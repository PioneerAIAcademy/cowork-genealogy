import type { Principal } from "../auth/principal.js";
import { mapWithConcurrency, withRetry } from "../utils/place-resolver.js";
import { selectRelativePairs } from "../utils/relatives.js";
import { scorePair } from "../utils/match-engine.js";
// scorePair (with its anchoring + FS-id mint) lives in the shared match-engine
// so rank_search_matches can reuse it; this tool's public contract is unchanged.
import type { SimplifiedGedcomX, SimplifiedPerson } from "../types/gedcomx.js";
import {
  isProjectForm,
  type SamePersonInput,
  type SamePersonExplicitInput,
  type SamePersonProjectInput,
  type SamePersonProjectResult,
  type SamePersonRelativeMatch,
  type SamePersonRelativesResult,
  type SamePersonResult,
  type ScoredRecordPersona,
  type ScoredTreePerson,
} from "../types/same-person.js";
import {
  NO_PROJECT_MESSAGE_READ,
  NoProjectError,
  readProjectJson,
  withProjectLock,
} from "../utils/project-io.js";
import { getProjectStore, type ProjectStore } from "../store/project-store.js";
import { recordReadTool } from "./record-read.js";
import { PERSONA_BEARING_PRODUCERS } from "../utils/results-staging.js";
import {
  NAME_TYPES,
  NAMES_SECOND_PERSON_KEYS,
  factTypeKey,
  isTwoParty,
  personaRolesById,
  projectRecordPersonas,
  projectedRecordDocument,
  recordPartyKeyer,
  type RecordPersonaGroup,
} from "../utils/record-persona.js";
import { recordMatchScore, type RecordedMatchScore } from "../utils/match-scores.js";
import { Mob } from "../utils/mob.js";
import { preferredName } from "../utils/name-helpers.js";
import { arkToBareId, toArk } from "../utils/ark.js";

/** Concurrency cap for the relatives-mode fan-out of per-pair FS calls. */
const PAIR_CONCURRENCY = 5;
/** Stable role order for sorting the relatives-mode matches list. */
const ROLE_ORDER: Record<SamePersonRelativeMatch["role"], number> = {
  parent: 0,
  spouse: 1,
  child: 2,
};

export async function samePerson(
  input: SamePersonInput,
  principal: Principal,
): Promise<SamePersonResult | SamePersonProjectResult | SamePersonRelativesResult> {
  if (isProjectForm(input)) return samePersonFromProject(input, principal);

  validateInput(input);

  if (input.matchRelatives) {
    return matchRelatives(
      input.gedcomx1,
      input.primaryId1,
      input.gedcomx2,
      input.primaryId2,
      principal,
    );
  }

  return scorePair(
    input.gedcomx1,
    input.primaryId1,
    input.gedcomx2,
    input.primaryId2,
    principal,
  );
}

// ─── Project-relative arm (issue #1731 step 1) ───────────────────────────────

class SamePersonInputError extends Error {}

/**
 * Resolved record documents, memoised per ProjectStore.
 *
 * Keyed on the STORE INSTANCE, not on `projectPath`. The desktop and both
 * harnesses reuse one store for the process, so the memo spans the session; a
 * shared server binds a fresh store per request (`src/http.ts`
 * `runWithProjectStore`), so nothing crosses a request boundary and one
 * patron's project read can never be served to another. A plain
 * `projectPath`-keyed module cache would do exactly that, since two patrons can
 * carry the same path string.
 *
 * Worth having because the agent resolves a record ONCE and reuses it across
 * every candidate it scores, while this arm is called once per link. Without
 * the memo a card about the cost of a call would turn one fetch per record into
 * one per link. Historical records do not change, so a session-lifetime memo is
 * safe.
 */
const recordDocCache = new WeakMap<ProjectStore, Map<string, SimplifiedGedcomX>>();

function cacheFor(): Map<string, SimplifiedGedcomX> {
  const store = getProjectStore();
  let m = recordDocCache.get(store);
  if (m === undefined) {
    m = new Map();
    recordDocCache.set(store, m);
  }
  return m;
}

/** Same-record test that tolerates the stored id spellings (resolver URL, bare
 *  `ark:`, type-prefixed), which the corpus carries all of.
 *
 *  Compares the CANONICAL ARK, not `arkToBareId`: dropping the `n:n:` type
 *  segment would pool the assertions of `1:1:X` (a persona), `1:2:X` (a source)
 *  and `3:1:X` (an image) into one projected record. See `scoresRef`. */
function sameRecord(a: unknown, b: unknown): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  return toArk(a).toLowerCase() === toArk(b).toLowerCase();
}

function personNames(p: SimplifiedPerson): string[] {
  return (p.names ?? []).map((n) =>
    [n.given, n.surname].filter(Boolean).join(" ").trim().toLowerCase(),
  );
}

/** A person's name as a response gives it: the preferred name, given name then
 *  surname, "" when the person has none. */
function displayName(person: SimplifiedPerson | undefined): string {
  const name = preferredName(person?.names);
  return [name?.given, name?.surname]
    .map((part) => (typeof part === "string" ? part.trim() : ""))
    .filter((part) => part !== "")
    .join(" ");
}

// ─── The names a link gives its party ────────────────────────────────────────
//
// A fetched `persons[]` carries names and no roles, so when the assertions'
// persona ids do not say which persona a link is about, the names they give
// have to. Two questions, never mixed: whose name is it (the assertion's own
// party, or another one), and how close a match is good enough.

/** A name as matching compares it: trimmed and lower case, the way `personNames`
 *  reads a persona's. A blank or non-string value is no name. */
function nameText(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() !== "" ? v.trim().toLowerCase() : undefined;
}

/** The assertion's `structured_value`, when it is an object. */
function structuredObject(assertion: any): Record<string, unknown> | undefined {
  const sv = assertion?.structured_value;
  return sv && typeof sv === "object" && !Array.isArray(sv) ? (sv as Record<string, unknown>) : undefined;
}

/** `given` then `surname` of a structured value, joined as `personNames` joins a
 *  persona's: the whole name, which is what matches a persona exactly. */
function joinedName(sv: Record<string, unknown>): string | undefined {
  return nameText([nameText(sv.given), nameText(sv.surname)].filter(Boolean).join(" "));
}

/** The value of the one key of a structured value that names a second person
 *  (`spouse`, `father`, `mother`, ...: `NAMES_SECOND_PERSON_KEYS`, as
 *  `factTypeKey` folds a key). Undefined when none does, and when several do:
 *  `{father, mother}` names two people, so neither answers a question about one. */
function secondPersonName(sv: Record<string, unknown>): string | undefined {
  const keys = Object.keys(sv).filter((k) => NAMES_SECOND_PERSON_KEYS.has(factTypeKey(k)));
  return keys.length === 1 ? nameText(sv[keys[0]]) : undefined;
}

/** What an assertion says one party is called: whole names, most specific
 *  first, and the given name and surname alone for a name given in parts. */
interface PartyWords {
  names: string[];
  given?: string;
  surname?: string;
}

function definedNames(names: Array<string | undefined>): string[] {
  return names.filter((n): n is string => n !== undefined);
}

/**
 * What the cited assertion says ANOTHER party of its record is called: the party
 * a `recordRole` asks for.
 *
 * Its own party's name never counts. On a fact about one person (a `name`), the
 * `given`, `surname` and `name` of its structured value are the name of the
 * person the assertion is about, and answering a request for another party with
 * it scores the wrong person. On a fact about two (a marriage, a relationship,
 * a parentage: `isTwoParty`) they name the OTHER party, as does the one key that
 * names a second person (`{spouse: "Mary Doyle"}` on the groom's marriage).
 * A key named by the role asked, and `related_person_name`, `person` and `other`,
 * name another party whatever the fact.
 */
function otherPartyWords(assertion: any, asked: string): PartyWords {
  const sv = structuredObject(assertion);
  if (sv === undefined) return { names: [] };
  const names = [nameText(sv[asked]), nameText(sv.related_person_name), nameText(sv.person), nameText(sv.other)];
  const words: PartyWords = { names: [] };
  if (isTwoParty(assertion?.fact_type)) {
    names.push(joinedName(sv), nameText(sv.name), secondPersonName(sv));
    words.given = nameText(sv.given);
    words.surname = nameText(sv.surname);
  }
  words.names = definedNames(names);
  return words;
}

/**
 * What the cited assertion says ITS OWN party is called. The key its own role
 * names; and, on a fact about one person, `name` and `given` + `surname`. On a
 * fact about two, `given`, `surname` and `name` name the other party, so they do
 * not say who this one is.
 */
function ownPartyWords(assertion: any, ownRole: string | undefined): PartyWords {
  const sv = structuredObject(assertion);
  if (sv === undefined) return { names: [] };
  const names = [ownRole !== undefined ? nameText(sv[ownRole]) : undefined];
  const words: PartyWords = { names: [] };
  if (!isTwoParty(assertion?.fact_type)) {
    names.push(nameText(sv.name), joinedName(sv));
    words.given = nameText(sv.given);
    words.surname = nameText(sv.surname);
  }
  words.names = definedNames(names);
  return words;
}

/** The names the record's own `name` assertions give the party at `role`: each
 *  one's `value`, and its structured given name and surname joined. */
function siblingNames(record: readonly any[], role: string): string[] {
  const names: Array<string | undefined> = [];
  for (const a of record) {
    if (a?.record_role !== role || !NAME_TYPES.has(String(a?.fact_type ?? "").toLowerCase())) continue;
    const sv = structuredObject(a);
    names.push(nameText(a?.value), sv !== undefined ? joinedName(sv) : undefined);
  }
  return definedNames(names);
}

/** How close a persona's name must be to a name the assertions give. */
type NameTest = (name: string, hint: string) => boolean;
/** The whole name, exactly. */
const SAME_NAME: NameTest = (n, h) => n === h;
/** The whole name loosely: one contains the other. */
const LIKE_NAME: NameTest = (n, h) => n.includes(h) || h.includes(n);
/** A part of a name (a given name, a surname): a whole word of the persona's. */
const HAS_WORDS: NameTest = (n, h) => ` ${n} `.includes(` ${h} `);

/** The personas any of whose names passes `test` against any of `hints`. */
function personsNamed(
  candidates: readonly SimplifiedPerson[],
  hints: readonly string[],
  test: NameTest,
): SimplifiedPerson[] {
  return candidates.filter((p) => personNames(p).some((n) => n !== "" && hints.some((h) => test(n, h))));
}

/**
 * The one persona some words name, or undefined when nothing does or when two
 * people answer to them: choosing between those is a guess, so the caller
 * refuses and lists them. In order: the whole name exactly, the whole name
 * loosely, then the given name alone and the surname alone. The last two are
 * the loosest, since a household shares a surname, so each counts only when it
 * matches a single persona.
 */
function personNamedBy(candidates: readonly SimplifiedPerson[], words: PartyWords): SimplifiedPerson | undefined {
  for (const test of [SAME_NAME, LIKE_NAME]) {
    const hits = personsNamed(candidates, words.names, test);
    if (hits.length > 0) return hits.length === 1 ? hits[0] : undefined;
  }
  for (const part of [words.given, words.surname]) {
    if (part === undefined) continue;
    const hits = personsNamed(candidates, [part], HAS_WORDS);
    if (hits.length === 1) return hits[0];
  }
  return undefined;
}

/**
 * Read a project document, turning every not-a-project state into an
 * LLM-actionable error.
 *
 * `same_person` is NOT in `tests/tools/no-project.test.ts`'s table, and that is
 * deliberate rather than an omission. That table's first assertion requires the
 * tool to RETURN `{ ok: false, reason: "no_project" }`; this tool returns a
 * score, so there is no answer shape to carry a no-project verdict in. Issue
 * #1695's ruling — "it is not fine for the user to see an error merely because
 * they are not in a project" — is about a WRITE being silently dropped. Here
 * nothing is being saved, the explicit two-document form still works anywhere,
 * and the right answer is to say so, which is what these messages do.
 */
async function readProject(projectPath: string, filename: string): Promise<any> {
  try {
    return await readProjectJson(projectPath, filename);
  } catch (e) {
    if (e instanceof NoProjectError) {
      throw new SamePersonInputError(
        `same_person: ${NO_PROJECT_MESSAGE_READ} There are no project references to ` +
          "resolve, so pass the two documents explicitly instead " +
          "(gedcomx1/primaryId1/gedcomx2/primaryId2).",
      );
    }
    throw new SamePersonInputError(
      e instanceof Error ? `same_person: ${e.message}` : String(e),
    );
  }
}

async function samePersonFromProject(
  input: SamePersonProjectInput,
  principal: Principal,
): Promise<SamePersonProjectResult | SamePersonRelativesResult> {
  const { projectPath, assertionId, treePersonId } = input;
  if (typeof assertionId !== "string" || assertionId.trim() === "") {
    throw new SamePersonInputError(
      "same_person: assertionId is required on the project-relative form.",
    );
  }
  if (typeof treePersonId !== "string" || treePersonId.trim() === "") {
    throw new SamePersonInputError(
      "same_person: treePersonId is required on the project-relative form.",
    );
  }

  const research = await readProject(projectPath, "research.json");
  const assertions: any[] = Array.isArray(research?.assertions) ? research.assertions : [];
  const assertion = assertions.find((a) => a?.id === assertionId);
  if (assertion === undefined) {
    throw new SamePersonInputError(
      `same_person: no assertion '${assertionId}' in this project's research.json.`,
    );
  }
  const recordId = String(assertion.record_id ?? "");
  if (recordId === "") {
    throw new SamePersonInputError(
      `same_person: assertion '${assertionId}' carries no record_id, so there is ` +
        "no record side to score. Leave match_score null and say so in the rationale.",
    );
  }
  const role = input.recordRole ?? (assertion.record_role as string | undefined);

  // ── the tree side ──
  const tree = (await readProject(projectPath, "tree.gedcomx.json")) as SimplifiedGedcomX;
  let mob: Mob;
  try {
    mob = new Mob(tree, treePersonId);
  } catch {
    throw new SamePersonInputError(
      `same_person: tree person '${treePersonId}' is not in tree.gedcomx.json. ` +
        "Score against a person that exists, or create it first.",
    );
  }
  const gedcomx2 = withoutRecordSourced(mob.matchSubset().gedcomx, research, recordId);

  // ── the record side: fetch first, derive second ──
  const resolved = await resolveRecordSide(input, research, assertion, recordId, role, principal);
  const { gedcomx1, primaryId1, recordSource, recordPersona } = resolved;

  if (input.matchRelatives) {
    const hasRels = (gedcomx1.relationships ?? []).length > 0;
    if (!hasRels) {
      return {
        matchRelatives: true,
        matches: [],
        note:
          `The record side for '${recordId}' was projected from assertions, which carry ` +
          "no relationships, so there are no record relatives to pair. Score the focus " +
          "person on its own (omit matchRelatives), or pass the record's gedcomx " +
          "explicitly if you have it.",
      };
    }
    return matchRelatives(gedcomx1, primaryId1, gedcomx2, treePersonId, principal);
  }

  const result = await scorePair(gedcomx1, primaryId1, gedcomx2, treePersonId, principal);

  // ── step 2: record what was computed ──
  let recorded = false;
  try {
    await withProjectLock(projectPath, async () => {
      // `buildRecordedScore` derives every field from the project documents;
      // what this call already resolved is authoritative and overrides it: the
      // persona, the role the response names for it, and the route. The shared
      // builder exists so the eval harness writes the same shape on a
      // fixture-served call rather than restating the rule.
      const derived = buildRecordedScore(
        research, assertionId, treePersonId, role, result, input.recordPersonaId,
      );
      if (derived !== null) {
        await recordMatchScore(projectPath, {
          ...derived,
          record_persona_id: recordPersona.id,
          record_role: recordPersona.role,
          record_source: recordSource,
        });
        recorded = true;
      }
    });
  } catch {
    // Best-effort, deliberately: the score is the answer and the agent asked for
    // it. Failing the call because the attestation could not be written would
    // make a disk problem look like an unscoreable identity, which is the exact
    // shape this card exists to stop producing.
    recorded = false;
  }

  // Built field by field, not spread from `result`: the spread carried the API's
  // framing of the request (`queryArk`, `candidateArk`, `apiTitle`, `updated`)
  // into every project-arm answer, and the answer should name whom it scored.
  const treePerson: ScoredTreePerson = {
    id: treePersonId,
    name: displayName((tree.persons ?? []).find((p) => p.id === treePersonId)),
  };
  return {
    matched: result.matched,
    ...(result.confidence !== undefined ? { confidence: result.confidence } : {}),
    score: result.score,
    recordSource,
    recorded,
    recordPersona,
    treePerson,
  };
}

/** The tree S-entry ids whose research sources reach `recordId` and no other
 *  record: tree ref -> research `sources[].gedcomx_source_description_id` ->
 *  research source id -> `assertions[].record_id`, the walk
 *  `mintedFromThisRecord` (research-append.ts) documents. */
function refsFromRecordOnly(research: any, recordId: string): Set<string> {
  const recordsBySource = new Map<string, Set<string>>();
  for (const a of (research?.assertions ?? []) as any[]) {
    const sid = a?.source_id;
    const rec = a?.record_id;
    if (typeof sid !== "string" || typeof rec !== "string" || rec === "") continue;
    if (!recordsBySource.has(sid)) recordsBySource.set(sid, new Set());
    recordsBySource.get(sid)!.add(rec);
  }
  const recordsByRef = new Map<string, Set<string>>();
  for (const src of (research?.sources ?? []) as any[]) {
    const ref = src?.gedcomx_source_description_id;
    if (typeof ref !== "string" || ref === "" || typeof src.id !== "string") continue;
    if (!recordsByRef.has(ref)) recordsByRef.set(ref, new Set());
    for (const rec of recordsBySource.get(src.id) ?? []) recordsByRef.get(ref)!.add(rec);
  }
  const refs = new Set<string>();
  for (const [ref, recs] of recordsByRef) {
    if (recs.size > 0 && [...recs].every((r) => r === recordId)) refs.add(ref);
  }
  return refs;
}

/** The tree side minus every fact and name sourced only from the record being
 *  scored. `materialize_facts` copies a record's facts onto the person it is
 *  linked to, so scoring that record again afterwards compares it with itself:
 *  Gaetjen's 1875 register persona scored 0.43 against I1 as the tree held him
 *  and 0.985 once its own facts were on I1 (live, 2026-10-12). A fact or name
 *  that also cites another source stays, and a person keeps at least one name. */
export function withoutRecordSourced(
  gedcomx: SimplifiedGedcomX,
  research: any,
  recordId: string,
): SimplifiedGedcomX {
  const refs = refsFromRecordOnly(research, recordId);
  if (refs.size === 0) return gedcomx;
  const onlyFromRecord = (item: { sources?: Array<{ ref?: string }> }): boolean => {
    const cited = (item.sources ?? [])
      .map((s) => (typeof s?.ref === "string" ? s.ref.replace(/^#/, "") : ""))
      .filter((r) => r !== "");
    return cited.length > 0 && cited.every((r) => refs.has(r));
  };
  const persons = (gedcomx.persons ?? []).map((p) => {
    const names = p.names?.filter((n) => !onlyFromRecord(n));
    return {
      ...p,
      names: names && names.length > 0 ? names : p.names,
      facts: p.facts?.filter((f) => !onlyFromRecord(f)),
    };
  });
  return { ...gedcomx, persons };
}

interface ResolvedRecordSide {
  gedcomx1: SimplifiedGedcomX;
  primaryId1: string;
  recordSource: "record_read" | "projection";
  /** The record persona this score is about: its id (null when the record names
   *  none), its name and the role the record's assertions give it. */
  recordPersona: ScoredRecordPersona;
}

// ─── Which record persona a link is about ────────────────────────────────────

/** What the other assertions of a record say about the party a call names. */
export type PartyBySiblings =
  | { kind: "own" }
  | { kind: "resolved"; personaId: string }
  | { kind: "ambiguous"; personaIds: string[] }
  | { kind: "unresolved" };

/** The role a call asks for when it names a DIFFERENT party from the one the
 *  assertion is about; undefined when it names no role, or the assertion's own. */
function otherRoleAsked(assertion: any, role: unknown): string | undefined {
  if (typeof role !== "string" || role === "") return undefined;
  const own = typeof assertion?.record_role === "string" ? assertion.record_role : undefined;
  return role === own ? undefined : role;
}

/** Every assertion of the record `assertion` cites, itself included. The record
 *  id is compared as `sameRecord` does, which tolerates the stored spellings. */
function recordAssertionsOf(research: any, assertion: any): any[] {
  return (Array.isArray(research?.assertions) ? research.assertions : []).filter((a: any) =>
    sameRecord(a?.record_id, assertion?.record_id),
  );
}

/**
 * Resolve the party a call names through the OTHER assertions of the same
 * record, when it names a different party from the one the assertion is about.
 *
 * A fetched `persons[]` carries no role, so "the father" cannot be read off the
 * record document. The record's own assertions can: each carries the persona id
 * and the role of the party it describes, and an extraction writes both on every
 * assertion of a party. The assertion's own persona says nothing about another
 * role, and answering a `recordRole` request with it scored the wrong person
 * while the attestation said otherwise.
 *
 *  - `own`        no different role was asked: the assertion's own party.
 *  - `resolved`   exactly one persona id is carried by siblings holding the role.
 *  - `ambiguous`  two or more ids are: two people at one role, which no caller
 *                 may be handed one of silently.
 *  - `unresolved` another role was asked and nothing carries it.
 *
 * Two kinds of id are no answer, however a sibling carries them. One the record
 * stamps on more than one role names no single party (the rule
 * `recordPartyKeyer` keys on, through `personaRolesById`): an extraction that
 * wrote the searched persona's id on every party gives "the father" the child's
 * id. And the assertion's own id is the party this call is NOT asking for.
 *
 * `presentIds`, when given, are the persona ids of the fetched record: a
 * sibling's id that the record does not hold is not an answer. The eval harness
 * has no fetch and omits it.
 *
 * Pure, and shared by `pickFetchedParty` (production) and `buildRecordedScore`
 * (the attestation the harness writes), so the two cannot disagree about which
 * persona a call is about.
 */
export function resolvePartyBySiblings(
  research: any,
  assertion: any,
  recordRole: string | undefined,
  presentIds?: readonly string[],
): PartyBySiblings {
  const asked = otherRoleAsked(assertion, recordRole);
  if (asked === undefined) return { kind: "own" };
  const record = recordAssertionsOf(research, assertion);
  const rolesById = personaRolesById(record);
  const own = typeof assertion?.record_persona_id === "string" ? assertion.record_persona_id : "";
  const personaIds: string[] = [];
  for (const a of record) {
    if (a?.record_role !== asked) continue;
    const pid = a?.record_persona_id;
    if (typeof pid !== "string" || pid === "") continue;
    if ((rolesById.get(pid)?.size ?? 0) > 1 || pid === own) continue;
    if (presentIds !== undefined && !presentIds.includes(pid)) continue;
    if (!personaIds.includes(pid)) personaIds.push(pid);
  }
  if (personaIds.length === 1) return { kind: "resolved", personaId: personaIds[0] };
  return personaIds.length > 1 ? { kind: "ambiguous", personaIds } : { kind: "unresolved" };
}

/** persona id -> the roles the record's assertions give it. A fetched
 *  `persons[]` has no role of its own, so this is where one comes from.
 *  Negative evidence (`record_role: "absent"`) is no role a persona holds. */
function personaRoles(research: any, assertion: any): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [pid, roles] of personaRolesById(recordAssertionsOf(research, assertion))) {
    out.set(pid, [...roles]);
  }
  return out;
}

/** The role a persona holds, preferring `prefer` when it holds several; null
 *  when no assertion names it. */
function roleOf(roles: Map<string, string[]>, personaId: string, prefer?: string): string | null {
  const list = roles.get(personaId);
  if (list === undefined) return null;
  return prefer !== undefined && list.includes(prefer) ? prefer : list[0];
}

/** Every persona of a fetched record as `id (name, role)`, so a refusal says who
 *  IS on the record. A role is only known from the assertions; a persona none of
 *  them names reads `role unknown`. */
function describePersonas(persons: SimplifiedPerson[], roles: Map<string, string[]>): string {
  const rows = persons
    .filter((p): p is SimplifiedPerson & { id: string } => typeof p.id === "string")
    .map((p) => `${p.id} (${displayName(p) || "unnamed"}, ${roles.get(p.id)?.join("/") ?? "role unknown"})`);
  return rows.length > 0 ? rows.join(", ") : "(none)";
}

/** A projected group as a refusal lists it: `id (name, role)`, with `no persona
 *  id` for a party the record gave none. */
function describeGroup(g: RecordPersonaGroup): string {
  return `${g.personaId ?? "no persona id"} (${g.names.join(" / ") || "unnamed"}, ${g.role})`;
}

/** The persona id an attestation files for a call, from the project documents
 *  alone: the caller's explicit `recordPersonaId`, else the persona the sibling
 *  lookup finds for a role asked, else the assertion's own. Null when the record
 *  names none, or another role was asked and nothing carries it. */
function attestedPersonaId(
  research: any,
  assertion: any,
  role: string | undefined,
  recordPersonaId: string | undefined,
): string | null {
  if (typeof recordPersonaId === "string" && recordPersonaId !== "") return recordPersonaId;
  const party = resolvePartyBySiblings(research, assertion, role);
  if (party.kind === "resolved") return party.personaId;
  if (party.kind === "own") return (assertion.record_persona_id as string | null) ?? null;
  return null;
}

/** The role an attestation files for a call. When the caller named a persona,
 *  the role the record's assertions give THAT persona, which need not be the role
 *  asked: filing the role asked beside another persona's id is an entry that
 *  contradicts itself. Otherwise the role the call asks for, else the
 *  assertion's own. Null when nothing says. The production response reports
 *  the same role, so the entry and the answer name one role for one persona. */
function attestedRole(
  research: any,
  assertion: any,
  role: string | undefined,
  recordPersonaId: string | undefined,
): string | null {
  const ownRole = typeof assertion?.record_role === "string" ? assertion.record_role : undefined;
  if (typeof recordPersonaId === "string" && recordPersonaId !== "") {
    return roleOf(personaRoles(research, assertion), recordPersonaId, ownRole);
  }
  return (typeof role === "string" && role !== "" ? role : ownRole) ?? null;
}

/** The attestation record for one scored pairing, derived from the project
 *  documents alone.
 *
 *  Extracted so the eval harness can write a truthful attestation on a
 *  fixture-served `same_person` call. `same_person` is not in the unit
 *  harness's `LIVE_TOOLS`, so this file never executes there and
 *  `recordMatchScore` never runs — which means no `results/.scores/` file
 *  exists in a unit run, and any writer-side gate that reads one is untestable.
 *  `record_search` has the same shape and its mock already stages its sidecar
 *  by calling the compiled build; this is the same move for this tool.
 *
 *  Restating the derivation in Python was the alternative and is forbidden:
 *  a second implementation is one the drift test cannot see.
 *
 *  Pure on purpose. `resolveRecordSide` decides `record_source` by whether the
 *  fetch actually returned personas, which needs the network, so this derives
 *  the likely branch from the documents instead: a persona id, a `record_read`
 *  log entry, or a persona-bearing search with a retained sidecar reads as
 *  `record_read`; anything else as `projection`.
 *
 *  It is NOT `personaReachable`, and the difference is deliberate. That
 *  predicate answers "could a score be obtained?" and so treats UNRESOLVABLE
 *  provenance as reachable, on purpose, to stop an assertion shedding the
 *  requirement by omitting its `log_entry_id`. This answers "which route
 *  assembled the record side?", where a missing log entry is evidence of
 *  nothing and `projection` is the honest answer. 257 corpus links are in that
 *  state, and the new `reads as projection when the log entry is missing
 *  entirely` test pins the divergence rather than leaving it to be read as a bug.
 *
 *  On the production path the value is overridden by what the fetch observed,
 *  so the derivation is load-bearing only in the harness. The persona it files
 *  comes from the lookup production uses (`resolvePartyBySiblings`, or the
 *  caller's `recordPersonaId`), so a call for the father files the father's
 *  persona whether or not a fetch happened. Where only a fetch can tell (a party
 *  found by name, a record with one persona) it files null or the assertion's own.
 *  The role it files is `attestedRole`'s: with a persona named, the role the
 *  record gives that persona.
 *
 *  Returns null when the pairing has no record side to attest — no such
 *  assertion, or no `record_id` on it — which is exactly when `samePerson`
 *  itself refuses. */
export function buildRecordedScore(
  research: any,
  assertionId: string,
  treePersonId: string,
  role: string | undefined,
  result: { score: number; confidence?: number; matched: boolean },
  recordPersonaId?: string,
): RecordedMatchScore | null {
  const assertions: any[] = Array.isArray(research?.assertions) ? research.assertions : [];
  const assertion = assertions.find((a) => a?.id === assertionId);
  if (assertion === undefined) return null;
  const recordId = String(assertion.record_id ?? "");
  if (recordId === "") return null;

  const log: any[] = Array.isArray(research?.log) ? research.log : [];
  const logEntry = log.find((l) => l?.id === assertion.log_entry_id);
  const fetchable =
    Boolean(assertion.record_persona_id) ||
    logEntry?.tool === "record_read" ||
    logEntry?.tool === "person_record_matches" ||
    (logEntry !== undefined &&
      PERSONA_BEARING_PRODUCERS.has(logEntry.tool) &&
      Boolean(logEntry.results_ref));

  return {
    record_id: recordId,
    record_persona_id: attestedPersonaId(research, assertion, role, recordPersonaId),
    record_role: attestedRole(research, assertion, role, recordPersonaId),
    tree_person_id: treePersonId,
    score: result.score,
    ...(result.confidence !== undefined ? { confidence: result.confidence } : {}),
    matched: result.matched,
    assertion_id: assertionId,
    record_source: fetchable ? "record_read" : "projection",
    computed: new Date().toISOString(),
  };
}

/**
 * Whom a project-arm call is about, from the project documents alone.
 *
 * The eval harness serves `same_person` from a canned fixture, and a fixture
 * whose predicate is `~` answers every pairing its test makes with the one
 * answer it was recorded with. Production names the pair each call asked for,
 * so the harness overlays this on the canned response: the id is the one
 * `buildRecordedScore` files, the name is the record's own name assertion for
 * that party (found as the projection route finds it), the role is the one
 * `buildRecordedScore` files, and the tree person is read from the tree.
 *
 * What the documents cannot say stays empty: no persona id is null, no name is
 * "". A fetch can say more, and the harness performs none.
 *
 * It names nobody that production would refuse to score. A persona id picks the
 * group keyed on it and nothing else: an id no group holds is named with no
 * name, not with the name of whichever group holds the role. With no id, the
 * party is the group at the role only when exactly one holds it; two groups at
 * one role are two people, which production refuses to choose between.
 *
 * Returns null when the assertion is not in the project.
 */
export function describeScoredPair(
  research: any,
  tree: SimplifiedGedcomX,
  assertionId: string,
  treePersonId: string,
  role: string | undefined,
  recordPersonaId?: string,
): { recordPersona: ScoredRecordPersona; treePerson: ScoredTreePerson } | null {
  const assertions: any[] = Array.isArray(research?.assertions) ? research.assertions : [];
  const assertion = assertions.find((a) => a?.id === assertionId);
  if (assertion === undefined) return null;

  const id = attestedPersonaId(research, assertion, role, recordPersonaId);
  const ownRole = typeof assertion.record_role === "string" ? assertion.record_role : undefined;
  const effectiveRole = typeof role === "string" && role !== "" ? role : ownRole;
  const groups = projectRecordPersonas(
    recordAssertionsOf(research, assertion),
    String(assertion.record_id ?? ""),
  );
  const atRole = groups.filter((g) => g.role === effectiveRole);
  const group =
    id !== null ? groups.find((g) => g.key === id) : atRole.length === 1 ? atRole[0] : undefined;
  return {
    recordPersona: {
      id,
      name: group?.names[0] ?? "",
      role: attestedRole(research, assertion, role, recordPersonaId),
    },
    treePerson: {
      id: treePersonId,
      name: displayName((tree?.persons ?? []).find((p) => p.id === treePersonId)),
    },
  };
}

async function resolveRecordSide(
  input: SamePersonProjectInput,
  research: any,
  assertion: any,
  recordId: string,
  role: string | undefined,
  principal: Principal,
): Promise<ResolvedRecordSide> {
  const { projectPath } = input;

  // Route 1 — the record's own GedcomX, via record_read in either of its modes.
  //
  // `record_read` IS both retrieval routes the agent does by hand: with a
  // resultsRef it reads the retained sidecar host-side, without one it does the
  // live FamilySearch read. It also normalises the id on both sides
  // (extractEntityId / arkToBareId), which a raw compare does not — `record_id`
  // is stored as a resolver URL on part of the corpus and as a bare ark: on the
  // rest. It writes nothing, stages nothing and logs nothing, so calling it
  // here is safe.
  //
  // Only a persona-bearing producer's sidecar (record_search, record_read) carries
  // a persona. A fulltext_search or external_links_search entry also has a
  // results_ref, but its results hold no gedcomx and key on `id` rather than
  // `recordId` (PERSONA_BEARING_PRODUCERS) — passing one would look up nothing.
  const log: any[] = Array.isArray(research?.log) ? research.log : [];
  const logEntry = log.find((l) => l?.id === assertion?.log_entry_id);
  const resultsRef =
    logEntry && PERSONA_BEARING_PRODUCERS.has(logEntry.tool) && logEntry.results_ref
      ? (logEntry.results_ref as string)
      : undefined;

  const cache = cacheFor();
  const cacheKey = `${projectPath}\u0000${arkToBareId(recordId)}`;
  let doc = cache.get(cacheKey);
  if (doc === undefined) {
    try {
      const read = await recordReadTool({ recordId, resultsRef, projectPath }, principal);
      doc = read as unknown as SimplifiedGedcomX;
      cache.set(cacheKey, doc);
    } catch {
      doc = undefined; // fall through to the projection
    }
  }

  if (doc !== undefined && (doc.persons ?? []).length > 0) {
    const party = pickFetchedParty(doc, input, assertion, role, recordId, research);
    return {
      gedcomx1: doc,
      primaryId1: party.id,
      recordSource: "record_read",
      recordPersona: {
        id: party.id,
        name: displayName((doc.persons ?? []).find((p) => p.id === party.id)),
        role: party.role,
      },
    };
  }

  // Route 2 — project the record's parties out of its own assertions.
  const own = (Array.isArray(research?.assertions) ? research.assertions : []).filter(
    (a: any) => sameRecord(a?.record_id, recordId),
  );
  const groups = projectRecordPersonas(own, recordId);
  if (groups.length === 0) {
    throw new SamePersonInputError(
      `same_person: record '${recordId}' could not be fetched and holds no projectable ` +
        "assertions, so there is no record side to score. Leave match_score null and say " +
        "so in the rationale.",
    );
  }
  if (role === undefined) {
    throw new SamePersonInputError(
      `same_person: assertion '${assertion.id}' carries no record_role, so the party to ` +
        `score is ambiguous. Pass recordRole explicitly (available: ${groups
          .map((g) => g.role)
          .join(", ")}).`,
    );
  }
  // `recordPersonaId` selects the party here too, not only on the fetched
  // route. `assertUnambiguous` below tells the agent to pass it when a role
  // names two people, and the schema advertises it as the disambiguator, so a
  // route that ignored it sent the agent round the same refusal for ever.
  // A persona id the record's extraction stamped on several roles names no one
  // party, so its assertions group by role (`recordPartyKeyer`); the
  // assertion's own role then picks the party.
  const sharedPid =
    typeof input.recordPersonaId === "string" &&
    own.some((a: any) => a?.record_persona_id === input.recordPersonaId) &&
    !groups.some((g) => g.key === input.recordPersonaId);
  let group: RecordPersonaGroup | undefined;
  if (typeof input.recordPersonaId === "string" && input.recordPersonaId !== "" && !sharedPid) {
    group = groups.find((g) => g.key === input.recordPersonaId);
  } else {
    // No persona was named. A call about the assertion's own party is about the
    // group that assertion falls in (the key `projectRecordPersonas` gave it):
    // two groups can hold one role, and the first of them is not always its.
    if (otherRoleAsked(assertion, role) === undefined) {
      const key = recordPartyKeyer(own)(assertion);
      group = groups.find((g) => g.key === key);
    }
    // Any other party is the group at the role asked, and two groups at one role
    // are two people. Taking the first would score one of them without saying so,
    // which the fetched route refuses; list them so the call can name one.
    if (group === undefined) {
      const atRole = groups.filter((g) => g.role === role);
      if (atRole.length > 1) {
        throw new SamePersonInputError(
          `same_person: role '${role}' in record '${recordId}' names more than one person ` +
            `(${atRole.map(describeGroup).join(", ")}), so scoring it would pick between them. ` +
            "Pass recordPersonaId to name one of them (a party shown with no persona id " +
            "cannot be named).",
        );
      }
      group = atRole[0];
    }
  }
  if (group === undefined && typeof input.recordPersonaId === "string") {
    throw new SamePersonInputError(
      `same_person: record '${recordId}' holds no persona with ` +
        `record_persona_id '${input.recordPersonaId}'. Known persona ids: ` +
        `${groups.map((g) => g.personaId).filter(Boolean).join(", ") || "(none recorded)"}. ` +
        `Available roles: ${groups.map((g) => g.role).join(", ")}.`,
    );
  }
  if (group === undefined) {
    throw new SamePersonInputError(
      `same_person: record '${recordId}' holds no persona for role '${role}'. ` +
        `Available roles: ${groups.map((g) => g.role).join(", ")}. If the record holds no ` +
        "persona for the party this link is about, leave match_score null and say so.",
    );
  }
  assertUnambiguous(group, recordId);

  return {
    gedcomx1: projectedRecordDocument(groups),
    primaryId1: group.key,
    recordSource: "projection",
    recordPersona: { id: group.personaId, name: group.names[0] ?? "", role: group.role },
  };
}

/**
 * Refuse to score a projected group that names more than one person.
 *
 * `record_role` is unique per party in the numbered vocabulary
 * (`child_1`, `witness_2`, …), but a transcribed register PAGE holds many
 * entries at one role each, and a role-keyed group merges them into one persona.
 * Scoring that merge is worse than refusing it.
 *
 * Deliberately NOT a general "two names means two people" rule. A group the
 * record itself assigned ONE `record_persona_id` to is one person under several
 * spellings (maiden name, scribal variant, "also known as"), and those are
 * keyed on the persona id rather than the role, so they never reach this guard
 * merged. Measured over 3,093 projected parties: 20 hold more than one distinct
 * name, of which 14 are role-keyed and refused here and 6 are persona-keyed and
 * exempt.
 *
 * The exemption trusts the extractor's persona id. 2 of those 6 look on
 * inspection like two people sharing one id rather than one person under two
 * spellings — an extraction defect this guard cannot see and does not try to.
 */
function assertUnambiguous(group: RecordPersonaGroup, recordId: string): void {
  if (group.names.length <= 1) return;
  if (group.personaId !== null) return; // one persona, several spellings
  throw new SamePersonInputError(
    `same_person: role '${group.role}' in record '${recordId}' names more than one ` +
      `person (${group.names.map((n) => JSON.stringify(n)).join(", ")}), so scoring it ` +
      "would compare a merge of them. This is normal for a transcribed page holding " +
      "several entries. Pass recordPersonaId to name one of them, or re-extract " +
      "so each entry carries its own record_role.",
  );
}

/** Whether the record's assertions give a persona roles and none of them is
 *  `role`: it is another party. False when no assertion names it, or when the
 *  assertion being scored has no role to compare. */
function knownAsAnotherRole(
  roles: Map<string, string[]>,
  personaId: string,
  role: string | undefined,
): boolean {
  const held = roles.get(personaId);
  return role !== undefined && held !== undefined && held.length > 0 && !held.includes(role);
}

/**
 * Which persons[].id in a FETCHED record document this link is about, and the
 * role the record's assertions give it.
 *
 * In this order:
 *  1. `recordPersonaId`, the caller's own word. A persona the record does not
 *     hold is refused, as on the projection route: skipping it scored whichever
 *     persona came next while the caller believed it had named one.
 *  2. A caller who asked for another role than the assertion's own (the second
 *     party of a relationship or marriage assertion):
 *       a. the persona id a sibling assertion of the same record carries for that
 *          role (`resolvePartyBySiblings`); two ids are two people and refused;
 *       b. the persona whose name is the name a sibling `name` assertion of that
 *          role gives, when exactly one persona's name is exactly that;
 *       c. the persona the cited assertion's own words name as that party
 *          (`otherPartyWords`), by the whole name exactly, the whole name loosely,
 *          then the given name alone and the surname alone, each when it names a
 *          single persona.
 *     The assertion's own persona is taken out of the candidates before any name
 *     is tried, since it is a different party: a name that finds it must not end
 *     the search while another persona bears the same name. A name given for the
 *     assertion's OWN party is not a name for this one.
 *  3. Otherwise the assertion's own persona (exact), then the name the assertion
 *     gives for its own party (`ownPartyWords`, matched as in 2c), then a record
 *     with one persona, unless the record's assertions know that persona as a
 *     different role than the assertion's own.
 * Everything else is refused, with every persona listed as `id (name, role)`.
 */
function pickFetchedParty(
  doc: SimplifiedGedcomX,
  input: SamePersonProjectInput,
  assertion: any,
  role: string | undefined,
  recordId: string,
  research: any,
): { id: string; role: string | null } {
  const persons = doc.persons ?? [];
  const ids = persons.map((p) => p.id).filter((i): i is string => typeof i === "string");
  const roles = personaRoles(research, assertion);
  const ownRole = typeof assertion?.record_role === "string" ? assertion.record_role : undefined;
  const listing = (only: readonly string[] = ids) =>
    describePersonas(persons.filter((p) => p.id !== undefined && only.includes(p.id)), roles);
  /** `label` is the role to report when the way the persona was found says
   *  what it is; otherwise the assertions that name it say. */
  const picked = (id: string, label?: string) => ({ id, role: label ?? roleOf(roles, id, ownRole) });

  const named = input.recordPersonaId;
  if (typeof named === "string" && named !== "") {
    if (ids.includes(named)) return picked(named);
    throw new SamePersonInputError(
      `same_person: record '${recordId}' holds no persona with record_persona_id '${named}'. ` +
        `Personas on the record: ${listing()}.`,
    );
  }

  const asked = otherRoleAsked(assertion, role);
  const sibling = resolvePartyBySiblings(research, assertion, role, ids);
  if (sibling.kind === "resolved") return picked(sibling.personaId, asked);
  if (sibling.kind === "ambiguous") {
    throw new SamePersonInputError(
      `same_person: role '${asked}' in record '${recordId}' names more than one person ` +
        `(${listing(sibling.personaIds)}), so scoring it would pick between them. ` +
        "Pass recordPersonaId to name one of them.",
    );
  }

  const own = typeof assertion?.record_persona_id === "string" ? assertion.record_persona_id : "";
  if (asked === undefined && own !== "" && ids.includes(own)) return picked(own);

  // The personas a name may find. For another party that is everyone but the
  // assertion's own persona, taken out here and not rejected after a name has
  // found it: a father and son who share a name would otherwise stop the search
  // at the son.
  const candidates = persons.filter(
    (p) => typeof p.id === "string" && !(asked !== undefined && p.id === own),
  );
  let hit: SimplifiedPerson | undefined;
  if (asked !== undefined) {
    const bySiblings = personsNamed(
      candidates,
      siblingNames(recordAssertionsOf(research, assertion), asked),
      SAME_NAME,
    );
    hit =
      bySiblings.length === 1
        ? bySiblings[0]
        : personNamedBy(candidates, otherPartyWords(assertion, asked));
  } else {
    hit = personNamedBy(candidates, ownPartyWords(assertion, ownRole));
  }
  if (hit?.id !== undefined) return picked(hit.id, asked ?? ownRole);

  if (
    asked === undefined &&
    persons.length === 1 &&
    ids.length === 1 &&
    !knownAsAnotherRole(roles, ids[0], ownRole)
  ) {
    return picked(ids[0], ownRole);
  }

  throw new SamePersonInputError(
    asked !== undefined
      ? `same_person: record '${recordId}' holds no persona for role '${asked}' that its ` +
          `assertions or the names they give resolve. Personas on the record: ${listing()}. ` +
          "If the record holds no persona for the party this link is about, leave " +
          "match_score null and say so; to score one of these, pass recordPersonaId."
      : `same_person: could not tell which persona of record '${recordId}' this link is ` +
          `about. Pass recordPersonaId (available: ${listing()}). If the record holds no ` +
          "persona for that party, leave match_score null and say so.",
  );
}

// ─── Relatives mode ──────────────────────────────────────────────────────────

async function matchRelatives(
  gedcomx1: SimplifiedGedcomX,
  primaryId1: string,
  gedcomx2: SimplifiedGedcomX,
  primaryId2: string,
  principal: Principal,
): Promise<SamePersonRelativesResult> {
  const { pairs, droppedForCap } = selectRelativePairs(
    gedcomx1,
    primaryId1,
    gedcomx2,
    primaryId2,
  );

  // Fan out one FS call per surviving pair, bounded + retried. A pair whose
  // call keeps failing is omitted from the result — one bad pair must not fail
  // the whole batch.
  const results = await mapWithConcurrency(pairs, PAIR_CONCURRENCY, async (pair) => {
    let result: SamePersonResult;
    try {
      result = await withRetry(() =>
        scorePair(
          gedcomx1,
          pair.target.id as string,
          gedcomx2,
          pair.candidate.id as string,
          principal,
        ),
      );
    } catch {
      return null;
    }
    const match: SamePersonRelativeMatch = {
      role: pair.role,
      targetId: pair.target.id as string,
      candidateId: pair.candidate.id as string,
      score: result.score,
      preScore: pair.preScore,
    };
    if (result.confidence !== undefined) match.confidence = result.confidence;
    return match;
  });

  const matches = results.filter(
    (m): m is SamePersonRelativeMatch => m !== null,
  );
  matches.sort(
    (a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || b.score - a.score,
  );

  const out: SamePersonRelativesResult = { matchRelatives: true, matches };
  if (droppedForCap > 0) out.droppedForCap = droppedForCap;
  return out;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function validateInput(input: SamePersonExplicitInput): void {
  const sides: Array<[SimplifiedGedcomX, string, "gedcomx1" | "gedcomx2"]> = [
    [input.gedcomx1, input.primaryId1, "gedcomx1"],
    [input.gedcomx2, input.primaryId2, "gedcomx2"],
  ];
  for (const [gedcomx, primaryId, side] of sides) {
    const persons = gedcomx?.persons;
    if (!Array.isArray(persons) || persons.length === 0) {
      throw new Error(
        `same_person: ${side} has no persons[] array.`,
      );
    }
    const ids = persons.map((p) => p.id).filter((id): id is string => typeof id === "string");
    if (!primaryId || !ids.includes(primaryId)) {
      throw new Error(
        `same_person: primaryId "${primaryId}" not found in ${side}. ` +
        `Available ids in ${side}: ${ids.join(", ") || "(none)"}.`,
      );
    }
  }
}

// ─── MCP schema ──────────────────────────────────────────────────────────────

export const samePersonSchema = {
  name: "same_person",
  description:
    "Ask FamilySearch whether two records describe the same person, and record " +
    "the score it computed.\n" +
    "\n" +
    "TWO WAYS TO CALL IT. Prefer the first.\n" +
    "\n" +
    "1. PROJECT-RELATIVE (cheap): `{ projectPath, assertionId, treePersonId }`. " +
    "Use this whenever you are about to write a `person_evidence` link — the " +
    "two ids are exactly what the link cites. The tool assembles both " +
    "documents itself: it resolves the record from the assertion (its retained " +
    "search sidecar, or a fresh read, or the record's own extracted " +
    "assertions), and builds the tree side as the candidate's matching mob " +
    "(focus + parents + spouses + children + siblings, capped at 40). You " +
    "hand-build nothing. It also records the score to the project, so the " +
    "`match_score` you then write is backed by a call that happened.\n" +
    "   Pass `recordRole` or `recordPersonaId` only for the SECOND party of a " +
    "relationship or marriage assertion — the party the assertion names but is " +
    "not itself about.\n" +
    "   Errors here are answers: if it says the record holds no persona for " +
    "that party, leave `match_score` null and say so in the rationale.\n" +
    "\n" +
    "2. EXPLICIT (two documents): when you already hold both GedcomX documents " +
    "and there is no project to resolve against — comparing two search results " +
    "to each other, for instance. Nothing is recorded on this path.\n" +
    "\n" +
    "Each result from the `record_search` tool carries a `gedcomx` field and a " +
    "`primaryId` field. Pass them straight through: `gedcomx1` = the first " +
    "result's `gedcomx`, `primaryId1` = its `primaryId`; likewise for " +
    "`gedcomx2`/`primaryId2`. Do NOT hand-build the gedcomx from the flat " +
    "summary fields — that drops the record ARK and the comparison fails.\n" +
    "\n" +
    "Returns a match decision with confidence (integer 1-5, omitted on " +
    "no-match) and score (float 0-1). Returns `matched: false` when the API " +
    "doesn't recognize a real match (confidence omitted, score near zero).\n" +
    "\n" +
    "Set `matchRelatives: true` to instead match the two focus persons' " +
    "RELATIVES (parents, spouses, children) — useful when attaching a " +
    "household record (head + spouse + children) to the tree and you need to " +
    "know which record-relative is which tree-relative. In that mode the result " +
    "shape is DIFFERENT: it has `matchRelatives: true` and a `matches` array of " +
    "`{ role, targetId, candidateId, score, confidence?, preScore }` triples " +
    "(targetId is a persons[].id in gedcomx1, candidateId in gedcomx2). It uses " +
    "local name/date heuristics to avoid scoring every possible pair.",
  inputSchema: {
    type: "object" as const,
    properties: {
      projectPath: {
        type: "string",
        description:
          "Project-relative form: the research project directory. Presence of " +
          "this field selects that form; gedcomx1/gedcomx2 are then not needed.",
      },
      assertionId: {
        type: "string",
        description:
          "Project-relative form: the assertion the person_evidence link will " +
          "cite (`a_...`). Resolves the record, the party and the retrieval " +
          "route.",
      },
      treePersonId: {
        type: "string",
        description:
          "Project-relative form: the candidate tree person's id in " +
          "tree.gedcomx.json (e.g. `I1`).",
      },
      recordRole: {
        type: "string",
        description:
          "Project-relative form, optional. Score a DIFFERENT party of the " +
          "same record than the assertion's own record_role — the other party " +
          "of a relationship or marriage assertion.",
      },
      recordPersonaId: {
        type: "string",
        description:
          "Project-relative form, optional. Name the record persona directly " +
          "when the assertion does not carry it and the party is ambiguous.",
      },
      gedcomx1: {
        type: "object",
        description:
          "First record's simplified-GedcomX document — the `gedcomx` field " +
          "of a `record_search` result, passed through verbatim.",
      },
      primaryId1: {
        type: "string",
        description:
          "The `primaryId` field of the same `record_search` result. Must match a " +
          "`persons[].id` in gedcomx1.",
      },
      gedcomx2: {
        type: "object",
        description:
          "Second record's simplified-GedcomX document — the `gedcomx` field " +
          "of another `record_search` result.",
      },
      primaryId2: {
        type: "string",
        description:
          "The `primaryId` field of the second `record_search` result. Must match a " +
          "`persons[].id` in gedcomx2.",
      },
      matchRelatives: {
        type: "boolean",
        description:
          "Default false. When true, match the focus persons' relatives " +
          "(parents/spouses/children) instead of the focus persons themselves, " +
          "returning a `matches` array of (role, targetId, candidateId, score) " +
          "triples. `primaryId1`/`primaryId2` still identify whose relatives to " +
          "gather. Use for household record-to-tree pairing.",
      },
    },
    // No top-level `required`: the two arms require different fields and JSON
    // Schema draft-07 `oneOf` is not reliably enforced by every MCP client, so
    // the tool validates the arm it was given and returns a message naming the
    // missing field. Listing the explicit form's four here would make the
    // cheap form look malformed to a validating client.
    required: [],
  },
};

import type { Principal } from "../auth/principal.js";
import { getValidToken } from "../auth/refresh.js";
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
  type SamePersonRelativeMatch,
  type SamePersonRelativesResult,
  type SamePersonResult,
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
  projectRecordPersonas,
  projectedRecordDocument,
  type RecordPersonaGroup,
} from "../utils/record-persona.js";
import { recordMatchScore } from "../utils/match-scores.js";
import { Mob } from "../utils/mob.js";
import { arkToBareId } from "../utils/ark.js";

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
): Promise<SamePersonResult | SamePersonRelativesResult> {
  if (isProjectForm(input)) return samePersonFromProject(input, principal);

  validateInput(input);

  // One OAuth token reused for the whole call (single pair or whole batch).
  const token = await getValidToken(principal);

  if (input.matchRelatives) {
    return matchRelatives(
      input.gedcomx1,
      input.primaryId1,
      input.gedcomx2,
      input.primaryId2,
      token,
    );
  }

  return scorePair(
    input.gedcomx1,
    input.primaryId1,
    input.gedcomx2,
    input.primaryId2,
    token,
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

/** Same-record test that tolerates the three stored id forms (resolver URL,
 *  bare `ark:`, type-prefixed), which the corpus carries all of. */
function sameRecord(a: unknown, b: unknown): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  return arkToBareId(a) === arkToBareId(b);
}

function personNames(p: SimplifiedPerson): string[] {
  return (p.names ?? []).map((n) =>
    [n.given, n.surname].filter(Boolean).join(" ").trim().toLowerCase(),
  );
}

/** The name an assertion gives the party this link is about — its
 *  `structured_value` first (where a relationship assertion names the other
 *  party), else its `value`. */
function partyNameHint(assertion: any, role: string | undefined): string | undefined {
  const sv = assertion?.structured_value;
  if (sv && typeof sv === "object" && !Array.isArray(sv)) {
    for (const key of [role, "name", "given", "surname", "person", "other"]) {
      if (key === undefined) continue;
      const v = (sv as Record<string, unknown>)[key];
      if (typeof v === "string" && v.trim() !== "") return v.trim().toLowerCase();
    }
    const given = typeof sv.given === "string" ? sv.given : "";
    const surname = typeof sv.surname === "string" ? sv.surname : "";
    const joined = [given, surname].filter(Boolean).join(" ").trim();
    if (joined !== "") return joined.toLowerCase();
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
): Promise<SamePersonResult | SamePersonRelativesResult> {
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
  const { gedcomx: gedcomx2 } = mob.matchSubset();

  // ── the record side: fetch first, derive second ──
  const resolved = await resolveRecordSide(input, research, assertion, recordId, role, principal);
  const { gedcomx1, primaryId1, recordSource, personaId } = resolved;

  const token = await getValidToken(principal);

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
    return matchRelatives(gedcomx1, primaryId1, gedcomx2, treePersonId, token);
  }

  const result = await scorePair(gedcomx1, primaryId1, gedcomx2, treePersonId, token);

  // ── step 2: record what was computed ──
  let recorded = false;
  try {
    await withProjectLock(projectPath, async () => {
      await recordMatchScore(projectPath, {
        record_id: recordId,
        record_persona_id: personaId,
        record_role: role ?? null,
        tree_person_id: treePersonId,
        score: result.score,
        ...(result.confidence !== undefined ? { confidence: result.confidence } : {}),
        matched: result.matched,
        assertion_id: assertionId,
        record_source: recordSource,
        computed: new Date().toISOString(),
      });
    });
    recorded = true;
  } catch {
    // Best-effort, deliberately: the score is the answer and the agent asked for
    // it. Failing the call because the attestation could not be written would
    // make a disk problem look like an unscoreable identity, which is the exact
    // shape this card exists to stop producing.
    recorded = false;
  }

  return { ...result, recordSource, recorded };
}

interface ResolvedRecordSide {
  gedcomx1: SimplifiedGedcomX;
  primaryId1: string;
  recordSource: "record_read" | "projection";
  /** The record persona this score is about, when the record names one. */
  personaId: string | null;
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
  // Only a record_search sidecar carries a persona. A fulltext_search or
  // external_links_search entry also has a results_ref, but its results hold no
  // gedcomx and key on `id` rather than `recordId`
  // (PERSONA_BEARING_PRODUCERS) — passing one would look up nothing.
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
    const primaryId1 = pickFetchedParty(doc, input, assertion, role, recordId);
    return {
      gedcomx1: doc,
      primaryId1,
      recordSource: "record_read",
      personaId: primaryId1,
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
  const group = groups.find((g) => g.role === role);
  if (group === undefined) {
    throw new SamePersonInputError(
      `same_person: record '${recordId}' holds no persona for role '${role}'. ` +
        `Available roles: ${groups.map((g) => g.role).join(", ")}. If the record holds no ` +
        "persona for the party this link is about, leave match_score null and say so.",
    );
  }
  assertUnambiguous(group, recordId);

  return {
    gedcomx1: projectedRecordDocument(groups, role, recordId),
    primaryId1: role,
    recordSource: "projection",
    personaId: group.personaId,
  };
}

/**
 * Refuse to score a projected group that names more than one person.
 *
 * `record_role` is unique per party in the numbered vocabulary
 * (`child_1`, `witness_2`, …), but a transcribed register PAGE holds many
 * entries at one role each, and grouping by role would merge them into one
 * persona and score the merge. Measured over the corpus's 524 projection-route
 * groups, 9 are ambiguous this way, across two runs.
 *
 * Deliberately NOT a general "two names means two people" rule: repo-wide, 18 of
 * the 22 role-level name collisions are ALIAS variants of a single persona
 * (maiden names, scribal variants, "also known as"). Those carry one
 * `record_persona_id`, so the guard exempts them explicitly rather than
 * false-firing on the commonest shape it would otherwise see.
 */
function assertUnambiguous(group: RecordPersonaGroup, recordId: string): void {
  if (group.names.length <= 1) return;
  if (group.personaId !== null) return; // one persona, several spellings
  throw new SamePersonInputError(
    `same_person: role '${group.role}' in record '${recordId}' names more than one ` +
      `person (${group.names.map((n) => JSON.stringify(n)).join(", ")}), so scoring it ` +
      "would compare a merge of them. This is normal for a transcribed page holding " +
      "several entries. Pass recordPersonaId, or give each entry its own record_role.",
  );
}

/** Which persons[].id in a FETCHED record document this link is about. */
function pickFetchedParty(
  doc: SimplifiedGedcomX,
  input: SamePersonProjectInput,
  assertion: any,
  role: string | undefined,
  recordId: string,
): string {
  const persons = doc.persons ?? [];
  const ids = persons.map((p) => p.id).filter((i): i is string => typeof i === "string");

  for (const candidate of [input.recordPersonaId, assertion?.record_persona_id]) {
    if (typeof candidate === "string" && candidate !== "" && ids.includes(candidate)) {
      return candidate;
    }
  }

  // The agent's own rule for the second party of a relationship assertion:
  // find the persona by the name the assertion gives that party.
  const hint = partyNameHint(assertion, input.recordRole ?? role);
  if (hint !== undefined) {
    const hit = persons.find((p) => personNames(p).some((n) => n !== "" && n === hint));
    if (hit?.id !== undefined) return hit.id;
    const loose = persons.find((p) =>
      personNames(p).some((n) => n !== "" && (n.includes(hint) || hint.includes(n))),
    );
    if (loose?.id !== undefined) return loose.id;
  }

  if (persons.length === 1 && ids.length === 1) return ids[0];

  throw new SamePersonInputError(
    `same_person: could not tell which persona of record '${recordId}' this link is ` +
      `about. Pass recordPersonaId (available: ${ids.join(", ") || "(none)"}). If the ` +
      "record holds no persona for that party, leave match_score null and say so.",
  );
}

// ─── Relatives mode ──────────────────────────────────────────────────────────

async function matchRelatives(
  gedcomx1: SimplifiedGedcomX,
  primaryId1: string,
  gedcomx2: SimplifiedGedcomX,
  primaryId2: string,
  token: string,
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
          token,
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
    "Returns a match decision with confidence (integer 1-10, omitted on " +
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

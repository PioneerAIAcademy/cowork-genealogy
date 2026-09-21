// record-persona — the assertion → person projection, and the assertion → tree-fact
// mapping it shares with `materialize_facts`.
//
// Lifted out of `src/tools/materialize-facts.ts` by lead ruling 2026-09-11
// (issue #1731): "`materialize_facts` already performs this mapping — lift it
// into `src/utils/` and give it a second consumer in step 1's project-relative
// `same_person`." The mapping below is a VERBATIM move; `materialize-facts.ts`
// now imports it. The projection at the bottom is the new second consumer.
//
// Why a util and not a cross-tool import: `same_person` needs this, and a
// `utils/` → `tools/` import is against CLAUDE.md's no-util→tool rule.
//
// Spec: docs/specs/same-person-tool-spec.md ("The record side").

import type {
  SimplifiedFact,
  SimplifiedGedcomX,
  SimplifiedName,
  SimplifiedPerson,
} from "../types/gedcomx.js";
import { toArk } from "./ark.js";

// ─── fact_type → tree fact type (honors the #711 structured-fact model) ───────
//
// An event's place/date are ATTRIBUTES of the one event fact, not their own fact
// types — extraction already folds birthplace/birth-date into a single `birth`
// assertion (research-append canonicalization), so here we only PascalCase the
// canonical event type and let date/place/value ride along as attributes. The
// value is null for event facts (below), which is why fact identity keys on
// `factsEquivalent` + `value`, never `(type, value)`.

/** Assertion fact_types handled as NON-facts: names, gender, and the ones this
 *  tool deliberately does not materialize (relationship edges are `tree_edit`
 *  add_relationship's job, §4.5; `age` is indirect evidence feeding a birth-year
 *  inference, not a standalone tree fact; `marriage` is a Couple-relationship
 *  event — per tree-edit.ts's own convention, "a Marriage/Divorce fact lives
 *  on the Couple, never duplicated onto each spouse" — so it can never be a
 *  correct PERSON-level write, structurally, not just usually. A caller
 *  wanting the marriage's date/place on the tree writes it via `tree_edit`
 *  `add_relationship`'s Couple `facts`, sourced with the same assertion via
 *  `sourceAssertionId`). Guards the exact mistake ut_person_evidence_022
 *  regression-tests: a `marriage` assertion on an already-existing spouse's
 *  persona getting materialized straight onto that person, leaving the
 *  relationship itself factless.
 *
 *  Skipped here means "not a fact for THIS persona" — it never meant the other
 *  party the assertion names has nowhere to go. That party is minted by the
 *  named-party arm below (§4.6), which writes her a sourced NAME — plus that
 *  persona's own facts where the record gives her a persona it never names AND
 *  the assertion's `related_person_role` corroborates the role — so the Couple
 *  event stays on the edge where it belongs. */
export const NAME_TYPES: ReadonlySet<string> = new Set(["name"]);
export const GENDER_TYPES: ReadonlySet<string> = new Set(["gender", "sex"]);
export const SKIP_TYPES: ReadonlySet<string> = new Set([
  "relationship",
  "age",
  "marriage",
  // `parentage`/`parentchild` join for the reason the comment above gives for
  // `marriage`: they establish a link between TWO parties, so they can never be
  // a correct person-level write, and the shared
  // RELATIONSHIP_ESTABLISHING_TYPES now says so on the sourcing side. Leaving
  // them out made the tool treat one fact_type two ways — a two-party link when
  // sourcing an edge, a person-level fact when materializing a persona. No tree
  // in the corpus carries a Parentage-like person fact, so nothing depended on
  // the old behaviour.
  "parentage",
  "parentchild",
]);

/** Couple-relationship event types, broken out so tree-forget.ts can import
 *  the set and sweep all of them without maintaining a parallel list. */
export const COUPLE_EVENT_TYPES: ReadonlySet<string> = new Set([
  "Marriage", "Divorce", "Annulment", "Engagement", "MarriageBanns", "Separation",
]);

/** Tree fact types whose `value` is null (events + place/duration attributes) —
 *  the qualifier `value` field is meaningful only for value-bearing types
 *  (Occupation, Race, Religion, Nationality, …). Exported so
 *  tests/packaging/tree-forget-sweep-drift.test.ts (#1549) can cross-reference
 *  its couple-event members against tree-forget.ts's swept set without
 *  re-declaring this list. */
export const EVENT_TREE_TYPES: ReadonlySet<string> = new Set([
  "Birth", "Death", "Christening", "Burial", "Baptism", "Cremation",
  ...COUPLE_EVENT_TYPES,
  "Residence", "Census", "MunicipalCensus", "Immigration", "Emigration",
  "Naturalization", "Will", "Probate", "Adoption",
]);

/** PascalCase a canonical snake_case fact_type into its tree type spelling:
 *  `birth` → `Birth`, `cause_of_death` → `CauseOfDeath`. Guarantees the
 *  uppercase-initial the tree schema requires. */
export function toTreeFactType(factType: string): string {
  return factType
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
}

/** The value when it is a string with non-space content, else undefined.
 *  Returns the value UNTRIMMED — the trim decides emptiness, it does not
 *  normalize the result. Exported because `research_append`'s rewrite has to
 *  compare a fact and an assertion the same way this reads them; a second copy
 *  there was a verbatim duplicate. */
export function factText(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() !== "" ? v : undefined;
}

/** Normalize a record/persona gender value to the tree enum, else undefined. */
export function normGender(v: unknown): "Male" | "Female" | "Unknown" | undefined {
  const g = String(v ?? "").trim().toLowerCase();
  if (g === "male" || g === "m") return "Male";
  if (g === "female" || g === "f") return "Female";
  if (g === "unknown" || g === "u") return "Unknown";
  return undefined;
}

// ─── build the tree-fact / tree-name candidate from an assertion ──────────────

export interface FactCandidate {
  type: string;
  date?: string;
  place?: string;
  standard_place?: string;
  value?: string;
}

export function factCandidate(assertion: any): FactCandidate {
  const type = toTreeFactType(String(assertion.fact_type));
  const cand: FactCandidate = { type };
  // Driven by `assertionFactAttr` rather than repeating its rules, so minting a
  // fact and later rewriting one cannot disagree about which assertion field
  // becomes which fact field. A second copy here is how the two would drift:
  // the rewrite's whole purpose is to keep a fact matching what minted it.
  for (const attr of ASSERTION_FACT_ATTRS) {
    const action = assertionFactAttr(assertion, attr, type);
    if (action !== null && "set" in action) cand[attr] = action.set;
    // `clear` and `malformed` both mean "nothing to mint here", which is what
    // the pre-shared `str()` call did for both. Minting is unchanged.
  }
  return cand;
}

/**
 * The tree-fact attributes an assertion supplies — the mirrored set a later
 * assertion correction rewrites on the fact it minted (#2472).
 *
 * Deliberately NOT `standard_date`: an assertion has no such field (the
 * research schema stops at `date`), so there is nothing to mirror. And not
 * `fact_type`: retyping an assertion is a re-classification, not an attribute
 * correction, and rewriting a fact's `type` under it would silently change what
 * the fact claims.
 *
 * Two near-neighbours, deliberately separate. `FACT_STRING_FIELDS`
 * (`tools/tree-edit.ts`) is the five fields a tree fact types as strings;
 * `checkTreeFact` (`validation/validator.ts`) passes those five plus
 * `assertion_id` for its type check. This set is the four an ASSERTION can
 * supply, a different question with a different answer, so it is derived from
 * neither. The differences, if they ever need to agree, are `standard_date`
 * (no assertion has one) and `assertion_id` (not an assertion field at all).
 */
export const ASSERTION_FACT_ATTRS = ["date", "place", "standard_place", "value"] as const;
export type AssertionFactAttr = (typeof ASSERTION_FACT_ATTRS)[number];

/**
 * What a rewrite should do to one tree-fact attribute, given the assertion the
 * fact was minted from and the fact's own tree type.
 *
 * The single source of that mapping: `factCandidate` below is driven by this
 * function rather than repeating it, so minting a fact and later rewriting one
 * cannot disagree about which assertion field becomes which fact field. `tree-forget.ts` already imports from this module and
 * `research-append.ts` already imports `treeDiff` from a sibling tool, so the
 * cross-tool import is the established shape here rather than a new util.
 *
 *   - `null`  — materialize would never have written this attribute, so leave
 *     whatever is there alone. Exactly one case: `value` on an event type,
 *     which `factCandidate` excludes (#711). An assertion's `value` is a prose
 *     sentence ("Immigrated to Canada, 1924; destination Odessa…"), and writing
 *     that into an Immigration fact's `value` is a fresh defect, not a fix.
 *   - `{ clear: true }` — the assertion asserts nothing here (null, absent or
 *     blank). Delete the key rather than writing `null`: the tree schema types
 *     these `string`, with no null branch, so assigning one makes the fact
 *     invalid.
 *   - `{ malformed: true }` — the assertion holds a NON-STRING here. Distinct
 *     from `clear` on purpose: "withdrawn" and "malformed" are different claims,
 *     and conflating them deletes tree data on a typo. `validator.ts` type-checks
 *     an assertion's `date`/`place`/`standard_place` but not its `value`, so a
 *     `value: 1924` reaches here and must not be read as "the researcher
 *     withdrew this". The caller leaves the fact alone and says so.
 *   - `{ set }` — the assertion's value, to write.
 */
export function assertionFactAttr(
  assertion: any,
  attr: AssertionFactAttr,
  treeFactType: string | undefined,
): { set: string } | { clear: true } | { malformed: true } | null {
  if (attr === "value" && EVENT_TREE_TYPES.has(String(treeFactType ?? ""))) return null;
  const raw = assertion?.[attr];
  if (raw === null || raw === undefined) return { clear: true };
  if (typeof raw !== "string") return { malformed: true };
  // A blank or whitespace-only string reads as "withdrawn" exactly as `null`
  // does — but it is also the likelier typo, so the caller WARNS on every clear
  // rather than trying to tell the two apart here. Deleting tree data is a
  // destructive edit whatever prompted it, and none of them should be silent.
  return raw.trim() === "" ? { clear: true } : { set: raw };
}

/** Whether an assertion of this `fact_type` can ever materialize as a PERSON
 *  fact. `name` becomes a tree name, `gender`/`sex` sets the scalar, and
 *  `SKIP_TYPES` (relationship, marriage, parentage, age, …) are two-party links
 *  or non-facts that never reach `person.facts` at all. Exported so
 *  `research_append` does not tell a caller to go re-check a fact that could
 *  not exist. */
export function materializesToPersonFact(assertion: any): boolean {
  // Mirrors the materialize loop's own four skips, in its order: negative
  // evidence stays an argument and never becomes a positive fact; `gender`/`sex`
  // set the scalar; `name` becomes a tree name; SKIP_TYPES are two-party links.
  if (assertion?.evidence_type === "negative") return false;
  const t = String(assertion?.fact_type ?? "").toLowerCase();
  return t !== "" && !NAME_TYPES.has(t) && !GENDER_TYPES.has(t) && !SKIP_TYPES.has(t);
}

/** The tree type an assertion's `fact_type` materializes as. Exported so the
 *  rewrite can tell when a fact no longer corresponds to its assertion's type. */
export function assertionTreeFactType(factType: unknown): string {
  return toTreeFactType(String(factType ?? ""));
}

/** A SimplifiedFact view of a candidate for factsEquivalent(). */
export function candAsFact(cand: FactCandidate): SimplifiedFact {
  const f: SimplifiedFact = { type: cand.type };
  if (cand.date !== undefined) f.date = cand.date;
  if (cand.place !== undefined) f.place = cand.place;
  if (cand.standard_place !== undefined) f.standard_place = cand.standard_place;
  if (cand.value !== undefined) f.value = cand.value;
  return f;
}

/** Given/surname from a name assertion — its structured_value when present, else
 *  parsed from `value` (surname = last token). Both parts are always returned
 *  (empty string, not undefined) so the minted name satisfies the tree schema's
 *  present-and-string given/surname requirement. */
export function nameParts(assertion: any): { given: string; surname: string } {
  const sv = assertion.structured_value;
  if (sv && typeof sv === "object" && !Array.isArray(sv)) {
    const given = typeof sv.given === "string" ? sv.given : "";
    const surname = typeof sv.surname === "string" ? sv.surname : "";
    if (given || surname) return { given, surname };
  }
  const tokens = String(assertion.value ?? "").trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { given: "", surname: "" };
  if (tokens.length === 1) return { given: tokens[0], surname: "" };
  return { given: tokens.slice(0, -1).join(" "), surname: tokens[tokens.length - 1] };
}

// ─── the record-side persona projection (issue #1731 step 1) ─────────────────
//
// Group a record's assertions by `record_role` and project each group into one
// record person, so a record with no fetchable GedcomX — an image-transcribed
// register page, a PDF, an external site, a search whose sidecar was not
// retained — is still scorable by `same_person`. Lead ruling 2026-09-11: the
// record side is DERIVED ON DEMAND, never stored and never built by the agent
// (a mis-shaped `persons[]` yields a bad score rather than an error).
//
// This is the FALLBACK route. `same_person` prefers the record's real GedcomX
// via `record_read` (sidecar or live), because a real persona carries parties
// the assertions never mention — the second party of a marriage assertion, most
// of all. See the tool spec for the route order and why it is that way.

/**
 * Types that never project onto a record persona.
 *
 * Three are two-party links: they assert an edge between two people, not an
 * attribute of one, and carry no date or place of their own to score. `age` is
 * here for a different and purely empirical reason — see below.
 *
 * DELIBERATELY NOT `materializesToPersonFact`, though the two now differ by
 * exactly one type. That predicate answers "may this be written onto a TREE
 * person's facts[]"; this one answers "what identifies this RECORD person", and
 * the answers part company on `marriage`: a Marriage fact belongs on the Couple
 * edge of a tree, but a real FamilySearch record persona carries one (14 of the
 * 356 person-level facts on committed real record personas are `Marriage`), and
 * this projection's standard is to look like a real record persona. That is
 * 286 of 11,340 corpus assertions — 2.5% — which would otherwise be dropped.
 *
 * **Measured, not assumed** (`dev/try-same-person-project.ts`, live API,
 * 2026-09-21), because the first version of this comment asserted both `age`
 * and `marriage` were discriminators and was half wrong:
 *
 *   - `Marriage` participates strongly: the same pairing scores 0.9480992 with
 *     a plausible marriage and 0.8032983 with an implausible one.
 *   - `Age` is IGNORED. An age of 42 and an age of 999 score identically
 *     (0.9333059 both), on a score nowhere near saturation. It also has no
 *     precedent — 0 of those 356 real-persona facts are `Age` — and it is
 *     structurally uncomparable: a tree person's facts[] can never hold an Age
 *     either, which is exactly why `materializesToPersonFact` skips it. So
 *     projecting one is payload that cannot ever move a score.
 *
 * `record-persona.test.ts` pins that the two predicates still differ, so a
 * later "tidy-up" cannot quietly collapse them.
 */
export const RECORD_PERSONA_SKIP_TYPES: ReadonlySet<string> = new Set([
  "relationship",
  "parentage",
  "parentchild",
  "age",
]);

/** Whether an assertion contributes a FACT to its record persona. Names and
 *  gender are handled separately (they become a `SimplifiedName` and the gender
 *  scalar); negative evidence never projects, by the same 2026-09-11 ruling that
 *  excludes `record_role: "absent"`. */
export function projectsToRecordPersonaFact(assertion: any): boolean {
  if (assertion?.evidence_type === "negative") return false;
  const t = String(assertion?.fact_type ?? "").toLowerCase();
  return (
    t !== "" &&
    !NAME_TYPES.has(t) &&
    !GENDER_TYPES.has(t) &&
    !RECORD_PERSONA_SKIP_TYPES.has(t)
  );
}

/** One record party, projected from the assertions that describe it. */
export interface RecordPersonaGroup {
  /** The projected `persons[].id`: the `record_persona_id` when the record
   *  named one, else the `record_role`. Also the attestation's party key, so
   *  the two cannot disagree about what identifies a party. */
  key: string;
  /** The `record_role` these assertions share. */
  role: string;
  /** The `record_persona_id` they share, or null when the record named none. */
  personaId: string | null;
  /** Every distinct `name` assertion value in the group. More than one is how a
   *  role that names two different people is detected (`same_person` refuses
   *  rather than scoring the merge). */
  names: string[];
  person: SimplifiedPerson;
}

/**
 * Whether an assertion may project at all. `record_role: "absent"` is negative
 * evidence about a person expected and NOT found, so it describes no persona
 * (lead ruling 2026-09-11, and the schema's own `$comment` on the role).
 */
function projectable(a: any): boolean {
  return (
    !!a &&
    typeof a === "object" &&
    a.record_role !== "absent" &&
    a.evidence_type !== "negative" &&
    typeof a.record_role === "string" &&
    a.record_role !== ""
  );
}

/**
 * Project every party of `recordId` out of `research.assertions`.
 *
 * Ids are matched with `arkToBareId`-style normalisation by the caller; this
 * takes the already-matched assertion list so the join rule lives in one place.
 */
export function projectRecordPersonas(
  assertions: unknown,
  recordIdForArk?: string,
): RecordPersonaGroup[] {
  // Key on `record_persona_id` when the record named one, else on
  // `record_role`. Grouping on the role ALONE merges two personas that share a
  // role into one projected person — a transcribed register page holds many
  // entries at one role each — and it also makes `recordPersonaId` unusable as
  // a disambiguator, because the two people the caller is trying to choose
  // between have already been collapsed by the time it is read.
  const byKey = new Map<string, any[]>();
  for (const a of Array.isArray(assertions) ? assertions : []) {
    if (!projectable(a)) continue;
    const pid = (a as any).record_persona_id;
    const key =
      typeof pid === "string" && pid !== "" ? pid : ((a as any).record_role as string);
    const bucket = byKey.get(key);
    if (bucket) bucket.push(a);
    else byKey.set(key, [a]);
  }

  const out: RecordPersonaGroup[] = [];
  for (const [key, group] of byKey) {
    const role = String(group[0]?.record_role ?? key);
    const person: SimplifiedPerson = { id: key };
    const names: string[] = [];
    const personaIds = new Set<string>();
    const facts: SimplifiedFact[] = [];
    const simpleNames: SimplifiedName[] = [];

    for (const a of group) {
      if (typeof a.record_persona_id === "string" && a.record_persona_id !== "") {
        personaIds.add(a.record_persona_id);
      }
      const t = String(a.fact_type ?? "").toLowerCase();
      if (NAME_TYPES.has(t)) {
        const v = factText(a.value);
        if (v !== undefined && !names.includes(v)) names.push(v);
        const { given, surname } = nameParts(a);
        simpleNames.push({ given, surname, preferred: simpleNames.length === 0 });
        continue;
      }
      if (GENDER_TYPES.has(t)) {
        const g = normGender(a.value) ?? normGender((a.structured_value ?? {}).gender);
        if (g !== undefined) person.gender = g;
        continue;
      }
      if (!projectsToRecordPersonaFact(a)) continue;
      facts.push(candAsFact(factCandidate(a)));
    }

    if (simpleNames.length > 0) person.names = simpleNames;
    if (facts.length > 0) person.facts = facts;
    out.push({
      key,
      role,
      personaId: personaIds.size === 1 ? [...personaIds][0] : null,
      names,
      person,
    });
  }
  return out;
}

/**
 * The projected record document. The caller anchors it with `primaryId1`,
 * which is the chosen group's `key`.
 *
 * NO `relationships[]`, deliberately. `record_role` is an OPEN enum
 * (`^[a-z][a-z0-9_]*$` — `enums.schema.json`), so inferring edges from role
 * names is guesswork, and a wrong edge scores worse than no edge. This is why
 * `matchRelatives` has nothing to pair on the projected route and says so
 * rather than returning an empty `matches` array.
 *
 * **NO `ark` either, and that is a correction.** An earlier version stamped
 * `toArk(record_id)` onto whichever party was the focus, to give `scorePair` a
 * persistent id instead of a minted one. That is wrong: a `1:1:` record id
 * names ONE persona (normally the searched/principal one), while every
 * assertion of the record carries it whatever its role. So scoring the bride
 * built a person wearing the principal's persona ARK, which
 * `buildRawWithAnchor` then writes into the focus person's
 * `http://gedcomx.org/Persistent` identifier before POSTing it — telling the
 * API the document is a persona it is not, for exactly the second-party links
 * this projection exists to serve.
 *
 * Nothing is lost by omitting it, which is why this is a correction rather
 * than a trade: `match-engine` mints a conforming ARK for a local id, and both
 * live probes show an ARK-less focus person scores normally
 * (`dev/probe-same-person-local-id.ts`: 0.9999484 against a 0.999967 control;
 * `dev/try-same-person-project.ts`: 0.9333059 on a projected persona whose
 * record id is not an ARK at all, so no ARK was ever attached there).
 */
export function projectedRecordDocument(
  groups: RecordPersonaGroup[],
): SimplifiedGedcomX {
  return { persons: groups.map((g) => g.person) };
}

// tree_forget — remove known information from tree.gedcomx.json so the agent
// must re-derive it from records.
//
// The engine behind the forget-and-rederive skill. A researcher who wants to
// know whether the agent can really *do* the research seeds a project from a
// well-documented FamilySearch person — at which point the answer is already in
// the local tree and "research" degrades to reading it back. This removes a
// chosen slice so the question becomes real again.
//
// Two rules shape the whole design (spec §2.1, §3.1):
//
//   1. It selects STRUCTURALLY, never by name. The caller passes
//      `{selector: "parents-of", personId: "I3"}`, not "remove Robert Smith";
//      the tool walks the tree's relationships to find the ids itself.
//   2. It reports COUNTS AND KINDS, never values. This result lands in the
//      context of the agent that is about to go looking for exactly this
//      information — printing what went would put the answer straight back and
//      make the exercise pointless. The researcher verifies in the viewer.
//
// Stripping the local copy is only half the mechanism: live FamilySearch still
// has the answer, so the agent must also be told not to look it up. That
// instruction lives in SKILL.md.
//
// Deliberately NOT part of tree_correct: that tool's `remove` never deletes a
// person, and that restriction is load-bearing for allowlist-enforceable write
// authority. Spec: docs/specs/tree-forget-tool-spec.md.

import { join } from "path";
import type {
  SimplifiedGedcomX,
  SimplifiedPerson,
  SimplifiedFact,
  SimplifiedRelationship,
} from "../types/gedcomx.js";
import { validateIntroduced } from "../validation/introduced-errors.js";
import { sanitizeTree } from "../validation/tree-sanitize.js";
import {
  atomicWriteJson,
  readProjectJson,
  fileExists,
  formatIssues,
  NoProjectError,
  noProjectResult,
} from "../utils/project-io.js";
import { coerceJsonArg } from "../utils/coerce-json-arg.js";
import { getStandardDate } from "../utils/fact-helpers.js";
import { earliestYear, latestYear, earliestIsUnbounded, latestIsUnbounded } from "../utils/date-helpers.js";

/** The pre-removal snapshot. Dot-prefixed on purpose — it still holds the
 *  answer, and both the agent's file browsing and the feedback bundler skip
 *  dot-prefixed entries. See spec §5. */
export const RESTORE_FILE = ".tree-before-forget.gedcomx.json";

export type ForgetSelectorKind =
  | "parents-of"
  | "children-of"
  | "spouses-of"
  | "birth-of"
  | "death-of"
  | "facts-of"
  | "facts-before"
  | "facts-after"
  | "facts-between"
  | "person"
  | "fact"
  | "relationship";

const SELECTOR_KINDS: ReadonlySet<string> = new Set<ForgetSelectorKind>([
  "parents-of",
  "children-of",
  "spouses-of",
  "birth-of",
  "death-of",
  "facts-of",
  "facts-before",
  "facts-after",
  "facts-between",
  "person",
  "fact",
  "relationship",
]);

// The subject's own person-level facts a relative selector must sweep alongside
// the structure it removes. FamilySearch carries a conclusion TWICE — as graph
// structure AND as a documentary fact on the subject's own record — so removing
// only the structure leaks the answer as a fact (and the fact can be the SOLE
// carrier when the relatives were never added as tree persons).
//
// These lists are a DELIBERATE, EVIDENCE-BACKED SUBSET, not the full couple/parent
// fact family. Add a type here only after confirming FS actually echoes it
// person-level in real data — never on assumption. (#1314's `Parents` matcher
// was nearly merged targeting an "undefined" type until a `person_read` RESULT
// in the feedback-2026-08-03 session log confirmed FS emits it — an upstream
// fact with an FS-native UUID id, not a value the agent wrote; do not repeat
// that in reverse by adding unverified types.) `materialize-facts.ts`'s
// `EVENT_TREE_TYPES` lists further couple-event types (`Engagement`,
// `MarriageBanns`) confirmed NOT to echo person-level — see
// COUPLE_TYPES_CONFIRMED_NOT_ECHOED below and issue #1549's corpus measurement.
//
// UNRESOLVED, left here rather than silently fixed (#1549): `Divorce` and
// `Annulment` are in this set with the SAME "0 corpus occurrences" evidence
// status that got Engagement/MarriageBanns/Separation excluded below. #1549's
// 2026-08-20 ruling kept them in the swept set anyway while its own text says
// "measures 0 person-level occurrences... so none earns a place" — that
// sentence and this line contradict each other, and no unredacted-data
// citation (the standard #1314's `Parents` met) was ever given for keeping
// them. Do not resolve this by editing the set; it needs the lead's ruling.
export const SWEPT_SPOUSE_FACT_TYPES = ["Marriage", "Divorce", "Annulment"] as const; // #1417, confirmed: 90 person-level Marriage facts across committed snapshot trees (2026-08-14); Divorce/Annulment have no corpus evidence yet — see #1549's open question above
export const SWEPT_PARENT_FACT_TYPES = ["Parents"] as const; // #1314, confirmed FS-native: a person_read result in the feedback-2026-08-03 session log returned type:"Parents" facts with FS UUID ids on GRNX-DFF ("Geo… Wilcox - Caroline E Woodruff") and GRN6-4MQ

// Couple-event types `materialize-facts.ts`'s `EVENT_TREE_TYPES` recognizes
// that #1549 measured and found NOT to earn a place in the swept set above:
// 0 person-level occurrences across the committed corpus (2026-08-20). Kept
// as a named, evidenced exclusion — not just an absence from the swept set —
// so the drift guard (tests/packaging/tree-forget-sweep-drift.test.ts) can
// tell "considered and excluded" apart from "never considered at all".
export const COUPLE_TYPES_CONFIRMED_NOT_ECHOED = ["Engagement", "MarriageBanns"] as const; // #1549, measured 2026-08-20: 0 person-level occurrences of either type across the committed corpus

export interface ForgetSelector {
  selector: ForgetSelectorKind;
  personId?: string;
  factType?: string;
  factId?: string;
  relationshipId?: string;
  /** facts-before/facts-after: the year threshold. */
  year?: number;
  /** facts-between: the inclusive range bounds. */
  fromYear?: number;
  toYear?: number;
}

export interface TreeForgetInput {
  projectPath: string;
  forget?: ForgetSelector[];
  dryRun?: boolean;
}

export interface TreeForgetRemoved {
  persons: number;
  relationships: number;
  relationshipsCascaded: number;
  factsByType: Record<string, number>;
}

export type TreeForgetResult =
  | {
      ok: true;
      dryRun: boolean;
      removed: TreeForgetRemoved;
      remaining: { persons: number; relationships: number };
      filesWritten: string[];
      restoreFile: string | null;
      validation: { valid: true; warnings: string[] };
    }
  // `reason: "no_project"` marks the one ok:false that is an answer rather than
  // a failure (see noProjectResult). Optional field on the existing arm, NOT a
  // third arm — every `if (!r.ok) r.errors…` keeps narrowing as it does today.
  | { ok: false; errors: string[]; reason?: "no_project" };

/** A user-correctable problem: bad selector, unknown id, nothing to remove,
 *  or an unreadable project file. Anything else propagates. */
class TreeForgetError extends Error {}

/** readProjectJson's expected failures, mapped onto the user-correctable class
 *  so they surface as `{ ok: false, errors }` rather than as a throw. The one
 *  exception is NoProjectError, which is an ANSWER rather than a failure and is
 *  re-raised unchanged for the outer catch to turn into noProjectResult(). */
async function readJson(projectPath: string, filename: string): Promise<any> {
  try {
    return await readProjectJson(projectPath, filename);
  } catch (e) {
    if (e instanceof NoProjectError) throw e;
    throw new TreeForgetError(e instanceof Error ? e.message : String(e));
  }
}

// ─── tree helpers ────────────────────────────────────────────────────────────

const persons = (tree: SimplifiedGedcomX): SimplifiedPerson[] => tree.persons ?? [];
const relationships = (tree: SimplifiedGedcomX): SimplifiedRelationship[] =>
  tree.relationships ?? [];

/** The two person ids a relationship connects, whatever its type. */
function endpoints(rel: SimplifiedRelationship): string[] {
  return rel.type === "ParentChild"
    ? [rel.parent ?? "", rel.child ?? ""]
    : [rel.person1 ?? "", rel.person2 ?? ""];
}

function requirePerson(tree: SimplifiedGedcomX, personId: string | undefined, sel: string): string {
  if (!personId) throw new TreeForgetError(`'${sel}' requires personId`);
  if (!persons(tree).some((p) => p.id === personId)) {
    throw new TreeForgetError(
      `no person '${personId}' in tree.gedcomx.json. Use the tree's own person id ` +
        `(the \`id\` field), not a FamilySearch PID unless they happen to match.`,
    );
  }
  return personId;
}

/**
 * (related person ids, relationship ids) for one structural relation.
 * Returns ids only — never names, which is the whole point.
 */
function relatives(
  tree: SimplifiedGedcomX,
  personId: string,
  kind: "parents" | "children" | "spouses",
): { people: Set<string>; rels: Set<string> } {
  const people = new Set<string>();
  const rels = new Set<string>();
  for (const rel of relationships(tree)) {
    const rid = rel.id ?? "";
    if (kind === "parents" || kind === "children") {
      if (rel.type !== "ParentChild") continue;
      const parent = rel.parent ?? "";
      const child = rel.child ?? "";
      if (kind === "parents" && child === personId) {
        people.add(parent);
        rels.add(rid);
      } else if (kind === "children" && parent === personId) {
        people.add(child);
        rels.add(rid);
      }
    } else {
      if (rel.type === "ParentChild") continue;
      const [p1, p2] = [rel.person1 ?? "", rel.person2 ?? ""];
      if (p1 === personId || p2 === personId) {
        people.add(p1 === personId ? p2 : p1);
        rels.add(rid);
      }
    }
  }
  return { people, rels };
}

function factIdsOfType(
  tree: SimplifiedGedcomX,
  personId: string,
  factType: string,
): Set<string> {
  const person = persons(tree).find((p) => p.id === personId);
  const wanted = factType.toLowerCase();
  return new Set(
    (person?.facts ?? [])
      .filter((f) => (f.type ?? "").toLowerCase() === wanted && f.id)
      .map((f) => f.id as string),
  );
}

/** factIdsOfType across several types, unioned — the person-level facts a
 *  relative selector must sweep alongside the structure it removes. */
function factIdsOfTypes(
  tree: SimplifiedGedcomX,
  personId: string,
  factTypes: string[],
): Set<string> {
  const ids = new Set<string>();
  for (const factType of factTypes) {
    factIdsOfType(tree, personId, factType).forEach((id) => ids.add(id));
  }
  return ids;
}

/** Leading token of a fact type, `+`/space-normalized: `"Marriage+bond"` and
 *  `"Marriage Registration"` both yield `"Marriage"`. FS emits couple/parent
 *  conclusions as free-text custom types that share this prefix with the
 *  canonical swept type without being an exact match (#1549). */
function leadingToken(factType: string): string {
  return factType.replace(/\+/g, " ").trim().split(/\s+/)[0] ?? "";
}

/**
 * Person-level facts whose type's leading token matches one of `sweptTypes`
 * but which are NOT an exact-match member of `removedIds` — so the sweep
 * above leaves them in place. Most such facts are distinct documentary
 * events, not echoes of the conclusion (#1549's ruling: a marriage bond, a
 * civil registration, a banns notice are real records in their own right),
 * so this warns rather than removes. Ids and type only, never the fact's
 * `value` — the same redaction rule every other notice in this file follows.
 */
function leftBehindCoupleFactWarnings(
  tree: SimplifiedGedcomX,
  personId: string,
  kind: "parents-of" | "spouses-of",
  sweptTypes: readonly string[],
  removedIds: ReadonlySet<string>,
): string[] {
  const person = persons(tree).find((p) => p.id === personId);
  const sweptTokens = new Set(sweptTypes.map((t) => t.toLowerCase()));
  const warnings: string[] = [];
  for (const f of person?.facts ?? []) {
    if (!f.id || !f.type || removedIds.has(f.id)) continue;
    if (!sweptTokens.has(leadingToken(f.type).toLowerCase())) continue;
    warnings.push(
      `${f.type} fact '${f.id}' on ${personId} was left in the tree — its type is not ` +
        `an exact match for the ${kind} sweep, so it was not removed. Confirm it does not ` +
        `duplicate the forgotten conclusion.`,
    );
  }
  return warnings;
}

function personOwnsFact(tree: SimplifiedGedcomX, personId: string, factId: string): boolean {
  const person = persons(tree).find((p) => p.id === personId);
  return (person?.facts ?? []).some((f) => f.id === factId);
}

/** A person and a relationship are two different id spaces — nothing in the
 *  tree or its validator guarantees they stay disjoint (a relationship's own
 *  id is never checked against person ids). factKey below carries this so an
 *  id shared across the two spaces can't collide the same way a bare factId
 *  did across persons (#1574). */
type OwnerKind = "person" | "relationship";

interface FactOwner {
  kind: OwnerKind;
  id: string;
}

/**
 * Every person or relationship whose facts array contains a fact with this
 * literal id. FamilySearch does not guarantee a fact id is unique across
 * persons (#1574) — more than one owner here is the collision this function
 * exists to surface, not a bug in this function.
 */
function findFactOwners(tree: SimplifiedGedcomX, factId: string): FactOwner[] {
  const owners: FactOwner[] = [];
  for (const p of persons(tree)) {
    if ((p.facts ?? []).some((f) => f.id === factId)) owners.push({ kind: "person", id: p.id ?? "" });
  }
  for (const r of relationships(tree)) {
    if ((r.facts ?? []).some((f) => f.id === factId)) {
      owners.push({ kind: "relationship", id: r.id ?? "" });
    }
  }
  return owners;
}

/** A request to check, later, whether a resolved fact's id ALSO exists on
 *  some other owner. Deferred rather than resolved on the spot: at the point
 *  any one selector resolves, the full removal set is not known yet, and an
 *  "other" owner sharing this id can turn out to be removed too, by a later
 *  match in the same tree-wide sweep or by a different selector in the same
 *  call (found by review — checking only against the pre-removal tree named
 *  an owner as untouched when this same call was also removing its copy). */
interface PendingFactNotice {
  ownerKind: OwnerKind;
  ownerId: string;
  factId: string;
  label: string;
}

function pendingFactNotice(
  ownerKind: OwnerKind,
  ownerId: string,
  factId: string,
  label: string,
): PendingFactNotice {
  return { ownerKind, ownerId, factId, label };
}

/** pendingFactNotice over a batch of ids resolved for one person — the
 *  `birth-of`/`death-of`/`facts-of`/`parents-of`/`spouses-of` shape, where
 *  every id shares one owner. */
function pendingFactNoticesForIds(
  pid: string,
  ids: Iterable<string>,
  label: string,
): PendingFactNotice[] {
  const notices: PendingFactNotice[] = [];
  for (const f of ids) {
    notices.push(pendingFactNotice("person", pid, f, label));
  }
  return notices;
}

/**
 * Turns each pending check into a final "also exists on" notice. Called
 * against the tree AFTER removal is fully applied (persons/relationships
 * reassigned to their kept sets, matched facts already pruned from every
 * survivor), so `findFactOwners` only ever finds an owner that genuinely
 * still has its own copy — an owner also removed this same call, whether by
 * this selector's own batch or a different one, has already lost its copy
 * by this point and cannot be named (found by review; see PendingFactNotice
 * for why this can't be resolved any earlier). Advisory only — removal
 * above is already correctly scoped regardless (#1574).
 *
 * Deduped on the final string, not on the pending entry's own (ownerKind,
 * ownerId, factId): two DIFFERENT removed facts (e.g. two different
 * people's own copies of the same shared id) can legitimately resolve to
 * the identical sentence once the tree state they're checked against is
 * the same for both — same factId, same post-removal "who else has it"
 * answer. And two selectors in the same call can independently rediscover
 * the exact same fact (e.g. each spouse's own person-scoped date selector
 * reaching their shared Couple relationship). Either way the second
 * occurrence tells the researcher nothing the first didn't already say
 * (found by review).
 */
function resolveFactSharingNotices(
  tree: SimplifiedGedcomX,
  pending: readonly PendingFactNotice[],
): string[] {
  const seen = new Set<string>();
  const notices: string[] = [];
  for (const { ownerKind, ownerId, factId, label } of pending) {
    const others = findFactOwners(tree, factId).filter(
      (o) => !(o.kind === ownerKind && o.id === ownerId),
    );
    if (others.length === 0) continue;
    const named = others.map((o) => `${o.id} (${o.kind})`).join(", ");
    const notice = `${label} fact '${factId}' also exists on: ${named}`;
    if (seen.has(notice)) continue;
    seen.add(notice);
    notices.push(notice);
  }
  return notices;
}

/**
 * Encodes an (ownerKind, ownerId, factId) triple as one Set entry.
 * JSON-encoded so no delimiter choice can collide with a real id's own
 * content. ownerKind is load-bearing, not decoration: a person and a
 * relationship can share a literal id (nothing checks the two id spaces
 * against each other), so (ownerId, factId) alone would silently reunite the
 * exact cross-owner leak this scoping exists to prevent, just across a
 * different pair of fields (#1574).
 */
function factKey(ownerKind: OwnerKind, ownerId: string, factId: string): string {
  return JSON.stringify([ownerKind, ownerId, factId]);
}

// ─── date-range selectors (#1574) ───────────────────────────────────────────
//
// `forget-and-rederive/SKILL.md` tells the agent NOT to read tree.gedcomx.json
// — the file holds the very answer it is about to go looking for. A date
// cutoff like "before 1850" therefore has to resolve to fact ids INSIDE the
// tool, never by the agent reading dates itself. These three selectors are
// that resolution: the year the caller passes is their own input, not tree
// data, so echoing it back in an error is not a redaction violation; a fact's
// OWN date value is never read into anything the caller receives.

interface DatedFact {
  ownerKind: OwnerKind;
  ownerId: string;
  fact: SimplifiedFact;
  earliest: number;
  latest: number;
}

/**
 * Every fact in scope that has a parseable date, with its earliest/latest
 * possible year. Scoped to one person's own facts when personId is given,
 * or every person AND relationship in the tree otherwise (the "tree-wide
 * variant" #1574 asks for). `skipped` counts facts in scope whose date
 * could not be parsed at all — they never match any date predicate, and the
 * caller is told the count (not which facts) so a dry run's silence about
 * them is never mistaken for "there were none."
 */
function datedFacts(
  tree: SimplifiedGedcomX,
  personId: string | undefined,
): { entries: DatedFact[]; skipped: number } {
  const entries: DatedFact[] = [];
  let skipped = 0;
  const consider = (ownerKind: OwnerKind, ownerId: string, facts: SimplifiedFact[] | undefined) => {
    for (const fact of facts ?? []) {
      // An id-less fact could never be targeted by factKey (its id would
      // collapse to the same "" as every other id-less fact on this owner),
      // so it must never become a match candidate here either — the same
      // guard factIdsOfType already applies for birth-of/facts-of. Not
      // currently reachable (validate-before-persist requires every fact to
      // carry an id), but this keeps the two resolution paths' guarantees
      // identical rather than relying on that being true forever.
      if (!fact.id) {
        skipped += 1;
        continue;
      }
      const std = getStandardDate(fact);
      if (std === null) {
        skipped += 1;
        continue;
      }
      const earliest = earliestYear(std);
      const latest = latestYear(std);
      if (earliest === null || latest === null) {
        skipped += 1;
        continue;
      }
      // `Bef`/`Aft` are open-ended on one side. date-helpers' FUDGE caps
      // that open side at a +/-10 year heuristic meant for the warning
      // checks, not a real bound: "Aft 1850" could be any later year, not
      // just up to 1860. Treating the fudge as a real bound let facts-before
      // sweep a fact that was never confidently before the threshold (found
      // by review) — unbounded on the open side instead, so the confident-
      // match predicates never fire there. earliestIsUnbounded/
      // latestIsUnbounded (not a bare string test) so a `Bet X and Y` range
      // where the modifier sits on only ONE side never voids the OTHER
      // side's already-real bound (found by an independent follow-up
      // review — a whole-string test over-refuses, never over-deletes, but
      // it's cheap to get exactly right while this function is open).
      entries.push({
        ownerKind,
        ownerId,
        fact,
        earliest: earliestIsUnbounded(std) ? -Infinity : earliest,
        latest: latestIsUnbounded(std) ? Infinity : latest,
      });
    }
  };
  if (personId !== undefined) {
    consider("person", personId, persons(tree).find((p) => p.id === personId)?.facts);
    // A marriage date normally lives on the Couple relationship, not on
    // either spouse's own record — the same reason spouses-of sweeps a
    // person-level Marriage fact in the other direction. Skipping this
    // would let a person-scoped date selector report success while a
    // dated fact the person is a party to stays in the tree, unremoved
    // and unmentioned (found by review).
    const { rels } = relatives(tree, personId, "spouses");
    for (const rid of rels) {
      const rel = relationships(tree).find((r) => r.id === rid);
      consider("relationship", rid, rel?.facts);
    }
  } else {
    for (const p of persons(tree)) consider("person", p.id ?? "", p.facts);
    for (const r of relationships(tree)) consider("relationship", r.id ?? "", r.facts);
  }
  return { entries, skipped };
}

function requireYear(value: unknown, sel: string, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TreeForgetError(`'${sel}' requires a numeric ${field}`);
  }
  return value;
}

// ─── selector resolution ─────────────────────────────────────────────────────

interface Targets {
  persons: Set<string>;
  /** (ownerKind, ownerId, factId) triples, each encoded by factKey.
   *  Owner-scoped so a fact id FamilySearch handed to more than one person
   *  (#1574) is only ever removed from the owner a selector actually
   *  resolved. */
  facts: Set<string>;
  relationships: Set<string>;
  /** One entry per resolved fact (birth-of/death-of/facts-of/parents-of/
   *  spouses-of/facts-before/facts-after/facts-between) whose literal id
   *  might also exist on a different owner. Not resolved to a final notice
   *  until every selector's removals are known (see PendingFactNotice). */
  pendingFactNotices: PendingFactNotice[];
  /** Advisory strings already final at the point they're added (e.g. the
   *  skipped-date count) — these need no later resolution. */
  factSharingNotices: string[];
}

/**
 * A `forget` call may not test different year thresholds for the same
 * date-range selector kind in one call. `resolveSelectors` processes entries
 * sequentially and throws on the first with zero matches, naming its own
 * threshold — so a single dry run packing a year-ladder into one entry (e.g.
 * facts-before at 1888, 1886, 1884, 1883 for the same person) reveals
 * exactly which threshold failed first, pinning a fact's date from ONE call
 * (found by review; reproduced: pins an exact year from one call, tighter
 * than the repeated-separate-calls form forget-and-rederive/SKILL.md closes
 * by instruction — that instruction cannot reach this in-call form, since it
 * is one tool invocation, not a series).
 *
 * Scoped to the THRESHOLD, not the selector kind: two entries of the same
 * kind sharing the identical year (or fromYear/toYear pair) are an ordinary
 * multi-person sweep — e.g. `facts-before(E1, 1850)` and
 * `facts-before(E2, 1850)` in one call — and stay allowed. Only a
 * *difference* in threshold for the same kind is the probe shape.
 */
function rejectVaryingDateThresholds(forget: ForgetSelector[]): void {
  // A `Map<string, string>` typed value would make `JSON.stringify(undefined)`
  // (itself the JS `undefined`, not a string — a malformed entry with no
  // `year` at all) collide with "never seen this kind before" if compared
  // against `undefined` directly. `.has()` distinguishes them. Note this guard
  // runs BEFORE the main loop, so a malformed entry alongside a valid one
  // reports the threshold error rather than `requireYear`'s missing-year error
  // — misleading, but only on input that is already invalid.
  const seenThreshold = new Map<string, string | undefined>();
  for (const entry of forget) {
    if (typeof entry !== "object" || entry === null) continue; // reported by the main loop below
    const kind = entry.selector;
    if (kind !== "facts-before" && kind !== "facts-after" && kind !== "facts-between") continue;
    const threshold =
      kind === "facts-between"
        ? JSON.stringify([entry.fromYear, entry.toYear])
        : JSON.stringify(entry.year);
    if (seenThreshold.has(kind) && seenThreshold.get(kind) !== threshold) {
      throw new TreeForgetError(
        `forget: multiple '${kind}' selectors with different year thresholds in one call ` +
          `are not allowed — the response would reveal which threshold a fact's date falls ` +
          `between. Use one threshold per call.`,
      );
    }
    seenThreshold.set(kind, threshold);
  }
}

function resolveSelectors(tree: SimplifiedGedcomX, forget: ForgetSelector[]): Targets {
  rejectVaryingDateThresholds(forget);

  const t: Targets = {
    persons: new Set(),
    facts: new Set(),
    relationships: new Set(),
    pendingFactNotices: [],
    factSharingNotices: [],
  };

  for (let i = 0; i < forget.length; i++) {
    const entry = forget[i];
    if (typeof entry !== "object" || entry === null) {
      throw new TreeForgetError(`forget[${i}] must be an object`);
    }
    const kind = entry.selector;
    if (!SELECTOR_KINDS.has(kind)) {
      throw new TreeForgetError(
        `forget[${i}]: unknown selector '${kind}'. Valid: ${[...SELECTOR_KINDS].join(", ")}`,
      );
    }

    switch (kind) {
      case "parents-of":
      case "children-of":
      case "spouses-of": {
        const pid = requirePerson(tree, entry.personId, kind);
        const relation = (
          { "parents-of": "parents", "children-of": "children", "spouses-of": "spouses" } as const
        )[kind];
        const { people, rels } = relatives(tree, pid, relation);
        // FamilySearch carries a conclusion TWICE: as structure AND as a
        // documentary fact on the subject's own record (person_read returns
        // both). Forgetting the structure must take the fact too, or the answer
        // survives on the subject. Each fact can even be the SOLE carrier — when
        // the related persons were never added as tree persons — so its presence
        // also keeps the selector from erroring as "matched nothing". The swept
        // type sets — and why they are a deliberate subset — are defined at
        // SWEPT_PARENT_FACT_TYPES / SWEPT_SPOUSE_FACT_TYPES. children-of is
        // unaffected: the `Parents` fact lives on the child, whom it removes whole.
        const redundantFactIds =
          kind === "parents-of"
            ? factIdsOfTypes(tree, pid, [...SWEPT_PARENT_FACT_TYPES])
            : kind === "spouses-of"
              ? factIdsOfTypes(tree, pid, [...SWEPT_SPOUSE_FACT_TYPES])
              : new Set<string>();
        if (people.size === 0 && rels.size === 0 && redundantFactIds.size === 0) {
          throw new TreeForgetError(
            `'${kind}' matched nothing — ${pid} has no ${relation} in the tree, ` +
              `so there is nothing to forget.`,
          );
        }
        people.forEach((p) => t.persons.add(p));
        rels.forEach((r) => t.relationships.add(r));
        redundantFactIds.forEach((f) => t.facts.add(factKey("person", pid, f)));
        // Same heads-up as birth-of/death-of/facts-of (#1574): a swept
        // Parents/Marriage/Divorce/Annulment fact id is not guaranteed
        // unique to this person either.
        const redundantLabel = kind === "parents-of" ? "Parents" : "Marriage/Divorce/Annulment";
        t.pendingFactNotices.push(...pendingFactNoticesForIds(pid, redundantFactIds, redundantLabel));
        // A left-behind leading-token-only match (e.g. "Marriage Registration")
        // is deliberately NOT swept (#1549) but is worth a warning regardless
        // of whether an exact-match fact was also found this call.
        if (kind === "parents-of") {
          t.factSharingNotices.push(
            ...leftBehindCoupleFactWarnings(tree, pid, kind, SWEPT_PARENT_FACT_TYPES, redundantFactIds),
          );
        } else if (kind === "spouses-of") {
          t.factSharingNotices.push(
            ...leftBehindCoupleFactWarnings(tree, pid, kind, SWEPT_SPOUSE_FACT_TYPES, redundantFactIds),
          );
        }
        break;
      }
      case "birth-of":
      case "death-of": {
        const pid = requirePerson(tree, entry.personId, kind);
        const factType = kind === "birth-of" ? "Birth" : "Death";
        const ids = factIdsOfType(tree, pid, factType);
        if (ids.size === 0) {
          throw new TreeForgetError(
            `'${kind}' matched nothing — ${pid} has no ${factType} fact.`,
          );
        }
        ids.forEach((f) => t.facts.add(factKey("person", pid, f)));
        t.pendingFactNotices.push(...pendingFactNoticesForIds(pid, ids, factType));
        break;
      }
      case "facts-of": {
        const pid = requirePerson(tree, entry.personId, kind);
        const factType = (entry.factType ?? "").trim();
        if (!factType) {
          throw new TreeForgetError("'facts-of' requires factType (e.g. Marriage, Residence)");
        }
        const ids = factIdsOfType(tree, pid, factType);
        if (ids.size === 0) {
          throw new TreeForgetError(
            `'facts-of' matched nothing — ${pid} has no ${factType} fact.`,
          );
        }
        ids.forEach((f) => t.facts.add(factKey("person", pid, f)));
        t.pendingFactNotices.push(...pendingFactNoticesForIds(pid, ids, factType));
        break;
      }
      case "facts-before":
      case "facts-after":
      case "facts-between": {
        // personId is OPTIONAL here — omitted means tree-wide, the variant
        // #1574 asks for alongside the person-scoped form. `!== undefined`,
        // not a truthy check: an explicitly-passed personId: "" must still
        // reach requirePerson's own "requires personId" error, the same as
        // every mandatory-personId selector already gives it — not silently
        // read as "omitted" and fall through to a full tree-wide sweep on
        // what is otherwise a destructive tool (found by review).
        const pid =
          entry.personId !== undefined ? requirePerson(tree, entry.personId, kind) : undefined;

        let matches: (earliest: number, latest: number) => boolean;
        let label: string;
        if (kind === "facts-before") {
          const year = requireYear(entry.year, kind, "year");
          // Confident match only: the fact's LATEST possible year must be
          // before the threshold, or a date that might actually be at/after
          // it would be swept by a selector named "before" — the same
          // over-broad-removal shape #1574 exists to eliminate, just moved
          // from id-collision onto date uncertainty.
          matches = (_earliest, latest) => latest < year;
          label = `before ${year}`;
        } else if (kind === "facts-after") {
          const year = requireYear(entry.year, kind, "year");
          matches = (earliest, _latest) => earliest > year;
          label = `after ${year}`;
        } else {
          const fromYear = requireYear(entry.fromYear, kind, "fromYear");
          const toYear = requireYear(entry.toYear, kind, "toYear");
          if (fromYear > toYear) {
            throw new TreeForgetError(`'facts-between' requires fromYear <= toYear`);
          }
          // Confident match: the fact's entire possible range must fit
          // inside [fromYear, toYear], not merely overlap it.
          matches = (earliest, latest) => earliest >= fromYear && latest <= toYear;
          label = `between ${fromYear} and ${toYear}`;
        }

        const { entries, skipped } = datedFacts(tree, pid);
        const matched = entries.filter((e) => matches(e.earliest, e.latest));
        if (matched.length === 0) {
          throw new TreeForgetError(
            `'${kind}' matched nothing${pid ? ` for ${pid}` : ""} — no fact's date is ` +
              `confidently ${label}.`,
          );
        }
        for (const m of matched) {
          const factId = m.fact.id ?? "";
          t.facts.add(factKey(m.ownerKind, m.ownerId, factId));
          // The fact's own type here, not the predicate label — consistent
          // with birth-of/facts-of's notices, and reads naturally ("Residence
          // fact ... also exists on"), whereas the predicate belongs in the
          // "matched nothing" error above, where restating it explains why.
          t.pendingFactNotices.push(
            pendingFactNotice(m.ownerKind, m.ownerId, factId, m.fact.type ?? "Unknown"),
          );
        }
        if (skipped > 0) {
          t.factSharingNotices.push(
            `${skipped} fact(s) in scope had no date this tool could compare and were ` +
              `not considered for '${kind}' — including any whose standard_date is not ` +
              `GEDCOM-canonical form (e.g. '1883-12-31' rather than '31 Dec 1883').`,
          );
        }
        break;
      }
      case "person": {
        t.persons.add(requirePerson(tree, entry.personId, kind));
        break;
      }
      case "fact": {
        if (!entry.factId) throw new TreeForgetError("'fact' requires factId");
        const factId = entry.factId;
        if (entry.personId !== undefined) {
          // Caller named the owner explicitly — the only way to disambiguate
          // a factId FamilySearch handed to more than one person (#1574).
          // `!== undefined`, not a truthy check: personId: "" must still
          // reach requirePerson's error rather than silently falling through
          // to the ambiguous-owner path below (found by review).
          const pid = requirePerson(tree, entry.personId, kind);
          if (!personOwnsFact(tree, pid, factId)) {
            throw new TreeForgetError(
              `'fact' factId '${factId}' does not belong to person '${pid}'.`,
            );
          }
          t.facts.add(factKey("person", pid, factId));
        } else {
          const owners = findFactOwners(tree, factId);
          if (owners.length > 1) {
            const named = owners.map((o) => `${o.id} (${o.kind})`).join(", ");
            throw new TreeForgetError(
              `'fact' factId '${factId}' exists on more than one owner: ${named} — ` +
                `add personId to target whichever one is a person.`,
            );
          }
          // owners.length === 0 uses the "" sentinel: no real owner has that
          // id, so applyForget's existing "not in the tree" check still
          // fires below, unchanged. owners.length === 1 resolves unambiguously,
          // carrying its real kind so it can't be confused with a same-id
          // owner of the other kind.
          const owner = owners[0];
          t.facts.add(factKey(owner?.kind ?? "person", owner?.id ?? "", factId));
        }
        break;
      }
      case "relationship": {
        if (!entry.relationshipId) {
          throw new TreeForgetError("'relationship' requires relationshipId");
        }
        t.relationships.add(entry.relationshipId);
        break;
      }
    }
  }
  return t;
}

// ─── the removal ─────────────────────────────────────────────────────────────

/**
 * Remove the targets in place, cascading relationships off removed persons.
 * Returns the redacted summary — how many of what kind went, never a value.
 */
interface ApplyForgetResult {
  removed: TreeForgetRemoved;
  factSharingNotices: string[];
}

function applyForget(tree: SimplifiedGedcomX, t: Targets): ApplyForgetResult {
  // A removed person takes every relationship touching them, or the tree is
  // left with links pointing at people who no longer exist.
  const cascaded = new Set(
    relationships(tree)
      .filter((r) => endpoints(r).some((id) => t.persons.has(id)))
      .map((r) => r.id ?? ""),
  );
  const deadRels = new Set([...t.relationships, ...cascaded]);

  const keptPersons = persons(tree).filter((p) => !t.persons.has(p.id ?? ""));
  const removedPersons = persons(tree).length - keptPersons.length;

  const keptRels = relationships(tree).filter((r) => !deadRels.has(r.id ?? ""));
  const removedRels = relationships(tree).length - keptRels.length;

  // Facts live on persons and on Couple relationships alike.
  const factsByType: Record<string, number> = {};
  const unmatched = new Set(t.facts);

  const pruneFacts = (ownerKind: OwnerKind) => (owner: { id?: string; facts?: SimplifiedFact[] }): void => {
    if (owner.facts === undefined) return;
    const ownerId = owner.id ?? "";
    owner.facts = owner.facts.filter((f) => {
      const fid = f.id ?? "";
      const key = factKey(ownerKind, ownerId, fid);
      if (!t.facts.has(key)) return true;
      const ftype = f.type ?? "Unknown";
      factsByType[ftype] = (factsByType[ftype] ?? 0) + 1;
      unmatched.delete(key);
      return false;
    });
  };
  keptPersons.forEach(pruneFacts("person"));
  keptRels.forEach(pruneFacts("relationship"));

  // A fact selector can target a fact whose owner is ALSO being wholesale-
  // removed by a person/relationship selector in the same call (e.g. `person:
  // I1` + `fact: <I1's own Birth fact>`). pruneFacts only ever visits KEPT
  // owners, so that fact's key is never touched above — but the request is
  // already satisfied, since the owner and everything on it is going away
  // regardless. Treating it as "not in the tree" would be wrong: the fact
  // unambiguously existed the instant before this call. Not counted in
  // factsByType either, consistent with a removed owner's OTHER facts, which
  // were never individually counted to begin with.
  for (const key of [...unmatched]) {
    const [ownerKind, ownerId] = JSON.parse(key) as [OwnerKind, string, string];
    const ownerAlsoRemoved =
      (ownerKind === "person" && t.persons.has(ownerId)) ||
      (ownerKind === "relationship" && deadRels.has(ownerId));
    if (ownerAlsoRemoved) unmatched.delete(key);
  }

  if (unmatched.size > 0) {
    // t.facts holds factKey-encoded (ownerKind, ownerId, factId) triples —
    // decode back to the bare factId for the message, matching the
    // pre-#1574 wording.
    const danglingFactIds = [...unmatched].map((k) => JSON.parse(k)[2] as string);
    throw new TreeForgetError(
      `these fact ids are not in the tree: ${danglingFactIds.sort().join(", ")}`,
    );
  }

  tree.persons = keptPersons;
  tree.relationships = keptRels;

  // Resolved against the tree AS IT NOW STANDS, post-removal — see
  // resolveFactSharingNotices for why that is the point every pending check
  // must wait for.
  const factSharingNotices = [
    ...resolveFactSharingNotices(tree, t.pendingFactNotices),
    ...t.factSharingNotices,
  ];

  return {
    removed: {
      persons: removedPersons,
      relationships: removedRels,
      relationshipsCascaded: [...cascaded].filter((r) => !t.relationships.has(r)).length,
      factsByType,
    },
    factSharingNotices,
  };
}

// ─── entry point ─────────────────────────────────────────────────────────────

export async function treeForget(input: TreeForgetInput): Promise<TreeForgetResult> {
  const { projectPath } = input;
  const dryRun = input.dryRun === true;

  // Recover an array the model serialized as a JSON string (see coerceJsonArg)
  // before any shape check, so a correct-but-stringified payload isn't rejected.
  const forget = coerceJsonArg(input.forget) as ForgetSelector[] | undefined;

  try {
    if (!Array.isArray(forget) || forget.length === 0) {
      return { ok: false, errors: ["`forget` must be a non-empty array of selectors"] };
    }

    const raw = await readJson(projectPath, "tree.gedcomx.json");
    // The pre-removal snapshot, taken before both the heal and the removal so
    // it reproduces the file exactly as it sits on disk. applyForget mutates in
    // place, so this has to be a copy, not a reference. (JSON round-trip rather
    // than structuredClone: the value came from JSON.parse, so it is faithful.)
    const original = JSON.parse(JSON.stringify(raw));

    // Heal legacy shapes before anything touches the document — the closed tree
    // shapes would otherwise refuse the write on a pre-tightening tree, with no
    // selector able to express the repair.
    const sanitized = sanitizeTree(raw);
    const tree = sanitized.tree;
    const research = await readJson(projectPath, "research.json");
    // Post-heal, pre-removal snapshot: block only on errors THIS call
    // introduces, not pre-existing drift in a section it never touches (#1572).
    const beforeTree = structuredClone(tree);

    const targets = resolveSelectors(tree, forget);
    const { removed, factSharingNotices } = applyForget(tree, targets);

    // Validate the WHOLE project before persisting. The realistic failure is a
    // dangling person reference from research.json (person_evidence,
    // subject_person_ids, timelines, known holdings) — this tool does not
    // repair those, by design, so the error names them and the caller decides.
    const validation = await validateIntroduced({ research, tree: beforeTree }, { research, tree }, { projectPath });
    if (!validation.valid) {
      return { ok: false, errors: formatIssues(validation.errors) };
    }

    const result: TreeForgetResult = {
      ok: true,
      dryRun,
      removed,
      remaining: { persons: persons(tree).length, relationships: relationships(tree).length },
      filesWritten: [],
      restoreFile: null,
      validation: {
        valid: true,
        warnings: [...sanitized.warnings, ...formatIssues(validation.warnings), ...factSharingNotices],
      },
    };
    if (dryRun) return result;

    // Snapshot the pre-removal tree — but only if there isn't one already, so
    // the restore point keeps pointing at the ORIGINAL rather than at an
    // already-forgotten intermediate (spec §5). No `.bak`: backupIfExists would
    // write a non-dot-prefixed copy of the answer, which is the one thing the
    // dot-prefix exists to prevent.
    const restorePath = join(projectPath, RESTORE_FILE);
    if (!(await fileExists(restorePath))) {
      await atomicWriteJson(restorePath, original);
    }

    await atomicWriteJson(join(projectPath, "tree.gedcomx.json"), tree);

    result.filesWritten = ["tree.gedcomx.json"];
    result.restoreFile = RESTORE_FILE;
    return result;
  } catch (e) {
    if (e instanceof NoProjectError) return noProjectResult();
    if (e instanceof TreeForgetError) return { ok: false, errors: [e.message] };
    throw e;
  }
}

// ─── MCP schema ──────────────────────────────────────────────────────────────

export const treeForgetSchema = {
  name: "tree_forget",
  description:
    "Set up a practice run: remove information the researcher already has from " +
    "the project's tree.gedcomx.json so it must be re-derived from records. " +
    "This is the ONLY tool that deletes tree persons outright (tree_correct's " +
    "remove never does, and merge_tree_persons collapses duplicates instead). " +
    "Use it only for the forget-and-rederive exercise — never to correct a " +
    "wrong fact (tree_correct) or to clean up a duplicate (merge_tree_persons).\n" +
    "\n" +
    "Selection is STRUCTURAL: pass tree person/fact/relationship ids and the " +
    "tool walks the tree's own relationships to resolve relatives. You do not " +
    "need to read — and are better off not reading — the names and dates you " +
    "are about to remove.\n" +
    "\n" +
    "The result reports COUNTS AND KINDS ONLY, never names, dates, or places: " +
    "printing the removed values would put the answer straight back into your " +
    "context and make the exercise worthless. The researcher confirms the gap " +
    "in the viewer. Do not restate removed values even if you know them.\n" +
    "\n" +
    "ALWAYS call with `dryRun: true` first and show the researcher the counts — " +
    "removing a person also removes every relationship touching them, so " +
    "forgetting a father can cut siblings, his own parents, and his marriage " +
    "(reported as `relationshipsCascaded`). Fact-level selectors (birth-of, " +
    "death-of, facts-of, facts-before, facts-after, facts-between, fact) " +
    "never cascade.\n" +
    "\n" +
    "FamilySearch does not guarantee a fact id is unique across owners. " +
    "Removal is always scoped correctly to the owner a selector resolved — " +
    "but if a resolved fact's id ALSO exists on a different owner not being " +
    "touched, `validation.warnings` says so (ids only, never a value). Not " +
    "an error; just tell the researcher.\n" +
    "\n" +
    "`parents-of`/`spouses-of` also WARNS (never removes) about a left-behind " +
    "fact whose type starts with the same word as a swept type but isn't an " +
    "exact match (e.g. `Marriage Registration`) — it may be a distinct " +
    "documentary record, not an echo of the forgotten conclusion.\n" +
    "\n" +
    "For a date-bounded request ('forget everything before 1850'), use " +
    "facts-before/facts-after/facts-between with a year, NOT your own reading " +
    "of tree.gedcomx.json's dates — the whole point of these selectors is " +
    "that the year threshold is your own input, never a value read off the " +
    "tree. Only a fact whose date is CONFIDENTLY inside the requested range " +
    "is removed; an uncertain or ranged date that only partly overlaps the " +
    "boundary is left alone rather than guessed. A fact with no parseable " +
    "date is never matched either; validation.warnings reports how many " +
    "were skipped this way (a count, not which ones).\n" +
    "\n" +
    "Validates the whole project before writing; on failure nothing is written " +
    "and `{ok: false, errors}` comes back — most often because research.json " +
    "still references a person being removed. A selector that matches nothing " +
    "is an error, not a no-op: read it as 'this was already forgotten'. " +
    "Writes tree.gedcomx.json plus a dot-prefixed restore file; NEVER read " +
    "that file — it still contains everything that was removed.",
  inputSchema: {
    type: "object" as const,
    properties: {
      projectPath: {
        type: "string",
        description:
          "Absolute path to the project directory holding tree.gedcomx.json and research.json.",
      },
      forget: {
        type: "array",
        description:
          "What to forget; one or more selectors, all applied to one in-memory tree " +
          "and written once (all-or-nothing).",
        items: {
          type: "object",
          properties: {
            selector: {
              type: "string",
              enum: [
                "parents-of",
                "children-of",
                "spouses-of",
                "birth-of",
                "death-of",
                "facts-of",
                "facts-before",
                "facts-after",
                "facts-between",
                "person",
                "fact",
                "relationship",
              ],
              description:
                "parents-of/children-of/spouses-of: the person's relatives AND the links to " +
                "them (cascades). parents-of ALSO removes the person's own `Parents` " +
                "documentary facts, and spouses-of ALSO removes the person's own " +
                "`Marriage`/`Divorce`/`Annulment` facts, so the forgotten conclusion does not " +
                "survive as a fact on the subject. birth-of/death-of: that person's Birth/Death " +
                "facts. facts-of: that person's facts of one type (needs factType). " +
                "facts-before/facts-after: that person's facts confidently before/after a " +
                "year, including a Couple relationship they are a party to (needs year). " +
                "facts-between: that person's facts confidently within an inclusive year " +
                "range, same reach (needs fromYear, toYear). All three date selectors " +
                "omit personId to apply tree-wide instead of to one person. person: one " +
                "person, cascading every relationship touching them. fact: one fact by id " +
                "(add personId if that id exists on more than one person). relationship: " +
                "one relationship by id.",
            },
            personId: {
              type: "string",
              description:
                "Tree person id (the `id` field, not a FamilySearch PID) — required for " +
                "parents-of, children-of, spouses-of, birth-of, death-of, facts-of, person. " +
                "Optional for fact: FamilySearch does not guarantee a fact id is unique " +
                "across persons, so pass this to say which person's copy to remove when " +
                "the tool reports the id exists on more than one. Optional for " +
                "facts-before/facts-after/facts-between: omit to apply tree-wide.",
            },
            factType: {
              type: "string",
              description:
                "Fact type for facts-of, e.g. Marriage or Residence. Matched case-insensitively.",
            },
            factId: { type: "string", description: "Fact id — required for the `fact` selector." },
            relationshipId: {
              type: "string",
              description: "Relationship id — required for the `relationship` selector.",
            },
            year: {
              type: "number",
              description:
                "Year threshold for facts-before (strictly before) or facts-after (strictly " +
                "after). Your own input, not a value read from the tree.",
            },
            fromYear: {
              type: "number",
              description: "facts-between: inclusive start year of the range.",
            },
            toYear: {
              type: "number",
              description: "facts-between: inclusive end year of the range. Must be >= fromYear.",
            },
          },
          required: ["selector"],
        },
      },
      dryRun: {
        type: "boolean",
        description:
          "Report what would go and write nothing. Always do this first and get the " +
          "researcher's agreement before applying — the cascade depends on the tree's " +
          "current shape, so a second forget's blast radius is not the first one's.",
      },
    },
    required: ["projectPath", "forget"],
  },
};

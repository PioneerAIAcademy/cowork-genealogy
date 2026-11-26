/**
 * The per-question state of a research project, and the next step each question
 * is waiting on — derived purely from `research.json`.
 *
 * **Why the document rather than the session's history.** The project folder is
 * the only durable state in this system: sessions are ephemeral, and the layer
 * that can observe control flow (a PreToolUse hook) runs in a sandbox that
 * cannot read the project at all. So "where are we" has exactly one honest
 * source, and it is this file. A document-derived state is also idempotent
 * under resume and compaction, and auditable afterwards, because its input is
 * committed alongside the run.
 *
 * **Per question, never per project.** A project holds N questions at N states
 * simultaneously; any single project-wide phase is wrong on arrival.
 *
 * **The state ladder is advisory. Nothing gates on it.** `state`, `nextStep`
 * and `openConflictIds` are a routing signal, never a refusal — no write is
 * refused because of anything this function returns. What changed: the
 * blocking-conflict predicate below is now *shared* with the completion gate in
 * `research_append`, which calls `conflictBlocksCompletion` rather than keeping
 * a third copy of the same reading. The gate still computes its own
 * preconditions; it no longer computes this one independently. This function
 * exists to tell the router what is outstanding — because a
 * call made without ever invoking the owning skill scores markedly worse than
 * one made after that skill's body was evicted from context, so getting the
 * skill invoked at all is the larger lever. Keeping it advisory is deliberate:
 * a state machine that can *deny* activity has to infer intent the document does
 * not carry, and would refuse legitimate work in a conversational product.
 *
 * Validated before it shipped: the same predicates, written in Python against
 * the 154 committed e2e runs, reproduce an independent count of the completion
 * gate's population to within two runs.
 */

import { owedFindings, type OwedFinding } from "./owed-findings.js";
import { earliestYear, latestYear, earliestIsUnbounded, latestIsUnbounded } from "./date-helpers.js";
import { disputeGroups, disputeGroupKey } from "./page-disputes.js";
import { countsForLinkedRung } from "./tree-person.js";
import { isLiveAssertion, questionAssertions } from "./assertion-liveness.js";
import { recordPartyKeys } from "./settled-birth-disputes.js";
import { awaitingUploadItemIds, closesHandOff, externalSiteOf } from "./awaiting-hand-offs.js";
import { routesToFamilySearch } from "./plan-item-plausibility.js";
import { isToolLoggedRead } from "./tool-logged-read.js";

export type QuestionState =
  | "framed"
  | "planned"
  | "searching"
  | "evidence-gathered"
  | "concluded"
  | "critiqued";

export interface QuestionStatus {
  id: string;
  state: QuestionState;
  /** What this question is waiting on, in the router's vocabulary. */
  nextStep: string | null;
  openConflictIds: string[];
  /** `questions[].status` verbatim — null when absent or not a string.
   *
   *  NOT a second opinion on `state`. `state` is this module's reading of the
   *  documents (any proof summary present ⇒ `"concluded"`); `storedStatus` is
   *  what the question says about itself. The two disagreeing is information,
   *  not a defect — a reader given only `state` reports a question as settled
   *  when its own status still says `in_progress`. */
  storedStatus: string | null;
  /** Linked assertions that disagree on a vital fact with no conflict entry
   *  naming the pair — a conflict the evidence shows and nobody registered. */
  unregisteredDisagreements: UnregisteredDisagreement[];
  /** Tree persons this question bears on with more than two parents and fewer
   *  than two hypotheses related to the question. */
  competingParentSets: CompetingParentSet[];
}

export interface UnregisteredDisagreement {
  personId: string;
  /** `"birth place"`, `"birth year"`, `"death place"` or `"death year"`. */
  fact: string;
  assertionIds: string[];
}

export interface CompetingParentSet {
  personId: string;
  parentIds: string[];
}

const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);

/**
 * Positive or partial log entries no assertion cites by `log_entry_id`. An
 * external-site entry whose capture has not come back is an open hand-off, not
 * something to extract. Nor is a page `image_transcribe` logged itself (#4721):
 * it records a read, not a find — a browsed page, a cut-off read, a hint page
 * since rejected — and `extraction_append` cites it when the page is extracted.
 */
function pendingExtraction(research: any, logs: any[]): any[] {
  const cited = new Set(arr(research?.assertions).map((a) => a?.log_entry_id));
  return logs.filter(
    (e) =>
      (e?.outcome === "positive" || e?.outcome === "partial") &&
      !cited.has(e?.id) &&
      !isToolLoggedRead(e) &&
      !(e?.tool === "external_site" && e?.external_site?.capture_received !== true),
  );
}

/** Which search destination a plan item wants: search-hints for a `fs_hints`
 *  item (issue #3153), else by its repository. `routesToFamilySearch` is the one
 *  FamilySearch-or-not rule, shared with research_append's outside-site check.
 *
 *  Lifted so section E's conflict-evidence arm and the ladder's own dispatch arm
 *  cannot disagree. They would: the plan writes E's arm as "the next step is
 *  search-records", which is right for the FamilySearch item it had in mind and
 *  wrong for a conflict whose decisive record is on Ancestry -- the router would
 *  spawn the wrong agent. */
function searchStepFor(item: any): string {
  if (item?.record_type === "fs_hints") return `search-hints — ${item.id}`;
  if (routesToFamilySearch(item)) return "search-records";
  return `search-external-sites — ${item.id} (${item.repository.trim()})`;
}

/** The lowest-sequence `planned`/`in_progress` item on a plan that is still
 *  active, **skipping one that waits only on the researcher's upload**. A
 *  `fs_hints` item is returned like any other: search-hints decides its hints
 *  and completes it in one spawn, so one left `in_progress` by the old
 *  verdict-waiting flow goes back to search-hints to finish.
 *
 *  `hasOpenWork` decides WHETHER a search is due from the set without the
 *  upload-waiting items; this picks WHICH one. Reading different sets let the
 *  ladder name a hand-off `awaitingUser` already lists — a link the router is
 *  told never to raise again — so the question stalled until the upload
 *  arrived. */
function nextUnexecutedItem(research: any, plans: any[]): any | null {
  const waitingOnUpload = awaitingUploadItemIds(research?.log);
  const searchedOut = searchedOutItemIds(research, plans);
  const items = openItems(plans)
    .filter((i) => !waitingOnUpload.has(i?.id) && !searchedOut.has(i?.id))
    .sort((a, b) => (Number(a?.sequence) || 0) - (Number(b?.sequence) || 0));
  return items[0] ?? null;
}

/** The step once nothing is left to search. Items searched with nothing found
 *  are still `in_progress`, and every gate reads that as unfinished work: the
 *  declaration, `hasOpenWork`, the unsettled-conflict ending and the new-question
 *  gate. So research-plan's Dispose mode closes them first (it completes a search
 *  that ran, even when it found nothing), and only then does the question go to
 *  research-exhaustiveness and proof-conclusion (lead, 2026-11-26). */
function searchSpentStep(research: any, plans: any[]): string {
  const waitingOnUpload = awaitingUploadItemIds(research?.log);
  const ids = [...searchedOutItemIds(research, plans)].filter((id) => !waitingOnUpload.has(id)).sort();
  return ids.length > 0
    ? `research-plan — dispose of ${ids.join(", ")} (searched, nothing found), then ` +
        "research-exhaustiveness and proof-conclusion"
    : "research-exhaustiveness, then proof-conclusion";
}

/** `in_progress` items already searched with nothing found: every entry they own
 *  is `negative`. search-records leaves such an item `in_progress`
 *  for re-planning, so it is executed, not due again; picking it re-ran the same
 *  searches turn after turn and the question never reached a conclusion
 *  (kenneth-quass-death, 2026-11-26: one item searched 9 times). A `fs_hints`
 *  item is never searched out: search-hints finishes it. */
function searchedOutItemIds(research: any, plans: any[]): Set<any> {
  const entries = arr(research?.log);
  const out = new Set<any>();
  for (const item of openItems(plans)) {
    if (item?.status !== "in_progress" || item?.record_type === "fs_hints") continue;
    const own = entries.filter((e) => e?.plan_item_id === item?.id);
    if (own.length > 0 && own.every((e) => e?.outcome === "negative")) {
      out.add(item?.id);
    }
  }
  return out;
}

/** The `planned`/`in_progress` items on a plan that is active or status-less. */
function openItems(plans: any[]): any[] {
  return plans
    .filter((p) => p?.status === undefined || p?.status === "active")
    .flatMap((p) => arr(p?.items))
    .filter((i) => i?.status === "planned" || i?.status === "in_progress");
}

/** Fact types that name one event per person, so two values are a disagreement
 *  rather than two events. `birthplace` is folded into `birth`'s place, since
 *  extractions record a birth's place under either. */
export const VITAL_EVENT: Readonly<Record<string, "birth" | "death">> = {
  birth: "birth",
  birthplace: "birth",
  death: "death",
  deathplace: "death",
};

/** Years further apart than this disagree. Census ages drift a year or two
 *  between enumerations; that is ordinary, not a conflict. */
export const YEAR_TOLERANCE = 2;

/** Both spellings of an assertion's place, each split into components. The raw
 *  and standardized forms are compared separately because standardization
 *  renames ("Forfarshire" → "Angus") and adds a country the raw form omits. */
export const placeForms = (a: any): string[][] =>
  [a?.place, a?.standard_place]
    .filter((p): p is string => typeof p === "string" && p.trim() !== "")
    .map((p) => p.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));

const partsMatch = (p: string, q: string): boolean => p.startsWith(q) || q.startsWith(p);

/** Places agree when every component of the less specific one matches one in
 *  the other — "England" agrees with "Rochdale, Lancashire, England", and
 *  "Russia" with "Russian Empire". Any pair of spellings agreeing is enough. */
export const placesAgree = (xs: string[][], ys: string[][]): boolean =>
  xs.some((x) =>
    ys.some((y) => {
      const [short, long] = x.length <= y.length ? [x, y] : [y, x];
      return short.every((p) => long.some((q) => partsMatch(p, q)));
    }),
  );

const BOUNDED_TEXT = /\b(between|bet|after|aft|before|bef)\b/i;

/** The span of years an assertion's date allows — `Bet 1836 and 1848` is
 *  [1836, 1848]; `Bef 1880` is open below and `Aft 1870` open above, so neither
 *  disagrees on its open side. A bounded date the standard-date parser cannot
 *  read ("after 1870, before 1880") is left out; any other unreadable date
 *  falls back to its first four-digit year as a one-year span. */
export const yearsOf = (a: any): [number, number] | null => {
  for (const raw of [a?.standard_date, a?.date]) {
    if (typeof raw !== "string") continue;
    const lo = earliestYear(raw), hi = latestYear(raw);
    if (lo !== null && hi !== null) {
      return [earliestIsUnbounded(raw) ? -Infinity : lo, latestIsUnbounded(raw) ? Infinity : hi];
    }
    if (BOUNDED_TEXT.test(raw)) return null;
    const m = raw.match(/\b(\d{4})\b/);
    if (m) return [Number(m[1]), Number(m[1])];
  }
  return null;
};

/** Pairs of linked assertions about one person's birth or death that disagree,
 *  with no conflict of ANY status naming both. A resolved conflict covers its
 *  pair: the disagreement was registered and settled. At least one assertion of
 *  each pair must be in `questionAssertionIds`. */
export function unregisteredDisagreements(
  research: any,
  questionAssertionIds: ReadonlySet<string>,
): UnregisteredDisagreement[] {
  const byId = new Map<string, any>();
  for (const a of arr(research?.assertions)) {
    if (isLiveAssertion(a) && typeof a?.id === "string" && VITAL_EVENT[a?.fact_type]) byId.set(a.id, a);
  }
  const groups = new Map<string, any[]>();
  for (const pe of arr(research?.person_evidence)) {
    const a = byId.get(pe?.assertion_id);
    if (!a || typeof pe?.person_id !== "string" || pe?.superseded_by != null) continue;
    const key = `${pe.person_id}\u0000${VITAL_EVENT[a.fact_type]}`;
    const g = groups.get(key) ?? [];
    if (!g.includes(a)) g.push(a);
    groups.set(key, g);
  }
  // A page that disputes its own index opens no conflict (ruling 10, #4286): a
  // pair inside one dispute group is that page's reading, reported and doubted
  // already, not a disagreement between two records.
  const disputes = disputeGroups(research);
  const allById = new Map<string, any>(
    arr(research?.assertions).filter((a) => typeof a?.id === "string").map((a) => [a.id, a]),
  );
  const groupOf = (id: string) => disputeGroupKey(allById.get(id), disputes, allById);
  const covered = (x: string, y: string): boolean =>
    (groupOf(x) !== undefined && groupOf(x) === groupOf(y)) ||
    arr(research?.conflicts).some((c) => {
      const ids = arr(c?.competing_assertion_ids);
      return ids.includes(x) && ids.includes(y);
    });

  const out: UnregisteredDisagreement[] = [];
  for (const [key, group] of groups) {
    const [personId, event] = key.split("\u0000");
    const aspects: Array<[string, (a: any, b: any) => boolean]> = [
      ["place", (a, b) => {
        const pa = placeForms(a), pb = placeForms(b);
        return pa.length > 0 && pb.length > 0 && !placesAgree(pa, pb);
      }],
      ["year", (a, b) => {
        const ya = yearsOf(a), yb = yearsOf(b);
        return ya !== null && yb !== null &&
          (ya[0] > yb[1] + YEAR_TOLERANCE || yb[0] > ya[1] + YEAR_TOLERANCE);
      }],
    ];
    for (const [aspect, disagree] of aspects) {
      const ids = new Set<string>();
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const a = group[i], b = group[j];
          if (!questionAssertionIds.has(a.id) && !questionAssertionIds.has(b.id)) continue;
          if (disagree(a, b) && !covered(a.id, b.id)) {
            ids.add(a.id);
            ids.add(b.id);
          }
        }
      }
      if (ids.size > 0) out.push({ personId, fact: `${event} ${aspect}`, assertionIds: [...ids].sort() });
    }
  }
  return out;
}

/** Persons this question bears on — the project's subjects plus every person
 *  its assertions are linked to — whose tree carries more than two birth
 *  parents (no subtype, or `Biological`), while fewer than two hypotheses relate
 *  to the question. Two candidate parent
 *  couples with no hypothesis per candidate is identity uncertainty nobody has
 *  set up to test. */
export function competingParentSets(
  research: any,
  tree: any,
  questionId: string,
  questionAssertionIds: ReadonlySet<string>,
  onlyPersonIds?: ReadonlySet<string>,
): CompetingParentSet[] {
  const related = arr(research?.hypotheses).filter((h) =>
    arr(h?.related_question_ids).includes(questionId),
  );
  if (related.length >= 2) return [];
  const inScope = new Set<string>(
    onlyPersonIds ?? arr(research?.project?.subject_person_ids).filter((id): id is string => typeof id === "string"),
  );
  for (const pe of onlyPersonIds ? [] : arr(research?.person_evidence)) {
    if (
      questionAssertionIds.has(pe?.assertion_id) &&
      typeof pe?.person_id === "string" &&
      pe?.superseded_by == null
    ) {
      inScope.add(pe.person_id);
    }
  }
  const parents = new Map<string, Set<string>>();
  for (const r of arr(tree?.relationships)) {
    if (r?.type !== "ParentChild" || typeof r?.child !== "string" || typeof r?.parent !== "string") continue;
    if (r?.subtype != null && String(r.subtype).toLowerCase() !== "biological") continue;
    if (!inScope.has(r.child)) continue;
    const s = parents.get(r.child) ?? new Set<string>();
    s.add(r.parent);
    parents.set(r.child, s);
  }
  return [...parents]
    .filter(([, s]) => s.size > 2)
    .map(([personId, s]) => ({ personId, parentIds: [...s].sort() }));
}

/** The person-evidence rung for a partly-linked question: some of its
 *  assertions are linked and some are not, yet no live link reaches a project
 *  subject. Null when every assertion is linked or rejected against a subject
 *  (`rejected_links`; person-evidence has nothing left to do, so the rung
 *  cannot loop), when a link already names a subject,
 *  or when no subject is a tree person. `linkedAssertionIds` holds the links
 *  `countsForLinkedRung` admits. */
export function subjectUnreached(
  research: any,
  tree: any,
  assertions: readonly any[],
  linkedAssertionIds: ReadonlySet<unknown>,
): { unlinked: number; subjects: string[] } | null {
  if (!tree) return null;
  const persons = new Set(arr(tree?.persons).map((p) => p?.id));
  const subjects = arr(research?.project?.subject_person_ids).filter(
    (id): id is string => typeof id === "string" && persons.has(id),
  );
  if (subjects.length === 0) return null;
  const rejected = new Set(
    arr(research?.rejected_links).filter((r) => subjects.includes(r?.person_id)).map((r) => r?.assertion_id),
  );
  const unlinked = assertions.filter((a) => !linkedAssertionIds.has(a?.id) && !rejected.has(a?.id)).length;
  if (unlinked === 0 || unlinked === assertions.length) return null;
  const ids = new Set(assertions.map((a) => a?.id));
  const reaches = arr(research?.person_evidence).some(
    (pe) => countsForLinkedRung(pe) && ids.has(pe?.assertion_id) && subjects.includes(pe?.person_id),
  );
  return reaches ? null : { unlinked, subjects };
}

/** Tree persons linked to this question's assertions whom nothing ties to a
 *  subject: no `ParentChild`/`Couple` path of any length or direction, and no
 *  record shared with a person who has one. Kinship like that was inferred, not
 *  read off a record, and needs a hypothesis before anything relies on it.
 *
 *  Empty when the question already has any related hypothesis: hypotheses carry
 *  no person ids, so "one names this person" cannot be computed, and matching
 *  `claim` text is fragile. Empty with no tree, or when no subject is a tree
 *  person — every linked person would otherwise count, the subject included.
 *
 *  A shared record is `record_id`, or `source_id` for an assertion with none:
 *  a household member read from the subject's own record is not inferred kin. */
export function unlinkedKin(
  research: any,
  tree: any,
  questionId: string,
  questionAssertionIds: ReadonlySet<string>,
): string[] {
  if (!tree) return [];
  const persons = new Set(arr(tree?.persons).map((p) => p?.id).filter((id): id is string => typeof id === "string"));
  const subjects = arr(research?.project?.subject_person_ids).filter(
    (id): id is string => typeof id === "string" && persons.has(id),
  );
  if (subjects.length === 0) return [];
  if (arr(research?.hypotheses).some((h) => arr(h?.related_question_ids).includes(questionId))) return [];

  const links = arr(research?.person_evidence).filter(
    (pe) => pe?.superseded_by == null && typeof pe?.person_id === "string",
  );
  const candidates = new Set<string>(
    links
      .filter((pe) => questionAssertionIds.has(pe?.assertion_id) && persons.has(pe.person_id))
      .map((pe) => pe.person_id),
  );
  if (candidates.size === 0) return [];

  const neighbours = new Map<string, string[]>();
  const connect = (a: unknown, b: unknown): void => {
    if (typeof a !== "string" || typeof b !== "string") return;
    for (const [from, to] of [[a, b], [b, a]]) {
      const list = neighbours.get(from);
      if (list) list.push(to);
      else neighbours.set(from, [to]);
    }
  };
  for (const r of arr(tree?.relationships)) {
    if (r?.type === "ParentChild") connect(r?.parent, r?.child);
    else if (r?.type === "Couple") connect(r?.person1, r?.person2);
  }
  const pathed = new Set<string>(subjects);
  const queue = [...subjects];
  for (let i = 0; i < queue.length; i++) {
    for (const next of neighbours.get(queue[i]) ?? []) {
      if (!pathed.has(next)) {
        pathed.add(next);
        queue.push(next);
      }
    }
  }

  const live = new Map(arr(research?.assertions).filter(isLiveAssertion).map((a) => [a?.id, a]));
  const recordKey = (a: any): unknown =>
    typeof a?.record_id === "string" && a.record_id !== "" ? a.record_id : a?.source_id;
  const keysByPerson = new Map<string, unknown[]>();
  for (const pe of links) {
    const key = live.has(pe?.assertion_id) ? recordKey(live.get(pe.assertion_id)) : null;
    if (key == null) continue;
    const list = keysByPerson.get(pe.person_id);
    if (list) list.push(key);
    else keysByPerson.set(pe.person_id, [key]);
  }
  const keysOf = (personId: string): unknown[] => keysByPerson.get(personId) ?? [];
  const anchored = new Set([...pathed].flatMap(keysOf));

  return [...candidates]
    .filter((id) => !pathed.has(id) && !keysOf(id).some((k) => anchored.has(k)))
    .sort();
}

/** Does `conflict` compete over any assertion in `assertionIds`?
 *
 *  The arm both consumers share. A conflict names the assertions that compete;
 *  whether that bears on a question is decided by which assertion ids the
 *  caller puts in the set — one question's, or every question's. */
const disputesAssertion = (conflict: any, assertionIds: ReadonlySet<string>): boolean =>
  arr(conflict?.competing_assertion_ids).some((id: string) => assertionIds.has(id));

/** An identity conflict, flagged by a non-empty `identity_question` STRING.
 *
 *  The schema types the field as the question's *text* (`string | null`), never
 *  a boolean, so the completion gate's original `=== true` was unsatisfiable
 *  dead code and an unresolved identity conflict slipped past whenever
 *  `blocks_question_ids` was empty too.
 *
 *  Says nothing about `status` — the callers that care check it themselves, and
 *  the gate's refusal message needs this reading on a snapshot entry `applyOne`
 *  has already mutated to `resolved`.
 *
 *  Deliberately NOT an arm of `conflictBlocksQuestion`: an identity conflict
 *  names no question, so folding it in there would report one unrelated
 *  conflict as open against every question in the project. */
export function isIdentityConflict(conflict: any): boolean {
  return (
    typeof conflict?.identity_question === "string" && conflict.identity_question.trim() !== ""
  );
}

/** Does an unresolved `conflict` block `questionId`?
 *
 *  Per-question, and used by the advisory ladder below. `questionAssertionIds`
 *  must be the assertions tied to THIS question — passing a project-wide set
 *  here silently widens `openConflictIds` to every question, which the unit
 *  suite pins. */
export function conflictBlocksQuestion(
  conflict: any,
  questionId: string,
  questionAssertionIds: ReadonlySet<string>,
): boolean {
  if (conflict?.status !== "unresolved") return false;
  return (
    arr(conflict?.blocks_question_ids).includes(questionId) ||
    disputesAssertion(conflict, questionAssertionIds)
  );
}

/** Assertion ids some question claims — `extracted_for_question_ids` non-empty.
 *
 *  The project-wide counterpart of one question's assertion set, and the scope
 *  `conflictBlocksCompletion` derives its link from. The question id is not
 *  checked against `questions[]`: nothing reference-checks
 *  `extracted_for_question_ids`, and a dangling id blocking is the safer
 *  direction than a dangling id going unseen (0 such refs across the corpus). */
export function questionTiedAssertionIds(research: any): Set<string> {
  return new Set(
    arr(research?.assertions)
      .filter((a) => isLiveAssertion(a) && arr(a?.extracted_for_question_ids).length > 0)
      .map((a) => a?.id)
      .filter((id): id is string => typeof id === "string"),
  );
}

/** Does an unresolved `conflict` block *any* question — the completion gate's
 *  predicate, project-wide.
 *
 *  Three arms, and the third is why this exists. `blocks_question_ids` and
 *  `identity_question` are the declared links, and 42 of the 75 conflicts in
 *  the committed e2e corpus carry neither, so a gate reading only those two is
 *  blind to 56% of them. The third arm derives the link from the evidence: a
 *  conflict competing over an assertion some question was built on bears on
 *  that question whether or not the agent wrote the link down.
 *
 *  Not narrowed to *unresolved* questions on purpose — a conflict bearing on an
 *  already-concluded question still means that conclusion rests on unresolved
 *  evidence. `resolved` and `moot` both settle a conflict. */
export function conflictBlocksCompletion(
  conflict: any,
  tiedAssertionIds: ReadonlySet<string>,
): boolean {
  if (conflict?.status !== "unresolved") return false;
  return (
    arr(conflict?.blocks_question_ids).length > 0 ||
    isIdentityConflict(conflict) ||
    disputesAssertion(conflict, tiedAssertionIds)
  );
}

/** Why `conflict` blocks completion, in the gate's refusal message.
 *
 *  A derived link is *inferred* rather than declared, so a refusal that named
 *  only the conflict id would leave the agent with no way to see what it is
 *  about — ADR-0011's "a gate PR owes an actionable error". Reads `research`
 *  live, and never `status`, so it still explains a snapshot entry this batch
 *  has since resolved. */
export function whyConflictBlocksCompletion(conflict: any, research: any): string {
  const reasons: string[] = [];
  // Every arm that fired, in the predicate's own order, not just the first.
  // Reporting one would drop the named questions from a conflict that both
  // names them and carries an identity_question.
  const blocks = arr(conflict?.blocks_question_ids);
  if (blocks.length > 0) reasons.push(`blocks ${blocks.join(", ")}`);
  // Names the FIELD, not the conflict type: the two disagree exactly when a
  // functionally-identity conflict was typed `fact`, which is the case worth
  // telling the caller about.
  if (isIdentityConflict(conflict)) reasons.push("identity_question set");
  for (const id of arr(conflict?.competing_assertion_ids)) {
    // EVERY assertion carrying this id, not the first: `disputesAssertion`
    // tests a set built from all of them, so a document with a duplicated id
    // whose later copy is the tied one blocks — and taking `find`'s first hit
    // would then explain a real refusal as "unresolved".
    const questions = arr(research?.assertions)
      .filter((a) => a?.id === id)
      .flatMap((a) => arr(a?.extracted_for_question_ids));
    if (questions.length > 0) {
      reasons.push(`disputes ${id}, which ${[...new Set(questions)].join(", ")} relies on`);
      // One tied assertion, deliberately, even when the conflict disputes
      // several. The message exists to make the refusal actionable, and the
      // action is the same for all of them — run conflict-resolution on this
      // conflict — so naming every one lengthens an error the caller reads
      // under failure without changing what it does next. The conflict id is
      // the handle; the assertion is there to show the link that was inferred
      // rather than declared.
      break;
    }
  }
  return reasons.length > 0 ? reasons.join("; ") : "unresolved";
}

/** Whether a `resources_spent` stop's justification opens with the verdict
 *  "Overturn risk: low", which is what makes concluding the default (section B).
 *  "Overturn risk: high — <sources>" names a source that could change the
 *  answer, so it defaults to searching it; an older stop wrote free prose and
 *  defaults to research-plan too. Only the low verdict concludes. */
function lowOverturnRisk(question: any): boolean {
  const justification = question?.search_stop?.justification;
  return typeof justification === "string" && /^\s*overturn risk:\s*low\b/i.test(justification);
}

/** Section B's choice: a question whose search stopped on RESOURCES, with
 *  nothing left running and nothing unaccounted for.
 *
 *  All four halves have to hold, and each rules out a different wrong routing:
 *  a stop for any other reason is a finding, not a budget; a summary means the
 *  question is already concluded; an open plan item means the search has not
 *  actually stopped; and a log entry the stop does not list means it stopped
 *  before that search was weighed.
 *
 *  The fourth is why this cannot filter the log by `plan_item_id` alone, which
 *  is what `questionStatus` does everywhere else. An external-site hand-off is
 *  closed by a LATER entry that carries no `plan_item_id` — the researcher's
 *  upload — so under a plain filter that upload would never undo the choice and
 *  the question would sit at the choice forever. It is matched by URL with the
 *  same `closesHandOff` rule `awaitingUserHandOffs` uses, from the one helper
 *  section I moved into `src/utils`.
 */
function researcherChoice(research: any, question: any, plans: any[], itemIds: Set<any>): boolean {
  const stop = question?.search_stop;
  if (stop?.stopped_because !== "resources_spent") return false;
  if (arr(research?.proof_summaries).some((s) => s?.question_id === question?.id)) return false;
  if (hasOpenWork(research, plans)) return false;
  // Every entry the question owns must be named by the stop.
  const listed = new Set(arr(stop?.log_entry_ids));
  return ownedLogEntries(research, itemIds).every((e) => listed.has(e?.id));
}

/** Whether the question's active plan still has work the agent can do: a
 *  `planned` or `in_progress` item, not counting one waiting only on an upload
 *  (section I), since the researcher is the blocker there. */
function hasOpenWork(research: any, plans: any[]): boolean {
  const waitingOnUpload = awaitingUploadItemIds(research?.log);
  return plans
    .filter((p) => p?.status === "active")
    .flatMap((p) => arr(p?.items))
    .some(
      (i) =>
        (i?.status === "planned" || i?.status === "in_progress") && !waitingOnUpload.has(i?.id),
    );
}

/** The log entries a question owns: its items' entries PLUS each later entry
 *  that closes one of their external-site hand-offs. The closing entry is the
 *  researcher's upload and carries no `plan_item_id`, so a plain filter would
 *  never see it; it is matched by URL with the same `closesHandOff` rule
 *  `awaitingUserHandOffs` uses. Section B's coverage set, and section E's. */
function ownedLogEntries(research: any, itemIds: Set<any>): any[] {
  const handOffUrls = arr(research?.log)
    .filter((e) => itemIds.has(e?.plan_item_id))
    .map((e) => externalSiteOf(e)?.url_generated)
    .filter((u): u is string => typeof u === "string");
  return arr(research?.log).filter(
    (e) => itemIds.has(e?.plan_item_id) || handOffUrls.some((url) => closesHandOff(e, url)),
  );
}

/** The log entries an unresolved `conflict` has weighed when it is analysed
 *  now: every entry owned by any question it blocks, a union when it blocks
 *  several. `research_append` stamps this as `weighed_log_entry_ids` on the
 *  analysis that finds nothing left to search, so the writer and
 *  `unsettledConflictWeighed` below read one coverage set. A conflict blocking
 *  no question weighs nothing. */
export function conflictCoverageLogIds(research: any, conflict: any): string[] {
  const ids = new Set<string>();
  for (const q of arr(research?.questions)) {
    const qid = q?.id;
    if (typeof qid !== "string") continue;
    const assertionIds = new Set<string>(
      arr(research?.assertions)
        .filter((a) => arr(a?.extracted_for_question_ids).includes(qid))
        .map((a) => a?.id),
    );
    if (!conflictBlocksQuestion(conflict, qid, assertionIds)) continue;
    for (const e of ownedLogEntries(research, questionItemIds(research, qid))) {
      if (typeof e?.id === "string") ids.add(e.id);
    }
  }
  return [...ids].sort();
}

/** Whether conflict-resolution has analysed this conflict.
 *
 *  One definition for both rungs. `Boolean(c.independence_analysis)` accepted
 *  `"   "`, which the unsettled rung rejected — so a whitespace analysis routed
 *  to a search from one rung and to conflict-resolution from its complement. */
export function isAnalysed(conflict: any): boolean {
  return typeof conflict?.independence_analysis === "string"
    && conflict.independence_analysis.trim() !== "";
}

/** Section E: every open conflict is analysed, and the question has open items
 *  that could settle it.
 *
 *  The open-items complement of `unsettledConflictWeighed`: that one fires when
 *  nothing is left to search, this one when something is. Without it the
 *  conflict rung below sends every pass back to conflict-resolution and the
 *  items the route PRs ask research-plan to write never run.
 *
 *  `independence_analysis` is the marker because conflict-resolution fills it on
 *  every analysis, resolved or not. A conflict not yet analysed still goes to
 *  conflict-resolution first, even beside an analysed one. */
function conflictEvidenceWanted(
  research: any,
  openConflictIds: string[],
  plans: any[],
): boolean {
  if (openConflictIds.length === 0) return false;
  if (!hasOpenWork(research, plans)) return false;
  const open = new Set(openConflictIds);
  return arr(research?.conflicts)
    .filter((c) => open.has(c?.id))
    .every((c) => isAnalysed(c));
}

/** Section E's ending on an unsettled conflict: every open conflict has been
 *  analysed (`independence_analysis`), conflict-resolution found nothing left
 *  to search over every log entry the question owns (`weighed_log_entry_ids`,
 *  present only on that finding), and no plan item is open. Re-running
 *  conflict-resolution there weighs the same evidence again, forever, so the
 *  question goes to proof-conclusion instead, which concludes at the tier the
 *  evidence reaches and leaves it open (decision 12). A log entry the weighed
 *  list does not cover -- a later upload, a steer's search -- is new evidence,
 *  and sends it back to conflict-resolution. */
function unsettledConflictWeighed(
  research: any,
  openConflictIds: string[],
  plans: any[],
  itemIds: Set<any>,
): boolean {
  if (openConflictIds.length === 0 || hasOpenWork(research, plans)) return false;
  const owned = ownedLogEntries(research, itemIds).map((e) => e?.id);
  const open = new Set(openConflictIds);
  return arr(research?.conflicts)
    .filter((c) => open.has(c?.id))
    .every((c) => {
      const analysed = isAnalysed(c);
      const weighed = new Set(arr(c?.weighed_log_entry_ids));
      return analysed && Array.isArray(c?.weighed_log_entry_ids) && owned.every((id) => weighed.has(id));
    });
}

/** Epoch ms of an `iso_datetime`, accepting the dash-separated time form the
 *  schema allows (`2026-05-01T10-15-00Z`); NaN when it does not parse. */
export function datetimeMs(value: string): number {
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2})[:-](\d{2})[:-](\d{2})(?:[.-](\d+))?(.*)$/.exec(value);
  if (!m) return Date.parse(value);
  return Date.parse(`${m[1]}:${m[2]}:${m[3]}${m[4] ? "." + m[4] : ""}${m[5]}`);
}

/** The plan-item ids of a question's plans. */
function questionItemIds(research: any, qid: unknown): Set<any> {
  return new Set(
    arr(research?.plans)
      .filter((p) => p?.question_id === qid)
      .flatMap((p) => arr(p?.items).map((i) => i?.id)),
  );
}

/** The log entries a question owns: its plan items' entries plus each upload
 *  that closes one of their hand-offs. */
export function questionOwnedLogEntries(research: any, qid: unknown): any[] {
  return ownedLogEntries(research, questionItemIds(research, qid));
}

/** Epoch ms of the latest entry a question owns (`ownedLogEntries`, so an
 *  upload counts), or -Infinity with none. A summary written before it
 *  predates evidence the question has since gathered. */
export function questionLastSearchedMs(research: any, qid: unknown): number {
  return Math.max(
    -Infinity,
    ...questionOwnedLogEntries(research, qid)
      .map((e) => (typeof e?.performed === "string" ? datetimeMs(e.performed) : NaN))
      .filter((t) => !Number.isNaN(t)),
  );
}

/** Section E's ending, read as the ladder reads it: every conflict blocking an
 *  open question was found searched out over every log entry the question
 *  owns, and no plan item is open. The resolve and tier refusals pass the
 *  pre-call snapshot, where a question being resolved in the same call is still
 *  open; the stale-summary checks pass the live research. */
export function unsettledConflictEnding(research: any, question: any): boolean {
  if (question?.status === "resolved" || Boolean(question?.resolved)) return false;
  const qid = question?.id;
  const plans = arr(research?.plans).filter((p) => p?.question_id === qid);
  const assertionIds = new Set(
    arr(research?.assertions)
      .filter((a) => arr(a?.extracted_for_question_ids).includes(qid))
      .map((a) => a?.id),
  );
  const openConflictIds = arr(research?.conflicts)
    .filter((c) => conflictBlocksQuestion(c, qid, assertionIds))
    .map((c) => c?.id)
    .filter((id): id is string => typeof id === "string");
  return unsettledConflictWeighed(research, openConflictIds, plans, questionItemIds(research, qid));
}

/** Whether a summary is the ending's terminal marker: `shortfall: "conflict"`
 *  at whatever tier the evidence reached, written no earlier than the
 *  question's latest search. A summary with no parseable `updated` predates
 *  the stamp and counts. */
export function endsOnConflict(summary: any, lastSearched: number): boolean {
  if (summary?.shortfall !== "conflict") return false;
  const written = typeof summary?.updated === "string" ? datetimeMs(summary.updated) : NaN;
  return Number.isNaN(written) || written >= lastSearched;
}

/** One tree person's two FamilySearch-attached births that cannot both be
 *  theirs and that no analysed conflict has weighed yet (#4444). Computed by
 *  research_append's pair test (a tool, with place lookups) and passed in. */
export interface AttachedBirthPair {
  personId: string;
  a: any;
  b: any;
}

/** The conflicts that name a pair the way one answers it: an identity conflict
 *  naming either record, through any assertion of the same record party (as a
 *  rejection rules one out), or a fact conflict naming both births. Analysed or
 *  not: the pair is answered once one of these is analysed, and while none is,
 *  the one registered is what conflict-resolution has to weigh. */
export function registeredPairConflictIds(research: any, pair: AttachedBirthPair): string[] {
  const ids = [pair.a?.id, pair.b?.id];
  const assertions = arr(research?.assertions);
  const byId = new Map<string, any>(assertions.map((a: any) => [a?.id, a]));
  const partyOf = recordPartyKeys(assertions);
  const pairParties = new Set([pair.a, pair.b].map(partyOf).filter((k): k is string => k != null));
  return arr(research?.conflicts)
    .filter((c: any) => {
      if (!Array.isArray(c?.competing_assertion_ids) || typeof c?.id !== "string") return false;
      const named = ids.filter((id) => c.competing_assertion_ids.includes(id)).length;
      if (c.conflict_type === "identity") {
        return named > 0 || c.competing_assertion_ids.some((id: unknown) => {
          const key = partyOf(byId.get(id as string));
          return key != null && pairParties.has(key);
        });
      }
      return c.conflict_type === "fact" && named === 2;
    })
    .map((c: any) => c.id as string);
}

/** What conflict-resolution does for the pairs: weigh the conflict already
 *  registered for a pair, or open one where none is. Naming the registered one
 *  matters: told to open a conflict, an orchestrator asked for John's pair to be
 *  registered again while c_002 sat unweighed (thomas-hanrahan-marriage,
 *  2026-11-18 14:12). */
export function attachedBirthPairsAction(pairs: readonly AttachedBirthPair[], research: any): string {
  const registered = new Set<string>();
  const unregistered: string[] = [];
  for (const pair of pairs) {
    const ids = registeredPairConflictIds(research, pair);
    if (ids.length > 0) ids.forEach((id) => registered.add(id));
    else if (!unregistered.includes(pair.personId)) unregistered.push(pair.personId);
  }
  const parts: string[] = [];
  if (registered.size > 0) {
    parts.push(`weigh ${[...registered].sort().join(", ")} (registered, not yet analysed)`);
  }
  if (unregistered.length > 0) {
    parts.push(`open a conflict_type 'identity' conflict naming the two records for ${unregistered.join(", ")}`);
  }
  return parts.join("; ");
}

/** The pairs as one clause: the identity rung's text and the proof gate's. */
export function describeAttachedBirthPairs(pairs: readonly AttachedBirthPair[]): string {
  return pairs
    .map(({ personId, a, b }) => `${personId}'s attached births ${a?.id} ('${a?.place}') and ${b?.id} ('${b?.place}')`)
    .join("; ");
}

/** This question's owed items of one kind: `encode` items on its summaries, or
 *  `hypothesis` items on hypotheses that relate to it. */
function owedFor(all: readonly OwedFinding[], research: any, qid: unknown, summaries: any[], kind: "encode" | "hypothesis"): OwedFinding[] {
  const owed = all.filter((f) => f.kind === kind);
  if (kind === "encode") {
    const ids = new Set(summaries.map((s) => `${s?.id}/`));
    return owed.filter((f) => [...ids].some((prefix) => f.ref.startsWith(prefix)));
  }
  const related = new Set(
    arr(research?.hypotheses)
      .filter((h) => arr(h?.related_question_ids).includes(qid))
      .map((h) => h?.id),
  );
  return owed.filter((f) => related.has(f.ref));
}

/**
 * The state of one question plus the step it is waiting on.
 *
 * The state ladder is monotonic on what was PRODUCED, not on tidiness: a
 * question with a proof summary is `concluded` even if its plan is thin,
 * because the artifact is what any downstream check joins on.
 */
export function questionStatus(
  research: any,
  question: any,
  tree: any = null,
  attachedBirthPairs: readonly AttachedBirthPair[] = [],
  owed?: readonly OwedFinding[],
): QuestionStatus {
  const qid = question?.id;
  // Computed only when an owed-finding arm is reached; questionStates passes it.
  let owedList = owed;
  const getOwed = (): readonly OwedFinding[] => (owedList ??= owedFindings(research, tree));

  const plans = arr(research?.plans).filter((p) => p?.question_id === qid);
  const itemIds = new Set(plans.flatMap((p) => arr(p?.items).map((i) => i?.id)));
  const logs = arr(research?.log).filter((e) => itemIds.has(e?.plan_item_id));
  const assertions = questionAssertions(research, qid);
  const assertionIds = new Set(assertions.map((a) => a?.id));
  const summaries = arr(research?.proof_summaries).filter((s) => s?.question_id === qid);

  // A superseded verdict does not count — a replacement is itself present and
  // satisfies the join; if nothing replaced it, the critique no longer stands.
  const critiqued = new Set(
    arr(research?.evaluations)
      .filter((e) => e?.focus === "proof-critique" && !e?.superseded_by)
      .map((e) => e?.target_id),
  );

  const openConflictIds = arr(research?.conflicts)
    .filter((c) => conflictBlocksQuestion(c, qid, assertionIds))
    .map((c) => c?.id)
    .filter((id): id is string => typeof id === "string");

  // Zero links, not some: a household record routinely leaves its children and
  // wife unlinked once the subject is linked (53 of 230 concluded e2e questions),
  // and that is not a skipped identity step. No link at all is.
  // An unchecked FamilySearch attachment link does not count as linked here:
  // the question still routes to person-evidence. A speculative link the
  // researcher confirmed does count (`countsForLinkedRung`).
  const linkedAssertionIds = new Set(
    arr(research?.person_evidence)
      .filter(countsForLinkedRung)
      .map((pe) => pe?.assertion_id),
  );
  const noneLinked = assertions.length > 0 && !assertions.some((a) => linkedAssertionIds.has(a?.id));

  const disagreements = unregisteredDisagreements(research, assertionIds);
  const parentSets = competingParentSets(research, tree, qid, assertionIds);

  const uncritiqued = summaries.filter((s) => !critiqued.has(s?.id));

  let state: QuestionState;
  if (summaries.length > 0 && uncritiqued.length === 0) state = "critiqued";
  else if (summaries.length > 0) state = "concluded";
  else if (assertions.length > 0) state = "evidence-gathered";
  else if (logs.length > 0) state = "searching";
  else if (plans.length > 0) state = "planned";
  else state = "framed";

  // Ordered by what blocks what: a conflict has to settle before a conclusion
  // means anything. A critique is not a step — gps-mentor runs only when the
  // user asks for one — so `critiqued` never gates what comes next.
  let nextStep: string | null = null;
  const resolved = question?.status === "resolved" || Boolean(question?.resolved);
  const kin = resolved ? [] : unlinkedKin(research, tree, qid, assertionIds);
  const unreached = resolved || summaries.length > 0 || noneLinked
    ? null
    : subjectUnreached(research, tree, assertions, linkedAssertionIds);
  if (attachedBirthPairs.length > 0) {
    // #4444. First, because research_append refuses every proof summary of this
    // question (any tier but disproved, resolved or not) until a conflict has
    // weighed each pair: a rung below one that names proof-conclusion would loop.
    nextStep =
      `conflict-resolution — identity: ${describeAttachedBirthPairs(attachedBirthPairs)} cannot both ` +
      `be theirs; ${attachedBirthPairsAction(attachedBirthPairs, research)}, blocking ${qid}`;
  } else if (!resolved && unsettledConflictWeighed(research, openConflictIds, plans, itemIds)) {
    // Section E. The summary is the terminal marker: once proof-conclusion has
    // written one with `shortfall: "conflict"`, at the tier the evidence reaches,
    // the research has ended on the conflict and nothing further is due. A
    // summary written before the question's latest search predates the evidence
    // just weighed, so it does not end the research; proof-conclusion refreshes it.
    const lastSearched = questionLastSearchedMs(research, qid);
    const ended = summaries.some((s) => endsOnConflict(s, lastSearched));
    nextStep = ended
      ? null
      : `proof-conclusion — unsettled conflict ${openConflictIds.join(", ")} has weighed every ` +
        "log entry and nothing is left to search: conclude at the tier the evidence reaches " +
        "and leave the question open";
  } else if (conflictEvidenceWanted(research, openConflictIds, plans)) {
    // Section E: a conflict that needs new evidence becomes plan items on this
    // question rather than a helper question. Routing to conflict-resolution
    // again would hand it the evidence it has already weighed.
    // Extraction first, but only for entries on items still open: search-records
    // leaves its item `in_progress` until the record is extracted, and
    // re-running that search would find the record again. An entry on a closed
    // item is not waiting on extraction: `extraction_append` cites the read, not
    // the search that found it, and inconclusive `partial`s and link lists stay
    // uncited for good, so counting them would hold the question here forever.
    const openIds = new Set(openItems(plans).map((i) => i?.id));
    const awaitingExtraction = logs.filter((e) => openIds.has(e?.plan_item_id));
    const item = nextUnexecutedItem(research, plans);
    nextStep = pendingExtraction(research, awaitingExtraction).length > 0
      ? "extraction (extraction_append for FamilySearch records, record-structurer for any other source)"
      : item
        ? searchStepFor(item)
        // Every open item is waiting on an upload or was searched with nothing
        // found: the conflict's evidence search is over (lead, 2026-11-26).
        : searchSpentStep(research, plans);
  } else if (openConflictIds.length > 0) {
    nextStep = `conflict-resolution — unresolved ${openConflictIds.join(", ")}`;
  } else if (noneLinked && summaries.length === 0) {
    // Ahead of the disagreement rung because that rung reads links: with none,
    // it is blind, so routing past here would also hide an unregistered conflict.
    nextStep =
      `person-evidence — none of this question's ${assertions.length} assertions ` +
      "is linked to a person";
  } else if (disagreements.length > 0) {
    // Registering a conflict is conflict-resolution's output, so an empty
    // `conflicts[]` cannot be what routes there — the evidence has to.
    nextStep =
      "conflict-resolution — unregistered disagreement: " +
      disagreements.map((d) => `${d.personId} ${d.fact} (${d.assertionIds.join(", ")})`).join("; ");
  } else if (parentSets.length > 0) {
    nextStep =
      "hypothesis-tracking — competing parent sets: " +
      parentSets.map((p) => `${p.personId} (${p.parentIds.join(", ")})`).join("; ");
  } else if (kin.length > 0) {
    nextStep = `hypothesis-tracking — unlinked kin: ${kin.join(", ")}`;
  } else if (unreached) {
    // Below the kin rung, so it changes no step that rung sets. Some links but
    // none reaching the subject: the record was linked around them, not to them.
    nextStep =
      `person-evidence — ${unreached.unlinked} of this question's ${assertions.length} assertions ` +
      `are unlinked and none of its links reaches the project subject (${unreached.subjects.join(", ")})`;
  } else if (researcherChoice(research, question, plans, itemIds)) {
    // Section B: the "not exhaustive" choice. The search stopped on resources
    // rather than on a finding, so neither searching more nor concluding is
    // wrong — and only the researcher can say which. Above the concluded arm
    // because it fires only when there is no summary, so the two never contend.
    nextStep = `researcher's choice: research-plan or proof-conclusion (default ${
      lowOverturnRisk(question) ? "proof-conclusion" : "research-plan"
    })`;
  } else if (tree && owedFor(getOwed(), research, qid, summaries, "encode").length > 0) {
    // A claim affirmed at probable or better that no tree object carries
    // (Decision 33's `encode`): proof-conclusion encodes it. Above the concluded
    // and blocked arms, so a resolved question still reports it. Skipped with no
    // tree, as competingParentSets is: a tree-less reader cannot tell.
    nextStep = owedFor(getOwed(), research, qid, summaries, "encode")[0].nextStep;
  } else if (summaries.length > 0 && !resolved) {
    // A summary on a question still open was written while the preconditions
    // gate blocked the conclusion: proof-conclusion resolves the question it
    // concludes (its step 7) and leaves it open only when blocked. The conflict
    // arms above found nothing open, so the blocker has settled and the next
    // step is to conclude again. Reporting null here would tell the router
    // nothing is left to do.
    nextStep = "proof-conclusion — concluded while blocked: re-conclude this question's proof summary";
  } else if (resolved && summaries.length === 0) {
    // Only reachable in a document seeded this way — the resolve gate refuses
    // the transition now. The completion gate still lets it pass.
    nextStep = "proof-conclusion — resolved with no proof summary";
  } else if (state === "framed") {
    // A project with no localities entry at all has surveyed no place, so the plan
    // step opens with locality-guide (issue #4791, stop 3). Whether an entry covers
    // this question's own place is research-plan's to judge, and it hands back.
    const surveyed = Array.isArray(research?.localities) && research.localities.length > 0;
    nextStep = surveyed ? "research-plan" : "locality-guide, then research-plan";
  } else if (state === "evidence-gathered") {
    // Not preempted by an uncited positive/partial entry: agents log
    // inconclusive searches as `partial` and link lists as `positive`, and those
    // stay uncited for good, so the check would hold the question on extraction.
    // Planned items are searched or disposed of before the gate (lead, #3546);
    // the search is offered first so a still-needed item is not skipped by default.
    // `in_progress` items are not disposable here (#3516 owns their closure), and
    // an item waiting only on the researcher's upload is left alone.
    const waitingOnUpload = awaitingUploadItemIds(research?.log);
    const planned = openItems(plans)
      .filter((i) => i?.status === "planned" && !waitingOnUpload.has(i?.id))
      .sort((x, y) => (Number(x?.sequence) || 0) - (Number(y?.sequence) || 0));
    // A supported hypothesis on this question, with nothing left to search and no
    // summary yet: concluding it is the next step (Decision 33's `hypothesis`).
    // Below extraction, framing and every planned search, which come first.
    const supported = planned.length === 0 && summaries.length === 0
      ? owedFor(getOwed(), research, qid, summaries, "hypothesis")
      : [];
    if (supported.length > 0) {
      nextStep = supported[0].nextStep;
    } else if (planned.length === 0) {
      nextStep = "research-exhaustiveness, then proof-conclusion";
    } else {
      const lane = searchStepFor(planned[0]);
      const search = lane === "search-records" ? `${lane} — next item ${planned[0].id}` : lane;
      nextStep =
        `${search}, or research-plan — dispose of ${planned.map((i) => i.id).join(", ")} ` +
        "if the evidence already answers the question";
    }
  } else if (state === "concluded" || state === "critiqued") {
    // Resolved with a proof summary: nothing outstanding.
  } else if (pendingExtraction(research, logs).length > 0) {
    nextStep = "extraction (extraction_append for FamilySearch records, record-structurer for any other source)";
  } else {
    // planned or searching, nothing to extract: the next unexecuted item decides
    // between the routing table's two search destinations, by its repository.
    const item = nextUnexecutedItem(research, plans);
    nextStep = item ? searchStepFor(item) : searchSpentStep(research, plans);
  }

  // Copied verbatim, never re-mapped or re-validated: this tool skips malformed
  // entries defensively rather than reporting them (spec §2, "Not a validator").
  const rawStatus = question?.status;
  const storedStatus = typeof rawStatus === "string" ? rawStatus : null;

  return {
    id: qid,
    state,
    nextStep,
    openConflictIds,
    storedStatus,
    unregisteredDisagreements: disagreements,
    competingParentSets: parentSets,
  };
}

/** Every question's state, in document order. `tree` is optional: without it
 *  `competingParentSets` is always empty. `attachedBirthPairs` (by question id)
 *  is optional: without it the identity rung never fires. */
export function questionStates(
  research: any,
  tree: any = null,
  attachedBirthPairs?: ReadonlyMap<string, readonly AttachedBirthPair[]>,
): QuestionStatus[] {
  // The owed list is project-wide: compute it once, not once per question.
  const owed = owedFindings(research, tree);
  return arr(research?.questions)
    .filter((q) => typeof q?.id === "string")
    .map((q) => questionStatus(research, q, tree, attachedBirthPairs?.get(q.id) ?? [], owed));
}

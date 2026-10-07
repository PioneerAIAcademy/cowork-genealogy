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

/** Fact types that name one event per person, so two values are a disagreement
 *  rather than two events. `birthplace` is folded into `birth`'s place, since
 *  extractions record a birth's place under either. */
const VITAL_EVENT: Readonly<Record<string, "birth" | "death">> = {
  birth: "birth",
  birthplace: "birth",
  death: "death",
  deathplace: "death",
};

/** Years further apart than this disagree. Census ages drift a year or two
 *  between enumerations; that is ordinary, not a conflict. */
const YEAR_TOLERANCE = 2;

/** Both spellings of an assertion's place, each split into components. The raw
 *  and standardized forms are compared separately because standardization
 *  renames ("Forfarshire" → "Angus") and adds a country the raw form omits. */
const placeForms = (a: any): string[][] =>
  [a?.place, a?.standard_place]
    .filter((p): p is string => typeof p === "string" && p.trim() !== "")
    .map((p) => p.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));

const partsMatch = (p: string, q: string): boolean => p.startsWith(q) || q.startsWith(p);

/** Places agree when every component of the less specific one matches one in
 *  the other — "England" agrees with "Rochdale, Lancashire, England", and
 *  "Russia" with "Russian Empire". Any pair of spellings agreeing is enough. */
const placesAgree = (xs: string[][], ys: string[][]): boolean =>
  xs.some((x) =>
    ys.some((y) => {
      const [short, long] = x.length <= y.length ? [x, y] : [y, x];
      return short.every((p) => long.some((q) => partsMatch(p, q)));
    }),
  );

const yearOf = (a: any): number | null => {
  for (const raw of [a?.standard_date, a?.date]) {
    const m = typeof raw === "string" ? raw.match(/\b(\d{4})\b/) : null;
    if (m) return Number(m[1]);
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
    if (typeof a?.id === "string" && VITAL_EVENT[a?.fact_type]) byId.set(a.id, a);
  }
  const groups = new Map<string, any[]>();
  for (const pe of arr(research?.person_evidence)) {
    const a = byId.get(pe?.assertion_id);
    if (!a || typeof pe?.person_id !== "string") continue;
    const key = `${pe.person_id}\u0000${VITAL_EVENT[a.fact_type]}`;
    const g = groups.get(key) ?? [];
    if (!g.includes(a)) g.push(a);
    groups.set(key, g);
  }
  const covered = (x: string, y: string): boolean =>
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
        const ya = yearOf(a), yb = yearOf(b);
        return ya !== null && yb !== null && Math.abs(ya - yb) > YEAR_TOLERANCE;
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
 *  its assertions are linked to — whose tree carries more than two parents,
 *  while fewer than two hypotheses relate to the question. Two candidate parent
 *  couples with no hypothesis per candidate is identity uncertainty nobody has
 *  set up to test. */
export function competingParentSets(
  research: any,
  tree: any,
  questionId: string,
  questionAssertionIds: ReadonlySet<string>,
): CompetingParentSet[] {
  const related = arr(research?.hypotheses).filter((h) =>
    arr(h?.related_question_ids).includes(questionId),
  );
  if (related.length >= 2) return [];
  const inScope = new Set<string>(
    arr(research?.project?.subject_person_ids).filter((id): id is string => typeof id === "string"),
  );
  for (const pe of arr(research?.person_evidence)) {
    if (questionAssertionIds.has(pe?.assertion_id) && typeof pe?.person_id === "string") {
      inScope.add(pe.person_id);
    }
  }
  const parents = new Map<string, Set<string>>();
  for (const r of arr(tree?.relationships)) {
    if (r?.type !== "ParentChild" || typeof r?.child !== "string" || typeof r?.parent !== "string") continue;
    if (!inScope.has(r.child)) continue;
    const s = parents.get(r.child) ?? new Set<string>();
    s.add(r.parent);
    parents.set(r.child, s);
  }
  return [...parents]
    .filter(([, s]) => s.size > 2)
    .map(([personId, s]) => ({ personId, parentIds: [...s].sort() }));
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
      .filter((a) => arr(a?.extracted_for_question_ids).length > 0)
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

/**
 * The state of one question plus the step it is waiting on.
 *
 * The state ladder is monotonic on what was PRODUCED, not on tidiness: a
 * question with a proof summary is `concluded` even if its plan is thin,
 * because the artifact is what any downstream check joins on.
 */
export function questionStatus(research: any, question: any, tree: any = null): QuestionStatus {
  const qid = question?.id;

  const plans = arr(research?.plans).filter((p) => p?.question_id === qid);
  const itemIds = new Set(plans.flatMap((p) => arr(p?.items).map((i) => i?.id)));
  const logs = arr(research?.log).filter((e) => itemIds.has(e?.plan_item_id));
  const assertions = arr(research?.assertions).filter((a) =>
    arr(a?.extracted_for_question_ids).includes(qid),
  );
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
  // means anything, and a conclusion has to exist before it can be critiqued.
  let nextStep: string | null = null;
  const resolved = question?.status === "resolved" || Boolean(question?.resolved);
  if (openConflictIds.length > 0) {
    nextStep = `conflict-resolution — unresolved ${openConflictIds.join(", ")}`;
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
  } else if (uncritiqued.length > 0) {
    nextStep = `gps-mentor (proof-critique) — ${uncritiqued.map((s) => s?.id).join(", ")}`;
  } else if (state === "critiqued" && !resolved) {
    // The last rung of the ladder is not the end of the work: the `resolved`
    // write is still outstanding, and it is the transition no skill body claims.
    // Reporting null here would tell the router nothing is left to do on the one
    // step this design most needs routed.
    nextStep = "question-selection — concluded and critiqued; mark the question resolved";
  } else if (resolved && summaries.length === 0) {
    // Only reachable in a document seeded this way — the resolve gate refuses
    // the transition now. The completion gate still lets it pass.
    nextStep = "proof-conclusion — resolved with no proof summary";
  } else if (state === "framed") {
    nextStep = "research-plan";
  } else if (state === "planned") {
    nextStep = "search-records";
  } else if (state === "searching") {
    nextStep = "record-extraction";
  } else if (state === "evidence-gathered") {
    nextStep = "research-exhaustiveness, then proof-conclusion";
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
 *  `competingParentSets` is always empty. */
export function questionStates(research: any, tree: any = null): QuestionStatus[] {
  return arr(research?.questions)
    .filter((q) => typeof q?.id === "string")
    .map((q) => questionStatus(research, q, tree));
}

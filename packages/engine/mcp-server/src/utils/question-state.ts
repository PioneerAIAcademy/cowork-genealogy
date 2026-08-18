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
 * **This is advisory. Nothing gates on it.** The gates in `research_append`
 * compute their own preconditions independently. This function exists to tell
 * the router what is outstanding — a routing signal, not a refusal — because a
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
}

const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);

/**
 * The state of one question plus the step it is waiting on.
 *
 * The state ladder is monotonic on what was PRODUCED, not on tidiness: a
 * question with a proof summary is `concluded` even if its plan is thin,
 * because the artifact is what any downstream check joins on.
 */
export function questionStatus(research: any, question: any): QuestionStatus {
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
    .filter(
      (c) =>
        c?.status === "unresolved" &&
        (arr(c?.blocks_question_ids).includes(qid) ||
          arr(c?.competing_assertion_ids).some((id: string) => assertionIds.has(id))),
    )
    .map((c) => c?.id)
    .filter((id): id is string => typeof id === "string");

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
  } else if (uncritiqued.length > 0) {
    nextStep = `gps-mentor (proof-critique) — ${uncritiqued.map((s) => s?.id).join(", ")}`;
  } else if (state === "critiqued" && !resolved) {
    // The last rung of the ladder is not the end of the work: the `resolved`
    // write is still outstanding. proof-conclusion owns this transition
    // (issue #1399) — question-selection no longer claims it
    // (question-selection/SKILL.md). Routing here is only correct when
    // proof-conclusion concluded the question THIS invocation, not on a
    // stale ps_ from an earlier one (proof-conclusion/SKILL.md §7).
    nextStep = "proof-conclusion — concluded and critiqued; mark the question resolved";
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

  return { id: qid, state, nextStep, openConflictIds };
}

/** Every question's state, in document order. */
export function questionStates(research: any): QuestionStatus[] {
  return arr(research?.questions)
    .filter((q) => typeof q?.id === "string")
    .map((q) => questionStatus(research, q));
}

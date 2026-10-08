/**
 * Which agent returns the judge graded, and which it did not.
 *
 * On a direct-agent test the judge scores the agent's OWN return rather than
 * `output.text_response`, which is the main thread relaying it — and the relay
 * paraphrases. An annotator shown only the relay confirms a score against text
 * the grader never saw: in `v1_2026-09-28_17-09-14` the relay for
 * `ut_search_wikipedia_009` restates the whole Kirchenbuch article while the
 * graded text is a single line. That holds for every suite with direct tests.
 *
 * The rule below is the judge's own — `orchestrator.py` via
 * `skill_runner.agent_return_text`: a DIRECT test only, and only returns from
 * the agent under test.
 *
 * **Both conditions are load-bearing.** A routed run can spawn agents too
 * (`ut_timeline_008` spawns `record-extractor`) and the judge still grades
 * `text_response` there, so gating on "the run has agent returns" would label a
 * routed run's spawn as graded when it was not. And a direct test can spawn
 * some *other* agent, whose return is likewise not what was graded.
 *
 * Extracted from the results page so the gating is testable: the failure this
 * guards against is silent — a wrong label reads as a normal panel.
 */

export interface AgentReturn {
  subagent_type: string;
  text: string;
}

/** `output.agent_returns`, keeping only well-formed entries. */
export function parseAgentReturns(raw: unknown): AgentReturn[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (r): r is AgentReturn =>
      !!r &&
      typeof (r as Record<string, unknown>).text === 'string' &&
      typeof (r as Record<string, unknown>).subagent_type === 'string',
  );
}

export function splitAgentReturns(
  agentReturns: AgentReturn[],
  isDirect: boolean,
  skill: string,
): { graded: AgentReturn[]; other: AgentReturn[] } {
  const graded = isDirect
    ? agentReturns.filter((r) => r.subagent_type === skill && r.text)
    : [];
  const other = agentReturns.filter((r) => !graded.includes(r));
  return { graded, other };
}

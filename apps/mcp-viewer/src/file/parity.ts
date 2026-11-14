/** Where each of the old viewer's sections lives in the new case file. */
export const SECTION_HOMES: Record<string, string> = {
  project_overview: 'The case: the objective and subjects at its top, then So far or the conclusion',
  questions: 'The case: the question switch, each question with its rationale and stop criteria',
  plans: 'The case: What was searched, each item with its rationale and what it found',
  localities: 'Sources, Background',
  external_collections: 'Sources, Background',
  log: 'Log, each search opening its results in the pane',
  sources: 'Sources, Direct mentions; the record pane',
  assertions: 'the record pane, What it says',
  person_evidence: 'the source chips and the person pane, with link strength',
  rejected_links: 'the person page, Ruled out',
  namesakes: 'the person page, Not the same person as',
  conflicts: 'The case: conflicts and competing identities',
  hypotheses: 'The case: conflicts and competing identities',
  timelines: 'the person page, its gaps and notes from the timeline',
  proof_summaries: 'The case: the conclusion, its claims and The whole argument',
  evaluations: 'The case: the reviewer, verdict and notes'
}

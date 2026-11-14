/** Where each of the old viewer's sections lives in the new case file. A pending row is
 *  content the card's case file cannot reach until that PR lands. */
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
  rejected_links: 'pending (M3-3): People, a person page',
  namesakes: 'pending (M3-3): People, a person page',
  conflicts: 'The case: conflicts and competing identities',
  hypotheses: 'The case: conflicts and competing identities',
  timelines: 'pending (M3-3): People, a person page in time order',
  proof_summaries: 'The case: the conclusion, its claims and The whole argument',
  evaluations: 'The case: the reviewer, verdict and notes'
}

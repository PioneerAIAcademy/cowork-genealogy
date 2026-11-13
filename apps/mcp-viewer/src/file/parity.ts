/** Where each of today's viewer sections lives in the new case file. M3-4 retires
 *  `ViewerBody` only when no row is pending. */
export const SECTION_HOMES: Record<string, string> = {
  project_overview: 'pending (M3-2): The case, its question switch and So far',
  questions: 'pending (M3-2): The case, the question switch',
  plans: 'pending (M3-2): The case, What was searched',
  localities: 'Sources, Background',
  external_collections: 'Sources, Background',
  log: 'Log, each search opening its results in the pane',
  sources: 'Sources, Direct mentions; the record pane',
  assertions: 'the record pane, What it says',
  person_evidence: 'the source chips and the person pane, with link strength',
  rejected_links: 'pending (M3-3): People, a person page',
  namesakes: 'pending (M3-3): People, a person page',
  conflicts: 'pending (M3-2): The case, conflicts and competing identities',
  hypotheses: 'pending (M3-2): The case, conflicts and competing identities',
  timelines: 'pending (M3-3): People, a person page in time order',
  proof_summaries: 'pending (M3-2): The case, the conclusion',
  evaluations: 'pending (M3-2): The case, the reviewer'
}

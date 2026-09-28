import type { ResearchData, GedcomxData, GedcomxSource } from './schema'

/**
 * Tree sources not already covered by a research source.
 * A tree source is "covered" when any research source's
 * `gedcomx_source_description_id` matches its `id`.
 */
export function treeOnlySources(
  research: ResearchData | null | undefined,
  gedcomx: GedcomxData | null | undefined
): GedcomxSource[] {
  const covered = new Set(
    (research?.sources ?? []).map((s) => s.gedcomx_source_description_id)
  )
  return (gedcomx?.sources ?? []).filter((gs) => !covered.has(gs.id))
}

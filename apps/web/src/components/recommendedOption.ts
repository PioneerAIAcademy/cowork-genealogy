// R9: *not sure* continues on the option the agent RECOMMENDED, never "the weaker
// choice". Two reasons, the second stronger: "weaker" was undecidable as written
// (weaker-scored candidate, or weaker-commitment option?), and *not sure* means the
// researcher is deferring to the agent's judgement -- the agent has already weighed
// the evidence, and continuing on anything else discards the reasoning the card
// exists to show.
//
// The ruling was unimplementable as written: `AskUserQuestion` carries no
// recommendation field, and across the committed unit corpus all 15 unprompted calls
// mark nothing. The convention it DOES have is in the tool's own contract -- "make
// that the first option in the list and add '(Recommended)' at the end of the label"
// -- so the reader takes the marker when present and the FIRST option when it is
// not. Both point at the same place by construction, so a model that follows the
// convention and one that only orders its options agree.

export interface AskOption {
  label: string
  description?: string
}

// Anchored at the END of the label: a description mentioning "recommended by the
// county archive" is prose, not a marker.
const MARKER = /\s*\(\s*recommended\s*\)\s*$/i

/** The option the agent recommended, or null when there are none to choose from. */
export function recommendedOption<T extends AskOption>(options: T[]): T | null {
  if (options.length === 0) return null
  return options.find((o) => MARKER.test(o.label ?? '')) ?? options[0]
}

/** The label without its marker — the card shows the recommendation as a badge, and
 *  leaving the suffix in renders "Search Indiana (Recommended) — Recommended". */
export function stripRecommendedMarker(label: string): string {
  return (label ?? '').replace(MARKER, '')
}

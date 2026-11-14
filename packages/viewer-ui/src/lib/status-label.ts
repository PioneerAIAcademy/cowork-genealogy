// The stored-value-to-words map, apart from the badge component, so a page can read
// it (`@genealogy/viewer-ui/status-label`) without pulling in any component or stylesheet.

// What the researcher reads, keyed on the stored VALUE like the color map. A value
// with no entry renders with underscores as spaces. Display vocabulary:
// docs/specs/research-schema-spec.md §5.11.
export const statusLabelMap: Record<string, string> = {
  exhaustive_declared: 'all reachable searched',
  original: 'Record image',
  derivative: 'Index or transcript',
  authored: 'Compiled work',
  ceiling: 'limit of online records',
  gap: 'evidence missing',
  conflict: 'conflicting evidence',
  // Proof tier; `probable` is also a person-evidence confidence, "likely" in both.
  proved: 'well established',
  probable: 'likely',
  possible: 'tentative',
  not_proved: 'not established',
  disproved: 'ruled out',
  // Skip category (#1830). The stored values are written for the gate; these
  // are what a researcher reads.
  answered: 'already answered',
  inaccessible: 'could not be reached',
  no_coverage: 'not covered by the repository',
  fallback_not_triggered: 'fallback not needed',
  out_of_scope: 'belongs to another question',
  premise_invalidated: 'the plan assumption was wrong',
  user_declined: 'declined by the researcher'
}

/** A stored status value as the researcher reads it. */
export function statusLabel(value: string): string {
  return statusLabelMap[value] ?? value.replace(/_/g, ' ')
}

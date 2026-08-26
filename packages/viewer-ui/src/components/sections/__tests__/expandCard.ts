import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/**
 * Card bodies are collapsed until their header is clicked (`shared/Card.tsx`
 * starts `expanded` false and renders `children` only when true), so any test
 * asserting on a card's body must expand it first.
 *
 * Consolidated from five call sites in two mechanisms: four named local helpers
 * (chevron-based in EvaluationsSection, SourcesSection and TimelinesSection;
 * title-based in AssertionsSection) plus an inline title-based click in
 * ConflictsSection. They all click the same element, and the shared chevron
 * helper keeps the length guard EvaluationsSection's copy lacked.
 * CLAUDE.md: two near-duplicates is the signal to consolidate.
 */
export async function expandFirstCard(): Promise<void> {
  const chevrons = screen.getAllByText(/^[▾▸]$/)
  if (chevrons.length === 0) throw new Error('No card chevrons found')
  const header = chevrons[0].closest('div')?.parentElement
  if (!header) throw new Error('No card header found')
  await userEvent.click(header)
}

/** Expand the card whose title matches, for tests that must pick a specific one. */
export async function expandCardByTitle(title: string): Promise<void> {
  const titleEl = screen.getAllByText(title)[0]
  const header = titleEl?.parentElement
  if (!header) throw new Error(`No card header found for title "${title}"`)
  await userEvent.click(header)
}

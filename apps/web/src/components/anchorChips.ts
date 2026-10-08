// Phase 2 item 3: chips and text render in the order they happened.
//
// The bug, stated by the parent plan: "the chat folds a turn into one bubble with
// every tool chip above every paragraph ... each new chip lands above text the reader
// has passed." ChatPane renders the whole `tools` array, then the whole `text`. On the
// captured session's worst stretch that is 36 chips stacked above the prose they
// belong to (docs/captures/2026-09-29-mcandrew-children/).
//
// A DIRECTION HEURISTIC WAS TRIED AND REJECTED ON THE DATA. The first version asked
// whether a paragraph reports the chips before it or announces the chips after it,
// and keyed that on the opening words. Narration genuinely does both, in almost equal
// measure -- 158 paragraph->chip and 158 chip->paragraph transitions on the main
// thread. But the openers do not separate the two: "the log", "the census" and "all
// four" each appear on BOTH sides in the corpus ("all four" announces twice and
// reports once). The ground-truth burst then settled it -- the paragraph that
// announces those 36 chips begins "Running both checks for all 18 persons at once",
// and no opener list built from the visible cases contained it.
//
// So the order is chronological and nothing is inferred. That is what the plan asked
// for, it cannot be wrong about a direction it never guesses, and it puts every chip
// adjacent to the prose it arrived with.

export interface FeedItem {
  kind: 'text' | 'chip'
  text?: string
  tool?: string
}

/** One rendered block: a paragraph, the chips that arrived with it, or both. */
export interface AnchoredGroup {
  text?: string
  chips: FeedItem[]
}

/**
 * Split a feed into blocks that preserve arrival order.
 *
 * Every chip lands in exactly one group and none is dropped: a burst that silently
 * lost steps would be worse than the wall of chips this replaces.
 */
export function anchorChips(items: FeedItem[]): AnchoredGroup[] {
  const groups: AnchoredGroup[] = []
  let chips: FeedItem[] = []

  for (const item of items) {
    if (item.kind === 'chip') {
      chips.push(item)
      continue
    }
    // A paragraph closes the block the preceding chips opened, so it renders BELOW
    // them -- where they arrived -- instead of below all of them at the end.
    groups.push({ text: item.text ?? '', chips })
    chips = []
  }
  if (chips.length > 0) groups.push({ chips })
  return groups
}

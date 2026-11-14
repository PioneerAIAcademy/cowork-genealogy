import type { ComponentType, ReactNode } from 'react'
import { ConclusionCard } from './ConclusionCard'
import { latestKind, type CardKind, type CardView } from './kit/view'
import { SearchCard } from './SearchCard'
import { SetupCard } from './SetupCard'
import { StubCard } from './StubCard'

export type { CardKind, CardView }

export interface CardProps {
  view: CardView
  heightLimit?: number | null
  actions?: ReactNode[]
  /** Opens the case file with this search's results in its side panel. */
  onSeeResults?: (logId: string) => void
}

/** Every step card. A card's PR replaces its stub here and touches nothing else. */
export const CARDS: Record<CardKind, ComponentType<CardProps>> = {
  setup: SetupCard,
  plan: StubCard,
  search: SearchCard,
  link: StubCard,
  conflict: StubCard,
  hypothesis: StubCard,
  assess: StubCard,
  conclusion: ConclusionCard
}

/** The card a `show` value draws. `latest`, and `file` until the case file, follow the question's state. */
export function cardKind(show: unknown, view: CardView): CardKind {
  if (typeof show === 'string' && Object.hasOwn(CARDS, show)) return show as CardKind
  return latestKind(view.status)
}

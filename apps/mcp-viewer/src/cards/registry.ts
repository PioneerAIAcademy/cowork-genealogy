import type { ComponentType, ReactNode } from 'react'
import { ConclusionCard } from './ConclusionCard'
import { latestKind, type CardKind, type CardView } from './kit/view'
import { LinkCard } from './LinkCard'
import { SearchCard } from './SearchCard'
import { SetupCard } from './SetupCard'

export type { CardKind, CardView }

export interface CardProps {
  view: CardView
  heightLimit?: number | null
  actions?: ReactNode[]
  /** Opens the case file with this search's results in its side panel. */
  onSeeResults?: (logId: string) => void
}

/** The built step cards. A new card's PR adds its entry here; until then its step draws `latest`. */
export const CARDS: Partial<Record<CardKind, ComponentType<CardProps>>> = {
  setup: SetupCard,
  search: SearchCard,
  link: LinkCard,
  conclusion: ConclusionCard
}

/** The card a `show` value draws. `latest`, `file`, and a step with no card yet follow the question's state. */
export function cardKind(show: unknown, view: CardView): CardKind {
  if (typeof show === 'string' && Object.hasOwn(CARDS, show)) return show as CardKind
  return latestKind(view.status)
}

/** The component that draws `kind`; `latestKind` only ever names a built card. */
export function cardFor(kind: CardKind): ComponentType<CardProps> {
  return CARDS[kind] ?? SetupCard
}

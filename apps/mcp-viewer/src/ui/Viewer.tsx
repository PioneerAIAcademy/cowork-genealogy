import { useMemo, useSyncExternalStore } from 'react'
import { cardView } from '../cards/kit/view'
import { Shell } from '../cards/kit/Shell'
import { CARDS, cardKind } from '../cards/registry'
import type { Session } from '../session'
import { headline } from './status'

export function Viewer({ session }: { session: Session }) {
  const state = useSyncExternalStore(session.subscribe, session.getState)
  const { load, heightLimit } = state
  const snapshot = state.connection !== 'unreachable' && load.phase === 'ready' ? load.snapshot : null
  const input = useMemo(() => load.input ?? snapshot?.echo ?? {}, [load.input, snapshot])
  const view = useMemo(() => (snapshot ? cardView(snapshot, input) : null), [snapshot, input])
  const actions =
    state.display.mode === 'fullscreen'
      ? [
          <button key="back" type="button" onClick={() => void session.requestMode('inline')}>
            Back to the card
          </button>
        ]
      : []

  if (!view) {
    return (
      <main className="page">
        <Shell title={headline(state)} actions={actions} heightLimit={heightLimit} />
      </main>
    )
  }
  const Card = CARDS[cardKind(input.show, view)]
  return (
    <main className="page">
      <Card view={view} heightLimit={heightLimit} actions={actions} />
    </main>
  )
}

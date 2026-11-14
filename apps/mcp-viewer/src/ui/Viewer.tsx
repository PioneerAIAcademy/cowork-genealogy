import { useMemo, useSyncExternalStore } from 'react'
import { cardView } from '../cards/kit/view'
import { CardLine, Shell } from '../cards/kit/Shell'
import { compareFindings, compareLine } from '../file/compare-model'
import { CARDS, cardKind } from '../cards/registry'
import { fullscreenOffered } from '../display-mode'
import type { Session } from '../session'
import { NewCaseFile } from '../file/NewCaseFile'
import { headline } from './status'

export function Viewer({ session }: { session: Session }) {
  const state = useSyncExternalStore(session.subscribe, session.getState)
  const { load, heightLimit } = state
  const snapshot = state.connection !== 'unreachable' && load.phase === 'ready' ? load.snapshot : null
  const input = useMemo(() => load.input ?? snapshot?.echo ?? {}, [load.input, snapshot])
  const view = useMemo(() => (snapshot ? cardView(snapshot, input) : null), [snapshot, input])
  const found = useMemo(() => {
    if (!snapshot || !view) return null
    const compare = compareFindings(view.research, snapshot.tree, snapshot.startingTree, view.index)
    return compare ? compareLine(compare.counts) : null
  }, [snapshot, view])

  if (view && state.display.mode === 'fullscreen') return <NewCaseFile session={session} input={input} />
  if (!view) {
    return (
      <main className="page">
        <Shell title={headline(state)} heightLimit={heightLimit} />
      </main>
    )
  }

  const canOpen = fullscreenOffered(state.display)
  const actions = canOpen
    ? [
        <button key="file" type="button" onClick={() => void session.openFile()}>
          Open the case file
        </button>
      ]
    : []
  const kind = cardKind(input.show, view)
  const Card = CARDS[kind]
  // Compare's count goes under the conclusion card, and under whatever `latest` draws.
  const line =
    found && (kind === 'conclusion' || input.show === 'latest') ? (
      canOpen ? (
        <button type="button" onClick={() => void session.openFile(undefined, 'compare')}>
          {found}
        </button>
      ) : (
        <p>{found}.</p>
      )
    ) : null
  return (
    <main className="page">
      <CardLine.Provider value={line}>
        <Card
          view={view}
          heightLimit={heightLimit}
          actions={actions}
          onSeeResults={canOpen ? (logId) => void session.openFile(logId) : undefined}
        />
      </CardLine.Provider>
    </main>
  )
}

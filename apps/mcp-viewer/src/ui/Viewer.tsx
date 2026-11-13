import { useMemo, useSyncExternalStore } from 'react'
import { cardView } from '../cards/kit/view'
import { Shell } from '../cards/kit/Shell'
import { CARDS, cardKind } from '../cards/registry'
import { fullscreenOffered } from '../display-mode'
import type { Session } from '../session'
import { NewCaseFile } from '../file/NewCaseFile'
import { CaseFile } from './CaseFile'
import { headline } from './status'

export function Viewer({ session }: { session: Session }) {
  const state = useSyncExternalStore(session.subscribe, session.getState)
  const { load, heightLimit } = state
  const snapshot = state.connection !== 'unreachable' && load.phase === 'ready' ? load.snapshot : null
  const input = useMemo(() => load.input ?? snapshot?.echo ?? {}, [load.input, snapshot])
  const view = useMemo(() => (snapshot ? cardView(snapshot, input) : null), [snapshot, input])

  if (view && state.display.mode === 'fullscreen') {
    // Until M3-4 the new file is reached by name: `show: file` with a `page`.
    return input.show === 'file' && typeof input.page === 'string' ? (
      <NewCaseFile session={session} input={input} />
    ) : (
      <CaseFile session={session} />
    )
  }
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
  const Card = CARDS[cardKind(input.show, view)]
  return (
    <main className="page">
      <Card
        view={view}
        heightLimit={heightLimit}
        actions={actions}
        onSeeResults={canOpen ? (logId) => void session.openFile(logId) : undefined}
      />
    </main>
  )
}

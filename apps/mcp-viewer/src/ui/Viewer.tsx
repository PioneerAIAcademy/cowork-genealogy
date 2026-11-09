import { useSyncExternalStore } from 'react'
import { fullscreenOffered } from '../display-mode'
import { SIZE_LADDER } from '../probes'
import { headline, reportText } from '../report'
import type { Session } from '../session'

export function Viewer({ session }: { session: Session }) {
  const state = useSyncExternalStore(session.subscribe, session.getState)
  const inFile = state.display.mode === 'fullscreen'
  const probesShown = state.connection === 'connected' && state.load.phase !== 'stopped'
  const image = state.imageProbe

  return (
    <main className="page">
      <h1>{inFile ? 'Case file' : headline(state)}</h1>
      {inFile && <p>The case file opens here. For now this is a placeholder.</p>}

      <div className="actions">
        {inFile && (
          <button type="button" onClick={() => void session.requestMode('inline')}>
            Back to the card
          </button>
        )}
        {!inFile && fullscreenOffered(state.display) && (
          <button type="button" onClick={() => void session.requestMode('fullscreen')}>
            Open full screen
          </button>
        )}
        {probesShown &&
          SIZE_LADDER.map((chars) => (
            <button key={chars} type="button" onClick={() => void session.runSizeProbe(chars)}>
              Read {chars} characters
            </button>
          ))}
        {probesShown && (
          <button type="button" onClick={() => void session.runImageProbe()}>
            Load an image
          </button>
        )}
        {probesShown && (
          <button type="button" onClick={() => void session.runLinkProbe()}>
            Open a link
          </button>
        )}
      </div>

      {image?.url && (
        <img
          key={image.url}
          className="probe-image"
          src={image.url}
          alt={`Image probe: ${image.ref}`}
          onLoad={(event) =>
            session.imageSettled({
              ok: true,
              width: event.currentTarget.naturalWidth,
              height: event.currentTarget.naturalHeight
            })
          }
          onError={() => session.imageSettled({ ok: false })}
        />
      )}

      <pre className="report">{reportText(state)}</pre>
    </main>
  )
}

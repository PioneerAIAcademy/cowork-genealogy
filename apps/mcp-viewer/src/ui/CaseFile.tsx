import { ResearchDataProvider, useResearchData, ViewerBody } from '@genealogy/viewer-ui'
import viewerCss from '@genealogy/viewer-ui/styles.css?inline'
import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import type { Session } from '../session'

/** Opens the side panel on one search's results, once, when the file has loaded. */
function OpenResults({ logId }: { logId: string | null }) {
  const { research, openSidecar } = useResearchData()
  const opened = useRef<string | null>(null)
  useEffect(() => {
    if (!logId || !research || opened.current === logId) return
    opened.current = logId
    openSidecar(logId)
  }, [logId, research, openSidecar])
  return null
}

/** The case file in fullscreen: viewer-ui's body over today's documents. Its page-wide
 *  styles live only while it is open, so they never pin or clip an inline card. */
export function CaseFile({ session }: { session: Session }) {
  const { fileLogId } = useSyncExternalStore(session.subscribe, session.getState)

  useLayoutEffect(() => {
    const style = document.createElement('style')
    style.dataset.caseFile = ''
    style.textContent = viewerCss
    document.head.appendChild(style)
    const root = document.documentElement
    const theme = root.getAttribute('data-theme')
    return () => {
      style.remove()
      if (theme === null) root.removeAttribute('data-theme')
      else root.setAttribute('data-theme', theme)
    }
  }, [])

  return (
    <div className="case-file">
      <div className="case-file-bar">
        <button type="button" onClick={() => void session.requestMode('inline')}>
          Back to the card
        </button>
      </div>
      <ResearchDataProvider transport={session.transport}>
        <OpenResults logId={fileLogId} />
        <ViewerBody showThemeToggle={false} hideHeaderActions />
      </ResearchDataProvider>
    </div>
  )
}

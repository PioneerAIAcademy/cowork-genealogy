import { useEffect, useRef } from 'react'
import FocusTrap from 'focus-trap-react'
import { useResearchData } from '../../contexts/ResearchDataContext'
import type {
  RecordSearchResult,
  FulltextSearchResult,
  SidecarFile,
  SidecarTool
} from '../../lib/schema'
import SidecarResultCard from './SidecarResultCard'
import styles from './SidecarPanel.module.css'

function HeaderTitle({ tool }: { tool: SidecarTool }): React.JSX.Element {
  if (tool === 'record_search') return <>Record Search Results</>
  if (tool === 'fulltext_search') return <>Fulltext Search Results</>
  return <>Search Results</>
}

function SummaryStrip({
  payload,
  examined
}: {
  payload: SidecarFile
  examined?: number
}): React.JSX.Element {
  const returned = payload.returned_count
  const labelParts: string[] = [`TOOL  ${payload.tool}`]
  if (examined !== undefined) {
    labelParts.push(`EXAMINED ${examined} of ${returned} returned`)
  } else {
    labelParts.push(`${returned} returned`)
  }
  return <div className={styles.summary}>{labelParts.join(' · ')}</div>
}

function LoadedBody({
  payload,
  focusPersonaId,
  bodyRef
}: {
  payload: SidecarFile
  focusPersonaId?: string
  bodyRef: React.Ref<HTMLDivElement>
}): React.JSX.Element {
  const results = (payload.payload.results ?? []) as Array<
    RecordSearchResult | FulltextSearchResult
  >

  if (results.length === 0) {
    return (
      <div ref={bodyRef} className={styles.body}>
        <p className={styles.emptyMessage}>This search returned no results.</p>
      </div>
    )
  }

  // Determine which card should be expanded by default: if there's a focused
  // persona, expand the result that contains it; otherwise expand the first.
  let defaultExpandedIndex = 0
  if (focusPersonaId !== undefined && payload.tool === 'record_search') {
    const idx = results.findIndex((r) => {
      const rs = r as RecordSearchResult
      if (rs.primaryId === focusPersonaId) return true
      return rs.gedcomx?.persons?.some((p) => p.id === focusPersonaId) ?? false
    })
    if (idx >= 0) defaultExpandedIndex = idx
  }

  return (
    <div ref={bodyRef} className={styles.body}>
      {results.map((r, idx) => (
        <SidecarResultCard
          key={idx}
          result={r}
          tool={payload.tool}
          focusPersonaId={focusPersonaId}
          defaultExpanded={idx === defaultExpandedIndex}
        />
      ))}
    </div>
  )
}

export default function SidecarPanel(): React.JSX.Element | null {
  const { sidecar, openSidecar, closeSidecar, clearFocusPersona } = useResearchData()
  const bodyRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to the focused person when the loaded payload first appears
  // for an assertion-triggered openSidecar. role="dialog" + aria-modal +
  // focus trap give us the a11y semantics; we intentionally skip aria-hidden
  // on the root because the drawer renders inside it.
  const focusPersonaId = sidecar.status === 'loaded' ? sidecar.focusPersonaId : undefined
  useEffect(() => {
    if (sidecar.status !== 'loaded') return
    if (focusPersonaId === undefined) return
    requestAnimationFrame(() => {
      const node = bodyRef.current?.querySelector('[data-focused="true"]')
      if (node) (node as HTMLElement).scrollIntoView({ block: 'center', behavior: 'smooth' })
    })
  }, [sidecar.status, focusPersonaId])

  // Escape-to-close. Driven by our own listener rather than the trap's
  // onDeactivate (see the FocusTrap note below): a StrictMode-induced trap
  // teardown must not be mistaken for a user dismissal.
  useEffect(() => {
    if (sidecar.status === 'closed') return
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closeSidecar()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [sidecar.status, closeSidecar])

  if (sidecar.status === 'closed') return null

  const handleBodyClick = (): void => {
    if (sidecar.status === 'loaded' && sidecar.focusPersonaId !== undefined) {
      clearFocusPersona()
    }
  }

  const titleId = 'sidecarTitle'

  return (
    <FocusTrap
      focusTrapOptions={{
        initialFocus: `.${styles.closeButton}`,
        fallbackFocus: `.${styles.drawer}`,
        // Do NOT wire onDeactivate -> closeSidecar. focus-trap-react fires
        // onDeactivate from componentWillUnmount, which React StrictMode trips
        // via its mount->unmount->remount probe, slamming the drawer shut the
        // instant it opens. Closing is driven explicitly instead: the backdrop
        // (click-outside), the × button, and the Escape handler above.
        // clickOutsideDeactivates stays true so the trap lets backdrop clicks
        // reach the backdrop's own onClick (otherwise it would
        // stopImmediatePropagation on outside clicks). Escape is ours.
        escapeDeactivates: false,
        clickOutsideDeactivates: true,
        returnFocusOnDeactivate: true
      }}
    >
      <div className={styles.overlay}>
        <div
          className={styles.backdrop}
          aria-hidden="true"
          onClick={closeSidecar}
          data-testid="sidecar-backdrop"
        />
        <aside
          className={styles.drawer}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          onClick={handleBodyClick}
        >
          <header className={styles.drawerHeader}>
            <div>
              <h2 id={titleId} className={styles.drawerTitle}>
                <HeaderTitle
                  tool={sidecar.status === 'loaded' ? sidecar.payload.tool : 'record_search'}
                />
              </h2>
              <div className={styles.headerMeta}>
                <code className={styles.logId}>{sidecar.logId}</code>
                {sidecar.status === 'loaded' && (
                  <>
                    {' · '}
                    {sidecar.payload.retrieved}
                  </>
                )}
              </div>
            </div>
            <button
              type="button"
              className={styles.closeButton}
              onClick={closeSidecar}
              aria-label="Close sidecar"
            >
              ×
            </button>
          </header>

          {sidecar.status === 'loading' && (
            <>
              <div className={styles.loadingStrip} aria-hidden="true" />
              <div className={styles.body}>
                <p className={styles.loadingMessage}>Loading…</p>
              </div>
            </>
          )}

          {sidecar.status === 'loaded' && (
            <>
              <SummaryStrip payload={sidecar.payload} />
              <LoadedBody
                payload={sidecar.payload}
                focusPersonaId={sidecar.focusPersonaId}
                bodyRef={bodyRef}
              />
            </>
          )}

          {sidecar.status === 'missing' && (
            <div className={styles.body}>
              <h3 className={styles.statusTitle}>Results file not found</h3>
              <p className={styles.statusBody}>
                <code className={styles.logId}>{`results/${sidecar.logId}.json`}</code> is missing
                from this project folder.
              </p>
              <div className={styles.statusActions}>
                <button type="button" className={styles.button} onClick={closeSidecar}>
                  Close
                </button>
              </div>
            </div>
          )}

          {sidecar.status === 'error' && (
            <div className={styles.body}>
              <h3 className={styles.statusTitle}>Couldn&apos;t load results</h3>
              <pre className={styles.errorBlock}>{sidecar.error}</pre>
              <div className={styles.statusActions}>
                <button
                  type="button"
                  className={styles.button}
                  onClick={() => openSidecar(sidecar.logId)}
                >
                  Try again
                </button>
                <button type="button" className={styles.button} onClick={closeSidecar}>
                  Close
                </button>
              </div>
            </div>
          )}
        </aside>
      </div>
    </FocusTrap>
  )
}

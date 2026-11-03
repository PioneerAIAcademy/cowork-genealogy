import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useResearchData } from '../../contexts/ResearchDataContext'
import { PrintModeContext } from '../../contexts/PrintModeContext'
import { sectionComponents } from '../../sections'
import { SECTION_ORDER } from '../layout/Sidebar'
import ErrorBoundary from '../ErrorBoundary'
import styles from './PrintView.module.css'

/** Every section key, in the sidebar's order. A section registered in
 *  `sectionComponents` but missing from `SECTION_ORDER` is appended rather than
 *  dropped, so a section added later still prints. */
export function printOrder(): string[] {
  const ordered = SECTION_ORDER.map((s) => s.key).filter((key) => key in sectionComponents)
  const rest = Object.keys(sectionComponents).filter((key) => !ordered.includes(key))
  return [...ordered, ...rest]
}

/**
 * The whole project, every section expanded, for `window.print()`.
 *
 * Rendered into `#print-root`, a sibling of the app's root on `document.body`, so
 * the print CSS in `global.css` can hide everything else — the sidebar, the header
 * and, in the web app, the chat pane. Mount it to print; it calls `onDone` once the
 * print dialog closes, and the caller unmounts it.
 */
export default function PrintView({ onDone }: { onDone: () => void }): React.JSX.Element {
  const { research } = useResearchData()
  // Created in the initializer, not the effect, so the first commit already has a
  // portal target.
  const [target] = useState(() => {
    const el = document.createElement('div')
    el.id = 'print-root'
    return el
  })

  useEffect(() => {
    document.body.appendChild(target)
    return () => target.remove()
  }, [target])

  // A ref, so a re-render with a new `onDone` (a live research update while the
  // dialog is open) does not re-run the effect below and print a second time.
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone

  useEffect(() => {
    // Two frames: the first runs before the portal's content is painted.
    let inner = 0
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => window.print())
    })
    const handleAfterPrint = (): void => onDoneRef.current()
    window.addEventListener('afterprint', handleAfterPrint)
    return () => {
      cancelAnimationFrame(outer)
      cancelAnimationFrame(inner)
      window.removeEventListener('afterprint', handleAfterPrint)
    }
  }, [])

  const title = research?.project?.title || research?.project?.objective

  return createPortal(
    <PrintModeContext.Provider value={true}>
      <div className={styles.printView}>
        {title && <h1 className={styles.title}>{title}</h1>}
        {printOrder().map((key) => {
          const Section = sectionComponents[key]
          return (
            <div key={key} className={styles.section} data-print-section={key}>
              <ErrorBoundary resetKey={key} label={`the ${key} section`}>
                <Section />
              </ErrorBoundary>
            </div>
          )
        })}
      </div>
    </PrintModeContext.Provider>,
    target
  )
}

import { useState } from 'react'
import FeedbackDialog from '../shared/FeedbackDialog'
import PrintView from '../print/PrintView'
import { useResearchData } from '../../contexts/ResearchDataContext'
import { exportGedcom, gedcomFileName } from '../../lib/gedcom-export'
import styles from './Header.module.css'

export default function Header(): React.JSX.Element {
  const [showFeedback, setShowFeedback] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [printing, setPrinting] = useState(false)
  const { research, gedcomx } = useResearchData()

  // A Blob + <a download> saves the file in both apps without a transport round
  // trip; spec: docs/specs/gedcom-export-spec.md.
  const handleExport = (): void => {
    if (!research || !gedcomx) return
    setExportError(null)
    try {
      const text = exportGedcom(research, gedcomx)
      // octet-stream, not text/plain: Safari can append `.txt` to a text download,
      // and a genealogy program will not pick up `x.ged.txt`.
      const url = URL.createObjectURL(new Blob([text], { type: 'application/octet-stream' }))
      const a = document.createElement('a')
      a.href = url
      a.download = gedcomFileName(research)
      document.body.appendChild(a)
      a.click()
      a.remove()
      // Revoking on the next tick can cancel a download the browser has not
      // started fetching yet; a minute is long enough for any of them.
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (err) {
      console.error('GEDCOM export failed', err)
      setExportError('Export failed')
    }
  }

  return (
    <>
      <header className={styles.header}>
        <div className={styles.title}>Research Viewer</div>
        <div className={styles.controls}>
          {exportError && (
            <span className={styles.exportError} role="alert">
              {exportError}
            </span>
          )}
          <button
            className={styles.exportBtn}
            onClick={handleExport}
            disabled={!research || !gedcomx}
            title="Download the research tree as a GEDCOM file"
          >
            Export GEDCOM
          </button>
          <button
            className={styles.exportBtn}
            onClick={() => setPrinting(true)}
            disabled={!research || printing}
            title="Print every section of the project"
          >
            Print
          </button>
          <button className={styles.feedbackBtn} onClick={() => setShowFeedback(true)}>
            Send Feedback
          </button>
        </div>
      </header>
      {showFeedback && <FeedbackDialog onClose={() => setShowFeedback(false)} />}
      {printing && <PrintView onDone={() => setPrinting(false)} />}
    </>
  )
}

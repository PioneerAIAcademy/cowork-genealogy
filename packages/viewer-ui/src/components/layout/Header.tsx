import { useState } from 'react'
import FeedbackDialog from '../shared/FeedbackDialog'
import styles from './Header.module.css'

export default function Header(): React.JSX.Element {
  const [showFeedback, setShowFeedback] = useState(false)

  return (
    <>
      <header className={styles.header}>
        <div className={styles.title}>Research Viewer</div>
        <div className={styles.controls}>
          <button className={styles.feedbackBtn} onClick={() => setShowFeedback(true)}>
            Send Feedback
          </button>
        </div>
      </header>
      {showFeedback && <FeedbackDialog onClose={() => setShowFeedback(false)} />}
    </>
  )
}

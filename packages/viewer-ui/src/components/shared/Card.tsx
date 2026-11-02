import { useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useResearchData } from '../../contexts/ResearchDataContext'
import { usePrintMode } from '../../contexts/PrintModeContext'
import DetailPanel from './DetailPanel'
import Linkify from './Linkify'
import styles from './Card.module.css'

interface CardProps {
  id: string
  title: ReactNode
  badges?: ReactNode
  summary?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  rawData?: unknown
  className?: string
}

const DRAG_THRESHOLD = 4

export default function Card({
  id,
  title,
  badges,
  summary,
  children,
  footer,
  rawData,
  className
}: CardProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const { devMode } = useResearchData()
  const print = usePrintMode()
  const open = expanded || print
  const downPos = useRef({ x: 0, y: 0 })

  return (
    <div id={id} className={`${styles.card} ${className ?? ''}`}>
      <div
        className={styles.header}
        onMouseDown={print ? undefined : (e) => { downPos.current = { x: e.clientX, y: e.clientY } }}
        onClick={print ? undefined : (e) => {
          const dx = e.clientX - downPos.current.x
          const dy = e.clientY - downPos.current.y
          if (dx * dx + dy * dy > DRAG_THRESHOLD * DRAG_THRESHOLD) return
          setExpanded(!expanded)
        }}
      >
        <div className={styles.title}>{title}</div>
        <div className={styles.badges}>
          {badges}
          {!print && <span className={styles.chevron}>{expanded ? '▾' : '▸'}</span>}
        </div>
      </div>
      {summary && (
        <div className={styles.summary}>
          {/* Summaries are usually agent-authored prose (citations, rationales,
              search summaries) that may embed a URL — linkify the string form.
              Non-string summaries (already JSX) pass through untouched. */}
          {typeof summary === 'string' ? <Linkify text={summary} /> : summary}
        </div>
      )}
      {open && children && <div className={styles.body}>{children}</div>}
      {open && footer && <div className={styles.footer}>{footer}</div>}
      {expanded && !print && devMode && rawData != null ? <DetailPanel data={rawData} /> : null}
    </div>
  )
}

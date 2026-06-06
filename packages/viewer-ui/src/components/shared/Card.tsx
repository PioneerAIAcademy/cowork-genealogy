import { useState } from 'react'
import type { ReactNode } from 'react'
import { useResearchData } from '../../contexts/ResearchDataContext'
import DetailPanel from './DetailPanel'
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

  return (
    <div id={id} className={`${styles.card} ${className ?? ''}`}>
      <div className={styles.header} onClick={() => setExpanded(!expanded)}>
        <div className={styles.title}>{title}</div>
        <div className={styles.badges}>
          {badges}
          <span className={styles.chevron}>{expanded ? '▾' : '▸'}</span>
        </div>
      </div>
      {summary && <div className={styles.summary}>{summary}</div>}
      {expanded && children && <div className={styles.body}>{children}</div>}
      {expanded && footer && <div className={styles.footer}>{footer}</div>}
      {expanded && devMode && rawData != null ? <DetailPanel data={rawData} /> : null}
    </div>
  )
}

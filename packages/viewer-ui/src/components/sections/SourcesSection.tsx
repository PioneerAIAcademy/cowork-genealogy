import { useState, useEffect } from 'react'
import { useResearchData } from '../../contexts/ResearchDataContext'
import Card from '../shared/Card'
import StatusBadge from '../shared/StatusBadge'
import CrossLink from '../shared/CrossLink'
import Linkify from '../shared/Linkify'
import type { Source } from '../../lib/schema'
import { openExternal } from '../../lib/external'
import styles from './SourcesSection.module.css'

const TRANSCRIPTION_PREVIEW_CHARS = 300

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return text.slice(0, max) + '...'
}

function Transcription({ text }: { text: string }): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const isLong = text.length > TRANSCRIPTION_PREVIEW_CHARS
  const displayed = expanded || !isLong ? text : text.slice(0, TRANSCRIPTION_PREVIEW_CHARS) + '…'
  return (
    <>
      <pre className={styles.transcriptionBlock}>{displayed}</pre>
      {isLong && (
        <button
          type="button"
          className={styles.transcriptionToggle}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </>
  )
}

function SourceImage({ filename }: { filename: string }): React.JSX.Element | null {
  const { getSourceImage } = useResearchData()
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!getSourceImage) return
    let alive = true
    setSrc(null)
    setFailed(false)
    getSourceImage(filename)
      .then((url) => {
        if (alive) setSrc(url)
      })
      .catch(() => {
        if (alive) setFailed(true)
      })
    return () => {
      alive = false
    }
  }, [getSourceImage, filename])

  // No transport support (web client), a load error, or the file is gone →
  // show nothing (the transcription still stands on its own).
  if (!getSourceImage || failed || !src) return null
  return <img className={styles.sourceImage} src={src} alt="Source page scan" />
}

function SourceCard({ source }: { source: Source }): React.JSX.Element {
  const { citation_detail: detail } = source

  const handleLinkClick = (url: string): void => {
    openExternal(url)
  }

  return (
    <Card
      id={source.id}
      title={detail.what}
      badges={<StatusBadge value={source.source_classification} />}
      summary={truncate(source.citation, 200)}
      footer={
        <div className={styles.footerLinks}>
          <CrossLink
            id={source.gedcomx_source_description_id}
            label={`GedcomX: ${source.gedcomx_source_description_id}`}
          />
          {source.log_entry_id && (
            <CrossLink id={source.log_entry_id} label={`Captured by: ${source.log_entry_id}`} />
          )}
        </div>
      }
      rawData={source}
    >
      <div className={styles.detailGrid}>
        <div className={styles.field}>
          <div className={styles.fieldLabel}>Who</div>
          <div className={styles.fieldValue}>{detail.who}</div>
        </div>
        <div className={styles.field}>
          <div className={styles.fieldLabel}>What</div>
          <div className={styles.fieldValue}>{detail.what}</div>
        </div>
        <div className={styles.field}>
          <div className={styles.fieldLabel}>When Created</div>
          <div className={styles.fieldValue}>{detail.when_created}</div>
        </div>
        <div className={styles.field}>
          <div className={styles.fieldLabel}>When Accessed</div>
          <div className={styles.fieldValue}>{detail.when_accessed}</div>
        </div>
        <div className={styles.field}>
          <div className={styles.fieldLabel}>Where</div>
          <div className={styles.fieldValue}>{detail.where}</div>
        </div>
        <div className={styles.field}>
          <div className={styles.fieldLabel}>Where Within</div>
          <div className={styles.fieldValue}>{detail.where_within}</div>
        </div>
      </div>

      <div className={styles.field}>
        <div className={styles.fieldLabel}>Repository</div>
        <div className={styles.fieldValue}>{source.repository}</div>
      </div>

      <div className={styles.field}>
        <div className={styles.fieldLabel}>Access Date</div>
        <div className={styles.fieldValue}>{source.access_date}</div>
      </div>

      {source.url && (
        <div className={styles.field}>
          <div className={styles.fieldLabel}>URL</div>
          <button className={styles.externalLink} onClick={() => handleLinkClick(source.url!)}>
            {source.url}
          </button>
        </div>
      )}

      {source.notes && (
        <div className={styles.field}>
          <div className={styles.fieldLabel}>Notes</div>
          <div className={styles.notes}><Linkify text={source.notes} /></div>
        </div>
      )}

      {source.transcription && (
        <div className={styles.field}>
          <div className={styles.fieldLabel}>Transcription</div>
          <Transcription text={source.transcription} />
        </div>
      )}

      {source.image_filename && (
        <div className={styles.field}>
          <div className={styles.fieldLabel}>Page scan</div>
          <SourceImage filename={source.image_filename} />
        </div>
      )}
    </Card>
  )
}

export default function SourcesSection(): React.JSX.Element {
  const { research } = useResearchData()
  const sources = research?.sources ?? []

  return (
    <div className={styles.section}>
      <h2 className={styles.sectionTitle}>Sources</h2>
      {sources.length === 0 ? (
        <p className={styles.empty}>No sources captured yet.</p>
      ) : (
        sources.map((s) => <SourceCard key={s.id} source={s} />)
      )}
    </div>
  )
}

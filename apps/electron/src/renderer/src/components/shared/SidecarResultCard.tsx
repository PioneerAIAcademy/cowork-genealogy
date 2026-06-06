import { useState } from 'react'
import type {
  RecordSearchResult,
  FulltextSearchResult,
  GedcomxPerson,
  GedcomxRelationship,
  SidecarTool
} from '../../lib/schema'
import { getPreferredName, getPrimaryFact } from '../../lib/schema'
import { orderPersons, relationshipFromPerspective } from '../../lib/relationship-label'
import Pill from './Pill'
import styles from './SidecarResultCard.module.css'

interface SidecarResultCardProps {
  result: RecordSearchResult | FulltextSearchResult
  tool: SidecarTool
  focusPersonaId?: string
  defaultExpanded: boolean
}

function isRecordSearch(
  _result: RecordSearchResult | FulltextSearchResult,
  tool: SidecarTool
): _result is RecordSearchResult {
  return tool === 'record_search'
}

function openExternal(url: string | undefined): void {
  if (url) window.api.openExternal(url)
}

function PersonRow({
  person,
  primaryId,
  primaryRelationships,
  focusPersonaId
}: {
  person: GedcomxPerson
  primaryId: string
  primaryRelationships: GedcomxRelationship[]
  focusPersonaId?: string
}): React.JSX.Element {
  const isPrimary = person.id === primaryId
  const isFocused = focusPersonaId !== undefined && person.id === focusPersonaId
  const label = isPrimary
    ? null
    : relationshipFromPerspective(primaryId, person.id, person.gender, primaryRelationships)
  const birth = getPrimaryFact(person, 'Birth')
  const death = getPrimaryFact(person, 'Death')

  return (
    <div
      className={`${styles.personRow} ${isFocused ? styles.focused : ''}`}
      data-focused={isFocused ? 'true' : undefined}
    >
      <div className={styles.personHeader}>
        <span className={styles.personName}>{getPreferredName(person)}</span>
        {isPrimary && <Pill label="PRIMARY" tone="primary" />}
        {isFocused && !isPrimary && <Pill label="MATCHED" tone="matched" />}
      </div>
      {label && <div className={styles.personRelationship}>{label}</div>}
      <div className={styles.personFacts}>
        {birth && (
          <span>
            b. {birth.date ?? '?'}
            {birth.place ? `, ${birth.place}` : ''}
          </span>
        )}
        {death && (
          <span>
            d. {death.date ?? '?'}
            {death.place ? `, ${death.place}` : ''}
          </span>
        )}
        {!birth && !death && <span className={styles.personFactsEmpty}>No facts recorded</span>}
      </div>
    </div>
  )
}

function RecordSearchBody({
  result,
  focusPersonaId
}: {
  result: RecordSearchResult
  focusPersonaId?: string
}): React.JSX.Element {
  const persons = result.gedcomx?.persons ?? []
  const relationships = result.gedcomx?.relationships ?? []
  const ordered = orderPersons(persons, result.primaryId, relationships)

  return (
    <div className={styles.body}>
      {ordered.length > 0 && (
        <div className={styles.personsSection}>
          <div className={styles.sectionLabel}>Persons</div>
          {ordered.map((p) => (
            <PersonRow
              key={p.id}
              person={p}
              primaryId={result.primaryId}
              primaryRelationships={relationships}
              focusPersonaId={focusPersonaId}
            />
          ))}
        </div>
      )}

      {result.treeMatches && result.treeMatches.length > 0 && (
        <div className={styles.treeMatches}>
          <div className={styles.sectionLabel}>Tree matches</div>
          <ul className={styles.treeMatchList}>
            {result.treeMatches.map((tm) => (
              <li key={tm.personId} className={styles.treeMatchItem}>
                <span>{tm.personName}</span>
                {tm.treeId && (
                  <>
                    {' — tree '}
                    <code className={styles.treeId}>{tm.treeId}</code>
                  </>
                )}
                {tm.ark && (
                  <>
                    {' · '}
                    <button
                      type="button"
                      className={styles.externalLink}
                      onClick={() => openExternal(tm.ark)}
                    >
                      View →
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {result.arkUrl && (
        <div className={styles.footerLink}>
          <button
            type="button"
            className={styles.externalLink}
            onClick={() => openExternal(result.arkUrl)}
          >
            Open in FamilySearch →
          </button>
        </div>
      )}
    </div>
  )
}

function FulltextSearchBody({ result }: { result: FulltextSearchResult }): React.JSX.Element {
  // Highlight matched terms inside the textDocument snippet.
  const text = result.textDocument ?? ''
  const terms = result.highlightTerms ?? []
  let rendered: React.ReactNode = text
  if (terms.length > 0 && text) {
    const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).filter(Boolean)
    if (escaped.length > 0) {
      const re = new RegExp(`(${escaped.join('|')})`, 'gi')
      rendered = text.split(re).map((chunk, i) =>
        re.test(chunk) ? (
          <mark key={i} className={styles.highlight}>
            {chunk}
          </mark>
        ) : (
          chunk
        )
      )
    }
  }

  return (
    <div className={styles.body}>
      {text && <p className={styles.snippet}>{rendered}</p>}
      {result.names && result.names.length > 0 && (
        <div className={styles.metaRow}>
          <span className={styles.metaLabel}>Names</span>
          <span>{result.names.join(', ')}</span>
        </div>
      )}
      {result.places && result.places.length > 0 && (
        <div className={styles.metaRow}>
          <span className={styles.metaLabel}>Places</span>
          <span>{result.places.join(', ')}</span>
        </div>
      )}
      {result.id && (
        <div className={styles.footerLink}>
          <button
            type="button"
            className={styles.externalLink}
            onClick={() => openExternal(result.id)}
          >
            Open in FamilySearch →
          </button>
        </div>
      )}
    </div>
  )
}

export default function SidecarResultCard({
  result,
  tool,
  focusPersonaId,
  defaultExpanded
}: SidecarResultCardProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(defaultExpanded)

  const isRS = isRecordSearch(result, tool)
  const title = isRS
    ? (result.recordTitle ?? result.collectionTitle ?? 'Untitled record')
    : ((result as FulltextSearchResult).recordType ??
      (result as FulltextSearchResult).collectionTitle ??
      'Untitled record')
  const score = isRS ? result.score : undefined

  return (
    <article className={styles.card}>
      <header
        className={styles.header}
        onClick={() => setExpanded((v) => !v)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setExpanded((v) => !v)
          }
        }}
      >
        <h3 className={styles.title}>{title}</h3>
        <div className={styles.headerMeta}>
          {score !== undefined && <span className={styles.score}>score {score.toFixed(2)}</span>}
          <span className={styles.chevron}>{expanded ? '▾' : '▸'}</span>
        </div>
      </header>
      {isRS && (
        <div className={styles.subMeta}>
          {result.collectionTitle && <span>{result.collectionTitle}</span>}
        </div>
      )}
      {expanded &&
        (isRS ? (
          <RecordSearchBody result={result} focusPersonaId={focusPersonaId} />
        ) : (
          <FulltextSearchBody result={result as FulltextSearchResult} />
        ))}
    </article>
  )
}

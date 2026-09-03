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
import { openFamilySearch } from '../../lib/external'
import { resolveFamilySearchTarget } from '../../lib/familysearch-url'
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
                {/* Gated on RESOLVABILITY, not truthiness — matching PersonCard. A value
                    the policy refuses renders a button that opens nothing, which
                    PersonCard's own test calls worse than no button (#2049 review). */}
                {tm.ark && resolveFamilySearchTarget(tm.ark) && (
                  <>
                    {' · '}
                    <button
                      type="button"
                      className={styles.externalLink}
                      onClick={() => openFamilySearch(tm.ark)}
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

      {result.arkUrl && resolveFamilySearchTarget(result.arkUrl) && (
        <div className={styles.footerLink}>
          <button
            type="button"
            className={styles.externalLink}
            onClick={() => openFamilySearch(result.arkUrl)}
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
  // recordDate (the record's own canonical date) and dates (every date
  // entity-extracted from the document text) are not redundant — a probate
  // filing can carry a filing date plus an earlier death date in the body —
  // so merge and dedupe rather than letting recordDate hide dates' other
  // entries.
  const allDates = Array.from(
    new Set([result.recordDate, ...(result.dates ?? [])].filter(Boolean))
  )
  // Prefer sourceUrl (the upstream-supplied resolver URL) when it resolves;
  // fall back to id, which can itself be a legacy full-URL shape for sidecars
  // staged before #272. Gated on RESOLVABILITY, not truthiness — matching
  // PersonCard and the tree-match sink above (#2049 review).
  const fulltextLinkTarget =
    (result.sourceUrl && resolveFamilySearchTarget(result.sourceUrl)) ||
    (result.id && resolveFamilySearchTarget(result.id))
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
      {allDates.length > 0 && (
        <div className={styles.metaRow}>
          <span className={styles.metaLabel}>Dates</span>
          <span>{allDates.join(', ')}</span>
        </div>
      )}
      {fulltextLinkTarget && (
        <div className={styles.footerLink}>
          <button
            type="button"
            className={styles.externalLink}
            onClick={() => openFamilySearch(result.sourceUrl || result.id)}
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
  const ft = result as FulltextSearchResult
  const title = isRS
    ? (result.recordTitle ?? result.collectionTitle ?? 'Untitled record')
    : (ft.title || ft.recordType || ft.collectionTitle || 'Untitled record')
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

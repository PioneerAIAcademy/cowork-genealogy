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

// Local on purpose (#3594): `SidecarTool` is already `| string`, and the schema
// package's sidecar types describe only the two search tools. These are the shapes
// record-read.ts and external-links-search.ts stage.
interface RecordReadSource {
  id?: string
  resource_type?: string
  title?: string
  citation?: string
  url?: string
}

export interface RecordReadResult {
  recordId?: string
  gedcomx?: {
    persons?: Array<GedcomxPerson & { principal?: boolean }>
    relationships?: GedcomxRelationship[]
    sources?: RecordReadSource[]
  }
  indexFields?: unknown
}

export interface ExternalLinkResult {
  linkText?: string
  url?: string
}

export type SidecarResult =
  RecordSearchResult | FulltextSearchResult | RecordReadResult | ExternalLinkResult

/** Tools rendered one card per result. SidecarPanel renders every other tool itself. */
export const ROUTED_TOOLS: readonly string[] = ['record_search', 'fulltext_search', 'record_read']

interface SidecarResultCardProps {
  result: SidecarResult
  tool: SidecarTool
  focusPersonaId?: string
  defaultExpanded: boolean
}

/** FamilySearch citations carry markup (`<i>FamilySearch</i>`); show it as plain text. */
function plainText(html: string): string {
  return new DOMParser().parseFromString(html, 'text/html').body.textContent ?? ''
}

export function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

interface RecordReadView {
  title: string
  citation?: string
  recordSearch: RecordSearchResult
}

/**
 * Adapt a staged `record_read` result to the record-search body. A record_read
 * result carries no `primaryId`, and a census marks every household member
 * principal, so the primary is the focused persona when it is on this record,
 * else the first principal, else none ('' — document order, no labels).
 */
function recordReadView(result: RecordReadResult, focusPersonaId?: string): RecordReadView {
  const persons = (result.gedcomx?.persons ?? []).filter(
    (p) => p && typeof p.id === 'string' && Array.isArray(p.names)
  )
  const relationships = (result.gedcomx?.relationships ?? []).filter(
    (r) => r && typeof r === 'object'
  )
  const sources = (result.gedcomx?.sources ?? []).filter((s) => s && typeof s === 'object')
  const record = sources.find((s) => s.resource_type === 'Record')
  const collection = sources.find((s) => s.resource_type === 'Collection')

  const primaryId =
    (focusPersonaId !== undefined && persons.some((p) => p.id === focusPersonaId)
      ? focusPersonaId
      : persons.find((p) => p.principal === true)?.id) ?? ''

  const recordId = nonEmpty(result.recordId) ? result.recordId : undefined
  const title =
    [record?.title, collection?.title, ...sources.map((s) => s.title)].find(nonEmpty) ??
    (recordId ? `Record ${recordId}` : 'Record')

  return {
    title,
    citation: nonEmpty(record?.citation) ? plainText(record?.citation) : undefined,
    recordSearch: {
      primaryId,
      // Gated on resolvability, as in FulltextSearchBody: a Record url the policy
      // refuses must not hide the recordId link, which always resolves.
      arkUrl: [record?.url, recordId].find((v) => resolveFamilySearchTarget(v)),
      gedcomx: { persons, relationships }
    }
  }
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
  const isPrimary = primaryId !== '' && person.id === primaryId
  const isFocused = focusPersonaId !== undefined && person.id === focusPersonaId
  // No primary means no perspective: every label would read "Relative".
  const label =
    isPrimary || primaryId === ''
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
  // `primaryId` is optional in the engine, and this component already reads
  // '' as "no primary" (see PersonRow's `primaryId !== ''`).
  const primaryId = result.primaryId ?? ''
  const ordered = orderPersons(persons, primaryId, relationships)

  return (
    <div className={styles.body}>
      {ordered.length > 0 && (
        <div className={styles.personsSection}>
          <div className={styles.sectionLabel}>Persons</div>
          {ordered.map((p) => (
            <PersonRow
              key={p.id}
              person={p}
              primaryId={primaryId}
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
            {result.treeMatches.map((tm, i) => {
              // Sidecar payloads are untyped at runtime (research-schema-spec
              // §5.4.1) and reach this component through a cast, so a row
              // without a PID is possible. Skip it rather than render an empty
              // chip under `key={undefined}`, which collides across rows.
              if (!tm.treePersonId) return null
              return (
                <li key={`${tm.treePersonId}-${i}`} className={styles.treeMatchItem}>
                  <code className={styles.treeId}>{tm.treePersonId}</code>
                  {typeof tm.stars === 'number' && (
                    <>
                      {' · '}
                      <span className={styles.treeStars}>
                        {tm.stars}/5<span className={styles.srOnly}> match confidence</span>
                      </span>
                    </>
                  )}
                  {/* Gated on RESOLVABILITY, not truthiness — matching PersonCard. A value
                      the policy refuses renders a button that opens nothing, which
                      PersonCard's own test calls worse than no button (#2049 review). */}
                  {resolveFamilySearchTarget(tm.treePersonId) && (
                    <>
                      {' · '}
                      <button
                        type="button"
                        className={styles.externalLink}
                        aria-label={`View ${tm.treePersonId} in FamilySearch`}
                        onClick={() => openFamilySearch(tm.treePersonId)}
                      >
                        View →
                      </button>
                    </>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {/* `arkUrl` is the record_read adapter's synthesized field and what the
          mock agent and sample seeds emit; a real `record_search` sidecar
          carries `recordArk` instead, so without the fallback the footer link
          never rendered for real data. */}
      {(() => {
        const footerArk = result.arkUrl ?? result.recordArk
        if (!footerArk || !resolveFamilySearchTarget(footerArk)) return null
        return (
          <div className={styles.footerLink}>
            <button
              type="button"
              className={styles.externalLink}
              onClick={() => openFamilySearch(footerArk)}
            >
              Open in FamilySearch →
            </button>
          </div>
        )
      })()}
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
  // PersonCard and the tree-match sink above (#2049 review). Keeps the RAW
  // identifier (not the resolved URL) as the winner, matching this component's
  // other two sinks: openFamilySearch forwards the raw value and resolves it
  // again downstream, so the gate and the click handler must pick the same
  // field or the button can render for one and open the other.
  const fulltextLinkSource =
    (result.sourceUrl && resolveFamilySearchTarget(result.sourceUrl) && result.sourceUrl) ||
    (result.id && resolveFamilySearchTarget(result.id) && result.id) ||
    undefined
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
      {fulltextLinkSource && (
        <div className={styles.footerLink}>
          <button
            type="button"
            className={styles.externalLink}
            onClick={() => openFamilySearch(fulltextLinkSource)}
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

  // Route on `tool` explicitly (#3594). An unrouted tool gets a neutral header and
  // no body — never the full-text card, whose fields it does not have. SidecarPanel
  // renders unrouted tools itself, so that branch is a backstop for direct callers.
  let title: string
  let subMeta: string | undefined
  let score: number | undefined
  let body: React.JSX.Element | null = null
  if (tool === 'record_search') {
    const rs = result as RecordSearchResult
    title = rs.recordTitle ?? rs.collectionTitle ?? 'Untitled record'
    subMeta = rs.collectionTitle
    score = rs.score
    body = <RecordSearchBody result={rs} focusPersonaId={focusPersonaId} />
  } else if (tool === 'record_read') {
    const view = recordReadView(result as RecordReadResult, focusPersonaId)
    title = view.title
    subMeta = view.citation
    body = <RecordSearchBody result={view.recordSearch} focusPersonaId={focusPersonaId} />
  } else if (tool === 'fulltext_search') {
    const ft = result as FulltextSearchResult
    title = ft.title || ft.recordType || ft.collectionTitle || 'Untitled record'
    body = <FulltextSearchBody result={ft} />
  } else {
    title = tool
  }

  return (
    <article className={styles.card}>
      <header
        className={styles.header}
        // Nothing to expand for an unrouted tool, so no control to announce.
        {...(body && {
          onClick: () => setExpanded((v) => !v),
          role: 'button',
          tabIndex: 0,
          onKeyDown: (e: React.KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              setExpanded((v) => !v)
            }
          }
        })}
      >
        <h3 className={styles.title}>{title}</h3>
        <div className={styles.headerMeta}>
          {score !== undefined && <span className={styles.score}>score {score.toFixed(2)}</span>}
          {body && <span className={styles.chevron}>{expanded ? '▾' : '▸'}</span>}
        </div>
      </header>
      {subMeta && (
        <div className={styles.subMeta}>
          <span>{subMeta}</span>
        </div>
      )}
      {expanded && body}
    </article>
  )
}

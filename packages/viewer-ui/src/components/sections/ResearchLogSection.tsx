import { useState, useMemo } from 'react'
import { useResearchData } from '../../contexts/ResearchDataContext'
import StatusBadge from '../shared/StatusBadge'
import CrossLink from '../shared/CrossLink'
import type { LogEntry, Source, Assertion } from '../../lib/schema'
import { indexByLogEntry } from '../../lib/index-by-log-entry'
import styles from './ResearchLogSection.module.css'

type SortKey = 'performed' | 'tool' | 'outcome' | 'results_examined'
type SortDir = 'asc' | 'desc'

function compareEntries(a: LogEntry, b: LogEntry, key: SortKey, dir: SortDir): number {
  let cmp = 0
  switch (key) {
    case 'performed':
      cmp = a.performed.localeCompare(b.performed)
      break
    case 'tool':
      cmp = a.tool.localeCompare(b.tool)
      break
    case 'outcome':
      cmp = a.outcome.localeCompare(b.outcome)
      break
    case 'results_examined':
      cmp = a.results_examined - b.results_examined
      break
  }
  return dir === 'desc' ? -cmp : cmp
}

function viewResultsLabel(entry: LogEntry): string {
  const examined = entry.results_examined
  const available = entry.results_available
  if (available !== undefined && available !== null && available > examined) {
    return `View ${examined} of ${available} results →`
  }
  return `View ${examined} results →`
}

export default function ResearchLogSection(): React.JSX.Element {
  const { research, devMode, openSidecar } = useResearchData()
  const logEntries = useMemo(() => research?.log ?? [], [research?.log])
  const sources = useMemo<Source[]>(() => research?.sources ?? [], [research?.sources])
  const assertions = useMemo<Assertion[]>(() => research?.assertions ?? [], [research?.assertions])

  const [sortKey, setSortKey] = useState<SortKey>('performed')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const sorted = useMemo(
    () => [...logEntries].sort((a, b) => compareEntries(a, b, sortKey, sortDir)),
    [logEntries, sortKey, sortDir]
  )

  const sourcesByLogEntry = useMemo(() => indexByLogEntry(sources), [sources])
  const assertionsByLogEntry = useMemo(() => indexByLogEntry(assertions), [assertions])

  const handleSort = (key: SortKey): void => {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  const renderSortIndicator = (key: SortKey): React.JSX.Element | null => {
    if (sortKey !== key) return null
    return <span className={styles.sortIndicator}>{sortDir === 'asc' ? '▲' : '▼'}</span>
  }

  if (logEntries.length === 0) {
    return (
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Research Log</h2>
        <p className={styles.empty}>No log entries yet.</p>
      </div>
    )
  }

  return (
    <div className={styles.section}>
      <h2 className={styles.sectionTitle}>Research Log</h2>
      <table className={styles.table}>
        <thead>
          <tr>
            <th onClick={() => handleSort('performed')}>Date{renderSortIndicator('performed')}</th>
            <th onClick={() => handleSort('tool')}>Tool{renderSortIndicator('tool')}</th>
            <th onClick={() => handleSort('outcome')}>Outcome{renderSortIndicator('outcome')}</th>
            <th onClick={() => handleSort('results_examined')}>
              Results{renderSortIndicator('results_examined')}
            </th>
            <th>Sources</th>
            <th>Assertions</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((entry) => {
            const isExpanded = expandedId === entry.id
            const capturedSources = sourcesByLogEntry.get(entry.id) ?? []
            const producedAssertions = assertionsByLogEntry.get(entry.id) ?? []
            return (
              <tr key={entry.id} id={entry.id}>
                <td colSpan={6} style={{ padding: 0 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <tbody>
                      <tr
                        className={styles.clickableRow}
                        onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                      >
                        <td>{entry.performed}</td>
                        <td>{entry.tool}</td>
                        <td>
                          <StatusBadge value={entry.outcome} />
                        </td>
                        <td>{entry.results_examined}</td>
                        <td>
                          <div className={styles.linkList}>
                            <span className={styles.count}>{capturedSources.length}</span>
                            {capturedSources.map((source) => (
                              <CrossLink key={source.id} id={source.id} />
                            ))}
                          </div>
                        </td>
                        <td>
                          <div className={styles.linkList}>
                            <span className={styles.count}>{producedAssertions.length}</span>
                            {producedAssertions.map((assertion) => (
                              <CrossLink key={assertion.id} id={assertion.id} />
                            ))}
                          </div>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className={styles.expandedRow}>
                          <td colSpan={6}>
                            <div className={styles.expandedContent}>
                              <div className={styles.field}>
                                <div className={styles.fieldLabel}>Query</div>
                                <pre className={styles.queryBlock}>
                                  {JSON.stringify(entry.query, null, 2)}
                                </pre>
                              </div>

                              {entry.notes && (
                                <div className={styles.field}>
                                  <div className={styles.fieldLabel}>Notes</div>
                                  <div className={styles.fieldValue}>{entry.notes}</div>
                                </div>
                              )}

                              {entry.results_ref && (
                                <div className={styles.field}>
                                  <div className={styles.fieldLabel}>Results</div>
                                  <button
                                    type="button"
                                    className={styles.viewResultsButton}
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      openSidecar(entry.id)
                                    }}
                                  >
                                    {viewResultsLabel(entry)}
                                  </button>
                                </div>
                              )}

                              {entry.external_site && (
                                <div className={styles.field}>
                                  <div className={styles.fieldLabel}>External Site</div>
                                  <div className={styles.fieldValue}>
                                    {entry.external_site.site} &middot;{' '}
                                    {entry.external_site.capture_received
                                      ? 'Captured'
                                      : 'Not captured'}
                                    {entry.external_site.capture_filename && (
                                      <> &middot; {entry.external_site.capture_filename}</>
                                    )}
                                  </div>
                                </div>
                              )}

                              {devMode && (
                                <div className={styles.field}>
                                  <div className={styles.fieldLabel}>Raw JSON</div>
                                  <pre className={styles.queryBlock}>
                                    {JSON.stringify(entry, null, 2)}
                                  </pre>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

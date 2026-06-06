import { useState, useMemo } from 'react'
import { useResearchData } from '../../contexts/ResearchDataContext'
import Card from '../shared/Card'
import StatusBadge from '../shared/StatusBadge'
import CrossLink from '../shared/CrossLink'
import type { Assertion } from '../../lib/schema'
import styles from './AssertionsSection.module.css'

function AssertionCard({ assertion }: { assertion: Assertion }): React.JSX.Element {
  const { openSidecar } = useResearchData()
  const canOpenSidecar = Boolean(assertion.log_entry_id && assertion.record_persona_id)
  return (
    <Card
      id={assertion.id}
      title={`${assertion.fact_type}: ${assertion.value}`}
      badges={
        <>
          <StatusBadge value={assertion.information_quality} />
          <StatusBadge value={assertion.evidence_type} />
        </>
      }
      summary={`${assertion.informant} (${assertion.informant_proximity.replace(/_/g, ' ')})`}
      footer={
        <div className={styles.footerLinks}>
          <CrossLink id={assertion.source_id} label={`Source: ${assertion.source_id}`} />
          {assertion.log_entry_id && (
            <CrossLink id={assertion.log_entry_id} label={`Log: ${assertion.log_entry_id}`} />
          )}
        </div>
      }
      rawData={assertion}
    >
      {assertion.date && (
        <div className={styles.field}>
          <div className={styles.fieldLabel}>Date</div>
          <div className={styles.fieldValue}>
            {assertion.date}
            {assertion.date_certainty && ` (${assertion.date_certainty})`}
          </div>
        </div>
      )}

      {assertion.place && (
        <div className={styles.field}>
          <div className={styles.fieldLabel}>Place</div>
          <div className={styles.fieldValue}>{assertion.place}</div>
        </div>
      )}

      <div className={styles.field}>
        <div className={styles.fieldLabel}>Record</div>
        <div className={styles.fieldValue}>
          {assertion.record_id} &middot; Role: {assertion.record_role}
        </div>
      </div>

      {assertion.record_persona_id && (
        <div className={styles.field}>
          <div className={styles.fieldLabel}>Persona</div>
          <div className={styles.fieldValue}>
            <code className={styles.personaId}>{assertion.record_persona_id}</code>
            {canOpenSidecar && (
              <>
                {' '}
                <button
                  type="button"
                  className={styles.personaLink}
                  onClick={() => openSidecar(assertion.log_entry_id!, assertion.record_persona_id!)}
                >
                  View in record →
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {assertion.structured_value && Object.keys(assertion.structured_value).length > 0 && (
        <div className={styles.field}>
          <div className={styles.fieldLabel}>Structured Value</div>
          <div className={styles.structuredValue}>
            {Object.entries(assertion.structured_value).map(([key, val]) => (
              <div key={key} style={{ display: 'contents' }}>
                <span className={styles.structuredKey}>{key}:</span>
                <span className={styles.structuredVal}>{String(val)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {assertion.informant_bias_notes && (
        <div className={styles.field}>
          <div className={styles.fieldLabel}>Informant Bias Notes</div>
          <div className={styles.fieldValue}>{assertion.informant_bias_notes}</div>
        </div>
      )}
    </Card>
  )
}

export default function AssertionsSection(): React.JSX.Element {
  const { research } = useResearchData()
  const assertions = useMemo(() => research?.assertions ?? [], [research?.assertions])

  const [factTypeFilter, setFactTypeFilter] = useState('all')
  const [evidenceTypeFilter, setEvidenceTypeFilter] = useState('all')

  const factTypes = useMemo(
    () => Array.from(new Set(assertions.map((a) => a.fact_type))).sort(),
    [assertions]
  )

  const evidenceTypes = useMemo(
    () => Array.from(new Set(assertions.map((a) => a.evidence_type))).sort(),
    [assertions]
  )

  const filtered = useMemo(
    () =>
      assertions.filter((a) => {
        if (factTypeFilter !== 'all' && a.fact_type !== factTypeFilter) return false
        if (evidenceTypeFilter !== 'all' && a.evidence_type !== evidenceTypeFilter) return false
        return true
      }),
    [assertions, factTypeFilter, evidenceTypeFilter]
  )

  return (
    <div className={styles.section}>
      <h2 className={styles.sectionTitle}>Assertions</h2>

      {assertions.length > 0 && (
        <div className={styles.filters}>
          <div className={styles.filterGroup}>
            <label className={styles.filterLabel}>Fact Type</label>
            <select
              className={styles.filterSelect}
              value={factTypeFilter}
              onChange={(e) => setFactTypeFilter(e.target.value)}
            >
              <option value="all">All</option>
              {factTypes.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.filterGroup}>
            <label className={styles.filterLabel}>Evidence Type</label>
            <select
              className={styles.filterSelect}
              value={evidenceTypeFilter}
              onChange={(e) => setEvidenceTypeFilter(e.target.value)}
            >
              <option value="all">All</option>
              {evidenceTypes.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {assertions.length > 0 && (
        <div className={styles.resultCount}>
          Showing {filtered.length} of {assertions.length} assertions
        </div>
      )}

      {filtered.length === 0 ? (
        <p className={styles.empty}>
          {assertions.length === 0
            ? 'No assertions yet.'
            : 'No assertions match the current filters.'}
        </p>
      ) : (
        filtered.map((a) => <AssertionCard key={a.id} assertion={a} />)
      )}
    </div>
  )
}

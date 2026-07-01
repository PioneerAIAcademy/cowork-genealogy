import { useMemo } from 'react'
import { useResearchData } from '../../contexts/ResearchDataContext'
import Card from '../shared/Card'
import StatusBadge from '../shared/StatusBadge'
import Linkify from '../shared/Linkify'
import type { Plan, Question } from '../../lib/schema'
import styles from './PlansSection.module.css'

export default function PlansSection(): React.JSX.Element {
  const { research, getById } = useResearchData()
  const plans = useMemo(() => research?.plans ?? [], [research?.plans])

  const grouped = useMemo(() => {
    const groups = new Map<string, Plan[]>()
    for (const plan of plans) {
      const key = plan.question_id
      const existing = groups.get(key)
      if (existing) {
        existing.push(plan)
      } else {
        groups.set(key, [plan])
      }
    }
    return groups
  }, [plans])

  if (plans.length === 0) {
    return (
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Plans</h2>
        <p className={styles.empty}>No plans defined yet.</p>
      </div>
    )
  }

  return (
    <div className={styles.section}>
      <h2 className={styles.sectionTitle}>Plans</h2>
      {Array.from(grouped.entries()).map(([questionId, questionPlans]) => {
        const entry = getById(questionId)
        const questionText = entry ? (entry.item as Question).question : questionId

        return (
          <div key={questionId} className={styles.group}>
            <div className={styles.groupHeader}>{questionText}</div>
            {questionPlans.map((plan) => {
              const sortedItems = [...plan.items].sort((a, b) => a.sequence - b.sequence)

              return (
                <Card
                  key={plan.id}
                  id={plan.id}
                  title={plan.id}
                  badges={<StatusBadge value={plan.status} />}
                  footer={<span>Created {plan.created}</span>}
                  rawData={plan}
                >
                  <ol className={styles.itemList}>
                    {sortedItems.map((item) => (
                      <li key={item.id} className={styles.item}>
                        <span className={styles.itemSequence}>{item.sequence}.</span>
                        <span className={styles.itemRecordType}>{item.record_type}</span>
                        <span className={styles.itemDetail}>
                          {item.jurisdiction} &middot; {item.date_range} &middot; {item.repository}
                        </span>
                        <StatusBadge value={item.status} />
                        {item.fallback_for && (
                          <span className={styles.fallbackLabel}>(fallback)</span>
                        )}
                        {item.rationale && (
                          <div className={styles.itemRationale}><Linkify text={item.rationale} /></div>
                        )}
                      </li>
                    ))}
                  </ol>
                </Card>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

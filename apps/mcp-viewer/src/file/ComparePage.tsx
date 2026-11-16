import { statusLabel } from '@genealogy/viewer-ui/status-label'
import { useMemo } from 'react'
import { Prose } from '../rules/Prose'
import { arkHref } from '../rules/rule-index'
import { compareFindings, type ComparePerson, type CompareView, type Tag } from './compare-model'
import { useFile } from './FileContext'
import { Open } from './Open'

export const TAG_WORDS: Record<Tag, string> = { already: 'Already in tree', improved: 'Improved', differs: 'Differs', new: 'New' }

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

/** "1 new relative, 3 people with new findings, 1 possible relative": each part only when above zero. */
export function countWords(counts: CompareView['counts']): string {
  return [
    counts.relatives > 0 ? plural(counts.relatives, 'new relative', 'new relatives') : null,
    counts.peopleWithNew > 0 ? plural(counts.peopleWithNew, 'person with new findings', 'people with new findings') : null,
    counts.possibleRelatives > 0 ? plural(counts.possibleRelatives, 'possible relative', 'possible relatives') : null
  ]
    .filter(Boolean)
    .join(', ')
}

/** The file's Compare, from the file's documents; null when there is nothing to compare against. */
export function useCompare(): CompareView | null {
  const { research, tree, startingTree, index } = useFile()
  return useMemo(() => compareFindings(research, tree, startingTree, index), [research, tree, startingTree, index])
}

function PersonFindings({ person }: { person: ComparePerson }) {
  const { index } = useFile()
  return (
    <section className="compare-person">
      <h3>
        <Open target={{ kind: 'person', id: person.personId }}>{person.name}</Open>
      </h3>
      {person.added && <p className="file-meta">Added by this research{person.strength ? `, ${person.strength}` : ''}</p>}
      {person.findings.length > 0 && (
        <ul className="file-list">
          {person.findings.map((finding) => (
            <li key={finding.id} className="file-item compare-row">
              <p>
                <strong>{finding.label}:</strong> <Prose text={finding.text} index={index} inline />
                <span className={`file-tag tag-${finding.tag}`}>{TAG_WORDS[finding.tag]}</span>
              </p>
              <p className="file-meta">{finding.treeValues.length > 0 ? `FamilySearch: ${finding.treeValues.join('; ')}` : 'Not on FamilySearch'}</p>
              <ul className="compare-records">
                {finding.records.length === 0 && <li className="file-meta">No record named</li>}
                {finding.records.map((record, i) => (
                  <li key={i}>
                    {record.ark ? <a href={arkHref(record.ark)}>{record.title}</a> : record.title}
                    {record.people.length > 0 && (
                      <span className="file-meta"> · {record.people.map((p) => `${p.name}, ${statusLabel(p.confidence)}`).join('; ')}</span>
                    )}
                    {record.sourceId && (
                      <>
                        {' '}
                        <Open target={{ kind: 'record', id: record.sourceId }}>Open</Open>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function ComparePage() {
  const compare = useCompare()
  if (!compare) return <p>There is no starting tree to compare with.</p>
  const counts = countWords(compare.counts)
  return (
    <article className="compare">
      <h2>Compare with FamilySearch</h2>
      <p>
        Against FamilySearch as it stood {compare.asOf ? `on ${compare.asOf}` : 'when the project started'}.
        {counts && ` ${counts.charAt(0).toUpperCase()}${counts.slice(1)}.`}
      </p>
      {compare.people.map((person) => (
        <PersonFindings key={person.personId} person={person} />
      ))}
      {compare.possibleRelatives.length > 0 && (
        <>
          <h2>Possible relatives</h2>
          {compare.possibleRelatives.map((person) => (
            <PersonFindings key={person.personId} person={person} />
          ))}
        </>
      )}
    </article>
  )
}

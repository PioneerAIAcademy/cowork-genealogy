import { recordTitle } from './prose-markdown'
import { arkHref, personHref, type PersonEntry, type RecordEntry, type RuleIndex } from './rule-index'

export interface FieldLabel {
  label: string
  href?: string
}

/** An id held in a field (`S1`, `I19`, `q_001`, `a_003`, `pe_060`) as what it names; null when it names nothing. */
export function resolveFieldId(id: unknown, index: RuleIndex): FieldLabel | null {
  if (typeof id !== 'string') return null
  let person: PersonEntry | null | undefined
  if (/^I\d+$/.test(id)) person = index.persons.get(id)
  else if (/^pe_\d+$/.test(id)) person = index.links.get(id)
  if (person !== undefined) {
    if (!person?.name) return null
    return person.pid ? { label: person.name, href: personHref(person.pid) } : { label: person.name }
  }

  let record: RecordEntry | null | undefined
  if (/^(?:S\d+|src_\d+)$/.test(id)) record = index.sources.get(id)
  else if (/^a_\d+$/.test(id)) record = index.assertions.get(id)?.record
  if (record) return { label: recordTitle(record) ?? 'this record', href: arkHref(record.ark) }

  const question = index.questions.get(id)
  return question ? { label: question } : null
}

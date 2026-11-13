import { resolveFieldId } from '../../rules/field-id'
import type { RuleIndex } from '../../rules/rule-index'

/** An id held in a field, shown as the person, record or question it names. Nothing when it names nothing. */
export function FieldName({ id, index }: { id: unknown; index: RuleIndex }) {
  const named = resolveFieldId(id, index)
  if (!named) return null
  return named.href ? <a href={named.href}>{named.label}</a> : <>{named.label}</>
}

import type { GedcomxPerson } from '../../lib/schema'
import { getPreferredName, getPrimaryFact } from '../../lib/schema'
import { openFamilySearch } from '../../lib/external'
import { resolveFamilySearchTarget } from '../../lib/familysearch-url'
import styles from './PersonCard.module.css'

interface PersonCardProps {
  person: GedcomxPerson
  relationship?: string
}

export default function PersonCard({ person, relationship }: PersonCardProps): React.JSX.Element {
  const name = getPreferredName(person)
  const birth = getPrimaryFact(person, 'Birth')
  const death = getPrimaryFact(person, 'Death')

  // `preventDefault` went with the <a>; a <button type="button"> submits nothing.
  //
  // Rendered only when the value actually resolves. `tree_edit` stores
  // `input.ark` unvalidated and `toArk` returns its input unchanged on no match,
  // so a person CAN carry a non-FamilySearch URL. Before the destination policy
  // such a value opened; now it is refused — and a button labelled "View on
  // FamilySearch" that silently does nothing is worse than no button. Opening it
  // anyway is not the alternative: that is the phishing path this closes.
  const arkTarget = person.ark ? resolveFamilySearchTarget(person.ark) : null

  return (
    <div className={styles.personCard}>
      <div className={styles.name}>{name}</div>
      {relationship && <div className={styles.relationship}>{relationship}</div>}
      <div className={styles.facts}>
        {birth && (
          <span className={styles.fact}>
            b. {birth.date ?? '?'}
            {birth.place ? `, ${birth.place}` : ''}
          </span>
        )}
        {death && (
          <span className={styles.fact}>
            d. {death.date ?? '?'}
            {death.place ? `, ${death.place}` : ''}
          </span>
        )}
        {!birth && !death && <span className={styles.fact}>No facts recorded</span>}
      </div>
      <div className={styles.meta}>
        {person.gender} · {person.facts?.length ?? 0} facts
        {arkTarget && (
          <>
            {' · '}
            {/* A <button>, not an <a href>. The hole is MIDDLE-click, which fires
                `auxclick` — not `click` — so an onClick handler never runs and the
                href is followed unchecked. (Ctrl+click does fire `click`, and the
                handler's preventDefault stops it; an earlier version of this
                comment claimed otherwise.) It only bites when `ark` holds an
                https:// value, which is the poisoned case and what the fixtures
                contain. `title` keeps the hover disclosure. */}
            <button
              type="button"
              onClick={() => openFamilySearch(person.ark)}
              className={styles.ark}
              title={person.ark}
            >
              View on FamilySearch
            </button>
          </>
        )}
      </div>
    </div>
  )
}

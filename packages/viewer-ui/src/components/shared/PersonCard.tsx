import type { GedcomxPerson } from '../../lib/schema'
import { getPreferredName, getPrimaryFact } from '../../lib/schema'
import { openFamilySearch } from '../../lib/external'
import styles from './PersonCard.module.css'

interface PersonCardProps {
  person: GedcomxPerson
  relationship?: string
}

export default function PersonCard({ person, relationship }: PersonCardProps): React.JSX.Element {
  const name = getPreferredName(person)
  const birth = getPrimaryFact(person, 'Birth')
  const death = getPrimaryFact(person, 'Death')

  const handleArkClick = (e: React.MouseEvent<HTMLButtonElement>): void => {
    e.preventDefault()
    openFamilySearch(person.ark)
  }

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
        {person.ark && (
          <>
            {' · '}
            {/* A <button>, not an <a href>: a raw href is followed by
                ctrl/middle-click WITHOUT the handler, bypassing the destination
                policy. That only bites when `ark` holds an https:// value — which
                is exactly the poisoned case this constrains, and what the shipped
                fixtures contain. `title` keeps the hover disclosure. */}
            <button
              type="button"
              onClick={handleArkClick}
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

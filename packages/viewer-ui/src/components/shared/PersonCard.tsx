import type { GedcomxPerson } from '../../lib/schema'
import { getPreferredName, getPrimaryFact } from '../../lib/schema'
import { openExternal } from '../../lib/external'
import { familySearchUrl } from '../../lib/ark'
import styles from './PersonCard.module.css'

interface PersonCardProps {
  person: GedcomxPerson
  relationship?: string
}

export default function PersonCard({ person, relationship }: PersonCardProps): React.JSX.Element {
  const name = getPreferredName(person)
  const birth = getPrimaryFact(person, 'Birth')
  const death = getPrimaryFact(person, 'Death')
  const arkUrl = person.ark ? familySearchUrl(person.ark) : undefined

  const handleArkClick = (e: React.MouseEvent<HTMLAnchorElement>): void => {
    e.preventDefault()
    openExternal(arkUrl)
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
        {arkUrl && (
          <>
            {' · '}
            <a href={arkUrl} onClick={handleArkClick} className={styles.ark} title={arkUrl}>
              View on FamilySearch
            </a>
          </>
        )}
      </div>
    </div>
  )
}

import { useMemo } from 'react'
import { useResearchData } from '../../contexts/ResearchDataContext'
import StatusBadge from '../shared/StatusBadge'
import PersonCard from '../shared/PersonCard'
import Linkify from '../shared/Linkify'
import type { GedcomxPerson, GedcomxRelationship, ResearcherProfile } from '../../lib/schema'
import { getPreferredName } from '../../lib/schema'
import { parentChildLabel, describeRelationship } from '../../lib/relationship-label'
import styles from './ProjectOverview.module.css'

function deriveRelationship(
  personId: string,
  subjectIds: string[],
  relationships: GedcomxRelationship[],
  persons: GedcomxPerson[]
): string | undefined {
  for (const rel of relationships) {
    if (rel.type === 'ParentChild') {
      if (rel.child === personId && subjectIds.includes(rel.parent)) {
        const parent = persons.find((p) => p.id === rel.parent)
        return parentChildLabel(rel, parent ? getPreferredName(parent) : 'subject', 'child')
      }
      if (rel.parent === personId && subjectIds.includes(rel.child)) {
        const child = persons.find((p) => p.id === rel.child)
        return parentChildLabel(rel, child ? getPreferredName(child) : 'subject', 'parent')
      }
      if (subjectIds.includes(rel.parent) && rel.child === personId) {
        return parentChildLabel(rel, '', 'child').replace(' of ', '')
      }
      if (subjectIds.includes(rel.child) && rel.parent === personId) {
        return parentChildLabel(rel, '', 'parent').replace(' of ', '')
      }
    }
    if (rel.type === 'Couple') {
      if (rel.person1 === personId && subjectIds.includes(rel.person2)) {
        return 'Spouse'
      }
      if (rel.person2 === personId && subjectIds.includes(rel.person1)) {
        return 'Spouse'
      }
    }
  }
  return undefined
}

function ResearcherProfileBlock({ profile }: { profile: ResearcherProfile }): React.JSX.Element {
  const subs = profile.subscriptions?.filter((s) => s !== 'none') ?? []
  return (
    <div className={styles.profileBox}>
      <div className={styles.profileRow}>
        {profile.experience_level && (
          <span className={styles.profileBadge}>{profile.experience_level}</span>
        )}
        {subs.length > 0 && <span className={styles.profileSubs}>{subs.join(', ')}</span>}
        {subs.length === 0 && (
          <span className={styles.profileSubsEmpty}>No paid subscriptions</span>
        )}
      </div>
      {profile.narration_guidance && (
        <div className={styles.profileGuidance}><Linkify text={profile.narration_guidance} /></div>
      )}
    </div>
  )
}

interface NotedRelationship {
  id: string
  description: string
  notes: string[]
}

export default function ProjectOverview(): React.JSX.Element {
  const { research, gedcomx } = useResearchData()
  const project = research?.project
  const profile = research?.researcher_profile

  const { subjectPersons, otherPersons, notedRelationships } = useMemo(() => {
    if (!gedcomx)
      return {
        subjectPersons: [] as GedcomxPerson[],
        otherPersons: [] as { person: GedcomxPerson; relationship?: string }[],
        notedRelationships: [] as NotedRelationship[]
      }

    const subjectIds = project?.subject_person_ids ?? []
    const subjects = subjectIds
      .map((id) => gedcomx.persons.find((p) => p.id === id))
      .filter((p): p is GedcomxPerson => !!p)

    const others = gedcomx.persons
      .filter((p) => !subjectIds.includes(p.id))
      .map((p) => ({
        person: p,
        relationship: deriveRelationship(p.id, subjectIds, gedcomx.relationships, gedcomx.persons)
      }))

    const noted: NotedRelationship[] = gedcomx.relationships
      .filter((r) => Array.isArray(r.notes) && r.notes.length > 0)
      .map((r) => ({
        id: r.id,
        description: describeRelationship(r, gedcomx.persons),
        notes: r.notes as string[]
      }))

    return { subjectPersons: subjects, otherPersons: others, notedRelationships: noted }
  }, [gedcomx, project])

  if (!project) {
    return (
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Project Overview</h2>
        <p className={styles.notIdentified}>No project data loaded.</p>
      </div>
    )
  }

  return (
    <div className={styles.section}>
      <h2 className={styles.sectionTitle}>Project Overview</h2>

      <p className={styles.objective}><Linkify text={project.objective} /></p>

      <div className={styles.meta}>
        <StatusBadge value={project.status} />
        <span>Created {project.created}</span>
        <span>Updated {project.updated}</span>
      </div>

      {profile && (
        <>
          <h3 className={styles.subHeading}>Researcher Profile</h3>
          <ResearcherProfileBlock profile={profile} />
        </>
      )}

      <h3 className={styles.subHeading}>Subject Persons</h3>
      {project.subject_person_ids === null || project.subject_person_ids.length === 0 ? (
        <p className={styles.notIdentified}>Subject not yet identified</p>
      ) : (
        <div className={styles.personsGrid}>
          {subjectPersons.map((person) => (
            <PersonCard key={person.id} person={person} />
          ))}
        </div>
      )}

      {otherPersons.length > 0 && (
        <>
          <h3 className={styles.subHeading}>Other Persons</h3>
          <div className={styles.personsGrid}>
            {otherPersons.map(({ person, relationship }) => (
              <PersonCard key={person.id} person={person} relationship={relationship} />
            ))}
          </div>
        </>
      )}

      {notedRelationships.length > 0 && (
        <>
          <h3 className={styles.subHeading}>Relationship Notes</h3>
          <ul className={styles.relNotesList}>
            {notedRelationships.map((rel) => (
              <li key={rel.id} className={styles.relNoteItem}>
                <div className={styles.relNoteHeader}>{rel.description}</div>
                <ul className={styles.relNoteBullets}>
                  {rel.notes.map((note, idx) => (
                    <li key={idx}><Linkify text={note} /></li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

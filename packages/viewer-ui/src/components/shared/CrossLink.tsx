import { useResearchData } from '../../contexts/ResearchDataContext'
import styles from './CrossLink.module.css'

interface CrossLinkProps {
  id: string
  label?: string
}

const sectionNavMap: Record<string, string> = {
  questions: 'questions',
  plans: 'plans',
  plan_items: 'plans',
  log: 'log',
  sources: 'sources',
  assertions: 'assertions',
  person_evidence: 'person_evidence',
  conflicts: 'conflicts',
  hypotheses: 'hypotheses',
  timelines: 'timelines',
  proof_summaries: 'proof_summaries',
  project: 'project_overview',
  gedcomx_persons: 'project_overview',
  gedcomx_relationships: 'project_overview',
  gedcomx_sources: 'sources'
}

export default function CrossLink({ id, label }: CrossLinkProps): React.JSX.Element {
  const { getById, setActiveSection } = useResearchData()

  const handleClick = (): void => {
    const entry = getById(id)
    if (entry) {
      const navSection = sectionNavMap[entry.section]
      if (navSection) {
        setActiveSection(navSection)
      }
      // Allow React to re-render the section, then scroll to the element
      requestAnimationFrame(() => {
        document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      })
    }
  }

  return (
    <button className={styles.crossLink} onClick={handleClick} title={`Go to ${id}`}>
      {label ?? id}
    </button>
  )
}

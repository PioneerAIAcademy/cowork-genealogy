import { useState, useCallback } from 'react'
import { useResearchData } from '../../contexts/ResearchDataContext'
import { treeOnlySources } from '../../lib/tree-sources'
import { countCollectionRows } from '../../lib/externalCollections'
import styles from './Sidebar.module.css'

interface SectionItem {
  key: string
  label: string
  countFn: () => number
}

// The order sections appear in, shared with PrintView so the printout reads in
// the same order as the sidebar.
export const SECTION_ORDER: readonly { key: string; label: string }[] = [
  { key: 'project_overview', label: 'Project Overview' },
  { key: 'questions', label: 'Questions' },
  { key: 'localities', label: 'Localities' },
  { key: 'external_collections', label: 'Collections' },
  { key: 'plans', label: 'Plans' },
  { key: 'log', label: 'Research Log' },
  { key: 'sources', label: 'Sources' },
  { key: 'assertions', label: 'Assertions' },
  { key: 'person_evidence', label: 'Person Evidence' },
  { key: 'namesakes', label: 'Namesakes' },
  { key: 'conflicts', label: 'Conflicts' },
  { key: 'hypotheses', label: 'Hypotheses' },
  { key: 'timelines', label: 'Timelines' },
  { key: 'proof_summaries', label: 'Findings' },
  { key: 'evaluations', label: 'Mentor Evaluations' }
]

function readStoredTheme(): string | null {
  try {
    return localStorage.getItem('theme')
  } catch {
    // Storage can throw outright — a private window with site data blocked.
    return null
  }
}

function getInitialTheme(): string {
  const stored = readStoredTheme() || 'light'
  if (document.documentElement.dataset.theme == null) {
    document.documentElement.dataset.theme = stored
  }
  return stored
}

export default function Sidebar({
  showThemeToggle = true
}: {
  showThemeToggle?: boolean
} = {}): React.JSX.Element {
  const {
    research,
    gedcomx,
    collections,
    folderPath,
    activeSection,
    setActiveSection,
    devMode,
    setDevMode,
    lastUpdated
  } = useResearchData()
  const [theme, setTheme] = useState(getInitialTheme)

  const toggleTheme = useCallback(() => {
    const next = theme === 'dark' ? 'light' : 'dark'
    document.documentElement.dataset.theme = next
    try {
      localStorage.setItem('theme', next)
    } catch {
      // Not fatal: the theme still applies for this session, just isn't remembered.
    }
    setTheme(next)
  }, [theme])

  const counts: Record<string, () => number> = {
    project_overview: () => (research?.project ? 1 : 0),
    questions: () => research?.questions?.length ?? 0,
    localities: () => research?.localities?.length ?? 0,
    external_collections: () => countCollectionRows(collections),
    plans: () => research?.plans?.length ?? 0,
    log: () => research?.log?.length ?? 0,
    sources: () => (research?.sources?.length ?? 0) + treeOnlySources(research, gedcomx).length,
    assertions: () => research?.assertions?.length ?? 0,
    person_evidence: () => research?.person_evidence?.length ?? 0,
    namesakes: () => research?.namesakes?.length ?? 0,
    conflicts: () => research?.conflicts?.length ?? 0,
    hypotheses: () => research?.hypotheses?.length ?? 0,
    timelines: () => research?.timelines?.length ?? 0,
    proof_summaries: () => research?.proof_summaries?.length ?? 0,
    evaluations: () => research?.evaluations?.length ?? 0
  }
  const sections: SectionItem[] = SECTION_ORDER.map((s) => ({
    ...s,
    countFn: counts[s.key] ?? (() => 0)
  }))

  return (
    <nav className={styles.sidebar}>
      <div className={styles.sectionGroup}>
        <div className={styles.groupLabel}>Research</div>
        {sections.map((section) => {
          const count = section.countFn()
          return (
            <button
              key={section.key}
              className={`${styles.sectionLink} ${activeSection === section.key ? styles.active : ''}`}
              onClick={() => setActiveSection(section.key)}
            >
              <span className={styles.label}>{section.label}</span>
              {count > 0 && <span className={styles.count}>{count}</span>}
            </button>
          )
        })}
      </div>
      <div className={styles.footer}>
        {lastUpdated && (
          <span className={styles.timestamp}>Updated {lastUpdated.toLocaleTimeString()}</span>
        )}
        <div className={styles.footerControls}>
          <button
            className={`${styles.footerToggle} ${devMode ? styles.active : ''}`}
            onClick={() => setDevMode(!devMode)}
            title="Toggle developer mode"
          >
            {'</>'}
          </button>
          {showThemeToggle && (
            <button
              className={styles.footerToggle}
              onClick={toggleTheme}
              title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            >
              {theme === 'dark' ? '☀' : '☽'}
            </button>
          )}
        </div>
        <div className={styles.watchStatus}>
          {folderPath ? (
            <span className={styles.watching} title={folderPath}>
              Watching
            </span>
          ) : (
            <span className={styles.notWatching}>No folder selected</span>
          )}
        </div>
      </div>
    </nav>
  )
}

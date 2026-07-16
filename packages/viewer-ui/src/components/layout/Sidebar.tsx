import { useState, useCallback } from 'react'
import { useResearchData } from '../../contexts/ResearchDataContext'
import styles from './Sidebar.module.css'

interface SectionItem {
  key: string
  label: string
  countFn: () => number
}

function getInitialTheme(): string {
  const stored = localStorage.getItem('theme') || 'light'
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
    localStorage.setItem('theme', next)
    setTheme(next)
  }, [theme])

  const sections: SectionItem[] = [
    {
      key: 'project_overview',
      label: 'Project Overview',
      countFn: () => (research?.project ? 1 : 0)
    },
    {
      key: 'known_holdings',
      label: 'Known Information',
      countFn: () => research?.known_holdings?.length ?? 0
    },
    { key: 'questions', label: 'Questions', countFn: () => research?.questions.length ?? 0 },
    { key: 'plans', label: 'Plans', countFn: () => research?.plans.length ?? 0 },
    { key: 'localities', label: 'Localities', countFn: () => research?.localities?.length ?? 0 },
    { key: 'log', label: 'Research Log', countFn: () => research?.log.length ?? 0 },
    { key: 'sources', label: 'Sources', countFn: () => research?.sources.length ?? 0 },
    { key: 'assertions', label: 'Assertions', countFn: () => research?.assertions.length ?? 0 },
    {
      key: 'person_evidence',
      label: 'Person Evidence',
      countFn: () => research?.person_evidence.length ?? 0
    },
    { key: 'conflicts', label: 'Conflicts', countFn: () => research?.conflicts.length ?? 0 },
    { key: 'hypotheses', label: 'Hypotheses', countFn: () => research?.hypotheses.length ?? 0 },
    { key: 'timelines', label: 'Timelines', countFn: () => research?.timelines.length ?? 0 },
    {
      key: 'proof_summaries',
      label: 'Proof Summaries',
      countFn: () => research?.proof_summaries.length ?? 0
    }
  ]

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

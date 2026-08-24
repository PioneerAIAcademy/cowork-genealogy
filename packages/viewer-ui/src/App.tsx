import { useEffect } from 'react'
import type { ResearchTransport } from './transport'
import { useResearchData } from './contexts/ResearchDataContext'
import { ResearchDataProvider } from './contexts/ResearchDataProvider'
import Header from './components/layout/Header'
import Sidebar from './components/layout/Sidebar'
import ProgressPipeline from './components/layout/ProgressPipeline'
import ProjectOverview from './components/sections/ProjectOverview'
import KnownInformationSection from './components/sections/KnownInformationSection'
import QuestionsSection from './components/sections/QuestionsSection'
import PlansSection from './components/sections/PlansSection'
import LocalitiesSection from './components/sections/LocalitiesSection'
import ResearchLogSection from './components/sections/ResearchLogSection'
import SourcesSection from './components/sections/SourcesSection'
import AssertionsSection from './components/sections/AssertionsSection'
import PersonEvidenceSection from './components/sections/PersonEvidenceSection'
import ConflictsSection from './components/sections/ConflictsSection'
import HypothesesSection from './components/sections/HypothesesSection'
import TimelinesSection from './components/sections/TimelinesSection'
import ProofSummariesSection from './components/sections/ProofSummariesSection'
import EvaluationsSection from './components/sections/EvaluationsSection'
import SidecarPanel from './components/shared/SidecarPanel'
import ErrorBoundary from './components/ErrorBoundary'
import styles from './App.module.css'

const sectionComponents: Record<string, React.ComponentType> = {
  project_overview: ProjectOverview,
  known_holdings: KnownInformationSection,
  questions: QuestionsSection,
  plans: PlansSection,
  localities: LocalitiesSection,
  log: ResearchLogSection,
  sources: SourcesSection,
  assertions: AssertionsSection,
  person_evidence: PersonEvidenceSection,
  conflicts: ConflictsSection,
  hypotheses: HypothesesSection,
  timelines: TimelinesSection,
  proof_summaries: ProofSummariesSection,
  evaluations: EvaluationsSection
}

function WelcomeScreen(): React.JSX.Element {
  const { selectFolder } = useResearchData()

  return (
    <div className={styles.welcome}>
      <div className={styles.welcomeContent}>
        <div className={styles.welcomeOrnament}>Pioneer Academy</div>
        <h1 className={styles.welcomeTitle}>Research Viewer</h1>
        <p className={styles.welcomeDesc}>
          Watch your AI genealogy research assistant work in real time. Evidence gathered,
          hypotheses tested, proof summaries written.
        </p>
        <div className={styles.welcomeDivider}>&#9830;</div>
        <button className={styles.welcomeButton} onClick={selectFolder}>
          Open Project Folder
        </button>
        <p className={styles.welcomeHint}>
          Select a folder containing research.json and tree.gedcomx.json
        </p>
      </div>
    </div>
  )
}

export function WaitingScreen({
  folderPath,
  canSelectFolder
}: {
  folderPath: string | null
  canSelectFolder: boolean
}): React.JSX.Element {
  // The folder-specific copy only makes sense where the viewer watches a real
  // folder the user can open — i.e. Electron, where `selectFolder` exists and
  // `folderPath` is a filesystem path. On the web client there is no folder
  // picker and `folderPath` is the session title, not a path, so naming it as a
  // watched folder and telling the user to "open that folder" both misinform
  // (issue #1317 review). Gate on the capability, not on folderPath being set.
  return (
    <div className={styles.welcome}>
      <div className={styles.welcomeContent}>
        {canSelectFolder ? (
          <>
            <p className={styles.waitingText}>No research data in this folder yet</p>
            {folderPath && (
              <p className={styles.welcomeHint}>
                Watching <code>{folderPath}</code>
              </p>
            )}
            <p className={styles.welcomeHint}>
              The viewer updates automatically when <code>research.json</code> appears here. If your
              research is somewhere else, open that folder instead.
            </p>
          </>
        ) : (
          <>
            <p className={styles.waitingText}>No research data yet</p>
            <p className={styles.welcomeHint}>
              The viewer updates automatically when the agent saves{' '}
              <code>research.json</code> for this session.
            </p>
          </>
        )}
      </div>
    </div>
  )
}

// A dismissible heads-up bar (e.g. "research.json is in a subfolder — you may
// be viewing the wrong folder level", issue #1317 bug 2). Reads `notice` from
// context, so it renders identically whether or not research is loaded — the
// reported case has a non-empty top-level research.json, so a WaitingScreen-only
// surface would never show it. A research load does NOT clear `notice`.
export function FolderNotice(): React.JSX.Element | null {
  const { notice, clearNotice } = useResearchData()
  if (!notice) return null
  return (
    <div
      role="status"
      style={{
        display: 'flex',
        gap: '0.75rem',
        alignItems: 'flex-start',
        padding: '0.6rem 1rem',
        background: '#8a6d1f',
        color: '#fff',
        fontSize: '0.85rem',
        lineHeight: 1.4
      }}
    >
      <span style={{ flex: 1 }}>{notice}</span>
      <button
        onClick={clearNotice}
        aria-label="Dismiss"
        style={{
          background: 'transparent',
          border: 'none',
          color: '#fff',
          cursor: 'pointer',
          fontSize: '1rem',
          lineHeight: 1
        }}
      >
        &times;
      </button>
    </div>
  )
}

// A dismissible error bar. `error` has existed on the context since the viewer
// was extracted and was rendered by nothing, so every failure routed into it was
// silent — including `selectFolder`'s rejection, which is the only feedback a
// user gets when the folder they picked is not a research project (#1722
// round-7). Mounted in all three AppContent branches; the WelcomeScreen one is
// load-bearing, because a rejected pick never sets folderPath and so leaves the
// user exactly there.
export function ErrorNotice(): React.JSX.Element | null {
  const { error, clearError } = useResearchData()
  if (!error) return null
  return (
    <div
      role="alert"
      style={{
        display: 'flex',
        gap: '0.75rem',
        alignItems: 'flex-start',
        padding: '0.6rem 1rem',
        background: '#8a2f1f',
        color: '#fff',
        fontSize: '0.85rem',
        lineHeight: 1.4
      }}
    >
      <span style={{ flex: 1 }}>{error}</span>
      <button
        onClick={clearError}
        aria-label="Dismiss"
        style={{
          background: 'transparent',
          border: 'none',
          color: '#fff',
          cursor: 'pointer',
          fontSize: '1rem',
          lineHeight: 1
        }}
      >
        &times;
      </button>
    </div>
  )
}

function AppContent({
  showThemeToggle,
  onProjectTitle
}: {
  showThemeToggle: boolean
  onProjectTitle?: (title: string | null) => void
}): React.JSX.Element {
  const { research, folderPath, canSelectFolder, activeSection } = useResearchData()

  // Relay the agent-written project.title up to the host shell, which patches it
  // to the control plane (live session naming). Hook runs before the early
  // returns below to satisfy the rules of hooks.
  const projectTitle = research?.project?.title ?? null
  useEffect(() => {
    onProjectTitle?.(projectTitle)
  }, [projectTitle, onProjectTitle])

  if (!folderPath) {
    return (
      <>
        <ErrorNotice />
        <WelcomeScreen />
      </>
    )
  }

  if (!research) {
    return (
      <div className={styles.layout}>
        <Sidebar showThemeToggle={showThemeToggle} />
        <div className={styles.main}>
          <Header />
          <ErrorNotice />
          <FolderNotice />
          <WaitingScreen folderPath={folderPath} canSelectFolder={canSelectFolder} />
        </div>
      </div>
    )
  }

  const ActiveSection = sectionComponents[activeSection] || ProjectOverview

  return (
    <div className={styles.layout}>
      <Sidebar showThemeToggle={showThemeToggle} />
      <div className={styles.main}>
        <Header />
        <ErrorNotice />
        <FolderNotice />
        <ProgressPipeline />
        <div className={styles.content}>
          <ErrorBoundary resetKey={activeSection} label={`the ${activeSection} section`}>
            <ActiveSection />
          </ErrorBoundary>
        </div>
      </div>
      <SidecarPanel />
    </div>
  )
}

export default function App({
  transport,
  // Whether the viewer renders its own theme toggle (Sidebar footer). The web
  // shell sets this false because it provides one in its chat header; Electron
  // omits it (defaults true) since the viewer's is the only one.
  showThemeToggle = true,
  // Called with the agent-written project.title (or null) whenever research
  // changes — the web shell uses it to name the session in the control plane.
  // Electron omits it (it has no session-list concept).
  onProjectTitle
}: {
  transport: ResearchTransport
  showThemeToggle?: boolean
  onProjectTitle?: (title: string | null) => void
}): React.JSX.Element {
  return (
    <ResearchDataProvider transport={transport}>
      <AppContent showThemeToggle={showThemeToggle} onProjectTitle={onProjectTitle} />
    </ResearchDataProvider>
  )
}

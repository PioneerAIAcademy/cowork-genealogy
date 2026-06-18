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
import ResearchLogSection from './components/sections/ResearchLogSection'
import SourcesSection from './components/sections/SourcesSection'
import AssertionsSection from './components/sections/AssertionsSection'
import PersonEvidenceSection from './components/sections/PersonEvidenceSection'
import ConflictsSection from './components/sections/ConflictsSection'
import HypothesesSection from './components/sections/HypothesesSection'
import TimelinesSection from './components/sections/TimelinesSection'
import ProofSummariesSection from './components/sections/ProofSummariesSection'
import SidecarPanel from './components/shared/SidecarPanel'
import styles from './App.module.css'

const sectionComponents: Record<string, React.ComponentType> = {
  project_overview: ProjectOverview,
  known_holdings: KnownInformationSection,
  questions: QuestionsSection,
  plans: PlansSection,
  log: ResearchLogSection,
  sources: SourcesSection,
  assertions: AssertionsSection,
  person_evidence: PersonEvidenceSection,
  conflicts: ConflictsSection,
  hypotheses: HypothesesSection,
  timelines: TimelinesSection,
  proof_summaries: ProofSummariesSection
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

function WaitingScreen(): React.JSX.Element {
  return (
    <div className={styles.welcome}>
      <div className={styles.welcomeContent}>
        <p className={styles.waitingText}>Waiting for research to begin...</p>
        <p className={styles.welcomeHint}>
          The viewer will update automatically when research.json is created
        </p>
      </div>
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
  const { research, folderPath, activeSection } = useResearchData()

  // Relay the agent-written project.title up to the host shell, which patches it
  // to the control plane (live session naming). Hook runs before the early
  // returns below to satisfy the rules of hooks.
  const projectTitle = research?.project?.title ?? null
  useEffect(() => {
    onProjectTitle?.(projectTitle)
  }, [projectTitle, onProjectTitle])

  if (!folderPath) {
    return <WelcomeScreen />
  }

  if (!research) {
    return (
      <div className={styles.layout}>
        <Sidebar showThemeToggle={showThemeToggle} />
        <div className={styles.main}>
          <Header />
          <WaitingScreen />
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
        <ProgressPipeline />
        <div className={styles.content}>
          <ActiveSection />
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

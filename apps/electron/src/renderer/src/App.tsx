import { useResearchData } from './contexts/ResearchDataContext'
import { ResearchDataProvider } from './contexts/ResearchDataProvider'
import Header from './components/layout/Header'
import Sidebar from './components/layout/Sidebar'
import ProgressPipeline from './components/layout/ProgressPipeline'
import ProjectOverview from './components/sections/ProjectOverview'
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

function AppContent(): React.JSX.Element {
  const { research, folderPath, activeSection } = useResearchData()

  if (!folderPath) {
    return <WelcomeScreen />
  }

  if (!research) {
    return (
      <div className={styles.layout}>
        <Sidebar />
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
      <Sidebar />
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

export default function App(): React.JSX.Element {
  return (
    <ResearchDataProvider>
      <AppContent />
    </ResearchDataProvider>
  )
}

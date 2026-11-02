import ProjectOverview from './components/sections/ProjectOverview'
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
import NamesakesSection from './components/sections/NamesakesSection'
import CollectionsSection from './components/sections/CollectionsSection'

// Its own module, not App.tsx, because PrintView (mounted by Header, which App
// imports) needs it too: reading it from App would be an import cycle.
export const sectionComponents: Record<string, React.ComponentType> = {
  project_overview: ProjectOverview,
  questions: QuestionsSection,
  plans: PlansSection,
  localities: LocalitiesSection,
  external_collections: CollectionsSection,
  log: ResearchLogSection,
  sources: SourcesSection,
  assertions: AssertionsSection,
  person_evidence: PersonEvidenceSection,
  namesakes: NamesakesSection,
  conflicts: ConflictsSection,
  hypotheses: HypothesesSection,
  timelines: TimelinesSection,
  proof_summaries: ProofSummariesSection,
  evaluations: EvaluationsSection
}

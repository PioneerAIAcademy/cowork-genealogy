import type { ResearchData } from './schema'

export type StageStatus = 'completed' | 'active' | 'pending'

export interface StageInfo {
  name: string
  label: string
  status: StageStatus
  /** Rail section this stage's artifacts live in — the click target in the
   *  ProgressPipeline. `analysis` spans three sections; we default to conflicts. */
  section: string
}

const stages = [
  { name: 'init', label: 'Init', section: 'project_overview' },
  { name: 'question_selection', label: 'Question Selection', section: 'questions' },
  { name: 'research_plan', label: 'Research Plan', section: 'plans' },
  { name: 'search_records', label: 'Search Records', section: 'log' },
  { name: 'extraction', label: 'Extraction', section: 'assertions' },
  { name: 'analysis', label: 'Analysis', section: 'conflicts' },
  { name: 'proof_summary', label: 'Proof Summary', section: 'proof_summaries' }
] as const

/** A stage counts as reached only when its section is a non-empty ARRAY.
 *  ProgressPipeline renders above the section ErrorBoundary, so a partial or
 *  half-written research.json reaching `.length` on an absent or not-yet-array
 *  section would blank the whole viewer with nothing to catch it (#1317). */
function has(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0
}

function isStageCompleted(name: string, data: ResearchData): boolean {
  switch (name) {
    case 'init':
      return data.project != null
    case 'question_selection':
      return has(data.questions)
    case 'research_plan':
      return has(data.plans)
    case 'search_records':
      return has(data.log)
    case 'extraction':
      return has(data.assertions)
    case 'analysis':
      return (
        has(data.conflicts) || has(data.hypotheses) || has(data.person_evidence)
      )
    case 'proof_summary':
      return has(data.proof_summaries)
    default:
      return false
  }
}

export function inferProgress(data: ResearchData): StageInfo[] {
  const result: StageInfo[] = []
  let allPriorComplete = true

  for (const stage of stages) {
    const completed = isStageCompleted(stage.name, data)

    let status: StageStatus
    if (completed) {
      status = 'completed'
    } else if (allPriorComplete) {
      status = 'active'
    } else {
      status = 'pending'
    }

    result.push({ name: stage.name, label: stage.label, status, section: stage.section })

    if (!completed) {
      allPriorComplete = false
    }
  }

  return result
}

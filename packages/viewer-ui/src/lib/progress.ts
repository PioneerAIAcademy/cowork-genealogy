import type { ResearchData } from './schema'

export type StageStatus = 'completed' | 'active' | 'pending'

export interface StageInfo {
  name: string
  label: string
  status: StageStatus
}

const stages = [
  { name: 'init', label: 'Init' },
  { name: 'question_selection', label: 'Question Selection' },
  { name: 'research_plan', label: 'Research Plan' },
  { name: 'search_records', label: 'Search Records' },
  { name: 'extraction', label: 'Extraction' },
  { name: 'analysis', label: 'Analysis' },
  { name: 'proof_summary', label: 'Proof Summary' }
] as const

function isStageCompleted(name: string, data: ResearchData): boolean {
  switch (name) {
    case 'init':
      return data.project != null
    case 'question_selection':
      return data.questions.length > 0
    case 'research_plan':
      return data.plans.length > 0
    case 'search_records':
      return data.log.length > 0
    case 'extraction':
      return data.assertions.length > 0
    case 'analysis':
      return (
        data.conflicts.length > 0 || data.hypotheses.length > 0 || data.person_evidence.length > 0
      )
    case 'proof_summary':
      return data.proof_summaries.length > 0
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

    result.push({ name: stage.name, label: stage.label, status })

    if (!completed) {
      allPriorComplete = false
    }
  }

  return result
}

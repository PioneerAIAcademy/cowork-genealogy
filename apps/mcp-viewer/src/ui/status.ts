import type { ProjectDocument } from '../contract'
import type { SessionState } from '../session'

export function projectName(document: ProjectDocument): string {
  const title = document.research?.project?.title
  if (typeof title === 'string' && title.trim()) return title
  return document.derived?.folderName ?? 'Untitled project'
}

export function headline(state: SessionState): string {
  if (state.connection === 'unreachable') return 'This page cannot reach its host.'
  const { load } = state
  switch (load.phase) {
    case 'waiting':
      return 'Waiting for the tool call.'
    case 'fetching':
      return 'Loading the project.'
    case 'ready':
      return load.snapshot ? projectName(load.snapshot) : 'Loading the project.'
    case 'failed':
      return load.message ?? 'The project could not be loaded.'
    case 'stopped':
      return 'The call was stopped.'
  }
}

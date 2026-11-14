import type { ProjectDocument } from '../contract'

/** Electron's LOG_ID_PATTERN. */
const LOG_ID_PATTERN = /^log_[a-zA-Z0-9_-]+$/

export interface TransportDeps {
  /** `read_project_view` with the card's project already in the arguments. */
  read(args: Record<string, unknown>): Promise<unknown>
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

/** A label for the open project: its title, else its objective, else its folder; never blank. */
export function projectLabel(document: ProjectDocument | null): string {
  const project = document?.research?.project
  return text(project?.title) ?? text(project?.objective) ?? text(document?.derived?.folderName) ?? 'This project'
}

/** What the case file reads beyond the document itself: a search's results, the record search that
 *  found a record, and a page image's signed link. Each read carries the card's project. */
export class McpAppResearchTransport {
  constructor(private readonly deps: TransportDeps) {}

  /** One results file; null when it was not kept, or for an id that is no log id. A failed read rejects. */
  async readSidecar(logId: string): Promise<{ raw: string; mtime: number } | null> {
    if (!LOG_ID_PATTERN.test(logId)) return null
    const answer = (await this.deps.read({ part: 'results', id: logId })) as { found?: unknown; results?: unknown } | null
    if (!answer || answer.found !== true) return null
    return { raw: JSON.stringify(answer.results), mtime: 0 }
  }

  /** The record search whose kept results hold this record, or null. */
  async recordSearch(recordId: string): Promise<string | null> {
    const answer = (await this.deps.read({ part: 'recordSearch', id: recordId })) as { found?: unknown; logId?: unknown } | null
    return answer?.found === true && typeof answer.logId === 'string' ? answer.logId : null
  }

  /** A fresh signed link to one saved page image. */
  getSourceImage = async (filename: string): Promise<string | null> => {
    const link = (await this.deps.read({ part: 'image', id: filename })) as { url?: unknown } | null
    return typeof link?.url === 'string' ? link.url : null
  }
}

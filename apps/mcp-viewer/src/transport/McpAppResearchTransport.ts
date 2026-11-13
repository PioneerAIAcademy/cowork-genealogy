import type { GedcomxData, ResearchData } from '@genealogy/schema'
import {
  resolveFamilySearchTarget,
  type ExternalCollectionsData,
  type FeedbackResult,
  type ProjectStateSnapshot,
  type ResearchTransport,
  type SidecarRead,
  type SubscriptionHandlers
} from '@genealogy/viewer-ui'
import type { ProjectDocument } from '../contract'
import { httpsUrl } from '../rules/links'

/** Electron's LOG_ID_PATTERN. */
const LOG_ID_PATTERN = /^log_[a-zA-Z0-9_-]+$/

export interface TransportDeps {
  /** `read_project_view` with the card's project already in the arguments. */
  read(args: Record<string, unknown>): Promise<unknown>
  openLink(url: string): unknown
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

/** A label for the open project; never null or blank, which would show the welcome screen. */
export function projectLabel(document: ProjectDocument | null): string {
  const project = document?.research?.project
  return text(project?.title) ?? text(project?.objective) ?? text(document?.derived?.folderName) ?? 'This project'
}

/** The case file's view of the project: today's documents, results and page images, read through the card's host. */
export class McpAppResearchTransport implements ResearchTransport {
  private document: ProjectDocument | null = null
  private readonly handlers = new Set<SubscriptionHandlers>()

  constructor(private readonly deps: TransportDeps) {}

  /** A newer document: the next `getProjectState` returns it, and every subscriber hears it. */
  update(document: ProjectDocument): void {
    this.document = document
    for (const handlers of this.handlers) {
      if (document.research) handlers.onResearch(document.research as ResearchData)
      if (document.tree) handlers.onGedcomx(document.tree as GedcomxData)
      handlers.onCollections((document.collections as ExternalCollectionsData | null | undefined) ?? null)
    }
  }

  async getProjectState(): Promise<ProjectStateSnapshot> {
    // Read at resolution, not at the call, and push again if a newer document lands
    // before the caller has applied this one: the newest must win either way.
    await Promise.resolve()
    const document = this.document
    setTimeout(() => {
      if (this.document && this.document !== document) this.update(this.document)
    }, 0)
    return {
      research: (document?.research as ResearchData | undefined) ?? null,
      gedcomx: (document?.tree as GedcomxData | undefined) ?? null,
      collections: (document?.collections as ExternalCollectionsData | null | undefined) ?? null,
      label: projectLabel(document),
      notice: null
    }
  }

  subscribe(handlers: SubscriptionHandlers): () => void {
    this.handlers.add(handlers)
    return () => {
      this.handlers.delete(handlers)
    }
  }

  async readSidecar(logId: string): Promise<SidecarRead | null> {
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

  getSourceImage = async (filename: string): Promise<string | null> => {
    const link = (await this.deps.read({ part: 'image', id: filename })) as { url?: unknown } | null
    return typeof link?.url === 'string' ? link.url : null
  }

  openExternal = (url: string): void => {
    const safe = httpsUrl(url)
    if (safe) this.open(safe)
  }

  openFamilySearch = (value: string): void => {
    const url = resolveFamilySearchTarget(value)
    if (url) this.open(url)
  }

  async submitFeedback(): Promise<FeedbackResult> {
    throw new Error('Feedback is not available here.')
  }

  private open(url: string): void {
    void Promise.resolve()
      .then(() => this.deps.openLink(url))
      .catch(() => {})
  }
}

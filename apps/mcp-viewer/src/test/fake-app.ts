import { vi } from 'vitest'
import { PROJECT_META_KEY, READ_PROJECT_VIEW, type ProjectDocument, type ToolInput } from '../contract'
import { createAppHost, type AppLike } from '../hosts/app-host'
import type { BootFacts } from '../hosts/choose-host'
import type { DisplayMode, HostCapabilities, HostContext, ToolResultEvent } from '../hosts/host'
import { createSession } from '../session'

export const BOOT: BootFacts = { typeofClaude: 'undefined', typeofClaudeUse: 'undefined', parentIsWindow: false }

export const META_DOCUMENT: ProjectDocument = {
  research: {
    project: { title: 'From the snapshot' },
    sources: [{}, { image_filename: 'images/page-1.jpg' }],
    questions: [{}]
  },
  derived: { folderName: 'snapshot-folder' },
  echo: { show: 'latest' },
  canary: 'CANARY-META-M4X9'
}

export const READ_DOCUMENT: ProjectDocument = {
  research: { project: { title: 'From the read' }, sources: [], questions: [] },
  derived: { folderName: 'read-folder' }
}

export const RESULT_WITH_META: ToolResultEvent = {
  content: [{ type: 'text', text: 'shown CANARY-CONTENT-K7Q2' }],
  _meta: { [PROJECT_META_KEY]: META_DOCUMENT }
}

export const RESULT_WITHOUT_META: ToolResultEvent = {
  content: [{ type: 'text', text: 'shown CANARY-CONTENT-K7Q2' }]
}

export const RESULT_FAILED: ToolResultEvent = {
  isError: true,
  content: [{ type: 'text', text: 'No such project.' }]
}

/** Models the real App's merged context, so a layout reading it would go stale. */
export class FakeApp implements AppLike {
  ontoolinput: AppLike['ontoolinput'] = undefined
  ontoolresult: AppLike['ontoolresult'] = undefined
  ontoolcancelled: AppLike['ontoolcancelled'] = undefined
  onhostcontextchanged: AppLike['onhostcontextchanged'] = undefined

  context: HostContext = { displayMode: 'inline', availableDisplayModes: ['inline', 'fullscreen'] }
  capabilities: HostCapabilities = { serverTools: {}, updateModelContext: { text: {} } }
  handlersSetBeforeConnect = false

  connect = vi.fn(async (): Promise<void> => {
    this.handlersSetBeforeConnect = [
      this.ontoolinput,
      this.ontoolresult,
      this.ontoolcancelled,
      this.onhostcontextchanged
    ].every(Boolean)
  })

  callServerTool = vi.fn(
    async (_params: { name: string; arguments?: Record<string, unknown> }, _options?: { timeout?: number }) => ({
      content: [{ type: 'text' as const, text: 'ok' }],
      structuredContent: READ_DOCUMENT as Record<string, unknown>
    })
  )

  openLink = vi.fn(async (_params: { url: string }): Promise<{ isError?: boolean }> => ({}))

  requestDisplayMode = vi.fn(async ({ mode }: { mode: DisplayMode }): Promise<{ mode: DisplayMode }> => ({ mode }))

  getHostContext = (): HostContext => this.context
  getHostCapabilities = (): HostCapabilities => this.capabilities
  getHostVersion = () => ({ name: 'Fake Host', version: '9.9.9' })

  sendInput(args: ToolInput): void {
    this.ontoolinput?.({ arguments: args })
  }

  sendResult(result: ToolResultEvent): void {
    this.ontoolresult?.(result)
  }

  sendCancelled(reason?: string): void {
    this.ontoolcancelled?.({ reason })
  }

  sendContextChange(change: HostContext): void {
    this.context = { ...this.context, ...change }
    this.onhostcontextchanged?.(change)
  }

  reads(): Array<Record<string, unknown> | undefined> {
    return this.callServerTool.mock.calls
      .filter(([params]) => params.name === READ_PROJECT_VIEW)
      .map(([params]) => params.arguments)
  }
}

export function sessionOn(app: FakeApp, applyTheme?: (context: HostContext) => void) {
  return createSession({ host: createAppHost(app), boot: BOOT, applyTheme })
}

import type {
  McpUiAppCapabilities,
  McpUiHostCapabilities,
  McpUiHostContext,
  McpUiHostContextChangedNotification,
  McpUiToolCancelledNotification,
  McpUiToolInputNotification,
  McpUiToolResultNotification
} from '@modelcontextprotocol/ext-apps'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { ToolCallError, toToolCallError, unwrapToolResult, type DisplayMode, type Host } from './host'

export const APP_INFO = { name: 'genealogy-viewer', version: '0.0.0' }

export const APP_CAPABILITIES: McpUiAppCapabilities = {
  availableDisplayModes: ['inline', 'fullscreen']
}

/** The clock runs while a person reads the host's prompt, so the SDK's 60 seconds is too short. */
export const TOOL_CALL_TIMEOUT_MS = 300_000

/** The slice of ext-apps' `App` this page uses. It has no sendMessage: a card never posts. */
export interface AppLike {
  ontoolinput: ((params: McpUiToolInputNotification['params']) => void) | undefined
  ontoolresult: ((params: McpUiToolResultNotification['params']) => void) | undefined
  ontoolcancelled: ((params: McpUiToolCancelledNotification['params']) => void) | undefined
  onhostcontextchanged: ((params: McpUiHostContextChangedNotification['params']) => void) | undefined
  connect(): Promise<void>
  getHostContext(): McpUiHostContext | undefined
  getHostCapabilities(): McpUiHostCapabilities | undefined
  getHostVersion(): { name: string; version: string } | undefined
  callServerTool(
    params: { name: string; arguments?: Record<string, unknown> },
    options?: { timeout?: number }
  ): Promise<CallToolResult>
  openLink(params: { url: string }, options?: { timeout?: number }): Promise<{ isError?: boolean }>
  requestDisplayMode(params: { mode: DisplayMode }): Promise<{ mode: DisplayMode }>
  updateModelContext(params: { content: Array<{ type: 'text'; text: string }> }): Promise<unknown>
}

export function createAppHost(app: AppLike): Host {
  return {
    kind: 'app',
    input: null,

    async connect(listeners) {
      // Before connect: the host may send these as soon as the handshake ends.
      app.ontoolinput = (params) => listeners.onToolInput(params.arguments ?? {})
      app.ontoolresult = (params) => listeners.onToolResult(params)
      app.ontoolcancelled = (params) => listeners.onToolCancelled(params.reason)
      app.onhostcontextchanged = (params) => listeners.onHostContextChanged(params)
      await app.connect()
      const info = app.getHostVersion()
      return {
        name: info?.name,
        version: info?.version,
        context: app.getHostContext() ?? {},
        capabilities: app.getHostCapabilities()
      }
    },

    async call(tool, args) {
      let result: CallToolResult
      try {
        result = await app.callServerTool({ name: tool, arguments: args }, { timeout: TOOL_CALL_TIMEOUT_MS })
      } catch (err) {
        throw toToolCallError(err)
      }
      return unwrapToolResult(result)
    },

    async openLink(url) {
      let answer: { isError?: boolean }
      try {
        answer = await app.openLink({ url }, { timeout: TOOL_CALL_TIMEOUT_MS })
      } catch (err) {
        throw toToolCallError(err)
      }
      if (answer.isError) throw new ToolCallError('The host refused to open the link.', 'open_link_denied')
    },

    async requestDisplayMode(mode) {
      try {
        return (await app.requestDisplayMode({ mode })).mode
      } catch (err) {
        throw toToolCallError(err)
      }
    },

    async tellModel(text) {
      try {
        await app.updateModelContext({ content: [{ type: 'text', text }] })
      } catch (err) {
        throw toToolCallError(err)
      }
    }
  }
}

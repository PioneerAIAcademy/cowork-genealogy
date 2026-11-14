import type {
  McpUiDisplayMode,
  McpUiHostCapabilities,
  McpUiHostContext,
  McpUiToolResultNotification
} from '@modelcontextprotocol/ext-apps'
import type { ToolInput, ToolName } from '../contract'

export type DisplayMode = McpUiDisplayMode
export type HostContext = McpUiHostContext
export type HostCapabilities = McpUiHostCapabilities
export type ToolResultEvent = McpUiToolResultNotification['params']
export type HostKind = 'artifact' | 'tab' | 'app'

/** The one shape a failed call takes, however it failed. */
export class ToolCallError extends Error {
  readonly code?: string

  constructor(message: string, code?: string) {
    super(message)
    this.name = 'ToolCallError'
    this.code = code
  }
}

export class HostUnreachableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HostUnreachableError'
  }
}

export interface HostListeners {
  onToolInput(args: ToolInput): void
  onToolResult(result: ToolResultEvent): void
  onToolCancelled(reason: string | undefined): void
  onHostContextChanged(change: HostContext): void
}

export interface HostConnection {
  name?: string
  version?: string
  context: HostContext
  capabilities?: HostCapabilities
}

export interface Host {
  readonly kind: HostKind
  /** A fixed input for a host with no tool events, else null. */
  readonly input: ToolInput | null
  connect(listeners: HostListeners): Promise<HostConnection>
  /** Resolves the tool's structured data; rejects with a ToolCallError. */
  call(tool: ToolName, args: ToolInput): Promise<unknown>
  openLink(url: string): Promise<void>
  requestDisplayMode(mode: DisplayMode): Promise<DisplayMode>
  /** Tells the model what the researcher is looking at. Posts no message. Absent where the host has no such call. */
  tellModel?(text: string): Promise<void>
}

/** Both modes, for a host where the page lays itself out. */
export const LOCAL_DISPLAY_CONTEXT: HostContext = {
  displayMode: 'inline',
  availableDisplayModes: ['inline', 'fullscreen']
}

export function toToolCallError(err: unknown): ToolCallError {
  if (err instanceof ToolCallError) return err
  if (typeof err === 'object' && err !== null) {
    const { message, code } = err as { message?: unknown; code?: unknown }
    return new ToolCallError(
      typeof message === 'string' ? message : String(err),
      code === undefined ? undefined : String(code)
    )
  }
  return new ToolCallError(String(err))
}

export function resultText(result: { content?: unknown }): string {
  const blocks = Array.isArray(result.content) ? (result.content as Array<{ type?: unknown; text?: unknown }>) : []
  const text = blocks
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
  return text || 'The tool reported an error with no text.'
}

export function unwrapToolResult(result: { isError?: boolean; content?: unknown; structuredContent?: unknown }): unknown {
  if (result.isError) throw new ToolCallError(resultText(result))
  return result.structuredContent
}

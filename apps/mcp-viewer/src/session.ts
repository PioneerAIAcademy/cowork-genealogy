import { READ_PROJECT_VIEW, type ProjectDocument, type ToolInput } from './contract'
import { createDisplayMode, fullscreenOffered, INITIAL_DISPLAY, type DisplayModeState } from './display-mode'
import type { BootFacts } from './hosts/choose-host'
import {
  ToolCallError,
  toToolCallError,
  type DisplayMode,
  type Host,
  type HostCapabilities,
  type HostContext,
  type HostKind
} from './hosts/host'
import { createCardLoader, INITIAL_LOAD, type LoadState } from './load'
import { McpAppResearchTransport } from './transport/McpAppResearchTransport'

export const HOST_CONNECT_TIMEOUT_MS = 10_000

export interface ContextChange {
  at: number
  displayMode: DisplayMode | null
  keys: string[]
}

export interface ModeRequest {
  at: number
  mode: DisplayMode
  trigger: 'button' | 'show: file'
  outcome: string
}

export interface SessionState {
  connection: 'connecting' | 'connected' | 'unreachable'
  unreachableReason: string | null
  mountId: string
  loadedAt: number
  boot: BootFacts
  hostKind: HostKind
  hostName: string | null
  hostVersion: string | null
  capabilities: HostCapabilities | null
  load: LoadState
  display: DisplayModeState
  contextChanges: ContextChange[]
  modeRequests: ModeRequest[]
  /** The host's `containerDimensions` height limit: a fixed height, a maximum, or none. */
  heightLimit: number | null
  /** The search whose results the case file opens in its side panel. */
  fileLogId: string | null
  /** The newest document the case file has: the card's snapshot, then what opening the file read. */
  fileDocument: ProjectDocument | null
}

export interface SessionDeps {
  host: Host
  boot: BootFacts
  applyTheme?(context: HostContext): void
  now?(): number
}

export interface Session {
  getState(): SessionState
  subscribe(listener: () => void): () => void
  start(): Promise<void>
  requestMode(mode: DisplayMode): Promise<void>
  /** Opens the case file on today's documents, with `logId`'s results in its side panel. */
  openFile(logId?: string): Promise<void>
  /** The case file's data, one per mount. */
  readonly transport: McpAppResearchTransport
  /** Tells the model, in words, what the researcher has open. Posts nothing; silent where the host cannot. */
  tellModel(text: string): void
}

/** Everything the page knows and does, with no React in it. */
export function createSession({ host, boot, applyTheme = () => {}, now = Date.now }: SessionDeps): Session {
  const listeners = new Set<() => void>()
  let state: SessionState = {
    connection: 'connecting',
    unreachableReason: null,
    mountId: Math.random().toString(36).slice(2, 10),
    loadedAt: now(),
    boot,
    hostKind: host.kind,
    hostName: null,
    hostVersion: null,
    capabilities: null,
    load: INITIAL_LOAD,
    display: INITIAL_DISPLAY,
    contextChanges: [],
    modeRequests: [],
    heightLimit: null,
    fileLogId: null,
    fileDocument: null
  }
  let fileOpenTried = false

  function update(patch: Partial<SessionState>): void {
    state = { ...state, ...patch }
    listeners.forEach((listener) => listener())
  }

  // A remounted card may get no tool input, so the snapshot's echo backs it up.
  function projectArgs(): ToolInput {
    const projectPath = state.load.input?.projectPath ?? state.load.snapshot?.echo?.projectPath
    return typeof projectPath === 'string' ? { projectPath } : {}
  }

  async function readDocument(args: ToolInput): Promise<ProjectDocument> {
    const document = await host.call(READ_PROJECT_VIEW, { part: 'document', ...args })
    if (typeof document !== 'object' || document === null) {
      throw new ToolCallError('read_project_view returned no document.', 'bad_response')
    }
    return document as ProjectDocument
  }

  const transport = new McpAppResearchTransport({
    read: (args) => host.call(READ_PROJECT_VIEW, { ...projectArgs(), ...args })
  })

  const loader = createCardLoader({
    read: (projectPath) => readDocument(projectPath ? { projectPath } : {}),
    now,
    onChange: (load) => {
      const fresh = load.snapshot !== null && load.snapshot !== state.load.snapshot
      update(fresh ? { load, fileDocument: load.snapshot } : { load })
    }
  })

  const display = createDisplayMode({
    request: (mode) => host.requestDisplayMode(mode),
    onChange: (next) => update({ display: next })
  })

  // A context change without `containerDimensions` leaves the limit as it was.
  function applyHeightLimit(context: HostContext): void {
    const dims = context.containerDimensions as { height?: number; maxHeight?: number } | undefined
    if (!dims) return
    const limit = typeof dims.height === 'number' ? dims.height : typeof dims.maxHeight === 'number' ? dims.maxHeight : null
    update({ heightLimit: limit })
  }

  async function askForMode(mode: DisplayMode, trigger: ModeRequest['trigger']): Promise<void> {
    const at = now()
    let outcome: string
    try {
      outcome = `answered ${await display.request(mode)}`
    } catch (err) {
      outcome = `rejected: ${toToolCallError(err).message}`
    }
    update({ modeRequests: [...state.modeRequests, { at, mode, trigger, outcome }] })
  }

  // A card opened by a typed `show: file` goes straight to the file, on the loader's own read.
  function openFileIfAsked(): void {
    if (fileOpenTried || state.connection !== 'connected' || state.load.input?.show !== 'file') return
    fileOpenTried = true
    const logId = state.load.input?.logId
    update({ fileLogId: typeof logId === 'string' ? logId : null })
    if (fullscreenOffered(state.display)) {
      void askForMode('fullscreen', 'show: file')
    } else {
      const request: ModeRequest = { at: now(), mode: 'fullscreen', trigger: 'show: file', outcome: 'not offered' }
      update({ modeRequests: [...state.modeRequests, request] })
    }
  }

  return {
    getState: () => state,

    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    async start() {
      // A message, not a verdict: a connect that lands later still connects.
      const slowConnect = setTimeout(() => {
        update({
          connection: 'unreachable',
          unreachableReason: `connect took over ${HOST_CONNECT_TIMEOUT_MS / 1000} seconds.`
        })
      }, HOST_CONNECT_TIMEOUT_MS)

      let connection
      try {
        connection = await host.connect({
          onToolInput(args) {
            loader.toolInput(args)
            openFileIfAsked()
          },
          onToolResult: (result) => loader.toolResult(result),
          onToolCancelled: (reason) => loader.toolCancelled(reason),
          onHostContextChanged(change) {
            const entry: ContextChange = {
              at: now(),
              displayMode: change.displayMode ?? null,
              keys: Object.keys(change)
            }
            update({ contextChanges: [...state.contextChanges, entry] })
            applyHeightLimit(change)
            display.apply(change)
            applyTheme(change)
          }
        })
      } catch (err) {
        // A rejected connect is final: the App closes its transport.
        loader.dispose()
        update({ connection: 'unreachable', unreachableReason: toToolCallError(err).message })
        return
      } finally {
        clearTimeout(slowConnect)
      }

      update({
        connection: 'connected',
        unreachableReason: null,
        hostName: connection.name ?? null,
        hostVersion: connection.version ?? null,
        capabilities: connection.capabilities ?? null
      })
      applyHeightLimit(connection.context)
      display.apply(connection.context)
      applyTheme(connection.context)
      if (host.input) loader.load(host.input)
      openFileIfAsked()
    },

    requestMode: (mode) => askForMode(mode, 'button'),

    async openFile(logId) {
      update({ fileLogId: logId ?? null })
      void askForMode('fullscreen', 'button')
      try {
        const document = await readDocument(projectArgs())
        update({ fileDocument: document })
      } catch {
        // The snapshot stays: an older file beats no file.
      }
    },

    transport,

    tellModel(text) {
      if (!host.tellModel || !state.capabilities?.updateModelContext) return
      void host.tellModel(text).catch(() => {})
    }
  }
}

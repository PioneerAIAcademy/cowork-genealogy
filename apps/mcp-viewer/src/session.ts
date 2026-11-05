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
import { imageProbeRef, isImageLink, type ImageProbe, type SizeProbe } from './probes'

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
  sizeProbes: SizeProbe[]
  imageProbe: ImageProbe | null
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
  runSizeProbe(chars: number): Promise<void>
  runImageProbe(): Promise<void>
  imageSettled(outcome: { ok: boolean; width?: number; height?: number }): void
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
    sizeProbes: [],
    imageProbe: null
  }
  let nextProbeId = 1
  let fileOpenTried = false

  function update(patch: Partial<SessionState>): void {
    state = { ...state, ...patch }
    listeners.forEach((listener) => listener())
  }

  function projectArgs(): ToolInput {
    const projectPath = state.load.input?.projectPath
    return typeof projectPath === 'string' ? { projectPath } : {}
  }

  async function readDocument(args: ToolInput): Promise<ProjectDocument> {
    const document = await host.call(READ_PROJECT_VIEW, { part: 'document', ...args })
    if (typeof document !== 'object' || document === null) {
      throw new ToolCallError('read_project_view returned no document.', 'bad_response')
    }
    return document as ProjectDocument
  }

  const loader = createCardLoader({
    read: (projectPath) => readDocument(projectPath ? { projectPath } : {}),
    now,
    onChange: (load) => update({ load })
  })

  const display = createDisplayMode({
    request: (mode) => host.requestDisplayMode(mode),
    onChange: (next) => update({ display: next })
  })

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

  // M0 asks whether a card opened by a typed request can go straight to the file.
  function openFileIfAsked(): void {
    if (fileOpenTried || state.connection !== 'connected' || state.load.input?.show !== 'file') return
    fileOpenTried = true
    if (fullscreenOffered(state.display)) {
      void askForMode('fullscreen', 'show: file')
    } else {
      const request: ModeRequest = { at: now(), mode: 'fullscreen', trigger: 'show: file', outcome: 'not offered' }
      update({ modeRequests: [...state.modeRequests, request] })
    }
  }

  function updateSizeProbe(id: number, patch: Partial<SizeProbe>): void {
    update({ sizeProbes: state.sizeProbes.map((probe) => (probe.id === id ? { ...probe, ...patch } : probe)) })
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
      display.apply(connection.context)
      applyTheme(connection.context)
      if (host.input) loader.load(host.input)
      openFileIfAsked()
    },

    requestMode: (mode) => askForMode(mode, 'button'),

    async runSizeProbe(chars) {
      const id = nextProbeId++
      update({ sizeProbes: [...state.sizeProbes, { id, chars, status: 'running' }] })
      const startedAt = now()
      try {
        const document = await readDocument({ ...projectArgs(), pad: chars })
        const received = typeof document.pad === 'string' ? document.pad.length : 0
        updateSizeProbe(id, { status: 'ok', ms: now() - startedAt, received })
      } catch (err) {
        const { message, code } = toToolCallError(err)
        updateSizeProbe(id, { status: 'failed', ms: now() - startedAt, message, code })
      }
    },

    async runImageProbe() {
      const ref = imageProbeRef(state.load.snapshot)
      update({ imageProbe: { ref, status: 'asking' } })
      try {
        const link = await host.call(READ_PROJECT_VIEW, { ...projectArgs(), part: 'image', id: ref })
        if (!isImageLink(link)) throw new ToolCallError('read_project_view returned no image link.', 'bad_response')
        update({ imageProbe: { ref, status: 'showing', url: link.url, expiresAt: link.expiresAt } })
      } catch (err) {
        update({ imageProbe: { ref, status: 'refused', message: toToolCallError(err).message } })
      }
    },

    imageSettled({ ok, width, height }) {
      if (!state.imageProbe) return
      update({ imageProbe: { ...state.imageProbe, status: ok ? 'loaded' : 'failed', width, height } })
    }
  }
}

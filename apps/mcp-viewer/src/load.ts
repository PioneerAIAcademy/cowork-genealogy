import { PROJECT_META_KEY, type ProjectDocument, type ToolInput } from './contract'
import { resultText, toToolCallError, type ToolResultEvent } from './hosts/host'

/** A host need not send a result to a card mounted after the call finished. */
export const RESULT_WAIT_MS = 2_000

export type DataSource = 'result _meta' | 'read_project_view call'

export interface LoadState {
  phase: 'waiting' | 'fetching' | 'ready' | 'failed' | 'stopped'
  input: ToolInput | null
  inputAt: number | null
  resultAt: number | null
  /** Top-level key names of the first result, so a missing _meta can be blamed on the host. */
  resultKeys: string[] | null
  resultCarriedMeta: boolean | null
  snapshot: ProjectDocument | null
  source: DataSource | null
  /** A failure's text, or the host's reason for stopping the call. */
  message: string | null
}

export const INITIAL_LOAD: LoadState = {
  phase: 'waiting',
  input: null,
  inputAt: null,
  resultAt: null,
  resultKeys: null,
  resultCarriedMeta: null,
  snapshot: null,
  source: null,
  message: null
}

export interface CardLoaderDeps {
  read(projectPath: string | undefined): Promise<ProjectDocument>
  now(): number
  onChange(state: LoadState): void
}

function metaSnapshot(result: ToolResultEvent): ProjectDocument | null {
  const entry = (result._meta as Record<string, unknown> | undefined)?.[PROJECT_META_KEY]
  return typeof entry === 'object' && entry !== null ? (entry as ProjectDocument) : null
}

/**
 * Loads the project once per mount. Only the first tool result counts, and it
 * decides the card whenever it arrives, even over a read already made; only a
 * cancellation or a dispose that came first stops it. The read happens at most
 * once, and never after dispose.
 */
export function createCardLoader(deps: CardLoaderDeps) {
  let state = INITIAL_LOAD
  let timer: ReturnType<typeof setTimeout> | undefined
  let resultSeen = false
  let stopped = false
  let readStarted = false
  let readDropped = false

  function set(patch: Partial<LoadState>): void {
    state = { ...state, ...patch }
    deps.onChange(state)
  }

  function clearTimer(): void {
    clearTimeout(timer)
    timer = undefined
  }

  function read(): void {
    clearTimer()
    if (readStarted || stopped) return
    readStarted = true
    set({ phase: 'fetching' })
    const projectPath = state.input?.projectPath
    deps.read(typeof projectPath === 'string' ? projectPath : undefined).then(
      (snapshot) => {
        if (!readDropped) set({ phase: 'ready', snapshot, source: 'read_project_view call' })
      },
      (err) => {
        if (!readDropped) set({ phase: 'failed', message: toToolCallError(err).message })
      }
    )
  }

  return {
    toolInput(input: ToolInput): void {
      if (state.input) return
      set({ input, inputAt: deps.now() })
      if (!resultSeen && !stopped) timer = setTimeout(read, RESULT_WAIT_MS)
    },

    toolResult(result: ToolResultEvent): void {
      if (resultSeen || stopped) return
      resultSeen = true
      clearTimer()
      const snapshot = metaSnapshot(result)
      set({ resultAt: deps.now(), resultKeys: Object.keys(result), resultCarriedMeta: snapshot !== null })
      if (snapshot) {
        readDropped = true
        set({ phase: 'ready', snapshot, source: 'result _meta', message: null })
      } else if (result.isError) {
        readDropped = true
        set({ phase: 'failed', snapshot: null, source: null, message: resultText(result) })
      } else {
        // A host sends the input first; if one did not, the read goes with no
        // projectPath, which the server resolves or refuses.
        read()
      }
    },

    toolCancelled(reason: string | undefined): void {
      if (resultSeen || stopped) return
      stopped = true
      readDropped = true
      clearTimer()
      set({ phase: 'stopped', snapshot: null, source: null, message: reason ?? null })
    },

    /** A host with no tool events: one document call, now. */
    load(input: ToolInput): void {
      set({ input, inputAt: deps.now() })
      read()
    },

    dispose(): void {
      stopped = true
      readDropped = true
      clearTimer()
    }
  }
}

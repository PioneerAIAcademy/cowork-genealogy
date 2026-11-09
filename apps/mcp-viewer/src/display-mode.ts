import type { DisplayMode, HostContext } from './hosts/host'

export interface DisplayModeState {
  mode: DisplayMode
  available: readonly DisplayMode[]
}

export const INITIAL_DISPLAY: DisplayModeState = { mode: 'inline', available: [] }

export function fullscreenOffered(display: DisplayModeState): boolean {
  return display.available.includes('fullscreen')
}

export interface DisplayModeDeps {
  request(mode: DisplayMode): Promise<DisplayMode>
  onChange(state: DisplayModeState): void
}

/**
 * The page's one display mode. A host need not notify after answering a
 * request, and a resize notification need not repeat the mode, so the layout
 * reads this value and never the merged host context. Each source overwrites
 * the last, which makes the last to arrive win.
 */
export function createDisplayMode(deps: DisplayModeDeps) {
  let state = INITIAL_DISPLAY

  function set(next: DisplayModeState): void {
    state = next
    deps.onChange(state)
  }

  return {
    /** The context at connect, or a host-context-changed: only what it carries counts. */
    apply(context: Pick<HostContext, 'displayMode' | 'availableDisplayModes'>): void {
      set({
        mode: context.displayMode ?? state.mode,
        available: context.availableDisplayModes ?? state.available
      })
    },

    /** Rejects if the host does, leaving the mode alone. */
    async request(mode: DisplayMode): Promise<DisplayMode> {
      const answered = await deps.request(mode)
      set({ ...state, mode: answered })
      return answered
    }
  }
}

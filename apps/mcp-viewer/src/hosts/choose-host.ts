import type { HostKind } from './host'

export interface HostWindow {
  claude?: { use?: unknown }
  parent: unknown
}

/** The plan's order; runs before anything connects. */
export function chooseHost(win: HostWindow): HostKind {
  if (typeof win.claude?.use === 'function') return 'artifact'
  if (win.parent === win) return 'tab'
  return 'app'
}

export interface BootFacts {
  typeofClaude: string
  typeofClaudeUse: string
  parentIsWindow: boolean
}

export function readBootFacts(win: HostWindow): BootFacts {
  return {
    typeofClaude: typeof win.claude,
    typeofClaudeUse: typeof win.claude?.use,
    parentIsWindow: win.parent === win
  }
}

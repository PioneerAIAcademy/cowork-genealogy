import type { ProjectDocument } from './contract'
import type { ImageProbe, LinkProbe, SizeProbe } from './probes'
import type { SessionState } from './session'

/** Values from this block go into a public doc, which never holds the tunnel's address. */
const URL_PATTERN = /\bhttps?:\/\/[^\s"'<>)]+/g

export function projectName(document: ProjectDocument): string {
  const title = document.research?.project?.title
  if (typeof title === 'string' && title.trim()) return title
  return document.derived?.folderName ?? 'Untitled project'
}

export function headline(state: SessionState): string {
  if (state.connection === 'unreachable') return 'This page cannot reach its host.'
  const { load } = state
  switch (load.phase) {
    case 'waiting':
      return 'Waiting for the tool call.'
    case 'fetching':
      return 'Loading the project.'
    case 'ready':
      return load.snapshot ? projectName(load.snapshot) : 'Loading the project.'
    case 'failed':
      return load.message ?? 'The project could not be loaded.'
    case 'stopped':
      return 'The call was stopped.'
  }
}

function count(value: unknown): number {
  return Array.isArray(value) ? value.length : 0
}

function time(ms: number | null | undefined): string {
  return typeof ms === 'number' ? new Date(ms).toISOString() : 'none'
}

function yesNo(value: boolean): string {
  return value ? 'yes' : 'no'
}

function cardLines(state: SessionState): string[] {
  const { load } = state
  const lines = [`status: ${state.connection === 'unreachable' ? 'unreachable' : load.phase}`]
  if (state.unreachableReason) lines.push(`reason: ${state.unreachableReason}`)
  if (load.message) lines.push(`message: ${load.message}`)
  const document = load.snapshot
  if (document) {
    lines.push(
      `project: ${projectName(document)}`,
      `sources: ${count(document.research?.sources)}`,
      `questions: ${count(document.research?.questions)}`
    )
    if (document.canary) lines.push(`canary: ${document.canary}`)
  }
  const input = document?.echo ?? load.input
  if (input) lines.push(`input: ${JSON.stringify(input)}`)
  return lines
}

function metaArrived(state: SessionState): string {
  const { resultCarriedMeta } = state.load
  if (resultCarriedMeta === null) return 'no result yet'
  return yesNo(resultCarriedMeta)
}

function mountPad(document: ProjectDocument | null): string {
  return typeof document?.pad === 'string' ? `${document.pad.length} characters` : 'none'
}

function hostLines(state: SessionState): string[] {
  const { boot, capabilities, display, load } = state
  return [
    `mount id: ${state.mountId}`,
    `frame loaded: ${time(state.loadedAt)}`,
    `typeof window.claude: ${boot.typeofClaude}`,
    `typeof window.claude?.use: ${boot.typeofClaudeUse}`,
    `window.parent === window: ${boot.parentIsWindow}`,
    `host kind: ${state.hostKind}`,
    `host name: ${state.hostName ?? 'unknown'}`,
    `host version: ${state.hostVersion ?? 'unknown'}`,
    `availableDisplayModes: ${display.available.join(', ') || 'none offered'}`,
    `current mode: ${display.mode}`,
    `host capabilities: ${capabilities ? JSON.stringify(capabilities) : 'none'}`,
    `updateModelContext offered: ${yesNo(Boolean(capabilities?.updateModelContext))}`,
    `tool input received: ${time(load.inputAt)}`,
    `first tool result received: ${time(load.resultAt)}`,
    `first result keys: ${load.resultKeys?.join(', ') || 'none'}`,
    `result _meta arrived: ${metaArrived(state)}`,
    `data came from: ${load.source ?? 'none yet'}`,
    `pad on mount: ${mountPad(load.snapshot)}`
  ]
}

function sizeProbeLine(probe: SizeProbe): string {
  if (probe.status === 'running') return `${probe.chars}: running`
  if (probe.status === 'ok') return `${probe.chars}: received ${probe.received} characters in ${probe.ms} ms`
  return `${probe.chars}: failed after ${probe.ms} ms: ${probe.message}${probe.code ? ` (${probe.code})` : ''}`
}

function imageProbeLines(probe: ImageProbe): string[] {
  const lines = [`ref: ${probe.ref}`]
  if (probe.expiresAt !== undefined) lines.push(`link expires: ${time(probe.expiresAt)}`)
  if (probe.status === 'asking') lines.push('result: asking for a link')
  if (probe.status === 'showing') lines.push('result: loading')
  if (probe.status === 'loaded') lines.push(`result: loaded, ${probe.width} x ${probe.height}`)
  if (probe.status === 'failed') lines.push('result: the image failed to load')
  if (probe.status === 'refused') lines.push(`result: refused: ${probe.message}`)
  return lines
}

function linkProbeLine(probe: LinkProbe | null): string {
  if (!probe) return 'not run'
  if (probe.status === 'asking') return 'result: waiting for the host'
  if (probe.status === 'answered') return `result: the host answered in ${probe.ms} ms`
  return `result: refused after ${probe.ms} ms: ${probe.message}`
}

function section(title: string, lines: string[]): string {
  return [title, ...lines.map((line) => `  ${line}`)].join('\n')
}

/** The whole card as one block of plain text. It keeps the project's title and any
 *  input path, so the probe doc takes single values from it, never the block. */
export function reportText(state: SessionState): string {
  const sections = [
    section('Card', cardLines(state)),
    section('Host facts', hostLines(state)),
    section(
      `host-context-changed events: ${state.contextChanges.length}`,
      state.contextChanges.map((change) => {
        const mode = change.displayMode ? `displayMode ${change.displayMode}` : 'no displayMode'
        return `${time(change.at)} ${mode}; keys: ${change.keys.join(', ') || 'none'}`
      })
    ),
    section(
      `Mode requests: ${state.modeRequests.length}`,
      state.modeRequests.map((request) => `${time(request.at)} ${request.mode} from ${request.trigger}: ${request.outcome}`)
    ),
    section(`Size ladder: ${state.sizeProbes.length}`, state.sizeProbes.map(sizeProbeLine)),
    section('Image probe', state.imageProbe ? imageProbeLines(state.imageProbe) : ['not run']),
    section('Link probe', [linkProbeLine(state.linkProbe)])
  ]
  return sections.join('\n\n').replace(URL_PATTERN, '<url>')
}

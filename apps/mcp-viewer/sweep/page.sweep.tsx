import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, render, waitFor } from '@testing-library/react'
import { PrintModeContext, ResearchDataProvider, sectionComponents, useResearchData, ViewerBody } from '@genealogy/viewer-ui'
import { expect, it, vi } from 'vitest'
import { cardView } from '../src/cards/kit/view'
import { CARDS, cardKind } from '../src/cards/registry'
import type { ProjectDocument } from '../src/contract'
import { leftoverIds } from '../src/rules/id-check'
import { Prose } from '../src/rules/Prose'
import { McpAppResearchTransport } from '../src/transport/McpAppResearchTransport'
import { FileContext, type FileView } from '../src/file/FileContext'
import { LogPage } from '../src/file/LogPage'
import type { PaneTarget } from '../src/file/model'
import { Pane } from '../src/file/Panes'
import { SourcesPage } from '../src/file/SourcesPage'
import { buildRuleIndex } from '../src/rules/rule-index'
import type { RuleIndex } from '../src/rules/rule-index'

// `make mcp-viewer-sweep`: the page over every committed end state, as
// packages/engine/mcp-server/dev/sweep-stage.ts dumped them into $SWEEP_DIR.

const PID_IN_TEXT = /(?<![\w-])(?=[A-Z0-9-]*[A-Z])[A-Z0-9]{4}(?:-[A-Z0-9]{3,4})+(?![\w-])/g
const URL = /https?:\/\/[^\s<>]+|\]\([^)]*\)/g
const REVIEWED = ['compound-objective-fully-covered', 'compound-objective-part-unframed']
const CRAFT_ONLY = 'flynn-prior-craft-verdict'

interface Staged {
  name: string
  document: ProjectDocument
}

function staged(): Staged[] {
  const dir = process.env.SWEEP_DIR
  if (!dir || !existsSync(join(dir, 'count.txt'))) throw new Error('No staged projects: run make mcp-viewer-sweep.')
  const expected = Number(readFileSync(join(dir, 'count.txt'), 'utf-8'))
  const files = readdirSync(join(dir, 'docs')).filter((f) => f.endsWith('.json'))
  if (!(expected > 0) || files.length !== expected) {
    throw new Error(`Staged ${expected} projects but found ${files.length} documents.`)
  }
  return files.sort().map((f) => ({
    name: f.slice(0, -'.json'.length),
    document: JSON.parse(readFileSync(join(dir, 'docs', f), 'utf-8')) as ProjectDocument
  }))
}

function texts(document: ProjectDocument): string[] {
  const research = document.research ?? {}
  const out: string[] = []
  for (const ps of research.proof_summaries ?? []) if (typeof ps?.narrative_markdown === 'string') out.push(ps.narrative_markdown)
  for (const pe of research.person_evidence ?? []) if (typeof pe?.rationale === 'string') out.push(pe.rationale)
  return out
}

function knownPids(text: string, index: RuleIndex): string[] {
  const prose = text.replace(URL, ' ')
  return [...new Set([...prose.matchAll(PID_IN_TEXT)].map((m) => m[0]))].filter(
    (pid) => index.pidToPerson.has(pid) || index.records.has(pid)
  )
}

it('every card and every narrative renders with no id left, every known pid linked, and the reviewer where the fixtures say', () => {
  const host = document.createElement('div')
  const problems: string[] = []
  const render = (element: React.ReactElement) => {
    host.innerHTML = renderToStaticMarkup(element)
    return {
      text: (host.textContent ?? '').replace(/\s+/g, ' '),
      hrefs: [...host.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? '')
    }
  }
  const check = (where: string, text: string) => {
    for (const hit of leftoverIds(text)) {
      const token = hit.slice(hit.indexOf(': ') + 2)
      const at = text.indexOf(token)
      problems.push(`${where}: ${hit} | …${text.slice(Math.max(0, at - 60), at + token.length + 30)}…`)
    }
  }

  const states = staged()
  let narratives = 0
  let cards = 0
  for (const { name, document } of states) {
    const base = cardView(document, {})
    for (const text of texts(document)) {
      narratives++
      const shown = render(<Prose text={text} index={base.index} />)
      check(name, shown.text)
      for (const pid of knownPids(text, base.index)) {
        if (!shown.hrefs.some((h) => h.endsWith(pid))) problems.push(`${name}: known ${pid} not linked`)
      }
    }
    const questionIds = (document.research?.questions ?? []).map((q) => q?.id).filter((id) => typeof id === 'string')
    for (const questionId of [undefined, ...questionIds]) {
      for (const show of [...Object.keys(CARDS), 'latest']) {
        const where = `${name} ${show}${questionId ? ` ${questionId}` : ''}`
        cards++
        try {
          const view = cardView(document, { show, questionId })
          const Card = CARDS[cardKind(show, view)]
          check(where, render(<Card view={view} />).text)
        } catch (error) {
          problems.push(`${where}: threw ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    }
    const conclusion = render(
      (() => {
        const view = cardView(document, { show: 'conclusion' })
        return <CARDS.conclusion view={view} />
      })()
    ).text
    if (REVIEWED.includes(name) && !conclusion.includes("A reviewer's verdict")) problems.push(`${name}: no reviewer shown`)
    if (name === CRAFT_ONLY && conclusion.includes("A reviewer's verdict")) problems.push(`${name}: a craft read shown as the verdict`)
  }

  console.log(`projects ${states.length}, narratives ${narratives}, cards ${cards}, problems ${problems.length}`)
  if (process.env.SWEEP_OUT) writeFileSync(process.env.SWEEP_OUT, problems.join('\n'), 'utf-8')
  expect(problems.length, problems.slice(0, 40).join('\n')).toBe(0)
})

it('the new case file draws its pages and every pane with no id left, for every project', () => {
  const host = document.createElement('div')
  const problems: string[] = []
  let drawn = 0
  const draw = (where: string, view: FileView, body: React.ReactElement) => {
    drawn++
    try {
      host.innerHTML = renderToStaticMarkup(<FileContext.Provider value={view}>{body}</FileContext.Provider>)
    } catch (error) {
      problems.push(`${where}: threw ${error instanceof Error ? error.message : String(error)}`)
      return
    }
    const text = (host.textContent ?? '').replace(/\s+/g, ' ')
    for (const hit of leftoverIds(text)) {
      const token = hit.slice(hit.indexOf(': ') + 2)
      const at = text.indexOf(token)
      problems.push(`${where}: ${hit} | …${text.slice(Math.max(0, at - 60), at + token.length + 30)}…`)
    }
  }
  for (const { name, document: doc } of staged()) {
    const research = doc.research ?? {}
    const transport = new McpAppResearchTransport({ read: async () => ({ found: false }), openLink: () => {} })
    const base: FileView = {
      research,
      tree: doc.tree,
      startingTree: doc.startingTree,
      collections: doc.collections,
      derived: doc.derived ?? {},
      index: buildRuleIndex({ research, tree: doc.tree }),
      transport,
      pane: null,
      open: () => {},
      close: () => {}
    }
    draw(`${name} sources`, base, <SourcesPage />)
    draw(`${name} log`, base, <LogPage />)
    const targets: PaneTarget[] = [
      ...(research.sources ?? []).map((s) => ({ kind: 'record' as const, id: s.id })),
      ...(research.log ?? []).map((e) => ({ kind: 'search' as const, id: e.id })),
      ...[...base.index.persons.keys()].map((id) => ({ kind: 'person' as const, id }))
    ]
    for (const target of targets) draw(`${name} ${target.kind} ${target.id}`, { ...base, pane: target }, <Pane />)
  }
  console.log(`new case file: drawn ${drawn}, problems ${problems.length}`)
  if (process.env.SWEEP_OUT) writeFileSync(`${process.env.SWEEP_OUT}.new`, problems.join('\n'), 'utf-8')
  expect(problems.length, problems.slice(0, 40).join('\n')).toBe(0)
})

let selectSection: (key: string) => void = () => {}
let loaded = false

function Driver() {
  const { setActiveSection, research } = useResearchData()
  selectSection = setActiveSection
  loaded = research !== null
  return null
}

it('every case file section renders, expanded, for every project', async () => {
  const problems: string[] = []
  const errors: string[] = []
  const quiet = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const caught = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(' ').slice(0, 200))
  })
  const keys = Object.keys(sectionComponents)
  let sections = 0
  try {
    for (const { name, document: doc } of staged()) {
      const transport = new McpAppResearchTransport({ read: async () => ({ found: false }), openLink: () => {} })
      transport.update(doc)
      loaded = false
      errors.length = 0
      const { container, unmount } = render(
        <PrintModeContext.Provider value={true}>
          <ResearchDataProvider transport={transport}>
            <Driver />
            <ViewerBody showThemeToggle={false} hideHeaderActions />
          </ResearchDataProvider>
        </PrintModeContext.Provider>
      )
      try {
        await waitFor(() => expect(loaded).toBe(true))
        for (const key of keys) {
          sections++
          act(() => selectSection(key))
          const text = container.textContent ?? ''
          if (/Couldn.t display/.test(text)) problems.push(`${name} ${key}: the section failed to render`)
          if (!container.querySelector('h2')) problems.push(`${name} ${key}: no section heading`)
        }
        for (const error of errors) problems.push(`${name}: console.error ${error}`)
      } catch (error) {
        problems.push(`${name}: threw ${error instanceof Error ? error.message : String(error)}`)
      } finally {
        unmount()
      }
    }
  } finally {
    quiet.mockRestore()
    caught.mockRestore()
  }
  console.log(`case file: sections rendered ${sections}, problems ${problems.length}`)
  if (process.env.SWEEP_OUT) writeFileSync(`${process.env.SWEEP_OUT}.file`, problems.join('\n'), 'utf-8')
  expect(problems.length, problems.slice(0, 40).join('\n')).toBe(0)
})

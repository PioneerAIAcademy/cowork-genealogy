import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { cardView } from '../src/cards/kit/view'
import { CARDS, cardKind } from '../src/cards/registry'
import type { ProjectDocument } from '../src/contract'
import { leftoverIds } from '../src/rules/id-check'
import { Prose } from '../src/rules/Prose'
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

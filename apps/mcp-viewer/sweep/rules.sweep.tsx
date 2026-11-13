import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { leftoverIds } from '../src/rules/id-check'
import { Prose } from '../src/rules/Prose'
import { buildRuleIndex, type RuleIndex } from '../src/rules/rule-index'

const REPO = resolve(process.cwd(), '../..')
const RUNLOGS = `${REPO}/eval/runlogs/e2e`
const PID_IN_TEXT = /(?<![\w-])(?=[A-Z0-9-]*[A-Z])[A-Z0-9]{4}(?:-[A-Z0-9]{3,4})+(?![\w-])/g
const URL = /https?:\/\/[^\s<>]+|\]\([^)]*\)/g

interface EndState {
  name: string
  research: Record<string, unknown>
  tree: Record<string, unknown>
}

function json(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf-8'))
}

function endStates(): EndState[] {
  const capture = `${REPO}/docs/captures/2026-09-29-mcandrew-children`
  const states: EndState[] = [
    { name: 'mcandrew-capture', research: json(`${capture}/research.json`), tree: json(`${capture}/tree.gedcomx.json`) }
  ]
  for (const fixture of readdirSync(RUNLOGS).sort()) {
    let files: string[]
    try {
      files = readdirSync(`${RUNLOGS}/${fixture}`)
    } catch {
      continue
    }
    for (const file of files.filter((f) => f.endsWith('.final-research.json')).sort()) {
      const stem = file.slice(0, -'.final-research.json'.length)
      const treeFile = `${RUNLOGS}/${fixture}/${stem}.final-tree.gedcomx.json`
      let tree: Record<string, unknown> = {}
      try {
        tree = json(treeFile)
      } catch {
        // an end state with no tree still renders its prose
      }
      states.push({ name: `${fixture}/${stem}`, research: json(`${RUNLOGS}/${fixture}/${file}`), tree })
    }
  }
  return states
}

function texts(research: Record<string, unknown>): string[] {
  const out: string[] = []
  for (const ps of (research.proof_summaries as Array<Record<string, unknown>>) ?? []) {
    if (typeof ps?.narrative_markdown === 'string') out.push(ps.narrative_markdown)
  }
  for (const pe of (research.person_evidence as Array<Record<string, unknown>>) ?? []) {
    if (typeof pe?.rationale === 'string') out.push(pe.rationale)
  }
  return out
}

function knownPids(text: string, index: RuleIndex): string[] {
  const prose = text.replace(URL, ' ')
  return [...new Set([...prose.matchAll(PID_IN_TEXT)].map((m) => m[0]))].filter(
    (pid) => index.pidToPerson.has(pid) || index.records.has(pid)
  )
}

it('every proof narrative and link rationale renders with no id left and every known pid linked', () => {
  const host = document.createElement('div')
  const problems: string[] = []
  let states = 0
  let rendered = 0
  let links = 0
  for (const state of endStates()) {
    states++
    const index = buildRuleIndex(state)
    for (const text of texts(state.research)) {
      rendered++
      host.innerHTML = renderToStaticMarkup(<Prose text={text} index={index} />)
      const shown = host.textContent ?? ''
      const hrefs = [...host.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? '')
      links += hrefs.length
      for (const hit of leftoverIds(shown)) {
        const token = hit.slice(hit.indexOf(': ') + 2)
        const at = shown.indexOf(token)
        problems.push(`${state.name}: ${hit} | …${shown.slice(Math.max(0, at - 60), at + token.length + 30)}…`)
      }
      for (const pid of knownPids(text, index)) {
        if (!hrefs.some((h) => h.endsWith(pid))) problems.push(`${state.name}: known ${pid} not linked`)
      }
    }
  }
  console.log(`end states ${states}, texts rendered ${rendered}, links ${links}, problems ${problems.length}`)
  const byKind = new Map<string, number>()
  for (const p of problems) {
    const kind = p.split(': ')[1]
    byKind.set(kind, (byKind.get(kind) ?? 0) + 1)
  }
  console.log([...byKind].sort((a, b) => b[1] - a[1]).slice(0, 20))
  if (process.env.SWEEP_OUT) writeFileSync(process.env.SWEEP_OUT, problems.join('\n'), 'utf-8')
  expect(problems.length, problems.slice(0, 40).join('\n')).toBe(0)
})

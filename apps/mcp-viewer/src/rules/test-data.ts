import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildRuleIndex, type RuleIndex } from './rule-index'

// vitest runs from the package directory.
const REPO = resolve(process.cwd(), '../..') + '/'

export interface Documents {
  research: Record<string, unknown> & { proof_summaries: Array<{ narrative_markdown: string }> }
  tree: Record<string, unknown>
}

export function load(dir: string, treeFile = 'tree.gedcomx.json'): Documents {
  return {
    research: JSON.parse(readFileSync(`${REPO}${dir}/research.json`, 'utf-8')),
    tree: JSON.parse(readFileSync(`${REPO}${dir}/${treeFile}`, 'utf-8'))
  }
}

export const MCANDREW = load('docs/captures/2026-09-29-mcandrew-children')
export const COMPOUND = load('eval/fixtures/scenarios/compound-objective-fully-covered')
export const mcandrew: RuleIndex = buildRuleIndex(MCANDREW)
export const compound: RuleIndex = buildRuleIndex(COMPOUND)

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { toolLabel, humanizeToolNames, MCP_PREFIX } from '../toolLabel'

// The acceptance clause, replayed over every chip the captured session showed a
// reader: "no mcp__genealogy__* string reaches the screen".
//
// Both slots are checked. ChatPane renders `{tool}: {summary}`, and 18 of these
// chips carry a qualified name inside the SUMMARY -- so a tool-name map alone passes
// a naive check while leaving raw names on screen.

interface Chip { tool: string; summary: string }
const CHIPS: Chip[] = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'captured-chips.json'), 'utf8')
)

describe('tool labels over the captured chips', () => {
  it('has a corpus to check — a zero-length scan proves nothing', () => {
    expect(CHIPS.length).toBe(1009)
    expect(CHIPS.filter((c) => c.summary.includes(MCP_PREFIX)).length).toBe(18)
  })

  it('no raw tool name survives in the NAME slot', () => {
    const leaked = CHIPS.filter((c) => toolLabel(c.tool).includes(MCP_PREFIX))
    expect(leaked).toEqual([])
  })

  it('no raw tool name survives in the SUMMARY slot', () => {
    const leaked = CHIPS.filter((c) => humanizeToolNames(c.summary).includes(MCP_PREFIX))
    expect(leaked.map((c) => c.summary)).toEqual([])
  })

  it('every chip gets a non-empty label', () => {
    expect(CHIPS.filter((c) => c.tool && !toolLabel(c.tool)).length).toBe(0)
  })

  it('distinct labels stay distinct — no two tools collapse into one word', () => {
    const tools = [...new Set(CHIPS.map((c) => c.tool).filter(Boolean))]
    const labels = tools.map(toolLabel)
    expect(new Set(labels).size).toBe(tools.length)
  })
})

// The staleness guard. The capture contains 33 distinct tools; the engine advertises
// 49. A hand-written lookup table would pass every test above while leaving 16 tools
// raw on screen, and would rot again on the next tool shipped.
describe('tool labels over every tool the engine advertises', () => {
  const ADVERTISED: string[] = JSON.parse(
    readFileSync(join(__dirname, 'fixtures', 'advertised-tools.json'), 'utf8')
  )

  it('covers more tools than the capture exercised', () => {
    expect(ADVERTISED.length).toBeGreaterThan(40)
  })

  it('labels every advertised tool without leaking the wire name', () => {
    const leaked = ADVERTISED.filter((n) => toolLabel(MCP_PREFIX + n).includes(MCP_PREFIX))
    expect(leaked).toEqual([])
  })

  it('gives every advertised tool a non-empty, human-looking label', () => {
    const bad = ADVERTISED.filter((n) => {
      const l = toolLabel(MCP_PREFIX + n)
      return !l || l.includes('__') || l.includes('_')
    })
    expect(bad).toEqual([])
  })
})

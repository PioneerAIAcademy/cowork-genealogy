import { describe, it, expect } from 'vitest'
import { toolLabel, humanizeToolNames, MCP_PREFIX } from '../toolLabel'

// Phase 2 item 2. In the captured session the reader is shown
// `mcp__genealogy__same_person` 299 times and `mcp__genealogy__research_query` 230
// times -- the wire protocol's name, on screen, in a product for genealogists.
//
// DERIVED, not a lookup table. The capture contains 33 distinct tools but the engine
// advertises 49, so a hand-written map would leave the rest raw and go stale on every
// tool added. Overrides exist only where the derived wording is wrong.

describe('toolLabel', () => {
  it('strips the wire prefix and reads as words', () => {
    expect(toolLabel('mcp__genealogy__record_search')).toBe('Record search')
    expect(toolLabel('mcp__genealogy__place_population')).toBe('Place population')
  })

  it('never lets the wire prefix through, whatever the suffix', () => {
    for (const t of ['mcp__genealogy__some_future_tool', 'mcp__genealogy__x']) {
      expect(toolLabel(t)).not.toContain(MCP_PREFIX)
      expect(toolLabel(t)).not.toContain('__')
    }
  })

  it('uses a clearer override where the derived words would mislead', () => {
    // "Same person" reads as a statement; the call ASKS whether two records match.
    expect(toolLabel('mcp__genealogy__same_person')).toBe('Compare persons')
    // "Research query" sounds like it searches records; it reads the project file.
    expect(toolLabel('mcp__genealogy__research_query')).toBe('Read project')
  })

  it('leaves built-in tools recognisable rather than renaming them', () => {
    expect(toolLabel('Read')).toBe('Read')
    expect(toolLabel('ToolSearch')).toBe('Find tools')
    expect(toolLabel('Agent')).toBe('Sub-agent')
  })

  it('returns something usable for an unknown name rather than empty', () => {
    expect(toolLabel('WhateverThis')).toBe('WhateverThis')
    expect(toolLabel('')).toBe('')
  })
})

describe('humanizeToolNames (the summary arm)', () => {
  it('rewrites a qualified name embedded in a summary', () => {
    // 18 chips in the capture carry this shape. A name->label map alone leaves them
    // on screen, because ChatPane renders `{tool}: {summary}`.
    expect(humanizeToolNames('query=select:mcp__genealogy__person_read, max_results=1'))
      .toBe('query=select:Person read, max_results=1')
  })

  it('rewrites every name in a comma-separated list', () => {
    expect(
      humanizeToolNames('query=select:mcp__genealogy__person_warnings,mcp__genealogy__person_quality, max_results=2')
    ).toBe('query=select:Person warnings,Person quality, max_results=2')
  })

  it('leaves a summary with no tool names untouched', () => {
    const s = 'personId=G13G-P68, relatives=True, projectPath=/project'
    expect(humanizeToolNames(s)).toBe(s)
  })

  it('leaves no wire prefix anywhere in its output', () => {
    expect(humanizeToolNames('a mcp__genealogy__foo_bar b')).not.toContain(MCP_PREFIX)
  })
})

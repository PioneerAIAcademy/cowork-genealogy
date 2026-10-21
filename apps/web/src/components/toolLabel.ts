// Phase 2 item 2: a tool chip says what happened, not what the wire called it.
//
// Measured on the captured session (docs/captures/2026-09-29-mcandrew-children/):
// 1,009 chips reach the reader, and they are labelled with the raw tool name --
// `mcp__genealogy__same_person` 299 times, `mcp__genealogy__research_query` 230.
//
// DERIVED rather than a lookup table. That capture contains 33 distinct tools while
// the engine advertises 49, so a hand-written map would leave the rest raw and would
// go stale the next time a tool ships. Overrides below exist ONLY where the derived
// wording would mislead; everything else is humanized automatically and a new tool
// gets a sensible label with no edit here.

export const MCP_PREFIX = 'mcp__genealogy__'

/** Where deriving from the tool name gives the wrong idea. */
const OVERRIDES: Record<string, string> = {
  // "Same person" reads as a statement of fact; the call ASKS whether two records
  // are the same person. It is also the most frequent chip in the corpus (299).
  same_person: 'Compare persons',
  // "Research query" sounds like it searches records. It reads the project file.
  research_query: 'Read project',
  research_append: 'Record finding',
  research_log_append: 'Log search',
  project_context: 'Project context',
  materialize_facts: 'Apply facts',
  extraction_append: 'Record extraction'
}

/** Built-ins are not genealogy tools; keep them recognisable. */
const BUILTINS: Record<string, string> = {
  Read: 'Read',
  Skill: 'Skill',
  Agent: 'Sub-agent',
  Task: 'Sub-agent',
  ToolSearch: 'Find tools',
  SendMessage: 'Message sub-agent',
  TaskStop: 'Stop sub-agent'
}

function humanizeSuffix(suffix: string): string {
  if (!suffix) return ''
  const words = suffix.replace(/_/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** What the chip should say for `tool`. Never returns the wire prefix. */
export function toolLabel(tool: string): string {
  if (!tool) return ''
  if (BUILTINS[tool]) return BUILTINS[tool]
  if (!tool.startsWith(MCP_PREFIX)) return tool
  const suffix = tool.slice(MCP_PREFIX.length)
  return OVERRIDES[suffix] ?? humanizeSuffix(suffix)
}

// A qualified name can also appear INSIDE a summary -- 18 chips in the capture carry
// `query=select:mcp__genealogy__person_read` from a ToolSearch call, and ChatPane
// renders `{tool}: {summary}`. Labelling only the tool slot would leave those on
// screen forever, which is why the acceptance names them explicitly.
const QUALIFIED_RE = new RegExp(`${MCP_PREFIX}([a-z0-9_]+)`, 'g')

/** The same rewrite, applied to every qualified name embedded in free text. */
export function humanizeToolNames(summary: string): string {
  if (!summary || !summary.includes(MCP_PREFIX)) return summary
  return summary.replace(QUALIFIED_RE, (_m, suffix: string) => toolLabel(MCP_PREFIX + suffix))
}

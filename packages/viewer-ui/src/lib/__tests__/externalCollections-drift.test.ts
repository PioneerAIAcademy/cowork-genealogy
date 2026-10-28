import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// The viewer's row type is a hand copy of the engine's (the web side never
// imports the engine). A field renamed on one side alone makes parseRow drop
// every row, and each place then reads "nothing specific to this place" — a
// false statement, not an empty state. Reading both files as text keeps the
// no-import rule.
const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..', '..', '..', '..')

/** The body of `interface name { … }`, nested braces included. */
function interfaceBody(source: string, name: string): string {
  const start = source.search(new RegExp(`interface ${name}\\s*\\{`))
  if (start < 0) throw new Error(`interface ${name} not found`)
  const open = source.indexOf('{', start)
  let depth = 0
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++
    if (source[i] === '}' && --depth === 0) return source.slice(open + 1, i)
  }
  throw new Error(`interface ${name} is not closed`)
}

/** `name: type` per top-level member, comments, whitespace and trailing
 *  separators dropped. */
function interfaceFields(source: string, name: string, rename: [string, string][] = []): string[] {
  let body = interfaceBody(source, name).replace(/\/\/.*$/gm, '')
  for (const [from, to] of rename) body = body.split(from).join(to)
  // Split on `;` or a newline only at the top level, so a member that spans
  // lines inside `{}`, `<>`, `()` or `[]` stays one field.
  const fields: string[] = []
  let depth = 0
  let current = ''
  for (const ch of body) {
    if ('{<(['.includes(ch)) depth++
    if ('}>)]'.includes(ch)) depth--
    if (depth === 0 && (ch === ';' || ch === '\n')) {
      fields.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  fields.push(current)
  return fields
    .map((f) => f.replace(/\s+/g, '').replace(/,$/, ''))
    .filter(Boolean)
    .sort()
}

describe('external collections row: engine and viewer agree', () => {
  it('declares the same fields with the same types', () => {
    const engine = readFileSync(
      join(repoRoot, 'packages/engine/mcp-server/src/utils/external-collections-store.ts'),
      'utf8'
    )
    const viewer = readFileSync(join(here, '..', 'externalCollections.ts'), 'utf8')
    const engineFields = interfaceFields(engine, 'StoredCollectionRow')
    expect(engineFields.length).toBeGreaterThan(5)
    expect(interfaceFields(viewer, 'ExternalCollectionRow')).toEqual(engineFields)
  })

  // A renamed `places` or `rows` makes the parser return null, and the section
  // says no list was fetched for a project that has one.
  it('wraps the rows in the same document shape', () => {
    const engine = readFileSync(
      join(repoRoot, 'packages/engine/mcp-server/src/utils/external-collections-store.ts'),
      'utf8'
    )
    const viewer = readFileSync(join(here, '..', 'externalCollections.ts'), 'utf8')
    expect(
      interfaceFields(viewer, 'ExternalCollectionsData', [['ExternalCollectionRow', 'ROW']])
    ).toEqual(interfaceFields(engine, 'ExternalCollectionsDoc', [['StoredCollectionRow', 'ROW']]))
  })

  it('reads a nested member as one field', () => {
    expect(
      interfaceFields('interface D {\n  places: Record<string, {\n    rows: R[]\n  }>;\n}', 'D')
    ).toEqual(['places:Record<string,{rows:R[]}>'])
  })

  it('reads fields across a reflowed body', () => {
    expect(interfaceFields('interface X {\n  b2: string; aB?: string[] // note\n}', 'X')).toEqual([
      'aB?:string[]',
      'b2:string'
    ])
  })
})

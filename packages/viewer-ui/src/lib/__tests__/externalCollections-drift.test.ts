import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

// The viewer's row type is a hand copy of the engine's (the web side never
// imports the engine). A field renamed on one side alone makes parseRow drop
// every row, and each place then reads "nothing specific to this place" — a
// false statement, not an empty state. Reading both files as text keeps the
// no-import rule.
const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..', '..', '..', '..')

/** `name: type` per member, the type printed by the TypeScript compiler so
 *  formatting never matters (the same reason schema-interface-drift.test.ts
 *  parses rather than greps). `rename` maps a type name to a shared placeholder,
 *  so the row type, named differently on each side, compares equal. */
function interfaceFields(source: string, name: string, rename: [string, string][] = []): string[] {
  const file = ts.createSourceFile('x.ts', source, ts.ScriptTarget.Latest, true)
  const printer = ts.createPrinter({ removeComments: true })
  for (const node of file.statements) {
    if (!ts.isInterfaceDeclaration(node) || node.name.text !== name) continue
    return node.members
      .filter(ts.isPropertySignature)
      .map((m) => {
        let type = m.type ? printer.printNode(ts.EmitHint.Unspecified, m.type, file) : ''
        for (const [from, to] of rename) type = type.split(from).join(to)
        return `${m.name.getText(file)}${m.questionToken ? '?' : ''}:${type.replace(/\s+/g, '')}`
      })
      .sort()
  }
  throw new Error(`interface ${name} not found`)
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

  it('reads a nested member as one field, however it is wrapped', () => {
    const wrapped = 'interface D {\n  places: Record<\n    string,\n    { rows: R[]; }\n  >;\n}'
    expect(interfaceFields(wrapped, 'D')).toEqual(
      interfaceFields('interface D { places: Record<string, { rows: R[] }> }', 'D')
    )
  })

  it('reads fields across a reflowed body', () => {
    expect(interfaceFields('interface X {\n  b2: string; aB?: string[] // note\n}', 'X')).toEqual([
      'aB?:string[]',
      'b2:string'
    ])
  })
})

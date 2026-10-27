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

function interfaceFields(source: string, name: string): string[] {
  const m = source.match(new RegExp(`interface ${name}\\s*\\{([^}]*)\\}`))
  if (!m) throw new Error(`interface ${name} not found`)
  return [...m[1].matchAll(/^\s*([a-z_]+)\??\s*:/gm)].map((f) => f[1]).sort()
}

describe('external collections row: engine and viewer agree', () => {
  it('names the same fields', () => {
    const engine = readFileSync(
      join(repoRoot, 'packages/engine/mcp-server/src/utils/external-collections-store.ts'),
      'utf8'
    )
    const viewer = readFileSync(join(here, '..', 'externalCollections.ts'), 'utf8')
    const engineFields = interfaceFields(engine, 'StoredCollectionRow')
    expect(engineFields.length).toBeGreaterThan(5)
    expect(interfaceFields(viewer, 'ExternalCollectionRow')).toEqual(engineFields)
  })

  it('reads fields across a reflowed body', () => {
    expect(interfaceFields('interface X {\n  b: string;\n  a?: string[]\n}', 'X')).toEqual(['a', 'b'])
  })
})

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
// @ts-expect-error — plain .mjs, no types; the guards are what is under test.
import { findShadowed, pascal, renderEnums } from '../../../schema/scripts/gen-enums.mjs'

/**
 * The generator's two guards actually fire.
 *
 * ADR-0008 tier 2 says "a generated file cannot drift from its input", and that
 * is true — but only while the generator refuses to emit a file that is wrong
 * in a way nothing downstream would report. Both refusals are silent-failure
 * insurance, so neither shows up in a passing build:
 *
 *  - the shadow guard, because `export *` shadows a name with NO tsc error, so
 *    a generated union can sit unreachable behind an interface of the same name
 *    (it did — `ExternalSite`, fixed in #1271);
 *  - the empty-output guard, because an `enums.schema.json` that stopped
 *    parsing into `$defs` would otherwise write a valid, empty file and every
 *    `import type` would fail somewhere else entirely.
 *
 * Lives in viewer-ui for the same reason as schema-interface-drift.test.ts:
 * packages/schema has no test script and viewer-ui's vitest reaches it.
 */

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..', '..', '..')

describe('gen-enums shadow guard', () => {
  it('catches a plain interface of the same name', () => {
    expect(findShadowed(new Set(['ExternalSite']), 'export interface ExternalSite {\n}\n')).toEqual([
      'ExternalSite',
    ])
  })

  it('catches a type alias of the same name', () => {
    expect(findShadowed(new Set(['Severity']), "export type Severity = 'x'\n")).toEqual(['Severity'])
  })

  it('catches a declaration whose name wrapped onto the next line', () => {
    // The guard is the only thing standing between a shadowed union and a
    // silently wrong build, so formatting must not be able to switch it off.
    expect(findShadowed(new Set(['ExternalSite']), 'export interface\n  ExternalSite {\n}\n')).toEqual(
      ['ExternalSite'],
    )
  })

  it('catches a re-export alias, which shadows identically', () => {
    expect(findShadowed(new Set(['Priority']), 'export { Foo as Priority }\n')).toEqual(['Priority'])
  })

  it('does not fire on an unrelated declaration', () => {
    expect(findShadowed(new Set(['Severity']), 'export interface TimelineGap {\n}\n')).toEqual([])
  })

  it('passes against the real src/index.ts', () => {
    // The live assertion: whatever the file currently declares, none of it may
    // collide with a generated name.
    const schema = JSON.parse(
      readFileSync(join(repoRoot, 'packages', 'schema', 'schemas', 'enums.schema.json'), 'utf8'),
    )
    const { emitted } = renderEnums(schema)
    expect(emitted.size, 'closed enums rendered').toBeGreaterThan(20)
    const source = readFileSync(join(repoRoot, 'packages', 'schema', 'src', 'index.ts'), 'utf8')
    expect(findShadowed(emitted, source)).toEqual([])
  })
})

describe('gen-enums rendering', () => {
  it('renders nothing for a schema with no closed enums', () => {
    // main() turns this into the "refusing to write an empty file" throw.
    const { blocks } = renderEnums({ $defs: { site_recommended: { examples: ['a', 'b'] } } })
    expect(blocks).toEqual([])
  })

  it('refuses a value that would break out of its quotes', () => {
    expect(() => renderEnums({ $defs: { bad: { enum: ["it's", 'ok'] } } })).toThrow(
      /quote or backslash/,
    )
  })

  it('refuses a $def name it cannot PascalCase', () => {
    expect(() => pascal('trailing_')).toThrow(/empty path segment/)
  })
})

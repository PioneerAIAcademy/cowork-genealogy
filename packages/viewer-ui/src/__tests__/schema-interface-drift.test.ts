import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * @genealogy/schema's hand-written interfaces mirror research.schema.json.
 *
 * The enum unions in that package are generated (scripts/gen-enums.mjs) and so
 * cannot drift. The interfaces are still hand-written — for their doc comments,
 * which the JSON Schema does not carry — and nothing checked them. Two fields
 * had already drifted when this was written (#1165) and a third,
 * `TimelineEvent.place_id`, was residue from a completed migration: the type
 * advertised a field `additionalProperties: false` rejects, so a caller who
 * wrote it had the whole write refused.
 *
 * This lives in viewer-ui rather than in packages/schema because viewer-ui
 * already has a vitest runner and a workspace dep on the schema package, and
 * js-tests.yml reaches both. packages/schema has no test script.
 *
 * Field NAMES only. Types — optionality, `| null`, and `date_certainty: string`
 * where the union exists — need the TypeScript compiler API and stay with #1165.
 */

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..', '..', '..')

const schema = JSON.parse(
  readFileSync(join(repoRoot, 'docs', 'specs', 'schemas', 'research.schema.json'), 'utf8'),
)
const source = readFileSync(join(repoRoot, 'packages', 'schema', 'src', 'index.ts'), 'utf8')

/** `$defs` name → the TS interface name, where PascalCase isn't the answer. */
const RENAMED: Record<string, string> = {
  external_site_detail: 'ExternalSite',
  person_evidence_entry: 'PersonEvidence',
}

/** `$defs` that intentionally have no TS interface. */
const NO_INTERFACE: string[] = []

const pascal = (s: string) => s.split('_').map((p) => p[0].toUpperCase() + p.slice(1)).join('')

function interfaceFields(src: string): Map<string, Set<string>> {
  // Strip block comments first so JSDoc prose can't be read as a field.
  const clean = src.replace(/\/\*[\s\S]*?\*\//g, '')
  const out = new Map<string, Set<string>>()
  for (const m of clean.matchAll(/export interface (\w+) \{([\s\S]*?)\n\}/g)) {
    const fields = [...m[2].matchAll(/^ {2}(\w+)\??\s*:/gm)].map((f) => f[1])
    out.set(m[1], new Set(fields))
  }
  return out
}

const parsed = interfaceFields(source)

describe('@genealogy/schema interfaces mirror research.schema.json', () => {
  it('parsed a plausible number of interfaces', () => {
    // A regex that silently matches nothing reads exactly like a clean run.
    expect(parsed.size, 'interfaces parsed out of packages/schema/src/index.ts').toBeGreaterThan(25)
  })

  const objectDefs = Object.entries<any>(schema.$defs).filter(
    ([, d]) => d.type === 'object' && d.properties,
  )

  it('found the object $defs to check', () => {
    expect(objectDefs.length).toBeGreaterThan(15)
  })

  for (const [defName, def] of objectDefs) {
    if (NO_INTERFACE.includes(defName)) continue
    const tsName = RENAMED[defName] ?? pascal(defName)

    it(`${tsName} ↔ $defs.${defName}`, () => {
      const fields = parsed.get(tsName)
      expect(
        fields,
        `no \`export interface ${tsName}\` in packages/schema/src/index.ts — ` +
          `add it, add a RENAMED entry, or list ${defName} in NO_INTERFACE`,
      ).toBeDefined()

      const schemaKeys = Object.keys(def.properties).sort()
      const tsKeys = [...fields!].sort()
      const missing = schemaKeys.filter((k) => !fields!.has(k))
      const extra = tsKeys.filter((k) => !(k in def.properties))

      expect(
        { missing, extra },
        `${tsName} drifted from $defs.${defName} — ` +
          `missing: schema has it, the type doesn't; extra: the type advertises a ` +
          `field the schema rejects (additionalProperties: false)`,
      ).toEqual({ missing: [], extra: [] })
    })
  }
})

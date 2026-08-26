import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

/**
 * @genealogy/schema's hand-written interfaces mirror BOTH persisted schemas —
 * research.schema.json and tree-gedcomx.schema.json.
 *
 * The enum unions in that package are generated (scripts/gen-enums.mjs) and so
 * cannot drift. The interfaces are still hand-written — for their doc comments,
 * which the JSON Schema does not carry — and nothing checked them. Two fields
 * had already drifted when this was written (#1165) and a third,
 * `TimelineEvent.place_id`, was residue from a completed migration: the type
 * advertised a field `additionalProperties: false` rejects, so a caller who
 * wrote it had the whole write refused.
 *
 * The tree half is here for the same reason and against the same failure: the
 * engine's allow-lists get that guard from tree-shape-drift.test.ts, but the
 * web mirror's `Gedcomx*` interfaces had no equivalent, so `GedcomxPerson`
 * could advertise a field every writer tool rejects and stay green.
 *
 * This lives in viewer-ui rather than in packages/schema because viewer-ui
 * already has a vitest runner and a workspace dep on the schema package, and
 * js-tests.yml reaches both. packages/schema has no test script.
 *
 * Field names AND optionality (schema `required` vs the TS `?`, both directions,
 * ADR-0008 / #1165). Still uncovered: value types — `| null` nullability, and a
 * closed enum typed as `string` where a union exists.
 */

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..', '..', '..')

const schema = JSON.parse(
  readFileSync(join(repoRoot, 'docs', 'specs', 'schemas', 'research.schema.json'), 'utf8'),
)
const treeSchema = JSON.parse(
  readFileSync(join(repoRoot, 'docs', 'specs', 'schemas', 'tree-gedcomx.schema.json'), 'utf8'),
)
const sourcePath = join(repoRoot, 'packages', 'schema', 'src', 'index.ts')

/** `$defs` name → the TS interface name, where PascalCase isn't the answer. */
const RENAMED: Record<string, string> = {
  person_evidence_entry: 'PersonEvidence',
}

/** `$defs` that intentionally have no TS interface. */
const NO_INTERFACE: string[] = []

/**
 * tree-gedcomx.schema.json `$defs` → interface. No naming convention connects
 * the two (`person` → `GedcomxPerson`), so every closed subschema is listed
 * explicitly and the completeness check below fails on an unlisted one.
 *
 * `id` is a bare string `$def` and `relationship` is a `oneOf` over the two
 * concrete relationship types; neither is a closed object, so neither has —
 * or needs — an interface.
 */
const TREE_INTERFACES: Record<string, string> = {
  person: 'GedcomxPerson',
  name: 'GedcomxName',
  fact: 'GedcomxFact',
  parent_child_relationship: 'GedcomxParentChildRelationship',
  couple_relationship: 'GedcomxCoupleRelationship',
  source_description: 'GedcomxSource',
  source_reference: 'GedcomxSourceRef',
}

const pascal = (s: string) => s.split('_').map((p) => p[0].toUpperCase() + p.slice(1)).join('')

/**
 * interface name → declared property names, via the TypeScript compiler.
 *
 * Not a regex (#1219). The regex this replaced keyed on `export interface X {`
 * and a 2-space field indent, so it was coupled to formatting rather than to
 * the language, and measured against four ordinary shapes it got all four
 * wrong: `extends Base` and a single-line body dropped the interface entirely;
 * a 4-space indent kept the interface with zero fields; and a nested object
 * literal leaked the nested `name` up as a top-level field of `Locality`.
 * Every one of those fails loudly, but three of the four fail with the wrong
 * diagnosis, and the last is a false positive — which is how a lint gets
 * disabled. The compiler reads all four, with one limit it does not remove:
 * `node.members` is directly-declared members only, so an `extends` still
 * reports its inherited fields as missing. That is what the inheritance guard
 * below asserts against, rather than something this parser handles.
 */
function interfaceFields(path: string): {
  fields: Map<string, Set<string>>
  optional: Map<string, Set<string>>
  inheriting: string[]
} {
  const sourceFile = ts.createSourceFile(
    path,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
  )
  const out = new Map<string, Set<string>>()
  const optionalOut = new Map<string, Set<string>>()
  const inheriting: string[] = []
  sourceFile.forEachChild((node) => {
    if (!ts.isInterfaceDeclaration(node)) return
    if (node.heritageClauses?.length) inheriting.push(node.name.text)
    const fields = new Set<string>()
    const optional = new Set<string>()
    for (const member of node.members) {
      // Index signatures and computed names have no plain identifier; no schema
      // object here uses one, and skipping is right if one ever appears.
      if (!ts.isPropertySignature(member) || !member.name) continue
      if (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name)) {
        fields.add(member.name.text)
        // `member.questionToken` is the `?` — present iff the field is optional.
        if (member.questionToken) optional.add(member.name.text)
      }
    }
    out.set(node.name.text, fields)
    optionalOut.set(node.name.text, optional)
  })
  return { fields: out, optional: optionalOut, inheriting }
}

const { fields: parsed, optional: parsedOptional, inheriting } = interfaceFields(sourcePath)

/** One interface against one subschema's `properties`, by field name. */
function expectMirrors(tsName: string, def: any, help: string) {
  const fields = parsed.get(tsName)
  expect(fields, help).toBeDefined()

  const schemaKeys = Object.keys(def.properties).sort()
  const missing = schemaKeys.filter((k) => !fields!.has(k))
  const extra = [...fields!].sort().filter((k) => !(k in def.properties))

  expect(
    { missing, extra },
    `${tsName} drifted — missing: the schema has it, the type doesn't; ` +
      `extra: the type advertises a field the schema rejects (additionalProperties: false)`,
  ).toEqual({ missing: [], extra: [] })
}

/**
 * One interface's optionality against one subschema's `required` list, BOTH
 * directions, no exemption list. The lead ruled 2026-08-21 (#1165, ADR-0008):
 * a key absent from `required` is `foo?: T | null`, and a key in `required` has
 * no `?`. Schema-optional means TypeScript-optional. An exemption list here
 * would re-admit exactly the "present but null" encoding that ruling rejected.
 * (Non-vacuity is enforced globally by the "optionality check is not vacuous"
 * test, not per-interface, since an empty intersection here means name drift,
 * which expectMirrors already fails on.)
 */
function expectOptionality(tsName: string, def: any, help: string): void {
  const fields = parsed.get(tsName)
  const optional = parsedOptional.get(tsName)
  expect(optional, help).toBeDefined()
  const required = new Set<string>(def.required ?? [])
  // Only fields present in BOTH the schema and the type; name drift is the
  // separate expectMirrors check above.
  const shared = Object.keys(def.properties).filter((k) => fields!.has(k))
  const missingQuestion = shared
    .filter((k) => !required.has(k) && !optional!.has(k))
    .sort()
  const spuriousQuestion = shared
    .filter((k) => required.has(k) && optional!.has(k))
    .sort()
  expect(
    { missingQuestion, spuriousQuestion },
    `${tsName} optionality drift — missingQuestion: absent from the schema's ` +
      `required list but the type has no \`?\`; spuriousQuestion: in required but ` +
      `the type marks \`?\`. Schema-optional MUST be TypeScript-optional ` +
      `(ADR-0008, #1165); no exemptions.`,
  ).toEqual({ missingQuestion: [], spuriousQuestion: [] })
}

describe('@genealogy/schema interfaces mirror research.schema.json', () => {
  it('parsed a plausible number of interfaces', () => {
    // A parser that silently returns nothing reads exactly like a clean run.
    expect(parsed.size, 'interfaces parsed out of packages/schema/src/index.ts').toBeGreaterThan(25)
  })

  it('no interface inherits its fields', () => {
    // `node.members` is directly-declared members only, so an `extends` would
    // make every inherited field read as missing — drift that isn't there, on
    // an interface that is fine. There is none today; fail here naming the
    // interface rather than N lines away naming its parent's fields.
    expect(
      inheriting,
      'this lint reads only directly-declared members, so an interface with ' +
        '`extends` reports its inherited fields as drift — teach interfaceFields ' +
        'to walk the heritage clause before adding one',
    ).toEqual([])
  })

  const objectDefs = Object.entries<any>(schema.$defs).filter(
    ([, d]) => d.type === 'object' && d.properties,
  )

  it('found the object $defs to check', () => {
    expect(objectDefs.length).toBeGreaterThan(15)
  })

  it('the optionality check is not vacuous', () => {
    // Two ways the optionality checks below could silently pass: a `questionToken`
    // read that is always undefined makes every field look required, and one that
    // is always truthy makes every field look optional. Either would make one
    // direction of every per-interface check below vacuous. Prove the parser sees
    // a real MIX across the file, so a broken read fails HERE, loudly.
    const optionalCount = [...parsedOptional.values()].reduce((n, s) => n + s.size, 0)
    const requiredCount = [...parsed.entries()].reduce(
      (n, [name, fs]) => n + [...fs].filter((f) => !parsedOptional.get(name)?.has(f)).length,
      0,
    )
    expect(optionalCount, 'no `?` fields parsed — questionToken read looks broken').toBeGreaterThan(20)
    expect(requiredCount, 'no required fields parsed — questionToken read looks broken').toBeGreaterThan(20)
  })

  it('ResearchData ↔ the research document root', () => {
    // The root is a closed object like every `$def`, but it is not IN `$defs`,
    // so the loop below never reaches it — the same shape the tree block guards
    // with its GedcomxData root checks.
    expect(schema.additionalProperties, 'the root must be closed').toBe(false)
    expectMirrors('ResearchData', schema, 'no `export interface ResearchData`')
  })

  it('ResearchData optionality ↔ the research document root.required', () => {
    expectOptionality('ResearchData', schema, 'no `export interface ResearchData`')
  })

  for (const [defName, def] of objectDefs) {
    if (NO_INTERFACE.includes(defName)) continue
    const tsName = RENAMED[defName] ?? pascal(defName)

    it(`${tsName} ↔ $defs.${defName}`, () => {
      expectMirrors(
        tsName,
        def,
        `no \`export interface ${tsName}\` in packages/schema/src/index.ts — ` +
          `add it, add a RENAMED entry, or list ${defName} in NO_INTERFACE`,
      )
    })

    it(`${tsName} optionality ↔ $defs.${defName}.required`, () => {
      expectOptionality(
        tsName,
        def,
        `no \`export interface ${tsName}\` in packages/schema/src/index.ts`,
      )
    })
  }
})

describe('@genealogy/schema interfaces mirror tree-gedcomx.schema.json', () => {
  it('every closed subschema has an interface listed', () => {
    // The engine's allow-lists get this check from tree-shape-drift.test.ts.
    // Without the same completeness assertion here, a new closed $def would
    // simply not be in TREE_INTERFACES and would go unchecked in silence.
    const closed = Object.entries<any>(treeSchema.$defs)
      .filter(([, d]) => d.additionalProperties === false)
      .map(([n]) => n)
      .sort()
    expect(closed, 'add the new $def to TREE_INTERFACES').toEqual(
      Object.keys(TREE_INTERFACES).sort(),
    )
  })

  it('GedcomxData ↔ the tree document root', () => {
    expect(treeSchema.additionalProperties, 'the root must be closed').toBe(false)
    expectMirrors('GedcomxData', treeSchema, 'no `export interface GedcomxData`')
  })

  it('GedcomxData optionality ↔ the tree document root.required', () => {
    expectOptionality('GedcomxData', treeSchema, 'no `export interface GedcomxData`')
  })

  for (const [defName, tsName] of Object.entries(TREE_INTERFACES)) {
    it(`${tsName} ↔ $defs.${defName}`, () => {
      const def = treeSchema.$defs[defName]
      expect(def, `no $defs.${defName} in tree-gedcomx.schema.json`).toBeDefined()
      expectMirrors(tsName, def, `no \`export interface ${tsName}\``)
    })

    it(`${tsName} optionality ↔ $defs.${defName}.required`, () => {
      const def = treeSchema.$defs[defName]
      expect(def, `no $defs.${defName} in tree-gedcomx.schema.json`).toBeDefined()
      expectOptionality(tsName, def, `no \`export interface ${tsName}\``)
    })
  }
})

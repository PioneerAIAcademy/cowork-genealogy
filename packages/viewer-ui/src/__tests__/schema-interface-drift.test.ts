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
 * ADR-0008 / #1165), for the `$defs` and the two document roots. Still
 * uncovered: value types — `| null` nullability, and a closed enum typed as
 * `string` where a union exists — and objects defined inline as an array's
 * `items` rather than as a `$def`, which neither loop below reaches.
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

/**
 * Which interfaces each helper actually compared — recorded only once the helper's
 * own expect has PASSED, so that neither a throw nor an early return registers a
 * name. Asserted as an exact SET, not a count: a floor is defeatable one interface
 * at a time (`if (tsName.startsWith('Gedcomx')) return` cleared a floor of 150 while
 * hiding a real regression), and a count cannot tell a skipped interface from a
 * smaller one.
 */
const seen = { names: new Set<string>(), optionality: new Set<string>() }

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
  // AFTER the expect, never before: a throw must NOT record the name. The
  // planted-drift block below calls this helper with 'Assertion' and expects a
  // throw; recording first let that count as coverage, and deleting the real
  // Assertion comparison then left this whole file green.
  seen.names.add(tsName)
}

/**
 * One interface's optionality against one subschema's `required` list, BOTH
 * directions, no exemption list. The lead ruled 2026-08-21 (#1165, ADR-0008):
 * a key absent from `required` is `foo?: T | null`, and a key in `required` has
 * no `?`. Schema-optional means TypeScript-optional. An exemption list here
 * would re-admit exactly the "present but null" encoding that ruling rejected.
 * (Non-vacuity: the "not vacuous" test proves the questionToken read, and the
 * planted-drift self-test at the end of this file proves these helpers actually
 * compare. An empty intersection here means name drift, which expectMirrors
 * already fails on.)
 */
function expectOptionality(tsName: string, def: any, help: string): void {
  const fields = parsed.get(tsName)
  const optional = parsedOptional.get(tsName)
  expect(optional, help).toBeDefined()
  // `?? []` is load-bearing for exactly one $def: `researcher_profile` declares no
  // `required` key at all, which JSON Schema reads as every field optional and its
  // own description confirms. That is deliberate, not an omission.
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
  seen.optionality.add(tsName)
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

/**
 * Self-test: prove each helper's comparison actually runs, by handing it a
 * deliberately drifted schema and requiring it to throw.
 *
 * This replaces a comparison COUNTER, which was the wrong instrument. It summed
 * the keys each helper ENUMERATED, so replacing every filter body with `[]` left
 * it reading its full 251 while both halves of the lint were inert and a planted
 * real drift stayed green. A floor is defeatable one interface at a time, too:
 * `if (tsName.startsWith('Gedcomx')) return` cleared 150 while hiding a genuine
 * regression. Planting the drift exercises the assertion itself, so there is no
 * floor to clear and no ordering to depend on.
 */
describe('the drift helpers actually compare', () => {
  const def = schema.$defs.assertion
  const req: string[] = def.required ?? []
  const optionalField = Object.keys(def.properties).find((k) => !req.includes(k))!
  const requiredField = req[0]

  it('expectMirrors rejects a schema key the interface lacks', () => {
    const planted = { ...def, properties: { ...def.properties, not_a_real_field: {} } }
    expect(() => expectMirrors('Assertion', planted, 'planted')).toThrow()
  })

  it('expectMirrors rejects an interface field the schema lacks', () => {
    const properties = { ...def.properties }
    delete (properties as Record<string, unknown>)[optionalField]
    expect(() => expectMirrors('Assertion', { ...def, properties }, 'planted')).toThrow()
  })

  it('expectOptionality rejects a schema-required field wearing a `?`', () => {
    const planted = { ...def, required: [...req, optionalField] }
    expect(() => expectOptionality('Assertion', planted, 'planted')).toThrow()
  })

  it('expectOptionality rejects a schema-optional field with no `?`', () => {
    const planted = { ...def, required: req.filter((k) => k !== requiredField) }
    expect(() => expectOptionality('Assertion', planted, 'planted')).toThrow()
  })
})

/**
 * Every interface the loops above intended to check was actually reached by both
 * helpers. This is what a comparison COUNT could not do: an exemption keyed on one
 * interface family clears any floor, and the planted-drift self-test below only
 * proves the helper works for the interface it plants against.
 */
describe('every intended interface was actually compared', () => {
  // Derived from the SCHEMA, deliberately NOT from NO_INTERFACE: an expectation
  // computed from the exemption list can never notice the list growing.
  const expected = new Set<string>(['ResearchData', 'GedcomxData'])
  for (const [defName] of Object.entries<any>(schema.$defs).filter(
    ([, d]) => d.type === 'object' && d.properties,
  )) {
    expected.add(RENAMED[defName] ?? pascal(defName))
  }
  for (const tsName of Object.values(TREE_INTERFACES)) expected.add(tsName)

  it('NO_INTERFACE is still empty', () => {
    // The ruling on #1165 is "no exemption list". This is one, and the failure
    // message in the loop above recommends it by name, so it is pinned here:
    // growing it must be a deliberate edit to this assertion, not a quiet append.
    expect(NO_INTERFACE).toEqual([])
  })

  it('expectMirrors reached every one', () => {
    expect(
      [...expected].filter((n) => !seen.names.has(n)).sort(),
      'requires a FULL unfiltered run: these names are recorded as each comparison passes, ' +
        'so a `-t` filter or a shuffled order lists interfaces whose tests never executed, ' +
        'which is this check being unverifiable — not schema drift',
    ).toEqual([])
  })

  it('expectOptionality reached every one', () => {
    expect(
      [...expected].filter((n) => !seen.optionality.has(n)).sort(),
      'requires a FULL unfiltered run: these names are recorded as each comparison passes, ' +
        'so a `-t` filter or a shuffled order lists interfaces whose tests never executed, ' +
        'which is this check being unverifiable — not schema drift',
    ).toEqual([])
  })
})

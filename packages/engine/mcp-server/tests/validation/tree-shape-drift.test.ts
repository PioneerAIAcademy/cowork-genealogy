import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  TREE_TOP_LEVEL_FIELDS,
  TREE_PERSON_FIELDS,
  TREE_NAME_FIELDS,
  TREE_FACT_FIELDS,
  TREE_PARENT_CHILD_FIELDS,
  TREE_COUPLE_FIELDS,
  TREE_SOURCE_FIELDS,
  TREE_SOURCE_REF_FIELDS,
} from "../../src/validation/tree-shape.js";

/**
 * The simplified-GedcomX allow-lists mirror tree-gedcomx.schema.json exactly.
 *
 * Same guard as validator.test.ts's "RESEARCH_SHAPES mirrors
 * research.schema.json exactly", for the other schema. These sets are what the
 * validator enforces `additionalProperties: false` from, so a field added to the
 * schema and not to the set makes **every writer tool reject the write**, and a
 * field in the set but not the schema is silently accepted by the tools and
 * rejected by anything validating against the JSON Schema.
 */

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, "..", "..", "..", "..", "..");

const schema = JSON.parse(
  readFileSync(
    join(projectRoot, "docs", "specs", "schemas", "tree-gedcomx.schema.json"),
    "utf8",
  ),
);

/**
 * Set name → its subschema, plus the keys the set deliberately carries beyond
 * it.
 *
 * The relationship sets each include the *other* type's endpoint keys so a
 * swapped-endpoint mistake produces one bespoke "should use 'parent'/'child'"
 * error instead of that plus a duplicate unknown-key error, and so the
 * sanitizer never deletes an endpoint it cannot re-derive. See the comment at
 * src/validation/tree-shape.ts:18-21.
 */
const CASES: Array<{
  name: string;
  set: ReadonlySet<string>;
  def: any;
  extra?: string[];
}> = [
  { name: "TREE_TOP_LEVEL_FIELDS", set: TREE_TOP_LEVEL_FIELDS, def: schema },
  { name: "TREE_PERSON_FIELDS", set: TREE_PERSON_FIELDS, def: schema.$defs.person },
  { name: "TREE_NAME_FIELDS", set: TREE_NAME_FIELDS, def: schema.$defs.name },
  { name: "TREE_FACT_FIELDS", set: TREE_FACT_FIELDS, def: schema.$defs.fact },
  {
    name: "TREE_PARENT_CHILD_FIELDS",
    set: TREE_PARENT_CHILD_FIELDS,
    def: schema.$defs.parent_child_relationship,
    extra: ["person1", "person2"],
  },
  {
    name: "TREE_COUPLE_FIELDS",
    set: TREE_COUPLE_FIELDS,
    def: schema.$defs.couple_relationship,
    extra: ["parent", "child"],
  },
  { name: "TREE_SOURCE_FIELDS", set: TREE_SOURCE_FIELDS, def: schema.$defs.source_description },
  { name: "TREE_SOURCE_REF_FIELDS", set: TREE_SOURCE_REF_FIELDS, def: schema.$defs.source_reference },
];

describe("tree-shape.ts mirrors tree-gedcomx.schema.json (drift guard)", () => {
  it("every closed object subschema has a matching allow-list", () => {
    // A $def gaining `additionalProperties: false` without a set here would be
    // enforced by the schema and not by the tools.
    const closed = Object.entries<any>(schema.$defs)
      .filter(([, d]) => d.additionalProperties === false)
      .map(([n]) => n)
      .sort();
    const covered = [
      "person", "name", "fact", "parent_child_relationship",
      "couple_relationship", "source_description", "source_reference",
    ].sort();
    expect(closed).toEqual(covered);
  });

  for (const { name, set, def, extra = [] } of CASES) {
    it(name, () => {
      expect(def, `${name}: no matching subschema`).toBeDefined();
      expect(
        def.additionalProperties,
        `${name} must be closed in the schema, or the allow-list enforces more than the spec`,
      ).toBe(false);

      const schemaKeys = Object.keys(def.properties ?? {});
      expect([...set].sort(), `allow-list drift on ${name}`).toEqual(
        [...schemaKeys, ...extra].sort(),
      );
    });
  }
});

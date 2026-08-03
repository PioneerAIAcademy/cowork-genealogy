import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/**
 * `packages/schema` TypeScript ↔ JSON Schema drift lint (issue #1165).
 *
 * `packages/schema` ships two descriptions of the same data: the JSON Schemas
 * under `schemas/`, and hand-maintained TypeScript interfaces in `src/index.ts`
 * that viewer-ui, the web client, and the control plane all compile against.
 * Two checks already guard *parts* of this:
 *
 *   - `eval/harness/tests/unit/test_schema_mirrors.py` — the two JSON copies
 *     (docs/specs/ and packages/schema/) are byte-identical.
 *   - `validator.test.ts` — the engine's `RESEARCH_SHAPES` mirrors the schema.
 *
 * Nothing compared the **TypeScript** to either. It had already drifted twice
 * when this was written: `Assertion.standard_place` and
 * `TimelineEvent.standard_place` were both present in both JSON copies and
 * absent from the interfaces (fixed in #1173). Nothing failed, because nothing
 * looked — a consumer just silently could not see the field.
 *
 * **Presence only, not optionality.** 25 fields across 11 interfaces are
 * optional in schema but declared required-and-nullable in TS (`date: string |
 * null` rather than `date?: string | null`). That is consistent enough across
 * the file to be house style rather than drift, and flipping it is a
 * behavior-visible change for every consumer. Asserting on it here would make
 * this lint a 25-line failure on day one, which is how a lint gets disabled.
 * A missing *field* is the defect that actually shipped.
 *
 * Parsed with the TypeScript compiler rather than a regex: an interface body
 * carries doc comments, unions spanning lines, and nested object literals, and
 * a regex that silently stops matching passes vacuously.
 */

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, "..", "..", "..", "..", "..");
const schemaPkg = join(projectRoot, "packages", "schema");
const TS_SOURCE = join(schemaPkg, "src", "index.ts");

/**
 * `$defs` key → interface name, where snake→Pascal does not land it.
 *
 * Deliberately explicit: an unmapped `$def` FAILS below rather than being
 * skipped, so adding a schema object forces a conscious decision about whether
 * it has a TS counterpart — which is the drift this lint exists to catch.
 */
const ALIASES: Record<string, string> = {
  external_site_detail: "ExternalSite",
  person_evidence_entry: "PersonEvidence",
};

/** `$defs` keys with no TS counterpart by design. Keep this list short. */
const NO_TS_COUNTERPART = new Set<string>([]);

function pascal(snake: string): string {
  return snake
    .split("_")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join("");
}

/** interface name → declared property names. */
function interfaceProperties(sourcePath: string): Map<string, Set<string>> {
  const source = ts.createSourceFile(
    sourcePath,
    readFileSync(sourcePath, "utf8"),
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
  );
  const out = new Map<string, Set<string>>();
  source.forEachChild((node) => {
    if (!ts.isInterfaceDeclaration(node)) return;
    const props = new Set<string>();
    for (const member of node.members) {
      if (!ts.isPropertySignature(member) || !member.name) continue;
      // Index signatures and computed names have no plain identifier; the
      // schema objects here don't use them, and skipping is right if they appear.
      if (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name)) {
        props.add(member.name.text);
      }
    }
    out.set(node.name.text, props);
  });
  return out;
}

type SchemaObject = { properties?: Record<string, unknown> };

function defsWithProperties(schemaPath: string): Map<string, SchemaObject> {
  const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as {
    $defs?: Record<string, SchemaObject>;
  };
  const out = new Map<string, SchemaObject>();
  for (const [name, def] of Object.entries(schema.$defs ?? {})) {
    if (def && typeof def === "object" && def.properties) out.set(name, def);
  }
  return out;
}

describe("packages/schema TypeScript mirrors its JSON Schema", () => {
  const interfaces = interfaceProperties(TS_SOURCE);

  it("parsed the TypeScript at all (guards the parser itself)", () => {
    expect(
      interfaces.size,
      `no interfaces parsed from ${TS_SOURCE} — if the file moved or its shape ` +
        `changed, fix this test rather than letting it pass vacuously`,
    ).toBeGreaterThan(10);
  });

  const schemaFile = join(schemaPkg, "schemas", "research.schema.json");
  const defs = defsWithProperties(schemaFile);

  it("found schema objects to check", () => {
    expect(defs.size).toBeGreaterThan(10);
  });

  it("maps every schema object to an interface", () => {
    const unmapped = [...defs.keys()].filter((name) => {
      if (NO_TS_COUNTERPART.has(name)) return false;
      return !interfaces.has(ALIASES[name] ?? pascal(name));
    });
    expect(
      unmapped,
      `these $defs have no TypeScript interface. Add one, add an entry to ` +
        `ALIASES if it is named differently, or add it to NO_TS_COUNTERPART ` +
        `with a reason: ${unmapped.join(", ")}`,
    ).toEqual([]);
  });

  for (const [defName, def] of defs) {
    if (NO_TS_COUNTERPART.has(defName)) continue;
    const ifaceName = ALIASES[defName] ?? pascal(defName);

    it(`${defName} → ${ifaceName}: every schema property is declared`, () => {
      const declared = interfaces.get(ifaceName);
      if (!declared) return; // reported by the mapping test above
      const missing = Object.keys(def.properties ?? {}).filter(
        (p) => !declared.has(p),
      );
      expect(
        missing,
        `${ifaceName} is missing ${missing.length} field(s) present in ` +
          `research.schema.json $defs.${defName}: ${missing.join(", ")}. ` +
          `Consumers compiling against this type cannot see them.`,
      ).toEqual([]);
    });
  }

  it("the schema file this checks is the one the mirror test pins", () => {
    // If these ever diverge, test_schema_mirrors.py fails first — but it only
    // compares the two JSON copies, so state the dependency here rather than
    // leaving this lint quietly checking whichever copy happened to be edited.
    const canonical = join(
      projectRoot,
      "docs",
      "specs",
      "schemas",
      "research.schema.json",
    );
    expect(existsSync(canonical)).toBe(true);
    expect(readFileSync(schemaFile, "utf8")).toEqual(
      readFileSync(canonical, "utf8"),
    );
  });
});

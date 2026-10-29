import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import ts from "typescript";

/**
 * `packages/schema`'s sidecar-payload types must not claim things the engine
 * never emits (#2476).
 *
 * The viewer reads a `results/<log_id>.json` sidecar, which is the verbatim
 * `record_search` response — `research-schema-spec.md` §5.4.1 types `payload`
 * as "the verbatim MCP tool response, loosely typed". `packages/schema` hand-
 * mirrors the part of that shape the viewer renders, and nothing compared the
 * two: `schema-interface-drift.test.ts` drives off `research.schema.json` and
 * `tree-gedcomx.schema.json` `$defs`, and there is no JSON Schema for sidecar
 * payloads at all, so neither `TreeMatch` nor `RecordSearchResult` was reached
 * by any check.
 *
 * What that cost, before this guard existed: `TreeMatch` was declared
 * `{personId, personName, treeId, ark}` against an engine that has emitted
 * `{treePersonId, stars}` since the tool shipped — zero field overlap. Every
 * "Tree matches" row in the viewer rendered an empty bullet under a duplicate
 * `key={undefined}`, and the two viewer tests passed because the fixture was
 * hand-written to the same invented shape. `RecordSearchResult` carried a
 * second instance (`personId`, which the engine has never had) and a third
 * (`arkUrl`, where the engine emits `recordArk`), so the footer link never
 * rendered for a real sidecar either. CLAUDE.md: "When the bug is the second
 * instance of a class already fixed, write one shared guard, not a second
 * one-off."
 *
 * WHAT THIS ASSERTS, AND WHAT IT DELIBERATELY DOES NOT.
 *
 * The mirror is a PARTIAL view by design — the viewer types only what it
 * renders, and the engine's `RecordSearchResult` carries ~29 fields to the
 * mirror's ~12. Requiring completeness would flag 18 fields on day one, which
 * is the rubber-stamped-exemption-list shape `field-render-drift.test.ts`
 * already rejected for the same reason. So a subset is fine. Two things are
 * not:
 *
 *   1. A field the engine does not have. Reading it yields `undefined` forever,
 *      and TypeScript cannot catch it because the mirror is the only type the
 *      viewer sees.
 *   2. A field REQUIRED in the mirror that is OPTIONAL in the engine. The
 *      mirror then asserts a guarantee real payloads do not honour, and every
 *      consumer is free to skip a null check.
 *
 * The reverse (optional here, required there) is safe and allowed: the viewer
 * merely checks something that is always present.
 *
 * WHY IT LIVES IN THE ENGINE SUITE. Same reason as `mcp-fixture-shape.test.ts`:
 * the contract being mirrored is engine-side, so the check needs a job that
 * sees both sides change. `engine-tests.yml` runs ungated on every PR. The web
 * side still never DEPENDS on the engine — this reads the engine's source as
 * text, in a test, and ships in neither artifact.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..", "..", "..");
const ENGINE_TYPES = join(
  repoRoot,
  "packages/engine/mcp-server/src/types/record-search.ts",
);
const MIRROR = join(repoRoot, "packages/schema/src/index.ts");

/** Interfaces compared, by name. Both files must declare each one. */
const MIRRORED = ["TreeMatch", "RecordSearchResult"] as const;

/**
 * Mirror-only fields that are NOT engine fields and are allowed to stay, each
 * with the reason. Anything else that is absent from the engine fails.
 *
 * Keep this list short and justified: every entry is a field the viewer reads
 * off a payload the engine did not put it in, so each one needs a producer
 * named here or it is the very bug this guard exists to catch.
 */
const MIRROR_ONLY: Record<string, string> = {
  "RecordSearchResult.arkUrl":
    "Synthesized by SidecarResultCard's record_read adapter, and emitted by " +
    "apps/server/app/agent/mock_agent.py and both sample-project seeds. Not a " +
    "record_search field: the real one is recordArk, which the mirror also has.",
};

type Field = { name: string; optional: boolean; type: string };

function fieldsOf(file: string, interfaceName: string): Field[] {
  const src = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
  let found: Field[] | null = null;
  sf.forEachChild((node) => {
    if (
      ts.isInterfaceDeclaration(node) &&
      node.name.text === interfaceName &&
      found === null
    ) {
      found = node.members
        .filter(ts.isPropertySignature)
        .map((m) => ({
          name: ts.isStringLiteral(m.name) ? m.name.text : m.name.getText(sf),
          optional: m.questionToken !== undefined,
          type: (m.type?.getText(sf) ?? "").replace(/\s+/g, "").replace(/^readonly/, "").replace(/^(?:Readonly)?Array<(\w+)>$/, "$1[]"),
        }));
    }
  });
  expect(
    found,
    `${interfaceName} not found in ${file}. If it was renamed, rename it in ` +
      `both files and update MIRRORED — a silently missing interface would ` +
      `turn this whole check into a no-op.`,
  ).not.toBeNull();
  return found!;
}

describe("packages/schema mirrors the engine's record_search shapes", () => {
  for (const name of MIRRORED) {
    describe(name, () => {
      it("declares no field the engine never emits", () => {
        const engine = new Set(fieldsOf(ENGINE_TYPES, name).map((f) => f.name));
        const invented = fieldsOf(MIRROR, name)
          .map((f) => f.name)
          .filter((f) => !engine.has(f))
          .filter((f) => MIRROR_ONLY[`${name}.${f}`] === undefined);
        expect(
          invented,
          `${name}: these fields exist in packages/schema but not in the ` +
            `engine's ${name}, so reading them yields undefined forever. ` +
            `Either correct them to the engine's spelling, or — if a non-engine ` +
            `producer really writes them — add an entry to MIRROR_ONLY naming ` +
            `that producer.`,
        ).toEqual([]);
      });

      it("never requires a field the engine leaves optional", () => {
        const engine = new Map(
          fieldsOf(ENGINE_TYPES, name).map((f) => [f.name, f.optional]),
        );
        const stricter = fieldsOf(MIRROR, name)
          .filter((f) => !f.optional)
          .filter((f) => engine.get(f.name) === true)
          .map((f) => f.name);
        expect(
          stricter,
          `${name}: these fields are required in packages/schema but optional ` +
            `in the engine, so the mirror promises something a real sidecar ` +
            `need not carry. Mark them optional here.`,
        ).toEqual([]);
      });
    });
  }

  it("types a field holding a mirrored shape with that same mirrored shape", () => {
    // A name-only comparison passes `treeMatches?: Array<{ personId: string }>`:
    // the invented shape comes back inline, past both interface checks above.
    const pattern = new RegExp(`\\b(${MIRRORED.join("|")})\\b`);
    const engine = new Map(fieldsOf(ENGINE_TYPES, "RecordSearchResult").map((f) => [f.name, f.type]));
    const nested = fieldsOf(MIRROR, "RecordSearchResult").filter((f) => pattern.test(engine.get(f.name) ?? ""));
    expect(nested.map((f) => f.name)).toContain("treeMatches");
    for (const f of nested) {
      expect(f.type, `RecordSearchResult.${f.name}: type it as the engine does`).toBe(engine.get(f.name));
    }
  });

  it("is actually reading both files, not matching nothing", () => {
    // A field-name comparison between two empty lists passes. Pin that each
    // side parsed, so a path typo or an interface rename cannot turn the two
    // assertions above into vacuous truths.
    for (const name of MIRRORED) {
      expect(fieldsOf(ENGINE_TYPES, name).length, `engine ${name}`).toBeGreaterThan(1);
      expect(fieldsOf(MIRROR, name).length, `mirror ${name}`).toBeGreaterThan(1);
    }
    // And that the engine side really is the richer one, which is the premise
    // the subset rule rests on.
    expect(
      fieldsOf(ENGINE_TYPES, "RecordSearchResult").length,
    ).toBeGreaterThan(fieldsOf(MIRROR, "RecordSearchResult").length);
  });

  it("keeps every MIRROR_ONLY entry earning its place", () => {
    // Shrink-only: once a mirror-only field becomes a real engine field, or is
    // deleted, its exemption must go too — otherwise the list silently grows
    // into the rubber stamp this guard exists to avoid.
    for (const key of Object.keys(MIRROR_ONLY)) {
      const [iface, field] = key.split(".");
      const inMirror = fieldsOf(MIRROR, iface).some((f) => f.name === field);
      const inEngine = fieldsOf(ENGINE_TYPES, iface).some((f) => f.name === field);
      expect(
        inMirror,
        `MIRROR_ONLY names ${key}, which packages/schema no longer declares. ` +
          `Remove the entry.`,
      ).toBe(true);
      expect(
        inEngine,
        `MIRROR_ONLY names ${key}, but the engine now declares it too, so the ` +
          `exemption is obsolete. Remove the entry and let the check cover it.`,
      ).toBe(false);
    }
  });
});

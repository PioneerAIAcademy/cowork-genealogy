import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertAcyclicTable,
  RECORD_TYPE_GROUP_TABLE,
  RECORD_TYPE_GROUP_NAMES,
  conceptIdsForGroups,
} from "../../src/utils/record-type-groups.js";
import { volumeSearchSchema } from "../../src/tools/volume-search.js";

// Contract: docs/specs/volume-search-tool-spec.md § "Record-type filtering".
//
// The spec states the vocabulary as two markdown tables a human reads and
// adjudicates; `src/utils/record-type-groups.ts` states the same vocabulary as
// the data the tool sends. Nothing compared them, and the spec's own Files table
// says so — "the implementation PR must add one, in the manner
// tests/packaging/manifest.test.ts guards manifest.json against allToolSchemas".
// This is that test. ADR-0008 tier 3 (Lint): the spec copy cannot be eliminated,
// because prose is what the genealogists review, so it gets a lint instead.
//
// Dropping one stray silently narrows a search — Baptism's `127575` is ~208k
// volumes — with no error and no empty result, so a mis-transcription has to
// fail here or it does not fail at all.

const here = dirname(fileURLToPath(import.meta.url));
const specPath = join(here, "..", "..", "..", "..", "..", "docs", "specs", "volume-search-tool-spec.md");
const spec = readFileSync(specPath, "utf8");

/** Rows of the pipe table whose header line starts with `header`. */
function tableRows(header: string): string[][] {
  const lines = spec.split("\n");
  const start = lines.findIndex((l) => l.startsWith(header));
  if (start === -1) return [];
  const out: string[][] = [];
  // +2 skips the header and the `|---|` separator.
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith("|")) break;
    out.push(line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
  }
  return out;
}

/** Backticked 6-digit concept ids in one cell. */
function idsIn(cell: string): number[] {
  return [...cell.matchAll(/`(\d{6})`/g)].map((m) => Number(m[1]));
}

const groupRows = tableRows("| Group | Anchor | Parent | Also returns |");
const strayRows = tableRows("| Group | Stray | Actually under |");

/** name -> { anchor, parent, alsoReturns } from the spec's group table. */
const specGroups = new Map(
  groupRows.map((c) => [
    // Enslavement and Indigenous carry a trailing footnote marker.
    c[0].replace("ᵃ", "").trim(),
    {
      anchor: idsIn(c[1])[0],
      parent: c[2] === "—" || c[2] === "" ? null : c[2],
      alsoReturns: c[3].split(",").map((s) => s.trim()).filter(Boolean),
    },
  ]),
);

/**
 * group -> stray ids, unioned across rows.
 *
 * A group can own several rows (Wills, Government Pensions) and a row can list
 * several ids. Ids are read from column 2 only: the *Actually under* column
 * carries backticked ids of its own (`Vital › Death \`124443›104898\``), and
 * reading the whole row would silently inflate the count.
 */
const specStrays = new Map<string, Set<number>>();
for (const c of strayRows) {
  const g = c[0].replace("ᵃ", "").trim();
  if (!specStrays.has(g)) specStrays.set(g, new Set());
  for (const id of idsIn(c[1])) specStrays.get(g)!.add(id);
}

describe("the spec's group tables and the shipped vocabulary agree", () => {
  // The extraction is regex over prose, so it must be shown to have found
  // something before anything is compared against it. Without these, a renamed
  // heading turns every assertion below into a comparison of two empty sets,
  // which passes and reads as coverage.
  it("parses both tables out of the spec at all", () => {
    expect(
      groupRows.length,
      "no rows parsed from the spec's group table — if its header or column order " +
        "changed, fix this parser rather than deleting the test",
    ).toBe(47);
    expect(
      strayRows.length,
      "no rows parsed from the spec's strays table — see the note above",
    ).toBe(16);
    const strayIds = new Set([...specStrays.values()].flatMap((s) => [...s]));
    expect(strayIds.size, "expected 20 distinct stray ids in the spec").toBe(20);
    expect(
      [...specGroups.values()].filter((g) => Number.isNaN(g.anchor) || g.anchor == null),
      "every group row must yield a backticked 6-digit anchor",
    ).toEqual([]);
  });

  it("lists exactly the groups the code ships, with the same anchor and parent", () => {
    const fromSpec = [...specGroups.entries()]
      .map(([name, g]) => `${name}|${g.anchor}|${g.parent ?? "—"}`)
      .sort();
    const fromCode = RECORD_TYPE_GROUP_TABLE.map(
      (g) => `${g.name}|${g.anchor}|${g.parent ?? "—"}`,
    ).sort();
    expect(fromSpec).toEqual(fromCode);
  });

  it("assigns each group the same strays as the code", () => {
    const norm = (m: Map<string, Set<number>>) =>
      [...m.entries()]
        .map(([name, ids]) => `${name}|${[...ids].sort((a, b) => a - b).join(",")}`)
        .sort();
    const codeStrays = new Map<string, Set<number>>();
    for (const g of RECORD_TYPE_GROUP_TABLE) {
      if (g.strays?.length) codeStrays.set(g.name, new Set(g.strays));
    }
    expect(norm(specStrays)).toEqual(norm(codeStrays));
  });

  // The one column nothing else reads. It is the reader-facing claim that
  // selecting `Government` also gets you Tax and Prison, and it is exactly the
  // transitive closure of the Parent column — so it can rot without any other
  // check noticing.
  // Structural, not a spec comparison: the runtime guard in `descendantsOf` only
  // walks into a cycle reachable from the group being queried, so a corrupt row
  // elsewhere would never surface. This is the check that fires whatever is asked.
  it("gives every group a parent chain that terminates at a root", () => {
    expect(() => assertAcyclicTable()).not.toThrow();
  });

  it("states 'Also returns' as the full set of nested groups", () => {
    const descendants = (name: string) =>
      [...specGroups.entries()]
        .filter(([, g]) => {
          let cur = g.parent;
          while (cur) {
            if (cur === name) return true;
            cur = specGroups.get(cur)?.parent ?? null;
          }
          return false;
        })
        .map(([n]) => n)
        .sort();
    const wrong = [...specGroups.entries()]
      .filter(([name, g]) => {
        const stated = [...g.alsoReturns].sort();
        const actual = descendants(name);
        return stated.length !== actual.length || stated.some((s, i) => s !== actual[i]);
      })
      .map(([name, g]) => `${name}: states [${g.alsoReturns}], nests [${descendants(name)}]`);
    expect(wrong).toEqual([]);
  });

  // Derived from the parsed tables rather than hardcoded: 47 anchors + 20 strays
  // is the same number the spec states, and pinning the literal here would just
  // add a fourth place to edit for one deliberate vocabulary change.
  it("sends every anchor and every stray, and nothing else", () => {
    const expected = new Set([
      ...[...specGroups.values()].map((g) => g.anchor),
      ...[...specStrays.values()].flatMap((s) => [...s]),
    ]);
    const sent = new Set(conceptIdsForGroups(RECORD_TYPE_GROUP_NAMES));
    expect([...sent].sort((a, b) => a - b)).toEqual(
      [...expected].sort((a, b) => a - b),
    );
  });
});

describe("the tool's advertised descriptions match the spec's schema block", () => {
  // No other check covers description text: manifest.json carries names only,
  // readme-catalog.test.ts is presence-only by design, and prompt-budget.test.ts
  // reads SKILL.md/agent bodies. That gap is why three of these descriptions
  // drifted into disagreement with each other before this PR.
  // Bounded at the next `## ` heading rather than running to the end of the file.
  // The tail is 24,056 characters where this section is 2,705, and an unbounded
  // slice lets a description deleted from the schema block still be "found"
  // further down the spec: delete `endYear`'s description from the block, leave
  // the same sentence in the tail as prose, and the unbounded version PASSES —
  // the count check below cannot see it either, because prose carries no second
  // `description: "` token. Measured, not reasoned about. Bounded, it fails.
  // A `-1` (Tool schema last in the file) falls back to the tail, since
  // `slice(start, -1)` would silently drop a character instead.
  const schemaStart = spec.indexOf("## Tool schema");
  const schemaEnd = spec.indexOf("\n## ", schemaStart + 1);
  const schemaBlock = spec.slice(schemaStart, schemaEnd === -1 ? undefined : schemaEnd);

  function describedStrings(node: unknown, out: string[] = []): string[] {
    if (node && typeof node === "object") {
      const rec = node as Record<string, unknown>;
      if (typeof rec.description === "string") out.push(rec.description);
      for (const v of Object.values(rec)) describedStrings(v, out);
    }
    return out;
  }

  it("finds descriptions to check on both sides", () => {
    const found = describedStrings(volumeSearchSchema);
    expect(found.length, "no description strings found on volumeSearchSchema").toBeGreaterThan(3);
    expect(schemaBlock.length, "no '## Tool schema' section found in the spec").toBeGreaterThan(500);
  });

  // The spec wraps its TS block at ~80 columns, so compare on collapsed
  // whitespace with the `" +` string-concatenation joins removed.
  const flat = schemaBlock.replace(/"\s*\+\s*\n\s*"/g, "").replace(/\s+/g, " ");

  it("quotes every advertised description verbatim in the spec", () => {
    const missing = describedStrings(volumeSearchSchema)
      .filter((d) => !flat.includes(d.replace(/\s+/g, " ")))
      .map((d) => d.slice(0, 70) + "…");
    expect(
      missing,
      "these descriptions are advertised by the tool but appear nowhere in the " +
        "spec's `## Tool schema` block — reword both sides or neither",
    ).toEqual([]);
  });

  // The other direction. Without this, the spec's block could keep documenting a
  // property the tool no longer advertises and the check above would still pass,
  // since it only walks outwards from the code.
  it("documents no description the tool does not advertise", () => {
    const declaredInSpec = (flat.match(/description: "/g) ?? []).length;
    expect(
      declaredInSpec,
      "the spec's `## Tool schema` block declares a different number of " +
        "descriptions than the tool advertises — one side gained or lost a " +
        "property without the other",
    ).toBe(describedStrings(volumeSearchSchema).length);
  });
});

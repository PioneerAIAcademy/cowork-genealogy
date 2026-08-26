import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ALL_WARNING_TAGS } from "../../src/tools/person-warnings.js";

// Contract: docs/specs/person-warnings-tool-spec.md § "Tag Catalogue".
//
// The spec documents the tool's warning tags as a human-reviewed catalogue;
// `ALL_WARNING_TAGS` in src/tools/person-warnings.ts states the same tags as the
// data the tool emits. Nothing compared them — CLAUDE.md holds that "a live tool
// must have a live spec", but no CI job enforces it, so the spec drifted to
// documenting three warnings the tool never emitted while the tool grew to 74
// FamilySearch tags (issue: person-warnings spec/impl reconciliation). This is
// that lint. Modeled on record-type-group-drift.test.ts; ADR-0008 tier 3 (Lint):
// the prose copy cannot be eliminated because prose is what the genealogists
// review, so it gets a lint instead.
//
// Three-way, because ALL_WARNING_TAGS is hand-maintained and could itself drift
// from the emit sites: (1) the array equals the tags actually emitted at
// `issueType:` sites in the source, and (2) the array equals the spec catalogue,
// checked in both directions. (1) keeps the array honest so (2) means what it
// claims.

const here = dirname(fileURLToPath(import.meta.url));
const specPath = join(
  here,
  "..",
  "..",
  "..",
  "..",
  "..",
  "docs",
  "specs",
  "person-warnings-tool-spec.md",
);
const toolPath = join(here, "..", "..", "src", "tools", "person-warnings.ts");
const spec = readFileSync(specPath, "utf8");
const toolSrc = readFileSync(toolPath, "utf8");

const shipped = new Set<string>(ALL_WARNING_TAGS);

/** Tags emitted at `issueType: CONST` sites, resolved through the const map. */
function emittedTags(): Set<string> {
  const constMap = new Map(
    [...toolSrc.matchAll(/const ([A-Z_0-9]+) = "([a-z][A-Za-z0-9_]*)";/g)].map(
      (m) => [m[1], m[2]] as const,
    ),
  );
  const out = new Set<string>();
  for (const m of toolSrc.matchAll(/issueType:\s*([A-Z_0-9]+)/g)) {
    const val = constMap.get(m[1]);
    if (val) out.add(val);
  }
  return out;
}

/** Tags in column 1 of any table row inside the § Tag Catalogue section. */
function catalogueTags(): Set<string> {
  const start = spec.indexOf("### Tag Catalogue");
  // Bounded at the next `## ` (H2) heading so a backticked tag mentioned later
  // in the file (e.g. in Extensibility) can't be counted as documented here.
  const end = spec.indexOf("\n## ", start + 1);
  const section = spec.slice(start, end === -1 ? undefined : end);
  const out = new Set<string>();
  // Column-1 only: anchored at line start, tag immediately followed by the `|`
  // cell separator. The Rule/Cause/Mirrors cells also carry backticked tags, but
  // those are mid-cell and never match this anchor.
  for (const m of section.matchAll(/^\|\s*`([a-z][A-Za-z0-9_]*)`\s*\|/gm)) {
    out.add(m[1]);
  }
  return out;
}

describe("person-warnings spec catalogue and the shipped tags agree", () => {
  // The extraction is regex over prose/source, so it must be shown to have found
  // something before anything is compared against it. Without these, a renamed
  // heading or a broken pattern turns every assertion below into a comparison of
  // empty sets, which passes and reads as coverage.
  it("finds the tags to compare on all three sides", () => {
    expect(shipped.size, "ALL_WARNING_TAGS is empty or lost entries").toBe(74);
    expect(
      catalogueTags().size,
      "no tag rows parsed from the spec's § Tag Catalogue — if its heading or " +
        "table shape changed, fix this parser rather than deleting the test",
    ).toBe(74);
    expect(
      emittedTags().size,
      "no `issueType:` emit sites parsed from person-warnings.ts",
    ).toBe(74);
  });

  // (1) Keeps the hand-maintained array honest: it must be exactly the tags the
  // tool actually emits, so the spec comparison below is a comparison against
  // real behaviour and not against a second list that can rot in parallel.
  it("ALL_WARNING_TAGS equals the tags emitted at issueType sites", () => {
    const emitted = emittedTags();
    expect([...shipped].sort()).toEqual([...emitted].sort());
  });

  // (2a) Every shipped tag is documented. Break it: rename a tag value in the
  // tool (e.g. hasEventAfterDeath1 -> hasEventAfterDeathX) and this fails.
  it("documents every shipped tag in the spec catalogue", () => {
    const cat = catalogueTags();
    const undocumented = [...shipped].filter((t) => !cat.has(t)).sort();
    expect(
      undocumented,
      "these tags are emitted by the tool but appear in no § Tag Catalogue row",
    ).toEqual([]);
  });

  // (2b) The other direction. Break it: delete a row from the catalogue and this
  // fails. Without it the spec could keep naming a retired tag and (2a) would
  // still pass, since it only walks outward from the code.
  it("names no catalogue tag the tool does not emit", () => {
    const extra = [...catalogueTags()].filter((t) => !shipped.has(t)).sort();
    expect(
      extra,
      "these tags are documented in § Tag Catalogue but the tool emits no such tag",
    ).toEqual([]);
  });
});

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ALL_WARNING_TAGS } from "../../src/tools/person-warnings.js";
import { GATE_EXEMPT_TYPES } from "../../src/validation/introduced-warnings.js";

// Contract: docs/specs/person-warnings-tool-spec.md § "Tag Catalogue".
//
// The spec documents the tool's warning tags as a human-reviewed catalogue;
// `ALL_WARNING_TAGS` in src/tools/person-warnings.ts states the same tags as the
// data the tool emits. Nothing compared them — CLAUDE.md holds that "a live tool
// must have a live spec", but no CI job enforces it, so the spec drifted to
// documenting three warnings the tool never emitted while the tool grew to 77
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
  for (const m of toolSrc.matchAll(
    /issueType:\s*(?:([A-Z_0-9]+)|"([a-z][A-Za-z0-9_]*)")/g,
  )) {
    const val = m[1] ? constMap.get(m[1]) : m[2];
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
    expect(shipped.size, "ALL_WARNING_TAGS is empty or lost entries").toBe(82);
    expect(
      catalogueTags().size,
      "no tag rows parsed from the spec's § Tag Catalogue — if its heading or " +
        "table shape changed, fix this parser rather than deleting the test",
    ).toBe(82);
    expect(
      emittedTags().size,
      "no `issueType:` emit sites parsed from person-warnings.ts",
    ).toBe(82);
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

  // (3) Every gate exemption names a tag the tool actually emits.
  //
  // `GATE_EXEMPT_TYPES` is matched against `issueType` by string equality, so a
  // misspelled or mis-cased entry exempts NOTHING and the gate keeps refusing
  // the write the entry was added to let through. Nothing caught that: the
  // type is `string`, the two drift arms above walk the code/spec pair and
  // never look at the exempt set, and an exemption that does nothing is
  // invisible until someone re-measures the fire rate. The set grew from 5 to
  // 22 when the gate began seeing parentage edges, which is when a silent
  // no-op started costing real refusals.
  it("exempts only tags the tool actually emits", () => {
    const unknown = [...GATE_EXEMPT_TYPES].filter((t) => !shipped.has(t)).sort();
    expect(
      unknown,
      "these GATE_EXEMPT_TYPES entries match no tag the tool emits, so they exempt nothing",
    ).toEqual([]);
  });

  // (4) A relative/gendered form is exempt iff its self form is.
  //
  // The rule GATE_EXEMPT_TYPES states about itself. A relative form is the
  // same predicate at the same severity evaluated from a different anchor, so
  // a split pair means one write refuses and an identical one does not,
  // depending only on which end of the edge the agent happened to anchor on.
  // The rule was prose in a comment, and prose does not fail CI: four pairs
  // were split (`deathRangeGreaterThan2`, `hasEventBeforeChristening365_3`,
  // `relativesHasEventBeforeBirth365_2`, `relativesTooManyBirthDates2`), one
  // of them refusing a write in a released run log. Derived from
  // ALL_WARNING_TAGS rather than listed, so a new tag pair is covered the day
  // it lands.
  //
  // Deliberate exception: `earliestChildBirthToBirth12` and its relative form
  // travel together but are both GATING, unlike their cutoff-14 siblings —
  // at cutoff 12 the tag is the only check that fires when a child is born
  // before their parent. That is a pair agreeing, so the rule still holds.
  const GENDERS = ["male", "female"] as const;

  /** The self form of a relative-form tag, or null if there is no such tag. */
  function selfFormOf(relTag: string, byLower: Map<string, string>): string | null {
    const m = relTag.match(/^(male|female)?[Rr]elatives(.+)$/);
    if (!m) return null;
    const gender = m[1] ?? "";
    const rest = m[2];
    const Cap = gender ? gender[0].toUpperCase() + gender.slice(1) : "";
    // The self spelling puts the gender in one of three places, and all three
    // are in use: `earliestChildBirthToBirthMale14` (before the number),
    // `hasDiffSurnameMale` (at the end), `femaleRelatives…` → none.
    const candidates = [rest, gender + rest, rest + Cap];
    const num = rest.match(/^(.*?)(\d+(?:_\d+)?)$/);
    if (num && gender) candidates.push(num[1] + Cap + num[2]);
    for (const c of candidates) {
      const hit = byLower.get(c.toLowerCase());
      if (hit) return hit;
    }
    return null;
  }

  function relativePairs(): Array<[string, string]> {
    const byLower = new Map([...shipped].map((t) => [t.toLowerCase(), t]));
    const out: Array<[string, string]> = [];
    for (const t of shipped) {
      if (!/^(?:male|female)?[Rr]elatives/.test(t)) continue;
      const self = selfFormOf(t, byLower);
      if (self && self !== t) out.push([t, self]);
    }
    return out;
  }

  it("finds the relative/self pairs to compare", () => {
    // Same reason as the parse guards above: an empty pair list passes (4)
    // vacuously. 28 of the 29 tags matching /relatives/i pair up;
    // `missingFactsAndRelatives` is a self-form tag that merely contains the
    // word, and correctly finds no partner.
    const pairs = relativePairs();
    // A FLOOR, not an equality. The job here is to catch a derivation that has
    // stopped matching — a renamed tag, a changed spelling, a broken regex —
    // which shows up as zero or a collapse, not as growth. Pinned exactly, a
    // correctly ADDED tag pair would red this test for doing the right thing.
    expect(pairs.length, "no relative/self tag pairs derived").toBeGreaterThanOrEqual(28);
    expect(pairs.map(([r]) => r)).not.toContain("missingFactsAndRelatives");
    // The derivation handles all three gender placements, not just the plain
    // `relativesX` case — the two irregular spellings must be found.
    expect(pairs).toEqual(
      expect.arrayContaining([
        ["maleRelativesHasDiffSurname", "hasDiffSurnameMale"],
        ["femaleRelativesEarliestChildBirthToBirth14", "earliestChildBirthToBirthFemale14"],
      ]),
    );
    expect(GENDERS.length).toBe(2);
  });

  it("exempts a relative form iff it exempts the self form", () => {
    const split = relativePairs()
      .filter(([r, s]) => GATE_EXEMPT_TYPES.has(r) !== GATE_EXEMPT_TYPES.has(s))
      .map(([r, s]) =>
        `${r} (${GATE_EXEMPT_TYPES.has(r) ? "exempt" : "gating"}) vs ` +
        `${s} (${GATE_EXEMPT_TYPES.has(s) ? "exempt" : "gating"})`,
      )
      .sort();
    expect(
      split,
      "these pairs are the same predicate from a different anchor, so one " +
        "write refuses and an identical one lands. Exempt both or neither",
    ).toEqual([]);
  });
});

import { describe, it, expect } from "vitest";
import {
  assertAcyclicTable,
  RECORD_TYPE_GROUPS,
  RECORD_TYPE_GROUP_NAMES,
  RECORD_TYPE_GROUP_TABLE,
  conceptIdsForGroups,
} from "../../src/utils/record-type-groups.js";

/**
 * These assertions exist because nothing else can catch a mis-transcribed row.
 *
 * The companion probe's `reach` section looks like a guard and is not: every stray
 * sits under a group anchor already in the set, so the OR union — and therefore the
 * reach percentage — is identical whether the strays are present or missing
 * entirely. Dropping Baptism's 127575 loses roughly 208,000 volumes from that
 * group's results while typecheck, the tool suite and `reach` all stay green.
 *
 * The ids themselves are pinned against docs/specs/volume-search-tool-spec.md's
 * group and strays tables by tests/packaging/record-type-group-drift.test.ts,
 * which parses both. What is left here is what parsing those tables cannot
 * express: that the expansion sends an anchor's strays and nothing extra, that
 * broadening to a parent never loses ids, that every parent names a real group,
 * and that no presentational marker reaches an enum value.
 */
describe("record-type group vocabulary", () => {
  it("exposes one lookup entry per enum literal, with no duplicates", () => {
    // The counts themselves (47 groups, 67 ids) are not pinned here — they are
    // derived from the spec's own tables by
    // tests/packaging/record-type-group-drift.test.ts. Hardcoding them again
    // would make one deliberate vocabulary change a four-file edit.
    expect(RECORD_TYPE_GROUPS.size).toBe(RECORD_TYPE_GROUP_NAMES.length);
    expect(new Set(RECORD_TYPE_GROUP_NAMES).size).toBe(RECORD_TYPE_GROUP_NAMES.length);
  });

  it("carries no presentational marker in an enum literal", () => {
    // The spec's table footnotes Enslavement and Indigenous with a superscript;
    // it is presentation, and must not reach the wire value callers pass in.
    for (const name of RECORD_TYPE_GROUP_NAMES) {
      expect(name).toBe(name.trim());
      expect(name).toMatch(/^[A-Za-z][A-Za-z ]*$/);
    }
  });

  it("expands a group to exactly its anchor plus its own strays", () => {
    // The drift guard compares the table's `strays` *field* against the spec.
    // This is the other half: that the *expansion* sends those ids and nothing
    // else — no descendant anchor leaking in, no id dropped. Passports is the
    // shortest row exercising an anchor with multiple strays.
    expect(conceptIdsForGroups(["Passports"]).sort((a, b) => a - b)).toEqual(
      [124216, 124432, 124442, 131572].sort((a, b) => a - b)
    );
  });

  it("names a parent that is itself a group, or null for a root", () => {
    const names = new Set(RECORD_TYPE_GROUP_NAMES);
    for (const group of RECORD_TYPE_GROUP_TABLE) {
      if (group.parent !== null) expect(names.has(group.parent)).toBe(true);
    }
    // The root *count* is not pinned here; the drift guard derives it from the
    // spec's Parent column. What matters locally is that no parent dangles.
    expect(RECORD_TYPE_GROUP_TABLE.some((g) => g.parent === null)).toBe(true);
  });

  it("unions anchors and strays without duplicates across groups", () => {
    const ids = conceptIdsForGroups(["Legal", "Court", "Probate"]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(122797);
    expect(ids).toContain(127571); // Court's stray
  });

  it("names every bad entry, including null and undefined", () => {
    // `["Tax", null].join(", ")` renders the null as an empty string, so a raw
    // join would name nothing at all — the opposite of reporting every bad
    // entry in one throw, which is why the message is plural.
    expect(() =>
      conceptIdsForGroups(["Tax", null] as unknown as string[])
    ).toThrow(/Unknown record-type group\(s\): null\./);
    expect(() =>
      conceptIdsForGroups(["Tax", undefined] as unknown as string[])
    ).toThrow(/Unknown record-type group\(s\): undefined\./);
    expect(() =>
      conceptIdsForGroups(["Nope", 42] as unknown as string[])
    ).toThrow(/Unknown record-type group\(s\): Nope, 42\./);
  });

  it("every parent chain terminates at a root", () => {
    // Whole-table check. `descendantsOf` only walks into cycles reachable from
    // the group being queried, so a corrupt row elsewhere would not surface at
    // runtime; this is the check that fails regardless of what is asked for.
    expect(() => assertAcyclicTable()).not.toThrow();
  });

  it("throws on an unknown name rather than quietly widening the search", () => {
    // volume_search validates before calling this, but a future caller that did
    // not would otherwise get a silently broader result set.
    expect(() => conceptIdsForGroups(["Tax", "NotAGroup"])).toThrow(
      /Unknown record-type group\(s\): NotAGroup/
    );
    expect(conceptIdsForGroups([])).toEqual([]);
  });

  it("carries descendants' strays so broadening never loses volumes", () => {
    // Selecting a parent must return at least what its children return.
    // Prison's 130086/126416 are filed under Legal, so containment from
    // Government never reaches them; without the union, broadening from Prison
    // to Government silently dropped the criminal-record volumes.
    const government = conceptIdsForGroups(["Government"]);
    for (const id of [130086, 126416, 129065, 124432, 124442, 131572, 126869, 124383]) {
      expect(government).toContain(id);
    }
    // The descendant's own anchor is not sent — upstream containment covers it.
    expect(government).not.toContain(123478);
  });
});

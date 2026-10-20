import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RESEARCH_APPEND_SECTIONS } from "../../src/tools/research-append.js";

/** A section `ownership.json` says `research_append` writes must be WRITABLE by it.
 *
 * `rejected_links` shipped in the internal SECTIONS map (so the id prefix and the
 * timestamp stamp were right) and in ownership.json as a `research_append` section —
 * but not in RESEARCH_APPEND_SECTIONS, which is what both advertised `section` enums are
 * built from. So the tool refused every call naming it, nothing could create a rejection,
 * and the whole re-link refusal it exists for could never fire. Every test seeded the
 * array by hand, so the suite stayed green.
 *
 * This is the general guard, not a second one-off for that one section: any future
 * section added to the ownership manifest and forgotten in the enum fails here.
 */
const OWNERSHIP = join(__dirname, "..", "..", "..", "..", "..", "docs", "specs", "schemas", "ownership.json");

type Row = { artifact?: string; section?: string; writerTools?: string[] };

function rows(): Row[] {
  const raw = JSON.parse(readFileSync(OWNERSHIP, "utf-8")) as Row[] | Record<string, Row[]>;
  const list = Array.isArray(raw) ? raw : (raw.rows ?? raw.ownership ?? []);
  expect(list.length, "the ownership manifest parsed to no rows — this suite reads nothing").toBeGreaterThan(0);
  return list;
}

describe("ownership manifest vs the research_append section enum", () => {
  it("every research.json section research_append owns is in its advertised enum", () => {
    const owned = rows()
      .filter((r) => r.artifact === "research.json" && (r.writerTools ?? []).includes("research_append"))
      .map((r) => r.section as string);
    expect(owned.length, "no research_append-owned sections found — the filter is wrong").toBeGreaterThan(0);

    const advertised = new Set<string>(RESEARCH_APPEND_SECTIONS as readonly string[]);
    const unreachable = owned.filter((s) => !advertised.has(s)).sort();
    expect(
      unreachable,
      "ownership.json says research_append writes these, but they are absent from " +
        "RESEARCH_APPEND_SECTIONS, so every call naming one is refused:\n" +
        unreachable.map((s) => `  - ${s}`).join("\n"),
    ).toEqual([]);
  });

  it("does not advertise a section the manifest gives no owner row", () => {
    // The other direction: an enum entry with no ownership row is a section nobody is
    // recorded as owning, which the packaging suite elsewhere requires.
    const known = new Set(rows().filter((r) => r.artifact === "research.json").map((r) => r.section));
    const orphans = (RESEARCH_APPEND_SECTIONS as readonly string[])
      .filter((s) => s !== "project" && s !== "researcher_profile" && !known.has(s))
      .sort();
    expect(orphans, `advertised with no ownership row: ${orphans.join(", ")}`).toEqual([]);
  });
});

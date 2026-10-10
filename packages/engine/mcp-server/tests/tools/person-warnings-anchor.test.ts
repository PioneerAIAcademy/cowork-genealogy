import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { personWarningsTool } from "../../src/tools/person-warnings.js";

// Anchor lookup (issue #2942): a tree id, or a FamilySearch id that one tree
// person's `ark` links to. init-project keys imported persons I1, I2… and keeps
// the FamilySearch id in `ark`, so a caller holding only the FamilySearch id
// (source-evaluation) still reaches them.
const noPlaces = { placeCoords: async () => null };

function person(id: string, ark: string | undefined, facts: object[]) {
  return {
    id,
    ...(ark !== undefined ? { ark } : {}),
    gender: "Male",
    names: [{ id: `N-${id}`, given: "Christian", surname: "Hole" }],
    facts,
  };
}

// A person with no facts and no relatives fires missingFactsAndRelatives under
// their own id, which shows which person was anchored; one fact keeps it quiet.
const EMPTY: object[] = [];
const ONE_FACT = [{ id: "F1", type: "Birth", date: "1875", standard_date: "1875" }];
const FIRES = "missingFactsAndRelatives";

describe("person_warnings anchor lookup", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "pw-anchor-"));
    await writeFile(join(dir, "research.json"), JSON.stringify({ project: { id: "rp_001" } }), "utf-8");
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function treeOf(persons: object[]) {
    await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify({ persons, relationships: [], sources: [] }), "utf-8");
  }

  async function anchorOf(personId: string) {
    const r = await personWarningsTool({ projectPath: dir, personId }, noPlaces);
    if (!("warnings" in r)) throw new Error("expected warnings");
    return r.warnings.map((w) => [w.personId, w.issueType]);
  }

  it("finds the person by tree id", async () => {
    await treeOf([person("I1", "ark:/61903/4:1:KD96-TV2", EMPTY)]);
    expect(await anchorOf("I1")).toEqual([["I1", FIRES]]);
  });

  it("finds the person by the FamilySearch id in their ark, in every spelling", async () => {
    for (const ark of [
      "ark:/61903/4:1:KD96-TV2",
      "https://familysearch.org/ark:/61903/4:1:KD96-TV2",
      "https://www.familysearch.org/ark:/61903/4:1:KD96-TV2?lang=en",
      "4:1:KD96-TV2",
    ]) {
      await treeOf([person("I1", ark, EMPTY)]);
      expect(await anchorOf("KD96-TV2"), ark).toEqual([["I1", FIRES]]);
    }
  });

  it("prefers a tree id over another person's ark", async () => {
    await treeOf([
      person("KD96-TV2", undefined, ONE_FACT),
      person("I1", "ark:/61903/4:1:KD96-TV2", EMPTY),
    ]);
    expect(await anchorOf("KD96-TV2")).toEqual([]);
  });

  it("does not match a record-persona ark or a longer id", async () => {
    for (const ark of ["ark:/61903/1:1:KD96-TV2", "ark:/61903/4:1:KD96-TV22"]) {
      await treeOf([person("I1", ark, EMPTY)]);
      await expect(personWarningsTool({ projectPath: dir, personId: "KD96-TV2" }, noPlaces)).rejects.toThrow(
        "Person 'KD96-TV2' not found",
      );
    }
  });

  it("refuses an id linked to two persons rather than picking one", async () => {
    await treeOf([
      person("I1", "ark:/61903/4:1:KD96-TV2", EMPTY),
      person("I5", "https://familysearch.org/ark:/61903/4:1:KD96-TV2", []),
    ]);
    await expect(personWarningsTool({ projectPath: dir, personId: "KD96-TV2" }, noPlaces)).rejects.toThrow(
      /linked to more than one person .*\(I1, I5\)/,
    );
  });
});

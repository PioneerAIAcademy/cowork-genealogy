import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
  personWarningsTool,
  personIdsOf,
  problemKey,
  MAX_PERSONS,
} from "../../src/tools/person-warnings.js";
import type { PlaceCoordsResolver } from "../../src/utils/place-coords.js";
import type { PersonWarningsList, PersonWarningsFound } from "../../src/types/person-warnings.js";

// person_warnings' list form (#3713): one call checks several anchors, with the
// four protections a list needs -- per-id errors, one shared place-lookup budget
// reported per anchor, problem-level de-duplication, and the single-id call
// unchanged.

// A son (I1) born 1850 to a father (I2) born 1840 who died 1845 and has a
// residence in 1870: the father's problems surface from BOTH circles, under
// different tags. I3 is unrelated and clean.
function family(extraFather: object[] = []) {
  return {
    persons: [
      { id: "I1", gender: "Male", names: [{ id: "N1", given: "Son", surname: "T" }],
        facts: [{ id: "F1", type: "Birth", date: "1850", standard_date: "1850" }] },
      { id: "I2", gender: "Male", names: [{ id: "N2", given: "Dad", surname: "T" }],
        facts: [
          { id: "F2", type: "Birth", date: "1840", standard_date: "1840" },
          { id: "F3", type: "Death", date: "1845", standard_date: "1845" },
          { id: "F4", type: "Residence", date: "1870", standard_date: "1870" },
          ...extraFather,
        ] },
      { id: "I3", gender: "Female", names: [{ id: "N3", given: "Other", surname: "U" }],
        facts: [{ id: "F9", type: "Birth", date: "1900", standard_date: "1900" }] },
    ],
    relationships: [{ id: "R1", type: "ParentChild", parent: "I2", child: "I1" }],
    sources: [],
  };
}

const noPlaces: { placeCoords: PlaceCoordsResolver } = { placeCoords: async () => null };

describe("person_warnings list form", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "pw-list-"));
    await writeFile(join(dir, "research.json"), JSON.stringify({ project: { id: "rp_001" } }), "utf-8");
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function tree(t: object) {
    await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify(t), "utf-8");
  }

  it("leaves the single-id call exactly as it was: no `results`, the anchor's own warnings", async () => {
    await tree(family());
    const single = (await personWarningsTool({ projectPath: dir, personId: "I2" }, noPlaces)) as PersonWarningsFound;
    expect(single).not.toHaveProperty("results");
    expect(single.warningCount).toBe(single.warnings.length);
    expect(single.warnings.map((w) => w.issueType)).toContain("hasEventAfterDeath1");
  });

  it("answers one entry per id, in request order, from a real list or a JSON-array string", async () => {
    await tree(family());
    for (const personId of [["I3", "I2"], '["I3","I2"]']) {
      const r = (await personWarningsTool({ projectPath: dir, personId: personId as any }, noPlaces)) as PersonWarningsList;
      expect(r.results.map((e) => e.personId)).toEqual(["I3", "I2"]);
      expect(r.results[0]).toMatchObject({ warningCount: 0, warnings: [], alreadyReported: 0 });
      expect(r.results[1].warnings!.map((w) => w.issueType)).toContain("hasEventAfterDeath1");
    }
  });

  it("protection 1: an id not in the tree answers its own error and the rest still answer", async () => {
    await tree(family());
    const r = (await personWarningsTool({ projectPath: dir, personId: ["I01", "I2"] }, noPlaces)) as PersonWarningsList;
    expect(r.results[0].personId).toBe("I01");
    expect(r.results[0].error).toMatch(/not found/);
    expect(r.results[0]).not.toHaveProperty("warnings");
    expect(r.results[1].warnings!.length).toBeGreaterThan(0);
  });

  it("protection 3: the same problem seen from two circles is reported once, and counted", async () => {
    await tree(family());
    const r = (await personWarningsTool({ projectPath: dir, personId: ["I1", "I2"] }, noPlaces)) as PersonWarningsList;
    const [son, dad] = r.results;
    // The son's circle already surfaced the father's parenthood and death-before-birth
    // problems (as `relatives*` tags); from the father only the residence after
    // death is new.
    expect(son.warningCount).toBeGreaterThan(0);
    expect(dad.warnings!.map((w) => w.issueType)).toEqual(["hasEventAfterDeath1"]);
    expect(dad.alreadyReported).toBe(4);
    expect(r.warningCount).toBe(son.warningCount! + dad.warningCount!);
    // Order decides who carries it, never whether it is counted.
    const rev = (await personWarningsTool({ projectPath: dir, personId: ["I2", "I1"] }, noPlaces)) as PersonWarningsList;
    expect(rev.warningCount).toBe(r.warningCount);
  });

  it("protection 3 keeps different problems apart: same people, different facts", async () => {
    const a = { scoreType: "COHERENCE", issueType: "hasDeathBeforeChildBirth30_10", severity: "contradiction" as const,
      personId: "I2", personName: "Dad", message: "m", relatedPersonId: "I1",
      facts: [{ id: "F3", type: "Death", date: "1845" }, { id: "F1", type: "Birth", date: "1850" }] };
    const sameProblem = { ...a, issueType: "relativesHasDeathBeforeChildBirth30_10" };
    const swapped = { ...a, issueType: "maleRelativesEarliestChildBirthToBirth14", personId: "I1", relatedPersonId: "I2" };
    const male = { ...a, issueType: "earliestChildBirthToBirthMale14" };
    expect(problemKey(sameProblem)).toBe(problemKey(a));
    expect(problemKey(swapped)).toBe(problemKey(male));
    expect(problemKey({ ...a, facts: [a.facts[0]] })).not.toBe(problemKey(a));
    expect(problemKey({ ...a, relatedPersonId: "I9" })).not.toBe(problemKey(a));
    expect(problemKey({ ...a, issueType: "hasDeathBeforeChildBirth365_2" })).not.toBe(problemKey(a));
  });

  describe("protection 2: one shared place-lookup budget, reported per anchor", () => {
    // Two children of the same father, each with a dated birthplace and the father
    // with a residence near it in time, so each needs a lookup.
    function twoChildren() {
      const child = (id: string, place: string) => ({
        id, gender: "Male", names: [{ id: `N${id}`, given: id, surname: "T" }],
        facts: [{ id: `B${id}`, type: "Birth", date: "1870", standard_date: "1870", place, standard_place: place }],
      });
      return {
        persons: [
          child("I1", "Here, Testshire, England"),
          child("I4", "There, Testshire, England"),
          { id: "I2", gender: "Male", names: [{ id: "N2", given: "Dad", surname: "T" }],
            facts: [{ id: "R2", type: "Residence", date: "1871", standard_date: "1871",
              place: "Home, Testshire, England", standard_place: "Home, Testshire, England" }] },
          { id: "I3", gender: "Female", names: [{ id: "N3", given: "Other", surname: "U" }], facts: [] },
        ],
        relationships: [
          { id: "R1", type: "ParentChild", parent: "I2", child: "I1" },
          { id: "R4", type: "ParentChild", parent: "I2", child: "I4" },
        ],
        sources: [],
      };
    }

    it("marks an anchor `checked` when its places resolved, `not_applicable` when it needed none", async () => {
      await tree(twoChildren());
      const near: PlaceCoordsResolver = async () => ({ latitude: 0, longitude: 0 });
      const r = (await personWarningsTool({ projectPath: dir, personId: ["I1", "I3"] }, { placeCoords: near })) as PersonWarningsList;
      expect(r.results.map((e) => e.birthplaceCheck)).toEqual(["checked", "not_applicable"]);
    });

    it("says `not_checked`, never silence, when the shared budget runs out", async () => {
      await tree(twoChildren());
      let started = 0;
      const never: PlaceCoordsResolver = () => { started++; return new Promise(() => {}); };
      // Fake time, so a loaded machine cannot blur one budget into two. Only the
      // timers are faked: the tree is still read from disk.
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      try {
        let settled = false;
        const call = personWarningsTool(
          { projectPath: dir, personId: ["I1", "I4"] }, { placeCoords: never, lookupBudgetMs: 300 },
        ).then((r) => { settled = true; return r as PersonWarningsList; });
        // Waits on real time (Date is not faked), so a loaded machine only makes them longer.
        const until = async (done: () => boolean) => {
          const end = Date.now() + 5_000;
          while (!done() && Date.now() < end) await new Promise((resolve) => setImmediate(resolve));
        };
        // The budget's timer starts with the lookups, so once all three are open it is running.
        await until(() => started === 3);
        await vi.advanceTimersByTimeAsync(299);
        expect(settled).toBe(false);
        // ONE budget for the call: 300 ms settles both anchors; a budget per anchor would
        // still be waiting on a second timer the frozen clock never reaches.
        await vi.advanceTimersByTimeAsync(1);
        await until(() => settled);
        expect(settled).toBe(true);
        const r = await call;
        expect(r.results.map((e) => e.birthplaceCheck)).toEqual(["not_checked", "not_checked"]);
      } finally {
        vi.useRealTimers();
      }
      // The father's residence is shared, and each name is looked up once.
      expect(started).toBe(3);
    });
  });

  it("refuses an empty list, a mixed list, a malformed array string and more than MAX_PERSONS ids", () => {
    expect(() => personIdsOf([])).toThrow(/empty list/);
    expect(() => personIdsOf(["I1", 2])).toThrow(/non-empty id strings/);
    expect(() => personIdsOf("[I1")).toThrow(/not a JSON array/);
    const many = Array.from({ length: MAX_PERSONS + 1 }, (_, i) => `I${i}`);
    expect(() => personIdsOf(many)).toThrow(/limit is 50/);
    expect(personIdsOf(["I1", "I1"])).toEqual({ ids: ["I1"], isList: true });
    expect(personIdsOf("I1")).toEqual({ ids: ["I1"], isList: false });
  });
});

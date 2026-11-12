/**
 * Unit tests for `introducedWarnings` (issue #2840): a writer tool must refuse
 * when its write introduces genealogical warnings the caller has not justified.
 *
 * The six acceptance criteria from the issue:
 * (a) introduced warning with no justification → refuse, tree byte-identical
 * (b) same write with every id justified → lands and persists justifications
 * (c) pre-existing warning → needs no justification
 * (d) warning on a one-hop relative is caught
 * (e) merge: collapsed person's old warning needs none (remap)
 * (f) justification with stale id → refused
 */

import { describe, it, expect } from "vitest";
import {
  introducedWarnings,
  warningId,
  staleJustifications,
  computeTouchedPersonIds,
  competingParentage,
  GATE_EXEMPT_TYPES,
} from "../../src/validation/introduced-warnings.js";
import { mergeGedcomx } from "../../src/utils/merge-gedcomx.js";
import { calculateWarnings } from "../../src/tools/person-warnings.js";
import { Mob } from "../../src/utils/mob.js";
import type { SimplifiedGedcomX } from "../../src/types/gedcomx.js";

function person(id: string, given: string, surname: string, facts: any[] = []) {
  return {
    id,
    gender: "Male",
    names: [{ id: `${id}-n`, given, surname }],
    facts,
  };
}

function tree(persons: any[], relationships: any[] = []): SimplifiedGedcomX {
  return { persons, relationships, sources: [] } as unknown as SimplifiedGedcomX;
}

/** A person with an implausible lifespan (born 1800, died 2000 = 200 years). */
function implausiblePerson(id: string, given: string, surname: string) {
  return person(id, given, surname, [
    { id: `${id}-f1`, type: "Birth", date: "1800", standard_date: "1800" },
    { id: `${id}-f2`, type: "Death", date: "2000", standard_date: "2000" },
  ]);
}

/** A person with a plausible lifespan (born 1900, died 1970 = 70 years). */
function plausiblePerson(id: string, given: string, surname: string) {
  return person(id, given, surname, [
    { id: `${id}-f1`, type: "Birth", date: "1900", standard_date: "1900" },
    { id: `${id}-f2`, type: "Death", date: "1970", standard_date: "1970" },
  ]);
}

describe("introducedWarnings", () => {
  // A gating impossibility refuses; its christening-proxy form is exempt.
  // `hasSpouseNotAliveTogetherEstimated` is the one estimated tag that can be
  // introduced alone — the other four always co-fire a tag that already gates
  // (`earliestChildBirthToBirth12`, `hasEventAfterDeath1`, `hasEarlyMarriage14`).
  it("(a2) refuses an introduced hasChildBornBeforeParent", () => {
    const parent = person("P", "Ann", "Kos", [{ id: "PB", type: "Birth", date: "1 Jan 1820", standard_date: "1 Jan 1820" }]);
    const child = person("K", "Jan", "Kos", [{ id: "KB", type: "Birth", date: "1 Jan 1800", standard_date: "1 Jan 1800" }]);
    const before = tree([parent, child]);
    const after = tree([parent, child], [{ id: "R", type: "ParentChild", parent: "P", child: "K" }]);
    const tags = introducedWarnings(before, after, ["P", "K"]).unjustified.map((w) => w.issueType);
    expect(tags).toContain("hasChildBornBeforeParent");
  });

  it("(a3) lets an introduced hasSpouseNotAliveTogetherEstimated land", () => {
    const a = person("A", "Jan", "Kos", [{ id: "AD", type: "Death", date: "1790", standard_date: "1790" }]);
    const s = { ...person("S", "Ann", "Bor", [{ id: "SC", type: "Christening", date: "1800", standard_date: "1800" }]), gender: "Female" };
    const before = tree([a, s]);
    const after = tree([a, s], [{ id: "C", type: "Couple", person1: "A", person2: "S" }]);
    // With exemptions off the write introduces the tag; with them on it lands.
    const unexempted = introducedWarnings(before, after, ["A", "S"], undefined, undefined, false);
    expect(unexempted.unjustified.map((w) => w.issueType)).toContain("hasSpouseNotAliveTogetherEstimated");
    expect(introducedWarnings(before, after, ["A", "S"]).unjustified).toEqual([]);
  });

  it("(a) an introduced warning with no justification is unjustified", () => {
    const before = tree([plausiblePerson("I1", "John", "Smith")]);
    // After: birth changed to 1800, making lifespan 170 years
    const after = tree([implausiblePerson("I1", "John", "Smith")]);

    const result = introducedWarnings(before, after, ["I1"]);

    expect(result.unjustified.length).toBeGreaterThan(0);
    expect(result.unjustified[0].issueType).toBe("hasAgeRangeGreaterThan120");
    expect(result.unjustified[0].warningId).toBeTruthy();
  });

  it("(b) same write with every id justified → no unjustified warnings", () => {
    const before = tree([plausiblePerson("I1", "John", "Smith")]);
    const after = tree([implausiblePerson("I1", "John", "Smith")]);

    // First call to get the warning ids
    const firstResult = introducedWarnings(before, after, ["I1"]);
    expect(firstResult.unjustified.length).toBeGreaterThan(0);

    // Second call with justifications
    const justifications = firstResult.allIntroduced.map((w) => ({
      warningId: w.warningId,
      justification: "Imported as recorded on FamilySearch",
    }));
    const result = introducedWarnings(before, after, ["I1"], justifications);

    expect(result.unjustified).toHaveLength(0);
    expect(result.allIntroduced.length).toBeGreaterThan(0);
  });

  it("(c) pre-existing warning needs no justification", () => {
    // Both before and after have the implausible lifespan
    const before = tree([implausiblePerson("I1", "John", "Smith")]);
    const after = tree([implausiblePerson("I1", "John", "Smith")]);

    const result = introducedWarnings(before, after, ["I1"]);

    // No introduced warnings since it was pre-existing
    expect(result.unjustified).toHaveLength(0);
    expect(result.allIntroduced).toHaveLength(0);
  });

  it("(d) warning on a one-hop relative is caught", () => {
    // The op adds ONLY the parentage edge. I1 was already implausible before
    // it, and I2's own facts never change -- so the warning this must catch is
    // the `relatives*` form on I2, a person the write never touched directly.
    //
    // The previous version of this test made I2 ITSELF implausible and passed
    // `["I2"]`, so it fired on `hasAgeRangeGreaterThan120@I2` -- the op's own
    // person -- with the relationship inert. It passed with no relationship at
    // all, which is to say criterion (d) was never exercised. Assert the
    // specific issueType AND personId so it cannot drift back.
    const before = tree(
      [implausiblePerson("I1", "John", "Smith"), plausiblePerson("I2", "Jane", "Smith")],
      [],
    );
    const after = tree(
      [implausiblePerson("I1", "John", "Smith"), plausiblePerson("I2", "Jane", "Smith")],
      [{ id: "R1", type: "ParentChild", parent: "I1", child: "I2" }],
    );

    // Both ends must be touched by the edge write; reading only
    // `person1`/`person2` returns [] here and the write sails through.
    const touched = computeTouchedPersonIds(before, after);
    expect(touched).toEqual(expect.arrayContaining(["I1", "I2"]));

    const result = introducedWarnings(before, after, touched);
    const tags = result.unjustified.map((w) => `${w.issueType}@${w.personId}`);
    expect(tags).toContain("relativesHasAgeRangeGreaterThan120@I2");
  });

  it("(e2) merge: a contradiction NEITHER predecessor carried IS introduced", () => {
    // The reviewer's question: "introduces" reads as a comparison against the
    // pre-write state, and a merge is exactly where that gets interesting.
    //
    // The answer the code gives, asserted here so it is a contract rather than
    // a reading: a merge that SURFACES a contradiction introduces it. I1 has a
    // birth and no death; I2 has a death and no birth; each is individually
    // plausible and neither warns. Collapsing I2 into I1 gives the survivor a
    // 200-year lifespan, which is in neither before-state, so the delta finds
    // it and the writer must justify it. (e) is the converse: a warning the
    // collapsed person already carried is remapped and needs nothing.
    const before = tree([
      person("I1", "John", "Smith", [
        { id: "I1-f1", type: "Birth", date: "1800", standard_date: "1800" },
      ]),
      person("I2", "Jon", "Smith", [
        { id: "I2-f1", type: "Death", date: "2000", standard_date: "2000" },
      ]),
    ]);
    // After the collapse: one survivor carrying both facts.
    const after = tree([
      person("I1", "John", "Smith", [
        { id: "I1-f1", type: "Birth", date: "1800", standard_date: "1800" },
        { id: "I2-f1", type: "Death", date: "2000", standard_date: "2000" },
      ]),
    ]);

    const result = introducedWarnings(before, after, ["I1", "I2"], undefined, new Map([["I2", "I1"]]));
    const tags = result.unjustified.map((w) => `${w.issueType}@${w.personId}`);
    expect(tags).toContain("hasAgeRangeGreaterThan120@I1");
  });

  it("(e) merge: collapsed person's old warning needs no justification (remap)", () => {
    // Before: both I1 (survivor) and I2 (collapsed) have an implausible lifespan.
    // The merge collapses I2 into I1, keeping I1's facts — I2 disappears.
    // The warning on I1 was pre-existing, so the merge introduces nothing.
    const before = tree([
      implausiblePerson("I1", "John", "Smith"),
      implausiblePerson("I2", "Jane", "Smith"),
    ]);
    // After merge: I2 is gone, I1 (survivor) still has the same implausible dates
    const after = tree([implausiblePerson("I1", "John", "Smith")]);

    // collapseMap: I2 was collapsed into I1
    const collapseMap = new Map([["I2", "I1"]]);

    // I1's warning was pre-existing (same facts, same person) so needs none.
    // I2's warning is remapped to I1 — since I1 already had the same warning
    // type before, the delta is empty.
    const result = introducedWarnings(
      before, after, ["I1", "I2"], undefined, collapseMap,
    );

    expect(result.unjustified).toHaveLength(0);
    expect(result.allIntroduced).toHaveLength(0);
  });

  it("(e3) merge: a pre-existing warning NAMING the collapsed person needs no justification", () => {
    // The other half of (e), and the half that was broken. (e) covers a
    // warning whose `personId` is the collapsed person; this one covers a
    // warning on an untouched third party whose `relatedPersonId` is.
    //
    // `warningId` keys on BOTH id fields, and the before-side remap rewrote
    // only `personId`. So I3's pre-existing `relativesHasAgeRangeGreaterThan120`
    // keyed `...|I3|I2|...` before and `...|I3|I1|...` after, never matched,
    // and the merge was refused for a warning it did not introduce — the one
    // thing this module exists to prevent.
    const implausible = (id: string) => [
      { id: `${id}-f1`, type: "Birth", date: "1800", standard_date: "1800" },
      { id: `${id}-f2`, type: "Death", date: "2000", standard_date: "2000" },
    ];
    // I2 (to be collapsed) has the implausible lifespan; I3 is its child, so
    // I3 carries the RELATIVE form of the warning, pointing back at I2.
    const before = tree(
      [
        person("I1", "John", "Smith"),
        person("I2", "Jon", "Smith", implausible("I2")),
        person("I3", "Child", "Smith"),
      ],
      [{ id: "R1", type: "ParentChild", parent: "I2", child: "I3" }],
    );
    // After: I2 collapsed into I1, carrying its facts and its edge to I3.
    const after = tree(
      [
        person("I1", "John", "Smith", implausible("I2")),
        person("I3", "Child", "Smith"),
      ],
      [{ id: "R1", type: "ParentChild", parent: "I1", child: "I3" }],
    );

    const collapseMap = new Map([["I2", "I1"]]);

    // The fixture really does produce that warning, keyed on the collapsed
    // id — without this the test passes whenever NOTHING fires, which is
    // exactly how it would look if the fixture drifted. Computed by diffing
    // the before-tree against an empty one, so everything in it is reported.
    const seeded = introducedWarnings(tree([]), before, ["I3"]).allIntroduced
      .filter((w) => w.issueType === "relativesHasAgeRangeGreaterThan120");
    expect(seeded.map((w) => `${w.personId}->${w.relatedPersonId}`)).toContain(
      "I3->I2",
    );

    const result = introducedWarnings(
      before, after, ["I1", "I2", "I3"], undefined, collapseMap,
    );

    const tags = result.unjustified.map((w) => `${w.issueType}@${w.personId}`);
    expect(tags).not.toContain("relativesHasAgeRangeGreaterThan120@I3");
    expect(result.unjustified).toHaveLength(0);
  });

  it("(g) a pre-existing warning reachable only through the NEW edge is not introduced", () => {
    // Modelled on a real case in the committed corpus
    // (elisabetha-sugecz-parents/run-2026-08-02_12-17-10, edge
    // G4C9-Y6C→LKL8-4VC), reduced to three people.
    //
    // `checkRelativesEarliestChildBirthToBirth12` keys its warning on the
    // RELATIVE that has the problem, and emits it from every anchor that
    // relative is a relative OF. So "P had S at age 5" is surfaced by
    // anchoring on any child of P — never by anchoring on P.
    //
    // Add a second child N to P. Touched is {P, N}: before the write N is
    // connected to nothing, so the before side reaches no anchor that can
    // surface the warning, while after the write anchoring on N surfaces it.
    // A warning P has carried all along then reads as introduced, and the
    // write is refused for it. Widening by one hop puts S — P's other child —
    // in the computed set, where the before side finds it and subtracts it.
    //
    // 18 of 83 refused parentage edges across the committed corpus were this;
    // re-derive with `dev/measure-parentage-gate-rate.ts --no-widen-hop`.
    const born = (id: string, year: string) => ({
      id,
      gender: "Male",
      names: [{ id: `${id}-n`, given: id, surname: "X" }],
      facts: [{ id: `${id}-f1`, type: "Birth", date: year, standard_date: year }],
    });
    const people = [born("P", "1850"), born("S", "1855"), born("N", "1890")];
    const existing = [{ id: "R1", type: "ParentChild", parent: "P", child: "S" }];
    const before = tree(people, existing);
    const after = tree(people, [
      ...existing,
      { id: "R2", type: "ParentChild", parent: "P", child: "N" },
    ]);

    // The warning really is there beforehand, or this passes for the wrong
    // reason — and it is NOT visible from either touched person.
    const seeded = introducedWarnings(tree([]), before, ["S"]).allIntroduced;
    expect(seeded.map((w) => `${w.issueType}|${w.personId}|${w.relatedPersonId}`))
      .toContain("relativesEarliestChildBirthToBirth12|P|S");
    // ...and it is invisible from the two touched persons alone. This is the
    // whole defect in one line: with the widening off the write is refused,
    // with it on the same write lands.
    const narrow = introducedWarnings(
      before, after, ["P", "N"], undefined, undefined, true, /* widenOneHop */ false,
    );
    expect(
      narrow.allIntroduced.map((w) => `${w.issueType}|${w.personId}`),
    ).toContain("relativesEarliestChildBirthToBirth12|P");

    const result = introducedWarnings(before, after, ["P", "N"]);
    expect(
      result.allIntroduced.map((w) => `${w.issueType}|${w.personId}`),
    ).not.toContain("relativesEarliestChildBirthToBirth12|P");
    expect(result.unjustified).toHaveLength(0);
  });

  // (h) The age-12 gate, one warning per impossible child.
  //
  // These three rows are the reviewer's matrix, and the third is why the
  // per-child change was needed rather than just a better child-picker: with
  // ONE warning per parent, keyed on whichever child sorted first, adding a
  // second impossible child was accepted because the parent already carried a
  // warning under that key. A real corpus shape
  // (`elisabetha-sugecz-parents`: mother born 1810, children 1816/1820/1821).
  describe("(h) age-12 gate: each impossible child is judged on its own", () => {
    const kid = (id: string, date: string) => ({
      id,
      gender: "Male",
      names: [{ id: `${id}-n`, given: id, surname: "X" }],
      facts: [{ id: `${id}b`, type: "Birth", date, standard_date: date }],
    });
    const mum = {
      id: "M",
      gender: "Female",
      names: [{ id: "M-n", given: "Mary", surname: "X" }],
      facts: [{ id: "Mb", type: "Birth", date: "1860", standard_date: "1860" }],
    };
    const build = (kids: Array<[string, string]>, linked: string[]) =>
      tree(
        [mum, ...kids.map(([id, d]) => kid(id, d))],
        linked.map((id, i) => ({
          id: `R${i}`,
          type: "ParentChild",
          parent: "M",
          child: id,
        })),
      );
    const addEdge = (kids: Array<[string, string]>, existing: string[], add: string) => {
      const before = build(kids, existing);
      const after = build(kids, [...existing, add]);
      return introducedWarnings(
        before, after, computeTouchedPersonIds(before, after),
      );
    };

    it("lands a child that is only POSSIBLY impossible, beside one that is", () => {
      // B is certainly age 8; C spans 1850..1880 and may be age 30. Adding C
      // introduces nothing. Before the change this was refused, naming C.
      const r = addEdge([["B", "1868"], ["C", "Bet 1850 and 1880"]], ["B"], "C");
      expect(r.unjustified).toHaveLength(0);
    });

    it("refuses a second CERTAINLY impossible child given as a range", () => {
      const r = addEdge([["B", "1866"], ["C", "Bet 1850 and 1870"]], ["B"], "C");
      expect(
        r.unjustified.map((w) => `${w.issueType}|${w.relatedPersonId}`),
      ).toContain("earliestChildBirthToBirth12|C");
    });

    it("refuses a second CERTAINLY impossible child given as an exact date", () => {
      // The false ALLOW. One warning per parent already existed for B, so the
      // delta saw nothing new and D landed.
      const r = addEdge([["B", "1866"], ["D", "1870"]], ["B"], "D");
      expect(
        r.unjustified.map((w) => `${w.issueType}|${w.relatedPersonId}`),
      ).toContain("earliestChildBirthToBirth12|D");
    });
  });

  // Issue #4224: the death-before-child-birth tags were keyed on the EARLIEST
  // child, so a second posthumous child behind an in-time one raised nothing.
  describe("(i) death-before-child-birth gate: each posthumous child is judged on its own", () => {
    const kid = (id: string, date: string) => ({
      id,
      gender: "Male",
      names: [{ id: `${id}-n`, given: id, surname: "X" }],
      facts: [{ id: `${id}b`, type: "Birth", date, standard_date: date }],
    });
    const parent = (id: string, gender: string, death: string) => ({
      id,
      gender,
      names: [{ id: `${id}-n`, given: id, surname: "X" }],
      facts: [{ id: `${id}d`, type: "Death", date: death, standard_date: death }],
    });
    const addEdge = (
      par: ReturnType<typeof parent>,
      kids: Array<[string, string]>,
      existing: string[],
      add: string,
    ) => {
      const build = (linked: string[]) =>
        tree(
          [par, ...kids.map(([id, d]) => kid(id, d))],
          linked.map((id, i) => ({
            id: `R${i}`,
            type: "ParentChild",
            parent: par.id,
            child: id,
          })),
        );
      const before = build(existing);
      const after = build([...existing, add]);
      return introducedWarnings(
        before, after, computeTouchedPersonIds(before, after),
      );
    };

    it("refuses a second posthumous child behind one born in time", () => {
      const r = addEdge(
        parent("F", "Male", "12 Jan 1859"),
        [["A", "1 Jan 1820"], ["B", "9 Aug 1935"], ["C", "1 Mar 1940"]],
        ["A", "B"],
        "C",
      );
      expect(
        r.unjustified.map((w) => `${w.issueType}|${w.relatedPersonId}`),
      ).toContain("hasDeathBeforeChildBirth30_10|C");
    });

    it("lands an in-time child added to a mother who already has a posthumous one", () => {
      const r = addEdge(
        parent("M", "Female", "1 Jan 1850"),
        [["A", "1 Jan 1840"], ["B", "1 Jun 1855"], ["D", "1 Jan 1845"]],
        ["A", "B"],
        "D",
      );
      expect(r.unjustified).toHaveLength(0);
    });
  });

  // Interleaved children by two spouses is a spouse-structure claim, so it gates
  // like `similarSpouses` and `hasDissimilarSpousesWithSameMarriageYear`. The
  // warning cites the inside child and its nearest siblings, so a write that
  // adds no closer evidence keeps its id (person-warnings-tool-spec.md,
  // "Interleaved children by two spouses").
  describe("(j) interleaved-children gate", () => {
    const TAG = "hasInterleavedChildrenIgnoreSimilarSpouses";
    const b = (id: string, date: string) => ({ id, type: "Birth", date, standard_date: date });
    const pc = (p: string, c: string) => ({ id: `R${p}${c}`, type: "ParentChild", parent: p, child: c });
    const couple = (x: string, y: string) => ({ id: `C${x}${y}`, type: "Couple", person1: x, person2: y });
    const wife = (id: string, given: string, surname: string) => ({ ...person(id, given, surname), gender: "Female" });
    const kid = (id: string, date?: string, extra: any[] = []) =>
      person(id, `Kid${id}`, "Ward", date ? [b(`${id}B`, date), ...extra] : extra);
    const parents = [person("H", "Henry", "Ward"), wife("A", "Agnes", "Brown"), wife("B", "Bertha", "Clark")];
    const persons = [...parents, kid("A1", "1850"), kid("A2", "1860"), kid("X", "1855")];
    const base = [couple("H", "A"), couple("H", "B"), pc("H", "A1"), pc("A", "A1"), pc("H", "A2"), pc("A", "A2")];
    const before = tree(persons, [...base, pc("H", "X")]);
    const after = tree(persons, [...base, pc("H", "X"), pc("B", "X")]);
    const gate = (pre: SimplifiedGedcomX, post: SimplifiedGedcomX) =>
      introducedWarnings(pre, post, computeTouchedPersonIds(pre, post));
    const introducesTag = (pre: SimplifiedGedcomX, post: SimplifiedGedcomX) =>
      gate(pre, post).allIntroduced.some((w) => w.issueType === TAG);
    /** `after`, plus a new child of `mother` (H's child too), as the write. */
    const addChild = (mother: string, id: string, date: string) => {
      const pre = tree([...persons, kid(id, date)], after.relationships ?? []);
      const post = tree([...persons, kid(id, date)], [...(after.relationships ?? []), pc("H", id), pc(mother, id)]);
      return introducesTag(pre, post);
    };

    it("is not gate-exempt", () => {
      expect(GATE_EXEMPT_TYPES.has(TAG)).toBe(false);
    });

    it("refuses the write that makes Bertha the middle child's mother", () => {
      expect(gate(before, after).unjustified.map((w) => w.issueType)).toContain(TAG);
    });

    it("lets the same write land with a justification", () => {
      const w = gate(before, after).unjustified.find((x) => x.issueType === TAG);
      expect(w).toBeDefined();
      const r = introducedWarnings(before, after, computeTouchedPersonIds(before, after), [
        { warningId: w!.warningId, justification: "Henry had two households at once; see the probate." },
      ]);
      expect(r.unjustified.map((x) => x.issueType)).not.toContain(TAG);
    });

    it("refuses dating the inside child into the span", () => {
      const pre = tree([...parents, kid("A1", "1850"), kid("A2", "1860"), kid("X")], after.relationships ?? []);
      expect(gate(pre, after).unjustified.map((w) => w.issueType)).toContain(TAG);
    });

    it("keeps the id when Agnes gains a new eldest or youngest child", () => {
      expect(addChild("A", "A0", "1848")).toBe(false);
      expect(addChild("A", "A9", "1865")).toBe(false);
    });

    /** `after` plus a child `id` of Agnes, then the write removes that child's two edges. */
    const removeChild = (id: string, date: string) => {
      const all = [...persons, kid(id, date)];
      const pre = tree(all, [...(after.relationships ?? []), pc("H", id), pc("A", id)]);
      return introducesTag(pre, tree(all, after.relationships ?? []));
    };

    it("keeps the id when a child of Agnes who is not cited is removed", () => {
      // An eldest of three, and a same-day duplicate of the cited youngest.
      expect(removeChild("A0", "1848")).toBe(false);
      expect(removeChild("A2d", "1860")).toBe(false);
    });

    it("re-keys when a cited sibling is removed and another child of Agnes stands beyond it", () => {
      const all = [...persons, kid("A0", "1848")];
      const pre = tree(all, [...(after.relationships ?? []), pc("H", "A0"), pc("A", "A0")]);
      const post = tree(all, (pre.relationships ?? []).filter((r: any) => !(r.child === "A1" && r.type === "ParentChild")));
      expect(introducesTag(pre, post)).toBe(true);
    });

    it("re-keys when a merge replaces the inside child's first Birth fact", () => {
      // Xs is a second record of the 1855 child dated Mar 1855. The merge keeps the
      // survivor's fact and folds the other's equivalent 1855 into it, and the gate
      // remaps person ids, not fact ids, so the cited fact decides the outcome.
      const pre = tree([...persons, kid("Xs", "Mar 1855")], after.relationships ?? []);
      const gateMerge = (survivor: string, collapsed: string) => {
        const merged = mergeGedcomx(pre, null, [[survivor, collapsed]]);
        const gate = introducedWarnings(pre, merged, computeTouchedPersonIds(pre, merged), undefined, new Map([[collapsed, survivor]]));
        const mob = new Mob(merged, "H");
        const cited = calculateWarnings(mob, mob, mob, true)
          .filter((w) => w.issueType === TAG)
          .map((w) => (w.facts ?? []).map((f) => f.id).sort());
        return { gate, cited };
      };
      // Xs survives: the cited fact becomes XsB, a new key.
      const xs = gateMerge("Xs", "X");
      expect(xs.cited).toEqual([["A1B", "A2B", "XsB"]]);
      expect(xs.gate.unjustified.map((w) => w.issueType)).toContain(TAG);
      // X survives: the warning still stands on XB, the same key, so nothing is introduced.
      const x = gateMerge("X", "Xs");
      expect(x.cited).toEqual([["A1B", "A2B", "XB"]]);
      expect(x.gate.allIntroduced.map((w) => w.issueType)).not.toContain(TAG);
    });

    it("re-keys when a new child of Bertha turns the interleaving the other way", () => {
      // Bertha's 1840 child puts Agnes's 1850 child inside Bertha's span, and
      // 1850 is born before Bertha's 1855 child, so Agnes becomes the related spouse.
      const pre = tree([...persons, kid("Y", "1840")], after.relationships ?? []);
      const post = tree([...persons, kid("Y", "1840")], [...(after.relationships ?? []), pc("H", "Y"), pc("B", "Y")]);
      const w = gate(pre, post).unjustified.filter((x) => x.issueType === TAG);
      expect(w).toHaveLength(1);
      expect(w[0].relatedPersonId).toBe("A");
    });

    it("re-keys when an undated child of Bertha is dated inside the span before the inside child", () => {
      const pre = tree([...persons, kid("Y")], [...(after.relationships ?? []), pc("H", "Y"), pc("B", "Y")]);
      const post = tree([...persons, kid("Y", "1852")], pre.relationships ?? []);
      expect(introducesTag(pre, post)).toBe(true);
    });

    it("re-keys when an undated child of Agnes is dated between the inside child and its sibling", () => {
      const pre = tree([...persons, kid("AM")], [...(after.relationships ?? []), pc("H", "AM"), pc("A", "AM")]);
      const post = tree([...persons, kid("AM", "1853")], pre.relationships ?? []);
      expect(introducesTag(pre, post)).toBe(true);
    });

    it("re-keys when a new eldest child of Agnes brings an earlier child of Bertha inside the span", () => {
      const withY0 = [...persons, kid("Y0", "1845"), kid("A0", "1840")];
      const pre = tree(withY0, [...(after.relationships ?? []), pc("H", "Y0"), pc("B", "Y0")]);
      const post = tree(withY0, [...(pre.relationships ?? []), pc("H", "A0"), pc("A", "A0")]);
      expect(introducesTag(pre, post)).toBe(true);
    });

    it("keeps the id when a witness gains a second Birth fact", () => {
      const more = persons.map((p) => (p.id === "A1" ? kid("A1", "1850", [b("A1B2", "Jun 1850")]) : p));
      expect(introducesTag(after, tree(more, after.relationships ?? []))).toBe(false);
    });

    it("keeps the id when Bertha gains a later child inside the span", () => {
      expect(addChild("B", "Y", "1857")).toBe(false);
    });

    it("re-keys, and so asks again, for closer evidence: a nearer sibling or an earlier inside child", () => {
      expect(addChild("A", "AM", "1853")).toBe(true);
      expect(addChild("B", "Y", "1852")).toBe(true);
    });
  });

  it("(f) justification with stale id is detected", () => {
    const before = tree([plausiblePerson("I1", "John", "Smith")]);
    const after = tree([implausiblePerson("I1", "John", "Smith")]);

    const result = introducedWarnings(before, after, ["I1"], [
      { warningId: "stale_nonexistent_id", justification: "bad id" },
    ]);

    // Still unjustified because the stale id doesn't match
    expect(result.unjustified.length).toBeGreaterThan(0);

    // And staleJustifications detects the bad id
    const stale = staleJustifications(result.allIntroduced, [
      { warningId: "stale_nonexistent_id", justification: "bad id" },
    ]);
    expect(stale).toContain("stale_nonexistent_id");
  });
});

describe("warningId", () => {
  it("produces a stable id from issueType, personId, relatedPersonId and fact ids", () => {
    const w = {
      scoreType: "coherence",
      issueType: "hasAgeRangeGreaterThan120",
      severity: "contradiction" as const,
      personId: "I1",
      personName: "John Smith",
      message: "test",
      facts: [
        { id: "F2", type: "Death", date: "2000" },
        { id: "F1", type: "Birth", date: "1800" },
      ],
    };
    const id = warningId(w);
    expect(id).toBe("hasAgeRangeGreaterThan120|I1||F1,F2");
  });

  it("includes relatedPersonId when present", () => {
    const w = {
      scoreType: "coherence",
      issueType: "someCheck",
      severity: "contradiction" as const,
      personId: "I1",
      personName: "John Smith",
      message: "test",
      relatedPersonId: "I2",
    };
    const id = warningId(w);
    expect(id).toBe("someCheck|I1|I2|");
  });
});

describe("computeTouchedPersonIds", () => {
  it("detects a person whose facts changed", () => {
    const before = tree([plausiblePerson("I1", "John", "Smith")]);
    const after = tree([implausiblePerson("I1", "John", "Smith")]);
    const touched = computeTouchedPersonIds(before, after);
    expect(touched).toContain("I1");
  });

  it("detects an added person", () => {
    const before = tree([]);
    const after = tree([plausiblePerson("I1", "John", "Smith")]);
    const touched = computeTouchedPersonIds(before, after);
    expect(touched).toContain("I1");
  });

  it("detects a removed person", () => {
    const before = tree([plausiblePerson("I1", "John", "Smith")]);
    const after = tree([]);
    const touched = computeTouchedPersonIds(before, after);
    expect(touched).toContain("I1");
  });

  it("detects relationship endpoint changes", () => {
    const p1 = plausiblePerson("I1", "John", "Smith");
    const p2 = plausiblePerson("I2", "Jane", "Smith");
    const before = tree([p1, p2], []);
    const after = tree(
      [p1, p2],
      // A ParentChild carries its ends in `parent`/`child`. The previous
      // fixture used `person1`/`person2`, the Couple pair -- a shape that
      // occurs 0 times in the committed ParentChild edges -- so it
      // exercised the one field pair the function already read.
      [{ id: "R1", type: "ParentChild", parent: "I1", child: "I2" }],
    );
    const touched = computeTouchedPersonIds(before, after);
    expect(touched).toContain("I1");
    expect(touched).toContain("I2");
  });

  it("repointing a parent touches the OLD parent too", () => {
    // The before-side read of a CHANGED relationship. When a parent moves
    // I1 -> I3, I1 must enter `touched`, or its before-side warnings are never
    // computed and the delta is wrong in I1's favour -- a warning that existed
    // only while I1 was the parent would read as introduced, or one the
    // repoint resolves would read as still present.
    const p1 = plausiblePerson("I1", "John", "Smith");
    const p2 = plausiblePerson("I2", "Jane", "Smith");
    const p3 = plausiblePerson("I3", "James", "Smith");
    const before = tree([p1, p2, p3], [{ id: "R1", type: "ParentChild", parent: "I1", child: "I2" }]);
    const after = tree([p1, p2, p3], [{ id: "R1", type: "ParentChild", parent: "I3", child: "I2" }]);

    const touched = computeTouchedPersonIds(before, after);
    expect(touched).toEqual(expect.arrayContaining(["I1", "I2", "I3"]));
  });

  it("removing a parentage edge touches both of its ends", () => {
    // The removed-relationship arm. A removal can RESOLVE a warning as easily
    // as a write can introduce one, and the delta is only correct if both ends
    // are recomputed.
    const p1 = plausiblePerson("I1", "John", "Smith");
    const p2 = plausiblePerson("I2", "Jane", "Smith");
    const before = tree([p1, p2], [{ id: "R1", type: "ParentChild", parent: "I1", child: "I2" }]);
    const after = tree([p1, p2], []);

    const touched = computeTouchedPersonIds(before, after);
    expect(touched).toEqual(expect.arrayContaining(["I1", "I2"]));
  });

  it("still reads the Couple pair", () => {
    // The accept direction: widening to parent/child must not stop reading the
    // fields a Couple actually uses. 383 of the committed e2e Couple edges use
    // person1/person2 and none uses parent/child.
    const p1 = plausiblePerson("I1", "John", "Smith");
    const p2 = plausiblePerson("I2", "Jane", "Smith");
    const before = tree([p1, p2], []);
    const after = tree([p1, p2], [{ id: "R1", type: "Couple", person1: "I1", person2: "I2" }]);

    const touched = computeTouchedPersonIds(before, after);
    expect(touched).toEqual(expect.arrayContaining(["I1", "I2"]));
  });
});

// Issue #2525: competing biological parentage, surfaced by the tree writers.
describe("competingParentage", () => {
  const gp = (id: string, given: string, gender: string) => ({
    id,
    gender,
    names: [{ id: `${id}-n`, given, surname: "Flynn" }],
    facts: [],
  });
  const people = () => [
    gp("I1", "Patrick", "Male"),
    gp("I2", "Thomas", "Male"),
    gp("I3", "John", "Male"),
    gp("I4", "Mary", "Female"),
    gp("I5", "Ann", "Female"),
    gp("I6", "James", "Male"),
  ];
  const pc = (id: string, parent: string, subtype?: string, ref = "S1") => ({
    id,
    type: "ParentChild",
    parent,
    child: "I1",
    ...(subtype ? { subtype } : {}),
    sources: [{ ref }],
  });
  const research = {
    sources: [
      { id: "src_001", gedcomx_source_description_id: "S1" },
      { id: "src_002", gedcomx_source_description_id: "S2" },
    ],
    assertions: [
      { id: "a_001", source_id: "src_001", fact_type: "relationship" },
      { id: "a_002", source_id: "src_001", fact_type: "birth" },
      { id: "a_003", source_id: "src_002", fact_type: "relationship" },
    ],
    person_evidence: [
      { assertion_id: "a_001", person_id: "I2" },
      { assertion_id: "a_003", person_id: "I3" },
    ],
  };
  const surface = (
    beforeRels: any[],
    afterRels: any[],
    proposed?: Map<string, string>,
    beforePeople = people(),
    afterPeople = people(),
  ) => {
    const before = tree(beforePeople, beforeRels);
    const after = tree(afterPeople, afterRels);
    return competingParentage(before, after, research, proposed);
  };

  it("names both fathers and the assertion behind each when a second biological father is added", () => {
    const out = surface([pc("R1", "I2")], [pc("R1", "I2"), pc("R2", "I3", undefined, "S2")]);
    expect(out).toEqual([
      {
        personId: "I1",
        factType: "ParentChild",
        values: ["I2 Thomas Flynn (a_001)", "I3 John Flynn (a_003)"],
      },
    ]);
  });

  it("names the proposed edge by the call's sourceAssertionId", () => {
    const out = surface([pc("R1", "I2")], [pc("R1", "I2"), pc("R2", "I3")], new Map([["I3|I1", "a_099"]]));
    expect(out[0].values).toContain("I3 John Flynn (a_099)");
  });

  it("falls back to the source ref when no parentage assertion resolves", () => {
    const out = surface([pc("R1", "I2")], [pc("R1", "I2"), pc("R2", "I3", undefined, "S9")]);
    expect(out[0].values).toContain("I3 John Flynn (source S9)");
  });

  it("counts only the biological fathers when an adoptive one also stands", () => {
    const standing = [pc("R1", "I2"), pc("R2", "I3", "Adoptive")];
    const out = surface(standing, [...standing, pc("R3", "I6", undefined, "S9")]);
    expect(out).toEqual([
      {
        personId: "I1",
        factType: "ParentChild",
        values: ["I2 Thomas Flynn (a_001)", "I6 James Flynn (source S9)"],
      },
    ]);
  });

  it("surfaces a second father made by changing a parent's gender", () => {
    const rels = [pc("R1", "I2"), pc("R2", "I4")];
    const afterPeople = people().map((p) => (p.id === "I4" ? { ...p, gender: "Male" } : p));
    expect(surface(rels, rels, undefined, people(), afterPeople)).toHaveLength(1);
  });

  it("does not surface an adoptive father beside a biological one", () => {
    expect(surface([pc("R1", "I2")], [pc("R1", "I2"), pc("R2", "I3", "Adoptive")])).toEqual([]);
  });

  it("counts an absent subtype and Biological alike", () => {
    expect(surface([pc("R1", "I2")], [pc("R1", "I2"), pc("R2", "I3", "Biological")])).toHaveLength(1);
  });

  it("counts a subtype exactly as tooManyFathers2 does: any case, any unrecognized value", () => {
    for (const s of ["biological", "BiologicalParent", "Natural"]) {
      expect(surface([pc("R1", "I2")], [pc("R1", "I2"), pc("R2", "I3", s)])).toHaveLength(1);
    }
    expect(surface([pc("R1", "I2")], [pc("R1", "I2"), pc("R2", "I3", "adoptive")])).toEqual([]);
  });

  it("counts a parent holding both a Biological and an Adoptive edge once", () => {
    expect(surface([pc("R1", "I2")], [pc("R1", "I2"), pc("R2", "I2", "Adoptive")])).toEqual([]);
  });

  it("surfaces two biological mothers the same way", () => {
    const out = surface([pc("R1", "I4")], [pc("R1", "I4"), pc("R2", "I5")]);
    expect(out.map((c) => c.values.length)).toEqual([2]);
  });

  it("does not surface a mother added beside a father", () => {
    expect(surface([pc("R1", "I2")], [pc("R1", "I2"), pc("R2", "I4")])).toEqual([]);
  });

  it("does not cite an assertion linked only to the child (it may name the mother)", () => {
    const rs = {
      sources: [{ id: "src_001", gedcomx_source_description_id: "S1" }],
      assertions: [
        { id: "a_001", source_id: "src_001", fact_type: "relationship", value: "Father: Thomas" },
        { id: "a_002", source_id: "src_001", fact_type: "relationship", value: "Mother: Mary" },
      ],
      person_evidence: [
        { assertion_id: "a_001", person_id: "I2" },
        { assertion_id: "a_002", person_id: "I1" },
      ],
    };
    const before = tree(people(), [pc("R1", "I2")]);
    const after = tree(people(), [pc("R1", "I2"), pc("R2", "I3", undefined, "S2")]);
    expect(competingParentage(before, after, rs)[0].values).toEqual([
      "I2 Thomas Flynn (a_001)",
      "I3 John Flynn (source S2)",
    ]);
  });

  it("is skipped when no ParentChild edge or gender changed", () => {
    // A fact edit on a tree that already holds two fathers raises nothing new.
    const rels = [pc("R1", "I2"), pc("R2", "I3")];
    const before = tree(people(), []);
    const after = tree(people(), rels);
    expect(competingParentage(after, after, research)).toEqual([]);
    expect(competingParentage(before, after, research)).toHaveLength(1);
  });

  it("does not surface a set that did not grow", () => {
    const both = [pc("R1", "I2"), pc("R2", "I3")];
    expect(surface(both, [...both, pc("R3", "I2")])).toEqual([]);
  });
});

describe("introducedWarnings — hasPlaceStandardOtherCountry is gate-exempt (issue #3976)", () => {
  // A fact with place "Siaya, Nyanza, Kenya" standardized to "Madagascar":
  // countryConsistency finds the pair contradictory, firing the warning. The
  // tag is a standardisation artefact (usually FamilySearch-supplied), so a
  // write carrying it forward must not be refused.
  const facts = [
    {
      id: "I1-f1",
      type: "Death",
      date: "1983",
      standard_date: "1983",
      place: "Siaya, Nyanza, Kenya",
      standard_place: "Madagascar",
    },
  ];

  it("is NOT refused when a write introduces it (exemption applied)", () => {
    const before = tree([person("I1", "Zablon", "Yambo")]);
    const after = tree([person("I1", "Zablon", "Yambo", facts)]);

    const result = introducedWarnings(before, after, ["I1"]);

    expect(
      result.allIntroduced.some((w) => w.issueType === "hasPlaceStandardOtherCountry"),
    ).toBe(false);
    expect(result.unjustified).toHaveLength(0);
  });

  it("WOULD be introduced without the exemption (proves the exemption is load-bearing)", () => {
    const before = tree([person("I1", "Zablon", "Yambo")]);
    const after = tree([person("I1", "Zablon", "Yambo", facts)]);

    // applyExemptions = false bypasses GATE_EXEMPT_TYPES: the same warning now
    // appears, so removing the tag from the exempt set would refuse this write.
    const result = introducedWarnings(before, after, ["I1"], undefined, undefined, false);

    expect(
      result.allIntroduced.some((w) => w.issueType === "hasPlaceStandardOtherCountry"),
    ).toBe(true);
  });
});

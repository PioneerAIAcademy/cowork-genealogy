// D6: PersonWarning carries resolved facts, not bare ids.
//
// The defect this closes: handed `factIds: ["F3"]`, check-warnings was told to
// name the facts AND told to invent no date the response lacked. "F3" is not
// something a researcher can act on, so it went to the tree for the date and was
// marked down for fabricating it. There was no third thing to write.
import { describe, it, expect } from "vitest";

import { calculateWarnings, unionFactIds } from "../../src/tools/person-warnings.js";
import { warningFactsOfPerson } from "../../src/utils/fact-helpers.js";
import { Mob } from "../../src/utils/mob.js";
import type { SimplifiedGedcomX } from "../../src/types/gedcomx.js";
import type { WarningFact } from "../../src/types/person-warnings.js";

describe("WarningFact date precedence", () => {
  it("uses the fact's raw date, NOT the stdDate-normalized form", () => {
    // The trap: getStandardDate() reads standard_date first and normalizes
    // `date` through stdDate(), so "~1818" comes back "Abt 1818". Both are
    // defensible; they are different strings, and the spec, the nine fixtures
    // and the rubrics all quote this one.
    const facts = warningFactsOfPerson(
      { id: "I2", facts: [{ id: "F3", type: "Birth", date: "~1818" }] },
      null,
    );
    expect(facts).toEqual([{ id: "F3", type: "Birth", date: "~1818" }]);
  });

  it("falls back to standard_date, then to null", () => {
    const facts = warningFactsOfPerson(
      {
        id: "I1",
        facts: [
          { id: "A", type: "Death", standard_date: "3 Apr 1874" },
          { id: "B", type: "Burial" },
        ],
      },
      null,
    );
    expect(facts).toEqual([
      { id: "A", type: "Death", date: "3 Apr 1874" },
      // null, not "" or "unknown" — the skill is told not to narrate this, and
      // it can only obey a value it can recognize.
      { id: "B", type: "Burial", date: null },
    ]);
  });
});

describe("unionFactIds", () => {
  it("dedupes by id, not by object identity, preserving first-seen order", () => {
    // The one collection-semantics change in the rename. A Death fact reaches
    // the union from both the death-like and burial-like families; as strings
    // the Set collapsed them, as objects it would not.
    const a: WarningFact[] = [
      { id: "F2", type: "Death", date: "1908-03-12" },
      { id: "F1", type: "Birth", date: "~1845" },
    ];
    const b: WarningFact[] = [
      { id: "F2", type: "Death", date: "1908-03-12" },
      { id: "F3", type: "Burial", date: "1909" },
    ];
    expect(unionFactIds(a, b)).toEqual([
      { id: "F2", type: "Death", date: "1908-03-12" },
      { id: "F1", type: "Birth", date: "~1845" },
      { id: "F3", type: "Burial", date: "1909" },
    ]);
  });
});

describe("a warning carries the facts a researcher can act on", () => {
  it("names the type and the date, not just the id", () => {
    const tree: SimplifiedGedcomX = {
      persons: [
        {
          id: "I1",
          gender: "Male",
          facts: [
            { id: "F1", type: "Birth", date: "~1785" },
            { id: "F2", type: "Death", date: "1908-03-12" },
          ],
        },
      ],
    };
    const mob = new Mob(tree, "I1");
    const w = calculateWarnings(mob, mob, mob, true).find(
      (x) => x.issueType === "hasAgeRangeGreaterThan120",
    );
    expect(w?.facts).toEqual([
      { id: "F1", type: "Birth", date: "~1785" },
      { id: "F2", type: "Death", date: "1908-03-12" },
    ]);
  });
});

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  yearOf,
  yearOfDate,
  datedFromGedcomx,
  givenOf,
  familyYears,
  classifyAgainstWindow,
  type Gedcomx,
} from "../../dev/payload-extract.js";

/**
 * Ground truth for the qualifier probe's parser layer.
 *
 * Every assertion below is against a REAL captured payload, and every one of
 * them corresponds to a bug that already reached shipped documentation. The
 * probe's measurement logic was never the problem; the parser was, and its
 * failures were silent and one-directional — each manufactured ABSENCE, which
 * then read as a finding rather than as a fault.
 *
 * Fixtures live in tests/fixtures/payloads/, trimmed to the fields these
 * helpers read. Re-capture with dev tooling if the upstream shape changes; do
 * not hand-edit them to make a test pass.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const load = (name: string): Array<{ id: string; gedcomx: Gedcomx }> =>
  JSON.parse(
    readFileSync(join(HERE, "..", "fixtures", "payloads", `${name}.json`), "utf-8")
  );

const byId = (name: string, id: string): Gedcomx => {
  const rec = load(name).find((r) => r.id === id);
  if (!rec) throw new Error(`fixture ${name} has no record ${id}`);
  return rec.gedcomx;
};

const BIRTH = /^(Birth|Christening|Baptism|birthDate)$/i;
const DEATH = /^(Death|Burial|Cremation|deathDate)$/i;
const MARRIAGE = /^(Marriage|marriageDate)$/i;
const CENSUS = /^(Residence|Census|residenceDate)$/i;

describe("yearOf — plain strings", () => {
  it("reads a year out of an indexed date", () => {
    expect(yearOf("14 Aug 1565")).toBe(1565);
    expect(yearOf("1892")).toBe(1892);
  });

  it("returns null for a bare day-of-month, which is the whole problem", () => {
    // Real value from QP8V-35G7's Burial fact. Handed this alone, the parser
    // concluded "no year" and the record was counted as year-silent.
    expect(yearOf("5")).toBeNull();
    expect(yearOf("20")).toBeNull();
  });
});

describe("yearOfDate — date objects", () => {
  it("falls back to `formal` when `original` carries only the day", () => {
    // QP8V-35G7, hand-verified: Burial original "5", formal "+1505".
    expect(yearOfDate({ original: "5", formal: "+1505" })).toBe(1505);
  });

  it("prefers `original` when it holds a real year", () => {
    expect(yearOfDate({ original: "May 1696", formal: "+1696-05" })).toBe(1696);
  });

  it("reads `normalized[].value` when nothing else has a year", () => {
    expect(yearOfDate({ original: "31", normalized: [{ value: "1531" }] })).toBe(1531);
  });

  it("is null-safe on the shapes real payloads actually contain", () => {
    expect(yearOfDate(undefined)).toBeNull();
    expect(yearOfDate(null)).toBeNull();
    expect(yearOfDate({})).toBeNull();
    // A dateless fact — MaritalStatus and Occupation both appear this way.
    expect(yearOfDate({ original: undefined, formal: undefined })).toBeNull();
  });
});

describe("the formal-only burial is dated, not silent", () => {
  const gx = byId("death-formal-only", "QP8V-35G7");

  it("finds the 1505 burial that an original-only read misses", () => {
    expect(familyYears(datedFromGedcomx(gx), DEATH)).toContain(1505);
  });

  it("classifies it as in-range for 1500-1505 rather than silent", () => {
    // The index holds it as 1505, which is why an impossible-range query
    // returned it at all. Calling it "silent" made it look like evidence that
    // a range tolerates silence, and then like a survivor of `.exact`.
    expect(classifyAgainstWindow(datedFromGedcomx(gx), DEATH, 1500, 1505)).toBe("in-range");
  });
});

describe("marriage dates live on the relationship, not on any person", () => {
  const gx = byId("marriage-relationship-fact", "QL12-V6P6");
  const dated = datedFromGedcomx(gx);

  it("finds the 1501 marriage", () => {
    expect(familyYears(dated, MARRIAGE)).toContain(1501);
  });

  it("attributes it to the record (-1), not to persons[0]", () => {
    const m = dated.filter((d) => MARRIAGE.test(d.kind) && d.year === 1501);
    expect(m.length).toBeGreaterThan(0);
    expect(m.every((d) => d.personIdx === -1)).toBe(true);
  });

  it("would be invisible to a persons-only walk", () => {
    // This is the regression that mattered: reading persons only made marriage
    // look structurally date-less, so an "is any row genuinely in range?"
    // control returned a FALSE ZERO and the pool passed as clean.
    const personsOnly = dated.filter((d) => d.personIdx >= 0);
    expect(familyYears(personsOnly, MARRIAGE)).toHaveLength(0);
  });

  it("still classifies the record as in-range for 1500-1505", () => {
    expect(classifyAgainstWindow(dated, MARRIAGE, 1500, 1505)).toBe("in-range");
  });
});

describe("genuinely silent records exist and are distinguishable from fuzz", () => {
  it("a marriage record with no dated fact anywhere is silent", () => {
    // QGLH-L7NH: 4 persons, no dated fact on any of them or on the
    // relationships, yet a 1500-1505 marriage range returned it. THIS is
    // silence tolerance — the thing the verdict names.
    const gx = byId("marriage-relationship-fact", "QGLH-L7NH");
    expect(familyYears(datedFromGedcomx(gx), MARRIAGE)).toHaveLength(0);
    expect(classifyAgainstWindow(datedFromGedcomx(gx), MARRIAGE, 1500, 1505)).toBe("silent");
  });

  it("a christening 60 years outside the window is FUZZ, not silence", () => {
    // NPBV-WBQ: Christening 14 Aug 1565, returned by a 1500-1505 birth range.
    // Counting this as silent is how a 70-row birth "calibration" certified
    // that a range tolerates silence when it contained no silent row at all.
    const gx = byId("birth-fuzz", "NPBV-WBQ");
    expect(familyYears(datedFromGedcomx(gx), BIRTH)).toContain(1565);
    expect(classifyAgainstWindow(datedFromGedcomx(gx), BIRTH, 1500, 1505)).toBe("fuzz");
  });

  it("the three classes are exhaustive and mutually exclusive across a whole fixture", () => {
    for (const name of ["birth-fuzz", "death-formal-only", "marriage-relationship-fact"]) {
      for (const rec of load(name)) {
        const c = classifyAgainstWindow(datedFromGedcomx(rec.gedcomx), BIRTH, 1500, 1505);
        expect(["in-range", "fuzz", "silent"]).toContain(c);
      }
    }
  });
});

describe("census dates sit on persons", () => {
  it("reads a Census year from a person fact", () => {
    const gx = byId("residence-census", "Q27H-KK98");
    expect(familyYears(datedFromGedcomx(gx), CENSUS)).toContain(1881);
  });
});

describe("givenOf reads nameForms[].parts[], not names[].given", () => {
  it("returns the given name for a real person", () => {
    const gx = byId("marriage-normal", "6294-53FH");
    expect(givenOf(gx.persons?.[0])).toBe("Pedro");
  });

  it("returns null rather than throwing on a person with no names", () => {
    expect(givenOf(undefined)).toBeNull();
    expect(givenOf({})).toBeNull();
    expect(givenOf({ names: [] })).toBeNull();
  });

  it("does not read a `given` field, which does not exist in this payload", () => {
    // An earlier version did, found nothing on every person, and made every
    // relative nameless — so the section reading it reported ZERO conflicts.
    expect(givenOf({ names: [{ given: "Nope" }] } as never)).toBeNull();
  });
});

describe("datedFromGedcomx is defensive about real-world gaps", () => {
  it("survives missing persons, relationships and facts", () => {
    expect(datedFromGedcomx(undefined)).toEqual([]);
    expect(datedFromGedcomx({})).toEqual([]);
    expect(datedFromGedcomx({ persons: [{}], relationships: [{}] })).toEqual([]);
  });

  it("keeps dateless facts out of the year counts but does not crash on them", () => {
    // MaritalStatus and Occupation appear with `date: undefined`.
    const dated = datedFromGedcomx({
      persons: [{ facts: [{ type: "http://gedcomx.org/MaritalStatus" }] }],
    });
    expect(dated).toHaveLength(1);
    expect(dated[0]?.year).toBeNull();
  });
});

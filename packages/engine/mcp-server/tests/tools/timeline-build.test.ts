import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { readFileSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { formatEventDate, planTimeline, timelineBuild } from "../../src/tools/timeline-build.js";
import { extractRecord } from "../../src/utils/record-extract.js";
import { ATTACHMENT_LINK_RATIONALE } from "../../src/utils/tree-person.js";

const SCENARIOS = resolve(__dirname, "../../../../../eval/fixtures/scenarios");
const scenario = (name: string) => ({
  research: JSON.parse(readFileSync(resolve(SCENARIOS, name, "research.json"), "utf-8")),
  tree: JSON.parse(readFileSync(resolve(SCENARIOS, name, "tree.gedcomx.json"), "utf-8")),
});

/** Places resolve only from this table; anything else answers null. */
function places(table: Record<string, string> = {}, coords: Record<string, [number, number]> = {}) {
  return {
    resolvePlace: async (text: string) => table[text] ?? null,
    placeCoords: async (sp: string) => (coords[sp] ? { latitude: coords[sp][0], longitude: coords[sp][1] } : null),
  };
}

const treePerson = (tree: any, id: string) => tree.persons.find((p: any) => p.id === id);

function link(research: any, personId: string, assertionIds: string[], extra: object = {}) {
  let n = research.person_evidence.length;
  for (const id of assertionIds) {
    n += 1;
    research.person_evidence.push({
      id: `pe_t${n}`,
      assertion_id: id,
      person_id: personId,
      confidence: "probable",
      rationale: "test link",
      match_score: null,
      superseded_by: null,
      ...extra,
    });
  }
}

// ── A synthetic project: assertions with links, nothing validated. ──────────

interface Fact {
  record?: string;
  role?: string;
  persona?: string | null;
  fact: string;
  date?: string;
  certainty?: string;
  place?: string;
  sp?: string;
  value?: string;
  structured?: object;
  linked?: boolean;
  confidence?: string;
  rationale?: string;
}

function project(facts: Fact[], extra: { conflicts?: any[]; timelines?: any[] } = {}) {
  const assertions = facts.map((f, i) => ({
    id: `a_${String(i + 1).padStart(3, "0")}`,
    record_id: f.record ?? `ark:/61903/1:1:R${i + 1}`,
    record_role: f.role ?? "principal",
    record_persona_id: f.persona === undefined ? null : f.persona,
    fact_type: f.fact,
    value: f.value ?? f.place ?? f.date ?? f.fact,
    date: f.date ?? null,
    date_certainty: f.certainty ?? null,
    place: f.place ?? null,
    standard_place: f.sp ?? null,
    ...(f.structured ? { structured_value: f.structured } : {}),
  }));
  const person_evidence = facts.flatMap((f, i) =>
    f.linked === false
      ? []
      : [{
          id: `pe_${String(i + 1).padStart(3, "0")}`,
          assertion_id: assertions[i].id,
          person_id: "I1",
          confidence: f.confidence ?? "probable",
          rationale: f.rationale ?? "test link",
          match_score: f.confidence === "speculative" ? null : 0.9,
          superseded_by: null,
        }],
  );
  return { assertions, person_evidence, conflicts: extra.conflicts ?? [], timelines: extra.timelines ?? [] };
}

const man = { id: "I1", gender: "Male", names: [{ given: "Tom", surname: "Test" }] } as any;
const woman = { id: "I1", gender: "Female", names: [{ given: "Ann", surname: "Test" }] } as any;
const plan = (research: any, who: any = man, deps: object = places()) => planTimeline(research, who, deps);
const census = (p: any) => p.gaps.flatMap((g: any) => g.expected_events).filter((x: string) => /census/.test(x));

const OHIO = "Columbus, Franklin, Ohio, United States";
const PA = "Pittsburgh, Allegheny, Pennsylvania, United States";
const NY = "Albany, Albany, New York, United States";

// ── The governing plan's named cases ────────────────────────────────────────

describe("england-census-timeline", () => {
  it("expects 1841, 1861 and 1871, and not 1851", async () => {
    const { research, tree } = scenario("england-census-timeline");
    const p = await planTimeline(research, treePerson(tree, "I1"), places({ "Canterbury, Kent, England": "Canterbury, Kent, England" }));
    expect(census(p)).toEqual([
      "1841 England and Wales census",
      "1861 England and Wales census",
      "1871 England and Wales census",
    ]);
  });
  it("gives the same years when the place is in its modern form", async () => {
    const { research, tree } = scenario("england-census-timeline");
    const p = await planTimeline(
      research,
      treePerson(tree, "I1"),
      places({ "Canterbury, Kent, England": "Canterbury, Kent, England, United Kingdom" }),
    );
    expect(census(p)).toEqual([
      "1841 England and Wales census",
      "1861 England and Wales census",
      "1871 England and Wales census",
    ]);
  });
});

describe("the flynn copy (PR D's links)", () => {
  const FLYNN = {
    Ireland: "Ireland",
    "Schuylkill County, Pennsylvania": "Schuylkill, Pennsylvania, United States",
    Pennsylvania: "Pennsylvania, United States",
  };
  async function flynn() {
    const { research, tree } = scenario("mid-research-flynn");
    link(research, "I1", ["a_002", "a_003", "a_008", "a_009", "a_011", "a_012"]);
    return planTimeline(research, treePerson(tree, "I1"), places(FLYNN));
  }
  it("a_010 makes the 1860 event", async () => {
    const p = await flynn();
    expect(p!.events.find((e: any) => e.date === "1860").assertion_ids).toEqual(["a_010"]);
  });
  it("the 1860-1908 interval expects 1870, 1880 and 1900, then residence", async () => {
    const p = await flynn();
    expect(p!.gaps.filter((g: any) => g.severity === "high")).toEqual([
      expect.objectContaining({
        start: "1860",
        end: "1908-03-12",
        expected_events: ["1870 United States census", "1880 United States census", "1900 United States census", "residence"],
      }),
    ]);
  });
  it("adds the medium death-without-burial gap, bounded by the death, and no marriage gap", async () => {
    const p = await flynn();
    expect(p!.gaps.filter((g: any) => g.severity === "medium")).toEqual([
      expect.objectContaining({ start: "1908-03-12", end: "1908-03-12", expected_events: ["burial"] }),
    ]);
    expect(p!.gaps.some((g: any) => g.expected_events.includes("marriage"))).toBe(false);
  });
  it("the resolved conflict keeps a_002, drops a_009 and a_012, and carries its id", async () => {
    const p = await flynn();
    const cited = p!.events.flatMap((e: any) => e.assertion_ids);
    expect(cited).toContain("a_002");
    expect(cited).not.toContain("a_009");
    expect(cited).not.toContain("a_012");
    expect(p!.events.find((e: any) => e.assertion_ids.includes("a_002")).conflict_ids).toEqual(["c_001"]);
  });
  it("one record's assertions about one event merge into one event", async () => {
    const p = await flynn();
    expect(p!.events.find((e: any) => e.date === "1850").assertion_ids).toEqual(["a_003", "a_004"]);
  });
  it("a tree fact with no link becomes no event", async () => {
    const p = await flynn();
    expect(p!.events.every((e: any) => e.assertion_ids.length > 0)).toBe(true);
  });
});

describe("conflicts (flynn-multi-conflict)", () => {
  const FLYNN = { "Schuylkill County, Pennsylvania": "Schuylkill, Pennsylvania, United States" };
  it("an unresolved conflict marks each competing event; a name-only identity conflict marks its persona's record", async () => {
    const { research, tree } = scenario("flynn-multi-conflict");
    link(research, "I1", ["a_002", "a_009", "a_011", "a_012"]);
    const p = await planTimeline(research, treePerson(tree, "I1"), places(FLYNN));
    for (const id of ["a_002", "a_009", "a_012"]) {
      const e = p!.events.find((x: any) => x.assertion_ids.includes(id));
      expect(e.conflict_ids, id).toContain("c_001");
    }
    const household1850 = p!.events.find((x: any) => x.assertion_ids.includes("a_004"));
    expect(household1850.conflict_ids).toContain("c_002");
    const identity = research.conflicts.find((c: any) => c.id === "c_002").identity_question;
    expect(household1850.conflict_note).toContain(identity.trim());
  });
  it("a resolved conflict with no preferred assertion keeps its competing events, each carrying its id", async () => {
    const { research, tree } = scenario("flynn-multi-conflict");
    link(research, "I1", ["a_002", "a_009", "a_012"]);
    const c1 = research.conflicts.find((c: any) => c.id === "c_001");
    Object.assign(c1, { status: "resolved", resolution_kind: "synthesis", resolution_rationale: "Born in Ireland, raised in Pennsylvania." });
    const p = await planTimeline(research, treePerson(tree, "I1"), places(FLYNN));
    for (const id of ["a_002", "a_009", "a_012"]) {
      const e = p!.events.find((x: any) => x.assertion_ids.includes(id));
      expect(e.conflict_ids, id).toContain("c_001");
      expect(e.conflict_note).toContain("Born in Ireland, raised in Pennsylvania.");
    }
  });
  it("a moot conflict marks nothing", async () => {
    const { research, tree } = scenario("flynn-multi-conflict");
    link(research, "I1", ["a_002", "a_009", "a_012"]);
    research.conflicts = research.conflicts.map((c: any) => ({ ...c, status: "moot", resolution_rationale: "no longer bears" }));
    const p = await planTimeline(research, treePerson(tree, "I1"), places(FLYNN));
    expect(p!.events.every((e: any) => e.conflict_ids === null)).toBe(true);
  });
});

describe("unverified links", () => {
  it("speculative attachment links read 'Unverified attachment:'; other speculative links 'Unverified:'", async () => {
    const p = await plan(
      project([
        { fact: "birth", date: "1850", sp: OHIO, confidence: "speculative", rationale: ATTACHMENT_LINK_RATIONALE },
        { fact: "death", date: "1900", sp: OHIO, confidence: "speculative", rationale: "weak match the researcher confirmed" },
        { fact: "burial", date: "1900", sp: OHIO, record: "ark:/61903/1:1:R2" },
      ]),
    );
    const byType = Object.fromEntries(p!.events.map((e: any) => [e.event_type, e.description]));
    expect(byType.birth).toMatch(/^Unverified attachment: /);
    expect(byType.death).toMatch(/^Unverified: /);
    expect(byType.burial).not.toMatch(/^Unverified/);
    expect(p!.unverifiedEvents).toBe(2);
  });
});

// ── Census years ────────────────────────────────────────────────────────────

describe("census gaps", () => {
  it("names its year and its row's label, and a year with no row is not expected", async () => {
    const p = await plan(project([{ fact: "residence", date: "1850", sp: OHIO }, { fact: "residence", date: "1880", sp: OHIO }]));
    expect(census(p)).toEqual(["1860 United States census", "1870 United States census"]);
  });
  it("a New York interval spanning 1855 expects the New York census, never a United States one", async () => {
    const p = await plan(project([{ fact: "residence", date: "1851", sp: NY }, { fact: "residence", date: "1859", sp: NY }]));
    expect(census(p)).toEqual(["1855 New York census"]);
  });
  it("a state census counts only when it covers both places", async () => {
    const p = await plan(project([{ fact: "residence", date: "1850", sp: NY }, { fact: "residence", date: "1870", sp: OHIO }]));
    expect(census(p)).toEqual(["1860 United States census"]);
  });
  it("Madeira 1852 and São Paulo 1890 expect neither country's census", async () => {
    const p = await plan(
      project([
        { fact: "residence", date: "1852", sp: "Funchal, Madeira, Portugal" },
        { fact: "residence", date: "1890", sp: "São Paulo, São Paulo, Brazil" },
      ]),
    );
    expect(census(p)).toEqual([]);
  });
  it("Danish 1885 and 1893 events and a later US one keep the 1890 Denmark census", async () => {
    const p = await plan(
      project([
        { fact: "residence", date: "1885", sp: "Odense, Odense, Denmark" },
        { fact: "residence", date: "1893", sp: "Odense, Odense, Denmark" },
        { fact: "residence", date: "1900", sp: OHIO },
      ]),
    );
    expect(census(p)).toEqual(["1890 Denmark census"]);
  });
  it("a placed 1850, an unplaced 1852 and a placed 1880 give one 1850-1880 gap", async () => {
    const p = await plan(
      project([
        { fact: "residence", date: "1850", sp: OHIO },
        { fact: "residence", date: "1852" },
        { fact: "residence", date: "1880", sp: OHIO },
      ]),
    );
    const high = p!.gaps.filter((g: any) => g.severity === "high");
    expect(high).toEqual([
      expect.objectContaining({
        start: "1850",
        end: "1880",
        expected_events: ["1860 United States census", "1870 United States census", "residence"],
      }),
    ]);
    expect(p!.gaps.every((g: any) => g.expected_events.length > 0)).toBe(true);
  });
  it("placed US events in 1845, 1870 and 1905 give two gaps, and no 1845-1905 one", async () => {
    const p = await plan(
      project([
        { fact: "residence", date: "1845", sp: OHIO },
        { fact: "residence", date: "1870", sp: OHIO },
        { fact: "residence", date: "1905", sp: OHIO },
      ]),
    );
    expect(p!.gaps.filter((g: any) => g.severity === "high")).toEqual([
      expect.objectContaining({ start: "1845", end: "1870", expected_events: ["1850 United States census", "1860 United States census", "residence"] }),
      expect.objectContaining({ start: "1870", end: "1905", expected_events: ["1880 United States census", "1900 United States census", "residence"] }),
    ]);
  });
  it("a US subject alive across 1890 gets no 1890 entry", async () => {
    const p = await plan(project([{ fact: "residence", date: "1880", sp: OHIO }, { fact: "residence", date: "1900", sp: OHIO }]));
    expect(census(p).some((x: string) => x.startsWith("1890"))).toBe(false);
  });
  it("Ireland expects 1901 and 1911, and never 1821-1851", async () => {
    const early = await plan(project([{ fact: "residence", date: "1815", sp: "Cork, County Cork, Ireland" }, { fact: "residence", date: "1860", sp: "Cork, County Cork, Ireland" }]));
    expect(census(early)).toEqual([]);
    const late = await plan(project([{ fact: "residence", date: "1895", sp: "Cork, County Cork, Ireland" }, { fact: "residence", date: "1915", sp: "Cork, County Cork, Ireland" }]));
    expect(census(late)).toEqual(["1901 Ireland census", "1911 Ireland census"]);
  });
  it("Belfast 1895 to 1915 expects 1901 and 1911, in either Irish form", async () => {
    const p = await plan(
      project([
        { fact: "residence", date: "1895", sp: "Belfast, County Antrim, Ireland" },
        { fact: "residence", date: "1915", sp: "Belfast, County Antrim, Northern Ireland, United Kingdom" },
      ]),
    );
    expect(census(p)).toEqual(["1901 Ireland census", "1911 Ireland census"]);
  });
  it("an Ontario place expects the 1891 Canada census", async () => {
    const p = await plan(project([{ fact: "residence", date: "1885", sp: "Kingston, Frontenac, Ontario, Canada" }, { fact: "residence", date: "1895", sp: "Kingston, Frontenac, Ontario, Canada" }]));
    expect(census(p)).toEqual(["1891 Canada census"]);
  });
  it("a Scotland event then an England one: no Scottish or English row covers both", async () => {
    const p = await plan(
      project([
        { fact: "residence", date: "1845", sp: "Edinburgh, Scotland, United Kingdom" },
        { fact: "residence", date: "1875", sp: "Canterbury, Kent, England, United Kingdom" },
      ]),
    );
    expect(census(p)).toEqual([]);
    expect(p!.gaps).toEqual([expect.objectContaining({ start: "1845", end: "1875", expected_events: ["residence"] })]);
  });
  it("two events in a country the table does not list give no census gap and name the country", async () => {
    const p = await plan(project([{ fact: "residence", date: "1890", sp: "Manila, Metro Manila, Philippines" }, { fact: "residence", date: "1910", sp: "Manila, Metro Manila, Philippines" }]));
    expect(census(p)).toEqual([]);
    expect(p!.unchecked).toEqual(["Philippines"]);
  });
  it("a place given only as a country the table covers by province says so", async () => {
    const p = await plan(project([
      { fact: "birth", date: "1832", sp: "Canada" },
      { fact: "census", date: "1851", sp: "Kingston, Frontenac, Ontario, Canada" },
    ]));
    expect(p!.unchecked).toEqual(["places given only as Canada"]);
  });
  it("a département the table does not cover is named with its country", async () => {
    const p = await plan(project([{ fact: "residence", date: "1850", sp: "Angoulême, Charente, France" }]));
    expect(p!.unchecked).toEqual(["Charente, France"]);
  });
});

describe("heads-only schedules", () => {
  // A heads-only schedule names only household heads, so a man is expected in
  // one only once he must be 21 and a linked marriage has ended before it.
  const born = (who: any, date?: string, married?: string) =>
    plan(
      project([
        ...(date ? [{ fact: "birth", date, sp: PA, record: "ark:/61903/1:1:B" }] : []),
        ...(married ? [{ fact: "marriage", date: married, sp: PA, record: "ark:/61903/1:1:M" }] : []),
        { fact: "residence", date: "1825", sp: PA },
        { fact: "residence", date: "1845", sp: PA },
      ]),
      who,
    );
  it("a US man born 1800, married 1824, expects 1830 and 1840", async () => {
    expect(census(await born(man, "1800", "1824"))).toEqual(["1830 United States census", "1840 United States census"]);
  });
  it("an unmarried man of 21 or older expects neither", async () => {
    expect(census(await born(man, "1800"))).toEqual([]);
  });
  it("a man married in 1838 expects 1840 but not 1830", async () => {
    expect(census(await born(man, "1800", "1838"))).toEqual(["1840 United States census"]);
  });
  it("a marriage open on its later side does not count", async () => {
    // Unplaced, so it is not a census interval's end and only the married test sees it.
    const p = await plan(project([
      { fact: "birth", date: "1800", sp: PA, record: "ark:/61903/1:1:B" },
      { fact: "marriage", date: "after 1828", record: "ark:/61903/1:1:M" },
      { fact: "residence", date: "1825", sp: PA },
      { fact: "residence", date: "1845", sp: PA },
    ]));
    expect(census(p)).toEqual([]);
  });
  it("a man born 1815 who married in 1845 does not expect 1840", async () => {
    const p = await plan(project([
      { fact: "birth", date: "1815", sp: OHIO, record: "ark:/61903/1:1:B" },
      { fact: "marriage", date: "1845", sp: OHIO, record: "ark:/61903/1:1:M" },
    ]));
    expect(census(p)).not.toContain("1840 United States census");
  });
  it("a US woman, and a man with no linked birth, expect neither", async () => {
    expect(census(await born(woman, "1800", "1824"))).toEqual([]);
    expect(census(await born(man, undefined, "1824"))).toEqual([]);
  });
  it("a birth Aft 1800 has no latest year, so 1840 is not expected", async () => {
    const p = await plan(project([
      { fact: "birth", date: "after 1800", sp: PA, record: "ark:/61903/1:1:B" },
      { fact: "marriage", date: "1830", sp: PA, record: "ark:/61903/1:1:M" },
      { fact: "residence", date: "1835", sp: PA },
      { fact: "residence", date: "1845", sp: PA },
    ]));
    expect(census(p)).not.toContain("1840 United States census");
  });
  it("a birth Bet 1795 and 1805 does not expect 1820 for a possible 15-year-old", async () => {
    const p = await plan(project([
      { fact: "birth", date: "between 1795 and 1805", sp: PA, record: "ark:/61903/1:1:B" },
      { fact: "marriage", date: "1814", sp: PA, record: "ark:/61903/1:1:M" },
      { fact: "residence", date: "1815", sp: PA },
      { fact: "residence", date: "1823", sp: PA },
    ]));
    expect(census(p)).toEqual([]);
  });
});

describe("approximate and directional dates (B4)", () => {
  it("a birth Aft 1840 then an 1870 census expects no 1850", async () => {
    const p = await plan(project([{ fact: "birth", date: "after 1840", sp: OHIO }, { fact: "census", date: "1870", sp: OHIO }]));
    expect(census(p)).not.toContain("1850 United States census");
  });
  it("an 1850 event then a death Bef 1880 expects no 1860 or 1870", async () => {
    const p = await plan(project([{ fact: "residence", date: "1850", sp: OHIO }, { fact: "death", date: "before 1880", sp: OHIO }]));
    expect(census(p)).toEqual([]);
  });
  it("Est 1845 spans 1835-1855", async () => {
    const p = await plan(project([{ fact: "birth", date: "est 1845", sp: OHIO }, { fact: "residence", date: "1880", sp: OHIO }]));
    expect(census(p)).toEqual(["1860 United States census", "1870 United States census"]);
  });
  it("an assertion certainty of before or after leaves that side open", async () => {
    const p = await plan(project([{ fact: "birth", date: "1840", certainty: "after", sp: OHIO }, { fact: "census", date: "1870", sp: OHIO }]));
    expect(census(p)).toEqual([]);
  });
});

describe("death, burial and the span (S1, S5)", () => {
  it("a death record's 1908 death and 1908 burial stay two events, with no burial gap", async () => {
    const p = await plan(project([
      { fact: "death", date: "1908", sp: OHIO, record: "ark:/61903/1:1:D", role: "deceased" },
      { fact: "burial", date: "1908", sp: OHIO, record: "ark:/61903/1:1:D", role: "deceased" },
    ]));
    expect(p!.events.map((e: any) => e.event_type).sort()).toEqual(["burial", "death"]);
    expect(p!.gaps).toEqual([]);
  });
  it("a burial with no death gives a medium death gap at the burial", async () => {
    const p = await plan(project([{ fact: "burial", date: "1908", sp: OHIO }]));
    expect(p!.gaps).toEqual([expect.objectContaining({ start: "1908", end: "1908", expected_events: ["death"], severity: "medium" })]);
  });
  it("an unplaced death ends the census years a later placed event would open", async () => {
    // Married, so the heads-only 1830 and 1840 are expected; nothing from 1850 on.
    const p = await plan(project([
      { fact: "birth", date: "1800", sp: OHIO },
      { fact: "marriage", date: "1824" },
      { fact: "residence", date: "1845", sp: OHIO },
      { fact: "death", date: "1847" },
      { fact: "probate", date: "1872", sp: OHIO },
    ]));
    expect(census(p)).toEqual(["1830 United States census", "1840 United States census"]);
  });
  it("a death open on its earlier side expects no census after the event before it", async () => {
    const p = await plan(project([
      { fact: "residence", date: "1850", sp: OHIO },
      { fact: "death", date: "before 1880" },
      { fact: "probate", date: "1900", sp: OHIO },
    ]));
    expect(census(p)).toEqual([]);
  });
  it("a burial with no death ends the span as a death does", async () => {
    const p = await plan(project([
      { fact: "residence", date: "1845", sp: OHIO },
      { fact: "burial", date: "1847", sp: OHIO },
      { fact: "probate", date: "1872", sp: OHIO },
    ]));
    expect(census(p)).toEqual([]);
    expect(p!.gaps.filter((g: any) => g.expected_events.includes("residence"))).toEqual([]);
  });
  it("a dated death and an undated linked burial give no burial gap", async () => {
    const p = await plan(project([
      { fact: "death", date: "1908", sp: OHIO, record: "ark:/61903/1:1:D", role: "deceased" },
      { fact: "burial", place: "Green Lawn Cemetery", record: "ark:/61903/1:1:B", role: "deceased" },
    ]));
    expect(p!.gaps).toEqual([]);
  });
  it("an undated linked death and a dated burial give no death gap", async () => {
    const p = await plan(project([
      { fact: "death", place: "Columbus", record: "ark:/61903/1:1:D", role: "deceased" },
      { fact: "burial", date: "1908", sp: OHIO, record: "ark:/61903/1:1:B", role: "deceased" },
    ]));
    expect(p!.gaps).toEqual([]);
  });
  it("a probate 25 years after a linked death gives no 20-year gap", async () => {
    const p = await plan(project([
      { fact: "residence", date: "1880", sp: OHIO },
      { fact: "death", date: "1885", sp: OHIO },
      { fact: "burial", date: "1885", sp: OHIO },
      { fact: "probate", date: "1910", sp: OHIO },
    ]));
    expect(p!.gaps.filter((g: any) => g.expected_events.includes("residence"))).toEqual([]);
  });
});

describe("the marriage gap (S3)", () => {
  const household = (marriage: string | null) =>
    project([
      ...(marriage ? [{ fact: "marriage", date: marriage, sp: OHIO, record: "ark:/61903/1:1:M" }] : []),
      { fact: "residence", date: "1880", sp: OHIO, record: "ark:/61903/1:1:C1880", role: "head_of_household", persona: "p_head" },
      { fact: "relationship", record: "ark:/61903/1:1:C1880", role: "child_1", persona: "p_son", value: "son",
        structured: { relationship_type: "son", related_person_role: "head_of_household" }, linked: false },
      { fact: "birth", date: "abt 1865", record: "ark:/61903/1:1:C1880", role: "child_1", persona: "p_son", linked: false },
    ]);
  it("marriage 1865 and a census son born about 1865: no gap", async () => {
    const p = await plan(household("1865"));
    expect(p!.gaps.some((g: any) => g.expected_events.includes("marriage"))).toBe(false);
  });
  it("no marriage and the same son: one gap ending at the census", async () => {
    const p = await plan(household(null));
    expect(p!.gaps.filter((g: any) => g.expected_events.includes("marriage"))).toEqual([
      expect.objectContaining({ start: "1880", end: "1880", severity: "high", expected_events: ["marriage"] }),
    ]);
  });
  it("a census child record that also carries the subject's age-derived birth: the gap ends at the census", async () => {
    const p = await plan(project([
      { fact: "residence", date: "1856", sp: OHIO, record: "ark:/61903/1:1:R1856" },
      { fact: "birth", date: "abt 1840", record: "ark:/61903/1:1:C1880", role: "head_of_household", persona: "p_head" },
      { fact: "residence", date: "1880", sp: OHIO, record: "ark:/61903/1:1:C1880", role: "head_of_household", persona: "p_head" },
      { fact: "relationship", record: "ark:/61903/1:1:C1880", role: "child_1", persona: "p_son", value: "son",
        structured: { relationship_type: "son", related_person_role: "head_of_household" }, linked: false },
      { fact: "birth", date: "1860", record: "ark:/61903/1:1:C1880", role: "child_1", persona: "p_son", linked: false },
    ]));
    expect(p!.gaps.filter((g: any) => g.expected_events.includes("marriage"))).toEqual([
      expect.objectContaining({ start: "1856", end: "1880", expected_events: ["marriage"] }),
    ]);
  });
  it("an undated linked marriage can precede the first child, so no gap", async () => {
    const research = household(null);
    research.assertions.push({
      id: "a_009", record_id: "ark:/61903/1:1:D", record_role: "spouse", record_persona_id: null,
      fact_type: "marriage", value: "wife of Tom Test", date: null, date_certainty: null, place: null, standard_place: null,
    });
    link(research, "I1", ["a_009"]);
    const p = await plan(research);
    expect(p!.gaps.some((g: any) => g.expected_events.includes("marriage"))).toBe(false);
  });
  it("the subject's own household-child assertion ('son') gives no marriage gap", async () => {
    const p = await plan(project([
      { fact: "residence", date: "1850", sp: OHIO, record: "ark:/61903/1:1:C1850", role: "child_1", persona: "p_me" },
      { fact: "relationship", record: "ark:/61903/1:1:C1850", role: "child_1", persona: "p_me", value: "son",
        structured: { relationship_type: "son", related_person_role: "head_of_household" } },
    ]));
    expect(p!.gaps.some((g: any) => g.expected_events.includes("marriage"))).toBe(false);
  });
  it("an inferred child relationship does not count", async () => {
    const research = household(null);
    research.assertions[1].structured_value = { relationship_type: "child_inferred", related_person_role: "head_of_household" };
    const p = await plan(research);
    expect(p!.gaps.some((g: any) => g.expected_events.includes("marriage"))).toBe(false);
  });
});

// ── Dates ───────────────────────────────────────────────────────────────────

describe("dates", () => {
  it("abt 1845, 1850 and 12 March 1908 are ~1845, 1850 and 1908-03-12, in that order", async () => {
    const p = await plan(project([
      { fact: "death", date: "12 March 1908", sp: OHIO },
      { fact: "residence", date: "1850", sp: OHIO },
      { fact: "birth", date: "abt 1845", sp: OHIO },
    ]));
    expect(p!.events.map((e: any) => e.date)).toEqual(["~1845", "1850", "1908-03-12"]);
  });
  it("between 1836 and 1848 is 1836-1848, estimated", () => {
    expect(formatEventDate("between 1836 and 1848", null)).toMatchObject({ date: "1836-1848", certainty: "estimated" });
  });
  it("1845? is 1845, and before or after a day shifts by a day", () => {
    expect(formatEventDate("1845?", null)?.date).toBe("1845");
    expect(formatEventDate("bef 8 Feb 1890", null)).toMatchObject({ date: "1890-02-07", certainty: "estimated" });
    expect(formatEventDate("after 1850", null)).toMatchObject({ date: "1851", certainty: "estimated" });
  });
  it("a stored before/after/between certainty is written estimated, and the write is accepted", () => {
    for (const c of ["before", "after", "between"]) {
      expect(formatEventDate("1940", c)?.certainty).toBe("estimated");
    }
  });
  it("quarter and split-year dates", () => {
    expect(formatEventDate("Q2 1850", null)?.date).toBe("1850-04");
    expect(formatEventDate("28 Feb 1623/24", null)?.date).toBe("1624-02-28");
  });
  it("an X-or-Y date makes an event", async () => {
    // stdDate writes "X or Y" only for an ambiguous numeric date.
    const p = await plan(project([{ fact: "birth", date: "3/9/1878", sp: OHIO }]));
    expect(p!.events).toEqual([expect.objectContaining({ date: "1878-03-09", date_certainty: "estimated" })]);
  });
  it("an undated assertion joins its record and party's event of the same type, or makes none", async () => {
    const joined = await plan(project([
      { fact: "birth", place: "Pennsylvania", sp: "Pennsylvania, United States", record: "ark:/61903/1:1:X", persona: "p_1" },
      { fact: "birth", date: "1845", record: "ark:/61903/1:1:X", persona: "p_1" },
    ]));
    expect(joined!.events).toEqual([expect.objectContaining({ date: "1845", standard_place: "Pennsylvania, United States", assertion_ids: ["a_002", "a_001"] })]);
    const alone = await plan(project([
      { fact: "birth", date: "17 May", record: "ark:/61903/1:1:X" },
      { fact: "residence", date: "1850", sp: OHIO, record: "ark:/61903/1:1:Y" },
    ]));
    expect(alone!.events.map((e: any) => e.assertion_ids)).toEqual([["a_002"]]);
  });
  it("gap boundaries are copied from the events, never padded", async () => {
    const p = await plan(project([{ fact: "residence", date: "1850", sp: OHIO }, { fact: "residence", date: "1880", sp: OHIO }]));
    for (const g of p!.gaps) {
      expect(g.start).not.toMatch(/-01-01$/);
      expect(g.end).not.toMatch(/-12-31$/);
    }
  });
});

describe("the census-1870 record-extract fixture", () => {
  it("joins the split birth into one Pennsylvania event (age-derived, so ~1845), and the 1870 census expects 1850 and 1860", async () => {
    const fx = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/record-extract/census-1870-no-relationship-column.json"), "utf-8"));
    const out = extractRecord(fx.element ?? fx, { questionIds: [] } as any);
    const mine = out.assertions.filter((a: any) => a.record_persona_id === "p_260900945");
    const research = {
      assertions: mine.map((a: any, i: number) => ({ ...a, id: `a_${String(i + 1).padStart(3, "0")}`, record_id: "ark:/61903/1:1:C1870" })),
      person_evidence: [] as any[],
      conflicts: [],
      timelines: [],
    };
    link(research, "I1", research.assertions.map((a: any) => a.id));
    const p = await planTimeline(research, man, places({
      Pennsylvania: "Pennsylvania, United States",
      "Lower Towamensing Township, Carbon, Pennsylvania, United States": "Lower Towamensing, Carbon, Pennsylvania, United States",
    }));
    const births = p!.events.filter((e: any) => e.event_type === "birth");
    expect(births).toEqual([expect.objectContaining({ date: "~1845", standard_place: "Pennsylvania, United States" })]);
    expect(census(p)).toEqual(["1850 United States census", "1860 United States census"]);
  });
});

describe("places and the deadline", () => {
  it("a raw place with no standard_place is resolved, and distances are computed", async () => {
    const p = await plan(
      project([{ fact: "residence", date: "1850", place: "Columbus, Ohio" }, { fact: "residence", date: "1860", sp: PA }]),
      man,
      places({ "Columbus, Ohio": OHIO }, { [OHIO]: [39.96, -83.0], [PA]: [40.44, -80.0] }),
    );
    expect(p!.events[0].standard_place).toBe(OHIO);
    expect(p!.events[1].distance_from_previous_km).toBeGreaterThan(200);
  });
  it("takes an event's standard place only from an assertion of its own place text, else resolves the text", async () => {
    const CINCINNATI = "Cincinnati, Hamilton, Ohio, United States";
    const p = await plan(
      project([
        { fact: "birth", date: "1850", record: "ark:/61903/1:1:R1", place: "Ohio" },
        { fact: "birth", date: "1850", record: "ark:/61903/1:1:R1", place: "Cincinnati, Ohio", sp: CINCINNATI },
        { fact: "death", date: "1900", record: "ark:/61903/1:1:R2", place: "Columbus, Ohio" },
        { fact: "death", date: "1900", record: "ark:/61903/1:1:R2", place: "columbus,  ÓHIO", sp: OHIO },
      ]),
      man,
      places({ Ohio: "Ohio, United States" }),
    );
    expect(p!.events.map((e: any) => [e.place, e.standard_place])).toEqual([
      ["Ohio", "Ohio, United States"],
      ["Columbus, Ohio", OHIO],
    ]);
  });
  it("a Places lookup that never answers leaves its checks out and still returns before the deadline", async () => {
    const never = { resolvePlace: () => new Promise<string | null>(() => {}), placeCoords: () => new Promise<any>(() => {}), deadlineMs: 200 };
    const t0 = Date.now();
    const p = await plan(project([{ fact: "residence", date: "1850", place: "Columbus, Ohio" }, { fact: "residence", date: "1880", place: "Columbus, Ohio" }]), man, never);
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(census(p)).toEqual([]);
    expect(p!.events.every((e: any) => e.distance_from_previous_km === null)).toBe(true);
    expect(p!.skipped.length).toBeGreaterThan(0);
  });
  describe("with the wall clock stopped while the deadline timer runs", () => {
    let clock: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      clock = vi.spyOn(Date, "now").mockReturnValue(Date.now());
    });
    afterEach(() => clock.mockRestore());
    const hangs = () => new Promise<any>(() => {});
    it("a place resolution the deadline cut short is still reported", async () => {
      const p = await plan(project([{ fact: "residence", date: "1850", place: "Columbus, Ohio" }]), man, {
        resolvePlace: hangs, placeCoords: hangs, deadlineMs: 200,
      });
      expect(p!.skipped).toContain("standardizing some places");
    });
    it("a coordinates lookup the deadline cut short is still reported", async () => {
      const p = await plan(project([{ fact: "residence", date: "1850", sp: PA }, { fact: "residence", date: "1860", sp: OHIO }]), man, {
        ...places(), placeCoords: hangs, deadlineMs: 200,
      });
      expect(p!.skipped).toContain("some distances");
    });
  });
  it("a lookup that answers null with no time left is not reported as skipped", async () => {
    const p = await plan(
      project([{ fact: "residence", date: "1850", place: "Nowhere" }, { fact: "residence", date: "1860", sp: PA }]),
      man,
      { ...places(), deadlineMs: 0 },
    );
    expect(p!.events.every((e: any) => e.distance_from_previous_km === null)).toBe(true);
    expect(p!.skipped).toEqual([]);
  });
});

describe("nothing linked", () => {
  it("returns null with no live link", async () => {
    expect(await plan(project([{ fact: "birth", date: "1850", linked: false }]))).toBeNull();
  });
});

// ── End to end: the tool reads, writes and updates the project. ─────────────

describe("timelineBuild on a project", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "timeline-build-"));
    for (const f of ["research.json", "tree.gedcomx.json"]) {
      await copyFile(join(SCENARIOS, "mid-research-flynn", f), join(dir, f));
    }
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  const read = async () => JSON.parse(await readFile(join(dir, "research.json"), "utf-8"));
  const deps = places({
    Ireland: "Ireland",
    "Schuylkill County, Pennsylvania": "Schuylkill, Pennsylvania, United States",
    Pennsylvania: "Pennsylvania, United States",
  });

  it("appends a person timeline beside the hypothesis one and leaves that alone", async () => {
    const before = await read();
    const r: any = await timelineBuild({ projectPath: dir, personId: "I1" }, deps);
    expect(r).toMatchObject({ ok: true, status: "written" });
    const after = await read();
    expect(after.timelines).toHaveLength(2);
    expect(after.timelines.find((t: any) => t.id === "t_001")).toEqual(before.timelines.find((t: any) => t.id === "t_001"));
    const mine = after.timelines.find((t: any) => t.id === r.timelineId);
    expect(mine.person_ids).toEqual(["I1"]);
    expect(mine.hypothesis_id ?? null).toBeNull();
  });

  it("a rerun updates the person's timeline in place", async () => {
    const first: any = await timelineBuild({ projectPath: dir, personId: "I1" }, deps);
    const second: any = await timelineBuild({ projectPath: dir, personId: "I1" }, deps);
    expect(second).toMatchObject({ ok: true, status: "updated", timelineId: first.timelineId });
    expect((await read()).timelines).toHaveLength(2);
  });

  it("a FamilySearch id resolves, and a timeline holding that id is updated, not duplicated", async () => {
    const tree = JSON.parse(await readFile(join(dir, "tree.gedcomx.json"), "utf-8"));
    tree.persons.find((p: any) => p.id === "I1").ark = "ark:/61903/4:1:KWCJ-RN4";
    await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify(tree), "utf-8");
    const first: any = await timelineBuild({ projectPath: dir, personId: "KWCJ-RN4" }, deps);
    expect(first).toMatchObject({ ok: true, status: "written" });
    const research = await read();
    research.timelines.find((t: any) => t.id === first.timelineId).person_ids = ["KWCJ-RN4"];
    await writeFile(join(dir, "research.json"), JSON.stringify(research), "utf-8");
    const second: any = await timelineBuild({ projectPath: dir, personId: "I1" }, deps);
    expect(second).toMatchObject({ status: "updated", timelineId: first.timelineId });
    expect((await read()).timelines.find((t: any) => t.id === first.timelineId).person_ids).toEqual(["KWCJ-RN4"]);
  });

  it("a person timeline written while this run looks up places is updated, not duplicated", async () => {
    let written = false;
    const racing = {
      ...deps,
      placeCoords: async (sp: string) => {
        if (!written) {
          written = true;
          const research = await read();
          research.timelines.push({
            id: "t_099", label: "other run", person_ids: ["I1"], generated: "2026-01-01T00:00:00Z", events: [], gaps: [],
          });
          await writeFile(join(dir, "research.json"), JSON.stringify(research), "utf-8");
        }
        return deps.placeCoords(sp);
      },
    };
    const r: any = await timelineBuild({ projectPath: dir, personId: "I1" }, racing);
    expect(written).toBe(true);
    expect(r).toMatchObject({ ok: true, status: "updated", timelineId: "t_099" });
    expect((await read()).timelines.filter((t: any) => t.person_ids.join() === "I1" && t.hypothesis_id == null)).toHaveLength(1);
  });

  it("a two-person timeline, and one naming a stale id, are left alone", async () => {
    const research = await read();
    research.timelines.push(
      { id: "t_090", label: "two", person_ids: ["I1", "I2"], generated: "2026-01-01T00:00:00Z", events: [], gaps: [] },
      { id: "t_091", label: "stale", person_ids: ["NOPE-123"], generated: "2026-01-01T00:00:00Z", events: [], gaps: [] },
    );
    await writeFile(join(dir, "research.json"), JSON.stringify(research), "utf-8");
    const r: any = await timelineBuild({ projectPath: dir, personId: "I1" }, deps);
    expect(r).toMatchObject({ ok: true, status: "written" });
  });

  it("nothing linked writes nothing and says so", async () => {
    const before = await readFile(join(dir, "research.json"), "utf-8");
    const r: any = await timelineBuild({ projectPath: dir, personId: "I4" }, deps);
    expect(r).toEqual({
      ok: true,
      status: "no_linked_evidence",
      summary: "No record yet places this person; no timeline was written.",
    });
    expect(await read()).toEqual(JSON.parse(before));
  });

  it("the summary names unverified events, high gaps and the census basis", async () => {
    const r: any = await timelineBuild({ projectPath: dir, personId: "I1" }, deps);
    expect(r.summary).toMatch(/events? from linked records/);
    expect(r.summary).toMatch(/Census years expected are those FamilySearch has indexed\./);
  });

  it("a person not in the tree is ok:false, naming the id", async () => {
    const r: any = await timelineBuild({ projectPath: dir, personId: "nobody" }, deps);
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/'nobody' not found/);
  });

  it("a refused write is relayed as ok:false with the writer's errors, and writes nothing", async () => {
    const research = await read();
    research.timelines = { not: "an array" };
    const text = JSON.stringify(research);
    await writeFile(join(dir, "research.json"), text, "utf-8");
    const r: any = await timelineBuild({ projectPath: dir, personId: "I1" }, deps);
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
    expect(await read()).toEqual(JSON.parse(text));
  });
});

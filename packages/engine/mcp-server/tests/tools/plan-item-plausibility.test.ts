import { describe, it, expect } from "vitest";
import { compoundJurisdictionError, planItemFlags, planWindowFlag } from "../../src/utils/plan-item-plausibility.js";

// Phase 3 item 5: "dead ends become next actions", and the next actions have to be
// usable. In the reported failure 2 of 8, then 1 of 3 suggestions were viable -- the
// rest "in the wrong place or years", including COUNTY records for a death in an
// independent city the locality guide had already flagged.
//
// A FLAG, never a gate. Searching a neighbouring jurisdiction can be deliberate and
// right, so this reports and the researcher decides. Repo doctrine: heuristics are
// flags, never gates.

const loc = (place: string): { place: string } => ({ place });

describe("planItemFlags — jurisdiction", () => {
  it("is quiet when the item sits inside a recorded locality", () => {
    const item = { jurisdiction: "Detroit, Wayne, Michigan, United States", date_range: "1880-1880" };
    expect(planItemFlags(item, [loc("Wayne, Michigan, United States")])).toEqual([]);
  });

  it("is quiet when the item IS the recorded locality", () => {
    const item = { jurisdiction: "Wayne, Michigan, United States", date_range: "1880-1880" };
    expect(planItemFlags(item, [loc("Wayne, Michigan, United States")])).toEqual([]);
  });

  it("flags a county search when the locality is an independent city", () => {
    // The reported failure, exactly: Baltimore City is independent and belongs to no
    // county, so county records cannot hold the death.
    const item = { jurisdiction: "Baltimore County, Maryland, United States", date_range: "1908-1908" };
    const flags = planItemFlags(item, [loc("Baltimore, Maryland, United States")]);
    expect(flags.some((f) => f.kind === "jurisdiction")).toBe(true);
  });

  it("says nothing when no locality has been recorded — it cannot know", () => {
    const item = { jurisdiction: "Anywhere, Nowhere", date_range: "1880-1880" };
    expect(planItemFlags(item, [])).toEqual([]);
  });

  it("is quiet when ANY recorded locality contains the item", () => {
    const item = { jurisdiction: "Baltimore, Maryland, United States", date_range: "1908-1908" };
    const flags = planItemFlags(item, [loc("Wayne, Michigan, United States"), loc("Baltimore, Maryland, United States")]);
    expect(flags).toEqual([]);
  });

  // Found in #3262's self-review: `jurisdiction` and a recorded locality are populated
  // by different callers, and only one routinely carries a trailing country. The same
  // place then compared as unrelated because the tail comparison no longer lined up.
  it("is quiet when the jurisdiction carries a country the recorded locality omits", () => {
    const item = { jurisdiction: "Detroit, Wayne, Michigan, United States", date_range: "1880-1880" };
    expect(planItemFlags(item, [loc("Wayne, Michigan")])).toEqual([]);
  });

  it("is quiet when the recorded locality carries a country the jurisdiction omits", () => {
    const item = { jurisdiction: "Detroit, Wayne, Michigan", date_range: "1880-1880" };
    expect(planItemFlags(item, [loc("Wayne, Michigan, United States")])).toEqual([]);
  });

  it("still flags a genuinely wrong county on either side of a country mismatch", () => {
    // The fix above must not turn ANY mismatch into a match -- only one that fails
    // solely on an extra outermost segment. A wrong county sits at the county/city
    // level, which stripping one OUTERMOST segment never reaches.
    const item = { jurisdiction: "Baltimore County, Maryland, United States", date_range: "1908-1908" };
    expect(
      planItemFlags(item, [loc("Baltimore, Maryland")]).some((f) => f.kind === "jurisdiction")
    ).toBe(true);
  });
});

describe("planItemFlags — enclosing jurisdictions", () => {
  // A statewide or national search covers the recorded county, so it is in the right
  // place. Routine, and flagging it drowned the real cases.
  for (const jurisdiction of ["Michigan, United States", "Michigan", "United States"]) {
    it(`is quiet for ${jurisdiction}, which encloses the recorded locality`, () => {
      expect(planItemFlags({ jurisdiction }, [loc("Wayne, Michigan, United States")])).toEqual([]);
    });
  }

  it("still flags a different state", () => {
    const flags = planItemFlags({ jurisdiction: "Ohio, United States" },
      [loc("Wayne, Michigan, United States")]);
    expect(flags.some((f) => f.kind === "jurisdiction")).toBe(true);
  });

  it("does not explain every flag with independent cities", () => {
    // The sentence was attached whether or not a city was involved.
    const [flag] = planItemFlags({ jurisdiction: "Ohio, United States" },
      [loc("Wayne, Michigan, United States")]);
    expect(flag.message).not.toMatch(/independent city/i);
  });
});

describe("planItemFlags — years", () => {
  it("flags a reversed range", () => {
    const item = { jurisdiction: "Wayne, Michigan, United States", date_range: "1920-1880" };
    const flags = planItemFlags(item, [loc("Wayne, Michigan, United States")]);
    expect(flags.some((f) => f.kind === "date_range")).toBe(true);
  });

  it("accepts a single-year range, which is how the corpus writes most of them", () => {
    const item = { jurisdiction: "Wayne, Michigan, United States", date_range: "1900-1900" };
    expect(planItemFlags(item, [loc("Wayne, Michigan, United States")])).toEqual([]);
  });

  it("says nothing about a range it cannot parse rather than guessing", () => {
    const item = { jurisdiction: "Wayne, Michigan, United States", date_range: "c. 1880s" };
    expect(planItemFlags(item, [loc("Wayne, Michigan, United States")])).toEqual([]);
  });

  it("never throws on a malformed item", () => {
    for (const bad of [{}, { jurisdiction: 5 }, { date_range: null }] as unknown[]) {
      expect(() => planItemFlags(bad as never, [loc("X")])).not.toThrow();
    }
  });
});

// --- The flags, through the real writer tool ----------------------------------------
//
// should-fix 14 of the #3262 self-review: this module was marked BUILT and imported by
// nothing but this file. A correct function nothing invokes looks identical to a working
// feature -- the plan called it built for two weeks while no caller existed.

import { researchAppend } from "../../src/tools/research-append.js";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function project(research: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), "plan-"));
  mkdirSync(join(dir, "results"), { recursive: true });
  writeFileSync(join(dir, "research.json"), JSON.stringify({
    project: { id: "rp_t", status: "active" },
    questions: [{ id: "q_001", question: "Who were his parents?" }],
    plans: [{ id: "pl_001", question_id: "q_001" }],
    plan_items: [], log: [], sources: [], assertions: [], person_evidence: [],
    conflicts: [], hypotheses: [], timelines: [], proof_summaries: [],
    evaluations: [],
    localities: [{ id: "lo_001", place: "Schuylkill, Pennsylvania" }],
    ...research
  }), "utf8");
  writeFileSync(join(dir, "tree.gedcomx.json"),
    JSON.stringify({ persons: [{ id: "I1" }], relationships: [], sources: [] }), "utf8");
  return dir;
}

/** A schema-valid plan item; the tests vary only the field under test. */
const ITEM = {
  sequence: 1,
  record_type: "civil",
  jurisdiction: "Schuylkill, Pennsylvania",
  date_range: "1900-1910",
  repository: "FamilySearch",
  rationale: "Civil death registers name parents in this jurisdiction after 1893.",
  fallback_for: null,
  status: "planned",
};

async function append(dir: string, entry: Record<string, unknown>) {
  const out = await researchAppend({
    projectPath: dir, section: "plan_items", op: "append", planId: "pl_001", entry,
  } as never, undefined as never).catch((e: Error) => e);
  return out instanceof Error ? out.message : JSON.stringify(out);
}

describe("research_append surfaces the plan-item flags", () => {
  it("warns when the jurisdiction sits outside every recorded locality", async () => {
    const text = await append(project({}), { ...ITEM, jurisdiction: "Fairfax, Virginia" });
    expect(text).toMatch(/Fairfax, Virginia is not inside any locality/);
    // Names the localities it DID compare against, or the researcher cannot tell a
    // real inconsistency from a project that simply has not recorded a place yet.
    expect(text).toMatch(/Schuylkill, Pennsylvania/);
  });

  it("does NOT refuse the write — flags, never gates", async () => {
    // Searching a neighbouring jurisdiction can be deliberate. The whole design rests
    // on this reporting rather than blocking, so a refusal here is the defect.
    const text = await append(project({}), { ...ITEM, jurisdiction: "Fairfax, Virginia" });
    expect(text).toMatch(/"ok":\s*true/);
  });

  it("stays silent on a jurisdiction inside a recorded locality", async () => {
    const text = await append(project({}), { ...ITEM, jurisdiction: "Pottsville, Schuylkill, Pennsylvania" });
    expect(text).not.toMatch(/outside|inconsistent/i);
  });
});


// Issue #2424 (umbrella #2475): a plan that stops short of its question's own date
// window. The window is stated on the question by question-selection; the subject's
// lifetime is not a stand-in (measured: 145 of 391 committed plan-bearing questions,
// correct plans included). Advisory, decided 2026-10-01.

const q = (date_window?: string) => ({ id: "q_001", ...(date_window ? { date_window } : {}) });
const plan = (ranges: string[], extra: Record<string, unknown> = {}) => ({
  id: "pl_001", question_id: "q_001", status: "active",
  items: ranges.map((date_range) => ({ date_range, status: "planned" })), ...extra,
});

describe("planWindowFlag", () => {
  it("fires on the anders-monsen shape: items from 1797 against a 1777-1799 marriage window", () => {
    const msg = planWindowFlag(q("1777-1799"), [plan(["1820-1900", "1797-1900", "1891"])]);
    expect(msg).toMatch(/q_001's plans span 1797–1900 but its date window is 1777–1799: 20 of its 23 years/);
  });

  it("fires on the Rule B shape: censuses 1850 and 1860 against a 1845-1908 window", () => {
    expect(planWindowFlag(q("1845-1908"), [plan(["1850-1850", "1860"])])).toMatch(/53 of its 64 years/);
  });

  it("is silent on the correct marriage plan, 1770-1800", () => {
    expect(planWindowFlag(q("1777-1799"), [plan(["1770-1800"])])).toBeNull();
  });

  it("judges the span, not summed years: single-year censuses 1850…1900 cover 1845-1908", () => {
    expect(planWindowFlag(q("1845-1908"), [plan(["1850", "1860", "1870", "1880", "1900"])])).toBeNull();
  });

  it("pins the threshold at more than half: 10 of 20 uncovered is silent, 11 of 20 fires", () => {
    expect(planWindowFlag(q("1800-1819"), [plan(["1810-1819"])])).toBeNull();
    expect(planWindowFlag(q("1800-1819"), [plan(["1811-1819"])])).toMatch(/11 of its 20 years/);
  });

  it("counts a plan entirely outside the window as fully uncovered", () => {
    expect(planWindowFlag(q("1777-1799"), [plan(["1840-1880"])])).toMatch(/23 of its 23 years/);
  });

  it("has no opinion without a window, with a malformed one, or with no parseable item", () => {
    expect(planWindowFlag(q(), [plan(["1840-1880"])])).toBeNull();
    expect(planWindowFlag(q("c. 1780s"), [plan(["1840-1880"])])).toBeNull();
    expect(planWindowFlag(q("1799-1777"), [plan(["1840-1880"])])).toBeNull();
    expect(planWindowFlag(q("1777-1799"), [plan(["c. 1880s", ""])])).toBeNull();
  });

  it("leaves out skipped items and superseded plans — they search nothing", () => {
    const skipped = plan(["1770-1800"]);
    (skipped.items[0] as any).status = "skipped";
    expect(planWindowFlag(q("1777-1799"), [skipped, plan(["1840-1880"], { id: "pl_002" })])).toMatch(/23 of/);
    const retired = plan(["1770-1800"], { status: "superseded" });
    expect(planWindowFlag(q("1777-1799"), [retired, plan(["1840-1880"], { id: "pl_002" })])).toMatch(/23 of/);
  });

  it("reads only the question's own plans", () => {
    const other = plan(["1770-1800"], { id: "pl_002", question_id: "q_002" });
    expect(planWindowFlag(q("1777-1799"), [other, plan(["1840-1880"])])).toMatch(/23 of/);
  });
});

describe("research_append surfaces the date-window flag", () => {
  const WINDOW_Q = [{ id: "q_001", question: "When did he marry?", date_window: "1777-1799" }];
  const withItems = (ranges: string[]) => [{
    id: "pl_001", question_id: "q_001", status: "active",
    items: ranges.map((date_range, i) => ({ ...ITEM, id: `pli_00${i + 1}`, sequence: i + 1, date_range })),
  }];

  it("warns on an item append that leaves the window uncovered, and still writes", async () => {
    const dir = project({ questions: WINDOW_Q, plans: withItems(["1820-1900"]) });
    const text = await append(dir, { ...ITEM, date_range: "1840-1880" });
    expect(text).toMatch(/"ok":\s*true/);
    expect(text).toMatch(/date window is 1777–1799/);
  });

  it("is silent when the plan reaches the window", async () => {
    const dir = project({ questions: WINDOW_Q, plans: withItems(["1820-1900"]) });
    expect(await append(dir, { ...ITEM, date_range: "1770-1800" })).not.toMatch(/date window/);
  });

  it("is silent for a question with no date_window", async () => {
    const dir = project({ plans: withItems(["1820-1900"]) });
    expect(await append(dir, { ...ITEM, date_range: "1840-1880" })).not.toMatch(/date window/);
  });

  it("does not re-warn on a status-only item update — a search agent's write", async () => {
    const dir = project({ questions: WINDOW_Q, plans: withItems(["1820-1900"]) });
    const out = await researchAppend({
      projectPath: dir, section: "plan_items", op: "update", planId: "pl_001",
      entryId: "pli_001", fields: { status: "in_progress" },
    } as never, undefined as never);
    expect(JSON.stringify(out)).not.toMatch(/date window/);
  });

  it("warns on an update that moves an item's date_range out of the window", async () => {
    const dir = project({ questions: WINDOW_Q, plans: withItems(["1770-1800"]) });
    const out = await researchAppend({
      projectPath: dir, section: "plan_items", op: "update", planId: "pl_001",
      entryId: "pli_001", fields: { date_range: "1840-1880" },
    } as never, undefined as never);
    expect(JSON.stringify(out)).toMatch(/date window is 1777–1799/);
  });

  it("warns on a plans append whose inline items leave the window uncovered, and still writes", async () => {
    const dir = project({ questions: WINDOW_Q, plans: [] });
    const out = await researchAppend({
      projectPath: dir, section: "plans", op: "append",
      entry: { question_id: "q_001", status: "active", items: [{ ...ITEM, id: "pli_001", date_range: "1840-1880" }] },
    } as never, undefined as never).catch((e: Error) => e);
    const text = out instanceof Error ? out.message : JSON.stringify(out);
    expect(text).toMatch(/"ok":\s*true/);
    expect(text).toMatch(/date window is 1777–1799/);
  });

  it("warns on a plans update that replaces items with an uncovered set", async () => {
    const dir = project({ questions: WINDOW_Q, plans: withItems(["1770-1800"]) });
    const out = await researchAppend({
      projectPath: dir, section: "plans", op: "update", entryId: "pl_001",
      fields: { items: [{ ...ITEM, id: "pli_001", date_range: "1840-1880" }] },
    } as never, undefined as never);
    expect(JSON.stringify(out)).toMatch(/date window is 1777–1799/);
  });

  it("warns once per question for a batch of two item appends", async () => {
    const dir = project({ questions: WINDOW_Q, plans: withItems(["1820-1900"]) });
    const out = await researchAppend({
      projectPath: dir,
      ops: [
        { section: "plan_items", op: "append", planId: "pl_001", entry: { ...ITEM, date_range: "1840-1880" } },
        { section: "plan_items", op: "append", planId: "pl_001", entry: { ...ITEM, sequence: 2, date_range: "1850-1890" } },
      ],
    } as never, undefined as never);
    expect(JSON.stringify(out).match(/date window is 1777–1799/g)).toHaveLength(1);
  });
});

// A plan item names one place: search-records hands its jurisdiction to record_search
// as the one residencePlace. A run of ut_research_plan_wzk wrote "Alabama and Texas,
// United States", was only warned, and returned the warning as "cosmetic".

const TWO_STATES = [loc("Alabama, United States"), loc("Texas, United States")];

describe("compoundJurisdictionError", () => {
  for (const jurisdiction of [
    "Alabama and Texas, United States",
    "Hill County, Texas and Alabama, United States",
    "Blount County, Alabama and Smith County, Texas, United States",
    "Texas and Alabama",
    "Texas & Alabama",
    "Alabama or Texas",
    "Blount County, Alabama; Smith County, Texas",
    "Alabama / Texas, United States",
  ]) {
    it(`refuses ${jurisdiction}, every part of which is a researched locality`, () => {
      expect(compoundJurisdictionError({ jurisdiction }, TWO_STATES)).toMatch(/names \d places .*one item per place/);
    });
  }

  for (const [jurisdiction, localities] of [
    ["Lewis and Clark County, Montana, United States", [loc("Montana, United States")]],
    ["Antigua and Barbuda", [loc("Antigua and Barbuda")]],
    ["East and West Feliciana Parish, Louisiana", [loc("Louisiana, United States")]],
    ["Alabama and Georgia, United States", TWO_STATES],
    ["Smith County and Hill County, Texas", TWO_STATES],
    ["Andalusia, Covington, Alabama, United States", TWO_STATES],
    ["Alabama and Texas, United States", []],
  ] as const) {
    it(`leaves ${jurisdiction} alone (${localities.length} localities)`, () => {
      expect(compoundJurisdictionError({ jurisdiction }, [...localities])).toBeUndefined();
    });
  }

  it("never throws on a malformed item", () => {
    for (const bad of [{}, { jurisdiction: 7 }, { jurisdiction: null }, null as never]) {
      expect(compoundJurisdictionError(bad as never, TWO_STATES)).toBeUndefined();
    }
  });
});

describe("research_append refuses a plan item that names two places", () => {
  const states = { localities: [{ id: "lo_001", place: "Alabama, United States" }, { id: "lo_002", place: "Texas, United States" }] };

  it("refuses the append and writes nothing", async () => {
    const dir = project(states);
    const text = await append(dir, { ...ITEM, jurisdiction: "Alabama and Texas, United States" });
    expect(text).toMatch(/"ok":\s*false/);
    expect(text).toMatch(/names 2 places \(Alabama; Texas, United States\)/);
    expect(JSON.parse(readFileSync(join(dir, "research.json"), "utf8")).plans[0].items ?? []).toEqual([]);
  });

  it("refuses the same item inline on a plans append", async () => {
    const out = await researchAppend({
      projectPath: project(states), section: "plans", op: "append",
      entry: { question_id: "q_001", status: "active", items: [{ ...ITEM, id: "pli_001", jurisdiction: "Texas and Alabama" }] },
    } as never, undefined as never).catch((e: Error) => e);
    expect(out instanceof Error ? out.message : JSON.stringify(out)).toMatch(/names 2 places/);
  });

  it("accepts one item per place", async () => {
    const dir = project(states);
    expect(await append(dir, { ...ITEM, jurisdiction: "Alabama, United States" })).toMatch(/"ok":\s*true/);
    expect(await append(dir, { ...ITEM, sequence: 2, jurisdiction: "Texas, United States" })).toMatch(/"ok":\s*true/);
  });

  it("does not hold an edit to a compound item written before the rule", async () => {
    const dir = project({ ...states, plans: [{ id: "pl_001", question_id: "q_001", status: "active", items: [
      { ...ITEM, id: "pli_001", jurisdiction: "Alabama and Texas, United States" },
    ] }] });
    const out = await researchAppend({
      projectPath: dir, section: "plan_items", op: "update", planId: "pl_001", entryId: "pli_001",
      fields: { rationale: "Reworded." },
    } as never, undefined as never).catch((e: Error) => e);
    expect(out instanceof Error ? out.message : JSON.stringify(out)).toMatch(/"ok":\s*true/);
  });

  it("does not hold an update that re-sends the stored compound jurisdiction", async () => {
    const dir = project({ ...states, plans: [{ id: "pl_001", question_id: "q_001", status: "active", items: [
      { ...ITEM, id: "pli_001", jurisdiction: "Alabama and Texas, United States" },
    ] }] });
    const out = await researchAppend({
      projectPath: dir, section: "plan_items", op: "update", planId: "pl_001", entryId: "pli_001",
      fields: { jurisdiction: "Alabama and Texas, United States", rationale: "Reworded." },
    } as never, undefined as never).catch((e: Error) => e);
    expect(out instanceof Error ? out.message : JSON.stringify(out)).toMatch(/"ok":\s*true/);
  });

  it("checks an inline item on a plans update only when its jurisdiction changed", async () => {
    const stored = { ...ITEM, id: "pli_001", jurisdiction: "Alabama and Texas, United States" };
    const plans = [{ id: "pl_001", question_id: "q_001", status: "active", items: [stored] }];
    const update = (items: unknown[]) => researchAppend({
      projectPath: project({ ...states, plans }), section: "plans", op: "update", entryId: "pl_001",
      fields: { items },
    } as never, undefined as never).then(JSON.stringify, (e: Error) => e.message);
    expect(await update([{ ...stored, rationale: "Reworded." }])).toMatch(/"ok":\s*true/);
    expect(await update([{ ...stored, jurisdiction: "Texas and Alabama" }])).toMatch(/names 2 places/);
  });

  it("refuses an update that sets a compound jurisdiction", async () => {
    const dir = project({ ...states, plans: [{ id: "pl_001", question_id: "q_001", status: "active", items: [
      { ...ITEM, id: "pli_001", jurisdiction: "Alabama, United States" },
    ] }] });
    const out = await researchAppend({
      projectPath: dir, section: "plan_items", op: "update", planId: "pl_001", entryId: "pli_001",
      fields: { jurisdiction: "Alabama and Texas, United States" },
    } as never, undefined as never).catch((e: Error) => e);
    expect(out instanceof Error ? out.message : JSON.stringify(out)).toMatch(/names 2 places/);
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, writeFile, readFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

// Offline: an appended assertion with a place would otherwise geocode live.
vi.mock("../../src/utils/place-resolver.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/utils/place-resolver.js")>();
  return { ...actual, resolveStandardPlace: vi.fn(async () => null), standardPlaceToCoords: vi.fn(async () => null) };
});

import { circularCorroborationVerdict, researchAppend } from "../../src/tools/research-append.js";
import { recordMatchScore } from "../../src/utils/match-scores.js";

// The audit arm of circular corroboration (issue #4430), in the shape of feedback
// #4379: on a question that audits the tree, Phebe (P) already cites the Find a
// Grave record whose death date her tree facts repeat, and the record is linked
// back to her at `confident`.

const P = "KHTG-005"; // Phebe
const H = "KHTG-009"; // her husband

const REC = {
  fag: "ark:/61903/1:1:QK1F-YBQW", // Find a Grave, the judged record
  births: "ark:/61903/1:1:QP77-VSCV", // an undated birth index the tree does not cite
  census: "ark:/61903/1:1:CEN5-001", // a census the tree does not cite
  treeCensus: "ark:/61903/1:1:M4ZM-9TH", // a census the tree cites on Phebe
  husbandCensus: "ark:/61903/1:1:HUS9-001", // a census the tree cites on her husband
  deathIndex: "ark:/61903/1:1:DTH7-001", // another index of the same death
};

const TOWNSHIP = "Springville Township, Susquehanna, Pennsylvania, United States";
const SPRINGVILLE = "Springville, Susquehanna, Pennsylvania, United States";

function assertion(
  id: string,
  sourceId: string,
  recordId: string,
  role: string,
  factType: string,
  value: string,
  extra: Record<string, unknown> = {},
) {
  return {
    id,
    source_id: sourceId,
    record_id: recordId,
    record_role: role,
    fact_type: factType,
    value,
    information_quality: "secondary",
    informant: "unknown",
    informant_proximity: "unknown",
    record_basis: "stated",
    extracted_for_question_ids: ["q_001"],
    ...extra,
  };
}

function source(id: string, description: string) {
  return {
    id,
    gedcomx_source_description_id: description,
    citation: `Record ${id}`,
    citation_detail: {
      who: "Indexer",
      what: `Record ${id}`,
      when_created: "1858",
      when_accessed: "2026-11-24",
      where: "Pennsylvania",
      where_within: "entry 1",
    },
    source_classification: "derivative",
    repository: "FamilySearch",
    access_date: "2026-11-24",
  };
}

function question(extra: Record<string, unknown> = {}) {
  return {
    id: "q_001",
    question: "Which individuals attributed to Philip Eastman are correctly identified as his children?",
    rationale: "The objective doubts the compiled attributions.",
    selection_basis: "objective_decomposition",
    question_kind: "enumerative",
    audits_tree: true,
    priority: "high",
    status: "open",
    depends_on: [],
    unblocks: [],
    created: "2026-11-09",
    resolved: null,
    resolution_assertion_ids: [],
    search_stop: { stopped_because: null, justification: null, log_entry_ids: [], stop_criteria: null, not_reached: [] },
    ...extra,
  };
}

/** The Find a Grave entry as the run extracted it. */
const FAG = [
  assertion("a_306", "src_022", REC.fag, "deceased", "name", "Phebe Eastman Cooper"),
  assertion("a_307", "src_022", REC.fag, "deceased", "death", "died", { date: "07 Oct 1858", place: TOWNSHIP }),
  assertion("a_308", "src_022", REC.fag, "deceased", "burial", "buried", { place: TOWNSHIP }),
  assertion("a_309", "src_022", REC.fag, "deceased", "birth", "born", { date: "1768" }),
];

function research(extra: Record<string, unknown> = {}): Record<string, any> {
  return {
    project: { id: "rp_001", objective: "Test", status: "active", created: "2026-01-01", updated: "2026-01-01" },
    questions: [question()],
    plans: [],
    log: [],
    sources: [source("src_022", "S58"), source("src_030", "S60"), source("src_031", "S61"), source("src_032", "S62")],
    assertions: [
      ...FAG,
      assertion("a_297", "src_030", REC.births, "child", "name", "Phebe Eastman"),
      assertion("a_298", "src_030", REC.births, "child", "birth", "born", { place: "Ashford, Windham, Connecticut, United States" }),
    ],
    person_evidence: [],
    conflicts: [],
    hypotheses: [],
    timelines: [],
    proof_summaries: [],
    evaluations: [],
    ...extra,
  };
}

const ref = (id: string) => ({ ref: id });

/** Phebe as the project began: the Find a Grave record and a census attached to
 *  her, her death date on the tree's own source, her husband with his census. */
function startingTree(opts: { phebe?: string[]; deathFact?: string[]; couple?: string[] } = {}): Record<string, any> {
  const { phebe = ["S23", "S24"], deathFact = ["S1"], couple = [] } = opts;
  return {
    persons: [
      {
        id: P,
        gender: "Female",
        names: [{ id: `${P}-n1`, given: "Phebe", surname: "Eastman" }],
        facts: [{ id: `${P}-f1`, type: "Death", date: "7 October 1858", sources: deathFact.map(ref) }],
        sources: phebe.map(ref),
      },
      { id: H, gender: "Male", names: [{ id: `${H}-n1`, given: "John", surname: "Cooper" }], sources: [ref("S27")] },
    ],
    relationships: [{ id: "R1", type: "Couple", person1: P, person2: H, sources: couple.map(ref) }],
    sources: [
      { id: "S1", title: "FamilySearch Family Tree (read from Philip Eastman, KHTG-65R)", url: "https://www.familysearch.org/tree" },
      { id: "S23", title: 'Phebe Eastman Cooper, "Find a Grave Index"', url: `https://familysearch.org/${REC.fag}` },
      { id: "S24", title: 'Phebe Cooper, "United States, Census, 1850"', url: `https://familysearch.org/${REC.treeCensus}` },
      { id: "S27", title: 'John Cooper, "United States, Census, 1850"', url: `https://familysearch.org/${REC.husbandCensus}` },
    ],
  };
}

let seq = 0;
const pe = (assertionId: string, personId = P, confidence = "confident") => ({
  id: `pe_${String(++seq).padStart(3, "0")}`,
  assertion_id: assertionId,
  person_id: personId,
  confidence,
  rationale: "test link",
  created: "2026-11-09",
  superseded_by: null,
});

/** The verdict on Phebe's link to the Find a Grave death, with `links` standing
 *  beside it (the judged link itself included, as the call's end state holds it). */
function verdict(r: Record<string, any>, baseline = startingTree(), confidence = "confident", assertionId = "a_307", links: any[] = []) {
  const entry = pe(assertionId, P, confidence);
  const doc = { ...r, person_evidence: [...links, entry] };
  return circularCorroborationVerdict(entry, doc, baseline, baseline);
}

/** A record the tree does not cite, one fact linked to Phebe. */
function withRecord(recordId: string, facts: Array<[string, string, Record<string, unknown>]>, sourceDescription = "S63") {
  const assertions = facts.map(([factType, value, extra], i) =>
    assertion(`a_4${String(i).padStart(2, "0")}`, "src_040", recordId, "head", factType, value, extra),
  );
  return {
    r: research({
      sources: [...research().sources, source("src_040", sourceDescription)],
      assertions: [...research().assertions, ...assertions],
    }),
    ids: assertions.map((a) => a.id),
  };
}

describe("circular corroboration: the audit arm (#4430)", () => {
  describe("the reported shape", () => {
    it("refuses Phebe's confident link to the Find a Grave record she already cites", () => {
      expect(verdict(research())).toMatchObject({ kind: "audit", refused: true, record: "QK1F-YBQW" });
    });

    it("refuses every fact of that record, the name and the inferred birth too", () => {
      for (const id of ["a_306", "a_308", "a_309"]) {
        expect(verdict(research(), startingTree(), "confident", id), id).toMatchObject({ kind: "audit", refused: true });
      }
    });

    it("allows the same link at probable", () => {
      expect(verdict(research(), startingTree(), "probable")?.refused).toBe(false);
    });

    it("leaves an unmarked question as it is today: the census she also cites clears the subject arm", () => {
      const r = research({ questions: [question({ audits_tree: false })] });
      expect(verdict(r)).toMatchObject({ kind: "subject", refused: false });
      const absent = research({ questions: [question({ audits_tree: undefined })] });
      expect(verdict(absent)).toMatchObject({ kind: "subject", refused: false });
    });

    it("leaves a person who does not cite the record as today, marked or not", () => {
      expect(verdict(research(), startingTree({ phebe: ["S24"] }))).toMatchObject({ kind: "subject", refused: false });
    });
  });

  describe("where the person cites the record", () => {
    it("does not read the tree vouching for itself as the record, as the subject arm does not", () => {
      const r = research({ sources: research().sources.map((s: any) => (s.id === "src_022" ? { ...s, gedcomx_source_description_id: "S1" } : s)) });
      const v = verdict(r, startingTree({ phebe: ["S1", "S24"], deathFact: [] }));
      expect(v).toMatchObject({ kind: "subject", refused: false });
    });

    it("reads a citation on one of her facts", () => {
      const v = verdict(research(), startingTree({ phebe: ["S24"], deathFact: ["S1", "S23"] }));
      expect(v).toMatchObject({ kind: "audit", refused: true });
    });

    it("reads a citation on her own couple relationship", () => {
      const v = verdict(research(), startingTree({ phebe: ["S24"], couple: ["S23"] }));
      expect(v).toMatchObject({ kind: "audit", refused: true });
    });
  });

  describe("what clears it", () => {
    it("clears on a census the tree does not cite, in the same county, linked probable", () => {
      const { r, ids } = withRecord(REC.census, [["residence", "lived", { date: "1850", place: SPRINGVILLE }]]);
      expect(verdict(r, startingTree(), "confident", "a_307", [pe(ids[0], P, "probable")])).toMatchObject({ kind: "audit", refused: false });
    });

    it("clears on a census fact the tree does not cite, in the same county", () => {
      const { r, ids } = withRecord(REC.census, [["census", "enumerated", { date: "1850", place: SPRINGVILLE }]]);
      expect(verdict(r, startingTree(), "confident", "a_307", [pe(ids[0], P, "probable")])?.refused).toBe(false);
    });

    it("clears on a death record the tree does not cite giving the same year, linked probable", () => {
      const { r, ids } = withRecord(REC.census, [["death", "died", { date: "1858", place: "Elsewhere, Bradford, Pennsylvania, United States" }]]);
      expect(verdict(r, startingTree(), "confident", "a_307", [pe(ids[0], P, "probable")])?.refused).toBe(false);
    });

    it("clears on a burial record the tree does not cite in the same county as the record's burial", () => {
      const { r, ids } = withRecord(REC.census, [["burial", "buried", { place: "Old Cemetery, Susquehanna, Pennsylvania, United States" }]]);
      expect(verdict(r, startingTree(), "confident", "a_308", [pe(ids[0], P, "probable")])?.refused).toBe(false);
    });

    it("clears on a marriage record the tree does not cite giving the year this record gives her marriage", () => {
      const r0 = research();
      r0.assertions.push(assertion("a_312", "src_022", REC.fag, "deceased", "marriage", "married John Cooper", { date: "1790" }));
      const { r, ids } = withRecord(REC.census, [["marriage", "married Phebe Eastman", { date: "12 May 1790", place: "Ashford, Windham, Connecticut, United States" }]]);
      r.assertions = [...r0.assertions, ...r.assertions.filter((a: any) => ids.includes(a.id))];
      expect(verdict(r, startingTree(), "confident", "a_307", [pe(ids[0])])?.refused).toBe(false);
      expect(verdict(r, startingTree(), "confident", "a_307", [pe(ids[0])].map((e) => ({ ...e, person_id: H })))?.refused).toBe(true);
    });

    it("clears on a place written without its country, or a standard place where the text differs", () => {
      for (const extra of [
        { place: "Springville, Susquehanna, Pennsylvania" },
        { place: "Susquehanna County, Pa.", standard_place: "Susquehanna, Pennsylvania, United States" },
      ]) {
        const { r, ids } = withRecord(REC.census, [["residence", "lived", { date: "1850", ...extra }]]);
        r.assertions = r.assertions.map((a: any) => (a.id === "a_307" ? { ...a, standard_place: SPRINGVILLE } : a));
        const v = verdict(r, startingTree(), "confident", "a_307", [pe(ids[0], P, "probable")]);
        expect(v?.refused, JSON.stringify(extra)).toBe(false);
      }
      const fag = (place: string) =>
        research({ assertions: research().assertions.map((a: any) => (a.id === "a_307" ? { ...a, place } : a)) });
      const { r: plain, ids } = withRecord(REC.census, [["residence", "lived", { date: "1850", place: SPRINGVILLE }]]);
      const r = { ...plain, assertions: [...fag("Springville, Susquehanna, Pennsylvania").assertions, ...plain.assertions.filter((a: any) => ids.includes(a.id))] };
      expect(verdict(r, startingTree(), "confident", "a_307", [pe(ids[0], P, "probable")])?.refused).toBe(false);
    });

    it("keys a British place on its county, with or without the United Kingdom", () => {
      const place = (fagPlace: string, otherPlace: string) => {
        const { r, ids } = withRecord(REC.census, [["residence", "lived", { date: "1850", place: otherPlace }]]);
        r.assertions = r.assertions.map((a: any) => (a.id === "a_307" || a.id === "a_308" ? { ...a, place: fagPlace } : a));
        return verdict(r, startingTree(), "confident", "a_307", [pe(ids[0], P, "probable")])?.refused;
      };
      expect(place("Dover, Kent, England", "Folkestone, Kent, England, United Kingdom")).toBe(false);
      expect(place("Kent, England", "Dover, Kent, England, United Kingdom")).toBe(false);
      expect(place("Dover, Kent, England", "England, United Kingdom")).toBe(true);
      expect(place("Dover, Kent, England", "Maidstone, Surrey, England")).toBe(true);
    });

    it("lets another index of the same death clear it: nothing in the documents tells it from a certificate", () => {
      const { r, ids } = withRecord(REC.deathIndex, [["death", "died", { date: "7 October 1858", place: TOWNSHIP }]]);
      expect(verdict(r, startingTree(), "confident", "a_307", [pe(ids[0])])?.refused).toBe(false);
    });
  });

  describe("what does not clear it", () => {
    it("does not clear on the undated birth index, even raised to confident (the #4379 shape)", () => {
      const r = research();
      const v = verdict(r, startingTree(), "confident", "a_307", [pe("a_297"), pe("a_298")]);
      expect(v).toMatchObject({ kind: "audit", refused: true });
    });

    it("does not clear on a state alone, nor on a place of another county", () => {
      for (const place of ["Pennsylvania, United States", "Springville, Bradford, Pennsylvania, United States"]) {
        const { r, ids } = withRecord(REC.census, [["residence", "lived", { date: "1850", place }]]);
        expect(verdict(r, startingTree(), "confident", "a_307", [pe(ids[0])])?.refused, place).toBe(true);
      }
    });

    it("does not clear on a record giving another year for the same death, though its place agrees", () => {
      const { r, ids } = withRecord(REC.deathIndex, [["death", "died", { date: "1860", place: TOWNSHIP }]]);
      expect(verdict(r, startingTree(), "confident", "a_307", [pe(ids[0])])?.refused).toBe(true);
    });

    it("does not clear on any fact of a record that gives another year for the same death", () => {
      const { r, ids } = withRecord(REC.deathIndex, [
        ["death", "died", { date: "1860" }],
        ["residence", "lived", { date: "1850", place: SPRINGVILLE }],
      ]);
      expect(verdict(r, startingTree(), "confident", "a_307", ids.map((id) => pe(id)))?.refused).toBe(true);
    });

    it("is not stopped by a year inferred from an age: a census child aged 0 born the year before", () => {
      const { r, ids } = withRecord(REC.deathIndex, [
        ["death", "died", { date: "1857", record_basis: "inferred" }],
        ["residence", "lived", { date: "1850", place: SPRINGVILLE }],
      ]);
      expect(verdict(r, startingTree(), "confident", "a_307", ids.map((id) => pe(id)))?.refused).toBe(false);
    });

    it("does not clear on a record whose agreeing fact is linked to someone else", () => {
      const { r, ids } = withRecord(REC.census, [["residence", "lived", { date: "1850", place: SPRINGVILLE }]]);
      expect(verdict(r, startingTree(), "confident", "a_307", [pe(ids[0], H)])?.refused).toBe(true);
    });

    it("does not clear on a record the tree already cites on her", () => {
      const { r, ids } = withRecord(REC.treeCensus, [["residence", "lived", { date: "1850", place: SPRINGVILLE }]]);
      expect(verdict(r, startingTree(), "confident", "a_307", [pe(ids[0])])?.refused).toBe(true);
    });

    it("does not clear on a record the tree cites on someone else, her husband", () => {
      const { r, ids } = withRecord(REC.husbandCensus, [["residence", "lived", { date: "1850", place: SPRINGVILLE }]]);
      expect(verdict(r, startingTree(), "confident", "a_307", [pe(ids[0])])?.refused).toBe(true);
    });

    it("does not clear on negative evidence", () => {
      const { r, ids } = withRecord(REC.census, [["residence", "lived", { date: "1850", place: SPRINGVILLE, record_basis: "absent" }]]);
      expect(verdict(r, startingTree(), "confident", "a_307", [pe(ids[0])])?.refused).toBe(true);
    });

    it("does not clear on a speculative link", () => {
      const { r, ids } = withRecord(REC.census, [["residence", "lived", { date: "1850", place: SPRINGVILLE }]]);
      expect(verdict(r, startingTree(), "confident", "a_307", [pe(ids[0], P, "speculative")])?.refused).toBe(true);
    });
  });

  describe("which questions are audits", () => {
    it("reads an unresolved marked question when the record names no question, and not a resolved one", () => {
      const bare = (status: string) =>
        research({
          questions: [question({ status })],
          assertions: research().assertions.map((a: any) => ({ ...a, extracted_for_question_ids: [] })),
        });
      expect(verdict(bare("open"))).toMatchObject({ kind: "audit", refused: true });
      expect(verdict(bare("resolved"))).toMatchObject({ kind: "subject", refused: false });
    });

    it("follows the record's own questions when it names some, though another question is a marked audit", () => {
      const r = research({
        questions: [question(), question({ id: "q_002", audits_tree: undefined, question: "When did Phebe die?" })],
        assertions: research().assertions.map((a: any) => ({ ...a, extracted_for_question_ids: ["q_002"] })),
      });
      expect(verdict(r)).toMatchObject({ kind: "subject", refused: false });
    });

    it("reads the whole record, so a fact extracted for no question shares its siblings' answer", () => {
      const r = research({
        questions: [question({ status: "resolved" })],
        assertions: research().assertions.map((a: any) => (a.id === "a_307" ? { ...a, extracted_for_question_ids: [] } : a)),
      });
      expect(verdict(r)).toMatchObject({ kind: "audit", refused: true });
    });
  });

  describe("with the role arms", () => {
    it("keeps the subject arm's refusal where both refuse: she cites nothing but the record", () => {
      expect(verdict(research(), startingTree({ phebe: ["S23"] }))).toMatchObject({ kind: "subject", refused: true });
    });

    it("refuses on the audit arm where the relationship arm allows: her husband's edge carries no source", () => {
      const r = research({
        assertions: [
          ...FAG.map((a) => ({ ...a, record_role: "wife" })),
          assertion("a_310", "src_022", REC.fag, "husband", "name", "John Cooper"),
        ],
      });
      expect(verdict(r)).toMatchObject({ kind: "audit", refused: true });
      expect(verdict(r, startingTree(), "probable")).toMatchObject({ kind: "relationship", refused: false });
    });

    it("judges a two-party assertion by the audit arm alone, against the facts of a party linked to her", () => {
      const rel = assertion("a_311", "src_022", REC.fag, "deceased", "relationship", "wife of John Cooper", {
        related_person_role: "husband",
      });
      const r = research({ assertions: [...research().assertions, rel] });
      // Nothing of hers on the record is linked to her: nothing can agree.
      expect(verdict(r, startingTree(), "confident", "a_311")).toMatchObject({ kind: "audit", refused: true });
      expect(verdict(r, startingTree(), "probable", "a_311")).toBeNull();
      // Her death linked, and a death record the tree does not cite giving its year:
      // cleared, and a two-party assertion the audit arm clears gets no verdict.
      const { r: withDeath, ids } = withRecord(REC.census, [["death", "died", { date: "1858" }]]);
      withDeath.assertions.push(rel);
      expect(verdict(withDeath, startingTree(), "confident", "a_311", [pe("a_307"), pe(ids[0])])).toBeNull();
    });
  });

  describe("through research_append", () => {
    let dir: string;
    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), "research-append-circular-audit-"));
    });
    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    async function setup(r: Record<string, any>) {
      await writeFile(join(dir, "research.json"), JSON.stringify(r, null, 2));
      await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify(startingTree(), null, 2));
      await writeFile(join(dir, "starting-tree.gedcomx.json"), JSON.stringify(startingTree(), null, 2));
      for (const a of r.assertions as any[]) {
        if (a.record_id !== REC.fag) continue;
        await recordMatchScore(dir, {
          record_id: a.record_id,
          record_persona_id: null,
          record_role: a.record_role,
          tree_person_id: P,
          score: 0.999,
          scorer: "familysearch",
          model: null,
          assertion_id: a.id,
          record_source: "record_read",
          computed: "2026-11-09T00:00:00Z",
        });
      }
    }
    const link = (assertionId: string, confidence: string) => ({
      section: "person_evidence",
      op: "append",
      entry: { assertion_id: assertionId, person_id: P, confidence, match_score: 0.999, rationale: "test link", superseded_by: null },
    });
    const call = (...ops: unknown[]) => researchAppend({ projectPath: dir, ops } as any);

    it("refuses the four links at confident, writes nothing and says how to settle it", async () => {
      await setup(research());
      const res: any = await call(...FAG.map((a) => link(a.id, "confident")));
      expect(res.ok).toBe(false);
      const audit = (res.errors as string[]).filter((e) => e.includes("audits the tree"));
      expect(audit).toHaveLength(4);
      expect(audit[0]).toContain(`record 'QK1F-YBQW' was extracted for question 'q_001', which audits the tree`);
      expect(audit[0]).toContain(`'${P}' already cites the record in the starting tree`);
      expect(audit[0]).toContain("'probable' is available");
      expect(audit[0]).toContain("cited by no one in the starting tree");
      const after = JSON.parse(await readFile(join(dir, "research.json"), "utf-8"));
      expect(after.person_evidence).toEqual([]);
    });

    it("names the open question when the record names none", async () => {
      await setup(research({ assertions: research().assertions.map((a: any) => ({ ...a, extracted_for_question_ids: [] })) }));
      const res: any = await call(link("a_307", "confident"));
      expect(res.ok).toBe(false);
      expect((res.errors as string[]).join("\n")).toContain(
        "record 'QK1F-YBQW' names no question, and the open question 'q_001' audits the tree",
      );
    });

    it("refuses unmarking a question that audits the tree, and allows marking one", async () => {
      await setup(research({ questions: [question(), question({ id: "q_002", audits_tree: undefined, status: "resolved" })] }));
      const unmark: any = await call({ section: "questions", op: "update", entryId: "q_001", fields: { audits_tree: false } });
      expect(unmark.ok).toBe(false);
      expect(unmark.errors.join("\n")).toContain("audits_tree is true and cannot be changed");
      const keep: any = await call({ section: "questions", op: "update", entryId: "q_001", fields: { audits_tree: true, priority: "medium" } });
      expect(keep.ok, keep.ok ? "" : keep.errors.join("\n")).toBe(true);
      const mark: any = await call({ section: "questions", op: "update", entryId: "q_002", fields: { audits_tree: true } });
      expect(mark.ok, mark.ok ? "" : mark.errors.join("\n")).toBe(true);
      const after = JSON.parse(await readFile(join(dir, "research.json"), "utf-8"));
      expect(after.questions.map((q: any) => q.audits_tree)).toEqual([true, true]);
    });

    it("writes the four links at probable", async () => {
      await setup(research());
      const res: any = await call(...FAG.map((a) => link(a.id, "probable")));
      expect(res.ok, res.ok ? "" : res.errors.join("\n")).toBe(true);
    });
  });
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, readFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { materializeFacts } from "../../src/tools/materialize-facts.js";

// The namesake copy gate and item 34 (issue #3363 PR 1d): a record's facts reach
// a person with a recorded namesake only through a link the namesake cap allows,
// and a stub is exempt from the link rule only for the party it was made from.

const P = "KWCB-111"; // John Smith, who has a recorded namesake
const W = "KWCB-222"; // Mary Smith, his wife

function source(id: string, sd: string) {
  return {
    id,
    gedcomx_source_description_id: sd,
    citation: "Test citation",
    citation_detail: { who: "", what: "", when_created: "", when_accessed: "", where: "", where_within: "" },
    source_classification: "original",
    repository: "Test Repository",
    access_date: "2026-01-01",
  };
}

function assertion(id: string, sourceId: string, recordId: string, role: string, factType: string, value: string, over = {}) {
  return {
    id,
    source_id: sourceId,
    record_id: recordId,
    record_role: role,
    record_persona_id: null,
    fact_type: factType,
    value,
    date: null,
    place: null,
    standard_place: null,
    information_quality: "primary" as const,
    informant: "unknown",
    informant_proximity: "official_duty" as const,
    record_basis: "stated" as const,
    extracted_for_question_ids: [] as string[],
    ...over,
  };
}

const ASSERTIONS = [
  assertion("a_001", "src_001", "REC-CEN", "head", "name", "John Smith"),
  assertion("a_002", "src_001", "REC-CEN", "head", "birth", "", { date: "1850" }),
  assertion("a_003", "src_001", "REC-CEN", "wife", "name", "Mary Smith"),
  assertion("a_004", "src_001", "REC-CEN", "wife", "birth", "", { date: "1852" }),
  assertion("a_010", "src_002", "REC-VOT", "principal", "name", "John Smith"),
  assertion("a_011", "src_002", "REC-VOT", "principal", "birth", "", { date: "1851" }),
  assertion("a_020", "src_003", "REC-MAR", "bride", "name", "Ann Brown"),
  assertion("a_021", "src_003", "REC-MAR", "bride", "marriage", "Ann Brown married John Smith"),
  assertion("a_022", "src_003", "REC-MAR", "groom", "name", "John Smith"),
  assertion("a_030", "src_004", "REC-BAP", "child", "name", "William Smith"),
  assertion("a_031", "src_004", "REC-BAP", "child", "birth", "", { date: "1880" }),
  assertion("a_032", "src_004", "REC-BAP", "father", "name", "John Smith"),
  assertion("a_033", "src_004", "REC-BAP", "father", "residence", "Niles"),
  assertion("a_040", "src_005", "REC-MAR2", "bride", "name", "Ann Jones"),
  assertion("a_041", "src_005", "REC-MAR2", "groom", "name", "Peter Brown"),
  assertion("a_042", "src_005", "REC-MAR2", "groom", "marriage", "Peter Brown married Ann Jones"),
  assertion("a_050", "src_006", "REC-BAP2", "child", "name", "John Smith"),
  assertion("a_051", "src_006", "REC-BAP2", "father", "name", "John Smith"),
  assertion("a_060", "src_003", "REC-MAR3", "bride", "name", "Ann Brown"),
  assertion("a_061", "src_003", "REC-MAR3", "bride", "marriage", "Ann Brown married John Smith"),
  assertion("a_070", "src_007", "REC-OTHER", "principal", "name", "Mary Smith"),
];

const ROW = {
  id: "ns_001",
  person_id: P,
  name: "John Smith",
  place: "San Francisco, California, United States",
  time_period: "born about 1873",
  record_ids: ["REC-VOT"],
  created: "2026-10-01",
};

function link(id: string, assertionId: string, personId: string, confidence = "probable") {
  return {
    id,
    assertion_id: assertionId,
    person_id: personId,
    confidence,
    rationale: "test link",
    match_score: null,
    created: "2026-01-01",
    superseded_by: null,
  };
}

function research(links: any[], opts: { row?: boolean } = {}) {
  return {
    project: { id: "rp_001", objective: "Test", status: "active", created: "2026-01-01", updated: "2026-01-01", subject_person_ids: [P] },
    questions: [],
    plans: [],
    log: [],
    sources: [1, 2, 3, 4, 5, 6, 7].map((n) => source(`src_00${n}`, `S${n}`)),
    assertions: ASSERTIONS,
    person_evidence: links,
    conflicts: [],
    hypotheses: [],
    timelines: [],
    proof_summaries: [],
    evaluations: [],
    ...(opts.row === false ? {} : { namesakes: [ROW] }),
  };
}

function person(id: string, given: string, surname: string, gender: string, over: Record<string, unknown> = {}) {
  return { id, gender, names: [{ id: `${id}-n1`, given, surname }], ...over };
}

function tree(persons: any[], relationships: any[] = []) {
  return {
    persons: [person(P, "John", "Smith", "Male"), ...persons],
    relationships,
    sources: [1, 2, 3, 4, 5, 6, 7].map((n) => ({ id: `S${n}`, title: `Record S${n}` })),
  };
}

const couple = (other: string) => ({ id: "R1", type: "Couple", person1: P, person2: other });

describe("materialize_facts under a recorded namesake (#3363 PR 1d)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "materialize-namesake-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function setup(r: any, t: any) {
    await writeFile(join(dir, "research.json"), JSON.stringify(r, null, 2), "utf-8");
    await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify(t, null, 2), "utf-8");
  }
  const readJson = async (name: string) => JSON.parse(await readFile(join(dir, name), "utf-8"));

  describe("the copy gate", () => {
    it("M1 refuses an explicit copy through a link the cap does not tie", async () => {
      await setup(research([link("pe_1", "a_010", P)]), tree([person(W, "Mary", "Smith", "Female")], [couple(W)]));
      const r = await materializeFacts({ projectPath: dir, personId: P, recordId: "REC-VOT", recordRole: "principal" });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.errors[0]).toMatch(
        /^'KWCB-111' has a recorded namesake \('ns_001'\), so a record's facts reach 'KWCB-111' only through a link the namesake cap allows\. 'pe_1' ties assertion 'a_010' to 'KWCB-111' at 'probable', but nothing in source 'src_002' ties it to 'KWCB-111' \(/,
      );
      expect(r.errors[0]).toContain("Route that link to person-evidence");
      expect(r.errors[0]).toContain("If this persona is someone else, omit personId");
    });

    it("M5 copies through the same link when no namesake is recorded", async () => {
      await setup(research([link("pe_1", "a_010", P)], { row: false }), tree([person(W, "Mary", "Smith", "Female")], [couple(W)]));
      const r = await materializeFacts({ projectPath: dir, personId: P, recordId: "REC-VOT", recordRole: "principal" });
      expect(r.ok).toBe(true);
    });

    it("M2 copies through a link the wife on the same record ties", async () => {
      await setup(
        research([link("pe_1", "a_001", P), link("pe_2", "a_003", W)]),
        tree([person(W, "Mary", "Smith", "Female")], [couple(W)]),
      );
      const r = await materializeFacts({ projectPath: dir, personId: P, recordId: "REC-CEN", recordRole: "head" });
      expect(r.ok).toBe(true);
    });

    it("M4 refuses a named party copied onto the row holder through an untied link", async () => {
      // The groom has no persona of his own on this record, so the naming
      // assertion is the link that qualifies.
      await setup(research([link("pe_1", "a_061", P)]), tree([person(W, "Mary", "Smith", "Female")], [couple(W)]));
      const r = await materializeFacts({
        projectPath: dir,
        personId: P,
        assertionId: "a_061",
        relatedRole: "groom",
        name: { given: "John", surname: "Smith" },
      });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.errors[0]).toMatch(/^'KWCB-111' has a recorded namesake \('ns_001'\)/);
      expect(r.errors[0]).toContain("If this party is someone else, omit personId to mint a new person.");
    });

    it("M3 makes a new person, with a warning, when the implicit lookup would reuse the row holder", async () => {
      const holder = person(P, "John", "Smith", "Male", {
        facts: [{ id: "F1", type: "Birth", date: "1851", assertion_id: "a_011", sources: [{ ref: "S2" }] }],
      });
      await setup(research([link("pe_1", "a_010", P)]), { ...tree([]), persons: [holder] });
      const r = await materializeFacts({ projectPath: dir, recordId: "REC-VOT", recordRole: "principal" });
      expect(r.ok).toBe(true);
      if (!r.ok || !("personId" in r)) throw new Error("expected a single-op success");
      expect(r.personId).not.toBe(P);
      expect(r.created).toBe(true);
      expect(r.validation.warnings).toContainEqual(
        expect.stringMatching(
          new RegExp(
            `^persona 'principal' of record 'REC-VOT' would have reused 'KWCB-111', but 'KWCB-111' has a recorded namesake and its link 'pe_1' from this record is not tied; '${r.personId}' was created instead\\.`,
          ),
        ),
      );
    });

    it("M6 judges a batch on the tree before the call: the wife's op first does not untie the head's link", async () => {
      // I2 has no refs before the call, so she ties the head's census link. The
      // wife op writes the census onto her, after which she reads as made from
      // that record alone; judged on the tree in memory, the head op would then
      // be refused in one order only.
      const wife = { id: "I2", gender: "Female", names: [{ id: "N2", given: "Mary", surname: "Smith" }] };
      const ops = [
        { personId: "I2", recordId: "REC-CEN", recordRole: "wife" },
        { personId: P, recordId: "REC-CEN", recordRole: "head" },
      ];
      for (const order of [ops, [...ops].reverse()]) {
        await setup(research([link("pe_1", "a_001", P), link("pe_2", "a_003", "I2")]), tree([wife], [couple("I2")]));
        const r = await materializeFacts({ projectPath: dir, ops: order });
        expect(r.ok).toBe(true);
      }
    });

    it("M7 judges a batch on the tree before the call: a placeholder name the wife's op replaces still ties nothing", async () => {
      // I2's only given name is a placeholder, and her other record keeps her
      // from reading as made from the census once the wife op writes it.
      const wife = {
        id: "I2",
        gender: "Female",
        names: [{ id: "N2", given: "Mrs", surname: "Smith", sources: [{ ref: "S7" }] }],
      };
      const ops = [
        { personId: "I2", recordId: "REC-CEN", recordRole: "wife" },
        { personId: P, recordId: "REC-CEN", recordRole: "head" },
      ];
      for (const order of [ops, [...ops].reverse()]) {
        await setup(
          research([link("pe_1", "a_001", P), link("pe_2", "a_003", "I2"), link("pe_3", "a_070", "I2")]),
          tree([wife], [couple("I2")]),
        );
        const r = await materializeFacts({ projectPath: dir, ops: order });
        expect(r.ok).toBe(false);
        if (r.ok) continue;
        expect(r.errors[0]).toMatch(/^ops\[\d\]: 'KWCB-111' has a recorded namesake/);
      }
    });
  });

  describe("item 34: a stub is exempt only for the party it was made from", () => {
    const childStub = (extraFacts: any[] = []) =>
      person("I5", "William", "Smith", "Male", {
        names: [{ id: "I5-n1", given: "William", surname: "Smith", sources: [{ ref: "S4" }] }],
        facts: [{ id: "F5", type: "Birth", date: "1880", assertion_id: "a_031", sources: [{ ref: "S4" }] }, ...extraFacts],
      });

    it("I1 refuses the father's persona onto the child's stub", async () => {
      await setup(research([], { row: false }), tree([childStub()]));
      const r = await materializeFacts({ projectPath: dir, personId: "I5", recordId: "REC-BAP", recordRole: "father" });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.errors[0]).toMatch(
        /^'I5' was created from record 'REC-BAP', but it carries that record's 'child' party \(fact 'F5'\), so it is not this party's stub\. 'I5' was already in the tree/,
      );
    });

    it("I2 copies the child's persona onto its own stub", async () => {
      await setup(research([], { row: false }), tree([childStub()]));
      const r = await materializeFacts({ projectPath: dir, personId: "I5", recordId: "REC-BAP", recordRole: "child" });
      expect(r.ok).toBe(true);
    });

    it("I6 mints rather than reuse a stub carrying another party's fact", async () => {
      const polluted = childStub([{ id: "F6", type: "Residence", value: "Niles", assertion_id: "a_033", sources: [{ ref: "S4" }] }]);
      await setup(research([], { row: false }), tree([polluted]));
      const r = await materializeFacts({ projectPath: dir, recordId: "REC-BAP", recordRole: "child" });
      expect(r.ok).toBe(true);
      if (!r.ok || !("personId" in r)) throw new Error("expected a single-op success");
      expect(r.personId).not.toBe("I5");
      expect(r.created).toBe(true);
    });

    const brideStub = () =>
      person("I6", "Ann", "Jones", "Female", { names: [{ id: "I6-n1", given: "Ann", surname: "Jones", sources: [{ ref: "S5" }] }] });

    it("I3 refuses the groom's persona onto the bride's name only stub", async () => {
      await setup(research([], { row: false }), tree([brideStub()]));
      const r = await materializeFacts({ projectPath: dir, personId: "I6", recordId: "REC-MAR2", recordRole: "groom" });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.errors[0]).toMatch(
        /^'I6' was created from record 'REC-MAR2', but nothing on it \(a fact, a link from a one-party assertion, or a name\) comes from this party, so it is not this party's stub\./,
      );
    });

    it("I3b still refuses when the groom's marriage, a two-party assertion, is linked to that stub", async () => {
      await setup(research([link("pe_1", "a_042", "I6")], { row: false }), tree([brideStub()]));
      const r = await materializeFacts({ projectPath: dir, personId: "I6", recordId: "REC-MAR2", recordRole: "groom" });
      expect(r.ok).toBe(false);
    });

    it("I5b refuses the groom's name onto the bride's stub even with the groom's marriage linked to it", async () => {
      const marriage = [
        assertion("a_082", "src_001", "REC-MARR", "groom", "marriage", "Thomas Flynn married Mary Doyle"),
        assertion("a_083", "src_001", "REC-MARR", "bride", "marriage", "Mary Doyle married Thomas Flynn"),
      ];
      const r0 = research([], { row: false });
      await setup({ ...r0, assertions: [...ASSERTIONS, ...marriage] }, tree([]));
      const first = await materializeFacts({
        projectPath: dir,
        assertionId: "a_082",
        relatedRole: "bride",
        name: { given: "Mary", surname: "Doyle" },
      });
      expect(first.ok).toBe(true);
      if (!first.ok || !("personId" in first)) throw new Error("expected a single-op success");
      const r1 = await readJson("research.json");
      r1.person_evidence = [link("pe_1", "a_082", first.personId)];
      await writeFile(join(dir, "research.json"), JSON.stringify(r1, null, 2), "utf-8");
      const second = await materializeFacts({
        projectPath: dir,
        personId: first.personId,
        assertionId: "a_083",
        relatedRole: "groom",
        name: { given: "Thomas", surname: "Flynn" },
      });
      expect(second.ok).toBe(false);
    });

    it("I7 copies a same-named father onto the son's name only stub (known let through)", async () => {
      const sonStub = person("I8", "John", "Smith", "Male", {
        names: [{ id: "I8-n1", given: "John", surname: "Smith", sources: [{ ref: "S6" }] }],
      });
      await setup(research([], { row: false }), tree([sonStub]));
      const r = await materializeFacts({ projectPath: dir, personId: "I8", recordId: "REC-BAP2", recordRole: "father" });
      expect(r.ok).toBe(true);
    });
  });
});

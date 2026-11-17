import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { attachedBirthConflictInvariants, coreIdentifierContradictionInvariants, researchAppend, type PersonLink } from "../../src/tools/research-append.js";
import { cp, mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { ATTACHMENT_LINK_RATIONALE } from "../../src/utils/tree-person.js";

// #4444: a tree person whose own FamilySearch-attached records disagree on
// birthplace cannot carry a record that sides with one of them past
// 'speculative'.

const P = "P1";

function birth(id: string, record: string, place: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    source_id: "src_1",
    record_id: record,
    record_role: "principal",
    record_persona_id: `${record}-principal`,
    fact_type: "birth",
    value: place,
    place,
    information_quality: "primary",
    informant: "self",
    informant_proximity: "participant",
    record_basis: "stated",
    extracted_for_question_ids: [],
    ...extra,
  };
}

function attachment(id: string, assertionId: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    assertion_id: assertionId,
    person_id: P,
    confidence: "speculative",
    rationale: ATTACHMENT_LINK_RATIONALE,
    match_score: null,
    created: "2026-11-01",
    superseded_by: null,
    ...extra,
  };
}

const CENSUS = birth("a_001", "ark:/61903/1:1:CENS-001", "New York, United States", {
  information_quality: "indeterminate",
  informant_proximity: "household_member",
});
const BAPTISM = birth("a_002", "ark:/61903/1:1:BAPT-002", "Ardfinnan, Tipperary, Ireland");
const IRISH = birth("a_003", "ark:/61903/1:1:CIVL-003", "Ireland");

function project(opts: { assertions?: any[]; links?: any[]; rejected?: any[]; treeBirth?: string } = {}) {
  const research = {
    assertions: opts.assertions ?? [CENSUS, BAPTISM, IRISH],
    person_evidence: opts.links ?? [attachment("pe_001", "a_001"), attachment("pe_002", "a_002")],
    rejected_links: opts.rejected ?? [],
    conflicts: [],
  };
  const tree = {
    persons: [{ id: P, facts: [{ id: "F1", type: "Birth", date: "28 Nov 1872", place: opts.treeBirth ?? "Ardfinnan, Tipperary, Ireland" }] }],
  };
  return { research, tree };
}

const linksOf = (research: any): PersonLink[] =>
  research.person_evidence
    .filter((pe: any) => pe.superseded_by == null)
    .map((pe: any) => ({ id: pe.id, assertion_id: pe.assertion_id, person_id: pe.person_id, confidence: pe.confidence }));

const link = (assertionId: string, confidence = "confident", person = P) => ({
  id: "pe_new",
  assertion_id: assertionId,
  person_id: person,
  confidence,
  rationale: "Birth matches.",
  match_score: 0.91,
});

const judge = (entry: any, research: any, tree: any) =>
  coreIdentifierContradictionInvariants(entry, research, tree, [...linksOf(research), entry]);

describe("core-identifier gate — a tree person's attached births disagree (#4444)", () => {
  it("refuses a record whose country-only birthplace sides with one attached birth, at confident and probable", () => {
    const { research, tree } = project();
    for (const confidence of ["confident", "probable"]) {
      const r = judge(link("a_003", confidence), research, tree);
      expect(r).toHaveLength(1);
      expect(r[0]).toContain("own attached records disagree on birthplace");
      expect(r[0]).toContain("a fact conflict between them does not lift this");
    }
    expect(judge(link("a_003", "speculative"), research, tree)).toEqual([]);
  });

  it("refuses the record's relationship link once a one-party link ties its party to the person", () => {
    const rel = { ...IRISH, id: "a_004", fact_type: "relationship", value: "child of Thomas", place: undefined };
    const { research, tree } = project({ assertions: [CENSUS, BAPTISM, IRISH, rel] });
    research.person_evidence.push({ ...link("a_003"), id: "pe_003", created: "2026-11-02", superseded_by: null });
    expect(judge(link("a_004"), research, tree)).toHaveLength(1);
  });

  it("still refuses when the census attachment was replaced by a checked link", () => {
    const { research, tree } = project({
      links: [
        attachment("pe_001", "a_001", { superseded_by: "pe_010" }),
        { ...link("a_001", "probable"), id: "pe_010", created: "2026-11-02", superseded_by: null },
        attachment("pe_002", "a_002"),
      ],
    });
    expect(judge(link("a_003"), research, tree)).toHaveLength(1);
  });

  it("refuses a record that agrees with an attachment the researcher ruled is not the person", () => {
    const { research, tree } = project({
      links: [attachment("pe_001", "a_001"), attachment("pe_002", "a_002", { superseded_by: "rj_001" })],
      rejected: [{ id: "rj_001", assertion_id: "a_002", person_id: P, researcher_words: "That baptism is another John.", created: "2026-11-03" }],
    });
    const r = judge(link("a_003"), research, tree);
    expect(r).toHaveLength(1);
    expect(r[0]).toContain("the researcher ruled is not this person");
  });

  it("refuses raising one of the two contradicting attachments", () => {
    const { research, tree } = project();
    expect(judge(link("a_002", "probable"), research, tree)).toHaveLength(1);
  });

  it("is silent when the person's attached births agree, written differently", () => {
    const cork = birth("a_002", "ark:/61903/1:1:BAPT-002", "Cork, Ireland");
    const ireland = birth("a_001", "ark:/61903/1:1:CENS-001", "Ireland");
    const dublin = birth("a_003", "ark:/61903/1:1:CIVL-003", "Dublin, Ireland");
    const { research, tree } = project({ assertions: [ireland, cork, dublin], treeBirth: "Ireland" });
    expect(judge(link("a_003"), research, tree)).toEqual([]);
  });

  it("reads a historical jurisdiction as the same place under its other names", () => {
    // william-sloan-spouse, live walk 2026-11-16: an 1850s record resolves to
    // "Upper Canada, British North America", later ones to "Ontario, Canada";
    // FamilySearch keeps both as representations of one place (1929952).
    const upper = birth("a_001", "ark:/61903/1:1:CENS-001", "Upper Canada, British North America", {
      standard_place: "Upper Canada, British North America",
    });
    const ontario = birth("a_002", "ark:/61903/1:1:BAPT-002", "Ont", { standard_place: "Ontario, Canada" });
    const record = birth("a_003", "ark:/61903/1:1:CIVL-003", "Ontario", { standard_place: "Ontario, Canada" });
    const { research, tree } = project({ assertions: [upper, ontario, record], treeBirth: "Ontario, Canada" });
    const place = { latitude: 44.1, longitude: -79.9, type: "Province" };
    const names = ["Ontario, Canada", "Canada West, British North America", "Upper Canada, British North America"];
    const withNames = new Map([
      ["Upper Canada, British North America", { ...place, aliases: names }],
      ["Ontario, Canada", { ...place, aliases: names }],
    ]);
    const entry = link("a_003");
    const links = [...linksOf(research), entry];
    expect(coreIdentifierContradictionInvariants(entry, research, tree, links, undefined, withNames as any)).toEqual([]);
    // Without the names lookup the two read as different countries and the arm
    // fails closed, as every place comparison here does.
    expect(coreIdentifierContradictionInvariants(entry, research, tree, links)).toHaveLength(1);
  });

  it("is silent with one attached birth only", () => {
    const { research, tree } = project({ links: [attachment("pe_002", "a_002")] });
    expect(judge(link("a_003"), research, tree)).toEqual([]);
  });

  it("is silent when the record states no birthplace", () => {
    const name = { ...IRISH, fact_type: "name", value: "John Hanrahan", place: undefined };
    const { research, tree } = project({ assertions: [CENSUS, BAPTISM, name] });
    expect(judge(link("a_003"), research, tree)).toEqual([]);
  });

  it("is silent when the record's birthplace sides with neither attached birth", () => {
    const england = birth("a_003", "ark:/61903/1:1:CIVL-003", "England");
    const { research, tree } = project({ assertions: [CENSUS, BAPTISM, england], treeBirth: "England" });
    expect(judge(link("a_003"), research, tree)).toEqual([]);
  });

  it("is silent once the researcher rejects the attachment the record contradicts", () => {
    const { research, tree } = project({
      links: [attachment("pe_001", "a_001", { superseded_by: "rj_001" }), attachment("pe_002", "a_002")],
      rejected: [{ id: "rj_001", assertion_id: "a_001", person_id: P, researcher_words: "That census is another John.", created: "2026-11-03" }],
    });
    expect(judge(link("a_003"), research, tree)).toEqual([]);
  });

  it("is silent when an attachment is retired with nothing in its place", () => {
    const { research, tree } = project({
      links: [attachment("pe_001", "a_001", { superseded_by: "pe_099" }), attachment("pe_002", "a_002")],
    });
    expect(judge(link("a_003"), research, tree)).toEqual([]);
  });

  it("is silent on a relationship link to the other party the record names", () => {
    const rel = { ...IRISH, id: "a_004", fact_type: "relationship", value: "child of Thomas", place: undefined };
    const { research, tree } = project({ assertions: [CENSUS, BAPTISM, IRISH, rel] });
    expect(judge(link("a_004", "confident", "FATHER"), research, tree)).toEqual([]);
  });

  it("does not let the run's own resolved conflict lift the cap (thomas-hanrahan-marriage, 2026-11-09)", () => {
    const base = join(__dirname, "../../../../../eval/runlogs/e2e/thomas-hanrahan-marriage/run-2026-11-09_12-14-54");
    const research = JSON.parse(readFileSync(`${base}.final-research.json`, "utf-8"));
    const tree = JSON.parse(readFileSync(`${base}.final-tree.gedcomx.json`, "utf-8"));
    expect(research.conflicts.find((c: any) => c.id === "c_001")).toMatchObject({
      status: "resolved",
      preferred_assertion_id: "a_145",
    });
    const links = linksOf(research);
    const refused = research.person_evidence
      .filter((pe: any) => pe.superseded_by == null && pe.confidence !== "speculative")
      .filter((pe: any) => coreIdentifierContradictionInvariants(pe, research, tree, links).length > 0)
      .map((pe: any) => pe.id)
      .sort();
    expect(refused).toEqual(["pe_088", "pe_089", "pe_090", "pe_093", "pe_095"]);
  });
});

describe("a birthplace conflict across a person's self-contradicting attached births (#4444)", () => {
  const conflict = (ids: string[], extra: Record<string, unknown> = {}) => ({
    id: "c_001",
    conflict_type: "fact",
    disputed_attribute: "birth_place",
    competing_assertion_ids: ids,
    status: "resolved",
    preferred_assertion_id: ids[1],
    ...extra,
  });
  const judge = (c: any, research: any, tree: any) => attachedBirthConflictInvariants(c, research, tree, linksOf(research));

  it("refuses resolving the person's two attached births against each other", () => {
    const { research, tree } = project();
    const r = judge(conflict(["a_001", "a_002"]), research, tree);
    expect(r).toHaveLength(1);
    expect(r[0]).toContain("identity");
  });

  it("refuses resolving an attached birth against a record that sides with the other one", () => {
    const { research, tree } = project();
    expect(judge(conflict(["a_001", "a_003"]), research, tree)).toHaveLength(1);
  });

  it("allows it unresolved, moot, or about another attribute", () => {
    const { research, tree } = project();
    expect(judge(conflict(["a_001", "a_002"], { status: "unresolved", preferred_assertion_id: null }), research, tree)).toEqual([]);
    expect(judge(conflict(["a_001", "a_002"], { status: "moot" }), research, tree)).toEqual([]);
    expect(judge(conflict(["a_001", "a_002"], { disputed_attribute: "birth_date" }), research, tree)).toEqual([]);
  });

  it("allows it once the researcher rejects one of the attachments", () => {
    const { research, tree } = project({
      links: [attachment("pe_001", "a_001"), attachment("pe_002", "a_002", { superseded_by: "rj_001" })],
      rejected: [{ id: "rj_001", assertion_id: "a_002", person_id: P, researcher_words: "Another John.", created: "2026-11-03" }],
    });
    expect(judge(conflict(["a_001", "a_002"]), research, tree)).toEqual([]);
  });

  it("allows attached births that disagree within one country", () => {
    const cork = birth("a_001", "ark:/61903/1:1:CENS-001", "Cork, Ireland");
    const dublin = birth("a_002", "ark:/61903/1:1:BAPT-002", "Dublin, Ireland");
    const { research, tree } = project({ assertions: [cork, dublin, IRISH], treeBirth: "Ireland" });
    expect(judge(conflict(["a_001", "a_002"]), research, tree)).toEqual([]);
  });

  it("allows a conflict whose competitors are not on both sides", () => {
    const other = birth("a_004", "ark:/61903/1:1:OTHR-004", "England");
    const { research, tree } = project({ assertions: [CENSUS, BAPTISM, IRISH, other] });
    research.person_evidence.push({ ...link("a_004"), id: "pe_004", created: "2026-11-02", superseded_by: null });
    expect(judge(conflict(["a_001", "a_004"]), research, tree)).toEqual([]);
  });

  // Run 2026-11-09 resolved c_001 (the 1880 census against the Irish civil
  // registration) toward the registration; the rule refuses that write.
  it("refuses the write through research_append on run 2026-11-09's own documents", async () => {
    const dir = await mkdtemp(join(tmpdir(), "attached-conflict-"));
    try {
      const base = join(__dirname, "../../../../../eval/runlogs/e2e/thomas-hanrahan-marriage/run-2026-11-09_12-14-54");
      await cp(`${base}.final-research.json`, join(dir, "research.json"));
      await cp(`${base}.final-tree.gedcomx.json`, join(dir, "tree.gedcomx.json"));
      const r: any = await researchAppend({
        projectPath: dir, section: "conflicts", op: "update", entryId: "c_001",
        fields: { status: "resolved", preferred_assertion_id: "a_145" },
      } as any);
      expect(r.ok).toBe(false);
      expect((r.errors as string[]).join(" ")).toContain("cannot be 'resolved' by preferring one side");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

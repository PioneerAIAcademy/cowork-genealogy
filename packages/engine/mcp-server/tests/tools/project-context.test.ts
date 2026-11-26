import { CLAIM_KINDS } from "../../src/validation/validator.js";
import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, utimes } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

import {
  BOUNDED_REQUEST_RULE,
  FIRST_QUESTION_NEXT_STEP,
  firstQuestionNextStep,
  projectContext,
  projectContextSchema,
} from "../../src/tools/project-context.js";
import { __usePlaceTableForTests } from "../../src/utils/place-resolver.js";
import { createPhippsProject, PIDS } from "../helpers/phipps-read.js";
import {
  researchQuery,
  RESEARCH_QUERY_SECTIONS,
  RESEARCH_QUERY_OPTIONAL_SECTIONS,
  EXTERNAL_COLLECTIONS_SECTION,
} from "../../src/tools/research-query.js";
import { readBuildInfo } from "../../src/utils/build-info.js";
import { fileStoreOnly } from "../helpers/store-backend.js";
import { callTool } from "../helpers/call-tool.js";
import { getProjectStore, runWithProjectStore } from "../../src/store/project-store.js";
import { LOCAL, bearerPrincipal, connectorPrincipal, type Principal } from "../../src/auth/principal.js";
import { __resetSessionChecksForTests } from "../../src/utils/session-check.js";
import { __resetUserLimitsForTests } from "../../src/utils/user-limits.js";
import { ScopedFsStore, SCOPED_ANCHOR } from "../helpers/scoped-fs-store.js";

describe("project_context", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "project-context-test-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writeProject(research: any, tree: any) {
    await writeFile(join(dir, "research.json"), JSON.stringify(research, null, 2));
    await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify(tree, null, 2));
  }

  it("projects a populated project: open questions, persons, sources with recordIds", async () => {
    await writeProject(
      {
        project: { id: "rp_001", objective: "Test", status: "active", created: "2026-01-01", updated: "2026-01-01" },
        questions: [
          { id: "q_001", question: "Who were William's parents?", status: "open" },
          { id: "q_002", question: "Resolved already", status: "resolved" },
          { id: "q_003", question: "Where was he in 1880?", status: "in_progress" },
          { id: "q_004", question: "Declared exhaustive", status: "exhaustive_declared" },
        ],
        sources: [
          { id: "src_001", repository: "FamilySearch", gedcomx_source_description_id: "S1" },
          { id: "src_002", repository: "Ancestry", gedcomx_source_description_id: "S1" },
          { id: "src_003", repository: "NARA", gedcomx_source_description_id: "S2" },
        ],
        assertions: [
          { id: "a_001", source_id: "src_001", record_id: "ark:/61903/1:1:AAAA-111" },
          { id: "a_002", source_id: "src_001", record_id: "ark:/61903/1:1:AAAA-111" }, // duplicate → distinct once
          { id: "a_003", source_id: "src_001", record_id: "ark:/61903/1:1:BBBB-222" },
          { id: "a_004", source_id: "src_002", record_id: "ancestry:coll:42" },
          { id: "a_005", source_id: "src_zzz", record_id: "dangling-source-ignored" },
        ],
      },
      {
        persons: [
          {
            id: "I1",
            gender: "Male",
            names: [
              // Preferred name second on purpose: at index 0 the assertion below
              // passes whether or not the code selects on `preferred` (#1389 review).
              { id: "N2", given: "Willie", surname: "Bottermiller" },
              { id: "N1", given: "William", surname: "Bottermiller", preferred: true, sources: [{ ref: "S2" }] },
            ],
            facts: [
              { id: "F1", type: "Birth", date: "1863", sources: [{ ref: "S1" }] },
              { id: "F2", type: "Death", date: "1929", sources: [{ ref: "S1" }, { ref: "S2" }] }, // dup ref → distinct once
            ],
            sources: [{ ref: "S1" }],
          },
          { id: "I2", gender: "Female", names: [{ id: "N3", given: "Mary", surname: "Bottermiller" }] }, // no preferred flag → first
          { id: "I3", gender: "Male" }, // no names at all
        ],
        relationships: [],
        sources: [
          { id: "S1", title: "1880 census" },
          { id: "S2", title: "1929 death record" },
        ],
      },
    );

    const r = await projectContext({ projectPath: dir }, LOCAL);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.projectStatus).toBe("active");
    expect(r.openQuestions).toEqual([
      { id: "q_001", question: "Who were William's parents?" },
      { id: "q_003", question: "Where was he in 1880?" },
      { id: "q_004", question: "Declared exhaustive" },
    ]);
    expect(r.persons).toEqual([
      { id: "I1", name: "William Bottermiller", gender: "Male", diedByYear: 1929 },
      { id: "I2", name: "Mary Bottermiller", gender: "Female" },
      { id: "I3", gender: "Male" },
    ]);
    expect(r.sources).toEqual([
      {
        id: "src_001",
        repository: "FamilySearch",
        gedcomxSourceDescriptionId: "S1",
        recordIds: ["ark:/61903/1:1:AAAA-111", "ark:/61903/1:1:BBBB-222"],
        assertionCount: 3,
      },
      {
        id: "src_002",
        repository: "Ancestry",
        gedcomxSourceDescriptionId: "S1",
        recordIds: ["ancestry:coll:42"],
        assertionCount: 1,
      },
      { id: "src_003", repository: "NARA", gedcomxSourceDescriptionId: "S2", assertionCount: 0 },
    ]);
  });

  it.each([
    ["a subject and no question", { subject_person_ids: ["I1"], status: "active" }, undefined, true],
    ["an empty questions list", { subject_person_ids: ["I1"], status: "active" }, [], true],
    ["a question already", { subject_person_ids: ["I1"], status: "active" }, [{ id: "q_001", question: "Q?", status: "open" }], false],
    ["no subject", { status: "active" }, undefined, false],
    ["a completed project", { subject_person_ids: ["I1"], status: "completed" }, undefined, false],
  ])("names the first question's steps as a top-level nextStep only on %s (#4791)", async (_label, project, questions, shown) => {
    await writeProject(
      {
        project: { id: "rp_001", objective: "Verify his parents.", created: "2026-01-01", updated: "2026-01-01", ...project },
        ...(questions ? { questions } : {}),
      },
      { persons: [{ id: "I1", gender: "Male", names: [{ given: "Anton", surname: "Vogt" }] }], relationships: [], sources: [] },
    );
    const r = await projectContext({ projectPath: dir }, LOCAL);
    if (!r.ok) throw new Error(r.errors.join("; "));
    if (shown) {
      expect(r.nextStep).toBe(FIRST_QUESTION_NEXT_STEP);
      expect(r.nextStep).not.toMatch(/objective/);
      expect(r.nextStep).toMatch(/Skill\("forget-and-rederive"\) with mode: verify/);
      expect(r.nextStep).toMatch(/extraction_append\(\{ projectPath, personId \}\) and timeline_build/);
      expect(r.nextStep).toMatch(/^For the research router only; an agent it spawned ignores this/);
      expect(r.nextStep).toMatch(/Not on a bounded request/);
      expect(r.nextStep).toMatch(/not in the turn that created the project/);
    } else {
      expect(r.nextStep).toBeUndefined();
    }
  });

  it("quotes the opening verify request in the first question's nextStep (#4791)", async () => {
    await writeProject(
      {
        project: {
          id: "rp_001", objective: "Verify his parents.", status: "active", created: "2026-01-01",
          updated: "2026-01-01", subject_person_ids: ["I1"], verify_request: "Verify his parents.",
        },
      },
      { persons: [{ id: "I1", gender: "Male", names: [{ given: "Anton", surname: "Vogt" }] }], relationships: [], sources: [] },
    );
    const r = await projectContext({ projectPath: dir }, LOCAL);
    if (!r.ok) throw new Error(r.errors.join("; "));
    expect(r.nextStep).toBe(firstQuestionNextStep("Verify his parents."));
    expect(r.nextStep).toContain('The researcher asked, when the project was created: "Verify his parents."');
    expect(r.nextStep).toMatch(/First Skill\("forget-and-rederive"\) with mode: verify/);
    expect(firstQuestionNextStep(undefined)).toBe(FIRST_QUESTION_NEXT_STEP);
  });

  it("gives each person its one-hop family from the tree's edges (#2537)", async () => {
    await writeProject(
      { project: { id: "rp_001", objective: "x", status: "active", created: "2026-01-01", updated: "2026-01-01" } },
      {
        persons: [
          { id: "I1", gender: "Male" },
          { id: "I2", gender: "Female", facts: [{ id: "F1", type: "http://gedcomx.org/Burial", date: "1858" }] },
          { id: "I3", gender: "Male" },
          { id: "I4", gender: "Female" },
          { id: "I5", gender: "Male", facts: [{ id: "F2", type: "Birth", date: "1850" }] },
        ],
        relationships: [
          { id: "R1", type: "Couple", person1: "I1", person2: "I2" },
          { id: "R2", type: "http://gedcomx.org/ParentChild", parent: "I1", child: "I3" },
          { id: "R3", type: "ParentChild", parent: "I2", child: "I3" },
          { id: "R4", type: "ParentChild", parent: "I1", child: "I3" }, // duplicate edge -> listed once
          { id: "R5", type: "Couple", person1: "I1", person2: "I4" },
          { id: "R6", type: "ParentChild", parent: "I9" }, // no child -> ignored
          { id: "R7", type: "Unknown", person1: "I1", person2: "I5" }, // not a family edge
        ],
        sources: [],
      },
    );
    const r = await projectContext({ projectPath: dir }, LOCAL);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const byId = Object.fromEntries((r.persons ?? []).map((p) => [p.id, p]));
    expect(byId.I1).toEqual({ id: "I1", gender: "Male", spouseIds: ["I2", "I4"], childIds: ["I3"] });
    expect(byId.I2).toEqual({ id: "I2", gender: "Female", spouseIds: ["I1"], childIds: ["I3"], diedByYear: 1858 });
    expect(byId.I3).toEqual({ id: "I3", gender: "Male", parentIds: ["I1", "I2"] });
    expect(byId.I4).toEqual({ id: "I4", gender: "Female", spouseIds: ["I1"] });
    expect(byId.I5).toEqual({ id: "I5", gender: "Male" });
  });

  it("reads diedByYear as the year a person was certainly dead by (#2537)", async () => {
    const person = (id: string, facts: any[]) => ({ id, gender: "Female", facts });
    await writeProject(
      { project: { id: "rp_001", objective: "x", status: "active", created: "2026-01-01", updated: "2026-01-01" } },
      {
        persons: [
          person("I1", [{ id: "F1", type: "Death", date: "Abt 1890" }]),
          person("I2", [{ id: "F2", type: "Death", date: "Bef 1870" }]),
          // the earlier of two dated facts wins; an undated one is no evidence
          person("I3", [
            { id: "F3", type: "Burial", date: "1875" },
            { id: "F4", type: "Death", date: "12 Mar 1874" },
            { id: "F5", type: "Death" },
          ]),
          person("I4", [{ id: "F6", type: "http://gedcomx.org/Death", date: "not a date" }]),
          person("I5", [{ id: "F7", type: "Birth", date: "1850" }]),
          // no upper bound: "after 1850" could be 1880, so it is no evidence of when
          person("I6", [{ id: "F8", type: "Death", date: "Aft 1850" }]),
        ],
        relationships: [],
        sources: [],
      },
    );
    const r = await projectContext({ projectPath: dir }, LOCAL);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const byId = Object.fromEntries((r.persons ?? []).map((p) => [p.id, p.diedByYear ?? null]));
    // the latest possible year, never the earliest: a death "Abt 1890" is not before 1891,
    // and one "Bef 1870" can fall in 1869, after an 1865 household
    expect(byId).toEqual({ I1: 1891, I2: 1870, I3: 1874, I4: null, I5: null, I6: null });
  });

  it("lets a record's own spelling of the given name carry it, and still flags Anthony (#4578)", async () => {
    // [tree given, linked name value, flagged?]
    const rows: [string, string, boolean][] = [
      ["Geronimo", "Jerónimo Beisaga", false], // one letter and an accent from eight
      ["Carmen", "Cármen Alfaro", false], // an accent
      ["Kristian Fredrik", "Christian Frederik Birkeland", false], // two letters from seven
      ["Honor Elizabeth", "Elizabeth Prizer", false], // a middle name
      ["George", "Georg Smith", false], // the record's shorter form
      ["John", "Jno Smith", false], // the given-name table
      ["Mary", "Polly Smith", false],
      ["William", "Bill Smith", false],
      ["Mary", "Maria 'Mary' Smith", false], // a quoted word
      ["Saml", "Samuel Tarrant", false], // the tree's contraction
      ["Christina", "Christena Clark", false], // one letter
      ["Anthony", "Anton Tyler", true],
      ["Anthony", "Antone Tyler", true],
      ["Anthony", "Antoine Tyler", true],
      ["Anthony", "Antonia Tyler", true],
      ["Anthony", "Atonne Tyler", true],
      ["Anthony", "Anntogne Tyler", true],
      ["Anthony", "Armtogne Tyler", true],
      ["Anthony", "Ann Tone Lightfoot", true],
      ["Anthony", "Tyler", true],
    ];
    const assertions: any[] = rows.map(([, value], i) => ({
      id: `a_${100 + i}`, source_id: "src_001", record_id: `r${i}`, fact_type: "name", value,
    }));
    const person_evidence: any[] = rows.map((_, i) => ({
      id: `pe_${100 + i}`, person_id: `P${i}`, assertion_id: `a_${100 + i}`, confidence: "probable",
    }));
    // A machine reading of the page, linked: evidence, never support. A researcher's reading supports.
    assertions.push(
      { id: "a_200", source_id: "src_001", record_id: "r0", fact_type: "name", value: "Tyler" },
      { id: "a_201", source_id: "src_001", record_id: "r0", fact_type: "name", value: "Anthony Tyler [?]", disputes_assertion_id: "a_200", log_entry_id: "log_001" },
      { id: "a_202", source_id: "src_001", record_id: "r0", fact_type: "name", value: "Anthony Tyler", disputes_assertion_id: "a_200", log_entry_id: "log_002" },
    );
    person_evidence.push(
      { id: "pe_200", person_id: "M1", assertion_id: "a_201", confidence: "probable" },
      { id: "pe_201", person_id: "M2", assertion_id: "a_202", confidence: "probable" },
    );
    const persons = [
      ...rows.map(([given], i) => ({ id: `P${i}`, gender: "Female", names: [{ id: `N${i}`, given, surname: "X", preferred: true }] })),
      { id: "M1", gender: "Female", names: [{ id: "NM1", given: "Anthony", surname: "Tyler", preferred: true }] },
      { id: "M2", gender: "Female", names: [{ id: "NM2", given: "Anthony", surname: "Tyler", preferred: true }] },
    ];
    await writeProject(
      {
        project: { id: "rp_001", objective: "x", status: "active", created: "2026-01-01", updated: "2026-01-01" },
        log: [
          { id: "log_001", tool: "image_transcribe" },
          { id: "log_002", tool: "user_provided" },
        ],
        assertions,
        person_evidence,
      },
      { persons, relationships: [], sources: [] },
    );
    const r = await projectContext({ projectPath: dir }, LOCAL);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const flagged = Object.fromEntries((r.persons ?? []).map((p) => [p.id, p.unsupportedGivenName !== undefined]));
    expect(flagged).toEqual({
      ...Object.fromEntries(rows.map(([, , f], i) => [`P${i}`, f])),
      M1: true, // only a machine reading of the page
      M2: false, // the researcher's own reading
    });
  });

  it("flags a given name none of the person's linked records gives, searched by its first letter (#4578)", async () => {
    const person = (id: string, given: string, surname = "Tyler") => ({
      id, gender: "Female", names: [{ id: `N${id}`, given, surname, preferred: true }],
    });
    const name = (id: string, value: string) => ({ id, source_id: "src_001", record_id: "r", fact_type: "name", value });
    const link = (n: number, personId: string, assertionId: string) => ({
      id: `pe_00${n}`, person_id: personId, assertion_id: assertionId, confidence: "confident",
    });
    await writeProject(
      {
        project: { id: "rp_001", objective: "x", status: "active", created: "2026-01-01", updated: "2026-01-01" },
        assertions: [
          name("a_001", "Tyler"), // the 1900 index: no given name
          name("a_002", "Dora Lightfoot"),
          name("a_003", "anthony TYLER"),
          { ...name("a_004", "Anthony Tyler"), superseded_by: "a_001" },
          { id: "a_005", source_id: "src_001", record_id: "r", fact_type: "sex", value: "Female" },
          name("a_006", "Wm. Tyler"),
          name("a_007", "Anthony Tyler"), // a namesake's record, linked to I1 once and revised away
          name("a_008", "Saml Tarrant"),
          name("a_009", "Herm Gaetjen"),
          name("a_010", "Ann Tone Lightfoot"),
        ],
        person_evidence: [
          link(1, "I1", "a_001"), link(2, "I1", "a_004"), link(3, "I1", "a_005"),
          { ...link(8, "I1", "a_007"), superseded_by: "pe_009" }, link(9, "I8", "a_007"),
          link(4, "I2", "a_002"),
          link(5, "I3", "a_003"),
          link(6, "I5", "a_005"),
          link(7, "I7", "a_006"),
          { ...link(0, "I9", "a_008"), id: "pe_010" },
          { ...link(0, "I10", "a_009"), id: "pe_011" },
          { ...link(0, "I11", "a_010"), id: "pe_012" },
        ],
      },
      {
        persons: [
          person("I1", "Anthony"), // only a superseded name and an index blank: flagged
          person("I2", "Dora"), // carried
          person("I3", "Anthony"), // carried, whatever the case
          person("I4", "Anthony"), // no linked name at all: not judged
          person("I5", "Anthony"), // a linked sex, no linked name: not judged
          person("I6", ""), // no given name to judge
          person("I7", "Wm."), // an abbreviation, carried as written
          person("I8", "Anthony"), // carried by the namesake's live link
          person("I9", "Samuel", "Tarrant"), // "Saml": a contraction carries it
          person("I10", "Hermann", "Gaetjen"), // "Herm": a prefix carries it
          person("I11", "Anthony"), // "Ann Tone": letters in order, but not a contraction
        ],
        relationships: [],
        sources: [],
      },
    );
    const r = await projectContext({ projectPath: dir }, LOCAL);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const flags = Object.fromEntries((r.persons ?? []).map((p) => [p.id, p.unsupportedGivenName ?? null]));
    expect(flags).toEqual({
      I1: { given: "Anthony", searchAs: "A*" },
      I2: null, I3: null, I4: null, I5: null, I6: null, I7: null, I8: null,
      I9: null, I10: null, I11: { given: "Anthony", searchAs: "A*" },
    });
    // A flagged given name is a reading in doubt, so the name is the surname alone.
    const names = Object.fromEntries((r.persons ?? []).map((p) => [p.id, p.name ?? null]));
    const surnameOf = (id: string) => (r.persons ?? []).find((p) => p.id === id)!.name;
    expect(names.I1).not.toMatch(/Anthony/);
    expect(names.I11).not.toMatch(/Anthony/);
    expect(surnameOf("I3")).toMatch(/^Anthony /);
  });

  it("gives a person its FamilySearch ID from a 4:1: ark, and none from a record ark or no ark (#4669)", async () => {
    await writeProject(
      { project: { id: "rp_001", objective: "x", status: "active", created: "2026-01-01", updated: "2026-01-01" } },
      {
        persons: [
          { id: "I1", gender: "Female", ark: "ark:/61903/4:1:K835-34K" },
          { id: "I2", gender: "Female", ark: "https://familysearch.org/ark:/61903/4:1:GJ8G-B7K" },
          // a record persona id is not a tree person: showing it as a PID points at the wrong person
          { id: "I3", gender: "Male", ark: "ark:/61903/1:1:AAAA-111" },
          { id: "I4", gender: "Male" },
          { id: "I5", gender: "Male", ark: "ark:/61903/3:1:3Q9M-CSLK-9QXV" },
          // the same PID the other tools compare uppercased
          { id: "I6", gender: "Male", ark: "ark:/61903/4:1:khwq-t7c" },
        ],
        relationships: [],
        sources: [],
      },
    );
    const r = await projectContext({ projectPath: dir }, LOCAL);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.persons).toEqual([
      { id: "I1", pid: "K835-34K", gender: "Female" },
      { id: "I2", pid: "GJ8G-B7K", gender: "Female" },
      { id: "I3", gender: "Male" },
      { id: "I4", gender: "Male" },
      { id: "I5", gender: "Male" },
      { id: "I6", pid: "KHWQ-T7C", gender: "Male" },
    ]);
  });

  it("returns the objective verbatim and untruncated, and leaves it out when absent (#3026)", async () => {
    const objective =
      "Identify the parents of Rosalind Hartwell (b. ca. 1855, Ohio). Her recorded surname 'Hartwell' is " +
      "unverified — it may be her birth (maiden) name or the married name she took from her husband.";
    expect(objective.length).toBeGreaterThan(140);
    await writeProject(
      { project: { id: "rp_001", objective, status: "active", created: "2026-01-01", updated: "2026-01-01" } },
      { persons: [], relationships: [], sources: [] },
    );
    const r = await projectContext({ projectPath: dir }, LOCAL);
    expect(r.ok && r.objective).toBe(objective);

    await writeProject(
      { project: { id: "rp_001", status: "active", created: "2026-01-01", updated: "2026-01-01" } },
      { persons: [], relationships: [], sources: [] },
    );
    const bare = await projectContext({ projectPath: dir }, LOCAL);
    expect(bare.ok).toBe(true);
    expect(bare).not.toHaveProperty("objective");
  });

  it("returns the project's subject person ids, and leaves them out when absent (#3516)", async () => {
    await writeProject(
      { project: { id: "rp_001", objective: "x", subject_person_ids: ["I1", "I2"], status: "active", created: "2026-01-01", updated: "2026-01-01" } },
      { persons: [], relationships: [], sources: [] },
    );
    const r = await projectContext({ projectPath: dir }, LOCAL);
    expect(r.ok && r.subjectPersonIds).toEqual(["I1", "I2"]);
    await writeProject(
      { project: { id: "rp_001", status: "active", created: "2026-01-01", updated: "2026-01-01" } },
      { persons: [], relationships: [], sources: [] },
    );
    const bare = await projectContext({ projectPath: dir }, LOCAL);
    expect(bare.ok).toBe(true);
    expect(bare).not.toHaveProperty("subjectPersonIds");
  });

  it("claimKinds lists every kind the engine accepts", async () => {
    await writeProject(
      { project: { id: "rp_001", objective: "Fresh", status: "active", created: "2026-01-01", updated: "2026-01-01" } },
      { persons: [], relationships: [], sources: [] },
    );
    const r = await projectContext({ projectPath: dir }, LOCAL);
    expect(r.ok && r.claimKinds).toEqual([...CLAIM_KINDS]);
  });

  it("leaves every empty list out of an empty project", async () => {
    await writeProject(
      { project: { id: "rp_001", objective: "Fresh", status: "active", created: "2026-01-01", updated: "2026-01-01" } },
      { persons: [], relationships: [], sources: [] },
    );
    const r = await projectContext({ projectPath: dir }, LOCAL);
    expect(r).toEqual({
      ok: true,
      buildId: readBuildInfo().version,
      projectStatus: "active",
      objective: "Fresh",
      boundedRequest: BOUNDED_REQUEST_RULE,
      // Absent here: an optional section counts 0, a required one is null
      // because research_query would refuse it.
      sectionCounts: Object.fromEntries(
        RESEARCH_QUERY_SECTIONS.filter((s) => s !== EXTERNAL_COLLECTIONS_SECTION).map((s) => [
          s,
          RESEARCH_QUERY_OPTIONAL_SECTIONS.has(s) ? 0 : null,
        ]),
      ),
      unregisteredDisagreementCount: 0,
      claimKinds: ["relationship", "fact", "identity", "name", "finding"],
    });
  });

  describe("the answer's shape: absent means null or empty", () => {
    /** Every path holding null, "" or []. A null nextStep and the sectionCounts
     *  values are the two places a null is an answer, so they are skipped. */
    function emptyPaths(value: unknown, path = "$"): string[] {
      if (value === null || value === "" || (Array.isArray(value) && value.length === 0)) return [path];
      if (Array.isArray(value)) return value.flatMap((v, i) => emptyPaths(v, `${path}[${i}]`));
      if (value && typeof value === "object") {
        return Object.entries(value).flatMap(([k, v]) =>
          k === "sectionCounts" || (k === "nextStep" && v === null) ? [] : emptyPaths(v, `${path}.${k}`),
        );
      }
      return [];
    }
    const keys = (o: unknown) => Object.keys(o as object).sort();
    const PROJECT = { id: "rp_001", status: "active", created: "2026-01-01", updated: "2026-01-01" };
    const URL_A = "https://www.archion.de/de/alle-archive/baden-wuerttemberg/x/baiersbronn";
    const browse = (group: string, count: number) =>
      getProjectStore().appendText(
        dir,
        "results/image-browse.jsonl",
        Array.from({ length: count }, (_, i) =>
          `${JSON.stringify({ image_group: group, image_id: `${group}_${String(i + 1).padStart(5, "0")}`, tool: "image_transcribe", at: "2026-10-14T00:00:00Z" })}\n`,
        ).join(""),
      );

    it("carries every documented field that has a value, and never sourceRefs or pagesRead", async () => {
      await writeProject(
        {
          project: { ...PROJECT, objective: "Find I1's parents", subject_person_ids: ["I1"] },
          researcher_profile: { narration_guidance: "Plain words.", subscriptions: ["ancestry"] },
          questions: [{ id: "q_001", question: "Who were I1's parents?", status: "in_progress" }],
          plans: [
            {
              id: "pl_001",
              question_id: "q_001",
              status: "active",
              created: "2026-10-14",
              items: [{ id: "pli_001", sequence: 1, status: "planned" }],
            },
          ],
          sources: [{ id: "src_001", repository: "FamilySearch", gedcomx_source_description_id: "S1" }],
          // Two linked birthplaces that disagree, and no conflict naming the pair.
          assertions: [
            { id: "a_1", source_id: "src_001", record_id: "ark:/61903/1:1:AAAA-111", fact_type: "birthplace", place: "England", extracted_for_question_ids: ["q_001"] },
            { id: "a_2", source_id: "src_001", record_id: "ark:/61903/1:1:BBBB-222", fact_type: "birthplace", place: "Alabama", extracted_for_question_ids: ["q_001"] },
          ],
          person_evidence: [
            { id: "pe_1", assertion_id: "a_1", person_id: "I1" },
            { id: "pe_2", assertion_id: "a_2", person_id: "I1" },
          ],
          conflicts: [{ id: "c_1", status: "unresolved", blocks_question_ids: ["q_001"], competing_assertion_ids: [] }],
          localities: [
            {
              id: "loc_001",
              place: "Norway",
              for_place: "Ringebu, Oppland, Norway",
              time_period: "1870-1880",
              jurisdictions: [{ name: "Ringebu, Oppland, Norway", date_range: "1838-" }],
              collections: [{ id: "4237104", title: "Norway, Church Books", date_range: "1797-1958", person_count: 5, record_count: 12 }],
              quirks: ["Indexed only at county level."],
              pages_read: [{ section: "home", url: "u1", found: true }],
            },
            {
              id: "loc_002",
              place: "Wayne, Michigan, United States",
              time_period: "1870-1930",
              collections: [{ id: "1325221", title: "United States, Census, 1900", date_range: "1900-1900", person_count: 5, record_count: 9 }],
              pages_read: [{ section: "home", url: "u1", found: true }],
            },
          ],
          log: [
            {
              id: "log_001",
              plan_item_id: "pli_001",
              performed: "2026-09-21T00:00:00.000Z",
              tool: "external_site",
              query: {},
              outcome: "partial",
              results_examined: 0,
              external_site: { site: "archion", url_generated: URL_A, capture_received: false },
              results_ref: null,
            },
            { id: "log_002", plan_item_id: "pli_001", performed: "2026-10-14T00:00:00Z", tool: "image_search", query: { imageGroupNumber: "004452257" }, outcome: "partial" },
          ],
        },
        {
          persons: [
            {
              id: "I1",
              gender: "Male",
              names: [{ id: "N1", given: "Ann", surname: "Doe", preferred: true, sources: [{ ref: "S1" }] }],
              facts: [{ id: "F1", type: "Death", date: "1900", sources: [{ ref: "S1" }] }],
              sources: [{ ref: "S1" }],
            },
            ...["I2", "I3", "I4", "I5", "I6"].map((id) => ({ id, gender: "Female" })),
          ],
          // Three birth parents of the subject: competing parent sets.
          relationships: [
            ...["I2", "I3", "I4"].map((p, n) => ({ id: `R${n}`, type: "ParentChild", parent: p, child: "I1" })),
            { id: "R5", type: "Couple", person1: "I1", person2: "I5" },
            { id: "R6", type: "ParentChild", parent: "I1", child: "I6" },
          ],
          sources: [{ id: "S1", title: "1880 census" }],
        },
      );
      await browse("004452257", 20);
      await writeFile(join(dir, "external-collections.json"), JSON.stringify({ places: { "Ohio, United States": { rows: [{ record_types: ["Census"] }] } } }));
      await mkdir(join(dir, "uploads"), { recursive: true });
      await writeFile(join(dir, "uploads", "census.pdf"), "pdf");

      const r = await projectContext({ projectPath: dir }, LOCAL);
      if (!r.ok) throw new Error(r.errors.join("; "));
      // waitingPages and uploadUrl need a staged page and a hosted store; their own tests show them.
      expect(keys(r)).toEqual(
        [
          "ok", "buildId", "projectStatus", "objective", "boundedRequest", "subjectPersonIds", "subject", "attachedSources", "narrationGuidance", "subscriptions",
          "openQuestions", "owedFindings", "questionStatuses", "persons", "sources", "localities", "nationalCollections", "awaitingUser",
          "exhaustedImageGroups", "claimKinds", "externalCollections", "sectionCounts",
          "unregisteredDisagreementCount", "uploads", "uploadsAre",
        ].sort(),
      );
      expect(keys(r.openQuestions?.[0])).toEqual(["id", "question"]);
      expect(keys(r.owedFindings?.[0])).toEqual(["blocksCompletion", "kind", "nextStep", "personIds", "ref"]);
      expect(keys(r.questionStatuses?.[0])).toEqual(
        ["id", "question", "state", "nextStep", "openConflictIds", "storedStatus", "unregisteredDisagreements", "competingParentSets", "spawn"].sort(),
      );
      expect(r.persons?.find((p) => p.id === "I1")).toEqual({
        id: "I1",
        name: "Ann Doe",
        gender: "Male",
        spouseIds: ["I5"],
        parentIds: ["I2", "I3", "I4"],
        childIds: ["I6"],
        diedByYear: 1900,
      });
      expect(keys(r.sources?.[0])).toEqual(["assertionCount", "gedcomxSourceDescriptionId", "id", "recordIds", "repository"]);
      expect(keys(r.localities?.[0])).toEqual(["collections", "forPlace", "id", "jurisdictions", "place", "quirks", "timePeriod"]);
      expect(keys(r.localities?.[0].jurisdictions?.[0])).toEqual(["dateRange", "name"]);
      expect(keys(r.localities?.[0].collections?.[0])).toEqual(["dateRange", "id", "personCount", "recordCount", "title"]);
      expect(keys(r.nationalCollections?.["United States"]?.[0])).toEqual(["dateRange", "id", "personCount", "recordCount", "title"]);
      expect(keys(r.awaitingUser?.[0])).toEqual(["logId", "performed", "planItemId", "site", "urlGenerated"]);
      expect(r.exhaustedImageGroups).toEqual([{ imageGroup: "004452257", imagesRead: 20, planItemIds: ["pli_001"] }]);
      expect(keys(r.uploads?.[0])).toEqual(["hasText", "name", "uploaded"]);
      expect(r.uploadsAre).toBe("files");
      expect(emptyPaths(r)).toEqual([]);
      expect(JSON.stringify(r)).not.toMatch(/sourceRefs|pagesRead/);
    });

    it("leaves out every null, \"\" and [] in rows that hold nothing, keeping a null nextStep and sectionCounts", async () => {
      await writeProject(
        {
          // No objective, no researcher_profile, no conflicts section (so sectionCounts.conflicts is null).
          project: PROJECT,
          questions: [
            { id: "q_001" },
            { id: "q_002", question: "Settled", status: "resolved" },
          ],
          proof_summaries: [{ id: "ps_001", question_id: "q_002" }],
          sources: [{ id: "src_001" }],
          assertions: [],
          localities: [{ id: "loc_001", jurisdictions: [{ name: "Ohio" }], collections: [{ id: "1" }] }],
          log: [
            {
              id: "log_001",
              plan_item_id: null,
              tool: "external_site",
              query: {},
              outcome: "partial",
              results_examined: 0,
              external_site: { site: "archion", url_generated: URL_A, capture_received: false },
              results_ref: null,
            },
          ],
        },
        { persons: [{ id: "I1" }], relationships: [], sources: [] },
      );
      await browse("008230326", 20);

      const r = await projectContext({ projectPath: dir }, LOCAL);
      if (!r.ok) throw new Error(r.errors.join("; "));
      expect(emptyPaths(r)).toEqual([]);
      expect(r.persons).toEqual([{ id: "I1" }]);
      expect(r.sources).toEqual([{ id: "src_001", assertionCount: 0 }]);
      expect(r.localities).toEqual([{ id: "loc_001", jurisdictions: [{ name: "Ohio" }], collections: [{ id: "1" }] }]);
      expect(r.openQuestions).toEqual([{ id: "q_001" }]);
      expect(r.awaitingUser).toEqual([{ logId: "log_001", site: "archion", urlGenerated: URL_A }]);
      expect(r.exhaustedImageGroups).toEqual([{ imageGroup: "008230326", imagesRead: 20 }]);
      expect(r).not.toHaveProperty("objective");
      expect(r).not.toHaveProperty("narrationGuidance");
      expect(r).not.toHaveProperty("subscriptions");
      // The two nulls that are answers stay.
      expect(r.questionStatuses?.find((q) => q.id === "q_002")).toHaveProperty("nextStep", null);
      expect(r.sectionCounts.conflicts).toBeNull();
    });
  });

  describe("exhaustedImageGroups: films whose browse cap is spent (#3549)", () => {
    const PROJECT = { id: "rp_001", objective: "T", status: "active", created: "2026-01-01", updated: "2026-01-01" };
    const id = (group: string, n: number) => `${group}_${String(n).padStart(5, "0")}`;
    async function browseLog(lines: string[]) {
      await getProjectStore().appendText(dir, "results/image-browse.jsonl", lines.map((l) => `${l}\n`).join(""));
    }
    function reads(group: string, count: number): string[] {
      return Array.from({ length: count }, (_, i) =>
        JSON.stringify({ image_group: group, image_id: id(group, i + 1), tool: "image_transcribe", at: "2026-10-14T00:00:00Z" }),
      );
    }
    function logEntry(planItemId: string, tool: string, query: Record<string, unknown>) {
      return { id: `log_${planItemId}`, plan_item_id: planItemId, performed: "2026-10-14T00:00:00Z", tool, query, outcome: "partial" };
    }
    function plan(planId: string, status: string, items: Record<string, string>) {
      return {
        id: planId,
        question_id: "q_001",
        status,
        created: "2026-10-14",
        items: Object.entries(items).map(([itemId, itemStatus], n) => ({ id: itemId, sequence: n + 1, status: itemStatus })),
      };
    }

    it("lists only open items on an active plan, so a disposed item drops off", async () => {
      await writeProject(
        {
          project: PROJECT,
          plans: [
            plan("pl_001", "superseded", { pli_001: "planned" }),
            plan("pl_002", "active", { pli_002: "completed", pli_003: "skipped", pli_004: "in_progress", pli_005: "planned" }),
          ],
          log: ["pli_001", "pli_002", "pli_003", "pli_004", "pli_005"].map((itemId) =>
            logEntry(itemId, "image_search", { imageGroupNumber: "004452257_001_ABCD-123" }),
          ),
        },
        { persons: [], relationships: [], sources: [] },
      );
      await browseLog(reads("004452257", 20));
      const r = await projectContext({ projectPath: dir }, LOCAL);
      expect(r.ok && r.exhaustedImageGroups).toEqual([
        { imageGroup: "004452257", imagesRead: 20, planItemIds: ["pli_004", "pli_005"] },
      ]);
    });

    it("lists a film at the cap with the plan items that browsed it, and only image_search entries", async () => {
      await writeProject(
        {
          project: PROJECT,
          plans: [plan("pl_001", "active", { pli_002: "planned", pli_003: "planned", pli_004: "planned" })],
          log: [
            logEntry("pli_002", "image_search", { imageGroupNumber: "004452257_001_ABCD-123" }),
            logEntry("pli_002", "image_search", { imageGroupNumber: "004452257_002_ABCD-456" }),
            logEntry("pli_003", "fulltext_search", { imageGroupNumber: "004452257" }),
            logEntry("pli_004", "image_search", { imageGroupNumber: "004000001" }),
          ],
        },
        { persons: [], relationships: [], sources: [] },
      );
      await browseLog([...reads("004452257", 20), ...reads("004000001", 3)]);
      const r = await projectContext({ projectPath: dir }, LOCAL);
      expect(r.ok && r.exhaustedImageGroups).toEqual([
        { imageGroup: "004452257", imagesRead: 20, planItemIds: ["pli_002"] },
      ]);
    });

    it("counts distinct images, so 19 plus a re-read is not exhausted", async () => {
      await writeProject({ project: PROJECT }, { persons: [], relationships: [], sources: [] });
      const nineteen = reads("004452257", 19);
      await browseLog([...nineteen, nineteen[0]]);
      const r = await projectContext({ projectPath: dir }, LOCAL);
      expect(r.ok).toBe(true);
      expect(r).not.toHaveProperty("exhaustedImageGroups");
    });

    it("skips a torn line, and lists a film with no browse logged against a plan item", async () => {
      await writeProject({ project: PROJECT }, { persons: [], relationships: [], sources: [] });
      await browseLog(["{not json", ...reads("008230326", 20)]);
      const r = await projectContext({ projectPath: dir }, LOCAL);
      expect(r.ok && r.exhaustedImageGroups).toEqual([{ imageGroup: "008230326", imagesRead: 20 }]);
    });
  });

  it("counts each section exactly as research_query would return it", async () => {
    // The promise question-selection relies on: a 0 here means that query comes
    // back empty, so skipping it loses nothing. Held per section against the
    // real query, not against a hand-written expectation.
    const research: Record<string, unknown> = {
      project: { id: "rp_001", objective: "x", status: "active", created: "2026-01-01", updated: "2026-01-01" },
      questions: [{ id: "q_001", question: "Where was Ann born?", status: "open" }],
      // Ann's birthplace: England on one census, Alabama on another, and no
      // conflict names the pair, so conflicts counts 0 while the query still
      // has something to say.
      assertions: [
        { id: "a_1", fact_type: "birth", place: "England" },
        { id: "a_2", fact_type: "birth", place: "Alabama, United States" },
      ],
      person_evidence: [
        { id: "pe_1", person_id: "I2", assertion_id: "a_1" },
        { id: "pe_2", person_id: "I2", assertion_id: "a_2" },
      ],
      conflicts: [],
      hypotheses: [{ id: "h_001", claim: "c", status: "active" }],
    };
    for (const section of RESEARCH_QUERY_SECTIONS) {
      if (section !== EXTERNAL_COLLECTIONS_SECTION && !(section in research)) research[section] = [];
    }
    await writeProject(research, { persons: [], relationships: [], sources: [] });

    const r = await projectContext({ projectPath: dir }, LOCAL);
    if (!r.ok) throw new Error(r.errors.join("; "));
    expect(Object.keys(r.sectionCounts).sort()).toEqual(
      RESEARCH_QUERY_SECTIONS.filter((s) => s !== EXTERNAL_COLLECTIONS_SECTION).sort(),
    );
    expect(r.sectionCounts.assertions).toBe(2);
    expect(r.sectionCounts.conflicts).toBe(0);
    for (const [section, count] of Object.entries(r.sectionCounts)) {
      const q = await researchQuery({ projectPath: dir, section } as any);
      if (!q.ok) throw new Error(`${section}: ${q.errors.join("; ")}`);
      expect(count, section).toBe(q.count);
      if (section === "conflicts") {
        expect(r.unregisteredDisagreementCount).toBe(q.unregisteredDisagreements?.length);
        expect(r.unregisteredDisagreementCount).toBe(1);
      }
    }
  });

  it("counts an absent optional section 0, and is null where research_query would refuse", async () => {
    await writeProject(
      {
        project: { id: "rp_001", status: "active", created: "2026-01-01", updated: "2026-01-01" },
        hypotheses: [{ id: "h_001" }],
        timelines: {},
      },
      { persons: [], relationships: [], sources: [] },
    );
    const r = await projectContext({ projectPath: dir }, LOCAL);
    if (!r.ok) throw new Error(r.errors.join("; "));
    expect(r.sectionCounts.localities).toBe(0);
    expect(r.sectionCounts.hypotheses).toBe(1);
    // A 0 here would let the agent skip a query that fails.
    for (const section of ["conflicts", "timelines"]) {
      expect(r.sectionCounts[section], section).toBeNull();
      expect((await researchQuery({ projectPath: dir, section } as any)).ok, section).toBe(false);
    }
  });

  describe("awaitingUser: open external-site hand-offs (spec §2.3)", () => {
    const URL_A = "https://www.archion.de/de/alle-archive/baden-wuerttemberg/x/baiersbronn";
    const URL_B = "https://www.fold3.com/search?keywords=Flynn";
    function ext(id: string, outcome: string, url: string, captureReceived: boolean, planItemId: string | null = null) {
      return {
        id,
        plan_item_id: planItemId,
        performed: `2026-09-2${id.slice(-1)}T00:00:00.000Z`,
        tool: "external_site",
        query: {},
        outcome,
        results_examined: 0,
        external_site: { site: "archion", url_generated: url, capture_received: captureReceived },
        results_ref: null,
      };
    }
    async function withLog(log: any[]) {
      await writeProject(
        { project: { id: "rp_001", objective: "T", status: "active", created: "2026-01-01", updated: "2026-01-01" }, log },
        { persons: [], relationships: [], sources: [] },
      );
      const r = await projectContext({ projectPath: dir }, LOCAL);
      expect(r.ok).toBe(true);
      if (!r.ok) throw new Error("project_context failed");
      return r.awaitingUser ?? [];
    }

    it("lists an open partial hand-off with its plan item and timestamp", async () => {
      expect(await withLog([ext("log_001", "partial", URL_A, false, "pli_004")])).toEqual([
        {
          logId: "log_001",
          site: "archion",
          urlGenerated: URL_A,
          planItemId: "pli_004",
          performed: "2026-09-21T00:00:00.000Z",
        },
      ]);
    });

    it("drops it once a later entry for the same URL carries the capture", async () => {
      expect(
        await withLog([ext("log_001", "partial", URL_A, false), ext("log_002", "positive", URL_A, true)]),
      ).toEqual([]);
    });

    it("drops it when the user could not access the site (a later error with no capture)", async () => {
      expect(
        await withLog([ext("log_001", "partial", URL_A, false), ext("log_002", "error", URL_A, false)]),
      ).toEqual([]);
    });

    it("a later partial for the same URL is the link sent again: it opens a row and closes none", async () => {
      const open = await withLog([ext("log_001", "partial", URL_A, false), ext("log_002", "partial", URL_A, false)]);
      expect(open.map((o) => o.logId)).toEqual(["log_001", "log_002"]);
    });

    it("an autonomous deferral (negative, no capture) never opens a row", async () => {
      expect(await withLog([ext("log_001", "negative", URL_A, false)])).toEqual([]);
    });

    it("a capture on a different URL closes nothing", async () => {
      const open = await withLog([ext("log_001", "partial", URL_A, false), ext("log_002", "positive", URL_B, true)]);
      expect(open.map((o) => o.logId)).toEqual(["log_001"]);
    });

    it("an EARLIER capture does not close a later hand-off of the same URL", async () => {
      const open = await withLog([ext("log_001", "positive", URL_A, true), ext("log_002", "partial", URL_A, false)]);
      expect(open.map((o) => o.logId)).toEqual(["log_002"]);
    });

    it("never lists a positive entry logged with capture_received: false (alpha feedback #2864)", async () => {
      expect(
        await withLog([ext("log_012", "positive", URL_A, false), ext("log_013", "positive", URL_B, false)]),
      ).toEqual([]);
    });

    it("ignores entries that are not external_site hand-offs", async () => {
      expect(
        await withLog([
          {
            id: "log_001",
            plan_item_id: null,
            performed: "2026-09-21T00:00:00.000Z",
            tool: "record_search",
            query: {},
            outcome: "partial",
            results_examined: 0,
            external_site: null,
            results_ref: null,
          },
        ]),
      ).toEqual([]);
    });
  });

  it("projects localities: snake→camel, omits guide_markdown and pages_read", async () => {
    await writeProject(
      {
        project: { id: "rp_001", objective: "T", status: "active", created: "2026-01-01", updated: "2026-01-01" },
        localities: [
          {
            id: "loc_001",
            place: "Norway",
            for_place: "Ringebu, Oppland, Norway",
            time_period: "1870-1880",
            jurisdictions: [{ name: "Ringebu, Oppland, Norway", date_range: "1838-" }],
            collections: [
              { id: "4237104", title: "Norway, Church Books", date_range: "1797-1958", person_count: 0, record_count: 12 },
              { id: "1", title: "Uncounted", date_range: null, person_count: null },
              { id: "2", title: "Bad count", person_count: "5", record_count: 1.5 },
            ],
            quirks: ["Indexed only at county level."],
            record_types: [
              { type: "church", years: "1814-1900", level: "parish", held_at: "Statsarkivet", access: "browse",
                collection_ids: ["4237104"], summary: "Church books by parish.", source_url: "https://x/church" },
              { type: "tax", years: null, level: null, held_at: null, access: "unknown", collection_ids: [],
                summary: "Not confirmed.", source_url: null },
            ],
            repositories: [{ name: "Statsarkivet i Hamar", holds: "church books", access: null, url: "https://x/hamar" }],
            losses: [{ record_set: "Ringebu church book", years: "1740-1760", source_url: "https://x/loss" }],
            catalog: [{ id: "koha:1", title: "Kirkebøker catalog row", place: "Ringebu", repository_calls: [], film_count: 3 }],
            guide_markdown: "## Norway\nlong prose that must not leak into the compact projection",
            pages_read: [
              { section: "home", url: "u1", found: true },
              { section: "research_tips", url: null, found: false },
            ],
            source: "locality-guide",
            created: "2026-01-02",
          },
        ],
      },
      { persons: [], relationships: [], sources: [] },
    );
    const r = await projectContext({ projectPath: dir }, LOCAL);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.localities).toEqual([
      {
        id: "loc_001",
        place: "Norway",
        forPlace: "Ringebu, Oppland, Norway",
        timePeriod: "1870-1880",
        jurisdictions: [{ name: "Ringebu, Oppland, Norway", dateRange: "1838-" }],
        collections: [
          { id: "4237104", title: "Norway, Church Books", dateRange: "1797-1958", personCount: 0, recordCount: 12, availability: "browse-only" },
          { id: "1", title: "Uncounted" },
          { id: "2", title: "Bad count" },
        ],
        quirks: ["Indexed only at county level."],
        recordTypes: [
          { type: "church", years: "1814-1900", level: "parish", heldAt: "Statsarkivet", access: "browse",
            collectionIds: ["4237104"], summary: "Church books by parish." },
          { type: "tax", access: "unknown", summary: "Not confirmed." },
        ],
        repositories: [{ name: "Statsarkivet i Hamar", holds: "church books", url: "https://x/hamar" }],
        losses: [{ recordSet: "Ringebu church book", years: "1740-1760" }],
      },
    ]);
    expect(JSON.stringify(r.localities)).not.toContain("long prose");
    expect(JSON.stringify(r.localities)).not.toContain("catalog row");
  });

  describe("nationalCollections: country-wide rows once per country (spec)", () => {
    const census = (year: number) => ({
      id: `us${year}`,
      title: `United States, Census, ${year}`,
      date_range: `${year}-${year}`,
      person_count: 1,
      record_count: 1,
    });
    const loc = (id: string, place: string, time_period: string, collections: unknown[]) => ({
      id,
      place,
      time_period,
      collections,
      pages_read: [{ section: "home", url: "u1", found: true }],
    });
    const run = async (localities: unknown[]) => {
      await writeProject(
        { project: { id: "rp_001", objective: "T", status: "active", created: "2026-01-01", updated: "2026-01-01" }, localities },
        { persons: [], relationships: [], sources: [] },
      );
      const r = await projectContext({ projectPath: dir }, LOCAL);
      if (!r.ok) throw new Error(r.errors.join("; "));
      return r;
    };
    const michigan = { id: "m1", title: "Michigan, Death Records, 1867-1952", date_range: "1867-1952", person_count: 1, record_count: 1 };

    it("lists a row two localities share once, by title, and in neither locality", async () => {
      const r = await run([
        loc("loc_001", "Wayne, Michigan, United States", "1870-1930", [michigan, census(1900), census(1880)]),
        loc("loc_002", "Cook, Illinois, United States", "1900-1950", [census(1940), census(1900)]),
      ]);
      expect(r.nationalCollections).toEqual({
        "United States": [
          { id: "us1880", title: "United States, Census, 1880", dateRange: "1880-1880", personCount: 1, recordCount: 1 },
          { id: "us1900", title: "United States, Census, 1900", dateRange: "1900-1900", personCount: 1, recordCount: 1 },
          { id: "us1940", title: "United States, Census, 1940", dateRange: "1940-1940", personCount: 1, recordCount: 1 },
        ],
      });
      expect(r.localities?.[0].collections?.map((c) => c.id)).toEqual(["m1"]);
      expect(r.localities?.[1].collections).toBeUndefined();
    });

    it("claims nothing for the years between two localities: only the rows they hold", async () => {
      const r = await run([
        loc("loc_001", "Wayne, Michigan, United States", "1850-1870", [census(1850), census(1860), census(1870)]),
        loc("loc_002", "Wayne, Michigan, United States", "1910-1930", [census(1910), census(1920), census(1930)]),
      ]);
      expect(r.nationalCollections?.["United States"]?.map((c) => c.id)).toEqual(["us1850", "us1860", "us1870", "us1910", "us1920", "us1930"]);
    });

    it("keeps a state-level title in its locality", async () => {
      const r = await run([
        loc("loc_001", "Halifax, Nova Scotia, Canada", "1836-1910", [
          { id: "ca1901", title: "Canada, Census, 1901" },
          { id: "cans", title: "Canada, Nova Scotia, Deaths, 1890-1955" },
        ]),
      ]);
      expect(r.nationalCollections).toEqual({ Canada: [{ id: "ca1901", title: "Canada, Census, 1901" }] });
      expect(r.localities?.[0].collections?.map((c) => c.id)).toEqual(["cans"]);
    });

    it("marks browse-only from a stored label over the count, or from an older row's count, and leaves name-searchable unmarked", async () => {
      const r = await run([
        loc("loc_001", "Schuylkill, Pennsylvania, United States", "1845-1908", [
          { id: "1999196", title: "Pennsylvania, Probate Records, 1683-1994", person_count: 52, availability: "browse-only" },
          { id: "2466360", title: "Pennsylvania, Church Marriages, 1682-1976", person_count: 17743 },
          { id: "old0", title: "Pennsylvania, Old Browse Set", person_count: 0 },
        ]),
      ]);
      expect(Object.fromEntries((r.localities?.[0].collections ?? []).map((c) => [c.id, c.availability]))).toEqual({
        "1999196": "browse-only",
        "2466360": undefined,
        old0: "browse-only",
      });
    });

    it("leaves a place outside the three countries alone, and gives no key", async () => {
      const r = await run([loc("loc_001", "Madeira, Portugal", "1830-1910", [{ id: "pt", title: "Portugal, Civil Records, 1437-2023" }])]);
      expect(r.nationalCollections).toBeUndefined();
      expect(r.localities?.[0].collections?.map((c) => c.id)).toEqual(["pt"]);
    });
  });

  it("truncates a long question to 140 chars ending in an ellipsis; leaves a 140-char one alone", async () => {
    const long = "x".repeat(200);
    const exact = "y".repeat(140);
    await writeProject(
      {
        project: { id: "rp_001", objective: "T", status: "paused", created: "2026-01-01", updated: "2026-01-01" },
        questions: [
          { id: "q_001", question: long, status: "open" },
          { id: "q_002", question: exact, status: "open" },
        ],
      },
      { persons: [] },
    );
    const r = await projectContext({ projectPath: dir }, LOCAL);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.projectStatus).toBe("paused");
    const [first, second] = (r.openQuestions ?? []).map((q) => q.question ?? "");
    expect(first).toHaveLength(140);
    expect(first.endsWith("…")).toBe(true);
    expect(first.startsWith("x".repeat(139))).toBe(true);
    expect(second).toBe(exact);
  });

  it("errors when a project file is missing or unparseable — never throws", async () => {
    fileStoreOnly("a document that is not JSON cannot exist in the Postgres store");
    await writeFile(join(dir, "research.json"), JSON.stringify({ project: { status: "active" } }));
    const missingTree = await projectContext({ projectPath: dir }, LOCAL);
    expect(missingTree.ok).toBe(false);
    if (missingTree.ok) return;
    expect(missingTree.errors.join(" ")).toMatch(/tree\.gedcomx\.json not found/);

    await writeFile(join(dir, "tree.gedcomx.json"), "{not json");
    const badTree = await projectContext({ projectPath: dir }, LOCAL);
    expect(badTree.ok).toBe(false);
    if (badTree.ok) return;
    expect(badTree.errors.join(" ")).toMatch(/tree\.gedcomx\.json is not valid JSON/);
  });
  it("skips a malformed entry in the attached-births scope rather than failing (#4444)", async () => {
    for (const [subjects, facts] of [[["P1"], { type: "Birth" }], ["P1", []]] as const) {
      await writeProject(
        {
          project: { status: "active", subject_person_ids: subjects },
          questions: [{ id: "q_001", question: "When did P1 marry?", status: "open" }],
          sources: [],
          assertions: [],
        },
        { persons: [{ id: "P1", facts }], relationships: [] },
      );
      const r = await projectContext({ projectPath: dir }, LOCAL);
      expect(r.ok).toBe(true);
    }
  });

  // #2126 — project_context is the primary "which build is this?" surface (8
  // skills call it), so the stamp rides on every return branch including the
  // two failure shapes.
  describe("buildId (#2126)", () => {
    const expected = readBuildInfo().version;

    it("carries the same stamped build on every return branch", async () => {
      await writeProject({ project: { status: "active" }, questions: [], sources: [], assertions: [] }, { persons: [] });
      const populated = await projectContext({ projectPath: dir }, LOCAL);
      expect(populated.buildId).toBe(expected);

      await rm(join(dir, "tree.gedcomx.json")); // broken project: one file of two
      const broken = await projectContext({ projectPath: dir }, LOCAL);
      expect(broken.ok).toBe(false);
      expect(broken.buildId).toBe(expected);

      await rm(join(dir, "research.json")); // not a project at all
      const none = await projectContext({ projectPath: dir }, LOCAL);
      expect(none.ok).toBe(false);
      if (!none.ok) expect(none.reason).toBe("no_project");
      expect(none.buildId).toBe(expected);
    });
  });

  // The router reads this answer just before it routes, so the bounded-request rule rides
  // here, on the project answer and on the no-project one a new folder gets.
  describe("boundedRequest", () => {
    it("rides on a project's answer and on a folder with no project, not on a broken one", async () => {
      await writeProject({ project: { status: "active" }, questions: [], sources: [], assertions: [] }, { persons: [] });
      const populated = await projectContext({ projectPath: dir }, LOCAL);
      expect(populated.ok).toBe(true);
      if (populated.ok) expect(populated.boundedRequest).toBe(BOUNDED_REQUEST_RULE);

      await rm(join(dir, "tree.gedcomx.json")); // broken project: one file of two
      const broken = await projectContext({ projectPath: dir }, LOCAL);
      expect(broken.ok).toBe(false);
      if (!broken.ok) expect(broken.boundedRequest).toBeUndefined();

      await rm(join(dir, "research.json")); // not a project at all
      const none = await projectContext({ projectPath: dir }, LOCAL);
      expect(none.ok).toBe(false);
      if (!none.ok) {
        expect(none.reason).toBe("no_project");
        expect(none.boundedRequest).toBe(BOUNDED_REQUEST_RULE);
      }
    });

    it("names the record's owner, the step a bounded turn never runs, and the attached-record read", () => {
      expect(BOUNDED_REQUEST_RULE).toMatch(/^For the research router only; an agent it spawned ignores this and does its own task\. /);
      expect(BOUNDED_REQUEST_RULE).toContain("after init-project when there is no project yet (search-records for a record)");
      expect(BOUNDED_REQUEST_RULE).toContain("the turn never runs question-selection");
      expect(BOUNDED_REQUEST_RULE).toContain('the reply ends on that agent\'s "Continue with …?" line');
      expect(BOUNDED_REQUEST_RULE).toContain(
        "A requested record that attachedSources already lists is not searched for: read it with person_read, and " +
          "with record_read when it has a recordId, and name it.",
      );
      expect(BOUNDED_REQUEST_RULE).toContain(
        "A children or siblings ask starts from what is attached: before any search, read each census in " +
          "attachedSources that has a recordId with record_read({ projectPath, recordId })",
      );
    });

    it("leaves a research plan out of the list, since a plan on a new folder stops after init-project", () => {
      expect(BOUNDED_REQUEST_RULE).not.toMatch(/\bplan\b/);
    });
  });

  // #2108 / #2031: proves the field reaches the payload, not just the helper.
  it("questionStatuses carries storedStatus, including where it disagrees with state", async () => {
    await writeProject(
      {
        project: { id: "rp_001", objective: "Test", status: "active", created: "2026-01-01", updated: "2026-01-01" },
        questions: [
          { id: "q_001", question: "Has a summary but is still in progress", status: "in_progress" },
          { id: "q_002", question: "No status key at all" },
        ],
        proof_summaries: [{ id: "ps_001", question_id: "q_001" }],
      },
      { persons: [], relationships: [], sources: [] },
    );

    const r = await projectContext({ projectPath: dir }, LOCAL);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const q1 = r.questionStatuses?.find((q) => q.id === "q_001");
    // Derived from the proof summary, while the question still says otherwise.
    expect(q1?.state).toBe("concluded");
    expect(q1?.storedStatus).toBe("in_progress");

    const q2 = r.questionStatuses?.find((q) => q.id === "q_002");
    expect(q2).toBeDefined();
    expect(q2).not.toHaveProperty("storedStatus");
  });

  // A resolved question is absent from openQuestions, so this is the only place its
  // text reaches the router reading the objective against every question.
  it("questionStatuses carries each question's text, resolved ones included, truncated", async () => {
    const long = "W".repeat(200);
    await writeProject(
      {
        project: { id: "rp_001", objective: "Test", status: "active", created: "2026-01-01", updated: "2026-01-01" },
        questions: [
          { id: "q_001", question: "Where was Elizabeth born?", status: "resolved" },
          { id: "q_002", question: long, status: "in_progress" },
          { id: "q_003", status: "framed" },
        ],
      },
      { persons: [], relationships: [], sources: [] },
    );

    const r = await projectContext({ projectPath: dir }, LOCAL);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect((r.openQuestions ?? []).map((q) => q.id)).not.toContain("q_001");
    const byId = new Map((r.questionStatuses ?? []).map((q) => [q.id, q]));
    expect(byId.get("q_001")?.question).toBe("Where was Elizabeth born?");
    expect(byId.get("q_002")?.question).toBe(`${"W".repeat(139)}…`);
    expect(byId.get("q_002")?.question).toBe(r.openQuestions?.find((q) => q.id === "q_002")?.question);
    expect(byId.get("q_003")).not.toHaveProperty("question");
  });
});

const EMPTY_RESEARCH = {
  project: { id: "rp_001", objective: "Test", status: "active", created: "2026-01-01", updated: "2026-01-01" },
};
const EMPTY_TREE = { persons: [], relationships: [], sources: [] };

describe("project_context uploads", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "project-context-uploads-"));
    await writeFile(join(dir, "research.json"), JSON.stringify(EMPTY_RESEARCH));
    await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify(EMPTY_TREE));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  // Seeded with fs, not the store: under PROTO_STORE=pg the routing store copies
  // these files, mtimes included, into Postgres/S3, so `list` runs as SQL there.
  async function upload(name: string, mtimeSec?: number) {
    await mkdir(join(dir, "uploads"), { recursive: true });
    await writeFile(join(dir, "uploads", name), name);
    if (mtimeSec !== undefined) await utimes(join(dir, "uploads", name), mtimeSec, mtimeSec);
  }

  it("lists each upload once, pairing an X.txt with its X as that upload's text layer", async () => {
    for (const name of ["census.pdf", "census.pdf.txt", "notes.txt", "b.jpg", ".DS_Store"]) await upload(name);
    const r = await projectContext({ projectPath: dir }, LOCAL);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const byName = [...(r.uploads ?? [])].sort((a, b) => a.name.localeCompare(b.name));
    expect(byName.map((u) => [u.name, u.hasText])).toEqual([
      ["b.jpg", false],
      ["census.pdf", true],
      ["notes.txt", false],
    ]);
    for (const u of byName) expect(new Date(u.uploaded).toISOString()).toBe(u.uploaded);
  });

  it("omits uploads when the project has none", async () => {
    const r = await projectContext({ projectPath: dir }, LOCAL);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect("uploads" in r).toBe(false);
    expect("uploadsAre" in r).toBe(false);
  });

  it("orders newest first, ties by name", async () => {
    // Name order (a, m, y, z) is neither the answer nor its reverse.
    const at: Record<string, number> = { "a.pdf": 1_000, "z.pdf": 3_000, "m.pdf": 2_000, "y.pdf": 3_000 };
    for (const [name, sec] of Object.entries(at)) await upload(name, sec);
    const r = await projectContext({ projectPath: dir }, LOCAL);
    if (!r.ok) throw new Error(r.errors.join("; "));
    expect(r.uploads?.map((u) => u.name)).toEqual(["y.pdf", "z.pdf", "m.pdf", "a.pdf"]);
    expect(r.uploads?.[3].uploaded).toBe(new Date(1_000_000).toISOString());
  });

  it("omits uploads, and still answers, when the listing fails", async () => {
    await upload("census.pdf");
    const store = getProjectStore();
    const failing = new Proxy(store, {
      get(target, key) {
        if (key === "list") {
          return async (projectPath: string, dirRef: string) => {
            if (dirRef === "uploads") throw new Error("listing failed");
            return target.list(projectPath, dirRef);
          };
        }
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const r = await runWithProjectStore(failing, () => projectContext({ projectPath: dir }, LOCAL));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect("uploads" in r).toBe(false);
  });
});

describe("project_context and project_create links", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "project-links-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function contextUnder(
    store: ScopedFsStore | null,
    config: Record<string, unknown>,
    principal: Principal = bearerPrincipal("tok", config),
  ) {
    const run = async () => {
      const s = getProjectStore();
      const path = store ? SCOPED_ANCHOR : root;
      await s.writeJson(path, "research.json", EMPTY_RESEARCH);
      await s.writeJson(path, "tree.gedcomx.json", EMPTY_TREE);
      const r = await projectContext({ projectPath: path }, principal);
      if (!r.ok) throw new Error(r.errors.join("; "));
      return r;
    };
    return store ? runWithProjectStore(store, run) : run();
  }

  it("returns uploadUrl from the store's project id when both settings are on, and never a viewer link", async () => {
    const r = await contextUnder(new ScopedFsStore(root, "p-42"), {
      webPublicUrl: "https://beta.example/",
      uploadsEnabled: true,
    });
    expect(r.uploadUrl).toBe("https://beta.example/upload/p-42");
    expect("projectUrl" in r).toBe(false);
  });

  it("says uploads are stored, and how to read each, when it serves an uploadUrl; files when it does not", async () => {
    const withUploads = async (config: Record<string, unknown>) => {
      const store = new ScopedFsStore(root, "p-42");
      await runWithProjectStore(store, async () => {
        await getProjectStore().writeBytes(SCOPED_ANCHOR, "uploads/census.pdf", new Uint8Array([1]));
        await getProjectStore().writeBytes(SCOPED_ANCHOR, "uploads/census.pdf.txt", new Uint8Array([1]));
        await getProjectStore().writeBytes(SCOPED_ANCHOR, "uploads/page.png", new Uint8Array([1]));
      });
      return contextUnder(store, config);
    };
    const hosted = await withUploads({ webPublicUrl: "https://beta.example", uploadsEnabled: true });
    expect(hosted.uploadsAre).toBe("stored");
    const byName = Object.fromEntries((hosted.uploads ?? []).map((u) => [u.name, [u.readWith, u.ref]]));
    expect(byName).toEqual({
      "census.pdf": ["sidecar_read", "uploads/census.pdf.txt"],
      "page.png": ["image_transcribe", undefined],
    });
    const off = await withUploads({ webPublicUrl: "https://beta.example", uploadsEnabled: false });
    expect(off.uploadsAre).toBe("files");
    expect((off.uploads ?? []).every((u) => !("readWith" in u))).toBe(true);
  });

  it("returns no link while uploads are off", async () => {
    const off = await contextUnder(new ScopedFsStore(root, "p-42"), { webPublicUrl: "https://beta.example", uploadsEnabled: false });
    expect("uploadUrl" in off).toBe(false);
    expect("projectUrl" in off).toBe(false);
    const unset = await contextUnder(new ScopedFsStore(root, "p-43"), { webPublicUrl: "https://beta.example" });
    expect("uploadUrl" in unset).toBe(false);
    expect("projectUrl" in unset).toBe(false);
  });

  it("returns no link without the public URL", async () => {
    const r = await contextUnder(new ScopedFsStore(root, "p-42"), { uploadsEnabled: true });
    expect("projectUrl" in r).toBe(false);
    expect("uploadUrl" in r).toBe(false);
  });

  it("returns no link from a store with no project id, whatever projectPath is", async () => {
    fileStoreOnly("the file store is the one with no project id");
    const r = await contextUnder(null, { webPublicUrl: "https://beta.example", uploadsEnabled: true });
    expect("projectUrl" in r).toBe(false);
    expect("uploadUrl" in r).toBe(false);
  });

  // Self-hosted beta E3: the next turn's first read shows the sign-in link even
  // when an agent's summary dropped the tool error that first carried it.
  describe("signInUrl, for a connector caller whose FamilySearch session has ended", () => {
    const familySearch = vi.fn();
    const LINK = "https://beta.example/auth/familysearch/login";
    const connector = (config: Record<string, unknown> = { webPublicUrl: "https://beta.example/" }) =>
      connectorPrincipal({ accessToken: "fs-token", userId: "u_1", config });
    const read = (principal: Principal) => contextUnder(new ScopedFsStore(root, "p-42"), {}, principal);

    beforeEach(() => {
      familySearch.mockReset();
      vi.stubGlobal("fetch", familySearch);
      __resetSessionChecksForTests();
      __resetUserLimitsForTests();
    });
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("carries the link once FamilySearch answers 401", async () => {
      familySearch.mockResolvedValue(new Response("{}", { status: 401 }));
      expect((await read(connector())).signInUrl).toBe(LINK);
    });

    it("carries none while the session is accepted, or when the check learns nothing", async () => {
      familySearch.mockResolvedValue(new Response("{}", { status: 200 }));
      expect("signInUrl" in (await read(connector()))).toBe(false);
      __resetSessionChecksForTests();
      familySearch.mockResolvedValue(new Response("{}", { status: 503 }));
      expect("signInUrl" in (await read(connector()))).toBe(false);
      __resetSessionChecksForTests();
      familySearch.mockRejectedValue(new Error("socket hang up"));
      expect("signInUrl" in (await read(connector()))).toBe(false);
    });

    it("asks FamilySearch nothing when there is no link to give: the worker, or no public URL", async () => {
      familySearch.mockResolvedValue(new Response("{}", { status: 401 }));
      expect("signInUrl" in (await read(bearerPrincipal("worker-token", { webPublicUrl: "https://beta.example" })))).toBe(false);
      expect("signInUrl" in (await read(connector({})))).toBe(false);
      expect(familySearch).not.toHaveBeenCalled();
    });
  });
});

describe("project_context owed findings and status (issue #3032 Stage 1b)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "project-context-owed-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  async function writeProject(research: any, tree: any) {
    await writeFile(join(dir, "research.json"), JSON.stringify(research), "utf-8");
    await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify(tree), "utf-8");
  }
  const tree = {
    persons: [
      { id: "I1", gender: "Male", names: [{ id: "N1", given: "John", surname: "Smith" }], facts: [{ id: "F1", type: "Birth", date: "1850", sources: [{ ref: "S2" }] }] },
      { id: "I2", gender: "Male", names: [{ id: "N2", given: "Thomas", surname: "Smith" }] },
    ],
    relationships: [{ id: "R1", type: "ParentChild", parent: "I2", child: "I1" }],
    sources: [{ id: "S2", title: "1850 census" }],
  };
  const research = () => ({
    project: { id: "rp_001", objective: "Parents", status: "active" },
    questions: [{ id: "q_001", question: "Who?", status: "open" }, { id: "q_002", question: "When?", status: "open" }],
    plans: [{ id: "pl_001", question_id: "q_002", items: [{ id: "pli_001" }] }],
    log: [{ id: "log_001", plan_item_id: "pli_001", outcome: "positive" }],
    sources: [],
    assertions: [{ id: "a_001", record_id: "r1", source_id: "src_001", record_role: "child", fact_type: "birth", extracted_for_question_ids: ["q_001"] }],
    person_evidence: [{ id: "pe_001", assertion_id: "a_001", person_id: "I1", confidence: "confident", superseded_by: null }],
    proof_summaries: [],
  });

  it("owedFindings lists an unextracted log entry before a question with tied assertions and no summary", async () => {
    await writeProject(research(), tree);
    const r = await projectContext({ projectPath: dir }, LOCAL);
    if (!r.ok) throw new Error(r.errors.join("; "));
    expect(r.owedFindings?.map((f) => [f.kind, f.ref])).toEqual([["extract", "log_001"], ["conclude", "q_001"]]);
    expect(r.owedFindings?.[1]).toMatchObject({ personIds: ["I1"], blocksCompletion: true });
    expect("status" in r).toBe(false);
  });

  it("include: ['status'] returns a status for every tree object", async () => {
    await writeProject(research(), tree);
    const r = await projectContext({ projectPath: dir, include: ["status"] }, LOCAL);
    if (!r.ok) throw new Error(r.errors.join("; "));
    expect(r.status?.map((row) => [row.holder, row.label])).toEqual([
      [{ personId: "I1" }, "found in a record, not yet checked"],
      [{ relationshipId: "R1" }, "from your starting tree, not yet checked"],
    ]);
  });

  it("include: ['historicalContext'] writes the historical-context spawn from the subject's family facts", async () => {
    const r0 = research();
    await writeProject(
      { ...r0, project: { ...r0.project, objective: "Why did John move to Ohio in 1870?", subject_person_ids: ["I1"] } },
      {
        ...tree,
        persons: [
          ...tree.persons,
          { id: "I3", names: [{ id: "N3", given: "Ann", surname: "Lee" }], facts: [{ id: "F3", type: "Death", date: "1901", place: "Ohio" }] },
          { id: "I4", names: [{ id: "N4", given: "Tom", surname: "Smith" }], facts: [{ id: "F4", type: "Birth", date: "1880", place: "Ohio" }] },
          { id: "I5", names: [{ id: "N5", given: "Unrelated", surname: "Person" }], facts: [{ id: "F5", type: "Birth", date: "1700" }] },
        ],
        relationships: [
          ...tree.relationships,
          { id: "R2", type: "http://gedcomx.org/Couple", person1: "I3", person2: "I1" },
          { id: "R3", type: "ParentChild", parent: "I1", child: "I4" },
        ],
      },
    );
    const without = await projectContext({ projectPath: dir }, LOCAL);
    if (!without.ok) throw new Error(without.errors.join("; "));
    expect("historicalContext" in without).toBe(false);
    const r = await projectContext({ projectPath: dir, include: ["historicalContext"] }, LOCAL);
    if (!r.ok) throw new Error(r.errors.join("; "));
    expect(r.historicalContext).toEqual({
      agent: "historical-context",
      prompt: [
        `projectPath: ${dir}`,
        "Project objective (the researcher's, not a tree fact): Why did John move to Ohio in 1870?",
        "Tree facts (the only places and years the tree holds for these people):",
        "- John Smith (I1, subject): Birth 1850",
        "- Thomas Smith (I2, parent): no dated or placed facts",
        "- Ann Lee (I3, spouse): Death 1901, Ohio",
        "- Tom Smith (I4, child): Birth 1880, Ohio",
        "message:",
      ].join("\n"),
    });
  });

  it("include: ['historicalContext'] gives nothing when the project names no subject in the tree", async () => {
    await writeProject(research(), tree);
    const r = await projectContext({ projectPath: dir, include: ["historicalContext"] }, LOCAL);
    if (!r.ok) throw new Error(r.errors.join("; "));
    expect("historicalContext" in r).toBe(false);
  });

  it("an include value outside the closed list is refused", async () => {
    await writeProject(research(), tree);
    const r = await projectContext({ projectPath: dir, include: ["view" as any] }, LOCAL);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatch(/include must be an array of: persons, sources, status/);
  });

  it("the default projection has the same length before and after adding 50 facts and 20 edges that cite existing sources", async () => {
    await writeProject(research(), tree);
    const measure = async () => {
      const r = await projectContext({ projectPath: dir }, LOCAL);
      if (!r.ok) throw new Error(r.errors.join("; "));
      // persons' family-id arrays grow with edges by design; the rest must not.
      const { persons: _persons, ...rest } = r as any;
      return JSON.stringify(rest).length;
    };
    const before = await measure();
    const big = structuredClone(tree) as any;
    for (let i = 0; i < 50; i++) big.persons[0].facts.push({ id: `FX${i}`, type: "Residence", date: String(1850 + i), sources: [{ ref: "S2" }] });
    for (let i = 0; i < 20; i++) {
      big.persons.push({ id: `IX${i}`, gender: "Male", names: [{ id: `NX${i}`, given: "X" }] });
      big.relationships.push({ id: `RX${i}`, type: "ParentChild", parent: "I1", child: `IX${i}`, sources: [{ ref: "S2" }] });
    }
    await writeProject(research(), big);
    expect(await measure()).toBe(before);
  });
});

// Stage 1 of #4422 introduces `include` inert: accepted and validated, but the
// answer is byte-identical whether or not it is passed. The default flip
// (persons → subjects' one-hop family, sources on request) is a later stage.
describe("project_context include parameter (#4422 stage 1)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "project-context-include-test-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writePopulated() {
    await writeFile(
      join(dir, "research.json"),
      JSON.stringify(
        {
          project: {
            id: "rp_001",
            objective: "Test",
            status: "active",
            subject_person_ids: ["I1"],
            created: "2026-01-01",
            updated: "2026-01-01",
          },
          questions: [{ id: "q_001", question: "Who were William's parents?", status: "open" }],
          sources: [{ id: "src_001", repository: "FamilySearch", gedcomx_source_description_id: "S1" }],
          assertions: [{ id: "a_001", source_id: "src_001", record_id: "ark:/61903/1:1:AAAA-111" }],
        },
        null,
        2,
      ),
    );
    await writeFile(
      join(dir, "tree.gedcomx.json"),
      JSON.stringify(
        {
          persons: [
            { id: "I1", gender: "Male", names: [{ id: "N1", given: "William", surname: "Bottermiller", preferred: true }] },
            { id: "I2", gender: "Female", names: [{ id: "N2", given: "Mary", surname: "Bottermiller" }] },
            // I3 is outside the subject's one-hop family (no edge). A Stage-3
            // narrowing to subjects + one hop would drop it, so the inert and
            // pinned-default checks below can see a premature narrowing.
            { id: "I3", gender: "Male", names: [{ id: "N3", given: "John", surname: "Hale" }] },
          ],
          relationships: [{ type: "Couple", person1: "I1", person2: "I2" }],
          sources: [{ id: "S1", title: "1880 census" }],
        },
        null,
        2,
      ),
    );
  }

  it("is inert: the answer is byte-identical with include omitted, each value, and both", async () => {
    await writePopulated();
    const omitted = await projectContext({ projectPath: dir }, LOCAL);
    const variants = [
      await projectContext({ projectPath: dir, include: ["persons"] }, LOCAL),
      await projectContext({ projectPath: dir, include: ["sources"] }, LOCAL),
      await projectContext({ projectPath: dir, include: ["persons", "sources"] }, LOCAL),
      await projectContext({ projectPath: dir, include: [] }, LOCAL),
    ];
    expect(omitted.ok).toBe(true);
    // Pin the default list: a narrowing that ignores include (always narrows)
    // leaves every variant byte-identical, so only this line catches it.
    expect(omitted.ok && omitted.persons?.map((p) => p.id)).toEqual(["I1", "I2", "I3"]);
    const baseline = JSON.stringify(omitted);
    for (const v of variants) expect(JSON.stringify(v)).toBe(baseline);
  });

  it("refuses an unknown value, keeping buildId, and does not read the project", async () => {
    // No project files written: validation happens before the file reads, so an
    // unknown value is refused on its own merits rather than erroring on the read.
    for (const include of [["view"], ["bogus"], ["persons", "nope"]]) {
      const r = await projectContext({ projectPath: dir, include: include as any }, LOCAL);
      expect(r.ok).toBe(false);
      if (r.ok) continue;
      expect(r.reason).toBeUndefined();
      expect(r.buildId).toBe(readBuildInfo().version);
      expect(r.errors.join(" ")).toContain("persons, sources");
    }
  });

  it("refuses a non-array include", async () => {
    const r = await projectContext({ projectPath: dir, include: "persons" as any }, LOCAL);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toContain("persons, sources");
  });

  it("is taken at the server's door, and an unknown value is refused there by the tool", async () => {
    // Through createServer: the schema property is what lets include past
    // rejectUnknownArgs, and the tool's own check is what refuses an unknown
    // value. Calling projectContext() directly would exercise neither.
    const taken = await callTool("project_context", { projectPath: dir, include: ["persons", "sources"] });
    expect(taken.text).not.toContain("has no parameter");
    const bad = await callTool("project_context", { projectPath: dir, include: ["view"] });
    expect(bad.isError).toBe(true);
    expect(bad.text).toContain("persons, sources");
  });
});

describe("project_context — searches on a search step (spec §2.2.1)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "project-context-searches-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const tree = {
    persons: [{ id: "I1", names: [{ id: "N1", given: "Ann", surname: "Lee", preferred: true }] }],
    relationships: [],
  };
  const planItem = {
    id: "pli_001",
    sequence: 1,
    record_type: "census",
    jurisdiction: "Ohio",
    date_range: "1850",
    repository: "FamilySearch",
    rationale: "The 1850 census.",
    fallback_for: null,
    status: "planned",
  };

  async function contextFor(plans: any[]) {
    await writeFile(
      join(dir, "research.json"),
      JSON.stringify({
        project: {
          id: "rp_001",
          objective: "x",
          status: "active",
          created: "2026-01-01",
          updated: "2026-01-01",
          subject_person_ids: ["I1"],
        },
        questions: [{ id: "q_001", question: "Where was Ann in 1850?", status: "in_progress" }],
        plans,
      }),
    );
    await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify(tree));
    const r = await projectContext({ projectPath: dir }, LOCAL);
    if (!r.ok) throw new Error(r.errors.join("; "));
    return r.questionStatuses![0];
  }

  it("writes the search step out when nextStep is a search", async () => {
    const row = await contextFor([{ id: "pl_001", question_id: "q_001", status: "active", items: [planItem] }]);
    expect(row.nextStep).toBe("search-records");
    expect(row.searches).toHaveLength(1);
    expect(row.searches![0]).toMatchObject({ planItemId: "pli_001", agent: "search-records" });
    expect(row.searches![0].prompt).toContain(`projectPath: ${dir}`);
    // Compared as an object: the Postgres store's jsonb reorders an object's keys.
    const line = row.searches![0].prompt.split("\n").find((l) => l.startsWith("plan_item: "));
    expect(JSON.parse(line!.slice("plan_item: ".length))).toEqual(planItem);
  });

  it("carries no searches when the next step is not a search", async () => {
    const row = await contextFor([]);
    expect(row.nextStep).toBe("locality-guide, then research-plan");
    expect(row.searches).toBeUndefined();
  });
});

describe("project_context familyReadPersonIds", () => {
  let dir: string;
  beforeAll(() => __usePlaceTableForTests({}));
  afterAll(() => __usePlaceTableForTests(null));
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "project-context-family-read-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const byPid = (r: any, pid: string) => r.persons.find((p: any) => p.pid === pid);

  it("names the person read; the wife has no parentIds and is not in it, so her parents read as not copied", async () => {
    await createPhippsProject(dir);
    const r = await projectContext({ projectPath: dir }, LOCAL);
    if (!r.ok) throw new Error("not ok");
    expect(r.familyReadPersonIds).toEqual(["I1"]);
    const mary = byPid(r, PIDS.mary);
    expect(mary).not.toHaveProperty("parentIds");
    expect(r.familyReadPersonIds).not.toContain(mary.id);
    const peyton = byPid(r, PIDS.peyton);
    expect(peyton.spouseIds).toHaveLength(1);
    expect(r.familyReadPersonIds).not.toContain(peyton.id);
  });

  it("still names the person read when the wife is made the subject", async () => {
    await createPhippsProject(dir, [PIDS.mary]);
    const r = await projectContext({ projectPath: dir }, LOCAL);
    if (!r.ok) throw new Error("not ok");
    expect(r.subjectPersonIds).toEqual([byPid(r, PIDS.mary).id]);
    expect(r.familyReadPersonIds).toEqual(["I1"]);
  });

  it("leaves the key out for a tree with no read-from source", async () => {
    await writeFile(
      join(dir, "research.json"),
      JSON.stringify({ project: { id: "rp_001", objective: "Test", status: "active", created: "2026-01-01", updated: "2026-01-01" } }),
    );
    await writeFile(
      join(dir, "tree.gedcomx.json"),
      JSON.stringify({
        persons: [{ id: "I1", ark: "ark:/61903/4:1:BBBB-111", names: [{ given: "Benjamin" }] }],
        relationships: [],
        sources: [{ id: "S1", title: "FamilySearch Family Tree", url: "https://www.familysearch.org/tree" }],
      }),
    );
    const r = await projectContext({ projectPath: dir }, LOCAL);
    if (!r.ok) throw new Error("not ok");
    expect(r).not.toHaveProperty("familyReadPersonIds");
  });

  it("describes the key and the not-copied rule", () => {
    const d = projectContextSchema.description;
    expect(d).toContain("familyReadPersonIds");
    expect(d).toMatch(/not in familyReadPersonIds, an absent or short spouseIds\/parentIds\/childIds means not copied from Family Tree, not\s+none/);
  });
});

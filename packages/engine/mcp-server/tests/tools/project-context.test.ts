import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

import { projectContext } from "../../src/tools/project-context.js";

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

  it("projects a populated project: open questions, persons with sourceRefs, sources with recordIds", async () => {
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
              { id: "N1", given: "William", surname: "Bottermiller", preferred: true, sources: [{ ref: "S2" }] },
              { id: "N2", given: "Willie", surname: "Bottermiller" },
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

    const r = await projectContext({ projectPath: dir });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.projectStatus).toBe("active");
    expect(r.openQuestions).toEqual([
      { id: "q_001", question: "Who were William's parents?" },
      { id: "q_003", question: "Where was he in 1880?" },
      { id: "q_004", question: "Declared exhaustive" },
    ]);
    expect(r.persons).toEqual([
      { id: "I1", name: "William Bottermiller", gender: "Male", sourceRefs: ["S1", "S2"] },
      { id: "I2", name: "Mary Bottermiller", gender: "Female", sourceRefs: [] },
      { id: "I3", name: null, gender: "Male", sourceRefs: [] },
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
      { id: "src_003", repository: "NARA", gedcomxSourceDescriptionId: "S2", recordIds: [], assertionCount: 0 },
    ]);
  });

  it("returns empty arrays for an empty project", async () => {
    await writeProject(
      { project: { id: "rp_001", objective: "Fresh", status: "active", created: "2026-01-01", updated: "2026-01-01" } },
      { persons: [], relationships: [], sources: [] },
    );
    const r = await projectContext({ projectPath: dir });
    expect(r).toEqual({ ok: true, projectStatus: "active", openQuestions: [], persons: [], sources: [], localities: [] });
  });

  it("projects localities: snake→camel, omits guide_markdown, pagesRead = found sections only", async () => {
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
            collections: [{ id: "4237104", title: "Norway, Church Books", date_range: "1797-1958" }],
            quirks: ["Indexed only at county level."],
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
    const r = await projectContext({ projectPath: dir });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.localities).toEqual([
      {
        id: "loc_001",
        place: "Norway",
        forPlace: "Ringebu, Oppland, Norway",
        timePeriod: "1870-1880",
        jurisdictions: [{ name: "Ringebu, Oppland, Norway", dateRange: "1838-" }],
        collections: [{ id: "4237104", title: "Norway, Church Books", dateRange: "1797-1958" }],
        quirks: ["Indexed only at county level."],
        pagesRead: ["home"],
      },
    ]);
    expect(JSON.stringify(r.localities)).not.toContain("long prose");
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
    const r = await projectContext({ projectPath: dir });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.projectStatus).toBe("paused");
    expect(r.openQuestions[0].question).toHaveLength(140);
    expect(r.openQuestions[0].question.endsWith("…")).toBe(true);
    expect(r.openQuestions[0].question.startsWith("x".repeat(139))).toBe(true);
    expect(r.openQuestions[1].question).toBe(exact);
  });

  it("errors when a project file is missing or unparseable — never throws", async () => {
    await writeFile(join(dir, "research.json"), JSON.stringify({ project: { status: "active" } }));
    const missingTree = await projectContext({ projectPath: dir });
    expect(missingTree.ok).toBe(false);
    if (missingTree.ok) return;
    expect(missingTree.errors.join(" ")).toMatch(/tree\.gedcomx\.json not found/);

    await writeFile(join(dir, "tree.gedcomx.json"), "{not json");
    const badTree = await projectContext({ projectPath: dir });
    expect(badTree.ok).toBe(false);
    if (badTree.ok) return;
    expect(badTree.errors.join(" ")).toMatch(/tree\.gedcomx\.json is not valid JSON/);
  });
});

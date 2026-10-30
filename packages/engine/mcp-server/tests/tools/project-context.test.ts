import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, utimes } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

import { projectContext } from "../../src/tools/project-context.js";
import {
  researchQuery,
  RESEARCH_QUERY_SECTIONS,
  RESEARCH_QUERY_OPTIONAL_SECTIONS,
  EXTERNAL_COLLECTIONS_SECTION,
} from "../../src/tools/research-query.js";
import { readBuildInfo } from "../../src/utils/build-info.js";
import { fileStoreOnly } from "../helpers/store-backend.js";
import { getProjectStore, runWithProjectStore } from "../../src/store/project-store.js";
import { LOCAL, bearerPrincipal } from "../../src/auth/principal.js";
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
    const noFamily = { spouseIds: [], parentIds: [], childIds: [] };
    expect(r.persons).toEqual([
      { id: "I1", name: "William Bottermiller", gender: "Male", sourceRefs: ["S1", "S2"], ...noFamily, diedByYear: 1929 },
      { id: "I2", name: "Mary Bottermiller", gender: "Female", sourceRefs: [], ...noFamily, diedByYear: null },
      { id: "I3", name: null, gender: "Male", sourceRefs: [], ...noFamily, diedByYear: null },
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
    const byId = Object.fromEntries(r.persons.map((p) => [p.id, p]));
    expect(byId.I1).toMatchObject({ spouseIds: ["I2", "I4"], parentIds: [], childIds: ["I3"], diedByYear: null });
    expect(byId.I2).toMatchObject({ spouseIds: ["I1"], parentIds: [], childIds: ["I3"], diedByYear: 1858 });
    expect(byId.I3).toMatchObject({ spouseIds: [], parentIds: ["I1", "I2"], childIds: [], diedByYear: null });
    expect(byId.I4).toMatchObject({ spouseIds: ["I1"], diedByYear: null });
    expect(byId.I5).toMatchObject({ spouseIds: [], parentIds: [], childIds: [], diedByYear: null });
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
    const byId = Object.fromEntries(r.persons.map((p) => [p.id, p.diedByYear]));
    // the latest possible year, never the earliest: a death "Abt 1890" is not before 1891,
    // and one "Bef 1870" can fall in 1869, after an 1865 household
    expect(byId).toEqual({ I1: 1891, I2: 1870, I3: 1874, I4: null, I5: null, I6: null });
  });

  it("returns the objective verbatim and untruncated, and null when absent (#3026)", async () => {
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
    expect(bare.ok && bare.objective).toBeNull();
  });

  it("returns the project's subject person ids, and [] when absent (#3516)", async () => {
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
    expect(bare.ok && bare.subjectPersonIds).toEqual([]);
  });

  it("returns empty arrays for an empty project", async () => {
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
      subjectPersonIds: [],
      narrationGuidance: null,
      subscriptions: [],
      openQuestions: [],
      questionStatuses: [],
      persons: [],
      sources: [],
      localities: [],
      awaitingUser: [],
      // Absent here: an optional section counts 0, a required one is null
      // because research_query would refuse it.
      sectionCounts: Object.fromEntries(
        RESEARCH_QUERY_SECTIONS.filter((s) => s !== EXTERNAL_COLLECTIONS_SECTION).map((s) => [
          s,
          RESEARCH_QUERY_OPTIONAL_SECTIONS.has(s) ? 0 : null,
        ]),
      ),
      unregisteredDisagreementCount: 0,
      exhaustedImageGroups: [],
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
      expect(r.ok && r.exhaustedImageGroups).toEqual([]);
    });

    it("skips a torn line, and lists a film with no browse logged against a plan item", async () => {
      await writeProject({ project: PROJECT }, { persons: [], relationships: [], sources: [] });
      await browseLog(["{not json", ...reads("008230326", 20)]);
      const r = await projectContext({ projectPath: dir }, LOCAL);
      expect(r.ok && r.exhaustedImageGroups).toEqual([{ imageGroup: "008230326", imagesRead: 20, planItemIds: [] }]);
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
      return r.awaitingUser;
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
    const r = await projectContext({ projectPath: dir }, LOCAL);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.projectStatus).toBe("paused");
    expect(r.openQuestions[0].question).toHaveLength(140);
    expect(r.openQuestions[0].question.endsWith("…")).toBe(true);
    expect(r.openQuestions[0].question.startsWith("x".repeat(139))).toBe(true);
    expect(r.openQuestions[1].question).toBe(exact);
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

    const q1 = r.questionStatuses.find((q) => q.id === "q_001");
    // Derived from the proof summary, while the question still says otherwise.
    expect(q1?.state).toBe("concluded");
    expect(q1?.storedStatus).toBe("in_progress");

    const q2 = r.questionStatuses.find((q) => q.id === "q_002");
    expect(q2?.storedStatus).toBeNull();
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
    for (const name of ["census.pdf", "census.pdf.txt", "notes.txt", "b.jpg"]) await upload(name);
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
});

describe("project_context and project_create links", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "project-links-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function contextUnder(store: ScopedFsStore | null, config: Record<string, unknown>) {
    const run = async () => {
      const s = getProjectStore();
      const path = store ? SCOPED_ANCHOR : root;
      await s.writeJson(path, "research.json", EMPTY_RESEARCH);
      await s.writeJson(path, "tree.gedcomx.json", EMPTY_TREE);
      const r = await projectContext({ projectPath: path }, bearerPrincipal("tok", config));
      if (!r.ok) throw new Error(r.errors.join("; "));
      return r;
    };
    return store ? runWithProjectStore(store, run) : run();
  }

  it("returns projectUrl and uploadUrl from the store's project id when both settings are on", async () => {
    const r = await contextUnder(new ScopedFsStore(root, "p-42"), {
      webPublicUrl: "https://beta.example/",
      uploadsEnabled: true,
    });
    expect(r.projectUrl).toBe("https://beta.example/#/p/p-42");
    expect(r.uploadUrl).toBe("https://beta.example/#/p/p-42/upload");
  });

  it("returns projectUrl but no uploadUrl while uploads are off", async () => {
    const off = await contextUnder(new ScopedFsStore(root, "p-42"), { webPublicUrl: "https://beta.example", uploadsEnabled: false });
    expect(off.projectUrl).toBe("https://beta.example/#/p/p-42");
    expect("uploadUrl" in off).toBe(false);
    const unset = await contextUnder(new ScopedFsStore(root, "p-43"), { webPublicUrl: "https://beta.example" });
    expect("uploadUrl" in unset).toBe(false);
  });

  it("returns neither link without the public URL", async () => {
    const r = await contextUnder(new ScopedFsStore(root, "p-42"), { uploadsEnabled: true });
    expect("projectUrl" in r).toBe(false);
    expect("uploadUrl" in r).toBe(false);
  });

  it("returns neither link from a store with no project id, whatever projectPath is", async () => {
    fileStoreOnly("the file store is the one with no project id");
    const r = await contextUnder(null, { webPublicUrl: "https://beta.example", uploadsEnabled: true });
    expect("projectUrl" in r).toBe(false);
    expect("uploadUrl" in r).toBe(false);
  });
});

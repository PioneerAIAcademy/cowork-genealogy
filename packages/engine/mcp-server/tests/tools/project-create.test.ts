import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// The ref build's place retry goes through this resolver; stubbed so the suite
// stays offline. It resolves nothing unless a test says otherwise.
vi.mock("../../src/utils/place-resolver.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/utils/place-resolver.js")>();
  return { ...actual, resolveStandardPlace: vi.fn(async () => null) };
});
import { resolveStandardPlace } from "../../src/utils/place-resolver.js";
import { mkdtemp, writeFile, readFile, rm, access, mkdir } from "fs/promises";
import { realpathSync } from "node:fs";
import { join } from "path";
import { tmpdir } from "os";
import { projectCreate } from "../../src/tools/project-create.js";

/**
 * `project_create` is the only route by which a project comes into existence.
 * Before it, `init-project` held no writer tool and built both documents with a
 * bare `Write` — which the shipped PreToolUse hook denies by basename, with no
 * exemption for a file that does not exist yet. Confirmed live in Cowork: the
 * `Write` was denied, `tree_edit` refused because the files were absent, and the
 * agent then wrote both through `device_bash`, and that write landed.
 *
 * So the cases that matter here are the ones that decide whether that bypass has
 * a sanctioned replacement: does it create BOTH documents, does it refuse to
 * overwrite one that exists, and does a rejected create leave nothing behind.
 */

const SUBJECT = {
  id: "I1",
  gender: "Male",
  names: [{ id: "N1", preferred: true, given: "Patrick", surname: "Flynn" }],
};
const TREE_SOURCE = { id: "S1", title: "FamilySearch Family Tree" };

describe("project_create", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "project-create-test-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const readResearch = async () => JSON.parse(await readFile(join(dir, "research.json"), "utf-8"));
  const readTree = async () =>
    JSON.parse(await readFile(join(dir, "tree.gedcomx.json"), "utf-8"));
  const exists = async (name: string) =>
    access(join(dir, name)).then(
      () => true,
      () => false,
    );

  // ── The headline case ────────────────────────────────────────────────────

  it("refuses a starting tree carrying a forged assertion_id (#2472)", async () => {
    // This tool copies the caller's tree verbatim and the document validator
    // type-checks `assertion_id` without knowing it was forged, so it was the
    // one unguarded fact write path. A forged backlink would persist into BOTH
    // tree.gedcomx.json and the write-once starting-tree baseline, after which
    // research_append rewrites a hand-entered fact from an assertion it never
    // came from. `tree_edit` refuses the same thing on its four paths.
    for (const holderKey of ["persons", "relationships"] as const) {
      const fact = { id: "F1", type: "Birth", date: "1850", assertion_id: "a_011" };
      const tree =
        holderKey === "persons"
          ? { persons: [{ ...SUBJECT, facts: [fact] }], relationships: [], sources: [TREE_SOURCE] }
          : {
              persons: [SUBJECT, { id: "I2", gender: "Female", names: [{ id: "N2", given: "Mary", surname: "Doyle" }] }],
              relationships: [{ id: "R1", type: "Couple", person1: "I1", person2: "I2", facts: [{ ...fact, type: "Marriage" }] }],
              sources: [TREE_SOURCE],
            };

      const r = await projectCreate({
        projectPath: dir,
        objective: "Identify the parents of Patrick Flynn",
        title: "Patrick Flynn's parents",
        subjectPersonIds: ["I1"],
        tree,
      } as never);

      expect(r.ok, holderKey).toBe(false);
      expect(JSON.stringify(r), holderKey).toMatch(/`assertion_id` on a fact of/);
      expect(await exists("tree.gedcomx.json"), holderKey).toBe(false);
      expect(await exists("starting-tree.gedcomx.json"), holderKey).toBe(false);
    }
  });

  it("still accepts a starting tree whose facts carry no backlink", async () => {
    const r = await projectCreate({
      projectPath: dir,
      objective: "Identify the parents of Patrick Flynn",
      title: "Patrick Flynn's parents",
      subjectPersonIds: ["I1"],
      tree: {
        persons: [{ ...SUBJECT, facts: [{ id: "F1", type: "Birth", date: "1850" }] }],
        relationships: [],
        sources: [TREE_SOURCE],
      },
    } as never);
    expect(r.ok).toBe(true);
  });

  it("creates both documents in an empty directory", async () => {
    const r = await projectCreate({
      projectPath: dir,
      objective: "Identify the parents of Patrick Flynn",
      title: "Patrick Flynn's parents",
      subjectPersonIds: ["I1"],
      tree: { persons: [SUBJECT], relationships: [], sources: [TREE_SOURCE] },
    });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.filesWritten).toEqual([
      "tree.gedcomx.json",
      "research.json",
      "starting-tree.gedcomx.json",
    ]);
    expect(r.counts).toEqual({ persons: 1, relationships: 0, sources: 1 });

    const research = await readResearch();
    expect(research.project.objective).toBe("Identify the parents of Patrick Flynn");
    expect(research.project.title).toBe("Patrick Flynn's parents");
    expect(research.project.subject_person_ids).toEqual(["I1"]);
    expect(research.project.id).toBe("rp_001");
    expect(research.project.status).toBe("active");
    expect(research.project.created).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(research.project.updated).toBe(research.project.created);

    const tree = await readTree();
    expect(tree.persons).toHaveLength(1);
    expect(tree.sources[0].id).toBe("S1");
  });

  it("writes a starting-tree.gedcomx.json baseline equal to the opening tree", async () => {
    // The tree-encoding completion gate (issue #1490) diffs the final tree
    // against this baseline. It must be written, and it must equal the opening
    // tree byte-for-byte content — not a re-derived or empty document — or the
    // gate would compare against the wrong starting point.
    await projectCreate({
      projectPath: dir,
      objective: "Identify the parents of Patrick Flynn",
      subjectPersonIds: ["I1"],
      tree: { persons: [SUBJECT], relationships: [], sources: [TREE_SOURCE] },
    });
    expect(await exists("starting-tree.gedcomx.json")).toBe(true);
    const baseline = JSON.parse(
      await readFile(join(dir, "starting-tree.gedcomx.json"), "utf-8"),
    );
    const tree = await readTree();
    expect(baseline).toEqual(tree);
  });

  it("starts every analytical section empty", async () => {
    await projectCreate({ projectPath: dir, objective: "Who were John's parents?" });
    const research = await readResearch();
    for (const section of [
      "questions",
      "plans",
      "log",
      "sources",
      "assertions",
      "person_evidence",
      "conflicts",
      "hypotheses",
      "timelines",
      "proof_summaries",
      "evaluations",
    ]) {
      expect(research[section], `${section} should start empty`).toEqual([]);
    }
  });

  it("writes no researcher_profile and no known_holdings", async () => {
    // Both are written afterwards through research_append, from what the
    // researcher actually said. A project was observed created with an
    // experience level and subscriptions the user was never asked for, and a
    // fabricated profile is indistinguishable downstream from a real one while
    // an absent one falls back to sane defaults everywhere.
    await projectCreate({ projectPath: dir, objective: "Who were John's parents?" });
    const research = await readResearch();
    expect(research.researcher_profile).toBeUndefined();
    expect(research.known_holdings).toBeUndefined();
  });

  it("creates a valid empty tree when none is supplied", async () => {
    const r = await projectCreate({ projectPath: dir, objective: "Who were John's parents?" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.counts).toEqual({ persons: 0, relationships: 0, sources: 0 });
    expect(await readTree()).toEqual({ persons: [], relationships: [], sources: [] });
  });

  // ── Create, never upsert ─────────────────────────────────────────────────

  it("refuses when research.json already exists, and changes nothing", async () => {
    await writeFile(join(dir, "research.json"), '{"project":{"objective":"existing"}}');
    const r = await projectCreate({ projectPath: dir, objective: "a different objective" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/exists in projectPath/);
    // The audit trail this would have destroyed is unreconstructible.
    expect(JSON.parse(await readFile(join(dir, "research.json"), "utf-8")).project.objective).toBe(
      "existing",
    );
    expect(await exists("tree.gedcomx.json")).toBe(false);
  });

  it("refuses a complete existing project, and points at the writer tools", async () => {
    // Both present is the ordinary "this is already a project" case, and there
    // the writers DO work — unlike the half-present case below.
    await writeFile(join(dir, "research.json"), '{"project":{"objective":"existing"}}');
    await writeFile(join(dir, "tree.gedcomx.json"), '{"persons":[],"relationships":[],"sources":[]}');
    const r = await projectCreate({ projectPath: dir, objective: "a different objective" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/already exist in projectPath/);
    expect(r.errors.join(" ")).toMatch(/research_append/);
  });

  it("refuses when only tree.gedcomx.json exists", async () => {
    // The half-present case: a researcher who exported or moved the tree still
    // must not have a create silently overwrite the other half.
    await writeFile(join(dir, "tree.gedcomx.json"), '{"persons":[],"relationships":[],"sources":[]}');
    const r = await projectCreate({ projectPath: dir, objective: "an objective" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/tree\.gedcomx\.json/);
    expect(await exists("research.json")).toBe(false);
  });

  it.each([
    ["research.json", "tree.gedcomx.json"],
    ["tree.gedcomx.json", "research.json"],
  ])(
    "names the MISSING file when only %s is present, and never says delete",
    async (present, missing) => {
      // Measured: with either file alone, project_create, research_append AND
      // tree_edit all refuse — every writer reads both documents. So a refusal
      // that points at the other writers points at another dead end, which is
      // the failure this whole tool exists to remove.
      //
      // And it must not offer "delete the one that survived" as the way out:
      // when that is research.json it is the audit trail, the half nothing can
      // reconstruct.
      const body =
        present === "research.json"
          ? '{"project":{}}'
          : '{"persons":[],"relationships":[],"sources":[]}';
      await writeFile(join(dir, present), body);
      const r = await projectCreate({ projectPath: dir, objective: "an objective" });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      const msg = r.errors.join(" ");
      expect(msg).toContain(missing);
      expect(msg).toMatch(/restore/i);
      expect(msg).not.toMatch(/use research_append and the tree tools/);
      expect(msg).not.toMatch(/^(?!.*Do not delete).*\bdelete\b.*$/);
      expect(await exists(missing)).toBe(false);
    },
  );

  // ── A project cannot nest inside another (issue #1869) ──────────────────

  it("refuses when an ancestor directory already holds a project, naming it, and writes NEITHER file", async () => {
    fileStoreOnly("projects do not nest in Postgres: findNestingAncestor is always null there");
    // The viewer watches one folder; a project created one level down inside
    // an existing project reads to a tester as lost files between sessions
    // (issue #1317 bug 2). This is the durable fix: refuse at create time.
    await writeFile(join(dir, "research.json"), '{"project":{"objective":"existing"}}');
    await writeFile(join(dir, "tree.gedcomx.json"), '{"persons":[],"relationships":[],"sources":[]}');
    const sub = join(dir, "sub-project");
    const r = await projectCreate({ projectPath: sub, objective: "a nested objective" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const msg = r.errors.join(" ");
    expect(msg).toContain(realpathSync.native(dir));
    expect(msg).toMatch(/already a research project/);
    expect(msg).toMatch(/cannot be nested/);
    expect(msg).toMatch(/research_append/);
    expect(await exists("research.json")).toBe(true); // the ANCESTOR's file, untouched
    await expect(access(join(sub, "research.json"))).rejects.toThrow();
    await expect(access(join(sub, "tree.gedcomx.json"))).rejects.toThrow();
  });

  it("refuses several levels down too, naming the nearest ancestor", async () => {
    fileStoreOnly("projects do not nest in Postgres: findNestingAncestor is always null there");
    await writeFile(join(dir, "research.json"), '{"project":{"objective":"existing"}}');
    await writeFile(join(dir, "tree.gedcomx.json"), '{"persons":[],"relationships":[],"sources":[]}');
    const deep = join(dir, "a", "b", "c");
    const r = await projectCreate({ projectPath: deep, objective: "a nested objective" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/already a research project/);
    await expect(access(join(deep, "research.json"))).rejects.toThrow();
  });

  it("a half-present project still gets its OWN message, not the nesting one", async () => {
    // The ancestor check runs after the two exists-refusals, so a half-present
    // project at projectPath itself keeps its own, more actionable message
    // even when ITS OWN parent also happens to hold a project.
    await writeFile(join(dir, "research.json"), '{"project":{"objective":"outer"}}');
    await writeFile(join(dir, "tree.gedcomx.json"), '{"persons":[],"relationships":[],"sources":[]}');
    const sub = join(dir, "sub-project");
    await mkdir(sub, { recursive: true });
    await writeFile(join(sub, "tree.gedcomx.json"), '{"persons":[],"relationships":[],"sources":[]}');
    const r = await projectCreate({ projectPath: sub, objective: "a nested objective" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const msg = r.errors.join(" ");
    expect(msg).toMatch(/research\.json/);
    expect(msg).toMatch(/restore/i);
    expect(msg).not.toMatch(/already a research project/);
  });

  it("a sibling project — nobody's descendant — is unaffected", async () => {
    const first = join(dir, "project-a");
    const second = join(dir, "project-b");
    await mkdir(first, { recursive: true });
    const r1 = await projectCreate({ projectPath: first, objective: "first project" });
    expect(r1.ok).toBe(true);

    const r2 = await projectCreate({ projectPath: second, objective: "second project" });
    expect(r2.ok).toBe(true);
  });

  // ── An objective is not optional ─────────────────────────────────────────

  it.each([
    ["absent", undefined],
    ["empty", ""],
    ["whitespace", "   "],
  ])("refuses a %s objective and writes nothing", async (_label, objective) => {
    const r = await projectCreate({ projectPath: dir, objective: objective as string });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/objective is required/);
    expect(await exists("research.json")).toBe(false);
    expect(await exists("tree.gedcomx.json")).toBe(false);
  });

  it("trims the objective it stores", async () => {
    await projectCreate({ projectPath: dir, objective: "  Who were John's parents?  " });
    expect((await readResearch()).project.objective).toBe("Who were John's parents?");
  });

  // ── The pair is validated together ───────────────────────────────────────

  it("refuses a subject person the tree does not contain, and writes NEITHER file", async () => {
    // This is why the tool takes the tree rather than creating an empty one and
    // leaving the caller to add persons afterwards: a dangling
    // subject_person_ids is a hard validator error, so a header-first create
    // would impose an ordering constraint that has to be got right every time.
    const r = await projectCreate({
      projectPath: dir,
      objective: "Identify the parents of Patrick Flynn",
      subjectPersonIds: ["I9"],
      tree: { persons: [SUBJECT], relationships: [], sources: [TREE_SOURCE] },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/I9/);
    expect(await exists("research.json")).toBe(false);
    expect(await exists("tree.gedcomx.json")).toBe(false);
  });

  it("refuses a malformed tree, and writes NEITHER file", async () => {
    const r = await projectCreate({
      projectPath: dir,
      objective: "Identify the parents of Patrick Flynn",
      tree: { persons: [{ id: "I1", gender: "Martian" }], relationships: [], sources: [] },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(await exists("research.json")).toBe(false);
    expect(await exists("tree.gedcomx.json")).toBe(false);
  });

  it("accepts a subject person that IS in the tree", async () => {
    const r = await projectCreate({
      projectPath: dir,
      objective: "Identify the parents of Patrick Flynn",
      subjectPersonIds: ["I1"],
      tree: { persons: [SUBJECT], relationships: [], sources: [TREE_SOURCE] },
    });
    expect(r.ok).toBe(true);
  });

  // ── Argument hygiene ─────────────────────────────────────────────────────

  it("omits title when none is given rather than writing an empty one", async () => {
    await projectCreate({ projectPath: dir, objective: "Who were John's parents?" });
    expect((await readResearch()).project.title).toBeUndefined();
  });

  it("defaults subject_person_ids to an empty array", async () => {
    // Empty, not absent: the schema types it as an array, and the set-once
    // predicate on research_append treats [] as unset, so it stays fillable.
    await projectCreate({ projectPath: dir, objective: "Who were John's parents?" });
    expect((await readResearch()).project.subject_person_ids).toEqual([]);
  });

  it("requires a projectPath", async () => {
    const r = await projectCreate({ projectPath: "", objective: "an objective" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/projectPath is required/);
  });
});

// ─── Stage B (#2944): the tree built host-side from a staged person_read ───

import { readFileSync } from "node:fs";
import { stagePersonRead } from "../../src/tools/person-read.js";
import { fileStoreOnly } from "../helpers/store-backend.js";

const FAMILY = JSON.parse(
  readFileSync(
    join(__dirname, "../../../../../eval/fixtures/mcp/person-read-flynn-family.json"),
    "utf-8",
  ),
).response;

describe("project_create — personReadRef (#2944 Stage B)", () => {
  let dir: string;
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-01T12:00:00Z"));
    dir = await mkdtemp(join(tmpdir(), "project-create-ref-"));
  });
  afterEach(async () => {
    vi.useRealTimers();
    await rm(dir, { recursive: true, force: true });
  });
  const readJson = async (name: string) => JSON.parse(await readFile(join(dir, name), "utf-8"));

  /** Stage the family fixture the way person_read does. The requested id is a
   *  merged-away one (a redirect), and the story memory carries an image_ref. */
  async function stageFamily(): Promise<string> {
    const result = structuredClone(FAMILY);
    result.sources.find((s: { id: string }) => s.id === "228755097").image_ref = "images/228755097.jpg";
    const { staged } = await stagePersonRead({
      projectPath: dir,
      input: { personId: "OLDX-001" },
      resolvedId: "LZNY-BRF",
      result,
    });
    return staged!.resultsRef;
  }

  const STUB = { id: "A1", gender: "Unknown", names: [{ given: "", surname: "Kelly" }] };
  const src = (id: string) => FAMILY.sources.find((s: { id: string }) => s.id === id);
  const FS = { ref: "S1", quality: 1 };
  const fact = (id: string, f: Record<string, unknown>) => ({ id, ...f, sources: [FS] });

  it("builds the starting tree from a staged person_read", async () => {
    const ref = await stageFamily();
    const result: any = await projectCreate({ projectPath: dir, objective: "Find Patrick's parents", personReadRef: ref });
    expect(result.ok).toBe(true);

    const expected = {
      persons: [
        {
          id: "I1", ark: "ark:/61903/4:1:LZNY-BRF", gender: "Male", living: false,
          names: [{ id: "N1", preferred: true, given: "Patrick", surname: "Flynn" }],
          facts: [
            fact("F1", { type: "Birth", date: "~1845", standard_date: "Abt 1845", place: "Ireland", standard_place: "Ireland" }),
            fact("F2", { type: "Death", date: "1908", standard_date: "1908", place: "Schuylkill County, Pennsylvania, United States", standard_place: "Schuylkill, Pennsylvania, United States" }),
          ],
        },
        {
          id: "I2", ark: "ark:/61903/4:1:LZNY-K2M", gender: "Female", living: false,
          names: [{ id: "N2", preferred: true, given: "Mary", surname: "Kelly" }],
          facts: [fact("F3", { type: "Birth", date: "1849", standard_date: "1849", place: "Ireland", standard_place: "Ireland" })],
        },
        {
          id: "I3", ark: "ark:/61903/4:1:LZNY-P7Q", gender: "Male", living: false,
          names: [{ id: "N3", preferred: true, given: "James", surname: "Flynn" }],
          facts: [fact("F4", { type: "Birth", date: "1871", standard_date: "1871", place: "Branch Township, Schuylkill County, Pennsylvania, United States", standard_place: "Branch, Schuylkill, Pennsylvania, United States" })],
        },
        {
          id: "I4", ark: "ark:/61903/4:1:LZNY-R4T", gender: "Female", living: false,
          names: [{ id: "N4", preferred: true, given: "Margaret", surname: "Flynn" }],
          facts: [fact("F5", { type: "Birth", date: "1874", standard_date: "1874", place: "Branch Township, Schuylkill County, Pennsylvania, United States", standard_place: "Branch, Schuylkill, Pennsylvania, United States" })],
        },
        {
          id: "I5", ark: "ark:/61903/4:1:LZNY-M3F", gender: "Male", living: false,
          names: [{ id: "N5", preferred: true, given: "Michael", surname: "Flynn" }],
          facts: [fact("F6", { type: "Birth", date: "~1815", standard_date: "Abt 1815", place: "Ireland", standard_place: "Ireland" })],
        },
        {
          id: "I6", ark: "ark:/61903/4:1:LZNY-B8S", gender: "Female", living: false,
          names: [{ id: "N6", preferred: true, given: "Bridget", surname: "Flynn" }],
          facts: [fact("F7", { type: "Birth", date: "1848", standard_date: "1848", place: "Ireland", standard_place: "Ireland" })],
        },
      ],
      relationships: [
        {
          id: "R1", type: "Couple", person1: "I1", person2: "I2", sources: [FS],
          facts: [fact("F8", { type: "Marriage", date: "1869", standard_date: "1869", place: "Schuylkill County, Pennsylvania, United States", standard_place: "Schuylkill, Pennsylvania, United States" })],
        },
        { id: "R2", type: "ParentChild", parent: "I1", child: "I3", subtype: "Biological", sources: [FS] },
        { id: "R3", type: "ParentChild", parent: "I2", child: "I3", subtype: "Biological", sources: [FS] },
        { id: "R4", type: "ParentChild", parent: "I1", child: "I4", subtype: "Biological", sources: [FS] },
        { id: "R5", type: "ParentChild", parent: "I2", child: "I4", subtype: "Biological", sources: [FS] },
        { id: "R6", type: "ParentChild", parent: "I5", child: "I1", subtype: "Biological", sources: [FS] },
        { id: "R7", type: "ParentChild", parent: "I5", child: "I6", subtype: "Biological", sources: [FS] },
      ],
      sources: [
        {
          id: "S1",
          title: "FamilySearch Family Tree (read from Patrick Flynn, LZNY-BRF)",
          citation: "FamilySearch Family Tree (https://www.familysearch.org/tree : accessed 1 October 2026), read from the page of Patrick Flynn (LZNY-BRF).",
          url: "https://www.familysearch.org/tree",
        },
        { id: "S2", title: src("MMM9-1QF").title, citation: src("MMM9-1QF").citation, url: src("MMM9-1QF").url },
        // notes, text, image_ref and artifact_url are response-only: dropped.
        { id: "S3", title: src("MMM9-7RB").title, url: src("MMM9-7RB").url },
        { id: "S4", title: src("228755097").title, url: src("228755097").url },
        { id: "S5", title: src("175960782").title, url: src("175960782").url },
      ],
    };
    // The top-level `notes` the read carried is gone too.
    expect(await readJson("tree.gedcomx.json")).toEqual(expected);
    expect(await readJson("starting-tree.gedcomx.json")).toEqual(expected);
    const research = await readJson("research.json");
    expect(research.project.subject_person_ids).toEqual(["I1"]);
    expect(result.idMap).toEqual({
      persons: {
        "LZNY-BRF": "I1", "OLDX-001": "I1", "LZNY-K2M": "I2", "LZNY-P7Q": "I3",
        "LZNY-R4T": "I4", "LZNY-M3F": "I5", "LZNY-B8S": "I6",
      },
      sources: { "MMM9-1QF": "S2", "MMM9-7RB": "S3", "228755097": "S4", "175960782": "S5" },
      additions: {},
      familySearchTreeSource: "S1",
    });
  });

  it("cites every relative's facts to a FamilySearch-tree source that names no one person's page", async () => {
    const ref = await stageFamily();
    const result: any = await projectCreate({ projectPath: dir, objective: "x", personReadRef: ref });
    expect(result.ok).toBe(true);
    expect(result.placesFilled).toBeUndefined();
    const tree = await readJson("tree.gedcomx.json");
    const s1 = tree.sources.find((s: any) => s.id === "S1");
    expect(s1.url).toBe("https://www.familysearch.org/tree");
    expect(s1.citation).not.toMatch(/tree\/person\/details/);
    const relative = tree.persons.find((p: any) => p.ark === "ark:/61903/4:1:LZNY-K2M");
    expect(relative.facts.every((f: any) => f.sources.some((r: any) => r.ref === "S1"))).toBe(true);
  });

  it("maps a subjectPersonIds PID, including the merged-away requested id", async () => {
    const ref = await stageFamily();
    for (const pid of ["LZNY-BRF", "OLDX-001"]) {
      await rm(join(dir, "research.json"), { force: true });
      await rm(join(dir, "tree.gedcomx.json"), { force: true });
      const result: any = await projectCreate({ projectPath: dir, objective: "x", personReadRef: ref, subjectPersonIds: [pid] });
      expect(result.ok).toBe(true);
      expect((await readJson("research.json")).project.subject_person_ids).toEqual(["I1"]);
    }
  });

  it("a stub addition naming a staged person by PID lands in the tree and the starting baseline", async () => {
    const ref = await stageFamily();
    // Mary Kelly's parent, implied by her stated maiden name. Labels only.
    const result: any = await projectCreate({
      projectPath: dir,
      objective: "Find Mary Kelly's parents",
      personReadRef: ref,
      tree: {
        persons: [{ id: "I1", gender: "Unknown", names: [{ given: "", surname: "Kelly" }] }],
        relationships: [{ type: "ParentChild", parent: "I1", child: "LZNY-K2M" }],
      },
    });
    expect(result.ok).toBe(true);
    // The label "I1" is NOT staged I1 (Patrick): it is re-minted after the staged ids.
    expect(result.idMap.additions).toEqual({ I1: "I7" });
    expect(result.idMap.statementSource).toBe("S6");
    for (const name of ["tree.gedcomx.json", "starting-tree.gedcomx.json"]) {
      const tree = await readJson(name);
      expect(tree.persons.find((p: any) => p.id === "I7")).toEqual({
        id: "I7", gender: "Unknown", names: [{ id: "N7", given: "", surname: "Kelly" }],
      });
      expect(tree.relationships.find((r: any) => r.id === "R8")).toEqual({
        id: "R8", type: "ParentChild", parent: "I7", child: "I2", sources: [{ ref: "S6", quality: 1 }],
      });
      expect(tree.sources.find((s: any) => s.id === "S6")).toEqual({
        id: "S6", title: "Researcher's statement",
        citation: "Statement by the researcher when the project was created, 1 October 2026.",
      });
    }
  });

  it.each([
    ["an I-shaped id that is not one of its own labels", { relationships: [{ type: "ParentChild", parent: "I2", child: "LZNY-K2M" }] }, /neither a FamilySearch ID/],
    ["an addition person whose id is a staged PID", { persons: [{ id: "LZNY-K2M", gender: "Female", names: [{ given: "M", surname: "K" }] }] }, /already in the staged read/],
    ["a ref to a source that is neither a label nor staged", { persons: [{ id: "A1", gender: "Unknown", names: [{ given: "", surname: "Kelly" }], facts: [{ type: "Birth", sources: [{ ref: "S2" }] }] }] }, /cites source "S2"/],
    ["a staged person re-added under a label (it carries an ark)", { persons: [{ id: "A1", ark: "ark:/61903/4:1:LZNY-K2M", gender: "Female", names: [{ given: "Mary", surname: "Kelly" }] }] }, /carries the ark of LZNY-K2M/],
    [
      "the whole read copied in as additions, re-id'd as I1..I6",
      {
        persons: FAMILY.persons.map((p: any, i: number) => ({ ...p, id: `I${i + 1}` })),
        relationships: [{ type: "ParentChild", parent: "I1", child: "I3" }],
      },
      /carries the ark of LZNY-BRF/,
    ],
    [
      "a label used twice",
      {
        persons: [
          { id: "A1", gender: "Unknown", names: [{ given: "", surname: "Kelly" }] },
          { id: "A1", gender: "Unknown", names: [{ given: "", surname: "Doyle" }] },
        ],
      },
      /label "A1" is used twice/,
    ],
    [
      "a source label used twice",
      { sources: [{ id: "X1", title: "a" }, { id: "X1", title: "b" }] },
      /source label "X1" is used twice/,
    ],
    ["a source label that is a staged FamilySearch source id", { sources: [{ id: "228755097", title: "dup" }] }, /FamilySearch source already in the staged read/],
    ["a staged relationship repeated", { relationships: [{ type: "ParentChild", parent: "LZNY-BRF", child: "LZNY-P7Q" }] }, /repeats a relationship already in the tree/],
    ["a staged Couple repeated with its endpoints swapped and lower-cased", { relationships: [{ type: "Couple", person1: "lzny-k2m", person2: "LZNY-BRF" }] }, /repeats a relationship already in the tree/],
    ["a staged person's ark in another spelling", { persons: [{ ...{ id: "A1", gender: "Unknown", names: [{ given: "", surname: "Kelly" }] }, ark: " https://www.familysearch.org/ark:/61903/4:1:lzny-k2m?lang=en" }] }, /carries the ark of lzny-k2m/],
    ["a label that is a staged PID in lower case", { persons: [{ ...{ id: "A1", gender: "Unknown", names: [{ given: "", surname: "Kelly" }] }, id: "lzny-k2m" }] }, /already in the staged read/],
    ["an endpoint that is an Object prototype key", { relationships: [{ type: "ParentChild", parent: "constructor", child: "LZNY-K2M" }] }, /neither a FamilySearch ID/],
    ["a source ref that is an Object prototype key", { persons: [{ ...{ id: "A1", gender: "Unknown", names: [{ given: "", surname: "Kelly" }] }, facts: [{ type: "Birth", sources: [{ ref: "toString" }] }] }] }, /cites source "toString"/],
  ])("refuses %s, writing nothing", async (_label, tree, message) => {
    const ref = await stageFamily();
    const result: any = await projectCreate({ projectPath: dir, objective: "x", personReadRef: ref, tree: tree as any });
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(message);
    expect(await exists("tree.gedcomx.json")).toBe(false);
    expect(await exists("research.json")).toBe(false);
  });

  it("accepts a Step parent beside a staged Biological one on the same pair", async () => {
    // The repeat refusal above asks "is this relationship already here", which
    // `relationshipMatches` answers: an untyped edge restating a staged
    // Biological one IS a repeat, a Step edge beside it is a second
    // relationship. Before the shared predicate replaced this file's private
    // type-and-endpoints key, the two collided and this threw "repeats a
    // relationship already in the tree".
    const ref = await stageFamily();
    const result: any = await projectCreate({
      projectPath: dir,
      objective: "x",
      personReadRef: ref,
      tree: {
        relationships: [
          { type: "ParentChild", parent: "LZNY-BRF", child: "LZNY-P7Q", subtype: "Step" },
        ],
      } as any,
    });
    expect(result.ok).toBe(true);
    const tree: any = await readJson("tree.gedcomx.json");
    // Endpoints are remapped to tree-local ids during the build, so find the
    // Step edge and check its own pair, rather than naming FamilySearch PIDs.
    const step = tree.relationships.find((r: any) => r.subtype === "Step");
    expect(step).toBeDefined();
    const onThePair = tree.relationships.filter(
      (r: any) => r.type === "ParentChild" && r.parent === step.parent && r.child === step.child,
    );
    expect(onThePair.map((r: any) => r.subtype).sort()).toEqual(["Biological", "Step"]);
  });

  it.each([
    ["a fact citation given as a bare string", { persons: [{ ...STUB, facts: [{ type: "Birth", sources: ["228755097"] }] }] }, /sources must be an array of objects/],
    ["a fact citation given as one object, not an array", { persons: [{ ...STUB, facts: [{ type: "Birth", sources: { ref: "228755097" } }] }] }, /sources must be an array of objects/],
    ["a relationship citation given as a string", { relationships: [{ type: "ParentChild", parent: "A1", child: "LZNY-K2M", sources: "228755097" }], persons: [STUB] }, /sources must be an array of objects/],
    ["facts given as an object", { persons: [{ ...STUB, facts: { type: "Birth" } }] }, /facts must be an array of objects/],
    ["persons given as an object", { persons: STUB }, /tree\.persons must be an array of objects/],
    ["a staged person's tree URL as an addition's ark", { persons: [{ ...STUB, ark: "https://www.familysearch.org/tree/person/details/LZNY-K2M" }] }, /carries the ark of LZNY-K2M/],
    ["a staged person's tree URL with a page segment", { persons: [{ ...STUB, ark: "https://www.familysearch.org/en/tree/person/sources/LZNY-K2M?x=1" }] }, /carries the ark of LZNY-K2M/],
    ["a staged person's percent-encoded ark", { persons: [{ ...STUB, ark: "ark:/61903/4%3A1%3ALZNY-K2M" }] }, /carries the ark of LZNY-K2M/],
    ["a staged person's percent-encoded ark with a stray %", { persons: [{ ...STUB, ark: "ark:/61903/4%3A1%3ALZNY-K2M%" }] }, /carries the ark of LZNY-K2M/],
    ["a staged person's pedigree URL", { persons: [{ ...STUB, ark: "https://www.familysearch.org/tree/pedigree/landscape/LZNY-K2M" }] }, /carries the ark of LZNY-K2M/],
    ["a staged person's upper-case ARK", { persons: [{ ...STUB, ark: "ARK:/61903/4:1:LZNY-K2M" }] }, /carries the ark of LZNY-K2M/],
    ["a staged person's URL with a two-part locale and a port", { persons: [{ ...STUB, ark: "https://www.familysearch.org:443/en-US/tree/person/details/LZNY-K2M" }] }, /carries the ark of LZNY-K2M/],
    ["a staged person's URL with a stray % after the PID", { persons: [{ ...STUB, ark: "https://www.familysearch.org/tree/person/details/LZNY-K2M%" }] }, /carries the ark of LZNY-K2M/],
    ["two additions carrying one non-staged ark", { persons: [{ ...STUB, ark: "ark:/61903/4:1:ZZZZ-999" }, { ...STUB, id: "A2", ark: "ark:/61903/4:1:ZZZZ-999" }] }, /carry the ark of the same person/],
    ["an addition source with a field the tree does not allow", { sources: [{ id: "X1", title: "t", bogus: 1 }] }, /bogus/],
  ])("refuses %s rather than dropping it", async (_label, tree, message) => {
    const ref = await stageFamily();
    const result: any = await projectCreate({ projectPath: dir, objective: "x", personReadRef: ref, tree: tree as any });
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(message);
    expect(await exists("tree.gedcomx.json")).toBe(false);
  });

  it("remaps an addition's name-level sources like its fact sources", async () => {
    const ref = await stageFamily();
    const result: any = await projectCreate({
      projectPath: dir, objective: "x", personReadRef: ref,
      tree: {
        persons: [{ ...STUB, names: [{ given: "", surname: "Kelly", sources: [{ ref: "obit" }, { ref: "228755097" }] }] }],
        sources: [{ id: "obit", title: "Obituary of Mary Flynn" }],
      },
    });
    expect(result.ok).toBe(true);
    const person = (await readJson("tree.gedcomx.json")).persons.find((p: any) => p.id === "I7");
    expect(person.names[0].sources).toEqual([{ ref: "S6" }, { ref: result.idMap.sources["228755097"] }]);
  });

  it.each([
    ["a tree URL whose query names a staged ark", "https://www.familysearch.org/tree/person/details/NEWP-ERS?from=4:1:LZNY-K2M"],
    ["a 4:1: substring inside unrelated text", "note 14:1:LZNY-K2M"],
    ["a record ark whose query names a staged tree ark", "https://www.familysearch.org/ark:/61903/1:1:QVJ5-ABCD?treeref=ark:/61903/4:1:LZNY-K2M"],
  ])("does not read %s as a staged person", async (_l, ark) => {
    const ref = await stageFamily();
    const result: any = await projectCreate({ projectPath: dir, objective: "x", personReadRef: ref, tree: { persons: [{ ...STUB, ark }] } });
    expect(result.errors?.join(" ") ?? "").not.toMatch(/carries the ark of LZNY-K2M/);
  });

  it("does not read two non-FamilySearch URLs as one tree person", async () => {
    const ref = await stageFamily();
    const ark = "https://example.com/tree/person/john-doe";
    const result: any = await projectCreate({
      projectPath: dir, objective: "x", personReadRef: ref,
      tree: { persons: [{ ...STUB, ark }, { ...STUB, id: "A2", ark }] },
    });
    expect(result.errors?.join(" ") ?? "").not.toMatch(/same person/);
  });

  it("does not treat a record-persona ark on an addition as a staged tree person", async () => {
    const ref = await stageFamily();
    const result: any = await projectCreate({
      projectPath: dir, objective: "x", personReadRef: ref,
      tree: { persons: [{ ...STUB, ark: "ark:/61903/1:1:LZNY-K2M" }] },
    });
    expect(result.errors?.join(" ") ?? "").not.toMatch(/carries the ark/);
  });

  it("names the addition label in a refusal raised after the build", async () => {
    const ref = await stageFamily();
    const forged: any = await projectCreate({
      projectPath: dir, objective: "x", personReadRef: ref,
      tree: { persons: [{ ...STUB, id: "d", facts: [{ type: "Birth", assertion_id: "as_1" }] }] },
    });
    expect(forged.errors.join(" ")).toMatch(/I7 \(addition "d"\)/);
    const invalid: any = await projectCreate({
      projectPath: dir, objective: "x", personReadRef: ref,
      tree: { persons: [{ ...STUB, id: "d", gender: "Robot" }] },
    });
    expect(invalid.ok).toBe(false);
    expect(invalid.errors.join(" ")).toMatch(/addition "d" is I7, persons\[6\]/);
    const quoted: any = await projectCreate({
      projectPath: dir, objective: "x", personReadRef: ref,
      tree: { persons: [{ ...STUB, id: 'He said "x"', gender: "Robot" }] },
    });
    expect(quoted.errors.join(" ")).toContain('addition "He said \\"x\\"" is I7');
    const onRel: any = await projectCreate({
      projectPath: dir, objective: "x", personReadRef: ref,
      tree: {
        persons: [STUB],
        relationships: [{ type: "ParentChild", parent: "A1", child: "LZNY-K2M", facts: [{ type: "Adoption", assertion_id: "as_1" }] }],
      },
    });
    expect(onRel.errors.join(" ")).toMatch(/R8 \(ParentChild, parent I7 \(addition "A1"\), child I2\)/);
    expect(onRel.errors.join(" ")).toMatch(/addition "A1" is I7, persons\[6\]/);
  });

  it("refuses rather than overwrites when another create lands while places are filled", async () => {
    const resolver = vi.mocked(resolveStandardPlace);
    const result = structuredClone(FAMILY);
    delete result.persons[0].facts.find((f: any) => f.standard_place).standard_place;
    const { staged } = await stagePersonRead({ projectPath: dir, input: { personId: "LZNY-BRF" }, result });
    resolver.mockImplementation(async () => {
      await writeFile(join(dir, "research.json"), "{\"other\": true}");
      return "Filled, Place";
    });
    try {
      const raced: any = await projectCreate({ projectPath: dir, objective: "x", personReadRef: staged!.resultsRef });
      expect(raced.ok).toBe(false);
      expect(raced.errors.join(" ")).toMatch(/appeared in projectPath/);
      expect(await readFile(join(dir, "research.json"), "utf-8")).toBe("{\"other\": true}");
      expect(await exists("tree.gedcomx.json")).toBe(false);
    } finally {
      resolver.mockImplementation(async () => null);
    }
  });

  it("fills an unresolved read place, and only after every refusal has passed", async () => {
    const resolver = vi.mocked(resolveStandardPlace);
    const result = structuredClone(FAMILY);
    const fact = result.persons[0].facts.find((f: any) => f.standard_place);
    delete fact.standard_place;
    const { staged } = await stagePersonRead({ projectPath: dir, input: { personId: "LZNY-BRF" }, result });
    resolver.mockClear();
    resolver.mockImplementation(async () => "Filled, Place");
    try {
      for (const tree of [
        { persons: [{ ...STUB, facts: [{ type: "Birth", assertion_id: "as_1" }] }] },
        { persons: [{ ...STUB, gender: "Robot" }] },
      ]) {
        const refused: any = await projectCreate({ projectPath: dir, objective: "x", personReadRef: staged!.resultsRef, tree: tree as any });
        expect(refused.ok).toBe(false);
      }
      expect(resolver).not.toHaveBeenCalled();
      const ok: any = await projectCreate({ projectPath: dir, objective: "x", personReadRef: staged!.resultsRef });
      expect(ok.ok).toBe(true);
      expect(resolver).toHaveBeenCalled();
      const written = (await readJson("tree.gedcomx.json")).persons[0].facts.find((f: any) => f.type === fact.type && f.place === fact.place);
      expect(written.standard_place).toBe("Filled, Place");
      expect(ok.placesFilled).toEqual([{ place: fact.place, standardPlace: "Filled, Place" }]);
    } finally {
      resolver.mockImplementation(async () => null);
    }
  });

  it("keeps the ark of an addition the read does not hold (a second person_read)", async () => {
    const ref = await stageFamily();
    const result: any = await projectCreate({
      projectPath: dir, objective: "x", personReadRef: ref,
      tree: {
        persons: [{ id: "A1", ark: "ark:/61903/4:1:ZZZZ-999", gender: "Male", names: [{ given: "Owen", surname: "Kelly" }] }],
        relationships: [{ type: "ParentChild", parent: "A1", child: "LZNY-K2M" }],
      },
    });
    expect(result.ok).toBe(true);
    const tree = await readJson("tree.gedcomx.json");
    expect(tree.persons.find((p: any) => p.id === "I7").ark).toBe("ark:/61903/4:1:ZZZZ-999");
  });

  it("matches the subject case-insensitively, and refuses a read that does not hold it", async () => {
    const result = structuredClone(FAMILY);
    const lower = await stagePersonRead({ projectPath: dir, input: { personId: "lzny-brf" }, result });
    const ok: any = await projectCreate({ projectPath: dir, objective: "x", personReadRef: lower.staged!.resultsRef });
    expect(ok.ok).toBe(true);
    const tree = await readJson("tree.gedcomx.json");
    expect(tree.persons[0]).toMatchObject({ id: "I1", ark: "ark:/61903/4:1:LZNY-BRF" });
    expect(tree.sources[0].title).toBe("FamilySearch Family Tree (read from Patrick Flynn, LZNY-BRF)");
    expect((await readJson("research.json")).project.subject_person_ids).toEqual(["I1"]);

    const other = await mkdtemp(join(tmpdir(), "project-create-nosubj-"));
    try {
      const wrong = await stagePersonRead({ projectPath: other, input: { personId: "ZZZZ-999" }, result });
      const refused: any = await projectCreate({ projectPath: other, objective: "x", personReadRef: wrong.staged!.resultsRef });
      expect(refused.ok).toBe(false);
      expect(refused.errors.join(" ")).toMatch(/holds no person "ZZZZ-999"/);
    } finally {
      await rm(other, { recursive: true, force: true });
    }
  });

  it("maps a lower-case subjectPersonIds PID, and links an addition to a lower-case staged PID", async () => {
    const ref = await stageFamily();
    const result: any = await projectCreate({
      projectPath: dir, objective: "x", personReadRef: ref, subjectPersonIds: [" lzny-brf "],
      tree: { persons: [{ id: "A1", gender: "Unknown", names: [{ given: "", surname: "Kelly" }] }], relationships: [{ type: "ParentChild", parent: "A1", child: "lzny-k2m" }] },
    });
    expect(result.ok).toBe(true);
    expect((await readJson("research.json")).project.subject_person_ids).toEqual(["I1"]);
    expect((await readJson("tree.gedcomx.json")).relationships.at(-1)).toMatchObject({ parent: "I7", child: "I2" });
  });

  it("accepts a ref with surrounding whitespace", async () => {
    const ref = await stageFamily();
    const result: any = await projectCreate({ projectPath: dir, objective: "x", personReadRef: ` ${ref}\n` });
    expect(result.ok).toBe(true);
  });

  it("refuses a subjectPersonIds entry that names neither a staged PID nor an addition", async () => {
    const ref = await stageFamily();
    const result: any = await projectCreate({ projectPath: dir, objective: "x", personReadRef: ref, subjectPersonIds: ["I2"] });
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/subjectPersonIds entry "I2"/);
  });

  it("refuses an assertion_id on an addition's fact", async () => {
    const ref = await stageFamily();
    const result: any = await projectCreate({
      projectPath: dir, objective: "x", personReadRef: ref,
      tree: { persons: [{ id: "A1", gender: "Unknown", names: [{ given: "", surname: "Kelly" }], facts: [{ type: "Birth", assertion_id: "a_001" }] }] },
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/assertion_id/);
  });

  it.each([
    ["missing", "results/.staging/nope.json", /not a staged read/],
    ["outside staging", "results/x.json", /is not under results\/\.staging/],
    ["a traversal", "../../etc/passwd", /is not under results\/\.staging/],
    ["blank", "  ", /must be the staged\.resultsRef/],
    ["invalid-JSON", "results/.staging/bad.json", /exists but holds invalid JSON/],
  ])("refuses a %s personReadRef in project_create terms, writing nothing", async (_l, ref, message) => {
    if (ref.endsWith("bad.json")) {
      await mkdir(join(dir, "results", ".staging"), { recursive: true });
      await writeFile(join(dir, "results", ".staging", "bad.json"), "{ not json");
    }
    const result: any = await projectCreate({ projectPath: dir, objective: "x", personReadRef: ref });
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(message);
    expect(result.errors.join(" ")).toMatch(/call person_read again/);
    expect(result.errors.join(" ")).not.toMatch(/research_log_append|stagedResultsRef/);
    expect(await exists("research.json")).toBe(false);
  });

  it("names a read fault on a ref that exists, rather than calling it pruned", async () => {
    fileStoreOnly("a directory where a staged file belongs has no Postgres meaning");
    await mkdir(join(dir, "results", ".staging", "adir.json"), { recursive: true });
    const result: any = await projectCreate({ projectPath: dir, objective: "x", personReadRef: "results/.staging/adir.json" });
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/exists but could not be read/);
    expect(result.errors.join(" ")).not.toMatch(/pruned/);
  });

  it("refuses a ref staged by another tool", async () => {
    const { stageSearchResults } = await import("../../src/utils/results-staging.js");
    const h = await stageSearchResults({ projectPath: dir, tool: "record_read", response: { results: [{ recordId: "X", gedcomx: {} }] } });
    const result: any = await projectCreate({ projectPath: dir, objective: "x", personReadRef: h!.resultsRef });
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/was not staged by person_read/);
  });

  const exists = async (name: string) =>
    access(join(dir, name)).then(() => true, () => false);
});

describe("project_create — hand-built tree (no personReadRef)", () => {
  let dir: string;
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-01T12:00:00Z"));
    dir = await mkdtemp(join(tmpdir(), "project-create-hand-"));
  });
  afterEach(async () => {
    vi.useRealTimers();
    await rm(dir, { recursive: true, force: true });
  });

  it.each([
    ["a non-object person entry", { persons: ["I1"] }, /persons\[0\]/],
    ["a non-object relationship entry", { relationships: [42] }, /relationships\[0\]/],
    ["a fact citation given as one object", { persons: [{ id: "I1", gender: "Male", names: [{ given: "P", surname: "F" }], facts: [{ type: "Birth", sources: { ref: "S1" } }] }], sources: [{ id: "S1", title: "t" }] }, /sources/],
    ["a relationship citation given as a string", { persons: [{ id: "I1", gender: "Male", names: [{ given: "P", surname: "F" }] }, { id: "I2", gender: "Male", names: [{ given: "Q", surname: "F" }] }], relationships: [{ type: "ParentChild", parent: "I1", child: "I2", sources: "S1" }], sources: [{ id: "S1", title: "t" }] }, /sources/],
  ])("refuses %s rather than dropping or re-citing it", async (_l, tree, message) => {
    const result: any = await projectCreate({ projectPath: dir, objective: "x", tree: tree as any });
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(message);
    expect(await access(join(dir, "tree.gedcomx.json")).then(() => true, () => false)).toBe(false);
  });

  const P = (id?: unknown) => ({ ...(id === undefined ? {} : { id }), gender: "Male", names: [{ given: "P", surname: "F" }] });
  it.each([
    ["a fact citing a source that does not exist, beside an unsourced fact", { persons: [{ ...P("I1"), facts: [{ type: "Birth", sources: [{ ref: "S1" }] }, { type: "Death" }] }] }, undefined, /'S1'/],
    ["a fact citing S1 beside an id-less source", { persons: [{ ...P("I1"), facts: [{ type: "Birth", sources: [{ ref: "S1" }] }] }], sources: [{ title: "Unrelated" }] }, undefined, /'S1'/],
    ["a relationship naming I2 beside an id-less person", { persons: [P("I1"), P()], relationships: [{ type: "Couple", person1: "I1", person2: "I2" }] }, undefined, /'I2'/],
    ["subjectPersonIds naming I1 beside an id-less person", { persons: [P()] }, ["I1"], /I1/],
  ])("does not let a minted id bind %s", async (_l, tree, subjects, message) => {
    const result: any = await projectCreate({ projectPath: dir, objective: "x", tree: tree as any, subjectPersonIds: subjects as any });
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(message);
  });

  it("keeps a non-string id the caller referenced, for the validator to judge", async () => {
    const result: any = await projectCreate({
      projectPath: dir, objective: "x",
      tree: { persons: [P(5), P("I2")], relationships: [{ type: "Couple", person1: 5, person2: "I2" }] } as any,
    });
    expect(result.errors?.join(" ") ?? "").not.toMatch(/'5' not found/);
  });

  it("reads a null collection as none, like an absent one", async () => {
    const result: any = await projectCreate({ projectPath: dir, objective: "x", tree: { persons: null, relationships: null, sources: null } as any });
    expect(result.ok).toBe(true);
  });

  it.each([["a string", "abc"], ["an array", [1]]])("refuses a tree that is %s", async (_l, tree) => {
    const result: any = await projectCreate({ projectPath: dir, objective: "x", tree: tree as any });
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/tree must be an object/);
  });

  it("refuses a tree collection that is not an array rather than writing it as empty", async () => {
    const result: any = await projectCreate({ projectPath: dir, objective: "x", tree: { persons: { id: "I1" } } as any });
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/tree\.persons must be an array of objects/);
  });

  it("keeps the model's ids, mints only missing ones, and cites unsourced facts and relationships to the researcher's statement", async () => {
    const result: any = await projectCreate({
      projectPath: dir,
      objective: "Find Sarah's grandmother",
      subjectPersonIds: ["I1"],
      tree: {
        persons: [
          { id: "I1", gender: "Female", names: [{ id: "N1", given: "Sarah", surname: "Hennessy" }], facts: [{ type: "Birth", date: "~1920" }] },
          { id: "I2", gender: "Unknown", names: [{ given: "", surname: "Donovan" }] },
        ],
        relationships: [{ type: "ParentChild", parent: "I2", child: "I1" }],
      },
    });
    expect(result.ok).toBe(true);
    const tree = JSON.parse(await readFile(join(dir, "tree.gedcomx.json"), "utf-8"));
    expect(tree.persons.map((p: any) => p.id)).toEqual(["I1", "I2"]);
    expect(tree.persons[1].names[0].id).toBe("N2");
    expect(tree.persons[0].facts[0]).toEqual({ id: "F1", type: "Birth", date: "~1920", sources: [{ ref: "S1", quality: 1 }] });
    expect(tree.relationships[0]).toEqual({ id: "R1", type: "ParentChild", parent: "I2", child: "I1", sources: [{ ref: "S1", quality: 1 }] });
    expect(tree.sources).toEqual([
      { id: "S1", title: "Researcher's statement", citation: "Statement by the researcher when the project was created, 1 October 2026." },
    ]);
  });

  it("leaves an already-sourced hand-built tree exactly as given", async () => {
    const tree = {
      persons: [{ ...SUBJECT, facts: [{ id: "F1", type: "Birth", sources: [{ ref: "S1", quality: 1 }] }] }],
      relationships: [],
      sources: [TREE_SOURCE],
    };
    const result: any = await projectCreate({ projectPath: dir, objective: "x", subjectPersonIds: ["I1"], tree: structuredClone(tree) });
    expect(result.ok).toBe(true);
    expect(JSON.parse(await readFile(join(dir, "tree.gedcomx.json"), "utf-8"))).toEqual(tree);
  });
});

describe("project_create — the old-extension message init-project keys on (#2944)", () => {
  it("is produced only by a build that ignores personReadRef, never by this one", async () => {
    // agents/init-project.md tells the model that this exact refusal means the
    // extension predates personReadRef. A build that ignores the ref sees an
    // empty tree and a PID subject, so it produces it:
    const dir = await mkdtemp(join(tmpdir(), "project-create-skew-"));
    try {
      const old: any = await projectCreate({ projectPath: dir, objective: "x", subjectPersonIds: ["LZNY-BRF"] });
      expect(old.ok).toBe(false);
      expect(old.errors.join(" ")).toMatch(/subject_person_ids contains 'LZNY-BRF' which is not in tree\.gedcomx\.json persons/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("project_create — a mis-copied personReadRef (resolveStagedRef)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "project-create-slip-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("builds from the one staged read a near-copy names and reports the correction (init-project k8d)", async () => {
    const { staged } = await stagePersonRead({ projectPath: dir, input: { personId: "LZNY-BRF" }, result: structuredClone(FAMILY) });
    const good = staged!.resultsRef;
    const bad = good.replace(/(-[0-9a-f]{4})([0-9a-f])/, "$1");
    expect(bad).not.toBe(good);
    const result: any = await projectCreate({ projectPath: dir, objective: "x", personReadRef: bad });
    expect(result.ok).toBe(true);
    expect(result.counts.persons).toBeGreaterThan(0);
    expect(result.validation.warnings.join(" ")).toContain(`personReadRef '${bad}' matched no staged file; used '${good}'`);
  });

  it("still refuses a ref that names no staged read", async () => {
    await stagePersonRead({ projectPath: dir, input: { personId: "LZNY-BRF" }, result: structuredClone(FAMILY) });
    const result: any = await projectCreate({
      projectPath: dir, objective: "x", personReadRef: "results/.staging/00000000-0000-4000-8000-000000000000.json",
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/is not a staged read/);
  });
});

describe("project_create — hand-entered places are standardized by the tool", () => {
  let dir: string;
  const resolver = vi.mocked(resolveStandardPlace);
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "project-create-places-"));
    resolver.mockImplementation(async (place: string) =>
      /^boston/i.test(place) ? "Boston, Suffolk, Massachusetts, United States" : null,
    );
  });
  afterEach(async () => {
    resolver.mockImplementation(async () => null);
    await rm(dir, { recursive: true, force: true });
  });
  const readTree = async () => JSON.parse(await readFile(join(dir, "tree.gedcomx.json"), "utf-8"));
  const person = (facts: unknown[]) => ({
    id: "I1", gender: "Male", names: [{ id: "N1", given: "Michael", surname: "Brennan" }], facts,
  });

  it("replaces a standard_place the caller typed with the resolver's, and says so", async () => {
    const tree = {
      persons: [person([{ id: "F1", type: "Birth", date: "~1850", place: "Boston, Massachusetts", standard_place: "Boston, Massachusetts, United States" }])],
      relationships: [], sources: [],
    };
    const result: any = await projectCreate({ projectPath: dir, objective: "x", subjectPersonIds: ["I1"], tree: tree as any });
    expect(result.ok).toBe(true);
    expect((await readTree()).persons[0].facts[0].standard_place).toBe("Boston, Suffolk, Massachusetts, United States");
    expect(result.validation.warnings.join(" ")).toContain(
      "standard_place \"Boston, Massachusetts, United States\" for 'Boston, Massachusetts' was replaced by 'Boston, Suffolk, Massachusetts, United States'",
    );
  });

  it("fills a hand-entered place the caller left unstandardized, and reports it", async () => {
    const tree = { persons: [person([{ id: "F1", type: "Birth", place: "Boston" }])], relationships: [], sources: [] };
    const result: any = await projectCreate({ projectPath: dir, objective: "x", subjectPersonIds: ["I1"], tree: tree as any });
    expect(result.ok).toBe(true);
    expect((await readTree()).persons[0].facts[0].standard_place).toBe("Boston, Suffolk, Massachusetts, United States");
    expect(result.placesFilled).toEqual([{ place: "Boston", standardPlace: "Boston, Suffolk, Massachusetts, United States" }]);
  });

  it("drops a typed standard_place the resolver cannot confirm, and says so", async () => {
    const tree = { persons: [person([{ id: "F1", type: "Birth", place: "Ballyowen", standard_place: "Ballyowen, Ireland" }])], relationships: [], sources: [] };
    const result: any = await projectCreate({ projectPath: dir, objective: "x", subjectPersonIds: ["I1"], tree: tree as any });
    expect(result.ok).toBe(true);
    expect((await readTree()).persons[0].facts[0].standard_place).toBeUndefined();
    expect(result.validation.warnings.join(" ")).toContain("standard_place \"Ballyowen, Ireland\" for 'Ballyowen' was not kept");
  });

  it("standardizes a relationship's own fact too", async () => {
    const tree = {
      persons: [person([]), { id: "I2", gender: "Female", names: [{ id: "N2", given: "Mary", surname: "Kelly" }] }],
      relationships: [{ id: "R1", type: "Couple", person1: "I1", person2: "I2", facts: [{ id: "F2", type: "Marriage", place: "Boston, Massachusetts" }] }],
      sources: [],
    };
    const result: any = await projectCreate({ projectPath: dir, objective: "x", subjectPersonIds: ["I1"], tree: tree as any });
    expect(result.ok).toBe(true);
    expect((await readTree()).relationships[0].facts[0].standard_place).toBe("Boston, Suffolk, Massachusetts, United States");
  });

  it("leaves a malformed person or facts entry for the validator to refuse, not a crash", async () => {
    for (const persons of [[null], [{ ...person([]), facts: { type: "Birth", place: "Boston" } }], [person([null, "x"])]]) {
      const result: any = await projectCreate({ projectPath: dir, objective: "x", tree: { persons, relationships: [null], sources: [] } as any });
      expect(result.ok).toBe(false);
      expect(result.errors.join(" ")).not.toMatch(/Cannot read properties|is not iterable|TypeError/);
    }
  });

  it("drops a typed standard_place on a fact with no place, and says so", async () => {
    const result: any = await projectCreate({
      projectPath: dir,
      objective: "x",
      subjectPersonIds: ["I1"],
      tree: { persons: [{ ...person([]), facts: [{ type: "Birth", date: "1850", standard_place: "Atlantis" }] }], relationships: [], sources: [] } as any,
    });
    expect(result.ok).toBe(true);
    expect((await readTree()).persons[0].facts[0].standard_place).toBeUndefined();
    expect(result.validation.warnings.join(" ")).toContain("standard_place \"Atlantis\" on a Birth fact with no place was not kept");
  });

  it("treats an explicit null standard_place as none supplied, with no warning", async () => {
    const tree = { persons: [person([{ type: "Birth", place: "Ballyowen", standard_place: null }])], relationships: [], sources: [] };
    const result: any = await projectCreate({ projectPath: dir, objective: "x", subjectPersonIds: ["I1"], tree: tree as any });
    expect(result.ok).toBe(true);
    expect((await readTree()).persons[0].facts[0].standard_place).toBeUndefined();
    expect(result.validation.warnings.join(" ")).not.toContain("standard_place null");
  });

  it("standardizes an addition's place in ref mode, as hand-entered", async () => {
    const { staged } = await stagePersonRead({ projectPath: dir, input: { personId: "LZNY-BRF" }, result: structuredClone(FAMILY) });
    const result: any = await projectCreate({
      projectPath: dir,
      objective: "x",
      personReadRef: staged!.resultsRef,
      tree: {
        persons: [{ id: "A1", gender: "Female", names: [{ given: "Mary", surname: "Kelly" }],
          facts: [{ type: "Birth", place: "boston ", standard_place: "Boston, Massachusetts" }] }],
      } as any,
    });
    expect(result.ok).toBe(true);
    const added = (await readTree()).persons.find((p: any) => p.id === result.idMap.additions.A1);
    expect(added.facts[0].standard_place).toBe("Boston, Suffolk, Massachusetts, United States");
    expect(result.placesFilled).toContainEqual({ place: "boston ", standardPlace: "Boston, Suffolk, Massachusetts, United States" });
    expect(result.validation.warnings.join(" ")).toContain("standard_place \"Boston, Massachusetts\" for 'boston ' was replaced");
  });
});

// ─── Issue #3384: a guessed personReadRef, and citations on evidence ─────────

import { getProjectStore } from "../../src/store/project-store.js";

describe("project_create — a personReadRef that is not a staged read falls back to the stated PID's (#3384)", () => {
  const T = new Date("2026-10-01T12:00:00Z");
  let dir: string;
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T);
    dir = await mkdtemp(join(tmpdir(), "project-create-fallback-"));
  });
  afterEach(async () => {
    vi.useRealTimers();
    await rm(dir, { recursive: true, force: true });
  });
  const stage = async (personId: string, result: unknown, resolvedId?: string) =>
    (await stagePersonRead({ projectPath: dir, input: { personId }, resolvedId, result: result as never })).staged!
      .resultsRef;
  const create = (personReadRef: unknown, subjectPersonIds?: string[]) =>
    projectCreate({ projectPath: dir, objective: "x", personReadRef: personReadRef as string, subjectPersonIds }) as Promise<any>;

  it("builds from the newest staged read of subjectPersonIds[0] when the ref was guessed, and says so", async () => {
    const ref = await stage("LZNY-BRF", structuredClone(FAMILY));
    const result = await create("results/.staging/LZNY-BRF", ["LZNY-BRF"]);
    expect(result.ok).toBe(true);
    expect(result.counts.persons).toBe(FAMILY.persons.length);
    expect(result.validation.warnings.join(" ")).toContain(
      `personReadRef 'results/.staging/LZNY-BRF' is not a staged person_read; used '${ref}', the newest staged person_read of LZNY-BRF.`,
    );
    expect(JSON.parse(await readFile(join(dir, "tree.gedcomx.json"), "utf-8")).persons[0].ark).toBe(
      "ark:/61903/4:1:LZNY-BRF",
    );
  });

  it("takes the newer of two staged reads of the same person", async () => {
    await stage("LZNY-BRF", structuredClone(FAMILY));
    vi.setSystemTime(new Date(T.getTime() + 60_000));
    const fewer = structuredClone(FAMILY);
    fewer.persons = fewer.persons.filter((p: { id: string }) => p.id !== "LZNY-B8S");
    fewer.relationships = fewer.relationships.filter((r: { child?: string }) => r.child !== "LZNY-B8S");
    const newer = await stage("LZNY-BRF", fewer);
    const result = await create("nope", ["LZNY-BRF"]);
    expect(result.ok).toBe(true);
    expect(result.counts.persons).toBe(FAMILY.persons.length - 1);
    expect(result.validation.warnings.join(" ")).toContain(`used '${newer}'`);
  });

  it.each([
    ["the merged-away id it was read under", "OLDX-001"],
    ["the id it resolved to", "LZNY-BRF"],
    ["a lower-case id", "lzny-brf"],
  ])("matches %s", async (_l, pid) => {
    await stage("OLDX-001", structuredClone(FAMILY), "LZNY-BRF");
    const result = await create("results/.staging/guess.json", [pid]);
    expect(result.ok).toBe(true);
    expect(result.counts.persons).toBe(FAMILY.persons.length);
  });

  it("falls back from a ref another tool staged when a read of the stated person exists", async () => {
    const { stageSearchResults } = await import("../../src/utils/results-staging.js");
    const h = await stageSearchResults({ projectPath: dir, tool: "record_read", response: { results: [{ recordId: "X", gedcomx: {} }] } });
    await stage("LZNY-BRF", structuredClone(FAMILY));
    const result = await create(h!.resultsRef, ["LZNY-BRF"]);
    expect(result.ok).toBe(true);
  });

  it.each([
    ["names no one", undefined],
    ["names someone no staged read holds", ["ZZZZ-999"]],
  ])("keeps the original refusal when subjectPersonIds %s", async (_l, ids) => {
    await stage("LZNY-BRF", structuredClone(FAMILY));
    const result = await create("results/.staging/LZNY-BRF", ids as string[] | undefined);
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/is not a staged read/);
    expect(await access(join(dir, "research.json")).then(() => true, () => false)).toBe(false);
  });

  it("never falls back to a read older than the staging TTL", async () => {
    vi.setSystemTime(new Date(T.getTime() - 25 * 60 * 60 * 1000));
    await stage("LZNY-BRF", structuredClone(FAMILY));
    vi.setSystemTime(T);
    const result = await create("results/.staging/LZNY-BRF", ["LZNY-BRF"]);
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/is not a staged read/);
  });

  it("reports only the read it used when a near-copy correction lands on a file it cannot use", async () => {
    const { stageSearchResults } = await import("../../src/utils/results-staging.js");
    const other = await stageSearchResults({ projectPath: dir, tool: "record_read", response: { results: [{ recordId: "X", gedcomx: {} }] } });
    const used = await stage("LZNY-BRF", structuredClone(FAMILY));
    const nearCopy = other!.resultsRef.replace(/(-[0-9a-f]{4})([0-9a-f])/, "$1");
    expect(nearCopy).not.toBe(other!.resultsRef);
    const result = await create(nearCopy, ["LZNY-BRF"]);
    expect(result.ok).toBe(true);
    const warnings = result.validation.warnings.join(" ");
    expect(warnings).toContain(`used '${used}'`);
    expect(warnings).not.toContain(other!.resultsRef);
  });

  it("does not fall back past a corrupt file the ref names", async () => {
    await stage("LZNY-BRF", structuredClone(FAMILY));
    await writeFile(join(dir, "results", ".staging", "bad.json"), "{ not json");
    const result = await create("results/.staging/bad.json", ["LZNY-BRF"]);
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/holds invalid JSON/);
  });

  it("never opens a staged file already past the TTL by its write time", async () => {
    fileStoreOnly("sets a file's mtime, which a Postgres row has no equivalent of");
    const { utimes } = await import("fs/promises");
    const old = await stage("LZNY-BRF", structuredClone(FAMILY));
    await stage("LZNY-BRF", structuredClone(FAMILY));
    // Aged after the second staging, whose prune would otherwise delete it.
    const past = new Date(T.getTime() - 25 * 60 * 60 * 1000);
    await utimes(join(dir, old), past, past);
    const store = getProjectStore();
    const readText = vi.spyOn(store, "readText");
    try {
      const result = await create("results/.staging/LZNY-BRF", ["LZNY-BRF"]);
      expect(result.ok).toBe(true);
      expect(readText.mock.calls.map((c) => c[1])).not.toContain(old);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("does not paper over a store fault that also fails the existence check", async () => {
    await stage("LZNY-BRF", structuredClone(FAMILY));
    vi.setSystemTime(new Date(T.getTime() + 1000));
    const named = await stage("LZNY-BRF", structuredClone(FAMILY));
    const store = getProjectStore();
    const readText = store.readText.bind(store);
    const exists = store.exists.bind(store);
    vi.spyOn(store, "readText").mockImplementation(async (p, r) => {
      if (r === named) throw new Error("ECONNRESET");
      return readText(p, r);
    });
    vi.spyOn(store, "exists").mockImplementation(async (p, r) => {
      if (r === named) throw new Error("ECONNRESET");
      return exists(p, r);
    });
    try {
      const result = await create(named, ["LZNY-BRF"]);
      expect(result.ok).toBe(false);
      expect(result.errors.join(" ")).toMatch(/could not be read/);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("does not paper over a store fault on the ref it was given", async () => {
    fileStoreOnly("a directory where a staged file belongs has no Postgres meaning");
    await stage("LZNY-BRF", structuredClone(FAMILY));
    await mkdir(join(dir, "results", ".staging", "adir.json"), { recursive: true });
    const result = await create("results/.staging/adir.json", ["LZNY-BRF"]);
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/exists but could not be read/);
  });
});

describe("project_create — a hand-entered fact or relationship cites the FamilySearch Family Tree only when a staged read holds it (#3384)", () => {
  let dir: string;
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-01T12:00:00Z"));
    dir = await mkdtemp(join(tmpdir(), "project-create-evidence-"));
  });
  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });
  const readTree = async () => JSON.parse(await readFile(join(dir, "tree.gedcomx.json"), "utf-8"));
  const titleOf = (tree: any, refs: any[]) =>
    refs.map((r) => tree.sources.find((s: any) => s.id === r.ref)?.title);
  const ark = (pid: string) => `ark:/61903/4:1:${pid}`;
  const SCHUYLKILL = "Schuylkill County, Pennsylvania, United States";

  /** The stub path: the model typed the read's people by hand, arks included. */
  const handTree = (subjectArk = ark("LZNY-BRF")) => ({
    persons: [
      {
        id: "I1", ark: subjectArk, gender: "Male", names: [{ given: "Patrick", surname: "Flynn" }],
        facts: [
          { type: "Birth", date: "~1845", place: "ireland" },
          { type: "Residence", date: "1880", place: "Boston" },
        ],
      },
      { id: "I2", ark: ark("LZNY-K2M"), gender: "Female", names: [{ given: "Mary", surname: "Kelly" }] },
      { id: "I3", gender: "Unknown", names: [{ given: "", surname: "Kelly" }] },
      { id: "I4", ark: ark("ZZZZ-999"), gender: "Male", names: [{ given: "Owen", surname: "Kelly" }], facts: [{ type: "Birth", date: "1820" }] },
    ],
    relationships: [
      {
        type: "Couple", person1: "I2", person2: "I1",
        facts: [
          { type: "Marriage", date: "1869", place: SCHUYLKILL },
          { type: "Marriage", date: "1870", place: SCHUYLKILL },
        ],
      },
      { type: "ParentChild", parent: "I1", child: "I2" },
      { type: "ParentChild", parent: "I3", child: "I2" },
    ],
    sources: [],
  });

  it("cites what a staged read holds to the Family Tree and everything else to the researcher", async () => {
    await stagePersonRead({ projectPath: dir, input: { personId: "LZNY-BRF" }, result: structuredClone(FAMILY) });
    const result: any = await projectCreate({ projectPath: dir, objective: "x", subjectPersonIds: ["I1"], tree: handTree() as any });
    expect(result.ok).toBe(true);
    const tree = await readTree();
    const [p1, , , p4] = tree.persons;
    expect(titleOf(tree, p1.facts[0].sources)).toEqual(["FamilySearch Family Tree"]);
    expect(titleOf(tree, p1.facts[1].sources)).toEqual(["Researcher's statement"]);
    expect(titleOf(tree, p4.facts[0].sources)).toEqual(["Researcher's statement"]);
    const [couple, notHeld, stubEdge] = tree.relationships;
    expect(titleOf(tree, couple.sources)).toEqual(["FamilySearch Family Tree"]);
    expect(titleOf(tree, couple.facts[0].sources)).toEqual(["FamilySearch Family Tree"]);
    expect(titleOf(tree, couple.facts[1].sources)).toEqual(["Researcher's statement"]);
    expect(titleOf(tree, notHeld.sources)).toEqual(["Researcher's statement"]);
    expect(titleOf(tree, stubEdge.sources)).toEqual(["Researcher's statement"]);
    const fsTree = tree.sources.find((s: any) => s.title === "FamilySearch Family Tree");
    expect(fsTree).toEqual({
      id: fsTree.id,
      title: "FamilySearch Family Tree",
      citation: "FamilySearch Family Tree (https://www.familysearch.org/tree : accessed 1 October 2026).",
      url: "https://www.familysearch.org/tree",
    });
    expect(result.idMap.familySearchTreeSource).toBe(fsTree.id);
    expect(result.validation.warnings).toContain(
      `2 fact(s) and 1 relationship(s) with no source were cited to ${fsTree.id}, the FamilySearch Family Tree: a staged person_read holds each of them exactly.`,
    );
  });

  it("matches a merged person's ark by the id it was read under", async () => {
    await stagePersonRead({ projectPath: dir, input: { personId: "OLDX-001" }, resolvedId: "LZNY-BRF", result: structuredClone(FAMILY) });
    const result: any = await projectCreate({ projectPath: dir, objective: "x", subjectPersonIds: ["I1"], tree: handTree(ark("OLDX-001")) as any });
    expect(result.ok).toBe(true);
    const tree = await readTree();
    expect(titleOf(tree, tree.relationships[0].sources)).toEqual(["FamilySearch Family Tree"]);
    expect(titleOf(tree, tree.persons[0].facts[0].sources)).toEqual(["FamilySearch Family Tree"]);
  });

  it("with nothing staged, cites everything to the researcher and claims no Family Tree citation", async () => {
    const result: any = await projectCreate({ projectPath: dir, objective: "x", subjectPersonIds: ["I1"], tree: handTree() as any });
    expect(result.ok).toBe(true);
    const tree = await readTree();
    expect(tree.sources.map((s: any) => s.title)).toEqual(["Researcher's statement"]);
    expect(result.idMap.familySearchTreeSource).toBeUndefined();
    expect(result.validation.warnings.join(" ")).not.toMatch(/FamilySearch Family Tree/);
  });

  it("an objective-only build, with no ark, never lists the staging folder", async () => {
    const list = vi.spyOn(getProjectStore(), "list");
    const result: any = await projectCreate({
      projectPath: dir, objective: "x", subjectPersonIds: ["I1"],
      tree: { persons: [{ id: "I1", gender: "Female", names: [{ given: "Sarah", surname: "Hennessy" }], facts: [{ type: "Birth", date: "~1920" }] }] },
    });
    expect(result.ok).toBe(true);
    expect(list.mock.calls.filter((c) => String(c[1]).includes(".staging"))).toEqual([]);
  });

  it.each([
    ["a Step edge where the read holds only an untyped one", "Step", undefined, "Researcher's statement"],
    ["a Step edge where the read holds a Biological one", "Step", "Biological", "Researcher's statement"],
    ["an untyped edge where the read holds a Biological one", undefined, "Biological", "FamilySearch Family Tree"],
    ["a Biological edge where the read holds a Biological one", "Biological", "Biological", "FamilySearch Family Tree"],
  ])("cites %s", async (_l, given, heldSubtype, title) => {
    const read = structuredClone(FAMILY);
    const edge = read.relationships.find((r: any) => r.parent === "LZNY-M3F" && r.child === "LZNY-BRF");
    if (heldSubtype === undefined) delete edge.subtype;
    else edge.subtype = heldSubtype;
    await stagePersonRead({ projectPath: dir, input: { personId: "LZNY-BRF" }, result: read });
    const result: any = await projectCreate({
      projectPath: dir, objective: "x", subjectPersonIds: ["I1"],
      tree: {
        persons: [
          { id: "I1", ark: ark("LZNY-BRF"), gender: "Male", names: [{ given: "Patrick", surname: "Flynn" }] },
          { id: "I2", ark: ark("LZNY-M3F"), gender: "Male", names: [{ given: "Michael", surname: "Flynn" }] },
        ],
        relationships: [{ type: "ParentChild", parent: "I2", child: "I1", ...(given ? { subtype: given } : {}) }],
      } as any,
    });
    expect(result.ok).toBe(true);
    const tree = await readTree();
    expect(titleOf(tree, tree.relationships[0].sources)).toEqual([title]);
  });

  it.each([
    ["the read's own standard_date", "Abt 1845", "FamilySearch Family Tree"],
    ["no standard_date", undefined, "FamilySearch Family Tree"],
    ["a standard_date the read does not hold", "1850", "Researcher's statement"],
  ])("cites a copied fact carrying %s", async (_l, standardDate, title) => {
    await stagePersonRead({ projectPath: dir, input: { personId: "LZNY-BRF" }, result: structuredClone(FAMILY) });
    const result: any = await projectCreate({
      projectPath: dir, objective: "x", subjectPersonIds: ["I1"],
      tree: {
        persons: [{
          id: "I1", ark: ark("LZNY-BRF"), gender: "Male", names: [{ given: "Patrick", surname: "Flynn" }],
          facts: [{ type: "Birth", date: "~1845", place: "Ireland", ...(standardDate ? { standard_date: standardDate } : {}) }],
        }],
      } as any,
    });
    expect(result.ok).toBe(true);
    const tree = await readTree();
    expect(titleOf(tree, tree.persons[0].facts[0].sources)).toEqual([title]);
  });

  describe("ref mode: an addition", () => {
    /** A second person_read: Owen, who the subject's read does not hold, with
     *  his edge to Mary (a relative in the subject's read). */
    const OWEN = {
      persons: [
        { id: "ZZZZ-999", ark: ark("ZZZZ-999"), gender: "Male", living: false, names: [{ given: "Owen", surname: "Kelly" }], facts: [{ type: "Birth", date: "1820", place: "Ireland" }] },
        { id: "LZNY-K2M", ark: ark("LZNY-K2M"), gender: "Female", living: false, names: [{ given: "Mary", surname: "Kelly" }] },
      ],
      relationships: [{ type: "ParentChild", parent: "ZZZZ-999", child: "LZNY-K2M" }],
      sources: [],
    };
    const additions = {
      persons: [
        {
          id: "A1", ark: ark("ZZZZ-999"), gender: "Male", names: [{ given: "Owen", surname: "Kelly" }],
          facts: [{ type: "Birth", date: "1820", place: "Ireland" }, { type: "Death", date: "1890" }],
        },
      ],
      relationships: [
        { type: "ParentChild", parent: "A1", child: "LZNY-K2M" },
        { type: "ParentChild", parent: "A1", child: "LZNY-BRF" },
      ],
    };
    const createWithRead = async () => {
      const { staged } = await stagePersonRead({ projectPath: dir, input: { personId: "LZNY-BRF" }, result: structuredClone(FAMILY) });
      return projectCreate({ projectPath: dir, objective: "x", personReadRef: staged!.resultsRef, tree: structuredClone(additions) as any }) as Promise<any>;
    };

    it("cites what a second staged read holds to a generic Family Tree source, never S1", async () => {
      await stagePersonRead({ projectPath: dir, input: { personId: "ZZZZ-999" }, result: structuredClone(OWEN) as never });
      const result = await createWithRead();
      expect(result.ok).toBe(true);
      const tree = await readTree();
      const extra = result.idMap.additionsTreeSource;
      expect(extra).toBeDefined();
      expect(extra).not.toBe("S1");
      expect(result.idMap.familySearchTreeSource).toBe("S1");
      const owen = tree.persons.find((p: any) => p.id === result.idMap.additions.A1);
      expect(owen.facts[0].sources).toEqual([{ ref: extra, quality: 1 }]);
      expect(titleOf(tree, owen.facts[1].sources)).toEqual(["Researcher's statement"]);
      const toMary = tree.relationships.find((r: any) => r.parent === owen.id && r.child === result.idMap.persons["LZNY-K2M"]);
      const toSubject = tree.relationships.find((r: any) => r.parent === owen.id && r.child === "I1");
      expect(toMary.sources).toEqual([{ ref: extra, quality: 1 }]);
      expect(titleOf(tree, toSubject.sources)).toEqual(["Researcher's statement"]);
      expect(result.validation.warnings).toContain(
        `1 fact(s) and 1 relationship(s) with no source were cited to ${extra}, the FamilySearch Family Tree: a staged person_read holds each of them exactly.`,
      );
    });

    it("with only unarked stubs added, never lists staging", async () => {
      const { staged } = await stagePersonRead({ projectPath: dir, input: { personId: "LZNY-BRF" }, result: structuredClone(FAMILY) });
      const list = vi.spyOn(getProjectStore(), "list");
      const result = await projectCreate({
        projectPath: dir, objective: "x", personReadRef: staged!.resultsRef,
        tree: {
          persons: [{ id: "A1", gender: "Unknown", names: [{ given: "", surname: "Kelly" }] }],
          relationships: [{ type: "ParentChild", parent: "A1", child: "LZNY-K2M" }],
        } as any,
      }) as any;
      expect(result.ok).toBe(true);
      expect(list.mock.calls.filter((c) => String(c[1]).includes(".staging"))).toEqual([]);
    });

    it("without that second read, cites the addition to the researcher", async () => {
      const result = await createWithRead();
      expect(result.ok).toBe(true);
      const tree = await readTree();
      expect(result.idMap.additionsTreeSource).toBeUndefined();
      const owen = tree.persons.find((p: any) => p.id === result.idMap.additions.A1);
      expect(titleOf(tree, owen.facts[0].sources)).toEqual(["Researcher's statement"]);
      expect(tree.relationships.filter((r: any) => r.parent === owen.id).every((r: any) => titleOf(tree, r.sources)[0] === "Researcher's statement")).toBe(true);
    });
  });
});

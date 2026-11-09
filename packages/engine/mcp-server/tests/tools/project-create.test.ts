import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// The ref build's place retry goes through this resolver; stubbed so the suite
// stays offline. It resolves nothing unless a test says otherwise.
vi.mock("../../src/utils/place-resolver.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/utils/place-resolver.js")>();
  return { ...actual, resolveStandardPlace: vi.fn(async () => null) };
});
// FamilySearch's place search, offline: it finds nothing unless a test says otherwise.
vi.mock("../../src/utils/place-api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/utils/place-api.js")>();
  return { ...actual, searchPlace: vi.fn(async () => []) };
});
import { resolveStandardPlace } from "../../src/utils/place-resolver.js";
import { searchPlace } from "../../src/utils/place-api.js";
import { mkdtemp, writeFile, readFile, rm, access, mkdir } from "fs/promises";
import { realpathSync } from "node:fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  HOUSE_RESEARCHER_PROFILE,
  nameForId,
  runProjectCreate,
  type ProjectCreateDeps,
} from "../../src/tools/project-create.js";
import { PERSON_ID_REQUIRED, PROJECT_TREE_REMOVED } from "../../src/utils/tool-hint-messages.js";
import { LOCAL, bearerPrincipal } from "../../src/auth/principal.js";
import { runWithProjectStore } from "../../src/store/project-store.js";
import { ScopedFsStore, SCOPED_ANCHOR } from "../helpers/scoped-fs-store.js";

/** A one-person read of KWCJ-RN4, as `readPerson` returns it. */
const ONE_PERSON = {
  persons: [{ id: "KWCJ-RN4", gender: "Male", names: [{ preferred: true, given: "Patrick", surname: "Flynn" }] }],
  relationships: [] as unknown[],
  sources: [] as unknown[],
};
/** How many reads the module's `projectCreate` made. */
let oneReads = 0;
/** `project_create` served `read` (default `ONE_PERSON`) as the FamilySearch
 *  read, with `personId` KWCJ-RN4 unless the input names another. `LOCAL` is
 *  the principal, as the stdio dispatcher binds it. */
const projectCreate = (input: Record<string, unknown>, read: unknown = ONE_PERSON) =>
  runProjectCreate(
    { personId: "KWCJ-RN4", ...input } as never,
    {
      readPerson: async (id) => {
        oneReads++;
        return { result: structuredClone(read) as never, resolvedId: id.toUpperCase(), memoryKinds: {} };
      },
    },
    LOCAL,
  );

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

/** ONE_PERSON with `facts` on Patrick, and `more` added to the read. */
const readWith = (facts: unknown[], more: { persons?: unknown[]; relationships?: unknown[] } = {}) => ({
  persons: [{ ...ONE_PERSON.persons[0], facts }, ...(more.persons ?? [])],
  relationships: more.relationships ?? [],
  sources: [],
});

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

  it("refuses a read carrying a forged assertion_id (#2472)", async () => {
    // This tool copies the read's facts as given, and the document validator
    // type-checks `assertion_id` without knowing it was forged. A forged
    // backlink would persist into BOTH tree.gedcomx.json and the write-once
    // starting-tree baseline, after which research_append rewrites a fact from
    // an assertion it never came from. `tree_edit` refuses the same thing.
    for (const holderKey of ["persons", "relationships"] as const) {
      const fact = { type: "Birth", date: "1850", assertion_id: "a_011" };
      const read =
        holderKey === "persons"
          ? readWith([fact])
          : readWith([], {
              persons: [{ id: "KWCJ-RN5", gender: "Female", names: [{ given: "Mary", surname: "Doyle" }] }],
              relationships: [{ type: "Couple", person1: "KWCJ-RN4", person2: "KWCJ-RN5", facts: [{ ...fact, type: "Marriage" }] }],
            });

      const r: any = await projectCreate({ projectPath: dir, objective: "Identify the parents of Patrick Flynn" }, read);

      expect(r.ok, holderKey).toBe(false);
      expect(JSON.stringify(r), holderKey).toMatch(/`assertion_id` on a fact of/);
      expect(await exists("tree.gedcomx.json"), holderKey).toBe(false);
      expect(await exists("starting-tree.gedcomx.json"), holderKey).toBe(false);
    }
  });

  it("still accepts a read whose facts carry no backlink", async () => {
    const r = await projectCreate(
      { projectPath: dir, objective: "Identify the parents of Patrick Flynn" },
      readWith([{ type: "Birth", date: "1850" }]),
    );
    expect(r.ok).toBe(true);
  });

  it("creates both documents in an empty directory", async () => {
    const r = await projectCreate({
      projectPath: dir,
      objective: "Identify the parents of Patrick Flynn",
      title: "Patrick Flynn's parents",
    });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.filesWritten).toEqual([
      "tree.gedcomx.json",
      "research.json",
      "starting-tree.gedcomx.json",
    ]);
    expect(r.counts).toEqual({ persons: 1, relationships: 0, sources: 1, memorySources: 0 });

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
    await projectCreate({ projectPath: dir, objective: "Identify the parents of Patrick Flynn" });
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

  it("writes the house researcher profile", async () => {
    // The profile is the fixed house default, the same on every project, and
    // never inferred about the researcher: no subscriptions, no stated level.
    await projectCreate({ projectPath: dir, objective: "Who were John's parents?" });
    const research = await readResearch();
    expect(research.researcher_profile).toEqual(HOUSE_RESEARCHER_PROFILE);
    expect(research.researcher_profile.subscriptions).toBeUndefined();
  });

  // ── A project always starts from a FamilySearch person (lead, 2026-11-02) ──

  it.each([
    ["absent", undefined],
    ["null", null],
    ["empty", ""],
    ["whitespace", " \n "],
  ])("refuses a %s personId before reading anyone, and writes nothing", async (_label, personId) => {
    oneReads = 0;
    const r: any = await projectCreate({ projectPath: dir, objective: "Who were John's parents?", personId });
    expect(r.ok).toBe(false);
    expect(r.errors).toEqual([PERSON_ID_REQUIRED]);
    expect(r.errors[0]).toMatch(/FamilySearch person ID/);
    expect(r.errors[0]).toMatch(/survey-surname agent with no projectPath/);
    expect(oneReads).toBe(0);
    expect(await exists("research.json")).toBe(false);
    expect(await exists("tree.gedcomx.json")).toBe(false);
  });

  it("refuses a personId that is not a string, saying what one looks like", async () => {
    const r: any = await projectCreate({ projectPath: dir, objective: "x", personId: 42 });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/personId must be a FamilySearch person ID such as "KWCJ-RN4"; got 42/);
    expect(r.errors.join(" ")).toMatch(/Ask the researcher/);
  });

  it.each([
    // Issue #4133's route: a general-purpose agent sent an empty tree and no personId.
    ["with no personId", { personId: undefined, tree: { persons: [], relationships: [] } }],
    ["beside a personId", { tree: { persons: [{ id: "I1" }] } }],
    ["even as null", { tree: null }],
  ])("refuses a tree %s by name, before reading anyone", async (_label, extra) => {
    oneReads = 0;
    const r: any = await projectCreate({ projectPath: dir, objective: "x", ...extra });
    expect(r.ok).toBe(false);
    expect(r.errors).toEqual([PROJECT_TREE_REMOVED]);
    expect(oneReads).toBe(0);
    expect(await exists("tree.gedcomx.json")).toBe(false);
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
    // This is why the tool writes the tree rather than creating an empty one and
    // leaving the caller to add persons afterwards: a dangling
    // subject_person_ids is a hard validator error, so a header-first create
    // would impose an ordering constraint that has to be got right every time.
    const r = await projectCreate({
      projectPath: dir,
      objective: "Identify the parents of Patrick Flynn",
      subjectPersonIds: ["I9"],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/I9/);
    expect(await exists("research.json")).toBe(false);
    expect(await exists("tree.gedcomx.json")).toBe(false);
  });

  it("refuses a read the validator rejects, and writes NEITHER file", async () => {
    const r = await projectCreate(
      { projectPath: dir, objective: "Identify the parents of Patrick Flynn" },
      { ...ONE_PERSON, persons: [{ ...ONE_PERSON.persons[0], gender: "Martian" }] },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(await exists("research.json")).toBe(false);
    expect(await exists("tree.gedcomx.json")).toBe(false);
  });

  it("accepts a subject person that IS in the read", async () => {
    const r = await projectCreate({
      projectPath: dir,
      objective: "Identify the parents of Patrick Flynn",
      subjectPersonIds: ["KWCJ-RN4"],
    });
    expect(r.ok).toBe(true);
    expect((await readResearch()).project.subject_person_ids).toEqual(["I1"]);
  });

  // ── Argument hygiene ─────────────────────────────────────────────────────

  it("omits title when none is given rather than writing an empty one", async () => {
    await projectCreate({ projectPath: dir, objective: "Who were John's parents?" });
    expect((await readResearch()).project.title).toBeUndefined();
  });

  it("defaults subject_person_ids to the person read", async () => {
    await projectCreate({ projectPath: dir, objective: "Who were John's parents?" });
    expect((await readResearch()).project.subject_person_ids).toEqual(["I1"]);
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

describe("project_create — personId (#3384; the tree build from #2944 Stage B)", () => {
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

  /** The family fixture as `readPerson` returns it. The requested id is a
   *  merged-away one (a redirect), and the story memory carries an image_ref. */
  let reads = 0;
  const reader: ProjectCreateDeps["readPerson"] = async () => {
    reads++;
    const result = structuredClone(FAMILY);
    result.sources.find((s: { id: string }) => s.id === "228755097").image_ref = "images/228755097.jpg";
    return { result, resolvedId: "LZNY-BRF", memoryKinds: { "228755097": "story", "175960782": "document" } };
  };
  /** The id the caller passes: the merged-away one, as the old staged read was asked for. */
  async function stageFamily(): Promise<string> {
    return "OLDX-001";
  }
  const create = (input: Record<string, unknown>): Promise<any> =>
    runProjectCreate(input as never, { readPerson: reader }, LOCAL);
  /** A create served `result` as the read, resolved to `resolvedId` (default:
   *  the id asked for, as `readPerson` answers when there is no redirect). */
  const createWith = (input: Record<string, unknown>, result: unknown, resolvedId?: string): Promise<any> =>
    runProjectCreate(
      input as never,
      { readPerson: async (id) => ({ result: structuredClone(result) as never, resolvedId: resolvedId ?? id, memoryKinds: {} }) },
      LOCAL,
    );

  const STUB = { id: "A1", gender: "Unknown", names: [{ given: "", surname: "Kelly" }] };
  const src = (id: string) => FAMILY.sources.find((s: { id: string }) => s.id === id);
  const FS = { ref: "S1", quality: 1 };
  const fact = (id: string, f: Record<string, unknown>) => ({ id, ...f, sources: [FS] });

  it("builds the starting tree from the read, and writes the profile and the transcribed memory", async () => {
    const ref = await stageFamily();
    const result: any = await create({ projectPath: dir, objective: "Find Patrick's parents", personId: ref });
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
    expect(research.researcher_profile).toEqual(HOUSE_RESEARCHER_PROFILE);
    // The one memory that came back transcribed is a source; the untranscribed
    // headstone (175960782) is not, since an entry would assert it was examined.
    expect(research.sources).toEqual([
      {
        id: "src_001",
        gedcomx_source_description_id: "S4",
        citation:
          `"${src("228755097").title}," story, FamilySearch Memories ` +
          "(https://www.familysearch.org/memories/228755097 : accessed 1 October 2026), memory " +
          "228755097, uploaded to the profile of Patrick Flynn (LZNY-BRF).",
        citation_detail: {
          who: "[CREATOR NOT RECORDED]",
          what: "[DOCUMENT TYPE NOT RECORDED]",
          when_created: "[DATE NOT RECORDED]",
          when_accessed: "2026-10-01",
          where: "FamilySearch Memories",
          where_within: "memory 228755097",
        },
        source_classification: "authored",
        repository: "FamilySearch Memories",
        access_date: "2026-10-01",
        url: "https://www.familysearch.org/memories/228755097",
        notes:
          "Classified authored from the memory's type (a story) when the project was created; " +
          "its text was not examined. A transcription or abstract of another record is derivative.",
        transcription: src("228755097").text,
        image_filename: "images/228755097.jpg",
      },
    ]);
    // A summary, never the tree.
    expect(result).toMatchObject({
      ok: true,
      projectId: "rp_001",
      subject: { id: "I1", familySearchId: "LZNY-BRF", name: "Patrick Flynn", birth: "~1845, Ireland" },
      counts: { persons: 6, relationships: 7, sources: 5, memorySources: 1 },
      memories: { transcribed: [src("228755097").title], notTranscribed: [src("175960782").title] },
    });
    expect(result.relatives).toEqual([
      { id: "I2", name: "Mary Kelly", relationship: "spouse" },
      { id: "I3", name: "James Flynn", relationship: "child" },
      { id: "I4", name: "Margaret Flynn", relationship: "child" },
      { id: "I5", name: "Michael Flynn", relationship: "father" },
      { id: "I6", name: "Bridget Flynn", relationship: "sibling" },
    ]);
    expect(result.idMap).toBeUndefined();
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(2000);
  });

  it("cites every relative's facts to a FamilySearch-tree source that names no one person's page", async () => {
    const ref = await stageFamily();
    const result: any = await create({ projectPath: dir, objective: "x", personId: ref });
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
      const result: any = await create({ projectPath: dir, objective: "x", personId: ref, subjectPersonIds: [pid] });
      expect(result.ok).toBe(true);
      expect((await readJson("research.json")).project.subject_person_ids).toEqual(["I1"]);
    }
  });

  it("refuses rather than overwrites when another create lands while places are filled", async () => {
    const resolver = vi.mocked(resolveStandardPlace);
    const result = structuredClone(FAMILY);
    delete result.persons[0].facts.find((f: any) => f.standard_place).standard_place;
    resolver.mockImplementation(async () => {
      await writeFile(join(dir, "research.json"), "{\"other\": true}");
      return "Filled, Place";
    });
    try {
      const raced: any = await createWith({ projectPath: dir, objective: "x", personId: "LZNY-BRF" }, result);
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
    resolver.mockClear();
    resolver.mockImplementation(async () => "Filled, Place");
    try {
      const refused: any = await createWith({ projectPath: dir, objective: "x", personId: "LZNY-BRF", subjectPersonIds: ["NOT-READ"] }, result);
      expect(refused.ok).toBe(false);
      expect(resolver).not.toHaveBeenCalled();
      const ok: any = await createWith({ projectPath: dir, objective: "x", personId: "LZNY-BRF" }, result);
      expect(ok.ok).toBe(true);
      expect(resolver).toHaveBeenCalled();
      const written = (await readJson("tree.gedcomx.json")).persons[0].facts.find((f: any) => f.type === fact.type && f.place === fact.place);
      expect(written.standard_place).toBe("Filled, Place");
      // The read's own places are the tool's to retry; the summary reports none.
      expect(ok.placesFilled).toBeUndefined();
    } finally {
      resolver.mockImplementation(async () => null);
    }
  });

  it("reports a read place the retry could not standardize either", async () => {
    const result = structuredClone(FAMILY);
    const fact = result.persons[0].facts.find((f: any) => f.standard_place);
    delete fact.standard_place;
    const ok: any = await createWith({ projectPath: dir, objective: "x", personId: "LZNY-BRF" }, result);
    expect(ok.ok).toBe(true);
    expect(ok.placesFilled).toBeUndefined();
    expect(ok.validation.warnings).toContain(`Places kept as written, with no standard place found: ${fact.place}.`);
  });

  describe("a place text that names one state beside a standard place in another (#4299)", () => {
    const WRONG = "Texas, Washington, Kentucky, United States";
    const withDeath = (place: string, standard_place: string) => {
      const result = structuredClone(FAMILY);
      result.persons[0].facts.push({ id: "F99", type: "Death", place, standard_place });
      return result;
    };
    const mismatches = (ok: any) => ok.validation.warnings.filter((w: string) => w.includes("lies in another"));

    it("warns, and keeps FamilySearch's value as read", async () => {
      const ok: any = await createWith({ projectPath: dir, objective: "x", personId: "LZNY-BRF" }, withDeath("Washington County, Texas", WRONG));
      expect(ok.ok).toBe(true);
      expect(mismatches(ok)).toHaveLength(1);
      expect(mismatches(ok)[0]).toContain("'Washington County, Texas'");
      expect(mismatches(ok)[0]).toContain(`'${WRONG}'`);
      const written = (await readJson("tree.gedcomx.json")).persons.flatMap((p: any) => p.facts ?? []).find((f: any) => f.place === "Washington County, Texas");
      expect(written.standard_place).toBe(WRONG);
    });

    it("warns once for a pair that Death and Burial share, and again for an abbreviated text", async () => {
      const result = withDeath("Washington County, Texas", WRONG);
      result.persons[0].facts.push({ id: "F98", type: "Burial", place: "Washington County, Texas", standard_place: WRONG });
      result.persons[0].facts.push({ id: "F97", type: "Residence", place: "Washington Co., TX", standard_place: WRONG });
      const ok: any = await createWith({ projectPath: dir, objective: "x", personId: "LZNY-BRF" }, result);
      expect(mismatches(ok)).toHaveLength(2);
    });

    it.each([
      ["the same state", "Washington County, Texas", "Washington, Texas, United States"],
      ["the same state, abbreviated", "Washington Co., TX", "Washington, Texas, United States"],
      ["a text naming no state", "Washington County", WRONG],
      ["a place inside the named state", "Independence Cemetery, Independence, Washington, Texas", "Rock Hill Graves, Washington, Washington, Texas, United States"],
    ])("does not warn for %s", async (_label, place, standard) => {
      const ok: any = await createWith({ projectPath: dir, objective: "x", personId: "LZNY-BRF" }, withDeath(place, standard));
      expect(ok.ok).toBe(true);
      expect(mismatches(ok)).toEqual([]);
    });
  });

  it("matches the subject case-insensitively, and refuses a read that does not hold it", async () => {
    const result = structuredClone(FAMILY);
    const ok: any = await createWith({ projectPath: dir, objective: "x", personId: "lzny-brf" }, result);
    expect(ok.ok).toBe(true);
    const tree = await readJson("tree.gedcomx.json");
    expect(tree.persons[0]).toMatchObject({ id: "I1", ark: "ark:/61903/4:1:LZNY-BRF" });
    expect(tree.sources[0].title).toBe("FamilySearch Family Tree (read from Patrick Flynn, LZNY-BRF)");
    expect((await readJson("research.json")).project.subject_person_ids).toEqual(["I1"]);

    const other = await mkdtemp(join(tmpdir(), "project-create-nosubj-"));
    try {
      const refused: any = await createWith({ projectPath: other, objective: "x", personId: "ZZZZ-999" }, result);
      expect(refused.ok).toBe(false);
      expect(refused.errors.join(" ")).toMatch(/holds no person "ZZZZ-999"/);
    } finally {
      await rm(other, { recursive: true, force: true });
    }
  });

  it("maps a padded, lower-case subjectPersonIds PID to the subject", async () => {
    const ref = await stageFamily();
    const result: any = await create({ projectPath: dir, objective: "x", personId: ref, subjectPersonIds: [" lzny-brf "] });
    expect(result.ok).toBe(true);
    expect((await readJson("research.json")).project.subject_person_ids).toEqual(["I1"]);
  });

  it("accepts a personId with surrounding whitespace, and reads it trimmed", async () => {
    const asked: string[] = [];
    const result: any = await runProjectCreate(
      { projectPath: dir, objective: "x", personId: " OLDX-001\n" },
      { readPerson: async (id, opts, principal) => { asked.push(id); return reader(id, opts, principal); } },
      LOCAL,
    );
    expect(result.ok).toBe(true);
    expect(asked).toEqual(["OLDX-001"]);
  });

  it("refuses a subjectPersonIds entry that names neither a staged PID nor an addition", async () => {
    const ref = await stageFamily();
    const result: any = await create({ projectPath: dir, objective: "x", personId: ref, subjectPersonIds: ["I2"] });
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/subjectPersonIds entry "I2"/);
  });

  it.each([
    ["an existing project", async () => {
      await writeFile(join(dir, "research.json"), "{}");
      await writeFile(join(dir, "tree.gedcomx.json"), "{}");
    }, { objective: "x" }, /already exist/],
    ["no objective", async () => {}, { objective: " " }, /objective is required/],
    ["a tree beside personId", async () => {}, { objective: "x", tree: { persons: [STUB] } }, /tree is no longer accepted/],
    ["a blank personId", async () => {}, { objective: "x", personId: " " }, /personId is required/],
  ])("refuses %s before reading anyone", async (_l, setup, extra, message) => {
    await setup();
    reads = 0;
    const result: any = await create({ projectPath: dir, personId: "OLDX-001", ...extra });
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(message);
    expect(reads).toBe(0);
  });

  it("classifies a scanned memory as original, saying the type decided it", async () => {
    const read = structuredClone(FAMILY);
    read.sources.find((s: any) => s.id === "175960782").text = "IN LOVING MEMORY OF PATRICK FLYNN";
    const result: any = await runProjectCreate(
      { projectPath: dir, objective: "x", personId: "LZNY-BRF" },
      { readPerson: async () => ({ result: read, resolvedId: "LZNY-BRF", memoryKinds: { "228755097": "story", "175960782": "document" } }) },
      LOCAL,
    );
    expect(result.ok).toBe(true);
    const scan = (await readJson("research.json")).sources.find((s: any) => s.citation_detail.where_within === "memory 175960782");
    expect(scan.source_classification).toBe("original");
    expect(scan.citation).toMatch(/," digital image, FamilySearch Memories/);
    expect(scan.notes).toMatch(/^Classified original from the memory's type \(a scanned document\).*not examined/);
  });

  it("marks a memory's transcription truncated when its OCR read hit the cap", async () => {
    const { recordImageReadCap, __clearTruncatedSourceImagesForTests } = await import("../../src/utils/image-store.js");
    try {
      recordImageReadCap(dir, "images/228755097.jpg", true);
      const result: any = await create({ projectPath: dir, objective: "x", personId: "OLDX-001" });
      expect(result.ok).toBe(true);
      expect((await readJson("research.json")).sources[0].transcription_truncated).toBe(true);
    } finally {
      __clearTruncatedSourceImagesForTests();
    }
  });

  it("writes no transcription_truncated when the memory's read was whole", async () => {
    const result: any = await create({ projectPath: dir, objective: "x", personId: "OLDX-001" });
    expect(result.ok).toBe(true);
    expect("transcription_truncated" in (await readJson("research.json")).sources[0]).toBe(false);
  });

  it("holds the summary to 2,000 characters on a large family, counting what it left out", async () => {
    const read = structuredClone(FAMILY);
    for (let i = 0; i < 63; i++) {
      const id = `KID${String(i).padStart(2, "0")}-AAA`;
      read.persons.push({ id, ark: `ark:/61903/4:1:${id}`, gender: "Male", living: false, names: [{ preferred: true, given: `Child Number ${i}`, surname: "Flynn" }] });
      read.relationships.push({ type: "ParentChild", parent: "LZNY-BRF", child: id, subtype: "Biological" });
    }
    const result: any = await runProjectCreate(
      { projectPath: dir, objective: "x", personId: "LZNY-BRF" },
      { readPerson: async () => ({ result: read, resolvedId: "LZNY-BRF", memoryKinds: {} }) },
      LOCAL,
    );
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(2000);
    expect(result.counts.persons).toBe(69);
    expect(result.omitted.relatives).toBeGreaterThan(0);
    expect(result.relatives.length + result.omitted.relatives).toBe(68);
    // Whole entries only: every one kept is complete.
    expect(result.relatives.every((r: any) => r.id && r.name && r.relationship)).toBe(true);
  });

  it("returns no viewer link with the public URL set, inside the 2,000 characters", async () => {
    const read = structuredClone(FAMILY);
    for (let i = 0; i < 63; i++) {
      const id = `KID${String(i).padStart(2, "0")}-AAA`;
      read.persons.push({ id, ark: `ark:/61903/4:1:${id}`, gender: "Male", living: false, names: [{ preferred: true, given: `Child Number ${i}`, surname: "Flynn" }] });
      read.relationships.push({ type: "ParentChild", parent: "LZNY-BRF", child: id, subtype: "Biological" });
    }
    const created = (await runWithProjectStore(new ScopedFsStore(dir, "p-linked"), () =>
      runProjectCreate(
        { projectPath: SCOPED_ANCHOR, objective: "x", personId: "LZNY-BRF" },
        { readPerson: async () => ({ result: structuredClone(read), resolvedId: "LZNY-BRF", memoryKinds: {} }) },
        bearerPrincipal("tok", { webPublicUrl: "https://beta.example", uploadsEnabled: true }),
      ),
    )) as any;
    expect(created.ok).toBe(true);
    expect("projectUrl" in created).toBe(false);
    expect(JSON.stringify(created).length).toBeLessThanOrEqual(2000);
  });

  it.each([
    ["Male", "father"],
    ["Female", "mother"],
    ["Unknown", "parent"],
  ])("labels a parent recorded %s as %s, so a caller can tell which slot is filled", async (gender, label) => {
    const read = structuredClone(FAMILY);
    read.persons.find((p: any) => p.id === "LZNY-M3F").gender = gender;
    const result: any = await runProjectCreate(
      { projectPath: dir, objective: "x", personId: "LZNY-BRF" },
      { readPerson: async () => ({ result: read, resolvedId: "LZNY-BRF", memoryKinds: {} }) },
      LOCAL,
    );
    expect(result.ok).toBe(true);
    expect(result.relatives.find((r: any) => r.name === "Michael Flynn").relationship).toBe(label);
  });

  it("never trims a parent or a spouse, however large the family", async () => {
    const read = structuredClone(FAMILY);
    for (let i = 0; i < 63; i++) {
      const id = `KID${String(i).padStart(2, "0")}-AAA`;
      read.persons.push({ id, ark: `ark:/61903/4:1:${id}`, gender: "Male", living: false, names: [{ preferred: true, given: `Child Number ${i}`, surname: "Flynn" }] });
      read.relationships.push({ type: "ParentChild", parent: "LZNY-BRF", child: id, subtype: "Biological" });
    }
    // The spouse and the father last, where trimming from the end reaches them first.
    const last = new Set(["LZNY-K2M", "LZNY-M3F"]);
    read.persons = [...read.persons.filter((p: any) => !last.has(p.id)), ...read.persons.filter((p: any) => last.has(p.id))];
    const result: any = await runProjectCreate(
      { projectPath: dir, objective: "x", personId: "LZNY-BRF" },
      { readPerson: async () => ({ result: read, resolvedId: "LZNY-BRF", memoryKinds: {} }) },
      LOCAL,
    );
    expect(result.ok).toBe(true);
    expect(result.omitted.relatives).toBeGreaterThan(0);
    const kept = result.relatives.map((r: any) => `${r.name}:${r.relationship}`);
    expect(kept).toContain("Mary Kelly:spouse");
    expect(kept).toContain("Michael Flynn:father");
  });

  it("gives the place retry no time once the read has spent the call budget", async () => {
    const resolver = vi.mocked(resolveStandardPlace);
    const read = structuredClone(FAMILY);
    delete read.persons[0].facts.find((f: any) => f.standard_place).standard_place;
    // Answers after 50 ms: in time for any budget but none at all.
    resolver.mockImplementation(() => new Promise((r) => setTimeout(() => r("Filled, Place"), 50)));
    try {
      const result: any = await runProjectCreate(
        { projectPath: dir, objective: "x", personId: "LZNY-BRF" },
        {
          readPerson: async () => {
            vi.setSystemTime(new Date(Date.now() + 60_000));
            return { result: read, resolvedId: "LZNY-BRF", memoryKinds: {} };
          },
        },
        LOCAL,
      );
      expect(result.ok).toBe(true);
      const birth = (await readJson("tree.gedcomx.json")).persons[0].facts.find((f: any) => f.type === "Birth");
      expect(birth.standard_place).toBeUndefined();
    } finally {
      resolver.mockImplementation(async () => null);
    }
  });

  it.each([
    ["a staged ref", "results/.staging/abc.json"],
    ["a blank ref", ""],
    ["a non-string", 42],
  ])("refuses personReadRef by name (%s), before any read, writing nothing", async (_l, ref) => {
    reads = 0;
    const result: any = await create({ projectPath: dir, objective: "x", personReadRef: ref, subjectPersonIds: ["LZNY-BRF"] });
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/personReadRef is no longer accepted: pass personId/);
    expect(reads).toBe(0);
    expect(await exists("research.json")).toBe(false);
  });

  it("names the subject where the objective and title name them by ID, and returns them as stored", async () => {
    const result: any = await create({
      projectPath: dir,
      objective: "Identify the parents of OLDX-001.",
      title: "LZNY-BRF general research",
      personId: "OLDX-001",
    });
    expect(result.ok).toBe(true);
    const project = (await readJson("research.json")).project;
    expect(project.objective).toBe("Identify the parents of Patrick Flynn.");
    expect(project.title).toBe("Patrick Flynn general research");
    expect(result.objective).toBe(project.objective);
    expect(result.title).toBe(project.title);
  });

  it("leaves an objective that names no ID, or names it beside the name, as given", async () => {
    const result: any = await create({
      projectPath: dir,
      objective: "General research: build out the tree and identify gaps and next steps.",
      title: "Patrick Flynn (LZNY-BRF) parents",
      personId: "OLDX-001",
    });
    const project = (await readJson("research.json")).project;
    expect(project.objective).toBe("General research: build out the tree and identify gaps and next steps.");
    expect(project.title).toBe("Patrick Flynn (LZNY-BRF) parents");
    expect(result.objective).toBe(project.objective);
  });

  const exists = async (name: string) =>
    access(join(dir, name)).then(() => true, () => false);
});

describe("nameForId", () => {
  const ids = ["LZNY-BRF", "OLDX-001"];
  it.each([
    ["Identify the parents of LZNY-BRF.", "Identify the parents of Patrick Flynn."],
    ["Find FamilySearch ID LZNY-BRF's parents", "Find Patrick Flynn's parents"],
    ["person ID: lzny-brf origins", "Patrick Flynn origins"],
    ["OLDX-001 and LZNY-BRF", "Patrick Flynn and Patrick Flynn"],
  ])("replaces a mention by ID: %s", (text, want) => {
    expect(nameForId(text, ids, "Patrick Flynn")).toBe(want);
  });
  it.each([
    ["an ID in parentheses", "Patrick Flynn (LZNY-BRF) parents"],
    ["a labelled ID in parentheses", "Patrick Flynn (FamilySearch ID LZNY-BRF)"],
    ["a longer token", "XLZNY-BRF and LZNY-BRFX and LZNY-BRF2"],
    ["no ID", "General research: build out the tree and identify gaps and next steps."],
  ])("keeps %s", (_l, text) => {
    expect(nameForId(text, ids, "Patrick Flynn")).toBe(text);
  });
  it("keeps everything when the read gave no name", () => {
    expect(nameForId("of LZNY-BRF", ids, "Unknown")).toBe("of LZNY-BRF");
    expect(nameForId("of LZNY-BRF", ids, "")).toBe("of LZNY-BRF");
  });
});

describe("project_create — a ParentChild loop in the FamilySearch read (#4085)", () => {
  let dir: string;
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-01T12:00:00Z"));
    dir = await mkdtemp(join(tmpdir(), "project-create-loop-"));
  });
  afterEach(async () => {
    vi.useRealTimers();
    await rm(dir, { recursive: true, force: true });
  });
  const readJson = async (name: string) => JSON.parse(await readFile(join(dir, name), "utf-8"));
  const person = (id: string, given: string, surname: string) => ({ id, gender: "Unknown", living: false, names: [{ given, surname }] });
  const createWith = (personId: string, read: unknown): Promise<any> =>
    runProjectCreate(
      { projectPath: dir, objective: "Find the children", personId } as never,
      { readPerson: async (id) => ({ result: structuredClone(read) as never, resolvedId: id, memoryKinds: {} }) },
      LOCAL,
    );

  // salvador-choc-daughter's loop, without its dates: Catarina, Salvador's
  // child, recorded as the parent of Petrona, Salvador's wife. With no dates
  // the generation walk decides.
  const SALVADOR_READ = {
    persons: [person("MGDD-CB5", "Salvador", "Choc"), person("GG1G-697", "Petrona", "Ba"), person("94B1-P5D", "Catarina", "Choc")],
    relationships: [
      { type: "Couple", person1: "MGDD-CB5", person2: "GG1G-697" },
      { type: "ParentChild", parent: "MGDD-CB5", child: "94B1-P5D" },
      { type: "ParentChild", parent: "GG1G-697", child: "94B1-P5D" },
      { type: "ParentChild", parent: "94B1-P5D", child: "GG1G-697" },
    ],
    sources: [],
  };
  const SALVADOR_NOTE =
    "FamilySearch records Catarina Choc as Petrona Ba's parent and Petrona Ba as Catarina Choc's; " +
    "the first link was left out of the tree, since a person cannot be their own ancestor.";

  it("creates the project, leaves the loop-closing edge out, and says so first in notes", async () => {
    const result = await createWith("MGDD-CB5", { ...SALVADOR_READ, notes: ["A note from the read."] });
    expect(result.ok).toBe(true);
    expect(result.notes).toEqual([SALVADOR_NOTE, "A note from the read."]);
    expect(result.validation.warnings).toContain(SALVADOR_NOTE);

    const tree = await readJson("tree.gedcomx.json");
    const byId = Object.fromEntries(tree.persons.map((p: any) => [p.id, p.names[0].given]));
    const parentChild = tree.relationships
      .filter((r: any) => r.type === "ParentChild")
      .map((r: any) => `${byId[r.parent]}>${byId[r.child]}`);
    expect(parentChild).toEqual(["Salvador>Catarina", "Petrona>Catarina"]);
    expect(await readJson("starting-tree.gedcomx.json")).toEqual(tree);
  });

  it("with the fixture's real dates, leaves out Petrona as Catarina's parent and says so", async () => {
    const withDates = structuredClone(SALVADOR_READ) as any;
    withDates.persons[1].facts = [{ type: "Christening", date: "14 Jul 1867" }];
    withDates.persons[2].facts = [{ type: "Birth", date: "1838" }];
    const result = await createWith("MGDD-CB5", withDates);
    expect(result.ok).toBe(true);
    expect(result.notes[0]).toBe(
      "FamilySearch records Petrona Ba as Catarina Choc's parent and Catarina Choc as Petrona Ba's; " +
        "the first link was left out of the tree, since a person cannot be their own ancestor.",
    );
    const tree = await readJson("tree.gedcomx.json");
    const byId = Object.fromEntries(tree.persons.map((p: any) => [p.id, p.names[0].given]));
    const parentChild = tree.relationships
      .filter((r: any) => r.type === "ParentChild")
      .map((r: any) => `${byId[r.parent]}>${byId[r.child]}`);
    expect(parentChild).toEqual(["Salvador>Catarina", "Catarina>Petrona"]);
  });

  it("words a longer loop without claiming a reciprocal link FamilySearch does not hold", async () => {
    // F is the subject's father and G is F's father; the subject is also
    // recorded as G's parent. That edge is the one dropped
    // (person-read-tree.test.ts).
    const result = await createWith("SUBJ-001", {
      persons: [person("SUBJ-001", "Sam", "Roe"), person("FATH-001", "Frank", "Roe"), person("GRAN-001", "George", "Roe")],
      relationships: [
        { type: "ParentChild", parent: "FATH-001", child: "SUBJ-001" },
        { type: "ParentChild", parent: "GRAN-001", child: "FATH-001" },
        { type: "ParentChild", parent: "SUBJ-001", child: "GRAN-001" },
      ],
      sources: [],
    });
    expect(result.ok).toBe(true);
    expect(result.notes[0]).toBe(
      "FamilySearch records Sam Roe as George Roe's parent, but also records George Roe as Sam Roe's " +
        "ancestor; that link was left out of the tree, since a person cannot be their own ancestor.",
    );
  });

  it("names an unnamed person on the loop by FamilySearch ID, never by the tree's own id", async () => {
    const result = await createWith("SUBJ-001", {
      persons: [person("SUBJ-001", "Sam", "Roe"), person("NONM-001", "", "")],
      relationships: [
        { type: "Couple", person1: "SUBJ-001", person2: "NONM-001" },
        { type: "ParentChild", parent: "SUBJ-001", child: "NONM-001" },
        { type: "ParentChild", parent: "NONM-001", child: "SUBJ-001" },
      ],
      sources: [],
    });
    expect(result.ok).toBe(true);
    expect(result.notes[0]).toContain("the person with FamilySearch ID NONM-001");
    expect(result.notes[0]).not.toMatch(/\bI\d+\b/);
  });

  it("adds no note for a read with no loop", async () => {
    const result = await createWith("MGDD-CB5", { ...SALVADOR_READ, relationships: SALVADOR_READ.relationships.slice(0, 3) });
    expect(result.ok).toBe(true);
    expect(result.notes).toBeUndefined();
  });
});

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
          title: "FamilySearch Family Tree: Patrick Flynn (LZNY-BRF)",
          citation: '"Patrick Flynn," FamilySearch Family Tree (https://www.familysearch.org/tree/person/details/LZNY-BRF : accessed 1 October 2026).',
          url: "https://www.familysearch.org/tree/person/details/LZNY-BRF",
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
    expect(tree.sources[0].title).toBe("FamilySearch Family Tree: Patrick Flynn (LZNY-BRF)");
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
    ["invalid-JSON", "results/.staging/bad.json", /not a staged read/],
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
    // init-project/SKILL.md tells the model that this exact refusal means the
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

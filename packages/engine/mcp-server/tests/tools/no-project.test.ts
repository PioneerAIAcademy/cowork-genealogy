/**
 * Issue #1695 — not being in a research project returns an ANSWER, not an error.
 *
 * The lead ruling: it is fine for standalone work not to be persisted; it is not
 * fine for the user to see an error merely because they are not in a project.
 *
 * The verdict is decided by the DIRECTORY and which files are in it, never by
 * which file the current read wanted — six of these twelve tools read
 * `tree.gedcomx.json` first, so a filename-derived verdict would hand them the
 * wrong message. Five states:
 *
 *   projectPath absent / not a string      -> loud, `projectPath is required`
 *   projectPath is not an existing dir     -> loud, `projectPath does not exist`
 *   neither project file present           -> reason: "no_project", NOT loud
 *   exactly one project file present       -> loud (a BROKEN project)
 *   a file present but unparseable         -> loud
 *
 * The half-a-project rows are the ones that matter most: a folder whose
 * `research.json` was deleted must stay loud, or a write against a real project
 * is dropped with a cheerful message.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

// Stub place resolver so research_append and tree_edit don't hit the network.
vi.mock("../../src/utils/place-resolver.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/utils/place-resolver.js")>();
  return { ...actual, resolveStandardPlace: vi.fn(async () => null) };
});

import { researchAppend } from "../../src/tools/research-append.js";
import { extractionAppend } from "../../src/tools/extraction-append.js";
import { researchLogAppend } from "../../src/tools/research-log-append.js";
import { treeEdit } from "../../src/tools/tree-edit.js";
import { treeCorrect } from "../../src/tools/tree-correct.js";
import { materializeFacts } from "../../src/tools/materialize-facts.js";
import { treeForget } from "../../src/tools/tree-forget.js";
import { projectContext } from "../../src/tools/project-context.js";
import { researchQuery } from "../../src/tools/research-query.js";
import { mergeTreePersons } from "../../src/tools/merge-tree-persons.js";
import { mergeWarnings } from "../../src/tools/merge-warnings.js";
import { personWarningsTool } from "../../src/tools/person-warnings.js";
import { NO_PROJECT_MESSAGE } from "../../src/utils/project-io.js";

const minimalResearch = {
  project: { id: "rp_001", objective: "Test", status: "active", created: "2026-01-01", updated: "2026-01-01" },
  questions: [], plans: [], log: [], sources: [], assertions: [],
  person_evidence: [], conflicts: [], hypotheses: [], timelines: [],
  proof_summaries: [], evaluations: [],
};
const minimalTree = { persons: [], relationships: [], sources: [] };

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "no-project-test-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const writeResearch = () =>
  writeFile(join(dir, "research.json"), JSON.stringify(minimalResearch, null, 2));
const writeTree = () =>
  writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify(minimalTree, null, 2));

/**
 * Every tool, called against `projectPath` with arguments that reach the
 * project read. Each call is otherwise valid — a tool that rejected its own
 * arguments before reading would prove nothing here.
 */
const CALLS: Array<{ tool: string; call: (projectPath: any) => Promise<any> }> = [
  {
    tool: "research_append",
    call: (projectPath) =>
      researchAppend({ projectPath, section: "sources", op: "append", entry: { id: "src_001" } } as any),
  },
  {
    tool: "extraction_append",
    call: (projectPath) =>
      extractionAppend({ projectPath, section: "sources", op: "append", entry: { id: "src_001" } } as any),
  },
  {
    tool: "research_log_append",
    call: (projectPath) =>
      researchLogAppend({
        projectPath,
        ops: [{
          op: "append",
          entry: {
            id: "log_001", plan_item_id: null, performed: "2026-01-01T00:00:00.000Z",
            tool: "record_search", query: {}, outcome: "negative",
            results_examined: 0, external_site: null, results_ref: null,
          },
        }],
      } as any),
  },
  {
    tool: "tree_edit",
    call: (projectPath) =>
      treeEdit({ projectPath, ops: [{ operation: "add_person", person: { id: "I1" } }] } as any),
  },
  {
    tool: "tree_correct",
    call: (projectPath) =>
      treeCorrect({ projectPath, ops: [{ operation: "remove", personId: "I1" }] } as any),
  },
  {
    tool: "materialize_facts",
    call: (projectPath) =>
      materializeFacts({ projectPath, ops: [{ personId: "I1", assertionId: "a_001" }] } as any),
  },
  {
    tool: "tree_forget",
    call: (projectPath) => treeForget({ projectPath, forget: [{ personId: "I1" }] } as any),
  },
  { tool: "project_context", call: (projectPath) => projectContext({ projectPath } as any) },
  {
    tool: "research_query",
    call: (projectPath) => researchQuery({ projectPath, section: "sources" } as any),
  },
  {
    tool: "merge_tree_persons",
    call: (projectPath) => mergeTreePersons({ projectPath, merges: [["I1", "I2"]] } as any),
  },
  {
    tool: "merge_warnings",
    call: (projectPath) => mergeWarnings({ projectPath, merges: [["I1", "I2"]] } as any),
  },
  {
    tool: "person_warnings",
    call: (projectPath) => personWarningsTool({ projectPath, personId: "I1" } as any),
  },
];

// ── the no-project answer ─────────────────────────────────────────────────────

describe("an existing directory holding neither project file", () => {
  for (const { tool, call } of CALLS) {
    it(`${tool} answers with reason: "no_project" and no error`, async () => {
      const r = await call(dir);
      expect(r.reason, `${tool} must carry the no_project discriminator`).toBe("no_project");
      expect(r.ok).toBe(false);
      // The text is relayed to a person unedited, so it is pinned, not just present.
      expect(r.errors).toEqual([NO_PROJECT_MESSAGE]);
      expect(r.errors[0]).not.toMatch(/projectPath|research\.json not found|tree\.gedcomx/);
    });
  }
});

// ── the four loud states ──────────────────────────────────────────────────────

/** Loud = a real failure: `errors`, and NO `reason` for a caller to branch on.
 *  `person_warnings` signals failure by throwing rather than returning. */
async function expectLoud(
  tool: string,
  call: (p: any) => Promise<any>,
  projectPath: any,
  pattern: RegExp,
) {
  if (tool === "person_warnings") {
    await expect(call(projectPath)).rejects.toThrow(pattern);
    return;
  }
  const r = await call(projectPath);
  expect(r.ok, `${tool} must still fail`).toBe(false);
  expect(r.reason, `${tool} must NOT claim no_project here`).toBeUndefined();
  expect(r.errors.join(" ")).toMatch(pattern);
}

describe("projectPath absent", () => {
  for (const { tool, call } of CALLS) {
    it(`${tool} stays loud`, async () => {
      await expectLoud(tool, call, undefined, /projectPath is required/);
    });
  }
});

describe("projectPath naming a directory that does not exist", () => {
  for (const { tool, call } of CALLS) {
    it(`${tool} stays loud and names the path`, async () => {
      const missing = join(dir, "no-such-folder");
      await expectLoud(tool, call, missing, /projectPath does not exist/);
    });
  }
});

describe("half a project — tree.gedcomx.json present, research.json missing", () => {
  // The regression this suite exists for. Under a file-derived verdict these
  // become "no_project" and the write is silently dropped against what is a
  // real, if damaged, project.
  const READS_RESEARCH = CALLS.filter(({ tool }) =>
    ["research_append", "extraction_append", "research_log_append", "tree_edit",
     "materialize_facts", "project_context", "research_query",
     "merge_tree_persons"].includes(tool),
  );
  for (const { tool, call } of READS_RESEARCH) {
    it(`${tool} stays loud`, async () => {
      await writeTree();
      await expectLoud(tool, call, dir, /research\.json not found in projectPath/);
    });
  }
});

describe("half a project — research.json present, tree.gedcomx.json missing", () => {
  const READS_TREE = CALLS.filter(({ tool }) =>
    ["research_append", "extraction_append", "research_log_append", "tree_edit",
     "tree_correct", "materialize_facts", "tree_forget", "project_context",
     "merge_tree_persons", "merge_warnings"].includes(tool),
  );
  for (const { tool, call } of READS_TREE) {
    it(`${tool} stays loud`, async () => {
      await writeResearch();
      await expectLoud(tool, call, dir, /tree\.gedcomx\.json not found in projectPath/);
    });
  }
});

describe("a project file that is present but unparseable", () => {
  it("research_query stays loud on invalid research.json", async () => {
    await writeFile(join(dir, "research.json"), "{not json");
    await expectLoud("research_query", CALLS.find((c) => c.tool === "research_query")!.call, dir,
      /research\.json is not valid JSON/);
  });

  it("tree_edit stays loud on invalid tree.gedcomx.json", async () => {
    await writeResearch();
    await writeFile(join(dir, "tree.gedcomx.json"), "{not json");
    await expectLoud("tree_edit", CALLS.find((c) => c.tool === "tree_edit")!.call, dir,
      /tree\.gedcomx\.json is not valid JSON/);
  });
});

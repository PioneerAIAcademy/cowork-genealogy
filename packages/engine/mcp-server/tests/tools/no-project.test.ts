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
import { mkdtemp, writeFile, rm, chmod } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

// Stub place resolver so research_append and tree_edit don't hit the network.
vi.mock("../../src/utils/place-resolver.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/utils/place-resolver.js")>();
  return { ...actual, resolveStandardPlace: vi.fn(async () => null) };
});

import { LOCAL } from "../../src/auth/principal.js";
import { researchAppend } from "../../src/tools/research-append.js";
import { extractionAppend } from "../../src/tools/extraction-append.js";
import { researchLogAppend } from "../../src/tools/research-log-append.js";
import { treeEdit } from "../../src/tools/tree-edit.js";
import { treeCorrect } from "../../src/tools/tree-correct.js";
import { materializeFacts } from "../../src/tools/materialize-facts.js";
import { treeForget } from "../../src/tools/tree-forget.js";
import { projectContext } from "../../src/tools/project-context.js";
import { researchQuery } from "../../src/tools/research-query.js";
import { sidecarRead } from "../../src/tools/sidecar-read.js";
import { imageTranscribeTool } from "../../src/tools/image-transcribe.js";
import { mergeTreePersons } from "../../src/tools/merge-tree-persons.js";
import { mergeWarnings } from "../../src/tools/merge-warnings.js";
import { personWarningsTool } from "../../src/tools/person-warnings.js";
import { buildExternalSearchUrlTool } from "../../src/tools/build-external-search-url.js";
import { validateResearchSchema } from "../../src/tools/validate-research-schema.js";
import {
  NO_PROJECT_MESSAGE_READ,
  NO_PROJECT_MESSAGE_WRITE,
} from "../../src/utils/project-io.js";

/** The five tools that are not writers. Telling someone who asked "where are
 *  we?" in a non-project folder that their work was not saved is both wrong and
 *  alarming, so these carry the read sentence. */
const READERS = new Set(["research_query", "project_context", "person_warnings", "merge_warnings", "sidecar_read", "image_transcribe", "validate_research_schema"]);

/** Tools that signal the two loud path states by THROWING rather than
 *  returning `{ ok: false, errors }` — the dispatch arm's catch turns the throw
 *  into `isError`. `person_warnings` classifies the directory itself;
 *  `sidecar_read` reads no project document, so it has no `readProjectJson`
 *  error to flatten into a result and mirrors the thrown messages instead. */
// `image_transcribe` joined both sets with its `file` input (#2048): it classifies
// the directory itself, throws the two loud states, and RETURNS the no-project answer.
const THROWERS = new Set(["person_warnings", "sidecar_read", "image_transcribe", "validate_research_schema"]);

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
    tool: "sidecar_read",
    call: (projectPath) => sidecarRead({ projectPath, ref: "uploads/notes.txt" } as any),
  },
  {
    tool: "image_transcribe",
    call: (projectPath) => imageTranscribeTool({ projectPath, file: "uploads/scan.jpg" } as any, LOCAL),
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
  {
    tool: "validate_research_schema",
    call: (projectPath) => validateResearchSchema({ projectPath }),
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
      expect(r.errors).toEqual([
        READERS.has(tool) ? NO_PROJECT_MESSAGE_READ : NO_PROJECT_MESSAGE_WRITE,
      ]);
      expect(r.errors[0]).not.toMatch(/projectPath|research\.json not found|tree\.gedcomx/);
      // A read must not claim the user's work went unsaved — it was never asked
      // to save anything.
      if (READERS.has(tool)) expect(r.errors[0]).not.toMatch(/saved/);
    });
  }
});

// ── the four loud states ──────────────────────────────────────────────────────

/** Loud = a real failure: `errors`, and NO `reason` for a caller to branch on.
 *  The THROWERS signal failure by throwing rather than returning. */
async function expectLoud(
  tool: string,
  call: (p: any) => Promise<any>,
  projectPath: any,
  pattern: RegExp,
) {
  if (THROWERS.has(tool)) {
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

describe("a real project directory that cannot be read", () => {
  // `access()` failing is not the same as a file being absent. A project folder
  // that lost its execute bit — restored from a backup, copied from a
  // restrictive archive, an odd sandbox mount — still stats as a directory while
  // every probe inside it throws EACCES. Read as "absent" that becomes
  // no_project, and a write against a genuine project is dropped with a
  // cheerful message: the silent loss the half-a-project rule exists to prevent.
  // Skipped on Windows: chmod there does not clear a directory's read bit, so
  // access() succeeds and this never reaches the EACCES branch — it would pass
  // whether or not the distinction exists.
  it.skipIf(process.platform === "win32")("stays loud rather than claiming the folder is not a project", async () => {
    await writeResearch();
    await writeTree();
    await chmod(dir, 0o600);
    try {
      const r: any = await researchAppend({
        projectPath: dir, section: "sources", op: "append", entry: { id: "src_001" },
      } as any);
      expect(r.ok).toBe(false);
      expect(r.reason, "an unreadable project must not be reported as no_project").toBeUndefined();
    } finally {
      await chmod(dir, 0o700);
    }
  });
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

// Not a CALLS row: every CALLS row answers no_project with `ok: false`, and the
// builder answers it with `ok: true` — the URL still serves a standalone search
// outside a project; only the hand-off log entry is skipped (spec §6).
describe("build_external_search_url with projectPath", () => {
  const call = (projectPath: any) =>
    buildExternalSearchUrlTool({ site: "findagrave", attributes: { surname: "Flynn" }, projectPath });

  it("an empty directory returns the URL, no logId, and the write sentence as a note", async () => {
    const r = await call(dir);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.url).toMatch(/^https:\/\/www\.findagrave\.com\//);
    expect(r.logId).toBeUndefined();
    expect(r.notes).toContain(NO_PROJECT_MESSAGE_WRITE);
  });

  it("a directory that does not exist stays loud", async () => {
    const r = await call(join(dir, "no-such-folder"));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/projectPath does not exist/);
  });

  it("half a project stays loud", async () => {
    await writeTree();
    const r = await call(dir);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/research\.json not found in projectPath/);
  });
});

// ── derivation: CALLS is complete ───────────────────────────────────────────
//
// Issue #2480 item 3 — the CALLS roster above was hand-maintained, so a new
// project-reading tool that forgot `noProjectResult()` was uncovered.  This
// derivation test traces static imports from every tool source file and flags
// any tool that transitively reaches project-io / results-staging /
// image-store / project-store but is absent from CALLS.

import { readFileSync, existsSync } from "fs";
import { resolve, relative, dirname } from "path";
import { allToolSchemas } from "../../src/tool-schemas.js";

/** Modules whose import means the tool reads or writes project files. */
const PROJECT_MODULES = new Set([
  "utils/project-io",
  "utils/results-staging",
  "utils/image-store",
  "store/project-store",
]);

/**
 * Tools that transitively reach a project module but are deliberately NOT in
 * CALLS.  Each entry explains why it is exempt:
 *
 * - `build_external_search_url`: returns `ok: true` with a note, not
 *   `noProjectResult()` — the URL is still useful without a project; tested
 *   separately above.
 * - `record_search`: optional enrichment from project context; primary search
 *   works without a project.
 * - `fulltext_search`: stages results when inside a project; the search itself
 *   works without one.
 * - `person_read`: stages the read when inside a project; the read works
 *   without one.
 * - `record_read`: stages the read when inside a project; the read works
 *   without one.
 * - `external_links_search`: stages results optionally.
 * - `same_person`: reads project context optionally for enrichment.
 * - `rank_search_matches`: reads project context optionally for scoring.
 * - `person_quality`: reads tree optionally for quality scoring.
 * - `image_read`: saves source image optionally when inside a project.
 * - `project_create`: writes project files, but it creates them rather than
 *   reading existing ones.
 * - `volume_bisect`: imports browse-budget which classifies the project path
 *   for cap tracking; the bisect itself works without a project.
 * - `wiki_place_page`: imports the validator for enum checks, whose module
 *   imports `isInsideProject`; the page fetch works without a project.
 */
const OPTIONAL_PROJECT_TOOLS = new Set([
  "build_external_search_url",
  "record_search",
  "fulltext_search",
  "person_read",
  "record_read",
  "external_links_search",
  "same_person",
  "rank_search_matches",
  "person_quality",
  "image_read",
  "project_create",
  "volume_bisect",
  "wiki_place_page",
]);

const SRC_ROOT = resolve(__dirname, "../../src");

/** Extract relative-to-src import targets from a TS source file. */
function localImports(absPath: string): string[] {
  const src = readFileSync(absPath, "utf-8");
  const out: string[] = [];
  // Match value imports/re-exports only — skip `import type` and `export type`
  // which are erased at compile time and create no runtime dependency.
  for (const m of src.matchAll(/^(?!.*\b(?:import|export)\s+type\b).*\bfrom\s+["'](\.[^"']+)["']/gm)) {
    const specifier = m[1].replace(/\.js$/, "");
    const resolved = resolve(dirname(absPath), specifier);
    // Stay within src/.
    if (!resolved.startsWith(SRC_ROOT)) continue;
    // Try .ts extension.
    const tsPath = resolved + ".ts";
    if (existsSync(tsPath)) out.push(tsPath);
  }
  return out;
}

/** Return true if the transitive import closure of `startFile` reaches any PROJECT_MODULE. */
function reachesProjectModule(startFile: string): boolean {
  const visited = new Set<string>();
  const stack = [startFile];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);
    // Check if this file IS a project module.
    const rel = relative(SRC_ROOT, current).replace(/\\/g, "/").replace(/\.ts$/, "");
    if (PROJECT_MODULES.has(rel)) return true;
    for (const dep of localImports(current)) {
      if (!visited.has(dep)) stack.push(dep);
    }
  }
  return false;
}

/** Map each tool name in allToolSchemas to its source file(s) via tool-schemas.ts imports. */
function buildToolFileMap(): Map<string, string> {
  const schemasSrc = readFileSync(resolve(SRC_ROOT, "tool-schemas.ts"), "utf-8");
  // Parse import lines: `import { fooSchema } from "./tools/bar.js";`
  const importMap = new Map<string, string>(); // schemaVarName → absolute file path
  for (const m of schemasSrc.matchAll(/import\s*\{([^}]+)\}\s*from\s*["'](\.[^"']+)["']/g)) {
    const names = m[1].split(",").map((n) => n.trim().replace(/\s+as\s+\S+/, ""));
    const specifier = m[2].replace(/\.js$/, "");
    const absPath = resolve(SRC_ROOT, specifier + ".ts");
    for (const n of names) {
      if (n) importMap.set(n, absPath);
    }
  }
  const toolToFile = new Map<string, string>();
  // Cache each file's content once rather than re-reading per schema.
  const fileContents = new Map<string, string>();
  for (const file of new Set(importMap.values())) {
    try { fileContents.set(file, readFileSync(file, "utf-8")); } catch { /* skip */ }
  }
  for (const schema of allToolSchemas) {
    const name = (schema as any).name as string;
    for (const [file, content] of fileContents) {
      if (content.includes(`name: "${name}"`)) {
        toolToFile.set(name, file);
        break;
      }
    }
  }
  return toolToFile;
}

describe("CALLS roster derivation (issue #2480)", () => {
  const callsSet = new Set(CALLS.map((c) => c.tool));
  const toolFileMap = buildToolFileMap();

  it("every tool in allToolSchemas maps to a source file", () => {
    const unmapped: string[] = [];
    for (const schema of allToolSchemas) {
      const name = (schema as any).name as string;
      if (!toolFileMap.has(name)) unmapped.push(name);
    }
    expect(unmapped, "tools with no source file mapping").toEqual([]);
  });

  it("every derived project-reading tool is in CALLS or OPTIONAL_PROJECT_TOOLS", () => {
    const missing: string[] = [];
    for (const [tool, file] of toolFileMap) {
      if (reachesProjectModule(file) && !callsSet.has(tool) && !OPTIONAL_PROJECT_TOOLS.has(tool)) {
        missing.push(tool);
      }
    }
    expect(
      missing,
      "these tools transitively import a project module but are absent from " +
      "both CALLS and OPTIONAL_PROJECT_TOOLS — either add a CALLS row with a " +
      "noProjectResult() test, or document the exemption in OPTIONAL_PROJECT_TOOLS",
    ).toEqual([]);
  });

  it("every CALLS tool is genuinely derived as project-reading", () => {
    const notDerived: string[] = [];
    for (const tool of callsSet) {
      const file = toolFileMap.get(tool);
      if (!file || !reachesProjectModule(file)) notDerived.push(tool);
    }
    expect(
      notDerived,
      "these CALLS tools do not transitively reach a project module — " +
      "either the import chain changed or the tool no longer reads project files",
    ).toEqual([]);
  });

  it("every OPTIONAL_PROJECT_TOOLS entry is genuinely derived as project-reading", () => {
    const notDerived: string[] = [];
    for (const tool of OPTIONAL_PROJECT_TOOLS) {
      const file = toolFileMap.get(tool);
      if (!file || !reachesProjectModule(file)) notDerived.push(tool);
    }
    expect(
      notDerived,
      "these OPTIONAL_PROJECT_TOOLS entries do not transitively reach a " +
      "project module — remove them from the exclusion set",
    ).toEqual([]);
  });

  // Break proof: extraction_append reaches project-io through research-append,
  // and tree_correct reaches it through tree-edit.
  it("extraction_append is derived through research-append", () => {
    const file = toolFileMap.get("extraction_append")!;
    expect(file).toBeDefined();
    expect(reachesProjectModule(file)).toBe(true);
  });

  it("tree_correct is derived through tree-edit", () => {
    const file = toolFileMap.get("tree_correct")!;
    expect(file).toBeDefined();
    expect(reachesProjectModule(file)).toBe(true);
  });
});

import { describe, it, expect } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { allToolSchemas } from "../../src/tool-schemas.js";
import { RESEARCH_APPEND_SECTIONS } from "../../src/tools/research-append.js";
import { NOT_A_DOCUMENT_WRITER, OK_FALSE_IS_FAILURE } from "../../src/tool-result.js";
import { frontmatterBlock, listFromBlock, parseFrontmatter, scalarValue } from "./frontmatter.js";
import { HOOK_ROUTED_TOOL, agentWritableSections, researchAppendReaches, wholeSectionOwners } from "./hook-lanes.js";
import { grantedTools } from "./tool-names.js";

/**
 * The ownership manifest is the shared declaration of who may write each
 * section of the two project documents. It replaced a pair of dict literals
 * inside a pytest validator — a tier that runs in neither Cowork nor the
 * hosted path, and only inside a paid per-skill eval run even in the harness.
 *
 * **What this file guards is that the declaration is exhaustive and resolvable**,
 * not that any particular skill owns any particular section. The enforced
 * writer sets are frozen separately, by
 * `eval/harness/tests/unit/test_ownership_manifest.py`, so that deleting an
 * owner reddens a test rather than silently widening what is allowed.
 *
 * The exhaustiveness check is keyed on the **union** of three vocabularies,
 * because each of them alone leaves a hole:
 *
 *  - `research.schema.json`'s top-level properties — misses `plan_items`,
 *    which the tool defines and the schema does not.
 *  - `research_append`'s `section` enum — misses `log` (written by
 *    `research_log_append`, which takes no `section` at all) and
 *    `researcher_profile` (which no tool can write).
 *  - `tree-gedcomx.schema.json`'s top-level properties — the second artifact,
 *    whose `sources` section is a different section from research.json's
 *    `sources` with a different writer set. Rows are keyed on the pair.
 *
 * Replayed against the committed corpus before promotion, the gap between the
 * first two vocabularies was the single largest source of wrong denials: four
 * keys existed on one side only, and they accounted for 1,307 of the 1,314
 * no-owner denials.
 */

const here = dirname(fileURLToPath(import.meta.url));
const mcpRoot = join(here, "..", "..");
const projectRoot = join(mcpRoot, "..", "..", "..");
const pluginRoot = join(projectRoot, "packages", "engine", "plugin");

interface OwnershipRow {
  artifact: string;
  section: string;
  owner: string | null;
  reason?: string;
  callers: string[];
  writerTools: string[];
  enforceableAt: string[];
  requires: string;
  failure: string;
  remedy: string;
  override: string;
  notes?: string;
  hookCallers?: string[];
  agentCallers?: AgentCaller[];
  /**
   * Writer tools the unit plane authorizes on this row by tool identity —
   * whoever calls them, provided the delta is that tool's own structural write
   * (`harness/ownership.py:writer_tool_sets`).
   */
  toolAuthorized?: string[];
}

/**
 * A non-owner agent writer, paired with the writer tools it reaches the row
 * with. The pairing is what stops a row's OTHER writer tools from counting the
 * agent as listed for them too.
 */
interface AgentCaller {
  agent: string;
  tools: string[];
}

const manifest = JSON.parse(
  readFileSync(join(projectRoot, "docs", "specs", "schemas", "ownership.json"), "utf8"),
) as { version: number; enforcementPlanes: Record<string, string>; rows: OwnershipRow[] };

const researchSchema = JSON.parse(
  readFileSync(join(projectRoot, "docs", "specs", "schemas", "research.schema.json"), "utf8"),
) as { properties: Record<string, unknown> };

const treeSchema = JSON.parse(
  readFileSync(join(projectRoot, "docs", "specs", "schemas", "tree-gedcomx.schema.json"), "utf8"),
) as { properties: Record<string, unknown> };

const rows = manifest.rows;
const key = (r: { artifact: string; section: string }) => `${r.artifact}#${r.section}`;

/**
 * Tools in `OK_FALSE_IS_FAILURE` that write neither project document.
 *
 * The subtraction is what makes the actual-writer guard's left-hand set
 * independent of the manifest. Reading the writer-tool vocabulary out of the
 * manifest's own `writerTools` would compare the manifest to itself exactly
 * where it matters most: a newly shipped writer tool granted to an agent, on a
 * row that lists it nowhere, would never enter the comparison at all and the
 * guard would report a confident zero.
 *
 * Adding a tool to `OK_FALSE_IS_FAILURE` therefore forces a decision here —
 * either it writes a project document and needs a manifest row, or it is one of
 * these readers. A writer that reports failure some other way never enters
 * `OK_FALSE_IS_FAILURE`, so the vocabulary is also derived from the engine's
 * code — every tool whose module reaches a document write — and the two are
 * required to agree ("derives the writer vocabulary from the engine's own
 * document writes" below).
 *
 * The list lives in `src/tool-result.ts` beside `OK_FALSE_IS_FAILURE`, so the
 * corpus report (`writer_attribution_report.py`) reads the same vocabulary.
 */
const READERS = new Set<string>(NOT_A_DOCUMENT_WRITER);

/** Every tool the engine ships that writes research.json or tree.gedcomx.json. */
const WRITER_TOOLS: string[] = OK_FALSE_IS_FAILURE.filter((t) => !READERS.has(t));

const srcRoot = join(mcpRoot, "src");

/** Every `.ts` file under `dir`, recursively. */
function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? tsFiles(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : [],
  );
}

/** The two `project-io.ts` functions every project-document write goes through. */
const DOCUMENT_WRITE_CALL = /\b(?:atomicWriteJson|atomicWriteBoth)\s*\(/;

/**
 * `ProjectStore` write methods called outside `src/store/`, by file. Documents
 * must be written through `project-io.ts`; a store write anywhere else is a path
 * `DOCUMENT_WRITE_CALL` does not see.
 */
const STORE_WRITE_CALL = /\.(?:writeJson|writeJsonBoth|writeBytes|appendText)\s*\(|\.remove\s*\(\s*[A-Za-z_$]/;

/**
 * Files outside `src/store/` that call a store write method directly, and what
 * each writes. None of them writes research.json or tree.gedcomx.json.
 */
const NON_DOCUMENT_STORE_WRITERS: Readonly<Record<string, string>> = {
  "utils/project-io.ts": "the document writers themselves (atomicWriteJson, atomicWriteBoth)",
  "utils/results-staging.ts": "results/ sidecars and their staging files",
  "utils/image-store.ts": "images/ blobs and their pruning",
  "tools/rank-search-matches.ts": "the ranker's score log",
  "tools/research-log-append.ts": "removes the staged result it just logged",
};

/**
 * Tool names whose module reaches a project-document write through its imports.
 * Over-reads by construction — a module that imports a writer counts as one —
 * which fails closed.
 */
async function structuralWriterTools(): Promise<{ tools: string[]; direct: string[] }> {
  const files = tsFiles(srcRoot);
  const imports = new Map<string, string[]>();
  const direct = new Set<string>();
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    const specs = [
      ...text.matchAll(/(?:import|export)\s[^;]*?\sfrom\s+["'](\.[^"']+)["']/g),
      ...text.matchAll(/\bimport\(\s*["'](\.[^"']+)["']\s*\)/g),
    ].map((m) => join(dirname(f), m[1].replace(/\.js$/, ".ts")));
    imports.set(f, specs);
    if (DOCUMENT_WRITE_CALL.test(text) && !f.endsWith(join("utils", "project-io.ts"))) direct.add(f);
  }
  const reaches = (f: string, seen = new Set<string>()): boolean => {
    if (direct.has(f)) return true;
    if (seen.has(f)) return false;
    seen.add(f);
    return (imports.get(f) ?? []).some((d) => reaches(d, seen));
  };
  const schemas = new Set<unknown>(allToolSchemas);
  const tools: string[] = [];
  for (const f of files.filter((f) => f.startsWith(join(srcRoot, "tools")) && reaches(f))) {
    const mod: Record<string, unknown> = await import(pathToFileURL(f).href);
    for (const value of Object.values(mod)) {
      if (schemas.has(value)) tools.push((value as { name: string }).name);
    }
  }
  return {
    tools: [...new Set(tools)].sort(),
    direct: [...direct].map((f) => f.slice(srcRoot.length + 1).replace(/\\/g, "/")).sort(),
  };
}

interface PluginGrants {
  /** `agent:<name>` / `skill:<name>` → the WRITER tools it is granted. */
  byHolder: Map<string, Set<string>>;
  /** Same keys → how many tool entries were parsed at all, writer or not. */
  entriesParsed: Map<string, number>;
  /** Holders whose frontmatter actually carries the key the scan reads. */
  declaresKey: Set<string>;
  /** Files the scan could not read at all — each a test failure, not a crash. */
  problems: string[];
  /** Tool-list keys spelled some way the runtime and this scan do not read. */
  misspelledKeys: string[];
  /** Each holder's frontmatter block, extracted once and shared by every check. */
  blocks: Map<string, string>;
}

/** The tool-list keys each kind of plugin file may carry, spelled exactly. */
const TOOL_LIST_KEYS = {
  agent: ["tools", "disallowedTools"],
  skill: ["allowed-tools", "disallowed-tools"],
} as const;

/**
 * Frontmatter keys that are a tool-list key under some other spelling
 * (`allowedTools:`, `Tools:`, `disallowed_tools:`). The scan reads the exact
 * key only, so a variant reads as "declares none" and passes the guard.
 */
function misspelledToolKeys(keys: readonly string[], allowed: readonly string[]): string[] {
  const wanted = new Set(["tools", "allowedtools", "disallowedtools"]);
  return keys.filter(
    (k) => wanted.has(k.toLowerCase().replace(/[-_]/g, "")) && !allowed.includes(k),
  );
}

/**
 * What the shipped plugin actually hands out: the writer tools named by each
 * agent's `tools:` and each skill's `allowed-tools:` frontmatter.
 *
 * This is the reading the manifest is checked AGAINST, so it deliberately
 * touches no part of the manifest. Two ways this scan can read nothing are
 * silent, and a silent zero here PASSES the guard rather than failing it: a
 * `tools:` list the parser reads as empty (`entriesParsed` catches that), and a
 * tool-list key under another spelling (`misspelledKeys` catches that). A file
 * that cannot be read at all lands in `problems` rather than throwing, so one
 * malformed file fails one test instead of the whole module.
 */
function readPluginGrants(root: string = pluginRoot): PluginGrants {
  const writers = new Set<string>(WRITER_TOOLS);
  const byHolder = new Map<string, Set<string>>();
  const entriesParsed = new Map<string, number>();
  const declaresKey = new Set<string>();
  const problems: string[] = [];
  const misspelledKeys: string[] = [];
  const blocks = new Map<string, string>();

  // Every read goes through here, so a file that cannot be read, or a
  // directory where a file should be, is a `problems` entry — one failing
  // test — instead of an exception at module load that takes every test here
  // down with it.
  const read = (label: string, fn: () => string): string | null => {
    try {
      return fn();
    } catch (e) {
      problems.push(`${label}: ${(e as Error).message}`);
      return null;
    }
  };
  const list = (label: string, dir: string) => {
    try {
      return readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      problems.push(`${label}: ${(e as Error).message}`);
      return [];
    }
  };

  const record = (holder: string, key: string, text: string) => {
    const kind = holder.startsWith("agent:") ? "agent" : "skill";
    // The block is extracted once per file and kept, so the other readings of
    // this file (tool list, key spellings, the name check) share one parse.
    const block = frontmatterBlock(text);
    if (block === null) {
      problems.push(`${holder}: no YAML frontmatter`);
      return;
    }
    blocks.set(holder, block);
    let held: Set<string>;
    let entries: string[];
    let keys: string[];
    try {
      keys = Object.keys(parseFrontmatter(block));
      entries = listFromBlock(block, key);
      // An agent with no `tools:` key inherits every tool the session holds,
      // so it holds every writer — the broadest grant there is, not none.
      // A skill with no `allowed-tools:` declares nothing, truthfully.
      const inherits = kind === "agent" && !keys.includes(key);
      held = new Set(
        (inherits ? [...WRITER_TOOLS] : entries.flatMap((e) => grantedTools(e, WRITER_TOOLS))).filter(
          (t) => writers.has(t),
        ),
      );
    } catch (e) {
      problems.push(`${holder}: ${(e as Error).message}`);
      return;
    }
    for (const k of misspelledToolKeys(keys, TOOL_LIST_KEYS[kind])) {
      misspelledKeys.push(`${holder}: '${k}:'`);
    }
    entriesParsed.set(holder, entries.length);
    // The key's PRESENCE in the parsed frontmatter only: a body that happens to
    // contain the string would make every holder look like a declarer.
    if (keys.includes(key)) declaresKey.add(holder);
    if (held.size > 0) byHolder.set(holder, held);
  };

  for (const entry of list("agents/", join(root, "agents"))) {
    if (!entry.name.endsWith(".md")) continue;
    const holder = `agent:${entry.name.slice(0, -3)}`;
    const text = read(holder, () => readFileSync(join(root, "agents", entry.name), "utf8"));
    if (text !== null) record(holder, "tools", text);
  }

  for (const entry of list("skills/", join(root, "skills"))) {
    if (!entry.isDirectory()) continue;
    const skillMd = join(root, "skills", entry.name, "SKILL.md");
    if (!existsSync(skillMd)) continue;
    const holder = `skill:${entry.name}`;
    // `allowed-tools:` only, never the whole frontmatter. `forget-and-rederive`'s
    // `description:` names `tree_correct` and `merge_tree_persons` in a "do NOT
    // use this, use that" clause, so a frontmatter-wide word match reports it as
    // a holder of two tools it does not hold (proven 2026-09-23: exactly those
    // two false positives).
    const text = read(holder, () => readFileSync(skillMd, "utf8"));
    if (text !== null) record(holder, "allowed-tools", text);
  }

  return { byHolder, entriesParsed, declaresKey, problems, misspelledKeys, blocks };
}

const pluginGrants = readPluginGrants();

/**
 * Whether `row` names `holder` as a writer of it with `tool`.
 *
 * `callers` is a permission field and counts for every writer tool on its row —
 * that is what it means. `hookCallers` names the agent the plugin hook permits,
 * and the hook routes `research_append` alone, so it counts for that tool only.
 * An `agentCallers` entry counts only for the tools it names.
 */
function listedOn(holder: string, tool: string, row: OwnershipRow): boolean {
  if (!row.writerTools.includes(tool)) return false;
  if (row.callers.includes(holder)) return true;
  if (tool === HOOK_ROUTED_TOOL && (row.hookCallers ?? []).includes(holder)) return true;
  return (row.agentCallers ?? []).some((a) => a.agent === holder && a.tools.includes(tool));
}

const hookLanes = agentWritableSections();
const hookOwners = wholeSectionOwners();

/**
 * Whether `holder` can write `row` with `tool`, decided from the shipped files.
 *
 * A tool the row's `toolAuthorized` names is authorized there for every caller,
 * so `"identity"`: the row needs to name no holder for it. Every other writer
 * tool but `research_append` writes the rows its `writerTools` entries name —
 * the section is the tool's, not the caller's. `research_append` writes the
 * section its op names: for an agent the hook confines that to its lane and to
 * sections not routed to another agent; for a skill nothing static confines
 * it, so `null` — which rows a skill writes with it is the unit plane's runtime
 * check (`test_ownership_table`), and its `callers` rows are the declaration
 * that check enforces.
 */
function reaches(holder: string, tool: string, row: OwnershipRow): boolean | null | "identity" {
  if (!row.writerTools.includes(tool)) return false;
  if ((row.toolAuthorized ?? []).includes(tool)) return "identity";
  if (tool !== HOOK_ROUTED_TOOL) return true;
  if (!holder.startsWith("agent:")) return null;
  return researchAppendReaches(holder.slice("agent:".length), row, hookLanes, hookOwners);
}

/** Every (artifact, section) pair that must have exactly one row. */
function expectedKeys(): string[] {
  const research = new Set<string>([
    ...Object.keys(researchSchema.properties),
    ...RESEARCH_APPEND_SECTIONS,
  ]);
  const tree = new Set<string>(Object.keys(treeSchema.properties));
  return [
    ...[...research].map((s) => `research.json#${s}`),
    ...[...tree].map((s) => `tree.gedcomx.json#${s}`),
  ].sort();
}

describe("ownership manifest — exhaustiveness", () => {
  it("has exactly one row per writable section of both project documents", () => {
    const declared = rows.map(key).sort();
    const expected = expectedKeys();

    const missing = expected.filter((k) => !declared.includes(k));
    const extra = declared.filter((k) => !expected.includes(k));

    expect(
      missing,
      "sections with no ownership row — an undeclared section is one nothing can " +
        "reason about, and default-deny on it denies writes that are correct",
    ).toEqual([]);
    expect(
      extra,
      "rows for a section that is in neither schema nor research_append's `section` " +
        "enum — a renamed or deleted section leaves the row behind",
    ).toEqual([]);
  });

  it("has no duplicate (artifact, section) row", () => {
    const seen = new Map<string, number>();
    for (const r of rows) seen.set(key(r), (seen.get(key(r)) ?? 0) + 1);
    const duped = [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k);
    expect(duped, "two rows for one section — one of them is dead").toEqual([]);
  });
});

describe("ownership manifest — every row is complete", () => {
  it("carries every required field, non-empty", () => {
    const bad: string[] = [];
    for (const r of rows) {
      for (const field of ["artifact", "section", "requires", "failure", "remedy", "override"] as const) {
        if (typeof r[field] !== "string" || r[field].trim() === "") {
          bad.push(`${key(r)}: ${field} missing or empty`);
        }
      }
      for (const field of ["callers", "writerTools", "enforceableAt"] as const) {
        if (!Array.isArray(r[field])) bad.push(`${key(r)}: ${field} is not an array`);
      }
      if (!("owner" in r)) bad.push(`${key(r)}: no owner field (use null to declare it unowned)`);
    }
    expect(bad).toEqual([]);
  });

  it("gives every unowned row a stated reason", () => {
    // The distinction this holds open is unowned-BY-DECISION versus
    // unowned-by-accident. An invented owner reads as coverage; a null owner
    // with no reason reads as an oversight. Only the pair is honest.
    const bad = rows
      .filter((r) => r.owner === null)
      .filter((r) => typeof r.reason !== "string" || r.reason.trim().length < 40)
      .map((r) => key(r));
    expect(
      bad,
      "a row may declare `owner: null`, but only with a substantive `reason` " +
        "saying why nobody owns it",
    ).toEqual([]);
  });

  it("does not put a reason on an owned row", () => {
    const bad = rows.filter((r) => r.owner !== null && r.reason !== undefined).map((r) => key(r));
    expect(bad, "`reason` explains an absent owner; an owned row states its rule in `requires`").toEqual([]);
  });
});

describe("ownership manifest — every name resolves", () => {
  /** `skill:<name>` → a real skill directory; `agent:<name>` → a real agent file. */
  function resolves(identifier: string): boolean {
    if (identifier.startsWith("skill:")) {
      return existsSync(join(pluginRoot, "skills", identifier.slice(6), "SKILL.md"));
    }
    if (identifier.startsWith("agent:")) {
      return existsSync(join(pluginRoot, "agents", `${identifier.slice(6)}.md`));
    }
    return false;
  }

  it("resolves every owner to a shipped skill or agent", () => {
    // 49 writes in the committed corpus are attributed to
    // `assertion-classification`, a skill that stopped shipping when extraction
    // absorbed it. This is the check that keeps a name like that out of the
    // declaration once it is gone.
    const bad = rows
      .filter((r) => r.owner !== null)
      .filter((r) => !resolves(r.owner as string))
      .map((r) => `${key(r)}: owner '${r.owner}'`);
    expect(
      bad,
      "an owner must be `skill:<dir under packages/engine/plugin/skills>` or " +
        "`agent:<file under packages/engine/plugin/agents>`",
    ).toEqual([]);
  });

  it("resolves every caller to a shipped skill or agent", () => {
    // All three caller fields, because the actual-writer guard below reads all
    // three as the permitted set — so a name that has stopped shipping widens it
    // from any of them.
    const bad: string[] = [];
    for (const r of rows) {
      for (const [field, list] of [
        ["callers", r.callers],
        ["hookCallers", r.hookCallers ?? []],
        ["agentCallers", (r.agentCallers ?? []).map((a) => a.agent)],
      ] as const) {
        for (const c of list) if (!resolves(c)) bad.push(`${key(r)}: ${field} '${c}'`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("puts only agents in agentCallers", () => {
    const bad: string[] = [];
    for (const r of rows) {
      for (const { agent } of r.agentCallers ?? []) {
        if (!agent.startsWith("agent:")) bad.push(`${key(r)}: agentCallers '${agent}'`);
      }
    }
    expect(
      bad,
      "`agentCallers` records which AGENTS write a row. A skill writer goes in " +
        "`callers`, the field the unit plane reads.",
    ).toEqual([]);
  });

  it("keeps a non-owner agent out of callers", () => {
    // One rule, not two. `callers` is what `harness/ownership.py:writer_sets`
    // reads, and an agent there on a unit-plane row raises
    // OwnershipManifestError outright — so a non-owner agent has to live
    // elsewhere on those rows anyway. Letting it sit in `callers` on the rows
    // that claim no plane would make the placement depend on `enforceableAt`,
    // and a two-rule placement is where the next drift hides. The owner is the
    // exception because a row must list its own owner among its callers.
    const bad: string[] = [];
    for (const r of rows) {
      for (const c of r.callers) {
        if (c.startsWith("agent:") && c !== r.owner) bad.push(`${key(r)}: caller '${c}'`);
      }
    }
    expect(
      bad,
      "a non-owner agent goes in `agentCallers` (or `hookCallers` where the row " +
        "claims the hook plane), never in `callers`",
    ).toEqual([]);
  });

  it("declares a row for every writer tool the engine ships", () => {
    // The vocabulary half of the guard below. Without it a writer tool that no
    // row mentions at all falls outside the comparison entirely: the agent
    // holding it is compared against nothing and reads as listed.
    expect(
      WRITER_TOOLS.length,
      "no writer tools left after subtracting NOT_A_DOCUMENT_WRITER from " +
        "OK_FALSE_IS_FAILURE (both in src/tool-result.ts) — the guard below is comparing against an empty set",
    ).toBeGreaterThan(0);

    const declared = new Set<string>(rows.flatMap((r) => r.writerTools));
    const shipped = new Set<string>(WRITER_TOOLS);
    expect(
      [...shipped].filter((tool) => !declared.has(tool)).sort(),
      "these tools write a project document and no ownership row names them as a " +
        "writer of anything — add the row's `writerTools` entry, or add the tool " +
        "to NOT_A_DOCUMENT_WRITER in src/tool-result.ts if it turns out to write neither document",
    ).toEqual([]);
    expect(
      [...declared].filter((tool) => !shipped.has(tool)).sort(),
      "the manifest calls these writer tools and the engine does not: each is " +
        "either missing from OK_FALSE_IS_FAILURE in src/tool-result.ts (a " +
        "writer's `ok: false` IS its own failure) or wrongly listed in " +
        "NOT_A_DOCUMENT_WRITER there",
    ).toEqual([]);
  });

  /**
   * The direction issue #2575 was filed about. Every other check here runs
   * listed -> exists; none runs exists -> listed. `record-extractor` held
   * `research_log_append` under all three spellings, called it 12 times across 9
   * committed runs, and appeared in no row's callers for as long as that was
   * true.
   *
   * Two readings that must agree, the same shape as the `merge_tree_persons`
   * check below: the plugin's grants on one side, the manifest's permitted
   * callers on the other. The left-hand set has to come from the plugin — a
   * guard that derived "actual writers" from the manifest's own `writerTools`
   * would compare the manifest to itself, pass green, and check nothing.
   *
   * **It is per ROW.** For each (holder, writer tool) the rows the manifest
   * names the holder on must equal the rows the tool can reach for it. Every
   * writer tool but `research_append` reaches every row whose `writerTools`
   * lists it; an agent's `research_append` reaches the rows the plugin hook
   * leaves it (its lane, minus sections routed to another agent). A skill's
   * `research_append` is confined by nothing static, so for that pair the
   * check asks only that some row names it; which rows it writes is the unit
   * plane's runtime check against `callers`.
   *
   * What a row lists for a holder differs by field. `callers` is a permission,
   * so it counts for every writer tool on the row. `hookCallers` is the hook's
   * permission, and the hook routes `research_append` alone, so it counts for
   * that tool only: an agent granted `merge_tree_persons` is not listed for it
   * by a hook row that happens to list it. An `agentCallers` entry names its
   * tools, and counts only for those: an agent
   * observed writing tree `persons` with `extraction_append` is not thereby
   * listed for the row's seven other tree writers, so a new tree-writer grant to
   * it reds here until the manifest names that tool for it.
   *
   * The skill half reads the DECLARED grant. `allowed-tools:` is a grant, not a
   * restriction (CLAUDE.md), so a skill body that calls a tool it never declared
   * is invisible to any frontmatter read; catching that call is
   * `test_tool_allowlist`'s job (`eval/harness/validators/test_universal.py`),
   * advisory in the unit tier.
   */
  it("reads every plugin file's frontmatter", () => {
    expect(
      pluginGrants.problems,
      "these plugin files could not be read, so their grants are missing from " +
        "every comparison below",
    ).toEqual([]);
  });

  it("turns every unreadable plugin file into a problem, and reads a wildcard or a missing tools: as every writer", () => {
    // Built on a scratch tree, so the breaks can be real without touching the
    // shipped plugin — where a directory named `x.md` would crash other suites
    // at collection before this one could say anything.
    const root = mkdtempSync(join(tmpdir(), "ownership-grants-"));
    const md = (...lines: string[]) => ["---", ...lines, "---", ""].join("\n");
    try {
      mkdirSync(join(root, "agents", "is-a-dir.md"), { recursive: true });
      writeFileSync(join(root, "agents", "no-frontmatter.md"), "no frontmatter here");
      writeFileSync(
        join(root, "agents", "quoted-name.md"),
        md('name: "quoted-name"  # a note', "tools:", "  - mcp__genealogy__tree_forget"),
      );
      writeFileSync(
        join(root, "agents", "wildcard.md"),
        md("name: wildcard", "tools:", "  - mcp__genealogy__*"),
      );
      writeFileSync(join(root, "agents", "no-tools-key.md"), md("name: no-tools-key"));
      writeFileSync(
        join(root, "agents", "foreign-wildcard.md"),
        md("name: foreign-wildcard", "tools:", "  - mcp__claude-in-chrome__*"),
      );
      // No `skills/` directory at all.
      const scan = readPluginGrants(root);

      expect(scan.problems.some((p) => p.startsWith("agent:is-a-dir:"))).toBe(true);
      expect(scan.problems).toContain("agent:no-frontmatter: no YAML frontmatter");
      expect(scan.problems.some((p) => p.startsWith("skills/:"))).toBe(true);
      expect([...(scan.byHolder.get("agent:wildcard") ?? [])].sort()).toEqual(
        [...WRITER_TOOLS].sort(),
      );
      // An agent with no `tools:` inherits every tool, so it holds every writer.
      expect([...(scan.byHolder.get("agent:no-tools-key") ?? [])].sort()).toEqual(
        [...WRITER_TOOLS].sort(),
      );
      // Another server's wildcard grants none of these tools: it is not read as
      // every writer, and it fails as an unrecognized prefix like any other entry.
      expect(scan.byHolder.has("agent:foreign-wildcard")).toBe(false);
      expect(
        scan.problems.some((p) => p.startsWith("agent:foreign-wildcard:") && p.includes("no recognized server prefix")),
      ).toBe(true);
      expect(scalarValue(scan.blocks.get("agent:quoted-name") ?? "", "name")).toBe("quoted-name");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("spells every tool-list key the way its reader does", () => {
    // Agents: `tools` / `disallowedTools`. Skills: `allowed-tools` /
    // `disallowed-tools`. Anything else reads as "declares none" and passes.
    expect(
      pluginGrants.misspelledKeys,
      "a tool-list key under another spelling is read by nothing — neither the " +
        "runtime nor this guard",
    ).toEqual([]);
  });

  it("names every plugin holder of a writer tool", () => {
    // Both readings that can silently return nothing here produce a clean zero
    // rather than an error, so each is asserted non-empty before the comparison.
    expect(
      pluginGrants.entriesParsed.size,
      "no agent or skill frontmatter parsed at all — the plugin tree moved and " +
        "this guard is comparing an empty set against the manifest",
    ).toBeGreaterThan(0);
    // Keyed on whether the FILE carries the key, not on agent-vs-skill. Two
    // skills legitimately declare no `allowed-tools`, so a blanket assertion
    // would be wrong — but skipping every skill leaves the skill half of the
    // scan with the same silent-zero hole the agent half exists to close.
    for (const [holder, count] of pluginGrants.entriesParsed) {
      if (!pluginGrants.declaresKey.has(holder)) continue; // declares none, truthfully
      const key = holder.startsWith("agent:") ? "tools" : "allowed-tools";
      expect(
        count,
        `${holder}: its frontmatter declares ${key}: and the scan read zero ` +
          `entries from it. A leading "#" comment block inside the list is the ` +
          `live shape that does this, and it leaves this guard reading nothing.`,
      ).toBeGreaterThan(0);
    }
    // Three known grants, one per parse path, so a scan that returns entries but
    // the wrong ones cannot pass either. Membership, not an exact set: the exact
    // per-agent list is already pinned by AGENT_PERMISSIONS in
    // agent-tool-names.test.ts, and pinning it twice would make a legitimate new
    // grant red HERE first — masking the unlisted comparison below, which is the
    // assertion that actually has something to say about it.
    for (const tool of ["extraction_append", "research_log_append"]) {
      expect([...(pluginGrants.byHolder.get("agent:record-extractor") ?? [])]).toContain(tool);
    }
    expect([...(pluginGrants.byHolder.get("skill:record-extraction") ?? [])]).toContain(
      "research_log_append",
    );
    expect([...(pluginGrants.byHolder.get("skill:forget-and-rederive") ?? [])]).toContain(
      "tree_forget",
    );

    const missing: string[] = [];
    const extra: string[] = [];
    for (const holder of [...pluginGrants.byHolder.keys()].sort()) {
      for (const tool of [...(pluginGrants.byHolder.get(holder) as Set<string>)].sort()) {
        const reach = rows
          .map((r) => [r, reaches(holder, tool, r)] as const)
          .filter(([, v]) => v !== "identity");
        const listed = reach.filter(([r]) => listedOn(holder, tool, r)).map(([r]) => key(r));
        if (reach.some(([, v]) => v === null)) {
          // A skill's research_append: listed somewhere is all a static read can ask.
          if (listed.length === 0) missing.push(`${holder} holds ${tool}: listed on no row`);
          continue;
        }
        const reachable = reach.filter(([, v]) => v === true).map(([r]) => key(r));
        for (const k of reachable) if (!listed.includes(k)) missing.push(`${holder} -> ${tool} on ${k}`);
        for (const k of listed) if (!reachable.includes(k)) extra.push(`${holder} -> ${tool} on ${k}`);
      }
    }
    expect(
      missing,
      "the plugin grants these writer tools, each reaches the row named, and the " +
        "row does not name the holder for it. Either the manifest is missing a " +
        "writer — a skill goes in `callers`, a non-owner agent in `agentCallers` " +
        "with the tool in its `tools` — or the grant should come out of the " +
        "frontmatter. Do not close it by dropping the tool from a row's " +
        "`writerTools`: that under-states what the tool writes.",
    ).toEqual([]);
    expect(
      extra,
      "these rows name a holder for a writer tool that cannot reach them — the " +
        "plugin hook confines the agent's research_append elsewhere. Drop the " +
        "tool from the entry, or give the agent's lane the section.",
    ).toEqual([]);
  });

  it("derives the writer vocabulary from the engine's own document writes", async () => {
    // `OK_FALSE_IS_FAILURE` minus `NOT_A_DOCUMENT_WRITER` is the vocabulary
    // every check here reads, and it rests on a rule about failure reporting,
    // not about writing. This reads writing directly: every tool whose module
    // reaches an `atomicWriteJson` / `atomicWriteBoth` call through its imports.
    const { tools, direct } = await structuralWriterTools();
    expect(direct.length, "found no module that calls a document writer").toBeGreaterThan(0);
    expect(
      tools,
      "the tools whose code writes a project document and the writer-tool " +
        "vocabulary disagree. A tool here and not in OK_FALSE_IS_FAILURE is a " +
        "writer this guard cannot see; a tool there and not here writes nothing " +
        "and belongs in NOT_A_DOCUMENT_WRITER (both in src/tool-result.ts).",
    ).toEqual([...WRITER_TOOLS].sort());
  });

  it("writes project state only through the known write paths", () => {
    // The vocabulary above sees document writes made through project-io.ts. A
    // store write anywhere else is a write path it does not see, so each one
    // outside src/store/ has to be named here with what it writes.
    const found: string[] = [];
    for (const f of tsFiles(srcRoot)) {
      const rel = f.slice(srcRoot.length + 1).replace(/\\/g, "/");
      if (rel.startsWith("store/")) continue;
      if (STORE_WRITE_CALL.test(readFileSync(f, "utf8"))) found.push(rel);
    }
    expect(found.length, "found no store write outside src/store/").toBeGreaterThan(0);
    expect(
      found.sort(),
      "a file outside src/store/ calls a ProjectStore write method. Route a " +
        "research.json or tree.gedcomx.json write through atomicWriteJson / " +
        "atomicWriteBoth in utils/project-io.ts; add any other write to " +
        "NON_DOCUMENT_STORE_WRITERS with what it writes.",
    ).toEqual(Object.keys(NON_DOCUMENT_STORE_WRITERS).sort());
  });

  it("names each agent the same way on both sides of the manifest", () => {
    // This file keys an agent by its FILENAME (`resolves()` and the grant scan
    // above both do); `eval/harness/e2e/writer_attribution_report.py` keys it by
    // the frontmatter `name`, through `declared_tools_by_agent`. They agree for
    // all seven shipped agents and nothing but coincidence made them. Let them
    // diverge and the corpus report misfiles a shipped agent as an UNBOUND
    // DELEGATION — the #939 class it states no manifest edit can ever close.
    // Reuses the grant scan's one pass over the agents, and reads `name:` the
    // way YAML does — `name: "x"` and `name: x  # note` are both `x`, as they
    // are to the Python reader's `yaml.safe_load`.
    const bad: string[] = [];
    const agents = [...pluginGrants.blocks].filter(([holder]) => holder.startsWith("agent:"));
    expect(agents.length, "the grant scan read no agent frontmatter").toBeGreaterThan(0);
    for (const [holder, block] of agents) {
      const declared = scalarValue(block, "name");
      if (declared !== holder.slice("agent:".length)) {
        bad.push(`${holder}: frontmatter name '${declared}'`);
      }
    }
    expect(
      bad,
      "an agent's frontmatter `name` must equal its filename stem, or the " +
        "manifest's two readers disagree about what to call it",
    ).toEqual([]);
  });

  it("pairs every agentCallers entry with tools it holds and its row lists", () => {
    // The stale half of the same declaration. A row keeps naming a tool for an
    // agent after the grant that put it there is gone, and the guard above
    // cannot see it — that one only walks grants the plugin still has. A tool
    // the row does not list pairs the agent with nothing it can write here, and
    // an empty list is an entry that counts for no tool at all.
    const bad: string[] = [];
    for (const r of rows) {
      for (const { agent, tools } of r.agentCallers ?? []) {
        if (tools.length === 0) bad.push(`${key(r)}: agentCallers '${agent}' names no tools`);
        const held = pluginGrants.byHolder.get(agent) ?? new Set<string>();
        for (const tool of tools) {
          if (!r.writerTools.includes(tool)) {
            bad.push(`${key(r)}: agentCallers '${agent}' names ${tool}, which the row does not list`);
          } else if (!held.has(tool)) {
            bad.push(`${key(r)}: agentCallers '${agent}' names ${tool}, which it is not granted`);
          }
        }
      }
    }
    expect(
      bad,
      "each `agentCallers` entry must name at least one writer tool, and only " +
        "tools its row lists and the agent's `tools:` still grants",
    ).toEqual([]);
  });

  it("authorizes by tool identity only tools the row lists", () => {
    // `toolAuthorized` exempts every holder of the tool from needing a caller
    // entry on the row, so a tool there that the row does not list as a writer
    // would exempt a write the row never declared.
    const bad: string[] = [];
    for (const r of rows) {
      for (const t of r.toolAuthorized ?? []) {
        if (!r.writerTools.includes(t)) bad.push(`${key(r)}: toolAuthorized '${t}' is not in writerTools`);
      }
    }
    expect(bad).toEqual([]);
    expect(
      rows.some((r) => (r.toolAuthorized ?? []).length > 0),
      "no row declares toolAuthorized — the unit plane's tool-identity paths read nothing",
    ).toBe(true);
  });

  it("lists a non-null owner among its own callers", () => {
    // `callers` is the set the checks enforce. An owner outside it is a
    // declaration that the owning skill may not write its own section.
    const bad = rows
      .filter((r) => r.owner !== null && !r.callers.includes(r.owner as string))
      .map((r) => `${key(r)}: owner '${r.owner}' not in callers`);
    expect(bad).toEqual([]);
  });

  it("resolves every writer tool to a registered tool name", () => {
    const registered = new Set(allToolSchemas.map((s) => s.name));
    const bad: string[] = [];
    for (const r of rows) {
      for (const t of r.writerTools) {
        if (!registered.has(t)) bad.push(`${key(r)}: writerTool '${t}'`);
      }
    }
    expect(
      bad,
      "a writer tool must be a name in allToolSchemas — a renamed or retired " +
        "tool leaves the remedy text pointing at a call that cannot be made",
    ).toEqual([]);
  });

  it("names only declared enforcement planes", () => {
    const planes = new Set(Object.keys(manifest.enforcementPlanes));
    const bad: string[] = [];
    for (const r of rows) {
      for (const p of r.enforceableAt) {
        if (!planes.has(p)) bad.push(`${key(r)}: enforceableAt '${p}'`);
      }
    }
    expect(bad, `declared planes: ${[...planes].join(", ")}`).toEqual([]);
  });

  it("does not claim a plane for a row with no writers at all", () => {
    // A row nobody may write cannot be enforced: there is no correct call for
    // the check to permit, so claiming a plane overstates coverage.
    const bad = rows
      .filter((r) => r.callers.length === 0 && r.enforceableAt.length > 0)
      .map((r) => key(r));
    expect(bad).toEqual([]);
  });
  /**
   * Item 4 of issue #1790's ruling: the manifest's `writerTools` must match what
   * the named tool's source actually writes.
   *
   * `ownership-manifest.test.ts` and `test_ownership_manifest.py` between them
   * check that the declaration is exhaustive, resolvable and unchanged. Neither
   * checked it against the code, so a tool silently gaining a cross-file write —
   * or the manifest silently missing one it already has — was invisible to both.
   * That is the `nothing-checks` half of #1790.
   *
   * `merge_tree_persons` repoints every research.json reference to a collapsed
   * person through `remapResearchPersonIds`, which walks `iteratePersonIdRefs` —
   * the single source of the field set, shared with the validator so "the field
   * set can never drift" (merge-shared.ts). This reads that walker's own `field:`
   * literals and requires a manifest row for each.
   *
   * **It found one on the day it was written.** The ruling named four sections;
   * the walker yields five. `proof_summaries` carries person refs, is
   * `enforceableAt: ["unit", "hook"]`, and listed only `research_append` — so a
   * merge that touched a proof summary's person ref would have been denied by the
   * very plane this work is fixing.
   */
  it("declares every research.json section merge_tree_persons actually writes", () => {
    const walker = readFileSync(
      join(mcpRoot, "src", "validation", "person-id-refs.ts"),
      "utf8",
    );
    // Two readings that must agree. The quoted `field:` literals are what the
    // walker demonstrably yields; `PersonIdRefField` is what it is ALLOWED to
    // yield, and every yield site is typed against it. Scraping only the
    // literals misses a field yielded through a variable — `field: HYP` where
    // `const HYP: PersonIdRefField = "hypotheses"` — which type-checks, adds a
    // sixth section, and leaves this guard green. Requiring the two sets to
    // match is what makes the literal scrape trustworthy rather than a subset.
    const fields = [...walker.matchAll(/\bfield:\s*"([a-z_]+)"/g)].map((m) => m[1]);
    const union = [
      ...(walker.match(/export type PersonIdRefField =([^;]+);/)?.[1] ?? "").matchAll(
        /"([a-z_]+)"/g,
      ),
    ].map((m) => m[1]);

    expect(
      fields.length,
      "no `field: \"...\"` literals found in person-id-refs.ts — the walker was " +
        "restructured and this guard is now reading nothing, which passes silently",
    ).toBeGreaterThan(0);
    expect(
      union.length,
      "could not read the `PersonIdRefField` union from person-id-refs.ts — the " +
        "guard's second reading is now empty and cannot disagree with the first",
    ).toBeGreaterThan(0);
    expect(
      union.filter((f) => !fields.includes(f)).sort(),
      "`PersonIdRefField` names a field no `field: \"...\"` literal yields — the " +
        "walker reaches it through a variable, so the literal scrape below is " +
        "reading a subset of what the tool actually writes",
    ).toEqual([]);
    expect(
      fields.filter((f) => !union.includes(f)).sort(),
      "a `field:` literal is not in the `PersonIdRefField` union — one of the two " +
        "readings is stale",
    ).toEqual([]);

    // The walker names the FIELD; `subject_person_ids` lives inside `project`.
    const sectionOf = (f: string) => (f === "subject_person_ids" ? "project" : f);
    const written = new Set(union.map(sectionOf));

    const declared = new Set(
      rows
        .filter(
          (r) =>
            r.artifact === "research.json" &&
            r.writerTools.includes("merge_tree_persons"),
        )
        .map((r) => r.section),
    );

    const undeclared = [...written].filter((s) => !declared.has(s)).sort();
    const overdeclared = [...declared].filter((s) => !written.has(s)).sort();

    expect(
      undeclared,
      "merge_tree_persons writes these research.json sections but the manifest " +
        "does not list it as a writer of them — the unit plane will deny a real " +
        "merge on exactly these",
    ).toEqual([]);
    expect(
      overdeclared,
      "the manifest lists merge_tree_persons as a writer of these sections but " +
        "the tool no longer writes them — a grant wider than the code",
    ).toEqual([]);
  });
});

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { allToolSchemas } from "../../src/tool-schemas.js";
import { RESEARCH_APPEND_SECTIONS } from "../../src/tools/research-append.js";
import { OK_FALSE_IS_FAILURE } from "../../src/tool-result.js";
import { extractList, frontmatterBlock } from "./frontmatter.js";

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
}

/**
 * An observed non-owner agent writer, paired with the writer tools it writes the
 * row with. The pairing is what stops a row's OTHER writer tools from counting
 * the agent as listed for them too.
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
 * these readers. **That is the floor, and it is one list-membership lower than
 * it looks:** `OK_FALSE_IS_FAILURE`'s own rule is "the call could not do what
 * was asked", not "the tool writes", so a writer that reports failure some other
 * way is invisible to this guard exactly as it is to the manifest.
 */
const NOT_A_DOCUMENT_WRITER = new Set([
  "convert_calendar",
  "build_external_search_url",
  "research_query",
  "project_context",
  "sidecar_read",
]);

/** Every tool the engine ships that writes research.json or tree.gedcomx.json. */
const WRITER_TOOLS = OK_FALSE_IS_FAILURE.filter((t) => !NOT_A_DOCUMENT_WRITER.has(t));

/** `mcp__<server>__<tool>` → `<tool>`; a built-in (`Read`) passes through. */
function bareToolName(entry: string): string {
  return entry.startsWith("mcp__") ? (entry.split("__").pop() as string) : entry;
}

interface PluginGrants {
  /** `agent:<name>` / `skill:<name>` → the WRITER tools it is granted. */
  byHolder: Map<string, Set<string>>;
  /** Same keys → how many tool entries were parsed at all, writer or not. */
  entriesParsed: Map<string, number>;
  /** Holders whose frontmatter actually carries the key the scan reads. */
  declaresKey: Set<string>;
}

/**
 * What the shipped plugin actually hands out: the writer tools named by each
 * agent's `tools:` and each skill's `allowed-tools:` frontmatter.
 *
 * This is the reading the manifest is checked AGAINST, so it deliberately
 * touches no part of the manifest. `entriesParsed` is carried alongside because
 * both ways this scan can read nothing are silent — a `tools:` list whose
 * leading `#` comment block stops the parser, and a renamed frontmatter key —
 * and a silent zero here PASSES the guard rather than failing it.
 */
function readPluginGrants(): PluginGrants {
  const writers = new Set<string>(WRITER_TOOLS);
  const byHolder = new Map<string, Set<string>>();
  const entriesParsed = new Map<string, number>();
  const declaresKey = new Set<string>();

  const record = (holder: string, key: string, text: string) => {
    const entries = extractList(text, key);
    entriesParsed.set(holder, entries.length);
    // Read the key's PRESENCE from the frontmatter block only: a body that
    // happens to contain the string would make every holder look like a declarer.
    const frontmatter = frontmatterBlock(text) ?? "";
    if (new RegExp(`^${key}:`, "m").test(frontmatter)) declaresKey.add(holder);
    const held = new Set(entries.map(bareToolName).filter((t) => writers.has(t)));
    if (held.size > 0) byHolder.set(holder, held);
  };

  for (const file of readdirSync(join(pluginRoot, "agents")).filter((f) => f.endsWith(".md"))) {
    const text = readFileSync(join(pluginRoot, "agents", file), "utf8");
    record(`agent:${file.slice(0, -3)}`, "tools", text);
  }

  for (const entry of readdirSync(join(pluginRoot, "skills"), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillMd = join(pluginRoot, "skills", entry.name, "SKILL.md");
    if (!existsSync(skillMd)) continue;
    // `allowed-tools:` only, never the whole frontmatter. `forget-and-rederive`'s
    // `description:` names `tree_correct` and `merge_tree_persons` in a "do NOT
    // use this, use that" clause, so a frontmatter-wide word match reports it as
    // a holder of two tools it does not hold (proven 2026-09-23: exactly those
    // two false positives).
    record(`skill:${entry.name}`, "allowed-tools", readFileSync(skillMd, "utf8"));
  }

  return { byHolder, entriesParsed, declaresKey };
}

const pluginGrants = readPluginGrants();

/**
 * Every identifier some row listing `tool` names as a writer of it.
 *
 * `callers` and `hookCallers` are permission fields and count for every writer
 * tool on their row — that is what they mean. An `agentCallers` entry counts
 * only for the tools it names.
 */
function listedWriters(tool: string): Set<string> {
  const out = new Set<string>();
  for (const r of rows) {
    if (!r.writerTools.includes(tool)) continue;
    for (const c of [...r.callers, ...(r.hookCallers ?? [])]) out.add(c);
    for (const a of r.agentCallers ?? []) if (a.tools.includes(tool)) out.add(a.agent);
  }
  return out;
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
        "OK_FALSE_IS_FAILURE — the guard below is comparing against an empty set",
    ).toBeGreaterThan(0);

    const declared = new Set<string>(rows.flatMap((r) => r.writerTools));
    const shipped = new Set<string>(WRITER_TOOLS);
    expect(
      [...shipped].filter((tool) => !declared.has(tool)).sort(),
      "these tools write a project document and no ownership row names them as a " +
        "writer of anything — add the row's `writerTools` entry, or add the tool " +
        "to NOT_A_DOCUMENT_WRITER if it turns out to write neither document",
    ).toEqual([]);
    expect(
      [...declared].filter((tool) => !shipped.has(tool)).sort(),
      "the manifest calls these writer tools and the engine does not: each is " +
        "either missing from OK_FALSE_IS_FAILURE in src/tool-result.ts (a " +
        "writer's `ok: false` IS its own failure) or wrongly listed in " +
        "NOT_A_DOCUMENT_WRITER",
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
   * **It is per TOOL and unions across rows.** A holder listed for a writer tool
   * on any one row is listed for it everywhere, because nothing static can say
   * which section a grant will be used on. So this catches a holder listed for a
   * writer tool NOWHERE — not a (holder, tool) written on the wrong row. That
   * holds for all three fields.
   *
   * What a row lists for a holder differs by field. `callers` and `hookCallers`
   * are permissions, so they count for every writer tool on the row. An
   * `agentCallers` entry names its tools, and counts only for those: an agent
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

    const unlisted: string[] = [];
    for (const holder of [...pluginGrants.byHolder.keys()].sort()) {
      for (const tool of [...(pluginGrants.byHolder.get(holder) as Set<string>)].sort()) {
        if (!listedWriters(tool).has(holder)) unlisted.push(`${holder} holds ${tool}`);
      }
    }
    expect(
      unlisted,
      "the plugin grants these writer tools to holders that no row listing the " +
        "tool names. Either the manifest is missing a writer — a skill goes in " +
        "`callers`, a non-owner agent in `agentCallers` — or the grant should come " +
        "out of the frontmatter. Do not close it by dropping the tool from a " +
        "row's `writerTools`: that widens what the row permits.",
    ).toEqual([]);
  });

  it("names each agent the same way on both sides of the manifest", () => {
    // This file keys an agent by its FILENAME (`resolves()` and the grant scan
    // above both do); `eval/harness/e2e/writer_attribution_report.py` keys it by
    // the frontmatter `name`, through `declared_tools_by_agent`. They agree for
    // all seven shipped agents and nothing but coincidence made them. Let them
    // diverge and the corpus report misfiles a shipped agent as an UNBOUND
    // DELEGATION — the #939 class it states no manifest edit can ever close.
    const bad: string[] = [];
    for (const file of readdirSync(join(pluginRoot, "agents")).filter((f) => f.endsWith(".md"))) {
      const text = readFileSync(join(pluginRoot, "agents", file), "utf8");
      const frontmatter = frontmatterBlock(text) ?? "";
      const declared = /^name:\s*(\S+)\s*$/m.exec(frontmatter)?.[1];
      if (declared !== file.slice(0, -3)) bad.push(`${file}: frontmatter name '${declared}'`);
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

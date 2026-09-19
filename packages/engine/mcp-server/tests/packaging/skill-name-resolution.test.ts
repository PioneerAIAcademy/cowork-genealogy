import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, sep } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, "..", "..", "..", "..", "..");
const pluginRoot = join(projectRoot, "packages", "engine", "plugin");

/**
 * Plugin prose routes by naming a skill — "recommend `record-extraction`",
 * "set `suggested_skill` to …". Nothing checked that the name still ships.
 *
 * `assertion-classification` stopped shipping on 2026-07-11 when extraction
 * absorbed it, and five prompt sites went on naming it for six weeks: a *hard
 * block* in `research-exhaustiveness/SKILL.md` that told the agent to stop and
 * recommend it, two sites in the `proof-conclusion` agent, and the
 * `suggested_skill` value in `gps-mentor`. An agent told to route to a skill
 * that does not exist has no recovery path, and CI stayed green throughout.
 *
 * `ownership-manifest.test.ts` guards the same class for `ownership.json`
 * (every owner and caller must resolve). This is the prose half.
 *
 * The rule: a backticked kebab-case token in a plugin body must be a shipped
 * skill directory, a shipped agent file, or declared below as not-a-skill.
 * Measured against the tree on 2026-08-21 — 17 distinct non-resolving tokens,
 * every one of them a query kind, a focus value, a status, or an example name.
 */

/**
 * Backticked kebab-case tokens that are deliberately not skill names.
 * Adding to this list is the correct fix when a token is genuinely not a
 * skill; it is the wrong fix when prose names a skill that no longer ships.
 */
const NOT_SKILL_NAMES = new Set([
  // gps-mentor `focus` values (docs/specs/gps-mentor-agent-spec.md)
  "proof-critique",
  "pre-exhaustiveness",
  "conclusion-readiness",
  // research_query query kinds
  "birth-of",
  "death-of",
  "facts-of",
  "parents-of",
  "children-of",
  "spouses-of",
  "facts-before",
  "facts-after",
  "facts-between",
  // statuses and modes
  "on-demand",
  "needs-review",
  // example values in worked prose
  "albert-einstein",
  "schuylkill-county-pennsylvania",
  "o-brien-surname",
]);

/**
 * Two alternatives. BARE: lowercase kebab-case inside backticks, two or more
 * `-`-joined segments — single-word names (`citation`, `research`, `timeline`,
 * `translation`) are out of range, because widening to bare words would match
 * ordinary prose. `@plugin:`-PREFIXED: any `[a-z0-9-]+` tail, single-word
 * included.
 *
 * The `@plugin:` arm exists because `research/SKILL.md` routes its paired rows
 * by spawning the agent (`@plugin:proof-conclusion`) rather than calling the
 * same-named thin skill. Without it the `@` is the first character inside the
 * backtick, the token never matches, and a cell naming an agent that does not
 * ship passes this test and refuses to spawn at runtime (issue #2075).
 *
 * THE TWO FORMS ARE SEPARATE ALTERNATIVES, AND THAT IS THE WHOLE POINT.
 *
 * 1. They resolve against different sets. Every paired name is BOTH a skill
 *    directory and an agent file, so resolving a `@plugin:` token against the
 *    union would be satisfied by the skill half forever: delete
 *    `agents/proof-conclusion.md` and a union check stays green while every
 *    `@plugin:proof-conclusion` cell refuses to spawn. A `@plugin:` token
 *    resolves against the AGENTS set alone; the bare form keeps the union.
 *
 * 2. They use different character classes, deliberately. The `@plugin:` arm
 *    uses `[a-z0-9-]+`, which MUST stay identical to the five copies that scan
 *    the same namespace — `eval/harness/harness/snapshot.py`,
 *    `eval/app/lib/snapshot.ts`, `eval/harness/scripts/check_rubric_tool_drift.py`,
 *    `apps/server/tests/test_plugin_agents.py`, and `AGENT_REF_RE` in
 *    `agent-delegation-framing.test.ts`. A narrower class here would skip a name
 *    those scanners fold into a snapshot: a single-word agent (`@plugin:citation`)
 *    is invisible to a kebab-only class, so a cell naming a non-existent one
 *    would ship green — the hole this file exists to close, reopened for one
 *    name shape. The BARE arm keeps the kebab class, because widening it to
 *    bare words would match ordinary prose.
 */
const KEBAB_IN_BACKTICKS =
  /`(?:@plugin:([a-z0-9-]+)|([a-z][a-z0-9]*(?:-[a-z0-9]+)+))`/g;

function shippedNames(): { agents: Set<string>; all: Set<string> } {
  const skills = readdirSync(join(pluginRoot, "skills")).filter((n) =>
    statSync(join(pluginRoot, "skills", n)).isDirectory(),
  );
  const agents = readdirSync(join(pluginRoot, "agents"))
    .filter((n) => n.endsWith(".md"))
    .map((n) => n.slice(0, -3));
  return { agents: new Set(agents), all: new Set([...skills, ...agents]) };
}

function pluginMarkdown(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith(".md")) out.push(full);
    }
  };
  walk(join(pluginRoot, "skills"));
  walk(join(pluginRoot, "agents"));
  return out;
}

describe("plugin prose names only skills and agents that ship", () => {
  // The matcher's own arms, asserted directly. Without this the `@plugin:`
  // widening is unfalsifiable: a prefix arm that matched nothing would leave
  // every suite green while the hole it was added to close stayed open, which
  // is the shape CLAUDE.md § "A new lint must be proven to fail" names.
  it("extracts the tail of an @plugin: spawn, and the bare form unchanged", () => {
    const tokens = (s: string) =>
      [...s.matchAll(KEBAB_IN_BACKTICKS)].map((m) => m[1] ?? m[2]);

    expect(tokens("spawn `@plugin:proof-conclusion` now")).toEqual(["proof-conclusion"]);
    expect(tokens("route to `research-plan`")).toEqual(["research-plan"]);
    expect(tokens("`@plugin:person-evidence` and `record-extraction`")).toEqual([
      "person-evidence",
      "record-extraction",
    ]);
    // A single-word name matches behind `@plugin:` and NOT bare. That
    // asymmetry is the point: `@plugin:citation` must be resolution-checked
    // because the five snapshot scanners already fold it, while a bare
    // `citation` is ordinary prose.
    expect(tokens("`@plugin:research`")).toEqual(["research"]);
    expect(tokens("the `citation` skill")).toEqual([]);
  });

  // The arm the union hid. `record-extraction` is a real SKILL with no agent
  // file, so it resolves bare and must NOT resolve behind `@plugin:`. Without
  // this, the widening is satisfied by the skill half of every paired name and
  // catches nothing it was added to catch — deleting `agents/proof-conclusion.md`
  // left the whole suite green.
  it("resolves an @plugin: token against agents only, never the skill of the same name", () => {
    const { agents, all } = shippedNames();

    expect(all.has("record-extraction"), "fixture assumption: it ships as a skill").toBe(true);
    expect(agents.has("record-extraction"), "fixture assumption: no agent of that name").toBe(false);

    const resolve = (text: string): string[] => {
      const bad: string[] = [];
      for (const [, pluginTail, bareToken] of text.matchAll(KEBAB_IN_BACKTICKS)) {
        const token = pluginTail ?? bareToken;
        const pool = pluginTail ? agents : all;
        // Mirrors the corpus loop below: the allowlist excuses the bare arm only.
        const excused = pluginTail ? false : NOT_SKILL_NAMES.has(token);
        if (!pool.has(token) && !excused)
          bad.push(pluginTail ? `@plugin:${token}` : token);
      }
      return bad;
    };

    expect(resolve("route to `record-extraction`")).toEqual([]);
    expect(resolve("spawn `@plugin:record-extraction`")).toEqual(["@plugin:record-extraction"]);
    // And a real agent still resolves behind the prefix.
    expect(resolve("spawn `@plugin:proof-conclusion`")).toEqual([]);

    // NOT_SKILL_NAMES excuses the bare arm only. `proof-critique` is a
    // gps-mentor focus value on the allowlist AND a plausible spawn typo —
    // `research/SKILL.md` spawns `@plugin:gps-mentor` naming a focus value in
    // the same sentence. Consulting the allowlist for the prefixed arm let it
    // ship green and refuse to spawn at runtime.
    expect(NOT_SKILL_NAMES.has("proof-critique"), "fixture assumption").toBe(true);
    expect(resolve("focus `proof-critique`")).toEqual([]);
    expect(resolve("spawn `@plugin:proof-critique`")).toEqual(["@plugin:proof-critique"]);
  });

  it("resolves every backticked kebab-case token", () => {
    const { agents, all } = shippedNames();
    const offenders: string[] = [];

    for (const file of pluginMarkdown()) {
      const body = readFileSync(file, "utf-8");
      const rel = relative(projectRoot, file).split(sep).join("/");
      const seen = new Set<string>();
      for (const [, pluginTail, bareToken] of body.matchAll(KEBAB_IN_BACKTICKS)) {
        // A `@plugin:` token must name an AGENT. The bare form may name either.
        const token = pluginTail ?? bareToken;
        const pool = pluginTail ? agents : all;
        // Keyed with the prefix so a bare mention cannot mask a bad spawn of
        // the same name in the same file — the two resolve against different
        // sets, so they are different claims.
        const key = pluginTail ? `@plugin:${token}` : token;
        // NOT_SKILL_NAMES declares "this token is not a skill name" and applies
        // to the BARE arm only. Behind `@plugin:` the token is a spawn target,
        // and three allowlisted entries — `proof-critique`, `pre-exhaustiveness`,
        // `conclusion-readiness` — are gps-mentor focus values that look exactly
        // like agent names. Consulting the allowlist for the prefixed arm let
        // `@plugin:proof-critique` ship green and refuse to spawn at runtime,
        // which is the hole this arm exists to close.
        const excused = pluginTail ? false : NOT_SKILL_NAMES.has(token);
        if (pool.has(token) || excused || seen.has(key)) continue;
        seen.add(key);
        offenders.push(`${rel}: \`${key}\``);
      }
    }

    expect(
      offenders,
      "a bare token must name a shipped skill directory or agent file, and a " +
        "`@plugin:` token must name a shipped AGENT file, or be declared in " +
        "NOT_SKILL_NAMES. A name that used to be a skill and no longer ships is " +
        "a dead routing target — repoint it, do not allowlist it. A `@plugin:` " +
        "name that ships only as a skill is a spawn that will be refused at " +
        "runtime.",
    ).toEqual([]);
  });

  it("has no stale NOT_SKILL_NAMES entry that now ships as a skill", () => {
    const { all } = shippedNames();
    const collisions = [...NOT_SKILL_NAMES].filter((n) => all.has(n));
    expect(
      collisions,
      "a declared non-skill now resolves to a shipped skill or agent — drop it " +
        "from NOT_SKILL_NAMES so the token is checked normally",
    ).toEqual([]);
  });
});

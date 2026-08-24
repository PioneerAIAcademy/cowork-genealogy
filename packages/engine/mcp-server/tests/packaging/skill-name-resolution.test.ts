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
 * Lowercase kebab-case inside backticks: two or more `-`-joined segments.
 * Single-word names — `citation`, `research`, `timeline`, `translation` —
 * are therefore out of range. Widening to bare words would match ordinary
 * prose, so this guard covers hyphenated names only.
 */
const KEBAB_IN_BACKTICKS = /`([a-z][a-z0-9]*(?:-[a-z0-9]+)+)`/g;

function shippedNames(): Set<string> {
  const skills = readdirSync(join(pluginRoot, "skills")).filter((n) =>
    statSync(join(pluginRoot, "skills", n)).isDirectory(),
  );
  const agents = readdirSync(join(pluginRoot, "agents"))
    .filter((n) => n.endsWith(".md"))
    .map((n) => n.slice(0, -3));
  return new Set([...skills, ...agents]);
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
  it("resolves every backticked kebab-case token", () => {
    const known = shippedNames();
    const offenders: string[] = [];

    for (const file of pluginMarkdown()) {
      const body = readFileSync(file, "utf-8");
      const rel = relative(projectRoot, file).split(sep).join("/");
      const seen = new Set<string>();
      for (const [, token] of body.matchAll(KEBAB_IN_BACKTICKS)) {
        if (known.has(token) || NOT_SKILL_NAMES.has(token) || seen.has(token)) continue;
        seen.add(token);
        offenders.push(`${rel}: \`${token}\``);
      }
    }

    expect(
      offenders,
      "each token must name a shipped skill directory or agent file, or be " +
        "declared in NOT_SKILL_NAMES. A name that used to be a skill and no " +
        "longer ships is a dead routing target — repoint it, do not allowlist it.",
    ).toEqual([]);
  });

  it("has no stale NOT_SKILL_NAMES entry that now ships as a skill", () => {
    const known = shippedNames();
    const collisions = [...NOT_SKILL_NAMES].filter((n) => known.has(n));
    expect(
      collisions,
      "a declared non-skill now resolves to a shipped skill or agent — drop it " +
        "from NOT_SKILL_NAMES so the token is checked normally",
    ).toEqual([]);
  });
});

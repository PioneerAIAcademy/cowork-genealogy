import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { allToolSchemas } from "../../src/tool-schemas.js";

/**
 * `README.md` catalog drift (issue #1137).
 *
 * The README is the user-facing catalog of tools, skills, and agents. Nothing
 * read it, and it had rotted badly: **13 of 47 tools appeared nowhere in it** —
 * the entire structured-persistence writer surface (`research_append`,
 * `tree_edit`, `research_query`, …) plus both projection tools. A reader could
 * not learn those existed. Two prose counts disagreed with each other *and*
 * with the code (33 and 31, against 47 live).
 *
 * Skills and agents were clean at 27/27 and 4/4, so that half is preventive.
 *
 * **Presence, not description quality.** This asserts every live name appears
 * somewhere in the README. It cannot tell whether the description is any good —
 * that is review's job. Presence is the failure that shipped.
 *
 * The counterpart lint is `manifest.test.ts` (manifest ↔ `allToolSchemas` ↔
 * dispatch). This extends the same idea to the document a *user* reads.
 */

const here = dirname(fileURLToPath(import.meta.url));
const engineRoot = join(here, "..", "..", "..");
const projectRoot = join(engineRoot, "..", "..");
const pluginRoot = join(engineRoot, "plugin");

const readme = readFileSync(join(projectRoot, "README.md"), "utf8");

/** Backticked identifiers, which is how the README names every tool/skill. */
const backticked = new Set(
  [...readme.matchAll(/`([a-z0-9_-]+)`/g)].map((m) => m[1]),
);

function dirNames(path: string): string[] {
  return readdirSync(path, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

describe("README catalog", () => {
  it("read a README with content (guards the reader itself)", () => {
    expect(backticked.size).toBeGreaterThan(20);
  });

  it("names every registered MCP tool", () => {
    const missing = allToolSchemas
      .map((s) => s.name)
      .filter((n) => !backticked.has(n))
      .sort();
    expect(
      missing,
      `these tools are registered but appear nowhere in README.md, so a user ` +
        `cannot discover them: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  // NO inverse check ("README names a tool that no longer exists"). It was
  // written and cut: distinguishing a stale tool name from a field name, an
  // enum value, or a directory needs a heuristic, and the first run produced
  // six false positives (`getting_started` and `online_records` are
  // `wiki_place_page` section values; `exhaustive_declaration`,
  // `narration_guidance` and `experience_level` are research.json fields;
  // `node_modules` is a directory) against zero real finds. The forward
  // direction — every live tool is named — is what caught the 13 real misses,
  // and a lint that cries wolf is a lint someone disables. If a renamed tool
  // ever survives in the README, that is a review miss, not a lint gap.

  it("names every shipped skill", () => {
    const skills = dirNames(join(pluginRoot, "skills"));
    const missing = skills.filter((s) => !readme.includes(s));
    expect(
      missing,
      `these skills ship in the plugin but appear nowhere in README.md: ` +
        missing.join(", "),
    ).toEqual([]);
  });

  it("names every shipped plugin agent", () => {
    const agents = readdirSync(join(pluginRoot, "agents"))
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.replace(/\.md$/, ""))
      .sort();
    const missing = agents.filter((a) => !readme.includes(a));
    expect(
      missing,
      `these plugin agents ship but appear nowhere in README.md: ` +
        missing.join(", "),
    ).toEqual([]);
  });

  it("states a tool count that matches reality, if it states one at all", () => {
    // The two prose counts that drifted said 33 and 31 against 47 live. A
    // count is optional; a *wrong* count is worse than none, because a reader
    // uses it to decide whether the tables below are complete.
    const claims = [...readme.matchAll(/(\d+)\s+MCP tools?\b/g)].map((m) =>
      Number(m[1]),
    );
    const wrong = claims.filter((n) => n !== allToolSchemas.length);
    expect(
      wrong,
      `README.md claims these MCP tool counts, but ${allToolSchemas.length} ` +
        `are registered: ${wrong.join(", ")}. Update the number, or drop it ` +
        `and point at the tables.`,
    ).toEqual([]);
  });
});

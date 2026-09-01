import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEATHLIKE_FACT_TYPES } from "../../src/utils/mob.js";

/**
 * Ties every prose restatement of the death-like fact family back to
 * `DEATHLIKE_FACT_TYPES` in `src/utils/mob.ts`.
 *
 * The family is the mechanism behind `hasEventAfterDeath1` -- a fact of one of
 * these types raises the death anchor rather than violating it -- so the skill
 * cannot reason about that tag without the list, and the list is duplicated
 * into three prose files that nothing read. Adding a tenth type to the Set
 * would leave all three silently stale, and a genealogist following stale
 * doctrine would call a legitimate probate record a contradiction.
 *
 * Direction is deliberate, and follows `measured-figures.test.ts`: rather than
 * asserting the docs contain some hand-listed names, each site's list is
 * extracted and compared to the Set both ways. An extra name fails as loudly
 * as a missing one, so this cannot pass by matching a subset.
 *
 * `warnings-as-identity-signals.md` omits `Death` on purpose: its bullet reads
 * "Death must follow every other event, except facts in the death-like family",
 * so listing Death among the exceptions to its own rule would be incoherent.
 * That omission is declared per-site rather than tolerated by a loose match.
 */

const projectRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  "..",
);

/** Carriage return. These files are CRLF on a Windows checkout; the
 *  paragraph-boundary patterns below are written against newlines only. */
const CR = String.fromCharCode(13);

interface Site {
  /** Repo-relative path. */
  path: string;
  /** Must capture exactly the list text in group 1. */
  list: RegExp;
  /** Types this site leaves out deliberately; see the header comment. */
  omits: string[];
}

const SITES: Site[] = [
  {
    path: "packages/engine/plugin/skills/check-warnings/references/warning-checks.md",
    list: /That family is ([\s\S]*?);/,
    omits: [],
  },
  {
    path: "packages/engine/plugin/skills/check-warnings/references/warnings-as-identity-signals.md",
    list: /violate it: ([\s\S]*?)\(`hasEventAfterDeath1`\)/,
    omits: ["Death"],
  },
  {
    path: "docs/specs/person-warnings-tool-spec.md",
    list: /\*\*"Death-like" is a family of nine fact types\*\*[\s\S]*?\n\n([\s\S]*?)\n\n/,
    omits: [],
  },
];

/** Split a prose or backticked list into bare type names. */
const parse = (raw: string): string[] =>
  raw
    .split(/,|\band\b/)
    .map((s) => s.trim().split("`").join("").trim())
    .filter((s) => s.length > 0);

describe("the death-like family in prose matches DEATHLIKE_FACT_TYPES", () => {
  it("the constant is non-empty (guards the reader itself)", () => {
    expect(DEATHLIKE_FACT_TYPES.size).toBeGreaterThan(0);
  });

  it.each(SITES)("$path restates the family exactly", ({ path, list, omits }) => {
    const body = readFileSync(join(projectRoot, path), "utf-8").split(CR).join("");
    const match = body.match(list);
    // A miss means the passage was reworded or removed, so the check has gone
    // vacuous. That must fail rather than silently pass.
    expect(match, `${path}: could not locate the death-like list`).not.toBeNull();

    const found = parse(match![1]);
    const expected = [...DEATHLIKE_FACT_TYPES].filter((t) => !omits.includes(t));
    expect([...found].sort()).toEqual([...expected].sort());
  });

  it("every declared omission is really in the constant", () => {
    // Stops a typo'd omission ("Deaths") from quietly widening a site's licence.
    for (const site of SITES) {
      for (const o of site.omits) {
        expect(
          DEATHLIKE_FACT_TYPES.has(o),
          `${site.path} omits unknown type ${o}`,
        ).toBe(true);
      }
    }
  });
});

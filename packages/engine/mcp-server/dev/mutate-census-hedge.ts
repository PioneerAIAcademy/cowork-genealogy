/**
 * Mutation sweep: take out one clause or guard of the pre-1880 census hedge
 * at a time and check that `tests/tools/pre1880-census-hedge.test.ts` notices.
 *
 * WHY THIS EXISTS. The hedge is a deny, and a deny that fails open fails
 * silently. Twice on issue #2123's PR a mechanism shipped that no test
 * exercised — the backward branch and the sentence stop in round 3, the
 * `of` and `includes` relations in round 4 — and in each case the suite was
 * green with the mechanism deleted. Reading the tests does not catch that:
 * a note written to exercise one clause routinely satisfies two, so the
 * clause you meant to pin is covered incidentally by a neighbour and the
 * coverage is imaginary. Only removing it and watching the suite go red says
 * otherwise.
 *
 * A GREEN ROW IS A FINDING, not a pass. It means that clause can be deleted
 * with the suite still green, so either it needs a test or it is inert and
 * should go. One clause was deleted on exactly that basis: the requirement
 * that a person stand outside a `(head)` bracket moved nothing over 4,322
 * corpus notes and could not be given a failing test, because it did nothing.
 *
 * Each entry is a literal substring of `src/tools/research-log-append.ts` and
 * its replacement. A SKIPPED row means the substring no longer matches the
 * source — that is a stale sweep entry, which is itself a finding: re-key it
 * rather than leaving the row skipped, or the clause silently stops being
 * swept.
 *
 * Offline; no FamilySearch session needed. Not shipped in any artifact.
 *
 * Usage:
 *   npx tsx dev/mutate-census-hedge.ts
 * Exit code is 1 if any row is GREEN or SKIPPED.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(here, "../src/tools/research-log-append.ts");
const PKG = resolve(here, "..");
const SPEC = "tests/tools/pre1880-census-hedge.test.ts";

/** [label, literal substring of the source, what to replace it with]. */
const MUTATIONS: readonly (readonly [string, string, string])[] = [
  ["coresidence arm", "if (CORESIDENCE_CLAIM.test(notes)) return true;", ""],
  ["compound arm", "|| hasHouseholdCompound(sentence)", ""],
  ["place guard", 'run.every((t) => !PLACE_MARKER_ONLY.test(t.replace(/\\.$/, "")))', "true"],
  ["complement guard", "(?![ ]${HOUSEHOLD_COMPLEMENT}\\b)", ""],
  ["sentence-opener strip", "while (run.length > 0 && SENTENCE_OPENER.test(run[0])) run.shift();", ""],
  ["sentence stop", ".split(/[.;]\\s/)", ".split(/\\u0000/)"],
  ["role in parens", "ROLE_IN_PARENS.test(notes) ||", ""],
  ["`of` relation", "\\b${HOUSEHOLD_NOUNS}\\s+of\\b", "(?!x)x"],
  ["`in` relation", "\\b(?:in|within)\\s+(?:[\\w.'’-]+\\s+){0,3}${HOUSEHOLD_NOUNS}\\b", "(?!x)x"],
  ["possessive relation", "\\b[\\w.’-]+(?:'s|s'|’s|s’)\\s+${HOUSEHOLD_NOUNS}\\b", "(?!x)x"],
  ["includes relation", "\\b${HOUSEHOLD_NOUNS}\\s+(?:\\d+\\s+)?(?:also\\s+)?(?:includes?|contains?|comprises?|lists?|holds?)\\b", "(?!x)x"],
  ["headship, head-first", "\\bhead(?:s|ing|ed)?\\s+(?:a|the|his|her|their|own|her\\s+own|his\\s+own)?\\s*${HOUSEHOLD_NOUNS}\\b", "(?!x)x"],
  ["headship, headed-by", "\\b${HOUSEHOLD_NOUNS}\\s+head(?:s|ing|ed)?\\s+by\\b", "(?!x)x"],
  ["head participle", "head(?:s|ing|ed)?\\s+(?:a|the", "heads?\\s+(?:a|the"],
  ["kinship: children", "|parents?|children)", "|parents?)"],
  ["kinship: report verb", "(?:(?:is|was|are|were)\\s+(?:listed|recorded|shown|given|named)\\s+as\\s+)?", ""],
  ["kinship: possessive carve-out", "(?<!\\b(?:his|her|their)\\s)", ""],
  ["hyphen in the hedge", "relationship[\\s-]+(?:to[\\s-]+head[\\s-]+)?column", "relationship\\s+(?:to\\s+head\\s+)?column"],
];

const original = readFileSync(SRC, { encoding: "utf-8" });
const rows: string[] = [];
let bad = 0;

try {
  for (const [label, from, to] of MUTATIONS) {
    const hits = original.split(from).length - 1;
    if (hits !== 1) {
      rows.push(`${label.padEnd(30)} SKIPPED — substring appears ${hits}x; re-key this entry`);
      bad++;
      continue;
    }
    writeFileSync(SRC, original.replace(from, to), { encoding: "utf-8" });
    let out = "";
    try {
      out = execFileSync("npx", ["vitest", "run", SPEC], {
        cwd: PKG, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (e) {
      // A non-zero exit is the expected case: the suite went red.
      out = `${(e as { stdout?: string }).stdout ?? ""}${(e as { stderr?: string }).stderr ?? ""}`;
    }
    const m = /Tests\s+(?:(\d+) failed \| )?(\d+) passed/.exec(out);
    if (m?.[1]) rows.push(`${label.padEnd(30)} red (${m[1]} failed)`);
    else if (m) { rows.push(`${label.padEnd(30)} GREEN — unpinned, needs a test or deletion`); bad++; }
    else rows.push(`${label.padEnd(30)} red (did not compile)`);
  }
} finally {
  writeFileSync(SRC, original, { encoding: "utf-8" });
}

console.log(rows.join("\n"));
console.log(`\n${MUTATIONS.length - bad} of ${MUTATIONS.length} pinned.`);
process.exit(bad === 0 ? 0 : 1);

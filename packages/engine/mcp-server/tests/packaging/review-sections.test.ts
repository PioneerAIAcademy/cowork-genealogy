import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Staleness lint for `REVIEW.md`'s severity table.
 *
 * `REVIEW.md` promotes a short list of `CLAUDE.md` rules from the managed
 * reviewer's default nit severity to Important. It names each rule by its
 * `CLAUDE.md` section rather than restating it — the reviewer is handed
 * `CLAUDE.md` independently, so the rules keep one home and cannot drift into
 * two versions.
 *
 * What that buys in single-sourcing it pays for in pointer fragility, and the
 * failure is silent in a way nothing else here would catch. `REVIEW.md` is
 * injected into the review agents' system prompt **verbatim**: a section that
 * has been renamed or deleted produces no error, no CI signal, and no
 * missing-file complaint of the kind `doc-links.test.ts` raises. The
 * escalation simply stops applying and the rule quietly reverts to nit
 * severity — on exactly the pull requests someone paid to have reviewed.
 *
 * **The rule for "this is a section citation":** it is a `**bolded**` span in
 * the second column of the severity table. That is why the second column holds
 * nothing but bolded section names — no prose glue, no arrows. Keeping the
 * column mechanically extractable is the point; prose there would force this
 * lint to guess, and a guessing lint gets `skip`ped.
 *
 * Matching is by **prefix**, after normalising case, backticks and whitespace.
 * `CLAUDE.md` headings carry parentheticals its citations reasonably omit
 * (`### Plugin hooks (\`packages/engine/plugin/hooks/\`)` cited as
 * `Plugin hooks`), and its bolded lead-ins carry a trailing clause and period
 * (`**No playbook/reference files for agents — an agent body is
 * self-contained.**`). Requiring equality there would fail on correct
 * citations, which is the false positive this directory's lints exist to
 * avoid.
 *
 * Not checked, on purpose: whether the rule under that heading still *says*
 * what `REVIEW.md` assumes. A rule rewritten to mean the opposite under an
 * unchanged heading passes here — that is a reading task, and the PR reversing
 * the rule is where it belongs.
 */

const here = dirname(fileURLToPath(import.meta.url));
const engineRoot = join(here, "..", "..", ".."); // packages/engine/
const projectRoot = join(engineRoot, "..", ".."); // repo root

/** Lowercase, strip backticks and bold markers, collapse whitespace. */
function normalize(s: string): string {
  return s
    .replace(/[`*]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Bolded spans in the second column of `REVIEW.md`'s severity table.
 *
 * A table row is a line starting with `|`; the separator row and any row
 * without a bolded span (the header) drop out on their own.
 */
function citedSections(text: string): string[] {
  const cited: string[] = [];
  for (const line of text.split("\n")) {
    if (!line.trimStart().startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1); // drop the empty edges
    if (cells.length !== 2) continue;
    for (const m of cells[1].matchAll(/\*\*(.+?)\*\*/g)) {
      cited.push(normalize(m[1]));
    }
  }
  return [...new Set(cited)];
}

/** Heading text and bolded lead-ins in `CLAUDE.md`, normalised. */
function sectionNames(text: string): string[] {
  const names: string[] = [];
  for (const line of text.split("\n")) {
    const heading = line.match(/^#{2,4}\s+(.*)$/);
    if (heading) names.push(normalize(heading[1]));
    // A lead-in is a bolded span opening the line, e.g. `**Plugin hooks.** …`.
    const leadIn = line.match(/^\*\*(.+?)\*\*/);
    if (leadIn) names.push(normalize(leadIn[1]));
  }
  return names;
}

describe("REVIEW.md section citations", () => {
  const review = readFileSync(join(projectRoot, "REVIEW.md"), "utf8");
  const claudeMd = readFileSync(join(projectRoot, "CLAUDE.md"), "utf8");

  it("cites at least one section (the extractor still matches the table)", () => {
    // Guards the lint itself: reformatting the table into a shape the
    // extractor misses would otherwise turn this file into a silent no-op.
    expect(citedSections(review).length).toBeGreaterThan(0);
  });

  it("names only CLAUDE.md sections that still exist", () => {
    const names = sectionNames(claudeMd);
    const missing = citedSections(review).filter(
      (cited) => !names.some((name) => name.startsWith(cited)),
    );

    expect(
      missing,
      `REVIEW.md escalates CLAUDE.md sections that no longer exist: ${missing.join(", ")}\n` +
        "Each bolded name in the severity table's second column must prefix a " +
        "CLAUDE.md heading or bolded lead-in.\n" +
        "If the section was renamed, update REVIEW.md. If the rule was " +
        "dropped, drop its row — an escalation pointing at nothing silently " +
        "reverts that rule to nit severity in every cloud review.",
    ).toEqual([]);
  });
});

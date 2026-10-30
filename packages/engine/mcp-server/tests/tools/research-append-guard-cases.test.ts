/**
 * Replays every labelled case of every registered guard that has a writer-tool
 * precondition. Where the guard also has a harness detector, the same case
 * file is replayed by it in eval/harness/tests/unit/test_guard_case_files.py,
 * so a divergence between the TypeScript guard and its Python twin fails one
 * side or the other (ADR-0011, "The bar is inspection, not a rate"; one JSON
 * case file per guard, replayed by every plane it binds on). A case file names
 * the research.json section its `write` id is in; the default is
 * proof_summaries.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  unpersistedConflictResolutionInvariants,
  competingParentSetsInvariants,
  namesakeTieInvariants,
  planItemCompletionRecordTypeInvariants,
} from "../../src/tools/research-append.js";
import { startingPersonIdsOf } from "../../src/utils/starting-tree.js";

const casesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "guard-cases");
const registry = JSON.parse(readFileSync(join(casesDir, "registry.json"), "utf-8"));

/** One binding per registered writer guard. A guard added to the registry with a
 *  `writer_guard` and no binding here fails the first test below. */
const WRITER_GUARDS: Record<string, (entry: any, research: any, tree?: any, startingTree?: any) => string[]> = {
  unpersistedConflictResolutionInvariants,
  competingParentSetsInvariants,
  namesakeTieInvariants: (entry, research, tree, startingTree) =>
    namesakeTieInvariants(entry, research, tree, startingTree ? startingPersonIdsOf(startingTree) : undefined, startingTree),
  planItemCompletionRecordTypeInvariants,
};

/** The entry a case is written for, found by `write` id. A proof-summary guard
 *  judges a `proof_summaries[]` entry; a plan-item guard judges a
 *  `plans[].items[]` entry. The id prefixes don't collide (`ps_` vs `pli_`), so
 *  the fallback picks the right one without the case naming its section. */
function findEntry(research: any, write: string): any {
  return (
    (research.proof_summaries ?? []).find((ps: any) => ps?.id === write) ??
    (research.plans ?? []).flatMap((p: any) => p?.items ?? []).find((it: any) => it?.id === write)
  );
}

interface GuardCase {
  id: string;
  expect: "fire" | "silent";
  write: string;
  research: any;
  tree?: any;
  /** The project's starting tree, for a guard that reads one. */
  starting_tree?: any;
}

// Scoped to this file's guards (proof_summary-shaped). The research-log-append
// guards replay through their own harness (research-log-append-guard-cases.test.ts),
// which also asserts every registry writer-guard file is one of the two known ones.
const writerGuards = registry.guards.filter((g: any) =>
  g.writer_guard?.file.endsWith("/research-append.ts"),
);

describe("guard case files: writer-tool replay", () => {
  it("binds every registered writer guard", () => {
    for (const g of writerGuards) {
      expect(WRITER_GUARDS[g.writer_guard.function], `${g.name}: no binding for ${g.writer_guard.function}`).toBeTypeOf(
        "function",
      );
    }
    expect(writerGuards.length).toBeGreaterThan(0);
  });

  for (const g of writerGuards) {
    const file = JSON.parse(readFileSync(join(casesDir, g.case_file), "utf-8"));
    const guard = WRITER_GUARDS[g.writer_guard.function];
    describe(g.name, () => {
      it.each((file.cases as GuardCase[]).map((c) => [c.id, c] as const))("%s", (_id, c) => {
        // A case file may name a flat `section` (e.g. person_evidence); without
        // one, findEntry locates a proof_summaries OR a nested plans[].items entry.
        const section = file.section;
        const entry = section
          ? (c.research[section] ?? []).find((e: any) => e?.id === c.write)
          : findEntry(c.research, c.write);
        expect(entry, `case ${c.id}: no entry ${c.write} in its research`).toBeDefined();
        const errors = guard(entry, c.research, c.tree, c.starting_tree);
        if (c.expect === "fire") expect(errors, `case ${c.id} should fire`).toHaveLength(1);
        else expect(errors, `case ${c.id} should be silent`).toEqual([]);
      });
    });
  }
});

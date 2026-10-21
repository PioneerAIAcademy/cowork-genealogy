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
} from "../../src/tools/research-append.js";

const casesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "guard-cases");
const registry = JSON.parse(readFileSync(join(casesDir, "registry.json"), "utf-8"));

/** One binding per registered writer guard. A guard added to the registry with a
 *  `writer_guard` and no binding here fails the first test below. */
const WRITER_GUARDS: Record<string, (entry: any, research: any, tree?: any) => string[]> = {
  unpersistedConflictResolutionInvariants,
  competingParentSetsInvariants,
  namesakeTieInvariants,
};

interface GuardCase {
  id: string;
  expect: "fire" | "silent";
  write: string;
  research: any;
  tree?: any;
}

const writerGuards = registry.guards.filter((g: any) => g.writer_guard);

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
        const section = file.section ?? "proof_summaries";
        const entry = (c.research[section] ?? []).find((e: any) => e?.id === c.write);
        expect(entry, `case ${c.id}: no ${section} entry ${c.write} in its research`).toBeDefined();
        const errors = guard(entry, c.research, c.tree);
        if (c.expect === "fire") expect(errors, `case ${c.id} should fire`).toHaveLength(1);
        else expect(errors, `case ${c.id} should be silent`).toEqual([]);
      });
    });
  }
});

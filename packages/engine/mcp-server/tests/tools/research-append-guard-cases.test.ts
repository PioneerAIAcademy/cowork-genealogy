/**
 * Replays every labelled case of every registered two-plane guard through its
 * writer-tool precondition. The same case file is replayed by the harness
 * detector in eval/harness/tests/unit/test_guard_case_files.py, so a divergence
 * between the TypeScript guard and its Python twin fails one side or the other
 * (ADR-0011, "The bar is inspection, not a rate"; one JSON case file per
 * two-plane guard, replayed by both planes).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { unpersistedConflictResolutionInvariants } from "../../src/tools/research-append.js";

const casesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "guard-cases");
const registry = JSON.parse(readFileSync(join(casesDir, "registry.json"), "utf-8"));

/** One binding per registered writer guard. A guard added to the registry with a
 *  `writer_guard` and no binding here fails the first test below. */
const WRITER_GUARDS: Record<string, (entry: any, research: any) => string[]> = {
  unpersistedConflictResolutionInvariants,
};

interface GuardCase {
  id: string;
  expect: "fire" | "silent";
  write: string;
  research: any;
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
        const entry = (c.research.proof_summaries ?? []).find((ps: any) => ps?.id === c.write);
        expect(entry, `case ${c.id}: no summary ${c.write} in its research`).toBeDefined();
        const errors = guard(entry, c.research);
        if (c.expect === "fire") expect(errors, `case ${c.id} should fire`).toHaveLength(1);
        else expect(errors, `case ${c.id} should be silent`).toEqual([]);
      });
    });
  }
});

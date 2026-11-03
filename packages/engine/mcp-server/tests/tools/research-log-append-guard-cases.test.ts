/**
 * Replays every labelled case of each `research-log-append.ts` writer guard
 * through its precondition. The same case files are shape-validated by the Python
 * half (eval/harness/tests/unit/test_guard_case_files.py); these guards carry no
 * harness detector, so the vitest half is the only one that runs the guard
 * (ADR-0011, "The bar is inspection, not a rate"; one JSON case file per guard).
 *
 * The research-append guards replay through `research-append-guard-cases.test.ts`
 * (proof_summary-shaped). These log-append guards judge a resolved log OP, so the
 * case research carries `{ log, ops }` and `write` names the op by id. The final
 * test here asserts every registry writer-guard file is one of the two known
 * harnesses' files, so a third writer-guard file can never slip past both
 * narrowed filters unbound.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { filteredNilRetryInvariants } from "../../src/tools/research-log-append.js";

const casesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "guard-cases");
const registry = JSON.parse(readFileSync(join(casesDir, "registry.json"), "utf-8"));

/** One binding per `research-log-append.ts` writer guard. A guard added to the
 *  registry under this file with no binding here fails the first test below. */
const WRITER_GUARDS: Record<string, (entry: any, research: any) => string[]> = {
  filteredNilRetryInvariants,
};

const THIS_FILE = "/research-log-append.ts";
const KNOWN_REPLAY_FILES = ["/research-append.ts", "/research-log-append.ts"];

interface GuardCase {
  id: string;
  expect: "fire" | "silent";
  write: string;
  research: { log?: any[]; ops?: any[] };
}

const logAppendGuards = registry.guards.filter((g: any) => g.writer_guard?.file.endsWith(THIS_FILE));

describe("guard case files: research-log-append writer replay", () => {
  it("every registry writer guard is bound by one of the two known replay harnesses", () => {
    for (const g of registry.guards.filter((x: any) => x.writer_guard)) {
      expect(
        KNOWN_REPLAY_FILES.some((f) => g.writer_guard.file.endsWith(f)),
        `${g.name}: writer_guard.file ${g.writer_guard.file} is not replayed by any known harness`,
      ).toBe(true);
    }
  });

  it("binds every research-log-append writer guard", () => {
    for (const g of logAppendGuards) {
      expect(
        WRITER_GUARDS[g.writer_guard.function],
        `${g.name}: no binding for ${g.writer_guard.function}`,
      ).toBeTypeOf("function");
    }
    expect(logAppendGuards.length).toBeGreaterThan(0);
  });

  for (const g of logAppendGuards) {
    const file = JSON.parse(readFileSync(join(casesDir, g.case_file), "utf-8"));
    const guard = WRITER_GUARDS[g.writer_guard.function];
    describe(g.name, () => {
      it.each((file.cases as GuardCase[]).map((c) => [c.id, c] as const))("%s", (_id, c) => {
        const entry = (c.research.ops ?? []).find((o: any) => o?.id === c.write);
        expect(entry, `case ${c.id}: no op ${c.write} in its research.ops`).toBeDefined();
        const errors = guard(entry, c.research);
        if (c.expect === "fire") expect(errors, `case ${c.id} should fire`).toHaveLength(1);
        else expect(errors, `case ${c.id} should be silent`).toEqual([]);
      });
    });
  }
});

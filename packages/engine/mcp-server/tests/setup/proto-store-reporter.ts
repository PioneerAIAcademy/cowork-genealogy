import { readFileSync } from "node:fs";
import type { Reporter, TestModule } from "vitest/node";

// The two guards on a `PROTO_STORE=pg` run, as a reporter because only a
// reporter's exit code fails the run (a global teardown's throw is printed and
// ignored):
//
// - Nothing skips. A skipped or todo test fails the run, naming each one; a
//   skipped case reads as coverage in the pass count.
// - The router was installed. Each test file appends how many calls its
//   PgRoutingStore answered (proto-store.ts); a broad run (BROAD_RUN files or
//   more) in which it answered none fails. A narrow run may legitimately make no
//   store call, so it only prints the count.

const BROAD_RUN = 20;

export default class ProtoStoreReporter implements Reporter {
  onTestRunEnd(testModules: ReadonlyArray<TestModule>): void {
    const skipped: string[] = [];
    for (const mod of testModules) {
      for (const test of mod.children.allTests()) {
        const state = test.result().state;
        if (state === "skipped" || state === "pending") skipped.push(`${mod.moduleId} > ${test.fullName}`);
      }
    }
    if (skipped.length > 0) {
      process.stderr.write(`PROTO_STORE=pg: ${skipped.length} test(s) skipped; nothing may skip here:\n`);
      for (const s of skipped) process.stderr.write(`  ${s}\n`);
      process.exitCode = 1;
    }

    let lines: string[] = [];
    try {
      lines = readFileSync(process.env.PROTO_STORE_REPORT ?? "", { encoding: "utf-8" }).split("\n").filter(Boolean);
    } catch {
      lines = [];
    }
    const counts = lines.map((l) => Number(l.split("\t")[0]));
    const total = counts.reduce((a, b) => a + b, 0);
    const routed = counts.filter((n) => n > 0).length;
    process.stdout.write(
      `PROTO_STORE=pg: ${total} store calls through PgS3ProjectStore, from ${routed} of ${testModules.length} test files\n`,
    );
    if (testModules.length >= BROAD_RUN && !(total > 0)) {
      process.stderr.write("PROTO_STORE=pg: no store call reached PgS3ProjectStore — the routing store was not installed\n");
      process.exitCode = 1;
    }
  }
}

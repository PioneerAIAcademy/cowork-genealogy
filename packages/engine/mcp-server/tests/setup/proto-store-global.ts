import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    protoStoreReport: string;
  }
}

// The file each test file's PgRoutingStore appends its call count to
// (proto-store.ts), read back by proto-store-reporter.ts, which runs in this
// process: hence the environment variable beside the provided value.

export default function setup(project: TestProject): () => void {
  const dir = mkdtempSync(join(tmpdir(), "proto-store-report-"));
  const report = join(dir, "calls.tsv");
  process.env.PROTO_STORE_REPORT = report;
  project.provide("protoStoreReport", report);
  return () => rmSync(dir, { recursive: true, force: true });
}

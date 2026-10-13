import { appendFileSync } from "node:fs";
import { afterAll, afterEach, beforeEach, expect, inject } from "vitest";
import { createPgS3Backend } from "../../src/store/pg-s3-project-store.js";
import { setProjectStore } from "../../src/store/project-store.js";
import { PgRoutingStore } from "../helpers/pg-routing-store.js";
import { protoBackendOptions } from "../store/pg-s3-test-env.js";

// `PROTO_STORE=pg` (U15): every test file runs with a PgRoutingStore as the
// process store, so each tool's reads and writes go through PgS3ProjectStore
// on the stack `make engine-test-pg` starts. Installed before every test,
// because a test that swaps in its own double resets to null afterwards. A
// missing stack is an error here, never a skip.

if (!process.env.PROTO_PG_DSN || !process.env.PROTO_S3_ENDPOINT) {
  throw new Error("PROTO_STORE=pg needs PROTO_PG_DSN and PROTO_S3_ENDPOINT (run `make engine-test-pg`)");
}

const backend = createPgS3Backend(protoBackendOptions());
const router = new PgRoutingStore(backend);

beforeEach(() => {
  setProjectStore(router);
});

afterEach(() => {
  setProjectStore(router);
  // A test that fakes Date (vi.setSystemTime) teaches the S3 client a clock
  // skew it keeps after useRealTimers(), and the next test's signatures are
  // then refused as too skewed. A real process never fakes its clock.
  (backend.s3.config as { systemClockOffset?: number }).systemClockOffset = 0;
});

afterAll(async () => {
  setProjectStore(null);
  const report = inject("protoStoreReport");
  appendFileSync(report, `${router.calls}\t${expect.getState().testPath ?? "?"}\n`, { encoding: "utf-8" });
  await backend.close();
});

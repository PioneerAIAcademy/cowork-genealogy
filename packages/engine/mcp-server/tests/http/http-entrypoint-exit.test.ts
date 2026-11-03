import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The real build/http.js (`pretest` builds it) refusing to start on a store
// environment it cannot use: a half-set S3 key pair, or a path-style flag that
// is neither `true` nor `false`. Both exit before the Pg/S3 backend exists, so
// no stack is needed. The start-up mode line and the debug-hold line are read
// the same way, killing the child once it prints. Every inherited GENEALOGY_*
// variable is cleared, so the case sees only what it sets. The readiness case
// keeps the child running, with both stores pointed at a closed port, and asks
// it for /healthz and /livez.

const HTTP_JS = resolve(dirname(fileURLToPath(import.meta.url)), "../../build/http.js");

const BASE = { GENEALOGY_PG_DSN: "postgresql://u:p@127.0.0.1:1/d", GENEALOGY_S3_BUCKET: "projects" };

// How long a child may take to start, shared by both helpers. 15s, not 5s: under
// make test-all's parallel load, start-up alone has run past 5s and been killed
// before it could exit 2 — and startHttp, left at 5s after runHttp was raised,
// failed the readiness case the same way at 5021ms inside the full engine suite.
const START_TIMEOUT_MS = 15_000;
// A test's own budget: one child start plus 5s for what follows it.
const TEST_TIMEOUT_MS = START_TIMEOUT_MS + 5_000;

/** The environment `build/http.js` sees: the inherited one minus every GENEALOGY_* variable, plus `storeEnv`. */
function childEnv(storeEnv: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (!name.startsWith("GENEALOGY_")) env[name] = value;
  }
  return Object.assign(env, storeEnv);
}

// With `until`, the child is killed as soon as stderr matches it.
function runHttp(
  storeEnv: Record<string, string>,
  until?: RegExp,
  timeoutMs = START_TIMEOUT_MS,
): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [HTTP_JS, "--port", "0"], {
      env: childEnv(storeEnv),
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      if (until?.test(stderr)) child.kill("SIGKILL");
    });
    // A process that listens instead of exiting is killed, and reads as code null.
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolvePromise({ code, stderr });
    });
  });
}

/** Start `build/http.js` and resolve with the child and its port once it prints the listening line. */
function startHttp(storeEnv: Record<string, string>): Promise<{ child: ChildProcess; port: number }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [HTTP_JS, "--port", "0"], {
      env: childEnv(storeEnv),
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`build/http.js did not listen within ${START_TIMEOUT_MS / 1000} s:\n${stderr}`));
    }, START_TIMEOUT_MS);
    child.stderr!.setEncoding("utf8");
    child.stderr!.on("data", (chunk: string) => {
      stderr += chunk;
      const m = /listening on http:\/\/[^:]+:(\d+)\//.exec(stderr);
      if (m) {
        clearTimeout(timer);
        resolvePromise({ child, port: Number(m[1]) });
      }
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`build/http.js exited ${code} before listening:\n${stderr}`));
    });
  });
}

describe("build/http.js readiness", () => {
  it("answers 503 on /healthz and 200 on /livez with Postgres and S3 unreachable, and keeps running", async () => {
    const { child, port } = await startHttp({
      ...BASE,
      GENEALOGY_S3_ENDPOINT: "http://127.0.0.1:1",
      GENEALOGY_S3_ACCESS_KEY: "ak-sentinel",
      GENEALOGY_S3_SECRET_KEY: "sk-sentinel",
    });
    try {
      const res = await fetch(`http://127.0.0.1:${port}/healthz`);
      const text = await res.text();
      expect(res.status, text).toBe(503);
      const body = JSON.parse(text);
      expect(body).toMatchObject({ ok: false, checks: { postgres: { ok: false }, s3: { ok: false } } });
      expect(body.tools).toBeGreaterThan(0);
      // Labels only: nothing from the DSN, the endpoint or either key.
      expect(text).not.toMatch(/u:p|127\.0\.0\.1|ak-sentinel|sk-sentinel/);
      // Liveness touches neither store, so it passes a deploy gate before they exist.
      const live = await fetch(`http://127.0.0.1:${port}/livez`);
      expect(live.status).toBe(200);
      expect(await live.json()).toEqual({ ok: true, tools: body.tools });
      // A failing store is a 503, never an exit.
      await new Promise((r) => setTimeout(r, 200));
      expect(child.exitCode).toBeNull();
      expect(child.signalCode).toBeNull();
    } finally {
      child.kill("SIGKILL");
    }
  }, TEST_TIMEOUT_MS);
});

describe("build/http.js store environment", () => {
  it("exits 2 naming the unset partner when exactly one S3 key is set", async () => {
    const r = await runHttp({ ...BASE, GENEALOGY_S3_ACCESS_KEY: "ak" });
    expect(r.code, r.stderr).toBe(2);
    expect(r.stderr).toMatch(/required environment not set: GENEALOGY_S3_SECRET_KEY/);
  }, TEST_TIMEOUT_MS);

  it("exits 2 naming GENEALOGY_S3_FORCE_PATH_STYLE when it is neither true nor false", async () => {
    const r = await runHttp({ ...BASE, GENEALOGY_S3_FORCE_PATH_STYLE: "yes" });
    expect(r.code, r.stderr).toBe(2);
    expect(r.stderr).toMatch(/invalid value.*GENEALOGY_S3_FORCE_PATH_STYLE/);
  }, TEST_TIMEOUT_MS);

  it.each([
    ["TRANSCRIPTION_ENABLED", "off", /invalid value: TRANSCRIPTION_ENABLED must be true or false/],
    ["UPLOADS_ENABLED", "1", /invalid value: UPLOADS_ENABLED must be true or false/],
    ["WEB_PUBLIC_URL", "beta.example.org", /invalid value: WEB_PUBLIC_URL must be an http\(s\) URL/],
  ])("exits 2 naming %s when it is set to %j", async (name, value, message) => {
    const r = await runHttp({ ...BASE, [name]: value });
    expect(r.code, r.stderr).toBe(2);
    expect(r.stderr).toMatch(message);
    // Refused before the store is built, as the other environment checks are.
    expect(r.stderr).not.toMatch(/s3 credentials:/);
  }, TEST_TIMEOUT_MS);

  it("exits 2 naming an orphan sweep grace under its floor", async () => {
    const r = await runHttp({ ...BASE, GENEALOGY_ORPHAN_GRACE_S: "60" });
    expect(r.code, r.stderr).toBe(2);
    expect(r.stderr).toMatch(/invalid value: GENEALOGY_ORPHAN_GRACE_S .*at least 3600/);
  }, TEST_TIMEOUT_MS);

  // The two process-wide limits (self-hosted beta E4). These cases are what
  // stops a PR shipping a fully unit-tested parser that src/http.ts never
  // merges into its exit branch and never hands to either module -- every
  // other test would still be green.
  it("exits 2 naming a limit set to a value it may not take", async () => {
    const zero = await runHttp({ ...BASE, GENEALOGY_FS_CALLS_PER_MINUTE: "0" });
    expect(zero.code, zero.stderr).toBe(2);
    expect(zero.stderr).toMatch(/invalid value: GENEALOGY_FS_CALLS_PER_MINUTE/);

    const words = await runHttp({ ...BASE, GENEALOGY_MAX_TRANSCRIPTIONS: "abc" });
    expect(words.code, words.stderr).toBe(2);
    expect(words.stderr).toMatch(/invalid value: GENEALOGY_MAX_TRANSCRIPTIONS/);
  }, TEST_TIMEOUT_MS * 2);

  it("names both limits on start-up, and says when each is off", async () => {
    const off = await runHttp(BASE, /listening on .*\n/);
    expect(off.stderr).toMatch(/fs budget: off\n/);
    expect(off.stderr).toMatch(/transcription cap: off\n/);

    const on = await runHttp(
      { ...BASE, GENEALOGY_FS_CALLS_PER_MINUTE: "120", GENEALOGY_MAX_TRANSCRIPTIONS: "4" },
      /listening on .*\n/,
    );
    expect(on.stderr).toMatch(/fs budget: 120 calls\/min\n/);
    expect(on.stderr).toMatch(/transcription cap: 4 at a time\n/);
  }, (START_TIMEOUT_MS + TEST_TIMEOUT_MS) * 2);

  it("names the orphan sweep's schedule on start-up, and says when it is off", async () => {
    const on = await runHttp(BASE, /listening on .*\n/);
    expect(on.stderr).toMatch(/orphan sweep: every 3600 s, grace 86400 s\n/);
    const off = await runHttp({ ...BASE, GENEALOGY_ORPHAN_SWEEP_INTERVAL_S: "0" }, /listening on .*\n/);
    expect(off.stderr).toMatch(/orphan sweep: off\n/);
  }, START_TIMEOUT_MS + TEST_TIMEOUT_MS);

  it("names the SDK default chain on start-up when neither S3 key is set", async () => {
    const r = await runHttp(BASE, /s3 credentials:.*\n/);
    expect(r.stderr).toMatch(/s3 credentials: SDK default chain; region us-east-1; endpoint AWS default/);
  }, TEST_TIMEOUT_MS);

  it("names static keys on start-up without printing either key", async () => {
    const r = await runHttp(
      { ...BASE, GENEALOGY_S3_ACCESS_KEY: "ak-sentinel", GENEALOGY_S3_SECRET_KEY: "sk-sentinel" },
      /s3 credentials:.*\n/,
    );
    expect(r.stderr).toMatch(/s3 credentials: static keys;/);
    expect(r.stderr).not.toMatch(/ak-sentinel|sk-sentinel/);
  }, TEST_TIMEOUT_MS);
});

describe("build/http.js debug holds", () => {
  it("prints no debug-hold line when neither hold is set", async () => {
    const r = await runHttp(BASE, /listening on .*\n/);
    expect(r.stderr).toMatch(/listening on/);
    expect(r.stderr).not.toMatch(/debug hold|GENEALOGY_DEBUG_/i);
  }, TEST_TIMEOUT_MS);

  it("names a set hold and its value before listening", async () => {
    const r = await runHttp({ ...BASE, GENEALOGY_DEBUG_HOLD_AFTER_COMMIT_MS: "45000" }, /listening on .*\n/);
    expect(r.stderr).toMatch(
      /debug holds set \(never in production\): GENEALOGY_DEBUG_HOLD_AFTER_COMMIT_MS="45000"\n(.|\n)*listening on/,
    );
    expect(r.stderr).not.toMatch(/GENEALOGY_DEBUG_HOLD_BEFORE_COMMIT_MS/);
  }, TEST_TIMEOUT_MS);
});

// U29: GENEALOGY_PG_SAS_OBJECT. The fake @fs/sas-client (tests/fixtures/fake-sas)
// is reached through NODE_PATH, as the bundle's node_modules would be.
describe("build/http.js with GENEALOGY_PG_SAS_OBJECT", () => {
  const SAS = { GENEALOGY_PG_SAS_OBJECT: "pgobj", GENEALOGY_S3_BUCKET: "projects" };
  const PASSWORD = "pw-sentinel-29";
  const OBJECT = JSON.stringify({
    fchUser: "app",
    fchPassword: PASSWORD,
    fchDbConnectUrl: "jdbc:postgresql://127.0.0.1:1/proto?sslmode=require",
  });
  let nodePath = "";
  let tmp = "";

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), "fake-sas-"));
    const pkg = join(tmp, "node_modules", "@fs", "sas-client");
    mkdirSync(pkg, { recursive: true });
    const fixture = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures/fake-sas/sas-client.cjs");
    writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "@fs/sas-client", main: "index.js" }), "utf8");
    writeFileSync(join(pkg, "index.js"), `module.exports = require(${JSON.stringify(fixture)});\n`, "utf8");
    nodePath = join(tmp, "node_modules");
  });

  afterAll(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  it("exits 2 when @fs/sas-client is not installed", async () => {
    const r = await runHttp({ ...SAS, NODE_PATH: "" });
    expect(r.code, r.stderr).toBe(2);
    expect(r.stderr).toContain(
      "http: GENEALOGY_PG_SAS_OBJECT is set but @fs/sas-client is not installed " +
        "(FamilySearch's build installs it; use GENEALOGY_PG_DSN elsewhere)\n",
    );
  }, TEST_TIMEOUT_MS);

  it("exits 2 when GENEALOGY_PG_DSN is set as well", async () => {
    const r = await runHttp({ ...BASE, ...SAS, NODE_PATH: nodePath, FAKE_SAS_OBJECT_JSON: OBJECT });
    expect(r.code, r.stderr).toBe(2);
    expect(r.stderr).toMatch(/invalid value: GENEALOGY_PG_SAS_OBJECT .*exclusive/);
  }, TEST_TIMEOUT_MS);

  it("exits 2 naming the field when the object is unusable, never its values", async () => {
    const r = await runHttp({
      ...SAS,
      NODE_PATH: nodePath,
      FAKE_SAS_OBJECT_JSON: JSON.stringify({ fchUser: "app", fchDbConnectUrl: "jdbc:postgresql://h/d" }),
    });
    expect(r.code, r.stderr).toBe(2);
    expect(r.stderr).toContain("http: SAS object pgobj unusable: SAS object has no fchPassword\n");
  }, TEST_TIMEOUT_MS);

  it("exits 1 with the error label when SAS stays unreachable through three tries", async () => {
    const r = await runHttp(
      { ...SAS, NODE_PATH: nodePath, FAKE_SAS_ERROR_CODE: "ECONNREFUSED" },
      undefined,
      START_TIMEOUT_MS + 15_000,
    );
    expect(r.code, r.stderr).toBe(1);
    expect(r.stderr).toContain("http: SAS object pgobj unavailable (ECONNREFUSED)\n");
    expect(r.stderr).not.toContain("fake SAS refused");
  }, TEST_TIMEOUT_MS + 15_000);

  it("names the SAS object, listens, and answers 503 on /healthz without the password", async () => {
    const { child, port } = await startHttp({
      ...SAS,
      NODE_PATH: nodePath,
      FAKE_SAS_OBJECT_JSON: OBJECT,
      GENEALOGY_S3_ENDPOINT: "http://127.0.0.1:1",
      GENEALOGY_ORPHAN_SWEEP_INTERVAL_S: "0",
    });
    let stderr = "";
    child.stderr!.on("data", (chunk: string) => {
      stderr += chunk;
    });
    try {
      const res = await fetch(`http://127.0.0.1:${port}/healthz`);
      const text = await res.text();
      expect(res.status, text).toBe(503);
      expect(JSON.parse(text)).toMatchObject({ ok: false, checks: { postgres: { ok: false } } });
      expect(text).not.toContain(PASSWORD);
      expect((await fetch(`http://127.0.0.1:${port}/livez`)).status).toBe(200);
      expect(stderr).not.toContain(PASSWORD);
    } finally {
      child.kill("SIGKILL");
    }
  }, TEST_TIMEOUT_MS);

  it("prints the SAS mode line before listening", async () => {
    const r = await runHttp(
      { ...SAS, NODE_PATH: nodePath, FAKE_SAS_OBJECT_JSON: OBJECT, GENEALOGY_ORPHAN_SWEEP_INTERVAL_S: "0" },
      /listening on .*\n/,
    );
    expect(r.stderr).toMatch(/pg credentials: SAS object pgobj\n(.|\n)*listening on/);
    expect(r.stderr).not.toContain(PASSWORD);
  }, TEST_TIMEOUT_MS);

  it("names the environment DSN when only GENEALOGY_PG_DSN is set", async () => {
    const r = await runHttp(BASE, /listening on .*\n/);
    expect(r.stderr).toMatch(/pg credentials: environment DSN\n/);
  }, TEST_TIMEOUT_MS);
});

import { describe, it, expect } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The real build/http.js (`pretest` builds it) refusing to start on a store
// environment it cannot use: a half-set S3 key pair, or a path-style flag that
// is neither `true` nor `false`. Both exit before the Pg/S3 backend exists, so
// no stack is needed. The start-up mode line and the debug-hold line are read
// the same way, killing the child once it prints. Every inherited GENEALOGY_*
// variable is cleared, so the case sees only what it sets. The readiness case
// keeps the child running, with both stores pointed at a closed port, and asks
// it for /healthz.

const HTTP_JS = resolve(dirname(fileURLToPath(import.meta.url)), "../../build/http.js");

const BASE = { GENEALOGY_PG_DSN: "postgresql://u:p@127.0.0.1:1/d", GENEALOGY_S3_BUCKET: "projects" };

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
    // 15s, not 5s: under make test-all's parallel load, start-up alone has run past
    // 5s and been killed before it could exit 2.
    const timer = setTimeout(() => child.kill("SIGKILL"), 15_000);
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
      reject(new Error(`build/http.js did not listen within 5 s:\n${stderr}`));
    }, 5000);
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
  it("answers 503 on /healthz with Postgres and S3 unreachable and keeps running", async () => {
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
      // A failing store is a 503, never an exit.
      await new Promise((r) => setTimeout(r, 200));
      expect(child.exitCode).toBeNull();
      expect(child.signalCode).toBeNull();
    } finally {
      child.kill("SIGKILL");
    }
  }, 10_000);
});

describe("build/http.js store environment", () => {
  it("exits 2 naming the unset partner when exactly one S3 key is set", async () => {
    const r = await runHttp({ ...BASE, GENEALOGY_S3_ACCESS_KEY: "ak" });
    expect(r.code, r.stderr).toBe(2);
    expect(r.stderr).toMatch(/required environment not set: GENEALOGY_S3_SECRET_KEY/);
  }, 20_000);

  it("exits 2 naming GENEALOGY_S3_FORCE_PATH_STYLE when it is neither true nor false", async () => {
    const r = await runHttp({ ...BASE, GENEALOGY_S3_FORCE_PATH_STYLE: "yes" });
    expect(r.code, r.stderr).toBe(2);
    expect(r.stderr).toMatch(/invalid value.*GENEALOGY_S3_FORCE_PATH_STYLE/);
  }, 20_000);

  it("names the SDK default chain on start-up when neither S3 key is set", async () => {
    const r = await runHttp(BASE, /s3 credentials:.*\n/);
    expect(r.stderr).toMatch(/s3 credentials: SDK default chain; region us-east-1; endpoint AWS default/);
  }, 20_000);

  it("names static keys on start-up without printing either key", async () => {
    const r = await runHttp(
      { ...BASE, GENEALOGY_S3_ACCESS_KEY: "ak-sentinel", GENEALOGY_S3_SECRET_KEY: "sk-sentinel" },
      /s3 credentials:.*\n/,
    );
    expect(r.stderr).toMatch(/s3 credentials: static keys;/);
    expect(r.stderr).not.toMatch(/ak-sentinel|sk-sentinel/);
  }, 20_000);
});

describe("build/http.js debug holds", () => {
  it("prints no debug-hold line when neither hold is set", async () => {
    const r = await runHttp(BASE, /listening on .*\n/);
    expect(r.stderr).toMatch(/listening on/);
    expect(r.stderr).not.toMatch(/debug hold|GENEALOGY_DEBUG_/i);
  }, 10_000);

  it("names a set hold and its value before listening", async () => {
    const r = await runHttp({ ...BASE, GENEALOGY_DEBUG_HOLD_AFTER_COMMIT_MS: "45000" }, /listening on .*\n/);
    expect(r.stderr).toMatch(
      /debug holds set \(never in production\): GENEALOGY_DEBUG_HOLD_AFTER_COMMIT_MS="45000"\n(.|\n)*listening on/,
    );
    expect(r.stderr).not.toMatch(/GENEALOGY_DEBUG_HOLD_BEFORE_COMMIT_MS/);
  }, 10_000);
});

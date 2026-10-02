import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The real build/http.js (`pretest` builds it) refusing to start on a store
// environment it cannot use: a half-set S3 key pair, or a path-style flag that
// is neither `true` nor `false`. Both exit before the Pg/S3 backend exists, so
// no stack is needed. The start-up mode line is read the same way, killing the
// child once it is printed. Every inherited GENEALOGY_* variable is cleared, so the
// case sees only what it sets.

const HTTP_JS = resolve(dirname(fileURLToPath(import.meta.url)), "../../build/http.js");

const BASE = { GENEALOGY_PG_DSN: "postgresql://u:p@127.0.0.1:1/d", GENEALOGY_S3_BUCKET: "projects" };

// With `until`, the child is killed as soon as stderr matches it.
function runHttp(
  storeEnv: Record<string, string>,
  until?: RegExp,
): Promise<{ code: number | null; stderr: string }> {
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (!name.startsWith("GENEALOGY_")) env[name] = value;
  }
  Object.assign(env, storeEnv);
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [HTTP_JS, "--port", "0"], { env, stdio: ["ignore", "ignore", "pipe"] });
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

import http from "node:http";
import type { AddressInfo } from "node:net";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, vi } from "vitest";
import { createViewer, type ViewerOptions } from "../../viewer/http.js";
import { fileStoreOnly } from "../helpers/store-backend.js";

export const ENGINE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const STUB_PAGE = "<!doctype html><title>stub page</title><p>stub</p>";
export const SECRET = "Test_secret-0123456789-abcdefghijklmnop";
export const PUBLIC_URL = "https://viewer.example";
export const RESEARCH = { project: { title: "Stub project" } };

/** Raw JSON nested too deep for Node 22's JSON.stringify, so only raw text can carry
 *  it. Node 25's does not overflow at any depth the body cap allows. */
export const DEEP_JSON = `${"[".repeat(20_000)}${"]".repeat(20_000)}`;

/** An initialize as raw text, with `clientInfo` already JSON. */
export const rawInitialize = (clientInfo: string, envelope = `"jsonrpc":"2.0","id":1`): string =>
  `{${envelope},"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":${clientInfo}}}`;

/** Calls `fileStoreOnly` before each test of a file: a real folder and its
 *  symlinks have no Postgres meaning. Runs after the pg setup file's hook. */
export function realFoldersOnly(): void {
  beforeEach(() => {
    fileStoreOnly("the viewer resolves real folders and symlinks under --root");
  });
}

export function writeProject(dir: string, research: unknown = RESEARCH): string {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "research.json"), JSON.stringify(research), "utf8");
  return dir;
}

/** A temp folder per test, realpath'd: on macOS `tmpdir()` is itself an alias. */
export function tempFolders(): { base: () => string; root: () => string } {
  let base = "";
  beforeEach(() => {
    base = realpathSync(mkdtempSync(join(tmpdir(), "viewer-test-")));
    mkdirSync(join(base, "root"));
  });
  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });
  return { base: () => base, root: () => join(base, "root") };
}

export interface RpcReply {
  status: number;
  headers: Headers;
  body: any;
}

export interface RunningViewer {
  origin: string;
  log: string[];
  /** Log lines parsed, once `count` of them have been written. */
  logged: (count: number) => Promise<any[]>;
  rpc: (method: string, params?: unknown) => Promise<RpcReply>;
  /** tools/call's `result`, sent as the page sends it: no initialize first. */
  call: (name: string, args?: Record<string, unknown>) => Promise<any>;
}

const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise((done) => {
          server.closeAllConnections();
          server.close(done);
        }),
    ),
  );
});

export async function startViewer(rootReal: string, overrides: Partial<ViewerOptions> = {}): Promise<RunningViewer> {
  const log: string[] = [];
  const server = http.createServer(
    createViewer({
      pageHtml: STUB_PAGE,
      rootReal,
      secret: SECRET,
      publicUrl: PUBLIC_URL,
      local: false,
      log: (line) => log.push(line),
      now: Date.now,
      ...overrides,
    }),
  );
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const secret = overrides.secret ?? SECRET;

  const rpc = async (method: string, params?: unknown): Promise<RpcReply> => {
    const response = await fetch(`${origin}/${secret}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    return { status: response.status, headers: response.headers, body: await response.json() };
  };

  return {
    origin,
    log,
    logged: async (count) => {
      await vi.waitFor(() => {
        if (log.length < count) throw new Error(`${log.length} of ${count} log lines`);
      });
      return log.map((line) => JSON.parse(line));
    },
    rpc,
    call: async (name, args = {}) => {
      const reply = await rpc("tools/call", { name, arguments: args });
      if (reply.status !== 200 || !reply.body.result) throw new Error(`tools/call failed: ${JSON.stringify(reply.body)}`);
      return reply.body.result;
    },
  };
}

/** The text of a failed tool result, failing if it did not fail. */
export function refusal(result: any): string {
  if (result.isError !== true) throw new Error(`expected a refusal, got ${JSON.stringify(result).slice(0, 300)}`);
  return result.content[0].text;
}

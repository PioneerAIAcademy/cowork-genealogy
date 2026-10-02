import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Server as HttpServer } from "node:http";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Acceptance check for D16 (items 1, 3, 4, 5) and for per-request store scoping
// (item 2, split three ways): the tool server over Streamable HTTP, started
// in-process on port 0 and driven with the SDK's own client transport. The
// store behind each X-Genealogy-Project-Id is a ScopedFsStore under one temp
// root, so no compose stack is needed; tests/http/http-server-pg.test.ts runs
// the isolation case against the real PgS3ProjectStore.

// Item 4 needs to see what reaches upstream. Every tool's external call goes
// through utils/http.ts (tests/packaging/no-bare-fetch.test.ts), so mocking
// its two fetchers is enough to capture the Authorization header each
// concurrent request carried. `vi.mock` is hoisted above the imports below, so
// the server module — and every tool it pulls in — binds the mock.
const upstream = vi.hoisted(() => ({
  calls: [] as Array<{ url: string; authorization: string | undefined }>,
}));

vi.mock("../../src/utils/http.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/utils/http.js")>();
  const capture = async (url: string | URL, init: RequestInit = {}): Promise<Response> => {
    const headers = new Headers(init.headers);
    upstream.calls.push({ url: String(url), authorization: headers.get("authorization") ?? undefined });
    return new Response("{}", { status: 401, statusText: "Unauthorized" });
  };
  return { ...actual, fetchWithRetry: capture, fetchWithTimeout: capture };
});

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { HEALTHZ_TIMEOUT_MS, startHttpServer, type ReadyReport } from "../../src/http-server.js";
import { allToolSchemas } from "../../src/tool-schemas.js";
import { HOSTED_REAUTH_INSTRUCTION } from "../../src/auth/config.js";
import type { ProjectStore } from "../../src/store/project-store.js";
import { ScopedFsStore, SCOPED_ANCHOR } from "../helpers/scoped-fs-store.js";

// The wire spelling; node:http lower-cases it to PROJECT_ID_HEADER on arrival.
const PROJECT_HEADER = "X-Genealogy-Project-Id";

let server: HttpServer;
let base: string;
/** The double's root: one directory per project id underneath. */
let root: string;
// Every id the server bound a store for, in order — the store half's oracle.
const bindStore = vi.fn(
  (projectId: string, _signal: AbortSignal): ProjectStore => new ScopedFsStore(root, projectId),
);
const clients: Client[] = [];
// Every HTTP exchange the SDK client made, so item 1 can show the 405 arrived.
const exchanges: Array<{ method: string; path: string; status: number }> = [];

async function connect(headers?: Record<string, string>): Promise<Client> {
  const client = new Client({ name: "http-server-test", version: "0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
    requestInit: headers ? { headers } : undefined,
    fetch: async (url, init) => {
      const res = await fetch(url, init);
      exchanges.push({
        method: init?.method ?? "GET",
        path: new URL(String(url)).pathname,
        status: res.status,
      });
      return res;
    },
  });
  await client.connect(transport);
  clients.push(client);
  return client;
}

function textOf(result: Awaited<ReturnType<Client["callTool"]>>): string {
  return (result.content as Array<{ type: string; text?: string }>)
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("");
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "http-server-test-"));
  server = await startHttpServer({ host: "127.0.0.1", port: 0, baseConfig: {}, bindStore });
  const address = server.address();
  if (!address || typeof address !== "object") throw new Error("server did not bind a port");
  base = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await Promise.all(clients.map((c) => c.close().catch(() => undefined)));
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(root, { recursive: true, force: true });
});

/** A `project_create` payload whose one tree person is given-named `given`. */
function createArgs(given: string): Record<string, unknown> {
  return {
    projectPath: SCOPED_ANCHOR,
    objective: "Does the HTTP transport bind a store per request?",
    title: `http ${given}`,
    subjectPersonIds: ["P1"],
    tree: {
      persons: [
        {
          id: "P1",
          gender: "Male",
          names: [{ id: "N1", preferred: true, given, surname: "Person", type: "BirthName" }],
          facts: [{ id: "F1", type: "Birth", primary: true, date: "1850", place: "Nowhere" }],
        },
      ],
      relationships: [],
      sources: [],
    },
  };
}

/** `persons[].name` from `project_context` under one client. */
async function personNames(client: Client): Promise<string[]> {
  const result = await client.callTool({ name: "project_context", arguments: { projectPath: SCOPED_ANCHOR } });
  expect(result.isError, textOf(result)).not.toBe(true);
  const body = JSON.parse(textOf(result)) as { persons: Array<{ name: string | null }> };
  return body.persons.map((p) => p.name ?? "");
}

describe("tool server over Streamable HTTP", () => {
  it("1. tools/list is exactly allToolSchemas, and still works after the post-initialize GET got 405", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(allToolSchemas.map((s) => s.name).sort());

    // The SDK client opens its server-push GET after `notifications/initialized`
    // is accepted (fire-and-forget), so wait for that exchange to be recorded.
    await vi.waitFor(() => {
      expect(exchanges.some((e) => e.method === "GET" && e.path === "/mcp")).toBe(true);
    });
    const gets = exchanges.filter((e) => e.method === "GET" && e.path === "/mcp");
    expect(gets.map((e) => e.status)).toEqual(gets.map(() => 405));

    const again = await client.listTools();
    expect(again.tools.length).toBe(allToolSchemas.length);
  });

  it("2. two concurrent requests with different X-Genealogy-Project-Id headers cannot read each other's documents", async () => {
    bindStore.mockClear();
    const idA = `alpha-${randomUUID()}`;
    const idB = `beta-${randomUUID()}`;
    const [a, b] = await Promise.all([
      connect({ [PROJECT_HEADER]: idA }),
      connect({ [PROJECT_HEADER]: idB }),
    ]);
    const [createdA, createdB] = await Promise.all([
      a.callTool({ name: "project_create", arguments: createArgs("Alpha") }),
      b.callTool({ name: "project_create", arguments: createArgs("Beta") }),
    ]);
    expect(createdA.isError, textOf(createdA)).not.toBe(true);
    expect(createdB.isError, textOf(createdB)).not.toBe(true);
    expect(JSON.parse(textOf(createdA)).ok).toBe(true);
    expect(JSON.parse(textOf(createdB)).ok).toBe(true);

    const [namesA, namesB] = await Promise.all([personNames(a), personNames(b)]);
    expect(namesA.some((n) => n.includes("Alpha"))).toBe(true);
    expect(namesA.some((n) => n.includes("Beta"))).toBe(false);
    expect(namesB.some((n) => n.includes("Beta"))).toBe(true);
    expect(namesB.some((n) => n.includes("Alpha"))).toBe(false);

    // Every POST bound a store for exactly the id its header named — the
    // initialize handshake included — and for no other id.
    const bound = bindStore.mock.calls.map(([id]) => id);
    expect(new Set(bound)).toEqual(new Set([idA, idB]));
    for (const id of [idA, idB]) expect(bound.filter((b) => b === id).length).toBeGreaterThan(0);

    // And the double put them in two directories, so the isolation was the
    // header's doing rather than the same document read twice.
    for (const id of [idA, idB]) {
      const tree = JSON.parse(await readFile(join(root, id, "tree.gedcomx.json"), "utf-8"));
      expect(tree.persons[0].names[0].given).toBe(id === idA ? "Alpha" : "Beta");
    }
  });

  it("2b. a request with no project header gets an error naming the header from project_create, and convert_calendar still answers", async () => {
    bindStore.mockClear();
    const client = await connect();
    const created = await client.callTool({ name: "project_create", arguments: createArgs("Nobody") });
    expect(created.isError).toBe(true);
    expect(textOf(created)).toContain(PROJECT_HEADER);

    const converted = await client.callTool({
      name: "convert_calendar",
      arguments: { date: { year: 1750, month: 2, day: 10 }, corrections: { osNsYear: true } },
    });
    expect(converted.isError, textOf(converted)).not.toBe(true);
    expect(JSON.parse(textOf(converted))).toMatchObject({ ok: true, converted: { year: 1751 } });

    expect(bindStore).not.toHaveBeenCalled();
    // Nothing reached the file backend either: the root holds only the
    // directories item 2 wrote.
    const dirs = (await readdir(root)).filter((d) => d !== "__missing__");
    expect(dirs.every((d) => d.startsWith("alpha-") || d.startsWith("beta-"))).toBe(true);
  });

  it("2c. a malformed project id is a 400 before any tool runs", async () => {
    bindStore.mockClear();
    const res = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        [PROJECT_HEADER]: "p/q",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "project_create", arguments: createArgs("Malformed") },
      }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      jsonrpc: "2.0",
      error: { code: -32600, message: "Invalid X-Genealogy-Project-Id header." },
      id: null,
    });
    expect(bindStore).not.toHaveBeenCalled();
  });

  it("3. a FamilySearch tool with no Authorization header gets the hosted reauth text, never the desktop one", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "record_read",
      arguments: { recordId: "QVS9-DHDB" },
    });
    expect(result.isError).toBe(true);
    const body = JSON.parse(textOf(result)) as { error: string };
    expect(body.error).toBe(HOSTED_REAUTH_INSTRUCTION);
    expect(body.error).not.toContain("Call the login tool");
    expect(body.error).not.toContain("not logged in");
  });

  it("4. two concurrent calls with different bearers each reach upstream with their own token", async () => {
    upstream.calls.length = 0;
    const [a, b] = await Promise.all([
      connect({ Authorization: "Bearer tok-A" }),
      connect({ Authorization: "Bearer tok-B" }),
    ]);
    const [ra, rb] = await Promise.all([
      a.callTool({ name: "record_read", arguments: { recordId: "QVS9-DHDB" } }),
      b.callTool({ name: "record_read", arguments: { recordId: "QVS9-DHDB" } }),
    ]);
    // The mocked upstream answers 401, which record_read reports as an error —
    // what matters is which token each request carried there.
    expect(ra.isError).toBe(true);
    expect(rb.isError).toBe(true);
    const seen = upstream.calls.map((c) => c.authorization);
    expect(seen.filter((h) => h === "Bearer tok-A")).toHaveLength(1);
    expect(seen.filter((h) => h === "Bearer tok-B")).toHaveLength(1);
    expect(seen).toHaveLength(2);
    for (const call of upstream.calls) {
      expect(call.url).toMatch(/familysearch\.org/);
    }
  });

  it("4b. the image cap is counted per project: A's 21st image refuses without fetching, B's is fetched (#3010)", async () => {
    const idA = `capa-${randomUUID()}`;
    const idB = `capb-${randomUUID()}`;
    const [a, b] = await Promise.all([
      connect({ [PROJECT_HEADER]: idA, Authorization: "Bearer tok-A" }),
      connect({ [PROJECT_HEADER]: idB, Authorization: "Bearer tok-B" }),
    ]);
    for (const [client, given] of [[a, "Alpha"], [b, "Beta"]] as const) {
      const created = await client.callTool({ name: "project_create", arguments: createArgs(given) });
      expect(created.isError, textOf(created)).not.toBe(true);
    }
    // A has already read 20 distinct images from the group, in its own log.
    const group = "004261111";
    const lines = Array.from({ length: 20 }, (_, i) =>
      JSON.stringify({ image_group: group, image_id: `${group}_${String(i + 1).padStart(5, "0")}`, tool: "image_read", at: "2026-10-01T00:00:00Z" }),
    );
    await mkdir(join(root, idA, "results"), { recursive: true });
    await writeFile(join(root, idA, "results", "image-browse.jsonl"), lines.join("\n") + "\n");

    upstream.calls.length = 0;
    const next = `${group}_00021`;
    const refusedA = await a.callTool({ name: "image_read", arguments: { imageId: next, projectPath: SCOPED_ANCHOR } });
    expect(refusedA.isError).toBe(true);
    expect(textOf(refusedA)).toMatch(/Image cap reached/);
    // No projectPath: still counted against A's bound project, through its anchorPath.
    const refusedBare = await a.callTool({ name: "image_read", arguments: { imageId: next } });
    expect(textOf(refusedBare)).toMatch(/Image cap reached/);
    expect(upstream.calls.filter((c) => c.authorization === "Bearer tok-A")).toHaveLength(0);

    const fetchedB = await b.callTool({ name: "image_read", arguments: { imageId: next, projectPath: SCOPED_ANCHOR } });
    expect(textOf(fetchedB)).not.toMatch(/Image cap reached/);
    expect(upstream.calls.filter((c) => c.authorization === "Bearer tok-B").length).toBeGreaterThan(0);
  });

  it("5. /healthz is 200 with the tool count; GET (SSE accept) and DELETE on /mcp are 405 with Allow: POST", async () => {
    const health = await fetch(`${base}/healthz`);
    expect(health.status).toBe(200);
    const healthBody = await health.json();
    expect(healthBody).toMatchObject({ ok: true, tools: allToolSchemas.length });
    // No checkReady option: nothing was probed, so nothing is reported.
    expect(healthBody).not.toHaveProperty("checks");

    // A bare GET would get the SDK transport's 406 and prove nothing about the
    // entrypoint's guard; with the SSE accept header the transport would hold
    // a stream open, so the 405 must come from the entrypoint.
    const get = await fetch(`${base}/mcp`, { headers: { Accept: "text/event-stream" } });
    expect(get.status).toBe(405);
    expect(get.headers.get("allow")).toBe("POST");
    expect(await get.json()).toEqual({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed." },
      id: null,
    });

    const del = await fetch(`${base}/mcp`, { method: "DELETE" });
    expect(del.status).toBe(405);
    expect(del.headers.get("allow")).toBe("POST");

    const missing = await fetch(`${base}/nope`);
    expect(missing.status).toBe(404);
  });

  it("5b. with checkReady, /healthz answers 200 or 503 from the report, and 503 (never 500) on a probe that rejects or never settles", async () => {
    let probe: () => Promise<ReadyReport> = async () => ({ ok: true, checks: {} });
    const ready = await startHttpServer({
      host: "127.0.0.1",
      port: 0,
      baseConfig: {},
      bindStore,
      checkReady: () => probe(),
    });
    const address = ready.address();
    if (!address || typeof address !== "object") throw new Error("server did not bind a port");
    const url = `http://127.0.0.1:${address.port}`;
    const healthz = async (): Promise<{ status: number; body: Record<string, unknown> }> => {
      const res = await fetch(`${url}/healthz`);
      return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    };
    const up = { ok: true };
    const down = { ok: false, error: "ECONNREFUSED" };
    try {
      probe = async () => ({ ok: true, checks: { postgres: up, s3: up } });
      expect(await healthz()).toEqual({
        status: 200,
        body: { ok: true, tools: allToolSchemas.length, checks: { postgres: up, s3: up } },
      });

      // A slow probe inside the deadline is still a 200.
      probe = () =>
        new Promise((resolve) => setTimeout(() => resolve({ ok: true, checks: { postgres: up, s3: up } }), 300));
      expect((await healthz()).status).toBe(200);

      for (const failing of ["postgres", "s3"] as const) {
        const checks = { postgres: up, s3: up, [failing]: down };
        probe = async () => ({ ok: false, checks });
        const r = await healthz();
        expect(r.status, failing).toBe(503);
        expect(r.body, failing).toEqual({ ok: false, tools: allToolSchemas.length, checks });
      }

      // fail → ok: the next probe's answer, not a cached one.
      probe = async () => ({ ok: true, checks: { postgres: up, s3: up } });
      expect((await healthz()).status).toBe(200);

      probe = async () => {
        throw new Error("postgresql://u:p@db.internal/x exploded");
      };
      const rejected = await healthz();
      expect(rejected.status).toBe(503);
      expect(rejected.body).toEqual({ ok: false, tools: allToolSchemas.length });

      probe = () => new Promise<ReadyReport>(() => {});
      const t0 = Date.now();
      const [hung, other] = await Promise.all([healthz(), fetch(`${url}/nope`)]);
      expect(Date.now() - t0).toBeLessThan(HEALTHZ_TIMEOUT_MS + 500);
      expect(hung.status).toBe(503);
      expect(hung.body).toEqual({ ok: false, tools: allToolSchemas.length });
      // The other routes are not held behind the probe.
      expect(other.status).toBe(404);
    } finally {
      ready.closeAllConnections();
      await new Promise<void>((resolve) => ready.close(() => resolve()));
    }
  }, 10_000);

  it("6. a client that disconnects mid-call aborts its store's signal; one that reads its response does not", async () => {
    // The store's first call blocks on `gate`, holding the tool mid-flight the
    // way a debug hold does, so the client can go away before the response.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const gated = (inner: ProjectStore): ProjectStore =>
      new Proxy(inner, {
        get(target, key, receiver) {
          const v = Reflect.get(target, key, receiver);
          return typeof v === "function"
            ? async (...args: unknown[]) => {
                await gate;
                return v.apply(target, args);
              }
            : v;
        },
      });
    const signals: AbortSignal[] = [];
    const post = (id: string, init: RequestInit = {}) =>
      fetch(`${base}/mcp`, {
        ...init,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          [PROJECT_HEADER]: id,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "project_context", arguments: { projectPath: SCOPED_ANCHOR } },
        }),
      });

    bindStore.mockImplementationOnce((projectId, signal) => {
      signals.push(signal);
      return gated(new ScopedFsStore(root, projectId));
    });
    const client = new AbortController();
    const dropped = post(`gone-${randomUUID()}`, { signal: client.signal }).catch(() => undefined);
    await vi.waitFor(() => expect(signals).toHaveLength(1));
    expect(signals[0].aborted).toBe(false);
    client.abort();
    await vi.waitFor(() => expect(signals[0].aborted).toBe(true));
    release();
    await dropped;

    bindStore.mockImplementationOnce((projectId, signal) => {
      signals.push(signal);
      return new ScopedFsStore(root, projectId);
    });
    const answered = await post(`kept-${randomUUID()}`);
    expect(answered.status).toBe(200);
    await answered.text();
    await new Promise((resolve) => setImmediate(resolve));
    expect(signals).toHaveLength(2);
    expect(signals[1].aborted).toBe(false);
  });
});

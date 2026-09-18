import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Server as HttpServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Acceptance check for D16 (PLAN.md, "Acceptance check" items 1-5): the tool
// server over Streamable HTTP, started in-process on port 0 and driven with the
// SDK's own client transport.

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
import { startHttpServer } from "../../src/http-server.js";
import { allToolSchemas } from "../../src/tool-schemas.js";
import { HOSTED_REAUTH_INSTRUCTION } from "../../src/auth/config.js";

let server: HttpServer;
let base: string;
let projectPath: string;
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
  projectPath = await mkdtemp(join(tmpdir(), "http-server-test-"));
  server = await startHttpServer({ host: "127.0.0.1", port: 0, baseConfig: {} });
  const address = server.address();
  if (!address || typeof address !== "object") throw new Error("server did not bind a port");
  base = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await Promise.all(clients.map((c) => c.close().catch(() => undefined)));
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(projectPath, { recursive: true, force: true });
});

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

  it("2. project_create and validate_research_schema work over HTTP against a temp dir", async () => {
    const client = await connect();
    const created = await client.callTool({
      name: "project_create",
      arguments: {
        projectPath,
        objective: "Does the HTTP transport reach the project store?",
        title: "http smoke",
        subjectPersonIds: ["P1"],
        tree: {
          persons: [
            {
              id: "P1",
              gender: "Male",
              names: [{ id: "N1", preferred: true, given: "Smoke", surname: "Person", type: "BirthName" }],
              facts: [{ id: "F1", type: "Birth", primary: true, date: "1850", place: "Nowhere" }],
            },
          ],
          relationships: [],
          sources: [],
        },
      },
    });
    expect(created.isError, textOf(created)).not.toBe(true);
    expect(JSON.parse(textOf(created)).ok).toBe(true);

    const valid = await client.callTool({
      name: "validate_research_schema",
      arguments: { projectPath },
    });
    expect(valid.isError, textOf(valid)).not.toBe(true);
    expect(JSON.parse(textOf(valid)).valid).toBe(true);
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

  it("5. /healthz is 200 with the tool count; GET (SSE accept) and DELETE on /mcp are 405 with Allow: POST", async () => {
    const health = await fetch(`${base}/healthz`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true, tools: allToolSchemas.length });

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
});

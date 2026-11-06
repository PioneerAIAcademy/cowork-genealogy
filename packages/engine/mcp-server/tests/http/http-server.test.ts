import { createHash } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
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
import {
  __resetUserLimitsForTests,
  __userLimitsStateForTests,
  USER_CALL_CAP,
} from "../../src/utils/user-limits.js";
import {
  CLAIM_EPOCH_HEADER,
  claimFenceFromHeaders,
  CONNECTOR_PROJECT_RE,
  HEALTHZ_TIMEOUT_MS,
  PROJECT_ID_HEADER,
  MAX_BODY_BYTES,
  connectorConfig,
  keptFamilySearchStatus,
  toolNameOf,
  PRM_PATH,
  startHttpServer,
  TURN_ID_HEADER,
  type AuthorizeRequest,
  type AuthorizeResult,
  type ReadyReport,
} from "../../src/http-server.js";
import { allToolSchemas } from "../../src/tool-schemas.js";
import { HOSTED_REAUTH_INSTRUCTION } from "../../src/auth/config.js";
import type { ClaimFence, OwnedProjectIds, ProjectStore } from "../../src/store/project-store.js";
import { ScopedFsStore, SCOPED_ANCHOR } from "../helpers/scoped-fs-store.js";

// The wire spelling; node:http lower-cases it to PROJECT_ID_HEADER on arrival.
const PROJECT_HEADER = "X-Genealogy-Project-Id";

let server: HttpServer;
let base: string;
/** The double's root: one directory per project id underneath. */
let root: string;
// Every id the server bound a store for, in order — the store half's oracle.
const bindStore = vi.fn(
  (
    projectId: string,
    _signal: AbortSignal,
    _fence?: ClaimFence,
    // E1: a connector request names its own anchor and owner.
    opts?: { anchorPath?: string; ownerId?: string },
  ): ProjectStore => new ScopedFsStore(root, projectId, opts?.anchorPath),
);
// Allow-all unless a case says otherwise: the project check itself is U4's
// section below and tests/http/http-server-pg.test.ts.
const authorize = vi.fn(async (_req: AuthorizeRequest): Promise<AuthorizeResult> => ({ ok: true }));
const clients: Client[] = [];
// Every HTTP exchange the SDK client made, so item 1 can show the 405 arrived.
const exchanges: Array<{ method: string; path: string; status: number }> = [];

/**
 * A client. With no headers it presents the TEST CONNECTOR TOKEN, because a
 * request with no project header now takes the connector door and one with
 * neither a project header nor a connector token is a 401 (E1). Pass headers to
 * override; pass {} for a genuinely anonymous client.
 */
async function connect(headers?: Record<string, string>, url: string = base): Promise<Client> {
  const client = new Client({ name: "http-server-test", version: "0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${url}/mcp`), {
    requestInit: { headers: headers ?? connectorHeaders() },
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

// Connector doubles (self-hosted beta E1). This module loads no backend, so
// these stand in for the Postgres lookups the entrypoint wires -- the same
// reason `authorize` and `bindStore` are injected.
//
// Every case that sends NO project header now takes the connector path, so it
// must present this token; a request with neither a project header nor a
// connector token is a 401, which is the point.
export const TEST_CONNECTOR_TOKEN = "connector-token-for-tests";
export const TEST_USER_ID = "u_test";

/** Connector tokens this double admits, each mapping to its own user AND its
 *  own decrypted FamilySearch token. Two of them, so item 4 can show the
 *  per-request principal is built from the LOOKUP, not from the header. */
const CONNECTOR_USERS: Record<string, { userId: string; familySearchToken: string }> = {
  [TEST_CONNECTOR_TOKEN]: { userId: TEST_USER_ID, familySearchToken: "fs-access-token" },
  "connector-token-A": { userId: "u_A", familySearchToken: "fs-tok-A" },
  "connector-token-B": { userId: "u_B", familySearchToken: "fs-tok-B" },
};
const lookupConnector = vi.fn(async (tokenSha256: string) => {
  for (const [token, who] of Object.entries(CONNECTOR_USERS)) {
    if (createHash("sha256").update(token, "utf8").digest("hex") === tokenSha256) {
      return { ...who, openRouterApiKey: null };
    }
  }
  return null;
});
/** No row: a fresh id, free for the first write to claim. */
const projectOwner = vi.fn(
  async (_projectId: string): Promise<{ exists: boolean; ownerId: string | null }> => ({
    exists: false,
    ownerId: null,
  }),
);

/** The caller owns nothing unless a case says otherwise. */
const ownedProjects = vi.fn(async (_userId: string): Promise<OwnedProjectIds> => ({ ids: [], truncated: false }));

/** The headers a connector request carries. */
function connectorHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { Authorization: `Bearer ${TEST_CONNECTOR_TOKEN}`, ...extra };
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "http-server-test-"));
  server = await startHttpServer({
    host: "127.0.0.1",
    port: 0,
    baseConfig: {},
    bindStore,
    authorize,
    lookupConnector,
    projectOwner,
    ownedProjects,
  });
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

  it("2b. a connector call whose projectPath is not a /proj_ path is refused at the door, before any tool", async () => {
    // Was: "no project header -> the tool names the header". A request with no
    // project header is now the CONNECTOR door (E1), and SCOPED_ANCHOR is the
    // worker's anchor, not a connector path -- so this is refused before a
    // store or a tool exists, which is a better refusal than the old one.
    bindStore.mockClear();
    authorize.mockClear();
    const res = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: {
        ...connectorHeaders(),
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "project_create", arguments: createArgs("Nobody") },
      }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toMatch(/proj_ followed by 16 lowercase hex/);
    expect(bindStore).not.toHaveBeenCalled();
    expect(authorize).not.toHaveBeenCalled();
  });

  it("2b2. a connector call to a store tool with NO projectPath runs store-less and says so, and convert_calendar still answers", async () => {
    // The other half of the old 2b, and the half whose meaning survives: a
    // connector that names no project at all gets the unbound store, while a
    // store-less tool answers normally.
    bindStore.mockClear();
    const client = await connect();
    const { projectPath: _omit, ...noPath } = createArgs("Nobody");
    const created = await client.callTool({ name: "project_create", arguments: noPath });
    expect(created.isError).toBe(true);

    const converted = await client.callTool({
      name: "convert_calendar",
      arguments: { date: { year: 1750, month: 2, day: 10 }, corrections: { osNsYear: true } },
    });
    expect(converted.isError, textOf(converted)).not.toBe(true);
    expect(JSON.parse(textOf(converted))).toMatchObject({ ok: true, converted: { year: 1751 } });

    expect(bindStore).not.toHaveBeenCalled();
    // Nothing reached the file backend either.
    const dirs = (await readdir(root)).filter((d) => d !== "__missing__");
    expect(dirs.every((d) => d.startsWith("alpha-") || d.startsWith("beta-"))).toBe(true);
  });

  it("2d. baseConfig's public URL reaches project_context as an upload link built from the header's project id, and no viewer link anywhere", async () => {
    const linked = await startHttpServer({
      host: "127.0.0.1",
      port: 0,
      baseConfig: { webPublicUrl: "https://beta.example/", uploadsEnabled: true },
      bindStore,
      authorize,
      lookupConnector,
      projectOwner,
      ownedProjects,
    });
    const address = linked.address();
    if (!address || typeof address !== "object") throw new Error("server did not bind a port");
    try {
      const id = `linked-${randomUUID()}`;
      const client = await connect({ [PROJECT_HEADER]: id }, `http://127.0.0.1:${address.port}`);
      const created = JSON.parse(textOf(await client.callTool({ name: "project_create", arguments: createArgs("Linked") })));
      expect(created.ok, JSON.stringify(created)).toBe(true);
      expect("projectUrl" in created).toBe(false);
      const ctx = JSON.parse(
        textOf(await client.callTool({ name: "project_context", arguments: { projectPath: SCOPED_ANCHOR } })),
      );
      expect("projectUrl" in ctx).toBe(false);
      expect(ctx.uploadUrl).toBe(`https://beta.example/#/p/${id}/upload`);
    } finally {
      linked.closeAllConnections();
      await new Promise<void>((resolve) => linked.close(() => resolve()));
    }
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

  describe("2d. the claim fence (U6): X-Genealogy-Turn-Id + X-Genealogy-Claim-Epoch, both or neither", () => {
    const TURN = "X-Genealogy-Turn-Id";
    const EPOCH = "X-Genealogy-Claim-Epoch";
    const INVALID_CLAIM_FENCE = {
      jsonrpc: "2.0",
      error: {
        code: -32600,
        message:
          "Invalid claim fence: send X-Genealogy-Turn-Id and X-Genealogy-Claim-Epoch together, " +
          "once each, with X-Genealogy-Project-Id.",
      },
      id: null,
    };

    /** One tools/call over raw fetch, so a header can be sent malformed or twice. */
    const post = (headers: Array<[string, string]>) =>
      fetch(`${base}/mcp`, {
        method: "POST",
        headers: [
          ["Content-Type", "application/json"],
          ["Accept", "application/json, text/event-stream"],
          ...headers,
        ],
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "project_context", arguments: { projectPath: SCOPED_ANCHOR } },
        }),
      });

    it("both headers valid: bindStore's third argument is the fence; neither: undefined", async () => {
      const turnId = randomUUID();
      bindStore.mockClear();
      const fenced = await post([
        [PROJECT_HEADER, `fence-${randomUUID()}`],
        [TURN, turnId],
        [EPOCH, "7"],
      ]);
      expect(fenced.status).toBe(200);
      await fenced.text();
      expect(bindStore).toHaveBeenCalledTimes(1);
      expect(bindStore.mock.calls[0][2]).toEqual({ turnId, claimEpoch: "7" });

      bindStore.mockClear();
      const unfenced = await post([[PROJECT_HEADER, `fence-${randomUUID()}`]]);
      expect(unfenced.status).toBe(200);
      await unfenced.text();
      expect(bindStore).toHaveBeenCalledTimes(1);
      expect(bindStore.mock.calls[0][2]).toBeUndefined();
    });

    it.each<[string, Array<[string, string]>]>([
      ["only the turn header", [[TURN, "t1"]]],
      ["only the epoch header", [[EPOCH, "1"]]],
      ["epoch 0", [[TURN, "t1"], [EPOCH, "0"]]],
      ["epoch -1", [[TURN, "t1"], [EPOCH, "-1"]]],
      ["epoch abc", [[TURN, "t1"], [EPOCH, "abc"]]],
      ["epoch 07", [[TURN, "t1"], [EPOCH, "07"]]],
      ["epoch 1.5", [[TURN, "t1"], [EPOCH, "1.5"]]],
      ["an empty epoch", [[TURN, "t1"], [EPOCH, ""]]],
      ["a 19-digit epoch", [[TURN, "t1"], [EPOCH, "1000000000000000000"]]],
      ["a duplicated epoch", [[TURN, "t1"], [EPOCH, "1"], [EPOCH, "2"]]],
      ["a joined epoch '1, 2'", [[TURN, "t1"], [EPOCH, "1, 2"]]],
      ["a turn id with '/'", [[TURN, "t/1"], [EPOCH, "1"]]],
    ])("%s is a 400 before any tool runs", async (_name, fence) => {
      bindStore.mockClear();
      const res = await post([[PROJECT_HEADER, `fence-${randomUUID()}`], ...fence]);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual(INVALID_CLAIM_FENCE);
      expect(bindStore).not.toHaveBeenCalled();
    });

    it("a fence with no project header is a 400, not an unbound store", async () => {
      bindStore.mockClear();
      const res = await post([
        [TURN, "t1"],
        [EPOCH, "1"],
      ]);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual(INVALID_CLAIM_FENCE);
      expect(bindStore).not.toHaveBeenCalled();
    });

    it.each<[string, Array<[string, string]>, { turnId: string; claimEpoch: string }]>([
      ["mixed-case header names", [["x-GENEALOGY-turn-ID", "t1"], ["X-genealogy-CLAIM-epoch", "3"]], { turnId: "t1", claimEpoch: "3" }],
      ["whitespace-padded values", [[TURN, " t1 "], [EPOCH, " 2 "]], { turnId: "t1", claimEpoch: "2" }],
      ["an 18-digit epoch", [[TURN, "t1"], [EPOCH, "999999999999999999"]], { turnId: "t1", claimEpoch: "999999999999999999" }],
    ])("accepts %s", async (_name, fence, expected) => {
      bindStore.mockClear();
      const res = await post([[PROJECT_HEADER, `fence-${randomUUID()}`], ...fence]);
      expect(res.status).toBe(200);
      await res.text();
      expect(bindStore.mock.calls[0][2]).toEqual(expected);
    });

    it("claimFenceFromHeaders refuses an array value (a header node:http does not join)", () => {
      expect(
        claimFenceFromHeaders({
          [PROJECT_ID_HEADER]: "p",
          [TURN_ID_HEADER]: ["t1", "t2"] as unknown as string,
          [CLAIM_EPOCH_HEADER]: "1",
        }),
      ).toEqual({ kind: "malformed" });
      expect(claimFenceFromHeaders({ [PROJECT_ID_HEADER]: "p" })).toEqual({ kind: "absent" });
    });
  });

  describe("2e. the project check (U4): authorize runs before any store, for project requests only", () => {
    const FORBIDDEN_ATTEMPT = {
      jsonrpc: "2.0",
      error: { code: -32600, message: "This bearer is not the grant of an open attempt on this project." },
      id: null,
    };
    const BEARER = "secret-bearer-sentinel";

    const post = (headers: Array<[string, string]>) =>
      fetch(`${base}/mcp`, {
        method: "POST",
        headers: [
          ["Content-Type", "application/json"],
          ["Accept", "application/json, text/event-stream"],
          ...headers,
        ],
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "project_context", arguments: { projectPath: SCOPED_ANCHOR } },
        }),
      });

    /** stderr lines written while `run` runs. */
    async function stderrOf(run: () => Promise<void>): Promise<string> {
      const lines: string[] = [];
      const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
        lines.push(String(chunk));
        return true;
      });
      try {
        await run();
      } finally {
        spy.mockRestore();
      }
      return lines.join("");
    }

    it("hands authorize the project, the fence and the bearer; admitted, the store is bound", async () => {
      const projectId = `door-${randomUUID()}`;
      const turnId = randomUUID();
      authorize.mockClear();
      bindStore.mockClear();
      const res = await post([
        [PROJECT_HEADER, projectId],
        ["X-Genealogy-Turn-Id", turnId],
        ["X-Genealogy-Claim-Epoch", "4"],
        ["Authorization", `Bearer ${BEARER}`],
      ]);
      expect(res.status).toBe(200);
      await res.text();
      expect(authorize).toHaveBeenCalledTimes(1);
      expect(authorize.mock.calls[0][0]).toEqual({ projectId, fence: { turnId, claimEpoch: "4" }, bearer: BEARER });
      expect(bindStore).toHaveBeenCalledTimes(1);

      // No Authorization header and no fence: still asked, with an empty bearer and no fence.
      authorize.mockClear();
      const bare = await post([[PROJECT_HEADER, projectId]]);
      await bare.text();
      expect(authorize.mock.calls[0][0]).toEqual({ projectId, fence: undefined, bearer: "" });
    });

    it.each(["no_fence", "empty_bearer", "no_match"] as const)(
      "a refusal (%s) is a 403 before bindStore, logged with its reason and never the bearer",
      async (reason) => {
        const projectId = `door-${randomUUID()}`;
        const turnId = randomUUID();
        authorize.mockClear();
        bindStore.mockClear();
        authorize.mockResolvedValueOnce({ ok: false, reason });
        let status = 0;
        let text = "";
        const logged = await stderrOf(async () => {
          const res = await post([
            [PROJECT_HEADER, projectId],
            ["X-Genealogy-Turn-Id", turnId],
            ["X-Genealogy-Claim-Epoch", "1"],
            ["Authorization", `Bearer ${BEARER}`],
          ]);
          status = res.status;
          text = await res.text();
        });
        expect(status).toBe(403);
        expect(JSON.parse(text)).toEqual(FORBIDDEN_ATTEMPT);
        expect(text).not.toContain(BEARER);
        expect(bindStore).not.toHaveBeenCalled();
        expect(logged).toContain(`ev=tool_refused reason=${reason} project_id=${projectId} turn_id=${turnId}\n`);
        expect(logged).not.toContain(BEARER);
      },
    );

    it("an authorize that throws is a 503, never an admission, and the error's message is not logged", async () => {
      const projectId = `door-${randomUUID()}`;
      authorize.mockClear();
      bindStore.mockClear();
      authorize.mockRejectedValueOnce(
        Object.assign(new Error(`postgresql://u:p@db.internal/x ${BEARER}`), { code: "ECONNREFUSED" }),
      );
      let status = 0;
      let body: unknown;
      const logged = await stderrOf(async () => {
        const res = await post([
          [PROJECT_HEADER, projectId],
          ["X-Genealogy-Turn-Id", "t1"],
          ["X-Genealogy-Claim-Epoch", "1"],
          ["Authorization", `Bearer ${BEARER}`],
        ]);
        status = res.status;
        body = await res.json();
      });
      expect(status).toBe(503);
      expect(body).toEqual({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Project authorization is unavailable." },
        id: null,
      });
      expect(bindStore).not.toHaveBeenCalled();
      expect(logged).toContain("error=ECONNREFUSED");
      expect(logged).not.toMatch(/db\.internal|secret-bearer-sentinel/);
    });

    it("a request with no project header never calls authorize; a malformed one is a 400 first", async () => {
      authorize.mockClear();
      // No project header is now the CONNECTOR door, so this presents a
      // connector token (without one it is a 401) and names NO project --
      // `post` sends the worker's anchor, which the connector door refuses as
      // not a /proj_ path.
      const store = await fetch(`${base}/mcp`, {
        method: "POST",
        headers: {
          ...connectorHeaders(),
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "convert_calendar",
            arguments: { date: { year: 1750, month: 2, day: 10 }, corrections: { osNsYear: true } },
          },
        }),
      });
      expect(store.status).toBe(200);
      await store.text();
      const malformed = await post([[PROJECT_HEADER, "p/q"]]);
      expect(malformed.status).toBe(400);
      await malformed.text();
      const badFence = await post([[PROJECT_HEADER, `door-${randomUUID()}`], ["X-Genealogy-Turn-Id", "t1"]]);
      expect(badFence.status).toBe(400);
      await badFence.text();
      expect(authorize).not.toHaveBeenCalled();
    });
  });

  it("3. a FamilySearch token the upstream refuses gets the hosted reauth text, never the desktop one", async () => {
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

  it("4. two concurrent connector calls each reach upstream with their OWN FamilySearch token, never the connector token", async () => {
    // Was: the header's bearer reaches upstream. On the connector door the
    // header carries the CONNECTOR token, which authenticates the caller to us
    // and means nothing to FamilySearch -- the token that goes upstream is the
    // decrypted one the lookup returned. So this now proves two things at once:
    // the principal is per request, and the connector token never leaves.
    upstream.calls.length = 0;
    const [a, b] = await Promise.all([
      connect({ Authorization: "Bearer connector-token-A" }),
      connect({ Authorization: "Bearer connector-token-B" }),
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
    expect(seen.filter((h) => h === "Bearer fs-tok-A")).toHaveLength(1);
    expect(seen.filter((h) => h === "Bearer fs-tok-B")).toHaveLength(1);
    expect(seen).toHaveLength(2);
    // The thing that must never happen.
    expect(seen.some((h) => h?.includes("connector-token"))).toBe(false);
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
    // B's bare call on a new image: counted against B's own project, never A's full group.
    const bareB = await b.callTool({ name: "image_read", arguments: { imageId: `${group}_00022` } });
    expect(textOf(bareB)).not.toMatch(/Image cap reached/);
  });

  describe("E1. the connector door", () => {
    const rpc = (body: unknown, headers: Record<string, string> = {}) =>
      fetch(`${base}/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...headers },
        body: JSON.stringify(body),
      });
    const call = (name: string, args: Record<string, unknown>) => ({
      jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args },
    });

    it("no bearer at all is a 401 carrying WWW-Authenticate, not a 403", async () => {
      const res = await rpc(call("convert_calendar", {}));
      expect(res.status).toBe(401);
      // No issuer is configured on this server, so the challenge is bare.
      expect(res.headers.get("WWW-Authenticate")).toBe("Bearer");
      await res.text();
    });

    it("an unknown connector token is a 401 with the SAME body as no token", async () => {
      const [none, unknown] = await Promise.all([
        rpc(call("convert_calendar", {})),
        rpc(call("convert_calendar", {}), { Authorization: "Bearer nope-not-a-token" }),
      ]);
      expect(unknown.status).toBe(401);
      // One body for every reason, so a caller learns nothing about which
      // check failed -- expired, ended, blocked and undecryptable included.
      expect(await unknown.json()).toEqual(await none.json());
    });

    it.each([
      ["a string", "not-an-object"],
      ["a number", 7],
      ["a boolean", true],
    ])("arguments that are %s bind no store and are not a 500", async (_label, args) => {
      bindStore.mockClear();
      const res = await rpc(
        { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "convert_calendar", arguments: args } },
        connectorHeaders(),
      );
      expect(res.status).not.toBe(500);
      await res.text();
      expect(bindStore).not.toHaveBeenCalled();
    });

    it("a JSON-RPC batch is refused before any tool runs", async () => {
      bindStore.mockClear();
      const res = await rpc([call("convert_calendar", {}), call("convert_calendar", {})], connectorHeaders());
      expect(res.status).toBe(400);
      expect((await res.json()).error.message).toMatch(/batch is not supported/);
      expect(bindStore).not.toHaveBeenCalled();
    });

    it.each([
      ["the worker's anchor", "/project"],
      ["no leading slash", "proj_0123456789abcdef"],
      ["uppercase hex", "/proj_0123456789ABCDEF"],
      ["too short", "/proj_0123456789abcde"],
      ["a traversal", "/proj_0123456789abcdef/../other"],
    ])("refuses a projectPath that is %s, before bindStore", async (_label, projectPath) => {
      bindStore.mockClear();
      const res = await rpc(call("project_context", { projectPath }), connectorHeaders());
      expect(res.status).toBe(400);
      expect(bindStore).not.toHaveBeenCalled();
      await res.text();
    });

    it("binds the store at the CALLER'S path, not the worker's anchor", async () => {
      // The whole point: PgS3ProjectStore checks every call's projectPath
      // against its anchor, so a store anchored at GENEALOGY_ANCHOR_PATH makes
      // every connector read read nothing and every write throw.
      bindStore.mockClear();
      const projectPath = "/proj_0123456789abcdef";
      const res = await rpc(call("project_context", { projectPath }), connectorHeaders());
      await res.text();
      expect(bindStore).toHaveBeenCalledTimes(1);
      const [projectId, , fence, opts] = bindStore.mock.calls[0]!;
      expect(projectId).toBe("proj_0123456789abcdef"); // the path minus its slash
      expect(fence).toBeUndefined(); // a connector never carries the worker's claim
      expect(opts).toMatchObject({ anchorPath: projectPath, ownerId: TEST_USER_ID });
    });

    it("refuses a project owned by someone else, and one owned by NOBODY", async () => {
      for (const ownerId of ["u_someone_else", null]) {
        bindStore.mockClear();
        projectOwner.mockResolvedValueOnce({ exists: true, ownerId });
        const res = await rpc(
          call("project_context", { projectPath: "/proj_00112233445566aa" }),
          connectorHeaders(),
        );
        expect(res.status, `ownerId=${ownerId}`).toBe(403);
        // A NULL owner is refused with the rest: a connector never claims an
        // ownerless project, unlike the web tier's may_create_or_claim.
        expect(bindStore).not.toHaveBeenCalled();
        await res.text();
      }
    });

    it("admits a project the caller owns", async () => {
      bindStore.mockClear();
      projectOwner.mockResolvedValueOnce({ exists: true, ownerId: TEST_USER_ID });
      const res = await rpc(
        call("project_context", { projectPath: "/proj_00112233445566bb" }),
        connectorHeaders(),
      );
      expect(res.status).toBe(200);
      expect(bindStore).toHaveBeenCalledTimes(1);
      await res.text();
    });

    it("a body over the cap is 413, and one at the largest the worker sends is admitted", async () => {
      // Both directions: a cap set too low 413s production worker writes with
      // every other test green. The measured largest real body is 53,329 bytes.
      const overCap = await rpc(
        call("convert_calendar", { pad: "x".repeat(MAX_BODY_BYTES + 1) }),
        connectorHeaders(),
      );
      expect(overCap.status).toBe(413);
      await overCap.text();

      const realistic = await rpc(call("convert_calendar", { pad: "x".repeat(60_000) }), connectorHeaders());
      expect(realistic.status).toBe(200);
      await realistic.text();
    });

    it("serves no protected-resource metadata with no issuer configured, and the 401 is bare", async () => {
      const res = await fetch(`${base}${PRM_PATH}`);
      expect(res.status).toBe(404);
      await res.text();
      // The two agree: nothing to point at, so nothing is pointed at.
      const refused = await rpc(call("convert_calendar", {}));
      expect(refused.headers.get("WWW-Authenticate")).toBe("Bearer");
      await refused.text();
    });

    it("serves the metadata from the ISSUER, not the request's Host, and the 401 points at it", async () => {
      const issuer = "https://beta.example";
      const withIssuer = await startHttpServer({
        host: "127.0.0.1",
        port: 0,
        baseConfig: {},
        bindStore,
        authorize,
        lookupConnector,
        projectOwner,
        ownedProjects,
        issuer,
      });
      const addr = withIssuer.address();
      if (!addr || typeof addr !== "object") throw new Error("no port");
      const url = `http://127.0.0.1:${addr.port}`;
      try {
        const res = await fetch(`${url}${PRM_PATH}`, {
          // A forged Host must change nothing: deriving the issuer from it
          // would let a caller point clients at their own authorization server.
          headers: { Host: "evil.example" },
        });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({
          resource: `${issuer}/mcp`,
          authorization_servers: [issuer],
        });

        const refused = await fetch(`${url}/mcp`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
          body: JSON.stringify(call("convert_calendar", {})),
        });
        expect(refused.status).toBe(401);
        // The URL the challenge names is the one just served.
        expect(refused.headers.get("WWW-Authenticate")).toBe(
          `Bearer resource_metadata="${issuer}${PRM_PATH}"`,
        );
        await refused.text();
      } finally {
        withIssuer.closeAllConnections();
        await new Promise<void>((r) => withIssuer.close(() => r()));
      }
    });

    it("logs one line per call with the user, the tool and the FamilySearch status — and no token", async () => {
      // A recorder that is never wired and one that works produce the SAME
      // door output: an absent field. This is the only test that reads the
      // line the door actually writes.
      const lines: string[] = [];
      const write = process.stderr.write.bind(process.stderr);
      const spy = vi.spyOn(process.stderr, "write").mockImplementation(((chunk: unknown) => {
        lines.push(String(chunk));
        return true;
      }) as typeof process.stderr.write);
      let line: string | undefined;
      try {
        // record_read reaches FamilySearch; the mocked upstream answers 401.
        const res = await rpc(call("record_read", { recordId: "QVS9-DHDB" }), connectorHeaders());
        await res.text();
        // The door writes this line in handleMcpPost's `finally`, which runs
        // AFTER the response is sent — so reading it straight after the body
        // is a race, and restoring the spy there loses the line entirely.
        await vi.waitFor(() => {
          line = lines.find((l) => l.startsWith("ev=tool_call"));
          expect(line, lines.join("")).toBeDefined();
        });
      } finally {
        spy.mockRestore();
        void write;
      }
      expect(line).toContain("surface=connector");
      expect(line).toContain(`user_id=${TEST_USER_ID}`);
      expect(line).toContain("tool=record_read");
      expect(line).toContain("fs_status=401");
      // Never the bearer or its hash.
      expect(line).not.toContain(TEST_CONNECTOR_TOKEN);
      expect(line).not.toContain(
        createHash("sha256").update(TEST_CONNECTOR_TOKEN, "utf8").digest("hex"),
      );
    });

    it("an admitted caller cannot forge a second audit record through the tool name", async () => {
      // The tool name is the ONLY caller-controlled field on this line, and the
      // line is newline-delimited `key=value`. The SDK types a tool name as a
      // plain string, so a newline survives parsing; unsanitized it would end
      // the real record early and append a complete second one attributed to
      // whatever user id the caller chose.
      const forged =
        'convert_calendar\nev=tool_call surface=worker user_id=victim tool=tree_edit fs_status=200';
      const lines: string[] = [];
      const spy = vi.spyOn(process.stderr, "write").mockImplementation(((chunk: unknown) => {
        lines.push(String(chunk));
        return true;
      }) as typeof process.stderr.write);
      let written: string[] = [];
      try {
        const res = await rpc(call(forged, {}), connectorHeaders());
        await res.text();
        await vi.waitFor(() => {
          written = lines.join("").split("\n").filter((l) => l.startsWith("ev=tool_call"));
          expect(written.length, lines.join("")).toBeGreaterThan(0);
        });
      } finally {
        spy.mockRestore();
      }
      // Exactly one record, and it is not the caller's.
      expect(written).toHaveLength(1);
      expect(written[0]).toContain(`user_id=${TEST_USER_ID}`);
      expect(written[0]).not.toContain("user_id=victim");
      expect(written[0]).not.toContain("surface=worker");
    });

    it("toolNameOf keeps a real name and neutralizes anything that is not one", () => {
      expect(toolNameOf({ method: "tools/call", params: { name: "record_read" } })).toBe("record_read");
      expect(toolNameOf({ method: "initialize" })).toBe("initialize");
      expect(toolNameOf({ method: "tools/call", params: {} })).toBe("-");
      expect(toolNameOf({ method: "tools/call", params: { name: 7 } })).toBe("-");
      expect(toolNameOf(null)).toBe("-");
      // The injection shapes, on both the tool name and the bare method.
      expect(toolNameOf({ method: "tools/call", params: { name: "a\nev=tool_call" } })).not.toContain("\n");
      expect(toolNameOf({ method: "a\rb" })).not.toContain("\r");
      // Long values are capped rather than allowed to swamp the line.
      expect(toolNameOf({ method: "tools/call", params: { name: "x".repeat(500) } })).toHaveLength(64);
    });

    it("the audit line keeps the FIRST failing FamilySearch status, not the last", () => {
      // A tool makes many FamilySearch requests, concurrently, so last-write
      // -wins makes the recorded status a race. E3's session-end rule keys on
      // this value.
      expect(keptFamilySearchStatus(null, 200)).toBe(200);
      expect(keptFamilySearchStatus(null, 401)).toBe(401);
      // The 401 survives every later success — this is the case that regressed.
      expect(keptFamilySearchStatus(401, 200)).toBe(401);
      expect(keptFamilySearchStatus(401, 403)).toBe(401);
      // A success gives way to the first failure.
      expect(keptFamilySearchStatus(200, 401)).toBe(401);
      // Among successes the first still stands; only a failure displaces one.
      expect(keptFamilySearchStatus(200, 204)).toBe(200);
    });

    it("never hands the operator's per-person credentials to a connector caller", () => {
      // baseConfig carries the TOOLS TIER's own OPENROUTER_API_KEY. Spreading
      // it into the connector principal would bill every patron's
      // transcriptions to the operator's account — and openrouter_key_enc is
      // null for every patron who has not linked one, so that is not an edge
      // case, it is the default path.
      const base = {
        openRouterApiKey: "operator-key-sentinel",
        wikiApiUrl: "https://wiki.example",
        matcherUrl: "https://matcher.example",
        matcherApiKey: "matcher-key",
        openRouterModel: "a/model",
      };
      const noKey = connectorConfig(base, {
        userId: "u_1",
        familySearchToken: "fs",
        openRouterApiKey: null,
      });
      expect(noKey.openRouterApiKey).toBeUndefined();
      expect(JSON.stringify(noKey)).not.toContain("operator-key-sentinel");
      // Deployment-level settings ARE shared: this server's own credential to
      // a sibling service is not the caller's, like wikiApiUrl.
      expect(noKey.wikiApiUrl).toBe("https://wiki.example");
      expect(noKey.matcherApiKey).toBe("matcher-key");
      expect(noKey.openRouterModel).toBe("a/model");
      expect(noKey.hosted).toBe(true);

      // A caller who HAS linked one gets their own, never the operator's.
      const own = connectorConfig(base, {
        userId: "u_2",
        familySearchToken: "fs",
        openRouterApiKey: "patron-key",
      });
      expect(own.openRouterApiKey).toBe("patron-key");
    });

    it.each([
      ["an array", ["/proj_0123456789abcdef"]],
      ["a number", 42],
      ["null", null],
      ["an object", { path: "/proj_0123456789abcdef" }],
    ])("refuses a projectPath that is %s, rather than binding nothing", async (_label, projectPath) => {
      bindStore.mockClear();
      const res = await rpc(call("project_context", { projectPath }), connectorHeaders());
      // Was a 200 carrying "send X-Genealogy-Project-Id" — the caller told to
      // fix the wrong thing, on a door where that header cannot help.
      expect(res.status).toBe(400);
      expect((await res.json()).error.message).toMatch(/proj_ followed by 16 lowercase hex/);
      expect(bindStore).not.toHaveBeenCalled();
    });

    it("tells a connector naming no project to pass projectPath, never to send a header", async () => {
      const res = await rpc(call("project_context", {}), connectorHeaders());
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toMatch(/proj_<16 lowercase hex>|projectPath/);
      // The worker's remedy would route this caller to the other door and a 403.
      expect(text).not.toContain("X-Genealogy-Project-Id");
    });

    it("a lookup that throws is a 503, never an admission", async () => {
      lookupConnector.mockRejectedValueOnce(new Error("pool is down"));
      const res = await rpc(call("convert_calendar", {}), connectorHeaders());
      expect(res.status).toBe(503);
      await res.text();
    });

    describe("project_list on a connector (#3991)", () => {
      /** A project on disk under `id`, as `ownedProjects` would name it. */
      async function seedOwned(id: string): Promise<void> {
        await mkdir(join(root, id), { recursive: true });
        await writeFile(join(root, id, "research.json"), JSON.stringify({ project: { objective: `about ${id}` } }));
      }

      async function listProjects(): Promise<{ isError?: boolean; text: string }> {
        const res = await rpc(call("project_list", {}), connectorHeaders());
        expect(res.status).toBe(200);
        const { result } = (await res.json()) as {
          result: { isError?: boolean; content: Array<{ text: string }> };
        };
        return { isError: result.isError, text: result.content[0]!.text };
      }

      it("a connector's project_list names the caller's projects and one fresh path", async () => {
        const ids = ["proj_aaaaaaaaaaaaaaaa", "proj_bbbbbbbbbbbbbbbb"];
        await Promise.all(ids.map(seedOwned));
        bindStore.mockClear();
        ownedProjects.mockClear();
        ownedProjects.mockResolvedValueOnce({ ids, truncated: false });

        const listed = await listProjects();
        expect(listed.isError, listed.text).not.toBe(true);
        const body = JSON.parse(listed.text);
        expect(ownedProjects).toHaveBeenCalledExactlyOnceWith(TEST_USER_ID);
        expect(body.mode).toBe("hosted");
        expect(body.projects.map((p: { projectPath: string }) => p.projectPath)).toEqual(ids.map((id) => `/${id}`));
        expect(body.projects[0].objective).toBe(`about ${ids[0]}`);
        expect(body.newProjectPath).toMatch(CONNECTOR_PROJECT_RE);
        expect(ids.map((id) => `/${id}`)).not.toContain(body.newProjectPath);

        // Each path's store: anchored at that path, for this caller, with no fence.
        expect(bindStore.mock.calls.map(([id]) => `/${id}`)).toEqual([...ids.map((id) => `/${id}`), body.newProjectPath]);
        for (const [id, , fence, opts] of bindStore.mock.calls) {
          expect(fence).toBeUndefined();
          expect(opts).toEqual({ anchorPath: `/${id}`, ownerId: TEST_USER_ID });
        }
      });

      it("a caller who owns nothing still gets a fresh path", async () => {
        const body = JSON.parse((await listProjects()).text);
        expect(body.projects).toEqual([]);
        expect(body.newProjectPath).toMatch(CONNECTOR_PROJECT_RE);
        expect(body.message).toBe("No project yet: pass newProjectPath as projectPath to start one.");
      });

      it("an id that is not /proj_ shaped is not listed", async () => {
        const good = "proj_cccccccccccccccc";
        const claimedByDevLogin = "a-web-tier-project";
        await Promise.all([good, claimedByDevLogin].map(seedOwned));
        bindStore.mockClear();
        ownedProjects.mockResolvedValueOnce({ ids: [claimedByDevLogin, good], truncated: false });

        const body = JSON.parse((await listProjects()).text);
        expect(body.projects.map((p: { projectPath: string }) => p.projectPath)).toEqual([`/${good}`]);
        expect(bindStore.mock.calls.map(([id]) => id)).not.toContain(claimedByDevLogin);
        expect(body).not.toHaveProperty("truncated");
      });

      it("a cut listing says so, even when the door's filter left fewer ids than the query's limit", async () => {
        const good = "proj_eeeeeeeeeeeeeeee";
        await seedOwned(good);
        ownedProjects.mockResolvedValueOnce({ ids: ["a-web-tier-project", good], truncated: true });

        const body = JSON.parse((await listProjects()).text);
        expect(body.projects.map((p: { projectPath: string }) => p.projectPath)).toEqual([`/${good}`]);
        expect(body.truncated).toBe(true);
        expect(body.message).toContain("More projects exist than are listed");
      });

      it("a failing ownedProjects is isError, never No project yet", async () => {
        ownedProjects.mockRejectedValueOnce(new Error("pool is down"));
        const listed = await listProjects();
        expect(listed.isError).toBe(true);
        expect(listed.text).toContain("pool is down");
        expect(listed.text).not.toContain("No project yet");
      });

      it("a document read that fails mid-listing is isError, never a project with no subject", async () => {
        const id = "proj_dddddddddddddddd";
        await seedOwned(id);
        ownedProjects.mockResolvedValueOnce({ ids: [id], truncated: false });
        const store = new ScopedFsStore(root, id, `/${id}`);
        vi.spyOn(store, "readText").mockRejectedValue(new Error("pool is down"));
        bindStore.mockReturnValueOnce(store);

        const listed = await listProjects();
        expect(listed.isError, listed.text).toBe(true);
        expect(listed.text).toContain("pool is down");
        expect(listed.text).not.toContain("newProjectPath");
      });

      it("a client that disconnects mid-listing stops the listing at its next read", async () => {
        const ids = ["proj_1111111111111111", "proj_2222222222222222", "proj_3333333333333333"];
        await Promise.all(ids.map(seedOwned));
        ownedProjects.mockResolvedValueOnce({ ids, truncated: false });

        // The first project's research.json holds the tool mid-listing until the
        // client has gone, which is when the store's signal aborts.
        let release!: () => void;
        const gate = new Promise<void>((resolve) => (release = resolve));
        const reads: string[] = [];
        const signals: AbortSignal[] = [];
        // One per listed path and one for the fresh path.
        for (let i = 0; i <= ids.length; i++) {
          bindStore.mockImplementationOnce((projectId, signal, _fence, opts) => {
            signals.push(signal);
            const store = new ScopedFsStore(root, projectId, opts?.anchorPath);
            const readText = store.readText.bind(store);
            vi.spyOn(store, "readText").mockImplementation(async (projectPath, ref) => {
              reads.push(`${projectPath}:${ref}`);
              await gate;
              return readText(projectPath, ref);
            });
            return store;
          });
        }

        const client = new AbortController();
        const dropped = fetch(`${base}/mcp`, {
          method: "POST",
          signal: client.signal,
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream",
            ...connectorHeaders(),
          },
          body: JSON.stringify(call("project_list", {})),
        }).catch(() => undefined);

        await vi.waitFor(() => expect(reads).toEqual([`/${ids[0]}:research.json`]));
        client.abort();
        await vi.waitFor(() => expect(signals[0]!.aborted).toBe(true));
        release();
        await dropped;
        // The dropped client has no response to wait on, so give the tool its next turns.
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(reads).toEqual([`/${ids[0]}:research.json`]);
      });

      it("a connector call naming no project still refuses project tools and queries nothing", async () => {
        bindStore.mockClear();
        ownedProjects.mockClear();
        const res = await rpc(call("tree_query", {}), connectorHeaders());
        expect(res.status).toBe(200);
        const text = await res.text();
        expect(text).toContain("This call named no project");
        expect(ownedProjects).not.toHaveBeenCalled();
        expect(bindStore).not.toHaveBeenCalled();
      });
    });
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
    const livePost = await fetch(`${base}/livez`, { method: "POST" });
    expect(livePost.status).toBe(404);
  });

  it("5b. with checkReady, /healthz answers 200 or 503 from the report, and 503 (never 500) on a probe that rejects or never settles; /livez is 200 throughout and never probes", async () => {
    let probe: () => Promise<ReadyReport> = async () => ({ ok: true, checks: {} });
    const ready = await startHttpServer({
      host: "127.0.0.1",
      port: 0,
      baseConfig: {},
      bindStore,
      authorize,
      checkReady: () => probe(),
      lookupConnector,
      projectOwner,
      ownedProjects,
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

      // /livez never consults checkReady: 200 while the probe rejects, and while it hangs below.
      let probed = 0;
      const failingProbe = probe;
      probe = () => {
        probed += 1;
        return failingProbe();
      };
      const live = await fetch(`${url}/livez`);
      expect(live.status).toBe(200);
      expect(await live.json()).toEqual({ ok: true, tools: allToolSchemas.length });
      expect(probed).toBe(0);

      probe = () => new Promise<ReadyReport>(() => {});
      const t0 = Date.now();
      const [hung, other, liveWhileHung] = await Promise.all([
        healthz(),
        fetch(`${url}/nope`),
        fetch(`${url}/livez`),
      ]);
      // Answered at all is the property: a probe the deadline did not cut never answers
      // and hits the 10 s test timeout. Under a parallel suite the event loop lags close
      // to 3 s past the 2 s deadline, so the bound sits between the two.
      expect(Date.now() - t0).toBeLessThan(8_000);
      expect(hung.status).toBe(503);
      expect(hung.body).toEqual({ ok: false, tools: allToolSchemas.length });
      // The other routes are not held behind the probe.
      expect(other.status).toBe(404);
      expect(liveWhileHung.status).toBe(200);
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

// Self-hosted beta E4, per-user half (issue #3999): at most 4 `tools/call`
// requests in flight per connector user, at the door. A call over the cap WAITS
// in FIFO order; it is never refused. Kept at the end of the file, apart from
// the cases above, because the limiter is module state shared by every request.
describe("E4. per-user limits on the connector door (#3999)", () => {
  const rpc = (body: unknown, headers: Record<string, string>, init: RequestInit = {}) =>
    fetch(`${base}/mcp`, {
      ...init,
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...headers },
      body: JSON.stringify(body),
    });
  const call = (name: string, args: Record<string, unknown>) => ({
    jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args },
  });
  const userA = { Authorization: "Bearer connector-token-A" };
  const userB = { Authorization: "Bearer connector-token-B" };
  /** A connector project path of its own per call, so each call's store is told apart. */
  const projPath = (prefix: string, n: number) => `/proj_${prefix}${n.toString(16).padStart(16 - prefix.length, "0")}`;
  const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

  beforeEach(() => {
    __resetUserLimitsForTests();
  });

  /**
   * The next `n` stores `bindStore` hands out hold every method until `open()`,
   * then 20 ms more, so calls overlap after the gate too. A request counts as
   * inside the tool while one of its store methods is in flight; `high()` is
   * the most requests that were ever inside at once. Each request binds exactly
   * one store, before the door's slot is taken.
   */
  function gatedStores(n: number) {
    let open!: () => void;
    const gate = new Promise<void>((resolve) => (open = resolve));
    const inFlight = new Map<string, number>();
    const entered = new Set<string>();
    let high = 0;
    const insideNow = () => [...inFlight.values()].filter((count) => count > 0).length;
    for (let i = 0; i < n; i++) {
      bindStore.mockImplementationOnce((projectId, _signal, _fence, opts) => {
        const inner = new ScopedFsStore(root, projectId, opts?.anchorPath);
        return new Proxy(inner, {
          get(target, key, receiver) {
            const v = Reflect.get(target, key, receiver);
            if (typeof v !== "function") return v;
            return async (...args: unknown[]) => {
              entered.add(projectId);
              inFlight.set(projectId, (inFlight.get(projectId) ?? 0) + 1);
              high = Math.max(high, insideNow());
              try {
                await gate;
                await new Promise((resolve) => setTimeout(resolve, 20));
                return await v.apply(target, args);
              } finally {
                inFlight.set(projectId, inFlight.get(projectId)! - 1);
              }
            };
          },
        });
      });
    }
    return { open: () => open(), entered, high: () => high, insideNow };
  }

  /** User A's 12 calls, held at the gate. Resolves once every one has reached
   *  the door (bindStore runs before the slot) and had time to enter the tool
   *  if the door let it. */
  async function holdTwelve() {
    bindStore.mockClear();
    lookupConnector.mockClear();
    const gated = gatedStores(12);
    const paths = Array.from({ length: 12 }, (_, i) => projPath("a", i));
    const answers = paths.map((projectPath) => rpc(call("project_context", { projectPath }), userA));
    await vi.waitFor(() => expect(bindStore).toHaveBeenCalledTimes(12));
    await settle();
    return { gated, answers };
  }

  /** Open the gate and read every answer, so a failed case leaves no request hanging. */
  async function release(gated: { open: () => void }, answers: Array<Promise<Response>>) {
    gated.open();
    return Promise.all(
      answers.map(async (answer) => {
        const res = await answer;
        return { status: res.status, body: await res.text() };
      }),
    );
  }

  it("12 parallel tools/call requests from one user all complete, never more than 4 running at once", async () => {
    expect(USER_CALL_CAP).toBe(4);
    const { gated, answers } = await holdTwelve();
    let done: Array<{ status: number; body: string }>;
    try {
      expect(gated.entered.size).toBe(4);
      expect(gated.insideNow()).toBe(4);
      expect(__userLimitsStateForTests("u_A")).toMatchObject({ running: 4, waiting: 8 });
    } finally {
      done = await release(gated, answers);
    }
    for (const { status, body } of done) {
      expect(status).toBe(200);
      expect(body).toContain('"result"');
    }
    expect(gated.entered.size).toBe(12);
    expect(gated.high()).toBe(4);
    // Each call's token was looked up at the door, and the 8 that waited were
    // looked up again when their slot came.
    expect(lookupConnector).toHaveBeenCalledTimes(12 + 8);
    // Nothing running or waiting, so the user's entry is gone.
    await vi.waitFor(() => expect(__userLimitsStateForTests().users).toBe(0));
  });

  it("a second user's calls start at once while the first has 4 running and 8 waiting, and the first's tools/list is not queued", async () => {
    const { gated, answers } = await holdTwelve();
    try {
      expect(__userLimitsStateForTests("u_A")).toMatchObject({ running: 4, waiting: 8 });
      // B's stores are the default, ungated ones: these answer while A is held.
      const fromB = await Promise.all(
        Array.from({ length: 4 }, (_, i) =>
          rpc(call("project_context", { projectPath: projPath("b", i) }), userB).then(async (res) => ({
            status: res.status,
            body: await res.text(),
          })),
        ),
      );
      for (const { status, body } of fromB) {
        expect(status).toBe(200);
        expect(body).toContain('"result"');
      }
      // A's own tools/list takes no slot, so it does not wait behind A's 8.
      const list = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }, userA);
      expect(list.status).toBe(200);
      expect(await list.text()).toContain('"project_context"');
      expect(__userLimitsStateForTests("u_A")).toMatchObject({ running: 4, waiting: 8 });
      expect(gated.entered.size).toBe(4);
    } finally {
      await release(gated, answers);
    }
    await vi.waitFor(() => expect(__userLimitsStateForTests().users).toBe(0));
  });

  it("a waiting call whose client hangs up leaves the queue, never runs, and is logged as abandoned", async () => {
    bindStore.mockClear();
    const gated = gatedStores(5);
    const held = Array.from({ length: 4 }, (_, i) =>
      rpc(call("project_context", { projectPath: projPath("c", i) }), userA),
    );
    await vi.waitFor(() => expect(bindStore).toHaveBeenCalledTimes(4));
    await settle();

    const lines: string[] = [];
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(((chunk: unknown) => {
      lines.push(String(chunk));
      return true;
    }) as typeof process.stderr.write);
    const goneId = projPath("c", 4).slice(1);
    const client = new AbortController();
    try {
      const dropped = rpc(call("project_context", { projectPath: `/${goneId}` }), userA, {
        signal: client.signal,
      }).catch(() => undefined);
      await vi.waitFor(() => expect(__userLimitsStateForTests("u_A")).toMatchObject({ running: 4, waiting: 1 }));
      client.abort();
      await dropped;
      await vi.waitFor(() => expect(__userLimitsStateForTests("u_A")).toMatchObject({ running: 4, waiting: 0 }));
      await vi.waitFor(() =>
        expect(lines.join("")).toContain("ev=tool_abandoned surface=connector user_id=u_A tool=project_context"),
      );
    } finally {
      spy.mockRestore();
      await release(gated, held);
    }
    // The four held calls finished; the abandoned one never touched its store.
    await settle();
    expect(gated.entered.has(goneId)).toBe(false);
    expect(gated.entered.size).toBe(4);
    expect(lines.join("")).not.toMatch(/ev=tool_call [^\n]*user_id=u_A tool=project_context/);
    await vi.waitFor(() => expect(__userLimitsStateForTests().users).toBe(0));
  });

  it("the worker path is not capped: 6 parallel worker calls are all inside the tool at once", async () => {
    bindStore.mockClear();
    const gated = gatedStores(6);
    const answers = Array.from({ length: 6 }, () =>
      rpc(call("project_context", { projectPath: SCOPED_ANCHOR }), {
        Authorization: "Bearer worker-bearer",
        [PROJECT_HEADER]: `worker-${randomUUID()}`,
      }),
    );
    try {
      await vi.waitFor(() => expect(bindStore).toHaveBeenCalledTimes(6));
      await settle();
      expect(gated.insideNow()).toBe(6);
      expect(__userLimitsStateForTests().users).toBe(0);
    } finally {
      const done = await release(gated, answers);
      for (const { status } of done) expect(status).toBe(200);
    }
  });

  it("a call that waited is refused, and never runs, when its token stopped being admitted meanwhile", async () => {
    bindStore.mockClear();
    const gated = gatedStores(5);
    const held = Array.from({ length: 4 }, (_, i) =>
      rpc(call("project_context", { projectPath: projPath("e", i) }), userA),
    );
    const blockedId = projPath("e", 4).slice(1);
    const waiting = rpc(call("project_context", { projectPath: `/${blockedId}` }), userA);
    try {
      await vi.waitFor(() => expect(__userLimitsStateForTests("u_A")).toMatchObject({ running: 4, waiting: 1 }));
      // The user is blocked while the call waits: the next lookup, the waiter's
      // second one, admits nothing.
      lookupConnector.mockImplementationOnce(async () => null);
    } finally {
      await release(gated, held);
    }
    const res = await waiting;
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toBe("Bearer");
    expect((await res.json()).error.message).toBe("Not authenticated. Sign in again to reconnect.");
    expect(gated.entered.has(blockedId)).toBe(false);
    await vi.waitFor(() => expect(__userLimitsStateForTests().users).toBe(0));
  });

  it("a call that waited runs with the FamilySearch token the second lookup returns", async () => {
    bindStore.mockClear();
    const gated = gatedStores(4);
    const held = Array.from({ length: 4 }, (_, i) =>
      rpc(call("project_context", { projectPath: projPath("f", i) }), userA),
    );
    let answer!: Promise<Response>;
    try {
      await vi.waitFor(() => expect(__userLimitsStateForTests("u_A")).toMatchObject({ running: 4, waiting: 0 }));
      // record_read reaches FamilySearch (the mocked upstream) with whatever
      // token the call's principal carries.
      answer = rpc(call("record_read", { recordId: "QVS9-WAIT" }), userA);
      await vi.waitFor(() => expect(__userLimitsStateForTests("u_A")).toMatchObject({ running: 4, waiting: 1 }));
      // The web tier replaced the user's FamilySearch token while the call waited.
      lookupConnector.mockImplementationOnce(async () => ({
        userId: "u_A",
        familySearchToken: "fs-tok-A-replaced",
        openRouterApiKey: null,
      }));
      upstream.calls.length = 0;
    } finally {
      await release(gated, held);
    }
    await (await answer).text();
    expect(upstream.calls.map((c) => c.authorization)).toContain("Bearer fs-tok-A-replaced");
    expect(upstream.calls.map((c) => c.authorization)).not.toContain("Bearer fs-tok-A");
  });
});

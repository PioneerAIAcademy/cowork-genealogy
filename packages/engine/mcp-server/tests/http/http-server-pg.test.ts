import { decrypt, encrypt } from "../../src/auth/fernet.js";
const TEST_ENC_KEY = "http-server-pg-test-key";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Server as HttpServer } from "node:http";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { CreateBucketCommand } from "@aws-sdk/client-s3";

// Nothing in this file reaches FamilySearch: the one person the flow below reads
// answers from here, and every other URL is a 404. `vi.mock` is hoisted above the
// imports, so the server and its tools bind this.
const upstream = vi.hoisted(() => ({
  personId: "FLOW-123",
  person: {
    persons: [
      {
        id: "FLOW-123",
        living: false,
        gender: { type: "http://gedcomx.org/Male" },
        names: [
          {
            nameForms: [
              {
                parts: [
                  { type: "http://gedcomx.org/Given", value: "Flow" },
                  { type: "http://gedcomx.org/Surname", value: "Person" },
                ],
              },
            ],
          },
        ],
        facts: [],
      },
    ],
  },
}));

vi.mock("../../src/utils/http.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/utils/http.js")>();
  const answer = async (url: string | URL): Promise<Response> =>
    new URL(String(url)).pathname === `/platform/tree/persons/${upstream.personId}`
      ? new Response(JSON.stringify(upstream.person), { status: 200 })
      : new Response("{}", { status: 404 });
  return { ...actual, fetchWithRetry: answer, fetchWithTimeout: answer };
});

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startHttpServer } from "../../src/http-server.js";
import {
  authorizeAttempt,
  createPgS3Backend,
  PgS3ProjectStore,
  type PgS3Backend,
  lookupConnectorToken,
  MAX_DOCUMENT_BYTES,
  MAX_LISTED_PROJECTS,
  ownedProjectIds,
  projectOwnerOf,
} from "../../src/store/pg-s3-project-store.js";
import { runWithProjectStore, type ClaimFence, type ProjectStore } from "../../src/store/project-store.js";
import { stagePersonRead } from "../../src/tools/person-read.js";
import { saveSourceImage } from "../../src/utils/image-store.js";
import { protoBackendOptions } from "../store/pg-s3-test-env.js";

// The HTTP server with the real per-request store and the real project check —
// the factories build/http.js installs — against the compose postgres + minio:
// `make proto-store-test` starts the stack and sets these, exactly as
// tests/store/pg-s3-project-store.test.ts is gated. Without them the file
// registers one skipped suite whose name says so. tests/http/http-server.test.ts
// proves the same isolation over a file double; this proves the header reaches
// Postgres rows keyed by the id it named, and (U4) that a bearer reaches only a
// project whose open turn the worker stamped with that bearer's hash.
//
// The worker's stamp and re-claim are simulated in SQL here; the hash is
// Postgres's own sha256 over the token's UTF-8 bytes, so the engine's node:crypto
// digest is checked against an independent one, as the worker's hashlib is in
// production.

const DSN = process.env.PROTO_PG_DSN;
const ENDPOINT = process.env.PROTO_S3_ENDPOINT;
const BUCKET = process.env.PROTO_S3_BUCKET ?? "projects";

const ANCHOR = "/project";
/** The origin image links are signed for; the tests fetch them from their own port. */
const PUBLIC_ORIGIN = "https://beta.example";
const PROJECT_HEADER = "X-Genealogy-Project-Id";
const TURN_HEADER = "X-Genealogy-Turn-Id";
const EPOCH_HEADER = "X-Genealogy-Claim-Epoch";

const FORBIDDEN_ATTEMPT = {
  jsonrpc: "2.0",
  error: { code: -32600, message: "This bearer is not the grant of an open attempt on this project." },
  id: null,
};

/** What one request presents: the project, its fence and its bearer, each optional. */
interface Attempt {
  projectId?: string;
  turnId?: string;
  epoch?: number;
  bearer?: string;
}

function headersOf(a: Attempt): Record<string, string> {
  const h: Record<string, string> = {};
  if (a.projectId) h[PROJECT_HEADER] = a.projectId;
  if (a.turnId) {
    h[TURN_HEADER] = a.turnId;
    h[EPOCH_HEADER] = String(a.epoch ?? 1);
  }
  if (a.bearer !== undefined) h.Authorization = `Bearer ${a.bearer}`;
  return h;
}

if (!DSN || !ENDPOINT) {
  describe.skip(
    "HTTP server over PgS3ProjectStore — skipped: PROTO_PG_DSN and PROTO_S3_ENDPOINT are not set (run `make proto-store-test`)",
    () => {
      it("needs the compose stack", () => {});
    },
  );
} else {
  const backend: PgS3Backend = createPgS3Backend(protoBackendOptions());
  const bindStore = vi.fn(
    (
      projectId: string,
      signal: AbortSignal,
      fence?: ClaimFence,
      // E1: a connector names its own anchor and owner. Mirrors src/http.ts —
      // without the override the store anchors at the WORKER's /project and
      // every connector call fails "is not this store's project".
      opts?: { anchorPath?: string; ownerId?: string },
    ): ProjectStore =>
      new PgS3ProjectStore(backend, {
        projectId,
        anchorPath: opts?.anchorPath ?? ANCHOR,
        signal,
        fence,
        ownerId: opts?.ownerId,
      }),
  );

  let server: HttpServer;
  let base: string;
  const clients: Client[] = [];
  const projectIds: string[] = [];
  let noProjectHeaderUser: string | null = null;
  const turnIds: string[] = [];

  async function connect(a: Attempt): Promise<Client> {
    const client = new Client({ name: "http-server-pg-test", version: "0" });
    const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers: headersOf(a) },
    });
    await client.connect(transport);
    clients.push(client);
    return client;
  }

  /** One tools/call over raw fetch, so a refusal's status and body are read
   *  exactly. */
  async function call(
    a: Attempt,
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ status: number; text: string }> {
    const res = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...headersOf(a),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
    });
    return { status: res.status, text: await res.text() };
  }

  /** A read on the project: admitted is a 200, refused the 403 body. */
  const contextOf = (a: Attempt) => call(a, "project_context", { projectPath: ANCHOR });

  async function expectForbidden(a: Attempt, what: string): Promise<void> {
    const r = await contextOf(a);
    expect(r.status, `${what}: ${r.text}`).toBe(403);
    expect(JSON.parse(r.text), what).toEqual(FORBIDDEN_ATTEMPT);
    if (a.bearer) expect(r.text, what).not.toContain(a.bearer);
  }

  async function expectAdmitted(a: Attempt, what: string): Promise<void> {
    const r = await contextOf(a);
    expect(r.status, `${what}: ${r.text}`).toBe(200);
  }

  function textOf(result: Awaited<ReturnType<Client["callTool"]>>): string {
    return (result.content as Array<{ type: string; text?: string }>)
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("");
  }

  function createArgs(given: string): Record<string, unknown> {
    return {
      projectPath: ANCHOR,
      objective: "Does the project header reach Postgres?",
      title: `pg ${given}`,
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

  async function personNames(client: Client): Promise<string[]> {
    const result = await client.callTool({ name: "project_context", arguments: { projectPath: ANCHOR } });
    expect(result.isError, textOf(result)).not.toBe(true);
    const body = JSON.parse(textOf(result)) as { persons: Array<{ name: string | null }> };
    return body.persons.map((p) => p.name ?? "");
  }

  /** A fresh project id, purged after the suite. */
  function newProject(): string {
    const id = randomUUID();
    projectIds.push(id);
    return id;
  }

  /** The worker's claim of a fresh turn (epoch 1) on `projectId`, stamped with
   *  `bearer`'s hash unless it is null (a claim not yet stamped, or a project
   *  with no grant to stamp). */
  async function seedTurn(projectId: string, bearer: string | null): Promise<string> {
    const turnId = randomUUID();
    turnIds.push(turnId);
    await backend.pool.query(
      `INSERT INTO turns (turn_id, session_id, project_id, message, claimed_at, claim_epoch, bearer_sha256)
       VALUES ($1, $2, $3, '{}'::jsonb, now(), 1,
               CASE WHEN $4::text IS NULL THEN NULL ELSE encode(sha256(convert_to($4::text, 'UTF8')), 'hex') END)`,
      [turnId, randomUUID(), projectId, bearer],
    );
    return turnId;
  }

  /** The worker's STAMP_BEARER_SQL. */
  async function stamp(turnId: string, bearer: string): Promise<void> {
    await backend.pool.query(
      "UPDATE turns SET bearer_sha256 = encode(sha256(convert_to($2::text, 'UTF8')), 'hex') WHERE turn_id = $1",
      [turnId, bearer],
    );
  }

  /** The worker's re-claim of an open turn (CLAIM_TURN_SQL): a new epoch, and
   *  the previous attempt's stamp cleared in the same UPDATE. */
  async function reclaim(turnId: string): Promise<void> {
    await backend.pool.query(
      `UPDATE turns SET claim_epoch = claim_epoch + 1, claimed_at = now(),
         bearer_sha256 = CASE WHEN turns.completed_at IS NULL THEN NULL ELSE turns.bearer_sha256 END
       WHERE turn_id = $1`,
      [turnId],
    );
  }

  /** How many rows `projectId` owns in each store table. */
  async function rowCounts(projectId: string): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    for (const table of ["documents", "blobs", "staging"]) {
      const r = await backend.pool.query<{ n: string }>(`SELECT count(*) AS n FROM ${table} WHERE project_id = $1`, [
        projectId,
      ]);
      counts[table] = Number(r.rows[0].n);
    }
    return counts;
  }

  /** Every row the project wrote, and every S3 object its blob and staging
   *  rows point at, gone. */
  async function purge(projectId: string): Promise<void> {
    const objects = await backend.pool.query<{ s3_key: string }>(
      "SELECT s3_key FROM blobs WHERE project_id = $1 UNION ALL SELECT s3_key FROM staging WHERE project_id = $1",
      [projectId],
    );
    await backend.deleteObjects(objects.rows.map((r) => r.s3_key));
    for (const table of ["documents", "blobs", "staging", "projects"]) {
      await backend.pool.query(`DELETE FROM ${table} WHERE project_id = $1`, [projectId]);
    }
  }

  describe("HTTP server over PgS3ProjectStore", () => {
    beforeAll(async () => {
      // The compose one-shot creates the bucket; a bare stack gets it here.
      try {
        await backend.s3.send(new CreateBucketCommand({ Bucket: BUCKET }));
      } catch (e: any) {
        if (e?.name !== "BucketAlreadyOwnedByYou" && e?.name !== "BucketAlreadyExists") throw e;
      }
      // Migration 012's column, so the suite does not depend on migration order.
      await backend.pool.query("ALTER TABLE turns ADD COLUMN IF NOT EXISTS bearer_sha256 text");
      server = await startHttpServer({
        host: "127.0.0.1",
        port: 0,
        baseConfig: { webPublicUrl: PUBLIC_ORIGIN },
        bindStore,
        authorize: (req) => authorizeAttempt(backend, req),
        lookupConnector: (sha) =>
          lookupConnectorToken(backend, sha, (c) => decrypt(c, TEST_ENC_KEY)),
        projectOwner: (projectId) => projectOwnerOf(backend, projectId),
        ownedProjects: (userId) => ownedProjectIds(backend, userId),
        checkReady: () => backend.checkReady(),
      });
      const address = server.address();
      if (!address || typeof address !== "object") throw new Error("server did not bind a port");
      base = `http://127.0.0.1:${address.port}`;
    });

    afterAll(async () => {
      await Promise.all(clients.map((c) => c.close().catch(() => undefined)));
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      for (const id of projectIds) await purge(id);
      await backend.pool.query("DELETE FROM turns WHERE turn_id = ANY($1::text[])", [turnIds]);
      // After the projects: projects.owner_id references users with no ON DELETE.
      if (noProjectHeaderUser) {
        await backend.pool.query("DELETE FROM users WHERE id = $1", [noProjectHeaderUser]);
      }
      await backend.close();
    });

    it("healthy stack: 200, both checks ok", async () => {
      const res = await fetch(`${base}/healthz`);
      const text = await res.text();
      expect(res.status, text).toBe(200);
      expect(JSON.parse(text)).toMatchObject({ ok: true, checks: { postgres: { ok: true }, s3: { ok: true } } });
    });

    it("two concurrent requests with different X-Genealogy-Project-Id headers write and read their own rows", async () => {
      const idA = newProject();
      const idB = newProject();
      const tokA = `tok-${randomUUID()}`;
      const tokB = `tok-${randomUUID()}`;
      const [turnA, turnB] = await Promise.all([seedTurn(idA, tokA), seedTurn(idB, tokB)]);
      const [a, b] = await Promise.all([
        connect({ projectId: idA, turnId: turnA, bearer: tokA }),
        connect({ projectId: idB, turnId: turnB, bearer: tokB }),
      ]);
      const [createdA, createdB] = await Promise.all([
        a.callTool({ name: "project_create", arguments: createArgs("Alpha") }),
        b.callTool({ name: "project_create", arguments: createArgs("Beta") }),
      ]);
      expect(createdA.isError, textOf(createdA)).not.toBe(true);
      expect(createdB.isError, textOf(createdB)).not.toBe(true);

      const [namesA, namesB] = await Promise.all([personNames(a), personNames(b)]);
      expect(namesA.some((n) => n.includes("Alpha"))).toBe(true);
      expect(namesA.some((n) => n.includes("Beta"))).toBe(false);
      expect(namesB.some((n) => n.includes("Beta"))).toBe(true);
      expect(namesB.some((n) => n.includes("Alpha"))).toBe(false);

      expect(new Set(bindStore.mock.calls.map(([id]) => id))).toEqual(new Set([idA, idB]));

      // project_create writes three refs; every .json ref outside the blob
      // roots routes to `documents`, so each id owns exactly these three rows.
      for (const id of [idA, idB]) {
        const rows = await backend.pool.query("SELECT name FROM documents WHERE project_id = $1 ORDER BY name", [
          id,
        ]);
        expect(rows.rows.map((r) => r.name), id).toEqual([
          "research.json",
          "starting-tree.gedcomx.json",
          "tree.gedcomx.json",
        ]);
        const tree = await backend.pool.query(
          "SELECT doc FROM documents WHERE project_id = $1 AND name = 'tree.gedcomx.json'",
          [id],
        );
        expect(tree.rows[0].doc.persons[0].names[0].given).toBe(id === idA ? "Alpha" : "Beta");
      }
    });

    // ── E1: the connector door, against real Postgres (issue #3984) ────────
    describe("the connector door (E1)", () => {
      /** A user with a Fernet-encrypted FamilySearch token and a live token. */
      async function seedConnector(
        opts: { blocked?: boolean; ended?: boolean; familySearch?: "none" | "undecryptable" } = {},
      ) {
        const userId = `u_${randomUUID()}`;
        const token = `conn-${randomUUID()}`;
        const sha = createHash("sha256").update(token, "utf8").digest("hex");
        await backend.pool.query(
          "INSERT INTO users (id, email, blocked_at) VALUES ($1, $2, $3)",
          [userId, `${userId}@test.invalid`, opts.blocked ? new Date() : null],
        );
        if (opts.familySearch !== "none") {
          const key = opts.familySearch === "undecryptable" ? `${TEST_ENC_KEY}-another-key` : TEST_ENC_KEY;
          await backend.pool.query(
            "INSERT INTO familysearch_tokens (user_id, access_token_enc, expires_at, granted_at) " +
              "VALUES ($1, $2, now() + interval '1 hour', now())",
            [userId, encrypt(`fs-token-for-${userId}`, key)],
          );
        }
        await backend.pool.query(
          "INSERT INTO connector_tokens (token_sha256, user_id, client_id, scopes, expires_at, ended_at) " +
            "VALUES ($1, $2, 'test', ARRAY['mcp'], now() + interval '1 hour', $3)",
          [sha, userId, opts.ended ? new Date() : null],
        );
        seededUsers.push(userId);
        return { userId, token };
      }

      const seededUsers: string[] = [];
      const seededProjects: string[] = [];
      const freshPath = () => {
        const p = `/proj_${randomBytes(8).toString("hex")}`;
        seededProjects.push(p.slice(1));
        return p;
      };

      /** `projects.owner_id` for a path's id: empty when the project has no row. */
      async function ownerOf(projectPath: string): Promise<Array<string | null>> {
        const rows = await backend.pool.query<{ owner_id: string | null }>(
          "SELECT owner_id FROM projects WHERE project_id = $1",
          [projectPath.slice(1)],
        );
        return rows.rows.map((r) => r.owner_id);
      }

      /** One connector tools/call over raw fetch. */
      async function connCall(token: string | null, name: string, args: Record<string, unknown>) {
        const res = await fetch(`${base}/mcp`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
        });
        return { status: res.status, text: await res.text() };
      }

      afterAll(async () => {
        // Ordered: projects reference users with no ON DELETE.
        for (const projectId of seededProjects) await purge(projectId);
        for (const userId of seededUsers) {
          await backend.pool.query("DELETE FROM users WHERE id = $1", [userId]);
        }
      });

      it("an ended grant is a 401", async () => {
        const { token } = await seedConnector({ ended: true });
        const r = await connCall(token, "convert_calendar", {});
        expect(r.status, r.text).toBe(401);
      });

      it("a blocked user is a 401", async () => {
        const { token } = await seedConnector({ blocked: true });
        const r = await connCall(token, "convert_calendar", {});
        expect(r.status, r.text).toBe(401);
      });

      it.each([
        ["with no FamilySearch token", "none"],
        ["whose FamilySearch token will not decrypt", "undecryptable"],
      ] as const)("a user %s is a 401 with the SAME body as an unknown token", async (_label, familySearch) => {
        const { token } = await seedConnector({ familySearch });
        const [refused, unknown] = await Promise.all([
          connCall(token, "convert_calendar", {}),
          connCall(`conn-${randomUUID()}`, "convert_calendar", {}),
        ]);
        expect(refused.status, refused.text).toBe(401);
        expect(JSON.parse(refused.text)).toEqual(JSON.parse(unknown.text));
      });

      it("an ended grant and a blocked user get the SAME body as an unknown token", async () => {
        const ended = await seedConnector({ ended: true });
        const blocked = await seedConnector({ blocked: true });
        const [a, b, c] = await Promise.all([
          connCall(ended.token, "convert_calendar", {}),
          connCall(blocked.token, "convert_calendar", {}),
          connCall(`conn-${randomUUID()}`, "convert_calendar", {}),
        ]);
        // A caller must not learn WHICH check refused it.
        expect(JSON.parse(a.text)).toEqual(JSON.parse(c.text));
        expect(JSON.parse(b.text)).toEqual(JSON.parse(c.text));
      });

      it("two users are isolated: B cannot read A's project, by id or by guessing", async () => {
        const a = await seedConnector();
        const b = await seedConnector();
        const projectPath = freshPath();

        // A writes, which claims the project.
        const created = await connCall(a.token, "project_create", { ...createArgs("Alpha"), projectPath });
        expect(created.status, created.text).toBe(200);
        // The HTTP status is the DOOR's verdict; the tool's own result is in
        // the body, and a claim that never happened leaves the project free.
        expect(created.text, "A's create must actually claim the project").not.toContain('"isError":true');

        // The canary has to be a string A's project ACTUALLY contains, or the
        // "reads nothing" half cannot fail. Prove it is one by reading it back
        // as A first: the same assertion that must hold for B is shown here to
        // be false for A, so a regression that let B's refusal carry A's
        // payload -- or that moved the owner check after the store read --
        // reddens this test instead of passing it.
        const mine = await connCall(a.token, "project_context", { projectPath });
        expect(mine.status, mine.text).toBe(200);
        expect(mine.text, "the canary must be in A's own project").toContain("Alpha");

        // B names the same project: refused, and reads nothing.
        const read = await connCall(b.token, "project_context", { projectPath });
        expect(read.status, read.text).toBe(403);
        expect(read.text).not.toContain("Alpha");
      });

      it("a call naming another user's project writes NOTHING", async () => {
        const a = await seedConnector();
        const b = await seedConnector();
        const projectPath = freshPath();
        const projectId = projectPath.slice(1);
        await connCall(a.token, "project_create", { ...createArgs("Alpha"), projectPath });
        const before = await rowCounts(projectId);
        await connCall(b.token, "research_append", {
          projectPath,
          section: "questions",
          op: "append",
          entry: { question: "can B write here?", status: "open" },
        });
        expect(await rowCounts(projectId)).toEqual(before);
      });

      it("a project whose owner_id is NULL is refused: a connector never claims an ownerless project", async () => {
        const a = await seedConnector();
        const projectPath = freshPath();
        const projectId = projectPath.slice(1);
        // The engine's own ownerless project, exactly as the worker creates one.
        await backend.pool.query("INSERT INTO projects (project_id) VALUES ($1)", [projectId]);
        const r = await connCall(a.token, "project_context", { projectPath });
        expect(r.status, r.text).toBe(403);
      });

      it("project_context on a fresh path answers no_project and claims nothing", async () => {
        const a = await seedConnector();
        const projectPath = freshPath();
        const r = await connCall(a.token, "project_context", { projectPath });
        expect(r.status, r.text).toBe(200);
        const { result } = JSON.parse(r.text);
        expect(result.isError, r.text).not.toBe(true);
        expect(JSON.parse(result.content[0].text)).toMatchObject({ ok: false, reason: "no_project" });
        expect(await ownerOf(projectPath)).toEqual([]);
      });

      it("staging and a scan on a fresh path land and claim it for the caller", async () => {
        const a = await seedConnector();
        const projectPath = freshPath();
        const store = new PgS3ProjectStore(backend, {
          projectId: projectPath.slice(1),
          anchorPath: projectPath,
          ownerId: a.userId,
        });
        const read = { persons: [], relationships: [], sources: [] };
        const { staged, imageRef } = await runWithProjectStore(store, async () => ({
          staged: await stagePersonRead({ projectPath, input: { personId: "KNDX-MKG" }, result: read }),
          imageRef: await saveSourceImage({ projectPath, imageKey: "scan_1", bytes: new Uint8Array([1, 2, 3]) }),
        }));
        expect(staged.stagingError).toBeUndefined();
        expect(staged.staged).not.toBeNull();
        expect(imageRef).toBe("images/scan_1.jpg");
        expect(await ownerOf(projectPath)).toEqual([a.userId]);
      });

      /** A project `userId` owns, written through the store a connector binds. */
      async function seedOwned(userId: string, objective: string): Promise<string> {
        const projectPath = freshPath();
        const store = new PgS3ProjectStore(backend, {
          projectId: projectPath.slice(1),
          anchorPath: projectPath,
          ownerId: userId,
        });
        await store.writeJson(projectPath, "research.json", { project: { objective } });
        return projectPath;
      }

      /** What a tool answered: the body of an admitted, non-error result. */
      function toolBody(r: { status: number; text: string }): Record<string, any> {
        expect(r.status, r.text).toBe(200);
        const { result } = JSON.parse(r.text);
        expect(result.isError, r.text).not.toBe(true);
        return JSON.parse(result.content[0].text);
      }

      const pathsOf = (body: Record<string, any>): string[] => body.projects.map((p: any) => p.projectPath);

      it("a user's projects list newest document first plus one fresh path, and another user's project is never listed", async () => {
        const a = await seedConnector();
        const b = await seedConnector();
        const [low, mid, high] = [
          await seedOwned(a.userId, "one"),
          await seedOwned(a.userId, "two"),
          await seedOwned(a.userId, "three"),
        ].sort();
        const foreign = await seedOwned(b.userId, "not yours");
        // The middle id is the newest, so neither id order passes.
        const backdate = (projectPath: string, days: number) =>
          backend.pool.query(
            "UPDATE documents SET updated_at = now() - make_interval(days => $2) WHERE project_id = $1 AND name = 'research.json'",
            [projectPath.slice(1), days],
          );
        await backdate(high!, 1);
        await backdate(low!, 2);

        const body = toolBody(await connCall(a.token, "project_list", {}));
        expect(body.mode).toBe("hosted");
        expect(pathsOf(body)).toEqual([mid, high, low]);
        expect(body.newProjectPath).toMatch(/^\/proj_[0-9a-f]{16}$/);
        expect([low, mid, high, foreign]).not.toContain(body.newProjectPath);
        expect(JSON.stringify(body)).not.toContain(foreign);
        expect(JSON.stringify(body)).not.toContain("not yours");
      });

      it("an ownerless project and a claimed id with no research.json are not listed, and the claimed id does not displace the fresh path", async () => {
        const a = await seedConnector();
        const ownerless = freshPath();
        await new PgS3ProjectStore(backend, { projectId: ownerless.slice(1), anchorPath: ownerless }).writeJson(
          ownerless,
          "research.json",
          { project: { objective: "nobody's" } },
        );
        const claimed = freshPath();
        await new PgS3ProjectStore(backend, {
          projectId: claimed.slice(1),
          anchorPath: claimed,
          ownerId: a.userId,
        }).writeBytes(claimed, "images/scan.jpg", new Uint8Array([1]));

        const body = toolBody(await connCall(a.token, "project_list", {}));
        expect(pathsOf(body)).toEqual([]);
        expect(body.newProjectPath).toMatch(/^\/proj_[0-9a-f]{16}$/);
        expect([claimed, ownerless]).not.toContain(body.newProjectPath);
      });

      it("a user at the listing limit gets every project, and one past it the newest with the cut said", async () => {
        const a = await seedConnector();
        const oldest = await seedOwned(a.userId, "the oldest");
        await backend.pool.query(
          "UPDATE documents SET updated_at = now() - interval '1 day' WHERE project_id = $1 AND name = 'research.json'",
          [oldest.slice(1)],
        );
        const rest: string[] = [];
        for (let i = 1; i < MAX_LISTED_PROJECTS; i++) rest.push(await seedOwned(a.userId, `project ${i}`));

        const atLimit = toolBody(await connCall(a.token, "project_list", {}));
        expect(pathsOf(atLimit)).toHaveLength(MAX_LISTED_PROJECTS);
        expect(pathsOf(atLimit)).toContain(oldest);
        expect(atLimit).not.toHaveProperty("truncated");
        expect(atLimit.message).not.toContain("More projects exist");

        const newest = await seedOwned(a.userId, "the newest");
        const pastLimit = toolBody(await connCall(a.token, "project_list", {}));
        expect(pathsOf(pastLimit)).toHaveLength(MAX_LISTED_PROJECTS);
        expect(pathsOf(pastLimit)).toContain(newest);
        expect(pathsOf(pastLimit)).not.toContain(oldest);
        expect(pastLimit.truncated).toBe(true);
        expect(pastLimit.message).toContain("More projects exist than are listed");
        expect(pastLimit.newProjectPath).toMatch(/^\/proj_[0-9a-f]{16}$/);

        // The database stops at the limit: the rest never reach this process.
        await seedOwned(a.userId, "two past the limit");
        const query = vi.spyOn(backend.pool, "query");
        await ownedProjectIds(backend, a.userId);
        const { rows } = await (query.mock.results[0]!.value as Promise<{ rows: unknown[] }>);
        query.mockRestore();
        expect(rows).toHaveLength(MAX_LISTED_PROJECTS + 1);
      }, 60_000);

      it("project_list then person_read then project_create builds a project the caller owns and the next project_list returns it", async () => {
        const a = await seedConnector();
        const first = toolBody(await connCall(a.token, "project_list", {}));
        expect(pathsOf(first)).toEqual([]);
        const projectPath = first.newProjectPath as string;
        seededProjects.push(projectPath.slice(1));

        const read = toolBody(
          await connCall(a.token, "person_read", { personId: upstream.personId, projectPath }),
        );
        expect(read.stagingError).toBeUndefined();
        expect(read.staged).not.toBeNull();
        expect(await ownerOf(projectPath)).toEqual([a.userId]);

        const created = toolBody(
          await connCall(a.token, "project_create", {
            projectPath,
            objective: "Does a connector build a project end to end?",
            personId: upstream.personId,
          }),
        );
        expect(created.ok, JSON.stringify(created)).toBe(true);
        expect(await ownerOf(projectPath)).toEqual([a.userId]);

        const next = toolBody(await connCall(a.token, "project_list", {}));
        expect(pathsOf(next)).toEqual([projectPath]);
        expect(next.projects[0].subjects[0].name).toBe("Flow Person");
        expect(next.newProjectPath).toMatch(/^\/proj_[0-9a-f]{16}$/);
        expect(next.newProjectPath).not.toBe(projectPath);
      });

      it("a research_append carrying a document past the cap is refused in words, and one under it still lands", async () => {
        const a = await seedConnector();
        const projectPath = freshPath();
        const created = await connCall(a.token, "project_create", { ...createArgs("Alpha"), projectPath });
        expect(created.text).not.toContain('"isError":true');

        // Filled to 5,000 bytes under the cap: room for a question, not for the
        // long rationale the update below gives it.
        const store = new PgS3ProjectStore(backend, {
          projectId: projectPath.slice(1),
          anchorPath: projectPath,
          ownerId: a.userId,
        });
        const research = JSON.parse(await store.readText(projectPath, "research.json"));
        const size = Buffer.byteLength(JSON.stringify(research, null, 2));
        research.project.objective += "x".repeat(MAX_DOCUMENT_BYTES - size - 5_000);
        await store.writeJson(projectPath, "research.json", research);
        const rationale = async () => JSON.parse(await store.readText(projectPath, "research.json")).questions[0].rationale;

        const asked = await connCall(a.token, "research_append", {
          projectPath,
          section: "questions",
          op: "append",
          entry: {
            question: "Who were his parents?",
            rationale: "A gap in the timeline",
            selection_basis: "objective_decomposition",
            priority: "high",
            status: "open",
            depends_on: [],
            unblocks: [],
            resolved: null,
            resolution_assertion_ids: [],
            search_stop: { stopped_because: null, log_entry_ids: [], stop_criteria: null, not_reached: [] },
          },
        });
        expect(toolBody(asked).ok, asked.text).toBe(true);

        const refused = await connCall(a.token, "research_append", {
          projectPath,
          section: "questions",
          op: "update",
          entryId: "q_001",
          fields: { rationale: "x".repeat(6_000) },
        });
        expect(refused.status, refused.text).toBe(200);
        const { result } = JSON.parse(refused.text);
        expect(result.isError, refused.text).toBe(true);
        expect(JSON.parse(result.content[0].text)).toEqual({
          error: "Nothing was saved: research.json would be larger than the 16 MB a project document may hold.",
        });
        expect(await rationale()).toBe("A gap in the timeline");

        expect(pathsOf(toolBody(await connCall(a.token, "project_list", {})))).toEqual([projectPath]);
      }, 30_000);

      it("a two-call batch is refused", async () => {
        const a = await seedConnector();
        const one = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "convert_calendar", arguments: {} } };
        const res = await fetch(`${base}/mcp`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream",
            Authorization: `Bearer ${a.token}`,
          },
          body: JSON.stringify([one, one]),
        });
        expect(res.status).toBe(400);
        expect((await res.text())).toMatch(/batch is not supported/);
      });

      it("a connector token sent with the WORKER's headers is 403 and reads nothing", async () => {
        const a = await seedConnector();
        // The project header routes to the worker path, where only a stamp on
        // an open turn admits — a connector token is not one.
        const workerProject = newProject();
        const turnId = await seedTurn(workerProject, null);
        const r = await call(
          { projectId: workerProject, turnId, bearer: a.token },
          "project_context",
          { projectPath: ANCHOR },
        );
        expect(r.status, r.text).toBe(403);
      });

      /** `userId`'s store on a path they own, for seeding what a tool would have written. */
      const ownedStore = (projectPath: string, userId: string) =>
        new PgS3ProjectStore(backend, { projectId: projectPath.slice(1), anchorPath: projectPath, ownerId: userId });

      /** The link `read_project_view` signs, as a path on the test's own port. */
      async function imagePath(token: string, projectPath: string, id: string): Promise<string> {
        const r = await connCall(token, "read_project_view", { part: "image", id, projectPath });
        expect(r.status, r.text).toBe(200);
        const { result } = JSON.parse(r.text);
        expect(result.isError, r.text).not.toBe(true);
        const { url } = result.structuredContent as { url: string };
        expect(url.startsWith(`${PUBLIC_ORIGIN}/img?t=`), url).toBe(true);
        return url.slice(PUBLIC_ORIGIN.length);
      }

      const imageBytes = async (path: string): Promise<Buffer> => {
        const res = await fetch(`${base}${path}`);
        expect(res.status).toBe(200);
        return Buffer.from(await res.arrayBuffer());
      };

      it("show_project and read_project_view read A's documents from Postgres", async () => {
        const a = await seedConnector();
        const projectPath = await seedOwned(a.userId, "shown");
        const args = { show: "latest", projectPath };
        const shown = await connCall(a.token, "show_project", args);
        expect(shown.status, shown.text).toBe(200);
        const { result } = JSON.parse(shown.text);
        expect(result.isError, shown.text).not.toBe(true);
        expect(result._meta["genealogy/project"]).toEqual({
          research: { project: { objective: "shown" } },
          tree: null,
          startingTree: null,
          collections: null,
          derived: { folderName: projectPath.slice(1) },
          echo: args,
        });
        const read = await connCall(a.token, "read_project_view", { part: "document", projectPath });
        expect(JSON.parse(read.text).result.structuredContent.research).toEqual({ project: { objective: "shown" } });
      });

      it("a scan written to A's project is served by /img with the same bytes", async () => {
        const a = await seedConnector();
        const projectPath = await seedOwned(a.userId, "scanned");
        const scan = randomBytes(4096);
        await ownedStore(projectPath, a.userId).writeBytes(projectPath, "images/scan.jpg", scan);
        const res = await fetch(`${base}${await imagePath(a.token, projectPath, "images/scan.jpg")}`);
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBe("image/jpeg");
        expect(Buffer.from(await res.arrayBuffer()).equals(scan)).toBe(true);
      });

      it("A's token never returns B's same-named image", async () => {
        const a = await seedConnector();
        const b = await seedConnector();
        const pathA = await seedOwned(a.userId, "A's");
        const pathB = await seedOwned(b.userId, "B's");
        const scanA = randomBytes(1024);
        const scanB = randomBytes(1024);
        await ownedStore(pathA, a.userId).writeBytes(pathA, "images/scan.jpg", scanA);
        await ownedStore(pathB, b.userId).writeBytes(pathB, "images/scan.jpg", scanB);
        const fromA = await imageBytes(await imagePath(a.token, pathA, "images/scan.jpg"));
        const fromB = await imageBytes(await imagePath(b.token, pathB, "images/scan.jpg"));
        expect(fromA.equals(scanA)).toBe(true);
        expect(fromB.equals(scanB)).toBe(true);
        expect(fromA.equals(scanB)).toBe(false);
      });

      it("a good token with no blob row is 404", async () => {
        const a = await seedConnector();
        const projectPath = await seedOwned(a.userId, "no scan");
        const res = await fetch(`${base}${await imagePath(a.token, projectPath, "images/absent.jpg")}`);
        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({ error: "Not found" });
      });

      it("B's read_project_view on A's project is 403 and signs nothing", async () => {
        const a = await seedConnector();
        const b = await seedConnector();
        const projectPath = await seedOwned(a.userId, "A's alone");
        await ownedStore(projectPath, a.userId).writeBytes(projectPath, "images/scan.jpg", randomBytes(16));
        const r = await connCall(b.token, "read_project_view", { part: "image", id: "images/scan.jpg", projectPath });
        expect(r.status, r.text).toBe(403);
        expect(r.text).not.toContain("/img");
        expect(r.text).not.toContain("expiresAt");
      });

      it("show_project on a fresh path is refused, names project_list and leaves no projects row", async () => {
        const a = await seedConnector();
        const projectPath = freshPath();
        const r = await connCall(a.token, "show_project", { show: "setup", projectPath });
        expect(r.status, r.text).toBe(200);
        const { result } = JSON.parse(r.text);
        expect(result.isError, r.text).toBe(true);
        expect(result.content[0].text).toContain("project_list");
        expect(await ownerOf(projectPath)).toEqual([]);
      });

      // The race the door CANNOT decide: it sees no projects row for either
      // user, so both are admitted and the first write has to settle it.
      // Driven at the store level because through the door it is not a race at
      // all — B is refused by the owner check before bindStore.
      it("two stores racing on one fresh id: the loser cannot write into the winner's project", async () => {
        const a = await seedConnector();
        const b = await seedConnector();
        const projectPath = freshPath();
        const projectId = projectPath.slice(1);

        const storeFor = (ownerId: string) =>
          new PgS3ProjectStore(backend, { projectId, anchorPath: projectPath, ownerId });

        await storeFor(a.userId).writeJson(projectPath, "research.json", { winner: a.userId });
        await expect(
          storeFor(b.userId).writeJson(projectPath, "research.json", { loser: b.userId }),
        ).rejects.toThrow(/belongs to another account/);

        const owner = await backend.pool.query<{ owner_id: string }>(
          "SELECT owner_id FROM projects WHERE project_id = $1",
          [projectId],
        );
        expect(owner.rows[0]?.owner_id).toBe(a.userId);
      });
    });

    describe("the project check (U4): the bearer must be the stamped grant of an open turn on the project", () => {
      // Patron A works project A on turn A; patron B works project B on turn B.
      let idA: string;
      let idB: string;
      let turnA: string;
      let turnB: string;
      const tokA = `tok-a-${randomUUID()}`;
      const tokB = `tok-b-${randomUUID()}`;

      beforeAll(async () => {
        idA = newProject();
        idB = newProject();
        turnA = await seedTurn(idA, tokA);
        turnB = await seedTurn(idB, tokB);
        // B already holds a document, a blob and a staged result.
        const storeB = new PgS3ProjectStore(backend, { projectId: idB, anchorPath: ANCHOR });
        await storeB.writeJson(ANCHOR, "notes.json", { owner: "B" });
        await storeB.writeBytes(ANCHOR, "images/b.bin", new Uint8Array([1, 2, 3]));
        await storeB.writeBytes(ANCHOR, "results/.staging/b.json", new TextEncoder().encode("{}"));
      });

      it("A's bearer on A's turn naming B's project: 403, and B's documents, blobs and staging are unchanged", async () => {
        const before = await rowCounts(idB);
        expect(before).toEqual({ documents: 1, blobs: 1, staging: 1 });
        bindStore.mockClear();
        const r = await call({ projectId: idB, turnId: turnA, bearer: tokA }, "project_create", createArgs("Intruder"));
        expect(r.status, r.text).toBe(403);
        expect(JSON.parse(r.text)).toEqual(FORBIDDEN_ATTEMPT);
        expect(r.text).not.toContain(tokA);
        expect(bindStore).not.toHaveBeenCalled();
        expect(await rowCounts(idB)).toEqual(before);
      });

      // B's fence is current here, so only the door's hash term stands between this
      // write and B's project.
      it("A's bearer on B's turn and B's project: 403, and nothing is written", async () => {
        const before = await rowCounts(idB);
        const r = await call({ projectId: idB, turnId: turnB, bearer: tokA }, "project_create", createArgs("Intruder"));
        expect(r.status, r.text).toBe(403);
        expect(JSON.parse(r.text)).toEqual(FORBIDDEN_ATTEMPT);
        expect(await rowCounts(idB)).toEqual(before);
      });

      it("A on A: 200, and the write lands", async () => {
        const r = await call({ projectId: idA, turnId: turnA, bearer: tokA }, "project_create", createArgs("Owner"));
        expect(r.status, r.text).toBe(200);
        expect(r.text).not.toContain('"isError":true');
        const tree = await backend.pool.query(
          "SELECT doc FROM documents WHERE project_id = $1 AND name = 'tree.gedcomx.json'",
          [idA],
        );
        expect(tree.rows[0]?.doc.persons[0].names[0].given).toBe("Owner");
      });

      it("an unknown bearer: 403", async () => {
        await expectForbidden({ projectId: idA, turnId: turnA, bearer: `tok-${randomUUID()}` }, "unknown bearer");
      });

      it("no Authorization header: 403", async () => {
        await expectForbidden({ projectId: idA, turnId: turnA }, "no bearer");
      });

      it("an unfenced project request: 403", async () => {
        await expectForbidden({ projectId: idA, bearer: tokA }, "no fence");
      });

      it("a NULL-owner project (claimed, never stamped): 403", async () => {
        const orphan = newProject();
        await backend.pool.query("INSERT INTO projects (project_id, owner_id) VALUES ($1, NULL)", [orphan]);
        const turn = await seedTurn(orphan, null);
        await expectForbidden({ projectId: orphan, turnId: turn, bearer: tokA }, "NULL owner, A's bearer");
        await expectForbidden({ projectId: orphan, turnId: turn, bearer: "" }, "NULL owner, empty bearer");
      });

      it("a completed turn's own bearer and fence: 403", async () => {
        const id = newProject();
        const tok = `tok-${randomUUID()}`;
        const turn = await seedTurn(id, tok);
        await expectAdmitted({ projectId: id, turnId: turn, bearer: tok }, "open turn");
        await backend.pool.query("UPDATE turns SET completed_at = now(), outcome = 'done' WHERE turn_id = $1", [turn]);
        await expectForbidden({ projectId: id, turnId: turn, bearer: tok }, "completed turn");
      });

      it("a re-claimed turn not yet stamped: 403 for every bearer", async () => {
        const id = newProject();
        const tok = `tok-${randomUUID()}`;
        const turn = await seedTurn(id, tok);
        await reclaim(turn);
        await expectForbidden({ projectId: id, turnId: turn, epoch: 2, bearer: tok }, "old bearer, fence 2");
        await expectForbidden({ projectId: id, turnId: turn, epoch: 1, bearer: tok }, "old bearer, fence 1");
        await expectForbidden({ projectId: id, turnId: turn, epoch: 2, bearer: `tok-${randomUUID()}` }, "new bearer");
      });

      it("a refresh between attempts: the re-claim stamps the new token, which is admitted; the old one is refused with either fence", async () => {
        const id = newProject();
        const oldTok = `tok-${randomUUID()}`;
        const newTok = `tok-${randomUUID()}`;
        const turn = await seedTurn(id, oldTok);
        await expectAdmitted({ projectId: id, turnId: turn, epoch: 1, bearer: oldTok }, "first attempt");
        await reclaim(turn);
        await expectForbidden({ projectId: id, turnId: turn, epoch: 2, bearer: oldTok }, "old token before restamp");
        await stamp(turn, newTok);
        await expectAdmitted({ projectId: id, turnId: turn, epoch: 2, bearer: newTok }, "new token, fence 2");
        await expectForbidden({ projectId: id, turnId: turn, epoch: 1, bearer: oldTok }, "old token, fence 1");
        await expectForbidden({ projectId: id, turnId: turn, epoch: 2, bearer: oldTok }, "old token, fence 2");
      });

      it("no project header: no U4 check, and convert_calendar works — now on the CONNECTOR door", async () => {
        // A request with no project header used to skip every check and run
        // store-less. Under one front door (E1) it is a connector request, so
        // it needs a connector token; `tokA` is a worker bearer and would be a
        // 401. The case's point — no U4 check, store-less tools still answer —
        // is unchanged.
        const conn = await backend.pool.query<{ id: string }>(
          "INSERT INTO users (id, email) VALUES ($1, $2) RETURNING id",
          [`u_nph_${randomUUID()}`, `nph-${randomUUID()}@test.invalid`],
        );
        const userId = conn.rows[0]!.id;
        noProjectHeaderUser = userId;
        const token = `conn-${randomUUID()}`;
        await backend.pool.query(
          "INSERT INTO familysearch_tokens (user_id, access_token_enc, expires_at, granted_at) " +
            "VALUES ($1, $2, now() + interval '1 hour', now())",
          [userId, encrypt("fs-token", TEST_ENC_KEY)],
        );
        await backend.pool.query(
          "INSERT INTO connector_tokens (token_sha256, user_id, client_id, scopes, expires_at) " +
            "VALUES ($1, $2, 'test', ARRAY['mcp'], now() + interval '1 hour')",
          [createHash("sha256").update(token, "utf8").digest("hex"), userId],
        );
        const client = await connect({ bearer: token });
        const converted = await client.callTool({
          name: "convert_calendar",
          arguments: { date: { year: 1750, month: 2, day: 10 }, corrections: { osNsYear: true } },
        });
        expect(converted.isError, textOf(converted)).not.toBe(true);
        expect(JSON.parse(textOf(converted))).toMatchObject({ ok: true, converted: { year: 1751 } });
      });

      it("an unmigrated turns.bearer_sha256: /healthz answers 503 with a schema label", async () => {
        const scratch = `door_${randomUUID().replace(/-/g, "")}`;
        await backend.pool.query(`CREATE DATABASE ${scratch}`);
        const options = protoBackendOptions();
        const dsn = new URL(options.dsn);
        dsn.pathname = `/${scratch}`;
        const unmigrated = createPgS3Backend({ ...options, dsn: dsn.toString() });
        let door: HttpServer | undefined;
        try {
          // Every store table exists; only the stamp column is missing.
          for (const table of ["documents", "blobs", "staging", "projects"]) {
            await unmigrated.pool.query(`CREATE TABLE ${table} (project_id text)`);
          }
          await unmigrated.pool.query("CREATE TABLE turns (turn_id text, project_id text, claim_epoch bigint)");
          // Present so this case isolates the missing COLUMN. The connector
          // door reads this table too (017), so STORE_TABLES covers it — and
          // without it readiness would fail here for a different reason.
          await unmigrated.pool.query("CREATE TABLE connector_tokens (token_sha256 text)");
          door = await startHttpServer({
            host: "127.0.0.1",
            port: 0,
            baseConfig: {},
            bindStore,
            authorize: (req) => authorizeAttempt(unmigrated, req),
            // This door runs against a database with no connector tables, so
            // the lookups would throw; the cases here never present a connector
            // token, and a throw is a 503, never an admission.
            lookupConnector: async () => null,
            projectOwner: async () => ({ exists: false, ownerId: null }),
            ownedProjects: async () => ({ ids: [], truncated: false }),
            checkReady: () => unmigrated.checkReady(),
          });
          const address = door.address();
          if (!address || typeof address !== "object") throw new Error("server did not bind a port");
          const res = await fetch(`http://127.0.0.1:${address.port}/healthz`);
          const text = await res.text();
          expect(res.status, text).toBe(503);
          expect(JSON.parse(text)).toMatchObject({
            ok: false,
            checks: { postgres: { ok: false, error: "schema: missing turns.bearer_sha256" }, s3: { ok: true } },
          });
        } finally {
          if (door) {
            door.closeAllConnections();
            await new Promise<void>((resolve) => door!.close(() => resolve()));
          }
          await unmigrated.close();
          await backend.pool.query(`DROP DATABASE ${scratch} WITH (FORCE)`);
        }
      });
    });
  });
}

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Server as HttpServer } from "node:http";
import { randomUUID } from "node:crypto";
import { CreateBucketCommand } from "@aws-sdk/client-s3";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startHttpServer } from "../../src/http-server.js";
import {
  authorizeAttempt,
  createPgS3Backend,
  PgS3ProjectStore,
  type PgS3Backend,
} from "../../src/store/pg-s3-project-store.js";
import type { ClaimFence, ProjectStore } from "../../src/store/project-store.js";
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
    (projectId: string, signal: AbortSignal, fence?: ClaimFence): ProjectStore =>
      new PgS3ProjectStore(backend, { projectId, anchorPath: ANCHOR, signal, fence }),
  );

  let server: HttpServer;
  let base: string;
  const clients: Client[] = [];
  const projectIds: string[] = [];
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
        baseConfig: {},
        bindStore,
        authorize: (req) => authorizeAttempt(backend, req),
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

      it("no project header: no check, and convert_calendar works", async () => {
        const client = await connect({ bearer: tokA });
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
          door = await startHttpServer({
            host: "127.0.0.1",
            port: 0,
            baseConfig: {},
            bindStore,
            authorize: (req) => authorizeAttempt(unmigrated, req),
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

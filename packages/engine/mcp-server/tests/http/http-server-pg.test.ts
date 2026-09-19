import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Server as HttpServer } from "node:http";
import { randomUUID } from "node:crypto";
import { CreateBucketCommand } from "@aws-sdk/client-s3";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startHttpServer } from "../../src/http-server.js";
import {
  createPgS3Backend,
  PgS3ProjectStore,
  type PgS3Backend,
} from "../../src/store/pg-s3-project-store.js";
import type { ProjectStore } from "../../src/store/project-store.js";

// The HTTP server with the real per-request store — the factory build/http.js
// installs — against the compose postgres + minio: `make proto-store-test`
// starts the stack and sets these, exactly as tests/store/pg-s3-project-store.test.ts
// is gated. Without them the file registers one skipped suite whose name says
// so. tests/http/http-server.test.ts proves the same isolation over a file
// double; this proves the header reaches Postgres rows keyed by the id it named.

const DSN = process.env.PROTO_PG_DSN;
const ENDPOINT = process.env.PROTO_S3_ENDPOINT;
const BUCKET = process.env.PROTO_S3_BUCKET ?? "projects";
const ACCESS_KEY = process.env.PROTO_S3_ACCESS_KEY ?? "proto";
const SECRET_KEY = process.env.PROTO_S3_SECRET_KEY ?? "protoproto";

const ANCHOR = "/project";
const PROJECT_HEADER = "X-Genealogy-Project-Id";

if (!DSN || !ENDPOINT) {
  describe.skip(
    "HTTP server over PgS3ProjectStore — skipped: PROTO_PG_DSN and PROTO_S3_ENDPOINT are not set (run `make proto-store-test`)",
    () => {
      it("needs the compose stack", () => {});
    },
  );
} else {
  const backend: PgS3Backend = createPgS3Backend({
    dsn: DSN,
    s3: {
      endpoint: ENDPOINT,
      bucket: BUCKET,
      accessKeyId: ACCESS_KEY,
      secretAccessKey: SECRET_KEY,
      forcePathStyle: true,
    },
  });
  const bindStore = vi.fn(
    (projectId: string): ProjectStore => new PgS3ProjectStore(backend, { projectId, anchorPath: ANCHOR }),
  );

  let server: HttpServer;
  let base: string;
  const clients: Client[] = [];
  const projectIds: string[] = [];

  async function connect(projectId: string): Promise<Client> {
    const client = new Client({ name: "http-server-pg-test", version: "0" });
    const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers: { [PROJECT_HEADER]: projectId } },
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

  /** Every row the project wrote, gone. project_create writes documents only,
   *  so no S3 object exists to delete; the blob and staging rows are cleared
   *  for symmetry with the store suite's purge. */
  async function purge(projectId: string): Promise<void> {
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
      server = await startHttpServer({ host: "127.0.0.1", port: 0, baseConfig: {}, bindStore });
      const address = server.address();
      if (!address || typeof address !== "object") throw new Error("server did not bind a port");
      base = `http://127.0.0.1:${address.port}`;
    });

    afterAll(async () => {
      await Promise.all(clients.map((c) => c.close().catch(() => undefined)));
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      for (const id of projectIds) await purge(id);
      await backend.close();
    });

    it("two concurrent requests with different X-Genealogy-Project-Id headers write and read their own rows", async () => {
      const idA = randomUUID();
      const idB = randomUUID();
      projectIds.push(idA, idB);
      const [a, b] = await Promise.all([connect(idA), connect(idB)]);
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
  });
}

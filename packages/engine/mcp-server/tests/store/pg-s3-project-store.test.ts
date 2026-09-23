import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import net from "node:net";
import {
  CreateBucketCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import {
  createPgS3Backend,
  PgS3ProjectStore,
  type PgS3Backend,
} from "../../src/store/pg-s3-project-store.js";
import { runProjectStoreConformance, type StoreFixture } from "./conformance.js";

// The Postgres/S3 backend against a live stack: `make proto-store-test` starts
// the compose postgres + minio and sets these. Without them the file registers
// one skipped suite whose name says so, so a plain `npm test` stays green and
// still shows that this backend was not exercised. The cases that need no
// stack — the projectId guard and the two timeouts — run either way.

const DSN = process.env.PROTO_PG_DSN;
const ENDPOINT = process.env.PROTO_S3_ENDPOINT;
const BUCKET = process.env.PROTO_S3_BUCKET ?? "projects";
const ACCESS_KEY = process.env.PROTO_S3_ACCESS_KEY ?? "proto";
const SECRET_KEY = process.env.PROTO_S3_SECRET_KEY ?? "protoproto";

const ANCHOR = "/project";
const MISSING = "/elsewhere";

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

/** One write's object key: `<projectId>/<ref>/<uuid>`. */
const objectKeyFor = (projectId: string, ref: string): RegExp =>
  new RegExp(`^${projectId}/${ref.replace(/[.]/g, "\\.")}/[0-9a-f-]{36}$`);

describe("PgS3ProjectStore without a stack", () => {
  const s3 = {
    endpoint: "http://127.0.0.1:1",
    bucket: "projects",
    accessKeyId: "x",
    secretAccessKey: "y",
    forcePathStyle: true,
  };

  it("rejects a projectId that cannot be an S3 key prefix on its own", async () => {
    const backend = createPgS3Backend({ dsn: "postgresql://x:y@127.0.0.1:1/z", s3 });
    try {
      for (const bad of ["p/q", "", "..", ".", "/p", "p q", "-p", "p\u0000"]) {
        expect(
          () => new PgS3ProjectStore(backend, { projectId: bad, anchorPath: ANCHOR }),
          JSON.stringify(bad),
        ).toThrow(/S3 key prefix/);
      }
      for (const ok of ["p", randomUUID(), "proj_1.2-x", "7"]) {
        expect(() => new PgS3ProjectStore(backend, { projectId: ok, anchorPath: ANCHOR }), ok).not.toThrow();
      }
    } finally {
      await backend.close();
    }
  });

  it("exposes its projectId — the identity the image-store cap keys on for patron isolation (#2457 B2)", async () => {
    // The shared-process cap isolation (truncatedImageKey) keys on the bound
    // store's `projectId`. If an isolating backend omitted the optional field it
    // would silently fall back to the shared anchor projectPath and collide, so
    // pin that PgS3 — the isolating backend — actually surfaces it.
    const backend = createPgS3Backend({ dsn: "postgresql://x:y@127.0.0.1:1/z", s3 });
    try {
      const store = new PgS3ProjectStore(backend, { projectId: "proj_alice", anchorPath: ANCHOR });
      expect(store.projectId).toBe("proj_alice");
    } finally {
      await backend.close();
    }
  });

  describe("timeouts", () => {
    // A listener that accepts every connection and never sends a byte: the
    // stalled-host shape both clients would otherwise wait on forever.
    const server = net.createServer((socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
    });
    const sockets = new Set<net.Socket>();
    let port = 0;

    beforeAll(async () => {
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      port = (server.address() as net.AddressInfo).port;
    });

    afterAll(async () => {
      for (const s of sockets) s.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    function silentBackend(): PgS3Backend {
      return createPgS3Backend({
        dsn: `postgresql://postgres:x@127.0.0.1:${port}/x`,
        s3: { ...s3, endpoint: `http://127.0.0.1:${port}` },
        timeouts: { connectMs: 300, s3RequestMs: 300 },
      });
    }

    it("rejects a Postgres connection that never completes", async () => {
      const backend = silentBackend();
      try {
        const store = new PgS3ProjectStore(backend, { projectId: "p", anchorPath: ANCHOR });
        const t0 = Date.now();
        await expect(store.classifyProject(ANCHOR)).rejects.toThrow(/timeout/i);
        expect(Date.now() - t0).toBeLessThan(3000);
      } finally {
        await backend.close();
      }
    }, 5000);

    it("rejects an S3 request that never answers", async () => {
      const backend = silentBackend();
      try {
        const t0 = Date.now();
        // Straight at the client: every store method reaches Postgres before
        // S3, so this is the only way to reach the S3 timeout alone.
        await expect(
          backend.s3.send(new HeadObjectCommand({ Bucket: "projects", Key: "p/x/y" })),
        ).rejects.toMatchObject({ name: "TimeoutError" });
        // Three attempts of 300 ms plus the SDK's backoff.
        expect(Date.now() - t0).toBeLessThan(4000);
      } finally {
        await backend.close();
      }
    }, 5000);
  });
});

if (!DSN || !ENDPOINT) {
  describe.skip(
    "PgS3ProjectStore — skipped: PROTO_PG_DSN and PROTO_S3_ENDPOINT are not set (run `make proto-store-test`)",
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

  /** Every object key under a prefix, sorted. */
  async function keysUnder(prefix: string): Promise<string[]> {
    const listed = await backend.s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix }));
    return (listed.Contents ?? []).map((o) => o.Key!).sort();
  }

  /** Every row and object the project wrote, gone. */
  async function purge(projectId: string): Promise<void> {
    for (const table of ["documents", "blobs", "staging", "projects"]) {
      await backend.pool.query(`DELETE FROM ${table} WHERE project_id = $1`, [projectId]);
    }
    const keys = (await keysUnder(`${projectId}/`)).map((Key) => ({ Key }));
    if (keys.length > 0) {
      await backend.s3.send(new DeleteObjectsCommand({ Bucket: BUCKET, Delete: { Objects: keys } }));
    }
  }

  async function blobRow(
    projectId: string,
    key: string,
  ): Promise<{ s3_key: string; bytes: number; sha256: string }> {
    const r = await backend.pool.query("SELECT s3_key, bytes, sha256 FROM blobs WHERE project_id = $1 AND key = $2", [
      projectId,
      key,
    ]);
    expect(r.rowCount, `blobs row for ${key}`).toBe(1);
    return r.rows[0];
  }

  /** The object behind a blob ref, straight from the bucket via the index row. */
  async function readBytes(store: PgS3ProjectStore, ref: string): Promise<Uint8Array> {
    const row = await blobRow(store.projectId, ref);
    const obj = await backend.s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: row.s3_key }));
    return obj.Body!.transformToByteArray();
  }

  async function expectObjectGone(key: string): Promise<void> {
    await expect(backend.s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }))).rejects.toMatchObject({
      $metadata: { httpStatusCode: 404 },
    });
  }

  async function projectRows(projectId: string): Promise<number> {
    const r = await backend.pool.query("SELECT count(*)::int AS n FROM projects WHERE project_id = $1", [projectId]);
    return r.rows[0].n;
  }

  async function makeProject(): Promise<{ projectId: string; store: PgS3ProjectStore }> {
    const projectId = randomUUID();
    await backend.pool.query("INSERT INTO projects (project_id) VALUES ($1)", [projectId]);
    return { projectId, store: new PgS3ProjectStore(backend, { projectId, anchorPath: ANCHOR }) };
  }

  async function makeFixture(): Promise<StoreFixture> {
    const { projectId, store } = await makeProject();
    return { store, projectPath: ANCHOR, missingPath: MISSING, cleanup: () => purge(projectId) };
  }

  describe("PgS3ProjectStore", () => {
    beforeAll(async () => {
      // The compose one-shot creates the bucket; a bare stack gets it here.
      try {
        await backend.s3.send(new CreateBucketCommand({ Bucket: BUCKET }));
      } catch (e: any) {
        if (e?.name !== "BucketAlreadyOwnedByYou" && e?.name !== "BucketAlreadyExists") throw e;
      }
    });

    afterAll(async () => {
      await backend.close();
    });

    runProjectStoreConformance("PgS3ProjectStore", makeFixture);

    describe("Postgres specifics", () => {
      /** A project per case, purged when the case ends. */
      async function withProject<T>(
        fn: (p: { projectId: string; store: PgS3ProjectStore }) => Promise<T>,
      ): Promise<T> {
        const p = await makeProject();
        try {
          return await fn(p);
        } finally {
          await purge(p.projectId);
        }
      }

      it("bumps a document's version on every rewrite", () =>
        withProject(async ({ projectId, store }) => {
          await store.writeJson(ANCHOR, "research.json", { v: 1 });
          await store.writeJson(ANCHOR, "research.json", { v: 2 });
          await store.writeJson(ANCHOR, "research.json", { v: 3 });
          const r = await backend.pool.query(
            "SELECT version, doc FROM documents WHERE project_id = $1 AND name = 'research.json'",
            [projectId],
          );
          expect(r.rows[0].version).toBe(3);
          expect(r.rows[0].doc).toEqual({ v: 3 });
        }));

      it("readText of a document parses back to the written value", () =>
        withProject(async ({ store }) => {
          const value = { b: [1, { c: "x" }], a: null, n: 1.5, s: "é — “quoted”" };
          await store.writeJson(ANCHOR, "tree.gedcomx.json", value);
          const text = await store.readText(ANCHOR, "tree.gedcomx.json");
          expect(JSON.parse(text)).toEqual(value);
          expect(text).toBe(JSON.stringify(JSON.parse(text), null, 2));
        }));

      it("creates the projects row on a project's first write", async () => {
        const writers: Array<[string, (s: PgS3ProjectStore) => Promise<void>]> = [
          ["writeJson", (s) => s.writeJson(ANCHOR, "research.json", {})],
          ["writeBytes", (s) => s.writeBytes(ANCHOR, "images/a.jpg", new Uint8Array([1]))],
          ["appendText", (s) => s.appendText(ANCHOR, "results/match-scores.jsonl", "{}\n")],
        ];
        for (const [name, write] of writers) {
          const projectId = randomUUID();
          const store = new PgS3ProjectStore(backend, { projectId, anchorPath: ANCHOR });
          try {
            expect(await projectRows(projectId), name).toBe(0);
            expect(await store.classifyProject(ANCHOR), name).toBe("missing_dir");
            expect(await store.projectDirState(ANCHOR), name).toBe("missing");
            await write(store);
            expect(await projectRows(projectId), name).toBe(1);
            expect(await store.projectDirState(ANCHOR), name).toBe("directory");
            expect(await store.classifyProject(ANCHOR), name).toBe(name === "writeJson" ? "project" : "no_project");
          } finally {
            await purge(projectId);
          }
        }
      });

      it("lists a staged write under results/.staging and not under results/", () =>
        withProject(async ({ projectId, store }) => {
          await store.writeJson(ANCHOR, "results/.staging/abc.json", { tool: "record_search" });
          await store.writeJson(ANCHOR, "results/log_001.json", { log_id: "log_001" });
          await store.appendText(ANCHOR, "results/match-scores.jsonl", "{}\n");
          expect((await store.list(ANCHOR, "results/.staging")).map((e) => e.name)).toEqual(["abc.json"]);
          expect((await store.list(ANCHOR, "results")).map((e) => e.name)).toEqual([
            "log_001.json",
            "match-scores.jsonl",
          ]);
          const staged = await backend.pool.query(
            "SELECT staging_id, s3_key FROM staging WHERE project_id = $1",
            [projectId],
          );
          expect(staged.rows).toEqual([
            {
              staging_id: "abc.json",
              s3_key: expect.stringMatching(objectKeyFor(projectId, "results/.staging/abc.json")),
            },
          ]);
          const blobs = await backend.pool.query("SELECT key FROM blobs WHERE project_id = $1 ORDER BY key", [
            projectId,
          ]);
          expect(blobs.rows.map((r) => r.key)).toEqual(["results/log_001.json", "results/match-scores.jsonl"]);
          // Neither table sees the other's rows, and the top-level documents are
          // in neither.
          const docs = await backend.pool.query("SELECT name FROM documents WHERE project_id = $1", [
            projectId,
          ]);
          expect(docs.rows).toEqual([]);
        }));

      it("lists documents and blobs together under a directory outside the blob roots", () =>
        withProject(async ({ store }) => {
          const before = Date.now() - 1000;
          await store.writeJson(ANCHOR, "evaluations/e1.json", { verdict: "pass" });
          await store.writeBytes(ANCHOR, "evaluations/n.txt", new Uint8Array([0x6e]));
          await store.writeJson(ANCHOR, "evaluations/nested/deeper.json", {});
          const entries = await store.list(ANCHOR, "evaluations");
          expect(entries.map((e) => e.name)).toEqual(["e1.json", "n.txt"]);
          for (const e of entries) {
            expect(typeof e.mtimeMs, e.name).toBe("number");
            expect(e.mtimeMs, e.name).toBeGreaterThanOrEqual(before);
          }
          expect((await store.list(ANCHOR, "evaluations/nested")).map((e) => e.name)).toEqual(["deeper.json"]);
        }));

      it("stores a blob's bytes, size and sha256 and reads them back", () =>
        withProject(async ({ projectId, store }) => {
          const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00]);
          await store.writeBytes(ANCHOR, "images/scan.jpg", bytes);
          const row = await blobRow(projectId, "images/scan.jpg");
          expect(row).toEqual({
            s3_key: expect.stringMatching(objectKeyFor(projectId, "images/scan.jpg")),
            bytes: 5,
            sha256: sha256(bytes),
          });
          expect(Array.from(await readBytes(store, "images/scan.jpg"))).toEqual(Array.from(bytes));
          const head = await backend.s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: row.s3_key }));
          expect(head.ContentLength).toBe(5);
        }));

      it("replaces the previous object on a rewrite and deletes it once the row points elsewhere", () =>
        withProject(async ({ projectId, store }) => {
          await store.writeBytes(ANCHOR, "images/scan.jpg", new Uint8Array([1, 2, 3]));
          const first = await blobRow(projectId, "images/scan.jpg");
          await store.writeBytes(ANCHOR, "images/scan.jpg", new Uint8Array([4, 5]));
          const second = await blobRow(projectId, "images/scan.jpg");
          expect(second.s3_key).not.toBe(first.s3_key);
          expect(second).toMatchObject({ bytes: 2, sha256: sha256(new Uint8Array([4, 5])) });
          // Exactly one object under the ref: the old one is gone, not orphaned.
          expect(await keysUnder(`${projectId}/images/scan.jpg/`)).toEqual([second.s3_key]);
          await expectObjectGone(first.s3_key);
          await store.appendText(ANCHOR, "results/match-scores.jsonl", "a\n");
          await store.appendText(ANCHOR, "results/match-scores.jsonl", "b\n");
          expect(await store.readText(ANCHOR, "results/match-scores.jsonl")).toBe("a\nb\n");
          expect(await keysUnder(`${projectId}/results/match-scores.jsonl/`)).toHaveLength(1);
        }));

      it("keeps a blob's committed bytes and hash when a rewrite inside a throwing body rolls back", () =>
        withProject(async ({ projectId, store }) => {
          await store.writeJson(ANCHOR, "results/log_1.json", { v: "old" });
          const before = await blobRow(projectId, "results/log_1.json");
          await expect(
            store.withTransaction(ANCHOR, async () => {
              await store.writeJson(ANCHOR, "results/log_1.json", { v: "NEW-UNCOMMITTED" });
              // Visible to the body's own connection…
              expect(JSON.parse(await store.readText(ANCHOR, "results/log_1.json"))).toEqual({ v: "NEW-UNCOMMITTED" });
              throw new Error("boom");
            }),
          ).rejects.toThrow("boom");
          // …and gone once the body threw: the bytes, the row, and the hash of
          // the bytes readText serves all agree with the committed write.
          const text = await store.readText(ANCHOR, "results/log_1.json");
          expect(JSON.parse(text)).toEqual({ v: "old" });
          const after = await blobRow(projectId, "results/log_1.json");
          expect(after).toEqual(before);
          expect(after.sha256).toBe(sha256(Buffer.from(text, "utf-8")));
          expect(after.bytes).toBe(Buffer.byteLength(text, "utf-8"));
          // The uncommitted object was deleted on rollback; the committed one stands alone.
          expect(await keysUnder(`${projectId}/results/log_1.json/`)).toEqual([before.s3_key]);
        }));

      it("brings a blob back intact when a remove inside a throwing body rolls back", () =>
        withProject(async ({ projectId, store }) => {
          const bytes = new Uint8Array([9, 8, 7]);
          await store.writeBytes(ANCHOR, "images/z.jpg", bytes);
          const before = await blobRow(projectId, "images/z.jpg");
          await expect(
            store.withTransaction(ANCHOR, async () => {
              await store.remove(ANCHOR, "images/z.jpg");
              expect(await store.exists(ANCHOR, "images/z.jpg")).toBe(false);
              throw new Error("boom");
            }),
          ).rejects.toThrow("boom");
          expect(await store.exists(ANCHOR, "images/z.jpg")).toBe(true);
          expect(Array.from(await readBytes(store, "images/z.jpg"))).toEqual(Array.from(bytes));
          expect(await blobRow(projectId, "images/z.jpg")).toEqual(before);
          // And a committed remove does delete the object.
          await store.withTransaction(ANCHOR, () => store.remove(ANCHOR, "images/z.jpg"));
          expect(await store.exists(ANCHOR, "images/z.jpg")).toBe(false);
          await expectObjectGone(before.s3_key);
        }));

      it("keeps two projects' refs apart", () =>
        withProject(async (a) =>
          withProject(async (b) => {
            await a.store.writeJson(ANCHOR, "research.json", { owner: "a" });
            await a.store.writeBytes(ANCHOR, "images/a.jpg", new Uint8Array([1]));
            await a.store.writeJson(ANCHOR, "results/.staging/a.json", {});
            expect(await b.store.exists(ANCHOR, "research.json")).toBe(false);
            expect(await b.store.list(ANCHOR, "images")).toEqual([]);
            expect(await b.store.list(ANCHOR, "results/.staging")).toEqual([]);
            expect(await b.store.classifyProject(ANCHOR)).toBe("no_project");
            await expect(b.store.readText(ANCHOR, "research.json")).rejects.toMatchObject({ code: "ENOENT" });
            await b.store.writeJson(ANCHOR, "research.json", { owner: "b" });
            expect(JSON.parse(await a.store.readText(ANCHOR, "research.json"))).toEqual({ owner: "a" });
            expect(JSON.parse(await b.store.readText(ANCHOR, "research.json"))).toEqual({ owner: "b" });
          }),
        ));

      it("reports a wrong projectPath as missing rather than answering for another project", () =>
        withProject(async ({ store }) => {
          await store.writeJson(ANCHOR, "research.json", {});
          expect(await store.classifyProject(MISSING)).toBe("missing_dir");
          expect(await store.projectDirState(MISSING)).toBe("missing");
          expect(await store.exists(MISSING, "research.json")).toBe(false);
          expect(await store.list(MISSING, "results")).toEqual([]);
          await expect(store.readText(MISSING, "research.json")).rejects.toMatchObject({ code: "ENOENT" });
          await expect(store.writeJson(MISSING, "research.json", {})).rejects.toThrow(/not this store's project/);
          await expect(store.withTransaction(MISSING, async () => 1)).rejects.toThrow(/not this store's project/);
        }));

      it("holds the project's advisory lock for the whole transaction", () =>
        withProject(async ({ projectId, store }) => {
          let releaseBody!: () => void;
          const bodyHeld = new Promise<void>((r) => (releaseBody = r));
          let bodyStarted!: () => void;
          const started = new Promise<void>((r) => (bodyStarted = r));
          const tx = store.withTransaction(ANCHOR, async () => {
            bodyStarted();
            await bodyHeld;
            return "done";
          });
          await started;

          const probe = await backend.pool.connect();
          try {
            await probe.query("BEGIN");
            const during = await probe.query("SELECT pg_try_advisory_xact_lock(hashtext($1)) AS ok", [
              projectId,
            ]);
            expect(during.rows[0].ok).toBe(false);
            await probe.query("ROLLBACK");

            releaseBody();
            expect(await tx).toBe("done");

            await probe.query("BEGIN");
            const after = await probe.query("SELECT pg_try_advisory_xact_lock(hashtext($1)) AS ok", [
              projectId,
            ]);
            expect(after.rows[0].ok).toBe(true);
            await probe.query("ROLLBACK");
          } finally {
            // On a failed assertion the probe may still be mid-transaction (and,
            // if the lock was NOT held, holding it): roll back before the client
            // goes back to the pool, or the next test's autocommit write lands in
            // this open transaction and is never committed. And let the body
            // finish, or `pool.end()` in afterAll waits on it forever.
            await probe.query("ROLLBACK").catch(() => {});
            probe.release();
            releaseBody();
            await tx.catch(() => {});
          }
        }));

      it("rolls back a writeJson made inside a transaction whose body throws", () =>
        withProject(async ({ projectId, store }) => {
          await store.writeJson(ANCHOR, "research.json", { v: "before" });
          await expect(
            store.withTransaction(ANCHOR, async () => {
              await store.writeJson(ANCHOR, "research.json", { v: "inside" });
              await store.writeJson(ANCHOR, "results/.staging/x.json", { staged: true });
              // The write is visible to the body's own connection…
              expect(JSON.parse(await store.readText(ANCHOR, "research.json"))).toEqual({ v: "inside" });
              throw new Error("boom");
            }),
          ).rejects.toThrow("boom");
          // …and gone once the body threw.
          expect(JSON.parse(await store.readText(ANCHOR, "research.json"))).toEqual({ v: "before" });
          expect(await store.exists(ANCHOR, "results/.staging/x.json")).toBe(false);
          const r = await backend.pool.query(
            "SELECT version FROM documents WHERE project_id = $1 AND name = 'research.json'",
            [projectId],
          );
          expect(r.rows[0].version).toBe(1);
          // The staged object the rolled-back body wrote is not left in the bucket.
          expect(await keysUnder(`${projectId}/results/.staging/`)).toEqual([]);
        }));

      it("commits writes made inside a transaction whose body returns", () =>
        withProject(async ({ store }) => {
          await store.withTransaction(ANCHOR, async () => {
            await store.writeJsonBoth(ANCHOR, [
              { ref: "tree.gedcomx.json", data: { tree: 1 } },
              { ref: "research.json", data: { research: 1 } },
            ]);
          });
          expect(await store.classifyProject(ANCHOR)).toBe("project");
          expect(JSON.parse(await store.readText(ANCHOR, "tree.gedcomx.json"))).toEqual({ tree: 1 });
        }));

      it("writeJsonBoth inside a body that throws writes neither", () =>
        withProject(async ({ projectId, store }) => {
          await store.writeJson(ANCHOR, "tree.gedcomx.json", { tree: "old" });
          await store.writeJson(ANCHOR, "research.json", { research: "old" });
          await expect(
            store.withTransaction(ANCHOR, async () => {
              await store.writeJsonBoth(ANCHOR, [
                { ref: "tree.gedcomx.json", data: { tree: "new" } },
                { ref: "research.json", data: { research: "new" } },
              ]);
              throw new Error("boom");
            }),
          ).rejects.toThrow("boom");
          expect(JSON.parse(await store.readText(ANCHOR, "tree.gedcomx.json"))).toEqual({ tree: "old" });
          expect(JSON.parse(await store.readText(ANCHOR, "research.json"))).toEqual({ research: "old" });
          const r = await backend.pool.query(
            "SELECT name, version FROM documents WHERE project_id = $1 ORDER BY name",
            [projectId],
          );
          expect(r.rows).toEqual([
            { name: "research.json", version: 1 },
            { name: "tree.gedcomx.json", version: 1 },
          ]);
        }));

      it("writeJsonBoth whose second upsert fails in Postgres writes neither", () =>
        withProject(async ({ projectId, store }) => {
          await store.writeJson(ANCHOR, "tree.gedcomx.json", { tree: "old2" });
          // Serialises fine; jsonb rejects the NUL at INSERT time, after the
          // first upsert has already run.
          await expect(
            store.writeJsonBoth(ANCHOR, [
              { ref: "tree.gedcomx.json", data: { tree: "new2" } },
              { ref: "research.json", data: { s: "a\u0000b" } },
            ]),
          ).rejects.toThrow(/Unicode escape/);
          const r = await backend.pool.query(
            "SELECT name, version, doc FROM documents WHERE project_id = $1 ORDER BY name",
            [projectId],
          );
          expect(r.rows).toEqual([{ name: "tree.gedcomx.json", version: 1, doc: { tree: "old2" } }]);
        }));

      it("writeJsonBoth with an unserialisable second value writes neither", () =>
        withProject(async ({ projectId, store }) => {
          await store.writeJson(ANCHOR, "tree.gedcomx.json", { tree: "old" });
          const circular: any = {};
          circular.self = circular;
          await expect(
            store.writeJsonBoth(ANCHOR, [
              { ref: "tree.gedcomx.json", data: { tree: "new" } },
              { ref: "research.json", data: circular },
            ]),
          ).rejects.toThrow();
          const r = await backend.pool.query(
            "SELECT name, version, doc FROM documents WHERE project_id = $1 ORDER BY name",
            [projectId],
          );
          expect(r.rows).toEqual([{ name: "tree.gedcomx.json", version: 1, doc: { tree: "old" } }]);
        }));

      it("removes the object with its index row and tolerates an absent one", () =>
        withProject(async ({ projectId, store }) => {
          await store.writeJson(ANCHOR, "results/.staging/x.json", {});
          const r = await backend.pool.query(
            "SELECT s3_key FROM staging WHERE project_id = $1 AND staging_id = 'x.json'",
            [projectId],
          );
          const key: string = r.rows[0].s3_key;
          await backend.s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
          await store.remove(ANCHOR, "results/.staging/x.json");
          await expectObjectGone(key);
          expect(await keysUnder(`${projectId}/`)).toEqual([]);
          await store.remove(ANCHOR, "results/.staging/x.json");
          await store.remove(ANCHOR, "images/never.jpg");
          await store.remove(ANCHOR, "research.json");
        }));
    });
  });
}

// PgS3ProjectStore — the second ProjectStore backend: project documents in
// Postgres jsonb, blobs and staged search results in S3 with a Postgres index,
// one project per store instance. Built for the hosted search-agent path, where
// every worker's cwd is the same string and `projectPath` therefore cannot
// identify a project: the store is constructed for ONE project (`projectId`,
// `anchorPath`) and treats the `projectPath` every method receives as a check
// against that anchor, never as a key. Nothing here imports `fs`.
//
// Routing by ref (project-relative POSIX path, validated by `assertRelativeRef`
// before anything else):
//   results/.staging/<name>            → the `staging` table + an S3 object
//   results/**, images/**, uploads/**,
//   and any ref not ending in .json    → the `blobs` table + an S3 object
//   every other *.json ref             → the `documents` table (jsonb)
// A document's `readText` is `JSON.stringify(doc, null, 2)` — jsonb keeps
// neither key order nor whitespace, so the bytes are not the bytes written.
//
// `withTransaction` is one pool connection holding `pg_advisory_xact_lock` on
// the project id for the whole callback; every store method called inside the
// callback runs on that connection (bound through an AsyncLocalStorage), so a
// throw rolls back every index write the body made — and so does the store's
// `signal` aborting before COMMIT (the HTTP server's client went away).
//
// S3 objects are immutable per write. Every write puts a NEW object under
// `<projectId>/<ref>/<uuid>` and points the index row at it; the object the row
// pointed at before is deleted only once the row change is durable — after
// COMMIT inside a transaction, right after the upsert outside one — and a
// ROLLBACK deletes the new objects instead. A rewrite or remove inside a body
// that throws therefore leaves the ref's bytes, size and hash exactly as they
// were; a reader never sees content that was not committed. The one residual
// is an orphan object after a crash between PutObject and the row write, or
// between COMMIT and the delete; nothing references it and nothing sweeps it.
//
// `projectId` is the S3 key prefix, so it is restricted to `[A-Za-z0-9._-]`
// with a leading letter or digit: a `/` would let two projects share a key.
//
// A `blobs`/`staging` row's `created_at` is set to the write time on every
// rewrite, which is what `list` reports as `mtimeMs` — the same "last write"
// clock the TTL sweeps compare against on the file backend.
//
// Neither client waits on a stalled host forever: `CONNECT_TIMEOUT_MS` bounds a
// Postgres connection (and a wait for a free pool slot) and an S3 TCP connect;
// `S3_REQUEST_TIMEOUT_MS` bounds one S3 request end to end, body included.

import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import pg from "pg";
import type { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { AsyncMutex } from "./async-mutex.js";
import { assertRelativeRef } from "./paths.js";
import { PROJECT_ID_RE } from "./project-id.js";
import type {
  JsonWrite,
  ProjectDirState,
  ProjectEntry,
  ProjectPathClass,
  ProjectStore,
  WriteJsonBothOptions,
} from "./project-store.js";

/** How long a Postgres connect, a wait for a free pool connection, or an S3 TCP
 *  connect may take before the call rejects instead of hanging. */
export const CONNECT_TIMEOUT_MS = 10_000;
/** How long one S3 request (headers and body, a multi-MB scan included) may
 *  take end to end. */
export const S3_REQUEST_TIMEOUT_MS = 90_000;

// ─── Backend: the shared connections ─────────────────────────────────────────

export interface PgS3BackendOptions {
  /** Postgres connection string, e.g. `postgresql://postgres:proto@localhost:5434/proto`. */
  dsn: string;
  s3: {
    endpoint: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    /** The SDK insists on one even for MinIO; defaults to `us-east-1`. */
    region?: string;
    /** `true` for MinIO and every other endpoint that is not AWS's own. */
    forcePathStyle: boolean;
  };
  /** Override the module's timeout constants (tests point them at a silent
   *  socket with a few hundred ms). */
  timeouts?: {
    connectMs?: number;
    s3RequestMs?: number;
  };
}

/** The minimum of `pg.Pool` / `pg.PoolClient` a store method needs, so one
 *  body runs unchanged on the autocommit pool or on a transaction's client. */
interface Queryable {
  query<R extends QueryResultRow = any>(text: string, values?: unknown[]): Promise<QueryResult<R>>;
}

/** One open transaction for one project: its connection and the S3 keys whose
 *  fate depends on how it ends. */
interface TxContext {
  client: PoolClient;
  /** Objects the transaction's rows no longer point at (replaced or removed):
   *  deleted after COMMIT, kept on ROLLBACK because the rows come back. */
  deleteOnCommit: string[];
  /** Objects written by this transaction: kept after COMMIT, deleted on
   *  ROLLBACK because no row points at them any more. */
  deleteOnRollback: string[];
}

/**
 * One pg pool, one S3 client and one bucket, shared by every store instance in
 * the process. Also carries the transaction context: which project ids the
 * current async execution holds a transaction for, and on which client.
 */
export class PgS3Backend {
  /** The per-execution map from project id to its open transaction. Read by
   *  every store method to pick its connection. */
  readonly transactions = new AsyncLocalStorage<ReadonlyMap<string, TxContext>>();

  // One in-process queue per project id, never evicted (a queued caller still
  // holds a reference). It orders same-process writer bodies by arrival and
  // keeps all but one of them off the pool while they wait for the advisory
  // lock, which is what stops N queued writers from draining N connections.
  private readonly queues = new Map<string, AsyncMutex>();

  constructor(
    readonly pool: Pool,
    readonly s3: S3Client,
    readonly bucket: string,
  ) {}

  queue(projectId: string): AsyncMutex {
    let mutex = this.queues.get(projectId);
    if (!mutex) {
      mutex = new AsyncMutex();
      this.queues.set(projectId, mutex);
    }
    return mutex;
  }

  /** Delete objects nothing references any more. Best-effort: a failure here
   *  leaves an orphan, never a wrong read, so it is not surfaced. */
  async deleteObjects(keys: readonly string[]): Promise<void> {
    for (const key of keys) {
      await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key })).catch(() => {});
    }
  }

  /** Drain the pool and drop the S3 client. Call once, when the process is done. */
  async close(): Promise<void> {
    await this.pool.end();
    this.s3.destroy();
  }
}

/** Build a backend from connection options. Neither client connects until first use. */
export function createPgS3Backend(options: PgS3BackendOptions): PgS3Backend {
  const connectMs = options.timeouts?.connectMs ?? CONNECT_TIMEOUT_MS;
  const s3RequestMs = options.timeouts?.s3RequestMs ?? S3_REQUEST_TIMEOUT_MS;
  const pool = new pg.Pool({ connectionString: options.dsn, connectionTimeoutMillis: connectMs });
  const s3 = new S3Client({
    endpoint: options.s3.endpoint,
    region: options.s3.region ?? "us-east-1",
    credentials: {
      accessKeyId: options.s3.accessKeyId,
      secretAccessKey: options.s3.secretAccessKey,
    },
    forcePathStyle: options.s3.forcePathStyle,
    // Only the checksums the S3 API itself mandates: the SDK's default
    // opportunistic CRC trailers are an AWS-only feature that S3-compatible
    // stores reject or ignore.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    // `requestTimeout` on its own only logs a warning when it fires; the flag
    // is what turns it into a rejection.
    requestHandler: new NodeHttpHandler({
      connectionTimeout: connectMs,
      requestTimeout: s3RequestMs,
      throwOnRequestTimeout: true,
    }),
  });
  return new PgS3Backend(pool, s3, options.s3.bucket);
}

// ─── Ref routing ─────────────────────────────────────────────────────────────

const STAGING_DIR = "results/.staging";
const STAGING_PREFIX = `${STAGING_DIR}/`;
const BLOB_DIRS = new Set(["results", "images", "uploads"]);

type Route =
  | { kind: "staging"; stagingId: string }
  | { kind: "blob" }
  | { kind: "document" };

function routeRef(ref: string): Route {
  if (ref.startsWith(STAGING_PREFIX)) {
    return { kind: "staging", stagingId: ref.slice(STAGING_PREFIX.length) };
  }
  const top = ref.slice(0, ref.indexOf("/") === -1 ? ref.length : ref.indexOf("/"));
  if (BLOB_DIRS.has(top) || !ref.endsWith(".json")) return { kind: "blob" };
  return { kind: "document" };
}

/** Which table(s) a directory listing reads. `mixed` is a directory outside the
 *  blob roots (`evaluations/`), where documents and non-JSON blobs can sit together. */
function routeDir(dirRef: string): "staging" | "blob" | "mixed" {
  if (dirRef === STAGING_DIR || dirRef.startsWith(STAGING_PREFIX)) return "staging";
  const top = dirRef.slice(0, dirRef.indexOf("/") === -1 ? dirRef.length : dirRef.indexOf("/"));
  return BLOB_DIRS.has(top) ? "blob" : "mixed";
}

/** Serialize to the same pretty form the file backend writes. */
function serialize(data: unknown): string {
  const text = JSON.stringify(data, null, 2);
  if (text === undefined) {
    throw new TypeError("cannot store a value with no JSON form (undefined, a function, or a symbol)");
  }
  return text;
}

/** An absent ref, with the `.code` callers classify by (sidecar_read → not_found). */
function enoent(projectId: string, ref: string): NodeJS.ErrnoException {
  const e: NodeJS.ErrnoException = new Error(`'${ref}' does not exist in project ${projectId}`);
  e.code = "ENOENT";
  return e;
}

function isS3Missing(e: unknown): boolean {
  const err = e as { name?: string; $metadata?: { httpStatusCode?: number } };
  return err?.name === "NoSuchKey" || err?.name === "NotFound" || err?.$metadata?.httpStatusCode === 404;
}

/** SQL for the direct children of a prefix: rows whose key starts with $2 and
 *  whose remainder holds no further `/`. `left(c, 0) = ''` is true, so an
 *  empty prefix lists a table's top level. `tsColumn` is the table's write-time
 *  column (`documents` has `updated_at`, the two index tables `created_at`). */
function directChildrenSql(
  table: "documents" | "blobs" | "staging",
  column: string,
  tsColumn: "created_at" | "updated_at",
): string {
  return (
    `SELECT substr(${column}, length($2) + 1) AS name, ` +
    `(extract(epoch FROM ${tsColumn}) * 1000)::float8 AS mtime_ms ` +
    `FROM ${table} WHERE project_id = $1 AND left(${column}, length($2)) = $2 ` +
    `AND position('/' IN substr(${column}, length($2) + 1)) = 0`
  );
}

// ─── The store ───────────────────────────────────────────────────────────────

export interface PgS3ProjectStoreOptions {
  /** The `projects.project_id` this store reads and writes. */
  projectId: string;
  /** The one `projectPath` string the tools pass for this project; every
   *  other value is "missing_dir". */
  anchorPath: string;
  /** Aborted when the caller that bound this store is gone (the HTTP server's
   *  client disconnected). A transaction still open then ROLLS BACK instead of
   *  committing, so a write whose result nobody can receive never lands. */
  signal?: AbortSignal;
}

export class PgS3ProjectStore implements ProjectStore {
  readonly projectId: string;
  readonly anchorPath: string;
  private readonly signal: AbortSignal | undefined;

  constructor(
    private readonly backend: PgS3Backend,
    options: PgS3ProjectStoreOptions,
  ) {
    if (typeof options.projectId !== "string" || !PROJECT_ID_RE.test(options.projectId)) {
      throw new Error(
        `projectId '${String(options.projectId)}' must match [A-Za-z0-9][A-Za-z0-9._-]* ` +
          `(it is an S3 key prefix; a '/' would let two projects share a key)`,
      );
    }
    this.projectId = options.projectId;
    this.anchorPath = options.anchorPath;
    this.signal = options.signal;
  }

  // ── scope and connection ─────────────────────────────────────────────────

  private isAnchor(projectPath: unknown): boolean {
    return typeof projectPath === "string" && projectPath === this.anchorPath;
  }

  /** For writes and the transaction: a wrong projectPath is an error, never a
   *  silent write somewhere else. */
  private assertAnchor(projectPath: unknown): void {
    if (!this.isAnchor(projectPath)) {
      throw new Error(
        `projectPath '${String(projectPath)}' is not this store's project (${this.anchorPath})`,
      );
    }
  }

  /** This project's open transaction, if the current execution is inside one
   *  (`withTransaction`, or `writeJsonBoth`'s own); otherwise `null`. */
  private tx(): TxContext | null {
    return this.backend.transactions.getStore()?.get(this.projectId) ?? null;
  }

  private db(): Queryable {
    return this.tx()?.client ?? this.backend.pool;
  }

  /** A fresh key for one write; no two writes ever share an object. */
  private newS3Key(ref: string): string {
    return `${this.projectId}/${ref}/${randomUUID()}`;
  }

  /**
   * BEGIN, run `fn` with this project's transaction bound for every store
   * method it calls, COMMIT — or ROLLBACK when `fn` or COMMIT throws, or when
   * the store's `signal` aborted while `fn` ran. Then the
   * S3 side: after a commit the objects the rows stopped pointing at go, after
   * a rollback the objects this transaction wrote go.
   */
  private async runTransaction<T>(fn: () => Promise<T>, lock: boolean): Promise<T> {
    const held = this.backend.transactions.getStore();
    const client = await this.backend.pool.connect();
    const ctx: TxContext = { client, deleteOnCommit: [], deleteOnRollback: [] };
    let broken: Error | undefined;
    let committed = false;
    try {
      await client.query("BEGIN");
      if (lock) await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [this.projectId]);
      const next = new Map(held);
      next.set(this.projectId, ctx);
      const result = await this.backend.transactions.run(next, fn);
      if (this.signal?.aborted) {
        throw new Error(
          `project '${this.projectId}': the caller disconnected before this write committed, ` +
            `so it was rolled back`,
        );
      }
      await client.query("COMMIT");
      committed = true;
      return result;
    } catch (e) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        // The connection itself is gone; hand it back to be destroyed. The
        // server discards the transaction with the connection.
        broken = rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError));
      }
      throw e;
    } finally {
      client.release(broken);
      await this.backend.deleteObjects(committed ? ctx.deleteOnCommit : ctx.deleteOnRollback);
    }
  }

  // ── ProjectStore ─────────────────────────────────────────────────────────

  async withTransaction<T>(projectPath: string, fn: () => Promise<T>): Promise<T> {
    this.assertAnchor(projectPath);
    if (this.tx()) {
      throw new Error(
        `withProjectLock re-entered for project '${this.projectId}': a locked writer called ` +
          `another locked writer for the same project. The transaction is not reentrant and ` +
          `this would deadlock — lock only the outermost writer (see project-io.ts §1715).`,
      );
    }
    return this.backend.queue(this.projectId).run(() => this.runTransaction(fn, true));
  }

  async classifyProject(projectPath: unknown): Promise<ProjectPathClass> {
    if (typeof projectPath !== "string" || projectPath.trim() === "") return "missing_arg";
    if (!this.isAnchor(projectPath)) return "missing_dir";
    const db = this.db();
    const row = await db.query("SELECT 1 FROM projects WHERE project_id = $1", [this.projectId]);
    if (row.rowCount === 0) return "missing_dir";
    const docs = await db.query(
      "SELECT 1 FROM documents WHERE project_id = $1 AND name IN ('research.json', 'tree.gedcomx.json') LIMIT 1",
      [this.projectId],
    );
    return docs.rowCount === 0 ? "no_project" : "project";
  }

  async projectDirState(projectPath: string): Promise<ProjectDirState> {
    if (!this.isAnchor(projectPath)) return "missing";
    const row = await this.db().query("SELECT 1 FROM projects WHERE project_id = $1", [this.projectId]);
    return row.rowCount === 0 ? "missing" : "directory";
  }

  /** Rows do not nest. */
  async findNestingAncestor(_projectPath: string): Promise<string | null> {
    return null;
  }

  async exists(projectPath: string, ref: string): Promise<boolean> {
    if (!this.isAnchor(projectPath)) return false;
    let rel: string;
    try {
      rel = assertRelativeRef(ref);
    } catch {
      return false;
    }
    return (await this.indexRow(rel)) !== null;
  }

  async readText(projectPath: string, ref: string): Promise<string> {
    const loaded = await this.load(projectPath, ref);
    return typeof loaded === "string" ? loaded : Buffer.from(loaded).toString("utf-8");
  }

  async readBytes(projectPath: string, ref: string): Promise<Uint8Array> {
    const loaded = await this.load(projectPath, ref);
    return typeof loaded === "string" ? new Uint8Array(Buffer.from(loaded, "utf-8")) : loaded;
  }

  /** A document as its pretty text; a blob or staged object as its bytes. */
  private async load(projectPath: string, ref: string): Promise<string | Uint8Array> {
    const rel = assertRelativeRef(ref);
    if (!this.isAnchor(projectPath)) throw enoent(this.projectId, rel);
    const route = routeRef(rel);
    if (route.kind === "document") {
      const r = await this.db().query("SELECT doc FROM documents WHERE project_id = $1 AND name = $2", [
        this.projectId,
        rel,
      ]);
      if (r.rowCount === 0) throw enoent(this.projectId, rel);
      return JSON.stringify(r.rows[0].doc, null, 2);
    }
    const row = await this.indexRow(rel);
    if (!row) throw enoent(this.projectId, rel);
    return this.getObject(row.s3_key, rel);
  }

  async list(projectPath: string, dirRef: string): Promise<ProjectEntry[]> {
    const dir = assertRelativeRef(dirRef);
    if (!this.isAnchor(projectPath)) return [];
    const db = this.db();
    const entries: ProjectEntry[] = [];
    const push = (r: QueryResult<{ name: string; mtime_ms: number }>) => {
      for (const row of r.rows) entries.push({ name: row.name, mtimeMs: row.mtime_ms });
    };
    switch (routeDir(dir)) {
      case "staging": {
        const prefix = dir === STAGING_DIR ? "" : `${dir.slice(STAGING_PREFIX.length)}/`;
        push(await db.query(directChildrenSql("staging", "staging_id", "created_at"), [this.projectId, prefix]));
        break;
      }
      case "blob":
        push(await db.query(directChildrenSql("blobs", "key", "created_at"), [this.projectId, `${dir}/`]));
        break;
      case "mixed":
        push(await db.query(directChildrenSql("documents", "name", "updated_at"), [this.projectId, `${dir}/`]));
        push(await db.query(directChildrenSql("blobs", "key", "created_at"), [this.projectId, `${dir}/`]));
        break;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return entries;
  }

  async writeJson(projectPath: string, ref: string, data: unknown): Promise<void> {
    this.assertAnchor(projectPath);
    const rel = assertRelativeRef(ref);
    const text = serialize(data);
    await this.touchProject();
    await this.putSerialized(rel, text);
  }

  /**
   * Every write in ONE transaction: the bound one when called inside
   * `withTransaction`, otherwise a transaction of its own. Every value is
   * serialized before the first write, so an unserialisable one writes nothing.
   * The file backend's `onBeforeSecondRename` seam has no rename to sit between
   * here and is ignored.
   */
  async writeJsonBoth(
    projectPath: string,
    writes: JsonWrite[],
    _options?: WriteJsonBothOptions,
  ): Promise<void> {
    this.assertAnchor(projectPath);
    const prepared = writes.map((w) => ({ ref: assertRelativeRef(w.ref), text: serialize(w.data) }));
    const run = async () => {
      await this.touchProject();
      for (const p of prepared) await this.putSerialized(p.ref, p.text);
    };
    if (this.tx()) {
      await run();
      return;
    }
    await this.runTransaction(run, false);
  }

  async writeBytes(projectPath: string, ref: string, bytes: Uint8Array): Promise<void> {
    this.assertAnchor(projectPath);
    const rel = assertRelativeRef(ref);
    const route = routeRef(rel);
    if (route.kind === "document") {
      throw new Error(`'${rel}' is a JSON document; write it with writeJson, not writeBytes`);
    }
    await this.touchProject();
    await this.putObjectIndexed(rel, route, bytes);
  }

  /** Read-modify-write of the object; the index row's size and hash follow. */
  async appendText(projectPath: string, ref: string, text: string): Promise<void> {
    this.assertAnchor(projectPath);
    const rel = assertRelativeRef(ref);
    const route = routeRef(rel);
    if (route.kind === "document") {
      throw new Error(`'${rel}' is a JSON document; appendText is for blobs`);
    }
    // A read-modify-write: two overlapping appends keep one unless they are
    // serialised, and rank_search_matches appends its score log with no lock
    // of its own. Outside a transaction this takes the project's queue and
    // advisory lock the way withTransaction does — the file backend's
    // appendFile is atomic per call, so the conformance suite's concurrent
    // append case holds on both. Inside a caller's transaction the caller's
    // lock already serialises it.
    const body = async (): Promise<void> => {
      await this.touchProject();
      const existing = await this.indexRow(rel);
      const head = existing ? await this.getObject(existing.s3_key, rel) : new Uint8Array();
      await this.putObjectIndexed(rel, route, Buffer.concat([head, Buffer.from(text, "utf-8")]));
    };
    if (this.tx()) return body();
    await this.backend.queue(this.projectId).run(() => this.runTransaction(body, true));
  }

  /** The index row goes first (so a reader never sees a row whose object is
   *  gone), then the object — after COMMIT when inside a transaction, so a
   *  rollback brings the ref back intact. An absent ref is not an error. */
  async remove(projectPath: string, ref: string): Promise<void> {
    const rel = assertRelativeRef(ref);
    if (!this.isAnchor(projectPath)) return;
    const db = this.db();
    const route = routeRef(rel);
    if (route.kind === "document") {
      await db.query("DELETE FROM documents WHERE project_id = $1 AND name = $2", [this.projectId, rel]);
      return;
    }
    const deleted =
      route.kind === "staging"
        ? await db.query<{ s3_key: string }>(
            "DELETE FROM staging WHERE project_id = $1 AND staging_id = $2 RETURNING s3_key",
            [this.projectId, route.stagingId],
          )
        : await db.query<{ s3_key: string }>(
            "DELETE FROM blobs WHERE project_id = $1 AND key = $2 RETURNING s3_key",
            [this.projectId, rel],
          );
    await this.releaseObjects(deleted.rows.map((r) => r.s3_key));
  }

  // ── internals ────────────────────────────────────────────────────────────

  /** Every write upserts the projects row, so a project exists from its first write. */
  private async touchProject(): Promise<void> {
    await this.db().query(
      "INSERT INTO projects (project_id) VALUES ($1) ON CONFLICT (project_id) DO NOTHING",
      [this.projectId],
    );
  }

  /** Objects the index no longer points at: gone now outside a transaction,
   *  after COMMIT inside one (a rollback would bring their rows back). */
  private async releaseObjects(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    const ctx = this.tx();
    if (ctx) ctx.deleteOnCommit.push(...keys);
    else await this.backend.deleteObjects(keys);
  }

  /** The index row behind a blob or staged ref, or `null` — and `null` for a
   *  document ref only when no document of that name exists (documents have
   *  no S3 key; `s3_key` is empty for them). */
  private async indexRow(rel: string): Promise<{ s3_key: string } | null> {
    const db = this.db();
    const route = routeRef(rel);
    let r: QueryResult<{ s3_key: string }>;
    switch (route.kind) {
      case "document":
        r = await db.query("SELECT '' AS s3_key FROM documents WHERE project_id = $1 AND name = $2", [
          this.projectId,
          rel,
        ]);
        break;
      case "staging":
        r = await db.query("SELECT s3_key FROM staging WHERE project_id = $1 AND staging_id = $2", [
          this.projectId,
          route.stagingId,
        ]);
        break;
      case "blob":
        r = await db.query("SELECT s3_key FROM blobs WHERE project_id = $1 AND key = $2", [
          this.projectId,
          rel,
        ]);
        break;
    }
    return r.rowCount === 0 ? null : r.rows[0];
  }

  private async getObject(s3Key: string, rel: string): Promise<Uint8Array> {
    let res;
    try {
      res = await this.backend.s3.send(new GetObjectCommand({ Bucket: this.backend.bucket, Key: s3Key }));
    } catch (e) {
      // The index said it exists and the bucket says it does not: an absent ref
      // by any reading the callers make (`.code === "ENOENT"`).
      if (isS3Missing(e)) throw enoent(this.projectId, rel);
      throw e;
    }
    return res.Body ? res.Body.transformToByteArray() : new Uint8Array();
  }

  /** Route already-serialized JSON text: a document row, or a staged/blob object. */
  private async putSerialized(rel: string, text: string): Promise<void> {
    const route = routeRef(rel);
    if (route.kind === "document") {
      await this.db().query(
        "INSERT INTO documents (project_id, name, version, doc, updated_at) " +
          "VALUES ($1, $2, 1, $3::jsonb, to_timestamp($4)) " +
          "ON CONFLICT (project_id, name) DO UPDATE SET doc = EXCLUDED.doc, " +
          "version = documents.version + 1, updated_at = EXCLUDED.updated_at",
        [this.projectId, rel, text, Date.now() / 1000],
      );
      return;
    }
    await this.putObjectIndexed(rel, route, Buffer.from(text, "utf-8"));
  }

  /**
   * Put a new object, then point the index row (staging or blobs) at it; the
   * upsert returns the key the row held before, which is released. Object
   * first: a row is only ever visible once its bytes are readable. A failed
   * upsert deletes the new object again, so nothing is left behind.
   */
  private async putObjectIndexed(
    rel: string,
    route: Exclude<Route, { kind: "document" }>,
    bytes: Uint8Array,
  ): Promise<void> {
    const s3Key = this.newS3Key(rel);
    await this.backend.s3.send(
      new PutObjectCommand({ Bucket: this.backend.bucket, Key: s3Key, Body: bytes }),
    );
    const now = Date.now() / 1000;
    let previous: QueryResult<{ prev_s3_key: string | null }>;
    try {
      // The CTE reads the row as it was before this statement (one statement,
      // one snapshot), so `prev_s3_key` is the object the row used to point at
      // — or NULL when the ref is new.
      previous =
        route.kind === "staging"
          ? await this.db().query(
              "WITH prev AS (SELECT s3_key FROM staging WHERE project_id = $1 AND staging_id = $2) " +
                "INSERT INTO staging (project_id, staging_id, s3_key, created_at) " +
                "VALUES ($1, $2, $3, to_timestamp($4)) " +
                "ON CONFLICT (project_id, staging_id) DO UPDATE SET s3_key = EXCLUDED.s3_key, " +
                "created_at = EXCLUDED.created_at " +
                "RETURNING (SELECT s3_key FROM prev) AS prev_s3_key",
              [this.projectId, route.stagingId, s3Key, now],
            )
          : await this.db().query(
              "WITH prev AS (SELECT s3_key FROM blobs WHERE project_id = $1 AND key = $2) " +
                "INSERT INTO blobs (project_id, key, s3_key, bytes, sha256, created_at) " +
                "VALUES ($1, $2, $3, $4, $5, to_timestamp($6)) " +
                "ON CONFLICT (project_id, key) DO UPDATE SET s3_key = EXCLUDED.s3_key, " +
                "bytes = EXCLUDED.bytes, sha256 = EXCLUDED.sha256, created_at = EXCLUDED.created_at " +
                "RETURNING (SELECT s3_key FROM prev) AS prev_s3_key",
              [this.projectId, rel, s3Key, bytes.byteLength, createHash("sha256").update(bytes).digest("hex"), now],
            );
    } catch (e) {
      await this.backend.deleteObjects([s3Key]);
      throw e;
    }
    const ctx = this.tx();
    if (ctx) ctx.deleteOnRollback.push(s3Key);
    const prevKey = previous.rows[0]?.prev_s3_key;
    if (prevKey && prevKey !== s3Key) await this.releaseObjects([prevKey]);
  }
}

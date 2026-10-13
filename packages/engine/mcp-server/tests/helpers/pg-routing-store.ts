import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { lstat, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { AsyncMutex } from "../../src/store/async-mutex.js";
import { PgS3ProjectStore, routeRef, type PgS3Backend } from "../../src/store/pg-s3-project-store.js";
import type {
  JsonWrite,
  ProjectDirState,
  ProjectEntry,
  ProjectPathClass,
  ProjectStore,
  WriteJsonBothOptions,
} from "../../src/store/project-store.js";

/**
 * The store the engine suites run on under `PROTO_STORE=pg` (U15): every tool
 * read and write goes through a real `PgS3ProjectStore`, while the tests keep
 * seeding and asserting on their `mkdtemp` directory with `node:fs`.
 *
 * Each distinct project directory (keyed by realpath, so aliases share one
 * project and one lock) gets its own Postgres project id, and each `projectPath`
 * spelling its own `PgS3ProjectStore` anchored at that exact string. Around
 * every call the directory and the project are reconciled:
 *
 * - **in**, before the call: files the test added, changed or deleted since the
 *   last reconcile are written to (or removed from) the project. A document ref
 *   goes in through `writeJson`, so a test that seeds invalid JSON there fails —
 *   the hosted store cannot hold one.
 * - **out**, after a write (after the whole body for `withTransaction`): the
 *   project is the truth, and the directory is rewritten to match it. A
 *   rolled-back transaction therefore reverts the directory too, and a test's
 *   disk assertion reads what Postgres holds, not what the tool tried to write.
 *
 * Symlinks are never followed or imported. An existing directory with no files
 * is a `projects` row with no documents (`no_project`), as on disk.
 */

/** Key order and whitespace are not a difference: jsonb keeps neither, so a
 *  document whose value did not change leaves the test's bytes alone. */
function sameDocument(ref: string, a: Buffer, b: Buffer): boolean {
  if (routeRef(ref).kind !== "document") return false;
  try {
    return canonical(JSON.parse(a.toString("utf-8"))) === canonical(JSON.parse(b.toString("utf-8")));
  } catch {
    return false;
  }
}

function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

interface DiskFile {
  sig: string;
  mtimeMs: number;
}

function signatures(files: Map<string, DiskFile>): Map<string, string> {
  return new Map([...files].map(([ref, f]) => [ref, f.sig]));
}

interface Tracked {
  projectId: string;
  /** relative path → stat signature, as of the last reconcile. */
  files: Map<string, string>;
  stores: Map<string, PgS3ProjectStore>;
  sync: AsyncMutex;
}

export class PgRoutingStore implements ProjectStore {
  private readonly projects = new Map<string, Tracked>();
  /** The projectIds whose transaction the current execution is inside. */
  private readonly inTx = new AsyncLocalStorage<ReadonlySet<string>>();
  /** For the store-inaccessible values (non-strings, blank): never matches. */
  private readonly nowhere: PgS3ProjectStore;
  /** Calls answered, for the run's guard: a router nobody called proves nothing. */
  calls = 0;

  constructor(private readonly backend: PgS3Backend) {
    this.nowhere = new PgS3ProjectStore(backend, { projectId: "u15-nowhere", anchorPath: "\0" });
  }

  // ── routing ──────────────────────────────────────────────────────────────

  // Synchronous, as the file store's lock key is: an awaited realpath lets two
  // calls overtake each other before they queue, losing arrival order.
  private key(projectPath: string): string {
    const abs = resolve(projectPath);
    try {
      return realpathSync.native(abs);
    } catch {
      return abs;
    }
  }

  private tracked(projectPath: string): { t: Tracked; dir: string } {
    const dir = this.key(projectPath);
    let t = this.projects.get(dir);
    if (!t) {
      t = { projectId: `u15-${randomUUID()}`, files: new Map(), stores: new Map(), sync: new AsyncMutex() };
      this.projects.set(dir, t);
    }
    return { t, dir };
  }

  private storeFor(t: Tracked, projectPath: string): PgS3ProjectStore {
    let s = t.stores.get(projectPath);
    if (!s) {
      s = new PgS3ProjectStore(this.backend, { projectId: t.projectId, anchorPath: projectPath });
      t.stores.set(projectPath, s);
    }
    return s;
  }

  private insideTx(t: Tracked): boolean {
    return this.inTx.getStore()?.has(t.projectId) ?? false;
  }

  /** Reconcile in, run `fn` on this path's store, and — for a write — reconcile out. */
  private async route<T>(
    projectPath: unknown,
    write: boolean,
    fn: (store: PgS3ProjectStore) => Promise<T>,
  ): Promise<T> {
    this.calls++;
    if (typeof projectPath !== "string" || projectPath.trim() === "") return fn(this.nowhere);
    let { t, dir } = this.tracked(projectPath);
    if (this.insideTx(t)) return fn(this.storeFor(t, projectPath));
    t = await t.sync.run(() => this.syncIn(t, dir));
    const store = this.storeFor(t, projectPath);
    try {
      return await fn(store);
    } finally {
      if (write) await t.sync.run(() => this.syncOut(t, dir, store, projectPath));
    }
  }

  // ── reconcile ────────────────────────────────────────────────────────────

  private async isDir(dir: string): Promise<boolean> {
    try {
      return (await stat(dir)).isDirectory();
    } catch {
      return false;
    }
  }

  /** Every regular file under `dir`, relative, with a signature that changes on any write. */
  private async walk(dir: string): Promise<Map<string, DiskFile>> {
    const out = new Map<string, DiskFile>();
    const visit = async (abs: string): Promise<void> => {
      let names: string[];
      try {
        names = await readdir(abs);
      } catch {
        return;
      }
      for (const name of names) {
        const p = join(abs, name);
        let st;
        try {
          st = await lstat(p, { bigint: true });
        } catch {
          continue;
        }
        if (st.isDirectory()) await visit(p);
        else if (st.isFile()) {
          out.set(relative(dir, p).split(sep).join("/"), {
            sig: `${st.size}:${st.mtimeNs}:${st.ctimeNs}:${st.ino}`,
            mtimeMs: Number(st.mtimeMs),
          });
        }
      }
    };
    await visit(dir);
    return out;
  }

  /** Disk → project. A directory that vanished starts a fresh project. Returns
   *  the entry to use, which is a new one after a vanish. */
  private async syncIn(t: Tracked, dir: string): Promise<Tracked> {
    if (!(await this.isDir(dir))) {
      if (t.files.size > 0 || (await this.hasRow(t))) {
        const fresh: Tracked = { ...t, projectId: `u15-${randomUUID()}`, files: new Map(), stores: new Map() };
        this.projects.set(dir, fresh);
        return fresh;
      }
      return t;
    }
    await this.backend.pool.query(
      "INSERT INTO projects (project_id) VALUES ($1) ON CONFLICT (project_id) DO NOTHING",
      [t.projectId],
    );
    const now = await this.walk(dir);
    const anchor = this.storeFor(t, dir);
    for (const [ref, { sig, mtimeMs }] of now) {
      if (t.files.get(ref) === sig) continue;
      const bytes = await readFile(join(dir, ref));
      if (routeRef(ref).kind === "document") {
        let data: unknown;
        try {
          data = JSON.parse(bytes.toString("utf-8"));
        } catch (e) {
          throw new Error(
            `PROTO_STORE=pg: the test seeded '${ref}' with text that is not JSON, which the ` +
              `Postgres store cannot hold as a document (${(e as Error).message})`,
          );
        }
        await anchor.writeJson(dir, ref, data);
      } else {
        await anchor.writeBytes(dir, ref, new Uint8Array(bytes));
      }
      await this.stampMtime(t, ref, mtimeMs);
    }
    for (const ref of t.files.keys()) {
      if (!now.has(ref)) await anchor.remove(dir, ref);
    }
    t.files = signatures(now);
    return t;
  }

  /** The row's write time becomes the file's mtime, so a test that ages a file
   *  with `utimes` ages the row the store's TTL sweeps read (`list`'s mtimeMs). */
  private async stampMtime(t: Tracked, ref: string, mtimeMs: number): Promise<void> {
    const route = routeRef(ref);
    const [sql, key] =
      route.kind === "document"
        ? ["UPDATE documents SET updated_at = to_timestamp($3) WHERE project_id = $1 AND name = $2", ref]
        : route.kind === "staging"
          ? ["UPDATE staging SET created_at = to_timestamp($3) WHERE project_id = $1 AND staging_id = $2", route.stagingId]
          : ["UPDATE blobs SET created_at = to_timestamp($3) WHERE project_id = $1 AND key = $2", ref];
    await this.backend.pool.query(sql, [t.projectId, key, mtimeMs / 1000]);
  }

  private async hasRow(t: Tracked): Promise<boolean> {
    const r = await this.backend.pool.query("SELECT 1 FROM projects WHERE project_id = $1", [t.projectId]);
    return (r.rowCount ?? 0) > 0;
  }

  /** Project → disk: the directory is rewritten to hold exactly what the project holds. */
  private async syncOut(t: Tracked, dir: string, store: PgS3ProjectStore, projectPath: string): Promise<void> {
    if (!(await this.hasRow(t))) return;
    const q = (sql: string) => this.backend.pool.query<{ ref: string }>(sql, [t.projectId]);
    const refs = [
      ...(await q("SELECT name AS ref FROM documents WHERE project_id = $1")).rows,
      ...(await q("SELECT key AS ref FROM blobs WHERE project_id = $1")).rows,
      ...(await q("SELECT 'results/.staging/' || staging_id AS ref FROM staging WHERE project_id = $1")).rows,
    ].map((r) => r.ref);
    await mkdir(dir, { recursive: true });
    const held = new Set(refs);
    for (const ref of refs) {
      const bytes = Buffer.from(await store.readBytes(projectPath, ref));
      const abs = join(dir, ref);
      let current: Buffer | null = null;
      try {
        current = await readFile(abs);
      } catch {
        current = null;
      }
      if (current && (current.equals(bytes) || sameDocument(ref, current, bytes))) continue;
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, bytes);
    }
    for (const ref of t.files.keys()) {
      if (!held.has(ref)) await rm(join(dir, ref), { force: true });
    }
    t.files = signatures(await this.walk(dir));
  }

  // ── ProjectStore ─────────────────────────────────────────────────────────

  async withTransaction<T>(projectPath: string, fn: () => Promise<T>): Promise<T> {
    return this.route(projectPath, true, async (store) => {
      const ids = new Set(this.inTx.getStore());
      ids.add(store.projectId);
      return this.inTx.run(ids, () => store.withTransaction(projectPath, fn));
    });
  }

  classifyProject(projectPath: unknown): Promise<ProjectPathClass> {
    return this.route(projectPath, false, (s) => s.classifyProject(projectPath));
  }

  projectDirState(projectPath: string): Promise<ProjectDirState> {
    return this.route(projectPath, false, (s) => s.projectDirState(projectPath));
  }

  findNestingAncestor(projectPath: string): Promise<string | null> {
    return this.route(projectPath, false, (s) => s.findNestingAncestor(projectPath));
  }

  exists(projectPath: string, ref: string): Promise<boolean> {
    return this.route(projectPath, false, (s) => s.exists(projectPath, ref));
  }

  readText(projectPath: string, ref: string): Promise<string> {
    return this.route(projectPath, false, (s) => s.readText(projectPath, ref));
  }

  readBytes(projectPath: string, ref: string): Promise<Uint8Array> {
    return this.route(projectPath, false, (s) => s.readBytes(projectPath, ref));
  }

  list(projectPath: string, dirRef: string): Promise<ProjectEntry[]> {
    return this.route(projectPath, false, (s) => s.list(projectPath, dirRef));
  }

  writeJson(projectPath: string, ref: string, data: unknown): Promise<void> {
    return this.route(projectPath, true, (s) => s.writeJson(projectPath, ref, data));
  }

  writeJsonBoth(projectPath: string, writes: JsonWrite[], options?: WriteJsonBothOptions): Promise<void> {
    return this.route(projectPath, true, (s) => s.writeJsonBoth(projectPath, writes, options));
  }

  writeBytes(projectPath: string, ref: string, bytes: Uint8Array): Promise<void> {
    return this.route(projectPath, true, (s) => s.writeBytes(projectPath, ref, bytes));
  }

  appendText(projectPath: string, ref: string, text: string): Promise<void> {
    return this.route(projectPath, true, (s) => s.appendText(projectPath, ref, text));
  }

  remove(projectPath: string, ref: string): Promise<void> {
    return this.route(projectPath, true, (s) => s.remove(projectPath, ref));
  }
}

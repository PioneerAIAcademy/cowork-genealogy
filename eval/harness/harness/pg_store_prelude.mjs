// `PROTO_STORE=pg` for the unit harness (U15's paid half). `_run_node_eval`
// (mock_mcp.py) preloads this with `node --import` when the harness runs with
// `--store pg`, so every live tool call in that node process reads and writes
// through PgS3ProjectStore instead of the workspace directory.
//
// One Postgres project per workspace per harness process: the id is the
// harness's run nonce (HARNESS_PG_RUN) plus a hash of the workspace's realpath.
// The FIRST call that touches a workspace seeds it — every file the harness
// staged is written into the project (orchestrator.py makes that call right
// after build_workspace, before the agent runs). After that the project is the
// truth: a later file the agent writes with its own Write tool is NOT imported,
// because on the hosted path such a file never reaches the store either.
//
// After every write the workspace is rewritten from the project (changed refs
// written, refs the write removed deleted), so snapshots, validators, the judge
// and the agent's own Read see what Postgres holds. A document whose value did
// not change keeps its bytes: jsonb keeps neither key order nor whitespace.
//
// The engine suites' counterpart is tests/helpers/pg-routing-store.ts, which
// re-imports disk before every call because its tests seed and edit fixtures on
// disk between calls; a workspace is seeded once.

import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { lstat, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

const BUILD = new URL("../../../packages/engine/mcp-server/build/", import.meta.url);
const { createPgS3Backend, PgS3ProjectStore, routeRef } = await import(
  new URL("store/pg-s3-project-store.js", BUILD).href
);
const { readPgS3Env } = await import(new URL("store/pg-s3-env.js", BUILD).href);
const { setProjectStore } = await import(new URL("store/project-store.js", BUILD).href);

const RUN = process.env.HARNESS_PG_RUN;
if (!RUN || !/^[A-Za-z0-9]+$/.test(RUN)) {
  throw new Error("pg_store_prelude: HARNESS_PG_RUN must be set to an alphanumeric run nonce");
}

const parsed = readPgS3Env({
  GENEALOGY_PG_DSN: process.env.PROTO_PG_DSN,
  GENEALOGY_S3_ENDPOINT: process.env.PROTO_S3_ENDPOINT,
  GENEALOGY_S3_BUCKET: process.env.PROTO_S3_BUCKET ?? "projects",
  GENEALOGY_S3_ACCESS_KEY: process.env.PROTO_S3_ACCESS_KEY,
  GENEALOGY_S3_SECRET_KEY: process.env.PROTO_S3_SECRET_KEY,
});
if (parsed.missing.length > 0 || parsed.invalid.length > 0) {
  throw new Error(
    `pg_store_prelude: PROTO_* store environment incomplete: missing [${parsed.missing.join(", ")}], ` +
      `invalid [${parsed.invalid.join(", ")}]`,
  );
}
const backend = createPgS3Backend(parsed.backendOptions);
// An idle pooled connection must not keep a finished tool call's process alive.
backend.pool.options.allowExitOnIdle = true;

function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

function sameDocument(ref, a, b) {
  if (routeRef(ref).kind !== "document") return false;
  try {
    return canonical(JSON.parse(a.toString("utf-8"))) === canonical(JSON.parse(b.toString("utf-8")));
  } catch {
    return false;
  }
}

async function isDir(p) {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

/** Every regular file under `dir`, relative and POSIX-separated, with its mtime. */
async function walk(dir) {
  const out = new Map();
  const visit = async (abs) => {
    let names;
    try {
      names = await readdir(abs);
    } catch {
      return;
    }
    for (const name of names) {
      const p = join(abs, name);
      let st;
      try {
        st = await lstat(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) await visit(p);
      else if (st.isFile()) out.set(relative(dir, p).split(sep).join("/"), st.mtimeMs);
    }
  };
  await visit(dir);
  return out;
}

class WorkspaceMirrorStore {
  constructor() {
    this.stores = new Map();
    this.seeded = new Map();
    this.inTx = new AsyncLocalStorage();
    this.nowhere = new PgS3ProjectStore(backend, { projectId: `h-${RUN}-nowhere`, anchorPath: "\0" });
  }

  dirOf(projectPath) {
    const abs = resolve(projectPath);
    try {
      return realpathSync.native(abs);
    } catch {
      return abs;
    }
  }

  storeFor(projectPath) {
    let s = this.stores.get(projectPath);
    if (!s) {
      const dir = this.dirOf(projectPath);
      const id = `h-${RUN}-${createHash("sha256").update(dir).digest("hex").slice(0, 16)}`;
      s = new PgS3ProjectStore(backend, { projectId: id, anchorPath: projectPath });
      this.stores.set(projectPath, s);
    }
    return s;
  }

  async refs(projectId) {
    const q = (sql) => backend.pool.query(sql, [projectId]);
    return [
      ...(await q("SELECT name AS ref FROM documents WHERE project_id = $1")).rows,
      ...(await q("SELECT key AS ref FROM blobs WHERE project_id = $1")).rows,
      ...(await q("SELECT 'results/.staging/' || staging_id AS ref FROM staging WHERE project_id = $1")).rows,
    ].map((r) => r.ref);
  }

  /** The first touch of a workspace in this run writes its files into the project. */
  seed(store, projectPath) {
    let p = this.seeded.get(store.projectId);
    if (!p) {
      p = this.seedOnce(store, projectPath);
      this.seeded.set(store.projectId, p);
    }
    return p;
  }

  async seedOnce(store, projectPath) {
    const dir = this.dirOf(projectPath);
    const existing = await backend.pool.query("SELECT 1 FROM projects WHERE project_id = $1", [store.projectId]);
    if (existing.rowCount > 0 || !(await isDir(dir))) return;
    await backend.pool.query("INSERT INTO projects (project_id) VALUES ($1) ON CONFLICT DO NOTHING", [store.projectId]);
    for (const [ref, mtimeMs] of await walk(dir)) {
      // The staged skills, agents and settings: the harness's runtime, not project data.
      if (ref.startsWith(".claude/")) continue;
      const bytes = await readFile(join(dir, ref));
      const route = routeRef(ref);
      if (route.kind === "document") {
        let data;
        try {
          data = JSON.parse(bytes.toString("utf-8"));
        } catch (e) {
          throw new Error(
            `pg_store_prelude: the workspace's '${ref}' is not JSON, which the Postgres store ` +
              `cannot hold as a document (${e.message})`,
          );
        }
        await store.writeJson(projectPath, ref, data);
      } else {
        await store.writeBytes(projectPath, ref, new Uint8Array(bytes));
      }
      const [sql, key] =
        route.kind === "document"
          ? ["UPDATE documents SET updated_at = to_timestamp($3) WHERE project_id = $1 AND name = $2", ref]
          : route.kind === "staging"
            ? ["UPDATE staging SET created_at = to_timestamp($3) WHERE project_id = $1 AND staging_id = $2", route.stagingId]
            : ["UPDATE blobs SET created_at = to_timestamp($3) WHERE project_id = $1 AND key = $2", ref];
      await backend.pool.query(sql, [store.projectId, key, mtimeMs / 1000]);
    }
  }

  /** Project → workspace: changed refs written, refs this write removed deleted. */
  async exportTo(store, projectPath, before) {
    const dir = this.dirOf(projectPath);
    const now = await this.refs(store.projectId);
    if (now.length === 0 && before.length === 0) return;
    const held = new Set(now);
    for (const ref of now) {
      const bytes = Buffer.from(await store.readBytes(projectPath, ref));
      const abs = join(dir, ref);
      let current = null;
      try {
        current = await readFile(abs);
      } catch {
        current = null;
      }
      if (current && (current.equals(bytes) || sameDocument(ref, current, bytes))) continue;
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, bytes);
    }
    for (const ref of before) {
      if (!held.has(ref)) await rm(join(dir, ref), { force: true });
    }
  }

  async route(projectPath, write, fn) {
    if (typeof projectPath !== "string" || projectPath.trim() === "") return fn(this.nowhere);
    const store = this.storeFor(projectPath);
    if (this.inTx.getStore()?.has(store.projectId)) return fn(store);
    await this.seed(store, projectPath);
    if (!write) return fn(store);
    const before = await this.refs(store.projectId);
    try {
      return await fn(store);
    } finally {
      await this.exportTo(store, projectPath, before);
    }
  }

  withTransaction(projectPath, fn) {
    return this.route(projectPath, true, (s) => {
      const ids = new Set(this.inTx.getStore());
      ids.add(s.projectId);
      return this.inTx.run(ids, () => s.withTransaction(projectPath, fn));
    });
  }
  classifyProject(p) {
    return this.route(p, false, (s) => s.classifyProject(p));
  }
  projectDirState(p) {
    return this.route(p, false, (s) => s.projectDirState(p));
  }
  findNestingAncestor(p) {
    return this.route(p, false, (s) => s.findNestingAncestor(p));
  }
  exists(p, ref) {
    return this.route(p, false, (s) => s.exists(p, ref));
  }
  readText(p, ref) {
    return this.route(p, false, (s) => s.readText(p, ref));
  }
  readBytes(p, ref) {
    return this.route(p, false, (s) => s.readBytes(p, ref));
  }
  list(p, dirRef) {
    return this.route(p, false, (s) => s.list(p, dirRef));
  }
  writeJson(p, ref, data) {
    return this.route(p, true, (s) => s.writeJson(p, ref, data));
  }
  writeJsonBoth(p, writes, options) {
    return this.route(p, true, (s) => s.writeJsonBoth(p, writes, options));
  }
  writeBytes(p, ref, bytes) {
    return this.route(p, true, (s) => s.writeBytes(p, ref, bytes));
  }
  appendText(p, ref, text) {
    return this.route(p, true, (s) => s.appendText(p, ref, text));
  }
  remove(p, ref) {
    return this.route(p, true, (s) => s.remove(p, ref));
  }
}

setProjectStore(new WorkspaceMirrorStore());

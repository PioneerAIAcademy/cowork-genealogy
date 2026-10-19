/**
 * export-project — the mirror image of seed-project: copy one project's files out
 * of the prototype's Postgres/S3 ProjectStore into a directory a person (or the e2e
 * judge) can read, through PgS3ProjectStore itself. Driven by
 * apps/server/proto/export.py, which resolves the session's project id and passes a
 * manifest on stdin:
 *
 *   {"projectId": "proj_x", "anchorPath": "/project", "outDir": "/abs/exports"}
 *
 *   PROTO_PG_DSN, PROTO_S3_ENDPOINT (+ PROTO_S3_BUCKET / _ACCESS_KEY / _SECRET_KEY)
 *   name the stack, with the compose defaults, as for `make proto-store-test`.
 *
 * Writes research.json, tree.gedcomx.json and every file the store lists directly
 * under results/ and images/ (the persisted sidecars and retained scans; the transient
 * results/.staging/ area is not a project file) to <outDir>/<projectId>/<ref>, bytes
 * as the store holds them. One line per ref written and a total; exit 1 on any
 * failure, including a project that holds no research.json.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createPgS3Backend, PgS3ProjectStore } from "../src/store/pg-s3-project-store.js";

interface Manifest {
  projectId: string;
  anchorPath: string;
  outDir: string;
}

const DOCUMENTS = ["research.json", "tree.gedcomx.json"];
const DIRS = ["results", "images"];

const manifest = JSON.parse(readFileSync(0, "utf-8")) as Manifest;
const backend = createPgS3Backend({
  dsn: process.env.PROTO_PG_DSN ?? "postgresql://postgres:proto@localhost:5434/proto",
  s3: {
    endpoint: process.env.PROTO_S3_ENDPOINT ?? "http://localhost:9000",
    bucket: process.env.PROTO_S3_BUCKET ?? "projects",
    accessKeyId: process.env.PROTO_S3_ACCESS_KEY ?? "proto",
    secretAccessKey: process.env.PROTO_S3_SECRET_KEY ?? "protoproto",
    forcePathStyle: true,
  },
});

let failed = false;
try {
  const { projectId, anchorPath, outDir } = manifest;
  const store = new PgS3ProjectStore(backend, { projectId, anchorPath });
  if (!(await store.exists(anchorPath, "research.json"))) {
    throw new Error(`project ${projectId} holds no research.json; nothing to export`);
  }
  const refs: string[] = [];
  for (const ref of DOCUMENTS) {
    if (await store.exists(anchorPath, ref)) refs.push(ref);
  }
  for (const dir of DIRS) {
    for (const entry of await store.list(anchorPath, dir)) refs.push(`${dir}/${entry.name}`);
  }
  const root = join(outDir, projectId);
  for (const ref of refs) {
    const bytes = await store.readBytes(anchorPath, ref);
    const path = join(root, ref);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes);
    process.stdout.write(`${ref}  ${bytes.length} bytes\n`);
  }
  process.stdout.write(`exported ${refs.length} files from project ${projectId} to ${root}\n`);
} catch (err) {
  failed = true;
  process.stderr.write(`export-project: ${err instanceof Error ? err.message : String(err)}\n`);
} finally {
  await backend.close();
}
process.exit(failed ? 1 : 0);

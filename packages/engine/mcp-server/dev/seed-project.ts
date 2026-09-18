/**
 * seed-project — load a fixture's project files into the prototype's Postgres/S3
 * ProjectStore for one project id, through PgS3ProjectStore itself (the same writes
 * the tools make), so a D17 run starts from a known research.json and tree rather
 * than an empty project. Driven by apps/server/proto/seed.py, which owns the fixture
 * layouts and passes a manifest on stdin:
 *
 *   {"projectId": "proj_x", "anchorPath": "/project",
 *    "files": [{"ref": "research.json", "path": "/abs/path/research.json"}, ...]}
 *
 *   PROTO_PG_DSN, PROTO_S3_ENDPOINT (+ PROTO_S3_BUCKET / _ACCESS_KEY / _SECRET_KEY)
 *   name the stack, with the compose defaults, as for `make proto-store-test`.
 *
 * Refuses a project that already holds research.json — seed a fresh id instead.
 * One line per ref written; exit 1 on any failure.
 */
import { readFileSync } from "node:fs";
import { createPgS3Backend, PgS3ProjectStore } from "../src/store/pg-s3-project-store.js";

interface Manifest {
  projectId: string;
  anchorPath: string;
  files: { ref: string; path: string }[];
}

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
  const store = new PgS3ProjectStore(backend, {
    projectId: manifest.projectId,
    anchorPath: manifest.anchorPath,
  });
  if (await store.exists(manifest.anchorPath, "research.json")) {
    throw new Error(`project ${manifest.projectId} already holds research.json; seed a fresh project id`);
  }
  for (const { ref, path } of manifest.files) {
    const bytes = readFileSync(path);
    if (ref.endsWith(".json")) {
      await store.writeJson(manifest.anchorPath, ref, JSON.parse(bytes.toString("utf-8")));
    } else {
      await store.writeBytes(manifest.anchorPath, ref, new Uint8Array(bytes));
    }
    if (!(await store.exists(manifest.anchorPath, ref))) {
      throw new Error(`${ref}: written but not readable back`);
    }
    process.stdout.write(`${ref}  ${bytes.length} bytes\n`);
  }
  process.stdout.write(`seeded ${manifest.files.length} files into project ${manifest.projectId}\n`);
} catch (err) {
  failed = true;
  process.stderr.write(`seed-project: ${err instanceof Error ? err.message : String(err)}\n`);
} finally {
  await backend.close();
}
process.exit(failed ? 1 : 0);

import { describe, it, expect, afterAll, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, readFile, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPgS3Backend, type PgS3Backend } from "../../src/store/pg-s3-project-store.js";
import { PgRoutingStore } from "../helpers/pg-routing-store.js";
import { runProjectStoreConformance } from "./conformance.js";
import { protoBackendOptions } from "./pg-s3-test-env.js";

// The store `PROTO_STORE=pg` runs the whole engine suite on (U15). Its disk
// mirror is code under test too, so it runs the shared conformance suite and
// the mirror's own cases against the live stack. Gated like the other live
// suites: without the stack the file registers one skipped suite naming why.

const DSN = process.env.PROTO_PG_DSN;
const ENDPOINT = process.env.PROTO_S3_ENDPOINT;

if (!DSN || !ENDPOINT) {
  describe.skip(
    "PgRoutingStore — skipped: PROTO_PG_DSN and PROTO_S3_ENDPOINT are not set (run `make engine-test-pg`)",
    () => {
      it("needs the compose stack", () => {});
    },
  );
} else {
  const backend: PgS3Backend = createPgS3Backend(protoBackendOptions());
  afterAll(async () => {
    await backend.close();
  });

  runProjectStoreConformance("PgRoutingStore", async () => {
    const root = await mkdtemp(join(tmpdir(), "pg-routing-conf-"));
    const projectPath = join(root, "project");
    await mkdir(projectPath);
    return {
      store: new PgRoutingStore(backend),
      projectPath,
      missingPath: join(root, "missing"),
      cleanup: () => rm(root, { recursive: true, force: true }),
    };
  });

  describe("PgRoutingStore: the disk mirror", () => {
    let root: string;
    let dir: string;
    let store: PgRoutingStore;
    const docRow = async (name: string) =>
      (
        await backend.pool.query(
          "SELECT d.doc FROM documents d WHERE d.project_id = $1 AND d.name = $2",
          [await projectId(), name],
        )
      ).rows[0]?.doc;
    // The id the router gave `dir`: the one project row its writes created.
    const projectId = async (): Promise<string> => {
      await store.exists(dir, "research.json");
      const r = await backend.pool.query<{ project_id: string }>(
        "SELECT project_id FROM documents WHERE name = 'marker.json' AND doc->>'dir' = $1",
        [dir],
      );
      return r.rows[0].project_id;
    };

    beforeEach(async () => {
      root = await mkdtemp(join(tmpdir(), "pg-routing-"));
      dir = join(root, "project");
      await mkdir(dir);
      await writeFile(join(dir, "marker.json"), JSON.stringify({ dir }));
      store = new PgRoutingStore(backend);
    });
    afterEach(async () => {
      await rm(root, { recursive: true, force: true });
    });

    it("an empty existing directory is no_project, a missing one missing_dir, as on disk", async () => {
      const empty = join(root, "empty");
      await mkdir(empty);
      expect(await store.classifyProject(empty)).toBe("no_project");
      expect(await store.classifyProject(join(root, "absent"))).toBe("missing_dir");
      expect(await store.classifyProject(undefined)).toBe("missing_arg");
    });

    it("a file the test writes on disk is what the store reads, and a later edit replaces it", async () => {
      await writeFile(join(dir, "research.json"), JSON.stringify({ a: 1 }));
      expect(JSON.parse(await store.readText(dir, "research.json"))).toEqual({ a: 1 });
      expect(await docRow("research.json")).toEqual({ a: 1 });
      await writeFile(join(dir, "research.json"), JSON.stringify({ a: 2 }));
      expect(JSON.parse(await store.readText(dir, "research.json"))).toEqual({ a: 2 });
      await rm(join(dir, "research.json"));
      expect(await store.exists(dir, "research.json")).toBe(false);
    });

    it("a store write lands in Postgres and is mirrored to disk; a remove deletes the file", async () => {
      await store.writeJson(dir, "research.json", { b: 1 });
      expect(await docRow("research.json")).toEqual({ b: 1 });
      expect(JSON.parse(await readFile(join(dir, "research.json"), "utf-8"))).toEqual({ b: 1 });
      await store.writeBytes(dir, "results/x.txt", new TextEncoder().encode("hi"));
      expect(await readFile(join(dir, "results", "x.txt"), "utf-8")).toBe("hi");
      await store.remove(dir, "results/x.txt");
      expect(await readdir(join(dir, "results"))).toEqual([]);
    });

    it("a transaction that throws rolls back in Postgres and on disk alike", async () => {
      await writeFile(join(dir, "research.json"), JSON.stringify({ v: "before" }));
      await expect(
        store.withTransaction(dir, async () => {
          await store.writeJson(dir, "research.json", { v: "after" });
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");
      expect(await docRow("research.json")).toEqual({ v: "before" });
      expect(JSON.parse(await readFile(join(dir, "research.json"), "utf-8"))).toEqual({ v: "before" });
    });

    it("a refused write leaves the test's bytes alone when only key order would differ", async () => {
      const text = '{\n  "zeta": 1,\n  "a": 2\n}';
      await writeFile(join(dir, "research.json"), text);
      await expect(
        store.withTransaction(dir, async () => {
          throw new Error("refused");
        }),
      ).rejects.toThrow("refused");
      expect(await readFile(join(dir, "research.json"), "utf-8")).toBe(text);
    });

    it("a file aged with utimes is aged in the row the TTL sweeps read", async () => {
      await mkdir(join(dir, "results", ".staging"), { recursive: true });
      await writeFile(join(dir, "results", ".staging", "old.json"), "{}");
      const old = new Date(Date.now() - 48 * 3600 * 1000);
      await utimes(join(dir, "results", ".staging", "old.json"), old, old);
      const [entry] = await store.list(dir, "results/.staging");
      expect(entry.name).toBe("old.json");
      expect(Math.abs(entry.mtimeMs - old.getTime())).toBeLessThan(1000);
    });

    it("a directory the test deletes starts a fresh project, not the old rows", async () => {
      await store.writeJson(dir, "research.json", { gone: true });
      await rm(dir, { recursive: true, force: true });
      expect(await store.classifyProject(dir)).toBe("missing_dir");
      await mkdir(dir);
      expect(await store.classifyProject(dir)).toBe("no_project");
    });

    it("a seeded document that is not JSON fails loudly, naming the ref", async () => {
      await writeFile(join(dir, "research.json"), "{not json");
      await expect(store.readText(dir, "research.json")).rejects.toThrow(
        /'research\.json' with text that is not JSON/,
      );
    });

    it("two spellings of one directory share one project and one lock", async () => {
      const alias = `${dir}/./`;
      await store.writeJson(alias, "research.json", { via: "alias" });
      expect(JSON.parse(await store.readText(dir, "research.json"))).toEqual({ via: "alias" });
    });

    it("counts every call it answers", async () => {
      const before = store.calls;
      await store.exists(dir, "x.json");
      await store.list(dir, "results");
      expect(store.calls - before).toBe(2);
    });
  });
}

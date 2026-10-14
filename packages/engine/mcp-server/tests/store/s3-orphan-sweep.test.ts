import { describe, it, expect, afterAll, beforeAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import {
  CreateBucketCommand,
  DeleteObjectsCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { createPgS3Backend, PgS3Backend, PgS3ProjectStore } from "../../src/store/pg-s3-project-store.js";
import {
  ORPHAN_KEY_RE,
  orphanSweepLine,
  startOrphanSweep,
  sweepOrphans,
  type OrphanSweepReport,
} from "../../src/store/s3-orphan-sweep.js";
import { protoBackendOptions } from "./pg-s3-test-env.js";

// The S3 orphan sweep (U19). The key layout and the timer run with no stack;
// the sweep itself runs against the stack `make proto-store-test` starts. Every
// live pass is held to the case's own project ids with `prefix`: the bucket is
// shared by every file of a parallel run, and a whole-bucket pass with a zero
// grace would delete their objects mid-write. MinIO cannot backdate
// LastModified, so the grace is crossed by moving `now`, not the object.

const DSN = process.env.PROTO_PG_DSN;
const ENDPOINT = process.env.PROTO_S3_ENDPOINT;
const BUCKET = process.env.PROTO_S3_BUCKET ?? "projects";
const ANCHOR = "/project";
const HOUR = 3_600_000;
const UUID = "0f8fad5b-d9cb-469f-a165-70867728950e";

describe("ORPHAN_KEY_RE", () => {
  it("reads the store's own layout, a ref holding '/' and '.' included", () => {
    expect(ORPHAN_KEY_RE.exec(`proj_ab12/images/2024/a.b.png/${UUID}`)?.slice(1)).toEqual([
      "proj_ab12",
      "images/2024/a.b.png",
      UUID,
    ]);
    expect(ORPHAN_KEY_RE.test(`p/results/.staging/x.json/${UUID}`)).toBe(true);
  });

  it("refuses any other key", () => {
    for (const key of [
      "proj_ab12/no-uuid",
      `proj_ab12/${UUID}`,
      "proj_ab12/a/b",
      `.hidden/a/${UUID}`,
      `proj_ab12/a/${UUID.toUpperCase()}`,
      `proj_ab12/a/${UUID}x`,
      "proj_ab12-foreign.txt",
    ]) {
      expect(ORPHAN_KEY_RE.test(key), key).toBe(false);
    }
  });
});

describe("startOrphanSweep", () => {
  const REPORT: OrphanSweepReport = {
    listed: 3,
    deleted: 1,
    young: 1,
    referenced: 1,
    foreign: 0,
    failed: 0,
    projects: 1,
    ms: 7,
  };
  const backend = {} as PgS3Backend;

  it("writes one line per pass, keeps going after a failed one, and stops", async () => {
    vi.useFakeTimers();
    try {
      const lines: string[] = [];
      const err = Object.assign(new Error("connect ECONNREFUSED 10.0.0.5:5432 user=secret"), { code: "ECONNREFUSED" });
      const sweep = vi.fn().mockRejectedValueOnce(err).mockResolvedValue(REPORT);
      const timer = startOrphanSweep(backend, {
        intervalMs: 1000,
        graceMs: 5 * HOUR,
        firstDelayMs: 500,
        write: (l) => void lines.push(l),
        sweep,
      });
      await vi.advanceTimersByTimeAsync(499);
      expect(sweep).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(lines).toEqual(["ev=orphan_sweep_failed error=ECONNREFUSED\n"]);
      await vi.advanceTimersByTimeAsync(1000);
      expect(lines[1]).toBe(
        "ev=orphan_sweep listed=3 deleted=1 young=1 referenced=1 foreign=0 failed=0 projects=1 ms=7\n",
      );
      expect(sweep).toHaveBeenLastCalledWith(backend, { graceMs: 5 * HOUR });
      timer.stop();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(sweep).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("never starts a pass while the last one is still running", async () => {
    vi.useFakeTimers();
    try {
      let release!: () => void;
      const sweep = vi.fn(
        () => new Promise<OrphanSweepReport>((r) => (release = () => r(REPORT))),
      );
      const timer = startOrphanSweep(backend, { intervalMs: 10, graceMs: HOUR, firstDelayMs: 0, write: () => {}, sweep });
      await vi.advanceTimersByTimeAsync(1000);
      expect(sweep).toHaveBeenCalledTimes(1);
      release();
      await vi.advanceTimersByTimeAsync(10);
      expect(sweep).toHaveBeenCalledTimes(2);
      timer.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("formats the line the alarms' filters read", () => {
    expect(orphanSweepLine({ ...REPORT, failed: 2 })).toMatch(/^ev=orphan_sweep .*failed=2 /);
  });
});

if (!DSN || !ENDPOINT) {
  describe.skip(
    "sweepOrphans — skipped: PROTO_PG_DSN and PROTO_S3_ENDPOINT are not set (run `make proto-store-test`)",
    () => {
      it("needs the compose stack", () => {});
    },
  );
} else {
  const backend: PgS3Backend = createPgS3Backend(protoBackendOptions());
  const enc = new TextEncoder();

  async function keysUnder(prefix: string): Promise<string[]> {
    const listed = await backend.s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix }));
    return (listed.Contents ?? []).map((o) => o.Key!).sort();
  }

  async function exists(key: string): Promise<boolean> {
    try {
      await backend.s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
      return true;
    } catch (e: any) {
      if (e?.$metadata?.httpStatusCode === 404) return false;
      throw e;
    }
  }

  async function plant(key: string): Promise<string> {
    await backend.s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: enc.encode("orphan") }));
    return key;
  }

  async function project(stem = `sweep_${randomUUID()}`): Promise<{ projectId: string; store: PgS3ProjectStore }> {
    const projectId = `${stem}_${randomUUID().slice(0, 8)}`;
    await backend.pool.query("INSERT INTO projects (project_id) VALUES ($1)", [projectId]);
    made.push(projectId);
    return { projectId, store: new PgS3ProjectStore(backend, { projectId, anchorPath: ANCHOR }) };
  }

  /** Rows only, the way `delete_session` leaves a project. */
  async function dropRows(projectId: string): Promise<void> {
    for (const table of ["documents", "blobs", "staging", "projects"]) {
      await backend.pool.query(`DELETE FROM ${table} WHERE project_id = $1`, [projectId]);
    }
  }

  async function blobKey(projectId: string, ref: string): Promise<string> {
    const r = await backend.pool.query("SELECT s3_key FROM blobs WHERE project_id = $1 AND key = $2", [projectId, ref]);
    return r.rows[0].s3_key;
  }

  const made: string[] = [];
  const at = (offsetMs: number) => () => Date.now() + offsetMs;

  describe("sweepOrphans", () => {
    beforeAll(async () => {
      try {
        await backend.s3.send(new CreateBucketCommand({ Bucket: BUCKET }));
      } catch (e: any) {
        if (e?.name !== "BucketAlreadyOwnedByYou" && e?.name !== "BucketAlreadyExists") throw e;
      }
    });

    afterAll(async () => {
      for (const projectId of made) {
        await dropRows(projectId);
        const keys = (await keysUnder(`${projectId}/`)).map((Key) => ({ Key }));
        if (keys.length > 0) {
          await backend.s3.send(new DeleteObjectsCommand({ Bucket: BUCKET, Delete: { Objects: keys } }));
        }
      }
      await backend.close();
    });

    it("deletes an unreferenced object and keeps what blobs and staging point at", async () => {
      const { projectId, store } = await project();
      await store.writeBytes(ANCHOR, "images/a.png", enc.encode("blob"));
      await store.writeJson(ANCHOR, "results/.staging/r1.json", { hit: 1 });
      const orphan = await plant(`${projectId}/images/a.png/${randomUUID()}`);

      const r = await sweepOrphans(backend, { graceMs: 0, prefix: `${projectId}/`, now: at(1000) });

      expect(r).toMatchObject({ listed: 3, referenced: 2, deleted: 1, young: 0, foreign: 0, failed: 0, projects: 1 });
      expect(await exists(orphan)).toBe(false);
      expect(new TextDecoder().decode(await store.readBytes(ANCHOR, "images/a.png"))).toBe("blob");
      expect(JSON.parse(await store.readText(ANCHOR, "results/.staging/r1.json"))).toEqual({ hit: 1 });
    });

    it("keeps an orphan younger than the grace and deletes it once older", async () => {
      const { projectId } = await project();
      const orphan = await plant(`${projectId}/tree.bin/${randomUUID()}`);
      const opts = { graceMs: HOUR, prefix: `${projectId}/` };

      expect(await sweepOrphans(backend, { ...opts, now: at(HOUR / 2) })).toMatchObject({ young: 1, deleted: 0 });
      expect(await exists(orphan)).toBe(true);
      expect(await sweepOrphans(backend, { ...opts, now: at(2 * HOUR) })).toMatchObject({ young: 0, deleted: 1 });
      expect(await exists(orphan)).toBe(false);
    });

    it("never deletes a key outside the store's layout", async () => {
      const { projectId } = await project();
      const foreign = [await plant(`${projectId}/no-uuid`), await plant(`${projectId}/a/b`)];
      const r = await sweepOrphans(backend, { graceMs: 0, prefix: `${projectId}/`, now: at(HOUR) });
      expect(r).toMatchObject({ listed: 2, foreign: 2, deleted: 0, projects: 0 });
      for (const key of foreign) expect(await exists(key), key).toBe(true);
    });

    it("empties a project whose rows are gone, past the grace and not before", async () => {
      const { projectId, store } = await project();
      await store.writeBytes(ANCHOR, "images/a.png", enc.encode("1"));
      await store.writeJson(ANCHOR, "results/.staging/r.json", {});
      await dropRows(projectId);
      const prefix = `${projectId}/`;

      expect(await sweepOrphans(backend, { graceMs: HOUR, prefix, now: at(0) })).toMatchObject({ young: 2 });
      expect(await keysUnder(prefix)).toHaveLength(2);
      expect(await sweepOrphans(backend, { graceMs: HOUR, prefix, now: at(2 * HOUR) })).toMatchObject({ deleted: 2 });
      expect(await keysUnder(prefix)).toEqual([]);
    });

    it("spares a write whose transaction has not committed, which is what the grace is for", async () => {
      const { projectId, store } = await project();
      const prefix = `${projectId}/`;
      await store.withTransaction(ANCHOR, async () => {
        await store.writeBytes(ANCHOR, "images/slow.png", enc.encode("in flight"));
        // The row is not visible outside this transaction yet: to the sweep it is an orphan.
        expect(await sweepOrphans(backend, { graceMs: HOUR, prefix, now: at(0) })).toMatchObject({
          young: 1,
          deleted: 0,
        });
      });
      expect(new TextDecoder().decode(await store.readBytes(ANCHOR, "images/slow.png"))).toBe("in flight");

      const lost = await project();
      await expect(
        lost.store.withTransaction(ANCHOR, async () => {
          await lost.store.writeBytes(ANCHOR, "images/slow.png", enc.encode("in flight"));
          await sweepOrphans(backend, { graceMs: 0, prefix: `${lost.projectId}/`, now: at(1000) });
        }),
      ).resolves.toBeUndefined();
      // With no grace the sweep took the object out from under the row that commits after it.
      await expect(lost.store.readBytes(ANCHOR, "images/slow.png")).rejects.toThrow();
      expect(await exists(await blobKey(lost.projectId, "images/slow.png"))).toBe(false);
    });

    it("follows every page and every project in it", async () => {
      const common = `sweep_${randomUUID()}`;
      const a = await project(common);
      const b = await project(common);
      for (let i = 0; i < 5; i++) await plant(`${a.projectId}/x${i}/${randomUUID()}`);
      for (let i = 0; i < 3; i++) await plant(`${b.projectId}/y${i}/${randomUUID()}`);

      const r = await sweepOrphans(backend, { graceMs: 0, prefix: common, pageSize: 2, now: at(1000) });
      expect(r).toMatchObject({ listed: 8, deleted: 8, projects: 2 });
      expect(await keysUnder(`${a.projectId}/`)).toEqual([]);
      expect(await keysUnder(`${b.projectId}/`)).toEqual([]);
    });

    it("reaches nothing outside its prefix", async () => {
      const mine = await project();
      const other = await project();
      const kept = await plant(`${other.projectId}/z/${randomUUID()}`);
      await plant(`${mine.projectId}/z/${randomUUID()}`);
      expect(await sweepOrphans(backend, { graceMs: 0, prefix: `${mine.projectId}/`, now: at(1000) })).toMatchObject({
        deleted: 1,
      });
      expect(await exists(kept)).toBe(true);
    });

    it("emits its line from a real pass through the timer", async () => {
      const { projectId } = await project();
      await plant(`${projectId}/e/${randomUUID()}`);
      const lines: string[] = [];
      const timer = startOrphanSweep(backend, {
        intervalMs: 60_000,
        graceMs: 0,
        firstDelayMs: 0,
        write: (l) => void lines.push(l),
        sweep: (b, o) => sweepOrphans(b, { ...o, prefix: `${projectId}/`, now: at(1000) }),
      });
      await vi.waitFor(() => expect(lines).toHaveLength(1), { timeout: 10_000 });
      timer.stop();
      expect(lines[0]).toMatch(/^ev=orphan_sweep listed=1 deleted=1 young=0 referenced=0 foreign=0 failed=0 projects=1 ms=\d+\n$/);
    });
  });
}

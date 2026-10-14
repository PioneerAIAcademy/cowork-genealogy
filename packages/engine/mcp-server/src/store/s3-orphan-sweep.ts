// The S3 orphan sweep (U19): deletes the objects no `blobs` or `staging` row
// points at once they are older than a grace, the one place a store object dies
// outside the write path. Orphans come from a crash between a PutObject and its
// row write, from a failed best-effort delete after COMMIT or ROLLBACK, and from
// the web tier's `delete_session`, which deletes a project's rows and leaves
// its objects here by design.
//
// Every object the store writes is `<projectId>/<ref>/<uuid>` (`newS3Key`), and
// a row only ever points at a key that was new when it was written, so an
// object once unreferenced stays unreferenced. The race is the other way: the
// object is PUT before its row is visible, and inside `withTransaction` the row
// commits only when the whole locked tool body does. The grace has to outlast
// the longest such body, which nothing server-side bounds (the worker's MCP
// call gives up at 1,800 s), so it is hours, and pg-s3-env.ts refuses less than one.
// A project with no rows at all gets no shortcut: `putObjectFenced` PUTs a new
// project's first object before its `projects` row exists.
//
// It LISTs the bucket, which 001_schema.sql's "never an S3 LIST" rule does not
// forbid: that rule is about serving `list` from the staging index, not about
// collecting garbage. A key that is not the store's layout is counted and left
// alone. Two sweeps at once (U18's second tools instance) only repeat work:
// deleting a missing key succeeds. No `fs`, no `fetch`.

import { DeleteObjectsCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { readyLabel, type PgS3Backend } from "./pg-s3-project-store.js";
import { PROJECT_ID_RE } from "./project-id.js";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** `<projectId>/<ref>/<uuid>`, the project id held to `PROJECT_ID_RE`. */
export const ORPHAN_KEY_RE = new RegExp(`^(${PROJECT_ID_RE.source.replace(/^\^|\$$/g, "")})/(.+)/(${UUID})$`);

const DELETE_BATCH = 1000;

export interface OrphanSweepOptions {
  graceMs: number;
  /** Only keys under this prefix (a project id and `/`, in the tests). */
  prefix?: string;
  /** ListObjectsV2's MaxKeys; S3's own default when unset. */
  pageSize?: number;
  now?: () => number;
}

export interface OrphanSweepReport {
  listed: number;
  referenced: number;
  young: number;
  foreign: number;
  deleted: number;
  failed: number;
  projects: number;
  ms: number;
}

interface Listed {
  key: string;
  modifiedMs: number;
}

/** One pass over the bucket. Throws when a LIST or a reference read fails, so
 *  nothing is deleted on a reference set it could not read. */
export async function sweepOrphans(backend: PgS3Backend, opts: OrphanSweepOptions): Promise<OrphanSweepReport> {
  const now = opts.now ?? Date.now;
  const started = Date.now();
  const report: OrphanSweepReport = {
    listed: 0,
    referenced: 0,
    young: 0,
    foreign: 0,
    deleted: 0,
    failed: 0,
    projects: 0,
    ms: 0,
  };

  let project: string | undefined;
  let held: Listed[] = [];

  const flush = async (): Promise<void> => {
    if (project === undefined || held.length === 0) return;
    report.projects++;
    const refs = await backend.pool.query<{ s3_key: string }>(
      "SELECT s3_key FROM blobs WHERE project_id = $1 UNION ALL SELECT s3_key FROM staging WHERE project_id = $1",
      [project],
    );
    const live = new Set(refs.rows.map((r) => r.s3_key));
    const cutoff = now() - opts.graceMs;
    const doomed: string[] = [];
    for (const o of held) {
      if (live.has(o.key)) report.referenced++;
      else if (o.modifiedMs > cutoff) report.young++;
      else doomed.push(o.key);
    }
    for (let i = 0; i < doomed.length; i += DELETE_BATCH) {
      const batch = doomed.slice(i, i + DELETE_BATCH);
      const r = await backend.s3.send(
        new DeleteObjectsCommand({
          Bucket: backend.bucket,
          Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
        }),
      );
      const failed = r.Errors?.length ?? 0;
      report.failed += failed;
      report.deleted += batch.length - failed;
    }
    held = [];
  };

  let token: string | undefined;
  do {
    const page = await backend.s3.send(
      new ListObjectsV2Command({
        Bucket: backend.bucket,
        ...(opts.prefix ? { Prefix: opts.prefix } : {}),
        ...(opts.pageSize ? { MaxKeys: opts.pageSize } : {}),
        ...(token ? { ContinuationToken: token } : {}),
      }),
    );
    for (const o of page.Contents ?? []) {
      if (!o.Key) continue;
      report.listed++;
      const m = ORPHAN_KEY_RE.exec(o.Key);
      // An object with no LastModified cannot be shown old enough.
      if (!m || !o.LastModified) {
        report.foreign++;
        continue;
      }
      // A LIST is sorted by key, so one project's objects arrive together.
      if (m[1] !== project) {
        await flush();
        project = m[1];
      }
      held.push({ key: o.Key, modifiedMs: o.LastModified.getTime() });
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  await flush();

  report.ms = Date.now() - started;
  return report;
}

/** The one stderr line a pass writes, for the alarms' metric filters. */
export function orphanSweepLine(r: OrphanSweepReport): string {
  return (
    `ev=orphan_sweep listed=${r.listed} deleted=${r.deleted} young=${r.young} referenced=${r.referenced} ` +
    `foreign=${r.foreign} failed=${r.failed} projects=${r.projects} ms=${r.ms}\n`
  );
}

export interface OrphanSweepTimer {
  stop(): void;
}

/** Sweep every `intervalMs`, first after `firstDelayMs`, never two passes at
 *  once and never keeping the process alive. A failed pass is one
 *  `ev=orphan_sweep_failed` line and the next pass still runs. */
export function startOrphanSweep(
  backend: PgS3Backend,
  opts: {
    intervalMs: number;
    graceMs: number;
    firstDelayMs: number;
    write?: (line: string) => void;
    sweep?: typeof sweepOrphans;
  },
): OrphanSweepTimer {
  const write = opts.write ?? ((line: string) => void process.stderr.write(line));
  const sweep = opts.sweep ?? sweepOrphans;
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;

  const run = async (): Promise<void> => {
    try {
      write(orphanSweepLine(await sweep(backend, { graceMs: opts.graceMs })));
    } catch (e) {
      write(`ev=orphan_sweep_failed error=${readyLabel(e)}\n`);
    }
    if (!stopped) schedule(opts.intervalMs);
  };
  const schedule = (ms: number): void => {
    timer = setTimeout(() => void run(), ms);
    timer.unref();
  };

  schedule(opts.firstDelayMs);
  return {
    stop() {
      stopped = true;
      clearTimeout(timer);
    },
  };
}

import { NextRequest, NextResponse } from 'next/server';
import { listRunLogsForSkill, readRunLogById, readSnapshotFiles } from '@/lib/fs/runlogs';
import { readAnnotation, annPathForRunLog } from '@/lib/fs/annotations';
import { deleteCandidate, releaseRunLog } from '@/lib/release';

/**
 * Run-log endpoint:
 *
 *   GET  /api/runlogs/<...id>  — read run log + annotation
 *   POST /api/runlogs/<...id>  — body `{action: "release"|"delete"}`
 *                                (Next.js catch-all routes can't have sibling
 *                                 paths underneath, so we dispatch on action
 *                                 in the request body instead of sub-paths.)
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string[] }> }) {
  const { id } = await params;
  const runLogId = id.map(decodeURIComponent).join('/');
  const found = await readRunLogById(runLogId);
  if (!found) return NextResponse.json({ error: 'not found' }, { status: 404 });
  let annotation;
  try {
    annotation = await readAnnotation(runLogId);
  } catch (err) {
    // The annotation file exists but is corrupt — either spliced by a
    // temp-name collision (unparseable JSON) or off-schema. Surface it as a
    // structured 422 — mirroring the sibling annotation route — so the page
    // can explain it instead of dying with a bare 500 and no way back. Carry
    // the file path explicitly rather than making the page parse it out of the
    // message, so the recovery `rm` line renders for both throw shapes.
    return NextResponse.json(
      { error: 'invalid_annotation', message: (err as Error).message, filePath: annPathForRunLog(runLogId) },
      { status: 422 },
    );
  }

  // Used by the client to decide whether Delete is offered: only candidates
  // whose version is above the latest release are deletable from the UI.
  // Historical candidates can still be removed by hand.
  const { runs } = await listRunLogsForSkill(found.runLog.skill);
  const latestReleasedVersion = runs
    .filter((r) => r.log.released && r.log.version != null)
    .reduce<number | null>((acc, r) => {
      const v = r.log.version as number;
      return acc == null || v > acc ? v : acc;
    }, null);

  // schema_version 3 snapshots hold digests, not content — the review panes
  // need the bytes, so read them fresh from disk for this run log only.
  const snapshotFiles = await readSnapshotFiles(found.runLog.snapshot);

  return NextResponse.json({
    runLog: found.runLog,
    annotation,
    id: runLogId,
    latestReleasedVersion,
    snapshotFiles,
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string[] }> }) {
  const { id } = await params;
  const runLogId = id.map(decodeURIComponent).join('/');

  let body: { action?: string };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const action = body.action;

  if (action === 'release') {
    try {
      const result = await releaseRunLog(runLogId);
      return NextResponse.json({ ok: true, ...result });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 400 });
    }
  }
  if (action === 'delete') {
    try {
      await deleteCandidate(runLogId);
      return NextResponse.json({ ok: true });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 400 });
    }
  }
  return NextResponse.json({ error: `unknown action: ${action ?? '(missing)'}` }, { status: 400 });
}

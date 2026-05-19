import { NextRequest, NextResponse } from 'next/server';
import { listRunLogsForSkill, readRunLogById } from '@/lib/fs/runlogs';
import { readAnnotation } from '@/lib/fs/annotations';
import { activateRunLog, previewActivate } from '@/lib/activate';
import { deleteCandidate, releaseRunLog } from '@/lib/release';

/**
 * Run-log endpoint:
 *
 *   GET  /api/runlogs/<...id>  — read run log + annotation
 *   POST /api/runlogs/<...id>  — body `{action: "activate"|"release"|"delete"}`
 *                                (Next.js catch-all routes can't have sibling
 *                                 paths underneath, so we dispatch on action
 *                                 in the request body instead of sub-paths.)
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string[] }> }) {
  const { id } = await params;
  const runLogId = id.map(decodeURIComponent).join('/');
  const found = await readRunLogById(runLogId);
  if (!found) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const annotation = await readAnnotation(runLogId);

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

  return NextResponse.json({
    runLog: found.runLog,
    annotation,
    id: runLogId,
    latestReleasedVersion,
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

  if (action === 'activate-preview') {
    const found = await readRunLogById(runLogId);
    if (!found) return NextResponse.json({ error: 'not found' }, { status: 404 });
    return NextResponse.json({ preview: previewActivate(found.runLog) });
  }
  if (action === 'activate') {
    const found = await readRunLogById(runLogId);
    if (!found) return NextResponse.json({ error: 'not found' }, { status: 404 });
    try {
      const written = await activateRunLog(found.runLog);
      return NextResponse.json({ ok: true, written });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 400 });
    }
  }
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

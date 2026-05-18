import { NextRequest, NextResponse } from 'next/server';
import { readRunLogById } from '@/lib/fs/runlogs';
import { readAnnotation } from '@/lib/fs/annotations';
import { compareRunLogs } from '@/lib/compare';

/**
 * Compare two run logs identified by `recent` and `previous` ids (each
 * is `<skill>/<filename-without-ext>`). Both must exist.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const recentId = sp.get('recent');
  const previousId = sp.get('previous');
  if (!recentId || !previousId) {
    return NextResponse.json({ error: 'recent and previous query params required' }, { status: 400 });
  }
  const [recent, previous] = await Promise.all([
    readRunLogById(recentId),
    readRunLogById(previousId),
  ]);
  if (!recent) return NextResponse.json({ error: `not found: ${recentId}` }, { status: 404 });
  if (!previous) return NextResponse.json({ error: `not found: ${previousId}` }, { status: 404 });

  const [recentAnn, previousAnn] = await Promise.all([
    readAnnotation(recentId),
    readAnnotation(previousId),
  ]);

  const result = compareRunLogs({
    recent: { log: recent.runLog, annotation: recentAnn },
    previous: { log: previous.runLog, annotation: previousAnn },
  });
  return NextResponse.json({
    recentId,
    previousId,
    ...result,
  });
}

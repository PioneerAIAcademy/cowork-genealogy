import { NextRequest, NextResponse } from 'next/server';
import { readRunLogById } from '@/lib/fs/runlogs';
import { readAnnotation } from '@/lib/fs/annotations';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string[] }> }) {
  const { id } = await params;
  // Each segment from Next is URL-decoded already; just join.
  const runLogId = id.map(decodeURIComponent).join('/');
  const found = await readRunLogById(runLogId);
  if (!found) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const annotation = await readAnnotation(runLogId);
  return NextResponse.json({ runLog: found.runLog, annotation, id: runLogId });
}

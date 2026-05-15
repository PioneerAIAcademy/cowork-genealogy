import { NextRequest, NextResponse } from 'next/server';
import { listRunLogs } from '@/lib/fs/runlogs';

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const annotatedParam = sp.get('annotated');
  let annotated: boolean | undefined;
  if (annotatedParam === 'true') annotated = true;
  else if (annotatedParam === 'false') annotated = false;
  const { runs, corrupt } = await listRunLogs({
    skill: sp.get('skill') ?? undefined,
    model: sp.get('model') ?? undefined,
    dateFrom: sp.get('dateFrom') ?? undefined,
    dateTo: sp.get('dateTo') ?? undefined,
    annotated,
  });
  return NextResponse.json({ runs, corrupt });
}

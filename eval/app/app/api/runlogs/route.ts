import { NextRequest, NextResponse } from 'next/server';
import { listRunLogs } from '@/lib/fs/runlogs';

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const { runs, corrupt } = await listRunLogs({
    skill: sp.get('skill') ?? undefined,
    releasableOnly: sp.get('releasable') === 'true' ? true : undefined,
  });
  return NextResponse.json({ runs, corrupt });
}

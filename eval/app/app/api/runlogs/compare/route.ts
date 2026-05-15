import { NextRequest, NextResponse } from 'next/server';
import { listRunLogsInDir } from '@/lib/fs/runlogs';
import { compareRunLogs } from '@/lib/compare';

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const skill = sp.get('skill');
  const model = sp.get('model');
  if (!skill || !model) {
    return NextResponse.json({ error: 'skill and model query params required' }, { status: 400 });
  }
  const { runs, corrupt } = await listRunLogsInDir(skill, model);
  const result = compareRunLogs(runs);
  return NextResponse.json({ skill, model, ...result, corrupt });
}

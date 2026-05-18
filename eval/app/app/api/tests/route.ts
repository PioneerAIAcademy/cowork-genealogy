import { NextRequest, NextResponse } from 'next/server';
import { listTests, writeTest, nextTestId } from '@/lib/fs/tests';
import type { UnitTestFile } from '@/lib/types';

export async function GET() {
  const { tests, corrupt } = await listTests();
  return NextResponse.json({ tests, corrupt });
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as Partial<UnitTestFile> & { test?: { skill?: string; id?: string } };
  if (!body?.test?.skill) {
    return NextResponse.json({ error: 'test.skill is required' }, { status: 400 });
  }
  if (!body.test.id) {
    body.test.id = await nextTestId(body.test.skill);
  }
  const filePath = await writeTest(body as UnitTestFile);
  return NextResponse.json({ ok: true, id: body.test.id, filePath });
}

import { NextRequest, NextResponse } from 'next/server';
import { readTest, writeTest, deleteTest } from '@/lib/fs/tests';
import type { UnitTestFile } from '@/lib/types';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const found = await readTest(id);
  if (!found) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ test: found.test, filePath: found.filePath });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json()) as UnitTestFile;
  if (body?.test?.id !== id) {
    return NextResponse.json({ error: 'id mismatch between URL and payload' }, { status: 400 });
  }
  const filePath = await writeTest(body);
  return NextResponse.json({ ok: true, filePath });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ok = await deleteTest(id);
  if (!ok) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

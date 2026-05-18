import { NextRequest, NextResponse } from 'next/server';
import { readFixture, testsReferencingFixture } from '@/lib/fs/fixtures';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const fixture = await readFixture(name);
  if (!fixture) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const references = await testsReferencingFixture(name);
  return NextResponse.json({ fixture, references });
}

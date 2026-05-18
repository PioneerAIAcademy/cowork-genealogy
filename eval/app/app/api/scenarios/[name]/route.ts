import { NextRequest, NextResponse } from 'next/server';
import { readScenario, testsReferencingScenario } from '@/lib/fs/scenarios';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const scenario = await readScenario(name);
  if (!scenario) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const references = await testsReferencingScenario(name);
  return NextResponse.json({ scenario, references });
}

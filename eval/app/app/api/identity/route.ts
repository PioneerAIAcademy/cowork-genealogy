import { NextRequest, NextResponse } from 'next/server';
import { getIdentity, setIdentity } from '@/lib/identity';

export async function GET() {
  const annotator = await getIdentity();
  return NextResponse.json(annotator ? { resolved: true, annotator } : { resolved: false });
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { annotator?: string };
  if (!body?.annotator || body.annotator.trim() === '') {
    return NextResponse.json({ error: 'annotator is required' }, { status: 400 });
  }
  await setIdentity(body.annotator.trim());
  return NextResponse.json({ ok: true, annotator: body.annotator.trim() });
}

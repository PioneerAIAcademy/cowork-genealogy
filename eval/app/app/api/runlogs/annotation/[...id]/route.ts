import { NextRequest, NextResponse } from 'next/server';
import { readAnnotation, writeAnnotation } from '@/lib/fs/annotations';
import { getIdentity } from '@/lib/identity';
import path from 'node:path';
import type { AnnotationFile } from '@/lib/types';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string[] }> }) {
  const { id } = await params;
  const runLogId = id.join('/');
  const annotation = await readAnnotation(runLogId);
  return NextResponse.json({ annotation });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string[] }> }) {
  const { id } = await params;
  const runLogId = id.join('/');
  const body = (await req.json()) as Partial<AnnotationFile>;

  const identity = await getIdentity();
  if (!identity) {
    return NextResponse.json({ error: 'identity_unresolved' }, { status: 409 });
  }

  const filename = path.basename(runLogId) + '.json';
  const annotation: AnnotationFile = {
    run_log: filename,
    annotator: identity,
    corrections: body.corrections ?? [],
  };
  const filePath = await writeAnnotation(runLogId, annotation);
  return NextResponse.json({ ok: true, filePath, annotation });
}

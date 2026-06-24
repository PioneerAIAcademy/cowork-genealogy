import { NextRequest, NextResponse } from 'next/server';
import { readAnnotation, writeAnnotation } from '@/lib/fs/annotations';
import { getIdentity } from '@/lib/identity';
import path from 'node:path';
import type { AnnotationFile } from '@/lib/types';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string[] }> }) {
  const { id } = await params;
  const runLogId = id.map(decodeURIComponent).join('/');
  try {
    const annotation = await readAnnotation(runLogId);
    return NextResponse.json({ annotation });
  } catch (err) {
    // The annotation file exists but is malformed (bad JSON or off-schema —
    // e.g. a hand-written file). Surface it instead of 500ing opaquely.
    return NextResponse.json(
      { error: 'invalid_annotation', message: (err as Error).message },
      { status: 422 },
    );
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string[] }> }) {
  const { id } = await params;
  const runLogId = id.map(decodeURIComponent).join('/');
  const body = (await req.json()) as Partial<AnnotationFile>;

  const identity = await getIdentity();
  if (!identity) {
    return NextResponse.json({ error: 'identity_unresolved' }, { status: 409 });
  }

  // The run log filename is the last path segment; ".json" suffix.
  const filename = path.basename(runLogId) + '.json';
  const annotation: AnnotationFile = {
    run_log: filename,
    annotator: identity,
    corrections: body.corrections ?? [],
  };
  try {
    const filePath = await writeAnnotation(runLogId, annotation);
    return NextResponse.json({ ok: true, filePath, annotation });
  } catch (err) {
    // Schema validation failed — never persist a malformed annotation.
    return NextResponse.json(
      { error: 'invalid_annotation', message: (err as Error).message },
      { status: 400 },
    );
  }
}

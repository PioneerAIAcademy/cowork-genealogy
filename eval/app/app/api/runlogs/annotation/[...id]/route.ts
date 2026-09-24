import { NextRequest, NextResponse } from 'next/server';
import { newAnnotation, readAnnotation, upsertCorrection, writeAnnotation } from '@/lib/fs/annotations';
import { getIdentity } from '@/lib/identity';
import path from 'node:path';
import type { AnnotationCorrection, AnnotationFile } from '@/lib/types';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string[] }> }) {
  const { id } = await params;
  // Next has ALREADY decoded these catch-all segments. Decoding again turned a
  // double-encoded separator into a real one AFTER normalisation had run, so a
  // traversal reached the path sinks looking clean. Join what Next gave us.
  const runLogId = id.join('/');
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
  // Next has ALREADY decoded these catch-all segments. Decoding again turned a
  // double-encoded separator into a real one AFTER normalisation had run, so a
  // traversal reached the path sinks looking clean. Join what Next gave us.
  const runLogId = id.join('/');
  const body = (await req.json()) as Partial<AnnotationFile>;

  const identity = await getIdentity();
  if (!identity) {
    return NextResponse.json({ error: 'identity_unresolved' }, { status: 409 });
  }

  if (!body.corrections) {
    return NextResponse.json(
      { error: 'missing_corrections', message: 'PUT requires an explicit corrections array.' },
      { status: 400 },
    );
  }

  // The run log filename is the last path segment; ".json" suffix.
  const filename = path.basename(runLogId) + '.json';

  // Preserve the existing annotator; stamp identity only on file creation
  // (issue #2487 — re-stamping on every save destroys attribution).
  const existing = await readAnnotation(runLogId);
  const annotation: AnnotationFile = {
    run_log: filename,
    annotator: existing?.annotator || identity,
    corrections: body.corrections,
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

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string[] }> }) {
  const { id } = await params;
  const runLogId = id.join('/');
  const body = (await req.json()) as AnnotationCorrection;

  const identity = await getIdentity();
  if (!identity) {
    return NextResponse.json({ error: 'identity_unresolved' }, { status: 409 });
  }

  const filename = path.basename(runLogId) + '.json';
  const existing = await readAnnotation(runLogId);
  const base = existing ?? newAnnotation(filename, identity);
  const updated = upsertCorrection(base, body);

  try {
    const filePath = await writeAnnotation(runLogId, updated);
    return NextResponse.json({ ok: true, filePath, annotation: updated });
  } catch (err) {
    return NextResponse.json(
      { error: 'invalid_annotation', message: (err as Error).message },
      { status: 400 },
    );
  }
}

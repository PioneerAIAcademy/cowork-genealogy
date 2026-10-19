import { NextRequest, NextResponse } from 'next/server';
import { correctionSchema, newAnnotation, readAnnotation, upsertCorrection, writeAnnotation } from '@/lib/fs/annotations';
import { getIdentity } from '@/lib/identity';
import path from 'node:path';
import type { AnnotationCorrection, AnnotationFile } from '@/lib/types';

// Per-runLogId serialization: PATCH (and PUT) do read→mutate→write, so
// concurrent calls on the same annotation race. Chain them through a
// promise-based lock keyed on the run log id.
const annotationLocks = new Map<string, Promise<unknown>>();
function withAnnotationLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const next = (annotationLocks.get(key) ?? Promise.resolve()).then(fn, fn);
  annotationLocks.set(key, next.catch(() => undefined));
  return next;
}

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

  return withAnnotationLock(runLogId, async () => {
    // Preserve the existing annotator; stamp identity only on file creation
    // (issue #2487 — re-stamping on every save destroys attribution).
    let existing: Awaited<ReturnType<typeof readAnnotation>>;
    try {
      existing = await readAnnotation(runLogId);
    } catch {
      // Corrupt existing file — let the PUT overwrite it (the recovery path).
      existing = null;
    }
    const annotation: AnnotationFile = {
      run_log: filename,
      annotator: existing?.annotator || identity,
      corrections: body.corrections!,
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
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string[] }> }) {
  const { id } = await params;
  const runLogId = id.join('/');
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json(
      { error: 'invalid_correction', message: 'Request body is not valid JSON.' },
      { status: 400 },
    );
  }
  const parsed = correctionSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    return NextResponse.json(
      { error: 'invalid_correction', message: `Bad correction: ${issues}` },
      { status: 400 },
    );
  }
  const body = parsed.data as AnnotationCorrection;

  const identity = await getIdentity();
  if (!identity) {
    return NextResponse.json({ error: 'identity_unresolved' }, { status: 409 });
  }

  const filename = path.basename(runLogId) + '.json';

  return withAnnotationLock(runLogId, async () => {
    let existing: Awaited<ReturnType<typeof readAnnotation>>;
    try {
      existing = await readAnnotation(runLogId);
    } catch (err) {
      // PATCH merges into an existing document. A corrupt file cannot be merged
      // into — silently dropping its corrections is the thing #2487 exists to
      // prevent. Return 422 so the caller knows the file needs manual repair.
      // PUT replaces the whole document, so its catch is defensible; PATCH's is not.
      return NextResponse.json(
        { error: 'corrupt_annotation', message: (err as Error).message },
        { status: 422 },
      );
    }
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
  });
}

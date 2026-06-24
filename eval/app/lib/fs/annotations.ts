/**
 * Read / write `.ann.json` files alongside their run logs.
 *
 * Schema v2: sparse. Each correction entry is keyed by
 * `(test_id, dimension_source, dimension_name)`. Missing entries mean
 * the annotator hasn't reviewed that dimension; explicit entries mean
 * they have (whether they agreed or disagreed).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { runlogsUnitDir } from '../paths';
import { atomicWriteJson } from './atomic';
import type { AnnotationCorrection, AnnotationFile, RunLogFile } from '../types';

/**
 * Strict schema for one correction, mirroring `$defs/correction` in
 * docs/specs/schemas/ann.schema.json. Hand-maintained on purpose: the
 * generated AnnotationSchema (lib/schema/annotation.ts) types `corrections`
 * as `z.array(z.any())` because json-schema-to-zod does not resolve the
 * `$ref` to `$defs/correction` — so it validates nothing about each entry.
 * If you change the correction shape in ann.schema.json, update this too.
 */
const scoreSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.null()]);
const correctionSchema = z
  .object({
    test_id: z.string().regex(/^ut_/),
    dimension_source: z.enum(['base', 'rubric']),
    dimension_name: z.string(),
    llm_score: scoreSchema,
    corrected_score: scoreSchema,
    comment: z.string().nullable().optional(),
  })
  .strict();

const annotationFileSchema = z
  .object({
    run_log: z.string(),
    annotator: z.string(),
    corrections: z.array(correctionSchema),
  })
  .strict();

/**
 * Validate an annotation object against the canonical v2 (sparse) schema and
 * return it typed. Throws a descriptive Error listing the first offending
 * entries. Called on both read and write so a hand-written or stale-tool
 * `.ann.json` — notably the deprecated `run_index`/`dimension`/`source` shape
 * that Claude emits when asked to write the file directly — is rejected at the
 * source instead of silently merged. Annotations must come from the CRUD UI.
 */
export function validateAnnotation(value: unknown): AnnotationFile {
  const result = annotationFileSchema.safeParse(value);
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new Error(
      `Invalid annotation: ${issues}. Annotations must be written by the CRUD ` +
        `UI, not by hand; the legacy run_index/dimension/source correction ` +
        `shape is no longer accepted. Delete the file and re-review in the UI.`,
    );
  }
  return result.data as AnnotationFile;
}

function annPathForRunLog(runLogId: string): string {
  return path.join(runlogsUnitDir(), `${runLogId}.ann.json`);
}

export async function readAnnotation(runLogId: string): Promise<AnnotationFile | null> {
  const filePath = annPathForRunLog(runLogId);
  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch {
    return null; // no annotation file yet — not an error
  }
  // A file that exists but is unparseable / off-schema is a real problem
  // (silently discarding it is how corrupt annotations used to accrete).
  // Surface it loudly rather than returning null.
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Annotation file ${filePath} is not valid JSON: ${(err as Error).message}`);
  }
  return validateAnnotation(parsed);
}

export async function writeAnnotation(runLogId: string, annotation: AnnotationFile): Promise<string> {
  // Reject bad shapes at the source: the UI must never persist (or merge into)
  // a malformed annotation.
  validateAnnotation(annotation);
  const filePath = annPathForRunLog(runLogId);
  await atomicWriteJson(filePath, annotation);
  return filePath;
}

export async function deleteAnnotation(runLogId: string): Promise<void> {
  const filePath = annPathForRunLog(runLogId);
  await fs.rm(filePath, { force: true });
}

/**
 * Return the set of unreviewed `(test_id, dimension_source,
 * dimension_name)` triples — dimensions present in the run log but
 * missing from the annotation. Used by:
 *   - The scoring UI to show which dimensions remain
 *   - The GH Action's completeness rule (rule 3)
 */
export function unreviewedDimensions(
  log: RunLogFile,
  ann: AnnotationFile | null,
): Array<{ test_id: string; dimension_source: string; dimension_name: string }> {
  const have = new Set(
    (ann?.corrections ?? []).map(
      (c) => `${c.test_id}|${c.dimension_source}|${c.dimension_name}`,
    ),
  );
  const out: Array<{ test_id: string; dimension_source: string; dimension_name: string }> = [];
  for (const t of log.tests) {
    for (const d of t.outcome_summary.aggregated_dimensions) {
      const key = `${t.test_id}|${d.source}|${d.name}`;
      if (!have.has(key)) {
        out.push({
          test_id: t.test_id,
          dimension_source: d.source,
          dimension_name: d.name,
        });
      }
    }
  }
  return out;
}

export function isAnnotationComplete(log: RunLogFile, ann: AnnotationFile | null): boolean {
  return unreviewedDimensions(log, ann).length === 0;
}

/**
 * Build a fresh AnnotationFile shell. The CRUD UI populates corrections
 * as the annotator reviews dimensions; this is the seed when none
 * exists.
 */
export function newAnnotation(runLogFilename: string, annotator: string): AnnotationFile {
  return {
    run_log: runLogFilename,
    annotator,
    corrections: [],
  };
}

/**
 * Upsert a single dimension's correction into the annotation. Pure
 * function; the caller persists via writeAnnotation.
 */
export function upsertCorrection(
  ann: AnnotationFile,
  correction: AnnotationCorrection,
): AnnotationFile {
  const key = (c: AnnotationCorrection) =>
    `${c.test_id}|${c.dimension_source}|${c.dimension_name}`;
  const next = ann.corrections.filter((c) => key(c) !== key(correction));
  next.push(correction);
  return { ...ann, corrections: next };
}

/**
 * Remove a single dimension's correction from the annotation. Used when
 * the annotator clears a previously-reviewed dimension.
 */
export function deleteCorrection(
  ann: AnnotationFile,
  test_id: string,
  dimension_source: string,
  dimension_name: string,
): AnnotationFile {
  return {
    ...ann,
    corrections: ann.corrections.filter(
      (c) =>
        !(
          c.test_id === test_id &&
          c.dimension_source === dimension_source &&
          c.dimension_name === dimension_name
        ),
    ),
  };
}

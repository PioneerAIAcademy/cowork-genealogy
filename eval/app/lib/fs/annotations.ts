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
import { runlogsUnitDir } from '../paths';
import { atomicWriteJson } from './atomic';
import type { AnnotationCorrection, AnnotationFile, RunLogFile } from '../types';

function annPathForRunLog(runLogId: string): string {
  return path.join(runlogsUnitDir(), `${runLogId}.ann.json`);
}

export async function readAnnotation(runLogId: string): Promise<AnnotationFile | null> {
  const filePath = annPathForRunLog(runLogId);
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as AnnotationFile;
  } catch {
    return null;
  }
}

export async function writeAnnotation(runLogId: string, annotation: AnnotationFile): Promise<string> {
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

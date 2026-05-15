/**
 * Read / write `.ann.json` files alongside their run logs.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { runlogsUnitDir } from '../paths';
import { atomicWriteJson } from './atomic';
import type { AnnotationFile } from '../types';

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

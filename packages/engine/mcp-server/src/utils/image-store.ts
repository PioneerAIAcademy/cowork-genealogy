// image-store — host-side persistence of source page-scan JPEGs (§8.5, design B).
// image_transcribe saves the fetched scan to images/<key>.jpg when given a
// projectPath and returns the project-relative ref; the caller records it as the
// source's `image_filename`. Only RETAINED-source images survive: research_append
// runs a best-effort TTL sweep (gcUnreferencedImages) that removes images/*.jpg
// no source cites and older than the TTL — so a just-transcribed-but-uncited scan
// ages out instead of lingering. Same discipline as results-staging's pruneStale;
// here a GC sweep replaces staging→finalize because a source carries no imageId to
// key a finalize on. Spec: docs/specs/image-transcribe-tool-spec.md §8.5.

import { writeFile, readdir, stat, unlink, mkdir } from "fs/promises";
import { join } from "path";

/** Project-relative directory holding retained source scans. */
export const IMAGES_SUBDIR = "images";

// Persisted source images whose read was CAPPED, keyed `${projectPath}\0${imageRef}`
// — the same `images/<key>.jpg` string a source records as `image_filename`. A
// capped read returns its partial transcription verbatim beside `truncated: true`,
// so the fact is known at the read; but `record-extractor` relays that text across
// a subagent boundary and never sees the flag, so `transcription_truncated` is
// derived at the write boundary instead: research_append joins a source's
// `image_filename` against this set (`wasSourceImageTruncated`) and sets the field
// from it (#2457). It lives here, not in image-transcribe.ts, because both the
// writer (image_transcribe) and the reader (research_append) already import this
// module — a tool→tool import would be the alternative, and image_filename is
// exactly the imageRef this module mints. Process-lifetime, never persisted; a
// group-only or global key would leak one project's cap into another, so it is
// keyed by project as browseBudgetSeen is. Only reads that PERSISTED an image land
// here (an imageRef is what a source cites); a read with no projectPath leaves no
// image_filename to join, the known limitation in image-transcribe-tool-spec §5.8.
// image_filename, not imageId, is the key because it is the only identifier both
// tools share — an ARK read gets one too, so an ARK read is NOT the blind spot the
// browse budget's imageId keying has.
const truncatedSourceImages = new Set<string>();

function truncatedImageKey(projectPath: string, imageRef: string): string {
  return `${projectPath}\0${imageRef}`;
}

/** Record (or clear) whether this project's persisted source image was read past
 *  the OCR output-token cap. Add-or-remove rather than add-only, so a later clean
 *  read of the same image — e.g. after an OCR model change — retracts a stale cap
 *  instead of leaving a whole read marked partial. */
export function recordImageReadCap(
  projectPath: string,
  imageRef: string,
  truncated: boolean,
): void {
  const key = truncatedImageKey(projectPath, imageRef);
  if (truncated) truncatedSourceImages.add(key);
  else truncatedSourceImages.delete(key);
}

/** Whether image_transcribe capped its read of the source image a research.json
 *  source cites via `image_filename` — the join research_append uses to derive
 *  `transcription_truncated` at the write boundary. */
export function wasSourceImageTruncated(
  projectPath: string,
  imageFilename: string,
): boolean {
  return truncatedSourceImages.has(truncatedImageKey(projectPath, imageFilename));
}

/** Test-only reset — the Set is module-level and persists across `it()` blocks. */
export function __clearTruncatedSourceImagesForTests(): void {
  truncatedSourceImages.clear();
}

/** Unreferenced scans older than this are pruned opportunistically. Matches the
 *  results-staging TTL — long enough that a scan survives from transcription to
 *  the research_append that cites it, short enough to bound uncited bloat. */
const IMAGE_GC_TTL_MS = 24 * 60 * 60 * 1000;

/** Filesystem-safe, stable filename from an imageId or ARK label. The same scan
 *  always maps to the same file (re-transcribing overwrites in place). */
export function imageFilenameFor(imageKey: string): string {
  const safe = imageKey
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `${safe || "image"}.jpg`;
}

/**
 * Save a page-scan JPEG to `<projectPath>/images/<key>.jpg` and return the
 * project-relative ref (`images/<key>.jpg`). Throws if projectPath is not an
 * existing directory (never scaffold under a typo'd path), matching
 * stageSearchResults.
 */
export async function saveSourceImage(args: {
  projectPath: string;
  imageKey: string;
  bytes: Uint8Array;
}): Promise<string> {
  const { projectPath, imageKey, bytes } = args;

  let st;
  try {
    st = await stat(projectPath);
  } catch {
    throw new Error(`projectPath '${projectPath}' does not exist`);
  }
  if (!st.isDirectory()) {
    throw new Error(`projectPath '${projectPath}' is not a directory`);
  }

  const name = imageFilenameFor(imageKey);
  await mkdir(join(projectPath, IMAGES_SUBDIR), { recursive: true });
  await writeFile(join(projectPath, IMAGES_SUBDIR, name), Buffer.from(bytes));
  return `${IMAGES_SUBDIR}/${name}`;
}

/**
 * Best-effort GC: remove `images/*.jpg` that no retained source cites (not in
 * `referenced`) AND that are older than the TTL. TTL-gating is what makes it
 * race-safe — a scan just saved by image_transcribe survives until the
 * research_append that cites it (kept) or the TTL elapses (pruned). Never throws;
 * a lost race or a stat failure is harmless.
 *
 * @param referenced project-relative refs still in use (from sources[].image_filename).
 */
export async function gcUnreferencedImages(
  projectPath: string,
  referenced: Set<string>,
): Promise<void> {
  const dir = join(projectPath, IMAGES_SUBDIR);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return; // no images/ dir yet — nothing to GC
  }
  const cutoff = Date.now() - IMAGE_GC_TTL_MS;
  await Promise.all(
    names
      .filter((n) => n.endsWith(".jpg"))
      .map(async (n) => {
        if (referenced.has(`${IMAGES_SUBDIR}/${n}`)) return;
        const p = join(dir, n);
        try {
          const s = await stat(p);
          if (s.mtimeMs < cutoff) await unlink(p);
        } catch {
          // best-effort: ignore ENOENT / races / stat failures
        }
      }),
  );
}

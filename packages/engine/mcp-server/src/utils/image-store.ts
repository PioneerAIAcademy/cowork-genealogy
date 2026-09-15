// image-store — host-side persistence of source page-scan JPEGs (§8.5, design B).
// image_transcribe saves the fetched scan to images/<key>.jpg when given a
// projectPath and returns the project-relative ref; the caller records it as the
// source's `image_filename`. Only RETAINED-source images survive: research_append
// runs a best-effort TTL sweep (gcUnreferencedImages) that removes images/*.jpg
// no source cites and older than the TTL — so a just-transcribed-but-uncited scan
// ages out instead of lingering. Same discipline as results-staging's pruneStale;
// here a GC sweep replaces staging→finalize because a source carries no imageId to
// key a finalize on. Spec: docs/specs/image-transcribe-tool-spec.md §8.5.
//
// All I/O goes through the active ProjectStore; this module owns the naming and
// the retention rule only.

import { getProjectStore } from "../store/project-store.js";

/** Project-relative directory holding retained source scans. */
export const IMAGES_SUBDIR = "images";

// What image_transcribe learned about each persisted source image's read, keyed
// `${projectPath}\0${imageRef}` — the same `images/<key>.jpg` string a source
// records as `image_filename`. TRI-STATE, deliberately (#2457 ruling amendment a):
//   true    = verified PARTIAL (the read hit the OCR output-token cap)
//   false   = verified WHOLE   (the read completed)
//   absent  = NOT ESTABLISHED  (no read reached here for this image)
// A capped read returns its partial transcription verbatim beside `truncated: true`,
// so the fact is known at the read; but `record-extractor` relays that text across
// a subagent boundary and never sees the flag, so `transcription_truncated` is
// derived at the write boundary instead: research_append joins a source's
// `image_filename` against this map (`sourceImageCapState`) and sets the field from
// it. `false` matters as much as `true`: it is what lets the derivation CLEAR a
// stale `true` on a later clean read — a `Set` (present/absent) could set the flag
// but never unset it, since `delete` on an update's patch only drops the key and
// the merge then keeps the persisted `true`. It lives here, not in
// image-transcribe.ts, because both the writer (image_transcribe) and the reader
// (research_append) already import this module. Process-lifetime, never persisted;
// keyed by project (a global key would leak one project's cap into another) as
// browseBudgetSeen is. Only reads that PERSISTED an image land here (an imageRef is
// what a source cites); a read with no projectPath leaves no image_filename to
// join, the known limitation in image-transcribe-tool-spec §8.6. image_filename,
// not imageId, is the key because it is the only identifier both tools share — an
// ARK read gets one too, so an ARK read is NOT the browse-budget imageId blind spot.
const sourceImageCaps = new Map<string, boolean>();

function truncatedImageKey(projectPath: string, imageRef: string): string {
  // projectPath arrives raw from an LLM relay, so a record under `/p/` and a query
  // under `/p` must join — strip the trailing separator on both sides. imageRef is
  // module-minted (canonical) and needs none. Without this the record/query
  // symmetry placeSearchCache relies on is lost and a capped read reads back clean.
  return `${projectPath.replace(/[/\\]+$/, "")}\0${imageRef}`;
}

/** Record whether this project's persisted source image was read past the OCR
 *  output-token cap. Stores the outcome either way (`true` partial, `false` whole)
 *  rather than deleting on a clean read — the `false` is what lets a later write
 *  clear a stale `true` instead of leaving a whole read marked partial. */
export function recordImageReadCap(
  projectPath: string,
  imageRef: string,
  truncated: boolean,
): void {
  sourceImageCaps.set(truncatedImageKey(projectPath, imageRef), truncated);
}

/** Tri-state read of what image_transcribe learned about the image a research.json
 *  source cites via `image_filename`: `true` verified partial, `false` verified
 *  whole, `undefined` not established. The join research_append uses to derive
 *  `transcription_truncated` at the write boundary. */
export function sourceImageCapState(
  projectPath: string,
  imageFilename: string,
): boolean | undefined {
  return sourceImageCaps.get(truncatedImageKey(projectPath, imageFilename));
}

/** Whether the cited image was verified PARTIAL (`true` only — `false`/unknown both
 *  read as "not partial"). The badge-side question, distinct from the tri-state the
 *  derivation needs. */
export function wasSourceImageTruncated(
  projectPath: string,
  imageFilename: string,
): boolean {
  return sourceImageCapState(projectPath, imageFilename) === true;
}

/** Test-only reset — the Map is module-level and persists across `it()` blocks. */
export function __clearTruncatedSourceImagesForTests(): void {
  sourceImageCaps.clear();
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
  const store = getProjectStore();

  const state = await store.projectDirState(projectPath);
  if (state === "missing") {
    throw new Error(`projectPath '${projectPath}' does not exist`);
  }
  if (state === "not_directory") {
    throw new Error(`projectPath '${projectPath}' is not a directory`);
  }

  const ref = `${IMAGES_SUBDIR}/${imageFilenameFor(imageKey)}`;
  await store.writeBytes(projectPath, ref, bytes);
  return ref;
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
  const store = getProjectStore();
  let entries;
  try {
    entries = await store.list(projectPath, IMAGES_SUBDIR);
  } catch {
    return; // an unusable projectPath — nothing to GC
  }
  const cutoff = Date.now() - IMAGE_GC_TTL_MS;
  await Promise.all(
    entries
      .filter((e) => e.name.endsWith(".jpg"))
      .map(async (e) => {
        const ref = `${IMAGES_SUBDIR}/${e.name}`;
        if (referenced.has(ref)) return;
        if (e.mtimeMs < cutoff) await store.remove(projectPath, ref);
      }),
  );
}

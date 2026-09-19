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
// records as `image_filename`. Values (#2457 B1/B2 ruling 2026-09-19):
//   true    = verified PARTIAL (the read hit the OCR output-token cap)
//   false   = verified WHOLE   (the read completed) — MEMORY ONLY, never persisted
//   absent  = NOT ESTABLISHED  (no read reached here for this image)
// A capped read returns its partial transcription verbatim beside `truncated: true`,
// so the fact is known at the read; but `record-extractor` relays that text across
// a subagent boundary and never sees the flag, so `transcription_truncated` is
// derived at the write boundary instead: research_append joins a source's
// `image_filename` against this map (`sourceImageCapState`) and persists `true` or
// nothing — never `false`. The single invariant is that nothing moves from
// PARTIAL to WHOLE, in memory or in the document: this Map is STICKY-`true`
// (recordImageReadCap drops a `false` when a `true` already stands for the key),
// and the derivation writes `true` or deletes. `false` exists only so the
// derivation reads it as "not true" and leaves the marker off; it is never a
// document value. That is why a wrong-but-resolvable `image_filename` can add an
// unneeded `true` badge but can never stamp a whole transcription "verified whole".
// It lives here, not in image-transcribe.ts, because both the writer
// (image_transcribe) and the reader (research_append) already import this module.
// Process-lifetime, never persisted; keyed by project (a global key would leak one
// project's cap into another) as browseBudgetSeen is. Only reads that PERSISTED an
// image land here (an imageRef is what a source cites); a read with no projectPath
// leaves no image_filename to join, the known limitation in
// image-transcribe-tool-spec §8.6. image_filename, not imageId, is the key because
// it is the only identifier both tools share — an ARK read gets one too, so an ARK
// read is NOT the browse-budget imageId blind spot.
const sourceImageCaps = new Map<string, boolean>();

/** Canonicalize an image ref/filename that arrives raw from an LLM relay:
 *  backslashes → forward slashes, drop a leading `./`. The write side mints a
 *  canonical `images/<key>.jpg`, but a source's `image_filename` on the read side
 *  (the cap join) and in the GC's referenced set can be spelled `./images/x.jpg`
 *  or with backslashes, so both must canonicalize the same way or they miss. */
function normalizeImageRef(ref: string): string {
  return ref.replace(/\\/g, "/").replace(/^\.\//, "");
}

function truncatedImageKey(projectPath: string, imageRef: string): string {
  // Both halves arrive raw from an LLM relay, so a record and a query can spell the
  // same thing differently and must still join. Normalize backslashes to forward
  // slashes on both sides (a Windows caller can record under `C:\Users\…` and query
  // `C:/Users/…`), strip a trailing separator on projectPath (record `/p/`, query
  // `/p`), and canonicalize imageRef (see normalizeImageRef) so `./images/x.jpg`
  // joins `images/x.jpg`. Without any of these the record/query symmetry is lost
  // and a capped read reads back clean (#2457).
  const proj = projectPath.replace(/\\/g, "/").replace(/\/+$/, "");
  return `${proj}\0${normalizeImageRef(imageRef)}`;
}

/** Record whether this project's persisted source image was read past the OCR
 *  output-token cap. STICKY-`true` (#2457 B1 ruling 2026-09-19): once an image
 *  reads capped, no later read in this process clears it — a `false` is dropped
 *  when a `true` already stands for that key. The cap bounds output tokens and
 *  the OCR prompt varies with `lookingFor`, so a second, narrower read of the
 *  same image can come back uncapped; without stickiness that later `false` would
 *  overwrite the `true` and stamp read 1's partial text "verified whole". A
 *  genuine "read it whole now" needs a bigger cap, which needs a rebuild+restart,
 *  which empties this process-lifetime store — so nothing legitimate is lost.
 *  Invariant: the cap store never moves an image from partial (`true`) to whole
 *  (`false`). */
export function recordImageReadCap(
  projectPath: string,
  imageRef: string,
  truncated: boolean,
): void {
  const key = truncatedImageKey(projectPath, imageRef);
  if (!truncated && sourceImageCaps.get(key) === true) return; // sticky: never true → false
  sourceImageCaps.set(key, truncated);
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
  // Canonicalize the referenced set the same way the cap join does, so a source
  // citing `./images/x.jpg` (or a backslash spelling) still protects the file
  // `images/x.jpg` from the sweep. Without this the normalization the cap join
  // relies on would let the GC delete a scan a source actually cites (#2457 r4 note 6).
  const normalizedReferenced = new Set([...referenced].map(normalizeImageRef));
  await Promise.all(
    entries
      .filter((e) => e.name.endsWith(".jpg"))
      .map(async (e) => {
        const ref = `${IMAGES_SUBDIR}/${e.name}`;
        if (normalizedReferenced.has(ref)) return;
        if (e.mtimeMs < cutoff) await store.remove(projectPath, ref);
      }),
  );
}

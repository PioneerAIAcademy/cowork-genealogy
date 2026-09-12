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

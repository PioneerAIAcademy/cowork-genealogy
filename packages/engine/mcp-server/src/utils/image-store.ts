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

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

import { posix } from "node:path";
import { getProjectStore } from "../store/project-store.js";

/** Project-relative directory holding retained source scans. */
export const IMAGES_SUBDIR = "images";

// The set of persisted source images image_transcribe read PAST the OCR
// output-token cap, keyed `${projectId-or-projectPath}\0${imageRef}` — the imageRef
// being the same `images/<key>.jpg` string a source records as `image_filename`,
// and the scope being the bound store's patron-isolating projectId where there is
// one, else the projectPath (see truncatedImageKey). Membership means "verified
// PARTIAL"; absence means "not established" (either a whole read or no read here).
// TRUE-or-ABSENT, add-only (#2457 B1/B2 rulings, C 2026-09-21): a whole read records
// nothing, so once an image is in the set it stays — stickiness by construction. The
// single invariant is that nothing moves from PARTIAL to WHOLE, in memory or in the
// document. A capped read returns its partial transcription verbatim beside
// `truncated: true`, but `record-extractor` relays that text across a subagent
// boundary and never sees the flag, so `transcription_truncated` is derived at the
// write boundary instead: research_append joins a source's `image_filename` against
// this set (`sourceImageCapState`) and persists `true` or nothing. That is why a
// wrong-but-resolvable `image_filename` can add an unneeded `true` badge but can
// never stamp a whole transcription "verified whole". It lives here, not in
// image-transcribe.ts, because both the writer (image_transcribe) and the reader
// (research_append) already import this module. Process-lifetime, never persisted
// (as browseBudgetSeen is); keyed by the bound store's projectId when it has one —
// patron isolation under the shared-process http.ts entrypoint, where every request
// presents the same anchor projectPath — else by projectPath. Only reads that
// PERSISTED an image land here (an imageRef is what a source cites); a read with no
// projectPath leaves no image_filename to join, the known limitation in
// image-transcribe-tool-spec §8.6. image_filename, not imageId, is the key because
// it is the only identifier both tools share — an ARK read gets one too, so an ARK
// read is NOT the browse-budget imageId blind spot.
const sourceImageCaps = new Set<string>();

/** Canonicalize an image ref/filename that arrives raw from an LLM relay. The
 *  write side mints a canonical `images/<key>.jpg`, but a source's `image_filename`
 *  on the read side (the cap join) and in the GC's referenced set can be spelled
 *  `./images/x.jpg`, `images//x.jpg`, `images/./x.jpg`, or with backslashes, so
 *  both must canonicalize the same way or they miss — the GC miss silently deletes
 *  a *cited* scan past its TTL. `posix.normalize` folds backslash→`/` (after the
 *  split-join), a leading `./`, doubled `//`, and interior `/./` the same way
 *  `assertRelativeRef` does, without its throwing project-escape checks (this is a
 *  cache/GC key, not a store write). */
function normalizeImageRef(ref: string): string {
  return posix.normalize(ref.replace(/\\/g, "/"));
}

/** The patron-isolating scope shared by the two process-lifetime caches
 *  (`sourceImageCaps` here, `browseBudgetSeen` in image-transcribe.ts): the bound
 *  store's `projectId` when there is one — the patron-isolating identity under the
 *  shared-process `http.ts` entrypoint, where every request presents the SAME
 *  anchor `projectPath` (`/project`), so keying on projectPath would collide two
 *  patrons (#2457 B2, browse budget #2771). getProjectStore() returns the
 *  request-bound store there — every http tool call runs inside runWithProjectStore
 *  — so record and read resolve the same projectId for one project and distinct ids
 *  across patrons. A header-less request instead binds an *unbound* store, whose
 *  projectId is undefined (not a throw), so scope falls back to the anchor
 *  projectPath; for the cap that fallback is never reached (the unbound store's I/O
 *  throws before any cap is recorded or read), but the browse budget performs no
 *  store I/O, so two header-less patrons share the fallback bucket — the accepted
 *  known limitation in image-transcribe-tool-spec §5.8. On the file backend
 *  projectId is undefined — one process serves one project — so fall back to the
 *  normalized projectPath. When even that is absent (image_transcribe's own
 *  `projectPath` is optional), fall back to the `<no-project>` sentinel so a bare
 *  `?? projectPath` never stringifies `undefined` into the key. projectPath arrives
 *  raw from an LLM relay, so canonicalize it: backslashes → `/` and a trailing
 *  separator off (a Windows caller may record `C:\p` and query `C:/p/`), or the
 *  record/query symmetry is lost. */
export function projectScope(projectPath: string | undefined): string {
  return (
    getProjectStore().projectId ??
    (projectPath === undefined
      ? "<no-project>"
      : posix.normalize(projectPath.replace(/\\/g, "/")).replace(/\/+$/, ""))
  );
}

function truncatedImageKey(projectPath: string, imageRef: string): string {
  // imageRef also arrives raw from an LLM relay, so canonicalize it the same way
  // the GC folds its referenced set: backslashes → `/`, a leading `./`, doubled
  // `//`, interior `/./` (so `./images/x.jpg` joins `images/x.jpg`). Without it the
  // record/query symmetry is lost.
  return `${projectScope(projectPath)}\0${normalizeImageRef(imageRef)}`;
}

/** Record that this project's persisted source image was read PAST the OCR
 *  output-token cap. Add-only (#2457 rulings, C 2026-09-21): a whole read
 *  (`!truncated`) records nothing, so once an image is in the set it stays —
 *  stickiness by construction, expressing the invariant that nothing moves from
 *  partial to whole. The cap bounds output tokens and the OCR prompt varies with
 *  `lookingFor`, so a second, narrower read of the same image can come back
 *  uncapped; that whole read must not clear the earlier partial, and here it
 *  simply doesn't try to. */
export function recordImageReadCap(
  projectPath: string,
  imageRef: string,
  truncated: boolean,
): void {
  if (!truncated) return;
  sourceImageCaps.add(truncatedImageKey(projectPath, imageRef));
}

/** Whether image_transcribe read the image a research.json source cites via
 *  `image_filename` past the cap (verified PARTIAL). Absence means not
 *  established — a whole read or no read here. The join research_append uses to
 *  derive `transcription_truncated` at the write boundary. */
export function sourceImageCapState(
  projectPath: string,
  imageFilename: string,
): boolean {
  return sourceImageCaps.has(truncatedImageKey(projectPath, imageFilename));
}

/** Test-only reset — the set is module-level and persists across `it()` blocks. */
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

/**
 * The browse budget: how many distinct pages one caller has read from one image
 * group in one project, and the advisory that fires once that passes a bound.
 *
 * Lifted out of `tools/image-transcribe.ts` (issue #2183) because it now has two
 * producers. `image_transcribe` charges a transcription; `volume_bisect` charges
 * a bisect probe. Both must land in the SAME counter or a hunt that alternates
 * between them is invisible to the bound — which is the failure the budget
 * exists to catch.
 *
 * **The threshold is calibrated for one producer.** `BROWSE_BUDGET_IMAGES = 20`
 * was derived from `image_transcribe` distinct-image counts alone over the
 * committed e2e corpus (the highest non-noticing block was 18). With a second
 * producer the effective threshold is reached sooner in wall-clock terms;
 * re-measure before changing the constant, and see
 * `docs/specs/image-transcribe-tool-spec.md` §5.8.
 */
import { projectScope } from "./image-store.js";

const BROWSE_BUDGET_IMAGES = 20;

// Distinct imageIds seen per (project, image-group), keyed
// `${projectScope(projectPath)}\0${imageGroup}` — the scope being the bound store's
// patron-isolating projectId where there is one (shared-process http.ts, where every
// request presents the same anchor projectPath, so a projectPath key would collide
// patrons), else the normalized projectPath, else the `<no-project>` sentinel. Keyed
// by PROJECT deliberately: the MCP server process outlives one conversation, so a
// group-only key would tell a second project it had already browsed 20 pages on its
// first read. Process-lifetime, never persisted; re-reading an image already in the
// set does not advance the count. Follows place-search.ts's module-cache precedent.
const browseBudgetSeen = new Map<string, Set<string>>();

/** Test-only reset — the Map is module-level and persists across `it()` blocks,
 *  which `vi` mock resets do not clear. Mirrors `__clearPlaceSearchCacheForTests`. */
export function __clearBrowseBudgetForTests(): void {
  browseBudgetSeen.clear();
}

/** The advisory a caller relays once the group passes the bound. Standalone
 *  rather than `ImageTranscribeResult["browseBudget"]`, because two tools now
 *  return it. */
export interface BrowseBudgetAdvisory {
  /** The image-group prefix, e.g. "004261111". */
  imageGroup: string;
  /** Distinct images read from this group in this project so far. */
  distinctImagesRead: number;
  /** The advisory the caller should act on. */
  notice: string;
}

/** How the caller reached the page, which decides the advisory's wording: a
 *  page-by-page transcription hunt and a converging bisect want different
 *  pivots. */
export type BrowseKind = "transcribe" | "bisect";

function noticeFor(
  kind: BrowseKind,
  count: number,
  imageGroup: string,
): string {
  if (kind === "bisect") {
    // "Pivot to the indexed route" is sound against a hand-hunt and wrong
    // against a bisect that is converging — it would tell the tool built to
    // end the 58-call hunt to abandon a search that is working. Report the
    // spend and let the bracket speak instead.
    return (
      `This bisect has now read ${count} distinct images from image group ` +
      `${imageGroup} in this project. A bracket still wide after this many ` +
      `probes is the signal that year headings are not resolving it — check ` +
      `the bracket and its confidence, and consider the indexed route ` +
      `(record_search, fulltext_search) or asking the user.`
    );
  }
  return (
    `You have now transcribed ${count} distinct images from image group ` +
    `${imageGroup} in this project. Page-by-page browsing rarely pays past this ` +
    `point. Log the browse with a negative outcome (research_log_append) and ` +
    `pivot to the indexed route — record_search, record_read, or fulltext_search ` +
    `— or ask the user whether to keep paging.`
  );
}

/**
 * Record this image against the (project, group) browse counter and return the
 * advisory once the group passes `BROWSE_BUDGET_IMAGES` distinct images.
 *
 * Returns `undefined` for an ark-only call: an ARK carries no image-group number,
 * so a hunt driven by `ark` is never counted (spec §5.8 known limitation). A
 * bisect probe must therefore pass `imageId`, never `ark`, or it is invisible here.
 */
export function recordBrowseAndCheckBudget(
  imageId: string | undefined,
  projectPath: string | undefined,
  kind: BrowseKind = "transcribe",
): BrowseBudgetAdvisory | undefined {
  if (!imageId) return undefined;
  const imageGroup = imageId.split("_")[0];
  const key = `${projectScope(projectPath)}\0${imageGroup}`;
  let seen = browseBudgetSeen.get(key);
  if (!seen) {
    seen = new Set<string>();
    browseBudgetSeen.set(key, seen);
  }
  seen.add(imageId);
  if (seen.size <= BROWSE_BUDGET_IMAGES) return undefined;
  return {
    imageGroup,
    distinctImagesRead: seen.size,
    notice: noticeFor(kind, seen.size, imageGroup),
  };
}

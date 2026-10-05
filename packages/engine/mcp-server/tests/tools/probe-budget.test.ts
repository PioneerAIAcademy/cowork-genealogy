/**
 * The three-leg probe budget fits Cowork's call abort (volume-bisect-tool-spec §8).
 *
 * This exists because the sum is easy to get wrong in both directions, and it was
 * got wrong in both on 2026-09-30. A drift review read `fs-image-fetch.ts`, saw
 * that it can issue a fallback after the primary, and concluded the download leg
 * counted twice — putting the worst case at 70s, over the abort. That is true of
 * the helper and false of this tool: `resolveFsImageInput` produces a
 * `fallbackUrl` only for the `ark` shape, and this tool always passes an
 * `imageId`, so the second attempt is unreachable. Acting on it shortened three
 * timeouts that did not need shortening.
 *
 * What this pins is the arithmetic, so neither mistake is available again in
 * silence: a raised timeout, or an attempt count that changes, reds here.
 *
 * What it cannot pin is whether each count still matches the control flow it
 * describes — those live in two other files. Each constant names the call site
 * that justifies it, and `DOWNLOAD_ATTEMPTS` names the condition that would make
 * it 2. Changing that condition without changing the constant is the one shape
 * this test cannot see.
 */
import { describe, it, expect } from "vitest";
import {
  PROBE_WORST_CASE_MS,
  COWORK_CALL_ABORT_MS,
  IMAGE_SEARCH_ATTEMPTS,
  DOWNLOAD_ATTEMPTS,
  OCR_ATTEMPTS,
} from "../../src/tools/volume-bisect.js";

/** Enough that a slow leg does not land exactly on the abort. */
const REQUIRED_HEADROOM_MS = 5_000;

describe("volume_bisect probe budget", () => {
  it("fits the bridge abort with headroom, counting every reachable attempt", () => {
    expect(PROBE_WORST_CASE_MS).toBeLessThanOrEqual(
      COWORK_CALL_ABORT_MS - REQUIRED_HEADROOM_MS,
    );
  });

  it("counts each leg's attempts as its call shape reaches them", () => {
    // image_search re-requests once on a defective response, so it is 2.
    expect(IMAGE_SEARCH_ATTEMPTS).toBe(2);
    // The download is 1 because this tool resolves an imageId, which yields no
    // fallbackUrl. If it ever resolves an ark, this becomes 2 and the budget
    // above has to absorb another full download — which at today's numbers it
    // cannot, so that change lands here first.
    expect(DOWNLOAD_ATTEMPTS).toBe(1);
    expect(OCR_ATTEMPTS).toBe(1);
    // The check that gives the line above teeth: a second download attempt does
    // not fit, so nobody can raise the count and keep the budget.
    const withArkFallback =
      PROBE_WORST_CASE_MS + (PROBE_WORST_CASE_MS > 0 ? 10_000 : 0);
    expect(withArkFallback).toBeGreaterThan(COWORK_CALL_ABORT_MS - REQUIRED_HEADROOM_MS);
  });
});

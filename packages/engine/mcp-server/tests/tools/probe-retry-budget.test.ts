/**
 * A lowered `timeoutMs` must bound the whole `image_search` call, not just each
 * HTTP request inside it (volume-bisect-tool-spec §8).
 *
 * This is the half `probe-budget.test.ts` structurally cannot cover. That one
 * recomputes the worst case from the constants and asserts the sum — it pins the
 * attempt COUNTS, and it assumed without checking that one attempt costs
 * `IMAGE_SEARCH_TIMEOUT_MS`. It did not: `fsFetch` delegates to `fetchWithRetry`,
 * whose default budget is 10s over 3 attempts, so a 6s timeout bounded each
 * request while the call ran to 10s. Measured with a hanging `fetch` on
 * 2026-09-30: 10,001ms over 2 requests uncapped, 6,001ms over 1 capped.
 *
 * Asserted on the REQUEST COUNT rather than elapsed time, but on the count being
 * SHORT OF THE FULL ATTEMPT SET rather than on an exact number.
 *
 * The first version asserted exactly 1 and was flaky at about 7.5%, which is how
 * it reached `main` and then reddened an unrelated PR. The retry backoff carries
 * jitter, so whether a second attempt fits inside a 40ms budget is a coin flip:
 * measured 2026-10-01, 40 runs at `budgetMs: 40` gave 1 request 37 times and 2
 * requests 3 times. "The count is deterministic" was the wrong half of the
 * lesson — it is deterministic only against the FULL attempt set, which no
 * jitter can reach once the budget is this small.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/auth/refresh.js", () => ({ getValidToken: vi.fn() }));

import { imageSearchTool } from "../../src/tools/image-search.js";
import { LOCAL } from "../../src/auth/principal.js";
import { getValidToken } from "../../src/auth/refresh.js";

let requests = 0;

/** "hang" waits for the caller's own AbortSignal, which is what a stalled
 *  upstream looks like to `fetchWithTimeout`. "reject" fails immediately, which
 *  is a refused connection — retryable, and it leaves the per-request timeout
 *  unspent so the retry BUDGET is what decides how many attempts run. */
let mode: "hang" | "reject" = "hang";

const stubFetch = vi.fn((_url: unknown, init: any) => {
  requests++;
  if (mode === "reject") return Promise.reject(new TypeError("fetch failed"));
  return new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () =>
      reject(new DOMException("Aborted", "AbortError")),
    );
  });
});
vi.stubGlobal("fetch", stubFetch);

beforeEach(() => {
  requests = 0;
  mode = "hang";
  stubFetch.mockClear();
  vi.mocked(getValidToken).mockResolvedValue("tok");
});

describe("image_search retry budget", () => {
  it("spends one request when the caller lowers the timeout", async () => {
    // A split Natural Group resolves its id without a network call, so every
    // request counted here belongs to `fetchChildren` — the leg volume_bisect
    // sizes its budget on.
    await expect(
      imageSearchTool(
        { imageGroupNumber: "004516861_001_M9S4-SQB" },
        LOCAL,
        { timeoutMs: 40 },
      ),
    ).rejects.toThrow();

    // Uncapped this is 3: `fetchWithRetry` keeps retrying inside its own 10s
    // budget, so the call outlives the timeout the caller asked for and the §8
    // arithmetic understates this leg. Capped, the budget expires during the
    // first backoff, so the attempt set cannot be exhausted — 1 or 2 depending
    // on the jitter, never 3.
    expect(requests).toBeLessThan(3);
  });

  it("leaves a default-timeout caller on the default retry budget", async () => {
    // The other direction, and the one that says the cap narrows only what the
    // caller asked to narrow: a default caller still gets its retries.
    //
    // Driven by immediate rejections rather than a hang. A default caller's
    // 30s per-request timeout exhausts the 10s retry budget on the first
    // attempt, so a hang gives one request whether or not the cap is there —
    // the assertion would pass for the wrong reason, and take 30s doing it.
    mode = "reject";
    await expect(
      imageSearchTool({ imageGroupNumber: "004516861_001_M9S4-SQB" }, LOCAL),
    ).rejects.toThrow();

    // The full attempt set, every time: 3 immediate rejections fit inside the
    // default 10s budget whatever the jitter does.
    expect(requests).toBe(3);
  });

  it("a lowered timeout narrows the budget even when requests fail fast", async () => {
    // Same fast-rejection path as above, capped: the budget is the caller's, so
    // the retries the default caller gets are the ones this one gives up.
    mode = "reject";
    await expect(
      imageSearchTool(
        { imageGroupNumber: "004516861_001_M9S4-SQB" },
        LOCAL,
        { timeoutMs: 40 },
      ),
    ).rejects.toThrow();

    expect(requests).toBeLessThan(3);
  });
});

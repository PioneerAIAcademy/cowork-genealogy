import { SolutionError } from "./errors.js";

export type Fetch = typeof fetch;

export interface RequestOptions {
  /** Covers headers AND body: the whole transfer, not just the first byte. */
  timeoutMs?: number;
  /** Extra attempts after the first, on a network error or a 429/502/503/504. */
  retries?: number;
}

const RETRY_STATUSES = new Set([429, 502, 503, 504]);
const MAX_WAIT_MS = 10_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function retryAfterMs(res: Response): number | undefined {
  const header = res.headers.get("retry-after");
  if (header === null) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return seconds * 1000;
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

function backoffMs(attempt: number): number {
  const base = 1000 * 2 ** attempt;
  return base + Math.random() * base * 0.5;
}

/**
 * `fetch` with a timeout and a small retry on transient failures. A timeout is
 * never retried: it has already spent the budget. Past the retries the last
 * Response is returned, so the caller's own status handling still runs.
 */
export async function request(
  fetchImpl: Fetch,
  url: string,
  init: RequestInit,
  { timeoutMs = 30_000, retries = 2 }: RequestOptions = {},
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      const name = (error as { name?: string }).name;
      if (name === "TimeoutError") {
        throw new SolutionError("upstream", `${new URL(url).host} did not answer within ${timeoutMs / 1000}s.`);
      }
      if (attempt >= retries) {
        throw new SolutionError("upstream", `Could not reach ${new URL(url).host}: ${String(error)}`);
      }
      await sleep(backoffMs(attempt));
      continue;
    }
    if (!RETRY_STATUSES.has(res.status) || attempt >= retries) return res;
    await res.body?.cancel();
    await sleep(Math.min(retryAfterMs(res) ?? backoffMs(attempt), MAX_WAIT_MS));
  }
}

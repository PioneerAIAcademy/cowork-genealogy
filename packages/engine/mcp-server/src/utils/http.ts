// Shared fetch wrapper with a bounded timeout. Node's global fetch has no
// timeout of its own — if an upstream connection (FamilySearch behind
// Imperva, the wiki-query-api sidecar, OpenRouter) stalls after accepting the
// TCP connection instead of erroring, a bare `fetch()` call hangs forever.
// Every tool that talks to an external service should call this instead of
// the global `fetch` directly.

export const DEFAULT_FETCH_TIMEOUT_MS = 30_000;

export async function fetchWithTimeout(
  url: string | URL,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS
): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      throw new Error(`Request to ${url} timed out after ${timeoutMs}ms.`);
    }
    throw err;
  }
}

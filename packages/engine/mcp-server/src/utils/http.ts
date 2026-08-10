// Shared fetch wrapper with a bounded timeout. Node's global fetch has no
// timeout of its own — if an upstream connection (FamilySearch behind
// Imperva, the wiki-query-api sidecar, OpenRouter) stalls after accepting the
// TCP connection instead of erroring, a bare `fetch()` call hangs forever.
// Every tool that talks to an external service should call this instead of
// the global `fetch` directly.
//
// The budget covers headers AND body. `AbortSignal.timeout` runs from the
// moment it is created and keeps running after the headers arrive, so a body
// that is still streaming when it fires is aborted mid-read. That rejection
// comes out of `response.json()` / `.text()` / `.arrayBuffer()` at the call
// site, long after this function has returned — which is why the body readers
// are wrapped below rather than only the fetch itself. Size the timeout for
// the whole transfer, not just the round-trip to first byte.

export const DEFAULT_FETCH_TIMEOUT_MS = 30_000;

// Every `Response` method that consumes the body stream, and can therefore
// reject with the abort once the timeout fires mid-transfer.
const BODY_READERS = [
  "json",
  "text",
  "arrayBuffer",
  "blob",
  "bytes",
  "formData",
] as const;

function isTimeout(err: unknown): boolean {
  return err instanceof Error && err.name === "TimeoutError";
}

/**
 * Shadow the response's body-reading methods with versions that translate the
 * abort into the same readable message the fetch itself produces. Mutates the
 * instance rather than wrapping it in a Proxy so the response a caller gets is
 * the same object identity fetch returned — callers pass it around, and a
 * stand-in would be a second thing to reason about for no gain.
 */
function guardBodyReads(
  response: Response,
  url: string | URL,
  timeoutMs: number
): Response {
  for (const name of BODY_READERS) {
    const original = (response as unknown as Record<string, unknown>)[name];
    if (typeof original !== "function") continue;
    Object.defineProperty(response, name, {
      configurable: true,
      writable: true,
      value: async (...args: unknown[]) => {
        try {
          return await (original as (...a: unknown[]) => Promise<unknown>).apply(
            response,
            args
          );
        } catch (err) {
          if (isTimeout(err)) {
            throw new Error(
              `Request to ${url} timed out after ${timeoutMs}ms while reading the response body.`
            );
          }
          throw err;
        }
      },
    });
  }
  return response;
}

export async function fetchWithTimeout(
  url: string | URL,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS
): Promise<Response> {
  let response: Response;
  try {
    // `signal` is spread last deliberately: no caller passes its own signal
    // today (grep `signal:` under src/ outside this file), and the timeout
    // must always win if one ever does — not silently drop the timeout.
    response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (isTimeout(err)) {
      throw new Error(`Request to ${url} timed out after ${timeoutMs}ms.`);
    }
    throw err;
  }
  return guardBodyReads(response, url, timeoutMs);
}

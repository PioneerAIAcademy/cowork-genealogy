import { vi } from "vitest";

/**
 * Settle a call whose retries back off, without waiting the backoff out. Only
 * setTimeout and Date are faked, from before the call starts, so its retry
 * deadline and its sleeps share one clock; time is stepped while real I/O (a
 * token or project read before the fetch) keeps running between steps.
 */
export async function elapseBackoff<T>(act: () => Promise<T>, maxMs = 60_000): Promise<T> {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  try {
    let done = false;
    const settled = act().then(
      (v) => ({ ok: true as const, v }),
      (e: unknown) => ({ ok: false as const, e }),
    );
    void settled.then(() => (done = true));
    for (let spent = 0; !done && spent < maxMs; spent += 250) {
      await vi.advanceTimersByTimeAsync(250);
      await new Promise((r) => setImmediate(r));
    }
    const r = await settled;
    if (!r.ok) throw r.e;
    return r.v;
  } finally {
    vi.useRealTimers();
  }
}

import { vi } from "vitest";

/**
 * Settle a call whose retries back off, without waiting the backoff out. Only
 * setTimeout and Date are faked, from before the call starts, so its retry
 * deadline and its sleeps share one clock; time is stepped while real I/O (a
 * token or project read before the fetch) keeps running between steps. The
 * bound is real time, not fake: on a loaded machine a call's real I/O takes
 * more steps, and a fake-time bound failed a call that was still progressing.
 */
export async function elapseBackoff<T>(act: () => Promise<T>, maxRealMs = 20_000): Promise<T> {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  try {
    let done = false;
    const settled = act().then(
      (v) => ({ ok: true as const, v }),
      (e: unknown) => ({ ok: false as const, e }),
    );
    void settled.then(() => (done = true));
    const start = performance.now();
    while (!done && performance.now() - start < maxRealMs) {
      await vi.advanceTimersByTimeAsync(250);
      await new Promise((r) => setImmediate(r));
    }
    if (!done) throw new Error(`elapseBackoff: the call did not settle within ${maxRealMs} ms of real time`);
    const r = await settled;
    if (!r.ok) throw r.e;
    return r.v;
  } finally {
    vi.useRealTimers();
  }
}

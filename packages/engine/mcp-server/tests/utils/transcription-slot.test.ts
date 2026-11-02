import { describe, it, expect, afterEach } from "vitest";
import {
  withTranscriptionSlot,
  configureTranscriptionCap,
  __resetTranscriptionSlotsForTests,
} from "../../src/utils/ocr.js";

// The process-wide concurrent-transcription cap (self-hosted beta E4). Takes
// no Principal: runOcr must stay principal-free (issue #3996).

afterEach(() => {
  __resetTranscriptionSlotsForTests();
});

/** A promise plus the handles to settle it, so a test can hold a slot open. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("withTranscriptionSlot", () => {
  it("calls straight through when unconfigured, however many are in flight", async () => {
    const held = Array.from({ length: 50 }, () => deferred<string>());
    const running = held.map((d) => withTranscriptionSlot(() => d.promise));
    held.forEach((d, i) => d.resolve(`ok${i}`));
    await expect(Promise.all(running)).resolves.toHaveLength(50);
  });

  it("admits up to the cap concurrently", async () => {
    configureTranscriptionCap({ max: 2 });
    const a = deferred<string>();
    const b = deferred<string>();
    const ra = withTranscriptionSlot(() => a.promise);
    const rb = withTranscriptionSlot(() => b.promise);
    a.resolve("a");
    b.resolve("b");
    await expect(Promise.all([ra, rb])).resolves.toEqual(["a", "b"]);
  });

  // Refused at once, never queued: a caller that waited would hold its tool
  // call open for as long as the busiest transcription takes.
  it("refuses the call past the cap immediately, rather than queueing it", async () => {
    configureTranscriptionCap({ max: 1 });
    const held = deferred<string>();
    const first = withTranscriptionSlot(() => held.promise);

    await expect(withTranscriptionSlot(async () => "second")).rejects.toThrow(
      /already running 1 transcription, its limit/,
    );

    held.resolve("first");
    await expect(first).resolves.toBe("first");
  });

  // The `finally`: without it a throwing transcription leaks its slot, and the
  // cap ratchets down to zero over a run -- every later call refused on a
  // server doing nothing.
  it("releases the slot when the work THROWS, not only when it succeeds", async () => {
    configureTranscriptionCap({ max: 1 });

    await expect(
      withTranscriptionSlot(async () => {
        throw new Error("OCR blew up");
      }),
    ).rejects.toThrow("OCR blew up");

    // The slot must be free again.
    await expect(withTranscriptionSlot(async () => "after")).resolves.toBe("after");
  });

  it("releases every slot across a burst of failures", async () => {
    configureTranscriptionCap({ max: 2 });
    for (let i = 0; i < 10; i++) {
      await expect(
        withTranscriptionSlot(async () => {
          throw new Error(`boom ${i}`);
        }),
      ).rejects.toThrow(`boom ${i}`);
    }
    const a = deferred<string>();
    const b = deferred<string>();
    const ra = withTranscriptionSlot(() => a.promise);
    const rb = withTranscriptionSlot(() => b.promise);
    a.resolve("a");
    b.resolve("b");
    await expect(Promise.all([ra, rb])).resolves.toEqual(["a", "b"]);
  });

  // person_read transcribes its memories with OCR_CONCURRENCY = 5
  // (person-read.ts:370) and calls imageTranscribeTool directly, so ONE
  // person_read may hold five slots at once. This is what makes the handoff's
  // "set it at 5 or above" row true, and what makes a cap of 4 degrade some of
  // its memories to metadata-only entries.
  //
  // Pinned here on the slot itself rather than through person_read: the
  // property is the fan-out arithmetic, and a 5-memory integration test in
  // that tool's 2,686-line harness would prove the same thing with far more
  // that can silently stop exercising it.
  it("admits a 5-wide fan-out at a cap of 5, and refuses the fifth at 4", async () => {
    configureTranscriptionCap({ max: 5 });
    const held = Array.from({ length: 5 }, () => deferred<number>());
    const all = held.map((d) => withTranscriptionSlot(() => d.promise));
    held.forEach((d, i) => d.resolve(i));
    await expect(Promise.all(all)).resolves.toEqual([0, 1, 2, 3, 4]);

    __resetTranscriptionSlotsForTests();
    configureTranscriptionCap({ max: 4 });
    const four = Array.from({ length: 4 }, () => deferred<number>());
    const running = four.map((d) => withTranscriptionSlot(() => d.promise));
    await expect(withTranscriptionSlot(async () => 5)).rejects.toThrow(
      /already running 4 transcriptions, its limit/,
    );
    four.forEach((d, i) => d.resolve(i));
    await Promise.all(running);
  });

  it("frees a slot as each call finishes, so sequential calls never refuse", async () => {
    configureTranscriptionCap({ max: 1 });
    for (let i = 0; i < 20; i++) {
      await expect(withTranscriptionSlot(async () => i)).resolves.toBe(i);
    }
  });
});

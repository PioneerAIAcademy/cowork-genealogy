/**
 * person_read x memories: the transcription phase — issue #1689 decision 4.
 *
 * image_transcribe is mocked at the module boundary so the phase's own rules
 * (budget, concurrency, rank order, fail-soft, retention) are what is measured,
 * not OpenRouter. The memories and artifact fetches are mocked at the fetch
 * layer so the filter and the story-text leg run for real.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/auth/refresh.js", () => ({ getValidToken: vi.fn() }));
vi.mock("../../src/tools/image-transcribe.js", () => ({
  imageTranscribeTool: vi.fn(),
}));

import { personReadTool } from "../../src/tools/person-read.js";
import { LOCAL } from "../../src/auth/principal.js";
import { getValidToken } from "../../src/auth/refresh.js";
import { imageTranscribeTool } from "../../src/tools/image-transcribe.js";

const PID = "KWCJ-RN4";
const transcribe = vi.mocked(imageTranscribeTool);

const ART = (ext: string, n: string) =>
  `https://sg30p0.familysearch.org/ark:/61903/3:1:${n}/v2/${n}/dist.${ext}`;

/** `qualifiers` is what the filter reads for media kind. */
const mem = (
  id: string,
  mediaType: string,
  kind: "Photo" | "Document" | "Story",
  title: string,
  ext: string,
) => ({
  id,
  mediaType,
  about: ART(ext, id),
  titles: [{ value: title }],
  artifactMetadata: [
    { qualifiers: [{ name: `http://familysearch.org/v1/${kind}` }] },
  ],
  links: { memory: { href: `https://www.familysearch.org/memories/${id}` } },
});

const personBody = {
  persons: [
    {
      id: PID,
      living: false,
      names: [{ nameForms: [{ fullText: "Almon Giles Clegg" }] }],
    },
  ],
  relationships: [],
  sourceDescriptions: [],
};

const fetchMock = vi.fn();
let previousFetch: typeof globalThis.fetch;

/** Route by URL: the two legs race, so call order cannot be relied on. */
function route(
  memories: unknown[],
  opts: { storyText?: string | null; storyStatus?: number } = {},
) {
  fetchMock.mockImplementation(async (url: string) => {
    const u = String(url);
    if (u.includes("/portrait")) return new Response(null, { status: 404 });
    if (u.includes("/memories")) {
      return new Response(JSON.stringify({ sourceDescriptions: memories, links: {} }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (u.includes("/dist.txt")) {
      if (opts.storyStatus && opts.storyStatus !== 200) {
        return new Response("", { status: opts.storyStatus });
      }
      return new Response(opts.storyText ?? "the full story text", { status: 200 });
    }
    return new Response(JSON.stringify(personBody), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
}

const read = (extra: Record<string, unknown> = {}) =>
  personReadTool({ personId: PID, sourceDescriptions: true, ...extra }, LOCAL);

beforeEach(() => {
  vi.mocked(getValidToken).mockResolvedValue("tok");
  previousFetch = globalThis.fetch;
  globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
  fetchMock.mockReset();
  transcribe.mockReset();
  transcribe.mockResolvedValue({ transcription: "OCR TEXT" } as never);
});
afterEach(() => {
  globalThis.fetch = previousFetch;
});

describe("person_read — transcription phase", () => {
  it("transcribes a kept image memory into text", async () => {
    route([mem("d1", "image/jpeg", "Document", "Last Will and Testament", "jpg")]);
    const out = await read();
    expect(out.sources.find((s) => s.id === "d1")?.text).toBe("OCR TEXT");
    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(transcribe.mock.calls[0][0]).toMatchObject({
      memoryArtifactUrl: ART("jpg", "d1"),
    });
  });

  it("transcribes a PDF memory — 29 of the 221-memory corpus are PDFs", async () => {
    route([mem("p1", "application/pdf", "Document", "Probate file", "pdf")]);
    const out = await read();
    expect(out.sources.find((s) => s.id === "p1")?.text).toBe("OCR TEXT");
  });

  it("fetches a story's FULL text rather than OCRing it", async () => {
    route([mem("s1", "text/plain", "Story", "A family story", "txt")], {
      storyText: "x".repeat(2592),
    });
    const out = await read();
    expect(out.sources.find((s) => s.id === "s1")?.text).toHaveLength(2592);
    expect(transcribe).not.toHaveBeenCalled();
  });

  it("notes a story whose artifact 404s and sets no text (1 of 6 measured)", async () => {
    route([mem("s1", "text/plain", "Story", "A family story", "txt")], {
      storyStatus: 404,
    });
    const s = (await read()).sources.find((x) => x.id === "s1");
    expect(s?.text).toBeUndefined();
    expect(s?.notes?.join(" ")).toMatch(/Story text unavailable/);
  });

  it("degrades to metadata + a note when OCR throws, and never fails the read", async () => {
    transcribe.mockRejectedValue(new Error("no OpenRouter key"));
    route([mem("d1", "image/jpeg", "Document", "Will", "jpg")]);
    const out = await read();
    const s = out.sources.find((x) => x.id === "d1");
    expect(out.persons[0].id).toBe(PID);
    expect(s?.text).toBeUndefined();
    expect(s?.notes?.join(" ")).toMatch(/image_transcribe/);
  });

  it("returns un-transcribed memories WITH a budget note when the budget expires", async () => {
    vi.useFakeTimers();
    try {
      // Every OCR outlasts the phase budget.
      transcribe.mockImplementation(
        () => new Promise((r) => setTimeout(() => r({ transcription: "late" } as never), 60_000)),
      );
      route([
        mem("d1", "image/jpeg", "Document", "Will", "jpg"),
        mem("d2", "image/jpeg", "Document", "Deed", "jpg"),
      ]);
      const p = read();
      await vi.advanceTimersByTimeAsync(120_000);
      const out = await p;
      // Nothing is dropped...
      expect(out.sources.map((s) => s.id).sort()).toEqual(["d1", "d2"]);
      // ...and the response says why they have no text.
      for (const s of out.sources) {
        expect(s.text).toBeUndefined();
        expect(s.notes?.join(" ")).toMatch(/budget ran out|attempt failed/);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("holds at most 5 transcriptions in flight", async () => {
    let inFlight = 0;
    let peak = 0;
    transcribe.mockImplementation(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return { transcription: "t" } as never;
    });
    route(
      Array.from({ length: 14 }, (_, i) =>
        mem(`d${i}`, "image/jpeg", "Document", `Doc ${i}`, "jpg"),
      ),
    );
    await read();
    expect(transcribe).toHaveBeenCalledTimes(14); // no count cap
    expect(peak).toBeLessThanOrEqual(5);
    expect(peak).toBeGreaterThan(1); // and it really is concurrent
  });

  it("forwards projectPath so the scan is retained, and returns its ref", async () => {
    transcribe.mockResolvedValue({
      transcription: "OCR TEXT",
      imageRef: "images/d1.jpg",
    } as never);
    route([mem("d1", "image/jpeg", "Document", "Will", "jpg")]);
    const out = await read({ projectPath: "/tmp/proj" });
    expect(transcribe.mock.calls[0][0]).toMatchObject({ projectPath: "/tmp/proj" });
    expect(out.sources.find((s) => s.id === "d1")?.image_ref).toBe("images/d1.jpg");
  });

  it("omits projectPath entirely when the caller gave none", async () => {
    route([mem("d1", "image/jpeg", "Document", "Will", "jpg")]);
    await read();
    expect(transcribe.mock.calls[0][0]).not.toHaveProperty("projectPath");
  });

  it("transcribes in record-language rank order", async () => {
    route([
      mem("photo", "image/jpeg", "Document", "Family reunion", "jpg"),
      mem("will", "image/jpeg", "Document", "Last Will and Testament", "jpg"),
    ]);
    // one at a time, so the order of calls is the rank order
    await read();
    const first = (transcribe.mock.calls[0][0] as { memoryArtifactUrl: string })
      .memoryArtifactUrl;
    expect(first).toBe(ART("jpg", "will"));
  });
});

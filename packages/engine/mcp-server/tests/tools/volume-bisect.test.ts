/**
 * volume_bisect acceptance (issue #2183).
 *
 * The three checks the plan named, in order: the tool refuses to keep probing a
 * sub-volume whose year headings contradict each other; it refuses a bare
 * image-group prefix; and a probe charges the SHARED browse budget under the
 * project's own key.
 *
 * Mocked at the module boundary (the `person-read-memories-ocr.test.ts` pattern)
 * so the bisect's own arithmetic is what is measured, not FamilySearch or
 * OpenRouter. `browse-budget.ts` is deliberately NOT mocked — the third check is
 * about that module's real keying.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/tools/image-search.js", () => ({ imageSearchTool: vi.fn() }));
vi.mock("../../src/utils/fs-image-fetch.js", () => ({
  resolveFsImageInput: vi.fn(),
  fetchFsImageBytes: vi.fn(),
}));
vi.mock("../../src/utils/ocr.js", () => ({ runOcr: vi.fn() }));
vi.mock("../../src/auth/config.js", () => ({
  getOpenRouterApiKey: vi.fn(),
  getOpenRouterModel: vi.fn(),
}));

import { volumeBisectTool, parseProbeYear } from "../../src/tools/volume-bisect.js";
import { __clearBrowseBudgetForTests } from "../../src/utils/browse-budget.js";
import { LOCAL } from "../../src/auth/principal.js";
import { imageSearchTool } from "../../src/tools/image-search.js";
import { resolveFsImageInput, fetchFsImageBytes } from "../../src/utils/fs-image-fetch.js";
import { runOcr } from "../../src/utils/ocr.js";
import { getOpenRouterApiKey, getOpenRouterModel } from "../../src/auth/config.js";
import type { VolumeBisectReading } from "../../src/types/volume-bisect.js";

/** The reviewer's image group and Natural Group, by name. The mocked id list
 *  below is a synthetic position index, NOT that volume's real sequence — the
 *  live `image_search` that would supply the real one needs a session, and the
 *  plan forbids standing a test on a fabricated one. Nothing here reads a year
 *  out of the list: every year an assertion depends on arrives as an explicit
 *  `readings` entry or as the probe's own answer, so the list only has to map a
 *  position to an id. The load-bearing evidence is the 295/299 pair below. */
const GROUP = "004516861_001_M9S4-SQB";
const PREFIX = "004516861";
const INDEX_LENGTH = 500;

const imageIdAt = (position: number) =>
  `${PREFIX}_${String(position).padStart(5, "0")}`;

const search = vi.mocked(imageSearchTool);
const resolve = vi.mocked(resolveFsImageInput);
const fetchBytes = vi.mocked(fetchFsImageBytes);
const ocr = vi.mocked(runOcr);

/** The next probe answers with this year; `null` stands for a page with none. */
let nextProbeYear: number | null = 1700;

beforeEach(() => {
  vi.clearAllMocks();
  __clearBrowseBudgetForTests();
  nextProbeYear = 1700;

  search.mockResolvedValue({
    imageIds: Array.from({ length: INDEX_LENGTH }, (_, i) => imageIdAt(i)),
  });
  resolve.mockReturnValue({
    url: "https://example.invalid/image",
    label: "image",
    memoryShape: false,
  });
  fetchBytes.mockResolvedValue({
    bytes: new Uint8Array([1, 2, 3]),
    contentType: "image/jpeg",
    resolvedUrl: "https://example.invalid/image",
  } as Awaited<ReturnType<typeof fetchFsImageBytes>>);
  ocr.mockImplementation(async () => ({
    text: nextProbeYear === null ? "NO YEAR" : String(nextProbeYear),
    truncated: false,
  }));
  vi.mocked(getOpenRouterApiKey).mockResolvedValue("sk-test");
  vi.mocked(getOpenRouterModel).mockResolvedValue("test/model");
});

describe("refuses to converge on a non-monotonic film", () => {
  /**
   * The reviewer's own readings off 004516861, which are not monotone:
   * 122 -> 1849, 257 -> 1685, 295 -> 1729, 299 -> 1685. The assertion anchors on
   * the ADJACENT pair 295/299 — four images apart, both register pages, both
   * transcribed in a committed run log — so it does not rest on the wide
   * 122/257 gap, where a sub-volume boundary would be a competing explanation.
   */
  const reviewerPair: VolumeBisectReading[] = [
    { position: 295, imageId: imageIdAt(295), year: 1729 },
    { position: 299, imageId: imageIdAt(299), year: 1685 },
  ];

  it("reports non-monotonic and spends no OCR probe", async () => {
    const result = await volumeBisectTool(
      { imageGroupNumber: GROUP, targetYear: 1700, readings: reviewerPair },
      LOCAL,
    );

    expect(result.confidence).toBe("non-monotonic");
    expect(result.stopped).toContain("295");
    expect(result.stopped).toContain("299");
    // The point of the check: it stops instead of probing again. A tool that
    // narrowed the bracket and probed once more would pass every assertion
    // above, so this line is the one that fails on the regression.
    expect(ocr).not.toHaveBeenCalled();
    expect(result.reading).toBeUndefined();
    expect(result.nextImageId).toBeUndefined();
  });

  it("still converges on the same pair read in monotone order", async () => {
    // The other direction: the check must not reject a legitimate ascending
    // volume. Same two positions, same two years, ordered.
    const monotone: VolumeBisectReading[] = [
      { position: 295, imageId: imageIdAt(295), year: 1685 },
      { position: 299, imageId: imageIdAt(299), year: 1729 },
    ];
    nextProbeYear = 1690;
    const result = await volumeBisectTool(
      { imageGroupNumber: GROUP, targetYear: 1700, readings: monotone },
      LOCAL,
    );

    expect(result.confidence).toBe("converging");
    expect(ocr).toHaveBeenCalledOnce();
    // The probe fell strictly inside the bracket, and the bracket narrowed onto
    // it: the low end moved 295 -> 297 while the high end stayed at 299.
    expect(result.reading).toMatchObject({ position: 297, year: 1690 });
    expect(result.bracket).toMatchObject({
      lowPosition: 297,
      lowYear: 1690,
      highPosition: 299,
      highYear: 1729,
    });
  });

  it("catches a contradiction the probe itself introduces", async () => {
    // The dated readings agree on the way in; the page just read is what breaks
    // monotonicity. That arm is a second `firstContradiction` call on a
    // different list, and nothing above reaches it.
    nextProbeYear = 1600;
    const result = await volumeBisectTool(
      {
        imageGroupNumber: GROUP,
        targetYear: 1700,
        readings: [
          { position: 100, imageId: imageIdAt(100), year: 1680 },
          { position: 400, imageId: imageIdAt(400), year: 1720 },
        ],
      },
      LOCAL,
    );

    expect(result.confidence).toBe("non-monotonic");
    expect(result.reading).toMatchObject({ position: 250, year: 1600 });
  });
});

describe("input domain", () => {
  it("refuses a bare image-group prefix and names volume_search", async () => {
    await expect(
      volumeBisectTool({ imageGroupNumber: PREFIX, targetYear: 1700 }, LOCAL),
    ).rejects.toThrow(/volume_search/);
    // Refused before anything was spent.
    expect(search).not.toHaveBeenCalled();
    expect(ocr).not.toHaveBeenCalled();
  });

  it("refuses a prefix with surrounding whitespace", async () => {
    // The shape that slips past a bare `=== prefix` check.
    await expect(
      volumeBisectTool({ imageGroupNumber: `  ${PREFIX}  `, targetYear: 1700 }, LOCAL),
    ).rejects.toThrow(/volume_search/);
  });

  it("refuses an empty and a missing group name", async () => {
    await expect(
      volumeBisectTool({ imageGroupNumber: "", targetYear: 1700 }, LOCAL),
    ).rejects.toThrow(/volume_search/);
    await expect(
      volumeBisectTool(
        { imageGroupNumber: undefined as unknown as string, targetYear: 1700 },
        LOCAL,
      ),
    ).rejects.toThrow(/volume_search/);
  });

  it("accepts the split Natural Group form", async () => {
    const result = await volumeBisectTool(
      { imageGroupNumber: `  ${GROUP}  `, targetYear: 1700 },
      LOCAL,
    );
    expect(search).toHaveBeenCalledWith(
      { imageGroupNumber: GROUP },
      LOCAL,
      expect.objectContaining({ timeoutMs: expect.any(Number) }),
    );
    expect(result.reading).toMatchObject({ position: 374, year: 1700 });
  });

  it("refuses a target year outside the register range", async () => {
    // 1952 is the filming-stamp year the ceiling exists to exclude.
    await expect(
      volumeBisectTool({ imageGroupNumber: GROUP, targetYear: 1952 }, LOCAL),
    ).rejects.toThrow(/1500-1950/);
    await expect(
      volumeBisectTool({ imageGroupNumber: GROUP, targetYear: 1700.5 }, LOCAL),
    ).rejects.toThrow(/1500-1950/);
  });

  it("refuses a reading whose imageId no longer matches its position", async () => {
    await expect(
      volumeBisectTool(
        {
          imageGroupNumber: GROUP,
          targetYear: 1700,
          readings: [{ position: 295, imageId: imageIdAt(296), year: 1700 }],
        },
        LOCAL,
      ),
    ).rejects.toThrow(/re-seed/);
  });
});

describe("browse budget", () => {
  /**
   * Drive `n` further probes on one continuing hunt, echoing each returned
   * reading back so the tool picks a NEW position every call — a fresh
   * `readings: []` would re-probe the midpoint and charge nothing, which is the
   * shape that made this check pass vacuously the first time it was written.
   */
  async function probe(
    n: number,
    projectPath: string | undefined,
    readings: VolumeBisectReading[] = [],
  ) {
    let last!: Awaited<ReturnType<typeof volumeBisectTool>>;
    for (let i = 0; i < n; i++) {
      last = await volumeBisectTool(
        { imageGroupNumber: GROUP, targetYear: 1700, readings, projectPath },
        LOCAL,
      );
      // Echo it back on the target year: every reading agrees, so the run stays
      // monotone and never trips the null-run or contradiction stops. What is
      // measured here is the counter, not the bracket.
      if (last.reading) readings.push({ ...last.reading, year: 1700 });
    }
    return { last, readings };
  }

  it("does not fire below the bound and fires once past it", async () => {
    const under = await probe(20, "/projects/alpha");
    expect(under.readings).toHaveLength(20);
    expect(new Set(under.readings.map((r) => r.imageId)).size).toBe(20);
    expect(under.last.browseBudget).toBeUndefined();

    const over = await probe(1, "/projects/alpha", under.readings);
    expect(over.last.browseBudget).toMatchObject({
      imageGroup: PREFIX,
      distinctImagesRead: 21,
    });
    // The bisect's own wording, not the transcription hunt's — telling a
    // converging bisect to "pivot to the indexed route" is the regression.
    expect(over.last.browseBudget!.notice).toContain("bisect");
    expect(over.last.browseBudget!.notice).not.toContain("transcribed");
  });

  it("charges the project's key, not a shared one", async () => {
    const alpha = await probe(20, "/projects/alpha");
    // Keyed on the group alone, or on the `<no-project>` sentinel, this 21st
    // read lands in alpha's bucket and fires. Keyed on the project, it is
    // beta's first.
    const beta = await probe(1, "/projects/beta", [...alpha.readings]);
    expect(beta.last.browseBudget).toBeUndefined();

    const sentinel = await probe(1, undefined, [...alpha.readings]);
    expect(sentinel.last.browseBudget).toBeUndefined();
  });

  it("normalizes the project path before keying", async () => {
    const alpha = await probe(20, "/projects/alpha");
    // The same project spelled differently must not get a fresh budget.
    const same = await probe(1, "/projects/alpha/", alpha.readings);
    expect(same.last.browseBudget).toBeDefined();
  });
});

describe("parseProbeYear", () => {
  it("takes the first four-digit run inside the register range", () => {
    expect(parseProbeYear("1729")).toBe(1729);
    expect(parseProbeYear("Anno Domini 1729")).toBe(1729);
    // A page number ahead of the heading is the shape "first run, then range
    // check" gets wrong.
    expect(parseProbeYear("0342 1729")).toBe(1729);
  });

  it("returns null rather than a digit slice of a longer run", () => {
    expect(parseProbeYear("NO YEAR")).toBeNull();
    expect(parseProbeYear("")).toBeNull();
    // `Number.parseInt` reads 16 out of this; the four-digit rule must not.
    expect(parseProbeYear("16000")).toBeNull();
    // The filming stamp the ceiling excludes.
    expect(parseProbeYear("DEC 2 . 1952")).toBeNull();
  });
});

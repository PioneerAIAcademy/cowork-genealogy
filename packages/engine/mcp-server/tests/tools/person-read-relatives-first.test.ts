import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

/**
 * `readPerson`'s `relativeSourcesFirst` (set by `project_create`): memory OCR waits
 * until the relatives' attached-source read has settled, so an OCR leg that eats the
 * whole budget cannot starve it. Without the option the two still overlap, and the
 * same OCR leaves every relative skipped.
 *
 * The relatives' read is mocked at the module boundary and reads the clock after a
 * real 30 ms, as a fetch would; the OCR mock moves the clock past the deadline.
 */
vi.mock("../../src/utils/relative-sources.js", () => ({
  fetchRelativeSources: vi.fn(),
  fetchSourceDescriptions: vi.fn(async () => ({ descriptions: [], skipped: [] })),
}));
vi.mock("../../src/tools/image-transcribe.js", () => ({ imageTranscribeTool: vi.fn() }));
vi.mock("../../src/auth/refresh.js", () => ({ getValidToken: vi.fn() }));

import { fetchRelativeSources } from "../../src/utils/relative-sources.js";
import { imageTranscribeTool } from "../../src/tools/image-transcribe.js";
import { getValidToken } from "../../src/auth/refresh.js";
import { readPerson } from "../../src/tools/person-read.js";
import { LOCAL } from "../../src/auth/principal.js";

let clockOffset = 0;
const realNow = Date.now.bind(Date);
vi.spyOn(Date, "now").mockImplementation(() => realNow() + clockOffset);
afterAll(() => vi.mocked(Date.now).mockRestore());

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const PID = "SUBJ-001";
const ART = "https://sg30p0.familysearch.org/ark:/61903/3:1:d1/v2/d1/dist.jpg";

const treeBody = {
  persons: [
    { id: PID, living: false, names: [{ nameForms: [{ fullText: "Ann Subject" }] }] },
    {
      id: "KID-0001",
      living: false,
      names: [{ nameForms: [{ fullText: "Bea Child" }] }],
      sources: [
        {
          description: "https://api.familysearch.org/platform/sources/descriptions/REL-9AA",
          descriptionId: "REL-9AA",
        },
      ],
    },
  ],
  childAndParentsRelationships: [{ parent1: { resourceId: PID }, child: { resourceId: "KID-0001" } }],
  sourceDescriptions: [],
};

const memory = {
  id: "d1",
  mediaType: "image/jpeg",
  about: ART,
  titles: [{ value: "Will" }],
  artifactMetadata: [{ qualifiers: [{ name: "http://familysearch.org/v1/Document" }] }],
  links: { memory: { href: "https://www.familysearch.org/memories/d1" } },
};

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

beforeEach(() => {
  clockOffset = 0;
  vi.mocked(getValidToken).mockResolvedValue("tok");
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) => {
    const u = String(url);
    if (u.includes("/portrait")) return new Response(null, { status: 404 });
    if (u.includes("/memories")) return json({ sourceDescriptions: [memory], links: {} });
    return json(treeBody);
  });
  vi.mocked(fetchRelativeSources).mockReset();
  vi.mocked(fetchRelativeSources).mockImplementation(async (ids, _principal, deadline) => {
    await new Promise((r) => setTimeout(r, 30));
    if (Date.now() >= deadline) return { descriptions: [], skipped: ids };
    return {
      descriptions: [{ id: "REL-9AA", titles: [{ value: "Bea's census" }] }],
      skipped: [],
      idsBy: { "KID-0001": ["REL-9AA"] },
    };
  });
  vi.mocked(imageTranscribeTool).mockReset();
  // An OCR that spends the whole budget and more.
  vi.mocked(imageTranscribeTool).mockImplementation(async () => {
    clockOffset += 60_000;
    return { transcription: "OCR TEXT" } as never;
  });
});

describe("readPerson — relatives' sources before memory OCR", () => {
  it("reads the relatives' sources even when OCR would spend the whole budget", async () => {
    const out = await readPerson(PID, { relativeSourcesFirst: true }, LOCAL);
    expect(out.relativeSourcesSkipped).toEqual([]);
    expect(out.result.sources.map((s) => s.id)).toContain("REL-9AA");
    expect(out.result.persons.find((p) => p.id === "KID-0001")?.sources).toEqual([{ ref: "REL-9AA" }]);
    // OCR still runs, on what the relatives left.
    expect(imageTranscribeTool).toHaveBeenCalledTimes(1);
    expect(out.result.sources.find((s) => s.id === "d1")?.text).toBe("OCR TEXT");
  });

  it("without the option, the same OCR starves them and names who was skipped", async () => {
    const out = await readPerson(PID, {}, LOCAL);
    expect(out.relativeSourcesSkipped).toEqual(["KID-0001"]);
    expect(out.result.sources.map((s) => s.id)).not.toContain("REL-9AA");
    expect(out.result.notes?.join(" ")).toMatch(/1 of 1 relatives' attached sources could not be read/);
  });
});

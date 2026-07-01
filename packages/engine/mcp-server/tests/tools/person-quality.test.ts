import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/auth/refresh.js", () => ({
  getValidToken: vi.fn(),
}));

import { personQualityTool } from "../../src/tools/person-quality.js";
import { getValidToken } from "../../src/auth/refresh.js";
import {
  renderIssueSentence,
  lookupTemplate,
} from "../../src/tools/person-quality-templates.js";
import type { FSQualityResponse } from "../../src/types/person-quality.js";

const mockedGetValidToken = vi.mocked(getValidToken);
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
  mockedGetValidToken.mockReset();
  mockedGetValidToken.mockResolvedValue("test-token");
});

afterEach(() => {
  vi.restoreAllMocks();
});

function mockOk(body: FSQualityResponse): void {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    headers: new Headers(),
  });
}

function mockStatus(status: number, headers: Record<string, string> = {}): void {
  mockFetch.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve({}),
    headers: new Headers(headers),
  });
}

// ─── Template rendering (offline, no fetch) ─────────────────────────────────

describe("renderIssueSentence", () => {
  it("uses the definite article for birth-group conclusion types", () => {
    expect(
      renderIssueSentence({ issueType: "MISSING_EVENT_DATE", conclusionType: "BURIAL" }),
    ).toBe("The burial date is missing.");
  });

  it("uses the indefinite article for marriage/residence", () => {
    expect(
      renderIssueSentence({ issueType: "DAY_NOT_SPECIFIED", conclusionType: "MARRIAGE" }),
    ).toBe("A marriage date is missing a day.");
    expect(
      renderIssueSentence({
        issueType: "MISSING_TAGGED_SOURCE_INFORMATIONAL",
        conclusionType: "RESIDENCE",
      }),
    ).toBe("A residence has no tagged sources.");
  });

  it("interpolates arbitrary fields", () => {
    expect(
      renderIssueSentence({
        issueType: "NON_STANDARD_PLACE",
        conclusionType: "BIRTH",
        originalPlace: "New York, United States",
      }),
    ).toBe(
      "The birth is missing a standardized location for New York, United States.",
    );
    expect(
      renderIssueSentence({
        issueType: "CHILD_COUNT",
        actualChildCount: 39,
        profileChildCount: 10,
      }),
    ).toBe("This person has 39 children. Most people had 10 or fewer.");
  });

  it("handles IMPOSSIBLE_EVENT_ORDER event-vs-event with both articles", () => {
    expect(
      renderIssueSentence({
        issueType: "IMPOSSIBLE_EVENT_ORDER",
        firstConclusionType: "BURIAL",
        secondConclusionType: "DEATH",
      }),
    ).toBe("The burial happened before the death.");
    expect(
      renderIssueSentence({
        issueType: "IMPOSSIBLE_EVENT_ORDER",
        firstConclusionType: "MARRIAGE",
        secondConclusionType: "BIRTH",
      }),
    ).toBe("A marriage happened before the birth.");
  });

  it("handles a bespoke relative event-order sentence", () => {
    expect(
      renderIssueSentence({
        issueType: "IMPOSSIBLE_EVENT_ORDER",
        firstConclusionType: "DEATH",
        secondConclusionType: "PARENT_BIRTH",
        parentGivenName: "Mary Jane",
      }),
    ).toBe("This person died before their parent, Mary Jane, was born.");
  });

  it("falls back for an unknown issueType without throwing", () => {
    const s = renderIssueSentence({
      issueType: "SOME_NEW_ISSUE",
      conclusionType: "NAME",
      scoreType: "CONSISTENCY",
    });
    expect(s).toBe("A consistency issue (SOME_NEW_ISSUE) was found on the name.");
    expect(lookupTemplate({ issueType: "SOME_NEW_ISSUE" })).toBeNull();
  });
});

// ─── Tool (mocked fetch + auth) ─────────────────────────────────────────────

describe("personQualityTool", () => {
  it("maps issues to sentences, counts categories, and summarizes", async () => {
    mockOk({
      isValid: true,
      visibility: "PUBLIC",
      personScores: {
        pid: "KD96-TV2",
        segment: "Norway 1816 - 1920",
        overallDisplayScore: 0.97,
        completenessScore: { displayScore: 0.91 },
        verifiabilityScore: { displayScore: 1 },
        consistencyScore: { displayScore: 1 },
        coherenceScore: { displayScore: 1 },
        issues: [
          {
            issueType: "MISSING_EVENT_DATE",
            conclusionType: "BURIAL",
            conclusionId: "d57d443f",
            scoreType: "COMPLETENESS",
          },
          {
            issueType: "MISSING_TAGGED_SOURCE_INFORMATIONAL",
            conclusionType: "RESIDENCE",
            conclusionId: "e77ececa",
            scoreType: "VERIFIABILITY",
          },
        ],
      },
    });

    const result = await personQualityTool({ personId: "KD96-TV2" });

    expect(result.personId).toBe("KD96-TV2");
    expect(result.segment).toBe("Norway 1816 - 1920");
    expect(result.overallScore).toBe(0.97);
    expect(result.qualityBand).toBe("High Quality");
    expect(result.issueCount).toBe(2);
    expect(result.issues[0].sentence).toBe("The burial date is missing.");
    expect(result.issues[0].conclusionId).toBe("d57d443f");
    expect(result.categories).toEqual([
      { scoreType: "COMPLETENESS", count: 1, score: 0.91 },
      { scoreType: "VERIFIABILITY", count: 1, score: 1 },
      { scoreType: "CONSISTENCY", count: 0, score: 1 },
      { scoreType: "COHERENCE", count: 0, score: 1 },
    ]);
  });

  it("sends bearer token + browser UA to the beta host", async () => {
    mockOk({ isValid: true, personScores: { issues: [] } });
    await personQualityTool({ personId: "KD96-TV2" });
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe(
      "https://sg30p0.familysearch.org/service/tree/tree-data/quality/person/KD96-TV2/scores",
    );
    expect(opts.headers.Authorization).toBe("Bearer test-token");
    expect(opts.headers["User-Agent"]).toContain("Mozilla/5.0");
  });

  it("treats a clean person (personScores present, no issues) as zero issues", async () => {
    mockOk({ isValid: true, personScores: { overallDisplayScore: 1, issues: [] } });
    const result = await personQualityTool({ personId: "CLEAN-1" });
    expect(result.issueCount).toBe(0);
    expect(result.issues).toEqual([]);
    expect(result.qualityBand).toBe("High Quality");
  });

  it("throws on NOT_FOUND (no personScores) — not a clean person", async () => {
    mockOk({ isValid: true, visibility: "NOT_FOUND" });
    await expect(personQualityTool({ personId: "ZZZZ-ZZZ" })).rejects.toThrow(
      /not found or not visible/,
    );
  });

  it("throws a re-auth message on 401", async () => {
    mockStatus(401);
    await expect(personQualityTool({ personId: "KD96-TV2" })).rejects.toThrow(
      /401.*login tool/s,
    );
  });

  it("surfaces the warning header on a 400 (malformed id)", async () => {
    mockStatus(400, { warning: "Invalid j-encoded identifier: BOGUS-PID" });
    await expect(personQualityTool({ personId: "BOGUS-PID" })).rejects.toThrow(
      /Invalid j-encoded identifier/,
    );
  });

  it("rejects an empty personId before calling the API", async () => {
    await expect(personQualityTool({ personId: "  " })).rejects.toThrow(
      /personId is required/,
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

import { LOCAL } from "../../src/auth/principal.js";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/auth/refresh.js", () => ({
  getValidToken: vi.fn(),
}));

import {
  personQualityTool,
  NOT_FAMILYSEARCH_ID_MESSAGE,
  notLinkedMessage,
} from "../../src/tools/person-quality.js";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getValidToken } from "../../src/auth/refresh.js";
import {
  renderIssueSentence,
  lookupTemplate,
} from "../../src/tools/person-quality-templates.js";
import type {
  FSQualityResponse,
  PersonQualityResult,
  PersonQualityToolResult,
} from "../../src/types/person-quality.js";

const mockedGetValidToken = vi.mocked(getValidToken);

/** Narrow to the scored arm; a not-FamilySearch-id answer here is a test failure. */
function scored(r: PersonQualityToolResult): PersonQualityResult {
  if ("reason" in r) throw new Error(`expected a scored result, got ${r.reason}`);
  return r;
}
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

    const result = scored(await personQualityTool({ personId: "KD96-TV2" }, LOCAL));

    expect(result.personId).toBe("KD96-TV2");
    expect(result.segment).toBe("Norway 1816 - 1920");
    expect(result.overallScore).toBe(0.97);
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
    await personQualityTool({ personId: "KD96-TV2" }, LOCAL);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe(
      "https://sg30p0.familysearch.org/service/tree/tree-data/quality/person/KD96-TV2/scores",
    );
    expect(opts.headers.Authorization).toBe("Bearer test-token");
    expect(opts.headers["User-Agent"]).toContain("Mozilla/5.0");
  });

  it("treats a clean person (personScores present, no issues) as zero issues", async () => {
    mockOk({ isValid: true, personScores: { overallDisplayScore: 1, issues: [] } });
    const result = scored(await personQualityTool({ personId: "KD96-TV7" }, LOCAL));
    expect(result.issueCount).toBe(0);
    expect(result.issues).toEqual([]);
    expect(result.overallScore).toBe(1);
  });

  it("throws on NOT_FOUND (no personScores) — not a clean person", async () => {
    mockOk({ isValid: true, visibility: "NOT_FOUND" });
    await expect(personQualityTool({ personId: "ZZZZ-ZZZ" }, LOCAL)).rejects.toThrow(
      /not found or not visible/,
    );
  });

  it("retries while CALCULATING, then returns the score", async () => {
    vi.useFakeTimers();
    mockOk({ isValid: false, visibility: "CALCULATING" });
    mockOk({ isValid: true, personScores: { overallDisplayScore: 1, issues: [] } });
    const promise = personQualityTool({ personId: "KD96-TV2" }, LOCAL);
    await vi.runAllTimersAsync();
    const result = scored(await promise);
    expect(result.issueCount).toBe(0);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("gives up after the max attempts if it never stops CALCULATING", async () => {
    vi.useFakeTimers();
    for (let i = 0; i < 5; i++) mockOk({ isValid: false, visibility: "CALCULATING" });
    const promise = personQualityTool({ personId: "KD96-TV2" }, LOCAL);
    const assertion = expect(promise).rejects.toThrow(/still calculating/);
    await vi.runAllTimersAsync();
    await assertion;
    expect(mockFetch).toHaveBeenCalledTimes(5);
    vi.useRealTimers();
  });

  it("throws a tombstoned message when TOMBSTONED", async () => {
    mockOk({ isValid: true, visibility: "TOMBSTONED" });
    await expect(personQualityTool({ personId: "KD96-TV5" }, LOCAL)).rejects.toThrow(
      /tombstoned/,
    );
  });

  it("throws a re-auth message on 401", async () => {
    mockStatus(401);
    await expect(personQualityTool({ personId: "KD96-TV2" }, LOCAL)).rejects.toThrow(
      /401.*login tool/s,
    );
  });

  it("surfaces the warning header on a 400 (malformed id)", async () => {
    mockStatus(400, { warning: "Invalid j-encoded identifier: ZZZZ-ZZ9" });
    await expect(personQualityTool({ personId: "ZZZZ-ZZ9" }, LOCAL)).rejects.toThrow(
      /Invalid j-encoded identifier/,
    );
  });

  it("rejects an empty personId before calling the API", async () => {
    await expect(personQualityTool({ personId: "  " }, LOCAL)).rejects.toThrow(
      /personId is required/,
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ─── Opt-in detail (#2225 D2) ───────────────────────────────────────────────
// Shapes here mirror the live KD96-TV2 body documented in
// dev/probe-person-quality-detail.ts's RESULTS header. Values are synthetic on
// purpose: the real body is gitignored (.gitignore, probe-*.out.json) because it
// carries a real person's names and dates, so a test reading it would pass
// locally and fail in CI with ENOENT — and committing its contents would put
// back exactly the data that ignore rule exists to keep out.
describe("personQualityTool detail flag", () => {
  // Two facts, one clean and one with an issue; three sources, one of which
  // repeats a conclusion id inside its own conclusions[] (13 of 28 real sources
  // do) so the uri dedupe is exercised rather than assumed.
  function detailBody(): FSQualityResponse {
    return {
      isValid: true,
      visibility: "PUBLIC",
      personScores: {
        pid: "BBBB-111",
        segment: "Testland 1800 - 1900",
        overallDisplayScore: 0.9,
        issues: [
          {
            id: "COMPLETENESS:MISSING_EVENT_DATE:BURIAL:c-burial",
            issueType: "MISSING_EVENT_DATE",
            conclusionType: "BURIAL",
            conclusionId: "c-burial",
            scoreType: "COMPLETENESS",
          },
        ],
        conclusionScores: [
          {
            conclusionId: "c-name",
            conclusionType: "NAME",
            affectingIssueIds: [],
            combinedDisplayScore: 1,
          },
          {
            conclusionId: "c-burial",
            conclusionType: "BURIAL",
            affectingIssueIds: ["COMPLETENESS:MISSING_EVENT_DATE:BURIAL:c-burial"],
            combinedDisplayScore: 0.5,
          },
          {
            conclusionId: "c-marriage",
            conclusionType: "MARRIAGE",
            affectingIssueIds: [],
            combinedDisplayScore: 1,
            relationshipId: "M111-AAA",
          },
        ],
        sourceClusters: {
          sourceClusters: [
            {
              sources: [
                {
                  uri: "https://example.org/ark:/1",
                  title: "1900 census",
                  // Same conclusion twice — upstream really does this.
                  conclusions: [
                    { id: "c-name", agreesWithSource: true },
                    { id: "c-name", agreesWithSource: true },
                    { id: "c-burial", agreesWithSource: false },
                  ],
                },
                {
                  uri: "https://example.org/ark:/2",
                  title: "Death index",
                  conclusions: [{ id: "c-name", agreesWithSource: true }],
                },
              ],
            },
          ],
          conflicts: [],
        },
      },
    };
  }

  it("omits detail entirely when the flag is off", async () => {
    mockOk(detailBody());
    const result = scored(await personQualityTool({ personId: "BBBB-111" }, LOCAL));
    // Absent, not empty: this is the byte-identical guarantee D2 rests on.
    expect(result.detail).toBeUndefined();
    expect("detail" in result).toBe(false);
  });

  it("returns a result identical to the flag-off one, minus detail", async () => {
    mockOk(detailBody());
    const off = scored(await personQualityTool({ personId: "BBBB-111" }, LOCAL));
    mockOk(detailBody());
    const on = scored(await personQualityTool({ personId: "BBBB-111", detail: true }, LOCAL));
    const { detail, ...onWithoutDetail } = on;
    expect(detail).toBeDefined();
    expect(onWithoutDetail).toEqual(off);
  });

  it("renders each fact's affecting issues as sentences, not raw ids", async () => {
    mockOk(detailBody());
    const result = scored(await personQualityTool({ personId: "BBBB-111", detail: true }, LOCAL));
    const burial = result.detail?.facts.find((f) => f.conclusionType === "BURIAL");
    // The raw id joins onto issues[].id, which this tool's output does not
    // carry — so passing the id through would hand the caller a dangling key.
    expect(burial?.issues).toEqual(["The burial date is missing."]);
    expect(burial?.score).toBe(0.5);
    const name = result.detail?.facts.find((f) => f.conclusionType === "NAME");
    expect(name?.issues).toEqual([]);
  });

  it("carries relationshipId only on the conclusions that have one", async () => {
    mockOk(detailBody());
    const result = scored(await personQualityTool({ personId: "BBBB-111", detail: true }, LOCAL));
    const byType = new Map(
      result.detail?.facts.map((f) => [f.conclusionType, f]) ?? [],
    );
    expect(byType.get("MARRIAGE")?.relationshipId).toBe("M111-AAA");
    expect("relationshipId" in (byType.get("NAME") ?? {})).toBe(false);
  });

  it("dedupes a fact's sources by uri and keeps each source's agreement", async () => {
    mockOk(detailBody());
    const result = scored(await personQualityTool({ personId: "BBBB-111", detail: true }, LOCAL));
    const name = result.detail?.facts.find((f) => f.conclusionType === "NAME");
    // ark:/1 lists c-name twice; it must appear once.
    expect(name?.sources).toEqual([
      { title: "1900 census", uri: "https://example.org/ark:/1", agrees: true },
      { title: "Death index", uri: "https://example.org/ark:/2", agrees: true },
    ]);
    const burial = result.detail?.facts.find((f) => f.conclusionType === "BURIAL");
    expect(burial?.sources).toEqual([
      { title: "1900 census", uri: "https://example.org/ark:/1", agrees: false },
    ]);
  });

  it("leaves sources empty for a conclusion nothing is attached to", async () => {
    mockOk(detailBody());
    const result = scored(await personQualityTool({ personId: "BBBB-111", detail: true }, LOCAL));
    // Real data is sparse: only 5 of KD96-TV2's 14 conclusions have any source.
    const marriage = result.detail?.facts.find((f) => f.conclusionType === "MARRIAGE");
    expect(marriage?.sources).toEqual([]);
  });

  it("groups the pairwise conflict list down to one entry per disagreement", async () => {
    // Upstream restates one disagreement once per source pair, so the raw list
    // is quadratic in the number of sources holding the field. KD96-TV2 returns
    // 50 entries encoding 5 real disagreements; this reproduces that shape with
    // synthetic values and the same source counts (11, 7, 7, 6, 4).
    const groups = [
      { name: "Birth Date", values: ["+1876-10-02", "+1877"], sources: 11 },
      { name: "Birth Date", values: ["+1876-10", "+1877"], sources: 7 },
      { name: "Birth Date", values: ["+1876", "+1877"], sources: 7 },
      { name: "Name", values: ["ALPHA ONE", "ALPHA TWO"], sources: 6 },
      { name: "Name", values: ["BETA ONE", "ALPHA TWO"], sources: 4 },
    ];
    const conflicts: NonNullable<
      NonNullable<FSQualityResponse["personScores"]>["sourceClusters"]
    >["conflicts"] = [];
    groups.forEach((g, gi) => {
      // Every unordered pair within the group restates the same disagreement.
      for (let a = 0; a < g.sources; a++) {
        for (let b = a + 1; b < g.sources; b++) {
          conflicts.push({
            sourceUris: [`https://example.org/g${gi}/s${a}`, `https://example.org/g${gi}/s${b}`],
            conflictingFields: [{ name: g.name, values: g.values }],
          });
        }
      }
    });
    expect(conflicts.length).toBeGreaterThan(50);

    const body = detailBody();
    body.personScores!.sourceClusters!.conflicts = conflicts;
    mockOk(body);
    const result = scored(await personQualityTool({ personId: "BBBB-111", detail: true }, LOCAL));

    // The number matters: `toBeLessThan(conflicts.length)` would pass on a
    // reduction that collapsed nothing useful.
    expect(result.detail?.conflicts).toHaveLength(5);
    const birthDate = result.detail?.conflicts.filter((c) => c.field === "Birth Date");
    expect(birthDate).toHaveLength(3);
    // Values are sorted, so the grouping key is order-independent.
    expect(birthDate?.map((c) => c.values)).toContainEqual(["+1876-10-02", "+1877"]);
    // Each group carries every source that took part, not just the last pair.
    const eleven = result.detail?.conflicts.find(
      (c) => c.values.join() === ["+1876-10-02", "+1877"].join(),
    );
    expect(eleven?.sources).toHaveLength(11);
  });

  it("returns no conflicts when upstream sends none", async () => {
    mockOk(detailBody());
    const result = scored(await personQualityTool({ personId: "BBBB-111", detail: true }, LOCAL));
    expect(result.detail?.conflicts).toEqual([]);
  });

  it("tolerates a body with neither list present", async () => {
    const body = detailBody();
    delete body.personScores!.conclusionScores;
    delete body.personScores!.sourceClusters;
    mockOk(body);
    const result = scored(await personQualityTool({ personId: "BBBB-111", detail: true }, LOCAL));
    expect(result.detail).toEqual({ facts: [], conflicts: [] });
  });
});

describe("person_quality — ids that are not FamilySearch person ids", () => {
  // A project's local ids (and anything FamilySearch would refuse on format) are
  // answered without a network call and without a token.
  it.each(["I1", "i1", "P123", " I1 ", "I10"])(
    "answers %j without fetching and without a token",
    async (personId) => {
      const result = await personQualityTool({ personId }, LOCAL);
      expect(result).toEqual({
        ok: false,
        reason: "not_familysearch_id",
        errors: [NOT_FAMILYSEARCH_ID_MESSAGE],
      });
      expect(mockFetch).not.toHaveBeenCalled();
      expect(mockedGetValidToken).not.toHaveBeenCalled();
    },
  );

  it("never tells a researcher who is not logged in to log in for such an id", async () => {
    mockedGetValidToken.mockRejectedValue(new Error("Call the login tool to authenticate."));
    const result = await personQualityTool({ personId: "I1" }, LOCAL);
    expect("reason" in result && result.reason).toBe("not_familysearch_id");
  });

  it("message names no id, no id type, and claims nothing about FamilySearch linkage", () => {
    // init-project gives imported people a local id AND keeps their FamilySearch
    // link in `ark`, so a sentence about the person's linkage would be false for them.
    expect(NOT_FAMILYSEARCH_ID_MESSAGE).not.toMatch(/\bI\d+\b/);
    expect(NOT_FAMILYSEARCH_ID_MESSAGE).not.toMatch(/synthetic|local id|linked/i);
  });

  it.each(["KD96-TV2", "kd96-tv2", " KD96-TV2 "])(
    "still asks FamilySearch for the FamilySearch id %j",
    async (personId) => {
      mockOk({ isValid: true, personScores: { overallDisplayScore: 1, issues: [] } });
      const result = scored(await personQualityTool({ personId }, LOCAL));
      expect(result.issueCount).toBe(0);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    },
  );
});

describe("person_quality — a project's local id, looked up in the project tree", () => {
  function project(persons: unknown[] | string): string {
    const dir = mkdtempSync(join(tmpdir(), "pq-"));
    writeFileSync(
      join(dir, "tree.gedcomx.json"),
      typeof persons === "string" ? persons : JSON.stringify({ persons }),
      "utf-8",
    );
    return dir;
  }
  const patrick = (extra: Record<string, unknown> = {}) => ({
    id: "I1",
    names: [{ given: "Patrick", surname: "Flynn", preferred: true }],
    ...extra,
  });

  it.each([
    ["a bare tree ark", "ark:/61903/4:1:MKVT-7XR"],
    ["a resolver URL", "https://familysearch.org/ark:/61903/4:1:MKVT-7XR"],
  ])("scores an imported person under the id in their link (%s)", async (_label, ark) => {
    mockOk({ isValid: true, personScores: { overallDisplayScore: 0.9, issues: [] } });
    const projectPath = project([patrick({ ark })]);
    const result = scored(await personQualityTool({ personId: "I1", projectPath }, LOCAL));
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toContain("/quality/person/MKVT-7XR/scores");
    expect(result.personId).toBe("MKVT-7XR");
  });

  it("answers a person with no FamilySearch link truthfully, by name, without a network call", async () => {
    const projectPath = project([patrick()]);
    const result = await personQualityTool({ personId: "I1", projectPath }, LOCAL);
    expect(result).toEqual({
      ok: false,
      reason: "not_familysearch_id",
      errors: [notLinkedMessage("Patrick Flynn")],
    });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockedGetValidToken).not.toHaveBeenCalled();
  });

  it("treats a record-persona (1:1:) link as no tree link", async () => {
    const projectPath = project([patrick({ ark: "ark:/61903/1:1:QPRC-WPBZ" })]);
    const result = await personQualityTool({ personId: "I1", projectPath }, LOCAL);
    expect("reason" in result && result.errors).toEqual([notLinkedMessage("Patrick Flynn")]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it.each([
    ["the person's tree link holds an id that is not a FamilySearch id",
      () => project([patrick({ ark: "https://familysearch.org/ark:/61903/4:1:KWCJ-JAM7" })])],
    ["the person is not in the tree", () => project([{ id: "I9", names: [] }])],
    ["the tree file is missing", () => mkdtempSync(join(tmpdir(), "pq-empty-"))],
    ["the tree file is not JSON", () => project("{not json")],
    ["the person has no name", () => project([{ id: "I1", names: [] }])],
  ])("falls back to the neutral sentence when %s, without throwing", async (_label, make) => {
    const result = await personQualityTool({ personId: "I1", projectPath: make() }, LOCAL);
    expect(result).toEqual({
      ok: false,
      reason: "not_familysearch_id",
      errors: [NOT_FAMILYSEARCH_ID_MESSAGE],
    });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockedGetValidToken).not.toHaveBeenCalled();
  });

  it("never puts the local id or its type into the sentence", async () => {
    const result = await personQualityTool({ personId: "I1", projectPath: project([patrick()]) }, LOCAL);
    const sentence = "reason" in result ? result.errors[0] : "";
    expect(sentence).not.toMatch(/\bI1\b/);
    expect(sentence).not.toMatch(/synthetic|local id|project id/i);
  });
});

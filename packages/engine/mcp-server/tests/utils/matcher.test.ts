import { LOCAL } from "../../src/auth/principal.js";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const settingsMock = vi.hoisted(() => vi.fn());
const hostedMock = vi.hoisted(() => vi.fn());
vi.mock("../../src/auth/config.js", async (orig) => ({
  ...(await orig<typeof import("../../src/auth/config.js")>()),
  getMatcherSettings: settingsMock,
  isHostedMode: hostedMock,
}));
vi.mock("../../src/utils/match-engine.js", () => ({ scorePair: vi.fn() }));
vi.mock("../../src/utils/http.js", async (orig) => {
  const actual = await orig<typeof import("../../src/utils/http.js")>();
  return { ...actual, fetchWithRetry: vi.fn(actual.fetchWithRetry) };
});

import { matchPairs, FAMILYSEARCH_FLOORS } from "../../src/utils/matcher.js";
import { scorePair } from "../../src/utils/match-engine.js";
import { fetchWithRetry } from "../../src/utils/http.js";
import { Mob } from "../../src/utils/mob.js";
import type { SimplifiedGedcomX } from "../../src/types/gedcomx.js";
import type { MatchPair } from "../../src/types/matcher.js";

const scorePairMock = vi.mocked(scorePair);
const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const URL_ = "http://127.0.0.1:8765";
const KEY = "feedfacecafebeef0123456789abcdef";
const SERVICE = { backend: "service", url: URL_, apiKey: KEY };
const FS = { concurrency: 10, retry: true };

const MODEL = {
  version: "m16",
  sha256: "abc",
  band: [0.04, 0.94],
  jev_pin: "jev-1.14.0",
  cutoffs: { floors: { thin_subject: 0.3, real_negative: 0.05 } },
};

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

/** A 200 that scores each pair it was sent, in order: a number is a score, a
 *  string an error code. */
function answer(...outcomes: Array<number | string>) {
  return async (_url: string, init: RequestInit) => {
    const sent = JSON.parse(init.body as string).pairs as Array<{ id: string }>;
    return json({
      model: MODEL,
      results: sent.map((p, i) =>
        typeof outcomes[i] === "number"
          ? { id: p.id, score: outcomes[i], local: outcomes[i], jev: "off", veto: false }
          : { id: p.id, error: { code: outcomes[i] } },
      ),
    });
  };
}

function sentBody(call = 0): { pairs: Array<Record<string, unknown>> } {
  return JSON.parse(fetchMock.mock.calls[call][1].body as string);
}

// A subject S with a parent P, a sibling B, a grandparent G, an uncle U and a
// cousin C. S's family cut holds S, P and B; it leaves out G, U and C.
const FAMILY_TREE: SimplifiedGedcomX = {
  persons: ["S", "P", "B", "G", "U", "C"].map((id) => ({
    id,
    names: [{ given: `Given${id}`, surname: "Family" }],
  })),
  relationships: [
    { type: "ParentChild", parent: "P", child: "S" },
    { type: "ParentChild", parent: "P", child: "B" },
    { type: "ParentChild", parent: "G", child: "P" },
    { type: "ParentChild", parent: "G", child: "U" },
    { type: "ParentChild", parent: "U", child: "C" },
  ],
  sources: [{ title: "a tree source the cut drops" }],
};

const REC: SimplifiedGedcomX = {
  persons: [{ id: "r1", names: [{ given: "GivenS", surname: "Family" }] }],
};
const REC2: SimplifiedGedcomX = {
  persons: [{ id: "q1", names: [{ given: "GivenS", surname: "Familie" }] }],
};
const FS_ONLY: SimplifiedGedcomX = {
  persons: [{ id: "S", names: [{ given: "OnlyFamilySearchSeesThis", surname: "Family" }] }],
};

const treePair = (pid = "S"): MatchPair => ({
  kind: "tree_record", tree: FAMILY_TREE, pid, rec: REC, personaId: "r1", familysearchTree: FS_ONLY,
});
const recordPair = (): MatchPair => ({
  kind: "record_record", rec: REC, personaId: "r1", rec2: REC2, personaId2: "q1",
});

beforeEach(() => {
  settingsMock.mockReset();
  hostedMock.mockReset();
  hostedMock.mockResolvedValue(false);
  scorePairMock.mockReset();
  fetchMock.mockReset();
  vi.mocked(fetchWithRetry).mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("matchPairs: the matcher service", () => {
  beforeEach(() => settingsMock.mockResolvedValue(SERVICE));

  it("posts the whole page in one call with the bearer key", async () => {
    fetchMock.mockImplementation(answer(0.9, 0.2, 0.7));
    await matchPairs([treePair(), treePair(), recordPair()], LOCAL, FS);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(`${URL_}/v1/score`);
    expect(init.method).toBe("POST");
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${KEY}`);
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("accept")).toBe("application/json");
    expect(sentBody().pairs.map((p) => p.id)).toEqual(["0", "1", "2"]);
    expect(sentBody()).not.toHaveProperty("jev");
  });

  it("goes through fetchWithRetry with a 15 s timeout and a 15 s budget", async () => {
    fetchMock.mockImplementation(answer(0.9));
    await matchPairs([treePair()], LOCAL, FS);
    expect(fetchWithRetry).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetchWithRetry).mock.calls[0].slice(2)).toEqual([15_000, { budgetMs: 15_000 }]);
  });

  it("sends the tree cut around the pid, as Mob.matchSubset cuts it", async () => {
    fetchMock.mockImplementation(answer(0.9));
    await matchPairs([treePair()], LOCAL, FS);
    const tree = sentBody().pairs[0].tree as SimplifiedGedcomX;
    expect(tree).toEqual(new Mob(FAMILY_TREE, "S").matchSubset().gedcomx);
    expect((tree.persons ?? []).map((p) => p.id).sort()).toEqual(["B", "P", "S"]);
  });

  it("never sends FamilySearch's tree document, and sends both records of a record pair", async () => {
    fetchMock.mockImplementation(answer(0.9, 0.8));
    await matchPairs([treePair(), recordPair()], LOCAL, FS);
    const [tree, record] = sentBody().pairs;
    expect(Object.keys(tree).sort()).toEqual(["id", "kind", "personaId", "pid", "rec", "tree"]);
    expect(JSON.stringify(sentBody())).not.toContain("OnlyFamilySearchSeesThis");
    expect(record).toEqual({ id: "1", kind: "record_record", rec: REC, personaId: "r1", rec2: REC2, personaId2: "q1" });
  });

  it("takes the floors and the model from the response", async () => {
    fetchMock.mockImplementation(answer(0.9));
    const call = await matchPairs([treePair()], LOCAL, FS);
    expect(call).toEqual({
      scorer: "service",
      model: "m16",
      floors: { thinSubject: 0.3, realNegative: 0.05 },
      results: [{ score: 0.9 }],
    });
  });

  it("gives a failed pair a null score and its code, and keeps the others' scores", async () => {
    fetchMock.mockImplementation(answer(0.9, "deadline", 0.4));
    const call = await matchPairs([treePair(), treePair(), recordPair()], LOCAL, FS);
    expect(call.results.map((r) => r.score)).toEqual([0.9, null, 0.4]);
    expect(call.results[1].error?.message).toContain("deadline");
    expect(call.results[0].error).toBeUndefined();
  });

  it("does not send a pair whose pid is not in its tree, and gives it pid_not_in_tree", async () => {
    fetchMock.mockImplementation(answer(0.9));
    const call = await matchPairs([treePair("NOPE"), treePair()], LOCAL, FS);
    expect(sentBody().pairs.map((p) => p.id)).toEqual(["1"]);
    expect(call.results[0].score).toBeNull();
    expect(call.results[0].error?.message).toContain("pid_not_in_tree");
    expect(call.results[1].score).toBe(0.9);
  });

  it("posts an empty page once, so a caller still gets the floors", async () => {
    fetchMock.mockImplementation(answer());
    const call = await matchPairs([], LOCAL, FS);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sentBody().pairs).toEqual([]);
    expect(call.floors).toEqual({ thinSubject: 0.3, realNegative: 0.05 });
    expect(call.results).toEqual([]);
  });

  describe("a call that scores no pair throws, and never falls back to FamilySearch", () => {
    afterEach(() => expect(scorePairMock).not.toHaveBeenCalled());

    it("on a 401, telling the desktop how to fix the key, and echoing none of it", async () => {
      fetchMock.mockResolvedValue(json({ error: { code: "unauthorized" } }, 401));
      const err = await matchPairs([treePair()], LOCAL, FS).then(() => null, (e: Error) => e);
      expect(err?.message).toMatch(/401/);
      expect(err?.message).toContain('"matcherApiKey"');
      expect(err?.message).toContain("~/.familysearch-mcp/config.json");
      expect(err?.message).not.toContain(KEY);
      expect(err?.message).not.toContain(KEY.slice(0, 8));
    });

    it("on a 401 in a hosted session, telling the agent to tell the user and not retry", async () => {
      hostedMock.mockResolvedValue(true);
      fetchMock.mockResolvedValue(json({ error: { code: "unauthorized" } }, 401));
      const err = await matchPairs([treePair()], LOCAL, FS).then(() => null, (e: Error) => e);
      expect(err?.message).toMatch(/401/);
      expect(err?.message).toMatch(/do not retry/i);
      expect(err?.message).not.toContain("config.json");
      expect(err?.message).not.toContain(KEY);
    });

    it("on a 413, naming the code", async () => {
      fetchMock.mockResolvedValue(json({ error: { code: "too_many_pairs" } }, 413));
      await expect(matchPairs([treePair()], LOCAL, FS)).rejects.toThrow(/413 too_many_pairs/);
    });

    it("on a 503 busy that outlasts the retries", async () => {
      fetchMock.mockImplementation(async () => json({ error: { code: "busy" } }, 503));
      await expect(matchPairs([treePair()], LOCAL, FS)).rejects.toThrow(/503 busy/);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it("on a transport failure", async () => {
      fetchMock.mockRejectedValue(new TypeError("fetch failed", { cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }) }));
      await expect(matchPairs([treePair()], LOCAL, FS)).rejects.toThrow(/Could not reach the matcher service.*ECONNREFUSED/);
    });

    it.each([
      ["no floors", { model: { version: "m16", cutoffs: {} }, results: [{ id: "0", score: 0.5 }] }],
      ["a floor out of range", { model: { ...MODEL, cutoffs: { floors: { thin_subject: 3, real_negative: 0.05 } } }, results: [{ id: "0", score: 0.5 }] }],
      ["no model version", { model: { cutoffs: MODEL.cutoffs }, results: [{ id: "0", score: 0.5 }] }],
      ["results that do not line up", { model: MODEL, results: [{ id: "1", score: 0.5 }] }],
      ["too few results", { model: MODEL, results: [] }],
      ["a score out of range", { model: MODEL, results: [{ id: "0", score: 1.5 }] }],
      ["a result with neither score nor code", { model: MODEL, results: [{ id: "0" }] }],
    ])("on a response with %s", async (_label, body) => {
      fetchMock.mockResolvedValue(json(body));
      await expect(matchPairs([treePair()], LOCAL, FS)).rejects.toThrow(/matcher service's response could not be read/);
    });

    it("on a response that is not JSON", async () => {
      fetchMock.mockResolvedValue(new Response("<html>gateway</html>", { status: 200 }));
      await expect(matchPairs([treePair()], LOCAL, FS)).rejects.toThrow(/matcher service's response could not be read/);
    });

    it("with the pair's own error when the one pair sent failed", async () => {
      fetchMock.mockImplementation(answer("persona_not_in_record"));
      await expect(matchPairs([treePair()], LOCAL, FS)).rejects.toThrow(/persona_not_in_record/);
    });

    it("naming each distinct code when every pair of a larger page failed", async () => {
      fetchMock.mockImplementation(answer("deadline", "deadline", "bad_document"));
      const err = await matchPairs([treePair(), treePair(), recordPair()], LOCAL, FS).then(() => null, (e: Error) => e);
      expect(err?.message).toMatch(/none of the 3 pairs/);
      expect(err?.message).toContain("deadline");
      expect(err?.message).toContain("bad_document");
      expect(err?.message.match(/deadline \(/g)).toHaveLength(1);
    });
  });
});

describe("matchPairs: FamilySearch's matcher", () => {
  beforeEach(() => settingsMock.mockResolvedValue({ backend: "familysearch" }));

  const echo = {
    queryArk: "ark:/61903/1:1:QUERY",
    candidateArk: "ark:/61903/1:1:CAND",
    apiTitle: "Matches for ark:/61903/1:1:QUERY",
    updated: "2026-10-30T00:00:00.000Z",
  };

  it("sends each pair what the call site gives FamilySearch, with its own floors and no model", async () => {
    scorePairMock.mockResolvedValue({ matched: true, confidence: 4, score: 0.8, ...echo });
    const call = await matchPairs([treePair(), recordPair()], LOCAL, FS);

    expect(scorePairMock.mock.calls).toEqual([
      [REC, "r1", FS_ONLY, "S", LOCAL],
      [REC, "r1", REC2, "q1", LOCAL],
    ]);
    expect(call).toEqual({
      scorer: "familysearch",
      model: null,
      floors: FAMILYSEARCH_FLOORS,
      results: [{ score: 0.8, familysearch: echo }, { score: 0.8, familysearch: echo }],
    });
    expect(FAMILYSEARCH_FLOORS).toEqual({ thinSubject: 0.01, realNegative: 0.01 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("with retry, scores again a pair that failed once", async () => {
    scorePairMock
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValue({ matched: false, score: 0.3, ...echo });
    const call = await matchPairs([treePair()], LOCAL, { concurrency: 1, retry: true });
    expect(scorePairMock).toHaveBeenCalledTimes(2);
    expect(call.results[0].score).toBe(0.3);
  });

  it("without retry, keeps the error scorePair threw, the very object", async () => {
    const thrown = new Error("FamilySearch matchTwoExamples API error: 500 Internal.");
    scorePairMock.mockRejectedValueOnce(thrown).mockResolvedValue({ matched: false, score: 0.3, ...echo });
    const call = await matchPairs([treePair(), recordPair()], LOCAL, { concurrency: 1, retry: false });
    expect(scorePairMock).toHaveBeenCalledTimes(2);
    expect(call.results[0]).toEqual({ score: null, error: thrown });
    expect(call.results[0].error).toBe(thrown);
    expect(call.results[1].score).toBe(0.3);
  });

  it("makes no call for an empty page", async () => {
    const call = await matchPairs([], LOCAL, FS);
    expect(scorePairMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(call.results).toEqual([]);
  });
});

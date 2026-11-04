import { LOCAL } from "../../src/auth/principal.js";
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, writeFile, readFile, readdir } from "fs/promises";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";

// What FamilySearch's matcher is sent, and what each caller makes of its
// answers, pinned against a golden generated on main before the matcher shim
// existed. Every request body, both ranking diagnostics and every output must
// stay the same under the FamilySearch backend; the outputs may differ only in
// the fields the shim removes or adds, which `normalize` deletes.
// Regenerate only on the PR's merge base: UPDATE_MATCHER_GOLDEN=1.

vi.mock("../../src/auth/refresh.js", () => ({
  getValidToken: vi.fn(async () => "test-token"),
}));
const recordReadMock = vi.hoisted(() => vi.fn());
vi.mock("../../src/tools/record-read.js", () => ({
  recordReadTool: recordReadMock,
}));
vi.mock("../../src/auth/config.js", async (orig) => ({
  ...(await orig<typeof import("../../src/auth/config.js")>()),
  getMatcherSettings: vi.fn(async () => ({ backend: "familysearch" })),
}));

import { rankSearchMatches } from "../../src/tools/rank-search-matches.js";
import { samePerson } from "../../src/tools/same-person.js";
import { stageSearchResults } from "../../src/utils/results-staging.js";

const GOLDEN = join(
  dirname(fileURLToPath(import.meta.url)),
  "../fixtures/matcher/familysearch-parity.json",
);

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

let requests: Recorded[] = [];
let score = 0.9;

vi.stubGlobal(
  "fetch",
  vi.fn(async (url: string | URL, init: RequestInit = {}) => {
    requests.push({
      url: String(url),
      method: init.method ?? "GET",
      headers: Object.fromEntries(new Headers(init.headers).entries()),
      body: typeof init.body === "string" ? JSON.parse(init.body) : null,
    });
    const entry: Record<string, unknown> = {
      id: "https://familysearch.org/ark:/61903/4:1:KCWM-J9H",
      score,
    };
    if (score >= 0.5) entry.confidence = 4;
    return new Response(
      JSON.stringify({
        entries: [entry],
        results: 1,
        title: "Matches for ark:/61903/4:1:KGS8-LY1",
        updated: "2026-10-30T00:00:00.000Z",
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }),
);

const RECORD = "https://www.familysearch.org/ark:/61903/1:1:PRTY-9ZK";
const OTHER_RECORD = "https://www.familysearch.org/ark:/61903/1:1:CNSS-1790";

const TREE = {
  persons: [
    {
      id: "I1",
      gender: "Male",
      names: [{ preferred: true, given: "Johann Georg", surname: "Hufenreuter" }],
      facts: [
        { type: "Birth", date: "1758", place: "Biesenrode, Sachsen, Preussen", sources: [{ ref: "S1" }] },
        { type: "Residence", date: "1790", place: "Mansfeld, Sachsen, Preussen", sources: [{ ref: "S9" }] },
      ],
    },
    {
      id: "I2",
      gender: "Female",
      names: [{ preferred: true, given: "Anna Maria", surname: "Schmidt" }],
      facts: [{ type: "Birth", date: "1762", place: "Wippra, Sachsen, Preussen" }],
    },
    {
      id: "I3",
      gender: "Male",
      names: [{ preferred: true, given: "Johann Christoph", surname: "Hufenreuter" }],
      facts: [{ type: "Birth", date: "1785", place: "Biesenrode, Sachsen, Preussen" }],
    },
    {
      id: "I4",
      gender: "Male",
      names: [{ preferred: true, given: "Johann Andreas", surname: "Hufenreuter" }],
      facts: [{ type: "Birth", date: "1810", place: "Biesenrode, Sachsen, Preussen" }],
    },
    {
      id: "I5",
      gender: "Male",
      names: [{ preferred: true, given: "Christoph", surname: "Hufenreuter" }],
      facts: [{ type: "Birth", date: "1730", place: "Biesenrode, Sachsen, Preussen" }],
    },
    {
      id: "I6",
      gender: "Male",
      names: [{ preferred: true, given: "Hans", surname: "Hufenreuter" }],
      facts: [{ type: "Birth", date: "1700" }],
    },
    {
      id: "I7",
      names: [{ preferred: true, given: "Wilhelm", surname: "Kunze" }],
    },
  ],
  relationships: [
    { type: "Couple", person1: "I1", person2: "I2" },
    { type: "ParentChild", parent: "I1", child: "I3" },
    { type: "ParentChild", parent: "I2", child: "I3" },
    { type: "ParentChild", parent: "I3", child: "I4" },
    { type: "ParentChild", parent: "I5", child: "I1" },
    { type: "ParentChild", parent: "I6", child: "I5" },
  ],
  sources: [],
};

const RESEARCH = {
  log: [{ id: "log_1", tool: "record_read", results_ref: "results/log_1.json" }],
  sources: [
    { id: "src_001", gedcomx_source_description_id: "S1" },
    { id: "src_009", gedcomx_source_description_id: "S9" },
  ],
  assertions: [
    {
      id: "a_001", record_id: RECORD, record_role: "principal", record_persona_id: "P1",
      fact_type: "name", value: "Johann Georg Hufenreuter",
      structured_value: { given: "Johann Georg", surname: "Hufenreuter" },
      record_basis: "stated", source_id: "src_009", log_entry_id: "log_1",
    },
    {
      id: "a_002", record_id: RECORD, record_role: "principal", record_persona_id: "P1",
      fact_type: "birth", value: "born 11 January 1758 in Biesenrode",
      structured_value: { date: "11 January 1758", place: "Biesenrode, Sachsen, Preussen" },
      record_basis: "stated", source_id: "src_009", log_entry_id: "log_1",
    },
    {
      id: "a_003", record_id: OTHER_RECORD, record_role: "head", record_persona_id: null,
      fact_type: "birth", value: "born 1758", structured_value: { year: "1758" },
      record_basis: "stated", source_id: "src_001", log_entry_id: "log_1",
    },
  ],
  person_evidence: [{ id: "pe_001", person_id: "I1", assertion_id: "a_002" }],
};

/** The record the project arm reads: three personas, related. */
const RECORD_DOC = {
  persons: [
    {
      id: "P1", ark: "https://familysearch.org/ark:/61903/1:1:PRTY-9ZK", gender: "Male", principal: true,
      names: [{ given: "Johann Georg", surname: "Hufenreuter" }],
      facts: [{ type: "Birth", date: "11 Jan 1758", place: "Biesenrode, Sachsen, Preussen" }],
    },
    {
      id: "P2", gender: "Female",
      names: [{ given: "Anna Maria", surname: "Schmidt" }],
    },
    {
      id: "P3", gender: "Male",
      names: [{ given: "Johann Christoph", surname: "Hufenreuter" }],
      facts: [{ type: "Christening", date: "3 Mar 1785", place: "Biesenrode, Sachsen, Preussen" }],
    },
  ],
  relationships: [
    { type: "Couple", person1: "P1", person2: "P2" },
    { type: "ParentChild", parent: "P1", child: "P3" },
    { type: "ParentChild", parent: "P2", child: "P3" },
  ],
  sources: [{ title: "Sachsen, Kirchenbuchduplikat, 1750-1800" }],
};

/** A second record, for the explicit two-document arm. */
const RECORD2_DOC = {
  persons: [
    {
      id: "Q1", gender: "Male",
      names: [{ given: "Georg", surname: "Hufenreuter" }],
      facts: [{ type: "Death", date: "1821", place: "Biesenrode, Sachsen, Preussen" }],
    },
    {
      id: "Q2", gender: "Female",
      names: [{ given: "Anna", surname: "Hufenreuter" }],
    },
    {
      id: "Q3", gender: "Male",
      names: [{ given: "Christoph", surname: "Hufenreuter" }],
    },
  ],
  relationships: [
    { type: "Couple", person1: "Q1", person2: "Q2" },
    { type: "ParentChild", parent: "Q1", child: "Q3" },
  ],
};

/** Three staged rows; the third carries no gedcomx and is never scored. */
const ROWS = [
  {
    recordId: "ark:/61903/1:1:ROW1-AAA",
    primaryId: "r1p",
    personName: "Johann Georg Hufenreuter",
    birthDate: "1758",
    collectionTitle: "Germany, Births and Baptisms",
    events: [{ type: "Christening", date: "13 Jan 1758", place: "Biesenrode" }],
    treeMatches: [],
    gedcomx: {
      persons: [
        {
          id: "r1p", gender: "Male", names: [{ given: "Johann Georg", surname: "Hufenreuter" }],
          facts: [{ type: "Christening", date: "13 Jan 1758", place: "Biesenrode" }],
        },
        { id: "r1f", gender: "Male", names: [{ given: "Christoph", surname: "Hufenreuter" }] },
      ],
      relationships: [{ type: "ParentChild", parent: "r1f", child: "r1p" }],
    },
  },
  {
    recordId: "ark:/61903/1:1:ROW2-BBB",
    primaryId: "r2p",
    personName: "Georg Hufenreiter",
    birthDate: "1771",
    events: [],
    treeMatches: [],
    gedcomx: {
      persons: [
        {
          id: "r2p", gender: "Male", names: [{ given: "Georg", surname: "Hufenreiter" }],
          facts: [{ type: "Birth", date: "1771" }],
        },
      ],
    },
  },
  {
    recordId: "ark:/61903/1:1:ROW3-CCC",
    personName: "J. Hufenreuter",
    events: [],
    treeMatches: [],
  },
];

const REMOVED_OR_ADDED = new Set([
  "matchConfidence", "match_confidence", "matched", "confidence",
  "scorer", "model", "performed", "computed",
]);

/** Deep copy without the fields the shim removes or adds, and the clocks. */
function normalize(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(normalize);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      if (!REMOVED_OR_ADDED.has(k)) out[k] = normalize(x);
    }
    return out;
  }
  if (typeof v === "string") return v.replace(/results\/\.staging\/[0-9a-f-]+\.json/g, "<staged>");
  return v;
}

function sortedRequests(): Recorded[] {
  return [...requests].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

describe("FamilySearch's matcher: requests and outputs unchanged by the shim", () => {
  let dir: string;
  const actual: Record<string, unknown> = {};

  async function scoreLog(): Promise<unknown[]> {
    try {
      const text = await readFile(join(dir, "results/match-scores.jsonl"), "utf-8");
      return text.split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l));
    } catch {
      return [];
    }
  }

  async function attestations(): Promise<unknown[]> {
    const names = (await readdir(join(dir, "results", ".scores"))).sort();
    return Promise.all(
      names.map(async (n) => JSON.parse(await readFile(join(dir, "results", ".scores", n), "utf-8"))),
    );
  }

  async function capture(
    name: string,
    s: number,
    call: () => Promise<unknown>,
    extra: () => Promise<Record<string, unknown>> = async () => ({}),
  ): Promise<void> {
    requests = [];
    score = s;
    const logBefore = (await scoreLog()).length;
    const response = await call();
    const logAfter = await scoreLog();
    actual[name] = normalize({
      requests: sortedRequests(),
      response,
      scoreLog: logAfter.slice(logBefore),
      ...(await extra()),
    });
  }

  async function rank(subjectId: string): Promise<unknown> {
    const handle = await stageSearchResults({
      projectPath: dir,
      tool: "record_search",
      response: { results: ROWS },
    });
    if (!handle) throw new Error("expected a staged handle");
    return rankSearchMatches({ projectPath: dir, stagedResultsRef: handle.resultsRef, subjectId }, LOCAL);
  }

  beforeAll(async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    recordReadMock.mockResolvedValue(RECORD_DOC);
    dir = await mkdtemp(join(tmpdir(), "matcher-parity-"));
    await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify(TREE), "utf-8");
    await writeFile(join(dir, "research.json"), JSON.stringify(RESEARCH), "utf-8");

    await capture("rank", 0.9, () => rank("I1"));
    await capture("rankRealNegative", 0.005, () => rank("I1"));
    await capture("rankThinSubject", 0.005, () => rank("I7"));
    await capture(
      "projectArm",
      0.9,
      () => samePerson({ projectPath: dir, assertionId: "a_001", treePersonId: "I1" }, LOCAL),
      async () => ({ attestation: await attestations() }),
    );
    await capture("projectRelatives", 0.9, () =>
      samePerson({ projectPath: dir, assertionId: "a_001", treePersonId: "I1", matchRelatives: true }, LOCAL),
    );
    await capture("explicitArm", 0.9, () =>
      samePerson({ gedcomx1: RECORD_DOC, primaryId1: "P1", gedcomx2: RECORD2_DOC, primaryId2: "Q1" }, LOCAL),
    );
    await capture("explicitRelatives", 0.9, () =>
      samePerson(
        { gedcomx1: RECORD_DOC, primaryId1: "P1", gedcomx2: RECORD2_DOC, primaryId2: "Q1", matchRelatives: true },
        LOCAL,
      ),
    );
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  it("each call reached FamilySearch's matcher, and both ranking diagnostics fired", () => {
    const calls = actual as Record<string, { requests: Recorded[]; response: any }>;
    expect(calls.rank.requests).toHaveLength(2);
    expect(calls.projectArm.requests).toHaveLength(1);
    expect(calls.projectRelatives.requests.length).toBeGreaterThan(1);
    expect(calls.explicitArm.requests).toHaveLength(1);
    expect(calls.explicitRelatives.requests.length).toBeGreaterThan(1);
    expect(calls.rankRealNegative.response.diagnostic).toMatch(/real negative/);
    expect(calls.rankThinSubject.response.diagnostic).toMatch(/no fact with a date or place/);
  });

  it("sends FamilySearch what main sent and makes the same outputs of its answers", async () => {
    if (process.env.UPDATE_MATCHER_GOLDEN === "1") {
      await writeFile(GOLDEN, JSON.stringify(actual, null, 2) + "\n", "utf-8");
    }
    const golden = JSON.parse(await readFile(GOLDEN, "utf-8"));
    expect(actual).toEqual(golden);
  });
});

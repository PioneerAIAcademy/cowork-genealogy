# `match_by_id` tools — implementation plan

**Goal:** Ship four MCP tools (`person_record_matches`, `record_person_matches`, `person_person_matches`, `record_record_matches`) wrapping the FamilySearch match-resolutions endpoint.

**Architecture:** One shared types file, one tool module with a shared `matchById()` helper + four thin exported wrappers, one dev smoke script, four entries in `src/index.ts`, one vitest file covering all four, README rows. Each tool differs only by `(collection, expected-ark-prefix)`.

**Tech Stack:** TypeScript, Node 18+ `fetch`, MCP SDK, vitest, existing `getValidToken()` + `BROWSER_USER_AGENT`.

**Spec:** `docs/specs/match-by-id-tools-spec.md`.

---

## File Structure

| File                                                | Purpose                                                                                     |
|-----------------------------------------------------|---------------------------------------------------------------------------------------------|
| `packages/engine/mcp-server/src/types/match-by-id.ts`               | Input / output / raw-API types shared by all four tools.                                    |
| `packages/engine/mcp-server/src/tools/match-by-id.ts`               | Shared `matchById()` helper + four exported tool functions + four exported MCP schemas.     |
| `packages/engine/mcp-server/dev/try-match-by-id.ts`                 | After-the-fact smoke test against live FS.                                                  |
| `packages/engine/mcp-server/src/index.ts`                           | Add 4 imports, 4 schemas to the list, 4 dispatch branches.                                  |
| `packages/engine/mcp-server/tests/tools/match-by-id.test.ts`        | Mocked-fetch vitest suite covering validation, URL construction, response parsing, errors.  |
| `README.md`                                         | Add the 4 tools to the catalog.                                                             |

Existing artifacts being kept untouched: `dev/probe-match-by-id.ts`, `dev/probe-match-status.ts`, `dev/probe-match-misc.ts` (the evidence trail for the spec).

---

### Task 1: Types

**Files:** Create `packages/engine/mcp-server/src/types/match-by-id.ts`

- [ ] **Step 1: Write the file**

```typescript
// src/types/match-by-id.ts

export type MatchStatus = "accepted" | "pending" | "rejected";
export type MatchArkType = "1:1:" | "4:1:";
export type MatchConfidence = 1 | 2 | 3 | 4 | 5;

/** Input shared by all four match-by-id tools. */
export interface MatchByIdInput {
  /**
   * Bare personId (e.g. "KNDX-MKG") or full ARK
   * ("ark:/61903/4:1:KNDX-MKG" or its https://familysearch.org/... form).
   * The prefix is enforced per-tool.
   */
  id: string;
  /** 1..5, default 2. */
  minConfidence?: number;
  /** Subset of ["accepted", "pending", "rejected"]; default all three. */
  status?: MatchStatus[];
  /** When true, each match includes the full gedcomx summary. Default false. */
  includeSummary?: boolean;
  /** Page size 1..50; default 20. */
  count?: number;
}

export interface MatchByIdMatch {
  ark: string;
  pid: string;
  arkType: MatchArkType;
  confidence: MatchConfidence;
  score: number;
  title: string;
  status: MatchStatus;
  collection: string;
  published?: string;
  summary?: unknown;
}

export interface MatchByIdResult {
  queryArk: string;
  resultCount: number;
  returned: number;
  title: string;
  updated: string;
  matches: MatchByIdMatch[];
}

// ─── Upstream API shape (internal — exported for tests only) ───────────────

export interface MatchApiMatchInfo {
  collection?: string;
  status?: string; // URI form, e.g. "http://familysearch.org/v1/Accepted"
}

export interface MatchApiEntry {
  id: string;            // e.g. "https://familysearch.org/ark:/61903/1:1:QPZP-Y6G4"
  confidence?: number;   // 1..5
  score?: number;        // 0..1
  title?: string;
  published?: string;
  matchInfo?: MatchApiMatchInfo[];
  content?: { gedcomx?: unknown };
}

export interface MatchApiResponse {
  entries?: MatchApiEntry[];
  results?: number;
  title?: string;
  updated?: string;
  links?: { self?: { href?: string } };
}
```

- [ ] **Step 2: typecheck**

Run: `cd packages/engine/mcp-server && npx tsc --noEmit`
Expected: no errors.

---

### Task 2: Tool module — failing test scaffolding first

**Files:** Create `packages/engine/mcp-server/tests/tools/match-by-id.test.ts`

- [ ] **Step 1: Write the failing test (initial — URL construction)**

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/auth/refresh.js", () => ({
  getValidToken: vi.fn(),
}));

import {
  personRecordMatches,
  recordPersonMatches,
  personPersonMatches,
  recordRecordMatches,
} from "../../src/tools/match-by-id.js";
import { getValidToken } from "../../src/auth/refresh.js";

const mockedGetValidToken = vi.mocked(getValidToken);
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const EMPTY_BODY = { entries: [], results: 0, title: "x", updated: "2025-01-01T00:00:00Z" };

function mockJson(body: unknown, status = 200) {
  mockFetch.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    text: () => Promise.resolve(JSON.stringify(body)),
    json: () => Promise.resolve(body),
    headers: new Headers({ "content-type": "application/json" }),
  });
}

beforeEach(() => {
  mockFetch.mockReset();
  mockedGetValidToken.mockReset();
  mockedGetValidToken.mockResolvedValue("test-token");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("URL construction", () => {
  it("person_record_matches builds the right URL (collection=records, ark prefix 4:1)", async () => {
    mockJson(EMPTY_BODY);
    await personRecordMatches({ id: "KNDX-MKG" });
    const url = new URL(mockFetch.mock.calls[0][0]);
    expect(url.host).toBe("sg30p0.familysearch.org");
    expect(url.pathname).toBe("/search/match/resolutions/match/matches");
    expect(url.searchParams.get("collection")).toBe("records");
    expect(url.searchParams.get("id")).toBe("ark:/61903/4:1:KNDX-MKG");
    expect(url.searchParams.get("minConfidence")).toBe("2");
    expect(url.searchParams.get("count")).toBe("20");
    expect(url.searchParams.get("includeSummary")).toBe("false");
    expect(url.searchParams.getAll("status")).toEqual(["accepted", "pending", "rejected"]);
    expect(url.searchParams.has("includeFlags")).toBe(false);
  });

  it("record_person_matches: collection=tree, ark prefix 1:1:", async () => {
    mockJson(EMPTY_BODY);
    await recordPersonMatches({ id: "QPTX-TMQ2" });
    const url = new URL(mockFetch.mock.calls[0][0]);
    expect(url.searchParams.get("collection")).toBe("tree");
    expect(url.searchParams.get("id")).toBe("ark:/61903/1:1:QPTX-TMQ2");
  });

  it("person_person_matches: collection=tree, ark prefix 4:1:", async () => {
    mockJson(EMPTY_BODY);
    await personPersonMatches({ id: "KNDX-MKG" });
    const url = new URL(mockFetch.mock.calls[0][0]);
    expect(url.searchParams.get("collection")).toBe("tree");
    expect(url.searchParams.get("id")).toBe("ark:/61903/4:1:KNDX-MKG");
  });

  it("record_record_matches: collection=records, ark prefix 1:1:", async () => {
    mockJson(EMPTY_BODY);
    await recordRecordMatches({ id: "QPTX-TMQ2" });
    const url = new URL(mockFetch.mock.calls[0][0]);
    expect(url.searchParams.get("collection")).toBe("records");
    expect(url.searchParams.get("id")).toBe("ark:/61903/1:1:QPTX-TMQ2");
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `cd packages/engine/mcp-server && npx vitest run tests/tools/match-by-id.test.ts`
Expected: FAIL with "Cannot find module ../../src/tools/match-by-id.js" or undefined function — file does not exist yet.

---

### Task 3: Tool module — minimal implementation

**Files:** Create `packages/engine/mcp-server/src/tools/match-by-id.ts`

- [ ] **Step 1: Write the tool module**

```typescript
import { getValidToken } from "../auth/refresh.js";
import { BROWSER_USER_AGENT } from "../constants.js";
import type {
  MatchApiEntry,
  MatchApiResponse,
  MatchArkType,
  MatchByIdInput,
  MatchByIdMatch,
  MatchByIdResult,
  MatchConfidence,
  MatchStatus,
} from "../types/match-by-id.js";

const API_URL =
  "https://sg30p0.familysearch.org/search/match/resolutions/match/matches";
const ALL_STATUSES: MatchStatus[] = ["accepted", "pending", "rejected"];
const STATUS_URI_TO_LOWER: Record<string, MatchStatus> = {
  "http://familysearch.org/v1/Accepted": "accepted",
  "http://familysearch.org/v1/Pending": "pending",
  "http://familysearch.org/v1/Rejected": "rejected",
};
const PID_RE = /^[A-Z0-9]{3,5}-[A-Z0-9]{3,5}$/;

interface MatchByIdConfig {
  toolName: string;
  collection: "records" | "tree";
  expectedPrefix: MatchArkType;
  /** Tool to recommend when the user passes the other prefix. */
  siblingTool: string;
}

async function matchById(
  input: MatchByIdInput,
  cfg: MatchByIdConfig,
): Promise<MatchByIdResult> {
  const queryArk = normalizeId(input.id, cfg);
  const { minConfidence, status, includeSummary, count } = validateOptions(input);

  const url = new URL(API_URL);
  url.searchParams.set("collection", cfg.collection);
  url.searchParams.set("id", queryArk);
  url.searchParams.set("minConfidence", String(minConfidence));
  url.searchParams.set("includeSummary", includeSummary ? "true" : "false");
  url.searchParams.set("count", String(count));
  for (const s of status) url.searchParams.append("status", s);
  // NOTE: includeFlags is deliberately omitted — see spec "What we don't expose".

  const token = await getValidToken();

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "User-Agent": BROWSER_USER_AGENT,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not reach FamilySearch match API: ${message}.`);
  }

  if (!response.ok) {
    await throwForBadStatus(response, queryArk);
  }

  let body: MatchApiResponse;
  try {
    body = (await response.json()) as MatchApiResponse;
  } catch {
    throw new Error("FamilySearch match API returned an unexpected response body.");
  }
  if (!body || !Array.isArray(body.entries)) {
    throw new Error("FamilySearch match API returned an unexpected response body.");
  }

  const matches = body.entries.map(simplifyEntry).filter((m): m is MatchByIdMatch => m !== null);

  return {
    queryArk,
    resultCount: body.results ?? matches.length,
    returned: matches.length,
    title: body.title ?? `Matches for ${queryArk}`,
    updated: body.updated ?? "",
    matches,
  };
}

// ─── Input normalization & validation ────────────────────────────────────────

const ARK_RE = /^(?:https:\/\/familysearch\.org\/)?ark:\/61903\/(\d:\d):([A-Z0-9\-]+)$/;

function normalizeId(raw: string, cfg: MatchByIdConfig): string {
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new Error(
      `${cfg.toolName} requires a non-empty id (e.g. "KNDX-MKG").`,
    );
  }
  const id = raw.trim();
  const arkMatch = id.match(ARK_RE);
  if (arkMatch) {
    const [, prefixCore, pid] = arkMatch;
    const prefix = `${prefixCore}:` as MatchArkType;
    if (prefix !== cfg.expectedPrefix) {
      throw new Error(
        `Expected a ${cfg.expectedPrefix === "4:1:" ? "tree person" : "record persona"} ARK ` +
          `(ark:/61903/${cfg.expectedPrefix}...) but received ${prefix}. ` +
          `Did you mean ${cfg.siblingTool}?`,
      );
    }
    return `ark:/61903/${cfg.expectedPrefix}${pid}`;
  }
  if (PID_RE.test(id)) {
    return `ark:/61903/${cfg.expectedPrefix}${id}`;
  }
  throw new Error(
    `Unrecognized id "${raw}". Expected a personId (e.g. "KNDX-MKG") ` +
      `or a full FamilySearch ARK.`,
  );
}

function validateOptions(input: MatchByIdInput): Required<
  Omit<MatchByIdInput, "id">
> {
  const minConfidence = input.minConfidence ?? 2;
  if (!Number.isInteger(minConfidence) || minConfidence < 1 || minConfidence > 5) {
    throw new Error("minConfidence must be 1..5.");
  }
  const count = input.count ?? 20;
  if (!Number.isInteger(count) || count < 1 || count > 50) {
    throw new Error("count must be 1..50.");
  }
  const includeSummary = input.includeSummary ?? false;
  let status: MatchStatus[];
  if (input.status === undefined) {
    status = [...ALL_STATUSES];
  } else {
    if (!Array.isArray(input.status) || input.status.length === 0) {
      throw new Error(
        "status must be a non-empty array of \"accepted\", \"pending\", or \"rejected\".",
      );
    }
    for (const s of input.status) {
      if (!ALL_STATUSES.includes(s)) {
        throw new Error(
          `Unknown status "${s}". Expected "accepted", "pending", or "rejected".`,
        );
      }
    }
    status = [...new Set(input.status)] as MatchStatus[];
  }
  return { minConfidence, status, includeSummary, count };
}

// ─── Response simplification ─────────────────────────────────────────────────

const ENTRY_ARK_RE = /ark:\/61903\/(\d:\d):([A-Z0-9\-]+)/;

function simplifyEntry(entry: MatchApiEntry): MatchByIdMatch | null {
  if (!entry || typeof entry.id !== "string") return null;
  const arkMatch = entry.id.match(ENTRY_ARK_RE);
  if (!arkMatch) return null;
  const [, prefixCore, pid] = arkMatch;
  const arkType = `${prefixCore}:` as MatchArkType;
  if (arkType !== "1:1:" && arkType !== "4:1:") return null;

  const matchInfo = entry.matchInfo?.[0] ?? {};
  const statusUri = matchInfo.status ?? "";
  const status = STATUS_URI_TO_LOWER[statusUri];
  if (!status) return null;

  const confidence = entry.confidence;
  if (
    confidence === undefined ||
    !Number.isInteger(confidence) ||
    confidence < 1 ||
    confidence > 5
  ) {
    return null;
  }

  const m: MatchByIdMatch = {
    ark: entry.id,
    pid,
    arkType,
    confidence: confidence as MatchConfidence,
    score: typeof entry.score === "number" ? entry.score : 0,
    title: entry.title ?? "",
    status,
    collection: matchInfo.collection ?? "",
  };
  if (entry.published) m.published = entry.published;
  if (entry.content?.gedcomx) m.summary = entry.content.gedcomx;
  return m;
}

// ─── Error handling ──────────────────────────────────────────────────────────

async function throwForBadStatus(response: Response, queryArk: string): Promise<never> {
  const text = await response.text().catch(() => "");
  if (response.status === 401 || response.status === 403) {
    throw new Error(
      `FamilySearch match API rejected the request: ${response.status} ${response.statusText}. ` +
        `Call the login tool to authenticate.`,
    );
  }
  if (response.status === 400) {
    // FS returns a JSON envelope; surface a friendly form.
    throw new Error(
      `FamilySearch rejected the id "${queryArk}" as a malformed ARK.`,
    );
  }
  throw new Error(
    `FamilySearch match API error: ${response.status} ${response.statusText}` +
      (text ? ` — ${text.slice(0, 200)}` : ""),
  );
}

// ─── Public per-tool wrappers ────────────────────────────────────────────────

const CFG_PR: MatchByIdConfig = {
  toolName: "person_record_matches",
  collection: "records",
  expectedPrefix: "4:1:",
  siblingTool: "record_record_matches",
};
const CFG_RP: MatchByIdConfig = {
  toolName: "record_person_matches",
  collection: "tree",
  expectedPrefix: "1:1:",
  siblingTool: "person_person_matches",
};
const CFG_PP: MatchByIdConfig = {
  toolName: "person_person_matches",
  collection: "tree",
  expectedPrefix: "4:1:",
  siblingTool: "record_person_matches",
};
const CFG_RR: MatchByIdConfig = {
  toolName: "record_record_matches",
  collection: "records",
  expectedPrefix: "1:1:",
  siblingTool: "person_record_matches",
};

export function personRecordMatches(input: MatchByIdInput): Promise<MatchByIdResult> {
  return matchById(input, CFG_PR);
}
export function recordPersonMatches(input: MatchByIdInput): Promise<MatchByIdResult> {
  return matchById(input, CFG_RP);
}
export function personPersonMatches(input: MatchByIdInput): Promise<MatchByIdResult> {
  return matchById(input, CFG_PP);
}
export function recordRecordMatches(input: MatchByIdInput): Promise<MatchByIdResult> {
  return matchById(input, CFG_RR);
}

// ─── MCP schemas ────────────────────────────────────────────────────────────

const INPUT_SCHEMA = {
  type: "object",
  properties: {
    id: {
      type: "string",
      description:
        "Bare personId (e.g. \"KNDX-MKG\") or full FamilySearch ARK. The tool " +
        "wraps a bare id with the correct ARK prefix automatically.",
    },
    minConfidence: {
      type: "integer",
      minimum: 1,
      maximum: 5,
      description: "Lowest match confidence to return (1..5). Default 2.",
    },
    status: {
      type: "array",
      items: { type: "string", enum: ["accepted", "pending", "rejected"] },
      description:
        "Which resolution statuses to return. Default is all three. The " +
        "upstream API silently defaults to \"pending\" only when omitted — " +
        "this tool overrides that to \"all\" for a more useful default.",
    },
    includeSummary: {
      type: "boolean",
      description: "Attach the matched entity's GEDCOMX summary. Default false.",
    },
    count: {
      type: "integer",
      minimum: 1,
      maximum: 50,
      description: "Max number of matches to return (1..50). Default 20.",
    },
  },
  required: ["id"],
} as const;

export const personRecordMatchesSchema = {
  name: "person_record_matches",
  description:
    "Return historical-record matches for a tree person. " +
    "Input: a tree personId (e.g. \"KNDX-MKG\") or 4:1: ARK. " +
    "Returns accepted/pending/rejected record matches by default. " +
    "Requires authentication — call the login tool first if not logged in.",
  inputSchema: INPUT_SCHEMA,
} as const;

export const recordPersonMatchesSchema = {
  name: "record_person_matches",
  description:
    "Return tree-person matches for a historical record persona. " +
    "Input: a record personId (e.g. \"QPTX-TMQ2\") or 1:1: ARK. " +
    "Returns accepted/pending/rejected tree-person matches by default. " +
    "Requires authentication — call the login tool first if not logged in.",
  inputSchema: INPUT_SCHEMA,
} as const;

export const personPersonMatchesSchema = {
  name: "person_person_matches",
  description:
    "Return possible-duplicate tree-person matches for a tree person. " +
    "Useful for finding tree merge candidates. " +
    "Input: a tree personId or 4:1: ARK. " +
    "Requires authentication — call the login tool first if not logged in.",
  inputSchema: INPUT_SCHEMA,
} as const;

export const recordRecordMatchesSchema = {
  name: "record_record_matches",
  description:
    "Return historical-record matches for a record persona — collateral " +
    "records describing the same individual. " +
    "Input: a record personId or 1:1: ARK. " +
    "Requires authentication — call the login tool first if not logged in.",
  inputSchema: INPUT_SCHEMA,
} as const;
```

- [ ] **Step 2: Re-run URL-construction tests, verify they pass**

Run: `cd packages/engine/mcp-server && npx vitest run tests/tools/match-by-id.test.ts`
Expected: 4/4 tests PASS.

---

### Task 4: Extend test file — validation + parsing + errors

- [ ] **Step 1: Append validation tests**

```typescript
describe("Input validation", () => {
  it("rejects empty id", async () => {
    await expect(personRecordMatches({ id: "" })).rejects.toThrow(/non-empty id/);
  });

  it("person_record_matches rejects a 1:1: ARK with sibling hint", async () => {
    await expect(
      personRecordMatches({ id: "ark:/61903/1:1:QPTX-TMQ2" }),
    ).rejects.toThrow(/record_record_matches/);
  });

  it("record_person_matches rejects a 4:1: ARK with sibling hint", async () => {
    await expect(
      recordPersonMatches({ id: "ark:/61903/4:1:KNDX-MKG" }),
    ).rejects.toThrow(/person_person_matches/);
  });

  it("rejects unrecognized id shape", async () => {
    await expect(personRecordMatches({ id: "not-a-pid" })).rejects.toThrow(/Unrecognized id/);
  });

  it("rejects out-of-range minConfidence", async () => {
    await expect(personRecordMatches({ id: "KNDX-MKG", minConfidence: 0 })).rejects.toThrow(/minConfidence/);
    await expect(personRecordMatches({ id: "KNDX-MKG", minConfidence: 6 })).rejects.toThrow(/minConfidence/);
  });

  it("rejects out-of-range count", async () => {
    await expect(personRecordMatches({ id: "KNDX-MKG", count: 0 })).rejects.toThrow(/count/);
    await expect(personRecordMatches({ id: "KNDX-MKG", count: 51 })).rejects.toThrow(/count/);
  });

  it("rejects unknown status value", async () => {
    await expect(
      // @ts-expect-error testing runtime guard
      personRecordMatches({ id: "KNDX-MKG", status: ["nope"] }),
    ).rejects.toThrow(/Unknown status/);
  });

  it("rejects empty status array", async () => {
    await expect(
      personRecordMatches({ id: "KNDX-MKG", status: [] }),
    ).rejects.toThrow(/non-empty array/);
  });

  it("accepts a full https:// ARK with the right prefix", async () => {
    mockJson(EMPTY_BODY);
    await personRecordMatches({ id: "https://familysearch.org/ark:/61903/4:1:KNDX-MKG" });
    const url = new URL(mockFetch.mock.calls[0][0]);
    expect(url.searchParams.get("id")).toBe("ark:/61903/4:1:KNDX-MKG");
  });

  it("custom status array is sent as-is and dedup'd", async () => {
    mockJson(EMPTY_BODY);
    await personRecordMatches({ id: "KNDX-MKG", status: ["accepted", "accepted", "pending"] });
    const url = new URL(mockFetch.mock.calls[0][0]);
    expect(url.searchParams.getAll("status").sort()).toEqual(["accepted", "pending"]);
  });

  it("custom count and minConfidence are propagated", async () => {
    mockJson(EMPTY_BODY);
    await personRecordMatches({ id: "KNDX-MKG", count: 7, minConfidence: 4 });
    const url = new URL(mockFetch.mock.calls[0][0]);
    expect(url.searchParams.get("count")).toBe("7");
    expect(url.searchParams.get("minConfidence")).toBe("4");
  });

  it("includeSummary=true is sent as the string 'true'", async () => {
    mockJson(EMPTY_BODY);
    await personRecordMatches({ id: "KNDX-MKG", includeSummary: true });
    const url = new URL(mockFetch.mock.calls[0][0]);
    expect(url.searchParams.get("includeSummary")).toBe("true");
  });

  it("never sends includeFlags", async () => {
    mockJson(EMPTY_BODY);
    await personRecordMatches({ id: "KNDX-MKG", includeSummary: true });
    const url = new URL(mockFetch.mock.calls[0][0]);
    expect(url.searchParams.has("includeFlags")).toBe(false);
  });
});

describe("Response parsing", () => {
  const KNDX_RESPONSE = {
    title: "Matches for ark:/61903/4:1:KNDX-MKG",
    results: 1,
    updated: "2025-09-11T16:56:42.040Z",
    entries: [
      {
        confidence: 5,
        id: "https://familysearch.org/ark:/61903/1:1:QPZP-Y6G4",
        published: "2024-09-19T20:07:47.508Z",
        score: 0.97402465,
        title: "BillionGraves Index",
        matchInfo: [
          {
            collection: "https://familysearch.org/platform/collections/records",
            status: "http://familysearch.org/v1/Accepted",
          },
        ],
        content: { gedcomx: { sourceDescriptions: [{ titles: [{ value: "BillionGraves Index" }] }] } },
      },
    ],
  };

  it("maps the happy-path response", async () => {
    mockJson(KNDX_RESPONSE);
    const result = await personRecordMatches({ id: "KNDX-MKG" });
    expect(result.queryArk).toBe("ark:/61903/4:1:KNDX-MKG");
    expect(result.resultCount).toBe(1);
    expect(result.returned).toBe(1);
    expect(result.title).toBe("Matches for ark:/61903/4:1:KNDX-MKG");
    expect(result.updated).toBe("2025-09-11T16:56:42.040Z");
    expect(result.matches).toHaveLength(1);
    const m = result.matches[0];
    expect(m.ark).toBe("https://familysearch.org/ark:/61903/1:1:QPZP-Y6G4");
    expect(m.pid).toBe("QPZP-Y6G4");
    expect(m.arkType).toBe("1:1:");
    expect(m.confidence).toBe(5);
    expect(m.score).toBeCloseTo(0.974, 3);
    expect(m.title).toBe("BillionGraves Index");
    expect(m.status).toBe("accepted");
    expect(m.collection).toBe("https://familysearch.org/platform/collections/records");
    expect(m.published).toBe("2024-09-19T20:07:47.508Z");
    expect(m.summary).toBeDefined();
  });

  it("omits summary when content.gedcomx is missing", async () => {
    const body = JSON.parse(JSON.stringify(KNDX_RESPONSE));
    delete body.entries[0].content;
    mockJson(body);
    const result = await personRecordMatches({ id: "KNDX-MKG" });
    expect(result.matches[0].summary).toBeUndefined();
  });

  it("maps status URIs to lowercase", async () => {
    const body = {
      title: "x", results: 3, updated: "t",
      entries: [
        { id: "https://familysearch.org/ark:/61903/1:1:A1A1-A1A", confidence: 5, score: 0.5,
          matchInfo: [{ status: "http://familysearch.org/v1/Pending", collection: "c" }] },
        { id: "https://familysearch.org/ark:/61903/1:1:B2B2-B2B", confidence: 4, score: 0.4,
          matchInfo: [{ status: "http://familysearch.org/v1/Rejected", collection: "c" }] },
        { id: "https://familysearch.org/ark:/61903/1:1:C3C3-C3C", confidence: 3, score: 0.3,
          matchInfo: [{ status: "http://familysearch.org/v1/Accepted", collection: "c" }] },
      ],
    };
    mockJson(body);
    const result = await personRecordMatches({ id: "KNDX-MKG" });
    expect(result.matches.map((m) => m.status)).toEqual(["pending", "rejected", "accepted"]);
  });

  it("drops entries with unknown status URI or malformed ARK", async () => {
    const body = {
      title: "x", results: 3, updated: "t",
      entries: [
        { id: "https://familysearch.org/ark:/61903/1:1:GOOD-PID", confidence: 5, score: 0.5,
          matchInfo: [{ status: "http://familysearch.org/v1/Accepted", collection: "c" }] },
        { id: "no-ark-here", confidence: 5, score: 0.5,
          matchInfo: [{ status: "http://familysearch.org/v1/Accepted", collection: "c" }] },
        { id: "https://familysearch.org/ark:/61903/1:1:BAD-STATUS", confidence: 5, score: 0.5,
          matchInfo: [{ status: "http://example.com/Unknown", collection: "c" }] },
      ],
    };
    mockJson(body);
    const result = await personRecordMatches({ id: "KNDX-MKG" });
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].pid).toBe("GOOD-PID");
  });
});

describe("Error handling", () => {
  it("translates 401 to a login-instruction error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false, status: 401, statusText: "Unauthorized",
      text: () => Promise.resolve(""), json: () => Promise.resolve({}),
      headers: new Headers(),
    });
    await expect(personRecordMatches({ id: "KNDX-MKG" })).rejects.toThrow(/login tool/);
  });

  it("translates 400 to a malformed-ARK message", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false, status: 400, statusText: "Bad Request",
      text: () => Promise.resolve('{"error":"Bad Request"}'),
      json: () => Promise.resolve({}),
      headers: new Headers(),
    });
    await expect(personRecordMatches({ id: "KNDX-MKG" })).rejects.toThrow(/malformed ARK/);
  });

  it("translates 500 to a generic upstream error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false, status: 500, statusText: "Server Error",
      text: () => Promise.resolve(""), json: () => Promise.resolve({}),
      headers: new Headers(),
    });
    await expect(personRecordMatches({ id: "KNDX-MKG" })).rejects.toThrow(/500/);
  });

  it("translates a network error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ETIMEDOUT"));
    await expect(personRecordMatches({ id: "KNDX-MKG" })).rejects.toThrow(/Could not reach/);
  });

  it("rejects malformed JSON body", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200, statusText: "OK",
      text: () => Promise.resolve("not json"),
      json: () => Promise.reject(new Error("bad json")),
      headers: new Headers({ "content-type": "application/json" }),
    });
    await expect(personRecordMatches({ id: "KNDX-MKG" })).rejects.toThrow(/unexpected response body/);
  });
});
```

- [ ] **Step 2: Run, verify all PASS**

Run: `cd packages/engine/mcp-server && npx vitest run tests/tools/match-by-id.test.ts`
Expected: all tests pass.

---

### Task 5: Wire into index.ts

**Files:** Modify `packages/engine/mcp-server/src/index.ts`

- [ ] **Step 1: Add the import** (after the existing validate-research-schema import block)

```typescript
import {
  personRecordMatches,
  recordPersonMatches,
  personPersonMatches,
  recordRecordMatches,
  personRecordMatchesSchema,
  recordPersonMatchesSchema,
  personPersonMatchesSchema,
  recordRecordMatchesSchema,
} from "./tools/match-by-id.js";
import type { MatchByIdInput } from "./types/match-by-id.js";
```

- [ ] **Step 2: Add the four schemas to the ListToolsRequestSchema tools[] array**

Inside the tools array (alphabetically grouped near `matchTwoExamplesSchema`):
```typescript
    personRecordMatchesSchema,
    recordPersonMatchesSchema,
    personPersonMatchesSchema,
    recordRecordMatchesSchema,
```

- [ ] **Step 3: Add four dispatch branches in CallToolRequestSchema handler**

Copy the standard 11-line shape (try / fetch / JSON-stringify / catch / isError) once per tool. Place them after the `match_two_examples` branch.

```typescript
  if (request.params.name === "person_record_matches") {
    try {
      const args = request.params.arguments as unknown as MatchByIdInput;
      const result = await personRecordMatches(args);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return { content: [{ type: "text", text: JSON.stringify({ error: message }) }], isError: true };
    }
  }
  if (request.params.name === "record_person_matches") {
    try {
      const args = request.params.arguments as unknown as MatchByIdInput;
      const result = await recordPersonMatches(args);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return { content: [{ type: "text", text: JSON.stringify({ error: message }) }], isError: true };
    }
  }
  if (request.params.name === "person_person_matches") {
    try {
      const args = request.params.arguments as unknown as MatchByIdInput;
      const result = await personPersonMatches(args);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return { content: [{ type: "text", text: JSON.stringify({ error: message }) }], isError: true };
    }
  }
  if (request.params.name === "record_record_matches") {
    try {
      const args = request.params.arguments as unknown as MatchByIdInput;
      const result = await recordRecordMatches(args);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return { content: [{ type: "text", text: JSON.stringify({ error: message }) }], isError: true };
    }
  }
```

- [ ] **Step 4: typecheck**

Run: `cd packages/engine/mcp-server && npx tsc --noEmit`
Expected: no errors.

---

### Task 6: Dev smoke script

**Files:** Create `packages/engine/mcp-server/dev/try-match-by-id.ts`

- [ ] **Step 1: Write the script**

```typescript
/**
 * After-tool smoke test for the four match-by-id tools. Hits the live FS API.
 *
 * Usage:
 *   npx tsx dev/try-match-by-id.ts                              # all four with default ids
 *   npx tsx dev/try-match-by-id.ts <which> <id> [<more flags>]  # one tool
 *
 * <which> is one of: pr, rp, pp, rr (or the full tool name).
 * <id> can be a bare pid or full ARK; the tool fixes the prefix.
 */
import {
  personRecordMatches,
  recordPersonMatches,
  personPersonMatches,
  recordRecordMatches,
} from "../src/tools/match-by-id.js";

const fns: Record<string, (input: { id: string }) => Promise<unknown>> = {
  pr: personRecordMatches,
  person_record_matches: personRecordMatches,
  rp: recordPersonMatches,
  record_person_matches: recordPersonMatches,
  pp: personPersonMatches,
  person_person_matches: personPersonMatches,
  rr: recordRecordMatches,
  record_record_matches: recordRecordMatches,
};

const DEFAULTS: Array<[string, string]> = [
  ["pr", "KNDX-MKG"],   // George Washington tree person
  ["rp", "QPTX-TMQ2"],  // Lincoln record persona
  ["pp", "KNDX-MKG"],
  ["rr", "QPTX-TMQ2"],
];

async function runOne(which: string, id: string): Promise<void> {
  const fn = fns[which];
  if (!fn) {
    console.error(`Unknown tool selector: ${which}. Use one of: ${Object.keys(fns).join(", ")}`);
    process.exit(1);
  }
  console.log(`\n=== ${which} id=${id} ===`);
  try {
    const result = await fn({ id });
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.log(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
  }
}

const [, , which, id] = process.argv;
if (which && id) {
  await runOne(which, id);
} else {
  for (const [w, i] of DEFAULTS) await runOne(w, i);
}
```

- [ ] **Step 2: Run live smoke**

Run: `cd packages/engine/mcp-server && npx tsx dev/try-match-by-id.ts`
Expected:
- `pr` (KNDX-MKG → records): non-empty entries (Washington has 1 accepted + 2 rejected = 3 matches).
- `rp`, `pp`, `rr`: may be empty for the default ids but must NOT error.

---

### Task 7: README

**Files:** Modify `README.md`

- [ ] **Step 1: Find the tool catalog**

Run: `grep -n "image_read\|person_read\|match_two_examples" /home/chris/fs-agent/cowork-genealogy/README.md | head -10`

- [ ] **Step 2: Add four rows next to the other match/auth-required tools**

(Match the existing row style — name, one-line summary, auth required.)

- [ ] **Step 3: Re-grep**

Run: `grep -c "person_record_matches\|record_person_matches\|person_person_matches\|record_record_matches" README.md`
Expected: ≥ 4

---

### Task 8: Run everything

- [ ] **Step 1: Full mcp-server test suite**

Run: `cd packages/engine/mcp-server && npm test 2>&1 | tail -20`
Expected: all previous tests still PASS + new match-by-id tests PASS, zero failures.

- [ ] **Step 2: Live smoke (re-run)**

Run: `cd packages/engine/mcp-server && npx tsx dev/try-match-by-id.ts pr KNDX-MKG`
Expected: returned ≥ 1 match with confidence 5, status "accepted".

- [ ] **Step 3: Build the MCP server**

Run: `cd packages/engine/mcp-server && npm run build 2>&1 | tail -10`
Expected: no errors.

- [ ] **Step 4: Repo grep for orphan refs**

Run: `grep -rn "person_record_matches\|record_person_matches\|person_person_matches\|record_record_matches" packages/engine/mcp-server/src/ packages/engine/mcp-server/tests/ packages/engine/mcp-server/dev/ docs/ README.md | wc -l`
Expected: many hits; spot-check that each is intentional.

---

### Task 9: Commit + push

- [ ] **Step 1: Stage ONLY the intended files**

```bash
cd /home/chris/fs-agent/cowork-genealogy
git add docs/specs/match-by-id-tools-spec.md \
        docs/plan/match-by-id-tools.md \
        packages/engine/mcp-server/src/types/match-by-id.ts \
        packages/engine/mcp-server/src/tools/match-by-id.ts \
        packages/engine/mcp-server/src/index.ts \
        packages/engine/mcp-server/tests/tools/match-by-id.test.ts \
        packages/engine/mcp-server/dev/probe-match-by-id.ts \
        packages/engine/mcp-server/dev/probe-match-status.ts \
        packages/engine/mcp-server/dev/probe-match-misc.ts \
        packages/engine/mcp-server/dev/try-match-by-id.ts \
        README.md
```

(Do NOT use `git add -A` — there are pre-existing untracked OCR files
that must stay out. See `~/fs-agent/CLAUDE.md` 2026-05-19 PM session
note.)

- [ ] **Step 2: Commit (no AI attribution)**

```bash
git commit -m "Add match-by-id MCP tools (#176)

person_record_matches, record_person_matches, person_person_matches,
record_record_matches — four MCP tools wrapping FamilySearch's
match-resolutions endpoint at sg30p0.familysearch.org. Includes shared
helper, types, mocked-fetch tests, live-smoke and evidence-probe dev
scripts, and the spec at docs/specs/match-by-id-tools-spec.md.

Notable API quirks captured by the spec and avoided in the tool:
includeFlags=true silently empties the response (we never send it);
upstream default status is Pending-only (we default to all three)."
```

- [ ] **Step 3: Push**

```bash
git push -u origin create-match-by-id-tools
```

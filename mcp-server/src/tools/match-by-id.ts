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
const ARK_RE = /^(?:https:\/\/familysearch\.org\/)?ark:\/61903\/(\d:\d):([A-Z0-9-]+)$/;
const ENTRY_ARK_RE = /ark:\/61903\/(\d:\d):([A-Z0-9-]+)/;

interface MatchByIdConfig {
  toolName: string;
  collection: "records" | "tree";
  expectedPrefix: MatchArkType;
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
  // NOTE: includeFlags is deliberately omitted for now. With the team's
  // shared internal-dev token, every includeFlags=true call returns an
  // empty entries[]. Other team members with different OAuth scopes do
  // get populated responses with per-match flags. See spec for details.

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

  const matches = body.entries
    .map(simplifyEntry)
    .filter((m): m is MatchByIdMatch => m !== null);

  return {
    queryArk,
    resultCount: body.results ?? matches.length,
    returned: matches.length,
    title: body.title ?? `Matches for ${queryArk}`,
    updated: body.updated ?? "",
    matches,
  };
}

function normalizeId(raw: string, cfg: MatchByIdConfig): string {
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new Error(`${cfg.toolName} requires a non-empty id (e.g. "KNDX-MKG").`);
  }
  const id = raw.trim();
  const arkMatch = id.match(ARK_RE);
  if (arkMatch) {
    const [, prefixCore, pid] = arkMatch;
    const prefix = `${prefixCore}:` as MatchArkType;
    if (prefix !== cfg.expectedPrefix) {
      const human = cfg.expectedPrefix === "4:1:" ? "tree person" : "record persona";
      throw new Error(
        `Expected a ${human} ARK (ark:/61903/${cfg.expectedPrefix}...) ` +
          `but received ${prefix}. Did you mean ${cfg.siblingTool}?`,
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

function validateOptions(input: MatchByIdInput): {
  minConfidence: number;
  status: MatchStatus[];
  includeSummary: boolean;
  count: number;
} {
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
        'status must be a non-empty array of "accepted", "pending", or "rejected".',
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

async function throwForBadStatus(
  response: Response,
  queryArk: string,
): Promise<never> {
  const text = await response.text().catch(() => "");
  if (response.status === 401 || response.status === 403) {
    throw new Error(
      `FamilySearch match API rejected the request: ${response.status} ${response.statusText}. ` +
        `Call the login tool to authenticate.`,
    );
  }
  if (response.status === 400) {
    throw new Error(`FamilySearch rejected the id "${queryArk}" as a malformed ARK.`);
  }
  throw new Error(
    `FamilySearch match API error: ${response.status} ${response.statusText}` +
      (text ? ` — ${text.slice(0, 200)}` : ""),
  );
}

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

const INPUT_SCHEMA = {
  type: "object",
  properties: {
    id: {
      type: "string",
      description:
        'Bare personId (e.g. "KNDX-MKG") or full FamilySearch ARK. The tool ' +
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
        "Which resolution statuses to return. Default is all three. " +
        'The upstream API silently defaults to "pending" only when omitted — ' +
        'this tool overrides that to "all" for a more useful default.',
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
    'Input: a tree personId (e.g. "KNDX-MKG") or 4:1: ARK. ' +
    "Returns accepted/pending/rejected record matches by default. " +
    "Requires authentication — call the login tool first if not logged in.",
  inputSchema: INPUT_SCHEMA,
} as const;

export const recordPersonMatchesSchema = {
  name: "record_person_matches",
  description:
    "Return tree-person matches for a historical record persona. " +
    'Input: a record personId (e.g. "QPTX-TMQ2") or 1:1: ARK. ' +
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

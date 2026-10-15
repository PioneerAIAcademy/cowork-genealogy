export type MatchStatus = "accepted" | "pending" | "rejected";
export type MatchArkType = "1:1:" | "4:1:";
export type MatchConfidence = 1 | 2 | 3 | 4 | 5;

export interface MatchByIdInput {
  id: string;
  minConfidence?: number;
  status?: MatchStatus[];
  includeSummary?: boolean;
  count?: number;
}

export interface MatchByIdMatch {
  // The matched entity's ARK in canonical form (e.g.
  // "ark:/61903/1:1:QPZP-Y6G4"). `pid` is the bare suffix; `arkType` says
  // whether it's a record persona (1:1:) or tree person (4:1:).
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

export interface MatchApiMatchInfo {
  collection?: string;
  status?: string;
}

export interface MatchApiEntry {
  id: string;
  confidence?: number;
  score?: number;
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
  // `not-found` is present when the service could not resolve the id in the
  // target system. It is the ONLY thing distinguishing "this persona has no
  // matches" from "this id names no persona": both answer 200 with
  // `entries: []` and `results: 0`, and both carry the same `title`. (An epoch
  // `updated` of 1970-01-01T00:00:00.001Z is a second tell, but the link is the
  // explicit one.) Measured 2026-09-10 — `dev/probe-match-not-found.ts`.
  links?: {
    self?: { href?: string };
    "not-found"?: { href?: string };
    "target-system"?: { href?: string };
  };
}

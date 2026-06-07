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
  links?: { self?: { href?: string } };
}

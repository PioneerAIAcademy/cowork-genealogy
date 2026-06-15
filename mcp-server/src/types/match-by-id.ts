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

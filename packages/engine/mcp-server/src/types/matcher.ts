// matchPairs (utils/matcher.ts): input and output types. Spec:
// docs/specs/matcher-shim-spec.md.

import type { SimplifiedGedcomX } from "./gedcomx.js";
import type { FamilySearchEcho } from "./same-person.js";

/** Which matcher scored a pair: config.json's `matcher`. */
export type MatcherBackend = "familysearch" | "service";

/** A tree person against a record persona. */
export interface TreeRecordPair {
  kind: "tree_record";
  /** The whole tree after the call site's own transforms; the service is sent it cut around `pid`. */
  tree: SimplifiedGedcomX;
  pid: string;
  rec: SimplifiedGedcomX;
  personaId: string;
  /** What FamilySearch's matcher is sent for the tree side: each call site's own document. */
  familysearchTree: SimplifiedGedcomX;
}

/** A record persona against another record's persona. */
export interface RecordRecordPair {
  kind: "record_record";
  rec: SimplifiedGedcomX;
  personaId: string;
  rec2: SimplifiedGedcomX;
  personaId2: string;
}

export type MatchPair = TreeRecordPair | RecordRecordPair;

/** Ranking's two floors: diagnostic (a), a thin subject, and (b), a real negative. */
export interface MatchFloors {
  thinSubject: number;
  realNegative: number;
}

export interface PairScore {
  /** 0-1, or null when this pair could not be scored. */
  score: number | null;
  /** Why it could not be scored. */
  error?: Error;
  /** Present when FamilySearch's matcher scored the pair. */
  familysearch?: FamilySearchEcho;
}

/** One matching call's answer. */
export interface MatchCall {
  scorer: MatcherBackend;
  /** The service's model version; null for FamilySearch, which reports none. */
  model: string | null;
  floors: MatchFloors;
  /** One per pair, in the order sent. */
  results: PairScore[];
}

/** How FamilySearch's backend fans a call out: each call site's own values. */
export interface FamilySearchOptions {
  concurrency: number;
  retry: boolean;
}

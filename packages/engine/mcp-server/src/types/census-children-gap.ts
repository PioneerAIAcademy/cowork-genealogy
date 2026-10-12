// census_children_gap I/O. Spec: docs/specs/census-children-gap-tool-spec.md.

export type CensusYear = 1900 | 1910;

export interface CensusChildCounts {
  year: CensusYear;
  childrenBorn: number;
  childrenLiving: number;
}

export interface KnownChild {
  name?: string;
  /** `YYYY`, `YYYY-MM` or `YYYY-MM-DD`. */
  birthDate: string;
  deathDate?: string;
}

export interface CensusChildrenGapInput {
  censuses: CensusChildCounts[];
  knownChildren?: KnownChild[];
}

export type CensusStatus = "dead" | "living" | "not_born" | "unknown";

export type MissingChildKind =
  | "died_before_1900"
  | "living_1900_died_by_1910"
  | "living_1900_and_1910"
  | "born_between_died_by_1910"
  | "born_between_living_1910"
  | "living_1900"
  | "dead_by_1910"
  | "living_1910";

export interface MissingChildGroup {
  kind: MissingChildKind;
  count: number;
  bornAfter: string | null;
  bornOnOrBefore: string;
  status1900: CensusStatus;
  status1910: CensusStatus;
  description: string;
}

export type UnresolvedChildGroup = Omit<MissingChildGroup, "kind">;

export interface CensusConflict {
  census: CensusYear | "both";
  message: string;
}

export interface UndeterminedCensus {
  census: CensusYear;
  child: string;
  reason: string;
}

export type CensusChildrenGapResult =
  | {
      ok: true;
      enumerationDays: { "1900": string; "1910": string };
      censusesUsed: CensusYear[];
      totalMissing: number | null;
      missing: MissingChildGroup[];
      unresolved: UnresolvedChildGroup[];
      conflicts: CensusConflict[];
      undetermined: UndeterminedCensus[];
      assumptions: string[];
    }
  | { ok: false; errors: string[] };

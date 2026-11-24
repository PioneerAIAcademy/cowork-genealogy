// Types for the source_screen tool. Spec: docs/specs/source-screen-tool-spec.md.


export interface SourceScreenInput {
  projectPath: string;
  /** A tree person id, or a FamilySearch id a tree person's `ark` links to. */
  personId: string;
}

/** The checks, by the letters the spec names them. f is not built; d was
 *  measured and dropped (spec, "Measurement"). */
export type SourceScreenCheck = "a" | "b" | "c" | "e" | "g" | "h";

export type SourceScreenVerdict = "misattributed" | "indexing_error" | "contradicts" | "weak" | "fine" | "not_scored";

export type SourceScreenNotScored = "unreadable" | "unindexed" | "ambiguous_party" | "reused_hint_no_persona" | "unlinked";

/** A check that could not run for this attachment, and why. */
export interface NotRun {
  not_run: string;
}

export interface PartyScore {
  personId: string;
  personaId: string;
  score: number | null;
  /** Why the party has no score (the matcher's budget, or its error). */
  not_run?: string;
}

export interface SourceScreenSignals {
  /** Leave-one-out matcher score of the record persona against the person. */
  a?: { score: number; band: "below" | "grey" | "clear" } | NotRun;
  /** Warnings the record's facts introduce on the leave-one-out person. */
  b?: { impossible: string[]; implausible: string[] };
  /** Relationship-level parties scored, and stated relationships the tree contradicts. */
  c?: { parties: PartyScore[]; disagreements: string[] };
  /** The page image read for the disputed vital fact (flagged attachments only):
   *  `fact` is e.g. "birth year", `lookingFor` the tree's value of it. */
  e?: { lookingFor: string; fact: string; found: "FOUND" | "NOT FOUND" } | NotRun;
  /** Every other tree person linked to a persona of this record, scored. */
  g?: { checked: PartyScore[]; failing: PartyScore[] };
  /** Other attachments whose birth or death year or place disagrees with this one. */
  h?: { contradicts: Array<{ sourceId: string; fact: string }> };
}

export interface SourceScreenAttachment {
  /** The tree source id (`S…`) of the attachment. */
  sourceId: string;
  /** The `1:1:` persona ARK the attachment names; null when it names none. */
  recordId: string | null;
  /** Whether the attachment hangs on the person or on one of their relationships. */
  level: "person" | "relationship";
  verdict: SourceScreenVerdict;
  /** The highest confidence a link to this record may carry: `speculative`
   *  for a misattributed record, `possible` for an indexing error. Absent
   *  otherwise. person-evidence caps its link here. */
  linkCap?: "speculative" | "possible";
  /** One sentence per signal that fired, or the not-scored reason. */
  reasons: string[];
  /** The tree source ids of attachments this one contradicts (check h). */
  contradicts?: string[];
  /** The record persona scored as the person, when one was chosen. */
  personaId?: string;
  signals: SourceScreenSignals;
}

export interface SourceScreenResult {
  ok: true;
  personId: string;
  attachments: SourceScreenAttachment[];
  counts: Partial<Record<SourceScreenVerdict, number>>;
}

export interface SourceScreenFailure {
  ok: false;
  errors: string[];
}

export type SourceScreenResponse = SourceScreenResult | SourceScreenFailure;

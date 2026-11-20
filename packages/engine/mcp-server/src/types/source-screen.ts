// Types for the source_screen tool. Spec: docs/specs/source-screen-tool-spec.md.

import type { NoProjectResult } from "../utils/project-io.js";
import type { NameRelation } from "../utils/attachment-support.js";

export interface SourceScreenInput {
  projectPath: string;
  /** A tree person id, or a FamilySearch id a tree person's `ark` links to. */
  personId: string;
}

/** The checks, by the letters the spec names them. Item f is not built. */
export type SourceScreenCheck = "a" | "b" | "c" | "d" | "e" | "g" | "h";

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
}

export interface SourceScreenSignals {
  /** Leave-one-out matcher score of the record persona against the person. */
  a?: { score: number; band: "below" | "grey" | "clear" } | NotRun;
  /** Warnings the record's facts introduce on the leave-one-out person. */
  b?: { impossible: string[]; implausible: string[] };
  /** Relationship-level parties scored, and stated relationships the tree contradicts. */
  c?: { parties: PartyScore[]; disagreements: string[] };
  /** The record name against the person's tree names, after the variant fold. */
  d?: { relation: NameRelation; recordName: string };
  /** The page image read for the disputed value (flagged attachments only). */
  e?: { lookingFor: string; found: "FOUND" | "NOT FOUND" } | NotRun;
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

export type SourceScreenResponse = SourceScreenResult | SourceScreenFailure | NoProjectResult;

// record_read tool I/O types and FS recapi response types.
//
// The tool accepts a FamilySearch historical record ID (either a full ARK like
// `ark:/61903/1:1:QVS9-DHDB` or a bare entity ID like `QVS9-DHDB`), fetches
// the record from the recapi endpoint, and returns simplified GEDCOMX.

import type { SimplifiedGedcomX } from "./gedcomx.js";

// ─── Tool I/O ─────────────────────────────────────────────────────────────

export interface RecordReadInput {
  recordId: string;
  // Optional sidecar mode: when set, resolve the record from this staged
  // (`results/.staging/<uuid>.json`) or finalized (`results/<log_id>.json`)
  // search sidecar instead of a live FS fetch. Requires `projectPath`.
  resultsRef?: string;
  projectPath?: string;
}

// The tool returns simplified GEDCOMX directly. A LIVE read given a
// `projectPath` also stages the record (issue #2048 / #2489) and carries the
// staging handle beside the document; a sidecar-mode read carries neither.
export type RecordReadResult = SimplifiedGedcomX & {
  /** The page-image document-image ARK. The requested persona's own source
   *  refs are tried first, then document order — a record can carry several
   *  page images, and the co-resident on scan 2 is not on scan 1. A source is
   *  skipped only when it names a `resource_type` that is not
   *  `DigitalArtifact*`; a `record_search`-staged source names none at all.
   *  Carries the source url's `i=`/`cc=`/`groupId=` context params when it has
   *  any, since a waypoint ark stripped of them can resolve to a neighbouring
   *  page without erroring. Absent when the record has no page-image source.
   *  Callers pass this to `image_read` / `image_transcribe` rather than
   *  deriving an image ARK from a record ARK. */
  imageArk?: string;
  /** Present iff `projectPath` was given on a live read: the record retained
   *  as a one-element `results[]` envelope under results/.staging/, readable
   *  back with `record_read({ recordId, resultsRef })` and finalized by
   *  `research_log_append({ stagedResultsRef })`. `null` when staging failed. */
  staged?: { resultsRef: string; returnedCount: number } | null;
  /** Why `staged` is null — staging is best-effort and never fails the read. */
  stagingError?: string;
};

// ─── FS recapi response (raw API) ─────────────────────────────────────────
//
// The recapi endpoint returns a GedcomX document. We reuse the shared
// `GedcomX` type from `./gedcomx.ts` for the actual parse; this file only
// declares the thin wrapper the endpoint places around it.

export interface FSRecordResponse {
  // The recapi envelope nests the GedcomX payload under a top-level key.
  // We treat the entire response as a GedcomX document since the recapi
  // format is standard GedcomX JSON — persons, relationships, and
  // sourceDescriptions live at the top level.
  persons?: unknown[];
  relationships?: unknown[];
  sourceDescriptions?: unknown[];
  places?: unknown[];
}

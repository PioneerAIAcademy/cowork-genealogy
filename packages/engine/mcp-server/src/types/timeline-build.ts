// timeline_build I/O. Spec: docs/specs/timeline-build-tool-spec.md.

import type { PlaceCoords } from "../utils/place-resolver.js";
import type { NoProjectResult } from "../utils/project-io.js";

export interface TimelineBuildInput {
  projectPath: string;
  /** A tree person id or a FamilySearch id a tree person's `ark` links to. */
  personId: string;
}

/** Injected for tests; production uses the Places resolvers and the clock. */
export interface TimelineBuildDeps {
  /** Raw place text -> standard place name, or null. */
  resolvePlace?: (placeText: string) => Promise<string | null>;
  /** Standard place name -> coordinates, or null. */
  placeCoords?: (standardPlace: string) => Promise<PlaceCoords | null>;
  now?: () => Date;
  /** One deadline for every Places lookup in the call. */
  deadlineMs?: number;
}

export interface TimelineBuildWritten {
  ok: true;
  status: "written" | "updated";
  timelineId: string;
  events: number;
  /** Events every one of whose links is speculative. */
  unverifiedEvents: number;
  gaps: { high: number; medium: number; low: number };
  summary: string;
}

export interface TimelineBuildNothingLinked {
  ok: true;
  status: "no_linked_evidence";
  summary: string;
}

export type TimelineBuildResult =
  | TimelineBuildWritten
  | TimelineBuildNothingLinked
  | { ok: false; errors: string[] }
  | NoProjectResult;

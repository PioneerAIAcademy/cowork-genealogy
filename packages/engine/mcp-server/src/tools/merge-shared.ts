// Shared helpers for the two merge tools (merge_record_into_tree,
// merge_tree_persons). The pure tree merge lives in utils/merge-gedcomx.ts;
// this module owns the tool-layer concerns both wrappers share: reading the
// project files, validating an inline candidate, deriving the compact summary
// from the merged document, backing up before an irreversible overwrite, and
// the Mode-2 research.json person-id remap. Spec: merge-gedcomx-spec.md §5b.

import { readFile, copyFile, access } from "fs/promises";
import { join } from "path";
import type { SimplifiedGedcomX, SimplifiedPerson } from "../types/gedcomx.js";
import { validateGedcomx } from "../validation/validator.js";
import { createReport, isValid } from "../validation/types.js";
import type { ValidationError } from "../validation/types.js";
import { iteratePersonIdRefs } from "../validation/person-id-refs.js";

/** Vital types the core marks exactly one `primary` fact for (mirrors the core). */
const VITAL_PRIMARY_TYPES: ReadonlySet<string> = new Set([
  "Birth",
  "Death",
  "Christening",
  "Burial",
]);

export interface MergePairSummary {
  survivorId: string;
  namesMerged: number;
  namesKept: number;
  factsMerged: number;
  factsKept: number;
  primarySet: string[];
  genderConflictKeptSurvivor: boolean;
}

export interface ResearchRefsUpdated {
  subject_person_ids: number;
  person_evidence: number;
  timelines: number;
  known_holdings: number;
}

export interface MergeSuccess {
  ok: true;
  filesWritten: string[];
  pairs: MergePairSummary[];
  newRelatives: string[];
  researchRefsUpdated?: ResearchRefsUpdated;
  validation: { valid: true; warnings: string[] };
}

export interface MergeFailure {
  ok: false;
  errors: string[];
}

export type MergeResult = MergeSuccess | MergeFailure;

/** Raised for expected input problems; the tool turns these into `{ ok: false }`. */
export class MergeInputError extends Error {}

/** Read + parse a project JSON file, raising a clear MergeInputError on failure. */
export async function readProjectJson(
  projectPath: string,
  filename: string,
): Promise<any> {
  let text: string;
  try {
    text = await readFile(join(projectPath, filename), "utf-8");
  } catch {
    throw new MergeInputError(`${filename} not found in projectPath`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new MergeInputError(`${filename} is not valid JSON`);
  }
}

/** Format validator issues as flat strings for the tool's error/warning lists. */
export function formatIssues(issues: ValidationError[]): string[] {
  return issues.map((e) => (e.path ? `${e.path}: ${e.message}` : e.message));
}

/**
 * Validate an inline candidate document by reusing the exported `validateGedcomx`.
 * `toSimplified` omits empty sections, so a valid record may legitimately have
 * no `relationships`/`sources` key — normalize absent sections to `[]` first so
 * the section-presence check doesn't spuriously reject it. Returns [] when valid.
 */
export function validateCandidateGedcomx(candidate: unknown): string[] {
  if (candidate === null || typeof candidate !== "object") {
    return ["candidateGedcomx is null or not an object"];
  }
  const c = candidate as SimplifiedGedcomX;
  const normalized: SimplifiedGedcomX = {
    persons: c.persons ?? [],
    relationships: c.relationships ?? [],
    sources: c.sources ?? [],
    ...(c.places !== undefined ? { places: c.places } : {}),
  };
  const report = createReport();
  validateGedcomx(normalized, report);
  if (isValid(report)) return [];
  return report.errors.map((e) => {
    const path = e.path.replace(/^tree\.gedcomx\.json/, "candidateGedcomx");
    return path ? `${path}: ${e.message}` : e.message;
  });
}

/** Copy `path` to `path.bak` if it exists (one-deep pre-overwrite backup). */
export async function backupIfExists(path: string): Promise<void> {
  try {
    await access(path);
  } catch {
    return;
  }
  await copyFile(path, `${path}.bak`);
}

/**
 * Repoint every research.json person-id reference from a collapsed id to its
 * survivor (Mode 2). Driven by the same `iteratePersonIdRefs` walker the
 * validator uses, so the field set can never drift. Mutates `research` in place
 * and returns the per-field count of references rewritten.
 */
export function remapResearchPersonIds(
  research: any,
  collapseMap: Map<string, string>,
): ResearchRefsUpdated {
  const counts: ResearchRefsUpdated = {
    subject_person_ids: 0,
    person_evidence: 0,
    timelines: 0,
    known_holdings: 0,
  };
  for (const ref of iteratePersonIdRefs(research)) {
    const survivor = collapseMap.get(ref.pid);
    if (survivor !== undefined && survivor !== ref.pid) {
      ref.set(survivor);
      counts[ref.field] += 1;
    }
  }
  return counts;
}

/**
 * Derive the per-pair name/fact merge summary by comparing each survivor's
 * pre-merge union (its own content + the collapsed person's) against the
 * post-merge survivor. The core drops its internal id map, so counts are
 * reconstructed by arithmetic: kept = post-merge count, merged = how many the
 * equivalence pass collapsed away.
 */
export function derivePairSummaries(
  merges: Array<[string, string]>,
  preSurvivors: Map<string, SimplifiedPerson>,
  preCollapsed: Map<string, SimplifiedPerson>,
  merged: SimplifiedGedcomX,
): MergePairSummary[] {
  const mergedById = new Map<string, SimplifiedPerson>();
  for (const p of merged.persons ?? []) {
    if (p.id !== undefined) mergedById.set(p.id, p);
  }

  return merges.map(([survivorId, collapsedId]) => {
    const pre = preSurvivors.get(survivorId);
    const coll = preCollapsed.get(collapsedId);
    const post = mergedById.get(survivorId);

    const preNames = (pre?.names?.length ?? 0) + (coll?.names?.length ?? 0);
    const postNames = post?.names?.length ?? 0;
    const preFacts = (pre?.facts?.length ?? 0) + (coll?.facts?.length ?? 0);
    const postFacts = post?.facts?.length ?? 0;

    const primarySet = [
      ...new Set(
        (post?.facts ?? [])
          .filter(
            (f) =>
              f.primary === true &&
              f.type !== undefined &&
              VITAL_PRIMARY_TYPES.has(f.type),
          )
          .map((f) => f.type as string),
      ),
    ];

    const genderConflictKeptSurvivor =
      pre?.gender !== undefined &&
      coll?.gender !== undefined &&
      pre.gender !== coll.gender;

    return {
      survivorId,
      namesMerged: Math.max(0, preNames - postNames),
      namesKept: postNames,
      factsMerged: Math.max(0, preFacts - postFacts),
      factsKept: postFacts,
      primarySet,
      genderConflictKeptSurvivor,
    };
  });
}

/** Build a survivor-id → pre-merge person map from a person list. */
export function personMapByIds(
  persons: SimplifiedPerson[] | undefined,
  ids: Iterable<string>,
): Map<string, SimplifiedPerson> {
  const wanted = new Set(ids);
  const map = new Map<string, SimplifiedPerson>();
  for (const p of persons ?? []) {
    if (p.id !== undefined && wanted.has(p.id)) map.set(p.id, p);
  }
  return map;
}

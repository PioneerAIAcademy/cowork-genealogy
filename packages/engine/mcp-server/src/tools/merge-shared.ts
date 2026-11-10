// Shared helpers for the merge tools (merge_tree_persons and the read-only
// merge_warnings dry-run). The pure tree merge lives in utils/merge-gedcomx.ts;
// this module owns the tool-layer concerns those wrappers share: reading the
// project files, validating an inline candidate, deriving the compact summary
// from the merged document, and the Mode-2 research.json person-id remap.
// Spec: merge-gedcomx-spec.md §5b.

import type { SimplifiedGedcomX, SimplifiedPerson, SimplifiedSourceReference } from "../types/gedcomx.js";
import type { ConflictSurfaced } from "../types/materialize-facts.js";
import type { WarningGateRefusal } from "./tree-edit.js";
import { TREE_SOURCE_REF_FIELDS } from "../validation/tree-shape.js";
import { validateGedcomx } from "../validation/validator.js";
import { createReport, isValid } from "../validation/types.js";
import { iteratePersonIdRefs } from "../validation/person-id-refs.js";
import {
  readProjectJson as readProjectJsonBase,
  formatIssues,
  NoProjectError as NoProjectErrorBase,
} from "../utils/project-io.js";
// Single source of the vital single-occurrence fact types — shared with the
// merge core and materialize_facts's conflict-surfacing gate (spec §4.4).
import { VITAL_PRIMARY_TYPES } from "../utils/merge-gedcomx.js";

export { formatIssues };

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
  rejected_links: number;
  timelines: number;
  proof_summaries: number;
  namesakes: number;
  hit_verdicts: number;
}

export interface MergeSuccess {
  ok: true;
  filesWritten: string[];
  pairs: MergePairSummary[];
  newRelatives: string[];
  researchRefsUpdated?: ResearchRefsUpdated;
  validation: { valid: true; warnings: string[] };
  /** Competing biological parentage the merge created while passing the
   *  warning gate (issue #2525). */
  conflicts_surfaced?: ConflictSurfaced[];
}

export interface MergeFailure extends Partial<Pick<WarningGateRefusal, "message" | "warnings" | "conflicts_surfaced">> {
  ok: false;
  errors: string[];
  /** `no_project` marks the one ok:false that is an answer rather than a
   *  failure — the user is not in a research project (see `noProjectResult`).
   *  `unjustified_warnings` is the warning gate's refusal. Optional so every
   *  existing `if (!r.ok) r.errors…` keeps narrowing as it does today. */
  reason?: "no_project" | "unjustified_warnings";
}

export type MergeResult = MergeSuccess | MergeFailure;

/** Re-exported so the merge tools' outer catches can build the no-project
 *  answer without importing project-io directly. */
export { NoProjectError, noProjectResult } from "../utils/project-io.js";

/** Raised for expected input problems; the tool turns these into `{ ok: false }`. */
export class MergeInputError extends Error {}

/** Read + parse a project JSON file, raising a clear MergeInputError on failure.
 *
 *  NoProjectError is the exception: it is an ANSWER, not a failure, and is
 *  re-raised unchanged so each merge tool's outer catch can return
 *  `noProjectResult()`. Flattening it here would leave both callers' catches
 *  (`merge-warnings.ts`, `merge-tree-persons.ts`) unable to tell it apart. */
export async function readProjectJson(
  projectPath: string,
  filename: string,
): Promise<any> {
  try {
    return await readProjectJsonBase(projectPath, filename);
  } catch (e) {
    if (e instanceof NoProjectErrorBase) throw e;
    throw new MergeInputError(e instanceof Error ? e.message : String(e));
  }
}

/**
 * Turn a candidate document — a `record_read` answer, compacted at the MCP
 * boundary or full, or any `toSimplified` result — into one the persisted tree
 * format accepts. Strips what is legal in tool output but not in the tree:
 * top-level `places[]`, the record-only fields `principal`, `resource_type` and
 * `coverage`, sources with no `title` (with every ref to them), relationships
 * whose type is not ParentChild or Couple (after FamilySearch's type-URI prefix
 * is stripped) or that name a persona absent from `persons`, and any
 * person-level source ref that is not a well-formed `{ref, page?, quality?}`
 * naming a source in this candidate. Fills what the compacted answer leaves out
 * and the tree requires: missing name, fact and relationship ids are minted
 * (`mergeGedcomx` re-mints them anyway), a persona with no gender gets
 * "Unknown", a missing `given` or `surname` becomes "", and a candidate with no
 * `sources` but a `citation` or `collectionTitle` gets one source `S1` built
 * from them, so `hasSameCensus` still has a title to compare. Returns a cleaned
 * deep copy plus one warning per kind — the input is never mutated, and a
 * candidate that carries these must not be rejected for it.
 */
export function sanitizeCandidate(candidate: CandidateDocument): {
  candidate: SimplifiedGedcomX;
  warnings: string[];
} {
  const cleaned = structuredClone(candidate) as CandidateDocument;
  const warnings: string[] = [];

  rebuildSourceFromCitation(cleaned, warnings);
  dropTitlelessSources(cleaned, warnings);

  if (Array.isArray(cleaned.places) && cleaned.places.length > 0) {
    warnings.push(
      `dropped ${cleaned.places.length} candidate place description(s) — ` +
        `the tree format carries places as names on facts, not as a places[] section`,
    );
  }
  delete cleaned.places;

  const candidateSourceIds = new Set(
    (cleaned.sources ?? []).map((s) => s?.id).filter((id): id is string => typeof id === "string"),
  );
  let personSourceRefs = 0;
  let strippedPersonFields = 0;
  for (const person of cleaned.persons ?? []) {
    if ("sources" in person) {
      const refs: unknown[] = Array.isArray(person.sources) ? person.sources : [person.sources];
      const kept = refs.filter(
        (r): r is SimplifiedSourceReference =>
          isTreeSourceRef(r) && candidateSourceIds.has(r.ref),
      );
      personSourceRefs += refs.length - kept.length;
      if (kept.length > 0) person.sources = kept;
      else delete person.sources;
    }
    if (person.principal !== undefined) { delete person.principal; strippedPersonFields++; }
  }
  if (personSourceRefs > 0) {
    warnings.push(
      `dropped ${personSourceRefs} person-level source reference(s) that were not a ` +
        `{ref, page?, quality?} naming a source in this candidate`,
    );
  }
  if (strippedPersonFields > 0) {
    warnings.push(
      `dropped record-only person fields (principal) — ` +
        `these describe a record persona's role, not a tree person`,
    );
  }

  let strippedSourceFields = 0;
  for (const sd of cleaned.sources ?? []) {
    if (sd.resource_type !== undefined) { delete sd.resource_type; strippedSourceFields++; }
    if (sd.coverage !== undefined) { delete sd.coverage; strippedSourceFields++; }
  }
  if (strippedSourceFields > 0) {
    warnings.push(
      `dropped record-only source description fields (resource_type/coverage) — ` +
        `these describe the scanned volume, not a tree source`,
    );
  }

  dropNonTreeRelationships(cleaned, warnings);
  fillTreeRequiredFields(cleaned, warnings);

  return { candidate: cleaned, warnings };
}

/** A candidate as merge_warnings receives it: simplified GedcomX, possibly a
 *  `record_read` answer compacted at the MCP boundary. */
export type CandidateDocument = SimplifiedGedcomX & {
  citation?: unknown;
  recordUrl?: unknown;
  collectionTitle?: unknown;
};

const FS_RELATIONSHIP_TYPE_PREFIX = "http://familysearch.org/types/relationships/";
const TREE_RELATIONSHIP_TYPES: ReadonlySet<string> = new Set(["ParentChild", "Couple"]);

/** The first straight-ASCII double-quoted run of a citation: FamilySearch
 *  citations open with the quoted collection title. */
function quotedTitle(citation: string): string | undefined {
  const m = /"([^"]+)"/.exec(citation);
  return m ? m[1] : undefined;
}

function nonEmpty(v: unknown): string | undefined {
  return typeof v === "string" && v !== "" ? v : undefined;
}

function rebuildSourceFromCitation(c: CandidateDocument, warnings: string[]): void {
  if (Array.isArray(c.sources) && c.sources.length > 0) return;
  const citation = nonEmpty(c.citation);
  const title = nonEmpty(c.collectionTitle) ?? (citation ? quotedTitle(citation) ?? citation : undefined);
  if (title === undefined) return;
  const recordUrl = nonEmpty(c.recordUrl);
  c.sources = [
    {
      id: "S1",
      title,
      ...(citation !== undefined ? { citation } : {}),
      ...(recordUrl !== undefined ? { url: recordUrl } : {}),
    },
  ];
  warnings.push(
    `built source S1 ("${title}") from the candidate's citation — ` +
      `a compacted record_read answer carries no sources[]`,
  );
}

type RefHolder = { sources?: unknown };

function refHolders(c: SimplifiedGedcomX): RefHolder[] {
  const holders: RefHolder[] = [];
  for (const p of c.persons ?? []) {
    holders.push(p);
    for (const n of p?.names ?? []) holders.push(n);
    for (const f of p?.facts ?? []) holders.push(f);
  }
  for (const r of c.relationships ?? []) {
    holders.push(r);
    for (const f of r?.facts ?? []) holders.push(f);
  }
  return holders.filter((h) => h !== null && typeof h === "object");
}

function dropTitlelessSources(c: SimplifiedGedcomX, warnings: string[]): void {
  if (!Array.isArray(c.sources)) return;
  const dropped = new Set<string>();
  const kept = c.sources.filter((sd) => {
    const ok = sd !== null && typeof sd === "object" && nonEmpty(sd.title) !== undefined;
    if (!ok && typeof sd?.id === "string") dropped.add(sd.id);
    return ok;
  });
  const count = c.sources.length - kept.length;
  if (count === 0) return;
  c.sources = kept;
  let refs = 0;
  for (const h of refHolders(c)) {
    if (!Array.isArray(h.sources)) continue;
    const list = h.sources as unknown[];
    const keptRefs = list.filter(
      (r) => !(r !== null && typeof r === "object" && dropped.has(String((r as { ref?: unknown }).ref))),
    );
    refs += list.length - keptRefs.length;
    if (keptRefs.length > 0) h.sources = keptRefs;
    else delete h.sources;
  }
  warnings.push(
    `dropped ${count} candidate source description(s) with no title, and ${refs} ` +
      `reference(s) to them — a tree source needs a title`,
  );
}

function dropNonTreeRelationships(c: SimplifiedGedcomX, warnings: string[]): void {
  if (!Array.isArray(c.relationships)) return;
  const personIds = new Set(
    (c.persons ?? []).map((p) => p?.id).filter((id): id is string => typeof id === "string"),
  );
  let wrongType = 0;
  let dangling = 0;
  c.relationships = c.relationships.filter((r) => {
    if (r === null || typeof r !== "object") return false;
    if (typeof r.type === "string" && r.type.startsWith(FS_RELATIONSHIP_TYPE_PREFIX)) {
      r.type = r.type.slice(FS_RELATIONSHIP_TYPE_PREFIX.length);
    }
    if (typeof r.type !== "string" || !TREE_RELATIONSHIP_TYPES.has(r.type)) {
      wrongType++;
      return false;
    }
    const ends = r.type === "ParentChild" ? [r.parent, r.child] : [r.person1, r.person2];
    if (!ends.every((e) => typeof e === "string" && personIds.has(e))) {
      dangling++;
      return false;
    }
    return true;
  });
  if (wrongType > 0) {
    warnings.push(
      `dropped ${wrongType} candidate relationship(s) whose type is not ParentChild or ` +
        `Couple (e.g. Sibling) — the tree carries only those two`,
    );
  }
  if (dangling > 0) {
    warnings.push(
      `dropped ${dangling} candidate relationship(s) naming a person not in the candidate's persons[]`,
    );
  }
}

function fillTreeRequiredFields(c: SimplifiedGedcomX, warnings: string[]): void {
  let ids = 0;
  let genders = 0;
  let nameParts = 0;
  (c.persons ?? []).forEach((p, pi) => {
    if (p === null || typeof p !== "object") return;
    if (nonEmpty(p.gender) === undefined) {
      p.gender = "Unknown";
      genders++;
    }
    (p.names ?? []).forEach((n, ni) => {
      if (n === null || typeof n !== "object") return;
      if (nonEmpty(n.id) === undefined) {
        n.id = `n_${pi}_${ni}`;
        ids++;
      }
      if (typeof n.given !== "string") {
        n.given = "";
        nameParts++;
      }
      if (typeof n.surname !== "string") {
        n.surname = "";
        nameParts++;
      }
    });
    (p.facts ?? []).forEach((f, fi) => {
      if (f === null || typeof f !== "object") return;
      if (nonEmpty(f.id) === undefined) {
        f.id = `f_${pi}_${fi}`;
        ids++;
      }
    });
  });
  (c.relationships ?? []).forEach((r, ri) => {
    if (nonEmpty(r.id) === undefined) {
      r.id = `r_${ri}`;
      ids++;
    }
    (r.facts ?? []).forEach((f, fi) => {
      if (f === null || typeof f !== "object") return;
      if (nonEmpty(f.id) === undefined) {
        f.id = `rf_${ri}_${fi}`;
        ids++;
      }
    });
  });
  if (ids > 0) {
    warnings.push(`minted ${ids} missing name/fact/relationship id(s) — the merge re-mints them`);
  }
  if (genders > 0) {
    warnings.push(`set gender "Unknown" on ${genders} candidate person(s) that carried none`);
  }
  if (nameParts > 0) {
    warnings.push(`set ${nameParts} missing given/surname name part(s) to ""`);
  }
}

/** A persisted tree source ref: only `ref`/`page`/`quality`, `ref` a non-empty
 *  string, `page` a string, `quality` a QUAY integer 0-3. */
function isTreeSourceRef(r: unknown): r is { ref: string; page?: string; quality?: number } {
  if (!r || typeof r !== "object" || Array.isArray(r)) return false;
  const o = r as Record<string, unknown>;
  if (!Object.keys(o).every((k) => TREE_SOURCE_REF_FIELDS.has(k))) return false;
  if (typeof o.ref !== "string" || o.ref === "") return false;
  if ("page" in o && typeof o.page !== "string") return false;
  if ("quality" in o && !(Number.isInteger(o.quality) && (o.quality as number) >= 0 && (o.quality as number) <= 3)) {
    return false;
  }
  return true;
}

/**
 * Validate an inline candidate document by reusing the exported `validateGedcomx`.
 * `toSimplified` omits empty sections, so a valid record may legitimately have
 * no `relationships`/`sources` key — normalize absent sections to `[]` first so
 * the section-presence check doesn't spuriously reject it. Callers pass the
 * `sanitizeCandidate` output, so no `places` and no malformed or dangling
 * person-level ref remain by the time the runtime validator sees it. Returns [] when valid.
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
  };
  const report = createReport();
  validateGedcomx(normalized, report);
  if (isValid(report)) return [];
  return report.errors.map((e) => {
    const path = e.path.replace(/^tree\.gedcomx\.json/, "candidateGedcomx");
    return path ? `${path}: ${e.message}` : e.message;
  });
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
    rejected_links: 0,
    timelines: 0,
    proof_summaries: 0,
    namesakes: 0,
    hit_verdicts: 0,
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

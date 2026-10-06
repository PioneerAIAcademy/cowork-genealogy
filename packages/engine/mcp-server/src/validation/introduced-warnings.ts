/**
 * Block a writer tool on the genealogical warnings its own call INTRODUCED,
 * letting pre-existing warnings ride along without justification.
 *
 * The same pre/post delta subtraction as introduced-errors.ts, keyed on a
 * stable warning id instead of a validation-error path. Issue #2840.
 *
 * Caller contract: `beforeTree` is a deep clone taken before the in-place
 * mutation; `afterTree` is the mutated tree. `touchedPersonIds` is every
 * person whose names, facts or relationships changed, plus both endpoints of
 * every relationship added, removed or edited.
 *
 * For merges: pass `collapseMap` (collapsed→survivor) so pre-write warnings
 * on collapsed persons are matched against their survivor's post-write
 * warnings and correctly subtracted.
 */

import type { SimplifiedGedcomX, SimplifiedPerson, SimplifiedRelationship } from "../types/gedcomx.js";
import type { ConflictSurfaced } from "../types/materialize-facts.js";
import type { PersonWarning } from "../types/person-warnings.js";
import { Mob, normalizeGender } from "../utils/mob.js";
import { calculateWarnings, getPersonName, isQualifyingParentChildEdge } from "../tools/person-warnings.js";
import { isRelationshipEstablishing } from "../utils/source-ref-resolver.js";

/** Stable warning identifier: tag + person + related + sorted fact ids. */
export function warningId(w: PersonWarning): string {
  const factIds = (w.facts ?? []).map((f) => f.id).sort();
  return `${w.issueType}|${w.personId}|${w.relatedPersonId ?? ""}|${factIds.join(",")}`;
}

/** Compute warnings for a single person on a tree, returning [] if the
 *  person does not exist (e.g. collapsed after a merge) or if the warning
 *  computation fails for any reason. The gate must never block a write
 *  because it could not compute the delta. */
function warningsForPerson(
  tree: SimplifiedGedcomX,
  personId: string,
): PersonWarning[] {
  try {
    const persons = tree.persons ?? [];
    if (!persons.some((p) => p.id === personId)) return [];
    const mob = new Mob(tree, personId);
    return calculateWarnings(mob, mob, mob, /* isFinalWarnings */ true);
  } catch {
    return [];
  }
}

export interface WarningJustificationInput {
  warningId: string;
  justification: string;
}

export interface IntroducedWarningsResult {
  /** Warnings the write introduced that have no justification. */
  unjustified: Array<PersonWarning & { warningId: string }>;
  /** All introduced warnings (justified or not). */
  allIntroduced: Array<PersonWarning & { warningId: string }>;
}

/**
 * Compute the genealogical warnings this write introduced and check each
 * against the supplied justifications.
 *
 * Returns `{ unjustified: [], allIntroduced: [] }` — the caller refuses the
 * write when `unjustified.length > 0`.
 */
export function introducedWarnings(
  beforeTree: SimplifiedGedcomX,
  afterTree: SimplifiedGedcomX,
  touchedPersonIds: string[],
  warningJustifications?: WarningJustificationInput[],
  collapseMap?: Map<string, string>,
): IntroducedWarningsResult {
  // Dedupe touched ids and, for merges, remap collapsed→survivor
  const uniqueIds = new Set<string>();
  for (const id of touchedPersonIds) {
    uniqueIds.add(collapseMap?.get(id) ?? id);
  }

  // Collect before and after warnings for every touched person
  const beforeWarnings = new Map<string, PersonWarning>();
  const afterWarnings = new Map<string, PersonWarning>();

  for (const pid of uniqueIds) {
    // Before-tree: use the original id (before remapping) if it was collapsed
    const beforeIds = new Set<string>();
    beforeIds.add(pid);
    if (collapseMap) {
      for (const [collapsed, survivor] of collapseMap) {
        if (survivor === pid) beforeIds.add(collapsed);
      }
    }

    for (const bid of beforeIds) {
      for (const w of warningsForPerson(beforeTree, bid)) {
        // Remap warning personId collapsed→survivor for matching
        const remapped: PersonWarning = collapseMap?.has(w.personId)
          ? { ...w, personId: collapseMap.get(w.personId)! }
          : w;
        beforeWarnings.set(warningId(remapped), remapped);
      }
    }

    for (const w of warningsForPerson(afterTree, pid)) {
      afterWarnings.set(warningId(w), w);
    }
  }

  // Warning types exempt from the gate. The satisfiability replay (ADR-0011
  // limit 2) showed these fire routinely on minimal trees and FamilySearch
  // imports, producing false-deny rates too high for the gate's intended
  // catches (implausible lifespan, event after death, burial after death).
  // Each is a data-quality indicator — not a genealogical contradiction the
  // writer introduced through a judgment error.
  const GATE_EXEMPT_TYPES = new Set([
    "missingFactsAndRelatives",     // stub detection — every one-fact person trips it on remove
    "tooManyBirthDates2",           // duplicate birth facts in imported records
    "hasEventBeforeBirth365_2",     // fires when adding a second birth-like fact
    "hasDiffSurnameMale",           // two names with different surnames — common in merges and imports
    "hasBlankName",                 // a name node with empty given/surname — named-party materializations
  ]);

  // Delta: warnings in after that were not in before
  const introduced: Array<PersonWarning & { warningId: string }> = [];
  for (const [wid, w] of afterWarnings) {
    if (!beforeWarnings.has(wid) && !GATE_EXEMPT_TYPES.has(w.issueType)) {
      introduced.push({ ...w, warningId: wid });
    }
  }

  // Check justifications
  const justifiedIds = new Set(
    (warningJustifications ?? []).filter((j) => typeof j.justification === "string" && j.justification.trim() !== "").map((j) => j.warningId),
  );

  const unjustified = introduced.filter((w) => !justifiedIds.has(w.warningId));

  return { unjustified, allIntroduced: introduced };
}

/**
 * Validate that every supplied justification matches a current introduced
 * warning. Returns stale ids (those not in the introduced set).
 */
export function staleJustifications(
  allIntroduced: Array<{ warningId: string }>,
  warningJustifications: WarningJustificationInput[],
): string[] {
  const introducedIds = new Set(allIntroduced.map((w) => w.warningId));
  return warningJustifications
    .map((j) => j.warningId)
    .filter((id) => !introducedIds.has(id));
}

/** Both ends of an edge: `person1`/`person2` on a Couple, `parent`/`child` on
 *  a ParentChild. Reading only the Couple pair left every ParentChild edit with
 *  no touched person, so the gate never saw it (issue #2525). */
function relationshipEndpoints(r: SimplifiedRelationship): string[] {
  return [r.person1, r.person2, r.parent, r.child].filter((p): p is string => !!p);
}

/**
 * Compute the set of person IDs whose data changed between two tree snapshots.
 * Includes every person whose names, facts, or gender differ, plus both
 * endpoints of every relationship added, removed, or edited.
 */
export function computeTouchedPersonIds(
  before: SimplifiedGedcomX,
  after: SimplifiedGedcomX,
): string[] {
  const touched = new Set<string>();

  const beforePersons = new Map<string, SimplifiedPerson>();
  for (const p of before.persons ?? []) {
    if (p.id) beforePersons.set(p.id, p);
  }
  const afterPersons = new Map<string, SimplifiedPerson>();
  for (const p of after.persons ?? []) {
    if (p.id) afterPersons.set(p.id, p);
  }

  // Persons added, removed, or changed
  for (const [id, p] of afterPersons) {
    const bp = beforePersons.get(id);
    if (!bp || JSON.stringify(bp) !== JSON.stringify(p)) {
      touched.add(id);
    }
  }
  for (const id of beforePersons.keys()) {
    if (!afterPersons.has(id)) touched.add(id);
  }

  // Relationship endpoints for added/removed/changed relationships
  const beforeRels = new Map<string, SimplifiedRelationship>();
  for (const r of before.relationships ?? []) {
    if (r.id) beforeRels.set(r.id, r);
  }
  const afterRels = new Map<string, SimplifiedRelationship>();
  for (const r of after.relationships ?? []) {
    if (r.id) afterRels.set(r.id, r);
  }
  for (const [id, r] of afterRels) {
    const br = beforeRels.get(id);
    if (!br || JSON.stringify(br) !== JSON.stringify(r)) {
      for (const p of relationshipEndpoints(r)) touched.add(p);
      if (br) for (const p of relationshipEndpoints(br)) touched.add(p);
    }
  }
  for (const [id, r] of beforeRels) {
    if (!afterRels.has(id)) for (const p of relationshipEndpoints(r)) touched.add(p);
  }

  return [...touched];
}

/** Key for one parent-child pair, as `executeTreeOps` records a proposed edge's
 *  `sourceAssertionId` for the competing-parentage check. */
export function parentChildKey(parent: string, child: string): string {
  return `${parent}|${child}`;
}

/** Biological parents of one sex for every child, in one pass. An edge with a
 *  non-biological `subtype` does not count; a parent holding both kinds of edge
 *  counts once. Parent ids pass through `rename` (a merge's collapsed→survivor
 *  map), so folding one father into another is not read as a new father; child
 *  ids do not, because folding two records of one child together does give
 *  that child both records' parents. */
function biologicalParentsByChild(
  tree: SimplifiedGedcomX,
  sex: "Male" | "Female",
  rename: (id: string) => string = (id) => id,
): Map<string, Set<string>> {
  const gender = new Map((tree.persons ?? []).map((p) => [rename(p.id ?? ""), normalizeGender(p.gender)]));
  const out = new Map<string, Set<string>>();
  for (const r of tree.relationships ?? []) {
    if (!r.parent || !r.child || !isQualifyingParentChildEdge(r)) continue;
    const parent = rename(r.parent);
    if (gender.get(parent) !== sex) continue;
    const child = r.child;
    const set = out.get(child) ?? new Set<string>();
    set.add(parent);
    out.set(child, set);
  }
  return out;
}

/** Where a parent edge's claim comes from: the proposed edge's own
 *  `sourceAssertionId`; else the assertions `person_evidence` links to that
 *  parent on the edge's sources, plus any source those do not cover; else the
 *  bare source refs. An assertion linked only to the child is not cited: it may
 *  name the other parent (a "Mother: …" on the same census). */
function parentEvidence(
  tree: SimplifiedGedcomX,
  research: any,
  parent: string,
  child: string,
  proposed: Map<string, string> | undefined,
): string {
  const fromCall = proposed?.get(parentChildKey(parent, child));
  if (fromCall) return fromCall;
  const refs: string[] = [];
  for (const r of tree.relationships ?? []) {
    if (r.parent === parent && r.child === child && isQualifyingParentChildEdge(r)) {
      for (const s of r.sources ?? []) if (s.ref && !refs.includes(s.ref)) refs.push(s.ref);
    }
  }
  if (refs.length === 0) return "no source";
  const sdidOf = new Map<string, string>(
    (Array.isArray(research?.sources) ? research.sources : [])
      .filter((s: any) => s && refs.includes(s.gedcomx_source_description_id))
      .map((s: any) => [s.id, s.gedcomx_source_description_id]),
  );
  const linkedToParent = new Set(
    (Array.isArray(research?.person_evidence) ? research.person_evidence : [])
      .filter((pe: any) => pe && pe.person_id === parent)
      .map((pe: any) => pe.assertion_id),
  );
  const cited = (Array.isArray(research?.assertions) ? research.assertions : []).filter(
    (a: any) =>
      a && sdidOf.has(a.source_id) && linkedToParent.has(a.id) &&
      isRelationshipEstablishing(a.fact_type) && String(a.fact_type).trim().toLowerCase() !== "marriage",
  );
  const covered = new Set(cited.map((a: any) => sdidOf.get(a.source_id)));
  const rest = refs.filter((r) => !covered.has(r));
  return [...cited.map((a: any) => a.id), ...(rest.length > 0 ? [`source ${rest.join(", ")}`] : [])].join(", ");
}

/** One competing-parentage finding, with what the gate needs to key it. */
export interface CompetingParentage {
  entry: ConflictSurfaced;
  sex: "Male" | "Female";
  /** Stable id for a justification: `competingParentage|child|sex|parents`. */
  warningId: string;
}

/**
 * Competing biological parentage this write creates: a child who now has two
 * or more biological parents of one sex, where that set grew. Issue #2525.
 *
 * Computed from the trees, not from the gate's introduced warnings: a
 * `tooManyFathers2` id carries no related person or facts, so a child who
 * already held the warning (a biological and an adoptive father, say) would
 * hide a new biological father, and a parent's gender change touches only the
 * parent while the warning sits on the child. A merge passes `collapseMap` so
 * a parent who was only folded into another is not read as new.
 *
 * Skipped unless the write changed a ParentChild edge or a person's gender:
 * nothing else can change a child's biological parents.
 */
export function findCompetingParentage(
  before: SimplifiedGedcomX,
  after: SimplifiedGedcomX,
  research: any,
  proposed?: Map<string, string>,
  collapseMap?: Map<string, string>,
): CompetingParentage[] {
  const edges = (t: SimplifiedGedcomX) =>
    JSON.stringify((t.relationships ?? []).filter((r) => r.type === "ParentChild"));
  const genders = (t: SimplifiedGedcomX) => JSON.stringify((t.persons ?? []).map((p) => [p.id, p.gender]));
  if (!collapseMap && edges(before) === edges(after) && genders(before) === genders(after)) return [];

  const rename = (id: string) => collapseMap?.get(id) ?? id;
  const people = new Map((after.persons ?? []).map((p) => [p.id, p]));
  const out: CompetingParentage[] = [];
  for (const sex of ["Male", "Female"] as const) {
    const was = biologicalParentsByChild(before, sex, rename);
    for (const [child, now] of biologicalParentsByChild(after, sex)) {
      if (now.size < 2 || !people.has(child)) continue;
      const prior = was.get(child) ?? new Set<string>();
      if (![...now].some((p) => !prior.has(p))) continue;
      const parents = [...now].sort();
      out.push({
        sex,
        warningId: `competingParentage|${child}|${sex}|${parents.join(",")}`,
        entry: {
          personId: child,
          factType: "ParentChild",
          values: parents.map((p) => {
            const person = people.get(p);
            const name = person ? getPersonName(person) : "";
            return `${p} ${name} (${parentEvidence(after, research, p, child, proposed)})`;
          }),
        },
      });
    }
  }
  return out;
}

/** The surfaced entries alone: what a writer returns as `conflicts_surfaced`. */
export function competingParentage(
  before: SimplifiedGedcomX,
  after: SimplifiedGedcomX,
  research: any,
  proposed?: Map<string, string>,
  collapseMap?: Map<string, string>,
): ConflictSurfaced[] {
  return findCompetingParentage(before, after, research, proposed, collapseMap).map((c) => c.entry);
}

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
import { relationshipEndpoints } from "../utils/relationship-endpoints.js";
import type { PersonWarning } from "../types/person-warnings.js";
import { Mob, normalizeGender } from "../utils/mob.js";
import { calculateWarnings, getPersonName, isQualifyingParentChildEdge } from "../tools/person-warnings.js";
import { isRelationshipEstablishing } from "../utils/source-ref-resolver.js";

/** Stable warning identifier: tag + person + related + sorted fact ids. */
export function warningId(w: PersonWarning): string {
  const factIds = (w.facts ?? []).map((f) => f.id).sort();
  return `${w.issueType}|${w.personId}|${w.relatedPersonId ?? ""}|${factIds.join(",")}`;
}

/**
 * Rewrite a before-tree warning's person references collapsed→survivor so it
 * can be matched against the after-tree warning it became.
 *
 * BOTH id fields, because `warningId` keys on both. Remapping only `personId`
 * leaves a pre-existing warning that merely NAMES a collapsed person — every
 * `relatives*` tag, and anything carrying a `relatedPersonId` — with a before
 * key the after side can never equal, so the subtraction misses it and the
 * merge is refused for a warning it did not introduce.
 */
function remapWarning(
  w: PersonWarning,
  collapseMap?: Map<string, string>,
): PersonWarning {
  if (!collapseMap) return w;
  const personId = collapseMap.get(w.personId) ?? w.personId;
  const relatedPersonId =
    w.relatedPersonId === undefined
      ? undefined
      : (collapseMap.get(w.relatedPersonId) ?? w.relatedPersonId);
  if (personId === w.personId && relatedPersonId === w.relatedPersonId) return w;
  return { ...w, personId, relatedPersonId };
}

// Warning types exempt from the gate.
//
// THE LINE IS THE CLASS, NOT THE FREQUENCY. A tag is exempt when it reports a
// DATA-QUALITY artefact -- an import that duplicated a person, a stub with one
// fact, two spellings of one name -- and gating when it reports a genealogical
// IMPOSSIBILITY the writer would be asserting. Picking by frequency instead
// put a real impossibility (`hasCloseChildBirthsIgnoreSimilarChildren`: two
// DISSIMILAR children born 2-240 days apart) on the exempt side while the
// duplicate-person class it is paired with kept refusing.
//
// A relative/gendered form is exempt iff its self form is. They are the same
// predicate at the same severity evaluated from a different anchor, so
// splitting them means one write refuses and an identical one does not.
// Enforced by `person-warnings-spec-drift.test.ts`, which derives the pairs
// from ALL_WARNING_TAGS rather than listing them: stated as prose the rule
// was silently broken by four pairs.
//
// Measured over the committed e2e final trees with
// dev/measure-parentage-gate-rate.ts; re-derive before changing this, and do
// not hand-copy the counts.
export const GATE_EXEMPT_TYPES: ReadonlySet<string> = new Set([
  // Import and stub artefacts -- predate the gate seeing parentage edges.
  "missingFactsAndRelatives",     // stub detection — every one-fact person trips it on remove
  "tooManyBirthDates2",           // duplicate birth facts in imported records
  "relativesTooManyBirthDates2",
  "hasEventBeforeBirth365_2",     // fires when adding a second birth-like fact
  "relativesHasEventBeforeBirth365_2",
  "hasDiffSurnameMale",           // two names with different surnames — common in merges and imports
  "hasBlankName",                 // a name node with empty given/surname — named-party materializations

  // One person recorded twice: the duplicate-person class, which is what an
  // import produces rather than a claim the writer is making.
  "similarChildren",
  "similarChildrenConflictingDates",

  // Date-precision artefacts: an imprecise or duplicated date, not a claim.
  "relativesHasEventBeforeChristening365_3",
  "hasEventBeforeChristening365_3",
  "relativesDeathRangeGreaterThan2",
  "deathRangeGreaterThan2",       // a death recorded as a multi-year range
  "maleRelativesHasDiffSurname",               // self form `hasDiffSurnameMale` exempt above

  // Child-bearing age and marriage-interval priors. Each appears in a self, a
  // gendered and a relative form; all forms travel together.
  //
  // `earliestChildBirthToBirth12` and `relativesEarliestChildBirthToBirth12`
  // are the deliberate hole in that pairing, and are NOT exempt. At cutoff 12
  // the tag stops being an age prior: it is the only check that fires when a
  // child is born BEFORE their parent, an impossibility rather than an
  // implausibility, and exempting it let every gated writer accept one. The
  // gendered forms at cutoff 14 stay exempt -- 13 and 14 are young, not
  // impossible. What makes un-exempting 12 safe is that the predicate now
  // reads the child's LATEST date bound, so an imprecise date no longer
  // fires it; before that change this entry was buying real false refusals.
  "femaleRelativesLatestChildBirthToBirth45",
  "latestChildBirthToBirthFemale45",
  "femaleRelativesEarliestChildBirthToBirth14",
  "earliestChildBirthToBirthFemale14",
  "maleRelativesEarliestChildBirthToBirth14",
  "earliestChildBirthToBirthMale14",
  "relativesLatestChildBirthToMarriage35",
  "latestChildBirthToMarriage35",
]);

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

/**
 * Every person one relationship hop out from `seed` in the AFTER tree,
 * excluding the seed itself.
 *
 * Deliberately NOT transitive: one hop is what `calculateWarnings` reaches
 * when it anchors a `relatives*` warning, so one hop is what the before side
 * has to be able to see. A full walk would compute warnings for the whole
 * connected component on every write.
 *
 * The before tree was scanned here too, on the reasoning that an edge REMOVAL
 * strands the neighbour on the other side. That was asserted, not measured,
 * and it is wrong: a removed edge's own endpoints are already in `seed`
 * (`computeTouchedPersonIds` adds both), and every other neighbour of theirs
 * survives in the after tree, so the before pass added nobody. Dropping it
 * leaves the gate suite at 466/466 and the corpus rate unchanged at 67.
 */
function oneHopNeighbours(
  afterTree: SimplifiedGedcomX,
  seed: ReadonlySet<string>,
): string[] {
  const out = new Set<string>();
  for (const r of afterTree.relationships ?? []) {
    const ends = relationshipEndpoints(r);
    if (!ends.some((e) => seed.has(e))) continue;
    for (const e of ends) if (!seed.has(e)) out.add(e);
  }
  return [...out];
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
  /** Measurement-only. `false` bypasses `GATE_EXEMPT_TYPES`, so the committed
   *  rate script can re-derive what the exempt list is actually buying rather
   *  than quoting a number nobody can reproduce. No shipped caller passes it. */
  applyExemptions = true,
  /** Measurement-only. `false` skips the one-hop widening below, so the rate
   *  script can re-derive the false refusals the widening removes. No shipped
   *  caller passes it. */
  widenOneHop = true,
): IntroducedWarningsResult {
  // Dedupe touched ids and, for merges, remap collapsed→survivor
  const uniqueIds = new Set<string>();
  for (const id of touchedPersonIds) {
    uniqueIds.add(collapseMap?.get(id) ?? id);
  }
  // Then widen by one relationship hop. `calculateWarnings` reports warnings
  // anchored on an anchor's relatives, not just the anchor, so the after side
  // sees a neighbour's warning while the before side cannot reach that
  // neighbour at all when the path is the edge being added. The warning is
  // then pre-existing but invisible to the subtraction, and the write is
  // refused for it. Same defect as the collapsed-id remap above, reached by a
  // different route.
  //
  // Measured over the committed e2e final trees with
  // `dev/measure-parentage-gate-rate.ts --no-widen-hop`: on PARENTAGE EDGES it
  // removes 16 of 83 refusals that no write introduced, leaving 67, and the
  // widened run finds the same distinct warnings -- it loses no true refusal
  // there. It is NOT subtract-only in general: review measured fact writes
  // separately (sampling every fourth committed fact as an added fact) at 37
  // refusals without the hop and 47 with, the 10 extra all parent-anchored and
  // all true catches. Both directions are the same mechanism -- the before side
  // can now reach what the after side reports.
  if (widenOneHop) {
    for (const id of oneHopNeighbours(afterTree, uniqueIds)) {
      uniqueIds.add(id);
    }
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
        const remapped = remapWarning(w, collapseMap);
        beforeWarnings.set(warningId(remapped), remapped);
      }
    }

    for (const w of warningsForPerson(afterTree, pid)) {
      afterWarnings.set(warningId(w), w);
    }
  }

  // Delta: warnings in after that were not in before
  const introduced: Array<PersonWarning & { warningId: string }> = [];
  for (const [wid, w] of afterWarnings) {
    if (!beforeWarnings.has(wid) && !(applyExemptions && GATE_EXEMPT_TYPES.has(w.issueType))) {
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
  // `relationshipEndpoints`, never a hand-written field read. These three
  // sites read only `person1`/`person2` -- the Couple pair -- so a ParentChild
  // edge, which carries `parent`/`child` and no `person1`, marked NOBODY as
  // touched and the gate could not fire on any parentage write.
  for (const [id, r] of afterRels) {
    const br = beforeRels.get(id);
    if (!br || JSON.stringify(br) !== JSON.stringify(r)) {
      for (const e of relationshipEndpoints(r)) touched.add(e);
      // The BEFORE side of a changed relationship is the repoint case: when a
      // parent moves A -> B, A must enter `touched` or the before-side
      // warnings are never computed and the delta is wrong in A's favour.
      if (br) {
        for (const e of relationshipEndpoints(br)) touched.add(e);
      }
    }
  }
  for (const [id, r] of beforeRels) {
    if (!afterRels.has(id)) {
      for (const e of relationshipEndpoints(r)) touched.add(e);
    }
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

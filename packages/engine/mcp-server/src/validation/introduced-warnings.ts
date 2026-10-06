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
import { relationshipEndpoints } from "../utils/relationship-endpoints.js";
import type { PersonWarning } from "../types/person-warnings.js";
import { Mob } from "../utils/mob.js";
import { calculateWarnings } from "../tools/person-warnings.js";

/** Stable warning identifier: tag + person + related + sorted fact ids. */
export function warningId(w: PersonWarning): string {
  const factIds = (w.facts ?? []).map((f) => f.id).sort();
  return `${w.issueType}|${w.personId}|${w.relatedPersonId ?? ""}|${factIds.join(",")}`;
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
//
// Measured over the committed e2e final trees with
// dev/measure-parentage-gate-rate.ts; re-derive before changing this, and do
// not hand-copy the counts.
export const GATE_EXEMPT_TYPES: ReadonlySet<string> = new Set([
  // Import and stub artefacts -- predate the gate seeing parentage edges.
  "missingFactsAndRelatives",     // stub detection — every one-fact person trips it on remove
  "tooManyBirthDates2",           // duplicate birth facts in imported records
  "hasEventBeforeBirth365_2",     // fires when adding a second birth-like fact
  "hasDiffSurnameMale",           // two names with different surnames — common in merges and imports
  "hasBlankName",                 // a name node with empty given/surname — named-party materializations

  // One person recorded twice: the duplicate-person class, which is what an
  // import produces rather than a claim the writer is making.
  "similarChildren",
  "similarChildrenConflictingDates",

  // Soft demographic and naming priors on a relative — heuristics, not
  // impossibilities.
  "relativesHasEventBeforeChristening365_3",
  "relativesDeathRangeGreaterThan2",
  "maleRelativesHasDiffSurname",               // self form `hasDiffSurnameMale` exempt above

  // Child-bearing age and marriage-interval priors. Each appears in a self, a
  // gendered and a relative form; all forms travel together.
  "femaleRelativesLatestChildBirthToBirth45",
  "latestChildBirthToBirthFemale45",
  "relativesEarliestChildBirthToBirth12",
  "earliestChildBirthToBirth12",
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

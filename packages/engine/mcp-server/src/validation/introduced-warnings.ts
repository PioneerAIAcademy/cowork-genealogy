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
import type { PersonWarning } from "../types/person-warnings.js";
import { Mob } from "../utils/mob.js";
import { calculateWarnings } from "../tools/person-warnings.js";

/** Stable warning identifier: tag + person + related + sorted fact ids. */
export function warningId(w: PersonWarning): string {
  const factIds = (w.facts ?? []).map((f) => f.id).sort();
  return `${w.issueType}|${w.personId}|${w.relatedPersonId ?? ""}|${factIds.join(",")}`;
}

/** Compute warnings for a single person on a tree, returning [] if the
 *  person does not exist (e.g. collapsed after a merge). */
function warningsForPerson(
  tree: SimplifiedGedcomX,
  personId: string,
): PersonWarning[] {
  const persons = tree.persons ?? [];
  if (!persons.some((p) => p.id === personId)) return [];
  const mob = new Mob(tree, personId);
  return calculateWarnings(mob, mob, mob, /* isFinalWarnings */ true);
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

  // Delta: warnings in after that were not in before
  const introduced: Array<PersonWarning & { warningId: string }> = [];
  for (const [wid, w] of afterWarnings) {
    if (!beforeWarnings.has(wid)) {
      introduced.push({ ...w, warningId: wid });
    }
  }

  // Check justifications
  const justifiedIds = new Set(
    (warningJustifications ?? []).map((j) => j.warningId),
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
  for (const [id, r] of afterRels) {
    const br = beforeRels.get(id);
    if (!br || JSON.stringify(br) !== JSON.stringify(r)) {
      if (r.person1) touched.add(r.person1);
      if (r.person2) touched.add(r.person2);
      if (br) {
        if (br.person1) touched.add(br.person1);
        if (br.person2) touched.add(br.person2);
      }
    }
  }
  for (const [id, r] of beforeRels) {
    if (!afterRels.has(id)) {
      if (r.person1) touched.add(r.person1);
      if (r.person2) touched.add(r.person2);
    }
  }

  return [...touched];
}

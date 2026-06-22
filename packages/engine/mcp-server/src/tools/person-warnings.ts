// MCP tool: person_warnings
// See `docs/specs/person-warnings-tool-spec.md`.
//
// Reads tree.gedcomx.json from a project directory and runs deterministic
// data-quality checks from the point of view of a required anchor person.
// No network, no auth — operates entirely on local file data.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type {
  SimplifiedGedcomX,
  SimplifiedPerson,
} from "../types/gedcomx.js";
import {
  BIRTH,
  BIRTHLIKE_FACT_TYPES,
  BIRTH_AND_EVENT_REGISTRATION,
  BURIAL,
  CHRISTENING,
  CHRISTENING_AND_BAPTISM,
  DEATH,
  DEATHLIKE_FACT_TYPES,
  MARRIAGELIKE_FACT_TYPES,
  Mob,
  getRelativeMobs,
} from "../utils/mob.js";
import {
  earliestDayOfChildFacts,
  earliestDayOfSelfFacts,
  earliestYearOfChildFacts,
  earliestYearOfParentFacts,
  earliestYearOfPersonFacts,
  earliestYearOfSelfFacts,
  factDaysCount,
  factDaysDiffEarliestLatest,
  factDaysDiffLatestLatest,
  factYearsDiffEarliestEarliest,
  factYearsDiffEarliestLatest,
  isPerfectStandardDate,
  latestDayOfPersonFacts,
  latestDayOfSelfFacts,
  latestYearOfChildFacts,
  latestYearOfPersonFacts,
  latestYearOfSelfFacts,
  perfectDaysOfSelfFacts,
} from "../utils/fact-helpers.js";
import { nameSimilarity, normalizeString } from "../utils/string-similarity.js";
import { getSimilarNamePairs } from "../utils/name-pairs.js";
import {
  getEarliest,
  getLatest,
  getPersonEventDayRanges,
  hasConflictingDates,
  hasOverlappingDates,
  sameYear,
} from "../utils/date-comparison.js";
import type {
  PersonWarning,
  PersonWarningsInput,
  PersonWarningsResult,
} from "../types/person-warnings.js";

export type {
  PersonWarningsInput,
  PersonWarning,
  PersonWarningsResult,
} from "../types/person-warnings.js";

const TREE_FILE = "tree.gedcomx.json";

interface LoadedAnchor {
  tree: SimplifiedGedcomX;
  anchor: SimplifiedPerson;
}

async function loadAnchor(
  projectPath: string,
  personId: string,
): Promise<LoadedAnchor> {
  const treePath = resolve(projectPath, TREE_FILE);

  let raw: string;
  try {
    raw = await readFile(treePath, "utf8");
  } catch {
    throw new Error(
      `${TREE_FILE} not found at ${projectPath}. Run person_read first to populate the tree file.`,
    );
  }

  let tree: SimplifiedGedcomX;
  try {
    tree = JSON.parse(raw) as SimplifiedGedcomX;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse ${TREE_FILE}: ${detail}`);
  }

  if (!tree.persons || tree.persons.length === 0) {
    throw new Error(`No persons found in ${TREE_FILE}.`);
  }

  const anchor = tree.persons.find((p) => p.id === personId);
  if (!anchor) {
    throw new Error(`Person '${personId}' not found in ${TREE_FILE}.`);
  }

  return { tree, anchor };
}

export const personWarningsToolSchema = {
  name: "person_warnings",
  description:
    "Check a person in tree.gedcomx.json for impossible or unlikely genealogical " +
    "data (e.g., death before birth, parent too young, event after death). Reads " +
    "the local project file — no authentication or network access required. " +
    "personId is the anchor person; warnings are evaluated over that person and " +
    "their one-hop relatives.",
  inputSchema: {
    type: "object" as const,
    properties: {
      projectPath: {
        type: "string",
        description:
          "Absolute path to the directory containing tree.gedcomx.json",
      },
      personId: {
        type: "string",
        description:
          "The anchor person to check. Warnings are evaluated over this person and their one-hop relatives.",
      },
    },
    required: ["projectPath", "personId"],
  },
} as const;

// Returns the display name for a person:
// preferred name → first name → "Unknown (id)" fallback.
export function getPersonName(person: SimplifiedPerson): string {
  const names = person.names ?? [];
  const chosen = names.find((n) => n.preferred) ?? names[0];
  if (!chosen) return `Unknown (${person.id ?? "?"})`;
  const given = chosen.given?.trim() ?? "";
  const surname = chosen.surname?.trim() ?? "";
  const full = [given, surname].filter(Boolean).join(" ");
  return full || `Unknown (${person.id ?? "?"})`;
}

const COHERENCE = "COHERENCE";

// Java MobWarnings warning tags. These strings match warnings.java exactly so
// the TS port emits the same `issueType` identifiers a Java caller would.
const HAS_EVENT_BEFORE_BIRTH_365_2 = "hasEventBeforeBirth365_2";
const EARLIEST_CHILD_BIRTH_TO_BIRTH_MALE_14 = "earliestChildBirthToBirthMale14";
const HAS_EVENT_AFTER_DEATH_1 = "hasEventAfterDeath1";
const HAS_AGE_RANGE_GREATER_THAN_120 = "hasAgeRangeGreaterThan120";
const HAS_BURIAL_AFTER_DEATH_31 = "hasBurialAfterDeath31";
const EARLIEST_CHILD_BIRTH_TO_BIRTH_12 = "earliestChildBirthToBirth12";
const DEATH_RANGE_GREATER_THAN_2 = "deathRangeGreaterThan2";
const HAS_LATE_MARRIAGE_90 = "hasLateMarriage90";
const HAS_EARLY_MARRIAGE_14 = "hasEarlyMarriage14";
const LATEST_CHILD_BIRTH_TO_BIRTH_80 = "latestChildBirthToBirth80";
const TOO_MANY_CHILDREN_18 = "tooManyChildren18";
const TOO_MANY_FATHERS_2 = "tooManyFathers2";
const TOO_MANY_MOTHERS_2 = "tooManyMothers2";
const HAS_BLANK_NAME = "hasBlankName";
const LATEST_CHILD_BIRTH_TO_BIRTH_FEMALE_55 = "latestChildBirthToBirthFemale55";
const HAS_DEATH_AFTER_CHILD_BIRTH_90 = "hasDeathAfterChildBirth90";
const HAS_CHILD_DEATH_AFTER_PARENT_BIRTH_200 = "hasChildDeathAfterParentBirth200";
const MISSING_FACTS_AND_RELATIVES = "missingFactsAndRelatives";
const CHILD_BIRTH_RANGE_40 = "childBirthRange40";
const EARLIEST_CHILD_MARRIAGE_TO_BIRTH_30 = "earliestChildMarriageToBirth30";
const LATEST_CHILD_BIRTH_TO_MARRIAGE_35 = "latestChildBirthToMarriage35";
const HAS_YOUNG_SPOUSE_15 = "hasYoungSpouse15";
const HAS_CHRISTENING_BEFORE_BIRTH = "hasChristeningBeforeBirth";
const HAS_EVENT_BEFORE_CHRISTENING_365_3 = "hasEventBeforeChristening365_3";
const TOO_MANY_BIRTH_DATES_2 = "tooManyBirthDates2";
const TOO_MANY_DEATH_DATES_2 = "tooManyDeathDates2";
const HAS_BURIAL_BEFORE_DEATH = "hasBurialBeforeDeath";
const HAS_DEATH_BEFORE_CHILD_BIRTH_30_10 = "hasDeathBeforeChildBirth30_10";
const HAS_DEATH_BEFORE_CHILD_BIRTH_365_2 = "hasDeathBeforeChildBirth365_2";
const HAS_DEATH_BEFORE_CHILD_BIRTH_FEMALE_2 = "hasDeathBeforeChildBirthFemale2";
const HAS_DEATH_BEFORE_CHILD_BIRTH_FEMALE_365 = "hasDeathBeforeChildBirthFemale365";
const CHILD_MARRIAGE_TO_MARRIAGE_15 = "childMarriageToMarriage15";
const HAS_DIFF_SURNAME_MALE = "hasDiffSurnameMale";

// Relative-mob warning tags — fired when an issue exists on a parent, spouse,
// or child of the anchor (Java's `relatives*` / `maleRelatives*` /
// `femaleRelatives*` warnings, warnings.java:188-556).
const RELATIVES_DEATH_RANGE_GREATER_THAN_2 = "relativesDeathRangeGreaterThan2";
const RELATIVES_EARLIEST_CHILD_BIRTH_TO_BIRTH_12 = "relativesEarliestChildBirthToBirth12";
const RELATIVES_HAS_EVENT_BEFORE_CHRISTENING_365_3 = "relativesHasEventBeforeChristening365_3";
const MALE_RELATIVES_EARLIEST_CHILD_BIRTH_TO_BIRTH_14 = "maleRelativesEarliestChildBirthToBirth14";
const FEMALE_RELATIVES_LATEST_CHILD_BIRTH_TO_BIRTH_55 = "femaleRelativesLatestChildBirthToBirth55";
const RELATIVES_HAS_DEATH_BEFORE_CHILD_BIRTH_365_2 = "relativesHasDeathBeforeChildBirth365_2";
const RELATIVES_HAS_DEATH_BEFORE_CHILD_BIRTH_30_10 = "relativesHasDeathBeforeChildBirth30_10";
const RELATIVES_EARLIEST_CHILD_MARRIAGE_TO_BIRTH_30 = "relativesEarliestChildMarriageToBirth30";
const FEMALE_RELATIVES_HAS_DEATH_BEFORE_CHILD_BIRTH_365 = "femaleRelativesHasDeathBeforeChildBirth365";
const FEMALE_RELATIVES_HAS_DEATH_BEFORE_CHILD_BIRTH_2 = "femaleRelativesHasDeathBeforeChildBirth2";
const RELATIVES_LATEST_CHILD_BIRTH_TO_MARRIAGE_35 = "relativesLatestChildBirthToMarriage35";
const RELATIVES_LATEST_CHILD_BIRTH_TO_BIRTH_80 = "relativesLatestChildBirthToBirth80";
const RELATIVES_CHILD_MARRIAGE_TO_MARRIAGE_15 = "relativesChildMarriageToMarriage15";
const RELATIVES_HAS_DEATH_AFTER_CHILD_BIRTH_90 = "relativesHasDeathAfterChildBirth90";
const RELATIVES_HAS_AGE_RANGE_GREATER_THAN_120 = "relativesHasAgeRangeGreaterThan120";
const RELATIVES_HAS_CHILD_DEATH_AFTER_PARENT_BIRTH_200 = "relativesHasChildDeathAfterParentBirth200";
const MALE_RELATIVES_HAS_DIFF_SURNAME = "maleRelativesHasDiffSurname";

// Tier A — date-sequence on relatives (added 2026-06; mirrors self-checkers
// already wired for the focal person). Each calls an existing self-checker
// inside a relativeMobs.some(...) anyMatch loop, matching Java MobWarnings
// lines 651-674.
const RELATIVES_HAS_EVENT_AFTER_DEATH_1 = "relativesHasEventAfterDeath1";
const RELATIVES_HAS_EVENT_BEFORE_BIRTH_365_2 = "relativesHasEventBeforeBirth365_2";
const RELATIVES_HAS_EARLY_MARRIAGE_14 = "relativesHasEarlyMarriage14";
const RELATIVES_HAS_LATE_MARRIAGE_90 = "relativesHasLateMarriage90";
const RELATIVES_HAS_BURIAL_BEFORE_DEATH = "relativesHasBurialBeforeDeath";
const RELATIVES_HAS_BURIAL_AFTER_DEATH_31 = "relativesHasBurialAfterDeath31";

// Tier B — added 2026-06. Two self warnings (missingSurnames,
// missingGivenNamesWithoutExactBirthLikeDate) plus four relative warnings
// that loop existing per-mob checkers over relativeMobs. Mirrors Java
// MobWarnings calculateNonFinalWarnings (warnings.java:572-648), which
// we collapse into the same orchestrator since our tool has no separate
// merge-pass.
const MISSING_SURNAMES = "missingSurnames";
const MISSING_GIVEN_NAMES_WITHOUT_EXACT_BIRTH_LIKE_DATE = "missingGivenNamesWithoutExactBirthLikeDate";
const RELATIVES_TOO_MANY_BIRTH_DATES_2 = "relativesTooManyBirthDates2";
const RELATIVES_TOO_MANY_DEATH_DATES_2 = "relativesTooManyDeathDates2";
const RELATIVES_BIRTH_LIKE_RANGE_GREATER_THAN_8 = "relativesBirthLikeRangeGreaterThan8";
const RELATIVES_CHILD_BIRTH_RANGE_40 = "relativesChildBirthRange40";
// Note on parent-mob enrichment: `buildParentMob` now carries the parent's
// other children (siblings of the anchor on that specific parent) into the
// synthetic tree, so `childBirthLikeRange` on a parent-mob can see the
// parent's full child set. `buildSpouseMob` is intentionally NOT enriched —
// the simplified GedcomX format doesn't carry coparent info, so we can't
// tell which of the anchor's children are shared with a given spouse. Half
// vs. full-sibling disambiguation needs a separate data-model change; the
// spouse-mob variant of relativesChildBirthRange40 stays deferred.

// Tier C + D — added 2026-06. Similar-child / similar-spouse duplicate-
// record detection, close-child-event spacing, and the dissimilar-spouses
// same-marriage-year warning. All run on a single Mob via the
// getSimilarNamePairs + date-comparison infrastructure in
// utils/name-pairs.ts and utils/date-comparison.ts.
const SIMILAR_CHILDREN = "similarChildren";
const SIMILAR_CHILDREN_CONFLICTING_DATES = "similarChildrenConflictingDates";
const SIMILAR_SPOUSES = "similarSpouses";
const SIMILAR_SPOUSES_CONFLICTING_DATES = "similarSpousesConflictingDates";
const HAS_CLOSE_CHILD_BIRTHS_IGNORE_SIMILAR_CHILDREN = "hasCloseChildBirthsIgnoreSimilarChildren";
const HAS_CLOSE_CHILD_CHRISTENINGS_6_30 = "hasCloseChildChristenings6_30";
const HAS_DISSIMILAR_SPOUSES_WITH_SAME_MARRIAGE_YEAR = "hasDissimilarSpousesWithSameMarriageYear";

// ─── Predicate ports of Java MobWarnings ────────────────────────────────────
// These mirror the boolean predicate methods in warnings.java exactly:
// same signature shape (mob + threshold), same internal aggregation, same
// comparison operator. The Java caller pattern is preserved one level up.

/**
 * Java MobWarnings.hasEventBeforeBirth (warnings.java:918).
 *
 * Fires when the gap between the earliest fact of any type and the latest
 * birth-like fact is more than `days` days. Java calls this with `days = 730`
 * (2 years) under the tag `hasEventBeforeBirth365_2`.
 */
export function hasEventBeforeBirth(mob: Mob, days: number): boolean {
  const diff = factDaysDiffEarliestLatest(
    mob,
    null,
    null,
    BIRTHLIKE_FACT_TYPES,
    null,
  );
  return diff !== null && diff > days;
}

/**
 * Java MobWarnings.earliestChildBirthToBirth (warnings.java:1723).
 *
 * Returns true when `earliestChildBirthYear − earliestSelfBirthYear <= cutoff`
 * for the anchor's birth-like facts and any child's birth-like facts. Per the
 * 2026-06-02 meeting, the spec's "conservative range" principle is overridden
 * by this earliest-to-earliest bound. Used at cutoff = 14 (male anchor) under
 * tag `earliestChildBirthToBirthMale14`, and at cutoff = 12 (any gender) under
 * tag `earliestChildBirthToBirth12` (the gender-neutral check is on the to-do
 * list — not implemented in this commit).
 */
export function earliestChildBirthToBirth(mob: Mob, cutoff: number): boolean {
  const earliestChildBirth = earliestYearOfChildFacts(mob, BIRTHLIKE_FACT_TYPES);
  const earliestBirth = earliestYearOfSelfFacts(mob, BIRTHLIKE_FACT_TYPES);
  if (earliestChildBirth === null || earliestBirth === null) return false;
  return earliestChildBirth - earliestBirth <= cutoff;
}

/**
 * Java MobWarnings.hasEventAfterDeath (warnings.java:913).
 *
 * Fires when the gap between the latest death-like fact and the latest fact
 * of any type is more than `days` days. Java calls this with `days = 365`
 * (1 year) under the tag `hasEventAfterDeath1`. The deathlike-family anchor
 * is what makes Burial, Cremation, Probate, etc. *not* trigger this on their
 * own — they raise the death-side anchor; Java relies on that family +
 * tolerance instead of a hard-coded exclusion list.
 */
export function hasEventAfterDeath(mob: Mob, days: number): boolean {
  const diff = factDaysDiffLatestLatest(
    mob,
    DEATHLIKE_FACT_TYPES,
    null,
    null,
    null,
  );
  return diff !== null && diff > days;
}

/**
 * Java MobWarnings.hasAgeRangeGreaterThan (warnings.java:825).
 *
 * Fires when `earliestDeath − latestBirth > years` over the birth-like and
 * death-like families. Java calls this with `years = 120` under the tag
 * `hasAgeRangeGreaterThan120` — i.e. an impossible lifespan.
 */
export function hasAgeRangeGreaterThan(mob: Mob, years: number): boolean {
  const latestBirth = latestYearOfSelfFacts(mob, BIRTHLIKE_FACT_TYPES);
  const earliestDeath = earliestYearOfSelfFacts(mob, DEATHLIKE_FACT_TYPES);
  if (latestBirth === null || earliestDeath === null) return false;
  return earliestDeath - latestBirth > years;
}

/**
 * Java MobWarnings.hasBurialAfterDeath (warnings.java:970).
 *
 * Direct port. The Java math is `latestDeathDay − earliestBurialDay > days`,
 * which is positive (and triggers the warning) only when the earliest Burial
 * is more than `days` days BEFORE the latest Death. So despite the function
 * name, this fires for "burial before death" outliers, not "burial after
 * death." Java tag: `hasBurialAfterDeath31` (days = 31). Uses exact Burial
 * and exact Death types — not the death-like family.
 */
export function hasBurialAfterDeath(mob: Mob, days: number): boolean {
  const diff = factDaysDiffEarliestLatest(mob, BURIAL, null, DEATH, null);
  return diff !== null && diff > days;
}

/**
 * Java MobWarnings.deathRangeGreaterThan (warnings.java:816).
 *
 * Returns true when the span of death-like dates is greater than `years`.
 * = latestDeathLikeYear − earliestDeathLikeYear > years. Java calls this with
 * years = 2 under the tag `deathRangeGreaterThan2` — multiple conflicting
 * death records spanning >2 years suggest unreconciled sources.
 */
export function deathRangeGreaterThan(mob: Mob, years: number): boolean {
  const span = factYearsDiffEarliestLatest(
    mob,
    DEATHLIKE_FACT_TYPES,
    null,
    DEATHLIKE_FACT_TYPES,
    null,
  );
  return span !== null && span > years;
}

/**
 * Java MobWarnings.hasLateMarriage (warnings.java:874).
 *
 * Returns true when the latest marriage-like year is more than `years` years
 * after the latest birth-like year. Java calls this with years = 90 under
 * the tag `hasLateMarriage90` — married after age 90 is biologically
 * unusual.
 */
export function hasLateMarriage(mob: Mob, years: number): boolean {
  const latestBirth = latestYearOfSelfFacts(mob, BIRTHLIKE_FACT_TYPES);
  const latestMarriage = latestYearOfSelfFacts(mob, MARRIAGELIKE_FACT_TYPES);
  if (latestBirth === null || latestMarriage === null) return false;
  return latestMarriage - latestBirth > years;
}

/**
 * Java MobWarnings.hasEarlyMarriage (warnings.java:845).
 *
 * Returns true when the earliest marriage-like year is less than `years`
 * after the earliest birth-like year. Java calls this with years = 14 under
 * the tag `hasEarlyMarriage14` — married before age 14 is unusual.
 */
export function hasEarlyMarriage(mob: Mob, years: number): boolean {
  const age = factYearsDiffEarliestEarliest(
    mob,
    BIRTHLIKE_FACT_TYPES,
    null,
    MARRIAGELIKE_FACT_TYPES,
    null,
  );
  return age !== null && age < years;
}

/**
 * Java MobWarnings.latestChildBirthToBirth (warnings.java:1734).
 *
 * Returns true when the gap (latestChildBirthYear − latestBirthYear) is
 * greater than or equal to `cutoff`. Java calls this with cutoff = 80
 * under the tag `latestChildBirthToBirth80` — a child born 80+ years
 * after the parent's birth is biologically implausible.
 */
export function latestChildBirthToBirth(mob: Mob, cutoff: number): boolean {
  const latestChildBirth = latestYearOfChildFacts(mob, BIRTHLIKE_FACT_TYPES);
  const latestBirth = latestYearOfSelfFacts(mob, BIRTHLIKE_FACT_TYPES);
  if (latestChildBirth === null || latestBirth === null) return false;
  return latestChildBirth - latestBirth >= cutoff;
}

/**
 * Java MobWarnings.tooManyChildren (warnings.java:1883).
 *
 * Returns true when the anchor has at least `cutoff` children. Java calls
 * this with cutoff = 18 under the tag `tooManyChildren18` — possible in
 * real life but rare enough to flag.
 */
export function tooManyChildren(mob: Mob, cutoff: number): boolean {
  return mob.getChildren().length >= cutoff;
}

/**
 * Java MobWarnings.tooManyFathers (warnings.java:2178). Returns true when
 * the anchor has at least 2 male parents — each person has at most one
 * biological father, so 2+ is a structural problem. Tag: `tooManyFathers2`.
 */
export function tooManyFathers(mob: Mob): boolean {
  return mob.getFathers().length >= 2;
}

/**
 * Java MobWarnings.tooManyMothers (warnings.java:2182). Mirror of
 * tooManyFathers for the female-parent side. Tag: `tooManyMothers2`.
 */
export function tooManyMothers(mob: Mob): boolean {
  return mob.getMothers().length >= 2;
}

/**
 * Java MobWarnings.hasBlankName (warnings.java:1767).
 *
 * Returns true when any of the anchor's given or surname strings is the
 * empty string. Tag: `hasBlankName`.
 */
export function hasBlankName(mob: Mob): boolean {
  for (const name of mob.getPerson().names ?? []) {
    if (name.given === "") return true;
    if (name.surname === "") return true;
  }
  return false;
}

/**
 * Java MobWarnings.hasDeathMoreThanNYearsAfterEarliestChildBirth
 * (warnings.java:902). Returns true when earliestDeathYear − earliestChild-
 * BirthYear > years. Java calls this at years = 90 under the tag
 * `hasDeathAfterChildBirth90` — implausibly long lifespan post-parenthood.
 */
export function hasDeathMoreThanNYearsAfterEarliestChildBirth(
  mob: Mob,
  years: number,
): boolean {
  const earliestDeath = earliestYearOfSelfFacts(mob, DEATHLIKE_FACT_TYPES);
  const earliestChildBirth = earliestYearOfChildFacts(mob, BIRTHLIKE_FACT_TYPES);
  if (earliestDeath === null || earliestChildBirth === null) return false;
  return earliestDeath - earliestChildBirth > years;
}

/**
 * Java MobWarnings.hasDeathMoreThanNYearsAfterEarliestParentBirth
 * (warnings.java:891). Returns true when earliestDeathYear − earliestParent-
 * BirthYear > years. Java calls this at years = 200 under the tag
 * `hasChildDeathAfterParentBirth200` — implausible across generations.
 */
export function hasDeathMoreThanNYearsAfterEarliestParentBirth(
  mob: Mob,
  years: number,
): boolean {
  const earliestParentBirth = earliestYearOfParentFacts(
    mob,
    BIRTHLIKE_FACT_TYPES,
  );
  const earliestDeath = earliestYearOfSelfFacts(mob, DEATHLIKE_FACT_TYPES);
  if (earliestParentBirth === null || earliestDeath === null) return false;
  return earliestDeath - earliestParentBirth > years;
}

/**
 * Java MobWarnings.missingFactsAndRelatives (warnings.java:1930).
 *
 * Returns true when the anchor has no facts (other than GenderChange) AND
 * has no relatives. A truly empty stub record. Tag: `missingFactsAndRelatives`.
 */
export function missingFactsAndRelatives(mob: Mob): boolean {
  const hasNonGenderChangeFact = (mob.getPerson().facts ?? []).some(
    (f) => f.type !== "GenderChange",
  );
  if (hasNonGenderChangeFact) return false;
  const hasRelatives =
    mob.getParents().length > 0 ||
    mob.getSpouses().length > 0 ||
    mob.getChildren().length > 0;
  return !hasRelatives;
}

/**
 * Java MobWarnings.childBirthLikeRange (warnings.java:1745).
 *
 * Returns true when the span between earliest and latest birth-like dates
 * across all children is `>= cutoff` years. Java calls this at cutoff = 40
 * under the tag `childBirthRange40` — a 40+ year span between earliest and
 * latest child births is implausible for a single mother.
 */
export function childBirthLikeRange(mob: Mob, cutoff: number): boolean {
  const earliest = earliestYearOfChildFacts(mob, BIRTHLIKE_FACT_TYPES);
  const latest = latestYearOfChildFacts(mob, BIRTHLIKE_FACT_TYPES);
  if (earliest === null || latest === null) return false;
  return latest - earliest >= cutoff;
}

/**
 * Java MobWarnings.earliestChildMarriageToBirth (warnings.java:880).
 *
 * Returns true when (earliestChildMarriageYear − earliestSelfBirthYear) is
 * less than `years` — i.e. a child of this person married before this
 * person reached age `years`. Java calls this at years = 30 under the tag
 * `earliestChildMarriageToBirth30` — implies the anchor had a child at < 14
 * or so. Note: despite the helper being named `childMarriageToBirthDayGap`
 * in Java, the computation is year-level.
 */
export function earliestChildMarriageToBirth(mob: Mob, years: number): boolean {
  const earliestChildMarriage = earliestYearOfChildFacts(
    mob,
    MARRIAGELIKE_FACT_TYPES,
  );
  const earliestBirth = earliestYearOfSelfFacts(mob, BIRTHLIKE_FACT_TYPES);
  if (earliestChildMarriage === null || earliestBirth === null) return false;
  return earliestChildMarriage - earliestBirth < years;
}

/**
 * Java MobWarnings.latestChildBirthToMarriage (warnings.java:1712).
 *
 * Returns true when (latestChildBirthYear − latestSelfMarriageYear) is
 * `>= cutoff`. Java calls this at cutoff = 35 under the tag
 * `latestChildBirthToMarriage35` — a child born 35+ years after the
 * anchor's latest marriage suggests a record error or wrong relationship.
 */
export function latestChildBirthToMarriage(mob: Mob, cutoff: number): boolean {
  const latestChildBirth = latestYearOfChildFacts(mob, BIRTHLIKE_FACT_TYPES);
  const latestMarriage = latestYearOfSelfFacts(mob, MARRIAGELIKE_FACT_TYPES);
  if (latestChildBirth === null || latestMarriage === null) return false;
  return latestChildBirth - latestMarriage >= cutoff;
}

/**
 * Java MobWarnings.hasYoungSpouse (warnings.java:1771).
 *
 * Returns true when any spouse died before `cutoff` years of age. Java
 * iterates the spouses and uses `factYearsDiffEarliestLatest(spouse,
 * BIRTHLIKE_FACT_TYPES, DEATHLIKE_FACT_TYPES)` — a spouse-level lifespan
 * computation. Tag: `hasYoungSpouse15` (cutoff = 15). Suggests an early-
 * childhood marriage record that warrants scrutiny.
 */
export function hasYoungSpouse(mob: Mob, cutoff: number): boolean {
  for (const spouse of mob.getSpouses()) {
    const earliestBirth = earliestYearOfPersonFacts(
      spouse,
      BIRTHLIKE_FACT_TYPES,
    );
    const latestDeath = latestYearOfPersonFacts(spouse, DEATHLIKE_FACT_TYPES);
    if (earliestBirth === null || latestDeath === null) continue;
    if (latestDeath - earliestBirth < cutoff) return true;
  }
  return false;
}

/**
 * Java MobWarnings.hasChristeningBeforeBirth (warnings.java:924).
 *
 * Returns true when the latest Christening day is strictly before the
 * earliest Birth day. Java passes `imperfectDateFudgeDays = 365` so that
 * year-only Christening / Birth dates get a year of slack on each side
 * before the comparison fires. Tag: `hasChristeningBeforeBirth`. Uses exact
 * `Christening` and exact `Birth` (not the broader birth-like family).
 */
export function hasChristeningBeforeBirth(mob: Mob): boolean {
  const fudge = 365;
  const latestChristeningDay = latestDayOfSelfFacts(mob, CHRISTENING, null, fudge);
  const earliestBirthDay = earliestDayOfSelfFacts(mob, BIRTH, null, fudge);
  if (latestChristeningDay === null || earliestBirthDay === null) return false;
  return latestChristeningDay < earliestBirthDay;
}

/**
 * Java MobWarnings.hasEventBeforeChristening (warnings.java:930).
 *
 * Returns true when any event (not Birth or EventRegistration) happens
 * more than `days` days before the latest Christening / Baptism, with a
 * 365-day imperfect-date fudge. Java calls this at days = 365 * 3 (3
 * years) under the tag `hasEventBeforeChristening365_3` — an event >3
 * years before a christening is implausible.
 */
export function hasEventBeforeChristening(mob: Mob, days: number): boolean {
  const fudge = 365;
  const diff = factDaysDiffEarliestLatest(
    mob,
    null,
    BIRTH_AND_EVENT_REGISTRATION,
    CHRISTENING_AND_BAPTISM,
    null,
    fudge,
  );
  return diff !== null && diff > days;
}

/**
 * Java MobWarnings.tooManyBirthDates (warnings.java:1909).
 *
 * Returns true when there are `cutoff` or more distinct perfect-DMY Birth
 * dates spaced more than 30 days apart. Tag: `tooManyBirthDates2` at
 * cutoff = 2. A person can have only one birth; multiple distinct ones
 * means unreconciled conflicting records.
 */
export function tooManyBirthDates(mob: Mob, cutoff: number): boolean {
  return factDaysCount(mob, "Birth", 30) >= cutoff;
}

/**
 * Java MobWarnings.tooManyDeathDates (warnings.java:1926).
 *
 * Returns true when there are `cutoff` or more distinct perfect-DMY Death
 * dates spaced more than `maxDays` apart. Tag: `tooManyDeathDates2` at
 * (maxDays = 14, cutoff = 2). Java's comment: "Sometimes the burial is
 * recorded as a death event. Give them maxDays to bury the person."
 */
export function tooManyDeathDates(
  mob: Mob,
  maxDays: number,
  cutoff: number,
): boolean {
  return factDaysCount(mob, "Death", maxDays) >= cutoff;
}

/**
 * Java MobWarnings.hasBurialBeforeDeath (warnings.java:935) — a full port of
 * Java's two-branch `hasPriorDate` (warnings.java:940) with dates1 = BURIAL,
 * dates2 = DEATH. Returns true when every recorded burial precedes every
 * recorded death:
 *   - Branch 1 (both Burial and Death have ≥1 perfect-DMY date): compare at
 *     the day level — earliest perfect Death day > latest perfect Burial day.
 *   - Branch 2 (else — at least one side has no perfect date): fall back to a
 *     YEAR-level comparison over ALL dates — earliest Death year > latest
 *     Burial year. (The earlier port implemented only branch 1, silently
 *     missing every year-only burial-before-death conflict.)
 */
export function hasBurialBeforeDeath(mob: Mob): boolean {
  const burialDays = perfectDaysOfSelfFacts(mob, BURIAL);
  const deathDays = perfectDaysOfSelfFacts(mob, DEATH);
  if (burialDays.length > 0 && deathDays.length > 0) {
    return Math.min(...deathDays) > Math.max(...burialDays);
  }
  const earliestDeathYear = earliestYearOfSelfFacts(mob, DEATH);
  const latestBurialYear = latestYearOfSelfFacts(mob, BURIAL);
  return (
    earliestDeathYear !== null &&
    latestBurialYear !== null &&
    earliestDeathYear > latestBurialYear
  );
}

/**
 * Java MobWarnings.birthLikeRangeGreaterThan / maxBirthLikeRange
 * (warnings.java around line 1190). Returns true when the span across all
 * birth-like facts (Birth + Christening + Baptism + EventRegistration) is
 * greater than `years`. Used at years=8 under the tag
 * `relativesBirthLikeRangeGreaterThan8` — when applied to a relative whose
 * birth-like facts span > 8 years, suggests two records were merged on one
 * relative identity.
 */
export function birthLikeRangeGreaterThan(mob: Mob, years: number): boolean {
  const range = factYearsDiffEarliestLatest(
    mob,
    BIRTHLIKE_FACT_TYPES,
    null,
    BIRTHLIKE_FACT_TYPES,
    null,
  );
  return range !== null && range > years;
}

/**
 * Java MobWarnings.missingSurnames (warnings.java:1941). Returns true when
 * the person has no non-empty surname across any of their name entries.
 * Java semantics: `surnameStream().findAny().isEmpty()` — zero non-empty
 * surnames, including the no-names-at-all case. Tag: `missingSurnames`.
 */
export function missingSurnames(mob: Mob): boolean {
  const names = mob.getPerson().names ?? [];
  return !names.some((n) => n.surname !== undefined && n.surname !== "");
}

/**
 * Java MobWarnings.missingGivenNames (warnings.java:1937). Returns true
 * when the person has no non-empty given name across any of their name
 * entries. Tag: paired with `missingGivenNamesWithoutExactBirthLikeDate`
 * (gated on AND with !hasExactBirthLikeDates).
 */
export function missingGivenNames(mob: Mob): boolean {
  const names = mob.getPerson().names ?? [];
  return !names.some((n) => n.given !== undefined && n.given !== "");
}

/**
 * Java MobWarnings.hasExactBirthLikeDates (warnings.java around line 1900).
 * Returns true when any of the person's birth-like facts (Birth, Christening,
 * Baptism, EventRegistration) has a perfect-DMY date. Used to gate
 * `missingGivenNamesWithoutExactBirthLikeDate` — a record missing the given
 * name is much more suspicious when there is no exact birth date to
 * disambiguate it from same-surname relatives.
 */
export function hasExactBirthLikeDates(mob: Mob): boolean {
  return perfectDaysOfSelfFacts(mob, BIRTHLIKE_FACT_TYPES).length > 0;
}

/**
 * Java MobWarnings.hasDeathBeforeChildBirth (warnings.java:1010).
 *
 * Returns true when the anchor's latest Death day was more than `days`
 * before the earliest of any child's Birth day. Uses exact Death and exact
 * Birth (not the broader families) — paired with the family variant
 * hasDeathBeforeChildBirthLike below.
 *
 * Java call sites: at days = 300 for `hasDeathBeforeChildBirth30_10` (male,
 * ~10 months — biologically impossible for a male) and at days = 2 for
 * `hasDeathBeforeChildBirthFemale2` (female, 2 days — mothers can give
 * birth and die same day, but 2+ days before makes it physically
 * impossible).
 */
export function hasDeathBeforeChildBirth(mob: Mob, days: number): boolean {
  const latestDeath = latestDayOfSelfFacts(mob, DEATH);
  const earliestChildBirth = earliestDayOfChildFacts(mob, BIRTH);
  if (latestDeath === null || earliestChildBirth === null) return false;
  return earliestChildBirth - latestDeath > days;
}

/**
 * Java MobWarnings.hasDeathBeforeChildBirthLike (warnings.java:999).
 *
 * Family-level analog of hasDeathBeforeChildBirth: uses
 * DEATHLIKE_FACT_TYPES for the anchor's death side and
 * BIRTHLIKE_FACT_TYPES for the children's birth side. Java call sites:
 * at days = 365 * 2 for `hasDeathBeforeChildBirth365_2` (male, 2-year
 * tolerance) and at days = 365 for `hasDeathBeforeChildBirthFemale365`
 * (female).
 */
export function hasDeathBeforeChildBirthLike(mob: Mob, days: number): boolean {
  const latestDeath = latestDayOfSelfFacts(mob, DEATHLIKE_FACT_TYPES);
  const earliestChildBirth = earliestDayOfChildFacts(mob, BIRTHLIKE_FACT_TYPES);
  if (latestDeath === null || earliestChildBirth === null) return false;
  return earliestChildBirth - latestDeath > days;
}

/**
 * Java MobWarnings.childMarriageToMarriage (warnings.java:1656).
 *
 * Returns true when any child married within `cutoff` years of the anchor's
 * earliest marriage. Children born more than 1 year BEFORE the anchor's
 * earliest marriage are skipped (they're presumed to be from a prior
 * relationship, so this anchor's marriage year doesn't apply to them).
 *
 * Java call site: cutoff = 15 under the tag `childMarriageToMarriage15`. The
 * intent: if a child marries within 15 years of the parent's first marriage,
 * the parent must have had that child very young — biologically possible but
 * worth flagging.
 */
export function childMarriageToMarriage(mob: Mob, cutoff: number): boolean {
  const earliestMarriage = earliestYearOfSelfFacts(
    mob,
    MARRIAGELIKE_FACT_TYPES,
  );
  if (earliestMarriage === null) return false;
  const earliestMarriageDay = earliestDayOfSelfFacts(
    mob,
    MARRIAGELIKE_FACT_TYPES,
  );
  for (const child of mob.getChildren()) {
    const latestChildBirthDay = latestDayOfPersonFacts(
      child,
      BIRTHLIKE_FACT_TYPES,
    );
    if (
      latestChildBirthDay !== null &&
      earliestMarriageDay !== null &&
      earliestMarriageDay - latestChildBirthDay > 365
    ) {
      continue;
    }
    const earliestChildMarriage = earliestYearOfPersonFacts(
      child,
      MARRIAGELIKE_FACT_TYPES,
    );
    if (
      earliestChildMarriage !== null &&
      earliestChildMarriage - earliestMarriage <= cutoff
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Java MobWarnings.hasDiffSurname (warnings.java:741).
 *
 * Returns true when the anchor has at least one surname that doesn't match
 * any of their OTHER surnames (using `nameSimilarity > 0.5`). Said another
 * way: for some surname S, every OTHER surname scores similarity ≤ 0.5
 * against S — S is an outlier worth flagging.
 *
 * NOTE — deviation from Java: Java's inner loop iterates the same surname
 * list both times without skipping the self-comparison (`surname1 == surname2`
 * trivially scores 1.0), which makes `foundSame` always true and the
 * function never fire. We skip the self-index here so the warning behaves
 * as the tag name plainly implies. Worth confirming with Richard at review;
 * easy to revert by removing the `i !== j` guard if Java is correct as
 * written.
 *
 * Java call sites: `hasDiffSurnameMale` (gated on Male) and
 * `maleRelativesHasDiffSurname` (any male relative).
 */
export function hasDiffSurname(mob: Mob): boolean {
  const surnames = (mob.getPerson().names ?? [])
    .map((n) => n.surname)
    .filter((s): s is string => typeof s === "string" && s.length > 0);
  for (let i = 0; i < surnames.length; i++) {
    let foundSame = false;
    let foundDiff = false;
    for (let j = 0; j < surnames.length; j++) {
      if (i === j) continue; // deviation from Java — see doc comment above
      if (nameSimilarity(surnames[i], surnames[j]) > 0.5) {
        foundSame = true;
      } else {
        foundDiff = true;
      }
    }
    if (foundDiff && !foundSame) return true;
  }
  return false;
}

// ─── Warning emitters (predicate + tag → PersonWarning) ─────────────────────
// One per check, mirroring the if-block pattern in Java's
// calculateFinalWarnings (warnings.java:78–570). Each returns null when the
// predicate doesn't fire; a single PersonWarning when it does. The TS
// PersonWarning carries the Java tag in `issueType` plus a human-readable
// `message` for our UI (Java doesn't carry messages, only tags).

function checkHasEventBeforeBirth(mob: Mob): PersonWarning | null {
  if (!hasEventBeforeBirth(mob, 365 * 2)) return null;
  return {
    scoreType: COHERENCE,
    issueType: HAS_EVENT_BEFORE_BIRTH_365_2,
    severity: "error",
    personId: mob.anchorId,
    personName: getPersonName(mob.getPerson()),
    message:
      "An event is dated more than 2 years before this person's earliest birth-like fact.",
  };
}

function checkEarliestChildBirthToBirthMale14(
  mob: Mob,
): PersonWarning | null {
  if (mob.getGender() !== "Male") return null;
  if (!earliestChildBirthToBirth(mob, 14)) return null;

  const earliestChildBirth = earliestYearOfChildFacts(
    mob,
    BIRTHLIKE_FACT_TYPES,
  );
  const earliestBirth = earliestYearOfSelfFacts(mob, BIRTHLIKE_FACT_TYPES);
  // Non-null here because the predicate would have returned false otherwise.
  const ageAtEarliestChildBirth = earliestChildBirth! - earliestBirth!;

  return {
    scoreType: COHERENCE,
    issueType: EARLIEST_CHILD_BIRTH_TO_BIRTH_MALE_14,
    severity: "warning",
    personId: mob.anchorId,
    personName: getPersonName(mob.getPerson()),
    message: `Earliest child was born when this person was at most ${ageAtEarliestChildBirth}, which is normally before fatherhood age (14).`,
  };
}

function checkHasEventAfterDeath(mob: Mob): PersonWarning | null {
  if (!hasEventAfterDeath(mob, 365)) return null;
  return {
    scoreType: COHERENCE,
    issueType: HAS_EVENT_AFTER_DEATH_1,
    severity: "error",
    personId: mob.anchorId,
    personName: getPersonName(mob.getPerson()),
    message:
      "An event is dated more than 1 year after this person's latest death-like fact.",
  };
}

function checkHasAgeRangeGreaterThan120(mob: Mob): PersonWarning | null {
  if (!hasAgeRangeGreaterThan(mob, 120)) return null;
  return {
    scoreType: COHERENCE,
    issueType: HAS_AGE_RANGE_GREATER_THAN_120,
    severity: "error",
    personId: mob.anchorId,
    personName: getPersonName(mob.getPerson()),
    message:
      "This person's lifespan is greater than 120 years, which is implausible.",
  };
}

function checkHasBurialAfterDeath31(mob: Mob): PersonWarning | null {
  if (!hasBurialAfterDeath(mob, 31)) return null;
  return {
    scoreType: COHERENCE,
    issueType: HAS_BURIAL_AFTER_DEATH_31,
    severity: "warning",
    personId: mob.anchorId,
    personName: getPersonName(mob.getPerson()),
    message:
      "The earliest Burial is more than 31 days before the latest Death, which is unusual.",
  };
}

function checkEarliestChildBirthToBirth12(mob: Mob): PersonWarning | null {
  if (!earliestChildBirthToBirth(mob, 12)) return null;
  return {
    scoreType: COHERENCE,
    issueType: EARLIEST_CHILD_BIRTH_TO_BIRTH_12,
    severity: "warning",
    personId: mob.anchorId,
    personName: getPersonName(mob.getPerson()),
    message:
      "This person appears to have had a child at age 12 or younger, which is normally before childbearing years.",
  };
}

function checkDeathRangeGreaterThan2(mob: Mob): PersonWarning | null {
  if (!deathRangeGreaterThan(mob, 2)) return null;
  return {
    scoreType: COHERENCE,
    issueType: DEATH_RANGE_GREATER_THAN_2,
    severity: "warning",
    personId: mob.anchorId,
    personName: getPersonName(mob.getPerson()),
    message:
      "This person's death-like dates span more than 2 years — likely unreconciled conflicting records.",
  };
}

function checkHasLateMarriage90(mob: Mob): PersonWarning | null {
  if (!hasLateMarriage(mob, 90)) return null;
  return {
    scoreType: COHERENCE,
    issueType: HAS_LATE_MARRIAGE_90,
    severity: "warning",
    personId: mob.anchorId,
    personName: getPersonName(mob.getPerson()),
    message:
      "This person appears to have married more than 90 years after their birth, which is biologically unusual.",
  };
}

function checkHasEarlyMarriage14(mob: Mob): PersonWarning | null {
  if (!hasEarlyMarriage(mob, 14)) return null;
  return {
    scoreType: COHERENCE,
    issueType: HAS_EARLY_MARRIAGE_14,
    severity: "warning",
    personId: mob.anchorId,
    personName: getPersonName(mob.getPerson()),
    message:
      "This person appears to have married before age 14, which is unusual.",
  };
}

function checkLatestChildBirthToBirth80(mob: Mob): PersonWarning | null {
  if (!latestChildBirthToBirth(mob, 80)) return null;
  return {
    scoreType: COHERENCE,
    issueType: LATEST_CHILD_BIRTH_TO_BIRTH_80,
    severity: "warning",
    personId: mob.anchorId,
    personName: getPersonName(mob.getPerson()),
    message:
      "A child of this person was born 80 or more years after this person's birth, which is implausible.",
  };
}

function checkTooManyChildren18(mob: Mob): PersonWarning | null {
  if (!tooManyChildren(mob, 18)) return null;
  return {
    scoreType: COHERENCE,
    issueType: TOO_MANY_CHILDREN_18,
    severity: "warning",
    personId: mob.anchorId,
    personName: getPersonName(mob.getPerson()),
    message:
      "This person has 18 or more children recorded — possible in real life but rare enough to verify.",
  };
}

function checkTooManyFathers2(mob: Mob): PersonWarning | null {
  if (!tooManyFathers(mob)) return null;
  return {
    scoreType: COHERENCE,
    issueType: TOO_MANY_FATHERS_2,
    severity: "warning",
    personId: mob.anchorId,
    personName: getPersonName(mob.getPerson()),
    message:
      "This person has 2 or more male parents recorded — each person should have at most one biological father.",
  };
}

function checkTooManyMothers2(mob: Mob): PersonWarning | null {
  if (!tooManyMothers(mob)) return null;
  return {
    scoreType: COHERENCE,
    issueType: TOO_MANY_MOTHERS_2,
    severity: "warning",
    personId: mob.anchorId,
    personName: getPersonName(mob.getPerson()),
    message:
      "This person has 2 or more female parents recorded — each person should have at most one biological mother.",
  };
}

function checkHasBlankName(mob: Mob): PersonWarning | null {
  if (!hasBlankName(mob)) return null;
  return {
    scoreType: COHERENCE,
    issueType: HAS_BLANK_NAME,
    severity: "warning",
    personId: mob.anchorId,
    personName: getPersonName(mob.getPerson()),
    message:
      "This person has a blank given name or surname, which suggests an incomplete record.",
  };
}

function checkLatestChildBirthToBirthFemale55(
  mob: Mob,
): PersonWarning | null {
  if (mob.getGender() !== "Female") return null;
  if (!latestChildBirthToBirth(mob, 55)) return null;
  return {
    scoreType: COHERENCE,
    issueType: LATEST_CHILD_BIRTH_TO_BIRTH_FEMALE_55,
    severity: "warning",
    personId: mob.anchorId,
    personName: getPersonName(mob.getPerson()),
    message:
      "This person (female) had a child 55 or more years after her own birth, which is biologically unusual.",
  };
}

function checkHasDeathAfterChildBirth90(mob: Mob): PersonWarning | null {
  if (!hasDeathMoreThanNYearsAfterEarliestChildBirth(mob, 90)) return null;
  return {
    scoreType: COHERENCE,
    issueType: HAS_DEATH_AFTER_CHILD_BIRTH_90,
    severity: "warning",
    personId: mob.anchorId,
    personName: getPersonName(mob.getPerson()),
    message:
      "This person died more than 90 years after their earliest child's birth, an implausibly long post-parenthood lifespan.",
  };
}

function checkHasChildDeathAfterParentBirth200(
  mob: Mob,
): PersonWarning | null {
  if (!hasDeathMoreThanNYearsAfterEarliestParentBirth(mob, 200)) return null;
  return {
    scoreType: COHERENCE,
    issueType: HAS_CHILD_DEATH_AFTER_PARENT_BIRTH_200,
    severity: "warning",
    personId: mob.anchorId,
    personName: getPersonName(mob.getPerson()),
    message:
      "This person died more than 200 years after a parent's birth, which is biologically impossible.",
  };
}

function checkMissingFactsAndRelatives(mob: Mob): PersonWarning | null {
  if (!missingFactsAndRelatives(mob)) return null;
  return {
    scoreType: COHERENCE,
    issueType: MISSING_FACTS_AND_RELATIVES,
    severity: "warning",
    personId: mob.anchorId,
    personName: getPersonName(mob.getPerson()),
    message:
      "This person has no facts (other than GenderChange) and no relatives — likely an unfinished stub record.",
  };
}

function checkChildBirthRange40(mob: Mob): PersonWarning | null {
  if (!childBirthLikeRange(mob, 40)) return null;
  return {
    scoreType: COHERENCE,
    issueType: CHILD_BIRTH_RANGE_40,
    severity: "warning",
    personId: mob.anchorId,
    personName: getPersonName(mob.getPerson()),
    message:
      "The span between this person's earliest and latest child births is 40 or more years, which is implausible for a single parent.",
  };
}

function checkEarliestChildMarriageToBirth30(
  mob: Mob,
): PersonWarning | null {
  if (!earliestChildMarriageToBirth(mob, 30)) return null;
  return {
    scoreType: COHERENCE,
    issueType: EARLIEST_CHILD_MARRIAGE_TO_BIRTH_30,
    severity: "warning",
    personId: mob.anchorId,
    personName: getPersonName(mob.getPerson()),
    message:
      "A child of this person married before this person reached age 30, which suggests an unusually young parenthood.",
  };
}

function checkLatestChildBirthToMarriage35(
  mob: Mob,
): PersonWarning | null {
  if (!latestChildBirthToMarriage(mob, 35)) return null;
  return {
    scoreType: COHERENCE,
    issueType: LATEST_CHILD_BIRTH_TO_MARRIAGE_35,
    severity: "warning",
    personId: mob.anchorId,
    personName: getPersonName(mob.getPerson()),
    message:
      "A child was born 35 or more years after this person's latest marriage — suggests a record error or wrong relationship.",
  };
}

function checkHasYoungSpouse15(mob: Mob): PersonWarning | null {
  if (!hasYoungSpouse(mob, 15)) return null;
  return {
    scoreType: COHERENCE,
    issueType: HAS_YOUNG_SPOUSE_15,
    severity: "warning",
    personId: mob.anchorId,
    personName: getPersonName(mob.getPerson()),
    message:
      "A spouse of this person died before age 15, suggesting an early-childhood marriage record that warrants scrutiny.",
  };
}

function checkHasChristeningBeforeBirth(mob: Mob): PersonWarning | null {
  if (!hasChristeningBeforeBirth(mob)) return null;
  return {
    scoreType: COHERENCE,
    issueType: HAS_CHRISTENING_BEFORE_BIRTH,
    severity: "error",
    personId: mob.anchorId,
    personName: getPersonName(mob.getPerson()),
    message:
      "This person's Christening is dated before their Birth — a date impossibility.",
  };
}

function checkHasEventBeforeChristening365_3(
  mob: Mob,
): PersonWarning | null {
  if (!hasEventBeforeChristening(mob, 365 * 3)) return null;
  return {
    scoreType: COHERENCE,
    issueType: HAS_EVENT_BEFORE_CHRISTENING_365_3,
    severity: "error",
    personId: mob.anchorId,
    personName: getPersonName(mob.getPerson()),
    message:
      "An event is dated more than 3 years before this person's Christening / Baptism, which is implausible.",
  };
}

function checkTooManyBirthDates2(mob: Mob): PersonWarning | null {
  if (!tooManyBirthDates(mob, 2)) return null;
  return {
    scoreType: COHERENCE,
    issueType: TOO_MANY_BIRTH_DATES_2,
    severity: "warning",
    personId: mob.anchorId,
    personName: getPersonName(mob.getPerson()),
    message:
      "This person has 2 or more distinct Birth dates more than 30 days apart — unreconciled conflicting records.",
  };
}

function checkTooManyDeathDates2(mob: Mob): PersonWarning | null {
  if (!tooManyDeathDates(mob, 14, 2)) return null;
  return {
    scoreType: COHERENCE,
    issueType: TOO_MANY_DEATH_DATES_2,
    severity: "warning",
    personId: mob.anchorId,
    personName: getPersonName(mob.getPerson()),
    message:
      "This person has 2 or more distinct Death dates more than 14 days apart — unreconciled conflicting records.",
  };
}

function checkHasBurialBeforeDeath(mob: Mob): PersonWarning | null {
  if (!hasBurialBeforeDeath(mob)) return null;
  return {
    scoreType: COHERENCE,
    issueType: HAS_BURIAL_BEFORE_DEATH,
    severity: "error",
    personId: mob.anchorId,
    personName: getPersonName(mob.getPerson()),
    message:
      "This person's Burial is dated before their Death — a date impossibility.",
  };
}

function checkHasDeathBeforeChildBirth30_10(
  mob: Mob,
): PersonWarning | null {
  if (mob.getGender() !== "Male") return null;
  if (!hasDeathBeforeChildBirth(mob, 300)) return null;
  return {
    scoreType: COHERENCE,
    issueType: HAS_DEATH_BEFORE_CHILD_BIRTH_30_10,
    severity: "error",
    personId: mob.anchorId,
    personName: getPersonName(mob.getPerson()),
    message:
      "This person (male) died more than 300 days before a child's recorded Birth, which is biologically impossible.",
  };
}

function checkHasDeathBeforeChildBirth365_2(
  mob: Mob,
): PersonWarning | null {
  if (mob.getGender() !== "Male") return null;
  if (!hasDeathBeforeChildBirthLike(mob, 365 * 2)) return null;
  return {
    scoreType: COHERENCE,
    issueType: HAS_DEATH_BEFORE_CHILD_BIRTH_365_2,
    severity: "error",
    personId: mob.anchorId,
    personName: getPersonName(mob.getPerson()),
    message:
      "This person (male) died more than 2 years before a child's earliest birth-like fact, which is implausible.",
  };
}

function checkHasDeathBeforeChildBirthFemale2(
  mob: Mob,
): PersonWarning | null {
  if (mob.getGender() !== "Female") return null;
  if (!hasDeathBeforeChildBirth(mob, 2)) return null;
  return {
    scoreType: COHERENCE,
    issueType: HAS_DEATH_BEFORE_CHILD_BIRTH_FEMALE_2,
    severity: "error",
    personId: mob.anchorId,
    personName: getPersonName(mob.getPerson()),
    message:
      "This person (female) died more than 2 days before a child's recorded Birth — physically impossible.",
  };
}

function checkHasDeathBeforeChildBirthFemale365(
  mob: Mob,
): PersonWarning | null {
  if (mob.getGender() !== "Female") return null;
  if (!hasDeathBeforeChildBirthLike(mob, 365)) return null;
  return {
    scoreType: COHERENCE,
    issueType: HAS_DEATH_BEFORE_CHILD_BIRTH_FEMALE_365,
    severity: "error",
    personId: mob.anchorId,
    personName: getPersonName(mob.getPerson()),
    message:
      "This person (female) died more than 1 year before a child's earliest birth-like fact, which is implausible.",
  };
}

// ─── Self emitters that needed new predicates (childMarriage*, hasDiffSurname*) ──

function checkChildMarriageToMarriage15(mob: Mob): PersonWarning | null {
  if (!childMarriageToMarriage(mob, 15)) return null;
  return {
    scoreType: COHERENCE,
    issueType: CHILD_MARRIAGE_TO_MARRIAGE_15,
    severity: "warning",
    personId: mob.anchorId,
    personName: getPersonName(mob.getPerson()),
    message:
      "A child of this person married within 15 years of this person's earliest marriage, suggesting this person had that child very young.",
  };
}

function checkHasDiffSurnameMale(mob: Mob): PersonWarning | null {
  // Java gates this on Male anchor (warnings.java:544).
  if (mob.getGender() !== "Male") return null;
  if (!hasDiffSurname(mob)) return null;
  return {
    scoreType: COHERENCE,
    issueType: HAS_DIFF_SURNAME_MALE,
    severity: "warning",
    personId: mob.anchorId,
    personName: getPersonName(mob.getPerson()),
    message:
      "This person (male) has at least one surname that doesn't match the others, suggesting conflated identities.",
  };
}

// ─── Relative-mob emitters ─────────────────────────────────────────────────
// Java parity for warnings.java:188-556 — the `relatives*` / `maleRelatives*`
// / `femaleRelatives*` checks. Two emission shapes:
//
//   - anyMatch flavor — emit ONE warning anchored on `mob.anchorId` when
//     at least one relative's predicate fires (e.g. `anyMatch(... > 2)`).
//   - per-relative flavor — emit a separate warning per failing relative,
//     each anchored on the relative's id (Java does this for the three
//     per-relative `for` loops in calculateFinalWarnings).
//
// The orchestrator builds the relative-mob list once via `getRelativeMobs`
// and passes it (plus male/female sub-filters) to each emitter.

function checkRelativesDeathRangeGreaterThan2(
  mob: Mob,
  relativeMobs: Mob[],
): PersonWarning | null {
  if (!relativeMobs.some((r) => deathRangeGreaterThan(r, 2))) return null;
  return {
    scoreType: COHERENCE,
    issueType: RELATIVES_DEATH_RANGE_GREATER_THAN_2,
    severity: "warning",
    personId: mob.anchorId,
    personName: getPersonName(mob.getPerson()),
    message:
      "A relative of this person has a death-date range greater than 2 years, suggesting unreconciled death records.",
  };
}

function checkRelativesEarliestChildBirthToBirth12(
  relativeMobs: Mob[],
): PersonWarning[] {
  const out: PersonWarning[] = [];
  for (const rel of relativeMobs) {
    if (!earliestChildBirthToBirth(rel, 12)) continue;
    out.push({
      scoreType: COHERENCE,
      issueType: RELATIVES_EARLIEST_CHILD_BIRTH_TO_BIRTH_12,
      severity: "warning",
      personId: rel.anchorId,
      personName: getPersonName(rel.getPerson()),
      message:
        "This person had a child before age 12, which is biologically implausible.",
    });
  }
  return out;
}

function checkRelativesHasEventBeforeChristening365_3(
  mob: Mob,
  relativeMobs: Mob[],
): PersonWarning | null {
  if (!relativeMobs.some((r) => hasEventBeforeChristening(r, 365 * 3))) {
    return null;
  }
  return {
    scoreType: COHERENCE,
    issueType: RELATIVES_HAS_EVENT_BEFORE_CHRISTENING_365_3,
    severity: "warning",
    personId: mob.anchorId,
    personName: getPersonName(mob.getPerson()),
    message:
      "A relative of this person has an event dated more than 3 years before their christening, which is implausible.",
  };
}

function checkMaleRelativesEarliestChildBirthToBirth14(
  mob: Mob,
  relativeMobs: Mob[],
): PersonWarning | null {
  const males = relativeMobs.filter((r) => r.getGender() === "Male");
  if (!males.some((r) => earliestChildBirthToBirth(r, 14))) return null;
  return {
    scoreType: COHERENCE,
    issueType: MALE_RELATIVES_EARLIEST_CHILD_BIRTH_TO_BIRTH_14,
    severity: "warning",
    personId: mob.anchorId,
    personName: getPersonName(mob.getPerson()),
    message:
      "A male relative of this person had a child before age 14, which is normally before fatherhood age.",
  };
}

function checkFemaleRelativesLatestChildBirthToBirth55(
  mob: Mob,
  relativeMobs: Mob[],
): PersonWarning | null {
  const females = relativeMobs.filter((r) => r.getGender() === "Female");
  if (!females.some((r) => latestChildBirthToBirth(r, 55))) return null;
  return {
    scoreType: COHERENCE,
    issueType: FEMALE_RELATIVES_LATEST_CHILD_BIRTH_TO_BIRTH_55,
    severity: "warning",
    personId: mob.anchorId,
    personName: getPersonName(mob.getPerson()),
    message:
      "A female relative of this person had a child after age 55, which is biologically unusual.",
  };
}

// ─── Tier A — relative date-sequence emitters ────────────────────────────────
// Each uses the anyMatch pattern: if any relative trips the existing
// self-checker, emit one warning anchored on the focal person (mob.anchorId).
// Mirrors Java MobWarnings lines 651-674.

function checkRelativesHasEventAfterDeath1(
  mob: Mob,
  relativeMobs: Mob[],
): PersonWarning | null {
  if (!relativeMobs.some((r) => hasEventAfterDeath(r, 365))) return null;
  return {
    scoreType: COHERENCE,
    issueType: RELATIVES_HAS_EVENT_AFTER_DEATH_1,
    severity: "warning",
    personId: mob.anchorId,
    personName: getPersonName(mob.getPerson()),
    message:
      "A relative of this person has an event dated more than 1 year after their death.",
  };
}

function checkRelativesHasEventBeforeBirth365_2(
  mob: Mob,
  relativeMobs: Mob[],
): PersonWarning | null {
  if (!relativeMobs.some((r) => hasEventBeforeBirth(r, 365 * 2))) return null;
  return {
    scoreType: COHERENCE,
    issueType: RELATIVES_HAS_EVENT_BEFORE_BIRTH_365_2,
    severity: "warning",
    personId: mob.anchorId,
    personName: getPersonName(mob.getPerson()),
    message:
      "A relative of this person has an event dated more than 2 years before their birth.",
  };
}

function checkRelativesHasEarlyMarriage14(
  mob: Mob,
  relativeMobs: Mob[],
): PersonWarning | null {
  if (!relativeMobs.some((r) => hasEarlyMarriage(r, 14))) return null;
  return {
    scoreType: COHERENCE,
    issueType: RELATIVES_HAS_EARLY_MARRIAGE_14,
    severity: "warning",
    personId: mob.anchorId,
    personName: getPersonName(mob.getPerson()),
    message:
      "A relative of this person appears to have married before age 14.",
  };
}

function checkRelativesHasLateMarriage90(
  mob: Mob,
  relativeMobs: Mob[],
): PersonWarning | null {
  if (!relativeMobs.some((r) => hasLateMarriage(r, 90))) return null;
  return {
    scoreType: COHERENCE,
    issueType: RELATIVES_HAS_LATE_MARRIAGE_90,
    severity: "warning",
    personId: mob.anchorId,
    personName: getPersonName(mob.getPerson()),
    message:
      "A relative of this person appears to have married more than 90 years after their birth.",
  };
}

function checkRelativesHasBurialBeforeDeath(
  mob: Mob,
  relativeMobs: Mob[],
): PersonWarning | null {
  if (!relativeMobs.some((r) => hasBurialBeforeDeath(r))) return null;
  return {
    scoreType: COHERENCE,
    issueType: RELATIVES_HAS_BURIAL_BEFORE_DEATH,
    severity: "warning",
    personId: mob.anchorId,
    personName: getPersonName(mob.getPerson()),
    message:
      "A relative of this person has a Burial dated before their Death — a date impossibility.",
  };
}

function checkRelativesHasBurialAfterDeath31(
  mob: Mob,
  relativeMobs: Mob[],
): PersonWarning | null {
  if (!relativeMobs.some((r) => hasBurialAfterDeath(r, 31))) return null;
  return {
    scoreType: COHERENCE,
    issueType: RELATIVES_HAS_BURIAL_AFTER_DEATH_31,
    severity: "warning",
    personId: mob.anchorId,
    personName: getPersonName(mob.getPerson()),
    message:
      "A relative of this person's earliest Burial is more than 31 days before their latest Death.",
  };
}

// ─── Tier B — self emitters ──────────────────────────────────────────────────

function checkMissingSurnames(mob: Mob): PersonWarning | null {
  if (!missingSurnames(mob)) return null;
  return {
    scoreType: COHERENCE,
    issueType: MISSING_SURNAMES,
    severity: "warning",
    personId: mob.anchorId,
    personName: getPersonName(mob.getPerson()),
    message:
      "This person has no recorded surname, which makes it hard to distinguish from same-given-name individuals.",
  };
}

function checkMissingGivenNamesWithoutExactBirthLikeDate(
  mob: Mob,
): PersonWarning | null {
  if (!missingGivenNames(mob)) return null;
  if (hasExactBirthLikeDates(mob)) return null;
  return {
    scoreType: COHERENCE,
    issueType: MISSING_GIVEN_NAMES_WITHOUT_EXACT_BIRTH_LIKE_DATE,
    severity: "warning",
    personId: mob.anchorId,
    personName: getPersonName(mob.getPerson()),
    message:
      "This person has no recorded given name AND no exact birth-like date — the record is too sparse to identify reliably.",
  };
}

// ─── Tier B — relative emitters ──────────────────────────────────────────────

function checkRelativesTooManyBirthDates2(
  mob: Mob,
  relativeMobs: Mob[],
): PersonWarning | null {
  if (!relativeMobs.some((r) => tooManyBirthDates(r, 2))) return null;
  return {
    scoreType: COHERENCE,
    issueType: RELATIVES_TOO_MANY_BIRTH_DATES_2,
    severity: "warning",
    personId: mob.anchorId,
    personName: getPersonName(mob.getPerson()),
    message:
      "A relative of this person has 2 or more distinct Birth dates more than 30 days apart — unreconciled records.",
  };
}

function checkRelativesTooManyDeathDates2(
  mob: Mob,
  relativeMobs: Mob[],
): PersonWarning | null {
  if (!relativeMobs.some((r) => tooManyDeathDates(r, 14, 2))) return null;
  return {
    scoreType: COHERENCE,
    issueType: RELATIVES_TOO_MANY_DEATH_DATES_2,
    severity: "warning",
    personId: mob.anchorId,
    personName: getPersonName(mob.getPerson()),
    message:
      "A relative of this person has 2 or more distinct Death dates more than 14 days apart — unreconciled records.",
  };
}

function checkRelativesBirthLikeRangeGreaterThan8(
  mob: Mob,
  relativeMobs: Mob[],
): PersonWarning | null {
  if (!relativeMobs.some((r) => birthLikeRangeGreaterThan(r, 8))) return null;
  return {
    scoreType: COHERENCE,
    issueType: RELATIVES_BIRTH_LIKE_RANGE_GREATER_THAN_8,
    severity: "warning",
    personId: mob.anchorId,
    personName: getPersonName(mob.getPerson()),
    message:
      "A relative of this person has birth-like fact dates spanning more than 8 years — suggests two records merged on one identity.",
  };
}

function checkRelativesChildBirthRange40(
  mob: Mob,
  relativeMobs: Mob[],
): PersonWarning | null {
  // Java emits a SINGLE aggregate warning via `anyMatch`, anchored on the
  // focal/merged mob (warnings.java:612-617) — not one warning per relative.
  if (!relativeMobs.some((rel) => childBirthLikeRange(rel, 40))) return null;
  return {
    scoreType: COHERENCE,
    issueType: RELATIVES_CHILD_BIRTH_RANGE_40,
    severity: "warning",
    personId: mob.anchorId,
    personName: getPersonName(mob.getPerson()),
    message:
      "A relative of this person has children whose births span 40 or more years, which is implausible for a single parent.",
  };
}

// ─── Tier C + D helpers — similar-pair detection on children / spouses ──────

const MAX_CHILDREN_TO_COMPARE = 40;

function compatibleGenders(p1: SimplifiedPerson, p2: SimplifiedPerson): boolean {
  const g1 = p1.gender;
  const g2 = p2.gender;
  if (g1 === undefined || g2 === undefined) return true;
  if (g1 === "Unknown" || g2 === "Unknown") return true;
  return g1 === g2;
}

function findPerson(persons: readonly SimplifiedPerson[], id: string): SimplifiedPerson | undefined {
  return persons.find((p) => p.id === id);
}

/**
 * Java parity for `hasSimilarChildren(mob)` (warnings.java:1033). Uses the
 * v1 simplification of `getSimilarPairs`: name-similarity + gender match +
 * neither overlapping nor conflicting dates. Skips the detailed birth-
 * overlap heuristics of the full Java implementation; can over-flag
 * compared to Java but does not under-flag.
 */
function hasSimilarChildren(mob: Mob): boolean {
  const children = mob.getChildren().slice(0, MAX_CHILDREN_TO_COMPARE);
  if (children.length < 2) return false;
  const pairs = getSimilarNamePairs(children, children, [], true);
  for (const [id1, id2] of pairs) {
    const c1 = findPerson(children, id1);
    const c2 = findPerson(children, id2);
    if (!c1 || !c2) continue;
    if (!compatibleGenders(c1, c2)) continue;
    if (hasOverlappingDates(c1, c2)) continue;
    if (hasConflictingDates(c1, c2)) continue;
    return true;
  }
  return false;
}

/**
 * Java parity for `hasSimilarChildrenConflictingDates(mob)` (warnings.java:1151).
 * Same name-similarity + gender check, but only fires when the dates DO
 * overlap — that suggests the two records are not actually duplicates but
 * carry conflicting source-disagreement.
 */
function hasSimilarChildrenConflictingDates(mob: Mob): boolean {
  const children = mob.getChildren().slice(0, MAX_CHILDREN_TO_COMPARE);
  if (children.length < 2) return false;
  const pairs = getSimilarNamePairs(children, children, [], true);
  for (const [id1, id2] of pairs) {
    const c1 = findPerson(children, id1);
    const c2 = findPerson(children, id2);
    if (!c1 || !c2) continue;
    if (!compatibleGenders(c1, c2)) continue;
    if (hasOverlappingDates(c1, c2)) return true;
  }
  return false;
}

function focalSpouseNoiseNames(mob: Mob): string[] {
  // When the focal is Male, his surname becomes "noise" so two distinct
  // wives who both share his surname don't count as similar on that
  // signal alone. Java applies this when bestGuessGender == Male.
  const person = mob.getPerson();
  if (person.gender !== "Male") return [];
  const surnames = (person.names ?? [])
    .map((n) => n.surname ?? "")
    .filter((s) => s.length > 0)
    .map((s) => normalizeString(s));
  return surnames;
}

/**
 * Java parity for `hasSimilarSpousesWithoutConflictingDates` →
 * `hasSimilarSpouses(mob, false)` (warnings.java:2061,2065) → emits
 * `similarSpouses`. Fires when a similar spouse pair does **not** have
 * conflicting dates. Java's spouse path keys ONLY on `hasConflictingDates` —
 * `hasOverlappingDates` is the children-path predicate (warnings.java:2072),
 * so it must not gate the spouse path.
 */
function hasSimilarSpouses(mob: Mob): boolean {
  const spouses = mob.getSpouses();
  if (spouses.length < 2) return false;
  const noise = focalSpouseNoiseNames(mob);
  const pairs = getSimilarNamePairs(spouses, spouses, noise, false);
  for (const [id1, id2] of pairs) {
    const s1 = findPerson(spouses, id1);
    const s2 = findPerson(spouses, id2);
    if (!s1 || !s2) continue;
    if (hasConflictingDates(s1, s2)) continue;
    return true;
  }
  return false;
}

/**
 * Java parity for `hasSimilarSpousesWithConflictingDates` →
 * `hasSimilarSpouses(mob, true)` (warnings.java:2057,2065) → emits
 * `similarSpousesConflictingDates`. Fires when a similar spouse pair **does**
 * have conflicting dates. Keys on `hasConflictingDates`, matching Java (the
 * earlier port used `hasOverlappingDates`, copied from the children path).
 */
function hasSimilarSpousesConflictingDates(mob: Mob): boolean {
  const spouses = mob.getSpouses();
  if (spouses.length < 2) return false;
  const noise = focalSpouseNoiseNames(mob);
  const pairs = getSimilarNamePairs(spouses, spouses, noise, false);
  for (const [id1, id2] of pairs) {
    const s1 = findPerson(spouses, id1);
    const s2 = findPerson(spouses, id2);
    if (!s1 || !s2) continue;
    if (hasConflictingDates(s1, s2)) return true;
  }
  return false;
}

/**
 * Java parity for `hasClosePersonFactDates` (warnings.java:1423). Given a
 * list of persons and a fact-type filter, returns true when any pair of
 * persons has earliest-perfect-DMY dates differing by a value strictly
 * between `minDays` and `maxDays`, AND the similarity predicate matches
 * (`compareSimilar=false` → only consider non-similar pairs;
 * `compareSimilar=true` → only consider similar pairs).
 */
function hasClosePersonFactDates(
  persons: readonly SimplifiedPerson[],
  factTypes: ReadonlySet<string>,
  minDays: number,
  maxDays: number,
  compareSimilar: boolean,
  compareGivenOnly: boolean,
): boolean {
  if (persons.length < 2) return false;
  const similarPairs = getSimilarNamePairs(persons, persons, [], compareGivenOnly);
  const similarKeys = new Set(
    similarPairs.map(([a, b]) => `${a}|${b}`),
  );

  const dayByPersonId = new Map<string, number>();
  for (const p of persons) {
    if (!p.id) continue;
    const days = getPersonEventDayRanges(p, factTypes, null, true, 0);
    const earliest = getEarliest(days);
    if (earliest !== null) dayByPersonId.set(p.id, earliest);
  }

  const ids = Array.from(dayByPersonId.keys());
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const id1 = ids[i];
      const id2 = ids[j];
      const [a, b] = id1 < id2 ? [id1, id2] : [id2, id1];
      const isSimilar = similarKeys.has(`${a}|${b}`);
      if (compareSimilar !== isSimilar) continue;
      const diff = Math.abs(dayByPersonId.get(id1)! - dayByPersonId.get(id2)!);
      if (diff > minDays && diff < maxDays) return true;
    }
  }
  return false;
}

const CHRISTENING_AND_BAPTISM_TYPES: ReadonlySet<string> = new Set([
  "Christening",
  "Baptism",
]);
const BIRTH_ONLY_TYPES: ReadonlySet<string> = new Set(["Birth"]);
const MARRIAGE_TYPES: ReadonlySet<string> = new Set([
  "Marriage",
  "MarriageLicense",
  "MarriageBanns",
  "Engagement",
]);

/**
 * Java parity for `hasCloseChildBirthsIgnoreSimilar(mob)` (warnings.java:1021).
 * `minDays=2, maxDays=8*30` → fires when two NON-similar children's exact
 * Birth dates are 2 to 240 days apart (suspicious sibling spacing).
 */
function hasCloseChildBirthsIgnoreSimilar(mob: Mob): boolean {
  const children = mob.getChildren().slice(0, MAX_CHILDREN_TO_COMPARE);
  return hasClosePersonFactDates(children, BIRTH_ONLY_TYPES, 2, 8 * 30, false, true);
}

/**
 * Java parity for `hasCloseChildChristenings(mob, 2, 6*30, null)` (warnings.java:1470).
 * `minDays=2, maxDays=6*30=180` → fires when two SIMILAR children's
 * Christening or Baptism dates are within that window (suggests duplicate
 * records of the same event).
 */
function hasCloseChildChristenings6_30(mob: Mob): boolean {
  const children = mob.getChildren().slice(0, MAX_CHILDREN_TO_COMPARE);
  return hasClosePersonFactDates(children, CHRISTENING_AND_BAPTISM_TYPES, 2, 6 * 30, true, true);
}

function getEarliestMarriageYearOfPerson(person: SimplifiedPerson): number | null {
  // Use the perfect+imperfect path; we only need a year, so passing
  // onlyPerfect=false and converting via getDayRange would over-engineer.
  // Just read years from the facts directly.
  let earliest: number | null = null;
  for (const f of person.facts ?? []) {
    if (f.type === undefined) continue;
    if (!MARRIAGE_TYPES.has(f.type)) continue;
    const std = f.standard_date ?? f.date;
    if (!std) continue;
    // Extract the first 4-digit year token from the standardized date.
    const m = std.match(/\b(\d{4})\b/);
    if (m) {
      const year = parseInt(m[1], 10);
      if (earliest === null || year < earliest) earliest = year;
    }
  }
  return earliest;
}

/**
 * Java parity for `hasDissimilarSpouseSameMarriageYear(mob)` (warnings.java:1784).
 * Fires when two of the focal's spouses share a marriage year but their
 * names are dissimilar — a strong signal that two different spouses got
 * merged under one identity.
 */
function hasDissimilarSpousesWithSameMarriageYear(mob: Mob): boolean {
  const spouses = mob.getSpouses();
  if (spouses.length < 2) return false;
  const noise = focalSpouseNoiseNames(mob);
  const similarPairs = getSimilarNamePairs(spouses, spouses, noise, false);
  const similarKeys = new Set(similarPairs.map(([a, b]) => `${a}|${b}`));

  // For each unordered pair, check same marriage year + not similar names.
  for (let i = 0; i < spouses.length; i++) {
    for (let j = i + 1; j < spouses.length; j++) {
      const s1 = spouses[i];
      const s2 = spouses[j];
      const y1 = getEarliestMarriageYearOfPerson(s1);
      const y2 = getEarliestMarriageYearOfPerson(s2);
      if (y1 === null || y2 === null) continue;
      if (y1 !== y2) continue;
      if (!s1.id || !s2.id) continue;
      const [a, b] = s1.id < s2.id ? [s1.id, s2.id] : [s2.id, s1.id];
      if (similarKeys.has(`${a}|${b}`)) continue;
      return true;
    }
  }
  return false;
}

// ─── Tier C + D — emitters ───────────────────────────────────────────────────

function checkSimilarChildren(mob: Mob): PersonWarning | null {
  if (!hasSimilarChildren(mob)) return null;
  return {
    scoreType: COHERENCE,
    issueType: SIMILAR_CHILDREN,
    severity: "warning",
    personId: mob.anchorId,
    personName: getPersonName(mob.getPerson()),
    message:
      "Two of this person's children look like the same individual recorded twice (similar names, same gender, dates compatible).",
  };
}

function checkSimilarChildrenConflictingDates(mob: Mob): PersonWarning | null {
  if (!hasSimilarChildrenConflictingDates(mob)) return null;
  return {
    scoreType: COHERENCE,
    issueType: SIMILAR_CHILDREN_CONFLICTING_DATES,
    severity: "warning",
    personId: mob.anchorId,
    personName: getPersonName(mob.getPerson()),
    message:
      "Two of this person's children have similar names but conflicting dates — likely the same child recorded twice with divergent source data.",
  };
}

function checkSimilarSpouses(mob: Mob): PersonWarning | null {
  if (!hasSimilarSpouses(mob)) return null;
  return {
    scoreType: COHERENCE,
    issueType: SIMILAR_SPOUSES,
    severity: "warning",
    personId: mob.anchorId,
    personName: getPersonName(mob.getPerson()),
    message:
      "Two of this person's spouses look like the same individual recorded twice (similar names, dates compatible).",
  };
}

function checkSimilarSpousesConflictingDates(mob: Mob): PersonWarning | null {
  if (!hasSimilarSpousesConflictingDates(mob)) return null;
  return {
    scoreType: COHERENCE,
    issueType: SIMILAR_SPOUSES_CONFLICTING_DATES,
    severity: "warning",
    personId: mob.anchorId,
    personName: getPersonName(mob.getPerson()),
    message:
      "Two of this person's spouses have similar names but conflicting dates — likely the same spouse recorded twice with divergent source data.",
  };
}

function checkHasCloseChildBirthsIgnoreSimilarChildren(mob: Mob): PersonWarning | null {
  if (!hasCloseChildBirthsIgnoreSimilar(mob)) return null;
  return {
    scoreType: COHERENCE,
    issueType: HAS_CLOSE_CHILD_BIRTHS_IGNORE_SIMILAR_CHILDREN,
    severity: "warning",
    personId: mob.anchorId,
    personName: getPersonName(mob.getPerson()),
    message:
      "Two of this person's children have Birth dates suspiciously close together — possible duplicate sibling records.",
  };
}

function checkHasCloseChildChristenings6_30(mob: Mob): PersonWarning | null {
  if (!hasCloseChildChristenings6_30(mob)) return null;
  return {
    scoreType: COHERENCE,
    issueType: HAS_CLOSE_CHILD_CHRISTENINGS_6_30,
    severity: "warning",
    personId: mob.anchorId,
    personName: getPersonName(mob.getPerson()),
    message:
      "Two of this person's children have Christening/Baptism dates within 6 months of each other AND similar names — possible duplicate event records.",
  };
}

function checkHasDissimilarSpousesWithSameMarriageYear(mob: Mob): PersonWarning | null {
  if (!hasDissimilarSpousesWithSameMarriageYear(mob)) return null;
  return {
    scoreType: COHERENCE,
    issueType: HAS_DISSIMILAR_SPOUSES_WITH_SAME_MARRIAGE_YEAR,
    severity: "warning",
    personId: mob.anchorId,
    personName: getPersonName(mob.getPerson()),
    message:
      "Two of this person's spouses share a marriage year but have dissimilar names — suggests two different spouses were merged under one identity.",
  };
}


function checkRelativesHasDeathBeforeChildBirth365_2(
  relativeMobs: Mob[],
): PersonWarning[] {
  const out: PersonWarning[] = [];
  for (const rel of relativeMobs) {
    if (!hasDeathBeforeChildBirthLike(rel, 365 * 2)) continue;
    out.push({
      scoreType: COHERENCE,
      issueType: RELATIVES_HAS_DEATH_BEFORE_CHILD_BIRTH_365_2,
      severity: "warning",
      personId: rel.anchorId,
      personName: getPersonName(rel.getPerson()),
      message:
        "This person's death-like fact is dated more than 2 years before a child's earliest birth-like fact.",
    });
  }
  return out;
}

function checkRelativesHasDeathBeforeChildBirth30_10(
  relativeMobs: Mob[],
): PersonWarning[] {
  const out: PersonWarning[] = [];
  for (const rel of relativeMobs) {
    if (!hasDeathBeforeChildBirth(rel, 30 * 10)) continue;
    out.push({
      scoreType: COHERENCE,
      issueType: RELATIVES_HAS_DEATH_BEFORE_CHILD_BIRTH_30_10,
      severity: "warning",
      personId: rel.anchorId,
      personName: getPersonName(rel.getPerson()),
      message:
        "This person's exact Death day is more than 300 days before a child's exact Birth day.",
    });
  }
  return out;
}

function checkRelativesEarliestChildMarriageToBirth30(
  mob: Mob,
  relativeMobs: Mob[],
): PersonWarning | null {
  if (!relativeMobs.some((r) => earliestChildMarriageToBirth(r, 30))) {
    return null;
  }
  return {
    scoreType: COHERENCE,
    issueType: RELATIVES_EARLIEST_CHILD_MARRIAGE_TO_BIRTH_30,
    severity: "warning",
    personId: mob.anchorId,
    personName: getPersonName(mob.getPerson()),
    message:
      "A relative of this person had a child marry before the relative reached age 30, implying very young parenthood.",
  };
}

function checkFemaleRelativesHasDeathBeforeChildBirth365(
  mob: Mob,
  relativeMobs: Mob[],
): PersonWarning | null {
  const females = relativeMobs.filter((r) => r.getGender() === "Female");
  if (!females.some((r) => hasDeathBeforeChildBirthLike(r, 365))) return null;
  return {
    scoreType: COHERENCE,
    issueType: FEMALE_RELATIVES_HAS_DEATH_BEFORE_CHILD_BIRTH_365,
    severity: "warning",
    personId: mob.anchorId,
    personName: getPersonName(mob.getPerson()),
    message:
      "A female relative of this person has a death-like fact more than 1 year before a child's earliest birth-like fact.",
  };
}

function checkFemaleRelativesHasDeathBeforeChildBirth2(
  mob: Mob,
  relativeMobs: Mob[],
): PersonWarning | null {
  const females = relativeMobs.filter((r) => r.getGender() === "Female");
  if (!females.some((r) => hasDeathBeforeChildBirth(r, 2))) return null;
  return {
    scoreType: COHERENCE,
    issueType: FEMALE_RELATIVES_HAS_DEATH_BEFORE_CHILD_BIRTH_2,
    severity: "warning",
    personId: mob.anchorId,
    personName: getPersonName(mob.getPerson()),
    message:
      "A female relative of this person has an exact Death day more than 2 days before a child's exact Birth day, which is biologically impossible.",
  };
}

function checkRelativesLatestChildBirthToMarriage35(
  mob: Mob,
  relativeMobs: Mob[],
): PersonWarning | null {
  if (!relativeMobs.some((r) => latestChildBirthToMarriage(r, 35))) return null;
  return {
    scoreType: COHERENCE,
    issueType: RELATIVES_LATEST_CHILD_BIRTH_TO_MARRIAGE_35,
    severity: "warning",
    personId: mob.anchorId,
    personName: getPersonName(mob.getPerson()),
    message:
      "A relative of this person had a child born 35+ years after their latest marriage, suggesting a record error.",
  };
}

function checkRelativesLatestChildBirthToBirth80(
  mob: Mob,
  relativeMobs: Mob[],
): PersonWarning | null {
  if (!relativeMobs.some((r) => latestChildBirthToBirth(r, 80))) return null;
  return {
    scoreType: COHERENCE,
    issueType: RELATIVES_LATEST_CHILD_BIRTH_TO_BIRTH_80,
    severity: "warning",
    personId: mob.anchorId,
    personName: getPersonName(mob.getPerson()),
    message:
      "A relative of this person had a child born 80+ years after their own birth, which is biologically implausible.",
  };
}

function checkRelativesChildMarriageToMarriage15(
  mob: Mob,
  relativeMobs: Mob[],
): PersonWarning | null {
  if (!relativeMobs.some((r) => childMarriageToMarriage(r, 15))) return null;
  return {
    scoreType: COHERENCE,
    issueType: RELATIVES_CHILD_MARRIAGE_TO_MARRIAGE_15,
    severity: "warning",
    personId: mob.anchorId,
    personName: getPersonName(mob.getPerson()),
    message:
      "A relative of this person has a child who married within 15 years of the relative's earliest marriage.",
  };
}

function checkRelativesHasDeathAfterChildBirth90(
  mob: Mob,
  relativeMobs: Mob[],
): PersonWarning | null {
  if (
    !relativeMobs.some((r) =>
      hasDeathMoreThanNYearsAfterEarliestChildBirth(r, 90),
    )
  ) {
    return null;
  }
  return {
    scoreType: COHERENCE,
    issueType: RELATIVES_HAS_DEATH_AFTER_CHILD_BIRTH_90,
    severity: "warning",
    personId: mob.anchorId,
    personName: getPersonName(mob.getPerson()),
    message:
      "A relative of this person died more than 90 years after their earliest child's birth, which is implausible.",
  };
}

function checkRelativesHasAgeRangeGreaterThan120(
  mob: Mob,
  relativeMobs: Mob[],
): PersonWarning | null {
  if (!relativeMobs.some((r) => hasAgeRangeGreaterThan(r, 120))) return null;
  return {
    scoreType: COHERENCE,
    issueType: RELATIVES_HAS_AGE_RANGE_GREATER_THAN_120,
    severity: "warning",
    personId: mob.anchorId,
    personName: getPersonName(mob.getPerson()),
    message:
      "A relative of this person has a lifespan greater than 120 years, which is implausible.",
  };
}

function checkRelativesHasChildDeathAfterParentBirth200(
  mob: Mob,
  relativeMobs: Mob[],
): PersonWarning | null {
  if (
    !relativeMobs.some((r) =>
      hasDeathMoreThanNYearsAfterEarliestParentBirth(r, 200),
    )
  ) {
    return null;
  }
  return {
    scoreType: COHERENCE,
    issueType: RELATIVES_HAS_CHILD_DEATH_AFTER_PARENT_BIRTH_200,
    severity: "warning",
    personId: mob.anchorId,
    personName: getPersonName(mob.getPerson()),
    message:
      "A relative of this person died more than 200 years after their earliest parent's birth, which is implausible.",
  };
}

function checkMaleRelativesHasDiffSurname(
  mob: Mob,
  relativeMobs: Mob[],
): PersonWarning | null {
  const males = relativeMobs.filter((r) => r.getGender() === "Male");
  if (!males.some((r) => hasDiffSurname(r))) return null;
  return {
    scoreType: COHERENCE,
    issueType: MALE_RELATIVES_HAS_DIFF_SURNAME,
    severity: "warning",
    personId: mob.anchorId,
    personName: getPersonName(mob.getPerson()),
    message:
      "A male relative of this person has surnames that don't match each other, suggesting conflated identities.",
  };
}

// ─── Merge-mode predicates, checks, and the non-final bucket ─────────────────
// Ported from warnings.java's calculateNonFinalWarnings (:572) plus the
// target-vs-candidate-separate checks in calculateWarnings (:143/:159/:181/
// :237/:528). These run only when comparing two distinct mobs during a merge
// dry-run (merge_warnings). Single-anchor person_warnings passes
// target === candidate === merged, so the census/marriage-guarded checks
// self-suppress (a mob trivially shares its own census + marriage dates).
// See docs/specs/match-merge-workflow-spec.md §7.

// Merge-mode warning tags (match warnings.java string tags exactly).
const HAS_SAME_CENSUS = "hasSameCensus";
const HAS_EVENTS_OUTSIDE_LIFESPAN_FAR = "hasEventsOutsideLifespanFar";
const HAS_EVENTS_OUTSIDE_LIFESPAN_NEAR = "hasEventsOutsideLifespanNear";
const BIRTH_LIKE_RANGE_GREATER_THAN_8 = "birthLikeRangeGreaterThan8";
const BIRTH_RANGE_GREATER_THAN_3 = "birthRangeGreaterThan3";

/**
 * Java MobWarnings.birthRangeGreaterThan (warnings.java:780). True when the
 * span between the earliest and latest exact (full-DMY) Birth date exceeds
 * `years`. Java includes imperfect (year-only) births with a conservative
 * ±365 narrowing; we instead use **perfect Birth dates only** (≥2 required, as
 * Java requires ≥2 birth dates) — a documented divergence that keeps the check
 * conservative (no false positive from a year-only span) at the cost of not
 * firing on two imperfect births. Guarded by `!hasSameMarriageDate` at the call
 * site (warnings.java:528).
 */
export function birthRangeGreaterThan(mob: Mob, years: number): boolean {
  const days = perfectDaysOfSelfFacts(mob, BIRTH);
  if (days.length < 2) return false;
  return Math.max(...days) - Math.min(...days) > years * 365 + 5;
}

/**
 * Java MobWarnings.hasSameMarriageDate (warnings.java:832). True when the two
 * mobs share any marriage-like fact with the same standardized date. In this
 * simplified model marriage facts live on the person (`marriageLikeFacts`),
 * and `standard_date` is the analog of Java's `MDate.getFormal()`. Used only
 * as a guard: a shared marriage date means birth-range divergence between the
 * two records is expected (they are the same couple), so the birth-range
 * warnings are suppressed (warnings.java:181, :528). Like Java
 * (`getSelfEventDates(..., onlyPerfect=true)`), only **perfect** (full-DMY)
 * marriage dates count — a year-only shared marriage is not a match.
 */
export function hasSameMarriageDate(mob1: Mob, mob2: Mob): boolean {
  const dates1 = new Set<string>();
  for (const f of mob1.marriageLikeFacts()) {
    if (f.standard_date !== undefined && isPerfectStandardDate(f.standard_date)) {
      dates1.add(f.standard_date);
    }
  }
  if (dates1.size === 0) return false;
  for (const f of mob2.marriageLikeFacts()) {
    if (
      f.standard_date !== undefined &&
      isPerfectStandardDate(f.standard_date) &&
      dates1.has(f.standard_date)
    ) {
      return true;
    }
  }
  return false;
}

// One year of slop for the "generous" (imperfect-date) interpretation of the
// lifespan window — mirrors the ±365 convention warnings.java uses for
// imperfect dates elsewhere.
const LIFESPAN_FUDGE_DAYS = 365;
const BIRTH_DEATH_FACT_TYPES: ReadonlySet<string> = new Set([
  ...BIRTHLIKE_FACT_TYPES,
  ...DEATHLIKE_FACT_TYPES,
]);

/**
 * A2 — defined in docs/plan/match-merge-workflow-plan.md (M2/A2), NOT ported
 * (we lack the FS `EventsOutsideLifespan` source). Returns the worst severity
 * of any non-birth/death event of one mob falling outside the OTHER mob's
 * [earliest-birth, latest-death] window, checked in both directions:
 *
 *   - "far":  outside even under the generous (range + ±365 fudge)
 *             interpretation — a temporal impossibility (spec §10 → error).
 *   - "near": outside only under the strict (exact-point) interpretation —
 *             improbable but possibly a date-precision artifact (§10 → warning).
 *   - "none": inside under the strict interpretation, or no testable data.
 *
 * Catches the self-consistent-but-different-person case the merged-mob
 * after-death / before-birth checks miss: the union of two birth/death sets
 * widens the merged lifespan and heals the contradiction, so it must be
 * checked pre-merge, mob against mob. An open bound (missing birth or death)
 * cannot flag on that side.
 */
export function hasEventsOutsideLifespan(
  target: Mob,
  candidate: Mob,
): "none" | "near" | "far" {
  // This is a two-mob, pre-merge comparison by construction. In single-anchor
  // final mode personWarningsTool passes the same Mob as target and candidate;
  // there is no second record to compare against, and self-inconsistency (an
  // event past the person's own death, etc.) is already covered by
  // hasEventAfterDeath / hasEventBeforeBirth. Short-circuit so single-anchor
  // person_warnings output is unchanged. (Documented divergence from
  // warnings.java, which would run it on the same mob — this helper is defined,
  // not ported; see plan M2/A2.)
  if (target === candidate) return "none";
  let worst: "none" | "near" | "far" = "none";
  for (const [eventsMob, windowMob] of [
    [target, candidate],
    [candidate, target],
  ] as const) {
    const sev = eventsOutsideOneWindow(eventsMob, windowMob);
    if (sev === "far") return "far";
    if (sev === "near") worst = "near";
  }
  return worst;
}

function eventsOutsideOneWindow(
  eventsMob: Mob,
  windowMob: Mob,
): "none" | "near" | "far" {
  const win = windowMob.getPerson();
  const ev = eventsMob.getPerson();

  // Non-birth/death dated events of the events-mob, under both interpretations.
  const evGen = getPersonEventDayRanges(
    ev,
    null,
    BIRTH_DEATH_FACT_TYPES,
    false,
    LIFESPAN_FUDGE_DAYS,
  );
  if (evGen.length === 0) return "none";
  const evStrict = getPersonEventDayRanges(ev, null, BIRTH_DEATH_FACT_TYPES, true, 0);

  // Window bounds: earliest birth-like / latest death-like of the window-mob.
  const loGen = getEarliest(
    getPersonEventDayRanges(win, BIRTHLIKE_FACT_TYPES, null, false, LIFESPAN_FUDGE_DAYS),
  );
  const hiGen = getLatest(
    getPersonEventDayRanges(win, DEATHLIKE_FACT_TYPES, null, false, LIFESPAN_FUDGE_DAYS),
  );
  const loStrict = getEarliest(
    getPersonEventDayRanges(win, BIRTHLIKE_FACT_TYPES, null, true, 0),
  );
  const hiStrict = getLatest(
    getPersonEventDayRanges(win, DEATHLIKE_FACT_TYPES, null, true, 0),
  );

  // FAR — outside even generously: the event's most-favorable day is still
  // beyond the window's most-forgiving bound.
  const evGenMin = getEarliest(evGen);
  const evGenMax = getLatest(evGen);
  if (
    (loGen !== null && evGenMax !== null && evGenMax < loGen) ||
    (hiGen !== null && evGenMin !== null && evGenMin > hiGen)
  ) {
    return "far";
  }

  // NEAR — outside only strictly (exact event points vs the tight window).
  const evStrictMin = getEarliest(evStrict);
  const evStrictMax = getLatest(evStrict);
  if (
    (loStrict !== null && evStrictMax !== null && evStrictMax < loStrict) ||
    (hiStrict !== null && evStrictMin !== null && evStrictMin > hiStrict)
  ) {
    return "near";
  }
  return "none";
}

/**
 * Census collection titles associated with a mob's anchor person. Titles live
 * in the top-level `SimplifiedGedcomX.sources[].title`, reached via the
 * ref→id join from the anchor's person/fact/name source references. When the
 * anchor carries no source references (e.g. a single-record candidate
 * document), we fall back to all of the document's source titles. Returns only
 * census-ish titles (containing "Census"). Empty when there are no sources.
 */
function getCensusTitles(mob: Mob): string[] {
  const sources = mob.tree.sources ?? [];
  if (sources.length === 0) return [];
  const person = mob.getPerson();
  const refIds = new Set<string>();
  for (const r of person.sources ?? []) {
    if (r.ref !== undefined) refIds.add(r.ref);
  }
  for (const f of person.facts ?? []) {
    for (const r of f.sources ?? []) if (r.ref !== undefined) refIds.add(r.ref);
  }
  for (const n of person.names ?? []) {
    for (const r of n.sources ?? []) if (r.ref !== undefined) refIds.add(r.ref);
  }

  const pickAll = refIds.size === 0;
  const titles: string[] = [];
  for (const s of sources) {
    if (s.title === undefined) continue;
    if (pickAll || (s.id !== undefined && refIds.has(s.id))) titles.push(s.title);
  }
  return titles.filter((t) => t.includes("Census"));
}

/**
 * Java MobWarnings.hasSameCensus (warnings.java:724). Two personas that share
 * the exact same census collection title cannot be the same person — a census
 * enumerates each person once, so the same census appearing on both sides of
 * a merge means the pairing conflated two distinct enumerated individuals. The
 * strongest census bad-merge signal.
 *
 * Documented divergences from Java: (1) Java concatenates titles into one
 * string split on `MobMergeUtil.TITLE_DELIMITER`; our simplified model stores
 * one title per source, so we compare title arrays directly (no delimiter
 * split). (2) Non-English census titles are not handled (warnings.java TODOs
 * this too) — v1 keys on the English "Census" substring. Degrades to false
 * (no warning, never throws) when either side lacks a usable title.
 */
export function hasSameCensus(target: Mob, candidate: Mob): boolean {
  const targetTitles = getCensusTitles(target);
  const candidateTitles = getCensusTitles(candidate);
  if (targetTitles.length === 0 || candidateTitles.length === 0) return false;
  for (const a of targetTitles) {
    for (const b of candidateTitles) if (a === b) return true;
  }
  return false;
}

// ─── Merge-mode check wrappers ───────────────────────────────────────────────

function checkHasSameCensus(target: Mob, candidate: Mob): PersonWarning | null {
  if (!hasSameCensus(target, candidate)) return null;
  return {
    scoreType: COHERENCE,
    issueType: HAS_SAME_CENSUS,
    severity: "error",
    personId: target.anchorId,
    personName: getPersonName(target.getPerson()),
    relatedPersonId: candidate.anchorId,
    mobRole: "candidate",
    message:
      "Both records being merged cite the same census collection. A census enumerates each person once, so they are almost certainly two different people — revisit the match.",
  };
}

function checkHasEventsOutsideLifespanFar(
  target: Mob,
  candidate: Mob,
  merged: Mob,
): PersonWarning | null {
  if (hasEventsOutsideLifespan(target, candidate) !== "far") return null;
  return {
    scoreType: COHERENCE,
    issueType: HAS_EVENTS_OUTSIDE_LIFESPAN_FAR,
    severity: "error",
    personId: merged.anchorId,
    personName: getPersonName(merged.getPerson()),
    message:
      "Merging these records places an event far outside the other record's lifespan (before its birth or after its death) — a temporal impossibility.",
  };
}

function checkHasEventsOutsideLifespanNear(
  target: Mob,
  candidate: Mob,
  merged: Mob,
): PersonWarning | null {
  if (hasEventsOutsideLifespan(target, candidate) !== "near") return null;
  return {
    scoreType: COHERENCE,
    issueType: HAS_EVENTS_OUTSIDE_LIFESPAN_NEAR,
    severity: "warning",
    personId: merged.anchorId,
    personName: getPersonName(merged.getPerson()),
    message:
      "Merging these records places an event slightly outside the other record's lifespan; this may be a date-precision artifact but is worth checking.",
  };
}

function checkBirthLikeRangeGreaterThan8(
  target: Mob,
  candidate: Mob,
  merged: Mob,
): PersonWarning | null {
  // This flags birth-range DIVERGENCE BETWEEN TWO RECORDS being merged. In
  // single-anchor mode (target === candidate) there is no second record, and
  // the !hasSameMarriageDate guard would NOT suppress a no-marriage person — so
  // short-circuit to keep single-anchor person_warnings output unchanged
  // (same pattern as hasEventsOutsideLifespan; documented divergence from
  // warnings.java, which runs it on the same mob).
  if (target === candidate) return null;
  if (!birthLikeRangeGreaterThan(merged, 8)) return null;
  if (hasSameMarriageDate(target, candidate)) return null;
  return {
    scoreType: COHERENCE,
    issueType: BIRTH_LIKE_RANGE_GREATER_THAN_8,
    severity: "warning",
    personId: merged.anchorId,
    personName: getPersonName(merged.getPerson()),
    message:
      "The merged record's birth-like facts span more than 8 years, with no shared marriage date to corroborate the match — the two records may be different people.",
  };
}

function checkBirthRangeGreaterThan3(
  target: Mob,
  candidate: Mob,
  merged: Mob,
): PersonWarning | null {
  // Two-record divergence check — silent in single-anchor mode (see
  // checkBirthLikeRangeGreaterThan8 for the rationale).
  if (target === candidate) return null;
  if (!birthRangeGreaterThan(merged, 3)) return null;
  if (hasSameMarriageDate(target, candidate)) return null;
  return {
    scoreType: COHERENCE,
    issueType: BIRTH_RANGE_GREATER_THAN_3,
    severity: "warning",
    personId: merged.anchorId,
    personName: getPersonName(merged.getPerson()),
    message:
      "The merged record's Birth facts span more than 3 years, with no shared marriage date to corroborate the match — the two records may be different people.",
  };
}

function checkMissingFactsAndRelativesEither(
  target: Mob,
  candidate: Mob,
  merged: Mob,
): PersonWarning | null {
  // Single-anchor mode (target === candidate): defer to the original single-mob
  // check + wording — there is no "merge" to frame the message around.
  if (target === candidate) return checkMissingFactsAndRelatives(merged);
  if (
    !missingFactsAndRelatives(target) &&
    !missingFactsAndRelatives(candidate)
  ) {
    return null;
  }
  return {
    scoreType: COHERENCE,
    issueType: MISSING_FACTS_AND_RELATIVES,
    severity: "warning",
    personId: merged.anchorId,
    personName: getPersonName(merged.getPerson()),
    message:
      "One side of this merge has no facts (other than GenderChange) and no relatives — likely an unfinished stub record.",
  };
}

/**
 * Merge-only checks — warnings.java `calculateNonFinalWarnings` (:572). Run
 * only when `!isFinalWarnings` (i.e. during a merge dry-run). `hasSameCensus`
 * first (the strongest census bad-merge signal); then the 13 checks
 * warnings.java gates on `!isFinalWarnings`, in source order. Each reuses the
 * existing self / relative check wrapper, anchored on the merged survivor and
 * its relatives.
 */
function calculateNonFinalWarnings(
  target: Mob,
  candidate: Mob,
  merged: Mob,
  relativeMobs: Mob[],
): PersonWarning[] {
  const warnings: PersonWarning[] = [];

  const sameCensus = checkHasSameCensus(target, candidate);
  if (sameCensus) warnings.push(sameCensus);

  const missingSurnamesW = checkMissingSurnames(merged);
  if (missingSurnamesW) warnings.push(missingSurnamesW);

  const missingGivenW = checkMissingGivenNamesWithoutExactBirthLikeDate(merged);
  if (missingGivenW) warnings.push(missingGivenW);

  const relBirthLikeRange = checkRelativesBirthLikeRangeGreaterThan8(
    merged,
    relativeMobs,
  );
  if (relBirthLikeRange) warnings.push(relBirthLikeRange);

  const relChildRange = checkRelativesChildBirthRange40(merged, relativeMobs);
  if (relChildRange) warnings.push(relChildRange);

  const relEarlyMarriage = checkRelativesHasEarlyMarriage14(merged, relativeMobs);
  if (relEarlyMarriage) warnings.push(relEarlyMarriage);

  const relTooManyBirth = checkRelativesTooManyBirthDates2(merged, relativeMobs);
  if (relTooManyBirth) warnings.push(relTooManyBirth);

  const relTooManyDeath = checkRelativesTooManyDeathDates2(merged, relativeMobs);
  if (relTooManyDeath) warnings.push(relTooManyDeath);

  const relBurialAfterDeath = checkRelativesHasBurialAfterDeath31(
    merged,
    relativeMobs,
  );
  if (relBurialAfterDeath) warnings.push(relBurialAfterDeath);

  const relLateMarriage = checkRelativesHasLateMarriage90(merged, relativeMobs);
  if (relLateMarriage) warnings.push(relLateMarriage);

  const relEventBeforeBirth = checkRelativesHasEventBeforeBirth365_2(
    merged,
    relativeMobs,
  );
  if (relEventBeforeBirth) warnings.push(relEventBeforeBirth);

  const relEventAfterDeath = checkRelativesHasEventAfterDeath1(
    merged,
    relativeMobs,
  );
  if (relEventAfterDeath) warnings.push(relEventAfterDeath);

  const relBurialBeforeDeath = checkRelativesHasBurialBeforeDeath(
    merged,
    relativeMobs,
  );
  if (relBurialBeforeDeath) warnings.push(relBurialBeforeDeath);

  const closeChristenings = checkHasCloseChildChristenings6_30(merged);
  if (closeChristenings) warnings.push(closeChristenings);

  return warnings;
}

// ─── Orchestrator — calculateWarnings(target, candidate, merged, isFinal) ────
// Faithful port of Java's calculateWarnings(targetMob, candidateMob,
// mergedMob, isFinalWarnings, warningSaver, returnOnAnyWarning)
// (warnings.java:129):
//   - Takes target, candidate, and merged mobs. Single-anchor callers pass the
//     same Mob three times with isFinalWarnings=true (warnings.java:118), which
//     is what personWarningsTool below does; the merge-mode merge_warnings tool
//     passes the three distinct mobs with isFinalWarnings=false.
//   - When !isFinalWarnings it additionally runs calculateNonFinalWarnings
//     (the merge-only bucket above), exactly as warnings.java:136.
//   - `returnOnAnyWarning` is dropped: we always run every check and return
//     every warning, no early-exit optimization.
// The merge-mode entry point that builds target/candidate/merged from a
// SimplifiedGedcomX pair-set lives in the merge_warnings tool
// (src/tools/merge-warnings.ts), built on the pure mergeGedcomx.

export function calculateWarnings(
  targetMob: Mob,
  candidateMob: Mob,
  mergedMob: Mob,
  isFinalWarnings: boolean,
): PersonWarning[] {
  const warnings: PersonWarning[] = [];

  // Relative-mob list is built once from the survivor and threaded through the
  // relative checks (warnings.java:130). Needed by both the merge-only bucket
  // and the always-run relative checks below.
  const relativeMobs = getRelativeMobs(mergedMob);

  // Merge-only checks — gated on !isFinalWarnings, exactly as warnings.java:136
  // gates calculateNonFinalWarnings. Single-anchor person_warnings passes
  // isFinalWarnings=true, so these never fire there.
  if (!isFinalWarnings) {
    warnings.push(
      ...calculateNonFinalWarnings(
        targetMob,
        candidateMob,
        mergedMob,
        relativeMobs,
      ),
    );
  }

  // Always-run checks that compare target vs candidate separately
  // (warnings.java:143/:159/:181/:237/:528). In single-anchor mode
  // target === candidate === merged, so the marriage-guarded birth-range
  // checks self-suppress and the lifespan/missing-facts checks reduce to the
  // single-mob form.
  const missingEither = checkMissingFactsAndRelativesEither(
    targetMob,
    candidateMob,
    mergedMob,
  );
  if (missingEither) warnings.push(missingEither);

  const lifespanFar = checkHasEventsOutsideLifespanFar(
    targetMob,
    candidateMob,
    mergedMob,
  );
  if (lifespanFar) warnings.push(lifespanFar);

  const lifespanNear = checkHasEventsOutsideLifespanNear(
    targetMob,
    candidateMob,
    mergedMob,
  );
  if (lifespanNear) warnings.push(lifespanNear);

  const birthLikeRange8 = checkBirthLikeRangeGreaterThan8(
    targetMob,
    candidateMob,
    mergedMob,
  );
  if (birthLikeRange8) warnings.push(birthLikeRange8);

  const birthRange3 = checkBirthRangeGreaterThan3(
    targetMob,
    candidateMob,
    mergedMob,
  );
  if (birthRange3) warnings.push(birthRange3);

  // Final-warnings checks (audit Parts 1 + 2) — always run, in either mode.
  const w1 = checkHasEventBeforeBirth(mergedMob);
  if (w1) warnings.push(w1);

  const w2 = checkEarliestChildBirthToBirthMale14(mergedMob);
  if (w2) warnings.push(w2);

  const w3 = checkHasEventAfterDeath(mergedMob);
  if (w3) warnings.push(w3);

  const lifespan = checkHasAgeRangeGreaterThan120(mergedMob);
  if (lifespan) warnings.push(lifespan);

  const burial = checkHasBurialAfterDeath31(mergedMob);
  if (burial) warnings.push(burial);

  const youngParent12 = checkEarliestChildBirthToBirth12(mergedMob);
  if (youngParent12) warnings.push(youngParent12);

  const deathRange = checkDeathRangeGreaterThan2(mergedMob);
  if (deathRange) warnings.push(deathRange);

  const lateMarriage = checkHasLateMarriage90(mergedMob);
  if (lateMarriage) warnings.push(lateMarriage);

  const earlyMarriage = checkHasEarlyMarriage14(mergedMob);
  if (earlyMarriage) warnings.push(earlyMarriage);

  const lateChild = checkLatestChildBirthToBirth80(mergedMob);
  if (lateChild) warnings.push(lateChild);

  const manyChildren = checkTooManyChildren18(mergedMob);
  if (manyChildren) warnings.push(manyChildren);

  const manyFathers = checkTooManyFathers2(mergedMob);
  if (manyFathers) warnings.push(manyFathers);

  const manyMothers = checkTooManyMothers2(mergedMob);
  if (manyMothers) warnings.push(manyMothers);

  const blankName = checkHasBlankName(mergedMob);
  if (blankName) warnings.push(blankName);

  const female55 = checkLatestChildBirthToBirthFemale55(mergedMob);
  if (female55) warnings.push(female55);

  const deathAfterChild = checkHasDeathAfterChildBirth90(mergedMob);
  if (deathAfterChild) warnings.push(deathAfterChild);

  const deathAfterParent = checkHasChildDeathAfterParentBirth200(mergedMob);
  if (deathAfterParent) warnings.push(deathAfterParent);

  const childRange = checkChildBirthRange40(mergedMob);
  if (childRange) warnings.push(childRange);

  const earlyChildMarriage = checkEarliestChildMarriageToBirth30(mergedMob);
  if (earlyChildMarriage) warnings.push(earlyChildMarriage);

  const lateChildBirth = checkLatestChildBirthToMarriage35(mergedMob);
  if (lateChildBirth) warnings.push(lateChildBirth);

  const youngSpouse = checkHasYoungSpouse15(mergedMob);
  if (youngSpouse) warnings.push(youngSpouse);

  const christeningBeforeBirth = checkHasChristeningBeforeBirth(mergedMob);
  if (christeningBeforeBirth) warnings.push(christeningBeforeBirth);

  const eventBeforeChristening = checkHasEventBeforeChristening365_3(mergedMob);
  if (eventBeforeChristening) warnings.push(eventBeforeChristening);

  const manyBirthDates = checkTooManyBirthDates2(mergedMob);
  if (manyBirthDates) warnings.push(manyBirthDates);

  const manyDeathDates = checkTooManyDeathDates2(mergedMob);
  if (manyDeathDates) warnings.push(manyDeathDates);

  const burialBeforeDeath = checkHasBurialBeforeDeath(mergedMob);
  if (burialBeforeDeath) warnings.push(burialBeforeDeath);

  const m30_10 = checkHasDeathBeforeChildBirth30_10(mergedMob);
  if (m30_10) warnings.push(m30_10);

  const m365_2 = checkHasDeathBeforeChildBirth365_2(mergedMob);
  if (m365_2) warnings.push(m365_2);

  const f2 = checkHasDeathBeforeChildBirthFemale2(mergedMob);
  if (f2) warnings.push(f2);

  const f365 = checkHasDeathBeforeChildBirthFemale365(mergedMob);
  if (f365) warnings.push(f365);

  const childMarriage15 = checkChildMarriageToMarriage15(mergedMob);
  if (childMarriage15) warnings.push(childMarriage15);

  const diffSurnameMale = checkHasDiffSurnameMale(mergedMob);
  if (diffSurnameMale) warnings.push(diffSurnameMale);

  // ─── Relative-mob checks (warnings.java:188-556) ────────────────────────
  // relativeMobs is built once at the top of this function and threaded
  // through; the helpers internally re-derive male/female sub-lists where
  // Java does.
  const relDeathRange = checkRelativesDeathRangeGreaterThan2(mergedMob, relativeMobs);
  if (relDeathRange) warnings.push(relDeathRange);

  warnings.push(...checkRelativesEarliestChildBirthToBirth12(relativeMobs));

  const relEventBeforeChristening = checkRelativesHasEventBeforeChristening365_3(
    mergedMob,
    relativeMobs,
  );
  if (relEventBeforeChristening) warnings.push(relEventBeforeChristening);

  const maleRelChild14 = checkMaleRelativesEarliestChildBirthToBirth14(
    mergedMob,
    relativeMobs,
  );
  if (maleRelChild14) warnings.push(maleRelChild14);

  const femRelChild55 = checkFemaleRelativesLatestChildBirthToBirth55(
    mergedMob,
    relativeMobs,
  );
  if (femRelChild55) warnings.push(femRelChild55);

  warnings.push(...checkRelativesHasDeathBeforeChildBirth365_2(relativeMobs));
  warnings.push(...checkRelativesHasDeathBeforeChildBirth30_10(relativeMobs));

  const relEarlyChildMarriage = checkRelativesEarliestChildMarriageToBirth30(
    mergedMob,
    relativeMobs,
  );
  if (relEarlyChildMarriage) warnings.push(relEarlyChildMarriage);

  const femRelDeathChild365 = checkFemaleRelativesHasDeathBeforeChildBirth365(
    mergedMob,
    relativeMobs,
  );
  if (femRelDeathChild365) warnings.push(femRelDeathChild365);

  const femRelDeathChild2 = checkFemaleRelativesHasDeathBeforeChildBirth2(
    mergedMob,
    relativeMobs,
  );
  if (femRelDeathChild2) warnings.push(femRelDeathChild2);

  const relLateChildMarriage = checkRelativesLatestChildBirthToMarriage35(
    mergedMob,
    relativeMobs,
  );
  if (relLateChildMarriage) warnings.push(relLateChildMarriage);

  const relLateChildBirth = checkRelativesLatestChildBirthToBirth80(
    mergedMob,
    relativeMobs,
  );
  if (relLateChildBirth) warnings.push(relLateChildBirth);

  const relChildMarriage = checkRelativesChildMarriageToMarriage15(
    mergedMob,
    relativeMobs,
  );
  if (relChildMarriage) warnings.push(relChildMarriage);

  const relDeathAfterChild = checkRelativesHasDeathAfterChildBirth90(
    mergedMob,
    relativeMobs,
  );
  if (relDeathAfterChild) warnings.push(relDeathAfterChild);

  const relAge120 = checkRelativesHasAgeRangeGreaterThan120(
    mergedMob,
    relativeMobs,
  );
  if (relAge120) warnings.push(relAge120);

  const relChildDeath200 = checkRelativesHasChildDeathAfterParentBirth200(
    mergedMob,
    relativeMobs,
  );
  if (relChildDeath200) warnings.push(relChildDeath200);

  const maleRelDiffSurname = checkMaleRelativesHasDiffSurname(
    mergedMob,
    relativeMobs,
  );
  if (maleRelDiffSurname) warnings.push(maleRelDiffSurname);

  // Tier A (date-sequence on relatives) and Tier B (missingSurnames,
  // missingGivenNamesWithoutExactBirthLikeDate, relativesTooMany*,
  // relativesBirthLikeRangeGreaterThan8, relativesChildBirthRange40) are
  // merge-only — warnings.java gates them on !isFinalWarnings, so they now
  // live in calculateNonFinalWarnings above and no longer run in final mode.

  // Tier C — similar-child / similar-spouse duplicate detection.
  const simChildren = checkSimilarChildren(mergedMob);
  if (simChildren) warnings.push(simChildren);

  const simChildrenConflict = checkSimilarChildrenConflictingDates(mergedMob);
  if (simChildrenConflict) warnings.push(simChildrenConflict);

  const simSpouses = checkSimilarSpouses(mergedMob);
  if (simSpouses) warnings.push(simSpouses);

  const simSpousesConflict = checkSimilarSpousesConflictingDates(mergedMob);
  if (simSpousesConflict) warnings.push(simSpousesConflict);

  // Tier C — close child events.
  const closeBirths = checkHasCloseChildBirthsIgnoreSimilarChildren(mergedMob);
  if (closeBirths) warnings.push(closeBirths);

  // hasCloseChildChristenings6_30 is merge-only (warnings.java:675) — moved to
  // calculateNonFinalWarnings.

  // Tier D — dissimilar spouses same marriage year.
  const dissimilarSpouses = checkHasDissimilarSpousesWithSameMarriageYear(mergedMob);
  if (dissimilarSpouses) warnings.push(dissimilarSpouses);

  return warnings;
}

// ─── MCP tool entry point ───────────────────────────────────────────────────
// Single-person mode: read tree.gedcomx.json, build a Mob anchored on the
// requested person, then call calculateWarnings with `isFinalWarnings=true`.

export async function personWarningsTool(
  input: PersonWarningsInput,
): Promise<PersonWarningsResult> {
  if (!input?.projectPath || typeof input.projectPath !== "string") {
    throw new Error("projectPath is required");
  }
  if (!input.personId || typeof input.personId !== "string") {
    throw new Error("personId is required");
  }

  const { tree, anchor } = await loadAnchor(input.projectPath, input.personId);
  if (!anchor.id) {
    throw new Error(`Person '${input.personId}' has no id field.`);
  }

  // Single-anchor / final mode: target === candidate === merged, isFinal=true
  // (warnings.java:118 getWarnings(mob, mob, mob, true)). The merge-only bucket
  // and the marriage-guarded checks self-suppress in this configuration.
  const mob = new Mob(tree, anchor.id);
  const warnings = calculateWarnings(mob, mob, mob, /* isFinalWarnings */ true);
  return { warningCount: warnings.length, warnings };
}

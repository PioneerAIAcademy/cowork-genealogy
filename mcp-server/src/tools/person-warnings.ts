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
  latestDayOfSelfFacts,
  latestYearOfChildFacts,
  latestYearOfPersonFacts,
  latestYearOfSelfFacts,
  perfectDaysOfSelfFacts,
} from "../utils/fact-helpers.js";
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
 * Java MobWarnings.hasBurialBeforeDeath (warnings.java:935).
 *
 * Returns true when both Burial and Death have at least one perfect-DMY
 * date AND the earliest perfect Death day is greater than the latest
 * perfect Burial day — i.e. every recorded burial precedes every recorded
 * death. Tag: `hasBurialBeforeDeath`. Direct port of Java's hasPriorDate
 * with dates1 = BURIAL and dates2 = DEATH.
 */
export function hasBurialBeforeDeath(mob: Mob): boolean {
  const burialDays = perfectDaysOfSelfFacts(mob, BURIAL);
  const deathDays = perfectDaysOfSelfFacts(mob, DEATH);
  if (burialDays.length === 0 || deathDays.length === 0) return false;
  const earliestDeath = Math.min(...deathDays);
  const latestBurial = Math.max(...burialDays);
  return earliestDeath > latestBurial;
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

// ─── Orchestrator — calculateWarnings(mergedMob, isFinalWarnings) ───────────
// Mirrors the structure of Java's calculateWarnings(targetMob, candidateMob,
// mergedMob, isFinalWarnings, warningSaver, returnOnAnyWarning), but adapted
// per the 2026-06-02 meeting:
//   - Operates on a `mergedMob` directly.
//   - The `isFinalWarnings` parameter defaults to `false` (merge-mode is the
//     typical case once the merge function lands). Single-person callers pass
//     `true` explicitly — that's what personWarningsTool below does.
//   - `returnOnAnyWarning` is gone: we always run every check, always return
//     every warning, no early-exit optimization.
//
// TODO: add the merge-mode entry point — the analog of Java's
//   getWarnings(targetMob, candidateMob, mergedMob, isFinalWarnings)
//   (warnings.java:111). It needs a "merge two SimplifiedGedcomX trees"
//   function (port of MobMergeUtil.combine) that doesn't exist yet; once it
//   lands, that orchestrator merges target+candidate, wraps the result in a
//   Mob, and calls calculateWarnings(mergedMob, isFinalWarnings).

export function calculateWarnings(
  mergedMob: Mob,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- merge-only checks not yet ported
  isFinalWarnings: boolean = false,
): PersonWarning[] {
  const warnings: PersonWarning[] = [];

  // Final-warnings checks (audit Parts 1 + 2) — always run, in either mode.
  // Three are ported so far; the other ~25 single-person checks will land
  // here in subsequent commits.
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

  const empty = checkMissingFactsAndRelatives(mergedMob);
  if (empty) warnings.push(empty);

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

  // Merge-only checks (audit Part 3) — placeholder. Java gates these on
  // `!isFinalWarnings`. Will be populated when those checks are ported.
  // if (!isFinalWarnings) { ...calculateNonFinalWarnings(mergedMob) }

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

  const mergedMob = new Mob(tree, anchor.id);
  const warnings = calculateWarnings(mergedMob, /* isFinalWarnings */ true);
  return { warningCount: warnings.length, warnings };
}

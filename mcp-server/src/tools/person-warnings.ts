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
  BIRTHLIKE_FACT_TYPES,
  BURIAL,
  DEATH,
  DEATHLIKE_FACT_TYPES,
  Mob,
} from "../utils/mob.js";
import {
  earliestYearOfChildFacts,
  earliestYearOfSelfFacts,
  factDaysDiffEarliestLatest,
  factDaysDiffLatestLatest,
  latestYearOfSelfFacts,
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

// ─── Orchestrator — calculateWarnings(mergedMob, is_final_warnings) ─────────
// Mirrors the structure of Java's calculateWarnings(targetMob, candidateMob,
// mergedMob, isFinalWarnings, warningSaver, returnOnAnyWarning), but adapted
// per the 2026-06-02 meeting:
//   - Operates on a `mergedMob` directly (the merge function that produces
//     it from a target+candidate is a separate component, written by Dallan).
//   - The `is_final_warnings` parameter defaults to `false` (merge-mode is
//     the typical case once the merge function lands). Single-person callers
//     pass `true` explicitly — that's what personWarningsTool below does.
//   - `returnOnAnyWarning` is gone: we always run every check, always return
//     every warning, no early-exit optimization.

export function calculateWarnings(
  mergedMob: Mob,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- merge-only checks not yet ported
  is_final_warnings: boolean = false,
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

  // Merge-only checks (audit Part 3) — placeholder. Java gates these on
  // `!isFinalWarnings`. Will be populated when those checks are ported.
  // if (!is_final_warnings) { ...calculateNonFinalWarnings(mergedMob) }

  return warnings;
}

// ─── MCP tool entry point ───────────────────────────────────────────────────
// Single-person mode: read tree.gedcomx.json, build a Mob anchored on the
// requested person, then call calculateWarnings with `is_final_warnings=true`.

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
  const warnings = calculateWarnings(mergedMob, /* is_final_warnings */ true);
  return { warningCount: warnings.length, warnings };
}

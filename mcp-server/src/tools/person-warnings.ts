// MCP tool: person_warnings
// See `docs/specs/person-warnings-tool-spec.md`.
//
// Reads tree.gedcomx.json from a project directory and runs deterministic
// data-quality checks from the point of view of a required anchor person.
// No network, no auth — operates entirely on local file data.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type {
  SimplifiedFact,
  SimplifiedGedcomX,
  SimplifiedPerson,
} from "../types/gedcomx.js";
import { stdDate } from "../utils/date-standardize.js";
import { earliestYear, isABeforeB, latestYear } from "../utils/date-helpers.js";
import { BIRTHLIKE_FACT_TYPES } from "../utils/mob.js";
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
const IMPOSSIBLE_EVENT_ORDER = "IMPOSSIBLE_EVENT_ORDER";
const YOUNG_BIRTH = "YOUNG_BIRTH";

// Fact-type families live in mcp-server/src/utils/mob.ts so they can be
// shared between the warning checks (this file) and the Mob adapter.

// Fact types that legitimately happen after death — excluded from W3.
// Note: this list is being retired as W3 is reworked to match Java's
// `hasEventAfterDeath`, which uses DEATHLIKE_FACT_TYPES as the death anchor
// instead of a hard-coded exclusion list. Kept for now until the W3 rework
// lands.
const POST_DEATH_FACT_TYPES = new Set([
  "Burial",
  "Cremation",
  "Obituary",
  "Probate",
  "Will",
  "Estate",
  "Funeral",
]);

// Father-too-young threshold (matches Java MobWarnings: earliestChildBirthToBirthMale14).
const FATHER_MIN_AGE = 14;

// Resolve a fact's canonical (GEDCOM-form) date string.
// Prefers the converter-emitted fact.standard_date sidecar (always present
// for facts read from FS via person_read). Falls back to stdDate(fact.date)
// when standard_date is missing — typical for LLM-authored stub facts in
// tree.gedcomx.json. Returns null when the fact has no date at all or the
// fallback standardization can't parse it.
function getStandardDate(fact: SimplifiedFact | undefined): string | null {
  if (!fact) return null;
  if (fact.standard_date) return fact.standard_date;
  if (!fact.date) return null;
  const std = stdDate(fact.date);
  return std || null;
}

// Wrappers around Dallan's date library. Take a fact (may be undefined),
// resolve its canonical date, and return the earliest/latest possible year
// — or null if the date is missing or unparseable.
export function earliestYearOf(fact: SimplifiedFact | undefined): number | null {
  const std = getStandardDate(fact);
  return std ? earliestYear(std) : null;
}

export function latestYearOf(fact: SimplifiedFact | undefined): number | null {
  const std = getStandardDate(fact);
  return std ? latestYear(std) : null;
}

// Day-level precision: is factA definitely before factB?
// Resolves both canonical dates, then uses day-precision range overlap.
// Returns null when either date is missing/unparseable, or when the
// day-level ranges overlap (cannot say which is earlier).
export function isBefore(
  factA: SimplifiedFact | undefined,
  factB: SimplifiedFact | undefined,
): boolean | null {
  const stdA = getStandardDate(factA);
  const stdB = getStandardDate(factB);
  if (!stdA || !stdB) return null;
  return isABeforeB(stdA, stdB);
}

// Pretty-print a fact type for messages: "Residence" → "residence".
function lower(s: string): string {
  return s ? s[0].toLowerCase() + s.slice(1) : s;
}

// W1: IMPOSSIBLE_EVENT_ORDER — anchor's Death is before anchor's Birth.
// Day-level precision: catches same-year cases like
// "born September 1845, died January 1845".
export function checkDeathBeforeBirth(
  anchor: SimplifiedPerson,
): PersonWarning | null {
  const facts = anchor.facts ?? [];
  const birthFact = facts.find((f) => f.type === "Birth");
  const deathFact = facts.find((f) => f.type === "Death");
  if (!birthFact || !deathFact) return null;

  if (isBefore(deathFact, birthFact) !== true) return null;

  return {
    scoreType: COHERENCE,
    issueType: IMPOSSIBLE_EVENT_ORDER,
    severity: "error",
    personId: anchor.id ?? "",
    personName: getPersonName(anchor),
    message: "The death happened before the birth.",
    factIds: [birthFact.id, deathFact.id].filter((id): id is string => !!id),
  };
}

// W2: YOUNG_BIRTH — male parent of the anchor (or anchor as male parent of a
// child) was at or under FATHER_MIN_AGE at the child's birth.
//
// Matches Java MobWarnings.earliestChildBirthToBirth(mob, 14) called from
// earliestChildBirthToBirthMale14 (warnings.java:222):
//   - Range bound: earliestChild − earliestSelf (the aggressive / earliest-
//     to-earliest bound). Java picks the EARLIEST possible birth year for
//     both the parent and the child. Different from the spec's "conservative"
//     principle; per the 2026-06-02 meeting, Java wins.
//   - Threshold: gap <= 14 fires (inclusive at 14).
//   - Fact family: BIRTHLIKE_FACT_TYPES on both sides (Baptism, Birth,
//     Christening, Adoption, BirthRegistration, etc.) — not just literal
//     "Birth" — so a child whose only birth-like fact is a Christening is
//     still evaluated.
export function checkFatherTooYoung(
  anchor: SimplifiedPerson,
  tree: SimplifiedGedcomX,
): PersonWarning[] {
  const out: PersonWarning[] = [];
  const persons = tree.persons ?? [];
  const relationships = tree.relationships ?? [];

  for (const rel of relationships) {
    if (rel.type !== "ParentChild") continue;
    if (rel.parent !== anchor.id && rel.child !== anchor.id) continue;

    const parent = persons.find((p) => p.id === rel.parent);
    const child = persons.find((p) => p.id === rel.child);
    if (!parent || !child) continue;
    if (parent.gender !== "Male") continue;

    const parentBirthFact = (parent.facts ?? []).find(
      (f) => f.type !== undefined && BIRTHLIKE_FACT_TYPES.has(f.type),
    );
    const childBirthFact = (child.facts ?? []).find(
      (f) => f.type !== undefined && BIRTHLIKE_FACT_TYPES.has(f.type),
    );
    if (!parentBirthFact || !childBirthFact) continue;

    const parentBirthYear = earliestYearOf(parentBirthFact);
    const childBirthYear = earliestYearOf(childBirthFact);
    if (parentBirthYear == null || childBirthYear == null) continue;

    const ageAtChildBirth = childBirthYear - parentBirthYear;
    if (ageAtChildBirth > FATHER_MIN_AGE) continue;

    const parentName = getPersonName(parent);
    out.push({
      scoreType: COHERENCE,
      issueType: YOUNG_BIRTH,
      severity: "warning",
      personId: child.id ?? "",
      personName: getPersonName(child),
      message: `If this person was born ${childBirthFact.date ?? "[unknown]"}, ${parentName} would have been ${ageAtChildBirth}, which is normally before child bearing years.`,
      factIds: [parentBirthFact.id, childBirthFact.id].filter(
        (id): id is string => !!id,
      ),
      relatedPersonId: parent.id,
    });
  }

  return out;
}

// W3: IMPOSSIBLE_EVENT_ORDER — anchor has a non-postmortem fact dated
// after their Death. Day-level precision: catches same-year cases like
// "died May 2026, residence November 2026".
export function checkEventAfterDeath(
  anchor: SimplifiedPerson,
): PersonWarning[] {
  const facts = anchor.facts ?? [];
  const deathFact = facts.find((f) => f.type === "Death");
  if (!deathFact) return [];

  const out: PersonWarning[] = [];
  for (const fact of facts) {
    if (fact === deathFact) continue;
    if (!fact.type) continue;
    if (fact.type === "Birth") continue; // covered by W1, avoid double-reporting
    if (POST_DEATH_FACT_TYPES.has(fact.type)) continue;

    if (isBefore(deathFact, fact) !== true) continue;

    out.push({
      scoreType: COHERENCE,
      issueType: IMPOSSIBLE_EVENT_ORDER,
      severity: "error",
      personId: anchor.id ?? "",
      personName: getPersonName(anchor),
      message: `The death happened before a ${lower(fact.type)}.`,
      factIds: [deathFact.id, fact.id].filter((id): id is string => !!id),
    });
  }

  return out;
}

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

  const warnings: PersonWarning[] = [];
  const w1 = checkDeathBeforeBirth(anchor);
  if (w1) warnings.push(w1);
  warnings.push(...checkFatherTooYoung(anchor, tree));
  warnings.push(...checkEventAfterDeath(anchor));

  return { warningCount: warnings.length, warnings };
}

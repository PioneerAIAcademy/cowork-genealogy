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
import { stdDate } from "../utils/dateStandardize.js";
import { earliestYear, isABeforeB, latestYear } from "../utils/dateHelpers.js";
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

// Fact types that legitimately happen after death — excluded from W3.
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

// Wrappers around Dallan's date library.
// Take a raw freeform date string from simplified GedcomX (may be undefined),
// standardize it, and return the earliest/latest possible year — or null if
// the date is missing or unparseable.
export function earliestYearOf(rawDate: string | undefined): number | null {
  if (!rawDate) return null;
  const std = stdDate(rawDate);
  if (!std) return null;
  return earliestYear(std);
}

export function latestYearOf(rawDate: string | undefined): number | null {
  if (!rawDate) return null;
  const std = stdDate(rawDate);
  if (!std) return null;
  return latestYear(std);
}

// Day-level precision: is rawA definitely before rawB?
// Standardizes both dates, then uses day-precision range overlap.
// Returns null when either date is missing/unparseable, or when the
// day-level ranges overlap (cannot say which is earlier).
export function isBefore(
  rawA: string | undefined,
  rawB: string | undefined,
): boolean | null {
  if (!rawA || !rawB) return null;
  const stdA = stdDate(rawA);
  const stdB = stdDate(rawB);
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

  if (isBefore(deathFact.date, birthFact.date) !== true) return null;

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

// W2: YOUNG_BIRTH — male parent of the anchor (or anchor as male parent of a child)
// was under FATHER_MIN_AGE at the child's birth.
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

    const parentBirthFact = (parent.facts ?? []).find((f) => f.type === "Birth");
    const childBirthFact = (child.facts ?? []).find((f) => f.type === "Birth");
    if (!parentBirthFact || !childBirthFact) continue;

    const parentBirthYear = earliestYearOf(parentBirthFact.date);
    const childBirthYear = latestYearOf(childBirthFact.date);
    if (parentBirthYear == null || childBirthYear == null) continue;

    const maxAge = childBirthYear - parentBirthYear;
    if (maxAge >= FATHER_MIN_AGE) continue;

    const parentName = getPersonName(parent);
    out.push({
      scoreType: COHERENCE,
      issueType: YOUNG_BIRTH,
      severity: "warning",
      personId: child.id ?? "",
      personName: getPersonName(child),
      message: `If this person was born ${childBirthFact.date ?? "[unknown]"}, ${parentName} would have been ${maxAge}, which is normally before child bearing years.`,
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

    if (isBefore(deathFact.date, fact.date) !== true) continue;

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

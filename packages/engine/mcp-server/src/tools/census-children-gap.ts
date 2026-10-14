// census_children_gap — the 1900/1910 US census children-born/children-living
// arithmetic: how many of a mother's children the tree is missing, and the
// birth window of each. Offline; writes nothing. Explicit mode is pure; tree
// mode (`motherId`) reads the mother's children from tree.gedcomx.json.
// Spec: docs/specs/census-children-gap-tool-spec.md.

import type {
  CensusChildCounts,
  CensusChildrenGapInput,
  CensusChildrenGapResult,
  CensusConflict,
  CensusStatus,
  CensusYear,
  KnownChild,
  MissingChildGroup,
  MissingChildKind,
  TreeChildUsed,
  UndeterminedCensus,
  UnresolvedChildGroup,
} from "../types/census-children-gap.js";
import type { SimplifiedFact, SimplifiedGedcomX, SimplifiedPerson } from "../types/gedcomx.js";
import { NoProjectError, noProjectResult, readProjectJson } from "../utils/project-io.js";
import { getStandardDate } from "../utils/fact-helpers.js";
import { earliestIsUnbounded, getDayRange, latestIsUnbounded } from "../utils/date-helpers.js";
import { BIRTHLIKE_FACT_TYPES, DEATHLIKE_FACT_TYPES } from "../utils/mob.js";
import { findAnchor, getPersonName, isNonBiologicalSubtype } from "./person-warnings.js";

export const ENUMERATION_DAYS: Record<CensusYear, string> = {
  1900: "1900-06-01",
  1910: "1910-04-15",
};

const CENSUS_YEARS: CensusYear[] = [1900, 1910];

/** A date as the closed interval of days it could be: YYYYMMDD in explicit mode,
 *  `getDayRange` day numbers in tree mode. Never compare across modes; each
 *  mode passes `computeGap` the census-day function in its own unit. */
interface DayInterval {
  earliest: number;
  latest: number;
}

const DATE_RE = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/;

function daysInMonth(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function parseDate(raw: unknown): DayInterval | null {
  if (typeof raw !== "string") return null;
  const m = DATE_RE.exec(raw.trim());
  if (!m) return null;
  const year = Number(m[1]);
  if (m[2] === undefined) {
    return { earliest: year * 10000 + 101, latest: year * 10000 + 1231 };
  }
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  const last = daysInMonth(year, month);
  if (m[3] === undefined) {
    return { earliest: year * 10000 + month * 100 + 1, latest: year * 10000 + month * 100 + last };
  }
  const day = Number(m[3]);
  if (day < 1 || day > last) return null;
  const ymd = year * 10000 + month * 100 + day;
  return { earliest: ymd, latest: ymd };
}

/** A census day in the same unit as the children's intervals. */
type CensusDayOf = (year: CensusYear) => number;

/** Explicit mode: intervals are YYYYMMDD. */
const EXPLICIT_DAY: Record<CensusYear, number> = {
  1900: Number(ENUMERATION_DAYS[1900].replace(/-/g, "")),
  1910: Number(ENUMERATION_DAYS[1910].replace(/-/g, "")),
};
const explicitDayOf: CensusDayOf = (year) => EXPLICIT_DAY[year];

/** Tree mode: intervals are `getDayRange` day numbers, so census days are too. */
const TREE_DAY: Record<CensusYear, number> = {
  1900: getDayRange("1 Jun 1900")!.min,
  1910: getDayRange("15 Apr 1910")!.min,
};
const treeDayOf: CensusDayOf = (year) => TREE_DAY[year];

function isCount(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0;
}

interface ParsedChild {
  label: string;
  /** Null only alongside `problem`. */
  birth: DayInterval | null;
  death: DayInterval | null;
  hasDeathDate: boolean;
  /** Set when the child cannot be placed against any census day. */
  problem?: string;
  /** What would place a birth or death that straddles a census day. */
  birthHint?: string;
  deathHint?: string;
}

function validateCensuses(input: CensusChildrenGapInput): { errors: string[]; censuses: CensusChildCounts[] } {
  const errors: string[] = [];
  const censuses: CensusChildCounts[] = [];

  const rawCensuses = (input as { censuses?: unknown })?.censuses;
  if (!Array.isArray(rawCensuses) || rawCensuses.length === 0) {
    errors.push("censuses must be a non-empty array of { year, childrenBorn, childrenLiving }.");
  } else if (rawCensuses.length > 2) {
    errors.push("censuses takes at most two entries, one for 1900 and one for 1910.");
  } else {
    const seen = new Set<number>();
    for (const c of rawCensuses as Partial<CensusChildCounts>[]) {
      if (c?.year !== 1900 && c?.year !== 1910) {
        errors.push(`census year must be 1900 or 1910; got ${JSON.stringify(c?.year)}.`);
        continue;
      }
      if (seen.has(c.year)) {
        errors.push(`census year ${c.year} is given twice.`);
        continue;
      }
      seen.add(c.year);
      if (!isCount(c.childrenBorn) || !isCount(c.childrenLiving)) {
        errors.push(`${c.year}: childrenBorn and childrenLiving must be whole numbers 0 or more.`);
        continue;
      }
      if (c.childrenLiving > c.childrenBorn) {
        errors.push(
          `${c.year}: childrenLiving (${c.childrenLiving}) cannot exceed childrenBorn (${c.childrenBorn}).`,
        );
        continue;
      }
      censuses.push({ year: c.year, childrenBorn: c.childrenBorn, childrenLiving: c.childrenLiving });
    }
  }
  return { errors, censuses };
}

function validate(
  input: CensusChildrenGapInput,
): { errors: string[]; censuses: CensusChildCounts[]; children: ParsedChild[] } {
  const { errors, censuses } = validateCensuses(input);
  const children: ParsedChild[] = [];

  const rawChildren = (input as { knownChildren?: unknown })?.knownChildren ?? [];
  if (!Array.isArray(rawChildren)) {
    errors.push("knownChildren must be an array.");
  } else {
    rawChildren.forEach((raw: Partial<KnownChild> | null, i: number) => {
      const name = typeof raw?.name === "string" && raw.name.trim() ? raw.name.trim() : null;
      const label = name ?? `child ${i + 1}`;
      if (raw?.birthDate === undefined || raw?.birthDate === null || raw?.birthDate === "") {
        errors.push(`${label}: birthDate is required (YYYY, YYYY-MM or YYYY-MM-DD).`);
        return;
      }
      const birth = parseDate(raw.birthDate);
      if (!birth) {
        errors.push(`${label}: birthDate ${JSON.stringify(raw.birthDate)} is not a real YYYY, YYYY-MM or YYYY-MM-DD date.`);
        return;
      }
      let death: DayInterval | null = null;
      const hasDeathDate = raw.deathDate !== undefined && raw.deathDate !== null && raw.deathDate !== "";
      if (hasDeathDate) {
        death = parseDate(raw.deathDate);
        if (!death) {
          errors.push(`${label}: deathDate ${JSON.stringify(raw.deathDate)} is not a real YYYY, YYYY-MM or YYYY-MM-DD date.`);
          return;
        }
        if (death.latest < birth.earliest) {
          errors.push(`${label}: deathDate ${raw.deathDate} is before birthDate ${raw.birthDate}.`);
          return;
        }
      }
      children.push({ label: name ?? `child ${i + 1} (b. ${raw.birthDate})`, birth, death, hasDeathDate });
    });
  }

  return { errors, censuses, children };
}

/** A known child's state on a census day, or the reason it cannot be placed. */
function placeChild(child: ParsedChild, year: CensusYear, dayOf: CensusDayOf): CensusStatus | { reason: string } {
  if (child.problem || !child.birth) return { reason: child.problem ?? "no birth date" };
  const day = dayOf(year);
  const iso = ENUMERATION_DAYS[year];
  if (child.birth.earliest > day) return "not_born";
  // A death before the census day proves the birth was before it too.
  if (child.death && child.death.latest < day) return "dead";
  if (child.birth.latest > day) {
    return { reason: `the birth date cannot be placed before or after the ${year} census day (${iso}); ${child.birthHint ?? "give the month or day"}` };
  }
  if (!child.death) return "living";
  if (child.death.latest < day) return "dead";
  if (child.death.earliest >= day) return "living";
  return { reason: `the death date cannot be placed before or after the ${year} census day (${iso}); ${child.deathHint ?? "give the month or day"}` };
}

interface CensusTally {
  year: CensusYear;
  censusDead: number;
  censusLiving: number;
  missingDead: number;
  missingLiving: number;
}

const DAY_1900 = ENUMERATION_DAYS[1900];
const DAY_1910 = ENUMERATION_DAYS[1910];

function group(
  kind: MissingChildKind,
  count: number,
  bornAfter: string | null,
  bornOnOrBefore: string,
  status1900: CensusStatus,
  status1910: CensusStatus,
  description: string,
): MissingChildGroup {
  return { kind, count, bornAfter, bornOnOrBefore, status1900, status1910, description };
}

export function censusChildrenGap(input: CensusChildrenGapInput): CensusChildrenGapResult {
  const { errors, censuses, children } = validate(input);
  if (errors.length > 0) return { ok: false, errors };
  return computeGap(censuses, children, explicitDayOf);
}

function computeGap(
  censuses: CensusChildCounts[],
  children: ParsedChild[],
  dayOf: CensusDayOf,
): CensusChildrenGapResult {
  const byYear = new Map(censuses.map((c) => [c.year, c]));
  const conflicts: CensusConflict[] = [];
  const undetermined: UndeterminedCensus[] = [];
  const assumptions: string[] = [];

  const c1900 = byYear.get(1900);
  const c1910 = byYear.get(1910);
  if (c1900 && c1910) {
    if (c1910.childrenBorn < c1900.childrenBorn) {
      conflicts.push({
        census: "both",
        message: `1910 records ${c1910.childrenBorn} children born, fewer than the ${c1900.childrenBorn} recorded in 1900.`,
      });
    }
    const dead1900 = c1900.childrenBorn - c1900.childrenLiving;
    const dead1910 = c1910.childrenBorn - c1910.childrenLiving;
    if (dead1910 < dead1900) {
      conflicts.push({
        census: "both",
        message: `1910 records ${dead1910} children dead, fewer than the ${dead1900} dead in 1900; the dead count only grows.`,
      });
    }
  }

  const tallies = new Map<CensusYear, CensusTally>();
  for (const year of CENSUS_YEARS) {
    const census = byYear.get(year);
    if (!census) continue;
    let knownDead = 0;
    let knownLiving = 0;
    let placeable = true;
    for (const child of children) {
      const status = placeChild(child, year, dayOf);
      if (typeof status === "object") {
        undetermined.push({ census: year, child: child.label, reason: status.reason });
        placeable = false;
      } else if (status === "dead") {
        knownDead++;
      } else if (status === "living") {
        knownLiving++;
      }
    }
    // The placed children are a lower bound even when another child cannot be
    // placed, so a contradiction they already prove is reported either way.
    const censusDead = census.childrenBorn - census.childrenLiving;
    const atLeast = placeable ? "" : "at least ";
    if (knownDead > censusDead) {
      conflicts.push({
        census: year,
        message: `The tree has ${atLeast}${knownDead} of her children dead by the ${year} census day (${ENUMERATION_DAYS[year]}), but the census records only ${censusDead}.`,
      });
    }
    if (knownLiving > census.childrenLiving) {
      conflicts.push({
        census: year,
        message: `The tree has ${atLeast}${knownLiving} of her children living on the ${year} census day (${ENUMERATION_DAYS[year]}), but the census records only ${census.childrenLiving}.`,
      });
    }
    if (!placeable) continue;
    tallies.set(year, {
      year,
      censusDead,
      censusLiving: census.childrenLiving,
      missingDead: censusDead - knownDead,
      missingLiving: census.childrenLiving - knownLiving,
    });
  }

  const t1900 = tallies.get(1900);
  const t1910 = tallies.get(1910);
  if (t1900 && t1910 && conflicts.length === 0) {
    if (t1910.missingDead < t1900.missingDead) {
      conflicts.push({
        census: "both",
        message: `${t1900.missingDead} missing children were dead by 1900, but the 1910 counts leave room for only ${t1910.missingDead} missing dead children; a child dead by 1900 must still be dead in 1910.`,
      });
    }
    const total1900 = t1900.missingDead + t1900.missingLiving;
    const total1910 = t1910.missingDead + t1910.missingLiving;
    if (total1910 < total1900) {
      conflicts.push({
        census: "both",
        message: `The 1900 counts leave ${total1900} children missing from the tree, but the 1910 counts leave only ${total1910}; a child counted in 1900 must still be counted in 1910.`,
      });
    }
  }

  const censusesUsed = CENSUS_YEARS.filter((y) => tallies.has(y));
  for (const child of children) {
    if (child.hasDeathDate || !child.birth) continue;
    const birth = child.birth;
    const relevant = censusesUsed.filter((y) => birth.latest <= dayOf(y));
    if (relevant.length > 0) {
      assumptions.push(`${child.label} has no death date, so is treated as living at the ${relevant.join(" and ")} census.`);
    }
  }

  const base = {
    ok: true as const,
    enumerationDays: { "1900": DAY_1900, "1910": DAY_1910 },
    censusesUsed,
    conflicts,
    undetermined,
    assumptions,
  };
  if (conflicts.length > 0 || censusesUsed.length === 0) {
    return { ...base, totalMissing: null, missing: [], unresolved: [] };
  }

  const missing: MissingChildGroup[] = [];
  const unresolved: UnresolvedChildGroup[] = [];

  if (t1900 && t1910) {
    const a = t1900.missingDead;
    const bMin = Math.max(0, t1900.missingLiving - t1910.missingLiving);
    const bMax = Math.min(t1900.missingLiving, t1910.missingDead - t1900.missingDead);
    const k = bMax - bMin;
    const c = t1900.missingLiving - bMax;
    const d = t1910.missingDead - a - bMax;
    const e = t1910.missingLiving - t1900.missingLiving + bMin;
    missing.push(
      group("died_before_1900", a, null, DAY_1900, "dead", "dead",
        `born on or before ${DAY_1900} and died before ${DAY_1900}`),
      group("living_1900_died_by_1910", bMin, null, DAY_1900, "living", "dead",
        `born on or before ${DAY_1900}, living on ${DAY_1900}, died before ${DAY_1910}`),
      group("living_1900_and_1910", c, null, DAY_1900, "living", "living",
        `born on or before ${DAY_1900} and living on both ${DAY_1900} and ${DAY_1910}`),
      group("born_between_died_by_1910", d, DAY_1900, DAY_1910, "not_born", "dead",
        `born after ${DAY_1900}, on or before ${DAY_1910}, and died before ${DAY_1910}`),
      group("born_between_living_1910", e, DAY_1900, DAY_1910, "not_born", "living",
        `born after ${DAY_1900}, on or before ${DAY_1910}, and living on ${DAY_1910}`),
    );
    if (k > 0) {
      unresolved.push(
        {
          count: k,
          bornAfter: null,
          bornOnOrBefore: DAY_1900,
          status1900: "living",
          status1910: "unknown",
          description: `born on or before ${DAY_1900} and living on ${DAY_1900}; the counts cannot say whether living on ${DAY_1910}`,
        },
        {
          count: k,
          bornAfter: DAY_1900,
          bornOnOrBefore: DAY_1910,
          status1900: "not_born",
          status1910: "unknown",
          description: `born after ${DAY_1900}, on or before ${DAY_1910}; the counts cannot say whether living on ${DAY_1910}. Paired with the group above: for each pair, exactly one of the two died before ${DAY_1910}`,
        },
      );
    }
  } else if (t1900) {
    missing.push(
      group("died_before_1900", t1900.missingDead, null, DAY_1900, "dead", "dead",
        `born on or before ${DAY_1900} and died before ${DAY_1900}`),
      group("living_1900", t1900.missingLiving, null, DAY_1900, "living", "unknown",
        `born on or before ${DAY_1900} and living on ${DAY_1900}`),
    );
  } else if (t1910) {
    missing.push(
      group("dead_by_1910", t1910.missingDead, null, DAY_1910, "unknown", "dead",
        `born on or before ${DAY_1910} and died before ${DAY_1910}`),
      group("living_1910", t1910.missingLiving, null, DAY_1910, "unknown", "living",
        `born on or before ${DAY_1910} and living on ${DAY_1910}`),
    );
  }

  const kept = missing.filter((g) => g.count !== 0);
  const totalMissing = [...kept, ...unresolved].reduce((n, g) => n + g.count, 0);
  return { ...base, totalMissing, missing: kept, unresolved };
}

const TREE_FILE = "tree.gedcomx.json";

function factKind(fact: SimplifiedFact): string {
  return (fact.type ?? "").replace(/^.*[/#]/, "");
}

/** The union of the day ranges of `person`'s facts of the given kinds, the
 *  standard dates read, and whether a fact of those kinds had a date that
 *  could not be read. */
function factInterval(
  person: SimplifiedPerson,
  kinds: ReadonlySet<string>,
): { interval: DayInterval | null; dates: string[]; unreadable: boolean; undated: boolean } {
  let interval: DayInterval | null = null;
  const dates: string[] = [];
  let unreadable = false;
  let undated = false;
  for (const fact of person.facts ?? []) {
    if (!kinds.has(factKind(fact))) continue;
    const std = getStandardDate(fact);
    if (std === null) {
      if (fact.date) unreadable = true;
      else undated = true;
      continue;
    }
    const range = getDayRange(std);
    if (!range) {
      unreadable = true;
      continue;
    }
    // `Aft`/`Bef` (and `Est`) get a plausibility cap from getDayRange; an
    // open end is not evidence, so it must not decide a census placement.
    const earliest = earliestIsUnbounded(std) ? -Infinity : range.min;
    const latest = latestIsUnbounded(std) ? Infinity : range.max;
    dates.push(kinds.size > 1 ? `${factKind(fact)} ${std}` : std);
    interval = interval
      ? { earliest: Math.min(interval.earliest, earliest), latest: Math.max(interval.latest, latest) }
      : { earliest, latest };
  }
  return { interval, dates, unreadable, undated };
}

const BIRTH_KINDS: ReadonlySet<string> = new Set(["Birth"]);
/** Born on or before any of these. */
const BIRTH_BOUND_KINDS: ReadonlySet<string> = new Set([...BIRTHLIKE_FACT_TYPES].filter((k) => k !== "Birth"));
const DEATH_KINDS: ReadonlySet<string> = new Set(["Death"]);
/** Died on or before any of these. */
const DEATH_BOUND_KINDS: ReadonlySet<string> = new Set(
  [...DEATHLIKE_FACT_TYPES].filter((k) => k !== "Death" && k !== "Will"),
);

/** The mother's children from the tree, as placement input. Every ParentChild
 *  edge from her counts unless its subtype denies biological parentage, so a
 *  child by any husband is included. A child the tree cannot place carries a
 *  `problem` and is reported as undetermined, never as a whole-call error. */
function childrenFromTree(
  tree: SimplifiedGedcomX,
  mother: SimplifiedPerson,
): { children: ParsedChild[]; used: TreeChildUsed[] } {
  const byId = new Map((tree.persons ?? []).map((p) => [p.id, p]));
  const childIds: string[] = [];
  for (const rel of tree.relationships ?? []) {
    if (factKind({ type: rel.type }) !== "ParentChild") continue;
    if (rel.parent !== mother.id || !rel.child) continue;
    if (isNonBiologicalSubtype(rel.subtype)) continue;
    if (!childIds.includes(rel.child)) childIds.push(rel.child);
  }

  const children: ParsedChild[] = [];
  const used: TreeChildUsed[] = [];
  for (const id of childIds) {
    const person = byId.get(id);
    if (!person) {
      children.push({ label: id, birth: null, death: null, hasDeathDate: false, problem: `child ${id} is linked but not in ${TREE_FILE}` });
      used.push({ personId: id, name: id, birth: null, death: null });
      continue;
    }
    const name = getPersonName(person);
    const label = `${name} (${id})`;
    const birth = factInterval(person, BIRTH_KINDS);
    const birthBound = factInterval(person, BIRTH_BOUND_KINDS);
    const death = factInterval(person, DEATH_KINDS);
    const deathBound = factInterval(person, DEATH_BOUND_KINDS);
    used.push({
      personId: id,
      name,
      birth: birth.dates.join(" / ") || (birthBound.dates.length ? `on or before ${birthBound.dates.join(" / ")}` : null),
      death: death.dates.join(" / ") || (deathBound.dates.length ? `on or before ${deathBound.dates.join(" / ")}` : null),
    });

    let birthInterval = birth.interval;
    if (!birthInterval && birthBound.interval) {
      birthInterval = { earliest: -Infinity, latest: birthBound.interval.latest };
    }
    let problem: string | undefined;
    if (!birthInterval) {
      problem = birth.unreadable || birthBound.unreadable
        ? "its birth date in the tree cannot be read"
        : "the tree has no birth or christening date for this child";
    }
    let deathInterval = death.interval;
    if (!deathInterval && deathBound.interval) {
      deathInterval = { earliest: birthInterval?.earliest ?? -Infinity, latest: deathBound.interval.latest };
    }
    if (!problem && !deathInterval && (death.unreadable || deathBound.unreadable)) {
      problem = "its death date in the tree cannot be read";
    }
    if (!problem && !deathInterval && (death.undated || deathBound.undated)) {
      problem = "the tree records a death for this child with no date";
    }
    if (!problem && birthInterval && deathInterval && deathInterval.latest < birthInterval.earliest) {
      problem = "its death date in the tree is before its birth date";
    }
    children.push({
      label,
      birth: birthInterval,
      death: deathInterval,
      hasDeathDate: deathInterval !== null,
      ...(problem ? { problem } : {}),
      ...(!birth.interval && birthBound.interval
        ? { birthHint: "the tree has only a christening-type date, which shows the birth was on or before it; a birth date would place it" }
        : {}),
      ...(!death.interval && deathBound.interval
        ? { deathHint: "the tree has only a burial-type date, which shows the death was on or before it; a death date would place it" }
        : {}),
    });
  }
  return { children, used };
}

/**
 * The tool's entry point. Without `motherId` this is `censusChildrenGap` (an
 * injected `projectPath` is ignored). With it, the mother's children and their
 * dates are read from tree.gedcomx.json instead of being passed in.
 */
export async function censusChildrenGapTool(input: CensusChildrenGapInput): Promise<CensusChildrenGapResult> {
  const motherId = (input as { motherId?: unknown })?.motherId;
  if (motherId === undefined || motherId === null) return censusChildrenGap(input);
  if (typeof motherId !== "string" || !motherId.trim()) {
    return { ok: false, errors: ["motherId must be a tree person id or a FamilySearch id."] };
  }
  const knownChildren = (input as { knownChildren?: unknown }).knownChildren;
  if (knownChildren !== undefined && knownChildren !== null) {
    return {
      ok: false,
      errors: ["Pass either motherId (the tool reads her children from the tree) or knownChildren, not both."],
    };
  }
  const { errors, censuses } = validateCensuses(input);
  if (errors.length > 0) return { ok: false, errors };

  let tree: SimplifiedGedcomX;
  try {
    tree = (await readProjectJson(input.projectPath as string, TREE_FILE)) as SimplifiedGedcomX;
  } catch (e) {
    if (e instanceof NoProjectError) return noProjectResult("read");
    return { ok: false, errors: [e instanceof Error ? e.message : String(e)] };
  }
  let mother: SimplifiedPerson;
  try {
    mother = findAnchor(tree.persons ?? [], motherId.trim());
  } catch (e) {
    return { ok: false, errors: [e instanceof Error ? e.message : String(e)] };
  }
  if ((mother.gender ?? "").replace(/^.*[/#]/, "").toLowerCase() === "male") {
    return {
      ok: false,
      errors: [`motherId '${motherId}' names ${getPersonName(mother)}, who is recorded as male; pass the mother's id.`],
    };
  }

  const { children, used } = childrenFromTree(tree, mother);
  const result = computeGap(censuses, children, treeDayOf);
  if (!result.ok) return result;
  return {
    ...result,
    mother: { personId: mother.id ?? motherId, name: getPersonName(mother) },
    knownChildrenUsed: used,
  };
}

export const censusChildrenGapSchema = {
  name: "census_children_gap",
  description:
    "Work out which of a mother's children the tree is missing from the 1900 or 1910 US " +
    "census's children-born and children-living counts, and each missing child's exact " +
    "birth window. Use it whenever a 1900/1910 census record or the user gives those counts " +
    "— never do this arithmetic yourself.\n" +
    "\n" +
    "Pass the counts for each census you have. In a project, also pass `projectPath` and " +
    "`motherId` (her tree id or FamilySearch id): the tool reads every child she bore from " +
    "the tree, by any husband, with their dates — do not copy dates yourself. With no " +
    "project, pass `knownChildren` instead: every child of hers you know of, with birth " +
    "date (required) and death date if known, as YYYY, YYYY-MM or YYYY-MM-DD; a child born " +
    "or dying in the census year needs the month, and in June 1900 or April 1910 the day.\n" +
    "\n" +
    "Returns `missing` groups (count, birth window, status at each census), `unresolved` " +
    "pairs the counts cannot settle, `conflicts` (the counts and the tree cannot both be " +
    "right — report them, nothing is computed), `undetermined` (a date too coarse to place " +
    "against a census day) and `assumptions`; tree mode adds `mother` and `knownChildrenUsed`. Windows are bounded by the census days " +
    `(${DAY_1900}, ${DAY_1910}), never by siblings' births. Report the windows as given. ` +
    "If the call errors, surface the error; do not fall back to hand arithmetic. Writes nothing.",
  inputSchema: {
    type: "object" as const,
    properties: {
      censuses: {
        type: "array",
        minItems: 1,
        maxItems: 2,
        description: "One entry per census, 1900 and/or 1910.",
        items: {
          type: "object",
          properties: {
            year: { type: "number", enum: [1900, 1910], description: "Census year." },
            childrenBorn: { type: "number", description: "Mother of how many children." },
            childrenLiving: { type: "number", description: "Number of these children living." },
          },
          required: ["year", "childrenBorn", "childrenLiving"],
        },
      },
      projectPath: {
        type: "string",
        description: "Absolute path of the research project. Used only with motherId.",
      },
      motherId: {
        type: "string",
        description: "Tree mode: the mother's tree person id or FamilySearch id. The tool reads her children from tree.gedcomx.json. Do not also pass knownChildren.",
      },
      knownChildren: {
        type: "array",
        description: "Without a project: every child of hers you know of, by any husband. Do not pass with motherId.",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Label only." },
            birthDate: { type: "string", description: "YYYY, YYYY-MM or YYYY-MM-DD." },
            deathDate: { type: "string", description: "YYYY, YYYY-MM or YYYY-MM-DD; omit if unknown (treated as living)." },
          },
          required: ["birthDate"],
        },
      },
    },
    required: ["censuses"],
  },
};

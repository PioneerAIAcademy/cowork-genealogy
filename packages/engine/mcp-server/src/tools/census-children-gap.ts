// census_children_gap — the 1900/1910 US census children-born/children-living
// arithmetic: how many of a mother's children the tree is missing, and the
// birth window of each. Pure and offline; writes nothing.
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
  UndeterminedCensus,
  UnresolvedChildGroup,
} from "../types/census-children-gap.js";

export const ENUMERATION_DAYS: Record<CensusYear, string> = {
  1900: "1900-06-01",
  1910: "1910-04-15",
};

const CENSUS_YEARS: CensusYear[] = [1900, 1910];

/** A partial ISO date as the closed interval of days it could be, as YYYYMMDD. */
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

const CENSUS_DAY_NUM: Record<CensusYear, number> = {
  1900: Number(ENUMERATION_DAYS[1900].replace(/-/g, "")),
  1910: Number(ENUMERATION_DAYS[1910].replace(/-/g, "")),
};

function censusDay(year: CensusYear): number {
  return CENSUS_DAY_NUM[year];
}

function isCount(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0;
}

interface ParsedChild {
  label: string;
  birth: DayInterval;
  death: DayInterval | null;
  hasDeathDate: boolean;
}

function validate(
  input: CensusChildrenGapInput,
): { errors: string[]; censuses: CensusChildCounts[]; children: ParsedChild[] } {
  const errors: string[] = [];
  const censuses: CensusChildCounts[] = [];
  const children: ParsedChild[] = [];

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
function placeChild(child: ParsedChild, year: CensusYear): CensusStatus | { reason: string } {
  const day = censusDay(year);
  const iso = ENUMERATION_DAYS[year];
  if (child.birth.earliest > day) return "not_born";
  // A death before the census day proves the birth was before it too.
  if (child.death && child.death.latest < day) return "dead";
  if (child.birth.latest > day) {
    return { reason: `the birth date cannot be placed before or after the ${year} census day (${iso}); give the month or day` };
  }
  if (!child.death) return "living";
  if (child.death.latest < day) return "dead";
  if (child.death.earliest >= day) return "living";
  return { reason: `the death date cannot be placed before or after the ${year} census day (${iso}); give the month or day` };
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
      const status = placeChild(child, year);
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
    if (child.hasDeathDate) continue;
    const relevant = censusesUsed.filter((y) => child.birth.latest <= censusDay(y));
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

export const censusChildrenGapSchema = {
  name: "census_children_gap",
  description:
    "Work out which of a mother's children the tree is missing from the 1900 or 1910 US " +
    "census's children-born and children-living counts, and each missing child's exact " +
    "birth window. Use it whenever a 1900/1910 census record or the user gives those counts " +
    "— never do this arithmetic yourself.\n" +
    "\n" +
    "Pass the counts for each census you have, and `knownChildren`: EVERY child she bore " +
    "that the tree already holds, by any husband, with birth date (required) and death " +
    "date if known. Dates are YYYY, YYYY-MM or YYYY-MM-DD; a child born or dying in the " +
    "census year needs the month, and in June 1900 or April 1910 the day, to be placed " +
    "against the census day.\n" +
    "\n" +
    "Returns `missing` groups (count, birth window, status at each census), `unresolved` " +
    "pairs the counts cannot settle, `conflicts` (the counts and the tree cannot both be " +
    "right — report them, nothing is computed), `undetermined` (a date too coarse to place " +
    "against a census day) and `assumptions`. Windows are bounded by the census days " +
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
      knownChildren: {
        type: "array",
        description: "Every child of hers already in the tree, by any husband.",
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

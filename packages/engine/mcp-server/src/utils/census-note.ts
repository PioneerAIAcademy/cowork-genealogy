// `census` on a `record_search` response: what the census table in code
// (`data/census-table.ts`) holds for the year and place a census search names.
//
// Keyed on the call's own arguments and nothing else, so the tool and the eval
// mock run the same function and cannot disagree. It reads no search result.

import {
  BRITISH_RELATIONSHIP_COLUMN_FROM,
  CENSUS_FRAGMENTS,
  CENSUS_TABLE,
  US_RELATIONSHIP_COLUMN_FROM,
  type CensusRow,
} from "../data/census-table.js";
import { foldPlaceKey, listedOneWordPlace } from "./one-word-places.js";

export interface CensusSchedule {
  year: number;
  /** The jurisdiction the census was taken for, as the table labels it. */
  census: string;
  collectionId: string;
  /** What the schedule recorded about household members, where the table knows. */
  recorded?: string;
}

export interface CensusNote {
  schedules: CensusSchedule[];
  /** With no schedule for the years searched: the years the table does list for the place. */
  indexedYears?: number[];
  /** Years searched whose census of the place survives only as fragments. */
  fragmentYears?: number[];
  note: string;
}

export interface CensusNoteInput {
  recordType?: unknown;
  collectionId?: unknown;
  residenceYearFrom?: unknown;
  residenceYearTo?: unknown;
  anyYearFrom?: unknown;
  anyYearTo?: unknown;
  residencePlace?: unknown;
  anyPlace?: unknown;
  recordSubdivision?: unknown;
  recordCountry?: unknown;
}

/** A range lists at most this many schedules, earliest first. */
export const MAX_CENSUS_SCHEDULES = 8;

export const CENSUS_SCHEDULES_NOTE =
  "From this tool's census table, not from the search results: what each census " +
  "schedule recorded. Say nothing else about what a schedule collected.";

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined);
const year = (v: unknown): number | undefined => (typeof v === "number" && Number.isInteger(v) ? v : undefined);

function searchedYears(input: CensusNoteInput): [number, number] | undefined {
  const from = year(input.residenceYearFrom) ?? year(input.anyYearFrom);
  const to = year(input.residenceYearTo) ?? year(input.anyYearTo);
  if (from === undefined || to === undefined || from > to) return undefined;
  return [from, to];
}

function searchedPlace(input: CensusNoteInput): string | undefined {
  return (
    str(input.residencePlace) ??
    str(input.anyPlace) ??
    str([str(input.recordSubdivision), str(input.recordCountry)].filter(Boolean).join(", "))
  );
}

/** A place's comma segments, each folded as the one-word list folds a key. */
function folded(place: string): string[] {
  return place
    .split(",")
    .map((s) => foldPlaceKey(s.trim()))
    .filter((s) => s !== "");
}

/** `whole` ends with every segment of `part`, in order. */
function endsWith(whole: readonly string[], part: readonly string[]): boolean {
  return part.length > 0 && part.length <= whole.length && part.every((s, i) => s === whole[whole.length - part.length + i]);
}

/** Every jurisdiction the census table names, folded, once each. */
const TABLE_FORMS: readonly string[][] = [
  ...new Set([...CENSUS_TABLE, ...CENSUS_FRAGMENTS].flatMap((r) => r.covers)),
].map(folded);

/** A segment written after a listed place agrees with its standard place when it
 *  ends the words of one of that place's parents: "Georgia" agrees with
 *  "Tbilisi, Republic of Georgia", "New York" does not agree with "Essex,
 *  England, United Kingdom". Each later segment is matched to a later parent. */
function agrees(standard: readonly string[], later: readonly string[]): boolean {
  const parents = standard.slice(1);
  let k = 0;
  for (const seg of later) {
    const words = seg.split(" ");
    while (k < parents.length && !endsWith(parents[k].split(" "), words)) k++;
    if (k === parents.length) return false;
    k++;
  }
  return true;
}

/**
 * The place the text stands for, as folded segments.
 *
 * 1. The most specific segment the one-word list resolves (the engine's own place
 *    standard) whose standard place agrees with every segment written after it.
 *    "Tbilisi, Georgia" is Tbilisi, Republic of Georgia; "Essex, New York" skips
 *    Essex, which the list puts in England, and is New York, United States.
 * 2. Else a jurisdiction of the census table written without its country:
 *    "Androscoggin, Maine" is in Maine, United States, which the list leaves out.
 * 3. Else the text as written.
 *
 * The segments written before the one resolved are kept in front of it.
 */
export function resolveCensusPlace(text: string, recordCountry?: string): string[] {
  const raw = text.split(",").map((s) => s.trim()).filter((s) => s !== "");
  const place = raw.map((s) => foldPlaceKey(s));
  for (let i = 0; i < raw.length; i++) {
    const standard = listedOneWordPlace(raw[i], recordCountry ?? null);
    if (standard === null) continue;
    const resolved = folded(standard);
    if (agrees(resolved, place.slice(i + 1))) return [...place.slice(0, i), ...resolved];
  }
  for (const form of TABLE_FORMS) {
    const body = form.slice(0, -1);
    if (endsWith(place, body) && !endsWith(place, form)) return [...place.slice(0, place.length - body.length), ...form];
  }
  return place;
}

/** The census area and the place overlap: one of the forms lies in the place,
 *  or the place lies in one of them. */
function overlaps(forms: readonly string[], place: readonly string[]): boolean {
  return forms.some((f) => {
    const form = folded(f);
    return endsWith(place, form) || endsWith(form, place);
  });
}

function recorded(row: CensusRow): string | undefined {
  if (row.headsOnly) return "names only the head of each household; the others are counted, not named";
  const from =
    row.label === "United States"
      ? US_RELATIONSHIP_COLUMN_FROM
      : row.label === "England and Wales" || row.label === "Scotland"
        ? BRITISH_RELATIONSHIP_COLUMN_FROM
        : undefined;
  if (from === undefined) return undefined;
  return row.year >= from
    ? "names every person and states each one's relationship to the head of household"
    : "names every person but has no relationship-to-head column: relationships within a household are inferred from surname, age and listing order, not stated";
}

function schedule(row: CensusRow): CensusSchedule {
  const said = recorded(row);
  return {
    year: row.year,
    census: row.label,
    collectionId: row.collectionId,
    ...(said ? { recorded: said } : {}),
  };
}

/**
 * The note for one search, or `undefined` when it has nothing to say.
 *
 * A search pinned to a census collection in the table gets that census. A search
 * with `recordType: "census"`, or one whose residence years are a single year,
 * gets the censuses of those years that cover the place searched. Only a
 * `recordType: "census"` search is told the table lists none, and only for a
 * place the table covers in some other year.
 */
export function censusNote(
  input: CensusNoteInput,
  table: readonly CensusRow[] = CENSUS_TABLE,
): CensusNote | undefined {
  const pinned = str(input.collectionId);
  const pinnedRows = pinned ? table.filter((r) => r.collectionId === pinned) : [];
  if (pinnedRows.length > 0) {
    return { schedules: pinnedRows.map(schedule), note: CENSUS_SCHEDULES_NOTE };
  }

  const asked = input.recordType === "census";
  const years = searchedYears(input);
  if (!years) return undefined;
  const [from, to] = years;
  const singleResidenceYear =
    year(input.residenceYearFrom) !== undefined && input.residenceYearFrom === input.residenceYearTo;
  if (!asked && !singleResidenceYear) return undefined;

  const place = searchedPlace(input);
  if (!place) return undefined;
  const country = str(input.recordCountry);
  // The search's country is part of the place when the text does not name it:
  // "Kent" with `recordCountry: "United States"` is not Kent, England.
  const named = country !== undefined && folded(place).includes(foldPlaceKey(country));
  const resolved = resolveCensusPlace(country === undefined || named ? place : `${place}, ${country}`, country);

  const rows = table
    .filter((r) => r.year >= from && r.year <= to && overlaps(r.covers, resolved))
    .sort((a, b) => a.year - b.year);
  const fragmentYears = [
    ...new Set(
      CENSUS_FRAGMENTS.filter((f) => f.year >= from && f.year <= to && overlaps(f.covers, resolved)).map(
        (f) => f.year,
      ),
    ),
  ].sort((a, b) => a - b);
  const fragments = fragmentYears.length > 0 ? { fragmentYears } : {};

  if (rows.length > 0) {
    return {
      schedules: rows.slice(0, MAX_CENSUS_SCHEDULES).map(schedule),
      ...fragments,
      note: CENSUS_SCHEDULES_NOTE,
    };
  }
  if (!asked) return undefined;

  const indexedYears = [...new Set(table.filter((r) => overlaps(r.covers, resolved)).map((r) => r.year))].sort(
    (a, b) => a - b,
  );
  if (indexedYears.length === 0 && fragmentYears.length === 0) return undefined;
  const span = from === to ? `${from}` : `${from}-${to}`;
  return {
    schedules: [],
    indexedYears,
    ...fragments,
    note:
      `This tool's census table lists no census of ${place} for ${span} that FamilySearch indexes. ` +
      "`indexedYears` are the census years it does list for that place. The table leaves out a census " +
      "indexed only in part, so run the search once before reporting these years as not on FamilySearch.",
  };
}

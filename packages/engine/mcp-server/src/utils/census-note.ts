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
  placeMatches,
  rowCovers,
  segments,
  type CensusRow,
} from "../data/census-table.js";

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

/** The forms cover the place; or the place is a bare country they lie in; or the
 *  place leaves its country off ("Dodge County, Wisconsin") and a form without
 *  its own country is a whole-segment suffix of it. The last reading is not
 *  taken when the search names another country: "Tbilisi, Georgia" searched
 *  with `recordCountry: "Georgia"` is not the US state. */
function formsCover(forms: readonly string[], place: string, recordCountry?: string): boolean {
  if (placeMatches(forms, place)) return true;
  const want = segments(place);
  if (want.length === 1 && forms.some((f) => segments(f).pop() === want[0])) return true;
  const named = recordCountry?.trim().toLowerCase();
  return forms.some((f) => {
    const form = segments(f);
    if (named && form[form.length - 1] !== named) return false;
    const withoutCountry = form.slice(0, -1);
    if (withoutCountry.length === 0 || withoutCountry.length > want.length) return false;
    const tail = want.slice(want.length - withoutCountry.length);
    return withoutCountry.every((seg, i) => seg === tail[i]);
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

  const rows = table
    .filter((r) => r.year >= from && r.year <= to && formsCover(r.covers, place, country))
    .sort((a, b) => a.year - b.year);
  const fragmentYears = [
    ...new Set(
      CENSUS_FRAGMENTS.filter((f) => f.year >= from && f.year <= to && formsCover(f.covers, place, country)).map(
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

  const indexedYears = [...new Set(table.filter((r) => rowCovers(r, place)).map((r) => r.year))].sort(
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

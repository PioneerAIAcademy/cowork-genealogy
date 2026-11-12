// What `record_search` adds to an answer to say how to search next: the census
// block, the note on a children search held to one collection or place, and the
// note on a surname search that found nobody where surnames are patronymic.
//
// Every part is computed from the call's own arguments and the answer's counts,
// so the tool and the eval mock run this one function and cannot disagree.

import { censusNote, type CensusNote, type CensusNoteInput } from "./census-note.js";
import { PATRONYMIC_ABBREVIATIONS, patronymicVariants, searchFoundNobody } from "./surname-variant-hints.js";

export interface ChildrenSearchNote {
  /** The arguments that hold the search to one source or place. */
  heldBy: string[];
  note: string;
}

export interface PatronymicSearchNote {
  /** The surname the search carried. */
  searched: string;
  note: string;
}

export interface SearchAdvice {
  census?: CensusNote;
  childrenSearch?: ChildrenSearchNote;
  patronymicSearch?: PatronymicSearchNote;
}

/** The keys of `SearchAdvice`, in the order they are serialized before `results`. */
export const SEARCH_ADVICE_KEYS = ["patronymicSearch", "childrenSearch", "census"] as const;

export type SearchAdviceInput = CensusNoteInput & Record<string, unknown>;

export interface SearchCounts {
  totalMatches?: unknown;
  ranked?: { subjectResolvable?: unknown } | null;
}

const EVENTS = ["birth", "death", "marriage", "residence", "any"] as const;
const PARENTS = ["father", "mother", "parent"] as const;

const text = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined);

function namesAny(input: SearchAdviceInput, roles: readonly string[]): boolean {
  return roles.some((r) => text(input[`${r}GivenName`]) !== undefined || text(input[`${r}Surname`]) !== undefined);
}

/**
 * The note on a search that names a parent and no child and is held to one
 * collection, batch or place, or `undefined`. It fires whatever the search
 * returned: the children it did not return are the ones filed elsewhere.
 */
export function childrenSearchNote(input: SearchAdviceInput): ChildrenSearchNote | undefined {
  if (!namesAny(input, PARENTS) || text(input.givenName) !== undefined) return undefined;
  const heldBy = [
    ...(["collectionId", "batchNumber"] as const).filter((k) => text(input[k]) !== undefined),
    ...EVENTS.map((e) => `${e}Place`).filter((k) => text(input[k]) !== undefined),
  ];
  if (heldBy.length === 0) return undefined;
  return {
    heldBy,
    note:
      "This search names a parent and no child, and is held to " +
      heldBy.map((k) => `\`${k}\``).join(", ") +
      ". A couple's children are indexed across collections and places. Before reporting their children, " +
      "send it once more with no `collectionId`, `batchNumber` or place, anchored on `recordCountry`.",
  };
}

/** The surname ends in an abbreviation of -datter/-dotter after the genitive s:
 *  "Halsteinsdr", "Persdtr", "Olsd". */
function isAbbreviatedPatronymic(surname: string): boolean {
  const lower = surname.toLowerCase();
  const endings = new Set(Object.values(PATRONYMIC_ABBREVIATIONS).flat());
  return [...endings].some((a) => lower.length > a.length + 2 && lower.endsWith(`s${a}`));
}

/** Countries whose records index people under patronymics (lead, 2026-11-12). */
export const PATRONYMIC_COUNTRIES: readonly string[] = ["norway", "sweden"];

export const PATRONYMIC_SEARCH_NOTE =
  "This search carried a surname and found nobody. In these records the surname is a patronymic that " +
  "changes each generation, or a farm or emigrant name taken later, so the index may hold this person " +
  "under a surname you cannot guess. Before any other retry, send the same search with no `surname`: " +
  "keep `givenName`, the place and the years; add the parents' given names you hold as " +
  "`fatherGivenName` and `motherGivenName`; anchor on `recordCountry`. A record found that way must " +
  "still be evaluated as this person.";

function searchedCountries(input: SearchAdviceInput): string[] {
  const places = [text(input.recordCountry), ...EVENTS.map((e) => text(input[`${e}Place`]))];
  return places
    .filter((p): p is string => p !== undefined)
    .map((p) => (p.split(",").pop() as string).trim().toLowerCase());
}

/**
 * The note on a search that carried a surname, found nobody, and was scoped to
 * a country in `PATRONYMIC_COUNTRIES` by `recordCountry` or by the last segment
 * of a place; `undefined` otherwise. A -datter/-dotter surname is left to
 * `surnameVariantHints`, which names the forms to try in the same field, and so
 * is one of those abbreviated forms ("Halsteinsd"): the caller is already
 * working that hint's list.
 */
export function patronymicSearchNote(input: SearchAdviceInput, out: SearchCounts): PatronymicSearchNote | undefined {
  const surname = text(input.surname);
  if (!surname || !searchFoundNobody(out)) return undefined;
  if (patronymicVariants(surname).length > 0 || isAbbreviatedPatronymic(surname)) return undefined;
  if (!searchedCountries(input).some((c) => PATRONYMIC_COUNTRIES.includes(c))) return undefined;
  return { searched: surname, note: PATRONYMIC_SEARCH_NOTE };
}

/** Everything `record_search` adds to one answer; an empty object when nothing applies. */
export function searchAdvice(input: SearchAdviceInput, out: SearchCounts = {}): SearchAdvice {
  const advice: SearchAdvice = {};
  const patronymic = patronymicSearchNote(input, out);
  if (patronymic) advice.patronymicSearch = patronymic;
  const children = childrenSearchNote(input);
  if (children) advice.childrenSearch = children;
  const census = censusNote(input);
  if (census) advice.census = census;
  return advice;
}

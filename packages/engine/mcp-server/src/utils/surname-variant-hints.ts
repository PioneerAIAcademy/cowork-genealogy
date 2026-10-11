// `surnameVariantHints` — the abbreviated forms of a Scandinavian patronymic,
// offered on a `record_search` that did not find its subject.
//
// Clerks wrote the patronymic ending -datter / -dotter ("daughter") short, and
// the indexes transcribe the short form without its period: the bride the tree
// calls "Unna Halsteinsdatter" is indexed "Urna Halsteinsdr" in Norway,
// Marriages, 1660-1926. A search on the full spelling finds nothing, and the
// model, told this in prose, applied it in about half of measured runs
// (issue #3054). So the tool computes the forms itself — the same reasoning as
// `jurisdictionHints` — and the caller is told on the call it already makes.
//
// The abbreviations are the FamilySearch wiki's, verbatim:
//   Norway Naming Customs#Abbreviations — "The abbreviations dr., dtr., d., are
//   all substitutes for datter."
//   Sweden Naming Customs — "The abbreviations d., dr., dtr., are all
//   substitutes for dotter."
// The same pages say male patronymics shorten to "s". That is deliberately NOT
// covered: -son also ends ordinary English surnames (Johnson, Wilson), so the
// hint would fire on every English nil and suggest "Johns". -datter and -dotter
// end no English surname.
//
// Keyed on the surname, not on a collectionId: a per-collection quirks table is
// the record-type x country shape ruled out on issue #1967 (lead ruling on
// #3054, 2026-10-06).
//
// Deliberately import-free. The eval harness's mock runs this exact function out
// of the compiled build, inside a node process it already spawns, so the model
// under test sees what production sends rather than a hand-written copy.

/** Every input field that carries a surname, in `RecordSearchInput` order. The
 *  bride in the case that motivated this is not indexed as a principal at all —
 *  only `spouseSurname: "Halsteinsdr"` finds her — so `surname` alone would miss
 *  the shape the real index answers. */
export const SURNAME_FIELDS = [
  "surname",
  "spouseSurname",
  "fatherSurname",
  "motherSurname",
  "parentSurname",
  "otherSurname",
] as const;

export type SurnameField = (typeof SURNAME_FIELDS)[number];

/** Patronymic ending → its abbreviations, most common first. */
export const PATRONYMIC_ABBREVIATIONS: Readonly<Record<string, readonly string[]>> = {
  datter: ["dr", "dtr", "d"],
  dotter: ["dr", "dtr", "d"],
};

export interface SurnameVariantHint {
  field: SurnameField;
  /** The surname as the caller sent it, trimmed. */
  searched: string;
  variants: string[];
}

export interface SurnameVariantHints {
  fields: SurnameVariantHint[];
  note: string;
}

export const SURNAME_VARIANT_HINTS_NOTE =
  "This search did not find the subject under the surname(s) as written. " +
  "Scandinavian clerks abbreviated the patronymic ending -datter/-dotter " +
  "('daughter') as dr., dtr. or d., and indexes transcribe the abbreviation " +
  "without the period. Retry with each form listed below, placed in the SAME " +
  "field it replaces (not in surnameAlt), and in the same call as each " +
  "given-name spelling you are trying — an index that abbreviated the surname " +
  "may also have transcribed the given name differently — before concluding " +
  "the record is not indexed. These are spellings to TRY, not evidence: a " +
  "record found under one must still be evaluated as this person.";

/** The abbreviated forms of one surname, or [] when it is not a -datter/-dotter
 *  patronymic with at least one letter before the ending. */
export function patronymicVariants(surname: string): string[] {
  const trimmed = surname.trim();
  const lower = trimmed.toLowerCase();
  for (const [ending, abbreviations] of Object.entries(PATRONYMIC_ABBREVIATIONS)) {
    if (!lower.endsWith(ending)) continue;
    const stem = trimmed.slice(0, trimmed.length - ending.length);
    if (!/\p{L}/u.test(stem)) return [];
    const written = trimmed.slice(stem.length);
    const upper = written === written.toUpperCase();
    return abbreviations.map((a) => stem + (upper ? a.toUpperCase() : a));
  }
  return [];
}

/**
 * The hint for one search, or `undefined` when it does not apply. Holds the
 * whole rule — trigger and content — so the tool and the eval mock cannot
 * disagree about either.
 *
 * Fires when the search did not find its subject: no matches at all, or rows
 * that ranking judged to hold no match (`subjectResolvable: false`), the same
 * test `jurisdictionHints` uses. It needs no tree and no `projectPath`.
 */
export function surnameVariantHints(
  input: Partial<Record<SurnameField, unknown>>,
  out: {
    totalMatches?: unknown;
    ranked?: { subjectResolvable?: unknown } | null;
  },
): SurnameVariantHints | undefined {
  const foundNobody =
    out.totalMatches === 0 || out.ranked?.subjectResolvable === false;
  if (!foundNobody) return undefined;

  const fields: SurnameVariantHint[] = [];
  for (const field of SURNAME_FIELDS) {
    const value = input[field];
    if (typeof value !== "string") continue;
    const variants = patronymicVariants(value);
    if (variants.length > 0) {
      fields.push({ field, searched: value.trim(), variants });
    }
  }
  if (fields.length === 0) return undefined;
  return { fields, note: SURNAME_VARIANT_HINTS_NOTE };
}

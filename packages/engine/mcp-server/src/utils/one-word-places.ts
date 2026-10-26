import { bundledDataPath, readBundledText } from "./bundled-data.js";

/**
 * The one-word places the engine standardizes from evidence rather than from
 * FamilySearch's best search hit: `config/one-word-places.json`, rebuilt from
 * the lead's 2026-10-26 list by `dev/build-one-word-places.ts`. A key is a place
 * text folded by `foldPlaceKey`. Its value is the English full name of the
 * FamilySearch place the text standardizes to, alone when that holds on every
 * record, or with the one condition it carries (`OneWordEntry`).
 */
export const ONE_WORD_PLACES_PATH = bundledDataPath("one-word-places.json");

/**
 * A list entry: a full name applies on every record; `record_country` only to a
 * record of that country; `except_record_countries` to a record of any other
 * known country; `accented_spellings` only to a text written with one of those
 * accents ("Ísland" is Iceland, the English word "Island" is not a place).
 */
export type OneWordEntry =
  | string
  | { place: string; record_country: string }
  | { place: string; except_record_countries: string[] }
  | { place: string; accented_spellings: string[] };

/** Letters NFKD leaves whole, so the combining-mark strip cannot fold them. */
const UNDECOMPOSED: Record<string, string> = {
  "ø": "o", "æ": "ae", "œ": "oe", "ß": "ss", "ł": "l", "đ": "d", "ð": "d", "þ": "th", "ı": "i",
};

/** Periods and apostrophes dropped, other punctuation a space, a run of single
 *  letters joined: the tail both folds share. */
function joinWords(s: string): string {
  const out: string[] = [];
  let previousSingle = false;
  const words = s.replace(/[.'’‘`´]/g, "").replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/);
  for (const word of words.filter((w) => w.length > 0)) {
    const single = /^\p{L}$/u.test(word);
    if (single && previousSingle) out[out.length - 1] += word;
    else out.push(word);
    previousSingle = single;
  }
  return out.join(" ");
}

/**
 * The list's key for a place text, the same fold that built it (matcher-lab
 * `m13/scripts/common.py` `fold`): case, accents and whitespace folded; periods
 * and apostrophes dropped ("U.S.A." is "usa", "Prince Edward's" is "prince
 * edwards"); any other punctuation a space ("Baden-Württemberg" is "baden
 * wurttemberg"); a run of single letters joined ("U S A" is "usa").
 */
export function foldPlaceKey(text: string): string {
  return joinWords(
    text
      .normalize("NFKD")
      .replace(/\p{Mn}/gu, "")
      .toLowerCase()
      .replace(/ς/g, "σ")
      .replace(/[øæœßłđðþı]/g, (c) => UNDECOMPOSED[c]),
  );
}

/** `foldPlaceKey` with the letters kept as written (matcher-lab
 *  `m13/final2/fl2.py` `accent_key`): "Ísland" and "ÍSLAND" are "ísland",
 *  "Island" is "island". */
export function accentKey(text: string): string {
  return joinWords(text.normalize("NFC").toLowerCase());
}

let table: Map<string, OneWordEntry> | null = null;

/** The entry for a place text's key. Reads the bundled list on first use and
 *  throws when it cannot. */
function entryFor(text: string): OneWordEntry | undefined {
  if (!table) table = new Map(Object.entries(JSON.parse(readBundledText(ONE_WORD_PLACES_PATH)).entries));
  return table.get(foldPlaceKey(text));
}

/** The list holds the text under a condition on the record's country. */
export function oneWordPlaceNeedsCountry(text: string): boolean {
  const e = entryFor(text);
  return typeof e === "object" && ("record_country" in e || "except_record_countries" in e);
}

/**
 * The standard place the list gives a one-word place text in a record of
 * `recordCountry` (the English name of a country; null when it is unknown), or
 * null. An entry for one record country, or excepted in some, gives nothing
 * when the country is unknown.
 */
export function listedOneWordPlace(text: string, recordCountry: string | null = null): string | null {
  const e = entryFor(text);
  if (e === undefined) return null;
  if (typeof e === "string") return e;
  if ("accented_spellings" in e) {
    const written = accentKey(text);
    return e.accented_spellings.some((s) => accentKey(s) === written) ? e.place : null;
  }
  if ("record_country" in e) return recordCountry === e.record_country ? e.place : null;
  return recordCountry !== null && !e.except_record_countries.includes(recordCountry) ? e.place : null;
}

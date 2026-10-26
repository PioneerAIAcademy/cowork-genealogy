import { bundledDataPath, readBundledText } from "./bundled-data.js";

/**
 * The one-word places the engine standardizes from evidence rather than from
 * FamilySearch's best search hit: `config/one-word-places.json`, rebuilt from
 * the lead's 2026-10-26 list by `dev/build-one-word-places.ts`. A key is a place
 * text folded by `foldPlaceKey`; its value is the English full name of the
 * FamilySearch place the text standardizes to on every record.
 */
export const ONE_WORD_PLACES_PATH = bundledDataPath("one-word-places.json");

/** Letters NFKD leaves whole, so the combining-mark strip cannot fold them. */
const UNDECOMPOSED: Record<string, string> = {
  "ø": "o", "æ": "ae", "œ": "oe", "ß": "ss", "ł": "l", "đ": "d", "ð": "d", "þ": "th", "ı": "i",
};

/**
 * The list's key for a place text, the same fold that built it (matcher-lab
 * `m13/scripts/common.py` `fold`): case, accents and whitespace folded; periods
 * and apostrophes dropped ("U.S.A." is "usa", "Prince Edward's" is "prince
 * edwards"); any other punctuation a space ("Baden-Württemberg" is "baden
 * wurttemberg"); a run of single letters joined ("U S A" is "usa").
 */
export function foldPlaceKey(text: string): string {
  const s = text
    .normalize("NFKD")
    .replace(/\p{Mn}/gu, "")
    .toLowerCase()
    .replace(/ς/g, "σ")
    .replace(/[øæœßłđðþı]/g, (c) => UNDECOMPOSED[c])
    .replace(/[.'’‘`´]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ");
  const out: string[] = [];
  let previousSingle = false;
  for (const word of s.split(/\s+/).filter((w) => w.length > 0)) {
    const single = /^\p{L}$/u.test(word);
    if (single && previousSingle) out[out.length - 1] += word;
    else out.push(word);
    previousSingle = single;
  }
  return out.join(" ");
}

let table: Map<string, string> | null = null;

/** The standard place a one-word place text names on every record, or null when
 *  the list does not hold it. Reads the bundled list on first use and throws
 *  when it cannot. */
export function listedOneWordPlace(text: string): string | null {
  if (!table) {
    const entries: Record<string, string> = JSON.parse(readBundledText(ONE_WORD_PLACES_PATH)).entries;
    table = new Map(Object.entries(entries));
  }
  return table.get(foldPlaceKey(text)) ?? null;
}

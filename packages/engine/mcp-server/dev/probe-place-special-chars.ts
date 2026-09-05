/**
 * Probe: how should a place string carrying Lucene operator characters be sent
 * to FamilySearch's name search — as-is, backslash-escaped, or stripped?
 *
 * Queries the endpoint directly (four arms per case) rather than going through
 * `searchPlace`, so the as-is arm bypasses the sanitizer that lives there and
 * the comparison stays honest after the fix has landed.
 *
 *   npx tsx dev/probe-place-special-chars.ts
 *
 * Result (2026-08-20, `&`-to-word arm added 2026-09-04): stripping beats both
 * as-is and escaping on all five cases. Escaping is either a no-op (\& and \#
 * score identically to the bare character and return the same wrong place) or
 * fatal (\? and \* return HTTP 400) — FamilySearch does not honour Lucene
 * backslash escaping on this endpoint.
 *
 * But stripping is NOT what the code ships for `&`. `sanitizeForNameQuery`
 * maps it to the word "and" and drops the rest, so the fourth arm here is the
 * one to read for the `&` cases: the index treats the conjunction as a word,
 * and deleting it shortens the phrase until a parent name outscores the real
 * place. The Manila case is in `CASES` for exactly that — dropping the `&`
 * returns only the CITY, mapping it returns the cemetery.
 *
 * The arms are per-character on purpose. Do not read a result for one
 * character as a result for the others: `#` is safe to drop because the index
 * normalises it, and that is a fact about `#`.
 */
import { fetchWithTimeout } from "../src/utils/http.js";

const BASE = "https://api.familysearch.org/platform/places/search?q=";
const OPS = "&?*#!^~|";
const ESC = String.fromCharCode(92); // a single backslash

const escape = (s: string) =>
  [...s].map((c) => (OPS.includes(c) ? ESC + c : c)).join("");
const strip = (s: string) =>
  [...s].map((c) => (OPS.includes(c) ? " " : c)).join("").replace(/[ ]+/g, " ").trim();
// The arm the code actually ships (src/utils/place-api.ts): `&` becomes the
// word, every other operator is dropped. Kept as a separate arm rather than
// replacing `strip` so the two treatments stay comparable side by side.
const ampersandToWord = (s: string) =>
  strip(s.replace(/&/g, " and "));

async function top(name: string): Promise<string> {
  const url = BASE + "name:" + encodeURIComponent(`"${name}"`);
  try {
    const res = await fetchWithTimeout(url, {
      headers: { Accept: "application/x-gedcomx-atom+json" },
    });
    if (!res.ok) return `  HTTP ${res.status}`;
    const body = await res.text();
    const entries = (JSON.parse(body).entries ?? []) as any[];
    if (entries.length === 0) return "     -  (no candidates)";
    const p = entries[0].content.gedcomx.places[0];
    return `${String(entries[0].score ?? 0).padStart(6)}  ${p.display.fullName}`;
  } catch (e) {
    return `  ERR  ${(e as Error).message}`;
  }
}

// Real corpus strings, one per operator character. The Manila cemetery is the
// case that separates the two `&` treatments — it is the only corpus string
// FamilySearch already standardises correctly, and dropping the `&` loses it.
const CASES = [
  "Election Districts 7 & 9 Ogden city Ward 2, Weber, Utah, United States",
  "Great & Little Singleton, Kirkham, Lancashire, England",
  "Manila American Cemetery & Memorial, Manila, Metro Manila, National Capital Region, Philippines",
  "??Gren",
  "Marshall Sal*, Missouri, United States",
  "Alverson Cemetery #1, Carp, Montgomery Township, Owen, Indiana",
];

for (const raw of CASES) {
  console.log(`"${raw}"`);
  console.log(`   as-is    ${await top(raw)}`);
  console.log(`   escaped  ${await top(escape(raw))}`);
  console.log(`   stripped ${await top(strip(raw))}`);
  if (raw.includes("&")) {
    console.log(`   & -> and ${await top(ampersandToWord(raw))}   <- shipped`);
  }
  console.log();
}

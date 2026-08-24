/**
 * Probe: how should a place string carrying Lucene operator characters be sent
 * to FamilySearch's name search — as-is, backslash-escaped, or stripped?
 *
 * Queries the endpoint directly (three arms per case) rather than going through
 * `searchPlace`, so the as-is arm bypasses the sanitizer that lives there and
 * the comparison stays honest after the fix has landed.
 *
 *   npx tsx dev/probe-place-special-chars.ts
 *
 * Result (2026-08-20): stripping wins 5/5. Escaping is either a no-op (\& and
 * \# score identically to the bare character and return the same wrong place)
 * or fatal (\? and \* return HTTP 400). FamilySearch does not honour Lucene
 * backslash escaping on this endpoint.
 */
import { fetchWithTimeout } from "../src/utils/http.js";

const BASE = "https://api.familysearch.org/platform/places/search?q=";
const OPS = "&?*#!^~|";
const ESC = String.fromCharCode(92); // a single backslash

const escape = (s: string) =>
  [...s].map((c) => (OPS.includes(c) ? ESC + c : c)).join("");
const strip = (s: string) =>
  [...s].map((c) => (OPS.includes(c) ? " " : c)).join("").replace(/[ ]+/g, " ").trim();

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

// Real corpus strings, one per operator character.
const CASES = [
  "Election Districts 7 & 9 Ogden city Ward 2, Weber, Utah, United States",
  "Great & Little Singleton, Kirkham, Lancashire, England",
  "??Gren",
  "Marshall Sal*, Missouri, United States",
  "Alverson Cemetery #1, Carp, Montgomery Township, Owen, Indiana",
];

for (const raw of CASES) {
  console.log(`"${raw}"`);
  console.log(`   as-is    ${await top(raw)}`);
  console.log(`   escaped  ${await top(escape(raw))}`);
  console.log(`   stripped ${await top(strip(raw))}`);
  console.log();
}

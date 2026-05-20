/**
 * Probe: what data shape does the FamilySearch /personas search endpoint
 * actually return, and is it converted before reaching the LLM?
 *
 * Answers three questions empirically:
 *   1. Does FS send raw GedcomX?  -> prints entry.content.gedcomx untouched.
 *   2. Does toSimplified() produce a usable shape from it? -> prints the
 *      conversion.
 *   3. Does the search tool now carry the simplified gedcomx through to its
 *      output? -> prints the new `gedcomx` + `primaryId` fields on a
 *      SearchResult.
 *
 * Before the 10-match-two-examples branch, answer to #3 was "no" — the
 * search tool returned only flat summary fields and discarded the GedcomX.
 *
 * Requires a valid FS session (run the login tool first).
 *
 * Usage:
 *   npx tsx dev/probe-search-gedcomx.ts [surname] [givenName]
 *   npx tsx dev/probe-search-gedcomx.ts Martin James
 */
import { getValidToken } from "../src/auth/refresh.js";
import { BROWSER_USER_AGENT } from "../src/constants.js";
import { toSimplified } from "../src/utils/gedcomx-convert.js";
import { searchTool } from "../src/tools/search.js";
import type { GedcomX } from "../src/types/gedcomx.js";

const surname = process.argv[2] ?? "Martin";
const givenName = process.argv[3] ?? "James";

const FS_SEARCH_URL =
  "https://www.familysearch.org/service/search/hr/v2/personas";

function rule(label: string): void {
  console.log("\n" + "═".repeat(72));
  console.log(label);
  console.log("═".repeat(72));
}

const token = await getValidToken();

// ── 1. Raw FS payload ────────────────────────────────────────────────────
const url =
  `${FS_SEARCH_URL}?q.surname=${encodeURIComponent(surname)}` +
  `&q.givenName=${encodeURIComponent(givenName)}&count=2&offset=0` +
  `&m.queryRequireDefault=on&m.defaultFacets=off`;

const response = await fetch(url, {
  headers: {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "Accept-Language": "en",
    "User-Agent": BROWSER_USER_AGENT,
  },
});

if (!response.ok) {
  console.error(`FS search failed: ${response.status} ${response.statusText}`);
  process.exit(1);
}

const data = await response.json();
const firstEntry = data.entries?.[0];
if (!firstEntry) {
  console.error("No entries returned — try a different name.");
  process.exit(1);
}

rule("1. RAW — entry.content.gedcomx exactly as FamilySearch sent it");
console.log(JSON.stringify(firstEntry.content?.gedcomx, null, 2));

// ── 2. toSimplified() of that raw payload ────────────────────────────────
rule("2. CONVERTED — toSimplified() applied to the raw GedcomX above");
const simplified = toSimplified(
  firstEntry.content?.gedcomx as unknown as GedcomX,
);
console.log(JSON.stringify(simplified, null, 2));

// ── 3. What the search tool now hands to the LLM ─────────────────────────
rule("3. SEARCH TOOL OUTPUT — first result, with the new gedcomx/primaryId");
const toolResult = await searchTool({ surname, givenName, count: 2 });
const first = toolResult.results[0];
console.log("primaryId:", first?.primaryId);
console.log("gedcomx present:", first?.gedcomx !== undefined);
console.log(JSON.stringify(first?.gedcomx, null, 2));

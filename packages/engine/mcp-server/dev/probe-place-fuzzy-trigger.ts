/**
 * Probe (#4315): when should place_search fall back to its fuzzy leaf query
 * even though the exact query returned hits?
 *
 * Today the fuzzy fallback runs only on ZERO exact hits. A comma-qualified
 * query whose leaf is not in the authority ("Sierkopas, Germany") still gets
 * exact hits, because the phrase query matches the context segment, so the
 * fallback never runs and the caller gets the country.
 *
 * For each labelled query this prints the exact hits, the fuzzy hits on the
 * leaf, which candidate trigger would fire, and what the shipped placeSearch
 * returns (`SHIPPED`, read off its matchType). `want` is the hand label:
 *   exact — the exact path's answer is right; a trigger that fires is a misfire
 *   fuzzy — the leaf is misspelled or missing; a trigger must fire
 *
 *   npx tsx dev/probe-place-fuzzy-trigger.ts
 */
import { searchPlace, sanitizeForNameQuery, type SearchPlaceResult } from "../src/utils/place-api.js";
import { foldPlaceName as fold } from "../src/utils/place-resolver.js";
import { placeSearch } from "../src/tools/place-search.js";

type Want = "exact" | "fuzzy";
const CORPUS: Array<[string, Want, string]> = [
  // Missing or misspelled leaf, valid context: the fuzzy path is needed.
  ["Sierkopas, Germany", "fuzzy", "missing leaf"],
  ["Helvesieck, Germany", "fuzzy", "missing leaf"],
  ["Brixtol, England", "fuzzy", "typo"],
  ["Philidelphia, Pennsylvania", "fuzzy", "typo"],
  ["Chicgo, Illinois", "fuzzy", "typo"],
  ["Manchster, England", "fuzzy", "typo"],
  ["Liverpol, England", "exact", "typo the exact path already corrects"],
  ["Rehrersberg, Pennsylvania", "fuzzy", "typo"],
  ["Tulpehockan, Berks, Pennsylvania", "fuzzy", "typo"],
  ["Stockhom, Sweden", "fuzzy", "typo"],
  ["Amsterdm, Netherlands", "fuzzy", "typo"],
  ["Coshoctan, Ohio", "exact", "typo the exact path already corrects"],
  ["Xqzwvillage, Germany", "fuzzy", "missing leaf, fuzzy finds nothing either"],
  ["Limerik, Ireland", "fuzzy", "typo"],
  ["Bojnica, Slovakia", "fuzzy", "typo"],
  // Historical or alternate names: the exact path already answers correctly.
  ["Pressburg, Hungary", "exact", "historical"],
  ["Munchen, Germany", "exact", "historical"],
  ["Leghorn, Italy", "exact", "historical"],
  ["Konigsberg, Prussia", "exact", "historical"],
  ["Danzig, Prussia", "exact", "historical"],
  ["Breslau, Germany", "exact", "historical"],
  ["Christiania, Norway", "exact", "historical"],
  ["Lemberg, Austria", "exact", "historical"],
  ["Constantinople, Turkey", "exact", "historical"],
  ["Fiume, Hungary", "exact", "historical"],
  // City, county and state sharing a name.
  ["Philadelphia, Philadelphia, Pennsylvania", "exact", "homonym"],
  ["Cork, Cork, Ireland", "exact", "homonym"],
  ["New York, New York, New York", "exact", "homonym"],
  ["Lancaster, Lancaster, Pennsylvania", "exact", "homonym"],
  ["Baltimore, Baltimore, Maryland", "exact", "homonym"],
  ["Limerick, Limerick, Ireland", "exact", "homonym"],
  ["Galway, Galway, Ireland", "exact", "homonym"],
  // Ordinary well-formed places.
  ["Rehrersburg, Berks, Pennsylvania", "exact", "ordinary"],
  ["Bristol, England", "exact", "ordinary"],
  ["Tulpehocken, Berks, Pennsylvania", "exact", "ordinary"],
  ["Coshocton, Ohio", "exact", "ordinary"],
  ["Bergen, Hordaland, Norway", "exact", "ordinary"],
  ["Bojnice, Slovakia", "exact", "ordinary"],
  ["Reading, Berks, Pennsylvania", "exact", "ordinary"],
  ["Washington, Washington, Pennsylvania", "exact", "homonym"],
  // A jurisdiction as the leaf: the first hit IS the leaf.
  ["Berks, Pennsylvania", "exact", "county leaf"],
  ["Pennsylvania, United States", "exact", "state leaf"],
  ["Hordaland, Norway", "exact", "county leaf"],
  ["Cork, Ireland", "exact", "city/county leaf"],
  // A leaf that is not a place name: today's coarser answer is the right one.
  ["Hospital, Cincinnati, Ohio", "exact", "non-place leaf"],
  ["Farm, Berks, Pennsylvania", "exact", "non-place leaf"],
  ["Home, Cincinnati", "exact", "non-place leaf"],
  ["Residence, Ohio", "exact", "non-place leaf"],
  // Shapes callers send that the trigger is not built for (known misses).
  ["Rehrersberg, Berks County, Pennsylvania", "fuzzy", "typo, 'X County' context"],
  ["Tulpehockan, Berks Co., Pennsylvania", "fuzzy", "typo, 'X Co.' context"],
  ["Sierkopas, Deutschland", "fuzzy", "missing leaf, exonym context"],
  ["Wanrooij, Netherlands", "fuzzy", "variant spelling"],
  // A qualifier that is a substring of another place's name.
  ["Hospital, India", "exact", "non-place leaf, India inside Indiana"],
  ["Home, York", "exact", "non-place leaf, York inside New York"],
  ["Farm, Georgia", "exact", "non-place leaf, Georgia inside South Georgia"],
];

function segments(q: string): string[] {
  return sanitizeForNameQuery(q).split(",").map((s) => s.trim()).filter(Boolean);
}

type Trigger = (leaf: string, rest: string[], hits: SearchPlaceResult[]) => boolean;
const TRIGGERS: Record<string, Trigger> = {
  // Rejected on #3545: no exact hit's full name contains the leaf.
  T1_noHitHasLeaf: (leaf, _r, hits) => !hits.some((h) => fold(h.fullName).includes(fold(leaf))),
  // Rejected on #3545: every exact hit's name contains a non-leaf segment.
  T2_allHitsAreContext: (_l, rest, hits) =>
    hits.length > 0 && hits.every((h) => rest.some((s) => fold(h.name).includes(fold(s)))),
  // Reviewer's variant: T1 AND the first hit's name equals a non-leaf segment.
  T3_reviewer: (leaf, rest, hits) =>
    TRIGGERS.T1_noHitHasLeaf(leaf, rest, hits) &&
    hits.length > 0 && rest.some((s) => fold(hits[0].name) === fold(s)),
  // First hit's name equals a non-leaf segment and not the leaf.
  T4_firstHitIsContext: (leaf, rest, hits) =>
    hits.length > 0 &&
    fold(hits[0].name) !== fold(leaf) &&
    rest.some((s) => fold(hits[0].name) === fold(s)),
};

const tally: Record<string, { hit: number; misses: string[]; misfires: string[] }> = {};
for (const t of [...Object.keys(TRIGGERS), "SHIPPED"]) tally[t] = { hit: 0, misses: [], misfires: [] };

for (const [query, want, kind] of CORPUS) {
  const segs = segments(query);
  const leaf = segs[0];
  const rest = segs.slice(1);
  const exact = await searchPlace(query);
  const fuzzy = leaf.includes(" ") ? [] : await searchPlace(leaf, { fuzzy: true });
  const fired: string[] = [];
  for (const [name, fn] of Object.entries(TRIGGERS)) {
    if (exact.length > 0 && fn(leaf, rest, exact)) fired.push(name);
  }
  const shipped = await placeSearch(query);
  if (shipped.matchType === "fuzzy") fired.push("SHIPPED");
  for (const name of Object.keys(tally)) {
    const f = fired.includes(name);
    if (want === "fuzzy") f ? tally[name].hit++ : tally[name].misses.push(query);
    else if (f) tally[name].misfires.push(query);
  }
  console.log(`\n### ${query}   [want ${want}, ${kind}]`);
  console.log(`  exact (${exact.length}): ${exact.slice(0, 3).map((h) => h.fullName).join(" | ") || "-"}`);
  console.log(`  fuzzy (${fuzzy.length}): ${fuzzy.slice(0, 3).map((h) => h.fullName).join(" | ") || "-"}`);
  console.log(`  shipped placeSearch: ${shipped.results[0]?.fullName ?? "-"}${shipped.matchType ? " [fuzzy]" : ""}`);
  console.log(`  fires: ${fired.join(", ") || "none"}`);
}

const nFuzzy = CORPUS.filter((c) => c[1] === "fuzzy").length;
const nExact = CORPUS.length - nFuzzy;
console.log(`\n=== Summary: ${nFuzzy} need fuzzy, ${nExact} exact is right ===`);
for (const [t, s] of Object.entries(tally)) {
  console.log(`${t.padEnd(22)} catches ${s.hit}/${nFuzzy}   misfires ${s.misfires.length}/${nExact}`);
  if (s.misses.length) console.log(`    misses: ${s.misses.join("; ")}`);
  if (s.misfires.length) console.log(`    misfires: ${s.misfires.join("; ")}`);
}

/**
 * Probe — the places whose collections a `collections_search` on their own
 * standard place misses (`docs/specs/collections-search-tool-spec.md`, "Place →
 * collection scope").
 *
 * For each leading title part in the live catalog (the text before a title's
 * first comma) that leads at least MIN titles, resolve the part to FamilySearch's
 * standard place (`resolveStandardPlace`) and count how many of the titles it
 * leads that place's scope keeps (`collectionScopeMatcher`). A part whose
 * standard place nests it under another country ("England" is "England, United
 * Kingdom") can keep none of them: the scope rule has to name that place. A part
 * that is not a place ("Find A Grave Index") resolves to nothing, or to an
 * unrelated place, and is listed for a reader to set aside.
 *
 * Read-only. Run: npx tsx dev/probe-collection-scope-nesting.ts [minTitles=3]
 */

import { LOCAL } from "../src/auth/principal.js";
import { getValidToken } from "../src/auth/refresh.js";
import { fetchAllCollections } from "../src/tools/collections-search.js";
import { collectionScopeMatcher, standardPlaceToCollectionsQuery } from "../src/utils/collection-scope.js";
import { mapWithConcurrency, resolveStandardPlace } from "../src/utils/place-resolver.js";

const MIN_TITLES = Number(process.argv[2] ?? 3);

const data = await fetchAllCollections(await getValidToken(LOCAL), LOCAL);
const titles = (data.entries ?? [])
  .map((e) => e.content?.gedcomx?.collections?.[0]?.title)
  .filter((t): t is string => typeof t === "string");

const byLead = new Map<string, string[]>();
for (const title of titles) {
  const lead = title.split(",")[0].trim();
  const list = byLead.get(lead) ?? [];
  list.push(title);
  byLead.set(lead, list);
}
const leads = [...byLead].filter(([, list]) => list.length >= MIN_TITLES).sort((a, b) => b[1].length - a[1].length);
console.log(`catalog: ${titles.length} titles; ${byLead.size} leading parts; ${leads.length} lead at least ${MIN_TITLES}`);

const rows = await mapWithConcurrency(leads, 4, async ([lead, list]) => {
  const standard = await resolveStandardPlace(lead);
  if (standard === null) return { lead, titles: list.length, standard: null, scope: null, kept: null };
  const inScope = collectionScopeMatcher(standard);
  return {
    lead,
    titles: list.length,
    standard,
    scope: standardPlaceToCollectionsQuery(standard),
    kept: list.filter(inScope).length,
  };
});

const missed = rows.filter((r) => r.kept !== null && r.kept < r.titles);
const unresolved = rows.filter((r) => r.kept === null);
console.log(`\n== ${missed.length} parts whose own standard place keeps fewer than all the titles they lead`);
for (const r of missed) console.log(`  ${r.kept}/${r.titles}  "${r.lead}" -> ${r.standard} (scope "${r.scope}")`);
console.log(`\n== ${rows.length - missed.length - unresolved.length} parts kept whole`);
for (const r of rows) if (r.kept !== null && r.kept === r.titles) console.log(`  ${r.titles}  "${r.lead}" -> ${r.standard}`);
console.log(`\n== ${unresolved.length} parts that resolve to no standard place`);
for (const r of unresolved) console.log(`  ${r.titles}  "${r.lead}"`);

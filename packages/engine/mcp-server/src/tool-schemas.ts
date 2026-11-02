// Single source of truth for the tool schemas advertised by the MCP
// server. `index.ts` spreads this into its ListTools handler, and the
// packaging drift test (tests/packaging/manifest.test.ts) imports it to
// assert manifest.tools stays in sync with what's registered. Keeping it
// in its own module means the test can read the list without importing
// index.ts, which connects the stdio transport as a side effect.
import { volumeBisectSchema } from "./tools/volume-bisect.js";
import { catalogSearchSchema } from "./tools/catalog-search.js";
import { wikipediaSearchSchema } from "./tools/wikipedia.js";
import { researchDeliveredSchema } from "./tools/research-delivered.js";
import {
  placeSearchToolSchema,
  placeSearchAllToolSchema,
} from "./tools/place-search.js";
import { loginToolSchema } from "./tools/login.js";
import { logoutToolSchema } from "./tools/logout.js";
import { authStatusToolSchema } from "./tools/auth-status.js";
import { collectionsSearchToolSchema } from "./tools/collections-search.js";
import { wikiSearchSchema } from "./tools/wiki-search.js";
import { placeDistanceToolSchema } from "./tools/distance.js";
import { populationToolSchema } from "./tools/place-population.js";
import { externalLinksSearchToolSchema } from "./tools/external-links-search.js";
import { imageReadToolSchema } from "./tools/image-read.js";
import { imageTranscribeToolSchema } from "./tools/image-transcribe.js";
import { recordSearchToolSchema } from "./tools/record-search.js";
import { personSearchToolSchema } from "./tools/person-search.js";
import { personAncestorsToolSchema } from "./tools/person-ancestors.js";
import { treeGapsToolSchema } from "./tools/tree-gaps.js";
import { samePersonSchema } from "./tools/same-person.js";
import {
  personRecordMatchesSchema,
  recordPersonMatchesSchema,
  personPersonMatchesSchema,
  recordRecordMatchesSchema,
} from "./tools/match-by-id.js";
import { personReadToolSchema } from "./tools/person-read.js";
import { recordReadSchema } from "./tools/record-read.js";
import { fulltextSearchToolSchema } from "./tools/fulltext-search.js";
import { wikiReadSchema } from "./tools/wiki-read.js";
import { wikiPlacePageSchema } from "./tools/wiki-place-page.js";
import { validateResearchSchemaSchema } from "./tools/validate-research-schema.js";
import { sourceAttachmentsSchema } from "./tools/source-attachments.js";
import { imageSearchSchema } from "./tools/image-search.js";
import { personWarningsToolSchema } from "./tools/person-warnings.js";
import { personQualityToolSchema } from "./tools/person-quality.js";
import { mergeWarningsSchema } from "./tools/merge-warnings.js";
import { volumeSearchSchema } from "./tools/volume-search.js";
import { mergeTreePersonsSchema } from "./tools/merge-tree-persons.js";
import { researchLogAppendSchema } from "./tools/research-log-append.js";
import { convertCalendarSchema } from "./tools/convert-calendar.js";
import { censusChildrenGapSchema } from "./tools/census-children-gap.js";
import { timelineBuildSchema } from "./tools/timeline-build.js";
import { treeEditSchema } from "./tools/tree-edit.js";
import { treeCorrectSchema } from "./tools/tree-correct.js";
import { treeForgetSchema } from "./tools/tree-forget.js";
import { researchAppendSchema } from "./tools/research-append.js";
import { rankSearchMatchesSchema } from "./tools/rank-search-matches.js";
import { projectContextSchema } from "./tools/project-context.js";
import { projectListSchema } from "./tools/project-list.js";
import { materializeFactsSchema } from "./tools/materialize-facts.js";
import { extractionAppendSchema } from "./tools/extraction-append.js";
import { researchQuerySchema } from "./tools/research-query.js";
import { projectCreateSchema } from "./tools/project-create.js";
import { buildExternalSearchUrlSchema } from "./tools/build-external-search-url.js";
import { treeQuerySchema } from "./tools/tree-query.js";
import { sidecarReadSchema } from "./tools/sidecar-read.js";
import { getNameVariantsSchema } from "./tools/name-variants.js";

// Tools exempt from ToolSearch deferral: their schemas load up front instead of
// costing a ToolSearch turn each time. Sized against the September 2026 e2e corpus.
export const ALWAYS_LOAD: ReadonlySet<string> = new Set([
  "research_query", // loaded by the first genealogy ToolSearch of 34/34 runs
  "project_context", // loaded beside research_query in that same first ToolSearch
  "project_list", // the router's first call in every conversation that names no projectPath
  "research_append", // most-loaded tool; 76 of its 82 re-loads follow a compaction
  "research_log_append", // logs every search; 67 of its 68 re-loads follow a compaction
  "record_read", // 2.3 KB and loaded in 31/34 runs. record_search stays deferred at 20.6 KB
  // 802 B -- the 11th smallest of the 54 schemas the server ships, and under a third
  // of record_read above (2,363 B). Not the smallest: logout is 185 B.
  // Deferred, it costs a ToolSearch round trip at the one moment that must not
  // fail: a bounded turn ending. The hosted Stop hook allows that stop ONLY on
  // this call, so a model that has not loaded the schema gets nudged onward
  // instead (#2813 item 1).
  "research_delivered",
]);

// Tools Claude Code may run side by side (annotations.readOnlyHint): concurrent calls cannot corrupt
// project state and their order does not matter — pure reads, plus reads that only stage their own
// result file, append a log line, write external-collections.json under withProjectLock, or rewrite
// their own retained scan under images/.
export const READ_ONLY: ReadonlySet<string> = new Set([
  "auth_status",
  "catalog_search",
  "census_children_gap",
  "collections_search",
  "convert_calendar",
  "external_links_search",
  "fulltext_search",
  "get_name_variants",
  "image_read",
  "image_search",
  "image_transcribe",
  "merge_warnings",
  "person_ancestors",
  "person_person_matches",
  "person_quality",
  "person_read",
  "person_record_matches",
  "person_search",
  "person_warnings",
  "place_distance",
  "place_population",
  "place_search",
  "place_search_all",
  "project_context",
  "project_list",
  "rank_search_matches",
  "record_person_matches",
  "record_read",
  "record_record_matches",
  "record_search",
  "research_query",
  "sidecar_read",
  "source_attachments",
  "tree_gaps",
  "tree_query",
  "validate_research_schema",
  "volume_bisect",
  "volume_search",
  "wiki_place_page",
  "wiki_read",
  "wiki_search",
  "wikipedia_search",
]);

export const allToolSchemas = [
  catalogSearchSchema,
  volumeBisectSchema,
  wikipediaSearchSchema,
  placeSearchToolSchema,
  placeSearchAllToolSchema,
  loginToolSchema,
  logoutToolSchema,
  authStatusToolSchema,
  collectionsSearchToolSchema,
  wikiSearchSchema,
  placeDistanceToolSchema,
  populationToolSchema,
  externalLinksSearchToolSchema,
  imageReadToolSchema,
  imageTranscribeToolSchema,
  recordSearchToolSchema,
  personSearchToolSchema,
  personAncestorsToolSchema,
  treeGapsToolSchema,
  samePersonSchema,
  personRecordMatchesSchema,
  recordPersonMatchesSchema,
  personPersonMatchesSchema,
  recordRecordMatchesSchema,
  personReadToolSchema,
  recordReadSchema,
  fulltextSearchToolSchema,
  wikiReadSchema,
  wikiPlacePageSchema,
  validateResearchSchemaSchema,
  sourceAttachmentsSchema,
  imageSearchSchema,
  personWarningsToolSchema,
  personQualityToolSchema,
  mergeWarningsSchema,
  volumeSearchSchema,
  mergeTreePersonsSchema,
  researchLogAppendSchema,
  convertCalendarSchema,
  censusChildrenGapSchema,
  timelineBuildSchema,
  treeEditSchema,
  treeCorrectSchema,
  treeForgetSchema,
  researchAppendSchema,
  rankSearchMatchesSchema,
  projectContextSchema,
  treeQuerySchema,
  projectListSchema,
  materializeFactsSchema,
  extractionAppendSchema,
  researchQuerySchema,
  projectCreateSchema,
  buildExternalSearchUrlSchema,
  sidecarReadSchema,
  getNameVariantsSchema,
  researchDeliveredSchema,
];

// Set in place, not copied: ownership-manifest.test.ts matches schemas by object identity.
function mark(set: ReadonlySet<string>, setName: string, fields: object): void {
  for (const name of set) {
    const schema = allToolSchemas.find((s) => s.name === name);
    if (!schema) throw new Error(`${setName} names unknown tool "${name}"`);
    Object.assign(schema, fields);
  }
}
mark(ALWAYS_LOAD, "ALWAYS_LOAD", { _meta: { "anthropic/alwaysLoad": true } });
mark(READ_ONLY, "READ_ONLY", { annotations: { readOnlyHint: true } });

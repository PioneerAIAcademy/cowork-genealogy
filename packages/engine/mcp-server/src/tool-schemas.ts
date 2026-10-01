// Single source of truth for the tool schemas advertised by the MCP
// server. `index.ts` spreads this into its ListTools handler, and the
// packaging drift test (tests/packaging/manifest.test.ts) imports it to
// assert manifest.tools stays in sync with what's registered. Keeping it
// in its own module means the test can read the list without importing
// index.ts, which connects the stdio transport as a side effect.
import { volumeBisectSchema } from "./tools/volume-bisect.js";
import { wikipediaSearchSchema } from "./tools/wikipedia.js";
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
import { treeEditSchema } from "./tools/tree-edit.js";
import { treeCorrectSchema } from "./tools/tree-correct.js";
import { treeForgetSchema } from "./tools/tree-forget.js";
import { researchAppendSchema } from "./tools/research-append.js";
import { rankSearchMatchesSchema } from "./tools/rank-search-matches.js";
import { projectContextSchema } from "./tools/project-context.js";
import { materializeFactsSchema } from "./tools/materialize-facts.js";
import { extractionAppendSchema } from "./tools/extraction-append.js";
import { researchQuerySchema } from "./tools/research-query.js";
import { projectCreateSchema } from "./tools/project-create.js";
import { buildExternalSearchUrlSchema } from "./tools/build-external-search-url.js";
import { sidecarReadSchema } from "./tools/sidecar-read.js";
import { getNameVariantsSchema } from "./tools/name-variants.js";

// Tools exempt from ToolSearch deferral: their schemas load up front instead of
// costing a ToolSearch turn each time. Sized against the September 2026 e2e corpus.
export const ALWAYS_LOAD: ReadonlySet<string> = new Set([
  "research_query", // loaded by the first genealogy ToolSearch of 34/34 runs
  "project_context", // loaded beside research_query in that same first ToolSearch
  "research_append", // most-loaded tool; 76 of its 82 re-loads follow a compaction
  "research_log_append", // logs every search; 67 of its 68 re-loads follow a compaction
  "record_read", // 2.3 KB and loaded in 31/34 runs. record_search stays deferred at 18.5 KB
]);

export const allToolSchemas = [
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
  treeEditSchema,
  treeCorrectSchema,
  treeForgetSchema,
  researchAppendSchema,
  rankSearchMatchesSchema,
  projectContextSchema,
  materializeFactsSchema,
  extractionAppendSchema,
  researchQuerySchema,
  projectCreateSchema,
  buildExternalSearchUrlSchema,
  sidecarReadSchema,
  getNameVariantsSchema,
];

// Set in place, not copied: ownership-manifest.test.ts matches schemas by object identity.
for (const name of ALWAYS_LOAD) {
  const schema = allToolSchemas.find((s) => s.name === name);
  if (!schema) throw new Error(`ALWAYS_LOAD names unknown tool "${name}"`);
  Object.assign(schema, { _meta: { "anthropic/alwaysLoad": true } });
}

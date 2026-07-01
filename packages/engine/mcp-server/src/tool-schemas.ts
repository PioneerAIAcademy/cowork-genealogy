// Single source of truth for the tool schemas advertised by the MCP
// server. `index.ts` spreads this into its ListTools handler, and the
// packaging drift test (tests/packaging/manifest.test.ts) imports it to
// assert manifest.tools stays in sync with what's registered. Keeping it
// in its own module means the test can read the list without importing
// index.ts, which connects the stdio transport as a side effect.
import { wikipediaSearchSchema } from "./tools/wikipedia.js";
import {
  placeSearchToolSchema,
  placeSearchAllToolSchema,
} from "./tools/place-search.js";
import { loginToolSchema } from "./tools/login.js";
import { logoutToolSchema } from "./tools/logout.js";
import { authStatusToolSchema } from "./tools/auth-status.js";
import { collectionsSearchToolSchema } from "./tools/collections-search.js";
import { collectionReadToolSchema } from "./tools/collection-read.js";
import { wikiSearchSchema } from "./tools/wiki-search.js";
import { placeDistanceToolSchema } from "./tools/distance.js";
import { populationToolSchema } from "./tools/place-population.js";
import { externalLinksSearchToolSchema } from "./tools/external-links-search.js";
import { imageReadToolSchema } from "./tools/image-read.js";
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
import { mergeRecordIntoTreeSchema } from "./tools/merge-record-into-tree.js";
import { mergeTreePersonsSchema } from "./tools/merge-tree-persons.js";
import { researchLogAppendSchema } from "./tools/research-log-append.js";
import { convertCalendarSchema } from "./tools/convert-calendar.js";
import { treeEditSchema } from "./tools/tree-edit.js";
import { researchAppendSchema } from "./tools/research-append.js";

export const allToolSchemas = [
  wikipediaSearchSchema,
  placeSearchToolSchema,
  placeSearchAllToolSchema,
  loginToolSchema,
  logoutToolSchema,
  authStatusToolSchema,
  collectionsSearchToolSchema,
  collectionReadToolSchema,
  wikiSearchSchema,
  placeDistanceToolSchema,
  populationToolSchema,
  externalLinksSearchToolSchema,
  imageReadToolSchema,
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
  mergeRecordIntoTreeSchema,
  mergeTreePersonsSchema,
  researchLogAppendSchema,
  convertCalendarSchema,
  treeEditSchema,
  researchAppendSchema,
];

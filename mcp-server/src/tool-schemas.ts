// Single source of truth for the tool schemas advertised by the MCP
// server. `index.ts` spreads this into its ListTools handler, and the
// packaging drift test (tests/packaging/manifest.test.ts) imports it to
// assert manifest.tools stays in sync with what's registered. Keeping it
// in its own module means the test can read the list without importing
// index.ts, which connects the stdio transport as a side effect.
import { wikipediaSearchSchema } from "./tools/wikipedia.js";
import { placeSearchToolSchema } from "./tools/place-search.js";
import { loginToolSchema } from "./tools/login.js";
import { logoutToolSchema } from "./tools/logout.js";
import { authStatusToolSchema } from "./tools/auth-status.js";
import { placeCollectionsToolSchema } from "./tools/place-collections.js";
import { wikiSearchSchema } from "./tools/wiki-search.js";
import { placeDistanceToolSchema } from "./tools/distance.js";
import { populationToolSchema } from "./tools/place-population.js";
import { placeExternalLinksToolSchema } from "./tools/place-external-links.js";
import { imageReadToolSchema } from "./tools/image-read.js";
import { recordSearchToolSchema } from "./tools/record-search.js";
import { matchTwoExamplesSchema } from "./tools/match-two-examples.js";
import {
  personRecordMatchesSchema,
  recordPersonMatchesSchema,
  personPersonMatchesSchema,
  recordRecordMatchesSchema,
} from "./tools/match-by-id.js";
import { treeReadToolSchema } from "./tools/tree-read.js";
import { fulltextSearchToolSchema } from "./tools/fulltext-search.js";
import { wikiReadSchema } from "./tools/wiki-read.js";
import {
  wikiCountryHomeSchema,
  wikiCountryGettingStartedSchema,
  wikiCountryOnlineRecordsSchema,
  wikiCountryResearchTipsSchema,
} from "./tools/wiki-country-page.js";
import { validateResearchSchemaSchema } from "./tools/validate-research-schema.js";

export const allToolSchemas = [
  wikipediaSearchSchema,
  placeSearchToolSchema,
  loginToolSchema,
  logoutToolSchema,
  authStatusToolSchema,
  placeCollectionsToolSchema,
  wikiSearchSchema,
  placeDistanceToolSchema,
  populationToolSchema,
  placeExternalLinksToolSchema,
  imageReadToolSchema,
  recordSearchToolSchema,
  matchTwoExamplesSchema,
  personRecordMatchesSchema,
  recordPersonMatchesSchema,
  personPersonMatchesSchema,
  recordRecordMatchesSchema,
  treeReadToolSchema,
  fulltextSearchToolSchema,
  wikiReadSchema,
  wikiCountryHomeSchema,
  wikiCountryGettingStartedSchema,
  wikiCountryOnlineRecordsSchema,
  wikiCountryResearchTipsSchema,
  validateResearchSchemaSchema,
];

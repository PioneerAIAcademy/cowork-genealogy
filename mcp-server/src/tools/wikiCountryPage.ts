import { getPlaceById } from "./places.js";
import { fetchAndCacheWikiPage } from "./wikiFetchPage.js";
import type { WikiCountryInput, WikiCountryResult } from "../types/wikiPage.js";

const FS_WIKI_BASE = "https://www.familysearch.org/en/wiki";

function buildWikiUrl(name: string, suffix: string): string {
  const slug = name.trim().replace(/ /g, "_");
  return `${FS_WIKI_BASE}/${slug}${suffix}`;
}

async function fetchCountryPage(
  input: WikiCountryInput,
  suffix: string
): Promise<WikiCountryResult> {
  const place = await getPlaceById(input.placeRepId);
  if (!place) {
    throw new Error(`No place found for placeRepId: ${input.placeRepId}`);
  }
  const url = buildWikiUrl(place.name, suffix);
  const result = await fetchAndCacheWikiPage(url);
  return { ...result, placeRepId: input.placeRepId, placeName: place.name };
}

const PLACE_REP_ID_SCHEMA = {
  type: "object" as const,
  properties: {
    placeRepId: {
      type: "string",
      description: "The FamilySearch place rep ID (from the places tool output)",
    },
  },
  required: ["placeRepId"],
};

export async function wikiCountryHomeTool(input: WikiCountryInput): Promise<WikiCountryResult> {
  return fetchCountryPage(input, "_Genealogy");
}

export const wikiCountryHomeSchema = {
  name: "wiki_country_home",
  description:
    "Return the FamilySearch wiki homepage for a country, US state, or Canadian province. Given a place rep ID (from the places tool), fetches the main Genealogy overview page (e.g. Portugal_Genealogy) and returns it as markdown. Cached locally after the first fetch.",
  inputSchema: PLACE_REP_ID_SCHEMA,
};

export async function wikiCountryGettingStartedTool(
  input: WikiCountryInput
): Promise<WikiCountryResult> {
  return fetchCountryPage(input, "_Getting_Started");
}

export const wikiCountryGettingStartedSchema = {
  name: "wiki_country_getting_started",
  description:
    "Return the FamilySearch wiki Getting Started guide for a country, US state, or Canadian province. Given a place rep ID (from the places tool), fetches the Getting Started page (e.g. Portugal_Getting_Started) and returns it as markdown. Cached locally after the first fetch.",
  inputSchema: PLACE_REP_ID_SCHEMA,
};

export async function wikiCountryRecordsTool(
  input: WikiCountryInput
): Promise<WikiCountryResult> {
  return fetchCountryPage(input, "_Online_Genealogy_Records");
}

export const wikiCountryRecordsSchema = {
  name: "wiki_country_records",
  description:
    "Return the FamilySearch wiki Online Genealogy Records page for a country, US state, or Canadian province. Given a place rep ID (from the places tool), fetches the Online Genealogy Records page (e.g. Portugal_Online_Genealogy_Records) and returns it as markdown. Cached locally after the first fetch.",
  inputSchema: PLACE_REP_ID_SCHEMA,
};

export async function wikiCountryResearchTipsTool(
  input: WikiCountryInput
): Promise<WikiCountryResult> {
  return fetchCountryPage(input, "_Research_Tips_and_Strategies");
}

export const wikiCountryResearchTipsSchema = {
  name: "wiki_country_research_tips",
  description:
    "Return the FamilySearch wiki Research Tips and Strategies page for a country, US state, or Canadian province. Given a place rep ID (from the places tool), fetches the Research Tips and Strategies page (e.g. Portugal_Research_Tips_and_Strategies) and returns it as markdown. Cached locally after the first fetch.",
  inputSchema: PLACE_REP_ID_SCHEMA,
};

export type { WikiCountryInput };

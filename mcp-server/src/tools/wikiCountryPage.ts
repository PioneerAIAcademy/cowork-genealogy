import { readFile } from "fs/promises";
import { join } from "path";
import { getPlaceByPrimaryId } from "./places.js";
import { getWikiMarkdownDir } from "../auth/config.js";
import type { WikiCountryInput, WikiCountryResult } from "../types/wikiPage.js";

const FS_WIKI_BASE = "https://www.familysearch.org/en/wiki";

function nameToSlug(name: string): string {
  return name.trim().replace(/ /g, "_");
}

async function tryReadFile(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

async function readCountryPage(
  placeId: string,
  getCandidateSlugs: (nameSlug: string) => string[]
): Promise<WikiCountryResult> {
  const place = await getPlaceByPrimaryId(placeId);
  if (!place) {
    throw new Error(`No place found for placeId: ${placeId}`);
  }

  const wikiDir = await getWikiMarkdownDir();
  const nameSlug = nameToSlug(place.name);
  const slugCandidates = getCandidateSlugs(nameSlug);

  for (const slug of slugCandidates) {
    const content = await tryReadFile(join(wikiDir, `${slug}.md`));
    if (content !== null) {
      return { url: `${FS_WIKI_BASE}/${slug}`, content, placeId, placeName: place.name };
    }
  }

  throw new Error(
    `No wiki page found for "${place.name}". Tried: ${slugCandidates.map((s) => s + ".md").join(", ")}`
  );
}

const PLACE_ID_SCHEMA = {
  type: "object" as const,
  properties: {
    placeId: {
      type: "string",
      description: "The FamilySearch place ID (the `placeId` field from the places tool output)",
    },
  },
  required: ["placeId"],
};

export async function wikiCountryHomeTool(input: WikiCountryInput): Promise<WikiCountryResult> {
  return readCountryPage(input.placeId, (nameSlug) => [
    `${nameSlug}_Genealogy`,
    `${nameSlug},_Canada_Genealogy`,
  ]);
}

export const wikiCountryHomeSchema = {
  name: "wiki_country_home",
  description:
    "Return the FamilySearch wiki homepage for a country, US state, or Canadian province. " +
    "Given a place ID (from the places tool), reads the main Genealogy overview page " +
    "(e.g. Portugal_Genealogy) from the pre-crawled wiki files and returns it as markdown.",
  inputSchema: PLACE_ID_SCHEMA,
};

export async function wikiCountryGettingStartedTool(
  input: WikiCountryInput
): Promise<WikiCountryResult> {
  return readCountryPage(input.placeId, (nameSlug) => [`${nameSlug}_Getting_Started`]);
}

export const wikiCountryGettingStartedSchema = {
  name: "wiki_country_getting_started",
  description:
    "Return the FamilySearch wiki Getting Started guide for a country, US state, or Canadian province. " +
    "Given a place ID (from the places tool), reads the Getting Started page " +
    "(e.g. Portugal_Getting_Started) from the pre-crawled wiki files and returns it as markdown.",
  inputSchema: PLACE_ID_SCHEMA,
};

export async function wikiCountryRecordsTool(
  input: WikiCountryInput
): Promise<WikiCountryResult> {
  return readCountryPage(input.placeId, (nameSlug) => [`${nameSlug}_Online_Genealogy_Records`]);
}

export const wikiCountryRecordsSchema = {
  name: "wiki_country_records",
  description:
    "Return the FamilySearch wiki Online Genealogy Records page for a country, US state, or Canadian province. " +
    "Given a place ID (from the places tool), reads the Online Genealogy Records page " +
    "(e.g. Portugal_Online_Genealogy_Records) from the pre-crawled wiki files and returns it as markdown.",
  inputSchema: PLACE_ID_SCHEMA,
};

export async function wikiCountryResearchTipsTool(
  input: WikiCountryInput
): Promise<WikiCountryResult> {
  return readCountryPage(input.placeId, (nameSlug) => [
    `${nameSlug}_Research_Tips_and_Strategies`,
  ]);
}

export const wikiCountryResearchTipsSchema = {
  name: "wiki_country_research_tips",
  description:
    "Return the FamilySearch wiki Research Tips and Strategies page for a country, US state, or Canadian province. " +
    "Given a place ID (from the places tool), reads the Research Tips and Strategies page " +
    "(e.g. Portugal_Research_Tips_and_Strategies) from the pre-crawled wiki files and returns it as markdown.",
  inputSchema: PLACE_ID_SCHEMA,
};

export type { WikiCountryInput };

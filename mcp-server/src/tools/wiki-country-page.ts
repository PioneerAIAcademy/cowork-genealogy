import { readFile } from "fs/promises";
import { join } from "path";
import { getPlaceCandidateNames } from "./place-search.js";
import { standardPlaceToPlaceId } from "../utils/place-resolver.js";
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

/**
 * Build the candidate English names to try as wiki-slug bases for a standard
 * place. The standard place's own leaf segment (e.g. "Minnesota" from
 * "Minnesota, United States") is always tried first; resolving the name to a
 * placeId yields additional variants from the places API (which handles places
 * whose canonical wiki name differs from the leaf, plus alternate spellings).
 */
async function candidateNamesFor(standardPlace: string): Promise<string[]> {
  const names: string[] = [];
  const leaf = standardPlace.split(",")[0].trim();
  if (leaf) names.push(leaf);

  const placeId = await standardPlaceToPlaceId(standardPlace);
  if (placeId) {
    for (const name of await getPlaceCandidateNames(placeId)) {
      if (!names.includes(name)) names.push(name);
    }
  }
  return names;
}

async function readCountryPage(
  standardPlace: string,
  getCandidateSlugs: (nameSlug: string) => string[]
): Promise<WikiCountryResult> {
  const candidateNames = await candidateNamesFor(standardPlace);
  if (candidateNames.length === 0) {
    throw new Error(`No place found for: ${standardPlace}`);
  }

  const wikiDir = await getWikiMarkdownDir();

  // Try every candidate name. The file-existence check is the reliable filter —
  // only the canonical name has a matching pre-crawled wiki file.
  for (const name of candidateNames) {
    const nameSlug = nameToSlug(name);
    for (const slug of getCandidateSlugs(nameSlug)) {
      const content = await tryReadFile(join(wikiDir, `${slug}.md`));
      if (content !== null) {
        return {
          url: `${FS_WIKI_BASE}/${slug}`,
          content,
          standardPlace,
          placeName: name,
        };
      }
    }
  }

  const tried = candidateNames.slice(0, 5).join(", ");
  throw new Error(
    `No wiki page found for "${standardPlace}". Tried names: ${tried}${candidateNames.length > 5 ? " (and more)" : ""}`
  );
}

const STANDARD_PLACE_SCHEMA = {
  type: "object" as const,
  properties: {
    standardPlace: {
      type: "string",
      description:
        'The standard place name (the `standardPlace` field from place_search), ' +
        'e.g. "Portugal" or "Minnesota, United States". Works for countries, ' +
        "US states, and Canadian provinces.",
    },
  },
  required: ["standardPlace"],
};

export async function wikiCountryHomeTool(input: WikiCountryInput): Promise<WikiCountryResult> {
  return readCountryPage(input.standardPlace, (nameSlug) => [
    `${nameSlug}_Genealogy`,                    // countries: Portugal_Genealogy
    `${nameSlug},_Canada_Genealogy`,            // Canadian provinces: Manitoba,_Canada_Genealogy
    `${nameSlug},_United_States_Genealogy`,     // US states: Minnesota,_United_States_Genealogy
  ]);
}

export const wikiCountryHomeSchema = {
  name: "wiki_country_home",
  description:
    "Return the FamilySearch wiki homepage for a country, US state, or Canadian province. " +
    "Given a standard place name (from place_search), reads the main Genealogy overview page " +
    "(e.g. Portugal_Genealogy) from the pre-crawled wiki files and returns it as markdown.",
  inputSchema: STANDARD_PLACE_SCHEMA,
};

export async function wikiCountryGettingStartedTool(
  input: WikiCountryInput
): Promise<WikiCountryResult> {
  return readCountryPage(input.standardPlace, (nameSlug) => [`${nameSlug}_Getting_Started`]);
}

export const wikiCountryGettingStartedSchema = {
  name: "wiki_country_getting_started",
  description:
    "Return the FamilySearch wiki Getting Started guide for a country, US state, or Canadian province. " +
    "Given a standard place name (from place_search), reads the Getting Started page " +
    "(e.g. Portugal_Getting_Started) from the pre-crawled wiki files and returns it as markdown.",
  inputSchema: STANDARD_PLACE_SCHEMA,
};

export async function wikiCountryOnlineRecordsTool(
  input: WikiCountryInput
): Promise<WikiCountryResult> {
  return readCountryPage(input.standardPlace, (nameSlug) => [`${nameSlug}_Online_Genealogy_Records`]);
}

export const wikiCountryOnlineRecordsSchema = {
  name: "wiki_country_online_records",
  description:
    "Return the FamilySearch wiki Online Genealogy Records page for a country, US state, or Canadian province. " +
    "Given a standard place name (from place_search), reads the Online Genealogy Records page " +
    "(e.g. Portugal_Online_Genealogy_Records) from the pre-crawled wiki files and returns it as markdown.",
  inputSchema: STANDARD_PLACE_SCHEMA,
};

export async function wikiCountryResearchTipsTool(
  input: WikiCountryInput
): Promise<WikiCountryResult> {
  return readCountryPage(input.standardPlace, (nameSlug) => [
    `${nameSlug}_Research_Tips_and_Strategies`,
  ]);
}

export const wikiCountryResearchTipsSchema = {
  name: "wiki_country_research_tips",
  description:
    "Return the FamilySearch wiki Research Tips and Strategies page for a country, US state, or Canadian province. " +
    "Given a standard place name (from place_search), reads the Research Tips and Strategies page " +
    "(e.g. Portugal_Research_Tips_and_Strategies) from the pre-crawled wiki files and returns it as markdown.",
  inputSchema: STANDARD_PLACE_SCHEMA,
};

export type { WikiCountryInput };

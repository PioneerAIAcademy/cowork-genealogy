import { readFile } from "fs/promises";
import { join } from "path";
import { getPlaceCandidateNames } from "./place-search.js";
import { standardPlaceToPlaceId } from "../utils/place-resolver.js";
import { getWikiMarkdownDir } from "../auth/config.js";
import type {
  WikiPlacePageInput,
  WikiPlacePageResult,
  WikiPageSection,
} from "../types/wikiPage.js";

const FS_WIKI_BASE = "https://www.familysearch.org/en/wiki";

function nameToSlug(name: string): string {
  return name.trim().replace(/ /g, "_");
}

// Build the candidate page slugs for a given section. The "home" section has
// three jurisdiction-shaped variants (country / Canadian province / US state);
// the other three sections each read a single suffixed page.
function candidateSlugsFor(
  section: WikiPageSection,
  nameSlug: string
): string[] {
  switch (section) {
    case "home":
      return [
        `${nameSlug}_Genealogy`, // countries: Portugal_Genealogy
        `${nameSlug},_Canada_Genealogy`, // Canadian provinces: Manitoba,_Canada_Genealogy
        `${nameSlug},_United_States_Genealogy`, // US states: Minnesota,_United_States_Genealogy
      ];
    case "getting_started":
      return [`${nameSlug}_Getting_Started`];
    case "online_records":
      return [`${nameSlug}_Online_Genealogy_Records`];
    case "research_tips":
      return [`${nameSlug}_Research_Tips_and_Strategies`];
  }
}

async function tryReadFile(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

/**
 * Try a list of candidate place names against the local pre-crawled wiki
 * corpus, returning the first matching page or null. Pure file reads — the
 * file-existence check is the reliable filter (only the canonical name has a
 * matching file). No network.
 */
async function tryNames(
  names: string[],
  getCandidateSlugs: (nameSlug: string) => string[],
  wikiDir: string,
  standardPlace: string
): Promise<WikiPlacePageResult | null> {
  for (const name of names) {
    const nameSlug = nameToSlug(name);
    for (const slug of getCandidateSlugs(nameSlug)) {
      const content = await tryReadFile(join(wikiDir, `${slug}.md`));
      if (content !== null) {
        return { url: `${FS_WIKI_BASE}/${slug}`, content, standardPlace, placeName: name };
      }
    }
  }
  return null;
}

async function readPlacePage(
  standardPlace: string,
  getCandidateSlugs: (nameSlug: string) => string[]
): Promise<WikiPlacePageResult> {
  if (!standardPlace || typeof standardPlace !== "string" || !standardPlace.trim()) {
    throw new Error(
      "standardPlace is required and must be a non-empty string. " +
        "Pass the standardPlace name (from place_search)."
    );
  }

  const wikiDir = await getWikiMarkdownDir();
  const leaf = standardPlace.split(",")[0].trim();

  // 1) Common case: try the standard place's own leaf name against the local
  //    wiki files first — no network (e.g. "Portugal" -> Portugal_Genealogy.md).
  if (leaf) {
    const hit = await tryNames([leaf], getCandidateSlugs, wikiDir, standardPlace);
    if (hit) return hit;
  }

  // 2) Fallback: only when every leaf slug misses, resolve to a placeId and try
  //    the places API's alternate name variants (handles places whose canonical
  //    wiki name differs from the leaf). Two network round-trips, paid rarely.
  const placeId = await standardPlaceToPlaceId(standardPlace);
  if (placeId) {
    const variants = (await getPlaceCandidateNames(placeId)).filter((n) => n !== leaf);
    const hit = await tryNames(variants, getCandidateSlugs, wikiDir, standardPlace);
    if (hit) return hit;
  }

  throw new Error(`No wiki page found for "${standardPlace}".`);
}

export async function wikiPlacePageTool(
  input: WikiPlacePageInput
): Promise<WikiPlacePageResult> {
  const { standardPlace, section } = input;
  if (!section) {
    throw new Error(
      "section is required: one of 'home', 'getting_started', " +
        "'online_records', or 'research_tips'."
    );
  }
  return readPlacePage(standardPlace, (nameSlug) =>
    candidateSlugsFor(section, nameSlug)
  );
}

export const wikiPlacePageSchema = {
  name: "wiki_place_page",
  description:
    "Return a FamilySearch Research Wiki page for a place (country, US state, " +
    "or Canadian province). Provide a standardPlace from place_search and the " +
    "section you want. Reads the pre-crawled wiki markdown for that jurisdiction " +
    "and returns it. The wiki corpus covers the country level everywhere, plus " +
    "the state/province level for the US and Canada; for a more specific place " +
    "(county, town) no page exists — broaden the standardPlace one jurisdiction " +
    "(see places guidance) and call again.",
  inputSchema: {
    type: "object" as const,
    properties: {
      standardPlace: {
        type: "string",
        description:
          "Standard place name (the `standardPlace` field from place_search).",
      },
      section: {
        type: "string",
        enum: ["home", "getting_started", "online_records", "research_tips"],
        description:
          "Which wiki page to return: 'home' (genealogy overview), " +
          "'getting_started', 'online_records' (online genealogy records), or " +
          "'research_tips' (research strategies).",
      },
    },
    required: ["standardPlace", "section"],
  },
};

export type { WikiPlacePageInput };

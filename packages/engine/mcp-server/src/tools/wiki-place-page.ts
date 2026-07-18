import { getPlaceCandidateNames } from "./place-search.js";
import { standardPlaceToPlaceId } from "../utils/place-resolver.js";
import { getWikiApiUrl } from "../auth/config.js";
import type {
  WikiPlacePageInput,
  WikiPlacePageResult,
  WikiPageSection,
} from "../types/wikiPage.js";

const FS_WIKI_BASE = "https://www.familysearch.org/en/wiki";

interface PageApiResponse {
  title: string;
  content: string;
  source_url: string;
}

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

/**
 * GET {WIKI_API_URL}/page/{slug}.
 * Returns the response body on 200, null on 404 (so the caller can try
 * the next candidate), and throws on network failure or any other
 * non-OK status (a transient 5xx must not be silently treated as
 * "page not found").
 */
async function fetchPage(
  baseUrl: string,
  slug: string
): Promise<PageApiResponse | null> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/page/${slug}`, {
      method: "GET",
      headers: { "User-Agent": "genealogy-mcp-server/0.0.1" },
    });
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Could not reach wiki-query-api at ${baseUrl}. Is the server running? (${cause})`
    );
  }

  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`wiki-query-api error: ${response.status}`);
  }
  return (await response.json()) as PageApiResponse;
}

/**
 * Try a list of candidate place names against the wiki-query-api server,
 * returning the first matching page or null. The server's 404 is the
 * reliable filter (only the canonical name has a corresponding page in
 * the corpus).
 */
async function tryNames(
  names: string[],
  getCandidateSlugs: (nameSlug: string) => string[],
  baseUrl: string,
  standardPlace: string
): Promise<WikiPlacePageResult | null> {
  for (const name of names) {
    const nameSlug = nameToSlug(name);
    for (const slug of getCandidateSlugs(nameSlug)) {
      const page = await fetchPage(baseUrl, slug);
      if (page !== null) {
        return {
          url: `${FS_WIKI_BASE}/${slug}`,
          content: page.content,
          standardPlace,
          placeName: name,
        };
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

  const baseUrl = await getWikiApiUrl();
  const leaf = standardPlace.split(",")[0].trim();

  // 1) Common case: try the standard place's own leaf name against the
  //    server first (e.g. "Portugal" -> Portugal_Genealogy).
  if (leaf) {
    const hit = await tryNames([leaf], getCandidateSlugs, baseUrl, standardPlace);
    if (hit) return hit;
  }

  // 2) Fallback: only when every leaf slug misses, resolve to a placeId and try
  //    the places API's alternate name variants (handles places whose canonical
  //    wiki name differs from the leaf). Two network round-trips, paid rarely.
  const placeId = await standardPlaceToPlaceId(standardPlace);
  if (placeId) {
    const variants = (await getPlaceCandidateNames(placeId)).filter((n) => n !== leaf);
    const hit = await tryNames(variants, getCandidateSlugs, baseUrl, standardPlace);
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
    "section you want. Fetches the markdown for that jurisdiction from the " +
    "hosted wiki-query-api server. The wiki corpus covers the country level " +
    "everywhere, plus the state/province level for the US and Canada; for a " +
    "more specific place (county, town) no page exists — broaden the " +
    "standardPlace one jurisdiction (see places guidance) and call again.",
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

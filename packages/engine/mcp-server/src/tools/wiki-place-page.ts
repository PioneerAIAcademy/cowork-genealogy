import type { Principal } from "../auth/principal.js";
import { getPlaceCandidateNames } from "./place-search.js";
import { standardPlaceToPlaceId, standardPlaceToRepId } from "../utils/place-resolver.js";
import { getPlaceById } from "../utils/place-api.js";
import { homeTitleShape, typeWordFits } from "../utils/wiki-home-title.js";
import { WIKI_SEARCH_TIMEOUT_MS } from "./wiki-search.js";
import type { WikiSearchAPIResponse } from "../types/wiki-search.js";
import { getWikiApiUrl } from "../auth/config.js";
import { describeFetchError, fetchWithRetry } from "../utils/http.js";
import { VALIDATOR_ENUMS } from "../validation/validator.js";
import type {
  WikiPlacePageInput,
  WikiPlacePageResult,
  WikiPageSection,
} from "../types/wikiPage.js";

const FS_WIKI_BASE = "https://www.familysearch.org/en/wiki";

// The four wiki place-page sections — the `locality_page_section` closed enum,
// which the skill records into research.json `pages_read[].section`.
const SECTIONS = VALIDATOR_ENUMS.locality_page_section;

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
    response = await fetchWithRetry(`${baseUrl}/page/${slug}`, {
      method: "GET",
      headers: { "User-Agent": "genealogy-mcp-server/0.0.1" },
    });
  } catch (error) {
    throw new Error(
      `Could not reach wiki-query-api at ${baseUrl} (${describeFetchError(error)}).`
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

/**
 * Ranked page titles from the wiki's own search, de-duplicated in rank order.
 * The wiki-query-api has no title-lookup endpoint, so this is how a sub-state
 * page's real title (`Schuylkill County, Pennsylvania Genealogy`) is found.
 * Fails like `fetchPage`: an unreachable server or a non-OK status throws, so an
 * outage is never reported as "no page".
 */
async function searchTitles(baseUrl: string, query: string): Promise<string[]> {
  let response: Response;
  try {
    response = await fetchWithRetry(
      `${baseUrl}/search`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "genealogy-mcp-server/0.0.1",
        },
        body: JSON.stringify({ query }),
      },
      WIKI_SEARCH_TIMEOUT_MS
    );
  } catch (error) {
    throw new Error(
      `Could not reach wiki-query-api at ${baseUrl} (${describeFetchError(error)}).`
    );
  }
  if (!response.ok) {
    throw new Error(`wiki-query-api error: ${response.status}`);
  }
  const data = (await response.json()) as WikiSearchAPIResponse;
  const titles: string[] = [];
  for (const item of data.results ?? []) {
    if (item.page_title && !titles.includes(item.page_title)) titles.push(item.page_title);
  }
  return titles;
}

/**
 * The Places API `type` of the place (`County`, `Independent City`, `Lutheran
 * Parish`). Null when the name does not resolve to one place or the lookup
 * fails — and null rejects every title carrying a type word, so a failed lookup
 * can only cost a page, never return the wrong jurisdiction's.
 */
async function placeTypeOf(standardPlace: string): Promise<string | null> {
  try {
    const repId = await standardPlaceToRepId(standardPlace);
    if (!repId) return null;
    return (await getPlaceById(repId))?.type ?? null;
  } catch {
    return null;
  }
}

/**
 * The home page of a sub-national place, resolved from its real wiki title. The
 * ranked titles are matched against the leaf first, then against the place's
 * names in every language: the wiki titles some provinces by their local name
 * (`South Holland, Netherlands` is `Zuid-Holland, Netherlands Genealogy`), and
 * a parenthetical that is one of those names is a name, not a type word
 * (`Bavaria (Bayern), Germany Genealogy`).
 */
async function homeByTitle(
  standardPlace: string,
  parts: string[],
  baseUrl: string
): Promise<WikiPlacePageResult | null> {
  const titles = await searchTitles(baseUrl, `${parts[0]} ${parts[1]} genealogy`);
  if (titles.length === 0) return null;
  let placeType: Promise<string | null> | undefined;
  let placeNames: Promise<string[]> | undefined;
  const namesOf = () =>
    (placeNames ??= standardPlaceToPlaceId(standardPlace).then((id) =>
      id ? getPlaceCandidateNames(id, {}, { anyLanguage: true }) : [],
    ));
  const tryLeaf = async (leaf: string): Promise<WikiPlacePageResult | null> => {
    for (const title of titles) {
      const shape = homeTitleShape(title, [leaf, ...parts.slice(1)]);
      if (!shape.ok) continue;
      if (shape.typeWord) {
        placeType ??= placeTypeOf(standardPlace);
        if (!typeWordFits(shape.typeWord, await placeType)) {
          const qualifier = shape.head.split(",")[0].slice(leaf.length).trim();
          const ownName = /^\(.+\)$/.test(qualifier) &&
            (await namesOf()).some((n) => n.toLowerCase() === qualifier.slice(1, -1).toLowerCase());
          if (!ownName) continue;
        }
      }
      // Diacritics are preserved, never folded: the folded slug 404s.
      const slug = nameToSlug(`${shape.head} Genealogy`);
      const page = await fetchPage(baseUrl, slug);
      if (page !== null) {
        return {
          url: `${FS_WIKI_BASE}/${slug}`,
          content: page.content,
          standardPlace,
          placeName: shape.head,
        };
      }
    }
    return null;
  };
  const hit = await tryLeaf(parts[0]);
  if (hit) return hit;
  for (const name of await namesOf()) {
    if (name === parts[0]) continue;
    const alt = await tryLeaf(name);
    if (alt) return alt;
  }
  return null;
}

async function readPlacePage(
  standardPlace: string,
  section: WikiPageSection,
  principal: Principal
): Promise<WikiPlacePageResult> {
  if (!standardPlace || typeof standardPlace !== "string" || !standardPlace.trim()) {
    throw new Error(
      "standardPlace is required and must be a non-empty string. " +
        "Pass the standardPlace name (from place_search)."
    );
  }

  const baseUrl = await getWikiApiUrl(principal);
  const parts = standardPlace.split(",").map((p) => p.trim()).filter(Boolean);
  const leaf = parts[0] ?? "";
  const slugsFor = (nameSlug: string) => candidateSlugsFor(section, nameSlug);
  // The leaf-name grammar addresses a country or a state/province only. Below
  // that it can only 404 or, worse, return a different jurisdiction's page with
  // a 200 (a county named Washington would get Washington state's). The three
  // section pages do not exist below state level at all (measured), so for those
  // a sub-state place gets "no page" and the caller broadens.
  const countryOrState = parts.length <= 2;

  // 1) Common case: the leaf name (e.g. "Portugal" -> Portugal_Genealogy).
  if (leaf && countryOrState) {
    const hit = await tryNames([leaf], slugsFor, baseUrl, standardPlace);
    if (hit) return hit;
  }

  // 2) A sub-national home page, by its real title from the wiki's own search.
  if (section === "home" && parts.length >= 2) {
    const hit = await homeByTitle(standardPlace, parts, baseUrl);
    if (hit) return hit;
  }

  // 3) Fallback: the places API's alternate name variants, for a country or
  //    state whose canonical wiki name differs from the leaf.
  if (countryOrState) {
    const placeId = await standardPlaceToPlaceId(standardPlace);
    if (placeId) {
      const variants = (await getPlaceCandidateNames(placeId)).filter((n) => n !== leaf);
      const hit = await tryNames(variants, slugsFor, baseUrl, standardPlace);
      if (hit) return hit;
    }
  }

  throw new Error(`No wiki page found for "${standardPlace}".`);
}

export async function wikiPlacePageTool(
  input: WikiPlacePageInput,
  principal: Principal
): Promise<WikiPlacePageResult> {
  const { standardPlace, section } = input;
  // An out-of-set string would fall through candidateSlugsFor's switch to
  // `undefined` and surface as a TypeError; reject it here with the set instead.
  if (typeof section !== "string" || !SECTIONS.has(section)) {
    throw new Error(
      `section is required and must be one of ${[...SECTIONS]
        .map((s) => `'${s}'`)
        .join(", ")}.`
    );
  }
  return readPlacePage(standardPlace, section as WikiPageSection, principal);
}

export const wikiPlacePageSchema = {
  name: "wiki_place_page",
  description:
    "Return a FamilySearch Research Wiki page for a place. Provide the most " +
    "specific standardPlace from place_search and the section you want. " +
    "'home' resolves the place's own page at any level the wiki has one — a " +
    "country, a state or province, and below that a county, parish or " +
    "independent city. The other three sections exist only for a country or a " +
    "state/province: for a more specific place they return no page, so " +
    "broaden the standardPlace one jurisdiction (see places guidance) and " +
    "call again.",
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
        enum: [...SECTIONS],
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

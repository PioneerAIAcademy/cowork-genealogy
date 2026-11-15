import type { Principal } from "../auth/principal.js";
import { getPlaceCandidateNames } from "./place-search.js";
import { standardPlaceToPlaceId, standardPlaceToRepId } from "../utils/place-resolver.js";
import { getPlaceById } from "../utils/place-api.js";
import { homeTitleShape, typeWordFits } from "../utils/wiki-home-title.js";
import { WIKI_SEARCH_TIMEOUT_MS } from "./wiki-search.js";
import type { WikiSearchAPIResponse } from "../types/wiki-search.js";
import { getWikiApiUrl } from "../auth/config.js";
import { describeFetchError, fetchWithRetry } from "../utils/http.js";
import { fetchPage, type PageApiResponse } from "../utils/wiki-page-fetch.js";

export { fetchPage };
import { pageText, requireWholeNumber } from "../utils/text-page.js";
import { stripWikiSidebar } from "../utils/wiki-sidebar.js";
import { VALIDATOR_ENUMS } from "../validation/validator.js";
import {
  WIKI_OFFSET_PROPERTY,
  WIKI_PAGE_MAX_CHARS,
  WIKI_PAGING_NOTE,
  WIKI_TOPIC_SUFFIXES,
  type WikiPlacePageInput,
  type WikiPlacePageResult,
  type WikiPageSection,
  type WikiSearchHelp,
  type WikiTopicPage,
} from "../types/wikiPage.js";

const FS_WIKI_BASE = "https://www.familysearch.org/en/wiki";

// The four wiki place-page sections — the `locality_page_section` closed enum,
// which the skill records into research.json `pages_read[].section`.
const SECTIONS = VALIDATOR_ENUMS.locality_page_section;


// Where a place resolved to, kept for the CONTINUATION calls of a paged page (`offset` above 0).
// Resolving a sub-state place costs a POST /search and Places API lookups before the page GET.
// `placeTypeOf` turns a failed type lookup into "unknown", which rejects every typed title, and
// a failed names lookup throws, so without this part 2 of a page that part 1 returned can fail
// on a Places outage. A call from the start always resolves in full, as before paging, and
// refreshes its entry.
// An in-process Map with no TTL, like the caches in utils/place-resolver.ts. Wiki pages are public
// and the key carries the per-user wiki URL, so sharing it across the process shares nothing
// user-scoped.
const resolvedPages = new Map<string, { slug: string; placeName: string }>();

/** JSON, so no part of the key can run into the next. */
function resolvedPageKey(baseUrl: string, section: WikiPageSection, standardPlace: string): string {
  return JSON.stringify([baseUrl, section, standardPlace]);
}

// A place's country topic pages, per wiki URL and candidate list. Only a list built with no
// failed lookup is kept, so a transient error is retried on the next call.
const topicPagesCache = new Map<string, WikiTopicPage[]>();

/** Test-only: empty the memo so cases don't bleed into each other. */
export function __clearResolvedPagesForTests(): void {
  resolvedPages.clear();
  topicPagesCache.clear();
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

/**
 * A place to its page, resolved in full: the leaf grammar, then a title found by the wiki's
 * own search, then the Places API's alternate names.
 */
async function resolvePlacePage(
  standardPlace: string,
  section: WikiPageSection,
  baseUrl: string
): Promise<WikiPlacePageResult> {
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

/**
 * The jurisdictions a place's topic pages may be titled by, broadest first, so the country's
 * page wins and a part the wiki does not title topic pages by falls through to the next.
 */
export function countryCandidates(standardPlace: string): string[] {
  return standardPlace.split(",").map((p) => p.trim()).filter(Boolean).reverse();
}

/**
 * The country's record-type pages that exist: for each `WIKI_TOPIC_SUFFIXES` entry, the first
 * candidate whose `{Candidate}_{Suffix}` page the server returns. A lookup that fails omits
 * that topic rather than failing the place page.
 */
async function topicPagesFor(standardPlace: string, baseUrl: string): Promise<WikiTopicPage[]> {
  const candidates = countryCandidates(standardPlace);
  const key = JSON.stringify([baseUrl, candidates]);
  const cached = topicPagesCache.get(key);
  if (cached) return cached;
  let failed = false;
  const found = await Promise.all(
    WIKI_TOPIC_SUFFIXES.map(async (suffix): Promise<WikiTopicPage | null> => {
      for (const name of candidates) {
        const slug = `${nameToSlug(name)}_${suffix}`;
        try {
          if ((await fetchPage(baseUrl, slug)) !== null) {
            return { topic: suffix.replace(/_/g, " "), url: `${FS_WIKI_BASE}/${slug}` };
          }
        } catch {
          failed = true;
          return null;
        }
      }
      return null;
    })
  );
  const pages = found.filter((p): p is WikiTopicPage => p !== null);
  if (!failed) topicPagesCache.set(key, pages);
  return pages;
}

/** A linked page counts as search help when its title says it is about searching records. */
export const SEARCH_HELP_TITLE = /\b(search results|search tips|searching)\b/i;
const SEARCH_HELP_MAX_CHARS = 8_000;
const WIKI_LINK = /\]\(https:\/\/www\.familysearch\.org\/en\/wiki\/([^)\s"]+)\s+"([^"]+)"\)/g;

/**
 * The first page the research-tips text links whose link title matches `SEARCH_HELP_TITLE`,
 * read and cut to `SEARCH_HELP_MAX_CHARS`. Undefined when none is linked or it cannot be read.
 */
async function searchHelpFor(content: string, baseUrl: string): Promise<WikiSearchHelp | undefined> {
  for (const [, slug, title] of content.matchAll(WIKI_LINK)) {
    if (!SEARCH_HELP_TITLE.test(title)) continue;
    let page: PageApiResponse | null;
    try {
      page = await fetchPage(baseUrl, decodeURIComponent(slug));
    } catch {
      return undefined;
    }
    if (page === null || typeof page.content !== "string") return undefined;
    const cut = pageText(stripWikiSidebar(page.content), undefined, SEARCH_HELP_MAX_CHARS);
    return {
      title,
      url: `${FS_WIKI_BASE}/${slug}`,
      content: cut.content,
      truncated: cut.paging?.truncated ?? false,
    };
  }
  return undefined;
}

/**
 * The page for a place. A call that CONTINUES a page (`continuing`, `offset` above 0) whose
 * place an earlier call resolved fetches that page directly. A remembered page that now 404s is
 * forgotten and the place is resolved in full; a network failure or a 5xx on that GET is thrown,
 * as `fetchPage` always throws it. Every other call resolves in full, and every full resolution
 * is remembered.
 */
async function readPlacePage(
  standardPlace: string,
  section: WikiPageSection,
  principal: Principal,
  continuing: boolean
): Promise<WikiPlacePageResult> {
  if (!standardPlace || typeof standardPlace !== "string" || !standardPlace.trim()) {
    throw new Error(
      "standardPlace is required and must be a non-empty string. " +
        "Pass the standardPlace name (from place_search)."
    );
  }

  const baseUrl = await getWikiApiUrl(principal);
  const key = resolvedPageKey(baseUrl, section, standardPlace);
  const known = continuing ? resolvedPages.get(key) : undefined;
  if (known) {
    const page = await fetchPage(baseUrl, known.slug);
    if (page !== null) {
      return {
        url: `${FS_WIKI_BASE}/${known.slug}`,
        content: page.content,
        standardPlace,
        placeName: known.placeName,
      };
    }
    resolvedPages.delete(key);
  }

  const hit = await resolvePlacePage(standardPlace, section, baseUrl);
  // `url` is `${FS_WIKI_BASE}/${slug}` wherever `resolvePlacePage` builds one.
  resolvedPages.set(key, { slug: hit.url.slice(FS_WIKI_BASE.length + 1), placeName: hit.placeName });
  return hit;
}

export async function wikiPlacePageTool(
  input: WikiPlacePageInput,
  principal: Principal
): Promise<WikiPlacePageResult> {
  const { standardPlace, section } = input;
  // Argument checks first: a bad offset must not cost a request or a place lookup.
  const offset = input.offset === undefined ? undefined : requireWholeNumber("offset", input.offset, 0);
  // An out-of-set string would fall through candidateSlugsFor's switch to
  // `undefined` and surface as a TypeError; reject it here with the set instead.
  if (typeof section !== "string" || !SECTIONS.has(section)) {
    throw new Error(
      `section is required and must be one of ${[...SECTIONS]
        .map((s) => `'${s}'`)
        .join(", ")}.`
    );
  }
  const hit = await readPlacePage(
    standardPlace,
    section as WikiPageSection,
    principal,
    offset !== undefined && offset > 0
  );
  // The page is cut once, after the place is resolved, so every way a place resolves (the
  // leaf grammar, a title found by search, an alternate name) is paged the same. A body
  // with no text passes through as it always did: there is nothing to cut. The sidebar goes
  // before the cut, so `totalChars` and `offset` count the text the caller reads.
  if (typeof hit.content !== "string") return hit;
  const { content, paging } = pageText(stripWikiSidebar(hit.content), offset, WIKI_PAGE_MAX_CHARS);
  const result: WikiPlacePageResult = { ...hit, content, ...paging };
  // Added to the first part only: a continuation call already had them.
  if (!offset) {
    const baseUrl = await getWikiApiUrl(principal);
    if (section === "home") {
      result.topicPages = await topicPagesFor(standardPlace, baseUrl);
    } else if (section === "research_tips") {
      const help = await searchHelpFor(stripWikiSidebar(hit.content), baseUrl);
      if (help) result.searchHelp = help;
    }
  }
  return result;
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
    "call again. 'home' also returns `topicPages`, the country's record-type " +
    "pages to read with wiki_read; 'research_tips' returns `searchHelp` when it " +
    "links a page on searching the place's records. " +
    WIKI_PAGING_NOTE,
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
      offset: WIKI_OFFSET_PROPERTY,
    },
    required: ["standardPlace", "section"],
  },
};

export type { WikiPlacePageInput };

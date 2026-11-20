import type { Principal } from "../auth/principal.js";
import { getWikiApiUrl } from "../auth/config.js";
import { describeFetchError, fetchWithRetry } from "../utils/http.js";
import { stripWikiSidebar } from "../utils/wiki-sidebar.js";
import type {
  WikiSearchAPIResponse,
  WikiSearchResult,
  WikiSearchResultItem,
} from "../types/wiki-search.js";

// One un-retried RAG request against the sidecar, and retrieval over the wiki
// corpus is slower than a plain JSON read: calls have been measured up to 56s,
// with 5 of 47 above the 30s default. Nothing retries behind this one.
export const WIKI_SEARCH_TIMEOUT_MS = 60_000;

// Characters of the compact JSON answer (what server.ts sends) an `includeText`
// answer may reach before its lowest-placed results lose their text. A design
// limit, deliberately below the shared TOOL_RESULT_CHAR_BUDGET.
export const WIKI_SEARCH_TEXT_BUDGET = 24_000;

export interface WikiSearchInput {
  query: string;
  includeText?: boolean;
}

const IMAGE_EXT = "(?:png|jpe?g|gif|svg|webp|bmp|tiff?)";
// A link destination: no whitespace, parentheses one level deep — wiki URLs carry
// them (`Hesse-Nassau_(Hessen-Nassau),_German_Empire_Church_Records`).
const DEST = String.raw`(?:[^\s()]|\([^\s()]*\))*`;
const TITLE = String.raw`(?:\s+"[^"\n]*")?`;
const IMAGE = String.raw`!\[[^\]\n]*\]\(${DEST}\.${IMAGE_EXT}${TITLE}\)`;
const LINKED_IMAGE_RE = new RegExp(String.raw`\[${IMAGE}\]\(${DEST}${TITLE}\)`, "gi");
const IMAGE_RE = new RegExp(IMAGE, "gi");
const LINK_TITLE_RE = new RegExp(String.raw`(\]\(${DEST})\s+"[^"\n]*"\)`, "g");

/**
 * One chunk's text without the wiki's sidebar, its image links (an image whose
 * source ends in an image extension, with the link wrapping it) and its link
 * titles (`[t](url "Title")` -> `[t](url)`).
 */
export function cleanWikiSearchText(text: string): string {
  return stripWikiSidebar(text)
    .replace(LINKED_IMAGE_RE, "")
    .replace(IMAGE_RE, "")
    .replace(LINK_TITLE_RE, "$1)");
}

/**
 * The server's answer as the tool returns it: each result a reference
 * (`page_title`, `section_heading`, `source_url`, and `source` when it is not
 * "wiki"). With `includeText`, each result also carries its cleaned
 * `chunk_text`, or `same_text_as` for text an earlier result already carries,
 * and the lowest-placed results lose their text until the JSON answer fits
 * WIKI_SEARCH_TEXT_BUDGET. Pure: `answer` is not mutated. Called by the tool
 * and, on a canned fixture, by the eval mock.
 */
export function compactWikiSearchAnswer(
  answer: WikiSearchAPIResponse,
  includeText: boolean
): WikiSearchResult {
  const raw = Array.isArray(answer.results) ? answer.results : [];
  const results: WikiSearchResultItem[] = raw.map((r) => {
    const item: WikiSearchResultItem = {
      page_title: r.page_title,
      section_heading: r.section_heading,
      source_url: r.source_url,
    };
    if (typeof r.source === "string" && r.source !== "wiki") item.source = r.source;
    return item;
  });

  const out = {} as WikiSearchResult;
  for (const [key, value] of Object.entries(answer)) {
    (out as unknown as Record<string, unknown>)[key] = key === "results" ? results : value;
  }
  out.results = results;
  if (!includeText) return out;

  const firstWithText = new Map<string, number>();
  raw.forEach((r, i) => {
    if (typeof r.chunk_text !== "string") return;
    const text = cleanWikiSearchText(r.chunk_text);
    const earlier = firstWithText.get(text);
    if (earlier === undefined) {
      firstWithText.set(text, i);
      results[i].chunk_text = text;
    } else {
      results[i].same_text_as = earlier;
    }
  });

  for (let i = results.length - 1; i >= 0; i--) {
    if (JSON.stringify(out).length <= WIKI_SEARCH_TEXT_BUDGET) break;
    if (results[i].chunk_text === undefined) continue;
    delete results[i].chunk_text;
    for (let j = i + 1; j < results.length; j++) {
      if (results[j].same_text_as === i) delete results[j].same_text_as;
    }
  }
  return out;
}

export async function wikiSearch(
  input: WikiSearchInput,
  principal: Principal
): Promise<WikiSearchResult> {
  const baseUrl = await getWikiApiUrl(principal);
  const url = `${baseUrl}/search`;

  let response: Response;
  try {
    response = await fetchWithRetry(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "genealogy-mcp-server/0.0.1",
        },
        body: JSON.stringify({ query: input.query }),
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
  return compactWikiSearchAnswer(data, input.includeText === true);
}

export const wikiSearchSchema = {
  name: "wiki_search",
  description:
    "Search the FamilySearch Wiki for genealogy guidance. Use this when the user asks how to find records (birth, marriage, death, census, immigration, military, church), how to research ancestors from a specific country or region, or how to use FamilySearch resources. Returns up to 20 matching wiki sections, most relevant first, as references: page_title, section_heading and source_url. Pass includeText: true to also get each section's text as chunk_text. With includeText the answer is capped at 24,000 characters: a section whose text repeats an earlier one carries same_text_as (the 0-based position of that earlier result) instead, and the lowest-placed results that do not fit come back as references without chunk_text.",
  inputSchema: {
    type: "object" as const,
    properties: {
      query: {
        type: "string",
        description: "A natural-language genealogy question",
      },
      includeText: {
        type: "boolean",
        description: "Also return each section's text as chunk_text. Default false: references only.",
      },
    },
    required: ["query"],
  },
};

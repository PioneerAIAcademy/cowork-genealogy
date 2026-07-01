import TurndownService from "turndown";
import { getValidToken } from "../auth/refresh.js";
import { BROWSER_USER_AGENT } from "../constants.js";
import type {
  FSCollectionDetailResponse,
  CollectionDetailResult,
} from "../types/collection.js";

const FS_COLLECTIONS_URL =
  "https://www.familysearch.org/service/search/hr/v2/collections";

// ---------- HTML → markdown conversion ----------

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  emDelimiter: "*",
});
turndown.remove(["head", "title", "style", "script"]);
turndown.addRule("dropHidden", {
  filter: (node) => {
    const style = (node as HTMLElement).getAttribute?.("style") ?? "";
    return /display\s*:\s*none/i.test(style);
  },
  replacement: () => "",
});

export function htmlToMarkdown(html: string | undefined | null): string | null {
  if (!html) return null;
  const md = turndown.turndown(html).trim();
  return md.length > 0 ? md : null;
}

export async function fetchCollectionDetail(
  token: string,
  id: string
): Promise<FSCollectionDetailResponse> {
  const url = `${FS_COLLECTIONS_URL}/${encodeURIComponent(id)}?embedWikiAboutCollection=true`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "User-Agent": BROWSER_USER_AGENT,
    },
  });

  if (response.status === 404) {
    throw new Error(
      `No FamilySearch collection found with id "${id}". Use collections_search({ standardPlace: ... }) to list available collections.`
    );
  }
  if (!response.ok) {
    throw new Error(
      `FamilySearch collection detail API error: ${response.status} ${response.statusText}`
    );
  }

  try {
    return (await response.json()) as FSCollectionDetailResponse;
  } catch {
    throw new Error("FamilySearch collection detail API returned malformed response.");
  }
}

// Convert documents[*].text from HTML to markdown when textType === "html".
// Per stakeholder direction (Dallan, 2026-05-12), only this field is converted;
// citations stay as HTML.
export function convertHtmlToMarkdown(
  response: FSCollectionDetailResponse
): FSCollectionDetailResponse {
  const documents = response.documents?.map((d) => {
    if (d.textType !== "html" || !d.text) return d;
    const md = htmlToMarkdown(d.text);
    return md == null ? d : { ...d, text: md, textType: "markdown" };
  });

  return { ...response, documents };
}

// ---------- Tool entry point ----------

export interface CollectionReadInput {
  id: string;
}

export async function collectionReadTool(
  input: CollectionReadInput
): Promise<CollectionDetailResult> {
  if (!input.id) {
    throw new Error(
      "collection_read requires an id (a collection ID like \"1743384\"). " +
        "Use collections_search({ standardPlace: ... }) to discover collection IDs."
    );
  }

  const token = await getValidToken();
  const detail = await fetchCollectionDetail(token, input.id);
  return convertHtmlToMarkdown(detail);
}

export const collectionReadToolSchema = {
  name: "collection_read",
  description:
    "Get detailed information about a single FamilySearch record collection by " +
    "id (a collection ID like \"1743384\", from collections_search). Returns the " +
    "FamilySearch API response for that collection (sourceDescriptions, documents, " +
    "collections), with HTML content (the FS Research Wiki page in documents[*].text) " +
    "converted to markdown; the formal citation stays as HTML. " +
    "Requires authentication — call the login tool first if not logged in.",
  inputSchema: {
    type: "object",
    properties: {
      id: {
        type: "string",
        description:
          "FamilySearch collection ID (e.g., \"1743384\"). Returns the FS API " +
          "response for that collection (sourceDescriptions, documents, " +
          "collections), with the Research Wiki page converted to markdown. " +
          "Use collections_search (standardPlace) first to discover the ID.",
      },
    },
    required: ["id"],
  },
};

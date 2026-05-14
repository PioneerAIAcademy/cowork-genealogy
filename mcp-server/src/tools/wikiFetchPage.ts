import { createHash } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import { load } from "cheerio";
import TurndownService from "turndown";
import type { WikiFetchPageInput, WikiPageResult } from "../types/wikiPage.js";
import { BROWSER_USER_AGENT } from "../constants.js";

const CACHE_DIR = join(homedir(), ".familysearch-mcp", "wiki-cache");

async function ensureCacheDir(): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true });
}

function urlToCacheFilename(url: string): string {
  return createHash("md5").update(url).digest("hex") + ".md";
}

export async function fetchAndCacheWikiPage(url: string): Promise<WikiPageResult> {
  await ensureCacheDir();
  const cacheFile = join(CACHE_DIR, urlToCacheFilename(url));

  try {
    const cached = await readFile(cacheFile, "utf8");
    return { url, content: cached, cached: true };
  } catch {
    // Cache miss — fetch the page
  }

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        "User-Agent": BROWSER_USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Accept-Encoding": "gzip, deflate, br",
        Connection: "keep-alive",
        "Upgrade-Insecure-Requests": "1",
      },
    });
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not fetch wiki page at ${url}. (${cause})`);
  }

  if (response.status === 404) {
    throw new Error(`No FamilySearch wiki page found at ${url}`);
  }

  if (!response.ok) {
    throw new Error(`Wiki fetch error: ${response.status} for ${url}`);
  }

  const html = await response.text();
  const $ = load(html);
  const articleHtml = $(".mw-parser-output").html() ?? "";

  const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
  const markdown = turndown.turndown(articleHtml);

  await writeFile(cacheFile, markdown, "utf8");
  return { url, content: markdown, cached: false };
}

export async function wikiFetchPageTool(input: WikiFetchPageInput): Promise<WikiPageResult> {
  return fetchAndCacheWikiPage(input.url);
}

export const wikiFetchPageSchema = {
  name: "wiki_fetch_page",
  description:
    "Fetch any FamilySearch wiki page and return its full content as markdown. Use this when you have a specific wiki URL. Pages are cached locally after the first fetch.",
  inputSchema: {
    type: "object" as const,
    properties: {
      url: {
        type: "string",
        description: "The full URL of a FamilySearch wiki page",
      },
    },
    required: ["url"],
  },
};

export type { WikiFetchPageInput };

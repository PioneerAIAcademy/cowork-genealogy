import { readFile } from "fs/promises";
import { join } from "path";
import { getWikiMarkdownDir } from "../auth/config.js";
import type { WikiReadInput, WikiPageResult } from "../types/wikiPage.js";

const FS_WIKI_BASE = "https://www.familysearch.org/en/wiki";

function urlToSlug(url: string): string {
  const match = url.match(/\/wiki\/([^?#]+)/);
  if (!match) {
    throw new Error(`Not a valid FamilySearch wiki URL: ${url}`);
  }
  return decodeURIComponent(match[1]);
}

export async function wikiReadTool(input: WikiReadInput): Promise<WikiPageResult> {
  const slug = urlToSlug(input.url);
  const wikiDir = await getWikiMarkdownDir();
  const filePath = join(wikiDir, `${slug}.md`);

  try {
    const content = await readFile(filePath, "utf8");
    return { url: `${FS_WIKI_BASE}/${slug}`, content };
  } catch {
    throw new Error(
      `No wiki page found for "${slug}". The page may not exist in the pre-crawled files.`
    );
  }
}

export const wikiReadSchema = {
  name: "wiki_read",
  description:
    "Read any FamilySearch wiki page from the pre-crawled markdown files on disk. " +
    "Pass the full FamilySearch wiki URL; the page title is extracted and the pre-crawled markdown is returned. " +
    "Use this for specific wiki pages not covered by the country-specific tools.",
  inputSchema: {
    type: "object" as const,
    properties: {
      url: {
        type: "string",
        description:
          "The full URL of a FamilySearch wiki page " +
          "(e.g. https://www.familysearch.org/en/wiki/Portugal_Genealogy)",
      },
    },
    required: ["url"],
  },
};

export type { WikiReadInput };

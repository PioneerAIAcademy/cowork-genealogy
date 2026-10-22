/**
 * Live check for the paging of `wiki_read` and `wiki_place_page`: follow `nextOffset`
 * for each page, join the parts, and compare the join with the page fetched whole from
 * the wiki server.
 *
 *   npx tsx dev/check-wiki-paging.ts                 # the three long pages, through wiki_read;
 *                                                    # two of them again through wiki_place_page
 *   npx tsx dev/check-wiki-paging.ts <wiki URL> ...  # your own pages, through wiki_read
 *   npx tsx dev/check-wiki-paging.ts --wire          # the same, through the built server over
 *                                                    # stdio: what the CLI sees. `npm run build` first.
 *
 * The whole page comes straight from `GET {wikiApiUrl}/page/<slug>`, not through the tool,
 * so the comparison is against what the server holds. Every part is also measured the way
 * the CLI sees it (the length of the serialized result), which must stay under the line
 * above which Claude Code saves a result to a file. Exit 0 only when every case joins
 * back exactly, every part is under that line and every chain ends; one line per part.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { getWikiApiUrl } from "../src/auth/config.js";
import { LOCAL } from "../src/auth/principal.js";
import { wikiPlacePageTool } from "../src/tools/wiki-place-page.js";
import { wikiReadTool } from "../src/tools/wiki-read.js";
import type { WikiPageResult } from "../src/types/wikiPage.js";
import { fetchWithRetry } from "../src/utils/http.js";
import { CLI_SPILL_CHARS } from "../tests/helpers/cli-spill.js";

const WIKI = "https://www.familysearch.org/en/wiki/";
const MAX_PARTS = 20;

/** The three pages that are over the line whole (measured 2026-10-22), by wiki slug. */
const LONG_PAGES = [
  "Schuylkill_County,_Pennsylvania_Genealogy",
  "Pennsylvania_Church_Records",
  "Ireland_Online_Genealogy_Records",
];

/** The same pages again through `wiki_place_page`, where a section reaches them. */
const PLACE_CASES = [
  { standardPlace: "Ireland", section: "online_records" },
  { standardPlace: "Schuylkill, Pennsylvania, United States", section: "home" },
] as const;

interface Part {
  result: WikiPageResult;
  /** Characters the CLI would count: the serialized result. */
  wireChars: number;
}

type Call = (tool: "wiki_read" | "wiki_place_page", args: Record<string, unknown>) => Promise<Part>;

const direct: Call = async (tool, args) => {
  const result =
    tool === "wiki_read"
      ? await wikiReadTool(args as unknown as Parameters<typeof wikiReadTool>[0], LOCAL)
      : await wikiPlacePageTool(args as unknown as Parameters<typeof wikiPlacePageTool>[0], LOCAL);
  return { result, wireChars: JSON.stringify(result).length };
};

const overStdio =
  (client: Client): Call =>
  async (tool, args) => {
    const res = await client.callTool({ name: tool, arguments: args });
    const first = (res.content as Array<{ type: string; text?: string }>)[0];
    const text = first?.type === "text" && typeof first.text === "string" ? first.text : "";
    if (res.isError) throw new Error(text || "the server returned an error with no text");
    return { result: JSON.parse(text) as WikiPageResult, wireChars: text.length };
  };

/** The page as the wiki server holds it, fetched without the tool. */
async function fetchWhole(slug: string): Promise<string> {
  const base = await getWikiApiUrl(LOCAL);
  const res = await fetchWithRetry(`${base}/page/${slug}`, {
    method: "GET",
    headers: { "User-Agent": "genealogy-mcp-server/0.0.1" },
  });
  if (!res.ok) throw new Error(`GET /page/${slug} answered ${res.status}`);
  const body = (await res.json()) as { content?: unknown };
  if (typeof body.content !== "string") throw new Error(`GET /page/${slug} carried no text`);
  return body.content;
}

const fmt = (n: number): string => n.toLocaleString("en-US");

function firstDifference(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return n;
}

/** How a part ended, judged from the part after it. */
function cutKind(content: string, next: string): string {
  if (content.endsWith("\n")) return next.startsWith("#") ? "heading" : "line break";
  return "mid-line";
}

/** Walk one page. Returns the problems found; an empty list means it passed. */
async function checkCase(
  label: string,
  call: (offset?: number) => Promise<Part>,
  slugOf: (first: WikiPageResult) => string,
): Promise<string[]> {
  const problems: string[] = [];
  const parts: Part[] = [];
  let offset: number | undefined;
  for (let n = 0; n < MAX_PARTS; n++) {
    const part = await call(offset);
    parts.push(part);
    if (!part.result.truncated) break;
    if (part.result.nextOffset === undefined) {
      problems.push(`part ${n + 1} is truncated but has no nextOffset`);
      break;
    }
    offset = part.result.nextOffset;
  }
  const last = parts[parts.length - 1].result;
  if (last.truncated) problems.push(`the chain had not ended after ${parts.length} parts`);

  const slug = slugOf(parts[0].result);
  const whole = await fetchWhole(slug);
  const joined = parts.map((p) => p.result.content).join("");
  console.log(`\n${label}: ${parts.length} part${parts.length === 1 ? "" : "s"}, the page is ${fmt(whole.length)} chars (${slug})`);
  let at = 0;
  parts.forEach((p, i) => {
    const r = p.result;
    const expectedOffset = r.offset ?? 0;
    if (expectedOffset !== at) problems.push(`part ${i + 1} starts at ${expectedOffset}, the last part ended at ${at}`);
    at += r.content.length;
    if (p.wireChars >= CLI_SPILL_CHARS) problems.push(`part ${i + 1} is ${fmt(p.wireChars)} chars serialized, over the ${fmt(CLI_SPILL_CHARS)} line`);
    if (i < parts.length - 1) {
      if (r.truncated !== true) problems.push(`part ${i + 1} is not marked truncated but another follows`);
      if (r.nextOffset !== (r.offset ?? 0) + r.content.length) problems.push(`part ${i + 1}: nextOffset ${r.nextOffset} is not offset + content length`);
    }
    const note =
      i < parts.length - 1 ? `truncated, next ${fmt(r.nextOffset ?? -1)}, cut at ${cutKind(r.content, parts[i + 1].result.content)}` : "last";
    console.log(
      `  part ${i + 1}  offset ${fmt(expectedOffset).padStart(7)}  ${fmt(r.content.length).padStart(7)} chars  serialized ${fmt(p.wireChars).padStart(7)}  ${note}`,
    );
  });
  if (parts.length === 1 && parts[0].result.totalChars !== undefined) {
    problems.push("a page that fits was asked for from the start but came back with paging fields");
  }
  if (joined !== whole) {
    problems.push(`the parts do not join to the page: ${fmt(joined.length)} chars against ${fmt(whole.length)}, first difference at ${fmt(firstDifference(joined, whole))}`);
  }
  console.log(`  joined parts equal the whole page: ${joined === whole ? "yes" : "NO"}`);
  return problems;
}

const slugFromUrl = (r: WikiPageResult): string => r.url.slice(r.url.indexOf("/wiki/") + "/wiki/".length);

async function run(call: Call): Promise<number> {
  const urls = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const failures: string[] = [];
  const attempt = async (label: string, fn: () => Promise<string[]>): Promise<void> => {
    try {
      const problems = await fn();
      for (const p of problems) failures.push(`${label}: ${p}`);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.log(`\n${label}: ERROR ${message}`);
      failures.push(`${label}: ${message}`);
    }
  };

  const readUrls = urls.length > 0 ? urls : LONG_PAGES.map((s) => `${WIKI}${s}`);
  for (const url of readUrls) {
    await attempt(`wiki_read ${url.slice(url.lastIndexOf("/") + 1)}`, () =>
      checkCase(
        `wiki_read ${url}`,
        (offset) => call("wiki_read", { url, ...(offset === undefined ? {} : { offset }) }),
        slugFromUrl,
      ),
    );
  }
  if (urls.length === 0) {
    for (const c of PLACE_CASES) {
      await attempt(`wiki_place_page ${c.standardPlace}`, () =>
        checkCase(
          `wiki_place_page ${JSON.stringify(c)}`,
          (offset) => call("wiki_place_page", { ...c, ...(offset === undefined ? {} : { offset }) }),
          slugFromUrl,
        ),
      );
    }
  }

  console.log("");
  if (failures.length > 0) {
    console.error(`FAILED (${failures.length}):\n${failures.map((f) => `  - ${f}`).join("\n")}`);
    return 1;
  }
  console.log("every case joined back to the whole page, every part under the spill line, every chain ended");
  return 0;
}

async function main(): Promise<void> {
  const unknown = process.argv.slice(2).filter((a) => a.startsWith("--") && a !== "--wire");
  if (unknown.length > 0) {
    console.error(`unknown flag ${unknown[0]}\nusage: npx tsx dev/check-wiki-paging.ts [--wire] [wiki URL ...]`);
    process.exit(1);
  }
  if (!process.argv.includes("--wire")) {
    console.log("through the tools directly");
    process.exit(await run(direct));
  }
  console.log("through build/index.js over stdio (what the CLI sees)");
  const client = new Client({ name: "check-wiki-paging", version: "0" });
  const transport = new StdioClientTransport({
    command: "node",
    args: ["build/index.js"],
    // The server's own environment, not the SDK's trimmed default: it reads HOME for its config.
    env: Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined)),
    stderr: "inherit",
  });
  let code = 1;
  try {
    await client.connect(transport);
    code = await run(overStdio(client));
  } finally {
    await client.close().catch(() => {});
  }
  process.exit(code);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

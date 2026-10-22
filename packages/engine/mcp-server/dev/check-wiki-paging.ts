/**
 * Live check for the paging of `wiki_read` and `wiki_place_page`: follow `nextOffset`
 * for each page, join the parts, and compare the join with the page fetched whole from
 * the wiki server.
 *
 *   npx tsx dev/check-wiki-paging.ts                 # the long pages, through wiki_read; some of
 *                                                    # them again through wiki_place_page
 *   npx tsx dev/check-wiki-paging.ts <wiki URL> ...  # your own pages, through wiki_read
 *   npx tsx dev/check-wiki-paging.ts --wire          # the same, through the built server over
 *                                                    # stdio: what the CLI sees. `npm run build` first.
 *
 * The whole page comes straight from `GET {wikiApiUrl}/page/<slug>`, not through the tool,
 * so the comparison is against what the server holds. Every part is also measured the way
 * the CLI sees it (the length of the serialized result), which must stay under the line
 * above which Claude Code saves a result to a file. Exit 0 only when every case joins
 * back exactly, every part is under that line and every chain ends; one line per part.
 * A default page that now fits whole also fails: it would pass every other check with
 * nothing walked, so the case needs a longer page. Pages you pass in are not held to that.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { getWikiApiUrl } from "../src/auth/config.js";
import { LOCAL } from "../src/auth/principal.js";
import { fetchPage, wikiPlacePageTool } from "../src/tools/wiki-place-page.js";
import { wikiReadTool } from "../src/tools/wiki-read.js";
import type { WikiPageResult } from "../src/types/wikiPage.js";
import { CLI_SPILL_CHARS } from "../tests/helpers/cli-spill.js";
import { callViaClient } from "./smoke-calls.js";

const WIKI = "https://www.familysearch.org/en/wiki/";

/**
 * Pages too long for one answer, by wiki slug: the pages the default run walks, from pages
 * of two parts to a long chain at the end. A page edited on the wiki can shrink under the
 * cap; the run then fails that case, and it needs a longer page.
 */
const LONG_PAGES = [
  "Schuylkill_County,_Pennsylvania_Genealogy", // a county page: headings throughout
  "Pennsylvania_Church_Records",
  "Ireland_Online_Genealogy_Records", // most of the page is one table row: a cut falls mid-row
  "Norway_Church_Records",
  "Cook_County,_Illinois_Genealogy",
  "San_José,_Costa_Rica,_Catholic_Church_Parish_Finding_Aid", // the longest chain
];

/** The pages a section reaches, again through `wiki_place_page`: by leaf name and by title. */
const PLACE_CASES = [
  { standardPlace: "Ireland", section: "online_records" },
  { standardPlace: "Schuylkill, Pennsylvania, United States", section: "home" },
  { standardPlace: "Cook, Illinois, United States", section: "home" },
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
    const res = await callViaClient(client, tool, args);
    if (res.isError) throw new Error(res.text || "the server returned an error with no text");
    if (typeof res.body?.content !== "string") {
      throw new Error(`the server answered with something that is not a page: ${res.text.slice(0, 200)}`);
    }
    return { result: res.body as WikiPageResult, wireChars: res.text.length };
  };

/** The page as the wiki server holds it, fetched without the tool. */
async function fetchWhole(slug: string): Promise<string> {
  const page = await fetchPage(await getWikiApiUrl(LOCAL), slug);
  if (page === null) throw new Error(`GET /page/${slug} answered 404`);
  if (typeof page.content !== "string") throw new Error(`GET /page/${slug} carried no text`);
  return page.content;
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

const slugFromUrl = (r: WikiPageResult): string => r.url.slice(r.url.indexOf("/wiki/") + "/wiki/".length);

/**
 * Walk one page. Returns the problems found; an empty list means it passed. With
 * `mustBePaged`, a page that comes back whole is a problem too.
 */
async function checkCase(
  label: string,
  call: (offset?: number) => Promise<Part>,
  mustBePaged: boolean,
): Promise<string[]> {
  const problems: string[] = [];
  // The first part is read before the whole page because a `wiki_place_page` case learns the
  // page's slug from it. The whole page comes next: its length bounds the walk.
  const parts: Part[] = [await call(undefined)];
  const slug = slugFromUrl(parts[0].result);
  const whole = await fetchWhole(slug);

  // Every part is non-empty (`fitPage`), so each call starts at least one character past the
  // last one and a chain over `whole.length` characters cannot have more parts than that. A part
  // that does not move forward is reported where it is seen, so this bound is the backstop, not
  // how a stuck chain ends.
  let asked = 0; // where the latest part was asked to start
  for (;;) {
    const n = parts.length;
    const latest = parts[n - 1].result;
    if (!latest.truncated) break;
    if (latest.nextOffset === undefined) {
      problems.push(`part ${n} is truncated but has no nextOffset`);
      break;
    }
    if (latest.nextOffset <= asked) {
      problems.push(`part ${n} is truncated but its nextOffset ${latest.nextOffset} is not past ${asked}, where it was asked to start`);
      break;
    }
    if (n >= whole.length) {
      problems.push(`the chain was still going after ${n} parts, more than a page of ${fmt(whole.length)} chars can have`);
      break;
    }
    asked = latest.nextOffset;
    parts.push(await call(asked));
  }

  const joined = parts.map((p) => p.result.content).join("");
  console.log(`\n${label}: ${parts.length} part${parts.length === 1 ? "" : "s"}, the page is ${fmt(whole.length)} chars (${slug})`);
  let at = 0;
  parts.forEach((p, i) => {
    const r = p.result;
    const start = r.offset ?? 0;
    if (start !== at) problems.push(`part ${i + 1} starts at ${start}, the last part ended at ${at}`);
    at += r.content.length;
    if (p.wireChars >= CLI_SPILL_CHARS) problems.push(`part ${i + 1} is ${fmt(p.wireChars)} chars serialized, over the ${fmt(CLI_SPILL_CHARS)} line`);
    // (A part is followed by another only when it is truncated: the loop above stops otherwise.)
    if (i < parts.length - 1 && r.nextOffset !== start + r.content.length) {
      problems.push(`part ${i + 1}: nextOffset ${r.nextOffset} is not offset + content length`);
    }
    const note =
      i < parts.length - 1
        ? `truncated, next ${fmt(r.nextOffset ?? -1)}, cut at ${cutKind(r.content, parts[i + 1].result.content)}`
        : r.truncated
          ? "truncated: the walk stopped here, the page goes on"
          : "last";
    console.log(
      `  part ${i + 1}  offset ${fmt(start).padStart(7)}  ${fmt(r.content.length).padStart(7)} chars  serialized ${fmt(p.wireChars).padStart(7)}  ${note}`,
    );
  });
  // One part that is not truncated: the page came back whole. (A first part that IS truncated and
  // ends the walk has already been reported above.)
  if (parts.length === 1 && !parts[0].result.truncated) {
    if (parts[0].result.totalChars !== undefined) {
      problems.push("a page that fits was asked for from the start but came back with paging fields");
    }
    if (mustBePaged) {
      problems.push(`it came back in a single part: the page now fits whole (${fmt(whole.length)} chars), so this case walks nothing; use a longer page`);
    }
  }
  if (joined !== whole) {
    problems.push(`the parts do not join to the page: ${fmt(joined.length)} chars against ${fmt(whole.length)}, first difference at ${fmt(firstDifference(joined, whole))}`);
  }
  console.log(`  joined parts equal the whole page: ${joined === whole ? "yes" : "NO"}`);
  return problems;
}

async function run(call: Call): Promise<number> {
  const urls = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const ownPages = urls.length > 0;
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

  const readUrls = ownPages ? urls : LONG_PAGES.map((s) => `${WIKI}${s}`);
  for (const url of readUrls) {
    await attempt(`wiki_read ${url.slice(url.lastIndexOf("/") + 1)}`, () =>
      checkCase(`wiki_read ${url}`, (offset) => call("wiki_read", { url, offset }), !ownPages),
    );
  }
  if (!ownPages) {
    for (const c of PLACE_CASES) {
      await attempt(`wiki_place_page ${c.standardPlace} ${c.section}`, () =>
        checkCase(`wiki_place_page ${JSON.stringify(c)}`, (offset) => call("wiki_place_page", { ...c, offset }), true),
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
  // No `env`: the SDK passes HOME, PATH and a few more by default, which is all the server needs
  // (it finds its config through os.homedir()). It leaves NODE_OPTIONS out, so the server runs on
  // Node's own defaults plus what the build sets, whatever this shell has exported.
  const transport = new StdioClientTransport({
    command: "node",
    args: ["build/index.js"],
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

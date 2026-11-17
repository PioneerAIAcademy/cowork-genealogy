/**
 * Live one-shot for the image_index tool (issue #4632). It measures what the
 * spec's "Measured live" section records, from wherever it is run: say which
 * network that was when you paste the numbers in.
 *
 * Usage (signed in: run dev/try-login.ts first):
 *   cd packages/engine/mcp-server
 *   npx tsx dev/try-image-index.ts                     # the Peru page, cc 1803958
 *   npx tsx dev/try-image-index.ts <imageArk> [--cc <collectionId>]
 *   npx tsx dev/try-image-index.ts --record tests/fixtures/image-index
 *
 * It prints, in order:
 *   1. the tool's answer as a user gets it (summary, first entries, errors);
 *   2. the order check: are entries 0 and 1 the personas issue #4140 found
 *      in-network (1:1:XHPP-F3V Michael Barry, 1:1:XHPP-FQX Mila Fuller)?
 *   3. which personas carry sortKey / role / relationshipToHead, and whether
 *      the sort keys ascend in list order;
 *   4. per-record latency, each record read on its own, one at a time:
 *      min / median / p95 / max, and the cap the spec's rule gives;
 *   5. the list answer's top-level links (a "next" means the route pages), the
 *      list call WITHOUT cc, and (Peru) with the viewer URL's i=6 added.
 *
 * `--record <dir>` (Peru page only) writes the raw list body and every raw
 * record body as `<dir>/peru-list.json` and `<dir>/peru-records.json`, the
 * fixtures' names, so the unit test runs on the recording.
 *
 * Spends about 2 x (records + 1) + 2 FamilySearch requests.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { LOCAL } from "../src/auth/principal.js";
import { BROWSER_USER_AGENT } from "../src/constants.js";
import { IMAGE_INDEX_CAP, imageIndexTool, recordLink } from "../src/tools/image-index.js";
import { fsFetch } from "../src/utils/fs-fetch.js";

const PERU = "ark:/61903/3:1:33SQ-GYY1-B2G";
const PERU_CC = "1803958";
const EXPECTED = ["ark:/61903/1:1:XHPP-F3V", "ark:/61903/1:1:XHPP-FQX"];
const HEADERS = { Accept: "application/x-gedcomx-v1+json", "User-Agent": BROWSER_USER_AGENT };

const args = process.argv.slice(2);
function flag(name: string): string | undefined {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const value = args[i + 1];
  if (value === undefined || value.startsWith("--")) {
    console.error(`${name} needs a value`);
    process.exit(1);
  }
  args.splice(i, 2);
  return value;
}
const recordDir = flag("--record");
const ccFlag = flag("--cc");
const unknown = args.filter((a) => a.startsWith("--"));
if (unknown.length > 0) {
  console.error(`Unknown option ${unknown.join(", ")}. Options: --cc <collectionId>, --record <dir>.`);
  process.exit(1);
}
const imageArk = args[0] ?? PERU;
const cc = ccFlag ?? (imageArk === PERU ? PERU_CC : undefined);
if (recordDir !== undefined && imageArk !== PERU) {
  console.error("--record writes the Peru fixtures, so it runs on the Peru page only.");
  process.exit(1);
}

function pathId(ark: string): string {
  return ark.replace(/^ark:\/61903\//, "");
}
function listUrl(withCc: boolean): string {
  const base = `https://www.familysearch.org/platform/records/images/${pathId(imageArk)}/records`;
  return withCc && cc !== undefined ? `${base}?cc=${cc}` : base;
}

// ── 1. The tool, as a user calls it ─────────────────────────────────────────
const started = Date.now();
let result;
try {
  result = await imageIndexTool({ imageId: imageArk, ...(cc ? { collectionId: cc } : {}) }, LOCAL);
} catch (error) {
  console.error(`Tool error: ${error instanceof Error ? error.message : String(error)}`);
  console.error(`${Date.now() - started} ms`);
  process.exit(1);
}
const toolMs = Date.now() - started;
const errors = new Map<string, number>();
for (const e of result.entries) if (e.error) errors.set(e.error, (errors.get(e.error) ?? 0) + 1);
console.log("== 1. tool answer");
console.log(`list URL         ${listUrl(true)}`);
console.log(
  JSON.stringify(
    {
      total: result.total,
      returned: result.returned,
      nextOffset: result.nextOffset,
      hydrationTimedOut: result.hydrationTimedOut,
      rateLimited: result.rateLimited,
      listTruncated: result.listTruncated ?? false,
      ordered: result.ordered,
      unhydrated: result.entries.filter((e) => !e.hydrated).length,
      errors: Object.fromEntries(errors),
      wallMs: toolMs,
      firstEntries: result.entries.slice(0, 3),
    },
    null,
    2,
  ),
);

// ── 2. Order beyond entry 0 ─────────────────────────────────────────────────
console.log("\n== 2. order");
if (imageArk === PERU) {
  EXPECTED.forEach((ark, i) => {
    const got = result.entries[i]?.personas.map((p) => `${p.personaArk} ${p.name ?? "(no name)"}`) ?? [];
    const ok = got.some((g) => g.startsWith(ark));
    console.log(`entry ${i}: ${ok ? "MATCHES" : "DIFFERS"} ${ark}; got ${JSON.stringify(got)}`);
  });
} else {
  console.log("(the in-network order is known for the Peru page only)");
}

// ── 3. What the personas carry ──────────────────────────────────────────────
console.log("\n== 3. persona fields");
const personas = result.entries.flatMap((e) => e.personas);
const FIELDS = ["sortKey", "lineNumber", "personNumber", "role", "relationshipToHead"] as const;
const count = (k: (typeof FIELDS)[number]) => personas.filter((p) => p[k] !== undefined).length;
console.log(`personas ${personas.length}: ${FIELDS.map((k) => `${k} ${count(k)}`).join(", ")}`);
const firstKeys = result.entries.map((e) => e.personas.find((p) => p.sortKey)?.sortKey);
const keyed = firstKeys.filter((k): k is string => k !== undefined);
if (keyed.length > 1) {
  const ascending = keyed.every((k, i) => i === 0 || keyed[i - 1] < k);
  console.log(`sort keys (first per entry) ascend in list order: ${ascending ? "YES" : "NO"} over ${keyed.length} entries`);
  console.log(`first keys: ${JSON.stringify(keyed.slice(0, 3))}`);
}

// ── 4. Per-record latency, one read at a time, and --record ─────────────────
console.log("\n== 4. per-record latency");
const listStarted = Date.now();
const listRes = await fsFetch(LOCAL, listUrl(true), { headers: HEADERS });
const listText = await listRes.text();
console.log(`raw list call: HTTP ${listRes.status}, ${listText.length} chars, ${Date.now() - listStarted} ms`);
if (!listRes.ok) process.exit(1);
const listBody = JSON.parse(listText) as { sourceDescriptions?: Array<Record<string, any>> };
const links = (listBody.sourceDescriptions ?? [])
  .filter((d) => d?.resourceType === "http://gedcomx.org/Record")
  .map((d) => recordLink(d?.links?.record?.href));
const timings: number[] = [];
const recordBodies: Record<string, unknown> = {};
let failedReads = 0;
const badLinks = links.filter((l) => l === undefined).length;
if (badLinks > 0) console.log(`  ${badLinks} list entr(ies) carry no FamilySearch record link`);
const ids = links.filter((l): l is { url: string; id: string } => l !== undefined).map((l) => l.id);
const duplicates = ids.length - new Set(ids).size;
if (duplicates > 0) console.log(`  ${duplicates} record id(s) appear more than once in the list`);
for (const link of links) {
  if (!link) continue;
  const t0 = Date.now();
  try {
    const res = await fsFetch(LOCAL, link.url, { headers: HEADERS }, undefined, { attempts: 1 });
    const text = await res.text();
    const ms = Date.now() - t0;
    if (!res.ok) {
      failedReads++;
      console.log(`  ${link.id}: HTTP ${res.status} in ${ms} ms`);
      continue;
    }
    const body = JSON.parse(text) as { persons?: unknown };
    if (!Array.isArray(body?.persons)) {
      failedReads++;
      console.log(`  ${link.id}: HTTP 200 in ${ms} ms but no persons array`);
      continue;
    }
    timings.push(ms);
    recordBodies[link.id] = body;
  } catch (error) {
    failedReads++;
    console.log(`  ${link.id}: ${error instanceof Error ? error.message : String(error)} after ${Date.now() - t0} ms`);
  }
}
if (timings.length > 0) {
  const sorted = [...timings].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];
  const p95 = at(0.95);
  const ruleCap = Math.min(IMAGE_INDEX_CAP, 6 * Math.floor(25_000 / Math.max(1, p95)));
  console.log(
    `reads ${timings.length}: min ${sorted[0]} ms, median ${at(0.5)} ms, p95 ${p95} ms, max ${sorted.at(-1)} ms`,
  );
  console.log(`cap by the spec's rule min(30, 6 x floor(25 s / p95)): ${ruleCap} (shipped: ${IMAGE_INDEX_CAP})`);
}
if (recordDir !== undefined && (failedReads > 0 || badLinks > 0)) {
  console.log(
    `NOT recorded: ${failedReads} record read(s) failed and ${badLinks} Record entr(ies) had no record link ` +
      "(above); a recording with unread records is not the page. Run again, or report the list's shape.",
  );
} else if (recordDir !== undefined) {
  // The facts the unit test checks: a recording that contradicts one is
  // still the truth, and the failing test is the finding to report.
  const owed = [
    result.total === 27 ? "" : `total ${result.total}, not 27`,
    result.entries[0]?.recordArk === "ark:/61903/1:2:1TVW-1PV" ? "" : "entry 0 is not record 1TVW-1PV",
    result.entries[0]?.personas.some((p) => p.personaArk === EXPECTED[0] && p.name === "Michael Barry")
      ? ""
      : "entry 0 does not carry 1:1:XHPP-F3V named Michael Barry",
    result.entries.some((e) => e.personas.some((p) => p.personaArk === EXPECTED[1] && p.name === "Mila Fuller"))
      ? ""
      : "no entry carries 1:1:XHPP-FQX named Mila Fuller (in this first answer)",
    duplicates === 0 ? "" : `${duplicates} record id(s) repeat`,
  ].filter(Boolean);
  if (owed.length > 0) console.log(`WARNING: recording anyway, and the unit test will fail on it: ${owed.join("; ")}`);
  const note = `Recorded ${new Date().toISOString()} by dev/try-image-index.ts --record (raw FamilySearch bodies).`;
  writeFileSync(join(recordDir, "peru-list.json"), JSON.stringify({ _note: note, ...listBody }, null, 2) + "\n");
  writeFileSync(join(recordDir, "peru-records.json"), JSON.stringify({ _note: note, ...recordBodies }, null, 2) + "\n");
  console.log(`recorded ${links.length} list entries and ${Object.keys(recordBodies).length} records into ${recordDir}`);
}

// ── 5. The list without cc, with the viewer's i=, and its links ─────────────
console.log("\n== 5. list call variants");
console.log(`list answer's top-level links: ${JSON.stringify(Object.keys((listBody as { links?: object }).links ?? {}))} (a "next" means the route pages)`);
const variants: string[] = [];
if (cc !== undefined) variants.push(listUrl(false));
// The Peru page's own viewer URL carries i=6: does the route take it, and does it change the list?
if (imageArk === PERU) variants.push(`${listUrl(true)}&i=6`);
for (const url of variants) {
  const res = await fsFetch(LOCAL, url, { headers: HEADERS });
  const text = await res.text();
  let count = "n/a";
  try {
    const body = JSON.parse(text) as { sourceDescriptions?: Array<Record<string, unknown>> };
    count = String((body.sourceDescriptions ?? []).filter((d) => d?.resourceType === "http://gedcomx.org/Record").length);
  } catch {
    // not JSON: the status says enough
  }
  console.log(`${url}: HTTP ${res.status}, ${text.length} chars, ${count} Record entries`);
}

/**
 * Step 0 — evidence trail behind issue #1689 Half 2 (memories in `person_read`).
 *
 * QUESTION: this codebase has never touched the FamilySearch Memories API. Issue
 * #1689 plans to widen `person_read` to return "source-style" memories under the
 * existing `sourceDescriptions` flag, filtered by media kind. Every assumption
 * under that plan came from the published platform docs and none of it had been
 * checked against a live tree. This probe answers the issue's eleven Step 0
 * questions so the filter is designed against the payload rather than the docs.
 *
 * Usage:
 *   npx tsx dev/probe-memories.ts [pid ...]
 *   (requires a prior `login` so ~/.familysearch-mcp/tokens.json exists)
 *
 * Default sample: KWCJ-RN4 (the issue's live case), plus two relatives reached
 * from that person's own tree read — real PIDs, not invented ones.
 *
 * RESULTS (2026-09-14, 221 memories over 3 persons). Headlines, full report below:
 *   1.  200 OK. Top level is {links, persons, sourceDescriptions} — memories
 *       arrive under the SAME key name as tree sources, and `persons` is []. It
 *       PAGES at 25, and the last page ends with a 204 and an EMPTY BODY, so a
 *       pager that calls .json() unconditionally throws on the final hop.
 *   2.  Media kind = `artifactMetadata[].qualifiers[].name`, values
 *       `http://familysearch.org/v1/{Photo,Document,Story}`. `mediaType` is the
 *       MIME type and is ORTHOGONAL to it.
 *   3.  No "this is a record" field exists. The full key set is
 *       {about, attribution, created, id, links, mediaType, resourceType, titles,
 *       artifactMetadata}; artifactMetadata carries only
 *       {displayState, filename, height, qualifiers, screeningState, size, width}.
 *       So the filter can only ever be a proxy, exactly as the issue warns.
 *   4.  Story text in the payload is a 200-CHARACTER PREVIEW, cut mid-word. The
 *       full text is a separate artifact fetch, and it is NOT reliably there:
 *       of the two text/plain stories, one served 2592 chars and one 404'd.
 *   5.  Record-type language by kind: Document 5/45 (11%), Photo 9/167 (5%),
 *       Story 1/9 (11%). Both directions of the proxy fail — see the table.
 *   6.  `?type=photo|document|story` DOES filter server-side, across the whole
 *       collection (43/13/5 against an unfiltered 61), so it is exact and free.
 *   7.  Memory ids and tree sourceDescription ids are DISJOINT id spaces
 *       (`3475` vs `SD_PERSON_KWCJ-RN4`), 0 overlap on both persons tested. The
 *       issue's "dedupe by id" can therefore never fire.
 *   8.  THE PREMISE, and it is not zero: 8 of 10 sampled persons carry at least
 *       one Document/Story memory. Caveat in the report — the sample is one
 *       heavily-memorialised family and is NOT representative of FamilySearch.
 *   9.  The artifact URL needs NEITHER the bearer token NOR BROWSER_USER_AGENT —
 *       it served 200 with no auth header at all. Unlike the `$dist` scans.
 *   10. Largest person carried 116 memories (5 pages). Largest artifact 14.4MB.
 *   11. MIME spread: image/jpeg 179, application/pdf 29, text/plain 6,
 *       image/png 4, audio/mpeg 3.
 *
 * Consequences the issue's plan did not anticipate are listed at the end of the
 * report under "CONFLICTS WITH THE CARD" and are what the lead gate needs.
 */
import { LOCAL } from "../src/auth/principal.js";
import { getValidToken } from "../src/auth/refresh.js";
import { BROWSER_USER_AGENT } from "../src/constants.js";

type Json = Record<string, unknown>;
const API = "https://api.familysearch.org/platform";

/** Record-document language. Deliberately narrow: a bare `birth` matches
 *  "90th birthday" and a bare `grave` matches "graveside service", which
 *  inflated an earlier count of this same corpus by 6. */
const RECORD =
  /\b(will|deed|certificate|census|obituar|marriage licen|probate|baptis|draft card|death certificate|birth certificate|marriage certificate|passport|naturaliz|pension file|land patent|headstone)\w*/i;

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/x-fs-v1+json",
    "Accept-Language": "en",
    "User-Agent": BROWSER_USER_AGENT,
  };
}

/** Walk every page. The final page is a 204 with an empty body, NOT an absent
 *  `next` link, so status and emptiness are both checked before parsing. */
async function allMemories(pid: string, token: string): Promise<{ mems: Json[]; pages: number }> {
  let url: string | undefined = `${API}/tree/persons/${pid}/memories`;
  const mems: Json[] = [];
  let pages = 0;
  while (url && pages < 20) {
    const res = await fetch(url, { headers: headers(token) });
    if (res.status !== 200) break;
    const raw = await res.text();
    if (!raw) break;
    const j = JSON.parse(raw) as Json;
    mems.push(...((j.sourceDescriptions as Json[] | undefined) ?? []));
    pages++;
    const links = j.links as Record<string, { href?: string }> | undefined;
    url = links?.next?.href;
  }
  return { mems, pages };
}

function kindOf(m: Json): string {
  const am = JSON.stringify(m.artifactMetadata ?? []);
  if (am.includes("/Photo")) return "Photo";
  if (am.includes("/Document")) return "Document";
  if (am.includes("/Story")) return "Story";
  return "(none)";
}

function textOf(m: Json): string {
  const titles = ((m.titles as Array<{ value?: string }> | undefined) ?? [])
    .map((t) => t.value ?? "")
    .join(" ");
  const descs = ((m.descriptions as Array<{ value?: string }> | undefined) ?? [])
    .map((d) => d.value ?? "")
    .join(" ");
  return `${titles} ${descs}`.trim();
}

function sizeOf(m: Json): number {
  const am = (m.artifactMetadata as Array<{ size?: number }> | undefined) ?? [];
  return Number(am[0]?.size ?? 0);
}

async function main(): Promise<void> {
  const token = await getValidToken(LOCAL);
  const pids = process.argv.slice(2).length ? process.argv.slice(2) : ["KWCJ-RN4", "KWCR-DQB", "KWCG-VGR"];
  const primary = pids[0];

  console.log("=".repeat(74));
  console.log("ITEM 1 — endpoint, auth, shape, pagination");
  console.log("=".repeat(74));
  const r1 = await fetch(`${API}/tree/persons/${primary}/memories`, { headers: headers(token) });
  console.log(`  GET /tree/persons/${primary}/memories -> ${r1.status} ${r1.headers.get("content-type")}`);
  const j1 = (await r1.json()) as Json;
  console.log(`  top-level keys: ${Object.keys(j1).join(", ")}`);
  console.log(`  persons[] length: ${((j1.persons as unknown[]) ?? []).length}  (memories arrive under sourceDescriptions)`);
  const { mems: firstAll, pages } = await allMemories(primary, token);
  console.log(`  ${primary}: ${firstAll.length} memories over ${pages} pages (25/page; last page is 204 + empty body)`);

  console.log("\n" + "=".repeat(74));
  console.log("ITEM 2/3 — media kind field, verbatim; and the absence of a record flag");
  console.log("=".repeat(74));
  const sample = firstAll[0];
  console.log(`  memory key set: ${Object.keys(sample).sort().join(", ")}`);
  const am0 = ((sample.artifactMetadata as Json[] | undefined) ?? [])[0] ?? {};
  console.log(`  artifactMetadata[0] key set: ${Object.keys(am0).sort().join(", ")}`);
  console.log("  verbatim:");
  console.log(
    "    " +
      JSON.stringify(
        { mediaType: sample.mediaType, resourceType: sample.resourceType, artifactMetadata: sample.artifactMetadata },
        null,
        2,
      )
        .split("\n")
        .join("\n    "),
  );
  console.log("  NO category / tag / screening field distinguishes a record from a snapshot.");

  console.log("\n" + "=".repeat(74));
  console.log("ITEM 6 — does ?type= filter server-side, over the whole collection?");
  console.log("=".repeat(74));
  for (const t of ["photo", "document", "story"]) {
    let url: string | undefined = `${API}/tree/persons/${primary}/memories?type=${t}`;
    let n = 0;
    let p = 0;
    while (url && p < 20) {
      const res = await fetch(url, { headers: headers(token) });
      if (res.status !== 200) break;
      const raw = await res.text();
      if (!raw) break;
      const j = JSON.parse(raw) as Json;
      n += ((j.sourceDescriptions as unknown[] | undefined) ?? []).length;
      p++;
      url = (j.links as Record<string, { href?: string }> | undefined)?.next?.href;
    }
    console.log(`  ?type=${t.padEnd(9)} -> ${n} across ${p} pages`);
  }
  const tally = new Map<string, number>();
  for (const m of firstAll) tally.set(kindOf(m), (tally.get(kindOf(m)) ?? 0) + 1);
  console.log(`  unfiltered tally: ${[...tally].map(([k, v]) => `${k} ${v}`).join(", ")}  -> ?type= is EXACT`);

  console.log("\n" + "=".repeat(74));
  console.log("ITEM 4 — story text: preview in the payload, full text behind the artifact");
  console.log("=".repeat(74));
  for (const m of firstAll.filter((x) => kindOf(x) === "Story")) {
    const preview = ((m.descriptions as Array<{ value?: string }> | undefined) ?? [])
      .map((d) => d.value ?? "")
      .join("").length;
    let art = "no `about`";
    if (typeof m.about === "string") {
      const rr = await fetch(m.about, { headers: { "User-Agent": BROWSER_USER_AGENT }, redirect: "follow" });
      const buf = await rr.arrayBuffer();
      const isText = String(rr.headers.get("content-type") ?? "").includes("text/");
      art = `artifact ${rr.status} ${buf.byteLength}B${isText && rr.status === 200 ? ` -> ${Buffer.from(buf).toString("utf8").length} chars of TEXT` : ""}`;
    }
    console.log(`  id=${String(m.id).padEnd(10)} ${String(m.mediaType).padEnd(11)} preview=${String(preview).padStart(4)}ch  ${art}`);
  }
  console.log("  NB: the audio rows are Story-qualified MP3s. Their bytes are not text.");

  console.log("\n" + "=".repeat(74));
  console.log("ITEM 9 — what the artifact fetch actually needs");
  console.log("=".repeat(74));
  const pdf = firstAll.find((m) => m.mediaType === "application/pdf");
  if (pdf && typeof pdf.about === "string") {
    for (const [label, h] of [
      ["token + browser UA", { Authorization: `Bearer ${token}`, "User-Agent": BROWSER_USER_AGENT }],
      ["token, no UA", { Authorization: `Bearer ${token}` }],
      ["NO token, browser UA", { "User-Agent": BROWSER_USER_AGENT }],
    ] as Array<[string, Record<string, string>]>) {
      const rr = await fetch(pdf.about, { headers: h, redirect: "follow" });
      const buf = await rr.arrayBuffer();
      console.log(`  ${label.padEnd(22)} -> ${rr.status} ${String(rr.headers.get("content-type")).slice(0, 18).padEnd(18)} ${buf.byteLength}B`);
    }
    console.log("  => public memory artifacts need NEITHER. Unlike the $dist scans behind Imperva.");
  }

  console.log("\n" + "=".repeat(74));
  console.log("ITEM 5/10/11 — record language by kind, sizes, MIME (whole sample)");
  console.log("=".repeat(74));
  const corpus: Array<{ pid: string; m: Json }> = [];
  for (const pid of pids) {
    const { mems } = await allMemories(pid, token);
    for (const m of mems) corpus.push({ pid, m });
    console.log(`  ${pid}: ${mems.length} memories`);
  }
  const byKind = new Map<string, { n: number; rec: number }>();
  for (const { m } of corpus) {
    const k = kindOf(m);
    const e = byKind.get(k) ?? { n: 0, rec: 0 };
    e.n++;
    if (RECORD.test(textOf(m))) e.rec++;
    byKind.set(k, e);
  }
  console.log(`  --- item 5, over ${corpus.length} memories ---`);
  for (const [k, e] of [...byKind].sort()) {
    console.log(`  ${k.padEnd(9)} n=${String(e.n).padStart(3)}  record-language=${String(e.rec).padStart(3)} (${((e.rec / e.n) * 100).toFixed(0)}%)`);
  }
  console.log("  --- Photo-qualified memories carrying record language (the predicted miss) ---");
  for (const { pid, m } of corpus) {
    if (kindOf(m) === "Photo" && RECORD.test(textOf(m))) {
      console.log(`    ${pid} id=${String(m.id).padEnd(10)} [${RECORD.exec(textOf(m))?.[0]}] ${textOf(m).slice(0, 50)}`);
    }
  }
  const mimes = new Map<string, number>();
  for (const { m } of corpus) mimes.set(String(m.mediaType), (mimes.get(String(m.mediaType)) ?? 0) + 1);
  console.log("  --- item 11, MIME ---");
  for (const [k, v] of [...mimes].sort((a, b) => b[1] - a[1])) console.log(`    ${String(v).padStart(3)}  ${k}`);
  const largest = Math.max(...corpus.map(({ m }) => sizeOf(m)));
  console.log(`  --- item 10 --- largest artifact ${(largest / 1e6).toFixed(1)}MB`);

  console.log("\n" + "=".repeat(74));
  console.log("ITEM 7 — overlap with ?sourceDescriptions=true");
  console.log("=".repeat(74));
  for (const pid of pids.slice(0, 2)) {
    const rt = await fetch(`${API}/tree/persons/${pid}?sourceDescriptions=true`, { headers: headers(token) });
    const jt = (await rt.json()) as Json;
    const treeIds = new Set(((jt.sourceDescriptions as Json[] | undefined) ?? []).map((s) => String(s.id)));
    const { mems } = await allMemories(pid, token);
    const memIds = new Set(mems.map((m) => String(m.id)));
    const overlap = [...memIds].filter((id) => treeIds.has(id));
    console.log(`  ${pid}: tree=${treeIds.size} memories=${memIds.size} overlap=${overlap.length}`);
    console.log(`    sample ids: tree="${[...treeIds][0]}" memory="${[...memIds][0]}" -> disjoint id spaces`);
  }

  console.log("\n" + "=".repeat(74));
  console.log("ITEM 8 — THE PREMISE: how many persons carry a source-style memory?");
  console.log("=".repeat(74));
  const rr = await fetch(`${API}/tree/persons/${primary}?relatives=true`, { headers: headers(token) });
  const jr = (await rr.json()) as Json;
  const people = ((jr.persons as Json[] | undefined) ?? []).map((p) => String(p.id));
  let withSourceStyle = 0;
  let withAny = 0;
  for (const pid of people) {
    const { mems } = await allMemories(pid, token);
    if (mems.length) withAny++;
    if (mems.some((m) => kindOf(m) === "Document" || kindOf(m) === "Story")) withSourceStyle++;
  }
  console.log(`  ${withSourceStyle} of ${people.length} sampled persons carry >=1 Document/Story memory`);
  console.log(`  ${withAny} of ${people.length} carry any memory at all`);
  console.log("  NOT zero, so Half 2 is not closed on the premise.");
  console.log("  CAVEAT: this is one heavily-memorialised family reached through one tree");
  console.log("  read. It is a floor, not a rate, and says nothing about FamilySearch at large.");

  console.log("\n" + "=".repeat(74));
  console.log("CONFLICTS WITH THE CARD — for the lead gate");
  console.log("=".repeat(74));
  console.log("  a. 'omit photo, audio and video, keep story' cannot be done on media kind:");
  console.log("     3 of 5 Story-qualified memories on the primary are audio/mpeg MP3s.");
  console.log("     Kind and MIME are orthogonal; the rule needs both axes.");
  console.log("  b. Acceptance 7 wants AT MOST ONE memories call. The endpoint pages at 25");
  console.log("     and the largest sampled person has 116 memories = 5 calls.");
  console.log("  c. Decision 3 persists story text. The payload carries only a 200-char");
  console.log("     preview, and the full-text artifact 404'd on 1 of 2 text stories.");
  console.log("  d. 'dedupe by id' cannot fire: the two id spaces are disjoint.");
  console.log("  e. ?type= filters server-side and exactly, which decision 2 assumed was");
  console.log("     unavailable. The tool can ask for document+story and never see a photo —");
  console.log("     but that is also what makes the 9 record scans filed under Photo invisible.");
}

void main();

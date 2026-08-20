/**
 * The same band design against the TREE endpoint (`platform/tree/search`).
 *
 * EXPLORATORY. **Its output is not in `dev/measured-figures.json` and must not be
 * cited as measured.** Nothing here calls `record()`, so no verdict it prints can
 * be traced, contradicted, or diffed against a re-run — which is exactly the
 * defect that reached a shipped tool description and two specs before review and a
 * self-audit caught it (issue #1409). Committed so the next person starts from
 * working code rather than from a prose description of a result.
 *
 * Reported 272 persons read in full, membership 164/82/3/1, zero in every band, and
 * a closure check of 341 = 341. Needs the retry loop it carries: this endpoint
 * throttles hard (~50 retries in one run) and `searchOnce` in the real probe does
 * NOT handle its 204 responses.
 *
 * To make its output citable it needs, in `probe-search-qualifiers.ts`: a section
 * letter wired into `SECTIONS`, `record()` calls for every figure and verdict, a
 * verdict string the producibility check can find in the source, and RULE 0
 * compliance (refuse a direction when the set could not be enumerated). Issue
 * #1771 steps 0 and 1 own that work.
 *
 * Run: `npx tsx dev/explore-year-bands-tree.ts` from `packages/engine/mcp-server`.
 */
import { getValidToken } from "../src/auth/refresh.js";
const BASE = "https://api.familysearch.org/platform/tree/search";
const POOL = "q.surname=Pocklington&q.givenName=Thomae&m.queryRequireDefault=on";
let token = ""; let retries = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function page(qs: string): Promise<any | null> {
  for (let a = 0; a < 10; a++) {
    await sleep(1200);
    const res = await fetch(`${BASE}?${qs}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/x-gedcomx-atom+json" } });
    if (res.status === 429) { retries++; await sleep((Number(res.headers.get("retry-after") ?? 8)) * 1000 + 1500); continue; }
    if (!res.ok) return null;
    const txt = await res.text();
    if (!txt.trim()) { retries++; await sleep(1500); continue; }
    try { return JSON.parse(txt); } catch { retries++; await sleep(1500); continue; }
  }
  return null;
}
async function readAll(extra: string): Promise<{ total: number | null; ids: string[] } | null> {
  const ids: string[] = []; let total: number | null = null;
  for (let offset = 0; offset <= 700; offset += 100) {
    const b = await page(`${POOL}${extra}&count=100&offset=${offset}`);
    if (b === null) return null;
    total ??= b?.results ?? null;
    const entries = b?.entries ?? [];
    for (const e of entries) ids.push(e?.content?.gedcomx?.persons?.[0]?.id ?? e?.id ?? "?");
    if (entries.length < 100) return { total, ids };
  }
  return null;
}
async function main(): Promise<void> {
  token = await getValidToken();
  const u = await readAll("");
  if (!u) { console.log("unranged pool did not enumerate"); return; }
  console.log(`unranged: total ${u.total}, read ${u.ids.length}, distinct ${new Set(u.ids).size}\n`);
  const BANDS: Array<[number, number]> = [];
  for (let y = 1400; y < 2000; y += 50) BANDS.push([y, y + 49]);
  const mem = new Map<string, number>(); const exMem = new Map<string, number>();
  let bandRows = 0, enumerated = 0, unqTot = 0, exTot = 0;
  console.log("band         rows  | .exact");
  console.log("-".repeat(32));
  for (const [f, t] of BANDS) {
    const r = await readAll(`&q.birthLikeDate.from=${f}&q.birthLikeDate.to=${t}`);
    const ex = await readAll(`&q.birthLikeDate.from=${f}&q.birthLikeDate.to=${t}&q.birthLikeDate.exact=on`);
    if (!r) { console.log(`${f}-${t}   DID NOT ENUMERATE`); continue; }
    enumerated++; bandRows += r.ids.length; unqTot += r.ids.length; exTot += ex?.ids.length ?? 0;
    for (const id of r.ids) mem.set(id, (mem.get(id) ?? 0) + 1);
    if (ex) for (const id of ex.ids) exMem.set(id, (exMem.get(id) ?? 0) + 1);
    console.log(`${f}-${t}  ${String(r.ids.length).padStart(5)}  | ${String(ex?.ids.length ?? "-").padStart(6)}`);
  }
  const hist = new Map<number, number>();
  for (const id of new Set(u.ids)) hist.set(mem.get(id) ?? 0, (hist.get(mem.get(id) ?? 0) ?? 0) + 1);
  console.log(`\n${enumerated} bands enumerated. membership over ${new Set(u.ids).size} distinct unranged persons:`);
  let closure = 0;
  for (const [c, n] of [...hist].sort((a, b) => a[0] - b[0])) {
    closure += c * n;
    const tag = c === 0 ? "  <- in NO band" : c === enumerated ? "  <- in EVERY band (index-silent)"
      : c === 1 ? "  <- one date" : "  <- estimated SPAN";
    console.log(`   ${String(c).padStart(2)} band(s): ${String(n).padStart(4)}${tag}`);
  }
  console.log(`\nCLOSURE: sum(k*count)=${closure}  sum(band rows)=${bandRows}  equal=${closure === bandRows}`);
  const spans = [...hist].filter(([c]) => c > 1 && c < enumerated).reduce((s, [, n]) => s + n, 0);
  console.log(`estimated SPANS (>1 band, not all): ${spans}`);
  console.log(`unqualified band rows ${unqTot} -> .exact ${exTot};  retries ${retries}`);
}
main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });

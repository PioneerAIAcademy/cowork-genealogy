/**
 * TARGETED independent verification of the year-range finding (#1771 review).
 *
 * EXPLORATORY. Not recorded to `dev/measured-figures.json`; no `record()` call.
 * Written to re-check, by enumeration, the load-bearing claims in
 * `explore-year-bands-records.ts` / `explore-year-range-sweep-records.ts` WITHOUT a
 * full 12-band sweep — each check narrows to a set that reads to the end:
 *
 *   A. require-switch trap — surname-only total vs +givenName (should collapse).
 *   B. unranged pool enumerates; how many carry a payload birth year vs none.
 *   C. one dense band (1750-1799): unqualified count vs .exact (claim 364 -> 29),
 *      and the payload-dated control — a persona whose payload year is in-band is
 *      present in the band's unqualified read.
 *   D. a payload-silent persona swept across contiguous + far windows: if it answers
 *      a CONTIGUOUS bounded span it carries an indexed range, not silence.
 *
 * VERIFIED LIVE 2026-08-22 (pool drifts; direction and ratios reproduce):
 *   A require-switch  surname-only 5910 -> +givenName 583 (collapses; the switch is load-bearing).
 *   B unranged        583 read, 583 distinct, 172 payload-dated / 411 silent.
 *   C band 1750-1799  unqualified 364 -> .exact 29; the .exact COUNT equals the 29
 *                     payload-dated-in-band personas, all of which are in the unqualified read
 *                     (cardinality + subset — Check C does not compare the .exact set id-for-id),
 *                     consistent with .exact = 'indexed date inside the range'.
 *   D silent JMDT-LQD present in 1700-1749 and 1750-1799 ONLY -> a bounded indexed RANGE, not
 *                     silence (would hit every band) and not a single date (would hit one).
 *   Matches explore-year-bands-records.ts (364->29) and the range-sweep sibling number-for-number.
 *
 * Run: npx tsx dev/explore-year-band-verify.ts   (from packages/engine/mcp-server)
 */
import { getValidToken } from "../src/auth/refresh.js";
import { BROWSER_USER_AGENT } from "../src/constants.js";
import { fetchRetry, sleep } from "./http-retry.js";

const BASE = "https://www.familysearch.org/service/search/hr/v2/personas";
const POOL = "q.surname=Pocklington&q.givenName=Thomae&q.recordCountry=England&f.recordType=0";

interface Row { id: string; year: number | null }

async function req(qs: string): Promise<any | null> {
  await sleep(250);
  const token = await getValidToken();
  const res = await fetchRetry(`${BASE}?${qs}&m.queryRequireDefault=on`,
    { headers: { Authorization: `Bearer ${token}`, Accept: "application/json",
                 "Accept-Language": "en", "User-Agent": BROWSER_USER_AGENT } },
    { maxRetries: 8, baseMs: 4000, label: qs });
  if (res.status === 204) return { results: 0, entries: [] };
  if (!res.ok) return null;
  return res.json();
}

async function total(extra: string): Promise<number | null> {
  const b = await req(`${POOL}${extra}&count=1&offset=0`);
  return b ? (typeof b.results === "number" ? b.results : null) : null;
}

/** Enumerate to the end. null = did not enumerate (cap hit with a full page). */
async function readAll(extra: string, cap = 4900): Promise<{ total: number | null; rows: Row[] } | null> {
  const rows: Row[] = [];
  let total: number | null = null;
  for (let offset = 0; offset < cap; offset += 100) {
    const b = await req(`${POOL}${extra}&count=100&offset=${offset}`);
    if (b === null) return null;
    total ??= typeof b.results === "number" ? b.results : null;
    const entries = b.entries ?? [];
    for (const e of entries) {
      const m = (e?.content?.gedcomx?.persons ?? [])[0] ?? {};
      const yrs = ((m.facts ?? []) as any[])
        .filter((f) => /Birth|Christening|Baptism/i.test(f.type ?? ""))
        .map((f) => { const mm = /\b(1[0-9]{3})\b/.exec(f.date?.original ?? ""); return mm ? Number(mm[1]) : null; })
        .filter((y): y is number => y !== null);
      const disp = /\b(1[0-9]{3})\b/.exec((m.display ?? {}).birthDate ?? "");
      rows.push({ id: e.id, year: yrs[0] ?? (disp ? Number(disp[1]) : null) });
    }
    if (entries.length < 100) return { total, rows };
  }
  return null;
}

async function main(): Promise<void> {
  // A. require-switch trap
  const surnameOnly = await (async () => {
    const b = await req(`q.surname=Pocklington&q.recordCountry=England&f.recordType=0&count=1&offset=0`);
    return b ? b.results : null;
  })();
  const withGiven = await total("");
  console.log(`A. require-switch: surname-only=${surnameOnly}  surname+givenName=${withGiven}  (expect a large collapse)`);

  // B. unranged pool
  const u = await readAll("");
  if (!u) { console.log("B. unranged did NOT enumerate — aborting"); return; }
  const dated = u.rows.filter((r) => r.year !== null);
  console.log(`B. unranged: total ${u.total}, read ${u.rows.length}, distinct ${new Set(u.rows.map(r=>r.id)).size}; payload-dated ${dated.length}, silent ${u.rows.length - dated.length}`);

  // C. one dense band + .exact + payload control
  const BF = 1750, BT = 1799;
  const band = await readAll(`&q.birthLikeDate.from=${BF}&q.birthLikeDate.to=${BT}`);
  const bandEx = await readAll(`&q.birthLikeDate.from=${BF}&q.birthLikeDate.to=${BT}&q.birthLikeDate.exact=on`);
  if (!band || !bandEx) { console.log("C. band did not enumerate — aborting C"); }
  else {
    const bandIds = new Set(band.rows.map(r=>r.id));
    const inBandDated = dated.filter(r => (r.year as number) >= BF && (r.year as number) <= BT);
    const controlOk = inBandDated.every(r => bandIds.has(r.id));
    console.log(`C. band ${BF}-${BT}: unqualified=${band.rows.length} (total ${band.total})  .exact=${bandEx.rows.length} (total ${bandEx.total})  drop=${band.rows.length}->${bandEx.rows.length}`);
    console.log(`   payload-dated personas with year in [${BF},${BT}]: ${inBandDated.length}; all present in the band's unqualified read: ${controlOk}`);
  }

  // D. silent-persona range sweep — pick a silent id that IS in the 1750-1799 unqualified band
  const silentCandidate = (band?.rows ?? []).find(r => r.year === null && !dated.some(d=>d.id===r.id));
  const target = silentCandidate?.id ?? "NPBV-WBQ";
  console.log(`D. sweep for a payload-silent persona ${target} (contiguous bounded => indexed range):`);
  const windows: Array<[string,string]> = [
    ["1650-1699","&q.birthLikeDate.from=1650&q.birthLikeDate.to=1699"],
    ["1700-1749","&q.birthLikeDate.from=1700&q.birthLikeDate.to=1749"],
    ["1750-1799","&q.birthLikeDate.from=1750&q.birthLikeDate.to=1799"],
    ["1800-1849","&q.birthLikeDate.from=1800&q.birthLikeDate.to=1849"],
    ["1900-1949 (far)","&q.birthLikeDate.from=1900&q.birthLikeDate.to=1949"],
  ];
  for (const [label, w] of windows) {
    const r = await readAll(w);
    const hit = r ? r.rows.some(x => x.id === target) : null;
    console.log(`   ${label.padEnd(18)} ${r ? String(r.rows.length).padStart(4)+" rows" : "no-enum"}   target ${hit === null ? "?" : hit ? "PRESENT" : "absent"}`);
  }
}
main().catch((e) => { console.error("ERR", e instanceof Error ? e.message : String(e)); process.exit(1); });

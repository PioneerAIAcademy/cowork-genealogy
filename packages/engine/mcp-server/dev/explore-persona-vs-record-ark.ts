/**
 * Personas are the search result; records are what they belong to.
 *
 * EXPLORATORY. **Its output is not in `dev/measured-figures.json` and must not be
 * cited as measured.** Nothing here calls `record()`, so no verdict it prints can
 * be traced, contradicted, or diffed against a re-run — which is exactly the
 * defect that reached a shipped tool description and two specs before review and a
 * self-audit caught it (issue #1409). Committed so the next person starts from
 * working code rather than from a prose description of a result.
 *
 * Groups persona rows (`1:1:` arks) by their record ark (`1:2:`) and shows records
 * represented by more than one persona row in a single result set. Written after a
 * scope test in the real probe compared PERSONA arks and drew a conclusion about
 * RECORDS — see `probe-search-qualifiers.ts` around the `outOf` docblock, which
 * that misreading left wrong.
 *
 * NOT A MEASUREMENT, so citability does not apply. This demonstrates a defect in
 * how the endpoint or the probe behaves; its value is that the failure is silent
 * and inverts the reading, so an executable demonstration beats a warning in prose.
 * Keep it as an explorer. The candidate promotion is into a TEST, not a probe
 * section — a test would fail when the defect is fixed, which is the signal worth
 * having.
 *
 * Run: `npx tsx dev/explore-persona-vs-record-ark.ts` from `packages/engine/mcp-server`.
 */
import { getValidToken } from "../src/auth/refresh.js";
import { BROWSER_USER_AGENT } from "../src/constants.js";
import { fetchWithTimeout } from "../src/utils/http.js";

const YPOP = "q.surname=Pocklington&q.recordCountry=England&f.recordType=0";
const RANGE = "&q.birthLikeDate.from=1850&q.birthLikeDate.to=1854";
let token = "";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  token = await getValidToken();
  const rows: Array<{ pid: string; name: string; sds: string[] }> = [];
  for (let offset = 0; offset < 900; offset += 100) {
    await sleep(300);
    // `fetchWithTimeout`, not the global `fetch`: Node's fetch never times out on
    // its own, and these scripts page for tens of minutes against an endpoint that
    // throttles. `volume_search` once hung for 236 minutes on exactly this
    // (CLAUDE.md). `no-bare-fetch.test.ts` only walks `src/`, so nothing here would
    // have caught it; three existing dev probes already use the helper.
    const res = await fetchWithTimeout(
      `https://www.familysearch.org/service/search/hr/v2/personas?${YPOP}${RANGE}&count=100&offset=${offset}&m.queryRequireDefault=on`,
      { headers: { Authorization: `Bearer ${token}`, Accept: "application/json",
                   "Accept-Language": "en", "User-Agent": BROWSER_USER_AGENT } });
    // Without this, a 429 or 5xx yields an error object, `entries` is [], the
    // `entries.length < 100` check breaks the paging loop, and every figure below
    // is printed from a partial read with nothing marking it partial.
    //
    // No 204 branch, deliberately. `res.ok` IS true for 204, so on the TREE endpoint
    // that omission would hand an empty body to `res.json()` — the trap
    // `explore-tree-204-vs-429.ts` documents. This is the RECORDS endpoint, which
    // answers a zero-result query 200 with `entries: []` (measured side by side on
    // 2026-08-20, cases F and G of that script). A 204 branch here would be dead
    // code; the ones in the sibling records-endpoint readers are defensive only.
    if (!res.ok) {
      console.log(`  ABORTING: HTTP ${res.status} at offset ${offset} — figures below would be partial`);
      process.exit(1);
    }
    const b: any = await res.json();
    const entries = b?.entries ?? [];
    for (const e of entries) {
      const persons = e?.content?.gedcomx?.persons ?? [];
      const sds = (e?.content?.gedcomx?.sourceDescriptions ?? []).map((s: any) => s.about ?? "");
      rows.push({ pid: e.id, name: persons[0]?.display?.name ?? "?", sds });
    }
    if (entries.length < 100) break;
    if (offset + 100 >= 900) {
      console.log("  ABORTING: hit the 900-row cap with a full page — counts below would be partial");
      process.exit(1);
    }
  }

  // What shapes actually appear in sourceDescriptions.about?
  const shapes = new Map<string, number>();
  for (const r of rows) for (const a of r.sds) {
    const m = /1:(\d):/.exec(a);
    const key = m ? `1:${m[1]}: (${m[1] === "1" ? "persona" : m[1] === "2" ? "RECORD" : "?"})`
                  : (a.includes("/collections/") ? "collection URL" : a ? "other" : "(empty)");
    shapes.set(key, (shapes.get(key) ?? 0) + 1);
  }
  console.log(`rows: ${rows.length}`);
  console.log("sourceDescriptions.about shapes across all rows:");
  for (const [k, v] of [...shapes].sort((a, b) => b[1] - a[1])) console.log(`   ${k.padEnd(22)} ${v}`);

  // Group by the 1:2: record ark specifically.
  const byRecord = new Map<string, Array<{ pid: string; name: string }>>();
  let noRecordArk = 0;
  for (const r of rows) {
    const rec = r.sds.find((a) => /\/1:2:/.test(a));
    if (!rec) { noRecordArk++; continue; }
    const k = rec.replace(/^.*\/(1:2:[^/?]+).*$/, "$1");
    (byRecord.get(k) ?? byRecord.set(k, []).get(k)!).push({ pid: r.pid, name: r.name });
  }
  const groups = [...byRecord.entries()];
  const multi = groups.filter(([, v]) => v.length > 1);
  console.log(`\nrows with no 1:2: ark: ${noRecordArk}`);
  console.log(`distinct record arks : ${groups.length}`);
  console.log(`record arks holding >1 persona row: ${multi.length}`);
  console.log(`\nfirst 5 such groups — distinct persona ids sharing ONE record ark:`);
  for (const [rec, v] of multi.slice(0, 5)) {
    console.log(`  ${rec}`);
    for (const p of v) console.log(`      persona 1:1:${p.pid.padEnd(10)} ${p.name}`);
  }
  const allDistinct = multi.every(([, v]) => new Set(v.map((p) => p.pid)).size === v.length);
  console.log(`\nevery multi-row group has DISTINCT persona ids: ${allDistinct}`);
}
main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });

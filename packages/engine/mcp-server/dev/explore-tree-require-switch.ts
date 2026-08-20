/**
 * Trap 1: `m.queryRequireDefault=on` is mandatory, and its absence is silent.
 *
 * EXPLORATORY. **Its output is not in `dev/measured-figures.json` and must not be
 * cited as measured.** Nothing here calls `record()`, so no verdict it prints can
 * be traced, contradicted, or diffed against a re-run — which is exactly the
 * defect that reached a shipped tool description and two specs before review and a
 * self-audit caught it (issue #1409). Committed so the next person starts from
 * working code rather than from a prose description of a result.
 *
 * Without the switch every query returns the SURNAME-ONLY total (Pocklington 3,953
 * rather than 272), which reads convincingly as "the given name does not filter"
 * and is wrong. `buildSearchUrl` always sends it; anything probing by hand must
 * too. The last row of each block reproduces the bug deliberately.
 *
 * NOT A MEASUREMENT, so citability does not apply. This demonstrates a defect in
 * how the endpoint or the probe behaves; its value is that the failure is silent
 * and inverts the reading, so an executable demonstration beats a warning in prose.
 * Keep it as an explorer. The candidate promotion is into a TEST, not a probe
 * section — a test would fail when the defect is fixed, which is the signal worth
 * having.
 *
 * Run: `npx tsx dev/explore-tree-require-switch.ts` from `packages/engine/mcp-server`.
 */
import { getValidToken } from "../src/auth/refresh.js";
import { fetchWithTimeout } from "../src/utils/http.js";
const BASE = "https://api.familysearch.org/platform/tree/search";
const REQUIRE = "m.queryRequireDefault=on";   // the switch I dropped last time
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function total(qs: string): Promise<number | string> {
  for (let a = 0; a < 6; a++) {
    await sleep(600);
    // `fetchWithTimeout`, not the global `fetch`: Node's fetch never times out on
    // its own, and these scripts page for tens of minutes against an endpoint that
    // throttles. `volume_search` once hung for 236 minutes on exactly this
    // (CLAUDE.md). `no-bare-fetch.test.ts` only walks `src/`, so nothing here would
    // have caught it; three existing dev probes already use the helper.
    // Per request, not once up front: `getValidToken()` auto-refreshes, so a token
    // expiring mid-run cannot surface as a 401 that reads like a data value.
    const token = await getValidToken();
    const res = await fetchWithTimeout(`${BASE}?${qs}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/x-gedcomx-atom+json" } });
    if (res.status === 204) return 0;   // meaningful zero, not a retry
    if (res.status === 429) {
      // `??` only defends a MISSING header. RFC 7231 also allows an HTTP-date, and
      // `Number("Wed, 20 Aug 2026 07:00:00 GMT")` is NaN — which setTimeout treats as
      // 0ms, so every retry fires instantly and the run reports throttling it never
      // waited for. Same shape as the 204/429 inversion this file family documents.
      const ra = Number(res.headers.get("retry-after"));
      await sleep((Number.isFinite(ra) ? ra : 5) * 1000 + 500);
      continue;
    }
    if (!res.ok) return `HTTP ${res.status}`;
    const txt = await res.text();
    if (!txt.trim()) { await sleep(2000); continue; }   // transient empty body
    try { return JSON.parse(txt)?.results ?? "?"; } catch { await sleep(2000); continue; }
  }
  return "429";
}

async function main(): Promise<void> {
  // Different names, per the ask: a common English pair and two rare ones.
  const SETS: Array<[string, string[]]> = [
    ["Pocklington / Thomae", ["q.surname=Pocklington", "q.givenName=Thomae"]],
    ["Bickerdike / Joseph",  ["q.surname=Bickerdike", "q.givenName=Joseph"]],
    ["Ollerenshaw / Hannah", ["q.surname=Ollerenshaw", "q.givenName=Hannah"]],
  ];
  for (const [label, [sn, gn]] of SETS) {
    console.log(`\n=== ${label} ===`);
    const cases: Array<[string, string]> = [
      ["surname only",              `${sn}&count=1&${REQUIRE}`],
      ["+ givenName",               `${sn}&${gn}&count=1&${REQUIRE}`],
      ["+ givenName NONSENSE",      `${sn}&q.givenName=Xzqwbrtl&count=1&${REQUIRE}`],
      ["+ givenName .exact",        `${sn}&${gn}&q.givenName.exact=on&count=1&${REQUIRE}`],
      ["+ givenName NONSENSE .exact", `${sn}&q.givenName=Xzqwbrtl&q.givenName.exact=on&count=1&${REQUIRE}`],
      ["surname .exact + givenName", `${sn}&q.surname.exact=on&${gn}&count=1&${REQUIRE}`],
      ["NO require switch (old bug)", `${sn}&${gn}&count=1`],
    ];
    for (const [what, qs] of cases) {
      const t = await total(qs);
      console.log(`  ${what.padEnd(30)} ${String(t).padStart(8)}`);
      console.log(`      ${BASE}?${qs}`);
    }
  }
}
main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });

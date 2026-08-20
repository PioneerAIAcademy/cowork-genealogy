/**
 * Trap 2: on the TREE endpoint a zero-result query returns HTTP 204 with an empty
 * body, not 200. The RECORDS endpoint does not — it answers 200 with an empty
 * `entries` array. Measured side by side on 2026-08-20 (cases F and G), because the
 * direction was being recalled both ways in review and nothing in
 * `measured-figures.json` settles it:
 *
 *   TREE     q.surname=Xzqwbrtl&q.surname.exact=on  ->  204, body empty
 *   RECORDS  the same query                         ->  200, entries:[] (results 0)
 *
 * One query per endpoint, not an enumeration — enough to fix the direction, not a
 * general claim about every zero-result shape. The practical consequence: a 204
 * branch is load-bearing for tree readers and defensive-only for records readers.
 *
 * EXPLORATORY. **Its output is not in `dev/measured-figures.json` and must not be
 * cited as measured.** Nothing here calls `record()`, so no verdict it prints can
 * be traced, contradicted, or diffed against a re-run — which is exactly the
 * defect that reached a shipped tool description and two specs before review and a
 * self-audit caught it (issue #1409). Committed so the next person starts from
 * working code rather than from a prose description of a result.
 *
 * `res.ok` is true for 204, so a reader that parses the body or retries on emptiness
 * turns a meaningful zero into an error. 72 apparent "429s" across six surnames
 * were 204s — the answer arriving correctly on the first call. `personSearchTool`
 * handles this; the probe's `searchOnce` does not.
 *
 * NOT A MEASUREMENT, so citability does not apply. This demonstrates a defect in
 * how the endpoint or the probe behaves; its value is that the failure is silent
 * and inverts the reading, so an executable demonstration beats a warning in prose.
 * Keep it as an explorer. The candidate promotion is into a TEST, not a probe
 * section — a test would fail when the defect is fixed, which is the signal worth
 * having.
 *
 * Run: `npx tsx dev/explore-tree-204-vs-429.ts` from `packages/engine/mcp-server`.
 */
import { getValidToken } from "../src/auth/refresh.js";
import { fetchWithTimeout } from "../src/utils/http.js";
import { BROWSER_USER_AGENT } from "../src/constants.js";
const TREE = "https://api.familysearch.org/platform/tree/search";
const RECORDS = "https://www.familysearch.org/service/search/hr/v2/personas";
const R = "m.queryRequireDefault=on";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function probe(label: string, qs: string, base = TREE): Promise<void> {
  await sleep(3000);
  const token = await getValidToken();
  // `fetchWithTimeout`, not the global `fetch`: Node's fetch never times out on
  // its own, and these scripts page for tens of minutes against an endpoint that
  // throttles. `volume_search` once hung for 236 minutes on exactly this
  // (CLAUDE.md). `no-bare-fetch.test.ts` only walks `src/`, so nothing here would
  // have caught it; three existing dev probes already use the helper.
  const res = await fetchWithTimeout(`${base}?${qs}`, {
    headers: base === TREE
      ? { Authorization: `Bearer ${token}`, Accept: "application/x-gedcomx-atom+json" }
      : { Authorization: `Bearer ${token}`, Accept: "application/json",
          "Accept-Language": "en", "User-Agent": BROWSER_USER_AGENT } });
  const body = await res.text();
  console.log(`\n${label}`);
  console.log(`  status ${res.status} ${res.statusText}`);
  for (const h of ["retry-after","x-processing-time","warning","x-fs-error","content-type","content-length","x-ratelimit-remaining"]) {
    const v = res.headers.get(h); if (v) console.log(`  ${h}: ${v}`);
  }
  console.log(`  body(${body.length}): ${body.slice(0, 300).replace(/\s+/g," ") || "(empty)"}`);
}
async function main(): Promise<void> {
  await probe("A. nonsense givenName + .exact  (the failing shape)",
    `q.surname=Pocklington&q.givenName=Xzqwbrtl&q.givenName.exact=on&count=1&${R}`);
  await probe("B. real givenName + .exact  (works)",
    `q.surname=Pocklington&q.givenName=Thomae&q.givenName.exact=on&count=1&${R}`);
  await probe("C. nonsense givenName, no .exact  (works)",
    `q.surname=Pocklington&q.givenName=Xzqwbrtl&count=1&${R}`);
  await probe("D. nonsense SURNAME + surname.exact",
    `q.surname=Xzqwbrtl&q.surname.exact=on&count=1&${R}`);
  await probe("E. nonsense givenName + .exact, WITHOUT the require switch",
    `q.surname=Pocklington&q.givenName=Xzqwbrtl&q.givenName.exact=on&count=1`);

  // Which endpoints actually answer a zero-result query with 204? Added because the
  // claim in this docblock was TREE-only and was then being recalled both ways in
  // review, with nothing in `measured-figures.json` to settle it and no side-by-side
  // read anywhere. The same unmatchable query, put to both endpoints, one after the
  // other. Compare the two `status` lines.
  await probe("F. TREE, zero-result query — status?",
    `q.surname=Xzqwbrtl&q.surname.exact=on&count=1&${R}`, TREE);
  await probe("G. RECORDS, the same zero-result query — status?",
    `q.surname=Xzqwbrtl&q.surname.exact=on&count=1&${R}`, RECORDS);
}
main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });

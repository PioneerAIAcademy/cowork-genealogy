/**
 * Trap 2: a zero-result query returns HTTP 204 with an empty body, not 200.
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
 * To make its output citable it needs, in `probe-search-qualifiers.ts`: a section
 * letter wired into `SECTIONS`, `record()` calls for every figure and verdict, a
 * verdict string the producibility check can find in the source, and RULE 0
 * compliance (refuse a direction when the set could not be enumerated). Issue
 * #1771 steps 0 and 1 own that work.
 *
 * Run: `npx tsx dev/explore-tree-204-vs-429.ts` from `packages/engine/mcp-server`.
 */
import { getValidToken } from "../src/auth/refresh.js";
const BASE = "https://api.familysearch.org/platform/tree/search";
const R = "m.queryRequireDefault=on";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function probe(label: string, qs: string): Promise<void> {
  await sleep(3000);
  const token = await getValidToken();
  const res = await fetch(`${BASE}?${qs}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/x-gedcomx-atom+json" } });
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
}
main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });

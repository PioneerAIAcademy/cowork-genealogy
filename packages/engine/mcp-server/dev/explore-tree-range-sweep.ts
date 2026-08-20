/**
 * Does a payload-date-less persona answer a CONTIGUOUS band of year ranges?
 *
 * EXPLORATORY. **Its output is not in `dev/measured-figures.json` and must not be
 * cited as measured.** Nothing here calls `record()`, so no verdict it prints can
 * be traced, contradicted, or diffed against a re-run — which is exactly the
 * defect that reached a shipped tool description and two specs before review and a
 * self-audit caught it (issue #1409). Committed so the next person starts from
 * working code rather than from a prose description of a result.
 *
 * If it does, it carries an indexed date the search payload never exposes, and
 * payload-silence cannot stand in for index-silence — which is what section N of
 * the real probe already warned. Reported one persona answering 1490-1550 and no
 * window outside it.
 *
 * DELIBERATELY NOT CITABLE, and should stay that way. The lead's 2026-08-17 ruling
 * on the exact-match rule is explicit: on `person_search`, "state the direction and
 * the mechanism only, carry no figure from it, and do not add `person-search.ts` to
 * `EVIDENCE_SURFACES`". Promoting this into a probe section would manufacture
 * exactly the figures that ruling forbids. It exists to let a reader re-run the
 * check by hand, not to source a number.
 *
 * Run: `npx tsx dev/explore-tree-range-sweep.ts` from `packages/engine/mcp-server`.
 */
import { getValidToken } from "../src/auth/refresh.js";
import { BROWSER_USER_AGENT } from "../src/constants.js";

const POOL = "q.surname=Pocklington&q.givenName=Thomae&q.recordCountry=England&f.recordType=0";
const TARGET = "NPBV-WBQ";
let token = "";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function readAll(range: string): Promise<{ total: number | null; ids: string[] }> {
  const ids: string[] = [];
  let total: number | null = null;
  for (let offset = 0; offset < 600; offset += 100) {
    await sleep(300);
    const res = await fetch(
      `https://www.familysearch.org/service/search/hr/v2/personas?${POOL}${range}&count=100&offset=${offset}&m.queryRequireDefault=on`,
      { headers: { Authorization: `Bearer ${token}`, Accept: "application/json",
                   "Accept-Language": "en", "User-Agent": BROWSER_USER_AGENT } });
    if (!res.ok) return { total: null, ids };
    const b: any = await res.json();
    total ??= b?.results ?? null;
    const entries = b?.entries ?? [];
    for (const e of entries) ids.push(e.id);
    if (entries.length < 100) break;
  }
  return { total, ids };
}

async function main(): Promise<void> {
  token = await getValidToken();
  const windows: Array<[string, string]> = [
    ["no range at all", ""],
    ["1480-1489", "&q.birthLikeDate.from=1480&q.birthLikeDate.to=1489"],
    ["1490-1499", "&q.birthLikeDate.from=1490&q.birthLikeDate.to=1499"],
    ["1500-1505", "&q.birthLikeDate.from=1500&q.birthLikeDate.to=1505"],
    ["1506-1515", "&q.birthLikeDate.from=1506&q.birthLikeDate.to=1515"],
    ["1516-1530", "&q.birthLikeDate.from=1516&q.birthLikeDate.to=1530"],
    ["1531-1550", "&q.birthLikeDate.from=1531&q.birthLikeDate.to=1550"],
    ["1551-1564", "&q.birthLikeDate.from=1551&q.birthLikeDate.to=1564"],
    ["1565-1565", "&q.birthLikeDate.from=1565&q.birthLikeDate.to=1565"],
    ["1566-1600", "&q.birthLikeDate.from=1566&q.birthLikeDate.to=1600"],
    ["1700-1750", "&q.birthLikeDate.from=1700&q.birthLikeDate.to=1750"],
  ];
  console.log(`target persona 1:1:${TARGET} (Thomae Pocklington, zero facts in payload)\n`);
  console.log("window            total   rows read   target present?");
  console.log("-".repeat(58));
  for (const [label, range] of windows) {
    const { total, ids } = await readAll(range);
    const hit = ids.includes(TARGET);
    console.log(
      `${label.padEnd(17)} ${String(total ?? "err").padStart(5)}   ${String(ids.length).padStart(9)}   ${hit ? "*** YES ***" : "no"}`
    );
  }
}
main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });

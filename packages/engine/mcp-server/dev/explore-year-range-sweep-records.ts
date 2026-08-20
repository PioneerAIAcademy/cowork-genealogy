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
 * PROMOTE, alongside `explore-year-bands-records.ts`, under #1771 steps 0-1.
 *
 * **Renamed 2026-08-20 from `explore-tree-range-sweep.ts`, and its disposition
 * reversed.** It was committed as a tree script whose header justified
 * non-citability by the `person_search` ruling. Both were wrong: it queries the
 * RECORD index (`www.familysearch.org/service/search/hr/v2/personas`, with
 * `q.recordCountry` and `f.recordType`), not `platform/tree/search`. On the record
 * endpoint figures ARE allowed and section N already records this question, so the
 * ruling that forbids tree-side figures never applied here. Mis-filed by endpoint,
 * with the wrong reason written into its header.
 *
 * What it needs before its output is citable is the ordinary list: a section letter
 * wired into `SECTIONS`, `record()` calls, a verdict string the producibility check
 * can find in the source, and RULE 0 compliance.
 *
 * Run: `npx tsx dev/explore-year-range-sweep-records.ts` from `packages/engine/mcp-server`.
 */
import { getValidToken } from "../src/auth/refresh.js";
import { BROWSER_USER_AGENT } from "../src/constants.js";

const POOL = "q.surname=Pocklington&q.givenName=Thomae&q.recordCountry=England&f.recordType=0";
const TARGET = "NPBV-WBQ";
let token = "";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function readAll(range: string): Promise<{ total: number | null; ids: string[] } | null> {
  const ids: string[] = [];
  let total: number | null = null;
  // Attempts are capped per page: an unbounded `offset -= 100; continue` spins
  // forever on a persistently throttling endpoint, and this one throttles.
  let attempts = 0;
  for (let offset = 0; offset < 1500; offset += 100) {   // sibling REPORTED 585 (not in the artifact); 600 was too tight
    await sleep(300);
    const res = await fetch(
      `https://www.familysearch.org/service/search/hr/v2/personas?${POOL}${range}&count=100&offset=${offset}&m.queryRequireDefault=on`,
      { headers: { Authorization: `Bearer ${token}`, Accept: "application/json",
                   "Accept-Language": "en", "User-Agent": BROWSER_USER_AGENT } });
    if (res.status === 204) return { total: total ?? 0, ids };   // meaningful zero
    if (res.status === 429) {                                     // retry, do not truncate
      if (++attempts > 8) return null;                            // bounded: null, never a partial
      await sleep((Number(res.headers.get("retry-after") ?? 8)) * 1000 + 1500);
      offset -= 100;
      continue;
    }
    attempts = 0;
    // Any other non-OK: return null so the caller cannot mistake a partial read
    // for a complete one. Previously this returned the rows read so far with a
    // total already set from page 1, which printed a plausible row and a silent
    // false negative on the only conclusion this script draws.
    if (!res.ok) return null;
    const b: any = await res.json();
    total ??= b?.results ?? null;
    const entries = b?.entries ?? [];
    for (const e of entries) ids.push(e.id);
    // A short page means the set is COMPLETE — return it. Falling through to the
    // trailing `return null` (which is the cap-exhausted path) made every complete
    // read look like a failure, so main() printed ABORTED for every window and the
    // script could never reach its only conclusion.
    if (entries.length < 100) return { total, ids };
  }
  // Cap exhausted with a full last page: the read is PARTIAL and must not be
  // handed back looking complete — "target present? no" would be a false negative,
  // which is the only conclusion this script draws. The records sibling's readAll
  // returns null here for the same reason.
  return null;
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
    const r = await readAll(range);
    if (r === null) {
      console.log(`${label.padEnd(17)}   ABORTED — a page failed; a partial read would read as "target absent"`);
      continue;
    }
    const { total, ids } = r;
    const hit = ids.includes(TARGET);
    console.log(
      `${label.padEnd(17)} ${String(total ?? "err").padStart(5)}   ${String(ids.length).padStart(9)}   ${hit ? "*** YES ***" : "no"}`
    );
  }
}
main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });

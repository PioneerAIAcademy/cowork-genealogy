/**
 * WHAT IS the father-absent population on a births pool? (It is not what I claimed.)
 *
 * EXPLORATORY. **Its output is not in `dev/measured-figures.json` and must not be
 * cited as measured.** Nothing here calls `record()`.
 *
 * ## Why it exists
 *
 * A probe since deleted (`explore-relative-empty-field-families.ts`; its traps now
 * live in section R of `probe-search-qualifiers.ts`) found that requiring
 * `q.fatherGivenName=<a real name>` returns ZERO of the 258 personas its baseline
 * classified father-absent. That reads as a contradiction of the shipped
 * `spouseGivenName` description ("A record that names no spouse at all is kept too,
 * since silence is not a contradiction") and of #1324's premise, so the population
 * had to be checked before the finding could be believed.
 *
 * ## The hypothesis this script KILLED
 *
 * I asserted the 258 were PARENT personas — the fathers and mothers themselves,
 * dragged into an 1880 birth-year pool by the estimated-range mechanism (a persona
 * with no year of its own gets a range derived from other people on the record), and
 * therefore correctly excluded when a father is required. Measured instead:
 *
 *     father-ABSENT personas ................................. 258
 *       appear as a PARENT in their own record's graph ........   8
 *       appear as a CHILD  in their own record's graph ........ 230
 *       both / neither ....................................... 1 / 19
 *       flagged principal=true ............................... 247
 *
 * So the population is overwhelmingly PRINCIPALS, not parents. `resolveParentTerm`
 * returns `absent` for them because their record names a MOTHER and no father —
 * mother-only baptism registrations, common in 1880 Brazil — not because the graph
 * is missing or the persona is a parent. The population is legitimate and the
 * estimated-range explanation is dead. Do not revive it.
 *
 * ## How it was resolved — nothing here is open
 *
 * The zero-retention result stood on a sound population, so the QUERY SHAPE was
 * what was wrong. The pool was anchored on country, type, date and place with no
 * name term at all, which makes an unmatchable relative token the only name term
 * and returns an EMPTY set; membership in an empty set distinguishes nothing.
 * Section R of `probe-search-qualifiers.ts` anchors every population on
 * `q.surname=` and finds the opposite — `R.verdict:keep-silent` HOLDS, with
 * retention tracking the silent share — so the shipped rule stands, and the probe
 * that contradicted it has been deleted. The trap is recorded in R.
 *
 * Run: `npx tsx dev/explore-father-absent-principals-records.ts` from
 * `packages/engine/mcp-server`.
 */
import { getValidToken } from "../src/auth/refresh.js";
import { BROWSER_USER_AGENT } from "../src/constants.js";
import { fetchWithTimeout } from "../src/utils/http.js";
import { toSimplified } from "../src/utils/gedcomx-convert.js";
import { findRepresentedPerson, resolveRelativeTerms } from "../src/tools/record-search.js";

const BASE = "https://www.familysearch.org/service/search/hr/v2/personas";
const POOL = "q.recordCountry=Brazil&f.recordType=0&q.birthLikeDate.from=1880&q.birthLikeDate.to=1880" +
             "&q.birthLikePlace=Lapa&q.birthLikePlace.exact=on";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const rows: any[] = [];
  for (let offset = 0; offset < 1500; offset += 100) {
    await sleep(300);
    const token = await getValidToken();
    const res = await fetchWithTimeout(`${BASE}?${POOL}&count=100&offset=${offset}&m.queryRequireDefault=on`,
      { headers: { Authorization: `Bearer ${token}`, Accept: "application/json",
                   "Accept-Language": "en", "User-Agent": BROWSER_USER_AGENT } });
    if (res.status === 204) break;
    if (!res.ok) { console.log(`  ABORT HTTP ${res.status} — partial, refusing`); process.exit(1); }
    const b: any = await res.json();
    const es = b?.entries ?? [];
    rows.push(...es);
    if (es.length < 100) break;
  }
  console.log(`  baseline read: ${rows.length} personas`);

  const tally = { parentEndpoint: 0, childEndpoint: 0, both: 0, neither: 0, principalFlag: 0, total: 0 };
  const examples: string[] = [];
  for (const e of rows) {
    const picked = findRepresentedPerson(e);
    const raw = e.content?.gedcomx;
    if (!picked || !raw) continue;
    const simple = toSimplified(raw);
    const st = resolveRelativeTerms(simple, picked.person.id, [{ prefix: "father" }], picked.anchor);
    if (st?.father?.status !== "absent") continue;
    tally.total++;
    const id = picked.person.id;
    const rels = simple.relationships ?? [];
    const isParent = rels.some((r: any) => r.type === "ParentChild" && r.parent === id);
    const isChild  = rels.some((r: any) => r.type === "ParentChild" && r.child === id);
    if (isParent && isChild) tally.both++;
    else if (isParent) tally.parentEndpoint++;
    else if (isChild) tally.childEndpoint++;
    else tally.neither++;
    if ((picked.person as any).principal === true) tally.principalFlag++;
    if (examples.length < 6) {
      const n = simple.persons?.find((p: any) => p.id === id)?.names?.[0];
      const nm = [n?.given, n?.surname].filter(Boolean).join(" ") || "(no name parts)";
      examples.push(`${e.id}  "${nm}"  parentEndpoint=${isParent} childEndpoint=${isChild} principal=${(picked.person as any).principal === true}`);
    }
  }
  console.log(`\n  father-ABSENT personas: ${tally.total}`);
  console.log(`    appear as a PARENT in their own record's graph: ${tally.parentEndpoint}`);
  console.log(`    appear as a CHILD  in their own record's graph: ${tally.childEndpoint}`);
  console.log(`    both: ${tally.both}    neither: ${tally.neither}`);
  console.log(`    flagged principal=true: ${tally.principalFlag}`);
  console.log("\n  examples:");
  for (const x of examples) console.log(`    ${x}`);
}
main().catch((e) => { console.error(e); process.exit(1); });

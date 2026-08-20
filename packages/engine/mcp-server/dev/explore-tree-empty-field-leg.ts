/**
 * The empty-field leg on the tree endpoint, via an unmatchable given name.
 *
 * EXPLORATORY. **Its output is not in `dev/measured-figures.json` and must not be
 * cited as measured.** Nothing here calls `record()`, so no verdict it prints can
 * be traced, contradicted, or diffed against a re-run — which is exactly the
 * defect that reached a shipped tool description and two specs before review and a
 * self-audit caught it (issue #1409). Committed so the next person starts from
 * working code rather than from a prose description of a result.
 *
 * An unmatchable given name with the require switch returns the persons whose given
 * name is EMPTY; adding `.exact=on` returns zero. Reported across six surnames.
 * Note what this is NOT: the rule shipped on `person_search` rests on the lead's
 * provenance, not on this script.
 *
 * DELIBERATELY NOT CITABLE, and should stay that way. The lead's 2026-08-17 ruling
 * on the exact-match rule is explicit: on `person_search`, "state the direction and
 * the mechanism only, carry no figure from it, and do not add `person-search.ts` to
 * `EVIDENCE_SURFACES`". Promoting this into a probe section would manufacture
 * exactly the figures that ruling forbids. It exists to let a reader re-run the
 * check by hand, not to source a number.
 *
 * Run: `npx tsx dev/explore-tree-empty-field-leg.ts` from `packages/engine/mcp-server`.
 */
import { getValidToken } from "../src/auth/refresh.js";
const BASE = "https://api.familysearch.org/platform/tree/search";
const R = "m.queryRequireDefault=on";
let token = "";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function total(qs: string): Promise<{ v: number | string; tries: number }> {
  for (let a = 0; a < 12; a++) {
    await sleep(3000);
    const res = await fetch(`${BASE}?${qs}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/x-gedcomx-atom+json" } });
    // 204 = zero results. A MEANINGFUL ZERO, not transient. Without this branch
    // the empty body below falls into the retry, all 12 attempts are spent, and
    // the function returns the literal string "429 (gave up after 12)" — so this
    // script reported its OWN expected result (`.exact` returns zero) as rate
    // limiting. That is the exact inversion its sibling
    // explore-tree-204-vs-429.ts was written to expose, and it sat in this file
    // until 2026-08-20.
    if (res.status === 204) return { v: 0, tries: a + 1 };
    if (res.status === 429) {
      const ra = Number(res.headers.get("retry-after") ?? 15);
      await sleep((Number.isFinite(ra) ? ra : 15) * 1000 + 3000);
      continue;
    }
    if (!res.ok) return { v: `HTTP ${res.status}`, tries: a + 1 };
    const txt = await res.text();
    if (!txt.trim()) { await sleep(3000); continue; }
    try { return { v: JSON.parse(txt)?.results ?? "?", tries: a + 1 }; } catch { await sleep(3000); continue; }
  }
  return { v: "429 (gave up after 12)", tries: 12 };
}

async function main(): Promise<void> {
  token = await getValidToken();
  const SURNAMES = ["Zsigmondy", "Mingazzini", "Bochenek", "Ollerenshaw", "Bickerdike", "Pocklington"];
  console.log("tree endpoint — does .exact drop the persons whose given name is EMPTY?");
  console.log("(nonsense given name matches nothing, so what survives is the empty-field set)\n");
  console.log("surname        real gn   nonsense   nonsense+.exact   tries");
  console.log("-".repeat(66));
  for (const sn of SURNAMES) {
    const real = await total(`q.surname=${sn}&q.givenName=Joseph&count=1&${R}`);
    const non  = await total(`q.surname=${sn}&q.givenName=Xzqwbrtl&count=1&${R}`);
    const ex   = await total(`q.surname=${sn}&q.givenName=Xzqwbrtl&q.givenName.exact=on&count=1&${R}`);
    console.log(
      `${sn.padEnd(14)} ${String(real.v).padStart(7)}   ${String(non.v).padStart(8)}   ${String(ex.v).padStart(15)}   ${ex.tries}`
    );
  }
}
main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });

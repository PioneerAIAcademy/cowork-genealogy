/**
 * Find a scope small enough that the Smith/Smyth membership test can run.
 *
 * Section W's first attempt scoped with an UNQUALIFIED `q.birthLikePlace` and got
 * 2.6M hits, whose top 100 are all literal `Smith` — FamilySearch ranks
 * exact-spelling matches above fuzzy expansions almost absolutely, so a
 * membership test on that sample cannot tell ABSENT from OUTRANKED (the trap
 * section E documents). The cause was measurable and already known: an
 * unqualified place expands upward far enough that the county is irrelevant —
 * this script's first version measured Norfolk and Cornwall returning counts
 * 0.001% apart.
 *
 * So scope with a HARD filter instead. Section C measured `.exact=on` on a place
 * cutting a county-scoped marriage search from ~35,500 to 2, so place-exact is
 * the lever that actually restricts. What we want is a row where:
 *
 *   - `Smyth` + exact  >= 1        (the variant exists inside the scope)
 *   - `Smith` fuzzy    <= ~300     (the pool is scannable, 3 pages of 100)
 *
 * Nothing here is recorded to measured-figures.json; this only picks the scope.
 */
import { getValidToken } from "../src/auth/refresh.js";
import { BROWSER_USER_AGENT } from "../src/constants.js";

const URL_BASE = "https://www.familysearch.org/service/search/hr/v2/personas";
const SWITCH = "m.queryRequireDefault=on";
const THROTTLE_MS = 250;
let token = "";

async function total(q: string): Promise<number | null> {
  await new Promise((r) => setTimeout(r, THROTTLE_MS));
  const res = await fetch(`${URL_BASE}?${q}&count=1&${SWITCH}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Accept-Language": "en",
      "User-Agent": BROWSER_USER_AGENT,
    },
  });
  const body = await res.text();
  try {
    const j = JSON.parse(body) as { results?: number; errors?: string[] };
    if (j.errors?.length) return null;
    return j.results ?? null;
  } catch {
    return null;
  }
}

/** Hard-scoped candidates: place-exact plus a tight year range. */
const scopes: Array<[string, string]> = [
  [
    "Norfolk EXACT 1850-1851",
    "&q.birthLikePlace=Norfolk,%20England&q.birthLikePlace.exact=on" +
      "&q.birthLikeDate.from=1850&q.birthLikeDate.to=1851",
  ],
  [
    "Norfolk EXACT 1850-1855",
    "&q.birthLikePlace=Norfolk,%20England&q.birthLikePlace.exact=on" +
      "&q.birthLikeDate.from=1850&q.birthLikeDate.to=1855",
  ],
  [
    "Norwich EXACT 1840-1870",
    "&q.birthLikePlace=Norwich,%20Norfolk,%20England&q.birthLikePlace.exact=on" +
      "&q.birthLikeDate.from=1840&q.birthLikeDate.to=1870",
  ],
  [
    "marr. Norfolk EXACT 1850-1855",
    "&q.marriageLikePlace=Norfolk,%20England&q.marriageLikePlace.exact=on" +
      "&q.marriageLikeDate.from=1850&q.marriageLikeDate.to=1855",
  ],
  [
    "marr. Norfolk EXACT 1850-1860",
    "&q.marriageLikePlace=Norfolk,%20England&q.marriageLikePlace.exact=on" +
      "&q.marriageLikeDate.from=1850&q.marriageLikeDate.to=1860",
  ],
  [
    "Cornwall EXACT 1840-1870",
    "&q.birthLikePlace=Cornwall,%20England&q.birthLikePlace.exact=on" +
      "&q.birthLikeDate.from=1840&q.birthLikeDate.to=1870",
  ],
];

async function main(): Promise<void> {
  token = await getValidToken();
  const f = (n: number | null): string => (n === null ? "ERR" : n.toLocaleString("en-US"));
  console.log(
    "scope                            Smyth+ex   Smith fz   Smith+ex   Sm?th fz   Sm?th+ex   usable?"
  );
  for (const [label, scope] of scopes) {
    const smythEx = await total(`q.surname=Smyth&q.surname.exact=on${scope}`);
    const smithFz = await total(`q.surname=Smith${scope}`);
    const smithEx = await total(`q.surname=Smith&q.surname.exact=on${scope}`);
    const wildFz = await total(`q.surname=${encodeURIComponent("Sm?th")}${scope}`);
    const wildEx = await total(
      `q.surname=${encodeURIComponent("Sm?th")}&q.surname.exact=on${scope}`
    );
    const usable =
      smythEx !== null && smithFz !== null && smythEx >= 1 && smithFz > 0 && smithFz <= 300;
    console.log(
      `${label.padEnd(32)}${f(smythEx).padStart(9)}${f(smithFz).padStart(11)}` +
        `${f(smithEx).padStart(11)}${f(wildFz).padStart(11)}${f(wildEx).padStart(11)}` +
        `   ${usable ? "YES" : "no"}`
    );
  }
  console.log(
    "\nUsable = Smyth+ex >= 1 AND Smith fuzzy <= 300, i.e. the variant is inside the\n" +
      "scope and the fuzzy pool can be read in full rather than sampled."
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});

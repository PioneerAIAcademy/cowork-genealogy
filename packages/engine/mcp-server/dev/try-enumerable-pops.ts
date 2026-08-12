/**
 * Find populations small enough to ENUMERATE, per RULE 0 in the qualifier probe.
 *
 * A population qualifies when every variant a section needs — the bare pool and
 * the pool with a relative-name term added — stays comfortably under the API's
 * 4,999 search-depth limit, so each can be read to a short page instead of
 * sampled. Wanted: a bare pool in the high hundreds to low thousands.
 *
 * This exists because picking the population is the step that decides whether a
 * section's answer is checkable, and it had been left to whatever surname was
 * convenient (`Martin`, `Smith`, `Oliveira` — 1.5M to 68M rows).
 */
import { getValidToken } from "../src/auth/refresh.js";
import { BROWSER_USER_AGENT } from "../src/constants.js";

const URL_BASE = "https://www.familysearch.org/service/search/hr/v2/personas";
const SW = "m.queryRequireDefault=on";
const CEILING = 4999;
let token = "";

async function total(q: string): Promise<number | null> {
  await new Promise((r) => setTimeout(r, 250));
  const res = await fetch(`${URL_BASE}?${q}&count=1&${SW}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Accept-Language": "en",
      "User-Agent": BROWSER_USER_AGENT,
    },
  });
  try {
    const j = JSON.parse(await res.text()) as { results?: number; errors?: string[] };
    if (j.errors?.length) return null;
    return j.results ?? null;
  } catch {
    return null;
  }
}

const GROUPS: Array<{ country: string; recordType?: string; extra?: string; names: string[] }> = [
  {
    // England needs a date window on top of the surname: no English surname
    // tested was rare enough on its own (21,000 - 136,000 rows). The window is a
    // hard filter, so it narrows where an unqualified place would not.
    country: "England",
    recordType: "1",
    extra: "&q.marriageLikeDate.from=1850&q.marriageLikeDate.to=1854",
    names: ["Pocklington", "Ollerenshaw", "Bickerdike", "Postlethwaite", "Threlfall"],
  },
  {
    country: "United States",
    recordType: "1",
    names: ["Quackenbush", "Stubblefield", "Pennebaker", "Hollingshead", "Vandermolen", "Bickerdike"],
  },
  {
    country: "Brazil",
    recordType: "1",
    names: ["Bochenek", "Trombetta", "Kunzler", "Bergamaschi"],
  },
];

async function main(): Promise<void> {
  token = await getValidToken();
  const f = (n: number | null): string => (n === null ? "ERR" : n.toLocaleString("en-US"));
  for (const g of GROUPS) {
    console.log(`\n### ${g.country}${g.recordType ? " (marriage)" : ""}`);
    console.log("surname            bare    +father   +spouse   enumerable?");
    for (const s of g.names) {
      const base =
        `q.surname=${encodeURIComponent(s)}&q.recordCountry=${encodeURIComponent(g.country)}` +
        (g.recordType ? `&f.recordType=${g.recordType}` : "") +
        (g.extra ?? "");
      const bare = await total(base);
      const fa = await total(`${base}&q.fatherGivenName=Xqzzyrbl`);
      const sp = await total(`${base}&q.spouseGivenName=Xqzzyrbl`);
      const all = [bare, fa, sp];
      const ok =
        all.every((n): n is number => n !== null) && all.every((n) => n > 0 && n < CEILING - 100);
      console.log(
        `${s.padEnd(17)}${f(bare).padStart(8)}${f(fa).padStart(10)}${f(sp).padStart(10)}   ${ok ? "YES" : "no"}`
      );
    }
  }
  console.log(
    `\nEnumerable = every variant > 0 and < ${CEILING - 100}, so each can be read to a short page.`
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});

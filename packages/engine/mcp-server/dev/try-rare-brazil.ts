/**
 * One-shot: find a Brazilian surname whose marriage pool is small enough that a
 * `fatherGivenName` result set can be read to the END, not sampled.
 *
 * Prints, per candidate: the bare pool, the pool with an unmatchable father
 * name, and the pool with a real one. Wanted is a few hundred — small enough to
 * enumerate every father and look for conflicts directly.
 */
import { getValidToken } from "../src/auth/refresh.js";
import { BROWSER_USER_AGENT } from "../src/constants.js";

const URL_BASE = "https://www.familysearch.org/service/search/hr/v2/personas";
const SW = "m.queryRequireDefault=on";
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

const CANDIDATES = [
  "Bochenek",
  "Kunzler",
  "Zaramella",
  "Sanhudo",
  "Wanderley",
  "Bittencourt",
  "Hollenbach",
  "Stefanello",
  "Bergamaschi",
  "Trombetta",
];

async function main(): Promise<void> {
  token = await getValidToken();
  const f = (n: number | null): string => (n === null ? "ERR" : n.toLocaleString("en-US"));
  console.log("surname          bare pool   +gibberish father   +real father (Jose)");
  for (const s of CANDIDATES) {
    const base = `q.surname=${encodeURIComponent(s)}&q.recordCountry=Brazil&f.recordType=1`;
    const bare = await total(base);
    const gib = await total(`${base}&q.fatherGivenName=Xqzzyrbl`);
    const real = await total(`${base}&q.fatherGivenName=Jose`);
    console.log(
      `${s.padEnd(15)}${f(bare).padStart(10)}${f(gib).padStart(20)}${f(real).padStart(21)}`
    );
  }
  console.log("\nWanted: a +gibberish pool in the low hundreds, so it ends on a short page.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});

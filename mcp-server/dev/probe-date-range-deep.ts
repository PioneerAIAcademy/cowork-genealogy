/**
 * Tighter test of q.birthLikeDate / .from / .to.
 *
 * Compare entry-by-entry score distributions and birth-date hits between:
 *   A) no date filter
 *   B) exact date filter
 *   C) narrow .from/.to range bracketing the exact date
 *   D) impossible .from/.to range (2200-2300)
 *
 * If date filters have any effect, A/B/C/D should diverge in either
 * total `results`, top-of-rank score, or the proportion of returned
 * entries whose birth year falls in-range. If they're identical, the
 * modifier is silently no-op.
 */
import { getValidToken } from "../src/auth/refresh.js";

const BASE = "https://api.familysearch.org/platform/records/personas";

interface Probe {
  name: string;
  q: string;
}

const VARIANTS: Probe[] = [
  { name: "A-no-date", q: "q.surname=Lincoln&count=20" },
  { name: "B-exact-1809", q: "q.surname=Lincoln&q.birthLikeDate=1809&count=20" },
  { name: "C-range-1800-1820", q: "q.surname=Lincoln&q.birthLikeDate.from=1800&q.birthLikeDate.to=1820&count=20" },
  { name: "D-range-2200-2300", q: "q.surname=Lincoln&q.birthLikeDate.from=2200&q.birthLikeDate.to=2300&count=20" },
  // Sanity: exact filter that should hit none of the top-ranked
  { name: "E-exact-1300", q: "q.surname=Lincoln&q.birthLikeDate=1300&count=20" },
];

interface Entry {
  id?: string;
  score?: number;
  content?: { gedcomx?: { persons?: Array<{ principal?: boolean; facts?: Array<{ type?: string; date?: { original?: string; formal?: string } }> }> } };
}

function birthYear(e: Entry): number | null {
  const principal = e.content?.gedcomx?.persons?.find((p) => p.principal);
  const birthFact = principal?.facts?.find((f) => f.type === "http://gedcomx.org/Birth");
  const formal = birthFact?.date?.formal;
  if (!formal) {
    const orig = birthFact?.date?.original ?? "";
    const m = orig.match(/(\d{3,4})/);
    return m ? parseInt(m[1], 10) : null;
  }
  // formal looks like "+1871" or "+1871-02-12"
  const m = formal.match(/^([+-]?\d{1,4})/);
  return m ? parseInt(m[1], 10) : null;
}

async function probe(token: string, p: Probe) {
  const url = `${BASE}?${p.q}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "User-Agent": "genealogy-mcp-server/0.0.1-probe",
    },
  });
  if (!res.ok) {
    console.log(`${p.name.padEnd(20)} HTTP ${res.status}`);
    return;
  }
  const data = (await res.json()) as { results?: number; entries?: Entry[] };
  const entries = data.entries ?? [];
  const scores = entries.map((e) => e.score ?? 0);
  const ids = entries.map((e) => e.id ?? "");
  const years = entries.map(birthYear);
  const inRange1800to1820 = years.filter((y) => y != null && y >= 1800 && y <= 1820).length;
  const inRange2200to2300 = years.filter((y) => y != null && y >= 2200 && y <= 2300).length;

  const fingerprint = ids.slice(0, 3).join(",");
  console.log(
    `${p.name.padEnd(20)} results=${String(data.results).padStart(7)} ` +
      `score[min..max]=${Math.min(...scores).toFixed(3)}..${Math.max(...scores).toFixed(3)} ` +
      `top3=${fingerprint}\n` +
      `${" ".repeat(20)} years=${years.map((y) => y ?? "?").join(",")}\n` +
      `${" ".repeat(20)} in-range[1800-1820]=${inRange1800to1820}/${entries.length}, in-range[2200-2300]=${inRange2200to2300}/${entries.length}`
  );
}

async function main() {
  const token = await getValidToken();
  console.log(`Got token\n`);
  for (const p of VARIANTS) {
    try {
      await probe(token, p);
      console.log("");
    } catch (e) {
      console.error(`${p.name}: ${(e as Error).message}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

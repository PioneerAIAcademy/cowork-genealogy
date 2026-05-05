/**
 * Deeper probe: does `entries[i].confidence` ever vary, or is it always 5?
 * First pass showed all 15 sampled entries had confidence=5. Walk further:
 *  - Deep offset (lower-ranked results)
 *  - Narrow + specific queries
 *  - Empty / weak queries
 *  - Different surname popularity tiers
 *
 * Discardable after answering the question.
 */
import { getValidToken } from "../src/auth/refresh.js";

const QUERIES: Array<{ name: string; q: string }> = [
  { name: "lincoln-abraham-shallow", q: "q.surname=Lincoln&q.givenName=Abraham&count=20" },
  { name: "lincoln-abraham-mid", q: "q.surname=Lincoln&q.givenName=Abraham&count=20&offset=2000" },
  { name: "smith-shallow", q: "q.surname=Smith&count=20" },
  { name: "smith-deep", q: "q.surname=Smith&count=20&offset=4000" },
  { name: "smith-deepest", q: "q.surname=Smith&count=20&offset=4900" },
  { name: "quesnelle-all", q: "q.surname=Quesnelle&count=20" },
  // Very specific
  { name: "lincoln-very-specific", q: "q.surname=Lincoln&q.givenName=Abraham&q.birthLikeDate=1809&q.birthLikePlace=Kentucky&count=20" },
  // Mismatched filters (specific person + wrong year/place to see if confidence drops)
  { name: "lincoln-bad-year", q: "q.surname=Lincoln&q.givenName=Abraham&q.birthLikeDate=1500&q.birthLikePlace=Antarctica&count=20" },
];

async function probe(token: string, p: { name: string; q: string }) {
  const url = `https://api.familysearch.org/platform/records/personas?${p.q}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "User-Agent": "genealogy-mcp-server/0.0.1-probe",
    },
  });

  if (!res.ok) {
    console.log(`${p.name.padEnd(28)} HTTP ${res.status}`);
    return;
  }

  const data = (await res.json()) as {
    results?: number;
    entries?: Array<{ confidence?: unknown; score?: unknown }>;
  };

  const entries = data.entries ?? [];
  const conf = entries.map((e) => e.confidence as number);
  const scores = entries.map((e) => e.score as number);
  const distinctConf = new Set(conf);
  const minConf = conf.length ? Math.min(...conf) : null;
  const maxConf = conf.length ? Math.max(...conf) : null;
  const minScore = scores.length ? Math.min(...scores) : null;
  const maxScore = scores.length ? Math.max(...scores) : null;

  console.log(
    `${p.name.padEnd(28)} results=${String(data.results).padStart(7)} entries=${String(entries.length).padStart(2)} ` +
      `conf=[${minConf}..${maxConf}] distinct=${[...distinctConf].sort().join(",")} ` +
      `score=[${minScore?.toFixed(3)}..${maxScore?.toFixed(3)}]`
  );
}

async function main() {
  const token = await getValidToken();
  console.log(`Got token`);
  console.log("query".padEnd(28) + " stats");
  console.log("-".repeat(110));
  for (const p of QUERIES) {
    try {
      await probe(token, p);
    } catch (e) {
      console.error(`${p.name}: ${(e as Error).message}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

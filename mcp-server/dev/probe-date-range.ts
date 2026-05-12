/**
 * Verify the documented .from / .to date-range modifiers on
 * /platform/records/personas. Docs say:
 *   q.birthLikeDate.from=YYYY  // start of range, inclusive
 *   q.birthLikeDate.to=YYYY    // end of range, inclusive
 *
 * Goals:
 *  - Confirm a range query returns 200 (not 400).
 *  - Confirm narrowing semantically: total `results` should respond to
 *    range tightness OR ranking should shift toward in-range entries.
 *  - Verify negative-year support (BCE) per GEDCOMX simple-date spec.
 *  - Confirm full-date format YYYY-MM-DD works alongside YYYY.
 */
import { getValidToken } from "../src/auth/refresh.js";

const BASE = "https://api.familysearch.org/platform/records/personas";

interface Probe {
  name: string;
  q: string;
}

const PROBES: Probe[] = [
  { name: "lincoln-baseline", q: "q.surname=Lincoln&q.givenName=Abraham&count=5" },
  { name: "lincoln-exact-1809", q: "q.surname=Lincoln&q.givenName=Abraham&q.birthLikeDate=1809&count=5" },
  { name: "lincoln-range-1800-1820", q: "q.surname=Lincoln&q.givenName=Abraham&q.birthLikeDate.from=1800&q.birthLikeDate.to=1820&count=5" },
  { name: "lincoln-range-from-only", q: "q.surname=Lincoln&q.givenName=Abraham&q.birthLikeDate.from=1800&count=5" },
  { name: "lincoln-range-to-only", q: "q.surname=Lincoln&q.givenName=Abraham&q.birthLikeDate.to=1820&count=5" },
  { name: "lincoln-narrow-range", q: "q.surname=Lincoln&q.givenName=Abraham&q.birthLikeDate.from=1808&q.birthLikeDate.to=1810&count=5" },
  { name: "lincoln-impossible-range", q: "q.surname=Lincoln&q.givenName=Abraham&q.birthLikeDate.from=2200&q.birthLikeDate.to=2300&count=5" },
  // Full-date format
  { name: "lincoln-fulldate", q: "q.surname=Lincoln&q.givenName=Abraham&q.birthLikeDate=1809-02-12&count=5" },
  // Negative year (GEDCOMX simple date allows ±YYYY)
  { name: "ancient-negative-year", q: "q.surname=Caesar&q.birthLikeDate=-100&count=5" },
];

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
    const body = await res.text();
    console.log(`${p.name.padEnd(32)} HTTP ${res.status} :: ${body.slice(0, 140).replace(/\s+/g, " ")}`);
    return;
  }

  const data = (await res.json()) as {
    results?: number;
    entries?: Array<{
      id?: string;
      score?: number;
      content?: { gedcomx?: { persons?: Array<{ principal?: boolean; facts?: Array<{ type?: string; date?: { original?: string; formal?: string } }> }> } };
    }>;
  };

  const entries = data.entries ?? [];
  const e0 = entries[0];
  const principal = e0?.content?.gedcomx?.persons?.find((p) => p.principal);
  const birthFact = principal?.facts?.find((f) => f.type === "http://gedcomx.org/Birth");
  const birthOriginal = birthFact?.date?.original ?? "n/a";
  const birthFormal = birthFact?.date?.formal ?? "n/a";

  console.log(
    `${p.name.padEnd(32)} HTTP 200  results=${String(data.results).padStart(7)} ` +
      `top.id=${(e0?.id ?? "n/a").padEnd(11)} top.score=${(e0?.score ?? 0).toFixed(3)} ` +
      `top.birth=${birthOriginal} (formal=${birthFormal})`
  );
}

async function main() {
  const token = await getValidToken();
  console.log(`Got token\n`);
  console.log("probe".padEnd(32) + "  status / stats");
  console.log("-".repeat(140));
  for (const p of PROBES) {
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

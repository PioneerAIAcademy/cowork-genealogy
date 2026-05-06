/**
 * Probe documented q.* terms not yet in the spec, plus q.sex value range.
 *
 *   Item 3 — verify residence and parent terms reshape ranking:
 *     q.residenceDate, q.residencePlace
 *     q.fatherBirthLikePlace, q.motherBirthLikePlace
 *     q.parentGivenName, q.parentSurname, q.parentBirthLikePlace
 *
 *   Item 8 — verify q.sex value range. Docs say "Male, Female, etc."
 *     Test: Unknown, Unspecified, U, M, F, plus mixed case.
 *
 * Pattern: compare top-of-rank score and top-3 entry IDs against a
 * baseline. If the term is honored, scores or top-3 IDs shift.
 */
import { getValidToken } from "../src/auth/refresh.js";

const BASE = "https://api.familysearch.org/platform/records/personas";

interface Probe {
  name: string;
  q: string;
}

const PROBES: Probe[] = [
  // Baseline
  { name: "BASELINE-lincoln", q: "q.surname=Lincoln&count=10" },

  // ---- Item 3: residence ----
  { name: "residenceDate-1850", q: "q.surname=Lincoln&q.residenceDate=1850&count=10" },
  { name: "residencePlace-illinois", q: "q.surname=Lincoln&q.residencePlace=Illinois&count=10" },
  { name: "residence-combined", q: "q.surname=Lincoln&q.residenceDate=1860&q.residencePlace=Illinois&count=10" },

  // ---- Item 3: parent terms ----
  { name: "fatherBirthLikePlace", q: "q.surname=Lincoln&q.fatherBirthLikePlace=Virginia&count=10" },
  { name: "motherBirthLikePlace", q: "q.surname=Lincoln&q.motherBirthLikePlace=Virginia&count=10" },
  { name: "parentGivenName", q: "q.surname=Lincoln&q.parentGivenName=Thomas&count=10" },
  { name: "parentSurname", q: "q.surname=Lincoln&q.parentSurname=Lincoln&count=10" },
  { name: "parentBirthLikePlace", q: "q.surname=Lincoln&q.parentBirthLikePlace=Virginia&count=10" },

  // Smoke: unknown q.* term should still 400 (sanity)
  { name: "SANITY-unknown-term", q: "q.surname=Lincoln&q.notARealTerm=foo&count=10" },

  // ---- Item 8: q.sex value range ----
  { name: "BASELINE-smith", q: "q.surname=Smith&count=10" },
  { name: "sex-male", q: "q.surname=Smith&q.sex=Male&count=10" },
  { name: "sex-female", q: "q.surname=Smith&q.sex=Female&count=10" },
  { name: "sex-unknown", q: "q.surname=Smith&q.sex=Unknown&count=10" },
  { name: "sex-unspecified", q: "q.surname=Smith&q.sex=Unspecified&count=10" },
  { name: "sex-U", q: "q.surname=Smith&q.sex=U&count=10" },
  { name: "sex-M-shorthand", q: "q.surname=Smith&q.sex=M&count=10" },
  { name: "sex-lowercase-male", q: "q.surname=Smith&q.sex=male&count=10" },
];

interface Entry {
  id?: string;
  score?: number;
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
    const warning = res.headers.get("warning") ?? "";
    const innerMatch = warning.match(/\{"message":"Validation failed\.","errors":\[(.*?)\]\}/);
    const detail = innerMatch ? innerMatch[1] : warning.slice(0, 120);
    console.log(`${p.name.padEnd(28)} HTTP ${res.status}  warning=${detail}`);
    return;
  }

  const data = (await res.json()) as { results?: number; entries?: Entry[] };
  const entries = data.entries ?? [];
  const scores = entries.map((e) => e.score ?? 0);
  const ids = entries.slice(0, 3).map((e) => e.id ?? "?").join(",");
  const minS = scores.length ? Math.min(...scores).toFixed(3) : "?";
  const maxS = scores.length ? Math.max(...scores).toFixed(3) : "?";
  console.log(
    `${p.name.padEnd(28)} HTTP 200  results=${String(data.results).padStart(8)}  ` +
      `score=${minS}..${maxS}  top3=${ids}`
  );
}

async function main() {
  const token = await getValidToken();
  console.log(`Got token\n`);
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

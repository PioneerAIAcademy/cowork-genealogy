/**
 * The Record Persona Search docs say:
 *   "204: Successful search with no results."
 * Verify whether /platform/records/personas actually returns 204 for a
 * zero-result query, or 200 with an empty entries array.
 *
 * Test inputs designed to force zero matches:
 *  - Nonsense surname (random letter mash).
 *  - Less-common surname + impossibly narrow place that won't match.
 *  - Very deep offset on a real query (offset near 4998).
 */
import { getValidToken } from "../src/auth/refresh.js";

const BASE = "https://api.familysearch.org/platform/records/personas";

const PROBES: Array<{ name: string; q: string }> = [
  { name: "nonsense-surname-1", q: "q.surname=Zzzqxywv&count=5" },
  { name: "nonsense-surname-2", q: "q.surname=Xqzpyqzqxw&q.givenName=Qjwzpfgxr&count=5" },
  { name: "nonsense-surname-empty", q: "q.surname=Zzzqxywv&q.givenName=Qqqxxyy&count=5" },
  { name: "nonsense-very-restrictive", q: "q.surname=Zzqzpfg&q.birthLikePlace=Antarctica&q.birthLikeDate=1850&count=5" },
  // Real query, just at the edge
  { name: "lincoln-offset-near-cap", q: "q.surname=Lincoln&q.givenName=Abraham&offset=4990&count=5" },
];

async function probe(token: string, p: { name: string; q: string }) {
  const url = `${BASE}?${p.q}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "User-Agent": "genealogy-mcp-server/0.0.1-probe",
    },
  });

  const ct = res.headers.get("content-type");
  const cl = res.headers.get("content-length");
  const text = await res.text();

  let parsed: { results?: number; entries?: unknown[] } | null = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }

  const summary =
    parsed
      ? `results=${parsed.results} entries.length=${(parsed.entries ?? []).length}`
      : `(no JSON body)`;

  console.log(
    `${p.name.padEnd(30)} HTTP ${res.status}  content-type=${(ct ?? "none").padEnd(28)} content-length=${cl ?? "?"}  body-bytes=${text.length}  ${summary}`
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

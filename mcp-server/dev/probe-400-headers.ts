/**
 * Docs claim 400 responses on /platform/records/personas carry useful
 * detail in "warning headers". Inspect actual headers + body across
 * several known-bad request shapes.
 *
 * Goal: see if there's diagnostic content the tool can echo back to
 * the LLM (vs the generic "Failure in upstream call" body wrapper).
 */
import { getValidToken } from "../src/auth/refresh.js";

const BASE = "https://api.familysearch.org/platform/records/personas";

const PROBES: Array<{ name: string; q: string }> = [
  { name: "no-q-params", q: "count=5" },
  { name: "count-too-large", q: "q.surname=Smith&count=200" },
  { name: "offset-too-deep", q: "q.surname=Smith&offset=5000&count=5" },
  { name: "q.gender-rejected", q: "q.surname=Smith&q.gender=Male&count=5" },
  { name: "english-date", q: "q.surname=Smith&q.birthLikeDate=around%201850&count=5" },
  { name: "unknown-q-term", q: "q.surname=Smith&q.notARealTerm=foo&count=5" },
  { name: "unknown-f-term", q: "q.surname=Smith&f.notARealFilter=foo&count=5" },
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

  console.log(`\n=== ${p.name} ===`);
  console.log(`  URL:    ${url}`);
  console.log(`  Status: ${res.status} ${res.statusText}`);
  console.log(`  Headers (all):`);
  for (const [k, v] of res.headers.entries()) {
    console.log(`    ${k}: ${v}`);
  }
  // Highlight any header containing "warn" or that looks diagnostic
  const diag = ["warning", "x-fs-warning", "x-warn", "x-error", "x-fs-error", "x-error-detail"];
  for (const k of diag) {
    const v = res.headers.get(k);
    if (v) console.log(`  >>> diagnostic header ${k}: ${v}`);
  }
  const body = await res.text();
  console.log(`  Body (${body.length}c): ${body.slice(0, 400).replace(/\s+/g, " ")}`);
}

async function main() {
  const token = await getValidToken();
  console.log(`Got token`);
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

/**
 * Probe 2 of 5 — search service q.* term acceptance + effectiveness.
 *
 * Endpoint: /service/search/hr/v2/personas
 *
 * Strategy: baseline q.surname=Lincoln (count=1, fast), then ONE term at a
 * time. For each: HTTP status, results count, top-3 IDs, top-3 scores.
 * Compare against baseline to classify each term as one of:
 *   - REJECTED      : HTTP 400 (term not recognized)
 *   - SILENT-NO-OP  : 200, identical results count + identical top-3 IDs
 *   - RERANKS-ONLY  : 200, identical results count, top-3 IDs differ
 *   - NARROWS       : 200, results count drops
 *   - EXPANDS       : 200, results count rises (the q.collectionId pattern
 *                     we saw on platform — q.* hints unioning the pool)
 *
 * Includes documented terms, plus q.collectionId and q.isPrincipal=true
 * (loose ends from the platform spec review).
 */
import { getValidToken } from "../src/auth/refresh.js";

const URL_BASE = "https://www.familysearch.org/service/search/hr/v2/personas";
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

interface Probe {
  label: string;
  q: string;
}

const BASELINE_Q = "q.surname=Lincoln&count=3";
const SURNAME_PREFIX = "q.surname=Lincoln";

const PROBES: Probe[] = [
  // Baseline
  { label: "BASELINE q.surname=Lincoln", q: BASELINE_Q },

  // Documented q.* terms — name + sex
  { label: "+ q.givenName=Abraham",                          q: `${SURNAME_PREFIX}&q.givenName=Abraham&count=3` },
  { label: "+ q.sex=Male",                                   q: `${SURNAME_PREFIX}&q.sex=Male&count=3` },
  { label: "+ q.sex=Female",                                 q: `${SURNAME_PREFIX}&q.sex=Female&count=3` },
  { label: "+ q.sex=Unknown",                                q: `${SURNAME_PREFIX}&q.sex=Unknown&count=3` },

  // Documented q.* terms — events
  { label: "+ q.birthLikeDate=1809",                         q: `${SURNAME_PREFIX}&q.birthLikeDate=1809&count=3` },
  { label: "+ q.birthLikePlace=Kentucky",                    q: `${SURNAME_PREFIX}&q.birthLikePlace=Kentucky&count=3` },
  { label: "+ q.deathLikeDate=1865",                         q: `${SURNAME_PREFIX}&q.deathLikeDate=1865&count=3` },
  { label: "+ q.deathLikePlace=Washington",                  q: `${SURNAME_PREFIX}&q.deathLikePlace=Washington&count=3` },
  { label: "+ q.marriageLikeDate=1842",                      q: `${SURNAME_PREFIX}&q.marriageLikeDate=1842&count=3` },
  { label: "+ q.marriageLikePlace=Springfield",              q: `${SURNAME_PREFIX}&q.marriageLikePlace=Springfield&count=3` },

  // Documented q.* terms — residence (census-style)
  { label: "+ q.residenceDate=1860",                         q: `${SURNAME_PREFIX}&q.residenceDate=1860&count=3` },
  { label: "+ q.residencePlace=Illinois",                    q: `${SURNAME_PREFIX}&q.residencePlace=Illinois&count=3` },

  // Documented q.* terms — kin
  { label: "+ q.spouseGivenName=Mary",                       q: `${SURNAME_PREFIX}&q.spouseGivenName=Mary&count=3` },
  { label: "+ q.spouseSurname=Todd",                         q: `${SURNAME_PREFIX}&q.spouseSurname=Todd&count=3` },
  { label: "+ q.fatherGivenName=Thomas",                     q: `${SURNAME_PREFIX}&q.fatherGivenName=Thomas&count=3` },
  { label: "+ q.fatherSurname=Lincoln",                      q: `${SURNAME_PREFIX}&q.fatherSurname=Lincoln&count=3` },
  { label: "+ q.fatherBirthLikePlace=Virginia",              q: `${SURNAME_PREFIX}&q.fatherBirthLikePlace=Virginia&count=3` },
  { label: "+ q.motherGivenName=Nancy",                      q: `${SURNAME_PREFIX}&q.motherGivenName=Nancy&count=3` },
  { label: "+ q.motherSurname=Hanks",                        q: `${SURNAME_PREFIX}&q.motherSurname=Hanks&count=3` },
  { label: "+ q.motherBirthLikePlace=Virginia",              q: `${SURNAME_PREFIX}&q.motherBirthLikePlace=Virginia&count=3` },
  { label: "+ q.parentGivenName=Thomas",                     q: `${SURNAME_PREFIX}&q.parentGivenName=Thomas&count=3` },
  { label: "+ q.parentSurname=Lincoln",                      q: `${SURNAME_PREFIX}&q.parentSurname=Lincoln&count=3` },
  { label: "+ q.parentBirthLikePlace=Virginia",              q: `${SURNAME_PREFIX}&q.parentBirthLikePlace=Virginia&count=3` },

  // Cardinality .1 — alternate-name workflow
  { label: "+ alt name (q.surname.1=Todd, q.givenName.1=Mary)",
    q: `${SURNAME_PREFIX}&q.givenName=Mary&q.surname.1=Todd&q.givenName.1=Mary&count=3` },

  // Loose ends from platform spec review
  { label: "+ q.collectionId=1743384 (Alabama Marriages)",   q: `${SURNAME_PREFIX}&q.collectionId=1743384&count=3` },
  { label: "+ q.isPrincipal=true",                           q: `${SURNAME_PREFIX}&q.isPrincipal=true&count=3` },

  // Sanity: term parser must reject unknown q.*
  { label: "SANITY q.notARealTerm=foo",                      q: `${SURNAME_PREFIX}&q.notARealTerm=foo&count=3` },
];

interface Entry {
  id?: string;
  score?: number;
}

interface ProbeResult {
  label: string;
  q: string;
  status: number;
  results?: number;
  top3Ids?: string[];
  top3Scores?: string[];
  errorDetail?: string;
}

async function runOne(token: string, p: Probe): Promise<ProbeResult> {
  const url = `${URL_BASE}?${p.q}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "User-Agent": BROWSER_UA,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    return {
      label: p.label,
      q: p.q,
      status: res.status,
      errorDetail: body.slice(0, 220).replace(/\s+/g, " "),
    };
  }

  const data = (await res.json()) as { results?: number; entries?: Entry[] };
  const entries = data.entries ?? [];
  return {
    label: p.label,
    q: p.q,
    status: 200,
    results: data.results,
    top3Ids: entries.slice(0, 3).map((e) => e.id ?? "?"),
    top3Scores: entries.slice(0, 3).map((e) => (e.score ?? 0).toFixed(3)),
  };
}

function classify(baseline: ProbeResult, r: ProbeResult): string {
  if (r.status !== 200) return `REJECTED-${r.status}`;
  if (!baseline.results || !r.results) return "?";
  if (r.results < baseline.results) return "NARROWS";
  if (r.results > baseline.results) return "EXPANDS";
  // results equal — compare top-3 IDs
  const same =
    JSON.stringify(r.top3Ids) === JSON.stringify(baseline.top3Ids);
  return same ? "SILENT-NO-OP" : "RERANKS-ONLY";
}

async function main() {
  const token = await getValidToken();
  console.log(`Got token (${token.length} chars)\n`);

  const results: ProbeResult[] = [];
  for (const p of PROBES) {
    const r = await runOne(token, p);
    results.push(r);
  }

  const baseline = results[0];
  console.log(`Baseline: ${baseline.q}`);
  console.log(`  status=${baseline.status}, results=${baseline.results}, top3=${baseline.top3Ids?.join(",")}\n`);
  console.log("─".repeat(120));

  for (let i = 1; i < results.length; i++) {
    const r = results[i];
    const verdict = classify(baseline, r);
    console.log(`${verdict.padEnd(14)} | ${r.label}`);
    if (r.status !== 200) {
      console.log(`${" ".repeat(14)} | http=${r.status}  detail=${r.errorDetail}`);
    } else {
      const delta = (r.results ?? 0) - (baseline.results ?? 0);
      const deltaStr = delta === 0 ? "Δ=0" : delta > 0 ? `Δ=+${delta}` : `Δ=${delta}`;
      console.log(`${" ".repeat(14)} | results=${r.results} (${deltaStr})  top3=${r.top3Ids?.join(",")}  scores=[${r.top3Scores?.join(",")}]`);
    }
  }

  console.log("\n" + "─".repeat(120));
  console.log("Verdict legend:");
  console.log("  NARROWS       — results count dropped from baseline (true filter)");
  console.log("  EXPANDS       — results count rose (q.* term unions into the pool)");
  console.log("  RERANKS-ONLY  — same results count, different top-3 (rerank only)");
  console.log("  SILENT-NO-OP  — same results count AND same top-3 (term ignored)");
  console.log("  REJECTED-N    — HTTP N (typically 400; means term not recognized)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

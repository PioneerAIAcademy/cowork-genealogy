/**
 * Probe 3 of 5 — search service f.* filter family.
 *
 * Endpoint: /service/search/hr/v2/personas
 *
 * Headline question: does f.collectionId narrow on the search service?
 * (q.collectionId already does — probe 2 — but f.* is the documented
 * "true filter" namespace per the FS docs grammar.) If both work, the
 * spec maps the tool's collectionId input to whichever is more reliable.
 *
 * Also catalogues the broader filter family: f.recordCountry,
 * f.recordSubcountry, f.gender, f.maritalStatus, name-standard filters,
 * place-level filters, year-range filters. For each: NARROWS / EXPANDS /
 * RERANKS-ONLY / SILENT-NO-OP / REJECTED-N (same classification as probe 2).
 *
 * Plus multi-value semantics for f.collectionId (repeated param vs
 * comma-separated; OR vs AND) and the bogus-ID validation question.
 */
import { getValidToken } from "../src/auth/refresh.js";

const URL_BASE = "https://www.familysearch.org/service/search/hr/v2/personas";
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

interface Probe {
  label: string;
  q: string;
}

const SURNAME_PREFIX = "q.surname=Smith";
const COLLECTION_ALABAMA = "1743384"; // "Alabama, County Marriages, 1711-1992"
const COLLECTION_NUMIDENT = "5000016"; // "United States, Social Security Numerical Identification Files, 1936-2007"

const PROBES: Probe[] = [
  // Baseline
  { label: "BASELINE q.surname=Smith", q: `${SURNAME_PREFIX}&count=3` },

  // ── f.collectionId: the headline test ──
  { label: "+ f.collectionId=1743384 (Alabama Marriages)",   q: `${SURNAME_PREFIX}&f.collectionId=${COLLECTION_ALABAMA}&count=3` },
  { label: "+ f.collectionId=5000016 (NUMIDENT)",            q: `${SURNAME_PREFIX}&f.collectionId=${COLLECTION_NUMIDENT}&count=3` },
  { label: "+ f.collectionId=999999999 (BOGUS)",             q: `${SURNAME_PREFIX}&f.collectionId=999999999&count=3` },
  { label: "+ f.collectionId=NOTACOLLECTION (BOGUS-TEXT)",   q: `${SURNAME_PREFIX}&f.collectionId=NOTACOLLECTION&count=3` },
  { label: "+ f.collectionId=  (EMPTY)",                     q: `${SURNAME_PREFIX}&f.collectionId=&count=3` },

  // ── multi-value f.collectionId: repeated vs comma-separated ──
  { label: "+ two f.collectionId (repeated param)",          q: `${SURNAME_PREFIX}&f.collectionId=${COLLECTION_ALABAMA}&f.collectionId=${COLLECTION_NUMIDENT}&count=3` },
  { label: "+ two f.collectionId (comma-separated)",         q: `${SURNAME_PREFIX}&f.collectionId=${COLLECTION_ALABAMA},${COLLECTION_NUMIDENT}&count=3` },

  // ── geographic filters (reviewer suggestion from earlier round) ──
  { label: "+ f.recordCountry=United States",                q: `${SURNAME_PREFIX}&f.recordCountry=United%20States&count=3` },
  { label: "+ f.recordCountry=England",                      q: `${SURNAME_PREFIX}&f.recordCountry=England&count=3` },
  { label: "+ f.recordSubcountry=Alabama",                   q: `${SURNAME_PREFIX}&f.recordSubcountry=Alabama&count=3` },
  { label: "+ f.recordCountry=US & f.recordSubcountry=Alabama", q: `${SURNAME_PREFIX}&f.recordCountry=United%20States&f.recordSubcountry=Alabama&count=3` },

  // ── demographic filters ──
  { label: "+ f.gender=Male",                                q: `${SURNAME_PREFIX}&f.gender=Male&count=3` },
  { label: "+ f.gender=Female",                              q: `${SURNAME_PREFIX}&f.gender=Female&count=3` },
  { label: "+ f.maritalStatus=Married",                      q: `${SURNAME_PREFIX}&f.maritalStatus=Married&count=3` },

  // ── name-standard filters ──
  { label: "+ f.givenNameStandard=John",                     q: `${SURNAME_PREFIX}&f.givenNameStandard=John&count=3` },
  { label: "+ f.surnameStandard=Smith",                      q: `${SURNAME_PREFIX}&f.surnameStandard=Smith&count=3` },

  // ── place-level filters (documented format: "parent_place_id,name") ──
  // Try both name-only and the documented "id,name" form
  { label: "+ f.birthLikePlace1=Alabama (name-only)",        q: `${SURNAME_PREFIX}&f.birthLikePlace1=Alabama&count=3` },
  { label: "+ f.birthLikePlace1=3,Alabama (id,name)",        q: `${SURNAME_PREFIX}&f.birthLikePlace1=3,Alabama&count=3` },

  // ── year-range filters ──
  { label: "+ f.birthYear0=1800 & f.birthYear1=1850",        q: `${SURNAME_PREFIX}&f.birthYear0=1800&f.birthYear1=1850&count=3` },

  // ── sanity: unknown f.* must reject ──
  { label: "SANITY f.notARealFilter=foo",                    q: `${SURNAME_PREFIX}&f.notARealFilter=foo&count=3` },
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
  const same = JSON.stringify(r.top3Ids) === JSON.stringify(baseline.top3Ids);
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
  console.log("Verdict legend (same as probe 2):");
  console.log("  NARROWS       — true filter, results count dropped");
  console.log("  EXPANDS       — pool grew (filter behaving as q.* hint, not a filter)");
  console.log("  RERANKS-ONLY  — same count, different top-3 (rerank only)");
  console.log("  SILENT-NO-OP  — same count AND same top-3 (filter ignored)");
  console.log("  REJECTED-N    — HTTP N (typically 400)");
  console.log("\nKey questions answered by this run:");
  console.log("  1. Does f.collectionId narrow? (compare to q.collectionId NARROWS from probe 2)");
  console.log("  2. Multi-value: repeated params vs comma — OR semantics expected");
  console.log("  3. Bogus collection ID: 400 (validates) vs SILENT-NO-OP (silently ignored)");
  console.log("  4. Geographic scoping via f.recordCountry / f.recordSubcountry");
  console.log("  5. Other documented filters (gender, maritalStatus, name-standard, place-level, year)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

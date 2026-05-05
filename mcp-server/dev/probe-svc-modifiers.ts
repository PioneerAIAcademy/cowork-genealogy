/**
 * Probe 4 of 5 — search service date semantics + modifiers.
 *
 * Endpoint: /service/search/hr/v2/personas
 *
 * Six questions to settle:
 *   1. Date granularity — does service honor YYYY-MM-DD or also drop month/day
 *      like platform? (Reviewer told us platform was year-only.)
 *   2. q.birthLikeDate.from/.to — does the documented range modifier work
 *      as a true filter or just rerank? (Platform: rerank-only.)
 *   3. f.birthYear0/1 vs q.birthLikeDate.from/.to — head-to-head.
 *      Probe 3 showed f.birthYear0/1 NARROWS. Confirm and compare.
 *   4. Out-of-range dates — silent-no-op (platform behavior), zero-results,
 *      or proper validation error?
 *   5. .exact modifier on names and places — huge if it works.
 *   6. .require modifier — what does it actually change?
 *   7. Wildcards * and ? in name values.
 *
 * Verdicts: same NARROWS / EXPANDS / RERANKS-ONLY / SILENT-NO-OP /
 * ZERO-RESULTS / REJECTED-N as earlier probes.
 */
import { getValidToken } from "../src/auth/refresh.js";

const URL_BASE = "https://www.familysearch.org/service/search/hr/v2/personas";
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

interface Probe {
  group: string;
  label: string;
  q: string;
}

const LINCOLN = "q.surname=Lincoln&q.givenName=Abraham";

const PROBES: Probe[] = [
  // ── BASELINE ──
  { group: "BASELINE", label: "Lincoln Abraham (no date filter)", q: `${LINCOLN}&count=3` },

  // ── 1. DATE GRANULARITY (year vs YYYY-MM-DD) ──
  { group: "GRANULARITY", label: "q.birthLikeDate=1809",        q: `${LINCOLN}&q.birthLikeDate=1809&count=3` },
  { group: "GRANULARITY", label: "q.birthLikeDate=1809-02-12 (Lincoln's actual birth)",
                                                                  q: `${LINCOLN}&q.birthLikeDate=1809-02-12&count=3` },
  { group: "GRANULARITY", label: "q.birthLikeDate=1809-12-31",  q: `${LINCOLN}&q.birthLikeDate=1809-12-31&count=3` },
  { group: "GRANULARITY", label: "q.birthLikeDate=1809-01-01",  q: `${LINCOLN}&q.birthLikeDate=1809-01-01&count=3` },

  // ── 2. q.birthLikeDate.from / .to (modifier syntax) ──
  { group: "Q.RANGE", label: "q.birthLikeDate.from=1800",                                  q: `${LINCOLN}&q.birthLikeDate.from=1800&count=3` },
  { group: "Q.RANGE", label: "q.birthLikeDate.to=1820",                                    q: `${LINCOLN}&q.birthLikeDate.to=1820&count=3` },
  { group: "Q.RANGE", label: "q.birthLikeDate.from=1800 & q.birthLikeDate.to=1820",        q: `${LINCOLN}&q.birthLikeDate.from=1800&q.birthLikeDate.to=1820&count=3` },
  { group: "Q.RANGE", label: "q.birthLikeDate.from=1808 & q.birthLikeDate.to=1810 (tight)", q: `${LINCOLN}&q.birthLikeDate.from=1808&q.birthLikeDate.to=1810&count=3` },

  // ── 3. f.birthYear0 / f.birthYear1 — head-to-head with .from/.to ──
  { group: "F.YEAR", label: "f.birthYear0=1800",                  q: `${LINCOLN}&f.birthYear0=1800&count=3` },
  { group: "F.YEAR", label: "f.birthYear1=1820",                  q: `${LINCOLN}&f.birthYear1=1820&count=3` },
  { group: "F.YEAR", label: "f.birthYear0=1800 & f.birthYear1=1820 (matches Q.RANGE above)", q: `${LINCOLN}&f.birthYear0=1800&f.birthYear1=1820&count=3` },
  { group: "F.YEAR", label: "f.birthYear0=1808 & f.birthYear1=1810 (tight)",                q: `${LINCOLN}&f.birthYear0=1808&f.birthYear1=1810&count=3` },

  // ── 4. OUT-OF-RANGE / IMPOSSIBLE DATES ──
  { group: "OUT-OF-RANGE", label: "q.birthLikeDate=1300 (no records, exact)",            q: `${LINCOLN}&q.birthLikeDate=1300&count=3` },
  { group: "OUT-OF-RANGE", label: "q.birthLikeDate.from=2200 & .to=2300 (future range)", q: `${LINCOLN}&q.birthLikeDate.from=2200&q.birthLikeDate.to=2300&count=3` },
  { group: "OUT-OF-RANGE", label: "f.birthYear0=2200 & f.birthYear1=2300 (future range)", q: `${LINCOLN}&f.birthYear0=2200&f.birthYear1=2300&count=3` },
  { group: "OUT-OF-RANGE", label: "q.birthLikeDate=around 1850 (English text)",          q: `${LINCOLN}&q.birthLikeDate=around%201850&count=3` },

  // ── 5. .exact MODIFIER on NAMES ──
  // The interesting comparison: with vs without .exact for a name with known variants.
  { group: ".EXACT.NAME", label: "q.givenName=Abraham (no .exact, fuzzy)",                                q: `q.surname=Lincoln&q.givenName=Abraham&count=3` },
  { group: ".EXACT.NAME", label: "q.givenName=Abraham & q.givenName.exact=on",                            q: `q.surname=Lincoln&q.givenName=Abraham&q.givenName.exact=on&count=3` },
  { group: ".EXACT.NAME", label: "q.givenName=Abe (nickname, no .exact, fuzzy)",                          q: `q.surname=Lincoln&q.givenName=Abe&count=3` },
  { group: ".EXACT.NAME", label: "q.givenName=Abe & q.givenName.exact=on (nickname strict)",              q: `q.surname=Lincoln&q.givenName=Abe&q.givenName.exact=on&count=3` },
  { group: ".EXACT.NAME", label: "q.surname=Smith & q.surname.exact=on",                                  q: `q.surname=Smith&q.surname.exact=on&count=3` },
  { group: ".EXACT.NAME", label: "q.surname=Smyth & q.surname.exact=on (variant strict)",                 q: `q.surname=Smyth&q.surname.exact=on&count=3` },

  // ── 5b. .exact MODIFIER on PLACES (jurisdiction expansion off) ──
  { group: ".EXACT.PLACE", label: "q.birthLikePlace=Hodgenville, Kentucky (fuzzy, expands to all KY)",  q: `${LINCOLN}&q.birthLikePlace=Hodgenville%2C%20Kentucky&count=3` },
  { group: ".EXACT.PLACE", label: "q.birthLikePlace=Hodgenville, Kentucky & .exact=on (strict)",         q: `${LINCOLN}&q.birthLikePlace=Hodgenville%2C%20Kentucky&q.birthLikePlace.exact=on&count=3` },
  { group: ".EXACT.PLACE", label: "q.birthLikePlace=Kentucky (fuzzy)",                                   q: `${LINCOLN}&q.birthLikePlace=Kentucky&count=3` },
  { group: ".EXACT.PLACE", label: "q.birthLikePlace=Kentucky & .exact=on",                               q: `${LINCOLN}&q.birthLikePlace=Kentucky&q.birthLikePlace.exact=on&count=3` },

  // ── 6. .require MODIFIER ──
  { group: ".REQUIRE", label: "q.spouseSurname=Todd (no .require)",                                       q: `${LINCOLN}&q.spouseSurname=Todd&count=3` },
  { group: ".REQUIRE", label: "q.spouseSurname=Todd & q.spouseSurname.require=on",                        q: `${LINCOLN}&q.spouseSurname=Todd&q.spouseSurname.require=on&count=3` },
  { group: ".REQUIRE", label: "q.birthLikeDate=1809 & q.birthLikeDate.require=on",                        q: `${LINCOLN}&q.birthLikeDate=1809&q.birthLikeDate.require=on&count=3` },

  // ── 7. WILDCARDS in name values ──
  { group: "WILDCARDS", label: "q.givenName=Abrah* (suffix wildcard)",                                    q: `q.surname=Lincoln&q.givenName=Abrah*&count=3` },
  { group: "WILDCARDS", label: "q.givenName=*braham (prefix wildcard)",                                   q: `q.surname=Lincoln&q.givenName=%2Abraham&count=3` },
  { group: "WILDCARDS", label: "q.givenName=Ab?aham (single-char wildcard)",                              q: `q.surname=Lincoln&q.givenName=Ab%3Faham&count=3` },
  { group: "WILDCARDS", label: "q.surname=Linc* (surname suffix wildcard)",                               q: `q.surname=Linc%2A&q.givenName=Abraham&count=3` },

  // ── SANITY ──
  { group: "SANITY", label: "q.notARealTerm=foo (must REJECTED-400)",                                     q: `${LINCOLN}&q.notARealTerm=foo&count=3` },
];

interface Entry {
  id?: string;
  score?: number;
}

interface ProbeResult {
  group: string;
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
      group: p.group, label: p.label, q: p.q, status: res.status,
      errorDetail: body.slice(0, 240).replace(/\s+/g, " "),
    };
  }
  const data = (await res.json()) as { results?: number; entries?: Entry[] };
  const entries = data.entries ?? [];
  return {
    group: p.group, label: p.label, q: p.q, status: 200,
    results: data.results,
    top3Ids: entries.slice(0, 3).map((e) => e.id ?? "?"),
    top3Scores: entries.slice(0, 3).map((e) => (e.score ?? 0).toFixed(3)),
  };
}

function classify(baseline: ProbeResult, r: ProbeResult): string {
  if (r.status !== 200) return `REJECTED-${r.status}`;
  if (r.results === 0) return "ZERO-RESULTS";
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
    results.push(await runOne(token, p));
  }

  const baseline = results[0];
  console.log(`Baseline: ${baseline.q}`);
  console.log(`  status=${baseline.status}, results=${baseline.results}, top3=${baseline.top3Ids?.join(",")}\n`);
  console.log("─".repeat(120));

  let lastGroup = "";
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.group !== lastGroup) {
      console.log(`\n── ${r.group} ──`);
      lastGroup = r.group;
    }
    const verdict = i === 0 ? "BASELINE" : classify(baseline, r);
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
  console.log("Decisions this probe drives:");
  console.log("  GRANULARITY   — year-only vs MM-DD honored?  (input field type)");
  console.log("  Q.RANGE vs F.YEAR — which date-range mechanism is a true filter?  (input mapping)");
  console.log("  OUT-OF-RANGE  — does service validate, silent-no-op, or zero-results?  (error handling)");
  console.log("  .EXACT.NAME   — does .exact strip nickname/spelling expansion?  (input feature)");
  console.log("  .EXACT.PLACE  — does .exact strip jurisdiction-level expansion?  (input feature)");
  console.log("  .REQUIRE      — what does it change?  (input feature)");
  console.log("  WILDCARDS     — does the API honor * and ?  (input feature or input sanitization)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

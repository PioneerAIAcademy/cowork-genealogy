/**
 * Probe 3.5 — investigate the "results=0" filters from probe 3.
 *
 * Probe 3 surfaced these filters as recognized-by-name (no 400) but
 * returning zero results — distinct from rejected and from silent-no-op.
 * Either the value format we used was wrong, or the filter is
 * registered-but-unimplemented. This probe tries reasonable value
 * variants for each one, plus a paired-with-q.* variant in case the
 * filter only narrows when there's a corresponding q.* hint.
 *
 * Targets:
 *   1. f.recordSubcountry  — try Alabama / AL / "Alabama, United States" / parent-place-ID
 *   2. f.givenNameStandard — try various capitalizations and variant forms
 *   3. f.surnameStandard   — same
 *   4. f.birthLikePlace<N> — try multiple jurisdiction levels (0/1/2/3) and value formats
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

const SMITH = "q.surname=Smith";

const PROBES: Probe[] = [
  // ── BASELINES ──
  { group: "BASELINE",  label: "q.surname=Smith",                                                  q: `${SMITH}&count=3` },
  { group: "BASELINE",  label: "q.surname=Smith + q.birthLikePlace=Alabama  (sanity for place-related filters)",
                                                                                                    q: `${SMITH}&q.birthLikePlace=Alabama&count=3` },

  // ── f.recordSubcountry value-format sweep ──
  { group: "SUBCOUNTRY", label: "f.recordSubcountry=Alabama",                                       q: `${SMITH}&f.recordSubcountry=Alabama&count=3` },
  { group: "SUBCOUNTRY", label: "f.recordSubcountry=AL",                                            q: `${SMITH}&f.recordSubcountry=AL&count=3` },
  { group: "SUBCOUNTRY", label: "f.recordSubcountry=alabama (lowercase)",                          q: `${SMITH}&f.recordSubcountry=alabama&count=3` },
  { group: "SUBCOUNTRY", label: "f.recordSubcountry=Alabama, United States",                       q: `${SMITH}&f.recordSubcountry=Alabama%2C%20United%20States&count=3` },
  { group: "SUBCOUNTRY", label: "f.recordSubcountry=33 (collections-API place-id for Alabama)",    q: `${SMITH}&f.recordSubcountry=33&count=3` },
  { group: "SUBCOUNTRY", label: "f.recordSubcountry=Alabama + f.recordCountry=United States",      q: `${SMITH}&f.recordSubcountry=Alabama&f.recordCountry=United%20States&count=3` },
  { group: "SUBCOUNTRY", label: "f.recordCountry=United States + f.recordSubcountry=Texas",        q: `${SMITH}&f.recordCountry=United%20States&f.recordSubcountry=Texas&count=3` },
  { group: "SUBCOUNTRY", label: "f.recordSubcountry=England (in case it's a synonym, not state-level)", q: `${SMITH}&f.recordSubcountry=England&count=3` },

  // ── f.givenNameStandard value-format sweep ──
  // First confirm w/o q.givenName matching, then with — sometimes the
  // standard filter only narrows when paired with the q.* hint.
  { group: "GIVENSTD",   label: "f.givenNameStandard=John",                                          q: `${SMITH}&f.givenNameStandard=John&count=3` },
  { group: "GIVENSTD",   label: "f.givenNameStandard=John + q.givenName=John",                      q: `${SMITH}&q.givenName=John&f.givenNameStandard=John&count=3` },
  { group: "GIVENSTD",   label: "f.givenNameStandard=john (lowercase) + q.givenName=John",          q: `${SMITH}&q.givenName=John&f.givenNameStandard=john&count=3` },
  { group: "GIVENSTD",   label: "f.givenNameStandard=Mary + q.givenName=Mary",                      q: `${SMITH}&q.givenName=Mary&f.givenNameStandard=Mary&count=3` },
  { group: "GIVENSTD",   label: "(control) just q.givenName=John",                                   q: `${SMITH}&q.givenName=John&count=3` },

  // ── f.surnameStandard value-format sweep ──
  // Note: q.surname=Smith + f.surnameStandard=Smith should be redundant if it works
  { group: "SURNAMESTD", label: "f.surnameStandard=Smith",                                           q: `${SMITH}&f.surnameStandard=Smith&count=3` },
  { group: "SURNAMESTD", label: "f.surnameStandard=smith (lowercase)",                              q: `${SMITH}&f.surnameStandard=smith&count=3` },
  // Try with a different surname pair to see if exact-standard filters narrow
  { group: "SURNAMESTD", label: "q.surname=Lincoln + f.surnameStandard=Lincoln",                    q: `q.surname=Lincoln&f.surnameStandard=Lincoln&count=3` },

  // ── f.birthLikePlace<N> jurisdiction-level sweep ──
  // Docs format hint: f.birthLikePlace1=3,Alberta  → "[parent_place_id],[place_name]"
  { group: "BIRTHPLACE", label: "f.birthLikePlace0=Alabama",                                         q: `${SMITH}&f.birthLikePlace0=Alabama&count=3` },
  { group: "BIRTHPLACE", label: "f.birthLikePlace2=Alabama",                                         q: `${SMITH}&f.birthLikePlace2=Alabama&count=3` },
  { group: "BIRTHPLACE", label: "f.birthLikePlace3=Alabama",                                         q: `${SMITH}&f.birthLikePlace3=Alabama&count=3` },
  // "id,name" form at multiple levels
  { group: "BIRTHPLACE", label: "f.birthLikePlace0=1,United States",                                 q: `${SMITH}&f.birthLikePlace0=1%2CUnited%20States&count=3` },
  { group: "BIRTHPLACE", label: "f.birthLikePlace1=33,Alabama (collections API place-id)",          q: `${SMITH}&f.birthLikePlace1=33%2CAlabama&count=3` },
  { group: "BIRTHPLACE", label: "f.birthLikePlace1=351,Alabama (places API place-id)",              q: `${SMITH}&f.birthLikePlace1=351%2CAlabama&count=3` },
  // Pair with q.birthLikePlace
  { group: "BIRTHPLACE", label: "q.birthLikePlace=Alabama + f.birthLikePlace1=Alabama",             q: `${SMITH}&q.birthLikePlace=Alabama&f.birthLikePlace1=Alabama&count=3` },
  // Try non-US example since reviewer's example was Alberta
  { group: "BIRTHPLACE", label: "f.birthLikePlace1=3,Alberta (reviewer's docs example)",            q: `${SMITH}&f.birthLikePlace1=3%2CAlberta&count=3` },
];

interface Entry {
  id?: string;
}

interface ProbeResult {
  group: string;
  label: string;
  q: string;
  status: number;
  results?: number;
  top3Ids?: string[];
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
      group: p.group,
      label: p.label,
      q: p.q,
      status: res.status,
      errorDetail: body.slice(0, 220).replace(/\s+/g, " "),
    };
  }

  const data = (await res.json()) as { results?: number; entries?: Entry[] };
  const entries = data.entries ?? [];
  return {
    group: p.group,
    label: p.label,
    q: p.q,
    status: 200,
    results: data.results,
    top3Ids: entries.slice(0, 3).map((e) => e.id ?? "?"),
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
    const r = await runOne(token, p);
    results.push(r);
  }

  // The first BASELINE row is our reference for narrowing.
  const baseline = results[0];
  console.log(`Baseline (for NARROWS/EXPANDS classification): ${baseline.q}`);
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
      console.log(`${" ".repeat(14)} | results=${r.results} (${deltaStr})  top3=${r.top3Ids?.join(",")}`);
    }
  }

  console.log("\n" + "─".repeat(120));
  console.log("Verdict legend (this run):");
  console.log("  NARROWS       — filter recognized AND value matched some records");
  console.log("  ZERO-RESULTS  — filter recognized, value matched nothing (we still don't know if format is right)");
  console.log("  RERANKS-ONLY  — same count, different top-3");
  console.log("  SILENT-NO-OP  — same count AND same top-3 (filter ignored)");
  console.log("  REJECTED-N    — HTTP N (typically 400)");
  console.log("\nDecision rule: NARROWS for ANY value variant in a group → filter is usable, we just need");
  console.log("the right value format. ALL ZERO-RESULTS or SILENT-NO-OP across all variants → defer the filter.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

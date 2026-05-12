/**
 * Probe 4 follow-ups — two refinement questions before drafting v2 spec.
 *
 * Endpoint: /service/search/hr/v2/personas
 *
 * Group A — f.birthYear* mystery
 *   Probe 4 saw:
 *     f.birthYear0=1800                               → NARROWS to 160,037
 *     f.birthYear1=1820                               → ZERO-RESULTS
 *     f.birthYear0=1800 & f.birthYear1=1820           → NARROWS to 160,037 (SAME as f.birthYear0=1800)
 *     f.birthYear0=1808 & f.birthYear1=1810 (tight)   → ZERO-RESULTS
 *
 *   The fact that .from=1800 alone gave the same count as .from=1800 + .to=1820
 *   suggests f.birthYear0 isn't a year boundary at all — it might be an
 *   *index/slot* (cardinality .0 / .1) and the actual filter parameter is
 *   plain f.birthYear (or f.birthYear<something>). Hypotheses to test:
 *     1. f.birthYear=YYYY              (no suffix)
 *     2. f.birthYear0=YYYY at non-decade values (1801, 1809, 1815)
 *     3. f.birthYear0=1800 & f.birthYear1=1900 (much wider — maybe bucket-aligned)
 *     4. f.birthYear0=1850 (different decade)
 *     5. Cardinality form: f.birthYear.from=1800 & f.birthYear.to=1820
 *
 * Group B — .require modifier on probe-2 SILENT-NO-OP terms
 *   Probe 4 confirmed .require=on upgrades q.spouseSurname=Todd to NARROWS.
 *   Question: does it also upgrade the SILENT-NO-OPs from probe 2?
 *     q.sex=Unknown
 *     q.fatherBirthLikePlace=Virginia
 *     q.motherBirthLikePlace=Virginia
 *     q.parentBirthLikePlace=Virginia
 *
 *   If .require=on turns any of these into NARROWS, that field's value to
 *   the LLM jumps — silent-no-op becomes useful when marked required.
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
const LINCOLN_ONLY = "q.surname=Lincoln";

const PROBES: Probe[] = [
  // ── BASELINE for group A (matches probe 4) ──
  { group: "BASELINE-A", label: "Lincoln Abraham (no year filter)", q: `${LINCOLN}&count=3` },

  // ── A.1: try plain f.birthYear (no suffix) ──
  { group: "A.PLAIN", label: "f.birthYear=1809",                        q: `${LINCOLN}&f.birthYear=1809&count=3` },
  { group: "A.PLAIN", label: "f.birthYear=1800",                        q: `${LINCOLN}&f.birthYear=1800&count=3` },

  // ── A.2: f.birthYear0 with non-decade values ──
  { group: "A.OFF-DECADE", label: "f.birthYear0=1801",                  q: `${LINCOLN}&f.birthYear0=1801&count=3` },
  { group: "A.OFF-DECADE", label: "f.birthYear0=1809 (Lincoln's year)", q: `${LINCOLN}&f.birthYear0=1809&count=3` },
  { group: "A.OFF-DECADE", label: "f.birthYear0=1815",                  q: `${LINCOLN}&f.birthYear0=1815&count=3` },
  { group: "A.OFF-DECADE", label: "f.birthYear0=1850 (different decade)", q: `${LINCOLN}&f.birthYear0=1850&count=3` },

  // ── A.3: wide ranges to test bucket-alignment hypothesis ──
  { group: "A.WIDE-RANGE", label: "f.birthYear0=1800 & f.birthYear1=1900 (century)",  q: `${LINCOLN}&f.birthYear0=1800&f.birthYear1=1900&count=3` },
  { group: "A.WIDE-RANGE", label: "f.birthYear0=1800 & f.birthYear1=1850",            q: `${LINCOLN}&f.birthYear0=1800&f.birthYear1=1850&count=3` },
  { group: "A.WIDE-RANGE", label: "f.birthYear0=1810 & f.birthYear1=1900",            q: `${LINCOLN}&f.birthYear0=1810&f.birthYear1=1900&count=3` },
  { group: "A.WIDE-RANGE", label: "f.birthYear0=1700 & f.birthYear1=2000 (very wide)", q: `${LINCOLN}&f.birthYear0=1700&f.birthYear1=2000&count=3` },

  // ── A.4: cardinality-style modifier syntax ──
  { group: "A.MODIFIER", label: "f.birthYear.from=1800",                              q: `${LINCOLN}&f.birthYear.from=1800&count=3` },
  { group: "A.MODIFIER", label: "f.birthYear.from=1800 & f.birthYear.to=1820",        q: `${LINCOLN}&f.birthYear.from=1800&f.birthYear.to=1820&count=3` },

  // ── BASELINE for group B (matches probe 2) ──
  { group: "BASELINE-B", label: "Lincoln (no other filters)", q: `${LINCOLN_ONLY}&count=3` },

  // ── B.1: control — confirm .require still works on q.spouseSurname here ──
  { group: "B.CONTROL", label: "q.spouseSurname=Todd                          (no .require)",       q: `${LINCOLN_ONLY}&q.spouseSurname=Todd&count=3` },
  { group: "B.CONTROL", label: "q.spouseSurname=Todd & q.spouseSurname.require=on (control)",       q: `${LINCOLN_ONLY}&q.spouseSurname=Todd&q.spouseSurname.require=on&count=3` },

  // ── B.2: SILENT-NO-OPs from probe 2 with .require=on ──
  { group: "B.SEX",     label: "q.sex=Unknown                                 (no .require)",      q: `${LINCOLN_ONLY}&q.sex=Unknown&count=3` },
  { group: "B.SEX",     label: "q.sex=Unknown & q.sex.require=on",                                  q: `${LINCOLN_ONLY}&q.sex=Unknown&q.sex.require=on&count=3` },
  { group: "B.FBLP",    label: "q.fatherBirthLikePlace=Virginia               (no .require)",      q: `${LINCOLN_ONLY}&q.fatherBirthLikePlace=Virginia&count=3` },
  { group: "B.FBLP",    label: "q.fatherBirthLikePlace=Virginia & .require=on",                     q: `${LINCOLN_ONLY}&q.fatherBirthLikePlace=Virginia&q.fatherBirthLikePlace.require=on&count=3` },
  { group: "B.MBLP",    label: "q.motherBirthLikePlace=Virginia               (no .require)",      q: `${LINCOLN_ONLY}&q.motherBirthLikePlace=Virginia&count=3` },
  { group: "B.MBLP",    label: "q.motherBirthLikePlace=Virginia & .require=on",                     q: `${LINCOLN_ONLY}&q.motherBirthLikePlace=Virginia&q.motherBirthLikePlace.require=on&count=3` },
  { group: "B.PBLP",    label: "q.parentBirthLikePlace=Virginia               (no .require)",      q: `${LINCOLN_ONLY}&q.parentBirthLikePlace=Virginia&count=3` },
  { group: "B.PBLP",    label: "q.parentBirthLikePlace=Virginia & .require=on",                     q: `${LINCOLN_ONLY}&q.parentBirthLikePlace=Virginia&q.parentBirthLikePlace.require=on&count=3` },
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

  const baselineA = results.find((r) => r.group === "BASELINE-A")!;
  const baselineB = results.find((r) => r.group === "BASELINE-B")!;

  console.log(`Baseline A (groups A.*): ${baselineA.q}`);
  console.log(`  results=${baselineA.results}  top3=${baselineA.top3Ids?.join(",")}`);
  console.log(`Baseline B (groups B.*): ${baselineB.q}`);
  console.log(`  results=${baselineB.results}  top3=${baselineB.top3Ids?.join(",")}\n`);
  console.log("─".repeat(120));

  let lastGroup = "";
  for (const r of results) {
    if (r.group.startsWith("BASELINE")) continue;
    if (r.group !== lastGroup) {
      console.log(`\n── ${r.group} ──`);
      lastGroup = r.group;
    }
    const baseline = r.group.startsWith("A.") ? baselineA : baselineB;
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
  console.log("Decisions this drives:");
  console.log("  GROUP A — Does ANY f.birthYear* form give clean year-range filtering?");
  console.log("    NARROWS for one variant w/ predictable behavior → expose with constraint");
  console.log("    All ZERO-RESULTS / SILENT-NO-OP / inconsistent → defer entirely");
  console.log("  GROUP B — Does .require=on upgrade silent-no-op q.* terms to NARROWS?");
  console.log("    NARROWS in any B.* group → mark that field as 'useful only when required'");
  console.log("    No NARROWS → confirm SILENT-NO-OP findings; document accordingly");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

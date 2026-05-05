/**
 * Settle the alt-names UNION semantics (reviewer comment #9 on
 * search-tool-spec-v2.md).
 *
 * Spec claims `q.surname.1=Todd&q.givenName.1=Mary` pairs the two
 * alternate terms — UNION of (Mary Lincoln) ∪ (Mary Todd). Reviewer
 * claims `q.givenName.1` has no pairing effect; the second branch
 * is actually `q.surname.1=Todd` alone, returning all Todds.
 *
 * Strategy: vary `q.givenName.1` while keeping all other parameters
 * fixed. If results count is invariant under that variation, reviewer
 * is right. If results change, our interpretation is right.
 *
 * Also inspect returned entries' actual names to see if non-Mary
 * Todds appear in the result set.
 */
import { getValidToken } from "../src/auth/refresh.js";

const URL_BASE = "https://www.familysearch.org/service/search/hr/v2/personas";
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

interface Entry {
  id?: string;
  content?: { gedcomx?: { persons?: Array<{ principal?: boolean; display?: { name?: string } }> }};
}

async function fetchJson(token: string, url: string) {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Accept-Language": "en",
      "User-Agent": BROWSER_UA,
    },
  });
  if (!res.ok) return { status: res.status, results: -1, entries: [] as Entry[] };
  const d = (await res.json()) as { results?: number; entries?: Entry[] };
  return { status: 200, results: d.results ?? -1, entries: d.entries ?? [] };
}

function principalName(e: Entry): string {
  const p = e.content?.gedcomx?.persons?.find((x) => x.principal === true)
         ?? e.content?.gedcomx?.persons?.[0];
  return p?.display?.name ?? "(unknown)";
}

async function main() {
  const token = await getValidToken();
  console.log(`Got token (${token.length} chars)\n`);

  // ── BASELINES ──
  const probes: Array<{ label: string; q: string }> = [
    // Single-name controls (no cardinality)
    { label: "1.  Mary Lincoln (baseline A)         ", q: "q.surname=Lincoln&q.givenName=Mary&count=20" },
    { label: "2.  Mary Todd (baseline B)            ", q: "q.surname=Todd&q.givenName=Mary&count=20" },
    { label: "3.  ALL Todds (no givenName)          ", q: "q.surname=Todd&count=20" },
    { label: "4.  ALL Lincolns (no givenName)       ", q: "q.surname=Lincoln&count=20" },

    // Cardinality variants — vary ONLY q.givenName.1
    { label: "5.  Lincoln+Mary, alt Todd+Mary       ", q: "q.surname=Lincoln&q.givenName=Mary&q.surname.1=Todd&q.givenName.1=Mary&count=20" },
    { label: "6.  Lincoln+Mary, alt Todd, NO altGiven", q: "q.surname=Lincoln&q.givenName=Mary&q.surname.1=Todd&count=20" },
    { label: "7.  Lincoln+Mary, alt Todd+Sarah      ", q: "q.surname=Lincoln&q.givenName=Mary&q.surname.1=Todd&q.givenName.1=Sarah&count=20" },
    { label: "8.  Lincoln+Mary, alt Todd+Xqzpyz     ", q: "q.surname=Lincoln&q.givenName=Mary&q.surname.1=Todd&q.givenName.1=Xqzpyz&count=20" },

    // Compose check: does altGiven affect anything when paired with NO altSurname?
    { label: "9.  Lincoln+Mary, NO altSurname+altGivenSarah", q: "q.surname=Lincoln&q.givenName=Mary&q.givenName.1=Sarah&count=20" },
  ];

  const results: Array<{ label: string; q: string; results: number; entries: Entry[] }> = [];
  for (const p of probes) {
    const r = await fetchJson(token, `${URL_BASE}?${p.q}`);
    results.push({ label: p.label, q: p.q, results: r.results, entries: r.entries });
    console.log(`${p.label}  results=${String(r.results).padStart(7)}`);
  }

  console.log("\n" + "=".repeat(80));
  console.log("INTERPRETATION GUIDE");
  console.log("=".repeat(80));
  console.log("");
  console.log("If our spec is RIGHT (cardinality pairs givenName.1 with surname.1):");
  console.log("  probe 5 (alt Todd+Mary)   ≈ probe 1 + probe 2 = Mary Lincolns + Mary Todds");
  console.log("  probe 7 (alt Todd+Sarah)  ≈ probe 1 + (count of Sarah Todds)");
  console.log("  probe 5 ≠ probe 6 (because altGiven changes the second branch)");
  console.log("  probe 5 ≠ probe 7 (because Mary≠Sarah on second branch)");
  console.log("");
  console.log("If REVIEWER is right (altGiven has no pairing effect, second branch = all Todds):");
  console.log("  probe 5 ≈ probe 6 ≈ probe 7 ≈ probe 8 (altGiven irrelevant)");
  console.log("  results count of all of them ≈ probe 1 + probe 3 = Mary Lincolns + ALL Todds");
  console.log("");

  const r1 = results[0].results, r2 = results[1].results, r3 = results[2].results;
  const r5 = results[4].results, r6 = results[5].results, r7 = results[6].results, r8 = results[7].results, r9 = results[8].results;

  console.log("=== RESULTS COUNT ANALYSIS ===");
  console.log(`probe 1 (Mary Lincolns):     ${r1}`);
  console.log(`probe 2 (Mary Todds):        ${r2}`);
  console.log(`probe 3 (ALL Todds):         ${r3}`);
  console.log(`probe 1 + probe 2 (paired):  ${r1 + r2}    ← should match probe 5 if our spec is right`);
  console.log(`probe 1 + probe 3 (any Todd):${r1 + r3}   ← should match probe 5 if reviewer is right`);
  console.log("");
  console.log(`probe 5 (alt Todd+Mary):     ${r5}`);
  console.log(`probe 6 (alt Todd, no altGiven): ${r6}`);
  console.log(`probe 7 (alt Todd+Sarah):    ${r7}`);
  console.log(`probe 8 (alt Todd+Xqzpyz):   ${r8}`);
  console.log(`probe 9 (no altSurname+altGivenSarah): ${r9}`);
  console.log("");

  console.log("=== ENTRY-LEVEL INSPECTION (probe 5: alt Todd+Mary) ===");
  console.log("Top 20 names — are non-Mary Todds present?");
  for (const e of results[4].entries.slice(0, 20)) {
    console.log(`  ${e.id?.padEnd(12)} ${principalName(e)}`);
  }

  console.log("\n=== ENTRY-LEVEL INSPECTION (probe 6: alt Todd, no altGiven) ===");
  console.log("Top 20 names — should differ if altGiven matters:");
  for (const e of results[5].entries.slice(0, 20)) {
    console.log(`  ${e.id?.padEnd(12)} ${principalName(e)}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

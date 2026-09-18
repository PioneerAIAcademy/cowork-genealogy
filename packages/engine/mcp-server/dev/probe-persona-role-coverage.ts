/**
 * Probe: what share of personas carry `display.role` and `principal` on
 * the SEARCH endpoint vs the RECAPI persona endpoint?
 *
 * Evidence for issue #2336 (step 1). The existing explore script
 * (`explore-relative-role-classifier-records.ts`) measured the search
 * endpoint's `display.role` vocabulary across two collections. This probe
 * extends that to the recapi persona endpoint — the path `record_read`
 * uses — which nobody has measured for these fields. It also reports the
 * distinct role strings seen and the `principal` boolean coverage on both.
 *
 * Per endpoint and across several record families, reports:
 *   - what share of personas carry `principal` (boolean)
 *   - what share of personas carry `display.role` (string)
 *   - the distinct role strings seen and their frequencies
 *
 * Requires a live FamilySearch session (run `make e2e-login` first).
 * Not shipped in any artifact; no unit test needed.
 *
 * Usage:
 *   npx tsx dev/probe-persona-role-coverage.ts
 */
import { LOCAL } from "../src/auth/principal.js";
import { getValidToken } from "../src/auth/refresh.js";
import { BROWSER_USER_AGENT } from "../src/constants.js";
import { fetchWithRetry } from "../src/utils/http.js";
import { mapWithConcurrency } from "../src/utils/place-resolver.js";

const RECAPI_BASE =
  "https://sg30p0.familysearch.org/service/cds/recapi/records/persona";
const SEARCH_BASE =
  "https://www.familysearch.org/service/search/hr/v2/personas";

const CONCURRENCY = 4;

// Diverse record persona ids drawn from committed eval fixtures and run logs.
// Same set as the artifact-coverage probe for consistency.
const RECAPI_IDS: { id: string; note: string }[] = [
  { id: "M7QZ-8KD", note: "1860 US Census (Ackerman)" },
  { id: "68Q9-K34P", note: "1850 US Census" },
  { id: "CFLT-9K2", note: "1850 US Census (Flynn)" },
  { id: "MPXD-MZC", note: "US Census, North Dakota" },
  { id: "M9VJ-V1R", note: "US Census, Grand Forks" },
  { id: "JMF4-CL9", note: "England, Births and Christenings (Richardson)" },
  { id: "NFCY-7VM", note: "England, Births and Christenings (Richardson)" },
  { id: "QL3R-C5SR", note: "England parish baptism" },
  { id: "68Q3-5SGC", note: "Norway Church Books (Birkeland)" },
  { id: "NW44-PM2", note: "Norway Marriages" },
  { id: "9XKT-M2P", note: "Norway Church Books (Anders)" },
  { id: "8YMV-R76Z", note: "Norway Census 1801" },
  { id: "4VVW-LFW2", note: "Birth, Alabama" },
  { id: "6LLN-M7ZZ", note: "Marriage, Luxembourg" },
];

// Search pools: collections that the explore script already confirmed carry
// role data, plus a couple more for breadth.
const SEARCH_POOLS: { name: string; qs: string; cap: number }[] = [
  {
    name: "Brazil/Parana Catholic (2177282), 1880 Lapa births",
    qs: "q.recordCountry=Brazil&f.recordType=0&q.birthLikeDate.from=1880&q.birthLikeDate.to=1880&q.birthLikePlace=Lapa&q.birthLikePlace.exact=on",
    cap: 200,
  },
  {
    name: "US Census 1850, surname=Martin",
    qs: "q.surname=Martin&q.collectionId=1401638",
    cap: 200,
  },
  {
    name: "England marriages (collection 1473014), surname=Smith",
    qs: "q.surname=Smith&q.collectionId=1473014",
    cap: 200,
  },
];

interface PersonaObs {
  id: string;
  source: "recapi" | "search";
  pool?: string;
  hasPrincipal: boolean;
  principalValue: boolean | undefined;
  hasRole: boolean;
  roleValue: string | undefined;
}

async function probeRecapi(
  recordId: string,
  token: string,
): Promise<PersonaObs[]> {
  const url = `${RECAPI_BASE}/${encodeURIComponent(recordId)}.json`;
  const res = await fetchWithRetry(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Accept-Language": "en",
      "User-Agent": BROWSER_USER_AGENT,
    },
  });
  if (!res.ok) {
    console.error(`  SKIP recapi ${recordId}: HTTP ${res.status}`);
    return [];
  }
  const body = (await res.json()) as any;
  const persons: any[] = body?.persons ?? [];
  return persons.map((p: any) => ({
    id: p.id ?? recordId,
    source: "recapi" as const,
    hasPrincipal: p.principal !== undefined,
    principalValue: p.principal,
    hasRole: p.display?.role !== undefined,
    roleValue: p.display?.role,
  }));
}

async function probeSearchPool(
  pool: { name: string; qs: string; cap: number },
  token: string,
): Promise<PersonaObs[]> {
  const results: PersonaObs[] = [];
  for (let offset = 0; offset < pool.cap; offset += 100) {
    if (offset > 0) await new Promise((r) => setTimeout(r, 700));
    const freshToken = await getValidToken(LOCAL);
    const url = `${SEARCH_BASE}?${pool.qs}&count=100&offset=${offset}&m.queryRequireDefault=on`;
    const res = await fetchWithRetry(url, {
      headers: {
        Authorization: `Bearer ${freshToken}`,
        Accept: "application/json",
        "Accept-Language": "en",
        "User-Agent": BROWSER_USER_AGENT,
      },
    });
    if (res.status === 204) break;
    if (!res.ok) {
      console.error(`  SKIP search pool "${pool.name}" at offset ${offset}: HTTP ${res.status}`);
      break;
    }
    const body = (await res.json()) as any;
    const entries: any[] = body?.entries ?? [];
    for (const entry of entries) {
      const persons: any[] = entry?.content?.gedcomx?.persons ?? [];
      for (const p of persons) {
        results.push({
          id: p.id ?? "?",
          source: "search",
          pool: pool.name,
          hasPrincipal: p.principal !== undefined,
          principalValue: p.principal,
          hasRole: p.display?.role !== undefined,
          roleValue: p.display?.role,
        });
      }
    }
    if (entries.length < 100) break;
  }
  return results;
}

function printStats(label: string, obs: PersonaObs[]): void {
  const total = obs.length;
  if (total === 0) {
    console.log(`\n${label}: 0 personas`);
    return;
  }

  const withPrincipal = obs.filter((o) => o.hasPrincipal).length;
  const principalTrue = obs.filter((o) => o.principalValue === true).length;
  const principalFalse = obs.filter((o) => o.principalValue === false).length;
  const withRole = obs.filter((o) => o.hasRole).length;

  const roleFreq = new Map<string, number>();
  for (const o of obs) {
    if (o.roleValue) roleFreq.set(o.roleValue, (roleFreq.get(o.roleValue) ?? 0) + 1);
  }

  console.log(`\n${label}: ${total} personas`);
  console.log(
    `  principal present: ${withPrincipal}/${total} (${Math.round((withPrincipal / total) * 100)}%)` +
      ` — true=${principalTrue}, false=${principalFalse}`,
  );
  console.log(
    `  display.role present: ${withRole}/${total} (${Math.round((withRole / total) * 100)}%)`,
  );
  if (roleFreq.size > 0) {
    console.log(`  distinct roles: ${roleFreq.size}`);
    for (const [role, count] of Array.from(roleFreq.entries()).sort((a, b) => b[1] - a[1])) {
      console.log(`    "${role}": ${count}`);
    }
  }
}

async function main(): Promise<void> {
  const token = await getValidToken(LOCAL);

  // 1. Probe recapi endpoint (per-record, parallel)
  console.log(`\nProbing recapi for ${RECAPI_IDS.length} records...`);
  const recapiResults: PersonaObs[] = [];
  const recapiBatches = await mapWithConcurrency(RECAPI_IDS, CONCURRENCY, (r) =>
    probeRecapi(r.id, token),
  );
  for (const batch of recapiBatches) recapiResults.push(...batch);

  console.log("\n=== RECAPI endpoint (record_read path) ===");
  printStats("recapi — all personas", recapiResults);

  // 2. Probe search endpoint (per-pool, sequential for rate limiting)
  console.log("\n\nProbing search endpoint...");
  const searchResults: PersonaObs[] = [];
  for (const pool of SEARCH_POOLS) {
    console.log(`  pool: ${pool.name}`);
    const poolObs = await probeSearchPool(pool, token);
    searchResults.push(...poolObs);
    printStats(`search — ${pool.name}`, poolObs);
  }

  console.log("\n=== SEARCH endpoint (record_search path) ===");
  printStats("search — all pools combined", searchResults);

  // 3. Combined summary
  console.log("\n=== COMBINED SUMMARY ===");
  const recapiWithRole = recapiResults.filter((o) => o.hasRole).length;
  const recapiWithPrincipal = recapiResults.filter((o) => o.hasPrincipal).length;
  const searchWithRole = searchResults.filter((o) => o.hasRole).length;
  const searchWithPrincipal = searchResults.filter((o) => o.hasPrincipal).length;

  console.log(`recapi:  role=${recapiWithRole}/${recapiResults.length}  principal=${recapiWithPrincipal}/${recapiResults.length}`);
  console.log(`search:  role=${searchWithRole}/${searchResults.length}  principal=${searchWithPrincipal}/${searchResults.length}`);

  console.log(
    "\nStamp into gedcomx-convert-spec.md as:" +
      `\n  measured ${new Date().toISOString().slice(0, 10)}, ` +
      "npx tsx dev/probe-persona-role-coverage.ts, " +
      `n=${recapiResults.length} recapi personas + ${searchResults.length} search personas`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * Probe 5 of 5 — search service edge cases, error surface, and v1
 * carryover questions.
 *
 * Endpoint: /service/search/hr/v2/personas
 *
 * Eleven groups answer questions the spec needs to lock down before
 * we can write Error Handling, Mapping Logic, and Output sections:
 *
 *   1. PAGE-CAP        — offset boundaries (4998/4999/5000/9999)
 *   2. COUNT-CAP       — count=100 vs 200 (boundary + over-boundary)
 *   3. SEX-VALUES      — q.sex value range (Unknown/Unspecified/M/male/etc.)
 *   4. NO-RESULTS      — 204 No Content vs 200-empty (docs say 204; v1 found
 *                        platform never returns it)
 *   5. ERR-400-SHAPE   — Where's the diagnostic? Warning header (platform)
 *                        or response body (probes 2+3+4 showed body)?
 *   6. ERR-401         — token omitted
 *   7. ERR-403-WAF     — UA omitted (known requirement, confirm)
 *   8. THROTTLING      — 8 rapid identical queries; do any 429?
 *   9. PRINCIPAL       — multi-principal records (parent-anchored search;
 *                        v1 found these on platform)
 *  10. CONFIDENCE      — variance across diverse queries (v1 found platform
 *                        was always page-uniform; reviewer claims otherwise)
 *  11. ARK-HOST        — does the ark URL come back with www. or bare,
 *                        and do both resolve?
 */
import { getValidToken } from "../src/auth/refresh.js";

const URL_BASE = "https://www.familysearch.org/service/search/hr/v2/personas";
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

interface FetchResult {
  status: number;
  contentType: string | null;
  warning: string | null;
  body: string;
  data: unknown;
}

async function fetchOne(
  token: string | null,
  url: string,
  ua: string | null = BROWSER_UA
): Promise<FetchResult> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (token !== null) headers.Authorization = `Bearer ${token}`;
  if (ua !== null) headers["User-Agent"] = ua;
  const res = await fetch(url, { headers });
  const body = await res.text();
  let data: unknown = null;
  try {
    data = body ? JSON.parse(body) : null;
  } catch {
    /* keep as string */
  }
  return {
    status: res.status,
    contentType: res.headers.get("content-type"),
    warning: res.headers.get("warning"),
    body,
    data,
  };
}

interface Entry {
  id?: string;
  score?: number;
  confidence?: unknown;
  content?: {
    gedcomx?: {
      persons?: Array<{
        principal?: boolean;
        names?: Array<{ nameForms?: Array<{ fullText?: string }> }>;
        identifiers?: Record<string, string[] | undefined>;
      }>;
    };
  };
}

function header(letter: string, title: string): void {
  console.log("\n" + "=".repeat(80));
  console.log(`${letter}.  ${title}`);
  console.log("-".repeat(80));
}

// ─────────────────── 1. PAGE-CAP ───────────────────
async function pageCap(token: string) {
  header("1", "Pagination cap — offset boundaries");
  const offsets = [4990, 4998, 4999, 5000, 5001, 9999];
  for (const o of offsets) {
    const url = `${URL_BASE}?q.surname=Lincoln&offset=${o}&count=3`;
    const r = await fetchOne(token, url);
    if (r.status !== 200) {
      const detail = r.warning ?? (typeof r.data === "object" && r.data ? JSON.stringify(r.data).slice(0, 220) : r.body.slice(0, 220));
      console.log(`  offset=${String(o).padStart(5)}  HTTP ${r.status}  detail=${detail}`);
    } else {
      const d = r.data as { results?: number; entries?: Entry[] };
      console.log(`  offset=${String(o).padStart(5)}  HTTP 200  results=${d.results}  returned=${(d.entries ?? []).length}`);
    }
  }
}

// ─────────────────── 2. COUNT-CAP ───────────────────
async function countCap(token: string) {
  header("2", "Count cap — count=100 vs over-cap");
  for (const c of [100, 101, 200, 1000]) {
    const url = `${URL_BASE}?q.surname=Lincoln&count=${c}`;
    const r = await fetchOne(token, url);
    if (r.status !== 200) {
      const detail = r.warning ?? (typeof r.data === "object" && r.data ? JSON.stringify(r.data).slice(0, 220) : r.body.slice(0, 220));
      console.log(`  count=${String(c).padStart(4)}  HTTP ${r.status}  detail=${detail}`);
    } else {
      const d = r.data as { results?: number; entries?: Entry[] };
      console.log(`  count=${String(c).padStart(4)}  HTTP 200  returned=${(d.entries ?? []).length}`);
    }
  }
}

// ─────────────────── 3. SEX-VALUES ───────────────────
async function sexValues(token: string) {
  header("3", "q.sex accepted value range");
  const values = ["Male", "Female", "Unknown", "Unspecified", "M", "F", "male", "female", "U", ""];
  for (const v of values) {
    const url = `${URL_BASE}?q.surname=Smith&q.sex=${encodeURIComponent(v)}&count=1`;
    const r = await fetchOne(token, url);
    if (r.status !== 200) {
      const detail = r.warning ?? r.body.slice(0, 200).replace(/\s+/g, " ");
      console.log(`  q.sex=${v.padEnd(12)} HTTP ${r.status}  detail=${detail.slice(0, 200)}`);
    } else {
      const d = r.data as { results?: number; entries?: Entry[] };
      console.log(`  q.sex=${v.padEnd(12)} HTTP 200  results=${d.results}`);
    }
  }
}

// ─────────────────── 4. NO-RESULTS ───────────────────
async function noResults(token: string) {
  header("4", "No-results — 204 No Content vs 200-empty");
  // Use the q.collectionId narrowing trick (probe 2: 569k → 531) combined
  // with a nonsense surname to force zero-but-not-rejected.
  const queries = [
    `q.surname=Zzqxywv&count=3`,                                              // nonsense surname (platform fuzzy-expanded to 1k+)
    `q.surname=Zqxywv&q.givenName=Qjwzxyz&count=3`,                           // nonsense pair
    `q.surname=Lincoln&offset=4990&count=3`,                                  // page past actual results (4905-ish)
    `q.surname=Smith&f.collectionId=999999999&count=3`,                       // valid filter, no records (probe 3 returned 0)
    `q.surname=Lincoln&q.givenName=Abraham&q.spouseSurname=Zqxxyz&count=3`,   // restrictive nonsense kin
  ];
  for (const q of queries) {
    const url = `${URL_BASE}?${q}`;
    const r = await fetchOne(token, url);
    const d = r.data as { results?: number; entries?: Entry[] } | null;
    console.log(
      `  HTTP ${r.status}  content-type=${r.contentType}  body-bytes=${r.body.length}  ` +
      `results=${d?.results}  returned=${(d?.entries ?? []).length}  ${q}`
    );
  }
}

// ─────────────────── 5. ERR-400-SHAPE ───────────────────
async function err400Shape(token: string) {
  header("5", "400 error shape — Warning header vs body diagnostic");
  // We've seen body diagnostic in earlier probes. Confirm whether Warning
  // header is also populated, and whether body OR header carries detail.
  const queries = [
    `count=3`,                                                                 // no q.*
    `q.surname=Lincoln&count=200`,                                             // count over cap
    `q.surname=Lincoln&offset=10000&count=3`,                                  // offset way over
    `q.surname=Lincoln&q.gender=Male&count=3`,                                 // deprecated term
    `q.surname=Lincoln&q.birthLikeDate=around%201850&count=3`,                 // bad date format
    `q.surname=Lincoln&q.notARealTerm=foo&count=3`,                            // unknown q.*
    `q.surname=Lincoln&f.notARealFilter=foo&count=3`,                          // unknown f.*
  ];
  for (const q of queries) {
    const url = `${URL_BASE}?${q}`;
    const r = await fetchOne(token, url);
    console.log(`  ${q}`);
    console.log(`    HTTP ${r.status}`);
    console.log(`    Warning header: ${r.warning ?? "(none)"}`);
    console.log(`    Body (first 300c): ${r.body.slice(0, 300).replace(/\s+/g, " ")}`);
  }
}

// ─────────────────── 6. ERR-401 ───────────────────
async function err401() {
  header("6", "401 — token omitted");
  const url = `${URL_BASE}?q.surname=Lincoln&count=3`;
  const r = await fetchOne(null, url);
  console.log(`  URL: ${url}`);
  console.log(`  HTTP ${r.status}  content-type=${r.contentType}`);
  console.log(`  Body (first 300c): ${r.body.slice(0, 300).replace(/\s+/g, " ")}`);
}

// ─────────────────── 7. ERR-403-WAF ───────────────────
async function err403Waf(token: string) {
  header("7", "403 — UA omitted (WAF check)");
  const url = `${URL_BASE}?q.surname=Lincoln&count=3`;
  // Try several non-browser UAs to see what gets through WAF.
  const uas: Array<[string, string | null]> = [
    ["null UA (omitted)", null],
    ["plain identifier", "genealogy-mcp-server/0.0.1"],
    ["curl-like", "curl/8.5.0"],
    ["browser (control)", BROWSER_UA],
  ];
  for (const [label, ua] of uas) {
    const r = await fetchOne(token, url, ua);
    console.log(`  UA[${label.padEnd(20)}]  HTTP ${r.status}  body-bytes=${r.body.length}`);
  }
}

// ─────────────────── 8. THROTTLING ───────────────────
async function throttling(token: string) {
  header("8", "Throttling — 8 rapid identical queries");
  const url = `${URL_BASE}?q.surname=Lincoln&q.givenName=Abraham&count=3`;
  console.log(`  URL: ${url}`);
  console.log(`  Issuing 8 rapid concurrent requests...`);
  const start = Date.now();
  const results = await Promise.all(
    Array.from({ length: 8 }, async (_, i) => {
      const t0 = Date.now();
      const r = await fetchOne(token, url);
      return { i, status: r.status, ms: Date.now() - t0, retryAfter: null as string | null, warning: r.warning };
    })
  );
  const elapsed = Date.now() - start;
  for (const r of results) {
    console.log(`  req[${r.i}]  HTTP ${r.status}  ${r.ms}ms`);
  }
  console.log(`  Total elapsed: ${elapsed}ms`);
  const failed = results.filter((r) => r.status !== 200);
  if (failed.length > 0) {
    console.log(`  ${failed.length} of 8 hit non-200; sample warning: ${failed[0].warning ?? "(none)"}`);
  } else {
    console.log(`  All 8 returned 200 — no throttling triggered at this rate.`);
  }
}

// ─────────────────── 9. PRINCIPAL ───────────────────
async function principal(token: string) {
  header("9", "Principal semantics — multi-principal records?");
  // v1 platform probe with q.parentSurname=Lincoln&q.parentGivenName=Thomas
  // surfaced household records with persons.length=3, 9, 8 all principal=true.
  // Test the same query on the search service.
  const queries = [
    `q.parentSurname=Lincoln&q.parentGivenName=Thomas&count=10`,
    `q.surname=Lincoln&q.givenName=Abraham&q.spouseSurname=Todd&q.spouseGivenName=Mary&q.marriageLikeDate=1842&count=10`,
    `q.surname=Lincoln&q.givenName=Abraham&q.birthLikeDate=1809&q.birthLikePlace=Kentucky&count=10`,
  ];
  for (const q of queries) {
    const url = `${URL_BASE}?${q}`;
    console.log(`\n  ${q}`);
    const r = await fetchOne(token, url);
    if (r.status !== 200) { console.log(`    HTTP ${r.status}`); continue; }
    const d = r.data as { entries?: Entry[] };
    const entries = d.entries ?? [];
    let withMultiPrincipal = 0;
    let totalPrincipals = 0;
    for (const e of entries.slice(0, 5)) {
      const persons = e.content?.gedcomx?.persons ?? [];
      const principals = persons.filter((p) => p.principal === true);
      const names = principals.map((p) => p.names?.[0]?.nameForms?.[0]?.fullText ?? "(unnamed)");
      console.log(`    ${e.id}  persons=${persons.length} principals=${principals.length}  → [${names.slice(0, 4).join("; ")}${names.length > 4 ? `; +${names.length - 4} more` : ""}]`);
      if (principals.length > 1) withMultiPrincipal++;
      totalPrincipals += principals.length;
    }
    console.log(`    Summary: ${withMultiPrincipal}/${Math.min(entries.length, 5)} entries have multiple principals`);
  }
}

// ─────────────────── 10. CONFIDENCE ───────────────────
async function confidence(token: string) {
  header("10", "Confidence variance across diverse queries");
  const queries = [
    `q.surname=Lincoln&count=20`,
    `q.surname=Lincoln&q.givenName=Abraham&count=20`,
    `q.surname=Lincoln&q.givenName=Abraham&q.birthLikeDate=1809&q.birthLikePlace=Kentucky&count=20`,
    `q.surname=Smith&count=20`,
    `q.surname=Smith&q.givenName=John&q.birthLikeDate=1850&q.birthLikePlace=Illinois&count=20`,
    `q.surname=Quesnelle&count=20`,
    `q.surname=Lincoln&q.givenName=Abraham&offset=4900&count=20`,
    `q.surname=Smith&f.collectionId=1743384&count=20`,
    `q.surname=Lincoln&q.spouseSurname=Todd&q.spouseSurname.require=on&count=20`,
  ];
  for (const q of queries) {
    const url = `${URL_BASE}?${q}`;
    const r = await fetchOne(token, url);
    if (r.status !== 200) { console.log(`  HTTP ${r.status} | ${q}`); continue; }
    const d = r.data as { entries?: Entry[] };
    const confs = (d.entries ?? []).map((e) => e.confidence);
    const distinct = [...new Set(confs.map((c) => JSON.stringify(c)))].sort();
    console.log(`  distinct=${distinct.join(",")}  | ${q}`);
  }
}

// ─────────────────── 11. ARK-HOST ───────────────────
async function arkHost(token: string) {
  header("11", "ark URL host — www. vs bare, and do both resolve?");
  const r = await fetchOne(token, `${URL_BASE}?q.surname=Lincoln&count=1`);
  const d = r.data as { entries?: Entry[] };
  const e0 = d.entries?.[0];
  const principal = e0?.content?.gedcomx?.persons?.find((p) => p.principal);
  const ark = principal?.identifiers?.["http://gedcomx.org/Persistent"]?.[0];
  if (!ark) { console.log("  (no ark URL on top entry)"); return; }
  console.log(`  ark from API: ${ark}`);
  const arkBare = ark.replace("https://www.familysearch.org", "https://familysearch.org").replace("https://familysearch.org", "https://familysearch.org");
  const arkWww = ark.startsWith("https://www.") ? ark : ark.replace("https://", "https://www.");
  console.log(`  www form:    ${arkWww}`);
  console.log(`  bare form:   ${arkBare}`);
  for (const u of [arkWww, arkBare]) {
    const res = await fetch(u, { method: "GET", redirect: "manual", headers: { "User-Agent": BROWSER_UA } });
    console.log(`    GET ${u}`);
    console.log(`      status=${res.status}  redirects-to=${res.headers.get("location") ?? "(none)"}`);
  }
}

async function main() {
  const token = await getValidToken();
  console.log(`Got token (${token.length} chars)`);

  const groups: Array<{ id: string; fn: () => Promise<void> | Promise<void> }> = [
    { id: "1.  PAGE-CAP",     fn: () => pageCap(token) },
    { id: "2.  COUNT-CAP",    fn: () => countCap(token) },
    { id: "3.  SEX-VALUES",   fn: () => sexValues(token) },
    { id: "4.  NO-RESULTS",   fn: () => noResults(token) },
    { id: "5.  ERR-400",      fn: () => err400Shape(token) },
    { id: "6.  ERR-401",      fn: () => err401() },
    { id: "7.  ERR-403-WAF",  fn: () => err403Waf(token) },
    { id: "8.  THROTTLING",   fn: () => throttling(token) },
    { id: "9.  PRINCIPAL",    fn: () => principal(token) },
    { id: "10. CONFIDENCE",   fn: () => confidence(token) },
    { id: "11. ARK-HOST",     fn: () => arkHost(token) },
  ];

  for (const g of groups) {
    try {
      await g.fn();
    } catch (e) {
      console.error(`${g.id} threw: ${(e as Error).message}`);
    }
  }
  console.log("\n" + "=".repeat(80));
  console.log("Probe 5 complete.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * Final probe — five questions to settle before drafting the v2 spec.
 *
 * Endpoint: /service/search/hr/v2/personas
 *
 *   1. MULTI-COLLECTION ATTRIBUTION
 *      Query with f.collectionId=A&f.collectionId=B (probe 3 confirmed this
 *      narrows to ~A+B). Can each returned entry be attributed to one of
 *      the two collections? Look at sourceDescriptions[0] across entries.
 *      If yes, v2 SearchResult exposes collectionId per result and the
 *      multi-collection workflow is honest. If no, the multi-value input
 *      is leaky.
 *
 *   2. q.birthLikeDate + f.birthYear* INTERACTION
 *      Untested combination. Three scenarios:
 *      (a) compatible & complementary (date hint within range)
 *      (b) compatible but date hint outside range
 *      (c) check whether date hint reranks within filtered pool
 *
 *   3. f.maritalStatus VALUE ENUM
 *      Probe 3 only tested "Married". Try all standard values + invalid +
 *      case variants. Builds the enum for v2 input.
 *
 *   4. entry.hints SEMANTICS (nice-to-have)
 *      Probe 1 showed entry.hints exists on entries 1+2 but not entry 0.
 *      Dump the contents to see if it's structured per-field match info
 *      that v2 could surface as output.
 *
 *   5. persons[].display{} SHAPE (nice-to-have)
 *      Probe 1 noted it exists but didn't inspect. Could contain
 *      pre-normalized name/date strings that simplify mapping.
 */
import { getValidToken } from "../src/auth/refresh.js";

const URL_BASE = "https://www.familysearch.org/service/search/hr/v2/personas";
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

interface Person {
  principal?: boolean;
  display?: Record<string, unknown>;
  names?: Array<{ nameForms?: Array<{ fullText?: string }> }>;
}
interface SourceDescription {
  about?: string;
  resourceType?: string;
  titles?: Array<{ value?: string }>;
}
interface Entry {
  id?: string;
  hints?: unknown;
  content?: {
    gedcomx?: {
      persons?: Person[];
      sourceDescriptions?: SourceDescription[];
    };
  };
}

async function fetchJson(token: string, url: string): Promise<{ status: number; data: unknown; warning: string | null; body: string }> {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "User-Agent": BROWSER_UA,
    },
  });
  const body = await res.text();
  let data: unknown = null;
  try { data = body ? JSON.parse(body) : null; } catch { /* keep null */ }
  return { status: res.status, data, warning: res.headers.get("warning"), body };
}

function header(n: number, title: string) {
  console.log("\n" + "=".repeat(80));
  console.log(`${n}.  ${title}`);
  console.log("-".repeat(80));
}

// Extract a collection identifier from an entry's sourceDescriptions[0]
function entryCollection(entry: Entry): string | null {
  const sd = entry.content?.gedcomx?.sourceDescriptions?.[0];
  if (!sd) return null;
  if (sd.resourceType !== "http://gedcomx.org/Collection") return null;
  return sd.about ?? null;
}

// ─── 1. MULTI-COLLECTION ATTRIBUTION ───
async function multiCollection(token: string) {
  header(1, "Multi-collection attribution — can each entry be traced to its collection?");

  const collectionA = "1743384"; // Alabama County Marriages
  const collectionB = "5000016"; // NUMIDENT
  const url = `${URL_BASE}?q.surname=Smith&f.collectionId=${collectionA}&f.collectionId=${collectionB}&count=20`;

  console.log(`URL: ${url}\n`);
  const r = await fetchJson(token, url);
  if (r.status !== 200) {
    console.log(`HTTP ${r.status}`);
    return;
  }
  const data = r.data as { results?: number; entries?: Entry[] };
  const entries = data.entries ?? [];
  console.log(`results=${data.results}, entries=${entries.length}`);

  // Tally collection per entry
  const colCounts: Record<string, number> = {};
  for (const e of entries) {
    const col = entryCollection(e) ?? "(none/missing)";
    colCounts[col] = (colCounts[col] ?? 0) + 1;
  }
  console.log("\nCollection attribution across 20 entries:");
  for (const [col, count] of Object.entries(colCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${count.toString().padStart(2)}  ${col}`);
  }

  // Pull a sample title for each distinct collection
  console.log("\nSample title per distinct collection:");
  const seen = new Set<string>();
  for (const e of entries) {
    const col = entryCollection(e);
    if (!col || seen.has(col)) continue;
    seen.add(col);
    const sd0 = e.content?.gedcomx?.sourceDescriptions?.[0];
    console.log(`  ${col}`);
    console.log(`    title=${sd0?.titles?.[0]?.value ?? "(none)"}`);
  }
}

// ─── 2. q.birthLikeDate + f.birthYear* INTERACTION ───
async function dateYearInteraction(token: string) {
  header(2, "q.birthLikeDate + f.birthYear* interaction");

  const queries: Array<{ label: string; q: string }> = [
    { label: "baseline                                  ", q: `q.surname=Lincoln&q.givenName=Abraham&count=3` },
    { label: "q.birthLikeDate=1809 only                  ", q: `q.surname=Lincoln&q.givenName=Abraham&q.birthLikeDate=1809&count=3` },
    { label: "f.birthYear0=1800 & f.birthYear1=1820 only ", q: `q.surname=Lincoln&q.givenName=Abraham&f.birthYear0=1800&f.birthYear1=1820&count=3` },
    { label: "BOTH (date in range, compatible)           ", q: `q.surname=Lincoln&q.givenName=Abraham&q.birthLikeDate=1809&f.birthYear0=1800&f.birthYear1=1820&count=3` },
    { label: "BOTH (date OUTSIDE range, conflicting)     ", q: `q.surname=Lincoln&q.givenName=Abraham&q.birthLikeDate=1900&f.birthYear0=1800&f.birthYear1=1820&count=3` },
  ];

  for (const { label, q } of queries) {
    const r = await fetchJson(token, `${URL_BASE}?${q}`);
    if (r.status !== 200) {
      console.log(`  ${label}  HTTP ${r.status}  detail=${r.body.slice(0, 200).replace(/\s+/g, " ")}`);
      continue;
    }
    const d = r.data as { results?: number; entries?: Entry[] };
    const top3 = (d.entries ?? []).slice(0, 3).map((e) => e.id).join(",");
    console.log(`  ${label}  results=${String(d.results).padStart(7)}  top3=${top3}`);
  }
  console.log("\nReadout:");
  console.log("  - If 'BOTH compatible' results == 'f.birthYear only' results: date hint reranks within filtered pool (compatible).");
  console.log("  - If 'BOTH conflicting' results == 'f.birthYear only' results AND top3 == 'f.birthYear only' top3: date hint silently ignored when outside range.");
  console.log("  - If 'BOTH conflicting' returns 0 or HTTP 400: API enforces consistency.");
}

// ─── 3. f.maritalStatus ENUM ───
async function maritalStatusEnum(token: string) {
  header(3, "f.maritalStatus accepted values");
  const values = [
    "Married", "Single", "Divorced", "Widowed", "Unknown", "Annulled", "Separated",
    "married", "MARRIED",                  // case variants
    "Common Law", "Common-Law",            // multi-word
    "foo",                                  // garbage sanity
    "",                                     // empty
  ];
  for (const v of values) {
    const url = `${URL_BASE}?q.surname=Smith&f.maritalStatus=${encodeURIComponent(v)}&count=1`;
    const r = await fetchJson(token, url);
    if (r.status !== 200) {
      const detail = (r.data && typeof r.data === "object")
        ? JSON.stringify(r.data).slice(0, 220)
        : r.body.slice(0, 220);
      console.log(`  f.maritalStatus=${JSON.stringify(v).padEnd(15)}  HTTP ${r.status}  detail=${detail}`);
    } else {
      const d = r.data as { results?: number };
      console.log(`  f.maritalStatus=${JSON.stringify(v).padEnd(15)}  HTTP 200  results=${d.results}`);
    }
  }
}

// ─── 4. entry.hints SEMANTICS ───
async function hintsSemantics(token: string) {
  header(4, "entry.hints — what's actually in there?");

  // Pull a generous query that's likely to give entries with hints.
  const queries = [
    { label: "Lincoln Abraham (probe-1 baseline)", q: `q.surname=Lincoln&q.givenName=Abraham&count=10` },
    { label: "Smith John 1850 Illinois (heavy match)", q: `q.surname=Smith&q.givenName=John&q.birthLikeDate=1850&q.birthLikePlace=Illinois&count=10` },
  ];
  for (const { label, q } of queries) {
    console.log(`\n[${label}]`);
    const r = await fetchJson(token, `${URL_BASE}?${q}`);
    if (r.status !== 200) { console.log(`  HTTP ${r.status}`); continue; }
    const entries = (r.data as { entries?: Entry[] }).entries ?? [];
    let hintsCount = 0;
    for (let i = 0; i < entries.length; i++) {
      if (entries[i].hints !== undefined) {
        hintsCount++;
        console.log(`  entries[${i}].id=${entries[i].id}  hints=${JSON.stringify(entries[i].hints).slice(0, 400)}`);
      }
    }
    console.log(`  → ${hintsCount}/${entries.length} entries had a 'hints' field`);
  }
}

// ─── 5. persons[].display{} SHAPE ───
async function displayShape(token: string) {
  header(5, "persons[].display{} — what's inside?");
  const url = `${URL_BASE}?q.surname=Lincoln&q.givenName=Abraham&q.birthLikeDate=1809&q.birthLikePlace=Kentucky&count=5`;
  const r = await fetchJson(token, url);
  if (r.status !== 200) { console.log(`HTTP ${r.status}`); return; }
  const entries = (r.data as { entries?: Entry[] }).entries ?? [];
  console.log(`URL: ${url}\n`);
  for (let i = 0; i < Math.min(3, entries.length); i++) {
    const persons = entries[i].content?.gedcomx?.persons ?? [];
    const principal = persons.find((p) => p.principal === true);
    if (!principal) { console.log(`  entries[${i}] has no principal person`); continue; }
    console.log(`  entries[${i}].id=${entries[i].id}  principal name=${principal.names?.[0]?.nameForms?.[0]?.fullText}`);
    console.log(`    display=${JSON.stringify(principal.display, null, 2)?.split("\n").join("\n    ") ?? "(none)"}`);
  }
}

async function main() {
  const token = await getValidToken();
  console.log(`Got token (${token.length} chars)`);

  const sections: Array<{ fn: () => Promise<void> }> = [
    { fn: () => multiCollection(token) },
    { fn: () => dateYearInteraction(token) },
    { fn: () => maritalStatusEnum(token) },
    { fn: () => hintsSemantics(token) },
    { fn: () => displayShape(token) },
  ];
  for (const s of sections) {
    try { await s.fn(); } catch (e) { console.error(`section threw: ${(e as Error).message}`); }
  }
  console.log("\n" + "=".repeat(80));
  console.log("Final probe complete — ready for v2 spec drafting.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

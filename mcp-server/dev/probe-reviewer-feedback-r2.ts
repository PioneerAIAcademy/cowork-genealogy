/**
 * Round-2 reviewer feedback probe — covers all 10 items A–J.
 *
 * Each probe is self-contained, prints the URLs it hit, and surfaces just
 * the data needed to confirm or refute the reviewer's claim. Probes E, F, J
 * are included even though we marked them as "no probe needed" — the
 * reviewer sounded certain, but we want our own verification.
 *
 * Run:
 *   cd mcp-server && npx tsx scripts/probe-reviewer-feedback-r2.ts
 */
import { getValidToken } from "../src/auth/refresh.js";

const PLATFORM = "https://api.familysearch.org/platform/records/personas";
const UA = "review-evidence/0.1";
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

interface Person {
  principal?: boolean;
  names?: Array<{ nameForms?: Array<{ fullText?: string }> }>;
  identifiers?: Record<string, string[] | undefined>;
  facts?: Array<{ type?: string }>;
  gender?: { type?: string };
}
interface Entry {
  id?: string;
  score?: number;
  confidence?: number;
  title?: string;
  content?: {
    gedcomx?: {
      persons?: Person[];
      sourceDescriptions?: Array<{
        identifiers?: Record<string, string[] | undefined>;
        titles?: Array<{ value?: string }>;
      }>;
    };
  };
}
interface SearchResponse {
  results?: number;
  entries?: Entry[];
  links?: { next?: { href: string } };
}

async function fetchJson(
  token: string,
  url: string,
  ua: string = UA
): Promise<{ ok: boolean; status: number; data: SearchResponse | null; warning: string | null }> {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "User-Agent": ua,
    },
  });
  const warning = res.headers.get("warning");
  if (!res.ok) return { ok: false, status: res.status, data: null, warning };
  try {
    return { ok: true, status: res.status, data: await res.json(), warning };
  } catch {
    return { ok: false, status: res.status, data: null, warning };
  }
}

function header(letter: string, title: string, claim: string) {
  console.log("\n" + "=".repeat(80));
  console.log(`${letter}.  ${title}`);
  console.log("-".repeat(80));
  console.log(`Reviewer claim: ${claim}`);
  console.log("");
}

function topIds(entries: Entry[] | undefined, n = 5): string {
  return (entries ?? []).slice(0, n).map((e) => e.id ?? "?").join(",");
}
function topScores(entries: Entry[] | undefined, n = 5): string {
  return (entries ?? []).slice(0, n).map((e) => (e.score ?? 0).toFixed(3)).join(",");
}

// ─────────────────── A ───────────────────
async function probeA(token: string) {
  header("A", "Date YYYY vs YYYY-MM-DD granularity",
    "API treats dates as year-only; YYYY-MM-DD is ignored beyond the year.");
  const variants = [
    "q.surname=Lincoln&q.givenName=Abraham&q.birthLikeDate=1809&count=20",
    "q.surname=Lincoln&q.givenName=Abraham&q.birthLikeDate=1809-02-12&count=20",
    "q.surname=Lincoln&q.givenName=Abraham&q.birthLikeDate=1809-12-31&count=20",
    "q.surname=Lincoln&q.givenName=Abraham&q.birthLikeDate=1809-01-01&count=20",
  ];
  for (const q of variants) {
    const url = `${PLATFORM}?${q}`;
    const r = await fetchJson(token, url);
    console.log(`URL: ${url}`);
    if (!r.ok) { console.log(`  HTTP ${r.status}`); continue; }
    console.log(`  results=${r.data?.results}  top5-ids=[${topIds(r.data?.entries)}]`);
    console.log(`  top5-scores=[${topScores(r.data?.entries)}]`);
  }
  console.log("\nIf reviewer is right: all four queries should yield identical top-IDs and scores.");
}

// ─────────────────── B ───────────────────
async function probeB(token: string) {
  header("B", "q.recordCountry / q.recordSubcountry (undocumented)",
    "These terms exist and can scope by country / 2nd-level jurisdiction.");
  const variants = [
    "q.surname=Smith&count=3",                                                // baseline
    "q.surname=Smith&q.recordCountry=United%20States&count=3",
    "q.surname=Smith&q.recordCountry=England&count=3",
    "q.surname=Smith&q.recordSubcountry=Alabama&count=3",
    "q.surname=Smith&q.recordCountry=United%20States&q.recordSubcountry=Alabama&count=3",
    "q.surname=Smith&q.recordCountry=Canada&q.recordSubcountry=Ontario&count=3",
  ];
  for (const q of variants) {
    const url = `${PLATFORM}?${q}`;
    const r = await fetchJson(token, url);
    console.log(`URL: ${url}`);
    if (!r.ok) {
      console.log(`  HTTP ${r.status}  warning=${r.warning?.slice(0, 200) ?? "(none)"}`);
      continue;
    }
    console.log(`  results=${r.data?.results}  top3=${topIds(r.data?.entries, 3)}`);
  }
  console.log("\nIf supported: HTTP 200 + results count and/or top-IDs differ from baseline.");
  console.log("If unsupported: HTTP 400 with 'Unsupported Term' in Warning header.");
}

// ─────────────────── C ───────────────────
async function probeC(token: string) {
  header("C", "What does collectionUrl actually point to?",
    "The /platform/externalId/easy/{n} URL is mislabeled — not a collection link.");
  const r = await fetchJson(token, `${PLATFORM}?q.surname=Lincoln&count=3`);
  if (!r.ok) { console.log(`  baseline failed: HTTP ${r.status}`); return; }
  for (const entry of r.data?.entries ?? []) {
    const sd = entry.content?.gedcomx?.sourceDescriptions?.[0];
    const collectionUrl = sd?.identifiers?.["http://gedcomx.org/Primary"]?.[0];
    console.log(`Entry ${entry.id} -> collectionUrl: ${collectionUrl ?? "(none)"}`);
    if (!collectionUrl) continue;
    const res = await fetch(collectionUrl, {
      method: "GET",
      redirect: "manual",
      headers: { Authorization: `Bearer ${await getValidToken()}`, Accept: "application/json", "User-Agent": UA },
    });
    const ct = res.headers.get("content-type") ?? "";
    const loc = res.headers.get("location") ?? "(none)";
    console.log(`  GET status=${res.status}, content-type=${ct}, redirects-to=${loc}`);
    if (res.status === 200 && ct.includes("json")) {
      try {
        const body = await res.json() as Record<string, unknown>;
        console.log(`  json keys: ${Object.keys(body).slice(0, 10).join(", ")}`);
      } catch { /* fall through */ }
    }
  }
}

// ─────────────────── D ───────────────────
async function probeD(token: string) {
  header("D", "Cardinality .1 for alternate names",
    "q.surname.1 / q.givenName.1 work for alternate-name searches (maiden+married).");
  const variants = [
    "q.surname=Lincoln&q.givenName=Mary&count=5",                                                 // baseline
    "q.surname=Todd&q.givenName=Mary&count=5",                                                    // alt baseline
    "q.surname=Lincoln&q.givenName=Mary&q.surname.1=Todd&q.givenName.1=Mary&count=5",
    "q.givenName=Mary&q.givenName.1=Mary&q.surname=Todd&q.surname.1=Lincoln&count=5",            // reviewer's exact form
  ];
  for (const q of variants) {
    const url = `${PLATFORM}?${q}`;
    const r = await fetchJson(token, url);
    console.log(`URL: ${url}`);
    if (!r.ok) {
      console.log(`  HTTP ${r.status}  warning=${r.warning?.slice(0, 200) ?? "(none)"}`);
      continue;
    }
    const entries = r.data?.entries ?? [];
    const namesShown = entries.slice(0, 3).map((e) => {
      const principal = e.content?.gedcomx?.persons?.find((p) => p.principal);
      return principal?.names?.[0]?.nameForms?.[0]?.fullText ?? "?";
    });
    console.log(`  results=${r.data?.results}  top3-names=[${namesShown.join(" | ")}]`);
  }
  console.log("\nIf supported: cardinality query returns Mary Todd Lincoln-related records.");
  console.log("If unsupported: HTTP 400 with 'Unsupported Term=surname.1' (or similar).");
}

// ─────────────────── E ───────────────────
async function probeE(token: string) {
  header("E", "Principal definition — multiple principals per record?",
    "principal=true means 'main person(s) the record is about'. Marriage records have 2.");
  const queries = [
    {
      label: "Lincoln-Todd marriage anchor",
      q: "q.surname=Lincoln&q.givenName=Abraham&q.spouseSurname=Todd&q.spouseGivenName=Mary&q.marriageLikeDate=1842&count=5",
    },
    {
      label: "Birth record anchor",
      q: "q.surname=Lincoln&q.givenName=Abraham&q.birthLikeDate=1809&q.birthLikePlace=Kentucky&count=5",
    },
    {
      label: "Search-by-parent anchor (Abraham's father Thomas)",
      q: "q.parentSurname=Lincoln&q.parentGivenName=Thomas&count=5",
    },
  ];
  for (const { label, q } of queries) {
    const url = `${PLATFORM}?${q}`;
    console.log(`[${label}]`);
    console.log(`URL: ${url}`);
    const r = await fetchJson(token, url);
    if (!r.ok) { console.log(`  HTTP ${r.status}`); continue; }
    for (const entry of r.data?.entries ?? []) {
      const persons = entry.content?.gedcomx?.persons ?? [];
      const principals = persons.filter((p) => p.principal === true);
      const principalNames = principals.map(
        (p) => p.names?.[0]?.nameForms?.[0]?.fullText ?? "(unnamed)"
      );
      const title = (entry.title ?? "").slice(0, 70);
      console.log(`  ${entry.id} (${title})`);
      console.log(`    persons=${persons.length}, principals=${principals.length} → [${principalNames.join("; ")}]`);
    }
    console.log("");
  }
  console.log("If reviewer is right: marriage records show 2 principals (bride+groom);");
  console.log("birth-by-parent search: principal is the child, not the parent we queried.");
}

// ─────────────────── F ───────────────────
async function probeF(token: string) {
  header("F", "ark URL: www.familysearch.org vs familysearch.org",
    "Both forms work — the spec's 'host rewriting' caveat is misleading.");
  const r = await fetchJson(token, `${PLATFORM}?q.surname=Lincoln&count=1`);
  const entry = r.data?.entries?.[0];
  const principal = entry?.content?.gedcomx?.persons?.find((p) => p.principal);
  const arkWWW = principal?.identifiers?.["http://gedcomx.org/Persistent"]?.[0];
  if (!arkWWW) { console.log("  (no ark URL on top entry)"); return; }
  const arkBare = arkWWW.replace("https://www.familysearch.org", "https://familysearch.org");
  console.log(`with www: ${arkWWW}`);
  console.log(`bare:     ${arkBare}`);
  console.log("");
  for (const url of [arkWWW, arkBare]) {
    const res = await fetch(url, { method: "GET", redirect: "manual", headers: { "User-Agent": BROWSER_UA } });
    const loc = res.headers.get("location");
    console.log(`  GET ${url}`);
    console.log(`    status=${res.status}  redirects-to=${loc ?? "(none)"}`);
  }
  console.log("\nIf both URLs behave the same way (same status, same redirect), they're equivalent.");
}

// ─────────────────── G ───────────────────
async function probeG(token: string) {
  header("G", "Non-surname q.* filters don't shrink `results` (broader proof)",
    "Reviewer 'still doesn't believe it'. Run 19 variants to settle it definitively.");
  const variants = [
    "q.surname=Lincoln&count=1",  // baseline
    "q.surname=Lincoln&q.givenName=Abraham&count=1",
    "q.surname=Lincoln&q.birthLikeDate=1809&count=1",
    "q.surname=Lincoln&q.birthLikePlace=Kentucky&count=1",
    "q.surname=Lincoln&q.deathLikeDate=1865&count=1",
    "q.surname=Lincoln&q.deathLikePlace=Washington&count=1",
    "q.surname=Lincoln&q.marriageLikeDate=1842&count=1",
    "q.surname=Lincoln&q.marriageLikePlace=Springfield&count=1",
    "q.surname=Lincoln&q.residenceDate=1860&count=1",
    "q.surname=Lincoln&q.residencePlace=Illinois&count=1",
    "q.surname=Lincoln&q.sex=Male&count=1",
    "q.surname=Lincoln&q.fatherSurname=Lincoln&count=1",
    "q.surname=Lincoln&q.fatherGivenName=Thomas&count=1",
    "q.surname=Lincoln&q.motherGivenName=Nancy&count=1",
    "q.surname=Lincoln&q.spouseSurname=Todd&count=1",
    "q.surname=Lincoln&q.spouseGivenName=Mary&count=1",
    "q.surname=Lincoln&q.parentSurname=Hanks&count=1",
    "q.surname=Lincoln&q.parentGivenName=Nancy&count=1",
    "q.surname=Lincoln&q.givenName=Abraham&q.birthLikeDate=1809&q.birthLikePlace=Kentucky&q.deathLikeDate=1865&q.deathLikePlace=Washington&q.marriageLikeDate=1842&q.spouseSurname=Todd&count=1",
  ];
  console.log(`results  | query`);
  console.log("-".repeat(120));
  for (const q of variants) {
    const r = await fetchJson(token, `${PLATFORM}?${q}`);
    if (!r.ok) { console.log(`HTTP ${r.status} | ${q}`); continue; }
    console.log(`${String(r.data?.results).padStart(7)}  | ${q}`);
  }
  console.log("\nIf reviewer is right: results should drop as filters narrow.");
  console.log("If spec is right: all values stay at the surname-baseline (4905 for Lincoln).");
}

// ─────────────────── H ───────────────────
async function probeH(token: string) {
  header("H", "Confidence variance within a page",
    "Confidence isn't always page-uniform; varies with query and corpus.");
  const variants = [
    "q.surname=Lincoln&count=20",
    "q.surname=Lincoln&q.givenName=Abraham&count=20",
    "q.surname=Lincoln&q.givenName=Abraham&q.birthLikeDate=1809&q.birthLikePlace=Kentucky&count=20",
    "q.surname=Smith&count=20",
    "q.surname=Smith&q.givenName=John&q.birthLikeDate=1850&q.birthLikePlace=Illinois&count=20",
    "q.surname=Quesnelle&count=20",
    "q.surname=Lincoln&q.givenName=Abraham&q.birthLikeDate=1809&q.birthLikePlace=Kentucky&q.deathLikeDate=1865&q.deathLikePlace=Washington&q.marriageLikeDate=1842&q.spouseSurname=Todd&count=20",
    "q.givenName=Abraham&count=20",
    "q.surname=Lincoln&q.givenName=Abraham&offset=4900&count=20",
  ];
  for (const q of variants) {
    const r = await fetchJson(token, `${PLATFORM}?${q}`);
    if (!r.ok) { console.log(`HTTP ${r.status} | ${q}`); continue; }
    const confs = (r.data?.entries ?? []).map((e) => e.confidence);
    const distinct = [...new Set(confs)].sort();
    console.log(`  distinct=[${distinct.join(",")}]  confidences=[${confs.join(",")}]`);
    console.log(`    ${q}`);
  }
  console.log("\nIf reviewer is right: at least one query shows distinct.length > 1 (mixed confidences).");
}

// ─────────────────── I ───────────────────
async function probeI(token: string) {
  header("I", "q.isPrincipal=true behavior",
    "Filters to records where the queried person is in a principal role (not just mentioned).");

  // Probe-1: is the term recognized at all?
  const url1 = `${PLATFORM}?q.surname=Lincoln&q.isPrincipal=true&count=5`;
  console.log(`Probe-1 URL: ${url1}`);
  const r1 = await fetchJson(token, url1);
  if (r1.ok) {
    console.log(`  HTTP 200, results=${r1.data?.results}  → term accepted`);
  } else {
    console.log(`  HTTP ${r1.status}, warning=${r1.warning?.slice(0, 200) ?? "(none)"}`);
  }
  console.log("");

  // Probe-2: with vs without on a query where the queried person is often non-principal
  // (Thomas Lincoln — Abraham's father — appears as a non-principal parent in many birth records)
  const compare = [
    { label: "WITHOUT q.isPrincipal", q: "q.surname=Lincoln&q.givenName=Thomas&count=10" },
    { label: "WITH q.isPrincipal=true", q: "q.surname=Lincoln&q.givenName=Thomas&q.isPrincipal=true&count=10" },
  ];
  for (const { label, q } of compare) {
    const url = `${PLATFORM}?${q}`;
    console.log(`[${label}]`);
    console.log(`URL: ${url}`);
    const r = await fetchJson(token, url);
    if (!r.ok) { console.log(`  HTTP ${r.status}`); continue; }
    console.log(`  results=${r.data?.results}, returned=${(r.data?.entries ?? []).length}`);
    for (const entry of (r.data?.entries ?? []).slice(0, 5)) {
      const persons = entry.content?.gedcomx?.persons ?? [];
      const principals = persons.filter((p) => p.principal === true);
      const thomases = persons.filter((p) => {
        const n = (p.names?.[0]?.nameForms?.[0]?.fullText ?? "").toLowerCase();
        return n.includes("thomas") && n.includes("lincoln");
      });
      const thomasPrincipalFlags = thomases.map((t) => t.principal === true);
      const title = (entry.title ?? "").slice(0, 70);
      console.log(`  ${entry.id} (${title})`);
      console.log(`    principals=${principals.length}, Thomas-Lincoln-occurrences=${thomases.length}, all-principal? [${thomasPrincipalFlags.join(",")}]`);
    }
    console.log("");
  }
  console.log("If reviewer is right: 'WITH' query should ONLY return records where Thomas Lincoln is principal=true.");
}

// ─────────────────── J ───────────────────
async function probeJ(token: string) {
  header("J", "Surname not API-required (re-confirm)",
    "Surname-required is tool policy; API requires only some q.* term.");
  const variants = [
    "count=3",
    "q.givenName=Abraham&count=3",
    "q.birthLikePlace=Kentucky&count=3",
    "q.givenName=Abraham&q.birthLikeDate=1809&count=3",
    "q.spouseSurname=Todd&count=3",
  ];
  for (const q of variants) {
    const url = `${PLATFORM}?${q}`;
    const r = await fetchJson(token, url);
    if (!r.ok) {
      console.log(`HTTP ${r.status}  ${url}`);
      console.log(`    warning=${r.warning?.slice(0, 200) ?? "(none)"}`);
    } else {
      console.log(`HTTP 200  results=${r.data?.results}  ${url}`);
    }
  }
  console.log("\nIf reviewer is right: anything non-empty (given-only, place-only, kin-only) should return 200.");
}

async function main() {
  const token = await getValidToken();
  console.log(`Got token (${token.length} chars)\n`);
  const probes: Array<{ letter: string; fn: (t: string) => Promise<void> }> = [
    { letter: "A", fn: probeA },
    { letter: "B", fn: probeB },
    { letter: "C", fn: probeC },
    { letter: "D", fn: probeD },
    { letter: "E", fn: probeE },
    { letter: "F", fn: probeF },
    { letter: "G", fn: probeG },
    { letter: "H", fn: probeH },
    { letter: "I", fn: probeI },
    { letter: "J", fn: probeJ },
  ];
  for (const { letter, fn } of probes) {
    try {
      await fn(token);
    } catch (e) {
      console.error(`Probe ${letter} threw: ${(e as Error).message}`);
    }
  }
  console.log("\n" + "=".repeat(80));
  console.log("All probes complete.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

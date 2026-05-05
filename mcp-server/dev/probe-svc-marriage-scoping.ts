/**
 * Reviewer comments #1+#2: settle four scoping primitives the spec
 * doesn't currently use.
 *
 *   A. q.isPrincipal=true — earlier probes saw no effect. Retest
 *      with possible companions (.require=on; m.queryRequireDefault=on)
 *      and against a query likely to surface non-principals.
 *
 *   B. f.recordType=N — does this filter, and which integer is which?
 *
 *   C. q.recordCountry / q.recordSubcountry (as q.*, NOT f.*) —
 *      reviewer's URL uses these. Format `United States,Alabama`
 *      (parent country, comma, state) not previously tested.
 *
 *   D. Marriage-year range — is there an analog to f.birthYear0/1
 *      (e.g., f.marriageYear0/1)? Or do we have to live with
 *      q.marriageLikeDate.from/.to which is rerank-only?
 */
import { getValidToken } from "../src/auth/refresh.js";

const URL_BASE = "https://www.familysearch.org/service/search/hr/v2/personas";
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

const ALABAMA_MARRIAGES = "1743384";

interface Person {
  principal?: boolean;
  display?: { name?: string; role?: string };
}
interface Entry {
  id?: string;
  content?: { gedcomx?: { persons?: Person[] } };
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
  const body = await res.text();
  let data: unknown = null;
  try { data = body ? JSON.parse(body) : null; } catch { /* keep */ }
  return { status: res.status, body, data };
}

function head(label: string) {
  console.log("\n" + "=".repeat(80));
  console.log(label);
  console.log("=".repeat(80));
}

function reportRow(label: string, q: string, status: number, data: unknown) {
  if (status !== 200) {
    const detail = (data && typeof data === "object")
      ? JSON.stringify(data).slice(0, 220).replace(/\s+/g, " ")
      : `(status ${status})`;
    console.log(`  ${label}  HTTP ${status}  detail=${detail}`);
    return null;
  }
  const d = data as { results?: number; entries?: Entry[] };
  const top3 = (d.entries ?? []).slice(0, 3).map((e) => e.id).join(",");
  console.log(`  ${label.padEnd(60)} results=${String(d.results).padStart(10)}  top3=${top3}`);
  return d;
}

async function main() {
  const token = await getValidToken();
  console.log(`Got token (${token.length} chars)`);

  // ── A. q.isPrincipal — does it filter under any companion? ──
  head("A.  q.isPrincipal=true effectiveness");
  console.log("Test query: surname=Smith inside Alabama Marriages (collection 1743384).");
  console.log("Marriage records have brides+grooms as principals; parents/witnesses non-principal.");
  console.log("If isPrincipal works, results count should drop with vs. without it.\n");
  const aProbes = [
    { label: "baseline (no isPrincipal)",
      q: `q.surname=Smith&f.collectionId=${ALABAMA_MARRIAGES}&count=5` },
    { label: "+ q.isPrincipal=true (alone)",
      q: `q.surname=Smith&f.collectionId=${ALABAMA_MARRIAGES}&q.isPrincipal=true&count=5` },
    { label: "+ q.isPrincipal=true & q.isPrincipal.require=on",
      q: `q.surname=Smith&f.collectionId=${ALABAMA_MARRIAGES}&q.isPrincipal=true&q.isPrincipal.require=on&count=5` },
    { label: "+ q.isPrincipal=true & m.queryRequireDefault=on",
      q: `q.surname=Smith&f.collectionId=${ALABAMA_MARRIAGES}&q.isPrincipal=true&m.queryRequireDefault=on&count=5` },
    { label: "+ q.isPrincipal=true with both modifiers",
      q: `q.surname=Smith&f.collectionId=${ALABAMA_MARRIAGES}&q.isPrincipal=true&q.isPrincipal.require=on&m.queryRequireDefault=on&count=5` },
    { label: "+ q.isPrincipal=false (does the inverse work?)",
      q: `q.surname=Smith&f.collectionId=${ALABAMA_MARRIAGES}&q.isPrincipal=false&q.isPrincipal.require=on&count=5` },
  ];
  for (const p of aProbes) {
    const r = await fetchJson(token, `${URL_BASE}?${p.q}`);
    reportRow(p.label, p.q, r.status, r.data);
  }

  // ── B. f.recordType=N — what works, what does each int mean? ──
  head("B.  f.recordType=N — accepted values + semantic guess");
  console.log("Strategy: try integers 0-10, see which produce HTTP 200.");
  console.log("Then pair the working ones with date filters to guess what each is.\n");
  const bProbes: Array<{ label: string; q: string }> = [];
  for (let i = 0; i <= 10; i++) {
    bProbes.push({ label: `f.recordType=${i}`, q: `q.surname=Smith&f.recordType=${i}&count=3` });
  }
  // Sanity: bogus
  bProbes.push({ label: "f.recordType=999 (bogus)", q: `q.surname=Smith&f.recordType=999&count=3` });
  bProbes.push({ label: "f.recordType=foo (non-numeric)", q: `q.surname=Smith&f.recordType=foo&count=3` });
  for (const p of bProbes) {
    const r = await fetchJson(token, `${URL_BASE}?${p.q}`);
    reportRow(p.label, p.q, r.status, r.data);
  }

  console.log("\n--- Pair recordType with date hints to guess semantics ---");
  const bSemantic = [
    { label: "f.recordType=1 + q.marriageLikeDate=1850 (marriage?)",
      q: `q.surname=Smith&f.recordType=1&q.marriageLikeDate=1850&count=3` },
    { label: "f.recordType=2 + q.birthLikeDate=1850 (birth?)",
      q: `q.surname=Smith&f.recordType=2&q.birthLikeDate=1850&count=3` },
    { label: "f.recordType=3 + q.deathLikeDate=1850 (death?)",
      q: `q.surname=Smith&f.recordType=3&q.deathLikeDate=1850&count=3` },
    { label: "f.recordType=4 + q.residenceDate=1850 (census?)",
      q: `q.surname=Smith&f.recordType=4&q.residenceDate=1850&count=3` },
  ];
  for (const p of bSemantic) {
    const r = await fetchJson(token, `${URL_BASE}?${p.q}`);
    reportRow(p.label, p.q, r.status, r.data);
  }

  // ── C. q.recordCountry / q.recordSubcountry as q.* ──
  head("C.  q.recordCountry / q.recordSubcountry (as q.*, NOT f.*)");
  console.log("Reviewer's URL uses these. We previously tested f.recordSubcountry (ZERO).");
  console.log("Try the q.* form with the format the reviewer used: `United States,Alabama`.\n");
  const cProbes = [
    { label: "baseline q.surname=Smith",
      q: `q.surname=Smith&count=5` },
    { label: "+ q.recordCountry=United States",
      q: `q.surname=Smith&q.recordCountry=United%20States&count=5` },
    { label: "+ q.recordSubcountry=Alabama (state name only)",
      q: `q.surname=Smith&q.recordSubcountry=Alabama&count=5` },
    { label: "+ q.recordSubcountry=United States,Alabama (reviewer's format)",
      q: `q.surname=Smith&q.recordSubcountry=United%20States%2CAlabama&count=5` },
    { label: "+ q.recordCountry=US AND q.recordSubcountry=US,Alabama (both)",
      q: `q.surname=Smith&q.recordCountry=United%20States&q.recordSubcountry=United%20States%2CAlabama&count=5` },
    { label: "+ both, with .require=on on subcountry",
      q: `q.surname=Smith&q.recordCountry=United%20States&q.recordSubcountry=United%20States%2CAlabama&q.recordSubcountry.require=on&count=5` },
    { label: "+ both, with m.queryRequireDefault=on",
      q: `q.surname=Smith&q.recordCountry=United%20States&q.recordSubcountry=United%20States%2CAlabama&m.queryRequireDefault=on&count=5` },
    { label: "+ q.recordSubcountry=Canada,Ontario (different country)",
      q: `q.surname=Smith&q.recordCountry=Canada&q.recordSubcountry=Canada%2COntario&count=5` },
  ];
  for (const p of cProbes) {
    const r = await fetchJson(token, `${URL_BASE}?${p.q}`);
    reportRow(p.label, p.q, r.status, r.data);
  }

  // ── D. Marriage-year range filter ──
  head("D.  Marriage-year range — is there an f.marriageYear0/1 analog?");
  console.log("f.birthYear0/1 narrows. Does f.marriageYear0/1 exist? f.deathYear0/1?\n");
  const dProbes = [
    { label: "baseline q.surname=Smith",
      q: `q.surname=Smith&count=3` },
    { label: "f.marriageYear0=1830 & f.marriageYear1=1850",
      q: `q.surname=Smith&f.marriageYear0=1830&f.marriageYear1=1850&count=3` },
    { label: "f.deathYear0=1850 & f.deathYear1=1900",
      q: `q.surname=Smith&f.deathYear0=1850&f.deathYear1=1900&count=3` },
    { label: "q.marriageLikeDate.from=1830 & q.marriageLikeDate.to=1850 (RERANKS-ONLY?)",
      q: `q.surname=Smith&q.marriageLikeDate.from=1830&q.marriageLikeDate.to=1850&count=3` },
    { label: "+ Alabama Marriages collection",
      q: `q.surname=Smith&f.collectionId=${ALABAMA_MARRIAGES}&q.marriageLikeDate.from=1830&q.marriageLikeDate.to=1850&count=3` },
    { label: "+ Alabama Marriages + .require=on on marriage date",
      q: `q.surname=Smith&f.collectionId=${ALABAMA_MARRIAGES}&q.marriageLikeDate.from=1830&q.marriageLikeDate.to=1850&q.marriageLikeDate.require=on&count=3` },
  ];
  for (const p of dProbes) {
    const r = await fetchJson(token, `${URL_BASE}?${p.q}`);
    reportRow(p.label, p.q, r.status, r.data);
  }

  // ── REVIEWER's THREE EXACT URLS — sanity check ──
  head("E.  Reviewer's three exact URLs (UI-style, with isPrincipal etc.)");
  console.log("These are from the reviewer's comment. Confirm what each returns.\n");
  const rProbes = [
    { label: "URL 1 (basic)",
      q: `f.collectionId=${ALABAMA_MARRIAGES}&q.birthLikeDate.from=1830&q.birthLikeDate.to=1850&q.birthLikePlace=Alabama&q.givenName=John&q.surname=Smith&count=5` },
    { label: "URL 2 (+ isPrincipal=true)",
      q: `count=5&q.birthLikeDate.from=1830&q.birthLikeDate.to=1850&q.birthLikePlace=Alabama&q.givenName=John&q.isPrincipal=true&q.surname=Smith&f.collectionId=${ALABAMA_MARRIAGES}` },
    { label: "URL 3 (recordType + country/subcountry, no collectionId)",
      q: `count=5&f.recordType=1&q.birthLikeDate.from=1830&q.birthLikeDate.to=1850&q.birthLikePlace=Alabama&q.givenName=John&q.isPrincipal=true&q.recordCountry=United%20States&q.recordSubcountry=United%20States%2CAlabama&q.surname=Smith` },
  ];
  for (const p of rProbes) {
    const r = await fetchJson(token, `${URL_BASE}?${p.q}`);
    reportRow(p.label, p.q, r.status, r.data);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

/**
 * Reviewer comments #6, #7, #10 — three small investigations.
 *
 *   6. m.queryRequireDefault=on — global modifier sent by the FS UI.
 *      Today's marriage-scoping probe confirmed it upgrades
 *      q.isPrincipal and q.recordSubcountry. Open questions:
 *        - Does it upgrade EVERY q.* hint, or only some?
 *        - Does it interfere with f.* filters?
 *        - Does it cause the silent-fallback behavior to change
 *          (e.g., q.birthLikeDate=1300 currently silent-fallbacks;
 *          would it return zero under queryRequireDefault?)
 *        - Does it interact with cardinality (.1) — does
 *          q.givenName.1 finally pair with q.surname.1?
 *
 *   7. m.defaultFacets=off — disable facet aggregation, may speed
 *      up the response and shrink the payload. We never use facets,
 *      so probably worth turning off if it helps.
 *
 *   10. personId source — entry.id vs persons[].identifiers
 *       ["http://gedcomx.org/Persistent"][0] suffix. Are they
 *       always equal? Could they diverge in multi-principal records?
 */
import { getValidToken } from "../src/auth/refresh.js";

const URL_BASE = "https://www.familysearch.org/service/search/hr/v2/personas";
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

interface Person {
  principal?: boolean;
  display?: { name?: string };
  identifiers?: Record<string, string[] | undefined>;
}
interface Entry {
  id?: string;
  content?: { gedcomx?: { persons?: Person[] } };
}

async function fetchJsonTimed(token: string, url: string) {
  const t0 = Date.now();
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Accept-Language": "en",
      "User-Agent": BROWSER_UA,
    },
  });
  const body = await res.text();
  const elapsed = Date.now() - t0;
  let data: unknown = null;
  try { data = body ? JSON.parse(body) : null; } catch { /* */ }
  return { status: res.status, body, data, ms: elapsed, bytes: body.length };
}

function head(label: string) {
  console.log("\n" + "=".repeat(80));
  console.log(label);
  console.log("=".repeat(80));
}

function reportRow(label: string, q: string, status: number, data: unknown, extra = "") {
  if (status !== 200) {
    const detail = (data && typeof data === "object")
      ? JSON.stringify(data).slice(0, 220).replace(/\s+/g, " ")
      : `(status ${status})`;
    console.log(`  ${label}  HTTP ${status}  detail=${detail}`);
    return null;
  }
  const d = data as { results?: number; entries?: Entry[] };
  const top3 = (d.entries ?? []).slice(0, 3).map((e) => e.id).join(",");
  console.log(`  ${label.padEnd(60)} results=${String(d.results).padStart(10)}  top3=${top3}  ${extra}`);
  return d;
}

async function main() {
  const token = await getValidToken();
  console.log(`Got token (${token.length} chars)`);

  // ── 6.A: Does queryRequireDefault upgrade EVERY q.* hint? ──
  head("6.A  m.queryRequireDefault=on — does it upgrade every q.* hint?");
  console.log("Test: q.surname=Lincoln + q.givenName=Abraham. Without queryRequireDefault,");
  console.log("givenName is RERANKS-ONLY (same 569k as surname alone). With it, should narrow.\n");
  const sixAProbes = [
    { label: "baseline q.surname=Lincoln",
      q: "q.surname=Lincoln&count=3" },
    { label: "+ q.givenName=Abraham (rerank-only normally)",
      q: "q.surname=Lincoln&q.givenName=Abraham&count=3" },
    { label: "+ q.givenName=Abraham + m.queryRequireDefault=on",
      q: "q.surname=Lincoln&q.givenName=Abraham&m.queryRequireDefault=on&count=3" },
    { label: "+ all hints + m.queryRequireDefault=on (heavy query)",
      q: "q.surname=Lincoln&q.givenName=Abraham&q.birthLikeDate=1809&q.birthLikePlace=Kentucky&q.deathLikeDate=1865&m.queryRequireDefault=on&count=3" },
  ];
  for (const p of sixAProbes) {
    const r = await fetchJsonTimed(token, `${URL_BASE}?${p.q}`);
    reportRow(p.label, p.q, r.status, r.data);
  }

  // ── 6.B: Does queryRequireDefault interact with cardinality? ──
  head("6.B  m.queryRequireDefault=on + cardinality alt names");
  console.log("Reviewer comment 9: q.givenName.1 doesn't pair with q.surname.1 normally.");
  console.log("Does m.queryRequireDefault=on fix the pairing?\n");
  const sixBProbes = [
    { label: "alt-name probe 5 (paired Mary+Todd, no flag)",
      q: "q.surname=Lincoln&q.givenName=Mary&q.surname.1=Todd&q.givenName.1=Mary&count=3" },
    { label: "alt-name probe 5 + m.queryRequireDefault=on",
      q: "q.surname=Lincoln&q.givenName=Mary&q.surname.1=Todd&q.givenName.1=Mary&m.queryRequireDefault=on&count=3" },
    { label: "alt-name probe 7 (alt Sarah, no flag)",
      q: "q.surname=Lincoln&q.givenName=Mary&q.surname.1=Todd&q.givenName.1=Sarah&count=3" },
    { label: "alt-name probe 7 + m.queryRequireDefault=on",
      q: "q.surname=Lincoln&q.givenName=Mary&q.surname.1=Todd&q.givenName.1=Sarah&m.queryRequireDefault=on&count=3" },
  ];
  for (const p of sixBProbes) {
    const r = await fetchJsonTimed(token, `${URL_BASE}?${p.q}`);
    reportRow(p.label, p.q, r.status, r.data);
  }

  // ── 6.C: Silent-fallback behavior under queryRequireDefault ──
  head("6.C  m.queryRequireDefault=on + dates that would silently no-op");
  console.log("q.birthLikeDate=1300 normally silent-fallbacks (returns baseline ranking).");
  console.log("Under queryRequireDefault, does it narrow to zero (filter behavior)?\n");
  const sixCProbes = [
    { label: "q.surname=Lincoln + q.birthLikeDate=1300 (no flag)",
      q: "q.surname=Lincoln&q.birthLikeDate=1300&count=3" },
    { label: "q.surname=Lincoln + q.birthLikeDate=1300 + m.queryRequireDefault=on",
      q: "q.surname=Lincoln&q.birthLikeDate=1300&m.queryRequireDefault=on&count=3" },
    { label: "q.surname=Lincoln + q.birthLikeDate.from=2200&.to=2300 + flag",
      q: "q.surname=Lincoln&q.birthLikeDate.from=2200&q.birthLikeDate.to=2300&m.queryRequireDefault=on&count=3" },
  ];
  for (const p of sixCProbes) {
    const r = await fetchJsonTimed(token, `${URL_BASE}?${p.q}`);
    reportRow(p.label, p.q, r.status, r.data);
  }

  // ── 6.D: Does queryRequireDefault interact cleanly with selective .require=off? ──
  head("6.D  m.queryRequireDefault=on + .require=off opt-out");
  console.log("If queryRequireDefault makes ALL hints required, can we opt out a specific");
  console.log("field with .require=off (so name is required but birth date stays as a hint)?\n");
  const sixDProbes = [
    { label: "+ q.givenName.require=off (still rerank-only)",
      q: "q.surname=Lincoln&q.givenName=Abraham&q.givenName.require=off&m.queryRequireDefault=on&count=3" },
    { label: "+ q.birthLikeDate.require=off",
      q: "q.surname=Lincoln&q.givenName=Abraham&q.birthLikeDate=1809&q.birthLikeDate.require=off&m.queryRequireDefault=on&count=3" },
    { label: "(control) all required (no .require=off)",
      q: "q.surname=Lincoln&q.givenName=Abraham&q.birthLikeDate=1809&m.queryRequireDefault=on&count=3" },
  ];
  for (const p of sixDProbes) {
    const r = await fetchJsonTimed(token, `${URL_BASE}?${p.q}`);
    reportRow(p.label, p.q, r.status, r.data);
  }

  // ── 7: m.defaultFacets=off — payload + timing ──
  head("7.  m.defaultFacets=off — does it shrink payload / speed up response?");
  console.log("Time + size each request; compare with vs without defaultFacets=off.\n");
  const sevenProbes = [
    { label: "baseline (facets default)",
      q: "q.surname=Lincoln&q.givenName=Abraham&count=20" },
    { label: "+ m.defaultFacets=off",
      q: "q.surname=Lincoln&q.givenName=Abraham&m.defaultFacets=off&count=20" },
    { label: "baseline #2 (broader, facets ON)",
      q: "q.surname=Smith&count=20" },
    { label: "+ m.defaultFacets=off (broader)",
      q: "q.surname=Smith&m.defaultFacets=off&count=20" },
  ];
  for (const p of sevenProbes) {
    const r = await fetchJsonTimed(token, `${URL_BASE}?${p.q}`);
    const extra = `[${r.ms}ms, ${(r.bytes / 1024).toFixed(1)}KB]`;
    reportRow(p.label, p.q, r.status, r.data, extra);
  }

  // ── 7.B: Inspect what facet data looks like ──
  console.log("\n--- Inspect what facet data is in the default response ---");
  const inspect = await fetchJsonTimed(token, `${URL_BASE}?q.surname=Lincoln&count=3`);
  if (inspect.status === 200 && inspect.data && typeof inspect.data === "object") {
    const d = inspect.data as Record<string, unknown>;
    const topKeys = Object.keys(d);
    console.log(`Top-level keys: ${topKeys.join(", ")}`);
    for (const k of ["facets", "facet", "facetGroups", "aggregations"]) {
      if (k in d) {
        const v = d[k];
        const sample = Array.isArray(v)
          ? `array length ${v.length}`
          : typeof v === "object"
            ? `object keys: ${Object.keys(v ?? {}).slice(0, 6).join(", ")}`
            : `(${typeof v})`;
        console.log(`  ${k}: ${sample}`);
      }
    }
  }

  // ── 10: personId source — entry.id vs persistent identifier ──
  head("10.  personId source — does entry.id ever differ from persons[].identifiers persistent suffix?");
  console.log("Inspect entries from queries that produce multi-principal records (households).\n");
  const tenProbes = [
    { label: "single-principal: Lincoln Abraham",
      q: "q.surname=Lincoln&q.givenName=Abraham&count=10" },
    { label: "multi-principal: parent-anchored",
      q: "q.parentSurname=Lincoln&q.parentGivenName=Thomas&count=10" },
    { label: "multi-principal: birth anchor (households)",
      q: "q.surname=Lincoln&q.givenName=Abraham&q.birthLikeDate=1809&q.birthLikePlace=Kentucky&count=10" },
  ];
  let divergenceCount = 0;
  let totalEntries = 0;
  for (const p of tenProbes) {
    console.log(`\n[${p.label}]`);
    const r = await fetchJsonTimed(token, `${URL_BASE}?${p.q}`);
    if (r.status !== 200) { console.log(`  HTTP ${r.status}`); continue; }
    const entries = (r.data as { entries?: Entry[] }).entries ?? [];
    for (const e of entries) {
      totalEntries++;
      const persons = e.content?.gedcomx?.persons ?? [];
      const principal = persons.find((p) => p.principal === true) ?? persons[0];
      const arkUrl = principal?.identifiers?.["http://gedcomx.org/Persistent"]?.[0];
      const arkSuffix = arkUrl?.split("/").pop();
      const match = arkSuffix === e.id;
      if (!match) divergenceCount++;
      console.log(`  ${e.id?.padEnd(12)} principals=${persons.filter((x) => x.principal).length}  ark-suffix=${arkSuffix?.padEnd(12)} match=${match}`);
    }
  }
  console.log(`\nTotal entries inspected: ${totalEntries}, divergences: ${divergenceCount}`);
}

main().catch((e) => { console.error(e); process.exit(1); });

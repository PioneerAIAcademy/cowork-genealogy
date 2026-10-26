/**
 * Probe: which upstream recordType values hold each plan-item record type, and
 * whether f.recordType takes several values. Evidence for record_search's
 * plan-type aliases (issue #3547).
 *
 * Requires a live FamilySearch session (run `make e2e-login` first).
 *
 * Usage: npx tsx dev/probe-record-type-aliases.ts
 */
import { LOCAL } from "../src/auth/principal.js";
import { getValidToken } from "../src/auth/refresh.js";
import { fsFetch } from "../src/utils/fs-fetch.js";
import { BROWSER_USER_AGENT } from "../src/constants.js";
import { fetchAllCollections } from "../src/tools/collections-search.js";

const BASE = "https://www.familysearch.org/service/search/hr/v2/personas";
const TYPE_NAMES: Record<string, string> = {
  "0": "birth", "1": "marriage", "2": "death", "3": "census",
  "4": "immigration", "5": "military", "6": "probate", "7": "other",
};
const PATTERNS: Record<string, RegExp> = {
  land: /\bland\b|deed|homestead|tract book|plat|patent/i,
  court: /court(?!.*naturali)/i,
  tax: /\btax|assessment|tithe/i,
  vital_record: /vital record/i,
  church: /church|parish/i,
  cemetery: /cemeter|grave|burial|interment|tombstone|headstone/i,
};
const SAMPLE = 80;

async function search(params: string): Promise<{ status: number; body: any }> {
  const r = await fsFetch(LOCAL, `${BASE}?${params}`, {
    headers: { Accept: "application/json", "Accept-Language": "en", "User-Agent": BROWSER_USER_AGENT },
  });
  const text = await r.text();
  try {
    return { status: r.status, body: JSON.parse(text) };
  } catch {
    return { status: r.status, body: null };
  }
}

/** Per-recordType record counts for one query, from the recordType facet. */
async function typeCounts(params: string): Promise<{ total: number; counts: Record<string, number> } | null> {
  const { status, body } = await search(`${params}&count=0&c.recordType=on`);
  if (status !== 200 || !body?.results) return null;
  const facet = (body.facets ?? []).find((f: any) => f.displayName === "recordType");
  const counts: Record<string, number> = {};
  for (const f of facet?.facets ?? []) counts[TYPE_NAMES[f.displayName] ?? f.displayName] = f.count;
  return { total: body.results, counts };
}

let seed = 42;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

const token = await getValidToken(LOCAL);
const catalog = await fetchAllCollections(token, LOCAL);
const collections: { id: string; title: string; region?: string }[] = [];
for (const e of catalog.entries ?? []) {
  for (const c of e.content?.gedcomx?.collections ?? []) {
    collections.push({ id: c.id, title: c.title, region: c.searchMetadata?.[0]?.region });
  }
}

// Section 1: the recordType mix inside each plan type's collections. A
// collection is anchored by its country (the whole collection), falling back to
// surname s*; one that returns nothing either way is image-only and skipped.
for (const [planType, pattern] of Object.entries(PATTERNS)) {
  let matched = collections.filter((c) => pattern.test(c.title));
  if (matched.length > SAMPLE) {
    matched = matched.map((c) => ({ c, k: rnd() })).sort((a, b) => a.k - b.k).slice(0, SAMPLE).map((x) => x.c);
  }
  const records: Record<string, number> = {};
  const dominant: Record<string, number> = {};
  let indexed = 0;
  for (const c of matched) {
    const country = c.region === "UNITED_STATES" ? "United States" : c.title.split(",")[0].trim();
    const r =
      (await typeCounts(`q.recordCountry=${encodeURIComponent(country)}&f.collectionId=${c.id}`)) ??
      (await typeCounts(`q.surname=s*&f.collectionId=${c.id}`));
    if (!r) continue;
    indexed++;
    for (const [t, n] of Object.entries(r.counts)) records[t] = (records[t] ?? 0) + n;
    const top = Object.entries(r.counts).sort((a, b) => b[1] - a[1])[0]?.[0];
    if (top) dominant[top] = (dominant[top] ?? 0) + 1;
  }
  const total = Object.values(records).reduce((a, b) => a + b, 0);
  const share = Object.entries(records)
    .sort((a, b) => b[1] - a[1])
    .map(([t, n]) => `${t} ${((100 * n) / total).toFixed(1)}%`)
    .join(", ");
  console.log(`${planType}: ${matched.length} collections, ${indexed} indexed, ${total} records`);
  console.log(`  records by type: ${share}`);
  console.log(`  collections by dominant type: ${JSON.stringify(dominant)}`);
}

// Section 2: does f.recordType take several values? Repeated parameters should
// return the sum of the single-value totals; other spellings are refused.
const base = "q.surname=Smith&q.residencePlace=Massachusetts";
for (const filter of [
  "f.recordType=0",
  "f.recordType=1",
  "f.recordType=2",
  "f.recordType=0&f.recordType=1",
  "f.recordType=0&f.recordType=1&f.recordType=2",
  "f.recordType=0,1",
  "f.recordType=0%20OR%201",
  "f.recordType=0%7C1",
]) {
  const { status, body } = await search(`${base}&${filter}&count=0`);
  console.log(`${filter}\t${status}\t${body?.results ?? "-"}`);
}

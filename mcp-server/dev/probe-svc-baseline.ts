/**
 * Probe 1 of 5 — search service baseline response shape.
 *
 * Endpoint: https://www.familysearch.org/service/search/hr/v2/personas
 *
 * Goal: capture the on-the-wire JSON shape so we can rewrite types and
 * mapping logic against actual data. We need to know:
 *   - What top-level keys exist (results, index, entries, links.next, others?)
 *   - JSON type of `confidence` (docs say string, platform returned number)
 *   - JSON type of `score`
 *   - Format of entry.id
 *   - Whether entry.title / entry.links / entry.matchInfo exist
 *   - Shape of content.gedcomx (persons[], sourceDescriptions[], ...)
 *   - For persons[]: principal flag, gender.type shape, facts shape,
 *     identifiers including ark URL
 *   - For sourceDescriptions[]: where to find a usable record title
 *     and source-collection identifier
 *   - Pagination signals: links.next, index echoing offset, total count
 */
import { getValidToken } from "../src/auth/refresh.js";

const URL_BASE = "https://www.familysearch.org/service/search/hr/v2/personas";
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

function summarizeKeys(obj: unknown, prefix = "", depth = 0, maxDepth = 4): void {
  if (depth > maxDepth) return;
  if (Array.isArray(obj)) {
    console.log(`${prefix}[]  (length=${obj.length})`);
    if (obj.length > 0) {
      console.log(`${prefix}[0]:`);
      summarizeKeys(obj[0], `${prefix}  `, depth + 1, maxDepth);
    }
    return;
  }
  if (obj === null || typeof obj !== "object") {
    const sample = JSON.stringify(obj);
    const preview = sample && sample.length > 80 ? `${sample.slice(0, 77)}...` : sample;
    console.log(`${prefix}<${typeof obj}> = ${preview}`);
    return;
  }
  const o = obj as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    const v = o[k];
    const t = Array.isArray(v) ? `[]:${v.length}` : v === null ? "null" : typeof v;
    const inline = ["string", "number", "boolean"].includes(typeof v)
      ? ` = ${JSON.stringify(v).slice(0, 80)}`
      : "";
    console.log(`${prefix}${k}  <${t}>${inline}`);
    if (v && typeof v === "object" && depth < maxDepth) {
      summarizeKeys(v, `${prefix}  `, depth + 1, maxDepth);
    }
  }
}

async function main() {
  const token = await getValidToken();
  const url = `${URL_BASE}?q.surname=Lincoln&q.givenName=Abraham&count=3`;
  console.log(`URL: ${url}\n`);

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "User-Agent": BROWSER_UA,
    },
  });

  console.log(`HTTP ${res.status} ${res.statusText}`);
  console.log(`Content-Type: ${res.headers.get("content-type")}`);
  console.log(`Content-Length header: ${res.headers.get("content-length") ?? "(chunked)"}`);
  console.log("");

  if (!res.ok) {
    const body = await res.text();
    console.log(`Body (first 600c): ${body.slice(0, 600)}`);
    return;
  }

  const data = (await res.json()) as Record<string, unknown>;

  console.log("=== TOP-LEVEL ENVELOPE ===");
  for (const k of Object.keys(data)) {
    const v = (data as Record<string, unknown>)[k];
    const t = Array.isArray(v) ? `[]:${v.length}` : v === null ? "null" : typeof v;
    const inline = ["string", "number", "boolean"].includes(typeof v) ? ` = ${JSON.stringify(v)}` : "";
    console.log(`  ${k}  <${t}>${inline}`);
  }

  const entries = (data.entries ?? []) as Array<Record<string, unknown>>;
  console.log(`\n=== entries.length = ${entries.length} ===`);
  if (entries.length === 0) {
    console.log("(no entries to inspect)");
    return;
  }

  // Inspect entry[0] in depth.
  const e = entries[0];
  console.log("\n=== entries[0] FULL KEY TREE (depth=4) ===");
  summarizeKeys(e, "  ", 0, 4);

  // Highlight specific fields the spec depends on.
  console.log("\n=== entries[0] CRITICAL FIELDS ===");
  console.log(`  id: ${JSON.stringify(e.id)}  (typeof ${typeof e.id})`);
  console.log(`  score: ${JSON.stringify(e.score)}  (typeof ${typeof e.score})`);
  console.log(`  confidence: ${JSON.stringify(e.confidence)}  (typeof ${typeof e.confidence})`);
  console.log(`  title: ${JSON.stringify(e.title)?.slice(0, 120) ?? "(none)"}`);
  console.log(`  links: ${e.links ? JSON.stringify(e.links).slice(0, 300) : "(none)"}`);
  console.log(`  matchInfo: ${e.matchInfo ? JSON.stringify(e.matchInfo).slice(0, 300) : "(none)"}`);

  type Gx = {
    persons?: Array<{
      id?: string;
      principal?: boolean;
      gender?: { type?: string };
      names?: Array<{ nameForms?: Array<{ fullText?: string }> }>;
      facts?: Array<{ type?: string; date?: { original?: string; formal?: string }; place?: { original?: string }; value?: string }>;
      identifiers?: Record<string, string[] | undefined>;
    }>;
    sourceDescriptions?: Array<{
      id?: string;
      titles?: Array<{ value?: string }>;
      identifiers?: Record<string, string[] | undefined>;
      about?: string;
      [k: string]: unknown;
    }>;
  };

  const gx = (e.content as { gedcomx?: Gx } | undefined)?.gedcomx;
  if (!gx) {
    console.log("\n(content.gedcomx not present)");
  } else {
    console.log("\n=== entries[0].content.gedcomx.persons ===");
    const persons = gx.persons ?? [];
    console.log(`  persons.length = ${persons.length}`);
    persons.forEach((p, i) => {
      console.log(`  persons[${i}]:`);
      console.log(`    id: ${p.id}, principal: ${p.principal}`);
      console.log(`    name: ${p.names?.[0]?.nameForms?.[0]?.fullText}`);
      console.log(`    gender.type: ${p.gender?.type}`);
      console.log(`    facts.length: ${p.facts?.length ?? 0}`);
      if (p.facts?.[0]) {
        console.log(`    facts[0]: type=${p.facts[0].type}, date.original=${p.facts[0].date?.original}, place.original=${p.facts[0].place?.original}`);
      }
      console.log(`    identifiers keys: ${Object.keys(p.identifiers ?? {}).join(", ")}`);
      const ark = p.identifiers?.["http://gedcomx.org/Persistent"]?.[0];
      console.log(`    ark URL: ${ark ?? "(none)"}`);
    });

    console.log("\n=== entries[0].content.gedcomx.sourceDescriptions ===");
    const sds = gx.sourceDescriptions ?? [];
    console.log(`  sourceDescriptions.length = ${sds.length}`);
    sds.slice(0, 3).forEach((sd, i) => {
      console.log(`  sourceDescriptions[${i}]:`);
      console.log(`    id: ${sd.id}`);
      console.log(`    about: ${sd.about ?? "(none)"}`);
      console.log(`    titles[0].value: ${sd.titles?.[0]?.value ?? "(none)"}`);
      console.log(`    identifiers keys: ${Object.keys(sd.identifiers ?? {}).join(", ")}`);
      for (const k of Object.keys(sd.identifiers ?? {})) {
        const v = sd.identifiers?.[k];
        console.log(`      ${k}: ${JSON.stringify(v)?.slice(0, 200)}`);
      }
    });
  }

  // Pagination signals.
  console.log("\n=== PAGINATION SIGNALS ===");
  console.log(`  results: ${data.results}`);
  console.log(`  index: ${data.index}`);
  const links = data.links as Record<string, unknown> | undefined;
  console.log(`  links present: ${links ? "yes" : "no"}`);
  if (links) {
    console.log(`  links keys: ${Object.keys(links).join(", ")}`);
    if ("next" in links) console.log(`  links.next: ${JSON.stringify(links.next)}`);
    if ("self" in links) console.log(`  links.self: ${JSON.stringify(links.self)}`);
  }

  // Quick scan: do all 3 entries have the same structural keys?
  console.log("\n=== STRUCTURAL CONSISTENCY ACROSS entries[] ===");
  for (let i = 0; i < entries.length; i++) {
    const ki = Object.keys(entries[i]).sort().join(",");
    console.log(`  entries[${i}] keys: ${ki}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

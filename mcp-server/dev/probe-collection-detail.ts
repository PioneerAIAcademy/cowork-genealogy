/**
 * Probe — evidence trail behind docs/specs/collection-detail-tool-spec.md.
 *
 * Documents the full investigation behind `collections({ id })` detail mode.
 *
 *   SECTION A — Endpoint survey. Tries 4 candidate endpoints against a
 *   real collection ID, prints HTTP status + top-level keys for each.
 *
 *   SECTION B — Deep dump of the chosen endpoint with the embed flag.
 *   Recursively prints the structure of each top-level field
 *   (sourceDescriptions, documents, collections) plus the raw body.
 *
 * RESULTS (recorded here so a future reader doesn't need to re-run):
 *
 *   1. /platform/records/collections/{id}        → 200. Returns
 *      `recordDescriptors[]` (structured field schema) but NOT the
 *      wiki "about" page. Initially chosen; then rejected by
 *      stakeholders in favor of #2 — wiki content was preferred over
 *      the field schema.
 *
 *   2. /service/search/hr/v2/collections/{id}?embedWikiAboutCollection=true
 *      ✓ CHOSEN. Top-level keys: sourceDescriptions, documents,
 *      collections, description, id, links. The MCP tool returns this
 *      response shape verbatim, with two HTML-bearing strings converted
 *      to markdown:
 *        - sourceDescriptions[*].citations[*].value  (was <i>X</i>, now *X*)
 *        - documents[*].text                          (textType flipped
 *          from "html" to "markdown")
 *      Otherwise unchanged — no field selection, no flattening, no
 *      pre-parsing of GEDCOMX timestamps. Per stakeholder direction
 *      (Dallan, meeting on 2026-05-12).
 *
 *   3. /service/search/hr/v2/collections?id={id}   → same shape as the
 *      list endpoint, filtered to one entry. Duplicates cached data.
 *
 *   4. /platform/sources/descriptions/{id}         → 400 Bad Request.
 *      Collection IDs don't address this resource family. Dead end.
 *
 * Temporal.formal formats observed across endpoints:
 *   - `+1809/+1950` — slash separator (platform/records, legacy)
 *   - `+1711-1992` — hyphen separator (service/search/hr/v2)
 *   - `+1860`      — single year (service/search/hr/v2)
 * The current parser handles all three.
 *
 * Usage:
 *   npx tsx dev/probe-collection-detail.ts                # uses default 1473181
 *   npx tsx dev/probe-collection-detail.ts 1743384        # Alabama Marriages
 */
import { getValidToken } from "../src/auth/refresh.js";
import { fetchAllCollections } from "../src/tools/place-collections.js";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

const DEFAULT_ID = "1473181";
const CHOSEN_URL_BASE =
  "https://www.familysearch.org/service/search/hr/v2/collections";
const CHOSEN_URL_QUERY = "?embedWikiAboutCollection=true";

interface Probe {
  label: string;
  url: string;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function topKeys(obj: unknown): string[] {
  if (!isPlainObject(obj)) return [];
  return Object.keys(obj);
}

/**
 * Recursive structural dump (depth-limited). Arrays show length + first
 * element shape; objects show their keys; primitives print inline.
 */
function dump(label: string, value: unknown, depth = 0, maxDepth = 5): void {
  const pad = "  ".repeat(depth);

  if (value === null) {
    console.log(`${pad}${label}: null`);
    return;
  }
  if (Array.isArray(value)) {
    console.log(`${pad}${label}: [] length=${value.length}`);
    if (value.length > 0 && depth < maxDepth) {
      dump("[0]", value[0], depth + 1, maxDepth);
    }
    if (value.length > 1 && depth < maxDepth) {
      const first = value[0];
      const sameShape =
        isPlainObject(first) &&
        value.every(
          (v) =>
            isPlainObject(v) &&
            JSON.stringify(Object.keys(v).sort()) ===
              JSON.stringify(Object.keys(first).sort())
        );
      console.log(
        `${pad}  (all ${value.length} elements share same key set: ${sameShape ? "yes" : "no"})`
      );
    }
    return;
  }
  if (!isPlainObject(value)) {
    const s = JSON.stringify(value);
    const preview = s.length > 200 ? `${s.slice(0, 197)}...` : s;
    console.log(`${pad}${label}: <${typeof value}> ${preview}`);
    return;
  }

  console.log(`${pad}${label}: { keys: [${Object.keys(value).join(", ")}] }`);
  if (depth >= maxDepth) return;
  for (const k of Object.keys(value)) {
    dump(k, value[k], depth + 1, maxDepth);
  }
}

/**
 * Quick endpoint hit — prints HTTP status, content-type, top-level keys.
 * Used in SECTION A. Body errors print first 400 chars for debugging.
 */
async function quickHit(token: string, probe: Probe): Promise<void> {
  console.log(`\n--- [${probe.label}] ---`);
  console.log(`URL: ${probe.url}`);

  let res: Response;
  try {
    res = await fetch(probe.url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "User-Agent": BROWSER_UA,
      },
    });
  } catch (err) {
    console.log(`FETCH ERROR: ${(err as Error).message}`);
    return;
  }

  console.log(`HTTP ${res.status} ${res.statusText}`);
  console.log(`Content-Type: ${res.headers.get("content-type") ?? "(none)"}`);

  const bodyText = await res.text();
  if (!res.ok) {
    console.log(`Body (first 400c): ${bodyText.slice(0, 400)}`);
    return;
  }

  let data: unknown;
  try {
    data = JSON.parse(bodyText);
  } catch {
    console.log(`Non-JSON body (first 400c): ${bodyText.slice(0, 400)}`);
    return;
  }

  console.log(`Top-level keys: [${topKeys(data).join(", ")}]`);
}

async function main(): Promise<void> {
  const id = process.argv[2] ?? DEFAULT_ID;
  console.log(`Probing collection detail for ID: ${id}\n`);

  const token = await getValidToken();

  // ----------------------------------------------------------------
  // Section 0: what does the cached list endpoint already give us?
  // ----------------------------------------------------------------
  console.log("================================================================");
  console.log("SECTION 0 — Already-cached record for this ID (list endpoint)");
  console.log("================================================================");
  const list = await fetchAllCollections(token);
  const match = (list.entries ?? [])
    .map((e) => e.content?.gedcomx?.collections?.[0])
    .filter((c): c is NonNullable<typeof c> => c?.id === id);
  if (match.length === 0) {
    console.log(`(no entry in list response with id=${id})`);
  } else {
    console.log("Full record from list response:");
    console.log(JSON.stringify(match[0], null, 2));
  }

  // ----------------------------------------------------------------
  // SECTION A — Endpoint survey
  // ----------------------------------------------------------------
  console.log("\n================================================================");
  console.log("SECTION A — Endpoint survey");
  console.log("================================================================");

  const probes: Probe[] = [
    {
      label: "1. /platform/records/collections/{id}  (legacy — has recordDescriptors, no wiki)",
      url: `https://www.familysearch.org/platform/records/collections/${id}`,
    },
    {
      label: "2. /service/search/hr/v2/collections/{id}?embedWikiAboutCollection=true  (CHOSEN)",
      url: `${CHOSEN_URL_BASE}/${id}${CHOSEN_URL_QUERY}`,
    },
    {
      label: "3. /service/search/hr/v2/collections?id={id}  (filtered list, dupes cached data)",
      url: `${CHOSEN_URL_BASE}?id=${id}&count=1`,
    },
    {
      label: "4. /platform/sources/descriptions/{id}  (wrong resource family — 400)",
      url: `https://www.familysearch.org/platform/sources/descriptions/${id}`,
    },
  ];

  for (const p of probes) {
    await quickHit(token, p);
  }

  // ----------------------------------------------------------------
  // SECTION B — Deep dump of the chosen endpoint
  // ----------------------------------------------------------------
  console.log("\n================================================================");
  console.log("SECTION B — Deep dump of the chosen endpoint (with embed flag)");
  console.log("================================================================");

  const chosenUrl = `${CHOSEN_URL_BASE}/${id}${CHOSEN_URL_QUERY}`;
  const res = await fetch(chosenUrl, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "User-Agent": BROWSER_UA,
    },
  });

  if (!res.ok) {
    console.log(`HTTP ${res.status} ${res.statusText}`);
    console.log(`Body (first 600c): ${(await res.text()).slice(0, 600)}`);
    return;
  }

  const data = (await res.json()) as Record<string, unknown>;

  console.log(`\nTop-level keys: [${Object.keys(data).join(", ")}]\n`);

  for (const key of Object.keys(data)) {
    console.log(`---- ${key} ----`);
    dump(key, data[key]);
    console.log("");
  }

  console.log("---- RAW BODY (first 4000 chars) ----");
  console.log(JSON.stringify(data, null, 2).slice(0, 4000));

  console.log("\n================================================================");
  console.log("DONE");
  console.log("================================================================");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

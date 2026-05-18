/**
 * Probe 6 — Catalog item detail for non-Book formats.
 *
 * Probe 2 dumped the detail shape for a Book (koha:1837843).
 * Microfilm / DGS items, manuscripts, and serials may carry
 * different fields (image_count, dgs_id, film_number on the item,
 * holding-library variations).
 *
 * Items to probe:
 *
 *   - koha:191073 — Brazilian parish registers (q.film_number=004001998
 *     returned exactly this). Should be Microfilm format.
 *
 *   - koha:810076 — "v. 7 (1916)" — the mystery default-top-hit from
 *     probe 4. Hopefully a serial / periodical issue.
 *
 *   - koha:47672 — "Alabama Genealogical Society magazine" (top
 *     hit on q.keywords=Alabama). Serial.
 *
 *   - koha:4119778 — "The adoptee's Guide to DNA testing" (top hit
 *     on q.subject=DNA). Book — for comparison sanity.
 *
 *   npx tsx dev/probe-catalog-microfilm.ts
 */

import { getValidToken } from "../src/auth/refresh.js";
import { BROWSER_USER_AGENT } from "../src/constants.js";

const IDS = [
  { id: "koha:191073", expect: "Brazilian parish registers (microfilm?)" },
  { id: "koha:810076", expect: "v. 7 (1916) — mystery default top hit" },
  { id: "koha:47672", expect: "Alabama Genealogical Society magazine" },
  { id: "koha:4119778", expect: "The adoptee's Guide to DNA testing (book)" },
];

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

async function fetchDetail(token: string, id: string): Promise<Record<string, unknown> | null> {
  const url = `https://www.familysearch.org/service/search/catalog/item/${encodeURIComponent(id)}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "User-Agent": BROWSER_USER_AGENT,
    },
  });
  if (!res.ok) {
    console.log(`  HTTP ${res.status} ${res.statusText}`);
    return null;
  }
  return (await res.json()) as Record<string, unknown>;
}

async function main(): Promise<void> {
  const token = await getValidToken();

  // Collect each detail body and dump field-set comparisons.
  const collected: Array<{ id: string; source: Record<string, unknown> | null }> = [];

  for (const { id, expect } of IDS) {
    console.log(`\n================================================================`);
    console.log(`${id}  (${expect})`);
    console.log(`================================================================`);

    const data = await fetchDetail(token, id);
    if (!data) {
      collected.push({ id, source: null });
      continue;
    }

    const source = isPlainObject(data.source) ? data.source : null;
    collected.push({ id, source });

    if (!source) {
      console.log(`(no source field)`);
      continue;
    }

    console.log(`Top-level source keys: [${Object.keys(source).join(", ")}]`);
    console.log(`\nFormat: ${JSON.stringify(source.format)}`);
    console.log(`Title: ${JSON.stringify(source.title)}`);
    console.log(`Display title: ${JSON.stringify(source.display_title)}`);
    console.log(`Inclusive dates: ${JSON.stringify(source.inclusive_dates)}`);
    console.log(`Available online: ${JSON.stringify(source.available_online)}`);

    // Print fields likely specific to microfilm / DGS
    for (const k of ["film_number", "dgs", "image_count", "image_count_total", "digital_id", "url", "physical", "copy", "publisher", "subject"]) {
      if (k in source) {
        console.log(`${k}: ${JSON.stringify(source[k], null, 2).slice(0, 600)}`);
      }
    }
  }

  // Field-set comparison: which fields appear in which records.
  console.log(`\n================================================================`);
  console.log(`FIELD-SET COMPARISON`);
  console.log(`================================================================`);
  const allFields = new Set<string>();
  for (const { source } of collected) {
    if (!source) continue;
    for (const k of Object.keys(source)) allFields.add(k);
  }
  const sortedFields = Array.from(allFields).sort();
  // print a matrix: rows = fields, columns = ids
  const header = ["FIELD".padEnd(28), ...collected.map((c) => c.id.padEnd(16))];
  console.log(header.join(" | "));
  console.log("-".repeat(header.join(" | ").length));
  for (const f of sortedFields) {
    const row = [
      f.padEnd(28),
      ...collected.map((c) => (c.source && f in c.source ? "yes" : "—").padEnd(16)),
    ];
    console.log(row.join(" | "));
  }

  console.log("\n================================================================");
  console.log("DONE");
  console.log("================================================================");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

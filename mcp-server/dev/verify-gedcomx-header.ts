/**
 * Compare responses from different Accept headers on the person endpoint.
 * Tests: application/x-fs-v1+json vs application/x-gedcomx-v1+json
 *
 * Usage: npx tsx dev/verify-gedcomx-header.ts
 */

import { getValidToken } from "../src/auth/refresh.js";

const BASE = "https://api.familysearch.org";
const PERSON_ID = "KNDX-MKG";

async function fetchWith(token: string, accept: string, params = "") {
  const url = `${BASE}/platform/tree/persons/${PERSON_ID}${params}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: accept,
    },
  });
  return res.json();
}

function summarize(label: string, data: any) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(label);
  console.log("=".repeat(60));

  // Top-level keys
  const keys = Object.keys(data);
  console.log(`\nTop-level keys: ${keys.join(", ")}`);

  // Persons
  if (data.persons) {
    console.log(`\npersons: ${data.persons.length}`);
    const p = data.persons[0];
    if (p) {
      console.log(`  First person keys: ${Object.keys(p).join(", ")}`);
      if (p.display) console.log(`  display keys: ${Object.keys(p.display).join(", ")}`);
      if (!p.display) console.log(`  display: NOT PRESENT`);
      if (p.names?.[0]?.nameForms?.[0]) {
        const nf = p.names[0].nameForms[0];
        console.log(`  nameForms[0] keys: ${Object.keys(nf).join(", ")}`);
        if (nf.fullText) console.log(`  fullText: ${nf.fullText}`);
        if (nf.parts) console.log(`  parts: ${JSON.stringify(nf.parts.map((p: any) => ({ type: p.type, value: p.value })))}`);
      }
      if (p.gender) console.log(`  gender: ${JSON.stringify(p.gender)}`);
      if (p.facts) {
        console.log(`  facts: ${p.facts.length}`);
        const f = p.facts[0];
        if (f) console.log(`  first fact keys: ${Object.keys(f).join(", ")}`);
        if (f) console.log(`  first fact type: ${f.type}`);
      }
      console.log(`  living: ${p.living}`);
    }
  }

  // Relationships
  if (data.relationships) {
    console.log(`\nrelationships: ${data.relationships.length}`);
    const r = data.relationships[0];
    if (r) console.log(`  first rel keys: ${Object.keys(r).join(", ")}`);
    if (r) console.log(`  first rel type: ${r.type}`);
  }

  // childAndParentsRelationships (FS-specific)
  if (data.childAndParentsRelationships) {
    console.log(`\nchildAndParentsRelationships: ${data.childAndParentsRelationships.length}`);
  } else {
    console.log(`\nchildAndParentsRelationships: NOT PRESENT`);
  }

  // sourceDescriptions
  if (data.sourceDescriptions) {
    const real = data.sourceDescriptions.filter((s: any) => !s.id?.startsWith("SD_"));
    const meta = data.sourceDescriptions.filter((s: any) => s.id?.startsWith("SD_"));
    console.log(`\nsourceDescriptions: ${data.sourceDescriptions.length} (${real.length} real, ${meta.length} metadata)`);
  }

  // Places
  if (data.places) {
    console.log(`places: ${data.places.length}`);
  }
}

async function main() {
  const token = await getValidToken();
  console.log("Token obtained\n");

  // Test 1: FS-extended format (what we've been using)
  const fsData = await fetchWith(token, "application/x-fs-v1+json");
  summarize("Accept: application/x-fs-v1+json (FS-extended)", fsData);

  // Test 2: Standard GEDCOMX format
  const gxData = await fetchWith(token, "application/x-gedcomx-v1+json");
  summarize("Accept: application/x-gedcomx-v1+json (standard GEDCOMX)", gxData);

  // Test 3: Standard GEDCOMX with relatives
  const gxRel = await fetchWith(token, "application/x-gedcomx-v1+json", "?relatives=true");
  summarize("Accept: application/x-gedcomx-v1+json + ?relatives=true", gxRel);

  // Test 4: Standard GEDCOMX with sourceDescriptions
  const gxSrc = await fetchWith(token, "application/x-gedcomx-v1+json", "?sourceDescriptions=true");
  summarize("Accept: application/x-gedcomx-v1+json + ?sourceDescriptions=true", gxSrc);

  // Test 5: Standard GEDCOMX with both
  const gxBoth = await fetchWith(token, "application/x-gedcomx-v1+json", "?relatives=true&sourceDescriptions=true");
  summarize("Accept: application/x-gedcomx-v1+json + both flags", gxBoth);

  // Key differences
  console.log(`\n${"=".repeat(60)}`);
  console.log("KEY DIFFERENCES");
  console.log("=".repeat(60));

  const fsKeys = new Set(Object.keys(fsData));
  const gxKeys = new Set(Object.keys(gxData));
  const onlyFS = [...fsKeys].filter(k => !gxKeys.has(k));
  const onlyGX = [...gxKeys].filter(k => !fsKeys.has(k));
  console.log(`\nTop-level keys only in FS format: ${onlyFS.join(", ") || "(none)"}`);
  console.log(`Top-level keys only in GEDCOMX format: ${onlyGX.join(", ") || "(none)"}`);

  if (fsData.persons?.[0] && gxData.persons?.[0]) {
    const fsPKeys = new Set(Object.keys(fsData.persons[0]));
    const gxPKeys = new Set(Object.keys(gxData.persons[0]));
    const onlyFSP = [...fsPKeys].filter(k => !gxPKeys.has(k));
    const onlyGXP = [...gxPKeys].filter(k => !fsPKeys.has(k));
    console.log(`\nPerson keys only in FS format: ${onlyFSP.join(", ") || "(none)"}`);
    console.log(`Person keys only in GEDCOMX format: ${onlyGXP.join(", ") || "(none)"}`);
  }

  // Check if GEDCOMX uses standard relationships instead of childAndParentsRelationships
  const gxRelBoth = await fetchWith(token, "application/x-gedcomx-v1+json", "?relatives=true");
  const hasCAP = !!gxRelBoth.childAndParentsRelationships;
  const hasRels = !!gxRelBoth.relationships;
  console.log(`\nWith ?relatives=true (GEDCOMX header):`);
  console.log(`  Has childAndParentsRelationships: ${hasCAP}`);
  console.log(`  Has relationships: ${hasRels}`);
  if (hasRels) {
    const types = [...new Set(gxRelBoth.relationships.map((r: any) => r.type))];
    console.log(`  Relationship types: ${types.join(", ")}`);
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

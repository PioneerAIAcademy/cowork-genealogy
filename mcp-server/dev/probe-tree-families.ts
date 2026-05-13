/**
 * Probe — tree families endpoint.
 *
 * Endpoint: GET https://api.familysearch.org/platform/tree/persons/{pid}/families
 *
 * Goal: capture the on-the-wire JSON shape of the /families response so
 * we can verify (and correct, if needed) the families section of
 * docs/specs/tree-tool-spec.md.
 *
 * The spec currently claims:
 *   - response.childAndParentsRelationships[] — family groups
 *   - response.persons[]                      — all referenced persons
 *   - each childAndParentsRelationship has parent1.resourceId,
 *     parent2.resourceId, child.resourceId
 *
 * Things to verify:
 *   1. Are those the actual top-level keys?
 *   2. Does each relationship really only carry resourceId, or is there
 *      also a name/display nested in it?
 *   3. Is there a separate `relationships[]` array for couple relationships
 *      (spouse links), or are spouses derived only from childAndParents?
 *   4. Where does the relationship-type label ("Step", "Guardianship",
 *      "Biological", "Adopted") live? The UI shows these but the spec
 *      doesn't model them.
 *   5. Does the response include display data (name, lifespan) on the
 *      persons[] array, or do we need an extra fetch per person?
 *   6. For someone with multiple spouses, are they returned as multiple
 *      couple relationships, or via multiple childAndParents groups?
 *
 * Test subjects:
 *   - KNDX-MKG (George Washington, per user) — has parents, no children
 *   - L6N4-4GW (the example used in the existing spec) — sanity-check
 *     that the spec's example ID still resolves the same way
 *   - A bogus-looking ID — confirm 404 shape
 */
/// <reference types="node" />
import { getValidToken } from "../src/auth/refresh.js";

const API_BASE = "https://api.familysearch.org/platform/tree";
const ACCEPT = "application/x-fs-v1+json";

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
    const preview = sample && sample.length > 120 ? `${sample.slice(0, 117)}...` : sample;
    console.log(`${prefix}<${typeof obj}> = ${preview}`);
    return;
  }
  const o = obj as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    const v = o[k];
    const t = Array.isArray(v) ? `[]:${v.length}` : v === null ? "null" : typeof v;
    const inline = ["string", "number", "boolean"].includes(typeof v)
      ? ` = ${JSON.stringify(v).slice(0, 100)}`
      : "";
    console.log(`${prefix}${k}  <${t}>${inline}`);
    if (v && typeof v === "object" && depth < maxDepth) {
      summarizeKeys(v, `${prefix}  `, depth + 1, maxDepth);
    }
  }
}

async function fetchFamilies(token: string, pid: string) {
  const url = `${API_BASE}/persons/${pid}/families`;
  console.log(`\n${"=".repeat(72)}`);
  console.log(`GET ${url}`);
  console.log("=".repeat(72));
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: ACCEPT,
    },
    redirect: "manual",
  });
  console.log(`HTTP ${res.status} ${res.statusText}`);
  console.log(`Content-Type: ${res.headers.get("content-type")}`);
  const loc = res.headers.get("location");
  if (loc) console.log(`Location: ${loc}`);

  const bodyText = await res.text();
  if (!bodyText || !bodyText.trim().startsWith("{")) {
    console.log(`\nBody (first 600c):\n${bodyText.slice(0, 600)}`);
    return null;
  }
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(bodyText) as Record<string, unknown>;
  } catch (e) {
    console.log(`(could not parse JSON: ${(e as Error).message})`);
    console.log(`Body (first 600c):\n${bodyText.slice(0, 600)}`);
    return null;
  }

  console.log(`\n=== TOP-LEVEL KEYS ===`);
  for (const k of Object.keys(data)) {
    const v = data[k];
    const t = Array.isArray(v) ? `[]:${v.length}` : v === null ? "null" : typeof v;
    console.log(`  ${k}  <${t}>`);
  }
  return data;
}

function inspectCAPR(data: Record<string, unknown>) {
  const caprs = data.childAndParentsRelationships as Array<Record<string, unknown>> | undefined;
  if (!caprs || caprs.length === 0) {
    console.log("\n(no childAndParentsRelationships present)");
    return;
  }
  console.log(`\n=== childAndParentsRelationships (${caprs.length}) ===`);
  caprs.forEach((capr, i) => {
    console.log(`\n  [${i}] keys: ${Object.keys(capr).join(", ")}`);
    console.log(`  [${i}] FULL TREE:`);
    summarizeKeys(capr, `    `, 0, 5);
  });
}

function inspectRelationships(data: Record<string, unknown>) {
  const rels = data.relationships as Array<Record<string, unknown>> | undefined;
  if (!rels || rels.length === 0) {
    console.log("\n(no relationships[] array — spouse/couple links not surfaced separately)");
    return;
  }
  console.log(`\n=== relationships[] (${rels.length}) — likely Couple/Spouse links ===`);
  rels.forEach((r, i) => {
    console.log(`\n  [${i}] keys: ${Object.keys(r).join(", ")}`);
    summarizeKeys(r, `    `, 0, 4);
  });
}

function inspectPersons(data: Record<string, unknown>) {
  const persons = data.persons as Array<Record<string, unknown>> | undefined;
  if (!persons || persons.length === 0) {
    console.log("\n(no persons[] in response — would need separate fetch per relative)");
    return;
  }
  console.log(`\n=== persons[] (${persons.length}) ===`);
  persons.forEach((p, i) => {
    const display = p.display as Record<string, unknown> | undefined;
    console.log(`\n  persons[${i}]: id=${p.id}`);
    if (display) {
      console.log(`    display.name: ${display.name}`);
      console.log(`    display.lifespan: ${display.lifespan}`);
      console.log(`    display.gender: ${display.gender}`);
      console.log(`    display.birthDate: ${display.birthDate ?? "(none)"}`);
      console.log(`    display.birthPlace: ${display.birthPlace ?? "(none)"}`);
      console.log(`    display.deathDate: ${display.deathDate ?? "(none)"}`);
      console.log(`    display.deathPlace: ${display.deathPlace ?? "(none)"}`);
      console.log(`    display keys: ${Object.keys(display).join(", ")}`);
    } else {
      console.log(`    (no display object)  keys=${Object.keys(p).join(", ")}`);
    }
  });
}

async function main() {
  const token = await getValidToken();
  console.log(`Token ok (len=${token.length})\n`);

  for (const pid of ["KNDX-MKG", "L6N4-4GW", "9999-XXX"]) {
    const data = await fetchFamilies(token, pid);
    if (!data) continue;
    inspectCAPR(data);
    inspectRelationships(data);
    inspectPersons(data);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

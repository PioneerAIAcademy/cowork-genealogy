/**
 * Probe — tree ancestry endpoint.
 *
 * Endpoint: GET https://api.familysearch.org/platform/tree/ancestry
 *          ?person={pid}&generations={n}&personDetails
 *
 * Goal: verify the `ancestry` action section of
 * docs/specs/tree-tool-spec.md against the live response.
 *
 * The spec claims:
 *   - Returns a `persons` array where each person has a
 *     `display.ascendancyNumber` (Ahnentafel: 1=self, 2=father,
 *     3=mother, 4=paternal grandfather, ...).
 *   - Max persons = 2^(generations+1) - 1; missing ancestors are
 *     simply absent.
 *   - generations param accepts 1..8.
 *   - The `personDetails` flag includes display properties and facts.
 *
 * Things to verify:
 *   1. Is `display.ascendancyNumber` a string or a number? (The spec
 *      types it as `number` in the output, but the person-detail
 *      response showed it as a string `"1"`.)
 *   2. Does the response include the focal person as ascendancyNumber=1?
 *   3. What happens with generations=0, 9, 100? Does the server clamp,
 *      error, or do something else?
 *   4. Without `personDetails`, what do we get back?
 *   5. Are the persons sorted in any particular order (Ahnentafel
 *      ascending, or insertion order)?
 *   6. What's the rest of the envelope (relationships,
 *      sourceDescriptions, etc.)?
 *
 * Test subjects:
 *   - KNDX-MKG (Washington) — deep, well-known ancestry
 *   - generations: 2 (small), 4 (default), 8 (max claimed), 9 (over-cap), 0 (under-cap)
 *   - With and without personDetails
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
    const preview = sample && sample.length > 140 ? `${sample.slice(0, 137)}...` : sample;
    console.log(`${prefix}<${typeof obj}> = ${preview}`);
    return;
  }
  const o = obj as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    const v = o[k];
    const t = Array.isArray(v) ? `[]:${v.length}` : v === null ? "null" : typeof v;
    const inline = ["string", "number", "boolean"].includes(typeof v)
      ? ` = ${JSON.stringify(v).slice(0, 120)}`
      : "";
    console.log(`${prefix}${k}  <${t}>${inline}`);
    if (v && typeof v === "object" && depth < maxDepth) {
      summarizeKeys(v, `${prefix}  `, depth + 1, maxDepth);
    }
  }
}

async function fetchAncestry(token: string, qs: string, label: string) {
  const url = `${API_BASE}/ancestry?${qs}`;
  console.log(`\n${"=".repeat(72)}`);
  console.log(`[${label}] GET ${url}`);
  console.log("=".repeat(72));
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: ACCEPT },
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
    console.log(`(parse error: ${(e as Error).message})`);
    return null;
  }
  console.log(`\n--- TOP-LEVEL KEYS ---`);
  for (const k of Object.keys(data)) {
    const v = data[k];
    const t = Array.isArray(v) ? `[]:${v.length}` : v === null ? "null" : typeof v;
    console.log(`  ${k}  <${t}>`);
  }
  return data;
}

function inspectAncestry(data: Record<string, unknown>) {
  const persons = data.persons as Array<Record<string, unknown>> | undefined;
  if (!persons?.length) {
    console.log("\n(no persons[] in ancestry response)");
    return;
  }
  console.log(`\n--- persons[].length: ${persons.length} ---`);

  // Distribution of ascendancyNumber, types, and ordering.
  const ascList: Array<{ idx: number; num: unknown; type: string; id?: string; name?: string }> = [];
  persons.forEach((p, idx) => {
    const display = p.display as Record<string, unknown> | undefined;
    ascList.push({
      idx,
      num: display?.ascendancyNumber,
      type: typeof display?.ascendancyNumber,
      id: p.id as string | undefined,
      name: display?.name as string | undefined,
    });
  });
  console.log(`\nascendancyNumber distribution (first 20):`);
  ascList.slice(0, 20).forEach((r) =>
    console.log(
      `  [${r.idx.toString().padStart(2)}] asc=${JSON.stringify(r.num)} (${r.type}) id=${r.id} name=${r.name}`,
    ),
  );
  if (ascList.length > 20) console.log(`  ... (${ascList.length - 20} more)`);

  // Verify ordering — are they sorted by ascendancyNumber?
  const nums = ascList
    .map((r) => Number(r.num))
    .filter((n) => !Number.isNaN(n));
  const sorted = [...nums].sort((a, b) => a - b);
  const isSorted = nums.every((n, i) => n === sorted[i]);
  console.log(`\nOrdering: persons[] is ${isSorted ? "SORTED" : "NOT sorted"} by ascendancyNumber`);

  // Inspect the focal person (asc=1).
  const focal = persons.find((p) => {
    const d = p.display as Record<string, unknown> | undefined;
    return d?.ascendancyNumber === "1" || d?.ascendancyNumber === 1;
  });
  if (focal) {
    console.log(`\n--- focal (asc=1) ---`);
    const d = focal.display as Record<string, unknown> | undefined;
    console.log(`  id: ${focal.id}; name: ${d?.name}; gender: ${d?.gender}; lifespan: ${d?.lifespan}`);
    console.log(`  has facts[]? ${Array.isArray(focal.facts) ? `yes (${(focal.facts as unknown[]).length})` : "no"}`);
  } else {
    console.log(`\n(no person found with ascendancyNumber=1)`);
  }
}

async function main() {
  const token = await getValidToken();
  console.log(`Token ok (len=${token.length})`);

  // Vary generations + personDetails.
  for (const variant of [
    "person=KNDX-MKG&generations=2&personDetails",
    "person=KNDX-MKG&generations=4&personDetails",
    "person=KNDX-MKG&generations=8&personDetails",
    "person=KNDX-MKG&generations=2", // no personDetails
    "person=KNDX-MKG&generations=9&personDetails", // over-cap
    "person=KNDX-MKG&generations=0&personDetails", // under-cap
    "person=ZZZZ-ZZZ&generations=2&personDetails", // bogus person
  ]) {
    const data = await fetchAncestry(token, variant, variant);
    if (data && (data.persons as unknown[] | undefined)?.length) inspectAncestry(data);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

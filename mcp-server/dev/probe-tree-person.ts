/**
 * Probe — tree person endpoint (full verification).
 *
 * Endpoint: GET https://api.familysearch.org/platform/tree/persons/{pid}
 *
 * Extends the sanity check that was folded into the families probe
 * notes. Goal: verify every claim in the `person` action section of
 * docs/specs/tree-tool-spec.md against the live response shape, and
 * surface anything the spec misses.
 *
 * The spec claims:
 *   - response.persons[0].id          — person ID
 *   - response.persons[0].living      — boolean
 *   - response.persons[0].gender.type — GEDCOMX URI
 *   - response.persons[0].display     — pre-formatted summary
 *   - response.persons[0].facts[]     — structured life events
 *   - response.persons[0].names[]     — structured name forms
 *
 * Things to verify:
 *   1. Does the response REALLY only carry persons[0] or is there a
 *      richer envelope (relationships, sourceDescriptions, places,
 *      childAndParentsRelationships) that we should be aware of?
 *   2. Is `display.gender` always one of {"Male","Female","Unknown"}
 *      as the spec assumes, or are there other values?
 *   3. Is `display.lifespan` always present? Format?
 *   4. What does `facts[i]` actually look like end-to-end? The spec
 *      lists `type`, `date.original`, `place.original`. Are there
 *      `date.formal` / `place.normalized` / `value` etc that we'd
 *      want to surface?
 *   5. What does `names[i]` look like? Does the focal person have
 *      multiple name forms (married name, alternate name)?
 *   6. Which GEDCOMX fact types appear in practice? Does the spec's
 *      FACT_TYPE_LABELS table miss any common ones?
 *
 * Test subjects:
 *   - KNDX-MKG (Washington — heavy facts/sources)
 *   - L6N4-4GW (spec's stale example ID — confirm it resolves cleanly)
 *   - ZZZZ-ZZZ (truly bogus — confirm 404 shape)
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

async function fetchPerson(token: string, pid: string) {
  const url = `${API_BASE}/persons/${pid}`;
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
    console.log(`\nBody (first 800c):\n${bodyText.slice(0, 800)}`);
    return null;
  }
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(bodyText) as Record<string, unknown>;
  } catch (e) {
    console.log(`(could not parse JSON: ${(e as Error).message})`);
    console.log(`Body (first 800c):\n${bodyText.slice(0, 800)}`);
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

function inspectPerson(data: Record<string, unknown>) {
  const persons = data.persons as Array<Record<string, unknown>> | undefined;
  if (!persons?.length) {
    console.log("\n(no persons[] in response)");
    return;
  }
  const p = persons[0];
  console.log(`\n=== persons[0] keys: ${Object.keys(p).join(", ")} ===`);

  console.log(`\n--- ID / LIVING / GENDER ---`);
  console.log(`  id: ${p.id}`);
  console.log(`  living: ${p.living}`);
  const gender = p.gender as Record<string, unknown> | undefined;
  if (gender) {
    console.log(`  gender keys: ${Object.keys(gender).join(", ")}`);
    console.log(`  gender.type: ${gender.type}`);
  }

  console.log(`\n--- display object (pre-formatted) ---`);
  const display = p.display as Record<string, unknown> | undefined;
  if (display) {
    console.log(`  display keys: ${Object.keys(display).join(", ")}`);
    for (const k of [
      "name",
      "gender",
      "lifespan",
      "birthDate",
      "birthPlace",
      "deathDate",
      "deathPlace",
      "ascendancyNumber",
      "descendancyNumber",
    ]) {
      console.log(`  display.${k}: ${JSON.stringify(display[k])}`);
    }
    if (display.familiesAsParent)
      console.log(`  display.familiesAsParent length: ${(display.familiesAsParent as unknown[]).length}`);
    if (display.familiesAsChild)
      console.log(`  display.familiesAsChild length: ${(display.familiesAsChild as unknown[]).length}`);
  } else {
    console.log("  (no display object)");
  }

  console.log(`\n--- names[] (structured) ---`);
  const names = p.names as Array<Record<string, unknown>> | undefined;
  if (names?.length) {
    console.log(`  names.length: ${names.length}`);
    names.forEach((n, i) => {
      console.log(`\n  names[${i}] keys: ${Object.keys(n).join(", ")}`);
      const nameForms = n.nameForms as Array<Record<string, unknown>> | undefined;
      if (nameForms?.length) {
        nameForms.forEach((nf, j) => {
          console.log(
            `    nameForms[${j}].fullText: ${nf.fullText}; lang: ${nf.lang}; parts: ${
              (nf.parts as unknown[] | undefined)?.length ?? 0
            }`,
          );
          const parts = nf.parts as Array<Record<string, unknown>> | undefined;
          if (parts) {
            parts.forEach((pp, k) =>
              console.log(`      parts[${k}]: type=${pp.type} value=${pp.value}`),
            );
          }
        });
      }
      if (n.preferred !== undefined) console.log(`    preferred: ${n.preferred}`);
      if (n.type) console.log(`    type: ${n.type}`);
    });
  } else {
    console.log("  (no names[])");
  }

  console.log(`\n--- facts[] (life events) ---`);
  const facts = p.facts as Array<Record<string, unknown>> | undefined;
  if (facts?.length) {
    console.log(`  facts.length: ${facts.length}`);
    const typeCounts: Record<string, number> = {};
    for (const f of facts) typeCounts[(f.type as string) ?? "?"] = (typeCounts[(f.type as string) ?? "?"] ?? 0) + 1;
    console.log(`  fact-type histogram:`);
    for (const [t, n] of Object.entries(typeCounts).sort()) {
      console.log(`    ${t}: ${n}`);
    }
    console.log(`\n  facts[0] FULL keys + values:`);
    summarizeKeys(facts[0], `    `, 0, 4);
    console.log(`\n  facts[1] FULL keys + values:`);
    if (facts[1]) summarizeKeys(facts[1], `    `, 0, 4);
  } else {
    console.log("  (no facts[])");
  }

  console.log(`\n--- person.links ---`);
  const links = p.links as Record<string, unknown> | undefined;
  if (links) console.log(`  link keys: ${Object.keys(links).join(", ")}`);

  console.log(`\n--- person.sources[] (per-fact / per-person source refs) ---`);
  const pSources = p.sources as Array<Record<string, unknown>> | undefined;
  if (pSources?.length) {
    console.log(`  sources.length: ${pSources.length}`);
    pSources.slice(0, 2).forEach((s, i) => {
      console.log(`  sources[${i}] keys: ${Object.keys(s).join(", ")}`);
      summarizeKeys(s, `    `, 0, 3);
    });
  } else {
    console.log("  (no person-level sources[] in this payload)");
  }
}

async function main() {
  const token = await getValidToken();
  console.log(`Token ok (len=${token.length})`);

  for (const pid of ["KNDX-MKG", "L6N4-4GW", "ZZZZ-ZZZ"]) {
    const data = await fetchPerson(token, pid);
    if (data && data.persons) inspectPerson(data);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

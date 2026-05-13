/**
 * Probe — tree sources endpoint (NEW; not in current spec).
 *
 * Endpoint: GET https://api.familysearch.org/platform/tree/persons/{pid}/sources
 *
 * This is the endpoint the spec extension must describe. The current
 * tree-tool-spec.md (branch `tree-tool-spec`) does not cover sources;
 * the Adeyinka task asks us to add them.
 *
 * Goal: capture the FULL on-the-wire shape so we can write an accurate
 * spec for the `sources` action. Things to learn:
 *   1. What's the top-level envelope? (sourceDescriptions? citations?
 *      persons? relationships? other?)
 *   2. For each source: what fields exist? Likely candidates per
 *      gedcomx — id, about, citations[], titles[], notes[],
 *      identifiers, attribution.
 *   3. How is the contributor surfaced? (attribution.contributor?
 *      modifier? changeMessage?) The UI shows "attached by".
 *   4. How is the year shown? (citation text? a structured date?
 *      a separate field?)
 *   5. Where does the "attached date" come from?
 *   6. Are sources tagged per-fact (e.g., "Birth - 6 sources") in
 *      this payload, or is that tagging only on the person record?
 *   7. Is there a difference in shape between FamilySearch-attached
 *      and user-attached sources?
 *   8. Pagination? Total count?
 *
 * Test subjects:
 *   - KNDX-MKG (Washington — heavily sourced public figure)
 *   - L6N4-4GW (spec example ID)
 *   - 9999-XXX (bogus — confirm 404 shape)
 *
 * Also probes companion endpoints we might want to surface or skip:
 *   - /persons/{pid}/source-references — lightweight reference list
 *   - /persons/{pid}/source-descriptions — server-side joined view
 *   - /sources/descriptions/{srcId} — full source-description fetch
 *     (only run on an ID discovered from the list).
 */
import { getValidToken } from "../src/auth/refresh.js";

const API_BASE = "https://api.familysearch.org/platform/tree";
const ACCEPT = "application/x-fs-v1+json";

function summarizeKeys(obj: unknown, prefix = "", depth = 0, maxDepth = 5): void {
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

async function probe(token: string, path: string, label: string) {
  const url = `https://api.familysearch.org${path}`;
  console.log(`\n${"=".repeat(72)}`);
  console.log(`[${label}] GET ${url}`);
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
  if (!bodyText) {
    console.log(`(empty body)`);
    return null;
  }
  if (!bodyText.trim().startsWith("{")) {
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

  console.log(`\n--- TOP-LEVEL KEYS ---`);
  for (const k of Object.keys(data)) {
    const v = data[k];
    const t = Array.isArray(v) ? `[]:${v.length}` : v === null ? "null" : typeof v;
    console.log(`  ${k}  <${t}>`);
  }
  return data;
}

function dumpSourceDescription(sd: Record<string, unknown>, label: string) {
  console.log(`\n>>> ${label}`);
  console.log(`    id: ${sd.id}`);
  console.log(`    about: ${sd.about ?? "(none)"}`);
  console.log(`    resourceType: ${sd.resourceType ?? "(none)"}`);
  console.log(`    mediaType: ${sd.mediaType ?? "(none)"}`);
  const titles = sd.titles as Array<{ value?: string }> | undefined;
  if (titles?.length) {
    titles.forEach((t, i) => console.log(`    titles[${i}].value: ${t.value}`));
  } else {
    console.log(`    titles: (none)`);
  }
  const citations = sd.citations as Array<{ value?: string }> | undefined;
  if (citations?.length) {
    citations.forEach((c, i) =>
      console.log(`    citations[${i}].value: ${(c.value ?? "").slice(0, 200)}`),
    );
  } else {
    console.log(`    citations: (none)`);
  }
  const notes = sd.notes as Array<{ text?: string; subject?: string }> | undefined;
  if (notes?.length) {
    notes.forEach((n, i) =>
      console.log(
        `    notes[${i}]: subject=${n.subject ?? ""} text=${(n.text ?? "").slice(0, 120)}`,
      ),
    );
  }
  const ids = sd.identifiers as Record<string, unknown> | undefined;
  if (ids) {
    console.log(`    identifiers keys: ${Object.keys(ids).join(", ")}`);
    for (const k of Object.keys(ids)) {
      const v = JSON.stringify(ids[k]);
      console.log(`      ${k}: ${v?.slice(0, 200)}`);
    }
  }
  const attribution = sd.attribution as Record<string, unknown> | undefined;
  if (attribution) {
    console.log(`    attribution keys: ${Object.keys(attribution).join(", ")}`);
    summarizeKeys(attribution, "      ", 0, 4);
  } else {
    console.log(`    attribution: (none)`);
  }
  const sources = sd.sources as Array<unknown> | undefined;
  if (sources?.length) console.log(`    sources (subsources): length=${sources.length}`);
  // Dump any other keys we haven't touched.
  const known = new Set([
    "id",
    "about",
    "resourceType",
    "mediaType",
    "titles",
    "citations",
    "notes",
    "identifiers",
    "attribution",
    "sources",
    "links",
  ]);
  const extras = Object.keys(sd).filter((k) => !known.has(k));
  if (extras.length) {
    console.log(`    EXTRA keys not pre-modeled: ${extras.join(", ")}`);
    for (const k of extras) {
      const v = (sd as Record<string, unknown>)[k];
      const t = Array.isArray(v) ? `[]:${v.length}` : v === null ? "null" : typeof v;
      console.log(`      ${k}  <${t}>`);
      if (v && typeof v === "object") summarizeKeys(v, `        `, 0, 3);
    }
  }
}

function inspectSourcesPayload(data: Record<string, unknown>) {
  const sds = data.sourceDescriptions as Array<Record<string, unknown>> | undefined;
  if (sds && sds.length) {
    console.log(`\n=== sourceDescriptions[] (${sds.length}) ===`);
    // Inspect the first 3 in depth; then summarize the rest.
    sds.slice(0, 3).forEach((sd, i) => dumpSourceDescription(sd, `sourceDescriptions[${i}]`));
    if (sds.length > 3) {
      console.log(`\n(${sds.length - 3} more sourceDescriptions — sample keys only:)`);
      for (let i = 3; i < Math.min(sds.length, 8); i++) {
        console.log(`  [${i}] keys: ${Object.keys(sds[i]).join(", ")}`);
      }
    }
  } else {
    console.log("\n(no sourceDescriptions[] in payload)");
  }

  const refs = data.sourceReferences as Array<Record<string, unknown>> | undefined;
  if (refs && refs.length) {
    console.log(`\n=== sourceReferences[] (${refs.length}) ===`);
    refs.slice(0, 3).forEach((r, i) => {
      console.log(`\n  [${i}] keys: ${Object.keys(r).join(", ")}`);
      summarizeKeys(r, `    `, 0, 4);
    });
  } else {
    console.log("\n(no sourceReferences[] in payload)");
  }

  const persons = data.persons as Array<Record<string, unknown>> | undefined;
  if (persons && persons.length) {
    console.log(`\n=== persons[] (${persons.length}) — checking for per-fact source links ===`);
    persons.slice(0, 1).forEach((p, i) => {
      console.log(`\n  persons[${i}]: id=${p.id}`);
      const facts = p.facts as Array<Record<string, unknown>> | undefined;
      if (facts?.length) {
        facts.forEach((f, j) => {
          const links = f.links;
          const sources = f.sources;
          console.log(
            `    facts[${j}].type=${f.type}; has links=${!!links}; has sources=${!!sources}; keys=${Object.keys(f).join(",")}`,
          );
        });
      }
      const personLinks = p.links;
      if (personLinks) console.log(`    person.links keys: ${Object.keys(personLinks).join(",")}`);
      const pSources = p.sources;
      if (pSources) console.log(`    person.sources present`);
    });
  } else {
    console.log("\n(no persons[] in payload)");
  }

  // Top-level links — pagination?
  const links = data.links as Record<string, unknown> | undefined;
  if (links) {
    console.log(`\n=== top-level links ===`);
    summarizeKeys(links, "  ", 0, 3);
  }
}

async function main() {
  const token = await getValidToken();
  console.log(`Token ok (len=${token.length})\n`);

  // Primary: Washington sources.
  const wash = await probe(token, `/platform/tree/persons/KNDX-MKG/sources`, "Washington /sources");
  if (wash) inspectSourcesPayload(wash);

  // Companion endpoints — what shape do they return?
  const refs = await probe(
    token,
    `/platform/tree/persons/KNDX-MKG/source-references`,
    "Washington /source-references",
  );
  if (refs) inspectSourcesPayload(refs);

  const descs = await probe(
    token,
    `/platform/tree/persons/KNDX-MKG/source-descriptions`,
    "Washington /source-descriptions",
  );
  if (descs) inspectSourcesPayload(descs);

  // Spec's example ID for cross-check.
  const wash2 = await probe(token, `/platform/tree/persons/L6N4-4GW/sources`, "L6N4-4GW /sources");
  if (wash2) inspectSourcesPayload(wash2);

  // Bogus ID — confirm 404 shape.
  await probe(token, `/platform/tree/persons/9999-XXX/sources`, "Bogus /sources");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * Probe — final edge-case sweep.
 *
 * Targets each remaining edge case with a specific known ID instead
 * of searching:
 *   - Multi-spouse: KNDX-MFX (Augustine Washington — married Jane
 *     Butler first, then Mary Ball after she died).
 *   - Heavily-sourced: tries /platform/tree/persons-search for Lincoln
 *     to find a tree ID with many sources. Also probes whether
 *     /sources paginates by passing count/start params.
 *   - 301-merged: scan /change-history for KNDX-MKG to look for a
 *     merged ID we can hit directly. Failing that, try a known stale
 *     ID format.
 *   - No-family: hits /families on a known sparse person (the bogus
 *     "Andres" we found earlier, 9999-XXX, only has parents and no
 *     children — close enough for the "minimal family" case).
 */
/// <reference types="node" />
import { getValidToken } from "../src/auth/refresh.js";

const API_BASE = "https://api.familysearch.org";
const ACCEPT = "application/x-fs-v1+json";

async function get(token: string, path: string) {
  return fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: ACCEPT },
    redirect: "manual",
  });
}

async function multiSpouseCase(token: string) {
  console.log("\n========== MULTI-SPOUSE: KNDX-MFX (Augustine Washington) ==========");
  const res = await get(token, "/platform/tree/persons/KNDX-MFX/families");
  console.log(`HTTP ${res.status}`);
  if (!res.ok) return;
  const data = (await res.json()) as {
    relationships?: Array<{
      type?: string;
      person1?: { resourceId?: string };
      person2?: { resourceId?: string };
      facts?: Array<{ type?: string; date?: { original?: string }; place?: { original?: string } }>;
    }>;
    persons?: Array<{ id?: string; display?: { name?: string; lifespan?: string } }>;
  };

  const couples =
    data.relationships?.filter(
      (r) =>
        r.type === "http://gedcomx.org/Couple" &&
        (r.person1?.resourceId === "KNDX-MFX" || r.person2?.resourceId === "KNDX-MFX"),
    ) ?? [];
  console.log(`Couples involving KNDX-MFX: ${couples.length}`);
  const personIndex = new Map<string, { name?: string; lifespan?: string }>();
  for (const p of data.persons ?? []) {
    if (p.id) personIndex.set(p.id, p.display ?? {});
  }
  couples.forEach((c, i) => {
    const spouseId =
      c.person1?.resourceId === "KNDX-MFX" ? c.person2?.resourceId : c.person1?.resourceId;
    const spouse = spouseId ? personIndex.get(spouseId) : undefined;
    const marriage = c.facts?.find((f) => f.type === "http://gedcomx.org/Marriage");
    console.log(`  spouse[${i}]: ${spouseId} = ${spouse?.name ?? "(not in payload)"} (${spouse?.lifespan ?? "?"})`);
    console.log(`    marriage: ${marriage?.date?.original ?? "(no date)"} @ ${marriage?.place?.original ?? "(no place)"}`);
  });
}

async function heavySourcedSearch(token: string) {
  console.log("\n========== HEAVY SOURCES: tree search for Lincoln ==========");
  // Tree-search service endpoint (not the hr/v2 record search).
  const url =
    "/platform/tree/search?q.givenName=Abraham&q.surname=Lincoln&q.birthLikeDate=1809&q.deathLikeDate=1865&count=5";
  const res = await get(token, url);
  console.log(`HTTP ${res.status} ${res.statusText}`);
  if (!res.ok) {
    const body = await res.text();
    console.log(`  body 400c: ${body.slice(0, 400)}`);
    return;
  }
  const data = (await res.json()) as {
    entries?: Array<{ id?: string; content?: { gedcomx?: { persons?: Array<{ id?: string }> } } }>;
  };
  const entries = data.entries ?? [];
  console.log(`  ${entries.length} hits`);
  const candidates: string[] = [];
  entries.slice(0, 5).forEach((e, i) => {
    const pid = e.content?.gedcomx?.persons?.[0]?.id;
    console.log(`  [${i}] entry.id=${e.id} treePersonId=${pid}`);
    if (pid) candidates.push(pid);
  });

  // For top hits, count their sources.
  for (const pid of candidates) {
    const sres = await get(token, `/platform/tree/persons/${pid}/sources`);
    if (!sres.ok) {
      console.log(`  ${pid}: /sources HTTP ${sres.status}`);
      continue;
    }
    const txt = await sres.text();
    const sd = txt ? (JSON.parse(txt) as { sourceDescriptions?: unknown[] }).sourceDescriptions ?? [] : [];
    console.log(`  ${pid}: ${sd.length} sources`);
  }
}

async function sourcesPaginationProbe(token: string) {
  console.log("\n========== PAGINATION on /sources for KNDX-MKG ==========");
  // Try various pagination-style params to see if any change the count.
  for (const q of ["", "?count=5", "?start=0&count=5", "?offset=20", "?count=200"]) {
    const r = await get(token, `/platform/tree/persons/KNDX-MKG/sources${q}`);
    if (!r.ok) {
      console.log(`  ${q || "(no params)"}: HTTP ${r.status}`);
      continue;
    }
    const txt = await r.text();
    const sd = txt ? (JSON.parse(txt) as { sourceDescriptions?: unknown[] }).sourceDescriptions ?? [] : [];
    console.log(`  ${q || "(no params)"}: ${sd.length} sources`);
  }
}

async function mergedRedirectProbe(token: string) {
  console.log("\n========== 301 MERGED REDIRECT ==========");
  // Pull the change-history on Washington — merge events may surface
  // historical IDs that 301 to him today.
  const res = await get(token, "/platform/tree/persons/KNDX-MKG/changes");
  console.log(`changes HTTP ${res.status}`);
  if (!res.ok) {
    const body = await res.text();
    console.log(`  body 400c: ${body.slice(0, 400)}`);
  } else {
    const data = (await res.json()) as { entries?: Array<{ id?: string; title?: string }> };
    const entries = data.entries ?? [];
    console.log(`  ${entries.length} change-history entries`);
    const merges = entries.filter((e) => /merge/i.test(e.title ?? ""));
    console.log(`  merge-related: ${merges.length}`);
    merges.slice(0, 5).forEach((e, i) => console.log(`    [${i}] ${e.title}`));
  }

  // As a fallback, try a known historical-tree pattern: some old IDs
  // beginning with M followed by 4 chars are stale. We try a few that
  // commonly redirect in FS public docs.
  console.log("\n  Trying speculative stale IDs:");
  for (const pid of ["KWN2-Y56", "MMMM-MMS", "K2QT-J56"]) {
    const r = await fetch(`${API_BASE}/platform/tree/persons/${pid}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: ACCEPT },
      redirect: "manual",
    });
    console.log(`    ${pid}: HTTP ${r.status}; Location: ${r.headers.get("location") ?? "(none)"}`);
  }
}

async function minimalFamilyCase(token: string) {
  console.log("\n========== MINIMAL FAMILY (current-user PQD1-2T4 — living, no relations) ==========");
  const res = await get(token, "/platform/tree/persons/PQD1-2T4/families");
  console.log(`HTTP ${res.status}; Content-Length: ${res.headers.get("content-length")}`);
  if (!res.ok) return;
  const txt = await res.text();
  if (!txt) {
    console.log(`  empty body (likely HTTP 204)`);
    return;
  }
  const parsed = JSON.parse(txt) as {
    childAndParentsRelationships?: unknown[];
    relationships?: unknown[];
    persons?: unknown[];
  };
  console.log(`  CAPRs: ${parsed.childAndParentsRelationships?.length ?? 0}`);
  console.log(`  relationships: ${parsed.relationships?.length ?? 0}`);
  console.log(`  persons: ${parsed.persons?.length ?? 0}`);
}

async function main() {
  const token = await getValidToken();
  console.log(`Token ok (len=${token.length})`);

  await multiSpouseCase(token);
  await heavySourcedSearch(token);
  await sourcesPaginationProbe(token);
  await mergedRedirectProbe(token);
  await minimalFamilyCase(token);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * Probe — second pass at finding edge-case IDs.
 *
 * Round 1 succeeded for the "living person" case (current-user
 * resolved to PQD1-2T4 and /sources returned HTTP 204 empty body —
 * useful spec detail).
 *
 * This round goes after the harder targets:
 *   - Multiple-spouse person (Henry VIII)
 *   - Heavily-sourced person (Lincoln, or any 50+-source profile)
 *   - Merged-person 301 redirect (probe a known stale/duplicate ID)
 */
/// <reference types="node" />
import { getValidToken } from "../src/auth/refresh.js";

const API_BASE = "https://api.familysearch.org";
const SEARCH = "https://www.familysearch.org/service/search/hr/v2/personas";
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

async function searchPersonas(token: string, params: Record<string, string>, label: string) {
  const q = new URLSearchParams(params).toString();
  const url = `${SEARCH}?${q}`;
  console.log(`\n--- ${label} ---`);
  console.log(`  ${q}`);
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "User-Agent": BROWSER_UA,
    },
  });
  console.log(`  HTTP ${res.status}`);
  if (!res.ok) {
    const body = await res.text();
    console.log(`  body (200c): ${body.slice(0, 200)}`);
    return [];
  }
  const data = (await res.json()) as {
    entries?: Array<{
      id?: string;
      title?: string;
      content?: { gedcomx?: { persons?: Array<{ id?: string; principal?: boolean }> } };
    }>;
  };
  const entries = data.entries ?? [];
  console.log(`  ${entries.length} entries:`);
  const ids: string[] = [];
  entries.slice(0, 8).forEach((e, i) => {
    const principal = e.content?.gedcomx?.persons?.find((p) => p.principal);
    const pid = principal?.id ?? e.content?.gedcomx?.persons?.[0]?.id;
    console.log(`    [${i}] entry.id=${e.id} principalId=${pid} title=${(e.title ?? "").slice(0, 80)}`);
    if (pid) ids.push(pid);
  });
  return ids;
}

async function followFamilies(token: string, pid: string, label: string) {
  console.log(`\n  follow /families for ${label} (${pid}):`);
  const r = await fetch(`${API_BASE}/platform/tree/persons/${pid}/families`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/x-fs-v1+json" },
    redirect: "manual",
  });
  console.log(`    HTTP ${r.status}; Location: ${r.headers.get("location") ?? "(none)"}`);
  if (!r.ok) {
    if (r.status === 301 || r.status === 302) console.log(`    *** REDIRECT — candidate merged-person ID ***`);
    return;
  }
  const data = (await r.json()) as {
    relationships?: Array<{
      type?: string;
      person1?: { resourceId?: string };
      person2?: { resourceId?: string };
    }>;
  };
  const couples = (data.relationships ?? []).filter(
    (rl) =>
      rl.type === "http://gedcomx.org/Couple" &&
      (rl.person1?.resourceId === pid || rl.person2?.resourceId === pid),
  );
  console.log(`    couples involving ${pid}: ${couples.length}`);
  couples.forEach((c, i) =>
    console.log(`      couple[${i}]: ${c.person1?.resourceId} <-> ${c.person2?.resourceId}`),
  );
}

async function quickSources(token: string, pid: string) {
  const r = await fetch(`${API_BASE}/platform/tree/persons/${pid}/sources`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/x-fs-v1+json" },
  });
  if (!r.ok) {
    console.log(`    /sources HTTP ${r.status}`);
    return 0;
  }
  const t = await r.text();
  if (!t) return 0;
  try {
    const d = JSON.parse(t) as { sourceDescriptions?: unknown[] };
    return d.sourceDescriptions?.length ?? 0;
  } catch {
    return 0;
  }
}

async function main() {
  const token = await getValidToken();
  console.log(`Token ok (len=${token.length})`);

  // 1. Henry VIII — simpler search (just name + death year window).
  const ids = await searchPersonas(
    token,
    { "q.givenName": "Henry", "q.surname": "Tudor", "q.deathLikePlace": "England", count: "10" },
    "Henry Tudor search",
  );

  // 2. Inspect each candidate for multi-spouse signature.
  for (const pid of ids.slice(0, 5)) await followFamilies(token, pid, "Henry-candidate");

  // 3. Also try a direct search for Henry VIII with year hints.
  const ids2 = await searchPersonas(
    token,
    {
      "q.givenName": "Henry VIII",
      "q.birthLikeDate.from": "1491",
      "q.birthLikeDate.to": "1491",
      count: "5",
    },
    "Henry VIII year-bounded",
  );
  for (const pid of ids2.slice(0, 3)) await followFamilies(token, pid, "Henry-VIII-yr");

  // 4. Lincoln — for high-sources pagination candidate.
  const linc = await searchPersonas(
    token,
    {
      "q.givenName": "Abraham",
      "q.surname": "Lincoln",
      "q.deathLikeDate.from": "1865",
      "q.deathLikeDate.to": "1865",
      count: "5",
    },
    "Lincoln search",
  );
  for (const pid of linc.slice(0, 3)) {
    const count = await quickSources(token, pid);
    console.log(`    ${pid} → /sources count = ${count}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

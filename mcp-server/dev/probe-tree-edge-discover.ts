/**
 * Probe — discover test person IDs for the tree-tool edge cases.
 *
 * The edge cases the spec needs to characterize:
 *   - Multiple spouses     → e.g. Henry VIII (6 wives)
 *   - Heavily sourced      → for /sources pagination test
 *   - Living person        → current-user resolution is one path
 *   - Merged (301)         → harder; deferred unless we find one
 *
 * Strategy:
 *   1. Hit /platform/tree/current-person to grab the logged-in user's
 *      tree person ID (a candidate "living person").
 *   2. Use the FS search-service to find Henry VIII (`hr/v2/personas`
 *      — same endpoint the search tool spec targets).
 *   3. For Henry VIII (or whoever we find), pull /families to count
 *      Couple relationships where he is person1/person2.
 *   4. For Lincoln (`KP5N-7H7` is a common public ID) try /sources —
 *      if response carries >20 sourceDescriptions we have our
 *      pagination candidate. Otherwise widen the net.
 *
 * Output: just print the candidate IDs and a one-line classification
 * so the next probe can use them directly.
 */
/// <reference types="node" />
import { getValidToken } from "../src/auth/refresh.js";

const API_BASE = "https://api.familysearch.org";
const SEARCH = "https://www.familysearch.org/service/search/hr/v2/personas";
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

async function getCurrentPerson(token: string) {
  console.log("\n--- /platform/tree/current-person ---");
  const res = await fetch(`${API_BASE}/platform/tree/current-person`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/x-fs-v1+json" },
    redirect: "manual",
  });
  console.log(`HTTP ${res.status}`);
  console.log(`Location: ${res.headers.get("location")}`);
  const loc = res.headers.get("location");
  if (!loc) return null;
  const m = loc.match(/\/persons\/([^/?]+)/);
  return m ? m[1] : null;
}

async function searchPersonas(token: string, params: Record<string, string>) {
  const q = new URLSearchParams(params).toString();
  const url = `${SEARCH}?${q}`;
  console.log(`\n--- search: ${q} ---`);
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "User-Agent": BROWSER_UA,
    },
  });
  console.log(`HTTP ${res.status}`);
  if (!res.ok) return [];
  const data = (await res.json()) as { entries?: Array<Record<string, unknown>> };
  const entries = data.entries ?? [];
  console.log(`  ${entries.length} entries`);
  return entries;
}

async function inspectPersonForCounts(token: string, pid: string, label: string) {
  console.log(`\n--- inspect ${label} (${pid}) ---`);

  // /persons/{id} → quick living/name check
  const pres = await fetch(`${API_BASE}/platform/tree/persons/${pid}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/x-fs-v1+json" },
  });
  if (pres.ok) {
    const pdata = (await pres.json()) as {
      persons?: Array<{ display?: { name?: string; lifespan?: string }; living?: boolean }>;
    };
    const p = pdata.persons?.[0];
    console.log(`  name: ${p?.display?.name}`);
    console.log(`  lifespan: ${p?.display?.lifespan}`);
    console.log(`  living: ${p?.living}`);
  } else {
    console.log(`  /persons returned HTTP ${pres.status}`);
  }

  // /sources → source count
  const sres = await fetch(`${API_BASE}/platform/tree/persons/${pid}/sources`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/x-fs-v1+json" },
  });
  if (sres.ok) {
    const txt = await sres.text();
    if (!txt) {
      console.log(`  /sources: empty body (HTTP ${sres.status}; content-length=${sres.headers.get("content-length")})`);
    } else {
      try {
        const sdata = JSON.parse(txt) as { sourceDescriptions?: unknown[] };
        console.log(`  sourceDescriptions: ${sdata.sourceDescriptions?.length ?? 0}`);
      } catch {
        console.log(`  /sources: non-JSON body, first 200c: ${txt.slice(0, 200)}`);
      }
    }
  } else {
    console.log(`  /sources returned HTTP ${sres.status}`);
  }

  // /families → couple count + parent/child counts where focal participates
  const fres = await fetch(`${API_BASE}/platform/tree/persons/${pid}/families`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/x-fs-v1+json" },
  });
  if (fres.ok) {
    const fdata = (await fres.json()) as {
      childAndParentsRelationships?: Array<{
        parent1?: { resourceId?: string };
        parent2?: { resourceId?: string };
        child?: { resourceId?: string };
      }>;
      relationships?: Array<{
        type?: string;
        person1?: { resourceId?: string };
        person2?: { resourceId?: string };
      }>;
    };
    const caprs = fdata.childAndParentsRelationships ?? [];
    const rels = fdata.relationships ?? [];

    const asParent = caprs.filter(
      (r) => r.parent1?.resourceId === pid || r.parent2?.resourceId === pid,
    ).length;
    const asChild = caprs.filter((r) => r.child?.resourceId === pid).length;
    const couples = rels.filter(
      (r) =>
        r.type === "http://gedcomx.org/Couple" &&
        (r.person1?.resourceId === pid || r.person2?.resourceId === pid),
    );
    console.log(`  CAPRs as parent: ${asParent}`);
    console.log(`  CAPRs as child: ${asChild}`);
    console.log(`  Couple relationships involving ${pid}: ${couples.length}`);
    couples.forEach((c, i) =>
      console.log(
        `    couple[${i}]: ${c.person1?.resourceId} <-> ${c.person2?.resourceId}`,
      ),
    );
  } else {
    console.log(`  /families returned HTTP ${fres.status}`);
  }
}

async function main() {
  const token = await getValidToken();
  console.log(`Token ok (len=${token.length})`);

  // 1. Current user (candidate living person).
  const myId = await getCurrentPerson(token);
  if (myId) {
    await inspectPersonForCounts(token, myId, "current-user");
  } else {
    console.log("  (current-person did not return a Location)");
  }

  // 2. Search Henry VIII.
  const henry = await searchPersonas(token, {
    "q.givenName": "Henry VIII",
    "q.surname": "England",
    "f.birthLikeDate.from": "1490",
    "f.birthLikeDate.to": "1500",
    "f.deathLikeDate.from": "1545",
    "f.deathLikeDate.to": "1550",
    count: "5",
  });
  for (const e of henry.slice(0, 3)) {
    const content = e.content as { gedcomx?: { persons?: Array<{ id?: string }> } } | undefined;
    const pid = content?.gedcomx?.persons?.[0]?.id;
    if (pid) {
      console.log(`\n  candidate Henry: ${pid}`);
      await inspectPersonForCounts(token, pid, `Henry VIII candidate ${pid}`);
    }
  }

  // 3. Try a couple of well-known historical IDs for heavy sourcing.
  // (These are guesses based on public profiles — adjust if they 404.)
  for (const pid of ["KP5N-7H7" /* Lincoln? */, "L62F-6BB" /* unknown */]) {
    await inspectPersonForCounts(token, pid, `historical guess ${pid}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

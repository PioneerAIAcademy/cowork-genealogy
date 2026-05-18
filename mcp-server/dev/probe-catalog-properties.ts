/**
 * Probe 8 — `properties[]` field on list-response hits.
 *
 * Earlier probes only inspected searchHits[0]. The Atlassian-page
 * sample query (Alabama) returned XML showing that hits 2+ carry a
 * `<properties>` element with typed metadata not visible in the
 * truncated JSON dumps from probe 1:
 *
 *   <property type="org.familysearch.www.catalog.topic">123363</property>
 *   <property type="org.familysearch.www.catalog.surname">Buttler</property>
 *
 * This probe iterates ALL 20 hits in the first page and reports:
 *   - Which hits have a `properties` field
 *   - What property types appear and their values
 *   - Whether the JSON-formatted response surfaces the same data
 *
 * It also dumps the FULL `repositoryCalls` array length for each hit,
 * because the XML showed some entries have 14+ repository entries
 * (probably physical copies) which the earlier probes only sampled
 * the first of.
 *
 *   npx tsx dev/probe-catalog-properties.ts
 */

import { getValidToken } from "../src/auth/refresh.js";
import { BROWSER_USER_AGENT } from "../src/constants.js";

const URL =
  "https://www.familysearch.org/service/search/catalog/v3/search" +
  "?m.defaultFacets=off&m.queryRequireDefault=on" +
  "&q.place=Alabama%2C%20United%20States&q.place.exact=on";

interface PropertyEntry {
  type?: string;
  value?: string;
  [k: string]: unknown;
}

interface RepoCall {
  title?: string;
  [k: string]: unknown;
}

interface Hit {
  metadataHit?: {
    metadata?: {
      title?: Array<{ value?: string }>;
      identifier?: { value?: string };
      properties?: PropertyEntry[] | { property?: PropertyEntry | PropertyEntry[] };
      repositoryCalls?: RepoCall[];
      [k: string]: unknown;
    };
  };
}

interface Resp {
  searchHits?: Hit[];
  totalHits?: number;
}

async function main(): Promise<void> {
  const token = await getValidToken();

  const res = await fetch(URL, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "User-Agent": BROWSER_USER_AGENT,
    },
  });
  if (!res.ok) {
    console.log(`HTTP ${res.status} ${res.statusText}`);
    console.log((await res.text()).slice(0, 400));
    return;
  }

  const data = (await res.json()) as Resp;
  const hits = data.searchHits ?? [];
  console.log(`totalHits=${data.totalHits}  hitsOnPage=${hits.length}\n`);

  const allTypes = new Map<string, number>();

  hits.forEach((hit, i) => {
    const meta = hit.metadataHit?.metadata ?? {};
    const id =
      meta.identifier?.value?.split("/").pop() ?? "(no id)";
    const title = meta.title?.[0]?.value?.slice(0, 60) ?? "(no title)";
    const metaKeys = Object.keys(meta);

    console.log(`[${i}] id=${id}`);
    console.log(`    keys: [${metaKeys.join(", ")}]`);
    console.log(`    title: "${title}"`);

    const repoCount = meta.repositoryCalls?.length ?? 0;
    console.log(`    repositoryCalls: ${repoCount} entries`);

    const props = meta.properties;
    if (!props) {
      console.log(`    properties: (none)`);
      console.log();
      return;
    }

    // The JSON shape might be: properties: [...] OR properties: { property: [...] }
    let list: PropertyEntry[] = [];
    if (Array.isArray(props)) {
      list = props;
    } else if (
      typeof props === "object" &&
      props !== null &&
      "property" in props
    ) {
      const p = (props as { property?: PropertyEntry | PropertyEntry[] }).property;
      list = Array.isArray(p) ? p : p ? [p] : [];
    } else {
      console.log(`    properties: (unexpected shape: ${JSON.stringify(props).slice(0, 100)})`);
      console.log();
      return;
    }

    console.log(`    properties: ${list.length} entries`);
    list.forEach((p) => {
      const type = p.type ?? "(no type)";
      const value =
        p.value ??
        (typeof p === "object" && p !== null && "text" in p
          ? (p as { text?: string }).text
          : undefined) ??
        JSON.stringify(p).slice(0, 60);
      console.log(`      type=${type}  value=${value}`);
      allTypes.set(type, (allTypes.get(type) ?? 0) + 1);
    });
    console.log();
  });

  console.log("================================================================");
  console.log("PROPERTY TYPES OBSERVED (across all 20 hits)");
  console.log("================================================================");
  const sorted = Array.from(allTypes.entries()).sort((a, b) => b[1] - a[1]);
  for (const [type, count] of sorted) {
    console.log(`  ${type}: ${count}`);
  }

  console.log("\n================================================================");
  console.log("DONE");
  console.log("================================================================");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

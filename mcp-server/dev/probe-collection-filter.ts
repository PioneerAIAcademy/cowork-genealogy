/**
 * Probe: how does f.collectionId behave on /platform/records/personas?
 *
 *  - Format: numeric vs string?
 *  - Single value, multiple values, none?
 *  - Composes with q.surname?
 *  - Behavior for unknown collection ID?
 *  - Behavior with no q.* terms but only f.collectionId?
 *  - Does it narrow `results` count, or only filter entries?
 *  - Same param repeated, vs comma-separated?
 *
 * Uses collection 1743384 (Alabama County Marriages, 1711-1992) — known
 * from collections tool example.
 */
import { getValidToken } from "../src/auth/refresh.js";

const BASE = "https://api.familysearch.org/platform/records/personas";

const PROBES: Array<{ name: string; q: string }> = [
  // Baseline: no filter
  { name: "baseline-smith", q: "q.surname=Smith&count=5" },

  // Single collectionId (Alabama County Marriages)
  { name: "smith+collection-alabama", q: "q.surname=Smith&f.collectionId=1743384&count=5" },

  // Different popular surname + same collection
  { name: "jones+collection-alabama", q: "q.surname=Jones&f.collectionId=1743384&count=5" },

  // No q.* — only collection filter
  { name: "no-q+collection-alabama", q: "f.collectionId=1743384&count=5" },

  // Multiple collection IDs, repeated param syntax
  { name: "smith+two-collections-repeated", q: "q.surname=Smith&f.collectionId=1743384&f.collectionId=2156134&count=5" },

  // Multiple collection IDs, comma-separated
  { name: "smith+two-collections-comma", q: "q.surname=Smith&f.collectionId=1743384,2156134&count=5" },

  // Bogus collection ID (impossibly large)
  { name: "smith+collection-bogus-numeric", q: "q.surname=Smith&f.collectionId=999999999&count=5" },

  // Non-numeric collection ID
  { name: "smith+collection-bogus-text", q: "q.surname=Smith&f.collectionId=NOTACOLLECTION&count=5" },

  // Empty collection ID
  { name: "smith+collection-empty", q: "q.surname=Smith&f.collectionId=&count=5" },
];

async function probe(token: string, p: { name: string; q: string }) {
  const url = `${BASE}?${p.q}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "User-Agent": "genealogy-mcp-server/0.0.1-probe",
    },
  });

  if (!res.ok) {
    const body = await res.text();
    console.log(`${p.name.padEnd(35)} HTTP ${res.status} :: ${body.slice(0, 160).replace(/\s+/g, " ")}`);
    return;
  }

  const data = (await res.json()) as {
    results?: number;
    entries?: Array<{
      id?: string;
      title?: string;
      content?: { gedcomx?: { sourceDescriptions?: Array<{ identifiers?: Record<string, string[]>; titles?: Array<{ value?: string }> }> } };
    }>;
  };
  const entries = data.entries ?? [];
  const sample = entries[0];
  const collectionUrl =
    sample?.content?.gedcomx?.sourceDescriptions?.[0]?.identifiers?.["http://gedcomx.org/Primary"]?.[0] ?? "n/a";
  const titleSnippet = (sample?.title ?? "").slice(0, 70);

  console.log(
    `${p.name.padEnd(35)} HTTP 200  results=${String(data.results).padStart(8)} ` +
      `entries=${String(entries.length).padStart(2)} sample-collection=${collectionUrl} title="${titleSnippet}"`
  );
}

async function main() {
  const token = await getValidToken();
  console.log(`Got token`);
  console.log("probe".padEnd(35) + "  status / stats");
  console.log("-".repeat(140));
  for (const p of PROBES) {
    try {
      await probe(token, p);
    } catch (e) {
      console.error(`${p.name}: ${(e as Error).message}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

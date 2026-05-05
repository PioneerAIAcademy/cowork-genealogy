/**
 * f.collectionId is silently ignored on /platform/records/personas.
 * Probe alternate names and the lower-level service endpoint to see if
 * ANY way of scoping by collection works.
 *
 * Strategy:
 *  - Try alternate filter names (f.collection, f.collectionTitle, f.recordSource, f.sourceCollection).
 *  - Try the q.* namespace.
 *  - Try the service endpoint /service/search/hr/v2/personas with the same parameters.
 *  - Compare result counts to detect filtering vs. silent-ignore.
 */
import { getValidToken } from "../src/auth/refresh.js";

const PLATFORM = "https://api.familysearch.org/platform/records/personas";
const SERVICE = "https://www.familysearch.org/service/search/hr/v2/personas";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

interface Probe {
  name: string;
  base: "platform" | "service";
  q: string;
  ua?: string;
}

const COLLECTION_ID = "1743384"; // Alabama County Marriages, 1711-1992

const PROBES: Probe[] = [
  // Baselines
  { name: "PLAT/baseline-smith", base: "platform", q: "q.surname=Smith&count=3" },
  { name: "SVC /baseline-smith", base: "service", q: "q.surname=Smith&count=3" },

  // PLATFORM — alternate filter names
  { name: "PLAT/f.collection", base: "platform", q: `q.surname=Smith&f.collection=${COLLECTION_ID}&count=3` },
  { name: "PLAT/f.collectionTitle", base: "platform", q: `q.surname=Smith&f.collectionTitle=Alabama%20County%20Marriages&count=3` },
  { name: "PLAT/f.recordSource", base: "platform", q: `q.surname=Smith&f.recordSource=${COLLECTION_ID}&count=3` },
  { name: "PLAT/f.sourceCollection", base: "platform", q: `q.surname=Smith&f.sourceCollection=${COLLECTION_ID}&count=3` },
  { name: "PLAT/f.recordType", base: "platform", q: `q.surname=Smith&f.recordType=Marriage&count=3` },

  // PLATFORM — q.* namespace
  { name: "PLAT/q.collection", base: "platform", q: `q.surname=Smith&q.collection=${COLLECTION_ID}&count=3` },
  { name: "PLAT/q.collectionId", base: "platform", q: `q.surname=Smith&q.collectionId=${COLLECTION_ID}&count=3` },

  // SERVICE — same set, since service endpoint backs the FS UI's collection-scoped search
  { name: "SVC /f.collectionId", base: "service", q: `q.surname=Smith&f.collectionId=${COLLECTION_ID}&count=3` },
  { name: "SVC /f.collection", base: "service", q: `q.surname=Smith&f.collection=${COLLECTION_ID}&count=3` },
  { name: "SVC /f.recordSource", base: "service", q: `q.surname=Smith&f.recordSource=${COLLECTION_ID}&count=3` },
  { name: "SVC /collectionId", base: "service", q: `q.surname=Smith&collectionId=${COLLECTION_ID}&count=3` },
  { name: "SVC /collection", base: "service", q: `q.surname=Smith&collection=${COLLECTION_ID}&count=3` },
];

async function probe(token: string, p: Probe) {
  const base = p.base === "platform" ? PLATFORM : SERVICE;
  const url = `${base}?${p.q}`;
  const ua = p.ua ?? (p.base === "service" ? BROWSER_UA : "genealogy-mcp-server/0.0.1-probe");
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "User-Agent": ua,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    console.log(`${p.name.padEnd(38)} HTTP ${res.status} :: ${body.slice(0, 120).replace(/\s+/g, " ")}`);
    return;
  }

  const data = (await res.json()) as { results?: number; entries?: Array<{ id?: string; title?: string }> };
  const entries = data.entries ?? [];
  const firstId = entries[0]?.id ?? "n/a";
  const firstTitle = (entries[0]?.title ?? "").slice(0, 60);
  console.log(
    `${p.name.padEnd(38)} HTTP 200  results=${String(data.results).padStart(8)}  first.id=${firstId.padEnd(11)} title="${firstTitle}"`
  );
}

async function main() {
  const token = await getValidToken();
  console.log(`Got token\n`);
  console.log("probe".padEnd(38) + "  status / stats");
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

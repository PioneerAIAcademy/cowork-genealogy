/**
 * Probe candidate URLs to find a working FamilySearch records search
 * endpoint. The documented /platform/records/search returned 404 — try
 * lower-level service/search paths similar to what `collections` uses,
 * plus other plausible variants.
 */
import { getValidToken } from "../src/auth/refresh.js";
import { mkdir, writeFile } from "node:fs/promises";

const OUT_DIR = "/tmp/search-explore";
const QUERY = "?q.surname=Lincoln&q.givenName=Abraham&count=3";
const QUERY2 = "?surname=Lincoln&givenName=Abraham&count=3";

const candidates: { name: string; url: string; headers?: Record<string, string> }[] = [
  // www.familysearch.org service paths (mirror of collections approach)
  { name: "ep01-www-hr-v2-personas", url: `https://www.familysearch.org/service/search/hr/v2/personas${QUERY}` },
  { name: "ep02-www-hr-v2-records", url: `https://www.familysearch.org/service/search/hr/v2/records${QUERY}` },
  { name: "ep03-www-hr-v2-search", url: `https://www.familysearch.org/service/search/hr/v2/search${QUERY}` },
  { name: "ep04-www-hr-v2-personas-q", url: `https://www.familysearch.org/service/search/hr/v2/personas${QUERY2}` },
  // platform variants
  { name: "ep05-platform-search-personas", url: `https://api.familysearch.org/platform/search/personas${QUERY}` },
  { name: "ep06-platform-records-personas", url: `https://api.familysearch.org/platform/records/personas${QUERY}` },
  { name: "ep07-platform-search-records", url: `https://api.familysearch.org/platform/search/records${QUERY}` },
  // tree search
  { name: "ep08-platform-tree-search", url: `https://api.familysearch.org/platform/tree/search${QUERY}` },
  // plain search root
  { name: "ep09-platform-search", url: `https://api.familysearch.org/platform/search${QUERY}` },
  // www public records search
  { name: "ep10-www-records-search", url: `https://www.familysearch.org/records/search${QUERY}` },
  // searchapi pattern
  { name: "ep11-www-searchapi-personas", url: `https://www.familysearch.org/searchapi/personas${QUERY}` },
  // hr root listing
  { name: "ep12-www-hr-v2-root", url: `https://www.familysearch.org/service/search/hr/v2/${QUERY}` },
];

async function probe(token: string, c: typeof candidates[number]) {
  const browserUA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "User-Agent": browserUA,
    ...c.headers,
  };

  const res = await fetch(c.url, { headers });
  const body = await res.text();

  await writeFile(`${OUT_DIR}/${c.name}.txt`, [
    `URL: ${c.url}`,
    `Status: ${res.status} ${res.statusText}`,
    `Content-Type: ${res.headers.get("content-type")}`,
    `Body length: ${body.length}`,
    "",
    "== Body preview (first 1500c) ==",
    body.slice(0, 1500),
  ].join("\n"));

  if (body.length > 200 && res.ok) {
    await writeFile(`${OUT_DIR}/${c.name}.body.json`, body);
  }

  console.log(`${c.name.padEnd(35)} ${res.status} ${(res.headers.get("content-type") ?? "").slice(0, 30).padEnd(30)} ${body.length}c`);

  if (res.ok && body.length > 200) {
    try {
      const j = JSON.parse(body);
      console.log(`  ↳ keys: ${Object.keys(j).slice(0, 6).join(", ")}`);
    } catch {
      console.log("  ↳ (not JSON)");
    }
  } else if (!res.ok && body.length < 500) {
    console.log(`  ↳ ${body.replace(/\s+/g, " ").slice(0, 150)}`);
  }
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const token = await getValidToken();
  console.log(`Got token (${token.length} chars)\n`);

  for (const c of candidates) {
    try {
      await probe(token, c);
    } catch (e) {
      console.error(`${c.name} threw:`, (e as Error).message);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

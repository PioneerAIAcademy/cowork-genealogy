/**
 * Characterize the working search endpoint:
 *   https://www.familysearch.org/service/search/hr/v2/personas
 * Test: parameters, pagination, error cases, UA requirement,
 * count caps, date+place formats, total result counts.
 */
import { getValidToken } from "../src/auth/refresh.js";
import { mkdir, writeFile } from "node:fs/promises";

const OUT_DIR = "/tmp/search-explore/params";
const BASE = "https://www.familysearch.org/service/search/hr/v2/personas";
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

interface Probe {
  name: string;
  query: string;
  ua?: string;
}

async function run(token: string, p: Probe) {
  const url = `${BASE}?${p.query}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "User-Agent": p.ua ?? BROWSER_UA,
    },
  });
  const body = await res.text();

  await writeFile(`${OUT_DIR}/${p.name}.txt`, [
    `URL: ${url}`,
    `Status: ${res.status}`,
    `Body length: ${body.length}`,
    "",
    body.slice(0, 2000),
  ].join("\n"));

  let info = "";
  if (res.ok) {
    try {
      const j = JSON.parse(body);
      const nextLink = (j as { links?: { next?: { href: string } } }).links?.next?.href ?? null;
      info = `results=${j.results} index=${j.index} entries=${(j.entries ?? []).length} next=${nextLink ? "yes" : "no"}`;
    } catch {
      info = "(unparseable)";
    }
  } else {
    info = body.slice(0, 200).replace(/\s+/g, " ");
  }
  console.log(`${p.name.padEnd(35)} ${String(res.status).padEnd(4)} ${info}`);
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const token = await getValidToken();
  console.log(`Got token (${token.length} chars)\n`);

  const probes: Probe[] = [
    // Headers / UA
    { name: "01-default-ua", query: "q.surname=Lincoln&q.givenName=Abraham&count=3", ua: "genealogy-mcp-server/0.0.1" },
    { name: "02-no-ua", query: "q.surname=Lincoln&q.givenName=Abraham&count=3", ua: "" },
    // Single field
    { name: "03-surname-only", query: "q.surname=Lincoln&count=3" },
    { name: "04-given-only", query: "q.givenName=Abraham&count=3" },
    // Year fields
    { name: "05-birth-year", query: "q.surname=Lincoln&q.givenName=Abraham&q.birthLikeDate=1809&count=3" },
    { name: "06-death-year", query: "q.surname=Lincoln&q.givenName=Abraham&q.deathLikeDate=1865&count=3" },
    // Place fields
    { name: "07-birth-place", query: "q.surname=Lincoln&q.givenName=Abraham&q.birthLikePlace=Kentucky&count=3" },
    { name: "08-death-place", query: "q.surname=Lincoln&q.givenName=Abraham&q.deathLikePlace=Washington%20DC&count=3" },
    // Combined
    { name: "09-combined", query: "q.surname=Lincoln&q.givenName=Abraham&q.birthLikeDate=1809&q.birthLikePlace=Kentucky&count=3" },
    // Gender
    { name: "10-gender-male", query: "q.surname=Lincoln&q.gender=Male&count=3" },
    { name: "11-gender-female", query: "q.surname=Lincoln&q.gender=Female&count=3" },
    // Empty / no-params
    { name: "12-no-params", query: "count=3" },
    { name: "13-only-count", query: "count=0" },
    // No-results
    { name: "14-no-results", query: "q.surname=Zzzqxywv&q.givenName=Qqqxxyy&count=3" },
    // Pagination
    { name: "15-offset-10", query: "q.surname=Smith&count=5&offset=10" },
    { name: "16-offset-far", query: "q.surname=Smith&count=5&offset=10000" },
    // Count caps
    { name: "17-count-50", query: "q.surname=Smith&count=50" },
    { name: "18-count-200", query: "q.surname=Smith&count=200" },
    { name: "19-count-1000", query: "q.surname=Smith&count=1000" },
    // Year ranges via date format
    { name: "20-date-range", query: "q.surname=Lincoln&q.birthLikeDate=1800-1820&count=3" },
    { name: "21-date-with-month", query: "q.surname=Lincoln&q.birthLikeDate=12%20Feb%201809&count=3" },
    // Place name vs place id
    { name: "22-place-full-name", query: "q.surname=Lincoln&q.birthLikePlace=Hodgenville,%20Kentucky&count=3" },
    // Spouse / parent fields (sometimes supported)
    { name: "23-spouse-name", query: "q.surname=Lincoln&q.spouseGivenName=Mary&count=3" },
    { name: "24-father-surname", query: "q.surname=Lincoln&q.fatherSurname=Lincoln&count=3" },
    { name: "25-mother-given", query: "q.surname=Lincoln&q.motherGivenName=Nancy&count=3" },
    // Special chars in name
    { name: "26-special-chars", query: "q.surname=O%27Brien&count=3" },
    // Less common name
    { name: "27-less-common", query: "q.surname=Quesnelle&count=3" },
  ];

  for (const p of probes) {
    try {
      await run(token, p);
    } catch (e) {
      console.error(`${p.name}: ${(e as Error).message}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

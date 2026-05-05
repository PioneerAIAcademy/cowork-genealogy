/**
 * Exploration script for the FamilySearch records search API.
 * Run several queries against /platform/records/search and report
 * back the response shape, headers, status codes, and pagination
 * semantics. NOT a smoke test for a shipped tool — this is the
 * pre-spec research script. Outputs raw JSON to /tmp/search-explore/.
 */
import { getValidToken } from "../src/auth/refresh.js";
import { mkdir, writeFile } from "node:fs/promises";

const OUT_DIR = "/tmp/search-explore";
const PLATFORM_BASE = "https://api.familysearch.org/platform/records/search";

interface Probe {
  name: string;
  url: string;
  headers?: Record<string, string>;
}

async function probe(token: string, p: Probe): Promise<void> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "User-Agent": "genealogy-mcp-server/0.0.1-explore",
    ...p.headers,
  };

  const res = await fetch(p.url, { headers });
  const body = await res.text();

  const lines: string[] = [];
  lines.push(`# Probe: ${p.name}`);
  lines.push(`URL: ${p.url}`);
  lines.push(`Status: ${res.status} ${res.statusText}`);
  lines.push(`Content-Type: ${res.headers.get("content-type") ?? "-"}`);
  lines.push(`Content-Length: ${body.length} chars`);
  lines.push("");
  lines.push("== Response headers ==");
  for (const [k, v] of res.headers.entries()) {
    lines.push(`${k}: ${v}`);
  }
  lines.push("");
  lines.push("== Body (first 2000 chars) ==");
  lines.push(body.slice(0, 2000));

  await writeFile(`${OUT_DIR}/${p.name}.txt`, lines.join("\n"));
  await writeFile(`${OUT_DIR}/${p.name}.body.json`, body);

  // Also print top-level structure to console
  console.log(`\n=== ${p.name} ===`);
  console.log(`Status: ${res.status}, Content-Type: ${res.headers.get("content-type")}, Body: ${body.length}c`);
  if (res.ok && body.trim().startsWith("{")) {
    try {
      const j = JSON.parse(body);
      console.log("Top-level keys:", Object.keys(j));
      if (Array.isArray((j as { entries?: unknown[] }).entries)) {
        const entries = (j as { entries: unknown[] }).entries;
        console.log(`entries.length: ${entries.length}`);
        if (entries.length > 0) {
          console.log("entries[0] keys:", Object.keys(entries[0] as object));
        }
      }
      // Look for typical pagination fields
      const interesting = ["index", "results", "count", "total", "rows", "links"];
      for (const k of interesting) {
        if (k in (j as Record<string, unknown>)) {
          const v = (j as Record<string, unknown>)[k];
          console.log(`${k}:`, typeof v === "object" ? JSON.stringify(v).slice(0, 200) : v);
        }
      }
    } catch {
      console.log("(body not parseable as JSON)");
    }
  } else if (!res.ok) {
    console.log("Body preview:", body.slice(0, 300));
  }
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const token = await getValidToken();
  console.log(`Got token (${token.length} chars)`);

  const probes: Probe[] = [
    // 1. Documented endpoint, plain JSON Accept
    {
      name: "01-basic-surname",
      url: `${PLATFORM_BASE}?q.surname=Lincoln&q.givenName=Abraham&count=5`,
    },
    // 2. With birth year
    {
      name: "02-with-birthyear",
      url: `${PLATFORM_BASE}?q.surname=Lincoln&q.givenName=Abraham&q.birthLikeDate=1809&count=5`,
    },
    // 3. With birth place
    {
      name: "03-with-birthplace",
      url: `${PLATFORM_BASE}?q.surname=Lincoln&q.givenName=Abraham&q.birthLikePlace=Kentucky&count=5`,
    },
    // 4. Different Accept header — gedcomx
    {
      name: "04-gedcomx-accept",
      url: `${PLATFORM_BASE}?q.surname=Lincoln&q.givenName=Abraham&count=3`,
      headers: { Accept: "application/x-gedcomx-atom+json" },
    },
    // 5. No params (should error or return nothing useful)
    {
      name: "05-no-params",
      url: `${PLATFORM_BASE}`,
    },
    // 6. Surname only
    {
      name: "06-surname-only",
      url: `${PLATFORM_BASE}?q.surname=Smith&count=5`,
    },
    // 7. High count
    {
      name: "07-large-count",
      url: `${PLATFORM_BASE}?q.surname=Lincoln&count=100`,
    },
    // 8. Browser UA (in case WAF kicks in for some queries)
    {
      name: "08-browser-ua",
      url: `${PLATFORM_BASE}?q.surname=Lincoln&q.givenName=Abraham&count=3`,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
      },
    },
    // 9. Death info
    {
      name: "09-death-fields",
      url: `${PLATFORM_BASE}?q.surname=Lincoln&q.givenName=Abraham&q.deathLikeDate=1865&q.deathLikePlace=Washington&count=3`,
    },
    // 10. Gender
    {
      name: "10-gender",
      url: `${PLATFORM_BASE}?q.surname=Lincoln&q.givenName=Abraham&q.gender=Male&count=3`,
    },
    // 11. Offset / pagination
    {
      name: "11-offset",
      url: `${PLATFORM_BASE}?q.surname=Smith&count=5&start=10`,
    },
    // 12. Junk query
    {
      name: "12-no-results",
      url: `${PLATFORM_BASE}?q.surname=Zzzqxywv&q.givenName=Qqqxxyy&count=5`,
    },
  ];

  for (const p of probes) {
    try {
      await probe(token, p);
    } catch (e) {
      console.error(`Probe ${p.name} threw:`, e);
    }
  }

  console.log(`\nAll probe outputs saved to ${OUT_DIR}/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

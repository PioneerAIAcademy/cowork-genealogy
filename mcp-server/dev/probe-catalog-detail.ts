/**
 * Probe 2 — Catalog item detail endpoint.
 *
 * Probe 1 showed each searchHits[i].metadataHit.metadata.identifier.value
 * is a URL of the form:
 *   https://www.familysearch.org/service/search/catalog/item/koha:1837843
 *
 * Questions this probe answers:
 *
 *   A. Does that identifier URL resolve to a JSON detail endpoint?
 *
 *   B. Are there alternate detail endpoints (e.g. /platform/records/catalog/...,
 *      /service/search/catalog/v3/item/..., bare-id without `koha:`)?
 *
 *   C. What additional fields does detail return beyond the list shape
 *      (subjects, ISBN, call numbers, subtitles, full coverage)?
 *
 *   D. What does the user-facing URL pattern look like (HTML vs JSON,
 *      302 redirect to a real API, etc.)?
 *
 * Default test ID: koha:1837843 (the Alabama Civil War book from probe 1).
 * Pass another ID as the first arg to test different item types.
 *
 *   npx tsx dev/probe-catalog-detail.ts
 *   npx tsx dev/probe-catalog-detail.ts koha:1837843
 */

import { getValidToken } from "../src/auth/refresh.js";
import { BROWSER_USER_AGENT } from "../src/constants.js";

const DEFAULT_ID = "koha:1837843";

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function dump(label: string, value: unknown, depth = 0, maxDepth = 6): void {
  const pad = "  ".repeat(depth);

  if (value === null) {
    console.log(`${pad}${label}: null`);
    return;
  }
  if (Array.isArray(value)) {
    console.log(`${pad}${label}: [] length=${value.length}`);
    if (value.length > 0 && depth < maxDepth) {
      dump("[0]", value[0], depth + 1, maxDepth);
    }
    return;
  }
  if (!isPlainObject(value)) {
    const s = JSON.stringify(value);
    const preview = s.length > 200 ? `${s.slice(0, 197)}...` : s;
    console.log(`${pad}${label}: <${typeof value}> ${preview}`);
    return;
  }

  console.log(`${pad}${label}: { keys: [${Object.keys(value).join(", ")}] }`);
  if (depth >= maxDepth) return;
  for (const k of Object.keys(value)) {
    dump(k, value[k], depth + 1, maxDepth);
  }
}

interface Probe {
  label: string;
  url: string;
  acceptJson: boolean;
  followRedirects: boolean;
}

async function hit(token: string, probe: Probe): Promise<void> {
  console.log(`\n--- [${probe.label}] ---`);
  console.log(`URL: ${probe.url}`);

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "User-Agent": BROWSER_USER_AGENT,
  };
  if (probe.acceptJson) {
    headers.Accept = "application/json";
  }

  let res: Response;
  try {
    res = await fetch(probe.url, {
      headers,
      redirect: probe.followRedirects ? "follow" : "manual",
    });
  } catch (err) {
    console.log(`FETCH ERROR: ${(err as Error).message}`);
    return;
  }

  console.log(`HTTP ${res.status} ${res.statusText}`);
  console.log(`Content-Type: ${res.headers.get("content-type") ?? "(none)"}`);
  const location = res.headers.get("location");
  if (location) console.log(`Location: ${location}`);

  const bodyText = await res.text();
  if (!res.ok && res.status !== 301 && res.status !== 302) {
    console.log(`Body (first 400c): ${bodyText.slice(0, 400)}`);
    return;
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("json")) {
    console.log(`Body length: ${bodyText.length} chars (non-JSON)`);
    console.log(`Body (first 400c): ${bodyText.slice(0, 400)}`);
    return;
  }

  let data: unknown;
  try {
    data = JSON.parse(bodyText);
  } catch {
    console.log(`Non-JSON body (first 400c): ${bodyText.slice(0, 400)}`);
    return;
  }

  if (isPlainObject(data)) {
    console.log(`Top-level keys: [${Object.keys(data).join(", ")}]`);
    console.log(`\nStructure:`);
    for (const k of Object.keys(data)) {
      dump(k, data[k]);
    }
    console.log(`\nFull body (first 4000c):`);
    console.log(JSON.stringify(data, null, 2).slice(0, 4000));
  } else if (Array.isArray(data)) {
    console.log(`Top-level: array length=${data.length}`);
    if (data.length > 0) dump("[0]", data[0]);
  }
}

async function main(): Promise<void> {
  const id = process.argv[2] ?? DEFAULT_ID;
  console.log(`Probing catalog detail for ID: ${id}\n`);

  const token = await getValidToken();

  const bareId = id.includes(":") ? id.split(":")[1] : id;

  const probes: Probe[] = [
    {
      label: "1. /service/search/catalog/item/{id}  (URL from identifier field)",
      url: `https://www.familysearch.org/service/search/catalog/item/${encodeURIComponent(id)}`,
      acceptJson: true,
      followRedirects: false,
    },
    {
      label: "2. /service/search/catalog/v3/item/{id}  (versioned variant)",
      url: `https://www.familysearch.org/service/search/catalog/v3/item/${encodeURIComponent(id)}`,
      acceptJson: true,
      followRedirects: false,
    },
    {
      label: "3. /service/search/catalog/item/{bare-id}  (without koha: prefix)",
      url: `https://www.familysearch.org/service/search/catalog/item/${encodeURIComponent(bareId)}`,
      acceptJson: true,
      followRedirects: false,
    },
    {
      label: "4. /platform/records/catalog/{id}  (platform-API guess)",
      url: `https://api.familysearch.org/platform/records/catalog/${encodeURIComponent(id)}`,
      acceptJson: true,
      followRedirects: false,
    },
    {
      label: "5. /search/catalog/{bare-id}  (user-facing URL — HTML expected)",
      url: `https://www.familysearch.org/search/catalog/${encodeURIComponent(bareId)}`,
      acceptJson: false,
      followRedirects: false,
    },
  ];

  for (const p of probes) {
    await hit(token, p);
  }

  console.log("\n================================================================");
  console.log("DONE");
  console.log("================================================================");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

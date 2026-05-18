/**
 * Probe 1 — Catalog API basic shape and auth requirement.
 *
 * Evidence trail behind a future `docs/specs/catalog-tool-spec.md`.
 *
 * Sample URL from the FamilySearch internal Atlassian page
 * (https://icseng.atlassian.net/wiki/spaces/Product/pages/814383280/Catalog+Search+API):
 *
 *   GET /service/search/catalog/v3/search
 *     ?m.defaultFacets=off
 *     &m.queryRequireDefault=on
 *     &q.place=Alabama%2C%20United%20States
 *     &q.place.exact=on
 *
 * Questions this probe answers:
 *
 *   1. Does the endpoint require OAuth, or is it public (no Bearer)?
 *      Compares the same URL with and without `Authorization`.
 *
 *   2. What HTTP status / content-type comes back?
 *      Verifies the WAF (Imperva) lets us through with the
 *      shared BROWSER_USER_AGENT.
 *
 *   3. What is the top-level response shape?
 *      Captures the JSON keys at the root, e.g. `entries`,
 *      `facets`, `count`, etc.
 *
 *   4. What does ONE entry look like?
 *      Dumps the first entry's nested structure so we know
 *      which fields we'd surface in an MCP tool.
 *
 * Usage:
 *   npx tsx dev/probe-catalog-basic.ts
 *   npx tsx dev/probe-catalog-basic.ts --auth      # also try authed
 */

import { BROWSER_USER_AGENT } from "../src/constants.js";

const SAMPLE_URL =
  "https://www.familysearch.org/service/search/catalog/v3/search" +
  "?m.defaultFacets=off" +
  "&m.queryRequireDefault=on" +
  "&q.place=Alabama%2C%20United%20States" +
  "&q.place.exact=on";

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function dump(label: string, value: unknown, depth = 0, maxDepth = 5): void {
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

async function hit(label: string, url: string, withAuth: boolean): Promise<unknown | null> {
  console.log(`\n--- [${label}] ---`);
  console.log(`URL: ${url}`);
  console.log(`Authorization: ${withAuth ? "Bearer <token>" : "(none)"}`);

  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": BROWSER_USER_AGENT,
  };

  if (withAuth) {
    const { getValidToken } = await import("../src/auth/refresh.js");
    try {
      const token = await getValidToken();
      headers.Authorization = `Bearer ${token}`;
    } catch (err) {
      console.log(`SKIPPED — getValidToken() threw: ${(err as Error).message}`);
      return null;
    }
  }

  let res: Response;
  try {
    res = await fetch(url, { headers });
  } catch (err) {
    console.log(`FETCH ERROR: ${(err as Error).message}`);
    return null;
  }

  console.log(`HTTP ${res.status} ${res.statusText}`);
  console.log(`Content-Type: ${res.headers.get("content-type") ?? "(none)"}`);

  const bodyText = await res.text();
  if (!res.ok) {
    console.log(`Body (first 600c): ${bodyText.slice(0, 600)}`);
    return null;
  }

  let data: unknown;
  try {
    data = JSON.parse(bodyText);
  } catch {
    console.log(`Non-JSON body (first 400c): ${bodyText.slice(0, 400)}`);
    return null;
  }

  if (isPlainObject(data)) {
    console.log(`Top-level keys: [${Object.keys(data).join(", ")}]`);
  } else if (Array.isArray(data)) {
    console.log(`Top-level: array length=${data.length}`);
  } else {
    console.log(`Top-level: <${typeof data}>`);
  }
  return data;
}

async function main(): Promise<void> {
  const tryAuth = process.argv.includes("--auth");

  console.log("================================================================");
  console.log("SECTION A — Anonymous request to the sample URL");
  console.log("================================================================");
  const anon = await hit("anon", SAMPLE_URL, false);

  let authed: unknown | null = null;
  if (tryAuth) {
    console.log("\n================================================================");
    console.log("SECTION B — Same URL with OAuth bearer (if logged in)");
    console.log("================================================================");
    authed = await hit("authed", SAMPLE_URL, true);
  }

  const usable = isPlainObject(authed) ? authed : isPlainObject(anon) ? anon : null;
  const source = isPlainObject(authed) ? "authed" : "anon";

  if (!usable) {
    console.log("\n(no usable response — stopping before deep dump)");
    return;
  }

  console.log("\n================================================================");
  console.log(`SECTION C — Top-level structure dump (${source} response)`);
  console.log("================================================================");
  for (const key of Object.keys(usable)) {
    console.log(`\n---- ${key} ----`);
    dump(key, usable[key]);
  }

  console.log("\n================================================================");
  console.log(`SECTION D — Inspect ONE hit's full body (${source} response)`);
  console.log("================================================================");
  const hits = (usable as { searchHits?: unknown; entries?: unknown }).searchHits
    ?? (usable as { entries?: unknown }).entries;
  if (Array.isArray(hits) && hits.length > 0) {
    console.log(JSON.stringify(hits[0], null, 2));
  } else {
    console.log("(no array of hits found — printing first 4000c of raw body instead)");
    console.log(JSON.stringify(usable, null, 2).slice(0, 4000));
  }

  console.log("\n================================================================");
  console.log(`SECTION E — totalHits / pagination (${source})`);
  console.log("================================================================");
  console.log(`totalHits: ${JSON.stringify((usable as Record<string, unknown>).totalHits)}`);
  console.log(`offset:    ${JSON.stringify((usable as Record<string, unknown>).offset)}`);
  if (Array.isArray(hits)) {
    console.log(`searchHits.length: ${hits.length}`);
  }

  console.log("\n================================================================");
  console.log("DONE");
  console.log("================================================================");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

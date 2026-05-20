/**
 * Probe the FamilySearch full-text search API to discover response shape.
 * Requires a valid FamilySearch session (run try-login.ts first).
 *
 * Usage: npx tsx dev/probe-fulltext-search.ts
 */

import { getValidToken } from "../src/auth/refresh.js";
import { BROWSER_USER_AGENT } from "../src/constants.js";

const BASE_URL =
  "https://www.familysearch.org/service/search/fulltext/search";

async function probe() {
  const token = await getValidToken();

  // Sample query from the GitHub issue
  const params = new URLSearchParams({
    "q.text": "Deed",
    "q.fullName": '"John Doe"',
    count: "2",
    "m.defaultFacets": "on",
    "m.queryRequireDefault": "on",
  });

  const url = `${BASE_URL}?${params}`;
  console.log("URL:", url);
  console.log();

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "User-Agent": BROWSER_USER_AGENT,
    },
  });

  console.log("Status:", response.status, response.statusText);
  console.log();

  if (!response.ok) {
    const body = await response.text();
    console.error("Error body:", body.slice(0, 500));
    process.exit(1);
  }

  const data = await response.json();

  // Show top-level keys
  console.log("Top-level keys:", Object.keys(data));
  console.log("results:", data.results);
  console.log("index:", data.index);
  console.log("links:", JSON.stringify(data.links));
  console.log();

  // Show first entry structure (truncate textDocument)
  if (data.entries?.length) {
    const entry = JSON.parse(JSON.stringify(data.entries[0]));
    if (entry.content?.textDocument) {
      entry.content.textDocument = entry.content.textDocument.slice(0, 200) + "...";
    }
    console.log("First entry keys:", Object.keys(entry));
    console.log("First entry:", JSON.stringify(entry, null, 2));
  }

  // Show facets if present
  if (data.facets) {
    console.log("\nFacets:", JSON.stringify(data.facets, null, 2).slice(0, 2000));
  }

  // Show contexts if present
  if (data.contexts) {
    console.log("\nContexts:", JSON.stringify(data.contexts).slice(0, 500));
  }
}

probe().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

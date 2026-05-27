/**
 * Live-API evidence probe for the four match-by-id tools (Issue #176).
 *
 * Hits https://sg30p0.familysearch.org/search/match/resolutions/match/matches
 * with each of the four (collection, id-prefix) combinations:
 *
 *   1. person_record_matches:  collection=records, id=ark:/61903/4:1:...
 *   2. record_person_matches:  collection=tree,    id=ark:/61903/1:1:...
 *   3. person_person_matches:  collection=tree,    id=ark:/61903/4:1:...
 *   4. record_record_matches:  collection=records, id=ark:/61903/1:1:...
 *
 * Usage:
 *   npx tsx dev/probe-match-by-id.ts                       # uses the issue's example ARKs
 *   npx tsx dev/probe-match-by-id.ts <pid> <recordId>      # supply your own ids (no ark prefix)
 *
 * Prints status, full body for each call, and a small summary.
 */
import { getValidToken } from "../src/auth/refresh.js";
import { BROWSER_USER_AGENT } from "../src/constants.js";

const API = "https://sg30p0.familysearch.org/search/match/resolutions/match/matches";

const personPid = process.argv[2] ?? "KD96-TV2"; // tree person
const recordPid = process.argv[3] ?? "QVK1-LK96"; // record persona

function buildUrl(collection: "records" | "tree", arkId: string): string {
  const params = new URLSearchParams();
  params.set("collection", collection);
  params.set("id", arkId);
  params.set("includeFlags", "true");
  params.set("minConfidence", "1");
  params.set("includeSummary", "true");
  // status= can repeat
  params.append("status", "accepted");
  params.append("status", "pending");
  params.append("status", "rejected");
  return `${API}?${params.toString()}`;
}

async function probe(label: string, collection: "records" | "tree", arkId: string, token: string) {
  const url = buildUrl(collection, arkId);
  console.log(`\n=== ${label} ===`);
  console.log(`URL: ${url}`);
  const t0 = Date.now();
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "User-Agent": BROWSER_USER_AGENT,
      },
    });
  } catch (err) {
    console.log(`NETWORK ERROR: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  const ms = Date.now() - t0;
  console.log(`Status: ${res.status} ${res.statusText} (${ms}ms)`);
  console.log(`Content-Type: ${res.headers.get("content-type")}`);
  const text = await res.text();
  console.log(`Body length: ${text.length} chars`);
  // Try to parse JSON; if it works, pretty-print, else dump first 800 chars.
  try {
    const json = JSON.parse(text);
    console.log("Body (JSON):");
    console.log(JSON.stringify(json, null, 2));
  } catch {
    console.log(`Body (raw, first 800):\n${text.slice(0, 800)}`);
  }
}

const token = await getValidToken();
console.log(`Got token: ${token.slice(0, 6)}... (len=${token.length})`);

await probe("1. person_record_matches", "records", `ark:/61903/4:1:${personPid}`, token);
await probe("2. record_person_matches", "tree", `ark:/61903/1:1:${recordPid}`, token);
await probe("3. person_person_matches", "tree", `ark:/61903/4:1:${personPid}`, token);
await probe("4. record_record_matches", "records", `ark:/61903/1:1:${recordPid}`, token);

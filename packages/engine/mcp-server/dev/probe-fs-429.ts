/**
 * Probe — evidence trail for the retry-budget decision in issue #2054.
 *
 * Hammers one anonymous FamilySearch endpoint until it 429s and records:
 *   1. Whether a `Retry-After` header is present on the 429 response.
 *   2. Whether it is numeric (delay-seconds) or HTTP-date form.
 *   3. What value it carries.
 *
 * Nothing in the repo knows this today. The retry helper in src/utils/http.ts
 * parses Retry-After when present and uses it as the next delay if it fits
 * inside the remaining budget; this probe documents what FamilySearch actually
 * sends so the budget and parse logic are grounded in observation.
 *
 * Target: the external-links-search endpoint, which is anonymous (no token)
 * and known to throttle under rapid fire. We hit it in a tight loop with a
 * valid placeId until it 429s, then print the headers.
 *
 * Run:  npx tsx dev/probe-fs-429.ts
 * No token needed.
 */

import { fetchWithTimeout } from "../src/utils/http.js";
import { BROWSER_USER_AGENT } from "../src/constants.js";

const FS_EXTERNAL_URL =
  "https://www.familysearch.org/service/search/hr/external/collections/search";

// A placeId known to return results (United States). Swap if it stops working.
const PLACE_ID = "2728";

const MAX_REQUESTS = 500;

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  console.log("probe-fs-429: hammering external-links-search for a 429...\n");
  console.log(`  endpoint: ${FS_EXTERNAL_URL}`);
  console.log(`  placeId:  ${PLACE_ID}`);
  console.log(`  max requests: ${MAX_REQUESTS}\n`);

  const url = `${FS_EXTERNAL_URL}?q.placeId=${PLACE_ID}&offset=0&count=1`;

  let status429Count = 0;
  let otherErrorCount = 0;

  for (let i = 1; i <= MAX_REQUESTS; i++) {
    let res: Response;
    try {
      res = await fetchWithTimeout(url, {
        headers: {
          "User-Agent": BROWSER_USER_AGENT,
          Accept: "application/json",
        },
      });
    } catch (err) {
      otherErrorCount++;
      console.log(`  [${i}] FETCH ERROR: ${err instanceof Error ? err.message : String(err)}`);
      // Brief pause on transport failure before continuing
      await sleep(500);
      continue;
    }

    if (res.status === 429) {
      status429Count++;
      const retryAfter = res.headers.get("retry-after");
      const allHeaders: Record<string, string> = {};
      res.headers.forEach((v, k) => {
        allHeaders[k] = v;
      });

      console.log(`\n  === 429 HIT on request #${i} ===`);
      console.log(`  Retry-After header: ${retryAfter ?? "(absent)"}`);
      if (retryAfter !== null) {
        const trimmed = retryAfter.trim();
        const isNumeric = /^\d+$/.test(trimmed);
        console.log(`    Form: ${isNumeric ? "numeric (delay-seconds)" : "non-numeric (HTTP-date or other)"}`);
        if (isNumeric) {
          console.log(`    Value: ${trimmed} seconds (${Number(trimmed) * 1000}ms)`);
        } else {
          console.log(`    Raw value: "${trimmed}"`);
        }
      }
      console.log(`  All response headers:`);
      for (const [k, v] of Object.entries(allHeaders)) {
        console.log(`    ${k}: ${v}`);
      }

      // Keep going to see if subsequent requests also 429
      if (status429Count >= 5) {
        console.log(`\n  Collected ${status429Count} 429s. Stopping.`);
        break;
      }
      // Wait a moment before next request to observe cooldown behavior
      await sleep(1000);
      continue;
    }

    if (!res.ok) {
      otherErrorCount++;
      console.log(`  [${i}] HTTP ${res.status} ${res.statusText}`);
      continue;
    }

    // Success — just log the count periodically
    if (i % 50 === 0 || i === 1) {
      console.log(`  [${i}] HTTP ${res.status} OK`);
    }
  }

  console.log(`\n--- Summary ---`);
  console.log(`  429 responses: ${status429Count}`);
  console.log(`  Other errors:  ${otherErrorCount}`);
  if (status429Count === 0) {
    console.log(
      `  NOT MEASURED: no 429 was triggered in ${MAX_REQUESTS} requests.` +
        ` The endpoint may not throttle anonymous requests at this rate,` +
        ` or the threshold is higher than ${MAX_REQUESTS} requests.`
    );
  }
}

main().catch((err) => {
  console.error("probe-fs-429 failed:", err);
  process.exit(1);
});

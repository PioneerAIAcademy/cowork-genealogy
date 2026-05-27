/**
 * Variant probes: try the match endpoint with progressively-relaxed params,
 * and try the alternate www host as well, to find what produces non-empty results.
 */
import { getValidToken } from "../src/auth/refresh.js";
import { BROWSER_USER_AGENT } from "../src/constants.js";

const SG30 = "https://sg30p0.familysearch.org/search/match/resolutions/match/matches";
const WWW = "https://www.familysearch.org/search/match/resolutions/match/matches";
const API_FS = "https://api.familysearch.org/search/match/resolutions/match/matches";

async function call(label: string, url: string, token: string) {
  console.log(`\n--- ${label} ---`);
  console.log(`GET ${url}`);
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
    console.log(`NETWORK ERR: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  const ms = Date.now() - t0;
  const body = await res.text();
  console.log(`${res.status} ${res.statusText} (${ms}ms) ct=${res.headers.get("content-type")} len=${body.length}`);
  if (body.length < 4000) {
    console.log(body);
  } else {
    console.log(body.slice(0, 1500) + "\n...[truncated]...");
  }
}

const token = await getValidToken();
console.log(`token=${token.slice(0, 6)}... len=${token.length}`);

const ark41 = "ark:/61903/4:1:KNDX-MKG"; // George Washington tree person

// 1: basic (sg30p0) with all status
await call(
  "sg30p0, all statuses, conf=2",
  `${SG30}?collection=records&id=${encodeURIComponent(ark41)}&includeFlags=true&minConfidence=2&includeSummary=false&status=accepted&status=pending&status=rejected`,
  token
);

// 2: only accepted
await call(
  "sg30p0, status=accepted only",
  `${SG30}?collection=records&id=${encodeURIComponent(ark41)}&minConfidence=1&status=accepted`,
  token
);

// 3: no status filter at all
await call(
  "sg30p0, no status param",
  `${SG30}?collection=records&id=${encodeURIComponent(ark41)}&minConfidence=1`,
  token
);

// 4: includeSummary=true, minimal otherwise
await call(
  "sg30p0, includeSummary=true minimal",
  `${SG30}?collection=records&id=${encodeURIComponent(ark41)}&includeSummary=true`,
  token
);

// 5: www host
await call(
  "www host",
  `${WWW}?collection=records&id=${encodeURIComponent(ark41)}&includeFlags=true&minConfidence=2&status=accepted&status=pending`,
  token
);

// 6: api.familysearch.org host
await call(
  "api.familysearch.org host",
  `${API_FS}?collection=records&id=${encodeURIComponent(ark41)}&includeFlags=true&minConfidence=2&status=accepted&status=pending`,
  token
);

// 7: bare pid (no ark prefix) just in case
await call(
  "sg30p0, bare pid as id",
  `${SG30}?collection=records&id=KNDX-MKG&includeFlags=true&minConfidence=2&status=accepted&status=pending`,
  token
);

// 8: invalid ark — see what error shape
await call(
  "sg30p0, malformed ark",
  `${SG30}?collection=records&id=ark:/61903/9:9:NOTREAL&includeFlags=true&minConfidence=2`,
  token
);

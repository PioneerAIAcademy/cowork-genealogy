/**
 * Pin down the status= behavior: does the API accept multiple values?
 * Test each combination explicitly against KNDX-MKG (George Washington — known
 * to have at least one Accepted match in the resolutions store).
 */
import { getValidToken } from "../src/auth/refresh.js";
import { BROWSER_USER_AGENT } from "../src/constants.js";

const SG30 = "https://sg30p0.familysearch.org/search/match/resolutions/match/matches";

async function probe(label: string, qs: string, token: string): Promise<void> {
  const url = `${SG30}?${qs}`;
  const t0 = Date.now();
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "User-Agent": BROWSER_USER_AGENT,
    },
  });
  const ms = Date.now() - t0;
  const text = await res.text();
  console.log(`\n--- ${label} ---`);
  console.log(`  ${res.status} ${res.statusText} (${ms}ms) len=${text.length}`);
  try {
    const j = JSON.parse(text);
    const entries = j.entries?.length ?? "?";
    const link = j.links?.self?.href ?? "";
    const results = j.results ?? "?";
    console.log(`  entries.length=${entries} results=${results}`);
    console.log(`  links.self.href=${link}`);
    if (j.entries?.length) {
      console.log(`  first.id=${j.entries[0].id} confidence=${j.entries[0].confidence} matchInfo=${JSON.stringify(j.entries[0].matchInfo)}`);
    }
  } catch {
    console.log(`  body=${text.slice(0, 200)}`);
  }
}

const token = await getValidToken();
const id = encodeURIComponent("ark:/61903/4:1:KNDX-MKG");
const base = `collection=records&id=${id}&minConfidence=1`;

await probe("only accepted", `${base}&status=accepted`, token);
await probe("only pending", `${base}&status=pending`, token);
await probe("only rejected", `${base}&status=rejected`, token);
await probe("accepted + pending (2)", `${base}&status=accepted&status=pending`, token);
await probe("accepted + pending + rejected (3)", `${base}&status=accepted&status=pending&status=rejected`, token);
await probe("uppercase Accepted", `${base}&status=Accepted`, token);
await probe("URI form", `${base}&status=${encodeURIComponent("http://familysearch.org/v1/Accepted")}`, token);
await probe("no status param", base, token);
await probe("status=accepted with count=20", `${base}&status=accepted&count=20`, token);
await probe("status=accepted with includeSummary=true", `${base}&status=accepted&includeSummary=true`, token);
await probe("status=accepted with includeFlags=true", `${base}&status=accepted&includeFlags=true`, token);

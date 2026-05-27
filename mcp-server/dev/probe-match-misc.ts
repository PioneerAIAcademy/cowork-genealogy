/**
 * Misc probes:
 * 1. What values does includeFlags actually accept? (the docs say "true" but it
 *    causes a silent empty response — see probe-match-status output.)
 * 2. Probe the other 3 tool shapes (record_person, person_person, record_record)
 *    against the Abraham Lincoln record ARK (QPTX-TMQ2) and tree pids returned
 *    from the search.
 * 3. Probe includeSummary=true on populated responses to see the extra shape.
 */
import { getValidToken } from "../src/auth/refresh.js";
import { BROWSER_USER_AGENT } from "../src/constants.js";

const SG30 = "https://sg30p0.familysearch.org/search/match/resolutions/match/matches";

async function call(label: string, qs: string, token: string): Promise<void> {
  const t0 = Date.now();
  const res = await fetch(`${SG30}?${qs}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "User-Agent": BROWSER_USER_AGENT,
    },
  });
  const ms = Date.now() - t0;
  const text = await res.text();
  console.log(`\n=== ${label} ===`);
  console.log(`  ${res.status} ${res.statusText} (${ms}ms) len=${text.length}`);
  try {
    const j = JSON.parse(text);
    const entries = j.entries?.length ?? "?";
    const results = j.results ?? "?";
    const link = j.links?.self?.href ?? "(none)";
    console.log(`  entries.length=${entries} results=${results}`);
    console.log(`  links.self.href=${link}`);
    if (j.entries?.length && label.includes("FULL")) {
      console.log(`  FIRST ENTRY:\n${JSON.stringify(j.entries[0], null, 2)}`);
    } else if (j.entries?.length) {
      console.log(`  entry[0].id=${j.entries[0].id} conf=${j.entries[0].confidence} title=${j.entries[0].title}`);
    }
  } catch {
    console.log(`  body=${text.slice(0, 200)}`);
  }
}

const token = await getValidToken();
const ark41 = encodeURIComponent("ark:/61903/4:1:KNDX-MKG"); // GW tree person
const ark11 = encodeURIComponent("ark:/61903/1:1:QPTX-TMQ2"); // Lincoln record

const idKW = `collection=records&id=${ark41}&minConfidence=1&status=accepted`;

// includeFlags variants
await call("includeFlags omitted (baseline)", idKW, token);
await call("includeFlags=true (suspected broken)", `${idKW}&includeFlags=true`, token);
await call("includeFlags=false", `${idKW}&includeFlags=false`, token);
await call("includeFlags=none", `${idKW}&includeFlags=none`, token);
await call("includeFlags=all", `${idKW}&includeFlags=all`, token);
await call("includeFlags=person", `${idKW}&includeFlags=person`, token);

// includeSummary=true on populated record to see extra fields
await call("FULL summary=true (one accepted match for GW)", `${idKW}&includeSummary=true`, token);

// The other 3 tool shapes against Lincoln record (1:1:QPTX-TMQ2)
const baseLR = `id=${ark11}&minConfidence=1&status=accepted&status=pending&status=rejected`;
await call("record_person (Lincoln 1:1: → tree)", `collection=tree&${baseLR}`, token);
await call("record_record (Lincoln 1:1: → records)", `collection=records&${baseLR}`, token);

// person_person — tree-to-tree dup-finding. Reuse GW.
const basePP = `collection=tree&id=${ark41}&minConfidence=1&status=accepted&status=pending&status=rejected`;
await call("person_person (GW 4:1: → tree)", basePP, token);

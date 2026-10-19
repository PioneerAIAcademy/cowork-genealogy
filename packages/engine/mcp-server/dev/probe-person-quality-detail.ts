/**
 * Evidence trail behind issue #2225 / D2 — the opt-in detail flag on person_quality.
 *
 * QUESTION: what are the real field names and shapes of
 * `personScores.conclusionScores[]` and `personScores.sourceClusters[]`?
 *
 * Both are fetched today and thrown away — src/types/person-quality.ts:40-41
 * ("deliberately not modeled"). docs/specs/person-quality-tool-spec.md describes
 * them in English only: conclusionScores as "one entry per conclusion ... plus
 * affectingIssueIds", sourceClusters as "each source (title + ark URI) and which
 * of the person's conclusions it touches, with agreesWithSource true/false".
 * No field-level sample exists anywhere in the repo, so the D2 types cannot be
 * written from evidence until this probe has run.
 *
 * Why not dev/try-person-quality.ts: that script prints the TOOL's output, which
 * is by definition the response with these two lists already stripped out.
 *
 * Usage:
 *   cd packages/engine/mcp-server
 *   npx tsx dev/probe-person-quality-detail.ts            # defaults to KD96-TV2
 *   npx tsx dev/probe-person-quality-detail.ts G7XY-2ZQ
 *   (requires a prior desktop `login` so ~/.familysearch-mcp/tokens.json exists)
 *
 * KD96-TV2 is the person the spec's own response-shape section was observed
 * from, so it is the default: it makes this probe directly comparable to the
 * table already in the spec.
 *
 * Writes the full raw body to dev/probe-person-quality-detail.out.json so the
 * shape can be re-read without spending another live call.
 *
 * RESULTS (2026-09-17, KD96-TV2, HTTP 200):
 *
 * 1. `sourceClusters` IS NOT AN ARRAY. The spec's `personScores.sourceClusters[]`
 *    is wrong. It is an OBJECT with two keys:
 *      { sourceClusters: SourceCluster[], conflicts: SourceConflict[] }
 *    A types file written from the spec would not compile against the live body.
 *
 * 2. `conflicts[]` IS UNDOCUMENTED — it appears in no spec, type or plan in this
 *    repo, and it is the highest-value payload here. 50 entries for this person:
 *      { sourceUris: [uriA, uriB],                    // always exactly 2
 *        conflictingFields: [{ name, values: [...] }] }
 *    e.g. name "Birth Date", values ["+1877", "+1876-10-02"]. That is literally
 *    "which two attached sources disagree, and about what" — the question the
 *    audit exists to answer. Distinct field names seen: "Birth Date", "Name".
 *    NB values carry a leading "+" (GedcomX formal-date syntax), not a typo.
 *
 * 3. `conflicts[]` is PAIRWISE and heavily duplicated: 50 entries encode only a
 *    handful of underlying disagreements, re-stated once per source pair. Any
 *    output must reduce, or it floods the context — the exact failure the
 *    original exclusion was protecting against.
 *
 * 4. `sourceClusters.sourceClusters[]` — 21 clusters, sizes [6, 3, then 19 × 1],
 *    28 sources total. Cluster entries have ONE key: `sources`.
 *      source      = { uri, title, conclusions[] }
 *      conclusion  = { id, agreesWithSource }     // `id` is a conclusionId
 *    13 of the 28 sources repeat the same conclusion id inside their own
 *    `conclusions[]` (a NAME id appearing twice). Dedupe by id.
 *
 * 5. `agreesWithSource` was `true` for EVERY conclusion on this person — no
 *    negative sample. The false branch is therefore UNVERIFIED; do not write a
 *    spec sentence describing how a disagreement renders until a person with one
 *    has been probed. The conflicts[] list above is where this person's actual
 *    disagreements live.
 *
 * 6. `conclusionScores[]` — 14 entries, one per conclusion. Union of keys:
 *      affectingIssueIds, coherenceScore, combinedDisplayScore, combinedRawScore,
 *      completenessScore, conclusionId, conclusionType, consistencyScore,
 *      relationshipId, verifiabilityScore
 *    `relationshipId` is present on only 2 of the 14 (the MARRIAGE entries,
 *    e.g. "M5PN-FXR") and absent from entries 0-2. Writing the type off the
 *    first entry would have missed it — which is why this probe prints the union
 *    across all entries, not a sample.
 *    conclusionTypes seen: NAME, GENDER, BIRTH, CHRISTENING, RESIDENCE × 6,
 *    DEATH, BURIAL, MARRIAGE × 2. Only 7 of 14 carry a non-empty
 *    affectingIssueIds; the other 7 are clean facts.
 *
 * 7. `affectingIssueIds` JOINS EXACTLY ON `issues[].id` — same opaque string,
 *    e.g. "COMPLETENESS:MISSING_EVENT_DATE:BURIAL:d57d443f-...". But the tool's
 *    current output (`QualityIssueOut`) does NOT carry `id`, so surfacing
 *    conclusionScores without also surfacing `issues[].id` yields ids that join
 *    to nothing. D2 must add `id` to the issue output, or resolve the join
 *    server-side and emit the sentence instead.
 *
 * 8. `issues[]` elements carry more than the spec's six observed fields:
 *      conclusionId, conclusionType, dismissible, id, issueType, originalPlace,
 *      penalty, placeId, scoreType, type
 *    `id`, `penalty` and `dismissible` are not in the spec's table.
 */
import { writeFileSync } from "node:fs";
import { LOCAL } from "../src/auth/principal.js";
import { getValidToken } from "../src/auth/refresh.js";
import { BROWSER_USER_AGENT } from "../src/constants.js";
import { fetchWithRetry } from "../src/utils/http.js";

// Duplicated from src/tools/person-quality.ts on purpose: a probe documents the
// live API, so it must not inherit the tool's choices.
const HOST = "https://sg30p0.familysearch.org";
const OUT = "dev/probe-person-quality-detail.out.json";

const personId = process.argv[2] ?? "KD96-TV2";

// Print every key of an object, and the type/sample of each value, so a field
// table can be written from the output without eyeballing raw JSON.
function describe(label: string, obj: unknown): void {
  if (obj === null || typeof obj !== "object") {
    console.log(`${label}: ${JSON.stringify(obj)}`);
    return;
  }
  console.log(`${label}:`);
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const type = Array.isArray(v) ? `array[${v.length}]` : v === null ? "null" : typeof v;
    console.log(`  ${k.padEnd(28)} ${type.padEnd(12)} ${JSON.stringify(v)?.slice(0, 120) ?? ""}`);
  }
}

const token = await getValidToken(LOCAL);
const url = `${HOST}/service/tree/tree-data/quality/person/${encodeURIComponent(personId)}/scores`;

console.log(`GET ${url}`);
const res = await fetchWithRetry(url, {
  headers: {
    Authorization: `Bearer ${token}`,
    "User-Agent": BROWSER_USER_AGENT,
    Accept: "application/json",
  },
});
console.log(`HTTP ${res.status}`);
if (!res.ok) {
  console.error(await res.text());
  process.exit(1);
}

const body = (await res.json()) as Record<string, unknown>;
writeFileSync(OUT, JSON.stringify(body, null, 2), { encoding: "utf-8" });
console.log(`raw body written to ${OUT}`);

const scores = body.personScores as Record<string, unknown> | undefined;
if (!scores) {
  console.log(`no personScores — visibility=${JSON.stringify(body.visibility)}`);
  process.exit(0);
}

console.log("\n=== personScores top-level keys ===");
describe("personScores", scores);

// sourceClusters is NOT an array (finding 1): it is a wrapper object holding
// `sourceClusters` and the undocumented `conflicts`. Unwrap both so each is
// described as a list; a bare Array.isArray check reports it as absent, which is
// wrong and was this probe's own first misreading.
const lists: Array<[string, unknown]> = [
  ["conclusionScores", scores.conclusionScores],
  ["sourceClusters.sourceClusters", (scores.sourceClusters as Record<string, unknown> | undefined)?.sourceClusters],
  ["sourceClusters.conflicts", (scores.sourceClusters as Record<string, unknown> | undefined)?.conflicts],
];

for (const [listName, list] of lists) {
  console.log(`\n=== ${listName} ===`);
  if (!Array.isArray(list)) {
    console.log(`NOT A LIST (${list === undefined ? "undefined" : typeof list}) — inspect the raw body at ${OUT}.`);
    continue;
  }
  console.log(`${list.length} entries`);
  list.slice(0, 3).forEach((entry, i) => {
    console.log(`\n--- ${listName}[${i}] ---`);
    describe("fields", entry);
    console.log(JSON.stringify(entry, null, 2));
  });
  // Every key seen across ALL entries, not just the first: optional fields are
  // routinely absent from entry 0 and a types file written from one entry misses them.
  const allKeys = new Set<string>();
  for (const e of list) {
    if (e && typeof e === "object") for (const k of Object.keys(e)) allKeys.add(k);
  }
  console.log(`\nunion of keys across all ${list.length} entries: ${[...allKeys].sort().join(", ")}`);
}

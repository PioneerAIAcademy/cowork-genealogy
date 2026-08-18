/**
 * Probe: how FamilySearch's RMS group-search endpoint filters by record type.
 * Evidence for docs/specs/volume-search-tool-spec.md's "Record-type filtering"
 * section — every number quoted there is produced by a section of this script.
 *
 * The endpoint SILENTLY IGNORES unknown request fields, so a 200 proves nothing
 * on its own. Section `filter` therefore sends a deliberately bogus field as a
 * control before testing any speculative parameter, and every count-based claim
 * paginates rather than reading a single 100-group page.
 *
 * Requires a live FamilySearch session (run `make e2e-login` first).
 *
 * Usage:
 *   npx tsx dev/probe-record-type-groups.ts             # every section
 *   npx tsx dev/probe-record-type-groups.ts filter      # one section
 *
 * Sections: filter | containment | or | roots | reach | anchors | tree
 */
import { getValidToken } from "../src/auth/refresh.js";
import {
  standardPlaceToPlaceId,
  placeIdToRepIds,
} from "../src/utils/place-resolver.js";
import { fetchWithTimeout } from "../src/utils/http.js";
import { BROWSER_USER_AGENT } from "../src/constants.js";

const RMS_SEARCH_URL =
  "https://sg30p0.familysearch.org/service/records/rms/group-service/group/search";

/** Harjager härad — small enough to paginate fully, and the fixture's locality. */
const HARJAGER = "Harjager, Malmöhus, Sweden";

interface Coverage {
  place?: string;
  datesOrig?: string;
  recordTypeOrig?: string;
  recordTypeConceptId?: number;
  recordTypeConceptIdHierarchy?: number[];
}

let token = "";

function headers(): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent": BROWSER_USER_AGENT,
    "FS-User-Agent-Chain": "chesworth",
  };
}

async function repIdsFor(place: string): Promise<number[] | null> {
  const placeId = await standardPlaceToPlaceId(place);
  if (!placeId) return null;
  const reps = await placeIdToRepIds(placeId);
  return reps.map(Number).filter((n) => !Number.isNaN(n));
}

/** One raw query. `extra` is merged into `coverage` so speculative fields can be tested. */
async function query(
  repIds: number[] | null,
  opts: {
    from?: string;
    to?: string;
    extraCoverage?: Record<string, unknown>;
    extraTop?: Record<string, unknown>;
    pageSize?: number;
    pageToken?: string;
  } = {}
): Promise<{ status: number; totalCount: number; groups: { groupName: string; coverages?: Coverage[] }[]; nextPageToken?: string }> {
  const coverage: Record<string, unknown> = { ...(opts.extraCoverage ?? {}) };
  if (repIds) coverage.placeRepIds = repIds;
  if (opts.from) coverage.fromDateString = opts.from;
  if (opts.to) coverage.toDateString = opts.to;
  const body: Record<string, unknown> = {
    coverage,
    types: ["NATURAL"],
    returnChildCounts: true,
    active: true,
    pageSize: opts.pageSize ?? 100,
    ...(opts.extraTop ?? {}),
    ...(opts.pageToken ? { nextPageToken: opts.pageToken } : {}),
  };
  const res = await fetchWithTimeout(
    RMS_SEARCH_URL,
    { method: "PUT", headers: headers(), body: JSON.stringify(body) },
    60_000
  );
  const text = await res.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* non-JSON error body */
  }
  return {
    status: res.status,
    totalCount: (parsed.totalCount as number) ?? -1,
    groups: (parsed.groups as { groupName: string; coverages?: Coverage[] }[]) ?? [],
    nextPageToken: parsed.nextPageToken as string | undefined,
  };
}

/** Every coverage row for a place, following nextPageToken to exhaustion. */
async function allCoverages(
  repIds: number[],
  from: string,
  to: string,
  cap = 20
): Promise<Coverage[]> {
  const out: Coverage[] = [];
  let pageToken: string | undefined;
  let pages = 0;
  do {
    const r = await query(repIds, { from, to, pageToken });
    for (const g of r.groups) out.push(...(g.coverages ?? []));
    pageToken = r.nextPageToken;
    pages += 1;
  } while (pageToken && pages < cap);
  return out;
}

/**
 * A concept's ancestor chain, from a global (place-less) query.
 * Works for internal nodes too: any coverage whose hierarchy CONTAINS the id
 * yields the ancestors as the slice before it.
 */
async function ancestorsOf(
  id: number
): Promise<{ total: number; chain: number[] | null; name: string }> {
  const r = await query(null, { extraCoverage: { recordTypeConceptIds: [id] }, pageSize: 20 });
  for (const g of r.groups) {
    for (const c of g.coverages ?? []) {
      const h = c.recordTypeConceptIdHierarchy;
      if (!Array.isArray(h)) continue;
      const i = h.indexOf(id);
      if (i < 0) continue;
      return {
        total: r.totalCount,
        chain: h.slice(0, i),
        name:
          c.recordTypeConceptId === id
            ? String(c.recordTypeOrig ?? "").replace(/^title:\s*/, "")
            : "",
      };
    }
  }
  return { total: r.totalCount, chain: null, name: "" };
}

// ---------------------------------------------------------------- sections

/**
 * Does `coverage.recordTypeConceptIds` filter server-side? The two CONTROL rows
 * are what make the answer readable: unknown fields are ignored, so only a row
 * whose total MOVES is evidence of a real parameter.
 */
async function sectionFilter() {
  console.log("\n## filter — is there a server-side record-type parameter?\n");
  const reps = await repIdsFor(HARJAGER);
  if (!reps) return console.log("  place unresolved");
  const opts = { from: "1650-01-01", to: "1720-12-31" };
  const cases: [string, Parameters<typeof query>[1]][] = [
    ["baseline (nothing extra)", opts],
    ["CONTROL bogus field @ top level", { ...opts, extraTop: { bogusFieldXyz: true } }],
    ["CONTROL bogus field @ coverage", { ...opts, extraCoverage: { bogusFieldXyz: true } }],
    ["recordTypeConceptIds @ top level", { ...opts, extraTop: { recordTypeConceptIds: [124410] } }],
    ["recordTypeConceptIds @ coverage", { ...opts, extraCoverage: { recordTypeConceptIds: [124410] } }],
    ["recordTypeConceptId (singular) @ coverage", { ...opts, extraCoverage: { recordTypeConceptId: 124410 } }],
    ["recordTypes (names) @ coverage", { ...opts, extraCoverage: { recordTypes: ["Taxation"] } }],
  ];
  for (const [label, o] of cases) {
    const r = await query(reps, o);
    console.log(`  ${String(r.status).padEnd(4)} total=${String(r.totalCount).padEnd(6)} ${label}`);
  }
  console.log("\n  Only a row whose total differs from baseline is a real filter.");
}

/** Ancestor ids match their whole subtree. */
async function sectionContainment() {
  console.log("\n## containment — does an ancestor id match its descendants?\n");
  const reps = await repIdsFor(HARJAGER);
  if (!reps) return console.log("  place unresolved");
  const opts = { from: "1650-01-01", to: "1720-12-31" };
  const probes: [string, number | null][] = [
    ["(no filter)", null],
    ["122797 Legal (root)", 122797],
    ["127010 Court (mid)", 127010],
    ["124277 Probate (leaf)", 124277],
    ["126517 Government (root)", 126517],
    ["124410 Taxation (child)", 124410],
    ["123402 Religious (root)", 123402],
    ["127575 Religious Birth (child)", 127575],
  ];
  for (const [label, id] of probes) {
    const r = await query(reps, {
      ...opts,
      ...(id ? { extraCoverage: { recordTypeConceptIds: [id] } } : {}),
    });
    const types = new Set<string>();
    for (const g of r.groups) for (const c of g.coverages ?? []) if (c.recordTypeOrig) types.add(c.recordTypeOrig);
    console.log(`  ${String(r.totalCount).padStart(4)}  ${label.padEnd(32)} ${[...types].slice(0, 4).join(", ")}`);
  }
}

/** Multiple ids union rather than intersect. */
async function sectionOr() {
  console.log("\n## or — how do multiple ids combine?\n");
  const reps = await repIdsFor(HARJAGER);
  if (!reps) return console.log("  place unresolved");
  const opts = { from: "1650-01-01", to: "1720-12-31" };
  for (const [label, ids] of [
    ["[124410] Taxation alone", [124410]],
    ["[123402] Religious alone", [123402]],
    ["[124410,123402] together — OR sums, AND would be 0", [124410, 123402]],
    ["[124410,999999] real + nonexistent", [124410, 999999]],
    ["[999999] nonexistent alone — 0 results, status 200", [999999]],
  ] as [string, number[]][]) {
    const r = await query(reps, { ...opts, extraCoverage: { recordTypeConceptIds: ids } });
    console.log(`  ${String(r.totalCount).padStart(4)}  ${label}`);
  }
}

const SWEEP_PLACES = [
  HARJAGER,
  "Edensor, Derbyshire, England, United Kingdom",
  "Wayne, Ohio, United States",
  "Kent, England, United Kingdom",
  "Jalisco, Mexico",
  "Ontario, Canada",
  "Oslo, Norway",
  "Tolna, Hungary",
  "Bayern, Germany",
  "New South Wales, Australia",
];

/**
 * Roots, the observed name map, and what a record-type filter would actually
 * exclude.
 *
 * THE DISTINCTION THAT MATTERS: the filter matches on `recordTypeConceptId`, so
 * a coverage is unreachable only when it has no concept id. A missing
 * `recordTypeOrig` is a missing *display name* — a different, far more common,
 * and far less consequential thing. Measuring the wrong one of these inverts the
 * conclusion: New South Wales has 100% of coverages missing the display name and
 * 0% missing the concept id, so a filter reaches it fine.
 *
 * The unit that decides whether a VOLUME is excluded is the group, not the
 * coverage row: a group survives if any one of its coverages carries an id.
 */
async function sectionRoots() {
  console.log("\n## roots — taxonomy roots, name map, and what a filter really excludes\n");
  const named = new Map<number, Set<string>>();
  const roots = new Set<number>();
  let total = 0;
  let noName = 0;
  let noId = 0;
  for (const place of SWEEP_PLACES) {
    const reps = await repIdsFor(place);
    if (!reps) {
      console.log(`  UNRESOLVED  ${place}`);
      continue;
    }
    const covs = await allCoverages(reps, "1500-01-01", "1950-12-31", 2);
    let n = 0;
    let i = 0;
    for (const c of covs) {
      total += 1;
      if (!c.recordTypeOrig) {
        n += 1;
        noName += 1;
      } else if (typeof c.recordTypeConceptId === "number") {
        if (!named.has(c.recordTypeConceptId)) named.set(c.recordTypeConceptId, new Set());
        named.get(c.recordTypeConceptId)!.add(c.recordTypeOrig.replace(/^title:\s*/, ""));
      }
      const h = c.recordTypeConceptIdHierarchy;
      const hasId = (Array.isArray(h) && h.length > 0) || typeof c.recordTypeConceptId === "number";
      if (!hasId) {
        i += 1;
        noId += 1;
      }
      if (Array.isArray(h) && h.length) roots.add(h[0]);
    }
    console.log(
      `  ${String(n).padStart(4)}/${String(covs.length).padEnd(5)} no display name` +
        ` | ${String(i).padStart(4)}/${String(covs.length).padEnd(5)} NO CONCEPT ID (what a filter excludes)` +
        `  ${place}`
    );
  }
  console.log(
    `\n  overall: ${noName}/${total} lack a display name (${Math.round((noName / total) * 100)}%)` +
      ` | ${noId}/${total} lack a concept id (${Math.round((noId / total) * 100)}%)`
  );
  console.log(`\n  roots observed (${roots.size}) — "NEVER NAMED" means no label in THIS sample:`);
  for (const id of [...roots].sort((a, b) => a - b)) {
    console.log(`    ${id}  ${[...(named.get(id) ?? [])].join(" / ") || "*** NEVER NAMED ***"}`);
  }
  console.log(
    "\n  Which ids appear unnamed is sample-dependent — deeper pagination names more of\n" +
      "  them. Treat this as a floor, not a census."
  );
}

/**
 * Vocabulary reach: what fraction of a place's volumes a filter can actually
 * retrieve when every known root is OR-ed together.
 *
 * This is the real constraint on the feature. It is NOT that volumes lack types
 * (they essentially never do) — it is that a closed vocabulary can only reach
 * the subtrees it names, so the gap measures OUR list's completeness, not the
 * API's data quality.
 */
async function sectionReach() {
  console.log("\n## reach — how much of a place a filter retrieves with all known roots OR-ed\n");
  const ROOTS = vocabularyIds();
  console.log(`  (measuring the ${ROOTS.length} ids the vocabulary would actually send)\n`);
  for (const place of SWEEP_PLACES) {
    const reps = await repIdsFor(place);
    if (!reps) {
      console.log(`  UNRESOLVED  ${place}`);
      continue;
    }
    const opts = { from: "1500-01-01", to: "1950-12-31" };
    const base = await query(reps, opts);
    const all = await query(reps, { ...opts, extraCoverage: { recordTypeConceptIds: ROOTS } });
    const pct = base.totalCount > 0 ? (all.totalCount / base.totalCount) * 100 : 0;
    console.log(
      `  ${String(all.totalCount).padStart(6)}/${String(base.totalCount).padEnd(7)}` +
        ` = ${pct.toFixed(1).padStart(5)}% reachable   ${place}`
    );
  }
  console.log("\n  A shortfall here is a gap in the ROOT LIST, not untyped data.");
}

/**
 * Group anchors from the proposed 48-group list, against the ids each group
 * claims to absorb. A claim holds when the anchor is in the id's ancestor chain.
 */
const GROUP_CLAIMS: [string, number[], number[]][] = [
  ["2 Baptism", [103612, 127575], [114490]],
  ["3 Death", [104898], [127079, 129429, 122911, 126811]],
  ["4 Religious Death", [127576], [127739]],
  ["6 Marriage", [104727], [114513, 127549, 104742, 104744, 101383, 126374]],
  ["7 Religious Marriage", [127577], [123591, 127680, 122950]],
  ["11 Military", [124133], [124131, 124134, 129087, 126656, 126657, 127571]],
  ["18 Passports", [124216], [123245, 124432, 124442, 131572]],
  ["19 ID documents", [126546], [131474, 123143, 129962, 129964]],
  ["21 Census", [123363], [124264, 104611, 100770, 130138, 126486, 129065, 129449]],
  ["22 Court", [127010], [123349, 126370, 126417, 127571]],
  ["23 Probate", [124277, 126785], [123648, 123196, 129461, 130661]],
  ["24 Wills", [124457], [124456, 126946, 127073, 129547]],
  ["30 Tax", [124410], [129065]],
  ["32 Religious", [123402, 124209], [130206, 126601]],
  ["42 Prison", [123478, 131448], [126780, 130086, 126416, 129538]],
  ["46 Government Pensions", [124227], [124225, 124226, 130136, 131421, 126869, 124383, 127027]],
  // Not shipped as a group — its members are reachable via Military and Death.
  // Kept so that decision stays reproducible from this probe.
  ["14 Casualties (not shipped)", [123352], [124372, 124129, 124445]],
  // 131602 sits beside Emigration under Migration, so Emigration carries it as a stray.
  ["16 Emigration", [123632], [131602]],
];

async function sectionAnchors() {
  console.log("\n## anchors — do the proposed groups' anchors cover what they claim?\n");
  let inSubtree = 0;
  let stray = 0;
  for (const [label, anchors, absorbed] of GROUP_CLAIMS) {
    const strays: string[] = [];
    for (const id of absorbed) {
      const r = await ancestorsOf(id);
      if (!r.chain) {
        strays.push(`${id} unresolvable (total=${r.total})`);
        continue;
      }
      if (anchors.some((a) => a === id || r.chain!.includes(a))) inSubtree += 1;
      else {
        stray += 1;
        strays.push(`${id}${r.name ? ` (${r.name})` : ""} -> under [${r.chain.join(",")}]`);
      }
    }
    if (strays.length) console.log(`  ${label}  anchors[${anchors.join(",")}]\n      ${strays.join("\n      ")}`);
  }
  console.log(`\n  in-subtree ${inSubtree} | out-of-subtree ${stray}`);
}

/**
 * THE VOCABULARY — single source of truth for `tree` and `reach`.
 *
 * Both sections derive their id sets from this array, so a change here is
 * automatically reflected in the reach measurement. An earlier version hardcoded
 * a separate id list inside `sectionReach`; it drifted from the group table
 * (carrying two ids that are not group roots, missing two that are) and reported
 * 100% reach for a vocabulary that does not ship. A check that cannot notice the
 * thing it checks is worse than no check.
 *
 * `strays` are ids belonging to the group editorially but OUTSIDE its anchor's
 * subtree, so containment cannot reach them; they are sent alongside the anchor.
 */
interface VocabGroup {
  name: string;
  anchor: number;
  parent: string | null;
  strays?: number[];
}

const VOCABULARY: VocabGroup[] = [
  { name: "Genealogies", anchor: 123682, parent: null },
  { name: "Biography", anchor: 122921, parent: "Genealogies" },
  { name: "Vital", anchor: 124443, parent: null },
  { name: "Birth", anchor: 103979, parent: "Vital" },
  { name: "Death", anchor: 104898, parent: "Vital", strays: [122911] },
  { name: "Cemetery", anchor: 104497, parent: "Death" },
  { name: "Marriage", anchor: 104727, parent: "Vital" },
  { name: "Divorce", anchor: 104832, parent: "Vital" },
  { name: "Religious", anchor: 123402, parent: null },
  { name: "Baptism", anchor: 103612, parent: "Religious", strays: [127575] },
  { name: "Religious Death", anchor: 127576, parent: "Religious", strays: [127739] },
  { name: "Religious Marriage", anchor: 127577, parent: "Religious" },
  { name: "Confirmation", anchor: 101655, parent: "Religious" },
  { name: "Military", anchor: 124133, parent: null },
  { name: "Military Pensions", anchor: 127621, parent: "Military" },
  { name: "Draft", anchor: 104808, parent: "Military" },
  { name: "Migration", anchor: 127023, parent: null },
  { name: "Emigration", anchor: 123632, parent: "Migration", strays: [131602] },
  { name: "Naturalization", anchor: 124162, parent: "Migration" },
  { name: "Census", anchor: 123363, parent: null, strays: [104611] },
  { name: "Legal", anchor: 122797, parent: null },
  { name: "Court", anchor: 127010, parent: "Legal", strays: [127571] },
  { name: "Probate", anchor: 124277, parent: "Court" },
  { name: "Guardianship", anchor: 123769, parent: "Probate" },
  { name: "Wills", anchor: 124457, parent: "Legal", strays: [127073, 129547] },
  { name: "Land", anchor: 127026, parent: "Legal" },
  { name: "Enslavement", anchor: 126864, parent: "Land" },
  { name: "Notarial", anchor: 100599, parent: "Legal" },
  { name: "Government", anchor: 126517, parent: null },
  { name: "ID documents", anchor: 126546, parent: "Government", strays: [129962, 129964] },
  { name: "Passports", anchor: 124216, parent: "ID documents", strays: [124432, 124442, 131572] },
  { name: "Foreigner", anchor: 131588, parent: "Government" },
  { name: "Tax", anchor: 124410, parent: "Government", strays: [129065] },
  { name: "Wartime", anchor: 130090, parent: "Government" },
  { name: "Poor Law", anchor: 126768, parent: "Government" },
  { name: "Prison", anchor: 123478, parent: "Government", strays: [130086, 126416, 131448] },
  { name: "Government Pensions", anchor: 124227, parent: "Government", strays: [126869, 124383, 127027] },
  { name: "Indigenous", anchor: 130717, parent: "Government" },
  { name: "Voting", anchor: 127015, parent: null },
  { name: "School", anchor: 124365, parent: null },
  { name: "Business", anchor: 126340, parent: null },
  { name: "Reference", anchor: 126808, parent: null },
  { name: "Medical", anchor: 127076, parent: null },
  { name: "Photographs", anchor: 122956, parent: null },
  { name: "Miscellaneous", anchor: 124078, parent: null },
  { name: "Administrative", anchor: 135784, parent: null },
  { name: "Newspapers", anchor: 124231, parent: null },
];

/** Every id the shipped vocabulary would send: anchors plus strays. */
function vocabularyIds(): number[] {
  const ids = new Set<number>();
  for (const g of VOCABULARY) {
    ids.add(g.anchor);
    for (const s of g.strays ?? []) ids.add(s);
  }
  return [...ids];
}

async function sectionTree() {
  console.log("\n## tree — which proposed groups nest inside other proposed groups?\n");
  const anchorIds = new Set(VOCABULARY.map((g) => g.anchor));
  const roots: string[] = [];
  for (const { name: label, anchor: id } of VOCABULARY) {
    const r = await ancestorsOf(id);
    if (!r.chain) {
      console.log(`  ${label.padEnd(20)} ${String(id).padEnd(8)} UNRESOLVED (total=${r.total})`);
      continue;
    }
    const nested = r.chain.filter((x) => anchorIds.has(x));
    if (!r.chain.length) roots.push(`${label} (${id})`);
    console.log(
      `  ${label.padEnd(20)} ${String(id).padEnd(8)}` +
        (r.chain.length ? `under [${r.chain.join(",")}]` : "*** ROOT ***") +
        (nested.length ? `   <- inside group anchor(s) ${nested.join(",")}` : "")
    );
  }
  console.log(`\n  roots among the proposed groups (${roots.length}): ${roots.join(", ")}`);
}

// ------------------------------------------------------------------- main

const SECTIONS: Record<string, () => Promise<void>> = {
  filter: sectionFilter,
  containment: sectionContainment,
  or: sectionOr,
  roots: sectionRoots,
  reach: sectionReach,
  anchors: sectionAnchors,
  tree: sectionTree,
};

async function main() {
  const wanted = process.argv[2];
  if (wanted && !SECTIONS[wanted]) {
    console.error(`Unknown section "${wanted}". Choose from: ${Object.keys(SECTIONS).join(" | ")}`);
    process.exit(1);
  }
  token = await getValidToken();
  for (const [name, fn] of Object.entries(SECTIONS)) {
    if (wanted && name !== wanted) continue;
    await fn();
  }
}

await main();

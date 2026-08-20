/**
 * WHERE does the raw search response say a person is the father? (`role`, not `fields`.)
 *
 * EXPLORATORY. **Its output is not in `dev/measured-figures.json` and must not be
 * cited as measured.** Nothing here calls `record()`.
 *
 * ## Why it exists
 *
 * To test whether an unqualified relative term keeps records that name no such
 * relative, you must first be able to say "this record names no father". I claimed
 * that could not be established from the search payload. Wrong twice over, and both
 * wrong turns are recorded here because each cost a run.
 *
 * ## What it measured
 *
 * 1. `fields[]` is a DEAD END for relatives. The raw entry does carry the indexed
 *    label array `extractBatchNumber` reads, and this walker visits every `fields[]`
 *    in the tree (root, persons, names, facts) — but across two unrelated
 *    collections it found ZERO kin labels. The vocabulary is record-level
 *    (`FS_RECORD_GROUP`, `FS_UDE_BATCH_NBR`), event-level (`EVENT_DATE`,
 *    `EVENT_PLACE`) and PRINCIPAL-level (`PR_BIR_*`, `PR_DEA_*`, `PR_AGE`) only.
 *    Reading one collection and generalising is what made this look conclusive the
 *    first time; it is per-collection, so read more than one.
 *
 * 2. `role` IS the answer, and it is right there on the raw persons:
 *
 *      collection 2177282 (Brazil/Parana, 1880 Lapa)  Other 683, Principal 500,
 *                                                     Mother 437, Father 345, Spouse 5
 *      collection 1494474 (q.surname=Martin)          Principal 500, Father 289,
 *                                                     Mother 229, Spouse 90
 *
 *    By that classifier 155/500 and 211/500 personas are on records naming no
 *    father. So the population is easy to find, and a bound target is easy to pick.
 *    `toSimplified` does not carry `role`, which is why neither the simplified
 *    document nor `record_read` (which returns simplified GedcomX) can answer this.
 *
 * ## What this does NOT do, and the verdict that already exists
 *
 * It reaches no conclusion about the empty-field rule, because the artifact already
 * did: `R.verdict:keep-silent` reads HOLDS — "the records retained by an unmatchable
 * name are the ones the baseline is silent about, in the same number" — with
 * `R.verdict:retention equals the silent share` HOLDS across every enumerated
 * population. `R.rows` shows the shape: pools anchored on a SURNAME
 * (Brazil/Bochenek, England/Pocklington), a three-way classifier of
 * named / nameless-but-indexed / silent, and retention tracking the silent share
 * (70.1% -> 70.2%, 92.8% -> 92.8%, 9.8% -> 10.2%).
 *
 * A probe deleted on 2026-08-20, `explore-relative-empty-field-families.ts`, got
 * "kept 0" against that. It was the
 * one that is wrong: place/date-anchored pool instead of a surname anchor, a
 * graph-derived two-way classifier instead of role-based three-way, and no check
 * that its own controls matched R before reporting. Its numbers must not be quoted.
 * R's three-way split matters specifically because a `role="Father"` person can carry
 * no name at all — neither "named" nor "silent" — which is R's
 * `namelessButIndexedInBaseline` column.
 *
 * Run: `npx tsx dev/explore-relative-role-classifier-records.ts` from
 * `packages/engine/mcp-server`.
 */
import { getValidToken } from "../src/auth/refresh.js";
import { BROWSER_USER_AGENT } from "../src/constants.js";
import { fetchWithTimeout } from "../src/utils/http.js";
import { toSimplified } from "../src/utils/gedcomx-convert.js";
import { findRepresentedPerson, resolveRelativeTerms } from "../src/tools/record-search.js";

const BASE = "https://www.familysearch.org/service/search/hr/v2/personas";
/**
 * Field labels are PER COLLECTION, which is the mistake this probe made first: it read
 * one collection, found no kin labels, and I generalised that to "the payload cannot
 * show the index view of relatives". Read more than one collection before saying that.
 */
const POOLS = [
  { name: "Brazil/Parana Catholic register (collection 2177282), 1880 Lapa births",
    qs: "q.recordCountry=Brazil&f.recordType=0&q.birthLikeDate.from=1880&q.birthLikeDate.to=1880" +
        "&q.birthLikePlace=Lapa&q.birthLikePlace.exact=on",
    crossTab: true },
  { name: "collection 1494474, q.surname=Martin",
    qs: "q.surname=Martin&q.collectionId=1494474",
    crossTab: true },
];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Every `role` in the object tree. THIS is where the raw search response says what a
 * person is on the record — "Father", "Mother", "Principal", "Spouse". `fields[]`
 * labels do not carry it (measured: two collections, zero kin labels), and the
 * relationship graph is a second-hand view of it. Checking `role` first is what this
 * probe should have done.
 */
function collectRoles(node: any, out: Map<string, number>): void {
  if (node === null || typeof node !== "object") return;
  if (Array.isArray(node)) { for (const x of node) collectRoles(x, out); return; }
  for (const [k, v] of Object.entries(node)) {
    if (k === "role" && typeof v === "string") out.set(v, (out.get(v) ?? 0) + 1);
    collectRoles(v, out);
  }
}

/** Every `fields[]` in the object tree, wherever it hangs — root, persons, names, facts. */
function collectLabels(node: any, out: Set<string>): void {
  if (node === null || typeof node !== "object") return;
  if (Array.isArray(node)) { for (const x of node) collectLabels(x, out); return; }
  for (const [k, v] of Object.entries(node)) {
    if (k === "fields" && Array.isArray(v)) {
      for (const f of v) for (const val of (f as any)?.values ?? []) {
        if (val?.labelId) out.add(String(val.labelId));
      }
    }
    collectLabels(v, out);
  }
}

async function runPool(POOL: string, label: string, crossTab: boolean): Promise<void> {
  console.log(`\n############ ${label} ############`);
  const rows: any[] = [];
  let retry = 0;
  const CAP = 500;   // vocabulary only — NOT an enumeration, and the report says so
  for (let offset = 0; offset < CAP; offset += 100) {
    await sleep(700);
    const token = await getValidToken();
    const res = await fetchWithTimeout(`${BASE}?${POOL}&count=100&offset=${offset}&m.queryRequireDefault=on`,
      { headers: { Authorization: `Bearer ${token}`, Accept: "application/json",
                   "Accept-Language": "en", "User-Agent": BROWSER_USER_AGENT } });
    if (res.status === 204) break;
    // `??` alone is not enough: RFC 7231 allows an HTTP-date, and Number() of that
    // is NaN, which setTimeout fires immediately — burning every retry in
    // milliseconds and then blaming the upstream.
    if (res.status === 429) {
      const ra = Number(res.headers.get("retry-after"));
      if (++retry > 10) { console.log("  ABORT: 429 after 10 retries — refusing"); process.exit(1); }
      await sleep((Number.isFinite(ra) ? ra : 20) * 1000 + 2000);
      offset -= 100;
      continue;
    }
    if (!res.ok) { console.log(`  ABORT HTTP ${res.status} at offset ${offset} — partial, refusing`); process.exit(1); }
    const b: any = await res.json();
    const es = b?.entries ?? [];
    rows.push(...es);
    if (es.length < 100) break;
  }
  console.log(`  read ${rows.length} personas (cap ${CAP} — a vocabulary sample, not an enumerated set)\n`);

  // 1. the vocabulary, from data
  const freq = new Map<string, number>();
  for (const e of rows) {
    const labels = new Set<string>();
    collectLabels(e.content?.gedcomx, labels);
    for (const l of labels) freq.set(l, (freq.get(l) ?? 0) + 1);
  }
  // role vocabulary FIRST — it is the direct answer, where fields[] is not
  const roles = new Map<string, number>();
  for (const e of rows) collectRoles(e.content?.gedcomx, roles);
  console.log(`  distinct \`role\` values: ${roles.size}`);
  for (const [r, n] of [...roles.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    role="${r}".padded`.replace(".padded", "").padEnd(34) + ` ${n} occurrences`);
  }
  const fatherRole = [...roles.keys()].find((r) => /father/i.test(r));
  if (fatherRole) {
    let noFather = 0, hasFather = 0;
    for (const e of rows) {
      const rs = new Map<string, number>();
      collectRoles(e.content?.gedcomx, rs);
      (rs.has(fatherRole) ? () => hasFather++ : () => noFather++)();
    }
    console.log(`\n  by role="${fatherRole}": ${hasFather} personas' records name a father, ${noFather} do NOT`);
    console.log("  ^ THIS is the classifier a bound-target probe should use.");
  } else {
    console.log("\n  no father-ish role value in this pool");
  }

  console.log(`\n  distinct labelIds in this pool: ${freq.size}`);
  const kin = [...freq.entries()].filter(([l]) => /FATHER|MOTHER|SPOUSE|PARENT/i.test(l))
    .sort((a, b) => b[1] - a[1]);
  console.log(`\n  kin-related labels (${kin.length}):`);
  for (const [l, n] of kin) console.log(`    ${l.padEnd(38)} on ${n}/${rows.length} personas`);
  if (kin.length === 0 || !crossTab) {
    console.log("    NONE — so the index view of relatives is not in this payload after all.");
    console.log("    Top 25 labels present, for the record:");
    for (const [l, n] of [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) {
      console.log(`      ${l.padEnd(38)} ${n}`);
    }
    return;
  }

  // 2. graph classifier vs index classifier, same personas
  const fatherLabels = kin.filter(([l]) => /FATHER/i.test(l)).map(([l]) => l);
  console.log(`\n  treating these as "index names a father": ${fatherLabels.join(", ")}`);
  const tab = { graphAbsent_indexNo: 0, graphAbsent_indexYes: 0, graphPresent_indexNo: 0, graphPresent_indexYes: 0, skipped: 0 };
  for (const e of rows) {
    const picked = findRepresentedPerson(e);
    const raw = e.content?.gedcomx;
    if (!picked || !raw) { tab.skipped++; continue; }
    const st = resolveRelativeTerms(toSimplified(raw), picked.person.id, [{ prefix: "father" }], picked.anchor);
    const graphAbsent = st?.father?.status === "absent";
    const labels = new Set<string>();
    collectLabels(raw, labels);
    const indexYes = fatherLabels.some((l) => labels.has(l));
    if (graphAbsent) indexYes ? tab.graphAbsent_indexYes++ : tab.graphAbsent_indexNo++;
    else indexYes ? tab.graphPresent_indexYes++ : tab.graphPresent_indexNo++;
  }
  console.log("\n  cross-tab over the same personas:");
  console.log(`    graph says ABSENT  + index has NO father label : ${tab.graphAbsent_indexNo}   <- candidates for a bound target`);
  console.log(`    graph says ABSENT  + index HAS a father label  : ${tab.graphAbsent_indexYes}   <- the graph was blind here`);
  console.log(`    graph says present + index has NO father label : ${tab.graphPresent_indexNo}`);
  console.log(`    graph says present + index HAS a father label  : ${tab.graphPresent_indexYes}`);
  console.log(`    skipped (no persona / no gedcomx)             : ${tab.skipped}`);
}
async function main(): Promise<void> {
  for (const p of POOLS) await runPool(p.qs, p.name, p.crossTab);
}

main().catch((e) => { console.error(e); process.exit(1); });

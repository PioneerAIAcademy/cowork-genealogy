/**
 * Does the empty-field leg hold for the THREE UNMEASURED relative families?
 *
 * EXPLORATORY. **Its output is not in `dev/measured-figures.json` and must not be
 * cited as measured.** Nothing here calls `record()`.
 *
 * The artifact enumerates the empty-field leg for two relative families only —
 * `F.verdict:relative .exact requires the relative to be present` (father) and
 * `R.verdict:spouse .exact requires the spouse to be present` (spouse). Six
 * `*Exact` descriptions on `record_search` therefore read "Assumed, as
 * `motherGivenNameExact`; only the father and spouse families were enumerated."
 * Six hedges is a measurement task, not a wording task. This measures the other
 * three: `mother`, `parent`, `other`.
 *
 * ## Method
 *
 * The unmatchable-token method from `explore-name-empty-field-leg-records.ts`,
 * plus set membership against a classified baseline, so no verdict rests on a
 * total alone:
 *
 *   1. Enumerate the pool with no relative term, to the end.
 *   2. Classify every row with the PRODUCTION detector — `findRepresentedPerson`
 *      + `resolveRelativeTerms`, imported, not reimplemented. A parallel copy is
 *      how the givenName leg of the sibling script ended up conflating "no typed
 *      Given part" with "no given name".
 *   3. For each family: add an unmatchable token, read to the end, and check
 *      whether the rows classified `absent` are still in the set. Then add
 *      `.exact=on` and check they are gone.
 *
 * `father` and `spouse` run as CONTROLS. They have recorded verdicts, so if the
 * method does not reproduce them it is the method that is wrong, and the run
 * refuses everything rather than reporting the other three.
 *
 * ## What it actually reported, and why that is a REFUSAL and not a finding
 *
 * On the Brazil/Lapa/1880 births pool, every family — including both controls —
 * came back "absent kept 0". The returned sets are not blind (breakdowns run
 * present=94/96, 312/320, 62/64, with `absent`=0 throughout), and the
 * `absent`-classified population is legitimate: a sibling probe,
 * `explore-father-absent-principals-records.ts`, shows 230/258 are CHILD endpoints
 * and 247/258 are flagged `principal=true` — mother-only registrations, not parent
 * personas. So neither the classifier nor the population explains it.
 *
 * That leaves the QUERY SHAPE, which is where this probe differs from production and
 * has not been tested: it supplies a relative name as the ONLY name term, whereas a
 * real `record_search` anchors on a principal name and adds the relative as a
 * supplement. Under `m.queryRequireDefault=on` a lone relative term is the sole
 * discriminator, which is plausibly why nothing survives. Until that variant is run,
 * this script's output is NOT evidence against the shipped rule that a record naming
 * no such relative is kept — it is a probe whose controls did not reproduce their
 * recorded verdicts, which by its own rule means the METHOD is suspect.
 *
 * ## Three traps specific to this probe
 *
 * 1. `other` IS QUERY-DEPENDENT. `resolveOtherTerm` compares co-person names to
 *    the query rather than resolving a relationship role, so under a gibberish
 *    token it returns `absent` even for a record that names plenty of
 *    co-occurring people. Using the production detector for `other` would
 *    measure the token, not the record. `other` gets an explicit
 *    "graph usable and exactly one person" detector instead.
 * 2. `unknown` IS NOT `absent`. `resolveParentTerm` returns `unknown` when the
 *    relationship graph is missing or a parent endpoint will not resolve, and
 *    those rows are excluded from both sides — counting them as `absent` would
 *    manufacture the finding.
 * 3. AN UNMATCHABLE TOKEN IS CONFOUNDED HERE, and the first run of this script
 *    used one, which is why it reported "kept 0" for every family including both
 *    controls. For the PRINCIPAL `givenName` a gibberish token works: the set
 *    comes back non-empty and what survives is the given-name-empty floor. For a
 *    RELATIVE the same token returns an EMPTY set, and empty is consistent with
 *    two different worlds — "the term is required, so nothing matched" and "there
 *    is no empty-field floor". Membership in an empty set distinguishes nothing.
 *    Real names keep the set non-empty, so retention of the `absent`-classified
 *    rows becomes a real observation. `m.queryRequireDefault=on` is what makes the
 *    term bind at all, and production sends it, so it stays on.
 *
 * Run: `npx tsx dev/explore-relative-empty-field-families.ts` from
 * `packages/engine/mcp-server`.
 */
import { getValidToken } from "../src/auth/refresh.js";
import { BROWSER_USER_AGENT } from "../src/constants.js";
import { fetchWithTimeout } from "../src/utils/http.js";
import { toSimplified } from "../src/utils/gedcomx-convert.js";
import { findRepresentedPerson, resolveRelativeTerms } from "../src/tools/record-search.js";

const BASE = "https://www.familysearch.org/service/search/hr/v2/personas";
const REQUIRE = "m.queryRequireDefault=on";
/**
 * REAL names, not gibberish — see trap 3. Three of them: agreement across three
 * unrelated names is what separates a real floor from one name's quirk.
 */
const NAMES = ["Jose", "Maria", "Antonio"];
/**
 * Two pools, because one record type cannot test every family. The births pool has
 * no spouse population at all (`q.spouseGivenName` returns an empty set there, which
 * is trap 3), so `spouse` — one of the two families the artifact DOES record — is
 * only testable on a marriage pool. Running both also checks the finding is not an
 * artifact of one record type.
 */
const POOLS = [
  { name: "Brazil/Lapa/1880 births (f.recordType=0)",
    qs: "q.recordCountry=Brazil&f.recordType=0&q.birthLikeDate.from=1880&q.birthLikeDate.to=1880" +
        "&q.birthLikePlace=Lapa&q.birthLikePlace.exact=on" },
  { name: "Brazil/Lapa/1880-1889 marriages (f.recordType=1)",
    qs: "q.recordCountry=Brazil&f.recordType=1&q.marriageLikeDate.from=1880&q.marriageLikeDate.to=1889" +
        "&q.marriageLikePlace=Lapa&q.marriageLikePlace.exact=on" },
];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Row { id: string; entry: any }

/** Read a set to the end. `null` means not comparable — never a partial. */
async function readAll(qs: string, cap = 1500): Promise<{ total: number | null; rows: Row[] } | null> {
  const rows: Row[] = [];
  let total: number | null = null;
  let retry = 0;
  for (let offset = 0; offset < cap; offset += 100) {
    await sleep(300);
    const token = await getValidToken();
    const res = await fetchWithTimeout(
      `${BASE}?${qs}&count=100&offset=${offset}&${REQUIRE}`,
      { headers: { Authorization: `Bearer ${token}`, Accept: "application/json",
                   "Accept-Language": "en", "User-Agent": BROWSER_USER_AGENT } });
    if (res.status === 204) return { total: total ?? 0, rows };   // meaningful zero
    if (res.status === 429) {
      const ra = Number(res.headers.get("retry-after"));
      if (++retry > 8) return null;
      await sleep((Number.isFinite(ra) ? ra : 5) * 1000 + 1500);
      offset -= 100;
      continue;
    }
    if (!res.ok) return null;
    const b: any = await res.json();
    total ??= b?.results ?? null;
    const entries = b?.entries ?? [];
    for (const e of entries) if (e?.id) rows.push({ id: e.id, entry: e });
    if (entries.length < 100) return { total, rows };
  }
  return null;   // hit the cap without terminating: not enumerated, so not comparable
}

/** Full status per the PRODUCTION detector — the breakdown, not just a boolean. */
function roleStatus(entry: any, prefix: "father" | "mother" | "parent" | "spouse"): string {
  const picked = findRepresentedPerson(entry);
  if (!picked) return "no-persona";
  const raw = entry.content?.gedcomx;
  if (!raw) return "no-gedcomx";
  const found = resolveRelativeTerms(
    toSimplified(raw), picked.person.id, [{ prefix }], picked.anchor);
  return found?.[prefix]?.status ?? "none";
}

/** `absent` per the PRODUCTION detector, for the four role-based prefixes. */
function roleAbsent(entry: any, prefix: "father" | "mother" | "parent" | "spouse"): boolean {
  const picked = findRepresentedPerson(entry);
  if (!picked) return false;
  const raw = entry.content?.gedcomx;
  if (!raw) return false;
  const found = resolveRelativeTerms(
    toSimplified(raw), picked.person.id, [{ prefix }], picked.anchor);
  return found?.[prefix]?.status === "absent";
}

/** Trap 1: `other` cannot use the production detector. Names no co-occurring person at all. */
function otherAbsent(entry: any): boolean {
  const persons = entry.content?.gedcomx?.persons ?? [];
  return persons.length === 1;
}

const FAMILIES = [
  { prefix: "father", param: "q.fatherGivenName", control: true },
  { prefix: "spouse", param: "q.spouseGivenName", control: true },
  { prefix: "mother", param: "q.motherGivenName", control: false },
  { prefix: "parent", param: "q.parentGivenName", control: false },
  { prefix: "other",  param: "q.otherGivenName",  control: false },
] as const;

async function runPool(POOL: string, label: string): Promise<void> {
  console.log(`\n############ ${label} ############`);
  console.log("=== baseline: no relative term ===");
  const base = await readAll(POOL);
  if (base === null) { console.log("  baseline did not enumerate — REFUSING every verdict"); return; }
  console.log(`  total ${base.total}, read ${base.rows.length} to the end`);
  if (base.total === null || base.rows.length !== base.total) {
    console.log(`  closure FAILED: read ${base.rows.length}, total reported ${base.total} — REFUSING every verdict`); return;
  }

  const results: Array<{ prefix: string; control: boolean; keeps: boolean | null; drops: boolean | null; n: number }> = [];

  for (const fam of FAMILIES) {
    console.log(`\n=== ${fam.prefix} ${fam.control ? "(CONTROL — has a recorded verdict)" : ""} ===`);
    const absent = new Set(
      base.rows.filter((r) => fam.prefix === "other"
        ? otherAbsent(r.entry)
        : roleAbsent(r.entry, fam.prefix as "father" | "mother" | "parent" | "spouse")).map((r) => r.id));
    console.log(`  rows classified ABSENT in the baseline: ${absent.size}/${base.rows.length}`);
    if (absent.size === 0) {
      console.log("  nothing to test — REFUSING a verdict for this family (not 'it does not apply')");
      results.push({ prefix: fam.prefix, control: fam.control, keeps: null, drops: null, n: 0 });
      continue;
    }

    let keptAll = true, droppedAll = true, comparable = true;
    for (const t of NAMES) {
      const u = await readAll(`${POOL}&${fam.param}=${t}`);
      const x = await readAll(`${POOL}&${fam.param}=${t}&${fam.param}.exact=on`);
      if (u === null || x === null) { console.log(`  + ${t}: not comparable`); comparable = false; break; }
      const uSet = new Set(u.rows.map((r) => r.id));
      const xSet = new Set(x.rows.map((r) => r.id));
      const kept = [...absent].filter((id) => uSet.has(id)).length;
      const stillThere = [...absent].filter((id) => xSet.has(id)).length;
      if (kept !== absent.size) keptAll = false;
      if (stillThere !== 0) droppedAll = false;
      if (u.rows.length === 0) {
        console.log(`  + ${t}: unqualified set is EMPTY — membership says nothing, not comparable`);
        comparable = false; break;
      }
      // Cross-check: what IS in the returned set? "absent kept 0" is only
      // meaningful if the set is full of `present` rows. If it is mostly
      // `unknown`, the classifier is blind and the 0 means nothing.
      const tally: Record<string, number> = {};
      for (const r of u.rows) {
        const st = fam.prefix === "other"
          ? (otherAbsent(r.entry) ? "absent" : "has-co-person")
          : roleStatus(r.entry, fam.prefix as "father" | "mother" | "parent" | "spouse");
        tally[st] = (tally[st] ?? 0) + 1;
      }
      const shape = Object.entries(tally).map(([k, v]) => `${k}=${v}`).join(" ");
      console.log(`  + ${t}: unqualified ${u.rows.length} rows (total ${u.total}), absent kept ${kept}/${absent.size}` +
                  ` | .exact ${x.rows.length} rows (total ${x.total}), absent still there ${stillThere}`);
      console.log(`      returned set breakdown: ${shape}`);
    }
    if (!comparable) {
      results.push({ prefix: fam.prefix, control: fam.control, keeps: null, drops: null, n: absent.size });
      continue;
    }
    console.log(`  => unqualified KEEPS the absent rows: ${keptAll}   |   .exact DROPS them: ${droppedAll}`);
    results.push({ prefix: fam.prefix, control: fam.control, keeps: keptAll, drops: droppedAll, n: absent.size });
  }

  console.log("\n=== controls ===");
  const controls = results.filter((r) => r.control);
  const controlsHold = controls.length > 0 && controls.every((r) => r.keeps === true && r.drops === true);
  for (const c of controls) console.log(`  ${c.prefix}: keeps ${c.keeps}, drops ${c.drops}`);
  if (!controlsHold) {
    console.log("  CONTROLS DID NOT REPRODUCE F/R — the method is wrong, so REFUSING all three findings.");
    return;
  }
  console.log("  both reproduce their recorded verdicts, so the method is sound on this pool.");

  console.log("\n=== the three previously unmeasured families ===");
  for (const r of results.filter((x) => !x.control)) {
    console.log(`  ${r.prefix.padEnd(7)} ${r.keeps === null ? "REFUSED (not comparable / nothing to test)"
      : `keeps=${r.keeps} drops=${r.drops}  (n=${r.n})`}`);
  }
}

async function main(): Promise<void> {
  for (const p of POOLS) await runPool(p.qs, p.name);
}

main().catch((e) => { console.error(e); process.exit(1); });

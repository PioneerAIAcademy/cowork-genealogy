/**
 * Does an unqualified name field keep records where THAT FIELD IS EMPTY?
 *
 * EXPLORATORY. **Its output is not in `dev/measured-figures.json` and must not be
 * cited as measured.** Nothing here calls `record()`. Committed because getting this
 * measurable took five wrong attempts, and the wrong attempts are the expensive part.
 *
 * PROMOTE, alongside the other records-side explorers, under #1771 steps 0-1: this
 * is the record index, where figures are allowed. It answers a question the artifact
 * leaves open — `T.verdict:all name fields behave alike` reads "NOT MEASURED", and
 * every empty-field verdict in the artifact (F, R, S) is about a RELATIVE's name, not
 * about the principal `surname`/`givenName`.
 *
 * ## What it reports
 *
 * The two principal fields behave OPPOSITELY, which is why one test each is not
 * enough:
 *
 *   givenName  an unqualified value keeps records with no typed Given part. Three
 *              unmatchable tokens retain ~251/252/252 of a 6,038 pool; `.exact`
 *              takes it to 0.
 *   surname    an unqualified value DROPS surname-empty records. A bound
 *              surname-empty record is present in a 1,100-row set read to the end and
 *              absent under three unmatchable tokens, each of which returns ZERO rows
 *              — not a low rank, an empty set.
 *
 * ## Five traps, each of which produced a wrong answer first
 *
 * 1. INCOHERENT ANCHOR. `f.recordType=0` is births; pairing it with
 *    `q.residenceDate` gave a 156M baseline and meaningless retention.
 * 2. A DETECTOR THAT CONFLATED TWO THINGS. "No typed Surname part" is not "no
 *    surname": some records put the whole name in the Given part, so
 *    `fullText: "Henry Pocklington"` can have zero Surname parts while the string is
 *    still in the name index. The SURNAME leg cross-checks `fullText` against the
 *    parts before accepting the bound target. The GIVENNAME leg does NOT — it
 *    counts typed Given parts
 *    only, so its 58/60 is a lower bound on given-name-silence, not a cross-checked
 *    count. Adding the same cross-check there is the open follow-up.
 * 3. A COMMON GIVEN NAME. Anchoring on `Maria` in Brazil means every pool is
 *    millions and you are reduced to inferring from totals instead of reading sets.
 * 4. THE NAME-EMPTY FLOOR. Any `q.givenName` term drags in every given-name-empty
 *    record, so the total barely moves with the name — five rare names all returned
 *    ~10,100 on one decade. A name-anchored pool will therefore not enumerate, and
 *    picking a rarer name does not help. Anchor WITHOUT a name term.
 * 5. PLACE EXPANSION. `q.birthLikePlace=Lapa` expands upward and would not
 *    enumerate; `q.birthLikePlace.exact=on` cut the same pool to 1,100. That toggle
 *    is what made the surname half provable at all.
 *
 * Run: `npx tsx dev/explore-name-empty-field-leg-records.ts` from
 * `packages/engine/mcp-server`.
 */
import { getValidToken } from "../src/auth/refresh.js";
import { BROWSER_USER_AGENT } from "../src/constants.js";
import { fetchWithTimeout } from "../src/utils/http.js";

const BASE = "https://www.familysearch.org/service/search/hr/v2/personas";
const REQUIRE = "m.queryRequireDefault=on";
/** Three tokens, not one: agreement is what separates silence from fuzzy reach (section S). */
const GIBBERISH = ["Xzqwbrtl", "Qwbrtlzx", "Vhkzptmw"];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Row { id: string; fullText: string; given: string[]; surname: string[] }

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
    if (res.status === 429 && retry < 6) {
      const ra = Number(res.headers.get("retry-after") ?? 5);
      await sleep((Number.isFinite(ra) ? ra : 5) * 1000 + 500);
      retry++; offset -= 100; continue;
    }
    if (!res.ok) return null;
    retry = 0;
    const b: any = await res.json();
    total ??= b?.results ?? null;
    const entries = b?.entries ?? [];
    for (const e of entries) {
      const p = (e?.content?.gedcomx?.persons ?? [])[0] ?? {};
      const nf = p?.names?.[0]?.nameForms?.[0] ?? {};
      const parts = (nf?.parts ?? []) as Array<{ type?: string; value?: string }>;
      const pick = (t: string) => parts.filter((x) => String(x.type ?? "").endsWith(t)).map((x) => String(x.value ?? ""));
      rows.push({ id: e.id, fullText: String(nf?.fullText ?? ""), given: pick("/Given"), surname: pick("/Surname") });
    }
    if (entries.length < 100) return { total, rows };
  }
  return null;   // cap exhausted with a full page: partial, not comparable
}

async function main(): Promise<void> {
  // ---- givenName: does an unqualified value keep given-name-empty records? ----
  const GPOOL = "q.surname=Pocklington&q.recordCountry=England&f.recordType=0";
  console.log("=== givenName ===");
  const gBase = await readAll(`${GPOOL}&count=1`, 100);
  console.log(`  surname only ............................. total ${gBase?.total ?? "not comparable"}`);
  const gTotals: Array<number | null> = [];
  let gEmptyVerified = 0, gSampled = 0;
  for (const t of GIBBERISH) {
    const r = await readAll(`${GPOOL}&q.givenName=${t}`, 400);
    gTotals.push(r?.total ?? null);
    for (const row of (r?.rows ?? []).slice(0, 20)) {
      gSampled++;
      if (row.given.length === 0) gEmptyVerified++;
    }
    console.log(`  + unmatchable givenName ${t} ....... total ${r?.total ?? "not comparable"}`);
  }
  const gEx = await readAll(`${GPOOL}&q.givenName=${GIBBERISH[0]}&q.givenName.exact=on`, 200);
  console.log(`  + that token AND .exact=on ............... total ${gEx?.total ?? "not comparable"}`);
  // `spread` on a one-element set is 0, which would satisfy a guard whose whole
  // purpose is AGREEMENT ACROSS TOKENS: if two of the three reads come back `null`,
  // `gNums` is `[251]`, spread is 0, and the verdict fires off a single comparable
  // read while printing "three tokens agree". The set-size precondition has to sit
  // outside `spread`, because there is no value `spread([x])` can return that is
  // both honest and usable.
  const spread = (xs: number[]) => (Math.max(...xs) - Math.min(...xs)) / Math.max(...xs);
  const gNums = gTotals.filter((n): n is number => n !== null);
  const allThreeComparable = gNums.length === GIBBERISH.length;
  const agree = allThreeComparable && spread(gNums) <= 0.02;
  console.log(`  all ${GIBBERISH.length} tokens comparable: ${allThreeComparable}` +
              `   agree (spread <= 2%): ${agree}   [${gNums.join(", ")}]`);
  console.log(`  retained rows with NO typed Given part: ${gEmptyVerified}/${gSampled}`);
  console.log(`  => VERDICT: ${!allThreeComparable
    ? `not established by this run — only ${gNums.length} of ${GIBBERISH.length} token reads were comparable`
    : agree && gEmptyVerified > gSampled * 0.8 && gEx?.total === 0
      ? "unqualified KEEPS records with no typed Given part; .exact removes them"
      : "not established by this run"}`);

  // ---- surname: bound-record membership, no name term in the anchor (trap 4) ----
  const TARGET = "6NVD-8MRS";   // fullText "Escolastica", one Given part, no Surname part
  const SPOOL = "q.recordCountry=Brazil&f.recordType=0&q.birthLikeDate.from=1880&q.birthLikeDate.to=1880" +
                "&q.birthLikePlace=Lapa&q.birthLikePlace.exact=on";   // trap 5
  console.log("\n=== surname ===");
  const sBase = await readAll(SPOOL);
  if (sBase === null) { console.log("  baseline did not enumerate — REFUSING a verdict"); return; }
  const bound = sBase.rows.find((r) => r.id === TARGET);
  console.log(`  baseline, no name term ................... total ${sBase.total}, read ${sBase.rows.length}`);
  console.log(`  bound target 1:1:${TARGET} present: ${Boolean(bound)}` +
              (bound ? `  (fullText "${bound.fullText}", Given=${bound.given.length}, Surname=${bound.surname.length})` : ""));
  if (!bound) { console.log("  target not in the baseline — REFUSING a verdict (the pool moved)"); return; }
  if (bound.surname.length !== 0 || bound.fullText.trim().split(/\s+/).length !== 1) {
    console.log("  target is NOT surname-empty by fullText+parts — REFUSING a verdict (trap 2)"); return;
  }
  let allAbsent = true, allZero = true;
  for (const t of GIBBERISH) {
    const r = await readAll(`${SPOOL}&q.surname=${t}`);
    if (r === null) { console.log(`  + unmatchable surname ${t}: not comparable`); allAbsent = false; continue; }
    const present = r.rows.some((x) => x.id === TARGET);
    if (present) allAbsent = false;
    if (r.total !== 0) allZero = false;
    console.log(`  + unmatchable surname ${t} ......... total ${r.total}, target ${present ? "PRESENT" : "absent"}`);
  }
  console.log(`  => VERDICT: ${allAbsent
    ? "unqualified DROPS surname-empty records" + (allZero ? " (every token returned an empty set, so this is not a ranking artifact)" : "")
    : "not established by this run"}`);
  console.log("\n  The two fields behave OPPOSITELY. That is the finding.");
}
main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });

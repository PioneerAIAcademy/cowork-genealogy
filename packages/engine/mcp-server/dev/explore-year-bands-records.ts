/**
 * Year-band membership on the RECORDS endpoint, by enumeration.
 *
 * EXPLORATORY. **Its output is not in `dev/measured-figures.json` and must not be
 * cited as measured.** Nothing here calls `record()`, so no verdict it prints can
 * be traced, contradicted, or diffed against a re-run — which is exactly the
 * defect that reached a shipped tool description and two specs before review and a
 * self-audit caught it (issue #1409). Committed so the next person starts from
 * working code rather than from a prose description of a result.
 *
 * Narrows a pool until the unranged set reads to the end, partitions the year axis
 * into disjoint 50-year bands, enumerates every band and its `.exact` counterpart,
 * and classifies each persona by how many bands contain it. Reported 585 rows, a
 * closure check of 1,465 = 1,465, zero personas in every band, and 1750-1799
 * falling 364 -> 29 under `.exact`. Read the closure assertion and the
 * payload-dated control before trusting any of it: closure alone is the WEAK guard
 * — it stays green through a dropped band and through a missing require switch.
 *
 * SHOULD BECOME CITABLE, and issue #1771 steps 0-1 own that: a section letter
 * wired into `SECTIONS`, `record()` calls for every figure and verdict, a verdict
 * string the producibility check can find in the source, and RULE 0 compliance
 * (refuse a direction when the set could not be enumerated). Do not promote it
 * before #1771's open questions are settled — the unbanded-persons gate, the
 * non-parish control pool, and which verdict keys are renamed — because recording
 * a verdict bakes in an answer to each.
 *
 * Run: `npx tsx dev/explore-year-bands-records.ts` from `packages/engine/mcp-server`.
 */
import { getValidToken } from "../src/auth/refresh.js";
import { BROWSER_USER_AGENT } from "../src/constants.js";

const POOL = "q.surname=Pocklington&q.givenName=Thomae&q.recordCountry=England&f.recordType=0";
const CAP = 4900;
let token = "";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Row { id: string; payloadYear: number | null }

/** Read a set to the end. Returns null if it never reached a short page. */
async function readAll(extra: string): Promise<{ total: number | null; rows: Row[] } | null> {
  const rows: Row[] = [];
  let total: number | null = null;
  let retry = 0;
  for (let offset = 0; offset < CAP; offset += 100) {
    await sleep(250);
    const res = await fetch(
      `https://www.familysearch.org/service/search/hr/v2/personas?${POOL}${extra}&count=100&offset=${offset}&m.queryRequireDefault=on`,
      { headers: { Authorization: `Bearer ${token}`, Accept: "application/json",
                   "Accept-Language": "en", "User-Agent": BROWSER_USER_AGENT } });
    // A transient 429 anywhere in 12 bands x 2 variants x N pages would otherwise
    // mark the band unenumerable and discard the whole run — and on the first read
    // it printed "narrow further", blaming pool size for throttling.
    if (res.status === 429 && retry < 6) {
      const ra = Number(res.headers.get("retry-after") ?? 5);
      await sleep((Number.isFinite(ra) ? ra : 5) * 1000 + 500);
      retry++;
      offset -= 100;
      continue;
    }
    if (!res.ok) return null;
    const b: any = await res.json();
    total ??= b?.results ?? null;
    const entries = b?.entries ?? [];
    for (const e of entries) {
      const m = (e?.content?.gedcomx?.persons ?? [])[0] ?? {};
      const yrs = ((m.facts ?? []) as any[])
        .filter((f) => /Birth|Christening|Baptism/i.test(f.type ?? ""))
        .map((f) => { const s = f.date?.original ?? ""; const mm = /\b(1[0-9]{3})\b/.exec(s); return mm ? Number(mm[1]) : null; })
        .filter((y): y is number => y !== null);
      const disp = /\b(1[0-9]{3})\b/.exec((m.display ?? {}).birthDate ?? "");
      rows.push({ id: e.id, payloadYear: yrs[0] ?? (disp ? Number(disp[1]) : null) });
    }
    if (entries.length < 100) return { total, rows };
  }
  return null;
}

async function main(): Promise<void> {
  token = await getValidToken();

  const u = await readAll("");
  if (!u) { console.log("unranged pool did not enumerate — narrow further"); return; }
  console.log(`unranged pool: total ${u.total}, read ${u.rows.length} rows in full`);
  const payloadDated = u.rows.filter((r) => r.payloadYear !== null).length;
  console.log(`  payload shows a birth year for ${payloadDated} of ${u.rows.length}; ${u.rows.length - payloadDated} show none\n`);

  const BANDS: Array<[number, number]> = [];
  for (let y = 1400; y < 2000; y += 50) BANDS.push([y, y + 49]);

  const membership = new Map<string, number>();
  const exactMembership = new Map<string, number>();
  const bandMembers = new Map<string, Set<string>>();   // band label -> ids, for the control
  console.log("band        total  read   | .exact total  read");
  console.log("-".repeat(52));
  let unenumerable = 0;
  // Counted straight off each response, NOT derived from `membership` — otherwise
  // the closure identity below compares a number to itself and can never fail,
  // which is worse than no check (CLAUDE.md: "a check that cannot fail reads as
  // coverage"). The first version of this block did exactly that.
  let bandRowsRead = 0;
  for (const [from, to] of BANDS) {
    const range = `&q.birthLikeDate.from=${from}&q.birthLikeDate.to=${to}`;
    const set = await readAll(range);
    const ex = await readAll(`${range}&q.birthLikeDate.exact=on`);
    if (!set) { unenumerable++; console.log(`${from}-${to}   DID NOT ENUMERATE`); continue; }
    bandRowsRead += set.rows.length;
    bandMembers.set(`${from}-${to}`, new Set(set.rows.map((r) => r.id)));
    for (const r of set.rows) membership.set(r.id, (membership.get(r.id) ?? 0) + 1);
    if (ex) for (const r of ex.rows) exactMembership.set(r.id, (exactMembership.get(r.id) ?? 0) + 1);
    console.log(
      `${from}-${to}  ${String(set.total).padStart(5)}  ${String(set.rows.length).padStart(4)}   | ` +
      `${String(ex?.total ?? "err").padStart(11)}  ${String(ex?.rows.length ?? "-").padStart(4)}`
    );
  }
  const N = BANDS.length - unenumerable;

  // THE CLOSURE IDENTITY, asserted over the UNRANGED SET so it can fail on data.
  //
  // The first two versions of this block were tautological. Both accumulated
  // `bandRowsRead` and the `membership` increments from the same `set.rows` in
  // adjacent statements, so the sums were identically equal for ANY input; the
  // injection that "proved" it could fail did so by mutating the code between
  // those two lines, which is a much narrower property than a closure identity.
  //
  // This version sums `k * count` over the histogram of the UNRANGED read, exactly
  // as the tree sibling does. A band that returns an id the unranged enumeration
  // did not contain contributes to `bandRowsRead` and to no histogram bucket, so
  // the two diverge — which is a real data-level failure (an incomplete unranged
  // read, or paging that served rows the first pass missed).
  //
  // Until 2026-08-20 this script printed the histogram and the band table and tied
  // them together nowhere: the "1,465 = 1,465" figure quoted for this pool was
  // arithmetic done by hand outside the script, and a commit message claimed the
  // assertion existed before it did. Both are the defect this file exists to stop.
  //
  // Closure remains the WEAK guard — it survives a dropped band (both sums fall
  // together) and a missing require switch (every band returns the whole pool, and
  // the sums still agree). The strong guard is the payload-dated control below:
  // a payload-dated persona must land in EXACTLY ONE band.
  const unrangedIds = new Set(u.rows.map((r) => r.id));
  let accountedFor = 0;
  for (const id of unrangedIds) accountedFor += membership.get(id) ?? 0;
  const strays = [...membership.keys()].filter((id) => !unrangedIds.has(id)).length;
  console.log(
    `\nCLOSURE: band rows read=${bandRowsRead}  accounted for by unranged ids=${accountedFor}  ` +
      `equal=${bandRowsRead === accountedFor}` + (strays ? `  (${strays} id(s) in a band but NOT in the unranged read)` : "")
  );
  if (bandRowsRead !== accountedFor) {
    console.log("  REFUSING a verdict: rows were counted on one side of the identity and not the other.");
    return;
  }
  if (unenumerable > 0) {
    console.log(`  REFUSING a verdict: ${unenumerable} band(s) did not enumerate, so coverage is partial.`);
    return;
  }

  const hist = new Map<number, number>();
  for (const r of u.rows) {
    const c = membership.get(r.id) ?? 0;
    hist.set(c, (hist.get(c) ?? 0) + 1);
  }
  console.log(`\n${N} bands enumerated (1400-1999, disjoint). Membership count per persona, over all ${u.rows.length} unranged rows:`);
  for (const [c, n] of [...hist].sort((a, b) => a[0] - b[0])) {
    const tag = c === 0 ? "  <- in NO band: every range dropped it"
      : c === N ? "  <- in EVERY band: genuinely index-silent"
      : c === 1 ? "  <- one index date (ordinary)"
      : "  <- index holds a SPAN";
    console.log(`   ${String(c).padStart(2)} band(s): ${String(n).padStart(4)} personas${tag}`);
  }

  // Control: does a payload date land in the band that contains it?
  // THE STRONG GUARD. A persona whose payload exposes a year must land in EXACTLY
  // ONE band, and in the band that contains that year.
  //
  // `>= 1` was the first version and it is useless: under the failure this guard
  // exists to catch — a missing `m.queryRequireDefault=on`, where every band
  // returns the whole pool — a dated persona is in all 12 bands and `>= 1` still
  // reports dated/dated. Closure passes that failure too (both sums rise together),
  // so this is the ONLY check that sees it. It refuses a verdict rather than
  // printing, for the same reason.
  const bandOf = (y: number): number => Math.floor((y - 1400) / 50);
  const dated = u.rows.filter((r) => r.payloadYear !== null);
  const wrongCount = dated.filter((r) => (membership.get(r.id) ?? 0) !== 1);
  const wrongBand = dated.filter((r) => {
    const b = bandOf(r.payloadYear as number);
    if (b < 0 || b >= BANDS.length) return false;   // dated outside the swept axis
    const [from, to] = BANDS[b]!;
    return !(bandMembers.get(`${from}-${to}`)?.has(r.id) ?? false);
  });
  console.log(
    `\ncontrol — payload-dated personas: ${dated.length}; in exactly one band: ` +
      `${dated.length - wrongCount.length}; in the band holding their own year: ` +
      `${dated.length - wrongBand.length}`
  );
  if (wrongCount.length || wrongBand.length) {
    console.log(
      `  REFUSING a verdict: ${wrongCount.length} dated persona(s) are not in exactly one band ` +
        `and ${wrongBand.length} are absent from the band holding their payload year. ` +
        `The usual cause is a missing m.queryRequireDefault=on, which makes every band ` +
        `return the whole pool — closure cannot see that.`
    );
    return;
  }

  // The silent cohort under .exact
  const silent = u.rows.filter((r) => (membership.get(r.id) ?? 0) === N && N > 0);
  const silentKept = silent.filter((r) => (exactMembership.get(r.id) ?? 0) > 0).length;
  console.log(`index-silent personas: ${silent.length}; of those, kept by .exact in >=1 band: ${silentKept}`);
  const noBand = u.rows.filter((r) => (membership.get(r.id) ?? 0) === 0);
  console.log(`personas in NO band: ${noBand.length}` +
    (noBand.length ? ` (payload year present for ${noBand.filter(r=>r.payloadYear!==null).length} of them)` : ""));
}
main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });

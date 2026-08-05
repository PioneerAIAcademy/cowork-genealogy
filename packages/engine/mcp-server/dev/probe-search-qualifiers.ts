/**
 * Probe — evidence trail behind the "What `.exact=on` actually does" section of
 * docs/specs/record-search-tool-spec-v2.md, and behind the `*Exact` schema
 * descriptions in src/tools/record-search.ts.
 *
 * Answers issue #1093: what the exact/close qualifier family actually does to a
 * FamilySearch record search, measured rather than inferred.
 *
 *   SECTION A — The require switch. `m.queryRequireDefault=on` (which the tool
 *     sends unconditionally) is the ONLY "required" mechanism; there is no
 *     per-field `.required` qualifier.
 *   SECTION B — Ranking displacement. Whether `.exact=on` changes WHICH records
 *     rank first, by diffing persona-ID lists page by page.
 *   SECTION C — Place expansion, right county vs wrong county vs exact.
 *   SECTION D — Where `surnameExact` destroys the answer.
 *   SECTION E — How far fuzzy given-name matching actually reaches, and where
 *     its coverage stops.
 *   SECTION F — Relative names keep records where the relative is absent.
 *   SECTION G — `recordCountry` is already strict.
 *
 * NOT COVERED: the `<event>Year` family. §1's "fuzzes around the range bounds"
 * is the one per-family direction no section here measures, so a reader
 * checking that claim has to go back to the issue's own comment thread. Adding
 * a section H is the obvious extension.
 *
 * EVERY CONCLUSION LINE IS COMPUTED FROM THE RUN, never a literal. Section F
 * used to end in a hardcoded `console.log` asserting "gibberish -> 0" — it
 * printed that verdict on a run whose own measured value was 241, which is the
 * exact failure mode an evidence-trail script cannot have. If you add a
 * section, derive its verdict from its own numbers and let it say NOT
 * CONFIRMED when the data says so.
 *
 * A WARNING FROM SECTION F's HISTORY, 2026-08-04. Making that verdict computed
 * produced a confident REFUTATION of the spec's relative-name paragraph — and
 * the refutation was wrong, three times over, each time because the code had
 * identified the wrong person as "the father": `others[0]`, then
 * `display.role === "Father"`, then the principal's father on records where
 * the search had matched the father himself. The tell each time was a
 * conflicting-father tally dominated by the SEARCHED given name. The spec is
 * right: an unqualified relative name returns fuzzy variants, initials, or
 * blank — never a conflicting relative. Resolve the father through the
 * ParentChild relationship graph against `persons[0]`, and treat any
 * "contradicting" result as a parse bug until you have checked it by hand.
 *
 * RESULTS (measured 2026-08-04; recorded so a future reader need not re-run):
 *
 *   A. `q.surname.required=on` → 400 "Unable to map supplied value=required to
 *      term modifier". No per-field required qualifier exists. With the global
 *      switch, `Zsigmondy`+exact (634) plus a gibberish given name / an
 *      impossible 1700-1710 birth range / Alaska-as-birthplace returned
 *      6 / 4 / 4. WITHOUT the switch: 634 / 634 / 634 — unchanged. Every added
 *      `q.*` term was ignored outright. `f.*` filters apply either way.
 *
 *   B. `.exact=on` changes the COUNT, not the ranking — so it cannot surface a
 *      record a fuzzy search buries. Displacement in the top 200:
 *      Measured over the FULL top 200 (two pages of 100), not a sample:
 *        Zsigmondy   108,398 → 634     (171x)  0 fuzzy-only, 0 positions moved
 *        Mingazzini   40,906 → 1,795    (23x)  0 fuzzy-only, 0 positions moved
 *        Geach    18,520,641 → 23,185  (799x)  2 fuzzy-only, first at rank 100,
 *                                              max 1 position among the 198 common
 *      Fuzzy matches interleave by relevance rather than strictly appending,
 *      but even at 800x inflation only two fuzzy-only records reach the top 200,
 *      and neither displaces a real match out of it.
 *
 *   C. Neal/James x Martha, Nevada County AR, marr. 1874-76. All three rows come
 *      from the ONE base query sectionC() sends, so they are directly comparable:
 *        right county, fuzzy place        35,510  target ranked 1 and 2
 *        right county, marriagePlaceExact      2  target ranked 1 and 2
 *        WRONG county (Yell), fuzzy       35,473  target absent
 *      Right 35,510 vs wrong 35,473 is 0.1% apart — an unqualified county scope
 *      barely discriminates, so its total is not an exhaustiveness signal. The
 *      qualifier fixes the count and moves nothing the agent reads.
 *      Do NOT reintroduce the `39,793 vs 39,750` pair that stood here: those
 *      figures came from the issue-thread probe under a different query shape and
 *      this section cannot produce them, so quoting them beside 35,510 implied a
 *      right-county total that changed between two adjacent lines. Same finding,
 *      one query — which is the "hold the query CONSTANT" rule this file opens with.
 *
 *   D. The same target is indexed under the surname `Neill`. Holding
 *      marriagePlaceExact fixed: `Neal` fuzzy → 2 (found); `Neal`+surnameExact
 *      → 0 (destroyed); `Neill`+surnameExact → 2 (only if you already knew the
 *      spelling). Fuzzy surname matching is what bridges an index misspelling.
 *
 *   E. Martin, Gloucestershire, 1810-14: fuzzy `Elizabeth` ranks
 *      Elizabeth Laura Martin first and does not surface the target in its top
 *      6; `Betty` ranks "Betty Martin, parents Thomas Martin & Sophia" FIRST.
 *      A top-100 sample of fuzzy `Elizabeth` held Elizabeth:72 Eliza:14
 *      Betsy:10 and no Betty. So fuzzy coverage is PARTIAL, not absent: it
 *      bridges standardized abbreviations (section F shows an unqualified
 *      `fatherGivenName=William` returning Wm:21 Wm.:14, which `.exact=on`
 *      then removes) and some nicknames (Eliza, Betsy), but not all of them.
 *      Nothing you can set widens it — qualifiers only subtract — so a
 *      diminutive fuzzy does not happen to cover must be searched as its own
 *      `givenName` value. This is why name-search-mechanics.md's
 *      "Auto-applied in fuzzy search" caption over the nickname table is the
 *      damaging part: it reads as complete coverage.
 *
 *   F. 300-result father-name survey:
 *        baseline (no father term)     104 father-bearing  John:12 William:6
 *        q.fatherGivenName=William     287 father-bearing  William:235 Wm:21 Wm.:14
 *        ...plus .exact=on             300 father-bearing  William:297 (no Wm/Wm.)
 *        gibberish father name           0 father-bearing
 *      The gibberish row proves different-father records ARE excluded. So an
 *      unqualified relative name keeps matches, keeps records where that
 *      relative was never indexed, and drops contradicting ones. `.exact`
 *      breaks it twice: it drops the silent records AND the 11% indexed Wm/Wm.
 *
 *   G. `q.recordCountry=Narnia` → 0. Already strict; no flag, none needed.
 *
 * METHOD TRAPS (each one cost a wrong answer at least once):
 *   - The total-hit field is top-level `results`, not `totalMatches`.
 *   - You MUST send `m.queryRequireDefault=on`, because the tool always does.
 *     Omit it and you measure a query shape production never issues.
 *   - A count of 2147483647 is an Int32 saturation sentinel, not a measurement.
 *   - Hold the query CONSTANT across a comparison. Comparing a no-spouse fuzzy
 *     search against a with-spouse exact one produced a false "the target is
 *     buried" reading during this investigation.
 *   - A count comparison says nothing about ranking. Diff the persona IDs.
 *
 * Usage:
 *   npx tsx dev/probe-search-qualifiers.ts          # all sections
 *   npx tsx dev/probe-search-qualifiers.ts B D      # only the named sections
 *
 * Requires a live FamilySearch session. Log in with `make e2e-login` from the
 * repo root (opens a browser; uses the bundled client ID; token lasts ~24h and
 * is shared host-wide). Do NOT reach for `dev/try-login.ts` — it takes an
 * explicit <clientId> argument. The token here comes from getValidToken(),
 * never from a literal in this file.
 */

import { getValidToken } from "../src/auth/refresh.js";
import { BROWSER_USER_AGENT } from "../src/constants.js";

const SEARCH_URL =
  "https://www.familysearch.org/service/search/hr/v2/personas";
const REQUIRE_SWITCH = "m.queryRequireDefault=on";

let token = "";

/**
 * A co-named person on a record, with the role the index assigns it
 * (`display.role`: "Father", "Mother", "Spouse", "Child", …). Section F
 * depends on the role: "does this record name a father?" is not the same
 * question as "does this record name anybody besides the principal?", and
 * an earlier version of that section conflated the two.
 */
interface CoNamed {
  name: string;
  role: string;
}

interface Persona {
  id: string;
  /** Display name of the `principal === true` person — used for the C/E rows. */
  name: string;
  others: CoNamed[];
  /**
   * `persons[0]` — the persona the SEARCH MATCHED, which is often not the
   * record's principal. On a christening matched via the father's name, the
   * principal is the child and `persons[0]` is the father.
   */
  matchedName: string;
  /**
   * The father OF THE MATCHED PERSONA, resolved through the ParentChild
   * relationship graph; `null` when the record is silent about that persona's
   * father.
   *
   * Three wrong ways to compute this, all of which we tried:
   *   - `others[0]` — any co-named person, whatever their role.
   *   - `display.role === "Father"` — that field is absent on most personas
   *     and, when present, varies ("Father Of Groom", "Other", "Principal").
   *   - the role=Father person relative to `principal === true` — that is the
   *     principal's father, and when the search matched the father himself
   *     it returns the searched person, making a silent record look like a
   *     contradicting one.
   * Each of those makes an unqualified relative term look like it retains
   * conflicting relatives. It does not; see SECTION F.
   */
  fatherOfMatched: string | null;
}

interface Hit {
  total: number | null;
  personas: Persona[];
  error: string | null;
}

async function search(query: string): Promise<Hit> {
  const res = await fetch(`${SEARCH_URL}?${query}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Accept-Language": "en",
      "User-Agent": BROWSER_USER_AGENT,
    },
  });
  const body = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { total: null, personas: [], error: `HTTP ${res.status}: unparseable` };
  }
  interface RelRef {
    resourceId?: string;
  }
  const j = parsed as {
    results?: number;
    errors?: string[];
    entries?: Array<{
      id?: string;
      content?: {
        gedcomx?: {
          persons?: Array<Record<string, unknown>>;
          relationships?: Array<{ type?: string; person1?: RelRef; person2?: RelRef }>;
        };
      };
    }>;
  };
  if (j.errors) return { total: null, personas: [], error: j.errors.join("; ") };

  const personas: Persona[] = (j.entries ?? []).map((e) => {
    const persons = e.content?.gedcomx?.persons ?? [];
    const principal =
      persons.find((p) => p.principal === true) ?? persons[0] ?? {};
    const display = (principal.display ?? {}) as { name?: string };
    const others = persons
      .filter((p) => p !== principal)
      .map((p) => {
        const d = (p.display ?? {}) as { name?: string; role?: string };
        return { name: d.name ?? "", role: d.role ?? "?" };
      })
      .filter((o) => Boolean(o.name));

    // The matched persona is persons[0], NOT the record's principal.
    const matched = persons[0] ?? {};
    const matchedId = matched.id as string | undefined;
    const rels = e.content?.gedcomx?.relationships ?? [];
    const parentIds = rels
      .filter((r) => r.type?.endsWith("ParentChild") && r.person2?.resourceId === matchedId)
      .map((r) => r.person1?.resourceId);
    const father = persons.find((p) => {
      if (!parentIds.includes(p.id as string)) return false;
      const d = (p.display ?? {}) as { role?: string };
      return p.gender === "Male" || /Father/i.test(d.role ?? "");
    });
    const fatherName = ((father?.display ?? {}) as { name?: string }).name ?? null;

    return {
      id: e.id ?? "?",
      name: display.name ?? "?",
      others,
      matchedName: ((matched.display ?? {}) as { name?: string }).name ?? "?",
      fatherOfMatched: fatherName,
    };
  });

  return { total: j.results ?? null, personas, error: null };
}

const fmt = (n: number | null): string =>
  n === null ? "  ERROR" : n.toLocaleString("en-US").padStart(11);

function tally(values: string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k, v]) => `${k}:${v}`)
    .join(" ");
}

// --- SECTION A — the require switch --------------------------------------

async function sectionA(): Promise<void> {
  console.log("\n=== A. The require switch (there is no per-field .required) ===");

  const bad = await search(
    `q.surname=Zsigmondy&q.surname.required=on&count=3&${REQUIRE_SWITCH}`
  );
  console.log(`  q.surname.required=on  -> ${bad.error ?? `results=${bad.total}`}`);

  const base = "q.surname=Zsigmondy&q.surname.exact=on&count=3";
  const extras: Array<[string, string]> = [
    ["baseline", ""],
    ["+ gibberish given name", "&q.givenName=Xqzzyrbl"],
    ["+ impossible birth range 1700-1710", "&q.birthLikeDate.from=1700&q.birthLikeDate.to=1710"],
    ["+ wrong birthplace (Alaska)", "&q.birthLikePlace=Alaska,%20United%20States"],
  ];
  console.log("  label                                 with switch   without");
  for (const [label, extra] of extras) {
    const on = await search(`${base}${extra}&${REQUIRE_SWITCH}`);
    const off = await search(`${base}${extra}`);
    console.log(`  ${label.padEnd(36)}${fmt(on.total)} ${fmt(off.total)}`);
  }
  console.log("  -> unchanged in the right-hand column = the term was ignored.");
}

// --- SECTION B — ranking displacement ------------------------------------

async function sectionB(): Promise<void> {
  console.log("\n=== B. Does .exact=on change the RANKING? (diff persona IDs) ===");
  for (const surname of ["Zsigmondy", "Mingazzini", "Geach"]) {
    const fuzzyTotal = (await search(`q.surname=${surname}&count=3&${REQUIRE_SWITCH}`)).total;
    const exactTotal = (
      await search(`q.surname=${surname}&q.surname.exact=on&count=3&${REQUIRE_SWITCH}`)
    ).total;
    console.log(
      `\n  ${surname}: fuzzy ${fmt(fuzzyTotal)} -> exact ${fmt(exactTotal)}` +
        (fuzzyTotal && exactTotal ? `  (${Math.round(fuzzyTotal / exactTotal)}x)` : "")
    );
    // The claim this section feeds — "displacement in the top 200" — has to be
    // measured over the actual top 200, not sampled. An earlier version paged
    // count=10 at offsets 0 and 200 (20 rows) and printed the literal
    // "IDENTICAL — 0 displacement", i.e. it asserted a 200-deep result from 20
    // rows. Page the whole window and compute the number.
    const page = async (exact: boolean): Promise<string[]> => {
      const ids: string[] = [];
      for (const offset of [0, 100]) {
        const q =
          `q.surname=${surname}${exact ? "&q.surname.exact=on" : ""}` +
          `&count=100&offset=${offset}&${REQUIRE_SWITCH}`;
        ids.push(...(await search(q)).personas.map((p) => p.id));
      }
      return ids;
    };
    const fuzzyIds = await page(false);
    const exactIds = await page(true);

    const exactSet = new Set(exactIds);
    // Records the fuzzy expansion injected into the top 200 that exact omits —
    // the only way `.exact=on` could surface something fuzzy buried is if these
    // pushed a real match out of the window.
    const fuzzyOnly = fuzzyIds.filter((id) => !exactSet.has(id));
    // How far the records present in BOTH lists moved.
    const exactRank = new Map(exactIds.map((id, i) => [id, i]));
    let maxShift = 0;
    fuzzyIds.forEach((id, i) => {
      const j = exactRank.get(id);
      if (j !== undefined) maxShift = Math.max(maxShift, Math.abs(i - j));
    });
    console.log(
      `    top ${fuzzyIds.length} compared: ${fuzzyOnly.length} fuzzy-only record(s), ` +
        `max shift ${maxShift} position(s) among the ${fuzzyIds.length - fuzzyOnly.length} in common`
    );
    if (fuzzyOnly.length) {
      const at = fuzzyIds.indexOf(fuzzyOnly[0] as string);
      console.log(`      first fuzzy-only record at rank ${at + 1}: ${fuzzyOnly[0]}`);
    }
  }
  console.log("\n  -> exact changes the count; the head of the list is unmoved.");
}

// --- SECTION C — place expansion -----------------------------------------

const NEAL =
  "q.surname=Neal&q.givenName=James&q.spouseGivenName=Martha" +
  "&q.marriageLikeDate.from=1874&q.marriageLikeDate.to=1876";
const NEVADA_AR = "Nevada,%20Arkansas,%20United%20States";
const YELL_AR = "Yell,%20Arkansas,%20United%20States";

async function sectionC(): Promise<void> {
  console.log("\n=== C. Place expansion (hold the query constant!) ===");
  const cases: Array<[string, string]> = [
    ["correct county, fuzzy place", `${NEAL}&q.marriageLikePlace=${NEVADA_AR}`],
    ["correct county, marriagePlaceExact", `${NEAL}&q.marriageLikePlace=${NEVADA_AR}&q.marriageLikePlace.exact=on`],
    ["WRONG county (Yell), fuzzy place", `${NEAL}&q.marriageLikePlace=${YELL_AR}`],
  ];
  for (const [label, q] of cases) {
    const r = await search(`${q}&count=3&${REQUIRE_SWITCH}`);
    const top = r.personas
      .slice(0, 2)
      .map((p) => `${p.name} x ${p.others[0]?.name ?? "-"}`)
      .join(" | ");
    console.log(`  ${label.padEnd(36)}${fmt(r.total)}  ${top}`);
  }
  console.log("  -> the target ranks first with AND without the qualifier.");
}

// --- SECTION D — where surnameExact destroys the answer -------------------

async function sectionD(): Promise<void> {
  console.log("\n=== D. surnameExact on a misspelled index (target is 'Neill') ===");
  const tail = `&q.marriageLikePlace=${NEVADA_AR}&q.marriageLikePlace.exact=on&count=3&${REQUIRE_SWITCH}`;
  const base = NEAL.replace("q.surname=Neal", "");
  const cases: Array<[string, string]> = [
    ["surname=Neal, fuzzy (what an agent sends)", `q.surname=Neal${base}${tail}`],
    ["surname=Neal + surnameExact", `q.surname=Neal&q.surname.exact=on${base}${tail}`],
    ["surname=Neill + surnameExact", `q.surname=Neill&q.surname.exact=on${base}${tail}`],
  ];
  for (const [label, q] of cases) {
    const r = await search(q);
    console.log(
      `  ${label.padEnd(42)}${fmt(r.total)}  ${r.personas.map((p) => p.name).join(" / ") || "(none)"}`
    );
  }
  console.log("  -> fuzzy is what bridges Neal->Neill; exact returns 0.");
}

// --- SECTION E — diminutives ---------------------------------------------

async function sectionE(): Promise<void> {
  console.log("\n=== E. How far fuzzy given-name matching reaches ===");
  const place = "&q.birthLikePlace=Gloucestershire,%20England&q.birthLikeDate.from=1810&q.birthLikeDate.to=1814";
  for (const given of ["Elizabeth", "Betty"]) {
    const r = await search(`q.surname=Martin&q.givenName=${given}${place}&count=6&${REQUIRE_SWITCH}`);
    console.log(`\n  givenName=${given.padEnd(10)} ${fmt(r.total)}`);
    r.personas.slice(0, 3).forEach((p, i) => {
      const with_ = p.others
        .slice(0, 2)
        .map((o) => `${o.name} (${o.role})`)
        .join(" & ");
      console.log(`    ${i + 1}. ${p.name}  [with: ${with_ || "-"}]`);
    });
  }
  const sample = await search(`q.surname=Martin&q.givenName=Elizabeth${place}&count=100&${REQUIRE_SWITCH}`);
  const firsts = sample.personas.map((p) => p.name.trim().split(/\s+/)[0] ?? "?");
  console.log(`\n  fuzzy 'Elizabeth' top-100 given names: ${tally(firsts)}`);
  console.log("  -> coverage is partial (cf. Wm->William in F), so a diminutive it");
  console.log("     misses must be searched as its own givenName value.");
}

// --- SECTION F — relative names keep the silent records ------------------

async function sectionF(): Promise<void> {
  console.log("\n=== F. A relative name keeps records where the relative is ABSENT ===");
  const base =
    "q.surname=Martin&q.givenName=John&q.recordCountry=United%20States" +
    "&q.birthLikeDate.from=1840&q.birthLikeDate.to=1860";
  const variants: Array<[string, string]> = [
    ["baseline (no father term)", ""],
    ["common name (William)", "&q.fatherGivenName=William"],
    ["...William plus .exact=on", "&q.fatherGivenName=William&q.fatherGivenName.exact=on"],
    // `Zachariah` is the load-bearing variant: a REAL but rare father name.
    // Gibberish alone cannot distinguish "contradicting records are dropped"
    // from "an unmatchable term is ignored", and the two predict opposite
    // things about a normal search. Keep both rows — if they agree, the term
    // is not filtering; if they diverge, gibberish is being special-cased.
    ["real but rare (Zachariah)", "&q.fatherGivenName=Zachariah"],
    ["...Zachariah plus .exact=on", "&q.fatherGivenName=Zachariah&q.fatherGivenName.exact=on"],
    ["gibberish father name", "&q.fatherGivenName=Xqzzyrbl"],
  ];
  // Measured per variant: of the records sampled, how many name a father FOR
  // THE MATCHED PERSONA versus how many are silent about him — see
  // `Persona.fatherOfMatched` for the three ways of computing this that give
  // the wrong answer. Every conclusion below is computed, never a literal.
  const measured = new Map<string, { total: number | null; sampled: number; names: string[] }>();
  for (const [label, extra] of variants) {
    const names: string[] = [];
    let total: number | null = null;
    let sampled = 0;
    for (const offset of [0, 100, 200]) {
      const r = await search(`${base}${extra}&count=100&offset=${offset}&${REQUIRE_SWITCH}`);
      if (total === null) total = r.total;
      sampled += r.personas.length;
      for (const p of r.personas) {
        if (p.fatherOfMatched) names.push(p.fatherOfMatched.trim().split(/\s+/)[0] ?? "?");
      }
    }
    measured.set(label, { total, sampled, names });
    console.log(
      `  ${label.padEnd(28)} total=${fmt(total)}  sampled=${String(sampled).padStart(3)}` +
        `  names-a-father=${String(names.length).padStart(3)}` +
        `  father-silent=${String(sampled - names.length).padStart(3)}  ${tally(names)}`
    );
  }

  // --- Verdict, derived from the rows above --------------------------------
  const baseline = measured.get("baseline (no father term)");
  const anchored = measured.get("common name (William)");
  const exact = measured.get("...William plus .exact=on");
  const rare = measured.get("real but rare (Zachariah)");
  const rareExact = measured.get("...Zachariah plus .exact=on");
  const gibberish = measured.get("gibberish father name");

  /**
   * Accepted indexed forms per search term — the forms that are the SAME name,
   * so anything else is a genuinely conflicting father.
   *
   * Explicit lists, not a prefix rule. A "shares the first three letters"
   * heuristic scores `Willis` and `Wilson` as `William`, and `Zachary` as
   * `Zachariah` — inflating the variant count, deflating the conflict count and
   * printing `drop-contradicting CONFIRMED` for the wrong reason. Since this
   * section uses two fixed terms, enumerate them; a list can be audited and a
   * heuristic cannot. Abbreviations (`Wm`, `Wm.`) must be included — that is the
   * commonest indexed form of `William`, and counting it as a conflict inverts
   * the result just as badly in the other direction.
   */
  const ACCEPTED_FORMS: Record<string, RegExp> = {
    William: /^(william|willia|willm|will|will?y|bill|wm)$/i,
    Zachariah: /^(zachariah|zacharia|zachari|zacharias|zacharius|zachary|zachariah?s|zacaria|zacharie|zachie|zach|zac|zack)$/i,
  };
  const looksLikeTerm = (term: string, name: string): boolean => {
    const n = name.replace(/\.$/, "").trim();
    const re = ACCEPTED_FORMS[term];
    if (!re) throw new Error(`sectionF: no ACCEPTED_FORMS entry for "${term}"`);
    return re.test(n);
  };
  const conflicts = (row: typeof baseline, term: string): string[] =>
    (row?.names ?? []).filter((n) => !looksLikeTerm(term, n));

  const silent = anchored ? anchored.sampled - anchored.names.length : 0;
  const keepSilent = silent > 0;

  // The decisive row is the REAL but RARE term: few records can match it, so
  // if the term merely boosted rank the sample would fill with other people's
  // fathers. Judge on the count of sampled records naming a CONFLICTING
  // father, which needs no assumption about how many records match.
  const rareConflicts = conflicts(rare, "Zachariah");
  const commonConflicts = conflicts(anchored, "William");
  const conflictRate = rare && rare.sampled > 0 ? rareConflicts.length / rare.sampled : NaN;
  const dropContradicting = Number.isFinite(conflictRate) && conflictRate < 0.02;

  const abbrevLost =
    anchored !== undefined &&
    exact !== undefined &&
    anchored.names.some((n) => /^Wm\.?$/.test(n)) &&
    !exact.names.some((n) => /^Wm\.?$/.test(n));

  console.log("");
  console.log(
    `  keep-silent          ${keepSilent ? "CONFIRMED" : "NOT CONFIRMED"} — ` +
      `${silent} of ${anchored?.sampled ?? 0} father-anchored hits name no father at all`
  );
  console.log(
    `  drop-contradicting   ${dropContradicting ? "CONFIRMED" : "NOT CONFIRMED"} — ` +
      `the rare term left ${rareConflicts.length}/${rare?.sampled ?? "?"} sampled records naming a ` +
      `conflicting father${rareConflicts.length ? ` (${tally(rareConflicts)})` : ""}; ` +
      `every other father named was a variant of it (${tally(rare?.names ?? [])})`
  );
  console.log(
    `                       common-name control: ${commonConflicts.length}/${anchored?.sampled ?? "?"} ` +
      `conflicting${commonConflicts.length ? ` (${tally(commonConflicts)})` : ""}`
  );
  console.log(
    `  unmatchable = silent ${
      gibberish && gibberish.names.length / Math.max(gibberish.sampled, 1) < 0.02
        ? "CONFIRMED"
        : "NOT CONFIRMED"
    } — a gibberish father name left ${gibberish?.names.length ?? "?"}/${gibberish?.sampled ?? "?"} ` +
      `records naming any father: it keeps the father-silent population, it does not filter to nothing`
  );
  console.log(
    `  .exact makes it hard ${
      rareExact?.total != null && rare?.total != null && rareExact.total < rare.total / 100
        ? "CONFIRMED"
        : "NOT CONFIRMED"
    } — .exact=on took the rare term from ${fmt(rare?.total ?? null).trim()} to ${fmt(rareExact?.total ?? null).trim()}`
  );
  console.log(
    `  .exact drops abbrevs ${abbrevLost ? "CONFIRMED" : "NOT CONFIRMED"} — ` +
      `Wm/Wm. present unqualified, absent under .exact=on`
  );
  if (!dropContradicting) {
    console.log(
      "\n  drop-contradicting NOT CONFIRMED contradicts the spec's relative-name\n" +
        "  paragraph. Before believing it, check the parse: this section has produced a\n" +
        "  false refutation three times, always by identifying the wrong person as the\n" +
        "  father (see `Persona.fatherOfMatched`). A conflicting-father tally dominated by\n" +
        "  the SEARCHED given name is the signature of that bug, not a finding."
    );
  }
}

// --- SECTION G — recordCountry is already strict -------------------------

async function sectionG(): Promise<void> {
  console.log("\n=== G. recordCountry / recordSubcountry are already strict ===");
  for (const country of ["United%20States", "Narnia"]) {
    const r = await search(`q.surname=Martin&q.recordCountry=${country}&count=3&${REQUIRE_SWITCH}`);
    console.log(`  recordCountry=${decodeURIComponent(country).padEnd(16)}${fmt(r.total)}`);
  }
  console.log("  -> no .exact flag exists for these, and none is needed.");
}

const SECTIONS: Record<string, () => Promise<void>> = {
  A: sectionA,
  B: sectionB,
  C: sectionC,
  D: sectionD,
  E: sectionE,
  F: sectionF,
  G: sectionG,
};

async function main(): Promise<void> {
  token = await getValidToken();
  const requested = process.argv.slice(2).map((a) => a.toUpperCase());
  const names = requested.length
    ? requested.filter((n) => n in SECTIONS)
    : Object.keys(SECTIONS);
  if (!names.length) {
    console.error(`No such section. Available: ${Object.keys(SECTIONS).join(" ")}`);
    process.exit(1);
  }
  for (const name of names) {
    const fn = SECTIONS[name];
    if (fn) await fn();
  }
  console.log("");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

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
 *   SECTION E — How far fuzzy given-name matching reaches: a tally that cannot
 *     answer the question, then a membership test that can.
 *   SECTION F — Relative names keep records where the relative is absent.
 *   SECTION G — `recordCountry` is already strict.
 *   SECTION H — the `<event>Year` family: whether an unqualified range fuzzes
 *     around its bounds and whether `.exact=on` hardens it. Measured on the
 *     BIRTH family only — see the section's own note before writing "the
 *     `<event>Year` family was measured". Its third question — what happens to
 *     records carrying NO indexed year — is answered only for `.exact=on`
 *     (it drops them); the unqualified case is OPEN and the section says so.
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
 *   B. `.exact=on` REMOVES records and REORDERS the ones it keeps.
 *      Re-done 2026-08-10/11 over COMPLETE sets on enumerable pools, scored by
 *      DISPLACEMENT (each shared record's position among the shared set in fuzzy
 *      order vs its position in the exact list; both run 1..N, so removal cannot
 *      itself move anything). Two earlier metrics were wrong in opposite
 *      directions: a score comparison built from both result sets, then a count
 *      of ADJACENT DESCENTS, which scores a 34-position move as a single blip.
 *        Brazil/Bochenek      fuzzy 521 -> exact  81   exact-only 0   displaced  0
 *        England/Pocklington  fuzzy 469 -> exact 423   exact-only 0   displaced 54
 *      exact-only = 0 in both: every record the exact search returns is already
 *      in the fuzzy set, so `.exact` is a strict SUBSET and CANNOT surface a
 *      record a fuzzy search buried. Measured on `surname` in marriage
 *      populations only.
 *      It DOES reorder what it keeps: 54 records move, the largest by 34
 *      positions, against a same-query noise floor of 0, and 6 of them cross
 *      rows carrying a different relevance score. Do NOT write "no reordering"
 *      or "no effect on ranking was detectable".
 *      Count inflation is kept separately as a TOTALS argument (RULE 0 permits
 *      totals without enumeration): Zsigmondy 172x, Mingazzini 23x, Geach 799x.
 *
 *   C. Neal/James x Martha, Nevada County AR, marr. 1874-76. All three rows come
 *      from the ONE base query sectionC() sends, so they are directly comparable:
 *        right county, fuzzy place        35,509  target ranked 1
 *        right county, marriagePlaceExact      2  target ranked 1
 *        WRONG county (Yell), fuzzy       35,472  target absent
 *      Right 35,509 vs wrong 35,472 is 0.1% apart — an unqualified county scope
 *      barely discriminates, so its total is not an exhaustiveness signal. The
 *      qualifier fixes the count and moves nothing the agent reads.
 *      Do NOT reintroduce the `39,793 vs 39,750` pair that stood here: those
 *      figures came from the issue-thread probe under a different query shape and
 *      this section cannot produce them, so quoting them beside 35,509 implied a
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
 *      FUZZY DOES REACH DIMINUTIVES — membership test, 8/8 over three name
 *      families (Elizabeth<-Betty, Margaret<-Peggy, Mary<-Polly): take a record
 *      whose given name IS the diminutive, then check whether the fuzzy search
 *      for the formal name returns that same record id. It does, every time.
 *      THE CONSTRAINT IS RANK, NOT COVERAGE — measured in the same section:
 *        pool   1,019  Betty Purnell   rank 347, 353   findable
 *        pool  55,514  Peggy Smith     >500
 *        pool  90,037  Polly Smith     >500
 *        pool 219,494  Betty Martin    >500
 *      Same matching behaviour throughout; only the number of closer-scoring
 *      competitors changes. Until 2026-08-08 this block said the opposite —
 *      "no Betty ... so a diminutive fuzzy does not cover must be searched as
 *      its own givenName value" — on a top-100 tally (Elizabeth:72 Eliza:14
 *      Betsy:10) of a 219,494-record pool. The Betty records were in it, past
 *      rank 500. A top-N tally cannot tell ABSENT from OUTRANKED. The remedy
 *      survives with a different reason: narrow the query until the pool is
 *      scannable, or search the diminutive as its own `givenName` value.
 *
 *   F. 300-result father-name survey (re-measured 2026-08-08 AFTER the
 *      `p.gender` fix below; the pre-fix figures were 104/287/300/0 and were
 *      artifacts of father detection falling back to the role regex):
 *        baseline (no father term)     262 father-bearing  John:54 William:22
 *        q.fatherGivenName=William     283 father-bearing  William:192 Wm:52 Wm.:31
 *        ...plus .exact=on             295 father-bearing  William:294 (no Wm/Wm.)
 *        real but rare (Zachariah)       7 father-bearing  incl. Zachariah:2
 *        ...plus .exact=on               2 father-bearing  Zachariah:2 (both)
 *        gibberish father name           1 father-bearing
 *      An unqualified relative name keeps matches, keeps records where that
 *      relative was never indexed, and drops contradicting ones. `.exact`
 *      breaks it twice: it drops the silent records AND the indexed Wm/Wm.
 *
 *      HOW MANY records name a father at all is NOT answerable from those
 *      sampled columns — the rate swings 80/92/90/14/0/80/80 percent across
 *      offsets 0..5000. Derive it from totals: the gibberish term drops only
 *      contradicting records, so baseline-minus-gibberish IS the father-bearing
 *      count. Measured across six populations in the same section:
 *        Martin/John US b.1840-60      3.2%      Martin, residence 1880  16.8%
 *        Martin, Gloucs b.1810-14      4.4%      Smith, England          18.5%
 *        Martin, marriage 1850-60     16.0%      Gallo, Italy            33.5%
 *      A minority everywhere measured, but the share varies by an order of
 *      magnitude. Do NOT quote one population's figure as a general fact — an
 *      earlier draft of this block quoted 3.2% that way.
 *
 *      RELATIVE `*Exact` REQUIRES THE RELATIVE TO BE PRESENT — measured
 *      2026-08-08 by membership, not inferred: the 390-record
 *      `fatherGivenName=William&.exact=on` set was read in full; a
 *      father-silent record from the unqualified row is ABSENT from it and a
 *      William-fathered control is present. The 295/300 father-bearing figure
 *      in the sampled row is a detector artifact — all five exceptions were
 *      inspected and all five have a male ParentChild parent whose
 *      `display.name` is absent, which is the field `fatherOfMatched` reads.
 *
 *   G. `q.recordCountry=Narnia` → 0. Already strict; no flag, none needed.
 *
 *   H. `<event>Year`, birth family, measured 2026-08-08:
 *        range fuzzes         3/300 sampled records fell outside an unqualified
 *                             1850-1850 range, every one carrying an APPROXIMATE
 *                             date ("about 1848"). That count is a LOWER BOUND
 *                             (see `explained` in the row type) and it is a
 *                             SAMPLE — do not read it as "the fuzz is small".
 *        .exact hardens it    0/300 outside; total 357,893 -> 3,056.
 *        .exact drops         a 1700-1950 range, which every indexed year
 *        year-silent records  satisfies, retains 99.1% unqualified but only
 *                             24.2% with `.exact=on` (11,387,277 baseline).
 *                             Records with an in-range year cannot be what it
 *                             removed, so it removes the year-SILENT ones.
 *        NOTE 2026-08-10       Section N re-does the .exact/year-silent leg on
 *                             an ENUMERABLE pool: 156 rows unqualified, all
 *                             year-silent, and 0 rows with `.exact=on`. So
 *                             `.exact` dropping year-silent records is settled
 *                             by enumeration; the sampled rows below are not
 *                             what that conclusion rests on any more.
 *        UNQUALIFIED case     OPEN. A model where an unqualified range simply
 *                             keeps year-silent records cannot produce both the
 *                             99.1% wide-range retention AND the 45% a narrow
 *                             range retains on a population sampled ~76%
 *                             year-less. Do not quote either direction until
 *                             this reconciles. An earlier draft of this block
 *                             asserted "silence tolerated" and was wrong.
 *
 * METHOD TRAPS (each one cost a wrong answer at least once):
 *
 *   ===================================================================
 *   RULE 0 — CHOOSE A POPULATION YOU CAN READ TO THE END.
 *
 *   Never compute a proportion, a rate, or an absence from a pool that
 *   was not enumerated. Not "sampled deeply". Not "300 of 455,000".
 *   Read to a short page, or report NOT MEASURED.
 *
 *   This is RULE 0 because it is the single largest source of wrong
 *   answers in this file's history, it has re-offended after being
 *   written down as a trap below, and every one of its failures LOOKS
 *   like a finding. A sampled proportion is always plausible; it is
 *   just not about the population you think.
 *
 *   The fix is upstream of the analysis: pick a RARE surname so the
 *   pool is in the hundreds. `Bochenek` + Brazil + marriage is 521
 *   records and answers the same questions `Martin` + US does at
 *   1,500,000 — except that the answers are checkable. If a question
 *   genuinely needs a big population, it needs a TOTALS argument, not
 *   a sample (see sections G, X, and the partition test in H).
 *
 *   What it cost on 2026-08-10 alone, all four from sampling pools too
 *   big to enumerate:
 *     * "fatherGivenName RANKS ONLY, does not filter on content" —
 *       inferred because a real name and gibberish returned nearly the
 *       same TOTAL. Enumerating a 521-record pool showed the term
 *       filters perfectly: all 147 father-bearing records dropped, 0
 *       contradictions retained. The totals matched because the SILENT
 *       population dominates what is kept, not because nothing filtered.
 *     * "retention tracks how often the relative is indexed: REFUTED" —
 *       from a 100-row sample of a 1,900,000-record pool that showed
 *       father and spouse both 100% indexed. Full enumeration: father
 *       28%, spouse 90%, and retention tracks them exactly. The
 *       explanation being "refuted" was correct.
 *     * "the wildcard does not expand" in section V's control — from a
 *       top-100 of a 68,000,000-record pool where every row is the
 *       literal spelling.
 *     * "variant expansion NOT killed" in section W's first draft —
 *       from a top-100 of a 2,600,000-record pool.
 *
 *   Enforced, not just documented: `mustEnumerate()` below refuses to
 *   return a proportion from an incomplete scan. Use it instead of a
 *   hand-rolled `for (const offset of [0, 100, 200])` loop.
 *
 *   NOT YET COMPLIANT — every figure from these is a sampled proportion
 *   of a pool far too large to enumerate, and none of them should be
 *   quoted until the section is moved onto a rare-surname population:
 *
 *     E  diminutive ranks; only the 1,019-record pool is enumerable,
 *        the 55,514 / 90,037 / 219,495 ones are scanned 500 deep.
 *     F  300 rows of ~455,000. Its 300-row PROPORTIONS are unverified; its
 *        totals-derived figures (the 96.8% retention, the 3.2-33.5%
 *        father-bearing spread) are fine. Section R now answers the same
 *        questions by enumeration and supersedes F's proportions.
 *     H  300 rows of 1,340,719 and 11,385,000 in three places, plus the
 *        offset sweep. The year verdicts rest on these.
 *     I  100 rows of ~1,025,000 for the initials shape/order counts.
 *     S  100 rows per population for the indexed share — the figure
 *        that produced the wrong "REFUTED" verdict.
 *     T  top-20 match rate on multi-million-record pools. Its verdicts are
 *        already WITHHELD in the artifact and defer to R.
 *
 *   COMPLIANT, and the reason their findings held up: B (complete
 *   set diffs on 469/521-row pools), R (pools of
 *   469-521, every scan routed through `mustEnumerate`), D (pools of 2),
 *   V's Ellis membership (218 / 669), W (~1,100, scanned to the end),
 *   and the totals-only sections A, G, X.
 *
 *   R is the worked example of what compliance buys. Enumerating it
 *   settled three things sampling had got wrong: keep-silent HOLDS,
 *   drop-contradicting HOLDS with ZERO conflicts across ~1,180 records,
 *   and retention equals the silent share to within a point in every
 *   population. Getting there also cost three scoring bugs, all failing
 *   toward "the model is broken" — diacritics (`José` != `Jose`),
 *   initials (`Thiago J` IS a hit for `Jose`), and comparing a queried
 *   GIVEN name against `display.name`, which for a person indexed with
 *   no given name is the surname. Score against `names[].given`.
 *   ===================================================================
 *
 *   - SCORING a name match is its own trap, and it fails toward "the model is
 *     broken" every time. `José` does not `.includes("Jose")` — fold diacritics.
 *     `Thiago J Bochnia` IS a hit for `Jose` — the index holds initials and the
 *     search matches them. Both bugs turned matches into "conflicts" and nearly
 *     produced a writeup claiming the documented keep/drop model was refuted.
 *   - The total-hit field is top-level `results`, not `totalMatches`.
 *   - You MUST send `m.queryRequireDefault=on`, because the tool always does.
 *     Omit it and you measure a query shape production never issues.
 *   - A count of 2147483647 is an Int32 saturation sentinel, not a measurement.
 *   - Hold the query CONSTANT across a comparison. Comparing a no-spouse fuzzy
 *     search against a with-spouse exact one produced a false "the target is
 *     buried" reading during this investigation.
 *   - A count comparison says nothing about ranking. Diff the persona IDs.
 *   - A top-N sample cannot distinguish ABSENT from OUTRANKED. If the question
 *     is "does the engine reach X", membership-test it: find a record that IS
 *     X, then check whether the query returns that id. Six wrong conclusions in
 *     this file's history came from reading a sampled window as a population.
 *   - Do not infer a population rate from a ranked head. Measured father-bearing
 *     rate by offset: 80/92/90/14/0/80/80 percent. Derive rates from totals.
 *   - `person.gender` is an OBJECT (`{ type: ".../Male" }`); the string form is
 *     `display.gender`. Comparing `person.gender` to "Male" silently never fires.
 *   - The API rejects a date range of 500 years or longer outright:
 *     `Query date range for key (birthLikeDate) cannot be 500 years or longer!`
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

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getValidToken } from "../src/auth/refresh.js";
import { BROWSER_USER_AGENT } from "../src/constants.js";
import {
  yearOf,
  yearOfDate,
  datedFromGedcomx,
  givenOf,
} from "./payload-extract.js";

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
  /**
   * The matched persona's `Couple` partner — the spouse equivalent of
   * `fatherOfMatched`, and subject to the same caveat: `null` covers both "no
   * spouse indexed" and "spouse indexed but carrying no readable display name",
   * which is why `spousesIndexed` exists alongside it.
   *
   * A Couple relationship is undirected in practice, so the matched persona may
   * be either `person1` or `person2`; the partner is whichever side is not it.
   * Reading only `person2` would silently halve the count.
   */
  spouseOfMatched: string | null;
  /**
   * The relative's GIVEN name only, from `names[].given` — not `display.name`.
   *
   * `q.<relative>GivenName` filters on the given name, so that is what a match
   * has to be scored against. `display.name` is the full name, and for a person
   * indexed with a surname and no given name it is the SURNAME — which a naive
   * comparison then reads as a given name that conflicts with the query. That
   * produced the one apparent counterexample to drop-contradicting in section R
   * (record X9YM-YXZG: spouse "Sebrian", surname only, no given name indexed —
   * silent about the queried field, not contradicting it).
   *
   * `null` means no given name is indexed for that relative, which is silence.
   */
  fatherGivenOfMatched: string | null;
  spouseGivenOfMatched: string | null;
  /**
   * The same given-name extraction for the three families the artifact left
   * unmeasured, so section R can answer them instead of six `*Exact`
   * descriptions saying "Assumed, as `motherGivenNameExact`".
   *
   * `mother` shares `father`'s candidate set (the matched persona's parents)
   * with the gender test inverted. `parent` is SEX-AGNOSTIC on purpose — it
   * mirrors `q.parentGivenName`, which a caller reaches for precisely when the
   * sex is unknown, so gating it on sex would report a mother-only record as
   * parent-silent. `other` has no relationship role at all: its population is
   * the co-named persons, which makes it the ONE family where `others[0]` is
   * the right answer rather than one of the three wrong ones listed above.
   */
  motherGivenOfMatched: string | null;
  parentGivenOfMatched: string | null;
  /**
   * EVERY parent's given name, because `q.parentGivenName` matches ANY of them.
   * `parentGivenOfMatched` is the first parent in graph order, so a record whose
   * SECOND parent carries the queried name was scored a conflict rather than a
   * match — inflating the bucket `verdict:drop-contradicting` sums.
   *
   * `parent` gets this and `other` does not, and the difference is boundedness:
   * `parent` is father plus mother, resolved through `ParentChild` edges, every
   * member a genuine kinship relation. `other` is an unbounded co-person list with
   * no role at all — godparents, witnesses, bystanders — whose 62 conflicts were
   * never explained, which is why it is excluded rather than accommodated.
   */
  parentGivensOfMatched: string[];

  /**
   * How many `Couple` partners the matched persona has, whatever their names.
   * The spouse counterpart of `parentsIndexed`, and for the same reason: it is
   * the only column that can stand behind a "the record is silent about this
   * relative" claim, because the name column conflates silence with a missing
   * display name.
   */
  spousesIndexed: number;
  /**
   * Parents of the matched persona that could BE the mother — everyone except a
   * provably-male one. `parentsIndexed` cannot serve here: it counts either sex,
   * so a father-only record reports a parent indexed with no readable mother
   * name and lands in "indexed-but-nameless" when it is in fact mother-SILENT.
   * Measured cost on 2026-08-20: 30 misfiled rows in England/Pocklington counted
   * a mother-SILENT record as indexed-but-nameless, putting the silent share at
   * 92.8% against a 99.1% retention. That 6.3-point gap is inside
   * `verdict:retention equals the silent share`'s ±10 tolerance, so it would not by
   * itself have flipped that verdict — but the misfiling is real, and the fix
   * brings the silent share to 99.1%, matching retention exactly.
   *
   * Sex-unprovable parents count IN, deliberately: this column exists to stand
   * behind a "the record is silent" claim, so it must not claim silence about a
   * parent whose sex the payload never states.
   *
   */
  mothersIndexed: number;
  /**
   * The mirror image, for `father`: parents that could BE the father — everyone
   * except a provably-female one.
   *
   * Section R needs COMPLETENESS here, not just sufficiency, because it divides
   * silence by the baseline and compares that share against retention. Section F
   * deliberately keeps `parentsIndexed === 0` instead, and is right to: it needs a
   * SUFFICIENT condition to pick representatives that certainly have no father,
   * and zero indexed parents is exactly that.
   */
  fathersIndexed: number;
  /**
   * `display.birthDate` of the matched persona, as free text the way the index
   * holds it ("12 March 1850", "1850", occasionally a range). SECTION H parses
   * a year out of it to test whether a year range fuzzes around its bounds.
   * `null` when the record carries no indexed birth date at all — which is
   * itself one of section H's measurements, not a parse failure.
   */
  matchedBirthDate: string | null;
  /**
   * Every BIRTH-LIKE fact on the matched persona — Birth, Christening, Baptism
   * — as `{ original, year, approximate }`.
   *
   * Section H needs this and not `matchedBirthDate`, and the difference is not
   * cosmetic: `q.birthLikeDate` matches the whole family, so a person born 1842
   * and christened 1850 is a legitimate hit on a 1850-1850 range while her
   * `display.birthDate` reads "9 January 1842". Scoring off the display field
   * counted her as out-of-range and inflated the fuzz measurement by 40% (5
   * apparent, 3 real) before this was caught — the same wrong-field mistake
   * section F's header warns about, one family over.
   */
  birthLike: Array<{ original: string; year: number | null; approximate: boolean }>;
  /**
   * Birth-like years carried by EVERY person on the record, matched persona
   * included — a census household, a marriage entry with both sets of parents.
   *
   * Section H needs this to separate two things its earlier drafts conflated:
   * a persona with no indexed birth year, and a RECORD with none. `q.birthLikeDate`
   * is a record-level filter, so a household whose matched persona is year-less
   * can still match a range on a sibling's or parent's year. Reading only
   * `birthLike` made those records look like proof that a range tolerates
   * silence, which is the reading that left this section's last verdict OPEN.
   */
  recordBirthYears: number[];
  /**
   * The engine's relevance score for this row.
   *
   * Needed to tell a real reordering from tie instability: if two rows carry the
   * SAME score, their relative order is not a ranking decision and swapping them
   * between two result sets says nothing about the qualifier.
   */
  score: number | null;
  /**
   * Every dated fact on EVERY person of the record, with the fact type kept
   * verbatim, plus every `*Date` key off each person's `display` block.
   *
   * Generic on purpose. `birthLike`/`recordBirthYears` above answer the same
   * question for one event family, and section Y needs it for four
   * (`birth`, `death`, `marriage`, `residence`). A `deathLike` field beside
   * `birthLike`, then a `marriageLike`, is the parallel-copy CLAUDE.md's
   * "Code reuse" section says to lift instead — so the family is a REGEX
   * APPLIED HERE rather than a field per family. `birthLike` is left alone:
   * six sections read it, and re-deriving those from this would be a
   * refactor with no measurement behind it.
   *
   * `personIdx === 0` is the matched persona (`persons[0]`), which is what
   * makes persona-silence and record-silence separable — the distinction
   * that kept section H's verdict at OPEN until it was drawn.
   */
  allDated: Array<{
    personIdx: number;
    /** Fact type URI tail, or the `display` key for a display-only date. */
    kind: string;
    original: string;
    year: number | null;
  }>;
  /**
   * How many ParentChild parents this persona has, whatever their gender labels
   * or names. NOT "does it have a father" — deliberately weaker, because that
   * question cannot be answered reliably from this payload.
   *
   * `fatherOfMatched` is null for THREE different reasons: no parent at all, a
   * parent whose `display.name` is missing (measured 2026-08-08: all five
   * apparently father-silent records in the `.exact` row were this case), or a
   * parent whose gender is unlabelled so the male detector never fires. Only
   * the first is genuine father-absence. Section F's presence verdict needs a
   * representative that genuinely has no father, so it requires
   * `parentsIndexed === 0` — a record with zero parents cannot have a father,
   * while a record with an unlabelled parent might. An earlier version tested
   * `father !== undefined`, i.e. "the male detector fired", which folded the
   * third case into "no father" and could flip the verdict to NOT CONFIRMED and
   * tell a reader to strip a correct claim from ten shipped tool descriptions.
   */
  parentsIndexed: number;
}

interface Hit {
  total: number | null;
  personas: Persona[];
  error: string | null;
}

// Politeness throttle. A full run is several hundred requests against a live
// FamilySearch endpoint; firing them back-to-back is rude and invites rate
// limiting. Every call in this file goes through search(), so gating here
// covers all sections.
const THROTTLE_MS = 250;
let lastCall = 0;
async function throttle(): Promise<void> {
  const wait = THROTTLE_MS - (Date.now() - lastCall);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
}

/**
 * The ONE class of response worth retrying, and why the list is this short.
 *
 * A 400 must NEVER be retried: two of this file's documented results ARE 400s
 * (section A's `q.surname.required=on`, and the METHOD TRAP's 500-year range),
 * so retrying one would burn requests to re-obtain a finding we already have.
 * A 401 is not transient either — the token is expired and every subsequent
 * call will fail the same way, so failing fast is the correct signal.
 *
 * That leaves rate limiting and transient gateway faults. These are exactly the
 * responses that used to be indistinguishable from "the pool ended here" (see
 * the note on `errored()` below), which is how a network blip could make a
 * section print the INVERSE of its finding rather than NOT MEASURED. Retrying
 * them converts a silent wrong answer into a slower right one.
 */
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_RETRIES = 5;
/** Retries actually spent, reported at the end of the run so a slow run is auditable. */
const retryTally = { attempts: 0, byStatus: new Map<number, number>() };

/**
 * Exponential backoff, honouring `Retry-After` when the server sends one.
 *
 * `Retry-After` may be either a delay in seconds or an HTTP date; only the
 * numeric form is honoured here, because the date form needs clock-skew
 * handling that a dev script has no business guessing at. Capped so one
 * pathological header cannot stall a run for an hour.
 */
const BACKOFF_CAP_MS = 30_000;
async function backoff(res: Response, attempt: number, query: string): Promise<void> {
  const header = res.headers.get("retry-after");
  const advised = header !== null && /^\d+$/.test(header.trim())
    ? Number(header.trim()) * 1000
    : null;
  const delay = Math.min(advised ?? 1000 * 2 ** attempt, BACKOFF_CAP_MS);
  retryTally.attempts++;
  retryTally.byStatus.set(res.status, (retryTally.byStatus.get(res.status) ?? 0) + 1);
  console.error(
    `    [retry ${attempt + 1}/${MAX_RETRIES}] HTTP ${res.status}` +
      `${advised === null ? "" : ` (Retry-After: ${header})`}` +
      ` — waiting ${delay}ms — ${query.slice(0, 80)}`
  );
  await new Promise((r) => setTimeout(r, delay));
}

/** Print the retry tally, or say plainly that there was none. */
function reportRetries(): void {
  if (retryTally.attempts === 0) {
    console.log("\n  (no retries were needed)");
    return;
  }
  const detail = [...retryTally.byStatus.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([status, n]) => `${status}x${n}`)
    .join(" ");
  console.log(`\n  retries spent: ${retryTally.attempts} (${detail})`);
}

/**
 * One attempt. Returns RETRY when the status is transient and the caller should
 * back off; `search()` is the only thing that should call this.
 */
const RETRY = Symbol("retry");
async function searchOnce(query: string, attempt: number): Promise<Hit | typeof RETRY> {
  await throttle();
  const res = await fetch(`${SEARCH_URL}?${query}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Accept-Language": "en",
      "User-Agent": BROWSER_USER_AGENT,
    },
  });
  // Status is checked here but LAST, after the body — see the long note below on
  // why the API's own message has to win. `errored()` and every pager guard test
  // `error !== null`, and until this check existed `error` was only set for an
  // unparseable body or an `errors` array — so a 401 on an expired token, or a
  // 429/502 carrying a JSON envelope, came back as `{ personas: [], error: null }`
  // and read as "the pool ended here". That is how a network fault could make
  // section E print `fuzzy reaches diminutives NOT CONFIRMED`, which is the
  // inverse of the result, not the absence of one.
  const body = await res.text();
  // BEFORE the body is interpreted, and deliberately. A 429 or a 502 often
  // carries HTML or an `errors` envelope, either of which the logic below would
  // turn into a terminal `error` string — the exact "reported ABSENCE" failure
  // the note on `errored()` describes. Checking status first is what makes the
  // retry reachable at all. A 400 is not in RETRYABLE_STATUS, so section A's
  // documented 400s still fall straight through to the body handling below.
  if (RETRYABLE_STATUS.has(res.status) && attempt < MAX_RETRIES) {
    await backoff(res, attempt, query);
    return RETRY;
  }
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
      score?: number;
      content?: {
        gedcomx?: {
          persons?: Array<Record<string, unknown>>;
          relationships?: Array<{ type?: string; person1?: RelRef; person2?: RelRef }>;
        };
      };
    }>;
  };
  // `errors: []` is TRUTHY. Testing the array itself turned a successful call
  // into `{total: null, error: ""}`, and section A's `err ?? results=` cannot
  // fall through an empty string — so a good call printed a blank verdict.
  // Order matters. The API's own message comes FIRST, because a 400 is how two
  // of this file's documented results are obtained: section A's
  // `q.surname.required=on` -> "Unable to map supplied value=required to term
  // modifier", and the METHOD TRAP "Query date range ... cannot be 500 years or
  // longer!". An earlier version of the status check returned before the body was
  // parsed, which replaced both with "HTTP 400 Bad Request" and stopped section A
  // reproducing its own header. Only fall back to the status line when the body
  // carries no message.
  if (j.errors?.length) return { total: null, personas: [], error: j.errors.join("; ") };
  if (!res.ok) {
    return { total: null, personas: [], error: `HTTP ${res.status} ${res.statusText}`.trim() };
  }

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
    // `matchedId === undefined` must match NOTHING. Without the guard it equals
    // every `person2?.resourceId` that is also undefined, and `parentIds` then
    // collects undefined entries which `includes()` matches against every id-less
    // person — inflating `parentsIndexed`, the sole basis for section F's
    // no-parent-at-all column and its keep-silent verdict.
    const parentIds =
      matchedId === undefined
        ? []
        : rels
            .filter((r) => r.type?.endsWith("ParentChild") && r.person2?.resourceId === matchedId)
            .map((r) => r.person1?.resourceId)
            .filter((id): id is string => typeof id === "string");
    // `person.gender` is an OBJECT here — `{ type: ".../Male" }` — while the
    // string form lives at `display.gender`. `p.gender === "Male"` therefore never
    // fired, and sex detection silently fell back to the role regex, which is one
    // of the three methods this file's own header rejects. Measured cost on
    // 2026-08-08 before the fix: the `Zachariah + .exact` row reported 0 fathers
    // named when BOTH surviving records name Zachariah, and the fuzzy row's tally
    // omitted `Zachariah` itself while listing its variants. So the precedence is
    // the tool's (src/tools/record-search.ts: display.gender first, then
    // gender.type, then the role regex last), written ONCE here and shared by the
    // father/mother finders AND the couldBe denominators below — a single copy so
    // a future fix to it cannot land in one and miss the other. `/Male$/` does not
    // match ".../Female" (that ends "emale"), which is what makes the same
    // predicate safe for both sexes.
    const ROLE_OF = { Male: /Father/i, Female: /Mother/i } as const;
    const provablyOfSex =
      (sex: "Male" | "Female") =>
      (p: (typeof persons)[number]): boolean => {
        const d = (p.display ?? {}) as { role?: string; gender?: string };
        const genderType = (p.gender as { type?: string } | undefined)?.type ?? "";
        return (
          d.gender === sex ||
          new RegExp(sex + "$").test(genderType) ||
          ROLE_OF[sex].test(d.role ?? "")
        );
      };
    const father = persons.find(
      (p) => parentIds.includes(p.id as string) && provablyOfSex("Male")(p)
    );
    const mother = persons.find(
      (p) => parentIds.includes(p.id as string) && provablyOfSex("Female")(p)
    );
    // Sex-agnostic by design; see the field's docblock. First parent in graph
    // order, so a mother-only record counts as parent-NAMED, not parent-silent.
    const parent = persons.find((p) => parentIds.includes(p.id as string));
    const parentGivens = persons
      .filter((q) => parentIds.includes(q.id as string))
      .map((q) => givenOf(q))
      .filter((g): g is string => g !== null);
    // Everyone except a parent PROVABLY of the wrong sex, using the SAME
    // `provablyOfSex` predicate the finders above use — or the numerator and the
    // denominator disagree. An earlier version inlined its own check that read only
    // `display.gender` and `gender.type`, omitting the `role` fallback, so a parent
    // whose sex is stated ONLY in `role` was resolvable by the finder while counting
    // as sex-unprovable here — landing in both denominators at once and inflating
    // `namelessButIndexedInBaseline` at the expense of the silent share. Sharing one
    // predicate is what makes that class of drift impossible.
    const couldBe = (wrongSex: "Male" | "Female") => (q: (typeof persons)[number]) =>
      parentIds.includes(q.id as string) && !provablyOfSex(wrongSex)(q);
    const mothersIndexed = persons.filter(couldBe("Male")).length;
    const fathersIndexed = persons.filter(couldBe("Female")).length;

    // `givenOf` now lives in dev/payload-extract.ts (see its docblock there).
    const fatherName = ((father?.display ?? {}) as { name?: string }).name ?? null;
    const parentsIndexed = persons.filter((q) => parentIds.includes(q.id as string)).length;

    // Couple partners of the matched persona. Same `matchedId === undefined`
    // guard as parentIds above, and for the same reason — without it every
    // id-less person pairs with every id-less relationship side and the count
    // inflates, which would put a floor under the keep-silent verdict.
    const spouseIds =
      matchedId === undefined
        ? []
        : rels
            .filter((r) => r.type?.endsWith("Couple"))
            .flatMap((r) => {
              const a = r.person1?.resourceId;
              const b = r.person2?.resourceId;
              // Undirected: take whichever side is not the matched persona.
              if (a === matchedId && typeof b === "string") return [b];
              if (b === matchedId && typeof a === "string") return [a];
              return [];
            });
    const spouse = persons.find((p) => spouseIds.includes(p.id as string));
    const spouseName = ((spouse?.display ?? {}) as { name?: string }).name ?? null;
    const spousesIndexed = persons.filter((q) => spouseIds.includes(q.id as string)).length;

    return {
      id: e.id ?? "?",
      name: display.name ?? "?",
      others,
      matchedName: ((matched.display ?? {}) as { name?: string }).name ?? "?",
      fatherOfMatched: fatherName,
      parentsIndexed,
      matchedBirthDate:
        ((matched.display ?? {}) as { birthDate?: string }).birthDate ?? null,
      birthLike: (
        (matched.facts ?? []) as Array<{ type?: string; date?: unknown }>
      )
        .filter((f) => /Birth|Christening|Baptism/i.test(f.type ?? ""))
        .map((f) => {
          const original =
            ((f.date ?? {}) as { original?: string }).original ?? "";
          return {
            original,
            // `yearOfDate`, not `yearOf(original)` — a register entry may carry
            // only the day in `original` and the real year in `formal`.
            year: yearOfDate(f.date),
            approximate: /\b(abt|about|circa|ca\.?|est)\b/i.test(original),
          };
        }),
      // Same extraction, across EVERY person on the record rather than just the
      // matched one. `display.birthDate` is included per person because some
      // entries carry the year only there and not as a fact.
      spouseOfMatched: spouseName,
      fatherGivenOfMatched: givenOf(father),
      spouseGivenOfMatched: givenOf(spouse),
      motherGivenOfMatched: givenOf(mother),
      parentGivenOfMatched: givenOf(parent),
      parentGivensOfMatched: parentGivens,
      spousesIndexed,
      mothersIndexed,
      fathersIndexed,
      score: typeof e.score === "number" ? e.score : null,
      // Both sources of a date, per person: typed facts and the display block.
      // Section H found records that carry a year ONLY on `display`, so a
      // facts-only read here would manufacture year-silent rows that are not
      // silent, in the direction that makes "a range tolerates silence" look
      // truer than it is.
      // Delegated to dev/payload-extract.ts so the vitest fixture in
      // tests/dev/payload-extract.test.ts actually protects THIS code path.
      // Kept inline once, it drifted from the tested copy by two bugs.
      allDated: datedFromGedcomx({ persons, relationships: rels } as never),
      recordBirthYears: persons.flatMap((per) => {
        const factYears = (
          (per.facts ?? []) as Array<{ type?: string; date?: { original?: string } }>
        )
          .filter((f) => /Birth|Christening|Baptism/i.test(f.type ?? ""))
          .map((f) => yearOfDate(f.date))
          .filter((y): y is number => y !== null);
        const d = (per.display ?? {}) as { birthDate?: string };
        const displayYear = yearOf(d.birthDate ?? null);
        return displayYear === null ? factYears : [...factYears, displayYear];
      }),
    };
  });

  return { total: j.results ?? null, personas, error: null };
}

/**
 * Every request in this file goes through here.
 *
 * The loop cannot spin: `searchOnce` only returns RETRY while
 * `attempt < MAX_RETRIES`, so the final attempt always takes the
 * fall-through path and returns a real `Hit` — an errored one if the status is
 * still bad, which the `errored()` guards below then treat as NOT MEASURED
 * rather than as an empty pool.
 */
async function search(query: string): Promise<Hit> {
  for (let attempt = 0; ; attempt++) {
    const r = await searchOnce(query, attempt);
    if (r !== RETRY) return r;
  }
}

/**
 * A page that ERRORED is not a page that ran out.
 *
 * `search()` returns `{ total: null, personas: [], error }` on an HTTP failure,
 * a non-JSON body, or an `errors` payload. Every pager here used to test only
 * `personas.length < 100`, so a 429 or a transient 500 was indistinguishable
 * from "the pool ended here" — and the sections then reported ABSENCE. On
 * section E that turns one network blip into `fuzzy reaches diminutives NOT
 * CONFIRMED`, the negation of the result the spec and the skill references are
 * written around; on section B an errored exact page empties the ID set and
 * reports the whole window as fuzzy-only. A measurement that cannot be taken
 * must say NOT MEASURED, never the opposite of what it would have found.
 */
const errored = (r: Hit): boolean => r.error !== null;

/**
 * Int32 saturation. The API returns 2147483647 when a count overflows, and the
 * METHOD TRAPS above have warned about it since this file was written — but no
 * code path checked for it, so any ratio built from a saturated total printed a
 * confidently formatted percentage derived from a non-measurement. Every other
 * trap in that list has a guard; this closes the last one.
 */
const SATURATED = 2147483647;
const usableTotal = (n: number | null): n is number => n !== null && n > 0 && n !== SATURATED;
/** Like `usableTotal` but 0 is a real answer, not a missing one. Needed for any
 *  NUMERATOR: a gibberish father term returning 0 means 100% father-bearing, and
 *  rejecting it silently dropped that population out of the range verdict. */
const measuredTotal = (n: number | null): n is number => n !== null && n !== SATURATED;


/**
 * Measured-figure artifact.
 *
 * Every number this file measures and any doc then quotes is recorded here, and
 * `tests/packaging/measured-figures.test.ts` fails if a doc quotes a different
 * one. That check exists because the failure it catches has happened: a spec
 * sentence was written citing 293/284 for the gibberish row when 293/284 were
 * the ZACHARIAH row's figures, and nothing but a human reading both could see
 * it. Hand-transcribing a number out of this script's stdout is the defect;
 * emitting it is the fix.
 *
 * The artifact is COMMITTED. The probe hits live FamilySearch, so CI cannot
 * re-measure — the check compares docs against the last recorded run, and
 * refreshing the figures means re-running the relevant section and committing
 * the diff. That is the intended workflow: a doc figure and the run behind it
 * move together, in one commit, or the check goes red.
 */
const FIGURES_PATH = fileURLToPath(new URL("./measured-figures.json", import.meta.url));
const figures: Record<string, Record<string, unknown>> = {};

/** Record one measured value under a section. Values must be JSON-clean. */
function record(section: string, key: string, value: unknown): void {
  (figures[section] ??= {})[key] = value;
}

/**
 * Merge into the artifact rather than overwrite it: running `... F` alone must
 * not delete section E's figures and silently un-cover every claim they back.
 * Only sections that actually ran this invocation are replaced.
 */
function writeFigures(): void {
  const sections = Object.keys(figures);
  if (sections.length === 0) return;
  let prior: Record<string, unknown> = {};
  if (existsSync(FIGURES_PATH)) {
    try {
      prior = JSON.parse(readFileSync(FIGURES_PATH, "utf8")) as Record<string, unknown>;
    } catch {
      // A corrupt artifact must not silently become an empty one — that would
      // drop every previously-recorded section and pass the check vacuously.
      throw new Error(`${FIGURES_PATH} is not valid JSON; fix or delete it before re-running.`);
    }
  }
  const merged = { ...prior } as Record<string, unknown>;
  for (const sec of sections) merged[sec] = { ...figures[sec], measured_at: new Date().toISOString() };
  writeFileSync(FIGURES_PATH, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
  console.log(`\n  wrote ${sections.join(", ")} to ${FIGURES_PATH.split("/").slice(-1)[0]}`);
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

// `yearOf` and `yearOfDate` moved to dev/payload-extract.ts, where they are
// asserted against captured payloads in tests/dev/payload-extract.test.ts.
// Their doc comments went with them; leaving the blocks here made them
// render as documentation for sectionA().

// --- SECTION A — the require switch --------------------------------------

async function sectionA(): Promise<void> {
  console.log("\n=== A. The require switch (there is no per-field .required) ===");

  // This section answers issue #1093's question 2, and until now it recorded
  // NOTHING to the artifact — so the spec's `400 ... term modifier` quote, its
  // `6 / 4 / 4` vs `634 / 634 / 634` table and the suffix-order rule were all
  // pinned by no check at all. Every figure it prints is now recorded.
  const bad = await search(
    `q.surname=Zsigmondy&q.surname.required=on&count=3&${REQUIRE_SWITCH}`
  );
  // The 400's BODY is the finding, not the status line — search() is ordered to
  // let the API's own message win precisely so this reads as the documented
  // "Unable to map supplied value=required to term modifier".
  const perFieldRejected = bad.error !== null && bad.total === null;
  record("A", "perFieldRequiredError", bad.error);
  record("A", "verdict:per-field .required", perFieldRejected ? "REJECTED" : "ACCEPTED");
  console.log(`  q.surname.required=on  -> ${bad.error ?? `results=${bad.total}`}`);

  // Suffix ORDER. The spec asserts `q.surname.exact.1=on` is accepted while
  // `q.surname.1.exact=on` is rejected; that claim had no probe behind it.
  const altBase = "q.surname=Zsigmondy&q.surname.1=Zsigmond&count=3";
  const orderOk = await search(`${altBase}&q.surname.exact.1=on&${REQUIRE_SWITCH}`);
  const orderBad = await search(`${altBase}&q.surname.1.exact=on&${REQUIRE_SWITCH}`);
  record("A", "suffixExactThenCardinalityTotal", errored(orderOk) ? null : orderOk.total);
  record("A", "suffixCardinalityThenExactError", orderBad.error);
  const orderVerdict =
    errored(orderOk) || orderBad.error === null
      ? "NOT MEASURED"
      : "exact.1 ACCEPTED, 1.exact REJECTED";
  record("A", "verdict:suffix order", orderVerdict);
  console.log(`  q.surname.exact.1=on   -> ${orderOk.error ?? `results=${orderOk.total}`}`);
  console.log(`  q.surname.1.exact=on   -> ${orderBad.error ?? `results=${orderBad.total}`}`);

  const base = "q.surname=Zsigmondy&q.surname.exact=on&count=3";
  const extras: Array<[string, string, string]> = [
    ["baseline", "", "baseline"],
    ["+ gibberish given name", "&q.givenName=Xqzzyrbl", "gibberishGiven"],
    [
      "+ impossible birth range 1700-1710",
      "&q.birthLikeDate.from=1700&q.birthLikeDate.to=1710",
      "impossibleRange",
    ],
    ["+ wrong birthplace (Alaska)", "&q.birthLikePlace=Alaska,%20United%20States", "wrongPlace"],
  ];
  console.log("  label                                 with switch   without");
  let baselineOff: number | null = null;
  const ignoredWithoutSwitch: boolean[] = [];
  for (const [label, extra, key] of extras) {
    const on = await search(`${base}${extra}&${REQUIRE_SWITCH}`);
    const off = await search(`${base}${extra}`);
    record("A", key, {
      on: errored(on) ? null : on.total,
      off: errored(off) ? null : off.total,
    });
    if (key === "baseline") baselineOff = errored(off) ? null : off.total;
    else if (!errored(off) && baselineOff !== null) {
      // "The term was ignored" means: adding it changed nothing relative to the
      // baseline WITHOUT the switch. Derived, not asserted.
      ignoredWithoutSwitch.push(off.total === baselineOff);
    }
    console.log(`  ${label.padEnd(36)}${fmt(on.total)} ${fmt(off.total)}`);
  }
  const allIgnored =
    ignoredWithoutSwitch.length === extras.length - 1 && ignoredWithoutSwitch.every(Boolean);
  record("A", "termsIgnoredWithoutSwitch", ignoredWithoutSwitch.length);
  record(
    "A",
    "verdict:terms without the switch",
    ignoredWithoutSwitch.length === 0
      ? "NOT MEASURED"
      : allIgnored
        ? "IGNORED"
        : "HONORED"
  );
  console.log(
    ignoredWithoutSwitch.length === 0
      ? "  -> NOT MEASURED — no comparable pair completed; do not quote this table."
      : allIgnored
        ? `  -> all ${ignoredWithoutSwitch.length} added terms were IGNORED without the switch` +
          ` (right-hand column never moved off the baseline).`
        : `  -> NOT all terms were ignored without the switch` +
          ` (${ignoredWithoutSwitch.filter(Boolean).length}/${ignoredWithoutSwitch.length}).` +
          ` The spec's "Each added term was ignored outright" is too strong — fix it.`
  );
}

// --- SECTION B — ranking displacement ------------------------------------

async function sectionB(): Promise<void> {
  console.log("\n=== B. Does .exact=on change WHICH records come back, or only how many? ===");
  console.log("  Both sets read to the END. No top-N window (RULE 0).");

  // The old version diffed the top 200 of pools up to 18,500,000 and concluded
  // "no promotion detected". That phrasing was honest about its limit but the
  // limit was fatal: a top-200 window cannot see a record promoted from rank
  // 5,000 to rank 900, which is exactly the move the claim is about. On a pool
  // small enough to read in full, the question stops being about windows —
  // a record is either in the exact set or it is not.
  const POPS: Array<{ id: string; base: string }> = [
    { id: "Brazil/Bochenek", base: "q.surname=Bochenek&q.recordCountry=Brazil&f.recordType=1" },
    {
      id: "England/Pocklington",
      base:
        "q.surname=Pocklington&q.recordCountry=England&f.recordType=1" +
        "&q.marriageLikeDate.from=1850&q.marriageLikeDate.to=1854",
    },
  ];

  const rows: Array<Record<string, unknown>> = [];
  for (const pop of POPS) {
    const fuzzy = await mustEnumerate(pop.base);
    const exact = await mustEnumerate(`${pop.base}&q.surname.exact=on`);
    if (fuzzy.personas === null || exact.personas === null) {
      console.log(
        `\n  -- ${pop.id}: NOT MEASURED (fuzzy ${fuzzy.why ?? "ok"}, exact ${exact.why ?? "ok"})`
      );
      continue;
    }
    const fIds = fuzzy.personas.map((p) => p.id);
    const eIds = exact.personas.map((p) => p.id);
    const fSet = new Set(fIds);
    const eSet = new Set(eIds);
    // THE question, answerable only with complete sets: is there anything in the
    // exact set that the fuzzy set does not contain at all?
    const exactOnly = eIds.filter((id) => !fSet.has(id));
    const fuzzyOnly = fIds.filter((id) => !eSet.has(id));
    // Of the records both return, does exact REORDER them?
    //
    // Measured as DISPLACEMENT, not as adjacent descents. Counting descents was
    // wrong in a way that hid the answer: a record displaced 34 places produces
    // exactly ONE descent, so a real move looked like a single blip, and a tie
    // check on that one adjacent pair then dismissed the whole displacement as
    // noise. Both of this section's previous reorder verdicts came from that.
    //
    // Ranks are compared like for like: each shared record's position AMONG THE
    // SHARED SET in fuzzy order, against its position in the exact list. Both
    // run 1..N, so removal of the fuzzy-only records cannot itself move anything.
    const fRank = new Map(fIds.map((id, i) => [id, i]));
    const shared = eIds.filter((id) => fSet.has(id));
    const sharedByFuzzy = [...shared].sort(
      (x, y) => (fRank.get(x) ?? 0) - (fRank.get(y) ?? 0)
    );
    const fuzzyPos = new Map(sharedByFuzzy.map((id, i) => [id, i + 1]));
    const exactPos = new Map(shared.map((id, i) => [id, i + 1]));
    const displacementOf = (id: string): number =>
      Math.abs((exactPos.get(id) ?? 0) - (fuzzyPos.get(id) ?? 0));
    const displaced = shared.filter((id) => displacementOf(id) > 0);
    const maxDisplacement = shared.length
      ? Math.max(...shared.map(displacementOf))
      : 0;

    // NOISE FLOOR: the same fuzzy query again, scored the same way. Any
    // displacement here is instability rather than an effect of the qualifier.
    const fuzzyAgain = await mustEnumerate(pop.base);
    let selfMaxDisplacement: number | null = null;
    if (fuzzyAgain.personas !== null) {
      const againIds = fuzzyAgain.personas.map((p) => p.id).filter((id) => fSet.has(id));
      const againPos = new Map(
        [...againIds]
          .sort((x, y) => (fRank.get(x) ?? 0) - (fRank.get(y) ?? 0))
          .map((id, i) => [id, i + 1])
      );
      const againOrderPos = new Map(againIds.map((id, i) => [id, i + 1]));
      selfMaxDisplacement = againIds.length
        ? Math.max(
            ...againIds.map((id) =>
              Math.abs((againOrderPos.get(id) ?? 0) - (againPos.get(id) ?? 0))
            )
          )
        : 0;
    }

    // Is a displacement explainable by a TIE? Only if the displaced record and
    // everything it crossed share its score — checked across the whole crossed
    // span, not just the adjacent neighbour.
    const fuzzyScore = new Map(fuzzy.personas.map((p) => [p.id, p.score]));
    let displacedAcrossDistinctScores = 0;
    for (const id of displaced) {
      const from = fuzzyPos.get(id) ?? 0;
      const to = exactPos.get(id) ?? 0;
      const lo = Math.min(from, to);
      const hi = Math.max(from, to);
      const mine = fuzzyScore.get(id);
      const crossed = sharedByFuzzy.slice(lo - 1, hi);
      if (crossed.some((o) => o !== id && fuzzyScore.get(o) !== mine)) {
        displacedAcrossDistinctScores++;
      }
    }

    // How far does exactness MOVE a surviving record up the list?
    //
    // The set-diff answers "can exact return something fuzzy did not" (no). It
    // does NOT answer the question a searcher actually asks: "my record is deep
    // in the results — will exact bring it up?" Exact removes competitors, so a
    // survivor's ABSOLUTE position necessarily improves. Quantify it, because
    // "exact cannot surface what fuzzy buried" reads as an answer to this and is
    // only true of the relative order.
    const deepest = shared.length
      ? Math.max(...shared.map((id) => fRank.get(id) ?? 0)) + 1
      : null;
    const eRankOf = new Map(eIds.map((id, i) => [id, i + 1]));
    let worstGain = 0;
    let deepestSurvivorFuzzyRank = 0;
    let deepestSurvivorExactRank = 0;
    for (const id of shared) {
      const fr = (fRank.get(id) ?? 0) + 1;
      const er = eRankOf.get(id) ?? 0;
      if (fr - er > worstGain) {
        worstGain = fr - er;
        deepestSurvivorFuzzyRank = fr;
        deepestSurvivorExactRank = er;
      }
    }
    rows.push({
      pop: pop.id,
      deepestSharedFuzzyRank: deepest,
      biggestPositionGain: worstGain,
      exampleFuzzyRank: deepestSurvivorFuzzyRank,
      exampleExactRank: deepestSurvivorExactRank,
      fuzzyRows: fIds.length,
      exactRows: eIds.length,
      exactOnly: exactOnly.length,
      fuzzyOnly: fuzzyOnly.length,
      sharedRows: shared.length,
      recordsDisplaced: displaced.length,
      maxDisplacement,
      selfMaxDisplacement,
      displacedAcrossDistinctScores,
    });
    console.log(
      `\n  -- ${pop.id}\n` +
        `     fuzzy ${fIds.length} rows, exact ${eIds.length} rows, shared ${shared.length}\n` +
        `     exact-only (records ONLY the exact search returns): ${exactOnly.length}\n` +
        `     fuzzy-only (dropped by exact):                      ${fuzzyOnly.length}\n` +
        `     records displaced vs the exact set:                 ${displaced.length}\n` +
        `     largest displacement (positions):                   ${maxDisplacement}\n` +
        `     largest displacement re-running the SAME query:     ${selfMaxDisplacement ?? "NOT MEASURED"}\n` +
        `     displaced ACROSS rows of a different score:          ${displacedAcrossDistinctScores}\n` +
        `     biggest position GAIN for a surviving record:        ${worstGain}` +
        ` (fuzzy rank ${deepestSurvivorFuzzyRank} -> exact rank ${deepestSurvivorExactRank})`
    );
  }
  record("B", "rows", rows);

  // COUNT INFLATION, kept from the previous version of this section and
  // permitted by RULE 0 because it is a TOTALS argument: how much bigger the
  // fuzzy pool is than the exact one needs no enumeration, only two counts.
  // These three surnames are the spec's displacement table. The set-diff above
  // supersedes that table's RANKING claim; the ratios are still measured, and
  // dropping them silently would leave shipped prose quoting nothing — which is
  // what the packaging guard caught when this section was first rewritten.
  for (const surname of ["Zsigmondy", "Mingazzini", "Geach"]) {
    const fz = (await search(`q.surname=${surname}&count=1&${REQUIRE_SWITCH}`)).total;
    const ex = (
      await search(`q.surname=${surname}&q.surname.exact=on&count=1&${REQUIRE_SWITCH}`)
    ).total;
    record("B", surname, {
      fuzzyTotal: measuredTotal(fz) ? fz : null,
      exactTotal: measuredTotal(ex) ? ex : null,
      inflation: usableTotal(fz) && usableTotal(ex) ? Math.round(fz / ex) : null,
    });
    console.log(`  count inflation ${surname.padEnd(12)}${fmt(fz)} -> ${fmt(ex)}`);
  }
  if (rows.length === 0) {
    record("B", "verdict:exact surfaces records fuzzy does not", "NOT MEASURED");
    record("B", "verdict:exact reorders the shared records", "NOT MEASURED");
    console.log("\n  -> NOT MEASURED — no population could be enumerated.");
    return;
  }
  const anyExactOnly = rows.reduce((a, r) => a + (r.exactOnly as number), 0);
  const anyDisplaced = rows.reduce((a, r) => a + (r.recordsDisplaced as number), 0);
  const acrossDistinct = rows.reduce(
    (a, r) => a + (r.displacedAcrossDistinctScores as number),
    0
  );
  // An UNMEASURED noise floor is not a noise floor of zero. `?? 0` turned "the
  // re-run failed" into "the re-run showed no movement", which is the direction
  // that makes YES easier — and it disagreed with this section's own console
  // line, which prints NOT MEASURED for the same value.
  const noiseUnmeasured = rows.some((r) => r.selfMaxDisplacement === null);
  // Compared PER POPULATION. Maxing signal and noise across rows lets one
  // population's noise floor excuse another population's movement.
  const beatsNoise = rows.some(
    (r) =>
      r.selfMaxDisplacement !== null &&
      (r.maxDisplacement as number) > (r.selfMaxDisplacement as number)
  );
  // From the BEATING rows only. `beatsNoise` is per-population (above, and
  // deliberately), but this was a Math.max across every row — so a population
  // moving 100 positions against a noise floor of 200 (not beating) could supply
  // the "largest by N positions" figure for a verdict another population earned.
  // The verdict string is what the spec table and every downstream doc quote.
  const beatingRows = rows.filter(
    (r) =>
      r.selfMaxDisplacement !== null &&
      (r.maxDisplacement as number) > (r.selfMaxDisplacement as number)
  );
  const maxDisp = beatingRows.length
    ? Math.max(...beatingRows.map((r) => r.maxDisplacement as number))
    : Math.max(...rows.map((r) => r.maxDisplacement as number));
  // Empty pools are not evidence. `mustEnumerate` returns `personas: []` for a
  // zero-result query — a short page trivially — so `rows.length > 0` does not
  // mean anything was measured. Without this, both verdicts below publish from
  // no records at all, and the header calls the first one "a proof".
  const anyShared = rows.reduce((a, r) => a + (r.sharedRows as number), 0);
  record(
    "B",
    "verdict:exact surfaces records fuzzy does not",
    anyShared === 0
      ? "NOT MEASURED — no shared records in any enumerated pool"
      : anyExactOnly === 0
        ? "NO — across complete sets, every record the exact search returns is already in the fuzzy set. Exact is a strict subset, so it cannot surface a record a fuzzy search buried. Measured on the `surname` qualifier in marriage populations only."
        : `YES — ${anyExactOnly} record(s) appear in the exact set and not in the fuzzy set`
  );
  record(
    "B",
    "verdict:exact reorders the shared records",
    anyShared === 0
      ? "NOT MEASURED — no shared records in any enumerated pool"
      : noiseUnmeasured
        ? "NOT MEASURED — the same-query re-run that establishes the noise floor did not complete, so movement cannot be separated from instability"
        : anyDisplaced === 0
          ? "NO — every shared record holds the same position in both orders"
          : !beatsNoise
            ? `NO — ${anyDisplaced} record(s) move, but by no more than re-running the same query moves them, so this is instability rather than an effect of the qualifier`
            : acrossDistinct === 0
              ? `NO — ${anyDisplaced} record(s) move further than the noise floor, but NONE of them crosses a row carrying a different relevance score, so every move is between rows whose order was never defined`
              : `YES — ${anyDisplaced} record(s) move, the largest by ${maxDisp} positions, exceeding the same-query noise floor, and ${acrossDistinct} of them cross rows carrying a DIFFERENT relevance score`
  );
  console.log(
    `\n  => exact-only records: ${anyExactOnly} (${anyExactOnly === 0 ? "exact is a strict SUBSET — it cannot surface what fuzzy buried" : "exact surfaces records fuzzy does not"})`
  );
  console.log(
    `  => displacement: ${anyDisplaced} record(s) moved, largest ${maxDisp} positions,` +
      ` noise floor ${noiseUnmeasured ? "NOT MEASURED" : "measured per population"},` +
      ` ${acrossDistinct} crossing rows of a different score.` +
      ` ${noiseUnmeasured ? "Withheld." : !beatsNoise || acrossDistinct === 0 ? "Within noise / ties." : "So exact DOES reorder the records it keeps."}`
  );
}

// --- SECTION C — place expansion -----------------------------------------

const NEAL =
  "q.surname=Neal&q.givenName=James&q.spouseGivenName=Martha" +
  "&q.marriageLikeDate.from=1874&q.marriageLikeDate.to=1876";
const NEVADA_AR = "Nevada,%20Arkansas,%20United%20States";
const YELL_AR = "Yell,%20Arkansas,%20United%20States";

async function sectionC(): Promise<void> {
  console.log("\n=== C. Place expansion (hold the query constant!) ===");
  const cases: Array<[string, string, string]> = [
    ["correct county, fuzzy place", `${NEAL}&q.marriageLikePlace=${NEVADA_AR}`, "correctCountyFuzzy"],
    ["correct county, marriagePlaceExact", `${NEAL}&q.marriageLikePlace=${NEVADA_AR}&q.marriageLikePlace.exact=on`, "correctCountyExact"],
    ["WRONG county (Yell), fuzzy place", `${NEAL}&q.marriageLikePlace=${YELL_AR}`, "wrongCountyFuzzy"],
  ];
  // The rank claim used to be an unconditional console.log while this section
  // recorded only totals — so "the target ranked first in both" was printed
  // whatever the run found, and three shipped documents restated it. It is now
  // derived. `count=20`, not 3: absence is only meaningful relative to a window
  // you actually scanned, and 3 rows out of 35,000 cannot support the word.
  const WINDOW = 20;
  /**
   * Identity is by RECORD ID, established from the first row, not by name.
   *
   * A name-blob predicate was tried and produced a false positive immediately:
   * the wrong county's rank-1 hit is `William Rufus Neal x James Neal`, whose
   * record mentions an unrelated Martha somewhere in its personas, so a
   * "surname-ish AND Martha" test matched it and the section printed "the
   * wrong-county claim in the docs is wrong" — the inverse of the truth. Names
   * cannot identify a record in a 35,000-row pool of same-surname families.
   */
  const nameLooksLikeTarget = (p: Persona): boolean => {
    const blob = [p.name, p.matchedName, ...p.others.map((o) => o.name)].join(" ");
    return /Ne[ai]l{1,2}\b/i.test(blob) && /\bMartha\b/i.test(blob) && /\bJames\b/i.test(blob);
  };
  let targetId: string | null = null;
  const ranks: Record<string, number | null> = {};
  for (const [label, q, key] of cases) {
    const r = await search(`${q}&count=${WINDOW}&${REQUIRE_SWITCH}`);
    record("C", key, errored(r) ? null : r.total);
    // The first case fixes the identity: its rank-1 row IS the target (checked
    // against the name shape so a reordering upstream cannot silently rebind
    // it). Every later case then tests membership of that same id.
    if (key === "correctCountyFuzzy" && !errored(r)) {
      const first = r.personas[0];
      if (first !== undefined && nameLooksLikeTarget(first)) targetId = first.id;
      else
        console.log(
          "    WARNING: the correct-county rank-1 row no longer looks like " +
            "James Neill x Martha Sampson — identity NOT bound, ranks below are null."
        );
    }
    // A rank from an errored page is not a rank. Leave it null so the verdict
    // below reads NOT MEASURED rather than inventing an absence.
    const idx =
      errored(r) || targetId === null ? -1 : r.personas.findIndex((p) => p.id === targetId);
    const rank = idx < 0 ? null : idx + 1;
    ranks[key] = rank;
    record("C", `${key}TargetRank`, rank);
    const top = r.personas
      .slice(0, 2)
      .map((p) => `${p.name} x ${p.others[0]?.name ?? "-"}`)
      .join(" | ");
    console.log(
      `  ${label.padEnd(36)}${fmt(r.total)}  ` +
        `target ${errored(r) ? "NOT MEASURED" : rank === null ? `not in top ${WINDOW}` : `rank ${rank}`}` +
        `  ${top}`
    );
  }
  record("C", "targetWindowScanned", WINDOW);
  record("C", "targetIdBound", targetId);
  const fz = ranks.correctCountyFuzzy;
  const ex = ranks.correctCountyExact;
  const wrong = ranks.wrongCountyFuzzy;
  // Every branch below is derived from what was just measured. There is no
  // unconditional verdict string in this section any more.
  if (fz === null || ex === null) {
    console.log(
      `  -> rank comparison NOT MEASURED (fuzzy=${String(fz)}, exact=${String(ex)}) —` +
        ` do not quote a ranking claim for the place qualifier.`
    );
  } else if (fz === 1 && ex === 1) {
    console.log("  -> the target ranks FIRST both with and without the qualifier.");
  } else {
    console.log(
      `  -> the target does NOT rank first in both (fuzzy rank ${fz}, exact rank ${ex}).` +
        ` Fix the sentence in place-date-mechanics.md / search-strategy-levers.md / the spec.`
    );
  }
  console.log(
    wrong === null
      ? `  -> the target is NOT in the wrong county's top ${WINDOW}. That is "not in the top ${WINDOW}",` +
          ` NOT "absent" — this section never scans the full wrong-county pool.`
      : `  -> the target DOES appear in the wrong county at rank ${wrong} — the wrong-county` +
          ` claim in the docs is wrong.`
  );
}

// --- SECTION D — where surnameExact destroys the answer -------------------

async function sectionD(): Promise<void> {
  console.log("\n=== D. surnameExact on a misspelled index (target is 'Neill') ===");
  const tail = `&q.marriageLikePlace=${NEVADA_AR}&q.marriageLikePlace.exact=on&count=3&${REQUIRE_SWITCH}`;
  const base = NEAL.replace("q.surname=Neal", "");
  const cases: Array<[string, string, string]> = [
    ["surname=Neal, fuzzy (what an agent sends)", `q.surname=Neal${base}${tail}`, "nealFuzzy"],
    ["surname=Neal + surnameExact", `q.surname=Neal&q.surname.exact=on${base}${tail}`, "nealExact"],
    ["surname=Neill + surnameExact", `q.surname=Neill&q.surname.exact=on${base}${tail}`, "neillExact"],
  ];
  for (const [label, q, key] of cases) {
    const r = await search(q);
    record("D", key, errored(r) ? null : r.total);
    console.log(
      `  ${label.padEnd(42)}${fmt(r.total)}  ${r.personas.map((p) => p.name).join(" / ") || "(none)"}`
    );
  }
  // Derived, not asserted. This was the last unconditional verdict line in the
  // file: it printed "exact returns 0" whatever the run found, which is the
  // shape the header condemns everywhere else.
  const dNealFuzzy = (figures.D ?? {}).nealFuzzy as number | null;
  const dNealExact = (figures.D ?? {}).nealExact as number | null;
  const dNeillExact = (figures.D ?? {}).neillExact as number | null;
  record(
    "D",
    "verdict:fuzzy bridges the misspelling and exact destroys it",
    dNealFuzzy === null || dNealExact === null || dNeillExact === null
      ? "NOT MEASURED"
      : dNealFuzzy > 0 && dNealExact === 0
        ? "HOLDS — the fuzzy spelling finds the record and the exact spelling returns nothing"
        : `DOES NOT HOLD — fuzzy ${dNealFuzzy}, exact ${dNealExact}`
  );
  console.log(
    dNealFuzzy === null || dNealExact === null
      ? "  -> NOT MEASURED — a row errored; do not quote this section."
      : dNealFuzzy > 0 && dNealExact === 0
        ? `  -> fuzzy is what bridges Neal->Neill (${dNealFuzzy} found); exact returns ${dNealExact}.`
        : `  -> NOT the expected shape: fuzzy ${dNealFuzzy}, exact ${dNealExact}. Fix the docs.`
  );
}

// --- SECTION E — diminutives ---------------------------------------------

async function sectionE(): Promise<void> {
  console.log("  [RULE 0] E samples deep pools; the diminutive-REACH question is re-done enumerably in section N.");
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
  // Not a pager — nothing infers exhaustion here — but an errored call would
  // print an empty tally that reads as "fuzzy returned nothing".
  console.log(
    errored(sample)
      ? `\n  fuzzy 'Elizabeth' top-100 given names: NOT AVAILABLE (${sample.error})`
      : `\n  fuzzy 'Elizabeth' top-100 given names: ${tally(firsts)}`
  );
  console.log("  -> a top-N tally CANNOT answer whether fuzzy reaches a diminutive.");
  console.log("     Exact matches saturate the head of a large pool. Membership below.");

  // --- Does fuzzy actually REACH the diminutive? ---------------------------
  //
  // The tally above is the trap, not the answer. Until 2026-08-08 this file
  // and the docs it backs concluded "fuzzy does not reach Betty" from exactly
  // such a sample — a top-100 window onto a 219,495-record pool, in which the
  // Betty records sat past rank 500 (all this scan can establish). They were in the result set the whole
  // time. Sampling depth cannot distinguish "absent" from "outranked", so ask
  // a question ranking cannot distort: take a record whose given name IS the
  // diminutive, then check whether the FUZZY search for the formal name
  // returns that same record id.
  console.log("\n  membership test — is a diminutive record inside the formal name's fuzzy set?");
  // Four pairs over THREE pool sizes on purpose. Membership answers "does the
  // expansion reach it"; rank answers "would a researcher ever see it", and the
  // second question is the one that decides what the skill should do. Keep a
  // small pool and a large one in the list or the rank column says nothing.
  const PAIRS: Array<[string, string, string]> = [
    ["Elizabeth", "Betty", "q.surname=Purnell&q.surname.exact=on&q.birthLikePlace=Trowbridge,%20Wiltshire,%20England"],
    ["Margaret", "Peggy", "q.surname=Smith&q.surname.exact=on&q.birthLikePlace=Trowbridge,%20Wiltshire,%20England"],
    ["Mary", "Polly", "q.surname=Smith&q.surname.exact=on&q.birthLikePlace=Trowbridge,%20Wiltshire,%20England"],
    ["Elizabeth", "Betty", "q.surname=Martin&q.surname.exact=on&q.birthLikePlace=Gloucestershire,%20England"],
  ];
  const RANK_SCAN = 500;
  // `present` is carried so the rank verdict can EXCLUDE records fuzzy never
  // returned. Without it a not-reached record lands in the same bucket as an
  // outranked one and gets reported as "reached but past N" — the very
  // absent-vs-outranked confusion this section exists to eliminate.
  const ranks: Array<{ formal: string; dim: string; pool: number | null; rank: number | null; present: boolean; rankExhausted: boolean; rankFailed: boolean }> = [];
  let reached = 0;
  let tested = 0;
  let inconclusive = 0;
  for (const [formal, dim, base] of PAIRS) {
    const holders = await search(`${base}&q.givenName=${dim}&q.givenName.exact=on&count=20&${REQUIRE_SWITCH}`);
    if (errored(holders)) {
      console.log(`    ${formal} <- ${dim.padEnd(6)} NOT MEASURED (API error fetching ${dim} records: ${holders.error})`);
      continue;
    }
    let done = 0;
    for (const h of holders.personas) {
      if (done >= 2) break;
      const year = h.birthLike.map((f) => f.year).find((y): y is number => y !== null);
      if (year === undefined) continue;
      done++;
      tested++;
      // Three outcomes, not two. `false` from a window we did not finish reading
      // is NOT "fuzzy does not reach it" — that is the absent-vs-outranked error
      // this section exists to kill, and it was still here in the negative
      // direction. Only an EXHAUSTED pool (a short page) can say "absent".
      let present = false;
      let exhausted = false;
      let apiFailed = false;
      for (const offset of [0, 100, 200]) {
        const probe = await search(
          `${base}&q.givenName=${formal}&q.birthLikeDate.from=${year}&q.birthLikeDate.to=${year}` +
            `&count=100&offset=${offset}&${REQUIRE_SWITCH}`
        );
        if (errored(probe)) { apiFailed = true; break; }
        if (probe.personas.some((x) => x.id === h.id)) { present = true; break; }
        if (probe.personas.length < 100) { exhausted = true; break; }
      }
      if (present) reached++;
      else if (apiFailed || !exhausted) inconclusive++;
      // Rank is measured in the UNNARROWED fuzzy search — the query a researcher
      // would actually run — not the year-narrowed one used for membership.
      const pool = (await search(`${base}&q.givenName=${formal}&count=1&${REQUIRE_SWITCH}`)).total;
      let rank: number | null = null;
      // `rankExhausted` separates "we read the whole pool and it was not there"
      // from "we stopped at RANK_SCAN". Printing `>500` for the first is wrong:
      // that is absence, not depth, and it can disagree with `present` because
      // membership is measured on the NARROWED query and rank on the unnarrowed
      // one — the two really can differ.
      let rankExhausted = false;
      let rankFailed = false;
      for (let off = 0; off < RANK_SCAN && present; off += 100) {
        const page = await search(`${base}&q.givenName=${formal}&count=100&offset=${off}&${REQUIRE_SWITCH}`);
        if (errored(page)) { rankFailed = true; break; }
        const at = page.personas.findIndex((x) => x.id === h.id); // leaves rank null and rankExhausted false -> ">RANK_SCAN" is wrong, so:
        if (at >= 0) { rank = off + at + 1; break; }
        if (page.personas.length < 100) { rankExhausted = true; break; }
      }
      ranks.push({ formal, dim, pool, rank, present, rankExhausted, rankFailed });
      console.log(
        `    ${formal} <- ${dim.padEnd(6)} "${h.matchedName}" (${year}): ${present ? "REACHED by fuzzy" : "not found in first 300"}` +
          `  pool=${fmt(pool)}  rank=${
            // Four cases, and conflating any two of them is how this file has
            // been wrong before. `!present` means the rank loop never ran, so
            // ">RANK_SCAN" would assert a scan that did not happen.
            rankFailed
              ? "not measured (API error during the scan)"
              : !present
                ? "n/a (fuzzy did not reach it, so rank was not measured)"
              : rank !== null
                ? String(rank)
                : rankExhausted
                  ? "absent from the whole pool"
                  : `>${RANK_SCAN}`
          }`
      );
    }
    if (!done) console.log(`    ${formal} <- ${dim.padEnd(6)} (no datable ${dim} record in this population)`);
  }
  console.log("");
  const conclusive = tested - inconclusive;
  if (!tested) {
    console.log("  fuzzy reaches diminutives  NOT MEASURED — no datable diminutive record was found to test.");
  } else {
    console.log(
      // Denominator is the candidates actually MEASURED. Counting inconclusive
      // ones here reported a weaker result than was found — one 429 on a
      // membership page turned 8/8 into "PARTIAL — re-check by hand", which is
      // the inverse of the rule this file states: a measurement that cannot be
      // taken says NOT MEASURED, never something weaker than the truth.
      `  fuzzy reaches diminutives  ${
        conclusive === 0 ? "NOT MEASURED" : reached === conclusive ? "CONFIRMED" : reached ? "PARTIAL" : "NOT CONFIRMED"
      } — ` +
        `${reached}/${conclusive} conclusively-tested diminutive records were returned by the fuzzy search for their formal name` +
        `${inconclusive ? ` (${inconclusive} inconclusive — not found in the first 300 rows of a pool we did not finish reading, which is NOT evidence of absence)` : ""}. ` +
        (conclusive > 0 && reached === conclusive
          ? "So the expansion DOES cover them."
          : "Mixed result — re-check the failures by hand before writing either conclusion down.")
    );
    // A scan that died on an API error is not a rank measurement. Excluding it
    // here is what stops the summary contradicting the per-row line, which
    // already prints "not measured".
    const rankable = ranks.filter((r) => r.present && r.pool !== null && !r.rankFailed);
    record("E", "reached", reached);
    record("E", "conclusive", conclusive);
    record("E", "rankScan", RANK_SCAN);
    // WHICH pairs were membership-tested, and over how many populations. A doc
    // naming a diminutive as "membership-tested" must be checkable against this
    // rather than against a reader's memory of what the probe covers.
    record("E", "pairsTested", [...new Set(PAIRS.map(([f, d]) => `${f}<-${d}`))]);
    record("E", "populationsTested", new Set(PAIRS.map(([, , b]) => b)).size);
    record("E", "membershipTested", [...new Set(ranks.filter((r) => r.present).map((r) => r.dim))]);
    const seen = rankable.filter((r) => r.rank !== null);
    const unseen = rankable.filter((r) => r.rank === null && !r.rankExhausted);
    // Carry the WINNING ROW, not two independent minima: taking min(rank) and
    // min(pool) separately can print a rank and a pool that never occurred
    // together on any pair.
    const best = seen.length
      ? seen.reduce((a, b) => ((a.rank as number) <= (b.rank as number) ? a : b))
      : null;
    const large = unseen.length ? Math.min(...unseen.map((r) => r.pool as number)) : null;
    record("E", "seenWithinScan", seen.length);
    record("E", "rankable", rankable.length);
    record("E", "bestRank", best?.rank ?? null);
    record("E", "bestPool", best?.pool ?? null);
    record("E", "unseenMinPool", large);
    record("E", "pools", rankable.map((r) => r.pool).sort((a, b) => (a as number) - (b as number)));
    console.log(
      `  rank is the constraint     ${seen.length && unseen.length ? "CONFIRMED" : "NOT CONFIRMED"} — ` +
        `${seen.length}/${rankable.length} of the REACHED records were found within the first ${RANK_SCAN} results` +
        `${best ? ` (best rank ${best.rank} in a pool of ${fmt(best.pool)})` : ""}` +
        `${unseen.length ? `, and ${unseen.length} were NOT, in pools from ${fmt(large)} up` : ""}. ` +
        (seen.length && unseen.length
          ? "Same matching behaviour throughout; only the number of closer-scoring competitors changes. So a broad search CONTAINS the diminutive and never shows it: narrow the query until the pool is scannable, or search the diminutive as its own givenName value, which surfaces it whatever the pool size."
          : "Not enough spread in pool size to demonstrate the effect — add a pair on a differently-sized population before drawing the rank conclusion.")
    );
  }
}

// --- SECTION F — relative names keep the silent records ------------------

async function sectionF(): Promise<void> {
  console.log("  [RULE 0] F's 300-row PROPORTIONS are sampled (RULE 0); its totals-derived figures are fine. Section R supersedes its relative-name reading.");
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
  /**
   * Stable artifact keys for the display labels above. Separate from the labels
   * on purpose: the label is prose that may be reworded, the key is what docs
   * are checked against and must not move when it is.
   */
  const ROW_KEYS: Record<string, string> = {
    "baseline (no father term)": "baseline",
    "common name (William)": "william",
    "...William plus .exact=on": "williamExact",
    "real but rare (Zachariah)": "zachariah",
    "...Zachariah plus .exact=on": "zachariahExact",
    "gibberish father name": "gibberish",
  };
  const silentReps: Array<{ id: string; who: string }> = [];
  let matchRep: { id: string; who: string } | null = null;
  const measured = new Map<string, { total: number | null; sampled: number; names: string[]; zeroParents: number }>();
  for (const [label, extra] of variants) {
    const names: string[] = [];
    let total: number | null = null;
    let sampled = 0;
    let zeroParents = 0;
    let pageFailed = false;
    for (const offset of [0, 100, 200]) {
      const r = await search(`${base}${extra}&count=100&offset=${offset}&${REQUIRE_SWITCH}`);
      // A failed page would shrink `sampled` silently, and `sampled` is the
      // denominator of the keep-silent verdict below.
      if (errored(r)) { pageFailed = true; break; }
      if (total === null) total = r.total;
      sampled += r.personas.length;
      for (const p of r.personas) {
        if (p.fatherOfMatched) names.push(p.fatherOfMatched.trim().split(/\s+/)[0] ?? "?");
        // Two different questions, two different columns. `fatherOfMatched`
        // reads the parent's `display.name`, so a record whose father IS indexed
        // but carries no readable name counts as name-less — that column cannot
        // stand behind a "names no father at all" claim. Zero indexed parents
        // can. Both are printed; every verdict below rests on this one.
        if (p.parentsIndexed === 0) zeroParents++;
        // Representatives for the presence verdict below, taken from rows we are
        // already paging, so this costs no extra calls against the live API.
        //
        // The father-less side MUST come from the baseline row. The William rows
        // are already father-anchored, so a genuinely father-less record is
        // precisely what they are suspected of dropping: drawing the test subject
        // from them can only ever find zero and report NOT MEASURED forever,
        // which is a rigged test, not a cautious one. The baseline row applies no
        // father term, so it is the only row that can supply one.
        if (label === "baseline (no father term)") {
          if (p.parentsIndexed === 0 && silentReps.length < 3) silentReps.push({ id: p.id, who: p.matchedName });
        } else if (label === "common name (William)") {
          const first = p.fatherOfMatched?.trim().split(/\s+/)[0] ?? null;
          if (first !== null && /^William$/i.test(first)) matchRep ??= { id: p.id, who: `${p.matchedName}, father ${first}` };
        }
      }
    }
    if (pageFailed) {
      console.log(`  ${label.padEnd(28)} NOT MEASURED — an API error truncated the survey; row omitted`);
      continue;
    }
    measured.set(label, { total, sampled, names, zeroParents });
    record("F", ROW_KEYS[label] ?? label, {
      total,
      sampled,
      namesAFather: names.length,
      noFatherName: sampled - names.length,
      noParentAtAll: zeroParents,
      tally: tally(names),
    });
    console.log(
      `  ${label.padEnd(28)} total=${fmt(total)}  sampled=${String(sampled).padStart(3)}` +
        `  names-a-father=${String(names.length).padStart(3)}` +
        `  no-father-name=${String(sampled - names.length).padStart(3)}` +
        `  no-parent-at-all=${String(zeroParents).padStart(3)}  ${tally(names)}`
    );
  }

  // --- Verdict, derived from the rows above --------------------------------
  // --- Does relative `*Exact` require the relative to be PRESENT? -----------
  //
  // The tool's ten relative *Exact descriptions assert it does. Settled here by
  // membership, which is the only way to settle it: the William+.exact set is
  // small enough to read in full, so ask whether a genuinely father-less record
  // — drawn from the BASELINE row, see the rep-selection note above — survives
  // into it, with a William-fathered record from the fuzzy row as the
  // sensitivity control. The two queries differ only in the father term, so any
  // record in the .exact set necessarily matches the base query: absence is
  // attributable to the qualifier and to nothing else.
  //
  // Do not restate a remembered result here. This verdict was CONFIRMED once on
  // a rep set chosen by `fatherOfMatched === null`, which selects records whose
  // father is indexed but unnamed just as readily as father-less ones — so that
  // run proved nothing and the claim it licensed had to be withdrawn. Read the
  // verdict the run prints, not this comment.
  //
  // The `no-father-name` and `no-parent-at-all` columns above differ for exactly
  // that reason and are not interchangeable: the first is a lower bound on
  // father-bearing, the second is the real one.
  // An IIFE, not a bare block: the early exits below must leave this
  // measurement, not abandon the five verdicts and the six-population survey
  // that follow it and do not depend on it. Section H's attribution block is
  // an arrow function for the same reason.
  await (async (): Promise<void> => {
    const exactTotal = measured.get("...William plus .exact=on")?.total ?? null;
    record("F", "williamExactTotal", exactTotal);
    const PAGEABLE = 600;
    if (silentReps.length === 0 || exactTotal === null || exactTotal > PAGEABLE) {
      console.log(
        `\n  requires presence    NOT MEASURED — ${
          silentReps.length === 0
            ? "no genuinely father-less record appeared in the unqualified William rows to test with"
            : `the .exact set is ${fmt(exactTotal)}, too large to read in full (cap ${PAGEABLE})`
        }. Not inferring it from the ratio.`
      );
    } else {
      const exactIds = new Set<string>();
      let readFailed = false;
      for (let off = 0; off < PAGEABLE; off += 100) {
        const pg = await search(
          `${base}&q.fatherGivenName=William&q.fatherGivenName.exact=on&count=100&offset=${off}&${REQUIRE_SWITCH}`
        );
        // A partial read turns "ABSENT" into "we did not finish looking".
        if (errored(pg)) { readFailed = true; break; }
        pg.personas.forEach((x) => exactIds.add(x.id));
        if (pg.personas.length < 100) break;
      }
      if (readFailed) {
        console.log(
          "\n  requires presence    NOT MEASURED — an API error interrupted the read of the .exact set, so" +
            " absence from it would mean 'not finished looking', not 'dropped'."
        );
        return;
      }
      // Every representative must agree; one is a sample of one.
      const keptAny = silentReps.filter((r) => exactIds.has(r.id));
      const silentKept = keptAny.length > 0;
      const matchKept = matchRep ? exactIds.has(matchRep.id) : null;
      // The control must EXIST and pass. `matchKept !== false` is true when
      // matchKept is null, so this printed CONFIRMED with no positive control at
      // all — while its own message said "no William-fathered control was
      // found". A verdict that survives the absence of its control is not a test.
      const ok = !silentKept && matchKept === true;
      record(
        "F",
        "verdict:relative .exact requires the relative to be present",
        matchRep === null
          ? "NOT MEASURED — no positive control (a record whose father DOES match) was found in the unqualified row, so absence of the silent records proves nothing"
          : ok
            ? "CONFIRMED — every father-less representative is absent from the exact set read in full, and the father-bearing control is present"
            : "NOT CONFIRMED"
      );
      console.log(
        `\n  requires presence    ${ok ? "CONFIRMED" : "NOT CONFIRMED"} — read the ${fmt(exactTotal)}-record ` +
          `.exact set in full. ${silentReps.length} genuinely father-less record(s) from the ` +
          `unqualified row (${silentReps.map((r) => r.who).join("; ")}) are ` +
          `${silentKept ? `NOT all absent — ${keptAny.length} survived` : "all ABSENT"}` +
          `${matchRep ? `; a William-fathered control (${matchRep.who}) is ${matchKept ? "present" : "ABSENT — control failed, distrust this row"}` : "; no William-fathered control was found"}. ` +
          (ok
            ? "So the qualifier requires the relative to be indexed, not merely to not-contradict."
            : "The presence claim in the tool's relative *Exact descriptions is NOT supported by this run — do not restate it.")
      );
    }
  })();

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
  /**
 * Diacritic- and initial-tolerant matching, matching what section R uses.
 *
 * Section F predates the three scoring fixes and never received them, so its
 * conflicting-father count still fails in all three directions: `José` does not
 * match `Jose`, a father indexed `W Martin` reduces to the token `W` and counts
 * as a CONFLICT, and for a father indexed with a surname and no given name the
 * first token of `display.name` IS the surname. The artifact shows the last one
 * biting already — the Zachariah tally records `Zacharish:1`, a plain variant
 * that ACCEPTED_FORMS does not list and that is therefore scored as a different
 * father.
 */
const foldName = (s: string): string =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const isInitialFor = (token: string, wanted: string): boolean => {
  const tk = foldName(token).replace(/\./g, "");
  return tk.length === 1 && tk[0] === foldName(wanted)[0];
};

const ACCEPTED_FORMS: Record<string, RegExp> = {
    William: /^(william|willia|willm|will|will?y|bill|wm)$/i,
    Zachariah: /^(zachariah|zacharia|zachari|zacharias|zacharius|zachary|zachariah?s|zacaria|zacharie|zachie|zach|zac|zack)$/i,
  };
  const looksLikeTerm = (term: string, name: string): boolean => {
    const n = name.replace(/\.$/, "").trim();
    const re = ACCEPTED_FORMS[term];
    if (!re) throw new Error(`sectionF: no ACCEPTED_FORMS entry for "${term}"`);
    // Fold diacritics before the regex, and treat a bare initial as a hit —
    // the index holds initials and the search matches them, so `W` is a hit for
    // `William`, not a different father. Without these, a match is scored as a
    // CONFLICT, and the drop-contradicting verdict below flips on ~6 of them.
    return re.test(n) || re.test(foldName(n)) || isInitialFor(n, term);
  };
  const conflicts = (row: typeof baseline, term: string): string[] =>
    (row?.names ?? []).filter((n) => !looksLikeTerm(term, n));

  // Does a FUZZY relative term keep records where the relative is unindexed?
  //
  // NOT answerable from the anchored row's head, and reading it that way gets
  // the sign wrong. A father-anchored query ranks father-bearing records first,
  // so a top-300 sample of 442,820 fills with them and reports zero father-less
  // records — which is what rank alone produces and says nothing about whether
  // the pool contains them. Section E is the same lesson: coverage and rank are
  // different questions, and only one of them a sample of the head can answer.
  // (A run of this file did print `keep-silent NOT CONFIRMED` off that sample.)
  //
  // Two lines of evidence that rank cannot confound:
  //   1. TOTALS. A gibberish father name — one no record can match — still
  //      returns essentially the whole baseline pool. If the term filtered on
  //      the father being indexed, an unmatchable one would collapse the count.
  //   2. The gibberish row's SAMPLE, where the head is not rank-filled by
  //      father-bearing records precisely because none of them match, so
  //      parentless records are visible in it.
  // Both must hold. `parentsIndexed === 0` throughout: a record with zero
  // indexed parents certainly has no father, whereas a missing `display.name`
  // only means the father's name is unreadable.
  const baseTotal = baseline?.total ?? null;
  const gibTotal = gibberish?.total ?? null;
  const totalHeld =
    measuredTotal(baseTotal) && measuredTotal(gibTotal) && baseTotal! > 0
      ? gibTotal! / baseTotal! > 0.9
      : null;
  record("F", "gibberishKeptPct", totalHeld === null ? null : +((gibTotal! / baseTotal!) * 100).toFixed(1));
  const gibSilent = gibberish?.zeroParents ?? 0;
  const silent = gibSilent;
  const keepSilent = totalHeld === true && gibSilent > 0;

  // The decisive row is the REAL but RARE term: few records can match it, so
  // if the term merely boosted rank the sample would fill with other people's
  // fathers. Judge on the count of sampled records naming a CONFLICTING
  // father, which needs no assumption about how many records match.
  const rareConflicts = conflicts(rare, "Zachariah");
  const commonConflicts = conflicts(anchored, "William");
  const conflictRate = rare && rare.sampled > 0 ? rareConflicts.length / rare.sampled : NaN;
  // Denominator: rows that can CONFLICT, not all rows sampled.
  //
  // Dividing 2 conflicts by 300 sampled rows when only 7 of them name a father
  // at all makes the threshold a function of the population's father-bearing
  // rate rather than of the qualifier. At 7 named the largest attainable rate is
  // 0.023 against a 0.02 threshold, so the check could only fail if 6 of the 7
  // conflicted; below ~6 named it cannot fail at all.
  const rareNamed = rare?.names.length ?? 0;
  const conflictRateAmongNamed = rareNamed > 0 ? rareConflicts.length / rareNamed : NaN;
  const dropContradicting =
    Number.isFinite(conflictRateAmongNamed) && conflictRateAmongNamed < 0.2;
  // RECORDED, not just printed. Every verdict in this section lived only in
  // stdout, including `requires presence`, which is the measurement the ten
  // shipped relative-`*Exact` tool descriptions rest on. Nothing pinned it.
  record("F", "conflictRate", Number.isFinite(conflictRate) ? +conflictRate.toFixed(4) : null);
  record("F", "rareRowNamedFathers", rareNamed);
  record(
    "F",
    "conflictRateAmongNamed",
    Number.isFinite(conflictRateAmongNamed) ? +conflictRateAmongNamed.toFixed(4) : null
  );
  record(
    "F",
    "conflictRateIsUpperBound",
    "YES — ACCEPTED_FORMS is a hand-curated list, so an unlisted transcription variant scores as a conflicting father. `Zacharish` is one such in this run. The list is deliberately NOT extended after seeing the data; the rate is therefore a ceiling, not an estimate."
  );
  record(
    "F",
    "verdict:drop-contradicting",
    Number.isFinite(conflictRate)
      ? dropContradicting
        ? "CONFIRMED (SAMPLED — 300 rows of a pool far too large to enumerate; section R enumerates the same question)"
        : "NOT CONFIRMED (SAMPLED)"
      : "NOT MEASURED"
  );

  const abbrevLost =
    anchored !== undefined &&
    exact !== undefined &&
    anchored.names.some((n) => /^Wm\.?$/.test(n)) &&
    !exact.names.some((n) => /^Wm\.?$/.test(n));

  console.log("");
  console.log(
    `  keep-silent          ${keepSilent ? "CONFIRMED" : "NOT CONFIRMED"} — ` +
      (totalHeld === null
        ? "NOT MEASURED — a total needed for this comparison was unavailable"
        : `an unmatchable father name still returned ${fmt(gibTotal)} of the baseline ${fmt(baseTotal)} ` +
          `(${((gibTotal! / baseTotal!) * 100).toFixed(1)}%), and ${silent} of ${gibberish?.sampled ?? 0} ` +
          `sampled hits carry no indexed parent at all. The anchored row's own head shows ` +
          `${anchored?.zeroParents ?? 0} of ${anchored?.sampled ?? 0} — that is rank filling with ` +
          `father-bearing records, NOT evidence of exclusion; see the note above`)
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
      // `sampled > 0` is load-bearing, not defensive. With `Math.max(sampled, 1)`
      // a row that sampled NOTHING scored 0/1 = 0, cleared the < 0.02 threshold,
      // and printed CONFIRMED — demonstrated live on 2026-08-08 by pointing the
      // gibberish variant at `recordCountry=Narnia`: the row returned an ERROR,
      // and this line still announced "left 0/0 records naming any father".
      // The sibling `drop-contradicting` verdict guards the same way (NaN when
      // sampled is 0), which is why it stayed honest on that run.
      gibberish !== undefined &&
      gibberish.sampled > 0 &&
      gibberish.names.length / gibberish.sampled < 0.02
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
    `  .exact drops abbrevs ${(() => {
      record(
        "F",
        "verdict:.exact drops indexed abbreviations",
        `${abbrevLost ? "CONFIRMED" : "NOT CONFIRMED"} (SAMPLED — 300 rows; the spec's Wm/Wm. figure comes from here and nothing pinned it until now)`
      );
      return abbrevLost ? "CONFIRMED" : "NOT CONFIRMED";
    })()} — ` +
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
  // --- How many records name a father AT ALL, across populations -----------
  //
  // Not answerable from the sampled columns above: the father-bearing rate in
  // this population swings 80/92/90/14/0/80/80 percent across offsets 0..5000,
  // so any one window misleads. Derive it from TOTALS instead. The gibberish
  // term drops only records that CONTRADICT it, and every real father name
  // contradicts `Xqzzyrbl`, so `baseline - gibberish` is the father-bearing
  // count and no sampling window can distort it.
  //
  // Six populations because the answer is not one number. Quoting this
  // section's own 3.2% as a general fact was wrong before this block existed.
  console.log("\n  father-bearing share by population (totals only, no sampling):");
  const POPS: Array<[string, string]> = [
    ["Martin/John US b.1840-60", base],
    ["Martin, Gloucs b.1810-14", "q.surname=Martin&q.birthLikePlace=Gloucestershire,%20England&q.birthLikeDate.from=1810&q.birthLikeDate.to=1814"],
    ["Martin, marriage 1850-60", "q.surname=Martin&q.marriageLikeDate.from=1850&q.marriageLikeDate.to=1860"],
    ["Martin, residence 1880", "q.surname=Martin&q.residenceDate.from=1880&q.residenceDate.to=1880"],
    ["Smith, England", "q.surname=Smith&q.recordCountry=England"],
    ["Gallo, Italy", "q.surname=Gallo&q.recordCountry=Italy"],
  ];
  const shares: number[] = [];
  for (const [label, popBase] of POPS) {
    const b = (await search(`${popBase}&count=1&${REQUIRE_SWITCH}`)).total;
    const g = (await search(`${popBase}&q.fatherGivenName=Xqzzyrbl&count=1&${REQUIRE_SWITCH}`)).total;
    const share = usableTotal(b) && measuredTotal(g) ? (b - g) / b : null;
    if (share !== null) shares.push(share);
    record("F", `pop:${label}`, { baseline: b, gibberish: g, fatherBearingPct: share === null ? null : +(share * 100).toFixed(1) });
    console.log(
      `    ${label.padEnd(26)} ${fmt(b)} -> ${fmt(g)}   father-bearing ${share === null ? "?" : (share * 100).toFixed(1) + "%"}`
    );
  }
  if (shares.length >= 2) {
    const lo = Math.min(...shares) * 100;
    const hi = Math.max(...shares) * 100;
    record("F", "popShareLoPct", +lo.toFixed(1));
    record("F", "popShareHiPct", +hi.toFixed(1));
    record("F", "popCount", shares.length);
    console.log(
      `\n  father-bearing is a  ${hi < 50 ? "MINORITY EVERYWHERE" : "NOT A MINORITY EVERYWHERE"} — the share ranges ` +
        `${lo.toFixed(1)}% to ${hi.toFixed(1)}% across ${shares.length} populations. ` +
        (hi < 50
          ? "Records naming a father are a minority in every population measured, but the share varies by an order of magnitude, so do NOT quote any single population's figure as a general fact."
          : "At least one population is majority father-bearing — the 'most records name no father' framing does not hold generally.")
    );
  }

}

// --- SECTION G — recordCountry is already strict -------------------------

async function sectionG(): Promise<void> {
  console.log("\n=== G. Are recordCountry and recordSubdivision strict? ===");
  // The heading used to assert this for `recordSubcountry` as well, while the
  // loop below only ever sent `recordCountry` — so the second half of the claim
  // rested on nothing, and the docs restated it. Both are now measured.
  //
  // SCOPE, deliberately narrow: this asks only whether a nonsense value is
  // REJECTED or IGNORED. It does not ask whether a state-level scope rescues a
  // wrong-county search — that is the place-EXPANSION comparison issue #1072
  // assigns to its owner, and nothing here touches it.
  const totals: Record<string, number | null> = {};
  for (const country of ["United%20States", "Narnia"]) {
    const r = await search(`q.surname=Martin&q.recordCountry=${country}&count=3&${REQUIRE_SWITCH}`);
    const key = decodeURIComponent(country).replace(/\s+/g, "");
    totals[key] = measuredTotal(r.total) ? r.total : null;
    record("G", key, totals[key]);
    console.log(`  recordCountry=${decodeURIComponent(country).padEnd(24)}${fmt(r.total)}`);
  }

  // Same question one level down. The tool composes `recordSubdivision` into
  // `q.recordSubcountry=<country>,<subdivision>`, so the raw form is built the
  // same way here.
  const US = "United States";
  for (const [label, sub] of [
    ["real (Alabama)", "Alabama"],
    ["nonsense (Xanadu)", "Xanadu"],
  ] as Array<[string, string]>) {
    const q =
      `q.surname=Martin&q.recordCountry=${encodeURIComponent(US)}` +
      `&q.recordSubcountry=${encodeURIComponent(`${US},${sub}`)}`;
    const r = await search(`${q}&count=3&${REQUIRE_SWITCH}`);
    const key = `subdivision:${sub}`;
    totals[key] = measuredTotal(r.total) ? r.total : null;
    record("G", key, totals[key]);
    console.log(`  recordSubdivision=${label.padEnd(22)}${fmt(r.total)}`);
  }

  const usTotal = totals.UnitedStates ?? null;
  const narnia = totals.Narnia ?? null;
  const alabama = totals["subdivision:Alabama"] ?? null;
  const xanadu = totals["subdivision:Xanadu"] ?? null;
  const countryStrict = narnia === 0;
  record(
    "G",
    "verdict:recordCountry is strict",
    narnia === null ? "NOT MEASURED" : countryStrict ? "STRICT" : "NOT STRICT — a nonexistent country still returned results"
  );
  // Three outcomes, not two: a nonsense subdivision could be rejected (0),
  // ignored (falls back to the country total), or something else — and only the
  // first justifies the word "strict".
  const subVerdict =
    xanadu === null || usTotal === null
      ? "NOT MEASURED"
      : xanadu === 0
        ? "STRICT — a nonexistent subdivision returns 0"
        : usTotal > 0 && Math.abs(xanadu - usTotal) <= usTotal * 0.01
          ? "IGNORED — a nonexistent subdivision falls back to the country total"
          : "NEITHER — a nonexistent subdivision returned a partial set; investigate before documenting";
  record("G", "verdict:recordSubdivision is strict", subVerdict);
  console.log(
    `  -> recordCountry:     ${narnia === null ? "NOT MEASURED" : countryStrict ? "STRICT" : "NOT STRICT"}\n` +
      `  -> recordSubdivision: ${subVerdict}` +
      `${alabama === null || usTotal === null ? "" : `  (a real subdivision returned ${fmt(alabama)} of ${fmt(usTotal)})`}`
  );
  console.log("  -> no .exact flag exists for either, and on this evidence none is needed.");
}

// --- SECTION H — the <event>Year family ----------------------------------

/**
 * SECTION H — what a year range actually does, and what `.exact=on` does to it.
 *
 * Three questions, one query pair. The range is a SINGLE year (1850-1850) so
 * that "outside the range" needs no judgement call: any parsed year that is not
 * 1850 was returned by a bound the caller did not ask for.
 *
 *   1. Does an unqualified range fuzz around its bounds? -> are there sampled
 *      records whose indexed birth year is outside 1850 at all?
 *   2. Does `.exact=on` harden it? -> does that out-of-range population go to
 *      zero, and does the total narrow?
 *   3. What happens to records carrying NO indexed year? This is the claim the
 *      branch deleted from place-date-mechanics.md ("Records with no indexed
 *      year are excluded") with no evidence in either direction. A record that
 *      is silent about the year cannot contradict the range, so section F's
 *      logic predicts it is KEPT; the deleted sentence predicts it is dropped.
 *      They cannot both be right, and the no-year column settles it.
 *
 * Scope, stated because it is narrower than the docs' language: this measures
 * the BIRTH family (`q.birthLikeDate`). The tool emits the same
 * `.from`/`.to`/`.exact` triple for death, marriage, residence and any-event
 * (EVENT_GROUPS in src/tools/record-search.ts), so the shape is expected to
 * carry, but only birth is measured here. Do not write "the <event>Year family
 * was measured" on the strength of this section alone.
 */
async function sectionH(): Promise<void> {
  console.log("  [RULE 0] H's sampled rows are RULE 0 non-compliant; the .exact/year-silent question is re-done enumerably in section N.");
  console.log(
    "\n=== H. <event>Year: does a range fuzz, does .exact harden it, and what about records with no year? ==="
  );
  const FROM = 1850;
  const TO = 1850;

  // TWO populations, because one query cannot answer all three questions.
  // Questions 1-2 need records that HAVE indexed birth years (otherwise there
  // is nothing to be in or out of range); question 3 needs records that DON'T
  // (otherwise a zero is unreadable — it could mean the range dropped them, or
  // that there were none to drop).
  //
  // The second row is a RESIDENCE-anchored population — census-shaped records,
  // where the person is indexed by where they lived and often carries no birth
  // fact at all. Measured 2026-08-08: 86/100 hold no birth-like year anywhere.
  // An England surname sweep was tried first and rejected: it looks year-less
  // if you read `display.birthDate` (84/100 blank) but every one of those
  // personas carries a dated Birth/Christening fact, so it answers nothing.
  const POPULATIONS: Array<{ id: string; base: string }> = [
    { id: "US Martin/John", base: "q.surname=Martin&q.givenName=John&q.recordCountry=United%20States" },
    { id: "US Martin residence-1880", base: "q.surname=Martin&q.residenceDate.from=1880&q.residenceDate.to=1880" },
  ];

  interface YearRow {
    total: number | null;
    sampled: number;
    inRange: number;
    /** Genuinely outside: no birth-like fact of ANY kind falls in the range. */
    outYears: number[];
    /** Personas with NO birth-like fact at all whose display year is out of
     *  range. A record with an in-range christening or baptism is already
     *  counted `inRange` by the branch above, so this bucket is NOT that case
     *  — the JSDoc used to say it was. These are excluded from `outYears`,
     *  which makes the "outside" figure a LOWER BOUND: any genuine fuzz hiding
     *  in a persona with no facts is invisible to it. Do not quote the outside
     *  count as exhaustive. */
    explained: number;
    /** Of `outYears`, how many carried only approximate ("about 1848") dates. */
    approximate: number;
    noYear: number;
  }
  const BASELINE = "baseline (no date filter)";
  const RANGE = `birth ${FROM}-${TO}, unqualified`;
  const EXACT = `birth ${FROM}-${TO} + .exact=on`;

  const byPopulation = new Map<string, Map<string, YearRow>>();
  for (const pop of POPULATIONS) {
    const range = `&q.birthLikeDate.from=${FROM}&q.birthLikeDate.to=${TO}`;
    const variants: Array<[string, string]> = [
      [BASELINE, ""],
      [RANGE, range],
      [EXACT, `${range}&q.birthLikeDate.exact=on`],
    ];
    const rows = new Map<string, YearRow>();
    console.log(`\n  -- ${pop.id}`);
    for (const [label, extra] of variants) {
      let total: number | null = null;
      let sampled = 0;
      let inRange = 0;
      let noYear = 0;
      let rowFailed = false;
      let explained = 0;
      let approximate = 0;
      const outYears: number[] = [];
      for (const offset of [0, 100, 200]) {
        const r = await search(`${pop.base}${extra}&count=100&offset=${offset}&${REQUIRE_SWITCH}`);
        // Last pager in the file without a guard. A truncated sample here would
        // empty outYears and print ".exact hardens it CONFIRMED" from nothing.
        if (errored(r)) { rowFailed = true; break; }
        if (total === null) total = r.total;
        sampled += r.personas.length;
        for (const p of r.personas) {
          // Score on the whole birth-like family, falling back to the display
          // field only when the persona carries no birth-like fact at all.
          const years = p.birthLike
            .map((f) => f.year)
            .filter((y): y is number => y !== null);
          const displayYear = yearOf(p.matchedBirthDate);
          if (!years.length && displayYear === null) {
            noYear++;
          } else if (years.some((y) => y >= FROM && y <= TO)) {
            inRange++;
          } else if (displayYear !== null && displayYear >= FROM && displayYear <= TO) {
            inRange++;
          } else if (years.length) {
            // Out on every birth-like fact it has -> genuinely outside.
            const y = years[0] as number;
            outYears.push(y);
            if (p.birthLike.every((f) => f.approximate)) approximate++;
          } else if (displayYear !== null) {
            // No facts at all, display year out of range: report as explained-
            // unknown rather than claiming fuzz on a field we know is partial.
            explained++;
          }
        }
      }
      if (rowFailed) {
        console.log(`     ${label.padEnd(30)} NOT MEASURED — an API error truncated this row`);
        continue;
      }
      rows.set(label, { total, sampled, inRange, outYears, explained, approximate, noYear });
      console.log(
        `     ${label.padEnd(30)} total=${fmt(total)}  sampled=${String(sampled).padStart(3)}` +
          `  in-range=${String(inRange).padStart(3)}  outside=${String(outYears.length).padStart(3)}` +
          `  (approx ${String(approximate).padStart(3)})  display-only=${String(explained).padStart(2)}` +
          `  no-year=${String(noYear).padStart(3)}  ${tally(outYears.map(String))}`
      );
    }
    byPopulation.set(pop.id, rows);
  }

  // --- Verdict, derived from the rows above --------------------------------
  // Each question is answered by whichever population can answer it, and the
  // verdict line names that population so the number is traceable to its row.
  const scored = [...byPopulation.entries()].map(([id, rows]) => ({
    id,
    rows,
    withYear: (rows.get(BASELINE)?.sampled ?? 0) - (rows.get(BASELINE)?.noYear ?? 0),
    noYear: rows.get(BASELINE)?.noYear ?? 0,
  }));
  const rich = [...scored].sort((a, b) => b.withYear - a.withYear)[0];
  const poor = [...scored].sort((a, b) => b.noYear - a.noYear)[0];

  const un = rich?.rows.get(RANGE);
  const ex = rich?.rows.get(EXACT);
  const usable = un !== undefined && ex !== undefined && un.sampled > 0 && ex.sampled > 0;

  console.log("");
  if (!usable || rich === undefined) {
    console.log(
      "  NOT MEASURED — the year-bearing population sampled 0 records (auth, rate limit, or an" +
        " empty result set). Verdicts are withheld rather than computed from nothing."
    );
    return;
  }

  record("H", "population", rich.id);
  record("H", "unqualifiedOutOfRange", un.outYears.length);
  record("H", "unqualifiedSampled", un.sampled);
  record("H", "unqualifiedApproximate", un.approximate);
  record("H", "exactOutOfRange", ex.outYears.length);
  record("H", "exactSampled", ex.sampled);
  record("H", "unqualifiedTotal", un.total);
  record("H", "exactTotal", ex.total);
  const fuzzes = un.outYears.length > 0;
  const hardens = un.outYears.length > 0 && ex.outYears.length === 0;
  const narrows = usableTotal(un.total) && measuredTotal(ex.total) && ex.total < un.total;
  // RECORDED because shipped prose cites them. `place-date-mechanics.md` states
  // "The fuzz is real" from `fuzzes`, and nothing in the artifact pinned it —
  // the guard could not check a sentence whose evidence lived only in stdout.
  // Both are SAMPLED (300 rows of a multi-hundred-thousand pool), so they are
  // labelled as such; section N re-does the same questions by enumeration.
  record(
    "H",
    "verdict:an unqualified range fuzzes past its bounds",
    `${fuzzes ? "CONFIRMED" : "NOT CONFIRMED"} (SAMPLED — ${un.outYears.length}/${un.sampled} rows of a ${fmt(un.total).trim()}-record pool; section N enumerates this and records WEAK)`
  );
  record(
    "H",
    "verdict:.exact hardens the range",
    `${hardens ? "CONFIRMED" : "NOT CONFIRMED"} (SAMPLED — an ABSENCE inside ${ex.sampled} rows of a ${fmt(ex.total).trim()}-record pool, which RULE 0 does not accept as evidence; section N enumerates and finds an out-of-range row SURVIVING .exact)`
  );
  console.log(
    `  range fuzzes         ${fuzzes ? "CONFIRMED" : "NOT CONFIRMED"} [${rich.id}] — unqualified ` +
      `${FROM}-${TO} returned ${un.outYears.length}/${un.sampled} sampled records dated outside it` +
      `${un.outYears.length ? ` (${tally(un.outYears.map(String))})` : ""}`
  );
  console.log(
    `  .exact hardens it    ${hardens ? "CONFIRMED" : "NOT CONFIRMED"} [${rich.id}] — with .exact=on ` +
      `the out-of-range population is ${ex.outYears.length}/${ex.sampled}` +
      `${ex.outYears.length ? ` (${tally(ex.outYears.map(String))})` : ""}`
  );
  console.log(
    `  .exact narrows count ${narrows ? "CONFIRMED" : "NOT CONFIRMED"} [${rich.id}] — ${fmt(un.total)} -> ${fmt(ex.total)}`
  );

  // --- WHAT does `.exact` actually drop? ------------------------------------
  //
  // The 99.1% -> 24.2% retention gap below shows `.exact` removes most of a
  // population, and the docs attributed that to year-SILENT records. That was
  // an inference, not a measurement, and it is not safe: a 300-row sample of an
  // unqualified 1850-1850 range held one record dated "about 1850" — in range —
  // and the same range with `.exact=on` held none, so `.exact` also drops
  // APPROXIMATE date forms whose year is in range. At least two populations are
  // inside that gap and this block says which, by membership rather than
  // arithmetic: page an exact result set small enough to read in full, then ask
  // whether specific records of each class are in it.
  const attribution = async (): Promise<void> => {
    console.log("\n  what .exact drops — membership, not inference:");
    const CANDIDATES = [
      "q.surname=Martin&q.givenName=John&q.birthLikePlace=Gloucestershire,%20England",
      "q.surname=Purnell&q.birthLikePlace=Wiltshire,%20England",
      "q.surname=Smith&q.birthLikePlace=Trowbridge,%20Wiltshire,%20England",
      "q.surname=Martin&q.givenName=John&q.birthLikePlace=Kent,%20England",
    ];
    const RANGE = `&q.birthLikeDate.from=${FROM}&q.birthLikeDate.to=${TO}`;
    const PAGEABLE = 300;
    let chosen: string | null = null;
    let exactTotal: number | null = null;
    for (const c of CANDIDATES) {
      const t = (await search(`${c}${RANGE}&q.birthLikeDate.exact=on&count=1&${REQUIRE_SWITCH}`)).total;
      if (t !== null && t > 0 && t <= PAGEABLE) { chosen = c; exactTotal = t; break; }
    }
    if (chosen === null) {
      console.log(
        `    NOT MEASURABLE — no candidate population had an exact result set of 1..${PAGEABLE},` +
          ` so none could be read in full. Without that the question needs a sample, and a sample` +
          ` cannot tell "dropped" from "ranked below where I looked".`
      );
      return;
    }
    // Read the ENTIRE exact set, so absence from it is absence, not depth.
    const exactIds = new Set<string>();
    for (let off = 0; off < PAGEABLE; off += 100) {
      const pg = await search(`${chosen}${RANGE}&q.birthLikeDate.exact=on&count=100&offset=${off}&${REQUIRE_SWITCH}`);
      if (errored(pg)) {
        console.log(
          "    NOT MEASURED — an API error interrupted the read of the exact set. Membership answers below" +
            " would report 'DROPPED' for records we simply never read."
        );
        return;
      }
      pg.personas.forEach((x) => exactIds.add(x.id));
      if (pg.personas.length < 100) break;
    }
    // Classify the unqualified set and pick one representative of each class.
    const rep: Record<string, { id: string; why: string } | null> = {
      "year-silent": null, "in-range approximate": null, "in-range precise": null,
    };
    for (const off of [0, 100, 200]) {
      const pg = await search(`${chosen}${RANGE}&count=100&offset=${off}&${REQUIRE_SWITCH}`);
      if (errored(pg)) break; // fewer representatives, but no false answer
      for (const x of pg.personas) {
        const years = x.birthLike.map((f) => f.year).filter((y): y is number => y !== null);
        const display = yearOf(x.matchedBirthDate);
        if (!years.length && display === null) {
          rep["year-silent"] ??= { id: x.id, why: "no birth-like fact and no display year" };
        } else if (years.some((y) => y >= FROM && y <= TO)) {
          const approx = x.birthLike.some((f) => f.approximate && f.year !== null && f.year >= FROM && f.year <= TO);
          const key = approx ? "in-range approximate" : "in-range precise";
          rep[key] ??= { id: x.id, why: x.birthLike.map((f) => f.original).filter(Boolean).join(" | ") || "(no original)" };
        }
      }
      if (pg.personas.length < 100) break;
    }
    console.log(`    population: exact set = ${fmt(exactTotal)} record(s), read in full`);
    let anyUnknown = false;
    for (const [cls, r] of Object.entries(rep)) {
      if (!r) {
        console.log(`      ${cls.padEnd(21)} no representative found in the unqualified set — not tested`);
        anyUnknown = true;
        // Recorded as NOT MEASURED rather than omitted: a doc claim about this
        // class must not be able to pass merely because the artifact is silent.
        record("H", `verdict:${cls}`, "NOT MEASURED");
        continue;
      }
      const kept = exactIds.has(r.id);
      record("H", `verdict:${cls}`, kept ? "KEPT" : "DROPPED");
      console.log(`      ${cls.padEnd(21)} ${kept ? "KEPT" : "DROPPED"} by .exact  (${r.id}: ${r.why.slice(0, 60)})`);
    }
    console.log(
      `    -> the retention gap below therefore cannot be attributed to year-silence alone` +
        `${anyUnknown ? "; and at least one class had no representative, so this is a partial answer" : ""}.`
    );

    // The question this block used to chase — whether a payload-silent record is
    // genuinely index-silent — is NOT answerable by paging, and two attempts at it
    // here were wasted effort. On the disjoint-range query the pool never reaches a
    // short page: it re-serves records, returning thousands of rows for a few
    // hundred distinct personas, so neither the reported total nor a page count
    // bounds the set. It is answered instead by the IMPOSSIBLE-RANGE test below,
    // which needs one query and no paging at all.
  };
  await attribution();

  // Question 3 CANNOT be answered from the sampled columns, and the first three
  // drafts of this section got it wrong by trying. Adding a year range reranks:
  // records carrying a matching year are promoted, so the year-SILENT ones fall
  // below a 300-record window and the sample reads 0 — which looks exactly like
  // exclusion and is not. Measured 2026-08-08 on the residence-1880 population:
  // sampled no-year went 261/300 -> 0/300 while the TOTAL only fell 11.39M ->
  // 5.13M, i.e. tens of millions of silent records were plainly still in the
  // result set. Answer it from totals instead, with a range so wide that every
  // indexed year matches it: what remains is a pure "must this field exist?"
  // question, and no sampling window can distort it.
  //
  // METHOD TRAP: the API rejects a range of 500 years or more outright —
  // `Query date range for key (birthLikeDate) cannot be 500 years or longer!`
  // 1700-1950 is wide enough to cover any plausible birth year and legal.
  const WIDE_FROM = 1700;
  const WIDE_TO = 1950;
  const poorPop = POPULATIONS.find((x) => x.id === poor?.id)?.base ?? "";
  const poorBase = poor?.rows.get(BASELINE)?.total ?? null;
  const wideQ = `&q.birthLikeDate.from=${WIDE_FROM}&q.birthLikeDate.to=${WIDE_TO}`;
  const wide = poor === undefined ? null : (await search(`${poorPop}${wideQ}&count=1&${REQUIRE_SWITCH}`)).total;
  // The `.exact` control is the half this section shipped without, and its
  // absence made the verdict assert the untested case. A wide range answers
  // "does an UNQUALIFIED range require the field to exist"; only the same range
  // WITH `.exact=on` answers it for the qualified form, and the two differ.
  const wideExact =
    poor === undefined
      ? null
      : (await search(`${poorPop}${wideQ}&q.birthLikeDate.exact=on&count=1&${REQUIRE_SWITCH}`)).total;

  const haveYearless = poor !== undefined && (poor.rows.get(BASELINE)?.noYear ?? 0) > 0;
  if (poor === undefined || poorBase === null || wide === null || wideExact === null) {
    console.log(
      "  silence vs conflict  NOT MEASURED — a control query returned no total, so whether a year range " +
        "requires the field to exist is left unanswered rather than guessed from a sample."
    );
    return;
  }
  if (!haveYearless) {
    console.log(
      `  silence vs conflict  NOT MEASURABLE — the chosen population sampled ` +
        `${poor.rows.get(BASELINE)?.noYear ?? 0}/${poor.rows.get(BASELINE)?.sampled ?? 0} records with no indexed ` +
        `birth year, so there were none available for a range to drop. Retention figures below would be ` +
        `about something else entirely. Re-run against a population known to hold year-less records.`
    );
    return;
  }

  if (!usableTotal(wide) || !usableTotal(wideExact) || !usableTotal(poorBase)) {
    console.log(
      "  wide-range control   NOT MEASURED — a total was null, zero, or the Int32 saturation" +
        " sentinel (2147483647), so a retention ratio built from it would not be a measurement."
    );
    return;
  }
  const keptUnqualified = wide / poorBase;
  const keptExact = wideExact / poorBase;
  record("H", "widePopulation", poor.id);
  record("H", "wideBaseline", poorBase);
  record("H", "wideUnqualified", wide);
  record("H", "wideUnqualifiedPct", +(keptUnqualified * 100).toFixed(1));
  record("H", "wideExact", wideExact);
  record("H", "wideExactPct", +(keptExact * 100).toFixed(1));
  console.log(
    `  wide-range control   [${poor.id}] baseline ${fmt(poorBase)} -> ${WIDE_FROM}-${WIDE_TO} ${fmt(wide)} ` +
      `(${(keptUnqualified * 100).toFixed(1)}%) -> same range +.exact=on ${fmt(wideExact)} ` +
      `(${(keptExact * 100).toFixed(1)}%)`
  );
  console.log(
    `  .exact drops silence ${keptExact < keptUnqualified * 0.9 ? "CONFIRMED" : "NOT CONFIRMED"} — a range every ` +
      `indexed year satisfies still loses ${(100 - keptExact * 100).toFixed(1)}% of the population once ` +
      `\`.exact=on\` is added, and the membership block above shows a year-silent record DROPPED while an ` +
      `in-range precise one is KEPT. What the gap does NOT establish is that year-silence is the whole of ` +
      `it — the in-range APPROXIMATE class is reported by the membership block above, and where that reads ` +
      `NOT MEASURED nothing here licenses a claim about it either way. Say ".exact drops year-silent ` +
      `records"; do not say that is all it drops.`
  );
  // MUST come from `poor`, not `rich`. Dividing rich's RANGE total by poor's
  // BASELINE total mixes two different queries and prints a meaningless
  // percentage — the same cross-population slip this section already had once.
  const poorRange = poor.rows.get(RANGE)?.total ?? null;
  const narrowKept = poorRange !== null && poorBase ? poorRange / poorBase : null;

  // --- THE PARTITION TEST — what finally settles "silence tolerated" --------
  //
  // The paradox this section shipped with: a WIDE range retains ~99% of a
  // population whose sampled baseline is ~87% year-less, which reads as "an
  // unqualified range keeps year-silent records"; yet a NARROW range on the same
  // population retains far less than that silent share, which the same model
  // cannot produce. Two figures, no single explanation, so the verdict was left
  // OPEN — and was twice written up as settled anyway.
  //
  // Totals alone can decide it, without membership in an 11M-record pool. Cut
  // the wide range into DISJOINT buckets. A record carrying one indexed year
  // falls in exactly one bucket, so if silence is not tolerated the buckets sum
  // to about the wide total. If silence IS tolerated, every silent record
  // matches EVERY bucket, so k buckets count it k times and the sum overshoots
  // by (k-1)·S — which also measures S, the silent population, directly.
  //
  //   not tolerated : sum ~= wide
  //   tolerated     : sum ~= wide + (k-1)*S,  S = (sum - wide) / (k - 1)
  const BUCKETS: Array<[number, number]> = [
    [1700, 1749],
    [1750, 1799],
    [1800, 1849],
    [1850, 1899],
    [1900, 1950],
  ];
  let bucketSum = 0;
  const bucketTotals: number[] = [];
  let bucketsMeasured = true;
  for (const [f, t] of BUCKETS) {
    const r = await search(
      `${poorPop}&q.birthLikeDate.from=${f}&q.birthLikeDate.to=${t}&count=1&${REQUIRE_SWITCH}`
    );
    if (!measuredTotal(r.total)) {
      bucketsMeasured = false;
      break;
    }
    bucketTotals.push(r.total);
    bucketSum += r.total;
  }
  if (!bucketsMeasured) {
    record("H", "verdict:silence tolerated", "NOT MEASURED");
    console.log(
      "  silence tolerated    NOT MEASURED — a partition bucket returned no usable total."
    );
    return;
  }
  // --- Is the range matching a DIFFERENT person on the record? -------------
  //
  // The partition ratio is the clue: if each record carried one year it would be
  // ~1x, and if every record matched every bucket it would be ~5x. A value in
  // between says records span several buckets — which is what a census household
  // looks like when the filter is record-level rather than persona-level.
  //
  // Test it directly: sample the year-poor baseline and ask, of the personas
  // that carry no birth year of their own, how many sit on a record where some
  // OTHER person does. Those are exactly the records that earlier drafts counted
  // as "year-silent records kept by an unqualified range".
  let silentPersona = 0;
  let silentPersonaRecordHasYear = 0;
  let silentPersonaRecordAlsoSilent = 0;
  for (const offset of [0, 100, 200]) {
    const r = await search(`${poorPop}&count=100&offset=${offset}&${REQUIRE_SWITCH}`);
    if (errored(r)) break;
    for (const p of r.personas) {
      const ownYears = p.birthLike.map((f) => f.year).filter((y): y is number => y !== null);
      const ownDisplay = yearOf(p.matchedBirthDate);
      if (ownYears.length || ownDisplay !== null) continue;
      silentPersona++;
      if (p.recordBirthYears.length > 0) silentPersonaRecordHasYear++;
      else silentPersonaRecordAlsoSilent++;
    }
    if (r.personas.length < 100) break;
  }
  record("H", "silentPersonaSampled", silentPersona);
  record("H", "silentPersonaRecordHasYear", silentPersonaRecordHasYear);
  record("H", "silentPersonaRecordAlsoSilent", silentPersonaRecordAlsoSilent);
  const recordLevel =
    silentPersona > 0 ? silentPersonaRecordHasYear / silentPersona : null;
  // Recorded even though it came back refuted: the hypothesis that these records
  // match on some OTHER person's year is the obvious explanation for the
  // partition ratio, and the next reader should not have to re-test it.
  record(
    "H",
    "verdict:year-less personas sit on records carrying another person's year",
    recordLevel === null
      ? "NOT MEASURED"
      : recordLevel >= 0.8
        ? "YES"
        : recordLevel <= 0.2
          ? "NO — those records carry no birth year on any person"
          : "MIXED"
  );
  console.log(
    `\n  persona-silence vs record-silence [${poor.id}], sampled ${silentPersona} year-less personas:\n` +
      `                       record carries someone else's birth year : ${silentPersonaRecordHasYear}\n` +
      `                       record carries no birth year at all      : ${silentPersonaRecordAlsoSilent}`
  );

  // --- THE IMPOSSIBLE-RANGE TEST — S in one query, no paging ---------------
  //
  // Ask for a birth range nothing in this population can legitimately occupy.
  // Nobody in an 1880 US residence set was born in 1500. So every record that
  // still comes back is one the range did not bind on — which is the silent
  // population, counted directly rather than inferred, solved for, or paged to.
  //
  // This replaces two failed attempts at the same question by enumeration. The
  // pool could not be read in full: deep paging re-serves records, returning
  // thousands of rows for a few hundred distinct personas and never reaching a
  // short page, so neither the reported total nor a page count bounds it. A
  // count needs none of that.
  //
  // Two impossible ranges, not one: if silence is tolerated they must return
  // about the SAME number, because the same silent set matches both. Two
  // centuries apart agreeing is much harder to explain any other way.
  const IMPOSSIBLE: Array<[number, number]> = [
    [1500, 1501],
    [1600, 1601],
  ];
  const impossible: number[] = [];
  for (const [f, t] of IMPOSSIBLE) {
    const r = await search(
      `${poorPop}&q.birthLikeDate.from=${f}&q.birthLikeDate.to=${t}&count=1&${REQUIRE_SWITCH}`
    );
    if (measuredTotal(r.total)) impossible.push(r.total);
    console.log(`  impossible range ${f}-${t}: ${fmt(r.total)}`);
  }
  record("H", "impossibleRangeTotals", impossible);

  // And WHO comes back. If the tolerated set is the payload-silent set, one page
  // of an impossible range should be overwhelmingly records with no year in the
  // payload — which is what makes "payload-silent" and "index-silent" the same
  // population rather than two different ones.
  let impSampled = 0;
  let impSilent = 0;
  const impFirst = IMPOSSIBLE[0];
  if (impFirst) {
    const r = await search(
      `${poorPop}&q.birthLikeDate.from=${impFirst[0]}&q.birthLikeDate.to=${impFirst[1]}` +
        `&count=100&${REQUIRE_SWITCH}`
    );
    if (!errored(r)) {
      impSampled = r.personas.length;
      for (const p of r.personas) {
        const own = p.birthLike.map((f) => f.year).filter((y): y is number => y !== null);
        if (!own.length && yearOf(p.matchedBirthDate) === null) impSilent++;
      }
    }
  }
  const impSilentPct = impSampled > 0 ? (impSilent / impSampled) * 100 : null;
  record("H", "impossibleRangeSampled", impSampled);
  record("H", "impossibleRangePayloadSilent", impSilent);
  record(
    "H",
    "verdict:payload-silent is the tolerated population",
    impSilentPct === null
      ? "NOT MEASURED"
      : impSilentPct >= 90
        ? "YES — a range nothing can legitimately match returns payload-year-less records almost exclusively, so the tolerated set and the payload-silent set are the same population"
        : `NO — only ${impSilentPct.toFixed(0)}% of an impossible range's results are payload-year-less, so something else is also being kept`
  );
  console.log(
    `  of one page of the impossible range, ${impSilent}/${impSampled} carry no year in the payload` +
      `${impSilentPct === null ? "" : ` (${impSilentPct.toFixed(0)}%)`}`
  );

  // --- Is the "87% year-less" figure a RANKING artifact? -------------------
  //
  // It is a sample of the first 300 rows of a relevance-ranked 11M-record pool,
  // and it is being compared against a population TOTAL (the 99.1% retention).
  // Those are not comparable quantities. This file already documents the same
  // trap one section over: section F's sampled father-bearing rate swings
  // 80/92/90/14/0/80/80 across offsets 0..5000, with the standing instruction to
  // derive rates from totals. Sweep the offset and find out.
  const SWEEP = [0, 1000, 2000, 3000, 4000];
  const sweep: Array<{ offset: number; sampled: number; noYear: number }> = [];
  for (const offset of SWEEP) {
    const r = await search(`${poorPop}&count=100&offset=${offset}&${REQUIRE_SWITCH}`);
    if (errored(r)) continue;
    let n = 0;
    for (const p of r.personas) {
      const own = p.birthLike.map((f) => f.year).filter((y): y is number => y !== null);
      if (!own.length && yearOf(p.matchedBirthDate) === null) n++;
    }
    sweep.push({ offset, sampled: r.personas.length, noYear: n });
  }
  record("H", "yearlessByOffset", sweep);
  const pcts = sweep.filter((s) => s.sampled > 0).map((s) => (s.noYear / s.sampled) * 100);
  const spread = pcts.length ? Math.max(...pcts) - Math.min(...pcts) : null;
  record("H", "yearlessSpreadPct", spread === null ? null : +spread.toFixed(1));
  // Worded off what was actually seen. The sweep is 86/1/86/86/86 — four offsets
  // agree and one does not, which is an 85-point spread but NOT a smooth swing,
  // and calling it one would be the same overstatement this section exists to
  // remove. The load-bearing objection to the sample is coverage, not variance:
  // 5 x 100 rows out of ~11.4M is 0.004% of the pool, so it cannot describe the
  // population however stable it looks.
  const sweepCoveragePct = poorBase ? (sweep.length * 100 * 100) / poorBase : null;
  record("H", "sweepCoveragePctOfPool", sweepCoveragePct === null ? null : +sweepCoveragePct.toFixed(4));
  record(
    "H",
    "verdict:the sampled year-less share describes the population",
    spread === null
      ? "NOT MEASURED"
      : "NO — the sampled window is a vanishing fraction of the pool" +
        (spread >= 30 ? ", and it is not even stable across offsets" : "")
  );
  console.log(
    `  year-less share by offset [${poor.id}]: ` +
      sweep.map((s) => `${s.offset}:${((s.noYear / s.sampled) * 100).toFixed(0)}%`).join("  ") +
      `   (spread ${spread === null ? "?" : spread.toFixed(0)} points)`
  );

  const k = BUCKETS.length;
  const ratio = bucketSum / wide;

  // --- Does multi-year-per-record explain the partition ratio? -------------
  //
  // A record matches a bucket for EVERY birth year it carries, so a household
  // spanning two generations is counted twice across disjoint buckets. If the
  // average number of distinct buckets a record spans is ~= the partition ratio,
  // the overshoot is fully explained by that and needs no "silence" hypothesis.
  const bucketOf = (y: number): number =>
    BUCKETS.findIndex(([f, t]) => y >= f && y <= t);
  let spanRecords = 0;
  let spanSum = 0;
  for (const offset of [0, 100, 200]) {
    const r = await search(`${poorPop}${wideQ}&count=100&offset=${offset}&${REQUIRE_SWITCH}`);
    if (errored(r)) break;
    for (const p of r.personas) {
      const buckets = new Set(
        p.recordBirthYears.map(bucketOf).filter((b) => b >= 0)
      );
      if (buckets.size === 0) continue; // carries no year in the partitioned span
      spanRecords++;
      spanSum += buckets.size;
    }
    if (r.personas.length < 100) break;
  }
  const meanSpan = spanRecords > 0 ? spanSum / spanRecords : null;
  record("H", "meanBucketsSpannedPerRecord", meanSpan === null ? null : +meanSpan.toFixed(2));
  record("H", "partitionRecordsSampled", spanRecords);
  console.log(
    `  mean distinct buckets spanned per record (wide-range sample): ` +
      `${meanSpan === null ? "NOT MEASURED" : meanSpan.toFixed(2)}` +
      ` over ${spanRecords} records`
  );
  const impliedSilent = Math.round((bucketSum - wide) / (k - 1));
  record("H", "partitionBuckets", bucketTotals);
  record("H", "partitionSum", bucketSum);
  record("H", "partitionRatioToWide", +ratio.toFixed(3));
  record("H", "partitionImpliedSilent", impliedSilent);
  record("H", "narrowKeptPct", narrowKept === null ? null : +(narrowKept * 100).toFixed(1));
  // The verdict weighs three independent signals, not the ratio alone. The
  // ratio by itself is ambiguous (1.94x is neither ~1x nor ~5x), and reading it
  // alone is what left this OPEN before:
  //
  //   (a) the partition overshoot is explained by records spanning several
  //       buckets — if `meanSpan` ~= `ratio`, no silent population is needed;
  //   (b) if silence were tolerated, EVERY bucket would be at least S, so the
  //       smallest bucket is a hard ceiling on how many silent records exist;
  //   (c) the sampled year-less share is only usable if it is stable by offset.
  const minBucket = Math.min(...bucketTotals);
  // A silent record appears in EVERY bucket, so the smallest bucket is a ceiling
  // on how many there can be. This is one of two independent estimates of S.
  const silentCeilingPct = (minBucket / wide) * 100;
  record("H", "smallestBucket", minBucket);
  record("H", "silentCeilingPctOfWide", +silentCeilingPct.toFixed(1));

  // Solve for S rather than eyeballing the ratio. With W = Y + S and
  // sum = m*Y + k*S (a year-bearing record spans m buckets, a silent one all k):
  //
  //     S = (sum - m*W) / (k - m)
  //
  // The first draft of this verdict compared `ratio` to ~1x and ~5x and, finding
  // 1.94x, concluded NOT TOLERATED — which is wrong twice over: with m = 1.78 the
  // no-silence prediction is 1.78x, not 1x, and the gap between 1.78 and 1.94 is
  // exactly what S accounts for. `meanSpan` is measured over year-bearing records
  // only (records spanning zero buckets are skipped), which is what this needs.
  const silentEstimate =
    meanSpan !== null && k > meanSpan ? (bucketSum - meanSpan * wide) / (k - meanSpan) : null;
  const silentPct = silentEstimate === null ? null : (silentEstimate / wide) * 100;
  record("H", "silentEstimate", silentEstimate === null ? null : Math.round(silentEstimate));
  record("H", "silentEstimatePctOfWide", silentPct === null ? null : +silentPct.toFixed(1));
  // THREE independent estimates of the same quantity, and agreement between
  // them is the check that the model holds at all:
  //   1. the partition algebra, S = (sum - m*W)/(k - m)
  //   2. the smallest bucket, a ceiling on any match-every-range population
  //   3. the impossible-range count, S measured directly in one query
  // Each is derived a different way; two agreeing could be luck, three is not.
  const impossibleMean =
    impossible.length > 0 ? impossible.reduce((a, b) => a + b, 0) / impossible.length : null;
  record("H", "impossibleRangeMean", impossibleMean === null ? null : Math.round(impossibleMean));
  const spreadOf = (xs: number[]): number =>
    xs.length < 2 ? 0 : (Math.max(...xs) - Math.min(...xs)) / Math.max(...xs);
  const allEstimates = [silentEstimate, minBucket, impossibleMean].filter(
    (n): n is number => n !== null
  );
  const estimatesAgree = allEstimates.length >= 2 && spreadOf(allEstimates) <= 0.25;
  record("H", "silentEstimatesAgree", estimatesAgree);
  record("H", "silentEstimateCount", allEstimates.length);
  console.log(
    `  three estimates of the silent population: partition ${fmt(silentEstimate === null ? null : Math.round(silentEstimate)).trim()},` +
      ` smallest bucket ${fmt(minBucket).trim()},` +
      ` impossible range ${fmt(impossibleMean === null ? null : Math.round(impossibleMean)).trim()}` +
      ` — spread ${(spreadOf(allEstimates) * 100).toFixed(1)}%, ${estimatesAgree ? "AGREE" : "DISAGREE"}`
  );
  // The verdict is GATED on the three estimates agreeing, and that gate is the
  // whole point. Without it this printed TOLERATED off the partition algebra
  // alone — and the impossible-range test then refuted the model that algebra
  // assumes. A number derived from a model nobody checked is not a measurement.
  //
  // What refutes it, concretely: if one fixed silent set matched EVERY range,
  // two impossible ranges a century apart would return the same count, and their
  // results would be the year-less records. Neither holds — the counts differ
  // materially, and a sampled page of an impossible range contains essentially
  // no payload-year-less records at all. Ordinary records with real indexed
  // years are being returned by a range they cannot occupy, and nothing here
  // explains why.
  const tolerated =
    silentPct === null || !estimatesAgree ? null : silentPct > 1 ? true : false;
  record(
    "H",
    "verdict:silence tolerated",
    tolerated === null
      ? "OPEN — the three independent estimates of the silent population disagree, and the impossible-range test refutes the match-every-range model they assume. Do not quote a share, and do not say an unqualified range keeps year-silent records."
      : tolerated
        ? "TOLERATED — but by a small minority of the population, not the sampled share"
        : "NOT TOLERATED"
  );
  console.log(
    `  smallest bucket is ${fmt(minBucket)} = ${silentCeilingPct.toFixed(1)}% of the wide range` +
      ` — a ceiling on any population matching EVERY range.\n` +
      `  solving the partition: S = (sum - m*W)/(k - m) = ${silentEstimate === null ? "?" : fmt(Math.round(silentEstimate))}` +
      ` (${silentPct === null ? "?" : silentPct.toFixed(1)}% of the wide range)` +
      ` — the two estimates ${estimatesAgree ? "AGREE" : "DISAGREE"}.`
  );
  console.log(
    `\n  partition test       [${poor.id}] ${k} disjoint buckets covering ${WIDE_FROM}-${WIDE_TO}:\n` +
      `                       ${bucketTotals.map((n) => fmt(n).trim()).join(" + ")}\n` +
      `                       = ${fmt(bucketSum)} vs the single wide range ${fmt(wide)}  (ratio ${ratio.toFixed(2)}x)`
  );
  if (tolerated === true) {
    console.log(
      `  silence tolerated    TOLERATED, but by a SMALL MINORITY — and both halves matter:\n` +
        `                       * an unqualified range DOES keep records with no indexed year:\n` +
        `                         ~${silentPct === null ? "?" : silentPct.toFixed(0)}% of this population matches every disjoint bucket,\n` +
        `                         including a 1700-1749 birth range in an 1880 residence set, which\n` +
        `                         is not a real 18th-century birth cohort;\n` +
        `                       * but it is NOWHERE NEAR the ${poor.rows.get(BASELINE)?.noYear ?? "?"}/${poor.rows.get(BASELINE)?.sampled ?? "?"} the offset-0 sample shows.\n` +
        `                         That sample covers ${sweepCoveragePct === null ? "?" : sweepCoveragePct.toFixed(3)}% of the pool and is not stable\n` +
        `                         across offsets (spread ${spread === null ? "?" : spread.toFixed(0)} points), so it never described the\n` +
        `                         population. Quote the ~${silentPct === null ? "?" : silentPct.toFixed(0)}%, never the sampled share.\n` +
        `                       Derived, not eyeballed: S = (sum - m*W)/(k - m) with m = ${meanSpan === null ? "?" : meanSpan.toFixed(2)},\n` +
        `                       cross-checked against the smallest bucket (${estimatesAgree ? "agrees" : "DISAGREES"}).`
    );
  } else if (tolerated === false) {
    console.log(
      `  silence tolerated    NOT TOLERATED — solving the partition puts the every-bucket population\n` +
        `                       at ${silentPct === null ? "?" : silentPct.toFixed(1)}% of the wide range, i.e. effectively none.`
    );
  } else {
    console.log(
      `  silence tolerated    OPEN — and NOT because the ratio is ambiguous. The partition\n` +
        `                       algebra gives a clean answer; the model behind it does not hold:\n` +
        `                       * two impossible ranges a century apart should return the SAME\n` +
        `                         count if one fixed silent set matched every range. They differ\n` +
        `                         materially (${impossible.map((n) => fmt(n).trim()).join(" vs ")}).\n` +
        `                       * a sampled page of an impossible range contains essentially no\n` +
        `                         payload-year-less records (${impSilent}/${impSampled}) — the records it returns\n` +
        `                         carry real indexed years and cannot occupy that range.\n` +
        `                       * the three independent estimates spread ${(spreadOf(allEstimates) * 100).toFixed(0)}%.\n` +
        `                       Something other than year-silence is being kept, and this run does\n` +
        `                       not identify it. Do not quote a share; do not say an unqualified\n` +
        `                       range keeps year-silent records.`
    );
  }
  // Consistency check on the narrow range, stated as arithmetic rather than as
  // an assertion about which verdict it favours — an earlier version of this
  // line said it was "consistent only if NOT TOLERATED", which stopped being
  // true the moment the verdict was derived properly.
  const narrowTotal = poor.rows.get(RANGE)?.total ?? null;
  const yearBearingInNarrow =
    narrowTotal !== null && silentEstimate !== null
      ? Math.round(narrowTotal - silentEstimate)
      : null;
  // Only meaningful if the silent estimate survived the agreement check. It used
  // to print "the figures reconcile" unconditionally, which read as corroboration
  // for a number the impossible-range test had just refuted.
  console.log(
    tolerated === null
      ? `                       (narrow ${FROM}-${TO} retained ${narrowKept === null ? "?" : (narrowKept * 100).toFixed(1)}% of baseline = ${fmt(narrowTotal).trim()}.\n` +
          `                       No silent-population figure is subtracted here, because none survived\n` +
          `                       the checks above.)`
      : `                       (narrow ${FROM}-${TO} retained ${narrowKept === null ? "?" : (narrowKept * 100).toFixed(1)}% of baseline = ${fmt(narrowTotal)};` +
          ` subtracting the ~${fmt(silentEstimate === null ? null : Math.round(silentEstimate))} silent\n` +
          `                       leaves ~${fmt(yearBearingInNarrow)} records actually carrying a ${FROM} year, which is a\n` +
          `                       plausible cohort for this population — the figures reconcile.)`
  );
}

// --- SECTION I — the initials exception ------------------------------------

/**
 * `search-strategy-levers.md` carries a standing exception to "do not set
 * `givenNameExact`": an initials search, where the initials ARE the indexed
 * form, so exactness is said to be what stops the fuzzy expansion swallowing
 * them. Nothing measured it, and it was briefly deleted from SKILL.md on that
 * basis — wrongly, since an unmeasured claim is a reason to measure.
 *
 * The claim makes two checkable predictions:
 *   1. a FUZZY `J W` search is dominated by spelled-out given names
 *      (`John William`), i.e. the expansion swallows the initials;
 *   2. the same search with `.exact=on` is dominated by initials-shaped names,
 *      i.e. exactness preserves them.
 * Both are about the SHAPE of the returned names, so both are answered by
 * classifying what actually comes back rather than by counting.
 */

/** The given-name portion of a display name: every token but the last. */
function givenPartOf(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, -1).join(" ");
}

/** `J W`, `J. W.`, `J` — every token a single letter, period optional. */
function isInitialsShaped(given: string): boolean {
  const parts = given.trim().split(/\s+/).filter(Boolean);
  return parts.length > 0 && parts.every((t) => /^[A-Za-z]\.?$/.test(t));
}

async function sectionI(): Promise<void> {
  console.log("\n=== I. Does .exact preserve an INITIALS search? (levers exception) ===");
  console.log(
    "  [RULE 0] Every figure below is a 100-row sample of pools of ~1,000,000 and" +
      " ~8,500. The transposition SHARE is therefore indicative only, and the" +
      " 'exact returns no transpositions' leg is a sampled ABSENCE, which this" +
      " file forbids as evidence. Section N re-does the reach question by" +
      " binding a record and enumerating a narrowed set."
  );
  // A US population, because initials are a US census/directory indexing habit;
  // the surname is held constant so the only variable is the given-name form.
  const base = "q.surname=Martin&q.recordCountry=United%20States";
  const INITIALS = "J%20W";
  const SAMPLE = 100;
  const rows: Array<[string, string, string]> = [
    ["J W, fuzzy", `${base}&q.givenName=${INITIALS}`, "fuzzy"],
    ["J W, .exact=on", `${base}&q.givenName=${INITIALS}&q.givenName.exact=on`, "exact"],
  ];
  /** `J. W.` -> `J W`, so order can be compared without punctuation noise. */
  const normalizeInitials = (given: string): string =>
    given.trim().toUpperCase().replace(/\./g, "").split(/\s+/).filter(Boolean).join(" ");
  const WANTED = "J W";
  const seen: Record<
    string,
    { total: number | null; sampled: number; initials: number; inOrder: number; transposed: number }
  > = {};
  for (const [label, q, key] of rows) {
    const r = await search(`${q}&count=${SAMPLE}&${REQUIRE_SWITCH}`);
    if (errored(r)) {
      console.log(`  ${label.padEnd(20)} NOT MEASURED — ${r.error}`);
      continue;
    }
    const givens = r.personas.map((p) => givenPartOf(p.matchedName)).filter(Boolean);
    const initials = givens.filter(isInitialsShaped).length;
    // The discriminator the first version of this section missed. Both rows come
    // back overwhelmingly initials-SHAPED, so "does fuzzy swallow initials into
    // spelled-out names" is answered NO and tells us nothing. What differs is
    // ORDER: the fuzzy row returns the transposition as well as the query.
    const norm = givens.filter(isInitialsShaped).map(normalizeInitials);
    const inOrder = norm.filter((g) => g === WANTED).length;
    const transposed = norm.filter(
      (g) => g === WANTED.split(" ").reverse().join(" ")
    ).length;
    seen[key] = { total: r.total, sampled: givens.length, initials, inOrder, transposed };
    record("I", key, {
      total: measuredTotal(r.total) ? r.total : null,
      sampled: givens.length,
      initialsShaped: initials,
      initialsPct: givens.length ? +((initials / givens.length) * 100).toFixed(1) : null,
      inQueriedOrder: inOrder,
      transposed,
      forms: tally(givens),
    });
    console.log(
      `  ${label.padEnd(20)}${fmt(r.total)}  sampled=${String(givens.length).padStart(3)}` +
        `  initials-shaped=${String(initials).padStart(3)}` +
        `  in-order=${String(inOrder).padStart(3)}  transposed=${String(transposed).padStart(3)}` +
        `  ${tally(givens)}`
    );
  }

  const fz = seen.fuzzy;
  const ex = seen.exact;
  if (!fz || !ex || fz.sampled === 0 || ex.sampled === 0) {
    record("I", "verdict:.exact preserves an initials search", "NOT MEASURED");
    console.log("  -> NOT MEASURED — a row returned no usable sample.");
    return;
  }
  const fzPct = (fz.initials / fz.sampled) * 100;
  const exPct = (ex.initials / ex.sampled) * 100;
  const fzOrderPct = (fz.inOrder / fz.sampled) * 100;
  const exOrderPct = (ex.inOrder / ex.sampled) * 100;
  const fzTransPct = (fz.transposed / fz.sampled) * 100;
  const exTransPct = (ex.transposed / ex.sampled) * 100;
  record("I", "fuzzyInitialsPct", +fzPct.toFixed(1));
  record("I", "exactInitialsPct", +exPct.toFixed(1));
  record("I", "fuzzyInOrderPct", +fzOrderPct.toFixed(1));
  record("I", "exactInOrderPct", +exOrderPct.toFixed(1));
  record("I", "fuzzyTransposedPct", +fzTransPct.toFixed(1));
  record("I", "exactTransposedPct", +exTransPct.toFixed(1));

  // TWO separate questions, and conflating them is what made the first version
  // of this section report NOT CONFIRMED against a real effect.
  //   (a) does fuzzy swallow initials into spelled-out names?  -> the SHAPE test
  //   (b) does fuzzy return the initials in the wrong ORDER?   -> the ORDER test
  const swallows = fzPct < 75;
  record(
    "I",
    "verdict:fuzzy swallows initials into spelled-out names",
    swallows ? "YES" : "NO — the fuzzy row is overwhelmingly initials-shaped too"
  );
  const pinsOrder = fzTransPct >= 10 && exTransPct <= 2;

  // The ORDER question, ENUMERATED. The percentages above are a 100-row window
  // onto an 8,483-row pool, and the claim that matters is an ABSENCE — that the
  // transposition is GONE from the exact set. RULE 0 does not accept an absence
  // inside a sample, and "SAMPLED ONLY" was a third verdict category that should
  // never have existed: it published a direction while conceding the evidence
  // did not support one, and three documents then quoted the direction and
  // dropped the concession.
  //
  // Section N already enumerates the fuzzy half (bind a "W J", narrow onto its
  // surname, read the pool to the end, find it). This does the same for the
  // exact half on the same pool, so both answers come from complete scans.
  // Scopes to try, in order, and the ORDER matters more than it looks.
  //
  // This first used England marriage 1850-54 — section N's population — and
  // enumerated twenty pools there, every one returning ZERO exact rows, then
  // reported NOT MEASURED. That was searching a population structurally unable
  // to answer: English marriage records do not index initials, so `.exact` on
  // `J W` correctly matches nothing and no pool can ever discriminate.
  //
  // The question only lives where initials ARE indexed — US census and
  // directory records, the same collections behind the 8,483-row exact pool
  // this section samples. Those go first; England stays last as a control, so a
  // run that still finds nothing says so against both.
  const SCOPES: Array<[string, string]> = [
    ["US census", "q.recordCountry=United States&f.recordType=3"],
    ["US any", "q.recordCountry=United States"],
    ["England marriage 1850-54",
     "q.recordCountry=England&f.recordType=1&q.marriageLikeDate.from=1850&q.marriageLikeDate.to=1854"],
  ];
  // Bind transposed records in whichever scope offers them.
  let bound: Hit = { total: null, personas: [], error: null };
  let scopeUsed = "";
  for (const [label, scope] of SCOPES) {
    const b = await search(
      `q.givenName=W%20J&q.givenName.exact=on&${scope}&count=100&${REQUIRE_SWITCH}`
    );
    if (!errored(b) && b.personas.length > 0) { bound = b; scopeUsed = scope; 
      console.log(`  order test: binding in ${label} (${fmt(b.total).trim()} transposed records)`);
      break; }
  }
  type OrderProbe = {
    surname: string; id: string; name: string;
    fuzzyRows: number; inFuzzy: boolean; exactRows: number; inExact: boolean;
  };
  let enumd: OrderProbe | null = null;
  let best: OrderProbe | null = null;
  let discriminating = false;
  let poolsTried = 0;
  /** Every enumerated pool, so the SHAPE of the failure is recorded too. */
  const attempts: OrderProbe[] = [];
  if (!errored(bound)) {
    for (const cand of bound.personas) {
      const sn = surnameToken(cand.matchedName);
      if (!sn) continue;
      const base = `q.surname=${encodeURIComponent(sn)}&q.givenName=J%20W&${scopeUsed}`;
      poolsTried++;
      const size = await search(`${base}&count=1&${REQUIRE_SWITCH}`);
      if (errored(size) || (size.total ?? 0) === 0 || (size.total ?? 0) > 1000) continue;
      const fzSet = await mustEnumerate(base, 1100);
      if (fzSet.personas === null) continue;
      const exSet = await mustEnumerate(`${base}&q.givenName.exact=on`, 1100);
      if (exSet.personas === null) continue;
      enumd = {
        surname: sn,
        id: cand.id,
        name: cand.matchedName,
        fuzzyRows: fzSet.personas.length,
        inFuzzy: fzSet.personas.some((x) => x.id === cand.id),
        exactRows: exSet.personas.length,
        inExact: exSet.personas.some((x) => x.id === cand.id),
      };
      // Keep the first pool that can DISCRIMINATE, not the first that merely
      // reaches. Two conditions, both required:
      //   inFuzzy      — fuzzy must reach the transposition, or there is
      //                  nothing for `.exact` to remove;
      //   exactRows>0  — the exact set must retain something, or "the
      //                  transposition is gone" cannot be told from "`.exact`
      //                  returned nothing at all".
      // Breaking on `inFuzzy` alone stopped at a 9 -> 0 pool and reported NOT
      // MEASURED, which reads as a limit of the API when it was a limit of this
      // loop. Weaker pools are kept only as a fallback for the report.
      attempts.push(enumd);
      if (enumd.inFuzzy && enumd.exactRows > 0) { discriminating = true; break; }
      if (!best || (enumd.inFuzzy && !best.inFuzzy)) best = enumd;
      enumd = null;
    }
  }
  if (!discriminating) enumd = best;
  record("I", "initialsOrderEnumerated", enumd);
  record("I", "initialsOrderPoolsTried", poolsTried);
  // WHY it could not be measured, which is more useful than the bare refusal.
  //
  // An empty exact set is a CORRECT answer, not a fault: `.exact` on `J W`
  // matches only a given name indexed literally as "J W". The bound record is
  // indexed "W J" so exactness rightly excludes it, and the rest of the pool
  // arrives through fuzzy from spelled-out forms ("John William") which it also
  // rightly excludes. Zero is what the qualifier is for.
  //
  // What that costs is the ORDER test, which needs a pool holding BOTH a record
  // indexed "J W" and one indexed "W J". None of the pools reachable this way
  // has one, so the question stays open for want of a population.
  // A DELIBERATE sweep of the spell-out scope, because the doc claim needs it.
  //
  // The loop above stops at the first pool that discriminates, which since the
  // scope reorder is a US census pool — so `attempts` no longer contains the
  // English-marriage evidence, and two documents were left citing "twenty pools
  // came back empty" against an artifact recording one pool that kept rows. The
  // claim is true and worth teaching (`.exact` on initials returns nothing where
  // the index spells names out), so it is measured here on purpose rather than
  // salvaged from whatever the search happened to touch.
  const SPELL_OUT = SCOPES[SCOPES.length - 1]?.[1] ?? "";
  let spellOutPools = 0;
  let spellOutEmpty = 0;
  const spellBind = await search(
    `q.givenName=W%20J&q.givenName.exact=on&${SPELL_OUT}&count=20&${REQUIRE_SWITCH}`
  );
  if (!errored(spellBind)) {
    for (const cand of spellBind.personas) {
      if (spellOutPools >= 8) break;
      const sn = surnameToken(cand.matchedName);
      if (!sn) continue;
      const b = `q.surname=${encodeURIComponent(sn)}&q.givenName=J%20W&${SPELL_OUT}`;
      const sz = await search(`${b}&count=1&${REQUIRE_SWITCH}`);
      if (errored(sz) || (sz.total ?? 0) === 0 || (sz.total ?? 0) > 1000) continue;
      const ex = await mustEnumerate(`${b}&q.givenName.exact=on`, 1100);
      if (ex.personas === null) continue;
      spellOutPools++;
      if (ex.personas.length === 0) spellOutEmpty++;
    }
  }
  record("I", "initialsExactInSpellOutScope", {
    scope: SPELL_OUT,
    poolsRead: spellOutPools,
    emptyExactSets: spellOutEmpty,
  });
  if (spellOutPools > 0) {
    record(
      "I",
      "verdict:.exact on initials where the index spells names out",
      spellOutEmpty === spellOutPools
        ? `RETURNS NOTHING — across ${spellOutPools} pool(s) read to the end in a collection that spells given names out, \`givenName.exact=on\` on a two-token initials value returned zero rows every time`
        : `${spellOutPools - spellOutEmpty} of ${spellOutPools} pool(s) kept rows, so it does not always empty`
    );
  }
  const emptyExact = attempts.filter((a) => a.exactRows === 0).length;
  record("I", "initialsExactEmptyPools", { enumeratedPools: attempts.length, emptyExactSets: emptyExact });
  if (attempts.length > 0) {
    record(
      "I",
      "verdict:.exact on an initials given name matches only the literal form",
      emptyExact === attempts.length
        ? `ONLY THE LITERAL FORM — across ${attempts.length} pool(s) read to the end, \`givenName.exact=on\` on a two-token initials value returned zero rows every time, because no record in them is indexed under those literal initials. That is the qualifier behaving correctly; the practical consequence is that setting it on an initials search returns nothing unless the index spells the name that same way.`
        : `${attempts.length - emptyExact} of ${attempts.length} enumerated pool(s) kept rows under .exact`
    );
  }
  const orderEnumerated =
    enumd !== null && enumd.inFuzzy && !enumd.inExact && enumd.exactRows > 0;
  record(
    "I",
    "verdict:.exact pins the initials ORDER",
    enumd === null
      ? "NOT MEASURED — no bound transposition sat in a pool small enough to read to the end"
      : !enumd.inFuzzy
        ? `NOT MEASURED — the fuzzy search did not reach the bound transposition in the enumerated pool (${enumd.surname}, ${enumd.fuzzyRows} rows read in full), so there was nothing for .exact to remove`
        : enumd.inExact
          ? `DOES NOT PIN THE ORDER — the transposed record is present in BOTH the fuzzy and the .exact set, each read to the end (${enumd.surname}, ${enumd.fuzzyRows} -> ${enumd.exactRows} rows)`
          : enumd.exactRows === 0
            ? // Absence from an EMPTY set is not evidence about order. `.exact`
              // returning nothing at all here is indistinguishable from it
              // removing the transposition specifically, and the first reading
              // would have this section certify the claim on a set that holds no
              // records of any kind.
              `NOT MEASURED — the .exact set is EMPTY (${enumd.surname}, ${enumd.fuzzyRows} -> 0 rows), so the transposition's absence cannot be told from .exact returning nothing at all`
            : `CONFIRMED (ENUMERATED) — the transposed record is in the fuzzy set and absent from the .exact set, both read to the end, and .exact kept ${enumd.exactRows} other row(s) so the absence is selective (${enumd.surname}, ${enumd.fuzzyRows} -> ${enumd.exactRows} rows)`
  );
  record(
    "I",
    "verdict:the levers initials exception",
    // The "different reason" was that exactness PINS THE ORDER — which the
    // enumerated test above declines to confirm. Deriving this from `pinsOrder`
    // (the sampled figure) would restate a claim the section just withheld, one
    // key away from the withholding.
    swallows
      ? "REAL AS STATED"
      : orderEnumerated
        ? "REAL, BUT FOR A DIFFERENT REASON THAN STATED — exactness pins the order, it does not stop a spelled-out expansion"
        : "NOT SUPPORTED AS STATED — fuzzy does not swallow initials into spelled-out names, so the stated reason is wrong; whether exactness pins the ORDER instead is NOT MEASURED (see the verdict above)"
  );
  console.log(
    `  -> initials-shaped: fuzzy ${fzPct.toFixed(0)}%, exact ${exPct.toFixed(0)}%` +
      ` — so fuzzy does NOT replace them with spelled-out names.\n` +
      `  -> queried order (${WANTED}): fuzzy ${fzOrderPct.toFixed(0)}%, exact ${exOrderPct.toFixed(0)}%;` +
      ` transposed: fuzzy ${fzTransPct.toFixed(0)}%, exact ${exTransPct.toFixed(0)}%.`
  );
  console.log(
    pinsOrder
      ? "  => the exception is REAL but its stated reason is WRONG. Exactness does not\n" +
          "     stop initials being swallowed by spelled-out names — that never happens.\n" +
          "     What it does is pin the ORDER: the fuzzy search also returns the\n" +
          "     transposition, and exactness removes it."
      : "  => not supported by this measurement."
  );
}

// --- SECTION T — does a name term FILTER on content, or only RANK? --------

/**
 * The question issue #1093 asks first — "filter, boost, or both?" — asked of
 * each name field separately, because the answer is not the same for all of
 * them and treating it as one answer is what produced every wrong model here.
 *
 * The method is a substitution test. Hold the query fixed and vary ONLY the
 * value in one name field: two different real names, and one unmatchable
 * string. Then:
 *
 *   * if the total moves with the value, the term FILTERS on content;
 *   * if the total barely moves but the top results still match the value, the
 *     term RANKS on content while filtering only on the field's presence.
 *
 * Why this supersedes section F's reading. F recorded `fatherGivenName=Zachariah`
 * at 441,217 and a gibberish father name at 441,206 — ELEVEN records apart — and
 * concluded "keep-matching / keep-silent / drop-contradicting". A real rare name
 * and pure nonsense returning the same total is the signature of ranking, not
 * filtering; the evidence was in the recorded figures and was read the other way.
 * Section A's own-name result (a few hundred collapsing to single digits on a
 * gibberish given name) is the contrast, and it is included here as a control so
 * the two behaviours are measured side by side rather than compared across
 * sections.
 */
async function sectionT(): Promise<void> {
  console.log("\n=== T. Do name terms filter on CONTENT, or only rank? (issue #1093 Q1) ===");
  const GIBBERISH = "Xqzzyrbl";
  // Two REAL names per population, both plausible there. A single real name
  // cannot separate "the value matters" from "this particular value is rare".
  const POPS: Array<{ id: string; base: string; real: [string, string] }> = [
    {
      id: "US marriage",
      base: "q.surname=Martin&q.recordCountry=United%20States&f.recordType=1",
      real: ["William", "Zachariah"],
    },
    {
      id: "Brazil marriage",
      base: "q.surname=Oliveira&q.recordCountry=Brazil&f.recordType=1",
      real: ["Anselmo", "Benedicto"],
    },
    {
      id: "England, Purnell",
      base: "q.surname=Purnell&q.recordCountry=England",
      real: ["William", "Ebenezer"],
    },
  ];
  // The searched person's own given name is the CONTROL: section A already
  // showed it collapses on an unmatchable value, so if this method is sound it
  // must reproduce that here, in the same run, on the same populations.
  const FIELDS: Array<{
    id: string;
    param: string;
    nameOf: (p: Persona) => string | null;
  }> = [
    { id: "own givenName", param: "givenName", nameOf: (p) => givenPartOf(p.matchedName) },
    { id: "fatherGivenName", param: "fatherGivenName", nameOf: (p) => p.fatherOfMatched },
    { id: "spouseGivenName", param: "spouseGivenName", nameOf: (p) => p.spouseOfMatched },
  ];

  const findings: Array<{
    pop: string;
    field: string;
    baseline: number | null;
    real1: number | null;
    real2: number | null;
    gibberish: number | null;
    fieldCostPct: number | null;
    contentSensitivityPct: number | null;
    contentSwingPct: number | null;
    topMatchPct: number | null;
  }> = [];

  for (const pop of POPS) {
    const b = await search(`${pop.base}&count=1&${REQUIRE_SWITCH}`);
    if (!usableTotal(b.total)) {
      console.log(`\n  -- ${pop.id}: NOT MEASURED (no usable baseline)`);
      continue;
    }
    const baseline = b.total;
    console.log(`\n  -- ${pop.id}  baseline ${fmt(baseline)}`);
    for (const field of FIELDS) {
      const totalFor = async (value: string): Promise<number | null> => {
        const r = await search(
          `${pop.base}&q.${field.param}=${encodeURIComponent(value)}&count=1&${REQUIRE_SWITCH}`
        );
        return measuredTotal(r.total) ? r.total : null;
      };
      const [n1, n2] = pop.real;
      const real1 = await totalFor(n1);
      const real2 = await totalFor(n2);
      const gib = await totalFor(GIBBERISH);

      // Does the supplied value actually reach the top of the result set? If the
      // term ranks, it must — otherwise it is doing nothing at all, which is a
      // third possibility this has to be able to report.
      let topMatchPct: number | null = null;
      const page = await search(
        `${pop.base}&q.${field.param}=${encodeURIComponent(n1)}&count=20&${REQUIRE_SWITCH}`
      );
      if (!errored(page) && page.personas.length > 0) {
        const hits = page.personas.filter((p) => {
          const nm = field.nameOf(p);
          return nm !== null && nm.toLowerCase().includes(n1.toLowerCase());
        }).length;
        topMatchPct = +((hits / page.personas.length) * 100).toFixed(0);
      }

      const fieldCostPct = gib === null ? null : +((gib / baseline) * 100).toFixed(1);
      // Content sensitivity, measured against the FIELD'S OWN pool rather than
      // the baseline — and the denominator is the whole measurement.
      //
      // Against the baseline every field looks "mixed", because a field whose
      // pool is 72% of baseline cannot swing more than a few percent OF THE
      // BASELINE no matter how completely the value controls it. Against its own
      // largest pool the behaviours separate cleanly: a value that filters moves
      // its pool by most of itself, a value that only ranks moves it by a few
      // percent. The first version of this section used the baseline and duly
      // reported all three fields as MIXED — an artifact of the denominator, not
      // a finding.
      const vals = [real1, real2, gib].filter((v): v is number => v !== null);
      const hi = vals.length ? Math.max(...vals) : 0;
      const contentSwingPct =
        vals.length < 2 || hi === 0
          ? null
          : +(((hi - Math.min(...vals)) / hi) * 100).toFixed(1);
      const contentSensitivityPct =
        vals.length < 2
          ? null
          : +(((Math.max(...vals) - Math.min(...vals)) / baseline) * 100).toFixed(2);

      findings.push({
        pop: pop.id,
        field: field.id,
        baseline,
        real1,
        real2,
        gibberish: gib,
        fieldCostPct,
        contentSensitivityPct,
        contentSwingPct,
        topMatchPct,
      });
      console.log(
        `     ${field.id.padEnd(16)} ${n1}:${fmt(real1).trim()}  ${n2}:${fmt(real2).trim()}` +
          `  gibberish:${fmt(gib).trim()}` +
          `   field-cost ${String(fieldCostPct).padStart(5)}%` +
          `  content-swing ${String(contentSwingPct).padStart(5)}%` +
          `  top-20 match ${String(topMatchPct).padStart(3)}%`
      );
    }
  }
  record("T", "findings", findings);

  // --- Verdict per FIELD, pooled across populations ------------------------
  for (const field of FIELDS) {
    const rows = findings.filter((f) => f.field === field.id && f.contentSwingPct !== null);
    if (rows.length === 0) {
      record("T", `verdict:${field.id}`, "NOT MEASURED");
      continue;
    }
    const swings = rows.map((r) => r.contentSwingPct as number);
    const maxSens = Math.max(...swings);
    const minSens = Math.min(...swings);
    const meanTop =
      rows.filter((r) => r.topMatchPct !== null).reduce((a, r) => a + (r.topMatchPct ?? 0), 0) /
      Math.max(1, rows.filter((r) => r.topMatchPct !== null).length);
    // Thresholds far apart on purpose: a content filter moves the total by tens
    // of percent, a ranker by a fraction of one. Anything between is a third
    // behaviour and must be reported as such rather than forced into either.
    // Thresholds on the within-field swing: a content filter moves its own pool
    // by most of itself; a ranker moves it by a few percent while still owning
    // the top of the list. The SPREAD across populations matters as much as the
    // maximum — a field that filters in one population and ranks in another is a
    // real result, not a middling one, and must not be averaged into "mixed".
    const verdict =
      minSens >= 50
        ? "FILTERS ON CONTENT in every population measured"
        : maxSens <= 10
          ? meanTop >= 50
            ? "RANKS ONLY — the value barely moves the total anywhere measured, yet dominates the top of the result set"
            : "NEITHER — the value moves neither the total nor the ranking; the term may be inert"
          : `POPULATION-DEPENDENT — swings from ${minSens}% to ${maxSens}% of its own pool, so it filters in some populations and only ranks in others`;
    // RULE 0: these swings are computed over multi-million-row pools that were
    // never enumerated. The father verdict read "RANKS ONLY" and was refuted by
    // enumerating a 521-row pool, where the term drops every contradicting
    // record. Record the measurement, withhold the interpretation.
    record(
      `T`,
      `verdict:${field.id}`,
      `NOT MEASURED HERE — computed over pools too large to enumerate (RULE 0). Observed swing ${minSens}-${maxSens}% of the field's own pool; see section R for the enumerated answer. Previous reading: ${verdict}`
    );
    record(`T`, `contentSwingPct:${field.id}`, { min: minSens, max: maxSens });
    record(`T`, `meanTop20MatchPct:${field.id}`, +meanTop.toFixed(0));
    console.log(
      `\n  ${field.id.padEnd(16)} -> WITHHELD under RULE 0 (pool not enumerable).` +
        ` Observed swing ${minSens}-${maxSens}%; previous reading was "${verdict.split(" —")[0]}".` +
        ` Section R has the enumerated answer.`
    );
  }

  // The comparison that matters for the docs: do the fields agree?
  // Every input here was just overwritten with "NOT MEASURED HERE …", so the
  // three strings differ only in their embedded swing numbers. Comparing them
  // with === therefore always reports a per-field DIVERGENCE whose evidence is
  // three identical "NOT" tokens. When the inputs decline to answer, so must this.
  const withheld = (s: string): boolean => s.startsWith("NOT MEASURED");
  const own = String(getFig("T", "verdict:own givenName"));
  const father = String(getFig("T", "verdict:fatherGivenName"));
  const spouse = String(getFig("T", "verdict:spouseGivenName"));
  record(
    "T",
    "verdict:all name fields behave alike",
    withheld(own) || withheld(father) || withheld(spouse)
      ? "NOT MEASURED — the per-field verdicts are withheld under RULE 0, so nothing here can compare them. Section R answers this by enumeration."
      : own === father && father === spouse
        ? "YES — one model covers every name field"
      : `NO — own="${own.split(" ")[0]}", father="${father.split(" ")[0]}", spouse="${spouse.split(" ")[0]}". A single keep/drop model cannot describe all three; the docs must state the behaviour PER FIELD.`
  );
  console.log(
    `\n  => name fields behave alike: ${
      withheld(own) || withheld(father) || withheld(spouse)
        ? "NOT MEASURED (per-field verdicts withheld under RULE 0; see section R)"
        : own === father && father === spouse
          ? "YES"
          : "NO — the docs must state this per field, not once"
    }`
  );
}

/** Read a value back out of the in-memory figures for cross-field verdicts. */
function getFig(section: string, key: string): unknown {
  return (figures[section] ?? {})[key];
}

// --- SECTION N — enumerable re-derivations of F, H, E and I ---------------

/**
 * The four sampled findings, redone so every count comes from a set read to the
 * end. Nothing here samples.
 *
 * Two of them (F's abbreviation drop, H's range fuzz) just needed a smaller
 * population. The other two did not, and the reason is worth stating because it
 * looks like a reason to give up on RULE 0: diminutives and initials are RARE,
 * so they do not occur in a pool small enough to enumerate — `Betty` and `J W`
 * both return 0 in every enumerable scope tried. Shrinking the population
 * removes the phenomenon.
 *
 * The way out is BIND-THEN-NARROW, which the header prescribes and which is not
 * the same as sampling: find a record that IS the thing (in whatever pool it
 * takes), keep its id, then build a SMALL query around that record's own
 * attributes and read THAT to the end. The narrow set either contains the bound
 * id or it does not, and both answers are real. What is never done is reading
 * the first 100 rows of a large set and calling the remainder absent.
 */
async function sectionN(): Promise<void> {
  console.log("\n=== N. Enumerable re-derivations (supersedes the sampled parts of F, H, E, I) ===");
  const ENG =
    "q.recordCountry=England&f.recordType=1" +
    "&q.marriageLikeDate.from=1850&q.marriageLikeDate.to=1854";
  const POCK = `q.surname=Pocklington&${ENG}`;

  // ---- F re-done: does a relative `*Exact` drop the variant forms the
  //      unqualified term reaches? ----
  //
  // Population chosen because it actually HAS named fathers: Bochenek/Brazil
  // carries 147 of them in 521 records, where every English-language enumerable
  // scope tried had ZERO (Pocklington 26 of 469, US scopes 0 of 100 sampled).
  // The abbreviation form is language-specific, so the question is put in the
  // general form the docs actually need: does exactness drop the OTHER SPELLINGS
  // that the unqualified term returned?
  const BOCH = "q.surname=Bochenek&q.recordCountry=Brazil&f.recordType=1";
  const formsOfFather = (ps: Persona[]): Map<string, number> => {
    const m = new Map<string, number>();
    for (const p of ps) {
      const g = (p.fatherGivenOfMatched ?? "").trim();
      if (g) m.set(g, (m.get(g) ?? 0) + 1);
    }
    return m;
  };
  const vFuzzy = await mustEnumerate(`${BOCH}&q.fatherGivenName=Joao`);
  const vExact = await mustEnumerate(`${BOCH}&q.fatherGivenName=Joao&q.fatherGivenName.exact=on`);
  if (vFuzzy.personas && vExact.personas) {
    const ff = formsOfFather(vFuzzy.personas);
    const fe = formsOfFather(vExact.personas);
    const dropped = [...ff.keys()].filter((k) => !fe.has(k));
    record("N", "variantForms", {
      fuzzyRows: vFuzzy.personas.length,
      exactRows: vExact.personas.length,
      fuzzyForms: [...ff.entries()].map(([k, v]) => `${k}:${v}`).join(" "),
      exactForms: [...fe.entries()].map(([k, v]) => `${k}:${v}`).join(" "),
      formsDroppedByExact: dropped.slice(0, 12),
    });
    record(
      "N",
      "verdict:relative .exact drops the variant forms fuzzy reached",
      ff.size === 0
        ? "NOT MEASURED — no named father in the unqualified set"
        : dropped.length > 0
          ? "HOLDS — forms present in the unqualified set are absent from the exact set, both read in full"
          : "DOES NOT HOLD — every form survived the exact form"
    );
    console.log(
      `\n  F-redo variant forms (Bochenek/Brazil, father given name):\n` +
        `     unqualified ${vFuzzy.personas.length} rows -> forms: ${[...ff.entries()].map(([k, v]) => `${k}:${v}`).join(" ") || "(none)"}\n` +
        `     + .exact    ${vExact.personas.length} rows -> forms: ${[...fe.entries()].map(([k, v]) => `${k}:${v}`).join(" ") || "(none)"}\n` +
        `     forms dropped by exact: ${dropped.join(" ") || "(none)"}`
    );
  }

  // ---- F (old form): the English abbreviation question, still unanswerable ----
  const givenTally = (ps: Persona[], pick: (p: Persona) => string | null): string =>
    tally(ps.map(pick).filter((x): x is string => x !== null));
  const fFuzzy = await mustEnumerate(`${POCK}&q.fatherGivenName=William`);
  const fExact = await mustEnumerate(
    `${POCK}&q.fatherGivenName=William&q.fatherGivenName.exact=on`
  );
  if (fFuzzy.personas && fExact.personas) {
    const abbrev = /^(wm|wm\.|will|willm)$/i;
    const fuzzyAbbrev = fFuzzy.personas.filter((p) =>
      abbrev.test((p.fatherGivenOfMatched ?? "").trim())
    ).length;
    const exactAbbrev = fExact.personas.filter((p) =>
      abbrev.test((p.fatherGivenOfMatched ?? "").trim())
    ).length;
    record("N", "abbrev", {
      fuzzyRows: fFuzzy.personas.length,
      exactRows: fExact.personas.length,
      fuzzyAbbrev,
      exactAbbrev,
      fuzzyForms: givenTally(fFuzzy.personas, (p) => p.fatherGivenOfMatched),
      exactForms: givenTally(fExact.personas, (p) => p.fatherGivenOfMatched),
    });
    record(
      "N",
      "verdict:relative .exact drops indexed abbreviations",
      fuzzyAbbrev > 0 && exactAbbrev === 0
        ? "HOLDS — abbreviated forms present in the unqualified set are absent from the exact set, both read in full"
        : fuzzyAbbrev === 0
          ? "NOT MEASURED — the unqualified set contained no abbreviated form to drop"
          : "DOES NOT HOLD — abbreviations survive the exact form"
    );
    console.log(
      `\n  F-redo abbreviations: unqualified ${fFuzzy.personas.length} rows (${fuzzyAbbrev} abbreviated)` +
        ` -> exact ${fExact.personas.length} rows (${exactAbbrev} abbreviated)`
    );
    console.log(`     unqualified father forms: ${givenTally(fFuzzy.personas, (p) => p.fatherGivenOfMatched)}`);
    console.log(`     exact father forms:       ${givenTally(fExact.personas, (p) => p.fatherGivenOfMatched)}`);
  } else {
    record("N", "verdict:relative .exact drops indexed abbreviations", "NOT MEASURED");
    console.log("\n  F-redo: NOT MEASURED — a set could not be enumerated");
  }

  // ---- H re-done: does an unqualified single-year range FUZZ? ----
  // Pocklington MARRIAGE records carry no birth years at all (156 rows, all
  // year-silent), so a fuzz measurement there measures nothing. This uses an
  // Ollerenshaw BIRTH population instead, where ~100% of sampled rows carry an
  // indexed birth year — the property the question requires.
  // Ollerenshaw births (1,891) does NOT enumerate — paging re-serves records and
  // never reaches a short page. Pocklington BIRTHS at 715 does, and carries
  // indexed years, which is the pair of properties this question needs. Size is
  // what decides enumerability on date-range queries, not the query shape:
  // Pocklington's 156-row and 715-row date-range pools both terminated.
  const YPOP = "q.surname=Pocklington&q.recordCountry=England&f.recordType=0";
  const yFuzzy = await mustEnumerate(`${YPOP}&q.birthLikeDate.from=1850&q.birthLikeDate.to=1850`);
  const yExact = await mustEnumerate(
    `${YPOP}&q.birthLikeDate.from=1850&q.birthLikeDate.to=1850&q.birthLikeDate.exact=on`
  );
  /**
   * PERSONA scope — reverted 2026-08-11, and deliberately not "fixed".
   *
   * This briefly read every person on the record instead, on the reasoning that
   * `q.birthLikeDate` is a record-level filter. That reasoning was inferred from
   * the payload's shape and never tested, and a test refutes it. NPBV-WBQ has a
   * date-less `persons[0]` and a child christened 1565:
   *
   *     range 1565-1565  (the child's own year)  -> record ABSENT
   *     range 1560-1570                          -> record ABSENT
   *     range 1850-1850                          -> record ABSENT
   *     range 1500-1501  (impossible)            -> record PRESENT
   *
   * So the child's 1565 is NOT what the filter matched on, and record-level
   * scoring had no basis. Note it also refutes the persona-level reading this
   * code returns to: a genuinely year-LESS record would answer every range, and
   * this one answers only the impossible window. Neither scope explains the
   * behaviour, which is why the verdicts below are withheld rather than
   * recomputed. Do not "correct" this again without a test that says what the
   * index actually matches on.
   *
   * The one thing kept from the record-level attempt is the `birthLike.length`
   * guard: `[].every(...)` is true, so a persona with no birth facts but a
   * display year used to be counted as approximate.
   */
  const outOf = (ps: Persona[]): { out: number; approx: number; noYear: number } => {
    let out = 0, approx = 0, noYear = 0;
    for (const p of ps) {
      const years = p.birthLike.map((f) => f.year).filter((y): y is number => y !== null);
      const disp = yearOf(p.matchedBirthDate);
      if (!years.length && disp === null) { noYear++; continue; }
      const inRange = years.some((y) => y === 1850) || disp === 1850;
      if (!inRange) {
        out++;
        if (p.birthLike.length > 0 && p.birthLike.every((f) => f.approximate)) approx++;
      }
    }
    return { out, approx, noYear };
  };
  // THE control for H's long-open question. Those year-silent rows are only
  // evidence of tolerated silence if they come back for a range they cannot
  // possibly satisfy. Same population, an impossible range, read to the end.
  const yImposs = await mustEnumerate(
    `${YPOP}&q.birthLikeDate.from=1500&q.birthLikeDate.to=1501`
  );
  if (yFuzzy.personas && yExact.personas) {
    const f = outOf(yFuzzy.personas);
    const e = outOf(yExact.personas);
    const impossRows = yImposs.personas?.length ?? null;
    const impossSilent = yImposs.personas ? outOf(yImposs.personas).noYear : null;
    record("N", "yearImpossibleRange", { rows: impossRows, yearSilent: impossSilent });
    record(
      "N",
      "verdict:an unqualified range tolerates year-silent records",
      impossRows === null || impossSilent === null
        ? "NOT MEASURED — the impossible-range set could not be enumerated"
        : impossSilent > 0 && f.noYear > 0
          ? `HOLDS — a range nothing can satisfy (1500-1501) still returns ${impossSilent} year-silent record(s) out of ${impossRows}, read to the end, so an unqualified range does not require an indexed year`
          : `DOES NOT HOLD — the impossible range returned ${impossRows} rows, ${impossSilent} of them year-silent`
    );
    console.log(
      `\n  H-redo impossible range 1500-1501: ${impossRows ?? "NOT MEASURED"} rows` +
        `${impossSilent === null ? "" : `, ${impossSilent} year-silent`}`
    );
    // THE question that had been open since this section was written, and the
    // comparison that answers it.
    //
    // If a record showing no year in the payload were genuinely year-LESS, it
    // could not prefer one range over another — it would come back for 1500 as
    // readily as for 1850. Measured here: the 1850 range returns 693 such rows
    // and the impossible range returns 11. They are therefore NOT year-less;
    // the index holds a year for them that the response does not expose, and
    // they answer to the range that year falls in. Payload-silence is not
    // index-silence, and every earlier attempt to read one as the other — the
    // "87% year-less" figure, the partition estimate, the two wrong
    // "silence tolerated" verdicts — was reading a rendering artifact as a fact
    // about the index. The residue that DOES match any range is small: 11 of
    // 715 here, ~1.5%, the same order as the ~5% the partition test estimated
    // on a different population.
    if (impossRows !== null && f.noYear > 0) {
      record(
        "N",
        "verdict:payload-silent means index-silent",
        impossRows < f.noYear / 2
          ? `NO — the 1850 range returns ${f.noYear} payload-silent rows but an impossible range returns only ${impossRows}. Those rows are index-dated and merely unexposed; only the ${impossRows} that answer any range are genuinely year-less.`
          : `YES — the impossible range returns ${impossRows} of the ${f.noYear} payload-silent rows, so they do not prefer a range`
      );
    }
    // WITHHELD, overriding whatever the classifier above computed.
    //
    // These three verdicts all reduce to "is this row year-silent?", and the
    // scope test in `outOf`'s docblock shows no payload-based classifier can
    // answer it: the dates the payload exposes do not predict which ranges
    // return the record. Persona scope says these rows are silent; record scope
    // says none is; the API says neither, because a silent row would answer
    // every range and these answer one.
    //
    // Section H has said `OPEN — do not say an unqualified range keeps
    // year-silent records` all along, and it was right. Recording a direction
    // here — in EITHER direction — is what put an unfounded claim into six
    // shipped documents. The raw counts stay in `yearFuzz` and
    // `yearImpossibleRange` so a later instrument can be compared against them.
    const WITHHELD =
      "NOT MEASURED — no payload-based classifier can decide year-silence here." +
      " Scope test: a record whose only indexed year is 1565 is ABSENT from a" +
      " 1565 range and PRESENT in an impossible 1500-1501 range, so neither the" +
      " matched persona's dates nor the record's predict what the index matched" +
      " on. A genuinely year-less record would answer every range; these answer one.";
    record("N", "verdict:an unqualified range tolerates year-silent records", WITHHELD);
    record("N", "verdict:.exact drops year-silent records", WITHHELD);
    record("N", "verdict:payload-silent means index-silent", WITHHELD);
    record("N", "yearFuzz", {
      fuzzyRows: yFuzzy.personas.length, ...f,
      exactRows: yExact.personas.length, exactOut: e.out, exactNoYear: e.noYear,
    });
    // Denominator stated, because it is 22, not 715: 693 of the rows carry no
    // year in the payload and cannot be classified at all. One out-of-range row
    // out of 22 is a thin basis for HOLDS, and that row ALSO survives `.exact`
    // (exactOut 1), which is not what fuzz looks like. The classifier is also
    // weaker than section H's: it reads only the matched persona's own dates,
    // while `q.birthLikeDate` is a RECORD-level filter, so a sibling's or
    // parent's in-range year makes a persona-out-of-range row legitimately
    // in-range. `Persona.recordBirthYears` exists precisely for that and is not
    // consulted here.
    const classifiable = (yFuzzy.personas?.length ?? 0) - f.noYear;
    const recordLevelInRange = (yFuzzy.personas ?? []).filter(
      (p) => p.recordBirthYears.includes(1850)
    ).length;
    record("N", "yearFuzzClassifiable", classifiable);
    record("N", "yearFuzzRecordLevelInRange", recordLevelInRange);
    record(
      "N",
      "verdict:an unqualified year range fuzzes past its bounds",
      f.out === 0
        ? "NOT SEEN — no record outside the range in a set read in full"
        : `WEAK — ${f.out} of ${classifiable} classifiable rows (of ${yFuzzy.personas?.length ?? 0} returned; the rest carry no year in the payload). ${
            e.out > 0
              ? `${e.out} out-of-range row(s) ALSO survive .exact, which is not the shape of fuzz`
              : ".exact removes the out-of-range rows, which is the shape fuzz would have"
          }. Scored on the matched persona only; the record-level check is not applied.`
    );
    // Withheld for the same reason as the other two, and re-asserted HERE
    // because this site runs AFTER the block above and silently overwrote it —
    // `record()` is last-write-wins, so a withheld verdict is only withheld if
    // nothing downstream recomputes the key. That is exactly how this verdict
    // came back as HOLDS on the first attempt to withdraw it.
    //
    // The computation it replaced read `f.noYear > 0 && e.noYear === 0`, i.e.
    // "rows the payload shows no year for are gone from the exact set". Whether
    // those rows are year-silent is the question no payload-based classifier can
    // answer here (see `outOf`), so this could only ever have restated its own
    // premise.
    record("N", "verdict:.exact drops year-silent records", WITHHELD);
    console.log(
      `\n  H-redo year range: unqualified ${yFuzzy.personas.length} rows` +
        ` (${f.out} outside the range, ${f.approx} of those approximate, ${f.noYear} year-silent)`
    );
    console.log(
      `                     + .exact  ${yExact.personas.length} rows` +
        ` (${e.out} outside, ${e.noYear} year-silent)`
    );
  } else {
    // WHY it could not be enumerated, because the reason is itself a finding and
    // it is not "the pool is too big".
    //
    // Measured on this exact query: reported total 1,891, yet paging fetched
    // 4,900 rows yielding only 1,100 DISTINCT personas and never reached a short
    // page. The same pathology appeared on the disjoint-range query in section H.
    // Both are `q.birthLikeDate` RANGE queries, and on those the reported total
    // does not bound the pageable set — deep paging re-serves records instead of
    // terminating. So a date-range pool cannot be read to the end by paging
    // however small its total looks, and any question about one needs a totals
    // argument (the partition and impossible-range tests in section H) rather
    // than enumeration.
    record("N", "verdict:an unqualified year range fuzzes past its bounds", "NOT MEASURED");
    record(
      "N",
      "verdict:date-range pools can be enumerated by paging",
      "NO — reported total 1,891 but 4,900 rows fetched for 1,100 distinct personas, never reaching a short page. Same behaviour on the section H disjoint-range query. Date-range questions need totals arguments, not enumeration."
    );
    console.log(
      "\n  H-redo: NOT MEASURED — the date-range pool does not enumerate:" +
        " paging re-serves records and never reaches a short page (reported 1,891," +
        " 4,900 rows fetched, 1,100 distinct). This is a property of date-range" +
        " queries, not of the pool's size."
    );
  }

  // ---- E and I re-done: BIND-THEN-NARROW ----
  /**
   * Find one record that IS the phenomenon, then read a small set around it.
   * `bindQuery` locates the record; `narrow` builds the enumerable set from the
   * bound record's own surname, so the set is small BECAUSE of the record rather
   * than in spite of it.
   */
  const bindThenNarrow = async (
    label: string,
    bindQuery: string,
    narrowFor: (surname: string) => string,
    key: string
  ): Promise<void> => {
    const bind = await search(`${bindQuery}&count=1&${REQUIRE_SWITCH}`);
    const target = bind.personas[0];
    if (errored(bind) || target === undefined) {
      record("N", `verdict:${key}`, "NOT MEASURED — no record of this kind could be bound");
      console.log(`\n  ${label}: NOT MEASURED — nothing to bind`);
      return;
    }
    const surname = (target.matchedName.trim().split(/\s+/).pop() ?? "").replace(/[^A-Za-z]/g, "");
    if (!surname) {
      record("N", `verdict:${key}`, "NOT MEASURED — bound record has no usable surname to narrow on");
      return;
    }
    const scan = await mustEnumerate(narrowFor(surname));
    if (scan.personas === null) {
      record("N", `verdict:${key}`, `NOT MEASURED — the narrowed set was ${scan.why}`);
      console.log(`\n  ${label}: NOT MEASURED — narrowed set ${scan.why} (surname ${surname})`);
      return;
    }
    const idx = scan.personas.findIndex((p) => p.id === target.id);
    const present = idx >= 0;
    // RANK, not just presence. "Fuzzy reaches it" and "you will see it" are
    // different claims, and the docs make the second one. In a set read to the
    // end the rank is exact rather than a floor from a truncated scan.
    record("N", key, {
      boundId: target.id,
      boundName: target.matchedName,
      narrowedOnSurname: surname,
      narrowedRows: scan.personas.length,
      present,
      rankInNarrowedSet: present ? idx + 1 : null,
    });
    record(
      "N",
      `verdict:${key}`,
      present
        ? "REACHED — the bound record is in the narrowed set, read in full"
        : "NOT REACHED — the bound record is absent from a set read in full, so this is real absence"
    );
    console.log(
      `\n  ${label}: bound ${target.matchedName} (${target.id}), narrowed on "${surname}"` +
        ` -> ${scan.personas.length} rows read in full, target ${present ? `PRESENT at rank ${idx + 1}` : "ABSENT"}`
    );
  };

  // E: does a fuzzy formal-name search reach a record indexed under the diminutive?
  await bindThenNarrow(
    "E-redo Elizabeth->Betty",
    `q.givenName=Betty&q.givenName.exact=on&${ENG}`,
    (sn) => `q.surname=${encodeURIComponent(sn)}&q.givenName=Elizabeth&${ENG}`,
    "diminutiveReach"
  );

  // I: does a fuzzy initials search reach a record indexed with the initials
  // transposed? Bind a "W J", then search "J W".
  await bindThenNarrow(
    "I-redo J W <- W J",
    `q.givenName=W%20J&q.givenName.exact=on&${ENG}`,
    (sn) => `q.surname=${encodeURIComponent(sn)}&q.givenName=J%20W&${ENG}`,
    "initialsTransposition"
  );
}

// --- SECTION S — is the father/spouse asymmetry real? ---------------------

/**
 * Section R reported that an unmatchable PARENT name barely narrows a search
 * while an unmatchable SPOUSE name removes most of the pool, and explained it by
 * how often each relative is indexed. That claim is doing real work in the docs
 * — it is why a parent-anchored nil is called weak evidence and a spouse-anchored
 * one strong — and it rests on a single population with a single rare name per
 * role. It is challenged, so this section is built to REFUTE it.
 *
 * Four confounds R could not rule out, each addressed here:
 *
 *   1. DIFFERENT NAMES per role (`Zachariah` for father, `Drusilla` for spouse,
 *      with very different variant spreads). Here the SAME unmatchable token is
 *      used for every role, so nothing depends on a name's shape.
 *   2. ONE POPULATION. Here four, spanning record types and countries — if the
 *      asymmetry is a property of US marriage indexing it will not survive.
 *   3. ONE GIBBERISH TOKEN. Two are used. If retention moves between them the
 *      metric is measuring fuzzy matching, not silence, and means nothing.
 *   4. THE EXPLANATION ITSELF. R's indexed-share came from the same relationship
 *      extraction whose output is in question — 13.5% parent-indexed in MARRIAGE
 *      records is low enough to suspect the extractor, not the index. It is
 *      reported per population here so a bad extractor shows up as a share that
 *      does not move when the record type plainly should move it.
 */
async function sectionS(): Promise<void> {
  console.log("\n=== S. Does the father/spouse asymmetry survive? (challenging section R) ===");
  const POPS: Array<[string, string]> = [
    ["US marriage", "q.surname=Martin&q.recordCountry=United%20States&f.recordType=1"],
    ["US residence 1880", "q.surname=Martin&q.residenceDate.from=1880&q.residenceDate.to=1880"],
    ["England, Purnell", "q.surname=Purnell&q.recordCountry=England"],
    ["Brazil marriage", "q.surname=Oliveira&q.recordCountry=Brazil&f.recordType=1"],
  ];
  // Two unmatchable tokens of different shapes. Retention must agree across both
  // or the measurement is not about silence at all.
  const GIBBERISH = ["Xqzzyrbl", "Vplkwnthq"];
  const FAMILIES: Array<[string, string, (p: Persona) => number]> = [
    // `fathersIndexed`, not `parentsIndexed`: the sex-aware count added for
    // section R counts parents that could be the father, so it does not conflate a
    // father-SILENT record (no father indexed) with a father-NAMELESS one (a
    // father indexed without a readable given name). The sex-blind `parentsIndexed`
    // this row read before overstated the father indexed rate by every mother-only
    // record, and had section S measuring a different denominator than section R.
    ["father", "fatherGivenName", (p) => p.fathersIndexed],
    // `mother`/`parent` are deliberately not rows here: this section challenges the
    // father/spouse asymmetry section R found, and its verdicts are father-vs-spouse.
    // Mother detection now DOES exist on `Persona` (`mothersIndexed`), so the old
    // "no mother detection" reason for withholding a mother row is void — mother
    // and parent are enumerated in section R rather than re-challenged here.
    ["spouse", "spouseGivenName", (p) => p.spousesIndexed],
  ];

  const rows: Array<{
    pop: string;
    family: string;
    indexedPct: number | null;
    retention: number[];
  }> = [];

  for (const [popName, base] of POPS) {
    // One page serves double duty: the baseline total, and the indexed share for
    // every family — they are properties of the same records.
    const b = await search(`${base}&count=100&${REQUIRE_SWITCH}`);
    if (errored(b) || !usableTotal(b.total)) {
      console.log(`\n  -- ${popName}: NOT MEASURED (${b.error ?? "no usable total"})`);
      continue;
    }
    const baseTotal = b.total;
    console.log(`\n  -- ${popName}  baseline ${fmt(baseTotal)}  (sampled ${b.personas.length})`);
    for (const [famName, param, indexedOf] of FAMILIES) {
      const indexed = b.personas.filter((p) => indexedOf(p) > 0).length;
      const indexedPct =
        b.personas.length > 0 ? +((indexed / b.personas.length) * 100).toFixed(1) : null;
      const retention: number[] = [];
      for (const g of GIBBERISH) {
        const r = await search(`${base}&q.${param}=${g}&count=1&${REQUIRE_SWITCH}`);
        if (measuredTotal(r.total)) retention.push(+((r.total / baseTotal) * 100).toFixed(1));
      }
      rows.push({ pop: popName, family: famName, indexedPct, retention });
      const spreadStr =
        retention.length === 2 ? `${Math.abs(retention[0]! - retention[1]!).toFixed(1)}pt` : "?";
      console.log(
        `     ${famName.padEnd(7)} indexed ${String(indexedPct).padStart(5)}%` +
          `   retention ${retention.map((x) => `${x}%`).join(" / ").padEnd(16)}` +
          `  (token spread ${spreadStr})`
      );
    }
  }
  record("S", "rows", rows);

  // --- Verdicts ------------------------------------------------------------
  // 1. Is the metric stable across the two tokens? If not, nothing else here
  //    means anything and the section must say so rather than proceed.
  const unstable = rows.filter(
    (r) => r.retention.length === 2 && Math.abs(r.retention[0]! - r.retention[1]!) > 10
  );
  record("S", "unstableRows", unstable.length);
  record(
    "S",
    "verdict:retention is stable across gibberish tokens",
    rows.length === 0
      ? "NOT MEASURED"
      : unstable.length === 0
        ? "STABLE — the two unmatchable tokens agree, so this measures silence rather than fuzzy matching"
        : `UNSTABLE in ${unstable.length}/${rows.length} rows — retention depends on WHICH unmatchable name is used, so it is not measuring silence; discount the asymmetry entirely`
  );

  // 2. Does the father/spouse gap hold in EVERY population, or only some?
  const byPop = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (r.retention.length === 0) continue;
    const mean = r.retention.reduce((a, b) => a + b, 0) / r.retention.length;
    if (!byPop.has(r.pop)) byPop.set(r.pop, new Map());
    byPop.get(r.pop)?.set(r.family, mean);
  }
  const comparisons: Array<{ pop: string; father: number; spouse: number; gap: number }> = [];
  for (const [pop, fams] of byPop) {
    const f = fams.get("father");
    const s = fams.get("spouse");
    if (f !== undefined && s !== undefined) comparisons.push({ pop, father: f, spouse: s, gap: f - s });
  }
  record("S", "comparisons", comparisons);
  const holds = comparisons.filter((c) => c.gap > 20).length;
  const reversed = comparisons.filter((c) => c.gap < -20).length;
  record(
    "S",
    "verdict:father retains more than spouse",
    comparisons.length === 0
      ? "NOT MEASURED"
      : holds === comparisons.length
        ? `HOLDS in all ${comparisons.length} populations`
        : reversed > 0
          ? `DOES NOT HOLD — reversed in ${reversed} of ${comparisons.length} populations, so it is not a property of the relative family`
          : `PARTIAL — a large gap in ${holds} of ${comparisons.length} populations; not a general rule`
  );

  // 3. Does retention actually track the indexed share, as R claimed? Across
  //    every point, not the two that suggested it.
  const pts = rows
    .filter((r) => r.indexedPct !== null && r.retention.length > 0)
    .map((r) => ({
      indexed: r.indexedPct as number,
      ret: r.retention.reduce((a, b) => a + b, 0) / r.retention.length,
    }));
  // The check that actually tests R's explanation, rather than one that passes
  // by construction. Sorting all points and comparing the extremes returns TRUE
  // whenever the two spouse rows happen to sit at the top of the indexed scale —
  // which they do — while saying nothing about whether indexing is the CAUSE.
  //
  // The decisive case is a population where father and spouse are indexed at the
  // SAME rate. If the gap persists there, the indexed share cannot be what
  // produces it.
  const controlled = comparisons
    .map((c) => {
      const fams = byPop.get(c.pop);
      const fIdx = rows.find((r) => r.pop === c.pop && r.family === "father")?.indexedPct ?? null;
      const sIdx = rows.find((r) => r.pop === c.pop && r.family === "spouse")?.indexedPct ?? null;
      void fams;
      return { pop: c.pop, gap: c.gap, fIdx, sIdx };
    })
    .filter(
      (x): x is { pop: string; gap: number; fIdx: number; sIdx: number } =>
        x.fIdx !== null && x.sIdx !== null && Math.abs(x.fIdx - x.sIdx) <= 10
    );
  record("S", "matchedIndexingPopulations", controlled);
  const gapSurvivesMatching = controlled.filter((x) => Math.abs(x.gap) > 20);
  // WITHHELD — this section's indexed share comes from a 100-row sample of pools
  // of 1.5M-11.4M rows, which RULE 0 forbids as the basis for a proportion. It
  // previously recorded REFUTED here, contradicting section R's HOLDS in the
  // same artifact. Section R now answers this from pools read to the end; this
  // section defers to it rather than offering a second, weaker answer.
  record(
    "S",
    "verdict:retention tracks the indexed share",
    "NOT MEASURED HERE — sampled populations violate RULE 0; see section R, which enumerates and finds retention equals the silent share"
  );
  // Printed to MATCH what was recorded. This line used to say REFUTED off the
  // same 100-row indexedPct the record() call above declares RULE 0 invalid —
  // stdout and the artifact gave opposite answers to the same question.
  // The surviving "controlled" population is also degenerate: fIdx 0 means the
  // extractor found no indexed parent on ANY sampled row, and two near-zero
  // rates trivially satisfy the |fIdx - sIdx| <= 10 gate.
  console.log(
    controlled.length === 0
      ? "    indexed-share explanation: UNTESTED (no population indexes both at a similar rate)"
      : `    indexed-share explanation: WITHHELD under RULE 0 (see section R) — matched pairs were ` +
          controlled
            .map((x) => `${x.pop}: father ${x.fIdx}% / spouse ${x.sIdx}% indexed, gap ${x.gap.toFixed(0)}pt${x.fIdx === 0 || x.sIdx === 0 ? " [DEGENERATE — a 0% rate means the extractor found none, so 'same rate' is vacuous]" : ""}`)
            .join("; ")
  );

  console.log("\n  --- verdicts ---");
  for (const c of comparisons) {
    console.log(
      `    ${c.pop.padEnd(20)} father ${c.father.toFixed(1)}%  spouse ${c.spouse.toFixed(1)}%` +
        `  gap ${c.gap >= 0 ? "+" : ""}${c.gap.toFixed(1)}pt`
    );
  }
  console.log(
    `    token stability: ${unstable.length === 0 ? "stable" : `UNSTABLE in ${unstable.length}/${rows.length} rows`}`
  );
}

// --- SECTION V — the two inherited wildcard-scope rules -------------------

/**
 * `name-search-mechanics.md` has carried two wildcard constraints since before
 * this branch, neither ever measured, both now labelled *(not measured)*:
 *
 *   1. "Wildcards disabled in Ellis Island collections"
 *   2. "In place parameters, wildcards work only in the innermost jurisdiction
 *      level"
 *
 * Section W already refuted two of that table's other rules (the three-letter
 * minimum and the four-star maximum), which is reason enough to stop trusting
 * the rest of it on inheritance.
 *
 * Both are answered by counts and one page of names — no enumeration, after the
 * paging attempts in section H proved that a pool the API will not let you read
 * to the end cannot answer a membership question.
 */
async function sectionV(): Promise<void> {
  console.log("\n=== V. Inherited wildcard-scope rules: Ellis Island, and place levels ===");

  // --- Rule 1: are wildcards disabled inside the Ellis Island collection? ---
  //
  // `Purnell` / `Parnell`, not `Smith`. The pair differs by one character so
  // `P?rnell` matches both, and both are rare enough that every pool here is a
  // few hundred records rather than tens of millions. That matters: the first
  // version of this section used `Smith`, whose pools ran to 68 million, forcing
  // a top-100 sample that could not show expansion at all — it reported the
  // control as "does not expand", a false negative from the same
  // ABSENT-vs-OUTRANKED trap that has caught this file three times.
  //
  // `.exact=on` throughout, which is what makes the totals decisive on their
  // own: with fuzzy expansion off, no index entry is literally spelled `P?rnell`,
  // so a non-zero result can ONLY come from the wildcard being honoured.
  const ELLIS = "1368704";
  const scopes: Array<[string, string]> = [
    ["Ellis Island", `&f.collectionId=${ELLIS}`],
    ["no collection filter", ""],
  ];
  const wildcardWorks: Record<string, boolean | null> = {};
  for (const [label, scope] of scopes) {
    const one = async (surname: string): Promise<number | null> => {
      const r = await search(
        `q.surname=${encodeURIComponent(surname)}&q.surname.exact=on${scope}` +
          `&count=1&${REQUIRE_SWITCH}`
      );
      return measuredTotal(r.total) ? r.total : null;
    };
    const purnell = await one("Purnell");
    const parnell = await one("Parnell");
    const wild = await one("P?rnell");
    const works =
      purnell === null || parnell === null || wild === null
        ? null
        : wild > Math.max(purnell, parnell);
    wildcardWorks[label] = works;
    record("V", `ellis:${label.replace(/\s+/g, "-")}`, {
      purnellExact: purnell,
      parnellExact: parnell,
      wildcardExact: wild,
      wildcardExpands: works,
    });
    console.log(
      `  ${label.padEnd(22)} Purnell ${fmt(purnell)}  Parnell ${fmt(parnell)}` +
        `  P?rnell ${fmt(wild)}  expands=${works === null ? "NOT MEASURED" : works ? "YES" : "no"}`
    );
  }

  // Membership cross-check, inside Ellis only, where the pools are small enough
  // to read to the end. Totals could in principle rise for some reason other
  // than the wildcard; the bound records either appear or they do not.
  const bound = await scanIds(
    `q.surname=Purnell&q.surname.exact=on&f.collectionId=${ELLIS}`,
    3000
  );
  const wildPool = await scanIds(
    `q.surname=${encodeURIComponent("P?rnell")}&q.surname.exact=on&f.collectionId=${ELLIS}`,
    3000
  );
  const bothComplete = bound.complete && wildPool.complete;
  const carried = bothComplete
    ? [...bound.ids].filter((id) => wildPool.ids.has(id)).length
    : null;
  record("V", "ellis:membership", {
    scansComplete: bothComplete,
    purnellBound: bound.ids.size,
    wildcardPool: wildPool.ids.size,
    purnellIdsInWildcardPool: carried,
  });
  console.log(
    `  membership inside Ellis: ${carried === null ? "NOT MEASURED" : `${carried}/${bound.ids.size}`}` +
      ` bound Purnell records appear in the P?rnell + exact pool` +
      `${bothComplete ? "" : " (scan incomplete — not evidence)"}`
  );

  const inEllis = wildcardWorks["Ellis Island"];
  const inControl = wildcardWorks["no collection filter"];
  record(
    "V",
    "verdict:wildcards disabled in Ellis Island collections",
    inEllis === null || inControl === null
      ? "NOT MEASURED"
      : inControl && !inEllis
        ? "CONFIRMED — the wildcard expands with no collection filter but not inside Ellis Island"
        : inEllis
          ? `REFUTED — inside Ellis Island the wildcard expands on totals${
              bothComplete && carried !== null
                ? `, and ${carried}/${bound.ids.size} bound records are carried into the wildcard pool by membership over complete scans`
                : " (the membership cross-check did NOT complete, so this rests on totals alone)"
            }`
          : "INCONCLUSIVE — the wildcard did not expand in the control either, so nothing is attributable to the collection"
  );


  // --- Rule 2: do place wildcards work only at the innermost level? --------
  //
  // A three-level place, wildcarded at each level in turn. "Innermost" is the
  // leading component (the narrowest jurisdiction), so the claim predicts the
  // first variant behaves and the other two do not.
  console.log("\n  place-parameter wildcard by jurisdiction level:");
  const PLACE_CASES: Array<[string, string, string]> = [
    ["literal", "Norwich, Norfolk, England", "literal"],
    ["innermost (Norw*)", "Norw*, Norfolk, England", "innermost"],
    ["middle (Norf*)", "Norwich, Norf*, England", "middle"],
    ["outermost (Engl*)", "Norwich, Norfolk, Engl*", "outermost"],
  ];
  const placeTotals: Record<string, number | null> = {};
  // Anchored on `recordCountry`, not on a surname. A fuzzy `Smith` alongside the
  // place mixed a multi-million-record name expansion into every total and made
  // the place term the smaller of two effects; the anchor here is a hard filter,
  // so what moves between rows is the place parameter and nothing else.
  for (const [label, place, key] of PLACE_CASES) {
    const r = await search(
      `q.recordCountry=England&q.birthLikePlace=${encodeURIComponent(place)}` +
        `&count=3&${REQUIRE_SWITCH}`
    );
    placeTotals[key] = measuredTotal(r.total) ? r.total : null;
    record("V", `place:${key}`, { total: placeTotals[key], error: r.error });
    console.log(
      `    ${label.padEnd(20)}${fmt(r.total)}${r.error === null ? "" : `  [${r.error}]`}`
    );
  }
  // THE control that makes the three variants interpretable: the same query with
  // NO place term at all. Three wildcard variants agreeing tells us the level is
  // irrelevant, but not WHY — "the place resolves to something small" and "the
  // place term is discarded" look identical until you know what discarding it
  // would return.
  const noPlace = await search(`q.recordCountry=England&count=3&${REQUIRE_SWITCH}`);
  const noPlaceTotal = measuredTotal(noPlace.total) ? noPlace.total : null;
  record("V", "place:noPlaceTerm", noPlaceTotal);
  console.log(`    ${"(no place term)".padEnd(20)}${fmt(noPlace.total)}`);

  const lit = placeTotals.literal;
  const variants = [placeTotals.innermost, placeTotals.middle, placeTotals.outermost];
  const measured = variants.filter((v): v is number => v !== null);
  // THE tell, and the thing a per-level boolean cannot express: if the three
  // variants come back at essentially the SAME total, they are not three
  // different wildcard expansions — they are the same query, i.e. the place term
  // stopped discriminating the moment it contained a wildcard, wherever the
  // wildcard sat. A first version asked only "is each variant non-zero and
  // different from the literal", which answers YES for all three and reads as
  // "honoured at every level" — the opposite of what identical totals mean.
  const spread =
    measured.length === 3
      ? (Math.max(...measured) - Math.min(...measured)) / Math.max(...measured)
      : null;
  const allAlike = spread !== null && spread <= 0.01;
  const differsFromLiteral =
    lit !== null && measured.length === 3 && measured.every((v) => v !== lit);
  record("V", "place:variantTotals", variants);
  record("V", "place:variantSpread", spread === null ? null : +(spread * 100).toFixed(3));
  // Is the wildcarded place term simply DISCARDED? Compare the variants to the
  // no-place control rather than to each other.
  const ignoresPlace =
    noPlaceTotal !== null &&
    measured.length === 3 &&
    measured.every((v) => Math.abs(v - noPlaceTotal) <= noPlaceTotal * 0.01);
  record("V", "place:wildcardEqualsNoPlaceTerm", ignoresPlace);
  record(
    "V",
    "verdict:place wildcards work only at the innermost level",
    measured.length < 3 || lit === null
      ? "NOT MEASURED"
      : !allAlike
        ? `MIXED — variants differ from each other (spread ${spread === null ? "?" : (spread * 100).toFixed(1)}%); inspect before documenting`
        : ignoresPlace
          ? "REFUTED — a wildcard at ANY level makes the place term behave as if it were absent entirely (all three variants match the no-place control), so the level is irrelevant and no level honours it"
          : differsFromLiteral
            ? "REFUTED, AND THE RULE HAS THE WRONG SHAPE — a wildcard at ANY level gives the same total, far from the literal's and not equal to dropping the term either. The level makes no difference; what the wildcarded place resolves to is not established here"
            : "INCONCLUSIVE"
  );
  console.log(
    `    -> literal ${fmt(lit)} vs three wildcard variants ${measured.map((v) => fmt(v).trim()).join(" / ")}` +
      ` — spread between variants ${spread === null ? "?" : (spread * 100).toFixed(3)}%`
  );
}

// --- SECTION R — does Q3 generalise across relative families? -------------

/**
 * Issue #1093 question 3: does exactness on a RELATIVE's name behave like
 * exactness on the principal's — and, the part that matters for the docs, does
 * it behave the same for every relative family?
 *
 * Section F answered this for `fatherGivenName` alone, in depth. The tool
 * exposes ten relative parameters and the docs state the finding for all of
 * them, so the generalisation was assumption, not measurement. This section
 * runs `father` and `spouse` through IDENTICAL code on the SAME population, so
 * a difference between them cannot be an artifact of different query shapes or
 * different slices of the index — which is the only way the comparison means
 * anything.
 *
 * Section F is deliberately left alone: its figures are already pinned and back
 * shipped prose, and re-deriving them through new code would put both the old
 * and new numbers in play at once.
 */
async function sectionR(): Promise<void> {
  // Pre-seeded so an early return cannot DELETE them. `writeFigures` replaces a
  // whole section object, so a run in which no population enumerates drops every
  // key this section did not record on THAT run. That must cover all FOUR
  // per-family `.exact requires the relative to be present` findings, not just
  // spouse: the shipped `*GivenNameExact` descriptions and both specs cite every
  // one by name (`R.verdict:father …`, `mother`, `parent`, `spouse`), yet the
  // father/mother/parent legs run only AFTER the `rows.length === 0` early return
  // below, so without a pre-seed a run where no baseline enumerates drops exactly
  // the keys the docs point at. A missing key fails nothing at write time: the
  // traceability check reads figures, and FORBIDDEN_WHEN treats an absent verdict
  // as an inactive rule. So the honest default is recorded first and overwritten
  // by a real measurement. The same key construction as the final FAMILIES loop.
  for (const famId of ["father", "spouse", "mother", "parent"] as const) {
    const key =
      famId === "spouse"
        ? "verdict:spouse .exact requires the spouse to be present"
        : `verdict:${famId} .exact requires the relative to be present`;
    record("R", key, `NOT MEASURED — this run did not reach the ${famId} leg`);
  }
  record("R", "exactRequiresPresence", []);
  record("R", "spouseExactRequiresPresence", []);
  console.log("\n=== R. Relative names: keep-matching / keep-silent / drop-contradicting ===");
  console.log(
    "  Every pool below is READ TO THE END (RULE 0). Nothing here is a sample."
  );

  // Populations chosen so that BOTH the bare pool and every term-added variant
  // stay under the API's search-depth limit — verified by
  // `dev/try-enumerable-pops.ts`. The previous version of this section used
  // `Martin` + US marriage at 1,534,508 rows and sampled 200 of them; its
  // indexed-share figure was wrong by a factor of three and produced a verdict
  // that contradicted section S.
  const POPS: Array<{ id: string; base: string }> = [
    {
      id: "Brazil/Bochenek",
      base: "q.surname=Bochenek&q.recordCountry=Brazil&f.recordType=1",
    },
    {
      id: "US/Bickerdike",
      base: "q.surname=Bickerdike&q.recordCountry=United%20States&f.recordType=1",
    },
    {
      id: "England/Pocklington",
      base:
        "q.surname=Pocklington&q.recordCountry=England&f.recordType=1" +
        "&q.marriageLikeDate.from=1850&q.marriageLikeDate.to=1854",
    },
  ];
  const FAMILIES: Array<{
    id: string;
    param: string;
    nameOf: (p: Persona) => string | null;
    /**
     * Every name this family offers, for the one family that offers more than one.
     * Defaults to `[nameOf]`, so the three single-valued families compute exactly as
     * before and their recorded verdicts cannot move as a side effect.
     */
    namesOf?: (p: Persona) => string[];
    /** How many relatives of this family are indexed, named or not. */
    indexedCount: (p: Persona) => number;
  }> = [
    {
      id: "father",
      param: "fatherGivenName",
      nameOf: (p) => p.fatherGivenOfMatched,
      // NOT parentsIndexed — the mirror of the mother fix. A mother-only record is
      // father-silent, and calling it father-nameless understates the silent share
      // that this section compares against retention.
      indexedCount: (p) => p.fathersIndexed,
    },
    {
      id: "spouse",
      param: "spouseGivenName",
      nameOf: (p) => p.spouseGivenOfMatched,
      indexedCount: (p) => p.spousesIndexed,
    },
    // The three the artifact left open. `T.verdict:all name fields behave alike`
    // read NOT MEASURED and six `*Exact` descriptions read "Assumed, as
    // `motherGivenNameExact`"; six hedges is a measurement task, not a wording
    // task. mother and parent share `parentsIndexed` as their denominator for
    // the same reason father does — a record with zero parents cannot name a
    // mother either, and it is the only column that does not conflate silence
    // with a missing display name.
    {
      id: "mother",
      param: "motherGivenName",
      nameOf: (p) => p.motherGivenOfMatched,
      // NOT parentsIndexed — see `mothersIndexed`. A father-only record is
      // mother-silent, and calling it mother-nameless is what broke the run.
      indexedCount: (p) => p.mothersIndexed,
    },
    {
      id: "parent",
      param: "parentGivenName",
      nameOf: (p) => p.parentGivenOfMatched,
      // Multi-valued: the query matches EITHER parent. See `parentGivensOfMatched`.
      namesOf: (p) => p.parentGivensOfMatched,
      indexedCount: (p) => p.parentsIndexed,
    },
  ];
  // `other` IS DELIBERATELY ABSENT. Measured on 2026-08-20 and excluded, not
  // forgotten — see `verdict:other names behave like the four kinship families`.
  // It is not a kinship role at all: `q.otherGivenName` is a co-occurrence
  // search, it is the only MULTI-VALUED family (a register entry names
  // godparents, witnesses and bystanders, any of whom can satisfy the query),
  // and including it put 62 records into the conflict bucket — 9 in
  // Brazil/Bochenek, 53 in England/Pocklington — which flipped BOTH
  // `verdict:drop-contradicting` and `verdict:retention equals the silent share`
  // from HOLDS to DOES NOT HOLD while all four kinship families stayed at zero
  // conflicts. The leading hypothesis for those 62 is untested: a record whose
  // co-persons include one with NO indexed given name can satisfy any
  // given-name query through that emptiness, exactly as the principal
  // `givenName` floor does. Do not re-add `other` here without settling that
  // first, and do not let it back into these two aggregate verdicts — they are
  // about kinship terms.
  /**
   * THREE TRAPS, each of which produced a wrong answer in a probe discarded on
   * 2026-08-20 (`dev/explore-relative-empty-field-families.ts`, deleted — its
   * numbers were wrong and it contradicted this section's recorded verdicts).
   *
   * 1. THE POOL MUST BE ANCHORED ON A NAME. Every POPS entry above carries
   *    `q.surname=`. Anchoring on country + type + date + place instead, with no
   *    name term at all, makes the method collapse: the relative term becomes the
   *    only name term, an unmatchable token then returns an EMPTY set, and
   *    membership in an empty set distinguishes nothing. That probe read the
   *    resulting zero as "unqualified DROPS silent records" — the exact opposite
   *    of `verdict:keep-silent` below, on three enumerated populations.
   * 2. GIBBERISH IS VALID HERE, and only here. It works precisely BECAUSE the
   *    pool is surname-anchored: what survives an unmatchable relative name is
   *    the silent share, which is the measurement. The discarded probe concluded
   *    gibberish was "confounded for relatives" in general. It is not — it was
   *    confounded by that probe's own missing name anchor.
   * 3. TWO BUCKETS IS NOT ENOUGH — see the named / nameless-but-indexed / silent
   *    split below. A graph-derived "has a father?" boolean counts a record whose
   *    relative IS indexed but carries no readable given name as silent, and
   *    those records are correctly DROPPED by an unmatchable name, so the verdict
   *    comes out short. `indexedCount` is the only denominator that separates
   *    the two.
   */
  const GIBBERISH = "Xqzzyrbl";

  /**
   * Diacritic- and initial-tolerant, because the index is both.
   *
   * `José` does not `.includes("Jose")`, and `Thiago J` IS a legitimate hit for
   * `Jose` — the index holds initials and the search matches them. Both were
   * live bugs in the first enumeration and both turned matches into
   * "conflicts", i.e. both failed toward "the documented model is broken".
   */
  const fold = (s: string): string =>
    s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const isHit = (name: string, wanted: string): boolean => {
    const f = fold(name);
    const w = fold(wanted);
    if (f.includes(w)) return true;
    return f
      .split(/\s+/)
      .some((tok) => tok.replace(/\./g, "").length === 1 && tok[0] === w[0]);
  };

  const rows: Array<Record<string, unknown>> = [];
  const sexRows: Array<Record<string, unknown>> = [];
  for (const pop of POPS) {
    console.log(`\n  -- ${pop.id}`);
    const baseScan = await mustEnumerate(pop.base);
    if (baseScan.personas === null) {
      console.log(`     NOT MEASURED — baseline scan stopped: ${baseScan.why}`);
      continue;
    }
    const baseline = baseScan.personas.length;
    if (baseline === 0) {
      // An empty pool passes every check below vacuously: silentSharePct is
      // 0/0, keep-silent compares 0 to 0, and drop-contradicting reports
      // "zero records naming a different relative" from zero records.
      console.log("     NOT MEASURED — the enumerated baseline is empty");
      continue;
    }

    // Which rows does the sex-specific denominator actually reclassify, and why?
    // Added because the answer was being GUESSED. `mothersIndexed` moved 30
    // Pocklington rows out of mother-nameless; whether `fathersIndexed` moves any
    // depends on whether those parents carry a READABLE sex, and no recorded figure
    // said. It does now.
    //
    // A parent of unreadable sex counts toward BOTH denominators by design, so it is
    // double-counted across the two; that overlap is what `anyUnreadable` detects.
    const withParents = baseScan.personas.filter((q) => q.parentsIndexed > 0);
    const allFemale = withParents.filter((q) => q.fathersIndexed === 0).length;
    const allMale = withParents.filter((q) => q.mothersIndexed === 0).length;
    const anyUnreadable = withParents.filter(
      (q) => q.mothersIndexed + q.fathersIndexed > q.parentsIndexed
    ).length;
    sexRows.push({
      pop: pop.id,
      baselineRows: baseline,
      rowsWithAParent: withParents.length,
      allParentsProvablyFemale: allFemale,
      allParentsProvablyMale: allMale,
      rowsWithAnUnreadableSexParent: anyUnreadable,
    });
    console.log(
      `     parent sex: ${withParents.length} row(s) name a parent — ${allFemale} all-female ` +
        `(these move father-nameless -> father-silent), ${allMale} all-male ` +
        `(mother-nameless -> mother-silent), ${anyUnreadable} with a parent of ` +
        `unreadable sex (no move — counted in both)`
    );

    for (const fam of FAMILIES) {
      // THREE buckets, not two. `nameOf(p) === null` conflates a record with no
      // such relative indexed at all with one whose relative IS indexed but whose
      // `display.name` is absent from the payload — and the probe header warns
      // about exactly this field. Counting the second as "silent" is what made
      // the keep-silent verdict look 8 records short in two unrelated
      // populations: those records DO carry an indexed relative, so an
      // unmatchable name contradicts them and they are correctly dropped.
      // Resolved once. For the three single-valued families this is exactly
      // `[nameOf]`, so nothing about their numbers changes.
      const namesOf = fam.namesOf ?? ((q: Persona) => {
        const n = fam.nameOf(q);
        return n === null ? [] : [n];
      });
      const named = baseScan.personas.filter((p) => namesOf(p).length > 0);
      const namelessButIndexed = baseScan.personas.filter(
        (p) => namesOf(p).length === 0 && fam.indexedCount(p) > 0
      ).length;
      const trulySilent = baseScan.personas.filter((p) => fam.indexedCount(p) === 0).length;
      const silentInBase = trulySilent;
      // The real name is drawn FROM the data rather than guessed, so the
      // keep-matching leg cannot fail merely because a chosen name is absent
      // from this population.
      const realName = (named[0] ? (namesOf(named[0])[0] ?? "") : "").split(/\s+/)[0] ?? "";

      const classify = async (
        value: string
      ): Promise<{
        total: number;
        match: number;
        conflict: number;
        silent: number;
        nameless: number;
      } | null> => {
        const scan = await mustEnumerate(
          `${pop.base}&q.${fam.param}=${encodeURIComponent(value)}`
        );
        if (scan.personas === null) return null;
        let match = 0;
        let conflict = 0;
        let silent = 0;
        let nameless = 0;
        for (const p of scan.personas) {
          const nms = namesOf(p);
          if (nms.length === 0) {
            if (fam.indexedCount(p) === 0) silent++;
            else nameless++;
          } else if (nms.some((nm) => isHit(nm, value))) match++;
          // A conflict only when NONE of the names the record offers is a hit.
          else conflict++;
        }
        return { total: scan.personas.length, match, conflict, silent, nameless };
      };

      const gib = await classify(GIBBERISH);
      const real = realName ? await classify(realName) : null;
      if (gib === null) {
        console.log(`     ${fam.id.padEnd(7)} NOT MEASURED — a scan could not be completed`);
        continue;
      }
      const silentSharePct = +((silentInBase / baseline) * 100).toFixed(1);
      const retentionPct = +((gib.total / baseline) * 100).toFixed(1);
      rows.push({
        pop: pop.id,
        family: fam.id,
        baselineRows: baseline,
        namedInBaseline: named.length,
        namelessButIndexedInBaseline: namelessButIndexed,
        silentInBaseline: silentInBase,
        silentSharePct,
        gibberish: gib,
        realName,
        real,
        retentionPct,
      });
      console.log(
        `     ${fam.id.padEnd(7)} baseline ${String(baseline).padStart(4)} rows` +
          ` (${named.length} name a ${fam.id}, ${namelessButIndexed} indexed-but-nameless,` +
          ` ${silentInBase} truly silent = ${silentSharePct}%)`
      );
      console.log(
        `             unmatchable name -> ${String(gib.total).padStart(4)} rows` +
          `  match ${gib.match}  CONFLICT ${gib.conflict}  silent ${gib.silent}` +
          `  nameless ${gib.nameless}` +
          `   retention ${retentionPct}%`
      );
      if (real) {
        console.log(
          `             real name "${realName}" -> ${String(real.total).padStart(4)} rows` +
            `  match ${real.match}  CONFLICT ${real.conflict}  silent ${real.silent}`
        );
      }
    }
  }
  record("R", "rows", rows);
  record("R", "parentSexReadability", sexRows);

  if (rows.length === 0) {
    record("R", "verdict:keep-silent", "NOT MEASURED");
    record("R", "verdict:drop-contradicting", "NOT MEASURED");
    record("R", "verdict:keep-matching", "NOT MEASURED");
    record("R", "verdict:retention equals the silent share", "NOT MEASURED");
    console.log("\n  -> NOT MEASURED — no population could be enumerated.");
    return;
  }

  // Every verdict below is a count over a COMPLETE scan, so "0 conflicts" means
  // none exist in the pool rather than none near the top of it.
  const totalConflicts = rows.reduce(
    (a, r) => a + ((r.gibberish as { conflict: number }).conflict ?? 0),
    0
  );
  record(
    "R",
    "verdict:drop-contradicting",
    totalConflicts === 0
      ? "HOLDS — across every enumerated pool, an unmatchable name left zero records naming a different relative"
      : `DOES NOT HOLD — ${totalConflicts} record(s) naming a different relative survived an unmatchable name`
  );
  const keepSilent = rows.every(
    (r) =>
      Math.abs(
        (r.gibberish as { silent: number }).silent - (r.silentInBaseline as number)
      ) <=
      Math.max(2, (r.silentInBaseline as number) * 0.05)
  );
  record(
    "R",
    "verdict:keep-silent",
    keepSilent
      ? "HOLDS — the records retained by an unmatchable name are the ones the baseline is silent about, in the same number"
      : "DOES NOT HOLD — the retained set is not the silent set"
  );
  const keepMatching = rows.some((r) => ((r.real as { match?: number } | null)?.match ?? 0) > 0);
  record(
    "R",
    "verdict:keep-matching",
    keepMatching ? "HOLDS — a real name drawn from the data returns matching records" : "NOT MEASURED"
  );
  // The explanation section S wrongly reported as REFUTED, re-tested on data
  // that can carry the claim.
  const tracks = rows.every(
    (r) => Math.abs((r.retentionPct as number) - (r.silentSharePct as number)) <= 10
  );
  record(
    "R",
    "verdict:retention equals the silent share",
    tracks
      ? "HOLDS — retention under an unmatchable name matches the baseline's silent share in every enumerated population, which is what makes the father/spouse difference an artifact of indexing rather than of the parameter"
      : "DOES NOT HOLD — retention and the silent share diverge"
  );
  console.log("\n  --- verdicts, all from complete scans ---");
  for (const r of rows) {
    console.log(
      `    ${String(r.pop).padEnd(20)} ${String(r.family).padEnd(7)}` +
        ` silent ${String(r.silentSharePct).padStart(5)}%  retention ${String(r.retentionPct).padStart(5)}%` +
        `  conflicts ${(r.gibberish as { conflict: number }).conflict}`
    );
  }
  console.log(
    `    drop-contradicting: ${totalConflicts === 0 ? "HOLDS (0 conflicts anywhere)" : `${totalConflicts} conflicts`}` +
      `   keep-silent: ${keepSilent ? "HOLDS" : "no"}   retention==silent share: ${tracks ? "HOLDS" : "no"}`
  );

  // --- does `.exact` on a SPOUSE name require the spouse to be present? ----
  //
  // Section F answered this for `fatherGivenName` and nothing else: five legs
  // set `q.fatherGivenName.exact=on`, and NO leg anywhere in this file has ever
  // set a spouse `.exact`. The shipped tool descriptions nevertheless gave
  // `spouseGivenNameExact` the firm father wording while hedging mother/parent/
  // other — on the reasoning that section R enumerated spouse too. R does, but R
  // enumerates the UNQUALIFIED term (keep-silent / drop-contradicting), which is
  // a different parameter from the qualifier on top of it.
  //
  // It is the gap that matters most: R measures spouses indexed in 81-92% of
  // marriage records against 10-70% for fathers, so a spouse anchor is the
  // strongest narrowing lever available in the record type most searched.
  //
  // Same shape as F's father test — silent representatives must be ABSENT from
  // the exact set, and a spouse-bearing control must be PRESENT — but read to
  // the end on both sides rather than paged to a cap.
  console.log("\n  --- does .exact on a relative name require that relative to be present? ---");
  // Generalised over FAMILIES. Was spouse-only; father is independently covered by
  // section F, and mother and parent had no measurement at all — which is what
  // left six `*Exact` descriptions reading "Assumed, as `motherGivenNameExact`".
  // The legacy key `spouseExactRequiresPresence` and the spouse verdict string are
  // preserved byte-for-byte: prose cites them and the traceability lint resolves
  // every `R.verdict:...` it finds in a spec against this artifact.
  const exactRows: Array<Record<string, unknown>> = [];
  // POPS OUTER, families inner, so the baseline is enumerated ONCE per population.
  // The first version had the loops the other way round with the enumeration inside
  // both, fetching the same three baselines fifteen times. Correct either way, just
  // wasteful — and it landed in the same run that went from two families to five, so
  // do not read the 46 minutes that run took as this bug's cost alone.
  for (const pop of POPS) {
    const full = await mustEnumerate(pop.base);
    for (const fam of FAMILIES) {
      if (full.personas === null) {
        console.log(`    ${fam.id.padEnd(7)} ${pop.id.padEnd(22)} NOT MEASURED — baseline ${full.why}`);
        exactRows.push({ family: fam.id, pop: pop.id, why: `baseline ${full.why}` });
        continue;
      }
      // A real given name drawn from the data, so the exact search has something to
      // match. Most common wins: it maximises the control's chance of existing
      // without choosing it for the answer it gives.
      // Same resolution as the keep-silent loop: for a multi-valued family the
      // candidate name must be drawn from EVERY member, and the control is any
      // record offering it — not only one whose FIRST member does.
      const namesOf = fam.namesOf ?? ((q: Persona) => {
        const n = fam.nameOf(q);
        return n === null ? [] : [n];
      });
      const counts = new Map<string, number>();
      for (const q of full.personas) {
        for (const g of namesOf(q)) counts.set(g, (counts.get(g) ?? 0) + 1);
      }
      const name = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      const silentReps = full.personas.filter((q) => fam.indexedCount(q) === 0);
      const control = full.personas.find((q) => name !== undefined && namesOf(q).includes(name));
      if (!name || silentReps.length === 0 || control === undefined) {
        const why = !name
          ? `no ${fam.id} given name appears in the baseline at all`
          : silentReps.length === 0
            ? `no ${fam.id}-silent record in the baseline to test with`
            : `no ${fam.id}-bearing control record`;
        console.log(`    ${fam.id.padEnd(7)} ${pop.id.padEnd(22)} NOT MEASURED — ${why}`);
        exactRows.push({ family: fam.id, pop: pop.id, why });
        continue;
      }
      const ex = await mustEnumerate(
        `${pop.base}&q.${fam.param}=${encodeURIComponent(name)}&q.${fam.param}.exact=on`
      );
      if (ex.personas === null) {
        console.log(`    ${fam.id.padEnd(7)} ${pop.id.padEnd(22)} NOT MEASURED — the .exact set was ${ex.why}`);
        exactRows.push({ family: fam.id, pop: pop.id, why: `exact set ${ex.why}` });
        continue;
      }
      const exIds = new Set(ex.personas.map((x) => x.id));
      const silentKept = silentReps.filter((r) => exIds.has(r.id)).length;
      const controlKept = exIds.has(control.id);
      exactRows.push({
        family: fam.id,
        pop: pop.id,
        name,
        baselineRows: full.personas.length,
        exactRows: ex.personas.length,
        silentReps: silentReps.length,
        silentKept,
        controlPresent: controlKept,
      });
      console.log(
        `    ${fam.id.padEnd(7)} ${pop.id.padEnd(22)} name=${name.padEnd(12)} ` +
          `silent ${String(silentReps.length).padStart(4)} kept ${silentKept}   control ${controlKept ? "present" : "ABSENT"}`
      );
    }
  }
  record("R", "exactRequiresPresence", exactRows);
  // Legacy key, unchanged shape: the spouse slice, minus the `family` column it
  // did not have. Dropping it would break every citation of it.
  record(
    "R",
    "spouseExactRequiresPresence",
    exactRows
      .filter((r) => r.family === "spouse")
      .map(({ family: _f, name, ...rest }) => (name === undefined ? rest : { ...rest, spouseName: name }))
  );

  // Recorded rather than omitted: silence in the artifact reads as "nobody
  // asked", and somebody did. RULE 0 applies to a family we chose not to
  // characterise just as much as to a pool we could not enumerate.
  record(
    "R",
    "verdict:other names behave like the four kinship families",
    "NOT MEASURED — `other` is excluded from this section by decision on 2026-08-20. " +
      "It is not a kinship role (`q.otherGivenName` is a co-occurrence search) and it is " +
      "the only multi-valued family, since a register entry names godparents, witnesses " +
      "and bystanders and any of them can satisfy the query. Measured once with a " +
      "single-name accessor and once with an any-name accessor: both put 62 records in " +
      "the conflict bucket (9 Brazil/Bochenek, 53 England/Pocklington) while all four " +
      "kinship families held at zero, which flipped drop-contradicting and " +
      "retention-equals-silent-share. Untested hypothesis for those 62: a co-person with " +
      "no indexed given name satisfies any given-name query through that emptiness, as " +
      "the principal `givenName` floor does. Settle that before re-admitting it."
  );

  for (const fam of FAMILIES) {
    const usable = exactRows.filter((r) => r.family === fam.id && typeof r.silentKept === "number");
    const allDrop = usable.length > 0 && usable.every((r) => r.silentKept === 0 && r.controlPresent === true);
    const anyKept = usable.some((r) => (r.silentKept as number) > 0);
    const noun = fam.id === "spouse" ? "spouse" : "relative";
    const key =
      fam.id === "spouse"
        ? "verdict:spouse .exact requires the spouse to be present"
        : `verdict:${fam.id} .exact requires the relative to be present`;
    record(
      "R",
      key,
      usable.length === 0
        ? `NOT MEASURED — no population produced both a ${fam.id}-silent record and a ${fam.id}-bearing control in a set readable to the end`
        : allDrop
          ? `CONFIRMED — across ${usable.length} population(s) read in full, every ${fam.id}-silent record is absent from the .exact set and the ${fam.id}-bearing control survives`
          : anyKept
            ? `DOES NOT HOLD — a ${fam.id}-silent record survives .exact in ${usable.filter((r) => (r.silentKept as number) > 0).length} of ${usable.length} population(s)`
            : `INCONCLUSIVE — silent records dropped but the control did not survive, so .exact is not selecting on ${noun} presence`
    );
    console.log(`  => ${String(getFig("R", key))}`);
  }
}

// --- SECTION W — wildcards x qualifiers (issue #1093 question 4) ----------

/**
 * RULE 0, in code: read a pool to the END or refuse to characterise it.
 *
 * Returns the personas only when the scan reached a short page. When it did
 * not, `personas` is null and `why` says which of the two failures happened —
 * because they call for different responses. `too-deep` means the POPULATION
 * was chosen badly and the fix is a rarer surname, not a bigger cap; `error`
 * means the run was interrupted and retrying may work.
 *
 * Callers must branch on `personas === null` and record NOT MEASURED. That is
 * the whole point: a proportion is arithmetic that cannot tell whether its
 * denominator was the population or the first page of it, so the guard has to
 * sit between the fetch and the arithmetic rather than in a comment above it.
 */
async function mustEnumerate(
  query: string,
  cap = DEPTH_LIMIT
): Promise<
  | { personas: Persona[]; total: number | null; why: null }
  | { personas: null; total: number | null; why: "too-deep" | "error" | "duplicates" }
> {
  const PAGE = 100;
  const out: Persona[] = [];
  let total: number | null = null;
  for (let offset = 0; ; offset += PAGE) {
    if (offset + PAGE > Math.min(cap, DEPTH_LIMIT)) {
      return { personas: null, total, why: "too-deep" };
    }
    const r = await search(`${query}&count=${PAGE}&offset=${offset}&${REQUIRE_SWITCH}`);
    if (errored(r)) return { personas: null, total, why: "error" };
    total ??= r.total;
    out.push(...r.personas);
    if (r.personas.length < PAGE) {
      // Rows are not personas. Some queries re-serve the same record at many
      // offsets (documented in section N: 4,900 rows for 1,100 distinct), and
      // every proportion downstream divides by this length. Both current
      // populations come back duplicate-free, but nothing checked that until
      // now, and a re-serving pool would have produced plausible wrong shares.
      const distinct = new Set(out.map((x) => x.id)).size;
      if (distinct !== out.length) {
        // NOT "error": an errored run may succeed on retry, and a caller is told
        // as much. A pool that re-serves records will re-serve them every time —
        // section N records this as a property of date-range queries — so the
        // reason has to say "choose a different population", not "try again".
        return { personas: null, total, why: "duplicates" };
      }
      return { personas: out, total, why: null };
    }
  }
}

/**
 * Read a pool IN FULL and return its persona ids.
 *
 * PREFER `mustEnumerate` for anything that ends in a proportion or an absence:
 * this one hands back a partial set with `complete: false`, and a caller who
 * forgets to branch on that gets a silent sample. This exists because two
 * sections need the IDS rather than the personas; both check `complete`.
 *
 * `complete: false` means the caller must not conclude absence from the result:
 * either a page errored, or the pool is deeper than `cap`. Absence inside an
 * incomplete scan is the ABSENT-vs-OUTRANKED trap, which is what forced this
 * helper to exist — a sampled top-100 cannot answer a membership question.
 *
 * `cap` also protects the FamilySearch depth limit: offset + count must stay
 * at or below 4999, so no scan may exceed that regardless of what is asked.
 */
const DEPTH_LIMIT = 4999;
async function scanIds(
  query: string,
  cap: number
): Promise<{
  ids: Set<string>;
  complete: boolean;
  total: number | null;
  /** Why the scan stopped — `cap` and `error` are different problems and the
   *  caller's message used to conflate them into "pool too deep to scan". */
  reason: "complete" | "cap" | "error";
  /** Rows FETCHED, which is NOT `ids.size`: some queries return the same
   *  persona at many offsets, and the gap between the two is the only way to
   *  see it. Reporting `ids.size` as "rows read" hid exactly that. */
  rows: number;
}> {
  const PAGE = 100;
  const ids = new Set<string>();
  let offset = 0;
  let rows = 0;
  let total: number | null = null;
  for (;;) {
    if (offset + PAGE > Math.min(cap, DEPTH_LIMIT)) {
      return { ids, complete: false, total, reason: "cap", rows };
    }
    const r = await search(`${query}&count=${PAGE}&offset=${offset}&${REQUIRE_SWITCH}`);
    if (errored(r)) return { ids, complete: false, total, reason: "error", rows };
    if (total === null) total = r.total;
    rows += r.personas.length;
    for (const p of r.personas) ids.add(p.id);
    // A short page is the end of the pool — the only reliable terminator, since
    // `total` counts records while a page yields personas.
    if (r.personas.length < PAGE) return { ids, complete: true, total, reason: "complete", rows };
    offset += PAGE;
  }
}

/**
 * Last whitespace-separated token of an index name, lowercased.
 *
 * Crude on purpose. It only has to separate `Smith` from `Smyth` in a tally,
 * and every alternative (parsing name parts out of the GedcomX display block)
 * would add a failure mode for no gain at this resolution. Suffixes like `Jr`
 * would land in the wrong bucket, which is why the verdicts below key off
 * whether a SPECIFIC expected form is present, never off the bucket count.
 */
function surnameToken(full: string): string {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  return (parts[parts.length - 1] ?? "").toLowerCase().replace(/[^a-z]/g, "");
}

/** Does any sampled record carry this surname form? */
function hasSurnameForm(r: Hit, form: string): boolean {
  return r.personas.some((p) => surnameToken(p.matchedName) === form);
}

async function sectionW(): Promise<void> {
  console.log("\n=== W. Wildcards x qualifiers (issue #1093 question 4) ===");
  console.log(
    "  name-search-mechanics.md has asserted since before this branch that a\n" +
      "  wildcard 'still expands but no additional variant interpretation is\n" +
      "  applied' under .exact=on. Nothing measured it. This section does."
  );

  // A HARD-scoped population, chosen with `dev/explore-wildcard-scope.ts`.
  //
  // The place qualifier is what makes it small: unqualified, this same scope
  // returns millions and the county contributes nothing (Norfolk and Cornwall
  // measured 0.001% apart). With `.exact=on` on the place the fuzzy `Smith` pool
  // is ~1,100 — small enough to READ IN FULL, which is the only way a membership
  // question can be answered. Every leg below scans; none samples.
  const scope =
    "&q.marriageLikePlace=Norfolk,%20England&q.marriageLikePlace.exact=on" +
    "&q.marriageLikeDate.from=1850&q.marriageLikeDate.to=1855";
  const SCAN_CAP = 3000;
  const SAMPLE = 100;

  // The three-way membership test. `Smith` and `Smyth` are the probe pair:
  // `Sm?th` matches both literally, so if `.exact=on` still returns both, the
  // wildcard expanded under exact; if exact drops `Smyth` from the LITERAL
  // `Smith` query but keeps it under `Sm?th`, the two mechanisms are separable.
  const cases: Array<[string, string, string]> = [
    ["Smith, fuzzy", "Smith", "smithFuzzy"],
    ["Smith, .exact=on", "Smith", "smithExact"],
    ["Sm?th, fuzzy", "Sm%3Fth", "wildFuzzy"],
    ["Sm?th, .exact=on", "Sm%3Fth", "wildExact"],
  ];
  const seen: Record<string, { smith: boolean | null; smyth: boolean | null; total: number | null }> = {};
  for (const [label, value, key] of cases) {
    const exact = key.endsWith("Exact") ? "&q.surname.exact=on" : "";
    const r = await search(
      `q.surname=${value}${exact}${scope}&count=${SAMPLE}&${REQUIRE_SWITCH}`
    );
    const entry = {
      // `null`, NOT `false`. `false` means "the sample did not contain this
      // form"; a failed request means we do not know. Collapsing the two let a
      // 400 or an unparseable body publish
      // `verdict:top-N sampling = PRODUCES A FALSE NEGATIVE` from a request that
      // never ran — the file's own `errored()` docblock forbids exactly this
      // ("a measurement that cannot be taken must say NOT MEASURED, never the
      // opposite"), and every other section guards it.
      smith: errored(r) ? null : hasSurnameForm(r, "smith"),
      smyth: errored(r) ? null : hasSurnameForm(r, "smyth"),
      total: errored(r) ? null : r.total,
    };
    seen[key] = entry;
    record("W", key, {
      total: entry.total,
      sampled: r.personas.length,
      smithPresent: entry.smith,
      smythPresent: entry.smyth,
      forms: errored(r) ? null : tally(r.personas.map((p) => surnameToken(p.matchedName))),
      error: r.error,
    });
    console.log(
      `  ${label.padEnd(20)}${fmt(entry.total)}  sampled=${String(r.personas.length).padStart(3)}` +
        `  Smith=${entry.smith === null ? "?" : entry.smith ? "Y" : "n"} Smyth=${entry.smyth ? "Y" : "n"}` +
        `${r.error === null ? "" : `  [${r.error}]`}`
    );
  }

  // The rows above are SAMPLES and no verdict is derived from them. An earlier
  // version recorded `verdict:wildcard expands under .exact` from that sample;
  // in this hard-scoped population it read DOES NOT EXPAND while the full scan
  // below finds the variant 10/10 present — two contradictory verdicts in one
  // artifact, either of which could have been quoted. The sample is kept only as
  // the demonstration at the end of this section, never as evidence.

  // Does .exact remove fuzzy variant expansion? By MEMBERSHIP, not by
  // subtracting totals.
  //
  // Bind the actual `Smyth` records inside the scope, then read each pool in
  // full and ask whether those ids are in it. An earlier version of this section
  // sampled a 2.6M pool and printed "variant expansion NOT killed" from a test
  // that could not fire — the ABSENT-vs-OUTRANKED trap. A full scan cannot make
  // that mistake: absence in a complete scan is real absence.
  const smyth = await scanIds(`q.surname=Smyth&q.surname.exact=on${scope}`, SCAN_CAP);
  const smithFuzzyScan = await scanIds(`q.surname=Smith${scope}`, SCAN_CAP);
  const smithExactScan = await scanIds(`q.surname=Smith&q.surname.exact=on${scope}`, SCAN_CAP);
  const wildExactScan = await scanIds(
    `q.surname=${encodeURIComponent("Sm?th")}&q.surname.exact=on${scope}`,
    SCAN_CAP
  );
  const inPool = (pool: Set<string>): number =>
    [...smyth.ids].filter((id) => pool.has(id)).length;
  const scansComplete =
    smyth.complete && smithFuzzyScan.complete && smithExactScan.complete && wildExactScan.complete;
  const smythCount = smyth.ids.size;
  const inFuzzy = inPool(smithFuzzyScan.ids);
  const inExact = inPool(smithExactScan.ids);
  const inWildExact = inPool(wildExactScan.ids);
  record("W", "membership", {
    scansComplete,
    smythRecordsBound: smythCount,
    smythIdsInSmithFuzzy: inFuzzy,
    smythIdsInSmithExact: inExact,
    smythIdsInWildcardExact: inWildExact,
    smithFuzzyScanned: smithFuzzyScan.ids.size,
    smithExactScanned: smithExactScan.ids.size,
    wildcardExactScanned: wildExactScan.ids.size,
  });
  console.log(
    `\n  membership (full scans, scope = marriage Norfolk place-exact 1850-1855):\n` +
      `    Smyth records bound            ${smythCount}\n` +
      `    ...of those, in Smith FUZZY    ${inFuzzy} / ${smythCount}   (pool ${smithFuzzyScan.ids.size})\n` +
      `    ...of those, in Smith EXACT    ${inExact} / ${smythCount}   (pool ${smithExactScan.ids.size})\n` +
      `    ...of those, in Sm?th EXACT    ${inWildExact} / ${smythCount}   (pool ${wildExactScan.ids.size})\n` +
      `    all scans complete             ${scansComplete ? "yes" : "NO — verdicts below are NOT MEASURED"}`
  );
  const variantRemoved =
    scansComplete && smythCount > 0 ? inFuzzy > 0 && inExact === 0 : null;
  record(
    "W",
    "verdict:.exact removes variant expansion",
    variantRemoved === null ? "NOT MEASURED" : variantRemoved ? "REMOVES" : "DOES NOT REMOVE"
  );
  const wildcardRestores =
    scansComplete && smythCount > 0 ? inWildExact > 0 : null;
  record(
    "W",
    "verdict:wildcard restores the variant under .exact",
    wildcardRestores === null ? "NOT MEASURED" : wildcardRestores ? "RESTORES" : "DOES NOT RESTORE"
  );

  // Why this section scans instead of sampling, measured on itself.
  //
  // The `Sm?th` + exact top-100 sample above contains no `Smyth` at all, while
  // the full scan of the SAME query finds every one of the bound records. Had
  // the verdict been read off the sample it would have said the wildcard does
  // not expand — the exact inverse. This is the concrete instance of the rule
  // section E states in the abstract: a top-N tally cannot tell ABSENT from
  // OUTRANKED, so a membership question needs a complete scan or no answer.
  const sampleSaidAbsent = seen.wildExact?.smyth === false;
  record("W", "samplingCheck", {
    sampleSize: SAMPLE,
    poolScanned: wildExactScan.ids.size,
    smythFoundBySample:
      seen.wildExact?.smyth === true ? "yes" : seen.wildExact?.smyth === false ? "no" : "errored",
    smythFoundByFullScan: inWildExact,
  });
  record(
    "W",
    "verdict:top-N sampling on this question",
    !scansComplete || smythCount === 0
      ? "NOT MEASURED"
      : seen.wildExact?.smyth === null || seen.wildExact?.smyth === undefined
        ? "NOT MEASURED — the sampled page errored, so it cannot be compared with the full scan"
        : sampleSaidAbsent && inWildExact > 0
          ? "PRODUCES A FALSE NEGATIVE — sample found none, full scan found them all"
          : "AGREED WITH THE FULL SCAN"
  );

  if (!scansComplete || smythCount === 0) {
    console.log(
      "  -> NOT MEASURED — a scan was incomplete or no Smyth record was bound.\n" +
        "     Do not quote a wildcard/qualifier claim from this run."
    );
  } else {
    console.log(
      `  -> .exact on a LITERAL name: variant expansion ${variantRemoved ? "REMOVED" : "NOT removed"}` +
        ` — the bound Smyth records are in fuzzy Smith's full pool (${inFuzzy}/${smythCount})` +
        ` and ${inExact === 0 ? "absent from" : `still in (${inExact}/${smythCount})`}` +
        ` exact Smith's full pool. Membership over complete scans, not sampling.`
    );
    console.log(
      `  -> the same wildcard under .exact ${wildcardRestores ? "RESTORES" : "does NOT restore"}` +
        ` them (${inWildExact}/${smythCount} present), so the wildcard expands while` +
        ` exact is on.`
    );
    console.log(
      "  => Q4: the two mechanisms are INDEPENDENT. `.exact=on` suppresses variant\n" +
        "     interpretation but does NOT suppress wildcard expansion — which is what\n" +
        "     name-search-mechanics.md has claimed all along."
    );
  }

  // NEGATIVE CONTROL for the leg above, and the reason it can be trusted.
  //
  // The worry: if `?` were passed through as a LITERAL character rather than a
  // wildcard, `Sm?th` + `.exact=on` would demand an index entry spelled exactly
  // "Sm?th" and return ~0 — so a large count could only mean the term was being
  // ignored outright, which would make the whole leg meaningless. Two facts rule
  // that out together: the wildcard pool under exact is non-empty and contains
  // records whose surname is NOT the literal pattern (so `?` is not literal), and
  // a nonsense stem carrying the same `?` returns 0 (so the term is NOT being
  // ignored — the qualifier and the pattern are both binding).
  const nonsense = await search(
    `q.surname=${encodeURIComponent("Zq?zzyrbl")}&q.surname.exact=on&count=3&${REQUIRE_SWITCH}`
  );
  const nonsenseTotal = measuredTotal(nonsense.total) ? nonsense.total : null;
  const wildPoolSize = wildExactScan.ids.size;
  record("W", "nonsenseWildcardExact", { total: nonsenseTotal, error: nonsense.error });
  record(
    "W",
    "verdict:? is a wildcard, not a literal",
    nonsenseTotal === null || !wildExactScan.complete
      ? "NOT MEASURED"
      : wildPoolSize > 0 && inWildExact > 0 && nonsenseTotal === 0
        ? "CONFIRMED"
        : "NOT CONFIRMED"
  );
  console.log(
    `  control: nonsense stem with the same '?' + exact -> ${fmt(nonsense.total)}` +
      `${
        nonsenseTotal === 0 && wildPoolSize > 0 && inWildExact > 0
          ? "  => '?' binds as a wildcard (it matched non-literal surnames) AND the term is not ignored"
          : "  => control INCONCLUSIVE; do not lean on the wildcard leg"
      }`
  );

  // The structural rules in that same table, none of which any probe checked.
  // A 400 here is a RESULT, so these read the body message like section A does.
  //
  // What this block can and cannot conclude: ACCEPTED is not the same as
  // "the documented limit does not exist" — the API could accept the string and
  // silently ignore the wildcard. The usable signal is COMPARATIVE. `Sm*`
  // returning MORE than `Smi*` means the two-letter stem really did expand more
  // broadly, which is what makes it evidence against a minimum-three-letter
  // rule; a five-star pattern returning a DIFFERENT count from its four-star
  // prefix means the fifth star was honoured rather than dropped.
  console.log("\n  documented wildcard rules, checked:");
  const rules: Array<[string, string, string]> = [
    ["min 3 non-wildcard letters: Sm*", "Sm*", "minLettersTwo"],
    ["min 3 non-wildcard letters: Smi*", "Smi*", "minLettersThree"],
    ["leading wildcard: *bou", "*bou", "leadingStar"],
    ["four stars: S*m*t*h*", "S*m*t*h*", "fourStars"],
    ["five stars: S*m*t*h*s*", "S*m*t*h*s*", "fiveStars"],
  ];
  const ruleTotals: Record<string, number | null> = {};
  for (const [label, value, key] of rules) {
    const r = await search(`q.surname=${encodeURIComponent(value)}&count=3&${REQUIRE_SWITCH}`);
    ruleTotals[key] = measuredTotal(r.total) ? r.total : null;
    record("W", key, { total: ruleTotals[key], error: r.error });
    console.log(
      `    ${label.padEnd(38)}${r.error === null ? `results=${fmt(r.total)}` : `REJECTED: ${r.error}`}`
    );
  }
  const two = ruleTotals.minLettersTwo;
  const three = ruleTotals.minLettersThree;
  const four = ruleTotals.fourStars;
  const five = ruleTotals.fiveStars;
  record(
    "W",
    "verdict:minimum 3 non-wildcard letters",
    two === null || three === null
      ? "NOT MEASURED"
      : two > three
        ? "NOT ENFORCED — a 2-letter stem expanded MORE broadly than a 3-letter one"
        : "CONSISTENT WITH A LIMIT"
  );
  record(
    "W",
    "verdict:four-star maximum",
    four === null || five === null
      ? "NOT MEASURED"
      : five !== four
        ? "NOT ENFORCED — a 5th star changed the count, so it was honoured"
        : "CONSISTENT WITH A LIMIT"
  );
  console.log(
    `    -> minimum-3-letters: ${
      two === null || three === null
        ? "NOT MEASURED"
        : two > three
          ? `NOT ENFORCED (Sm* ${fmt(two)} > Smi* ${fmt(three)})`
          : "consistent with a limit"
    }`
  );
  console.log(
    `    -> four-star maximum: ${
      four === null || five === null
        ? "NOT MEASURED"
        : five !== four
          ? `NOT ENFORCED (5 stars ${fmt(five)} != 4 stars ${fmt(four)})`
          : "consistent with a limit"
    }`
  );
}

// --- SECTION X — the 947 -> 1,478 "widening" (issues #1093 / #1088) -------

/**
 * The observation this whole issue was opened to explain, reconciled.
 *
 * #1088 recorded a `record_search` call whose `totalMatches` ROSE from 947 to
 * 1,478 when a parent anchor was added, and #1093 inherited it as "confirm the
 * broadening effect": an unqualified relative name was assumed to act as a
 * soft, score-boosting criterion that pulls in extra candidates.
 *
 * Reading the two calls out of the source transcript
 * (`eval/runlogs/e2e/manoel-oliveira-daughter/run-2026-07-31_16-26-10.transcript.md`,
 * deleted from the tree in e9df38f8 — recover with
 * `git show e9df38f8^:<path>`) shows they were not the same query:
 *
 *   947  -> surname, givenName, collectionId, recordType, recordCountry,
 *           marriageYearFrom=1924, marriageYearTo=1928
 *   1478 -> surname, givenName, collectionId, recordType, recordCountry,
 *           fatherGivenName, fatherSurname          <-- NO year range
 *
 * The 1924-1928 marriage-year range was DROPPED in the same call that added the
 * father anchor. The issue's own table describes 1,478 as "same **plus**
 * `fatherGivenName` + `fatherSurname`", which is what made the confound
 * invisible. The control is already in that transcript: a *mother*-surname call
 * with the year range likewise dropped returned 1,443 — a comparable rise with
 * no father anchor at all. The rise tracks the removed date filter.
 *
 * This section holds the query constant and moves one variable at a time, which
 * is what the original comparison did not do. Absolute totals will have drifted
 * since 2026-07-31; the SIGNS of the two effects are the finding.
 */
async function sectionX(): Promise<void> {
  console.log("\n=== X. The 947 -> 1,478 widening, as a 2x2 (issues #1093/#1088) ===");
  const base =
    "q.surname=Oliveira&q.givenName=Josefa&f.collectionId=2177294" +
    "&f.recordType=1&q.recordCountry=Brazil";
  const YEARS = "&q.marriageLikeDate.from=1924&q.marriageLikeDate.to=1928";
  const FATHER = "&q.fatherGivenName=Melquiades&q.fatherSurname=Oliveira";
  const MOTHER = "&q.motherSurname=Damasceno";

  const cells: Array<[string, string, string]> = [
    ["years, no anchor   (the 947 cell)", `${base}${YEARS}`, "yearsNoAnchor"],
    ["years + father     (never run)", `${base}${YEARS}${FATHER}`, "yearsFather"],
    ["no years, no anchor(isolates years)", base, "noYearsNoAnchor"],
    ["no years + father  (the 1478 cell)", `${base}${FATHER}`, "noYearsFather"],
    ["no years + mother  (the 1443 control)", `${base}${MOTHER}`, "noYearsMother"],
  ];
  const got: Record<string, number | null> = {};
  for (const [label, q, key] of cells) {
    const r = await search(`${q}&count=3&${REQUIRE_SWITCH}`);
    // `measuredTotal`, not `usableTotal`: a father anchor legitimately returning
    // 0 is a result, and treating it as missing would erase the finding. An
    // errored Hit already carries `total: null`, which fails this guard.
    const total = measuredTotal(r.total) ? r.total : null;
    got[key] = total;
    record("X", key, total);
    console.log(`  ${label.padEnd(38)}${fmt(r.total)}${r.error === null ? "" : `  [${r.error}]`}`);
  }

  const a = got.yearsNoAnchor;
  const b = got.yearsFather;
  const c = got.noYearsNoAnchor;
  const d = got.noYearsFather;
  // Every verdict below is derived from the pair it names, and any missing leg
  // yields NOT MEASURED — never a direction.
  const dir = (from: number | null, to: number | null): string =>
    from === null || to === null ? "NOT MEASURED" : to < from ? "NARROWS" : to > from ? "WIDENS" : "NO CHANGE";
  const anchorAtConstantQuery = dir(a, b);
  const yearRemoval = dir(a, c);
  record("X", "verdict:father anchor at constant query", anchorAtConstantQuery);
  record("X", "verdict:dropping the year range", yearRemoval);
  record(
    "X",
    "verdict:1478 explained by the dropped year range",
    a === null || b === null || c === null || d === null
      ? "NOT MEASURED"
      : b < a && c > a
        ? "CONFIRMED"
        : "NOT CONFIRMED"
  );
  if (a !== null && b !== null) {
    record("X", "anchorDeltaPct", Number((((b - a) / a) * 100).toFixed(1)));
  }
  console.log(
    `\n  -> adding the father anchor with the query otherwise HELD CONSTANT: ${anchorAtConstantQuery}` +
      `${a !== null && b !== null ? ` (${fmt(a)} -> ${fmt(b)})` : ""}`
  );
  console.log(
    `  -> dropping the year range alone, no anchor: ${yearRemoval}` +
      `${a !== null && c !== null ? ` (${fmt(a)} -> ${fmt(c)})` : ""}`
  );
  if (a !== null && b !== null && c !== null && d !== null) {
    console.log(
      b < a && c > a
        ? `  -> CONFIRMED: the anchor narrows; the year range is what widened. The 1,478 figure\n` +
            `     is a confounded comparison, not evidence that a relative name broadens a search.\n` +
            `     Anything reasoning from "the parent anchor widened it" (issue #1089) rests on it.`
        : `  -> NOT CONFIRMED — this run does not reproduce the confound explanation.\n` +
            `     Do NOT write the reconciliation into the docs on this run.`
    );
  } else {
    console.log("  -> NOT MEASURED — a cell is missing; do not quote this section.");
  }
}

// --- SECTION Y — does the year-range behaviour generalise past BIRTH? -----

/**
 * Sections H and N measured `q.birthLikeDate` and NOTHING ELSE. Two findings
 * came out of them:
 *
 *   1. an unqualified range does NOT require an indexed year — year-silent
 *      records are retained;
 *   2. adding `.exact=on` DROPS the year-silent records.
 *
 * The docs currently scope both to birth, because that is all that was read.
 * The lead states the behaviour generalises to the other event families, and
 * that is very likely right — but "very likely right" is what the broadening
 * effect, two wildcard-scope rules and the `Wm` abbreviation drop all were
 * before enumeration refuted them. So it is measured here instead of asserted,
 * per RULE 0 and one family at a time.
 *
 * TWO TRAPS, both of which earlier drafts of section H fell into:
 *
 *   - PERSONA-silence is not RECORD-silence. `q.<event>Date` filters the
 *     RECORD, so a household whose matched persona carries no year can still
 *     match on a sibling's. Silence is therefore computed over every person on
 *     the record (`allDated`, any `personIdx`), not over `persons[0]`.
 *   - A year can live ONLY on `display`, never as a typed fact. Reading facts
 *     alone manufactures silent rows that are not silent — and it errs toward
 *     making "a range tolerates silence" look truer. `allDated` carries both.
 *
 * A family whose unqualified set contains no silent rows at all is NOT
 * MEASURED, not "generalises": with nothing to drop, both behaviours predict
 * an identical result and the test cannot discriminate.
 */
const YEAR_FAMILIES: Array<{
  family: string;
  /** The `q.*` date parameter. Note residence is `residenceDate`, not `residenceLikeDate`. */
  param: string;
  /** Matches `allDated.kind` — fact-type tails AND `display` keys. */
  kind: RegExp;
  /**
   * `f.recordType` for this family, from RECORD_TYPE_TO_INT in
   * `src/tools/record-search.ts`. This is the anchor that makes the pool
   * enumerable, and it is deliberately NOT a date or place term: anchoring on
   * the family's own place field would confound the thing being measured.
   */
  recordType: number;
}> = [
  { family: "birth", param: "q.birthLikeDate", kind: /^(Birth|Christening|Baptism|birthDate)$/i, recordType: 0 },
  { family: "death", param: "q.deathLikeDate", kind: /^(Death|Burial|Cremation|deathDate)$/i, recordType: 2 },
  { family: "marriage", param: "q.marriageLikeDate", kind: /^(Marriage|marriageDate)$/i, recordType: 1 },
  { family: "residence", param: "q.residenceDate", kind: /^(Residence|Census|residenceDate)$/i, recordType: 3 },
];

/**
 * Rare surname + country pairs. A bare surname plus a range does NOT narrow
 * enough — the first run of this section measured 13k-7M and refused all four
 * families — so the country anchor is load-bearing.
 */
const YEAR_CANDIDATES = [
  "q.surname=Pocklington&q.recordCountry=England",
  "q.surname=Bochenek&q.recordCountry=Brazil",
  "q.surname=Bickerdike&q.recordCountry=England",
  "q.surname=Geach&q.recordCountry=England",
  "q.surname=Mingazzini&q.recordCountry=Italy",
  "q.surname=Zsigmondy&q.recordCountry=Hungary",
];

/** Narrowest first: the first window that enumerates is the one used. */
const YEAR_WINDOWS: Array<[number, number]> = [
  [1850, 1854],
  [1850, 1859],
  [1840, 1880],
];
/** Short enough to read to the end at 100/page without hitting the depth limit. */
const YEAR_ENUMERABLE = 600;
/**
 * Fewest genuinely year-silent rows that may carry a directional verdict.
 *
 * Hoisted so BOTH instruments provably use the same number. It used to be a
 * local of the secondary test, and when the primary needed a floor the
 * temptation was to pick a fresh one that happened to admit the primary's
 * residue — which is the same move that already produced one wrong headline
 * here (a threshold loosened after seeing the data). One constant, both users.
 */
const YEAR_MIN_SILENT = 5;

async function sectionY(): Promise<void> {
  console.log("\n=== SECTION Y — does the year-range behaviour generalise past birth? ===");
  console.log(
    `  Testing ${YEAR_FAMILIES.length} event families.` +
      `  Silence is computed RECORD-level, from facts AND display dates.\n`
  );

  // ---- PRIMARY INSTRUMENT: the impossible range -------------------------
  //
  // The payload test below asks "does this row carry a date?", and for three of
  // the four families the honest answer is "the payload does not say" — which
  // is why they all report NOT MEASURED. This asks the index instead, and it is
  // section H's own instrument rather than a new one.
  //
  // A record in an 1840s-1880s English or Brazilian pool cannot genuinely hold a
  // 1700-1705 event date. So if an unqualified `<family>Date.from=1700&.to=1705`
  // still returns rows, those rows matched DESPITE the range — the range
  // tolerated their silence. Adding `.exact=on` then answers whether exactness
  // removes them. Neither question touches the payload, so the marriage blind
  // spot (15 of 469 rows carrying a marriage date) does not apply.
  //
  // The enumeration is the control: if any returned row actually carries an
  // in-range year, the population was wrong and the row is not evidence.
  // ONE window, and the classification below is what makes it enough.
  //
  // This was a three-element list with a comment claiming "tried in order; the
  // first window with NO genuinely in-range row is used". That procedure was
  // real once, was replaced when the loop moved to iterate all POOLS instead,
  // and the comment was left behind describing a control that no longer
  // existed — only `[0]` was ever read. A stale comment asserting a safeguard
  // is worse than none, so the list is now a single value.
  //
  // Searching for a window that "clears" is also the wrong instinct: it tunes
  // the instrument until it yields the answer. What actually separates fuzz
  // from silence is classifying the rows, not moving the window — a row with no
  // date at all matches EVERY window, so once silence is measured directly the
  // window stops mattering.
  const IMP_WINDOW: [number, number] = [1500, 1505];
  console.log("  --- primary: impossible-range tolerance (asks the index, not the payload) ---");
  const impRows: Array<Record<string, unknown>> = [];
  // EVERY population, not the first that answers. A single pool returning zero
  // tolerated rows cannot tell "this family requires a year" from "this pool
  // happens to have none", and the claim at stake is a negative one.
  //
  // The "calibration" this section once claimed was not one. It read: birth
  // reproduces section H's known result — 11 rows retained, none genuinely in
  // range, all removed by `.exact` — and that was taken to license reading the
  // other families off the same instrument. Checked against raw payloads on
  // 2026-08-11, all 11 of those rows carry a dated birth-like fact 33-74 years
  // OUTSIDE the window and exactly 0 are year-silent. The instrument was
  // measuring range fuzz in the very family it was supposed to be calibrated
  // on, so it never reproduced H's silence result at all.
  //
  // Marriage was the tell and was misread: 20 rows at 1700-1705, 0 at
  // 1500-1505. That window-dependence is the signature of fuzz, not silence —
  // a date-less row matches every window. The response then was to pick the
  // window; the response now is to classify the rows.
  const [IMP_FROM, IMP_TO] = IMP_WINDOW;
  for (const fam of YEAR_FAMILIES) {
    const anchor = `&f.recordType=${fam.recordType}`;
    const imp = `&${fam.param}.from=${IMP_FROM}&${fam.param}.to=${IMP_TO}`;
    const perPool: Array<Record<string, unknown>> = [];

    for (const cand of YEAR_CANDIDATES) {
      const base = `${cand}${anchor}`;
      const label = cand.replace(/q\.surname=|q\.recordCountry=/g, "").replace("&", "/");
      const pool = await search(`${base}&count=1&${REQUIRE_SWITCH}`);
      if (errored(pool) || (pool.total ?? 0) === 0) {
        perPool.push({ pool: label, why: errored(pool) ? "error" : "empty pool" });
        continue;
      }
      const unq = await search(`${base}${imp}&count=1&${REQUIRE_SWITCH}`);
      const ex = await search(`${base}${imp}&${fam.param}.exact=on&count=1&${REQUIRE_SWITCH}`);
      if (errored(unq) || errored(ex)) {
        perPool.push({ pool: label, why: "error on the pair" });
        continue;
      }
      const tolerated = unq.total ?? 0;
      const survived = ex.total ?? 0;
      // THREE-WAY, not two-way. The old version asked only "is this row
      // genuinely in range?" and called everything else SILENT — so a
      // christening dated 60 years outside the window counted as evidence that
      // the range tolerates silence. It does not: it is range FUZZ. Measured
      // live 2026-08-11, all 11 birth rows in Pocklington/England and all 3 in
      // Bochenek/Brazil are dated OUT of range (median 63y and 138y off) and
      // exactly ZERO are silent — so the family this instrument was "calibrated"
      // on contained no silence at all.
      //
      // Only `silent` — carries no date of this family anywhere on the record —
      // can answer the question the verdict names, and being date-less it
      // matches ANY impossible window, which is what makes it window-independent
      // where the fuzz rows were not.
      let inRange: number | null = null;
      let outOfRange: number | null = null;
      let silent: number | null = null;
      let silentKept: number | null = null;
      if (tolerated > 0 && tolerated <= YEAR_ENUMERABLE) {
        const full = await mustEnumerate(`${base}${imp}`, YEAR_ENUMERABLE + 100);
        if (full.personas !== null) {
          const famYears = (p: Persona): number[] =>
            p.allDated
              .filter((d) => fam.kind.test(d.kind) && d.year !== null)
              .map((d) => d.year as number);
          const cls = full.personas.map((p) => ({ p, ys: famYears(p) }));
          inRange = cls.filter((c) => c.ys.some((y) => y >= IMP_FROM && y <= IMP_TO)).length;
          outOfRange = cls.filter(
            (c) => c.ys.length > 0 && !c.ys.some((y) => y >= IMP_FROM && y <= IMP_TO)
          ).length;
          const silentRows = cls.filter((c) => c.ys.length === 0).map((c) => c.p);
          silent = silentRows.length;
          // Which SILENT rows `.exact` kept — by id, so it is membership rather
          // than a difference of two totals that count different things.
          if (survived > 0 && survived <= YEAR_ENUMERABLE) {
            const exFull = await mustEnumerate(
              `${base}${imp}&${fam.param}.exact=on`,
              YEAR_ENUMERABLE + 100
            );
            if (exFull.personas !== null) {
              const exIds = new Set(exFull.personas.map((p) => p.id));
              silentKept = silentRows.filter((p) => exIds.has(p.id)).length;
            }
          } else if (survived === 0) {
            silentKept = 0;
          }
        }
      }
      perPool.push({
        pool: label,
        poolTotal: pool.total,
        tolerated,
        survived,
        inRange,
        outOfRange,
        silent,
        silentKept,
      });
      console.log(
        `    ${fam.family.padEnd(10)} ${label.padEnd(22)} pool ${String(fmt(pool.total)).trim().padStart(7)}` +
          `  retained ${String(tolerated).padStart(4)} -> .exact ${String(survived).padStart(4)}` +
          (tolerated === 0
            ? "  (nothing retained — no silence to test here)"
            : silent === null
              ? "  (too deep to enumerate — excluded)"
              : `  [in-range ${inRange} | fuzz ${outOfRange} | SILENT ${silent}${silentKept === null ? "" : `, .exact kept ${silentKept}`}]`)
      );
    }

    // Only pools that were read to the end can be classified, so only they can
    // contribute. A pool too deep to enumerate is excluded — and named as such,
    // rather than being described as "uncontrolled" for a reason that did not
    // always apply to it.
    const classified = perPool.filter((p) => typeof p.silent === "number");
    const excluded = perPool.filter(
      (p) => typeof p.tolerated === "number" && (p.tolerated as number) > 0 && p.silent === null
    ).length;
    const totalSilent = classified.reduce((s, p) => s + (p.silent as number), 0);
    const totalFuzz = classified.reduce((s, p) => s + ((p.outOfRange as number) ?? 0), 0);
    const withSilentMeasured = classified.filter(
      (p) => (p.silent as number) > 0 && typeof p.silentKept === "number"
    );
    const totalSilentKept = withSilentMeasured.reduce((s, p) => s + (p.silentKept as number), 0);
    const measurableSilent = withSilentMeasured.reduce((s, p) => s + (p.silent as number), 0);
    const caveat = excluded ? ` (${excluded} pool(s) excluded — too deep to enumerate and classify)` : "";

    // The SAME floor the secondary instrument uses. Deliberately not a lower one
    // chosen to admit this section's residue: an earlier gate here was loosened
    // after seeing the data and flipped the verdict, on a justification that
    // compared tolerated/pool against survived/tolerated — two different
    // quantities. Birth's real survived-over-tolerated is 0 (here, and 0 of 693
    // in section N), so zero survivors is exactly what birth passes.
    const MIN_SILENT_PRIMARY = YEAR_MIN_SILENT;
    let verdict: string;
    if (!classified.length) {
      verdict = `NOT MEASURED — no pool could be enumerated and classified${caveat}`;
    } else if (totalSilent === 0) {
      verdict =
        `NO SILENCE OBSERVED — every one of the ${totalFuzz} row(s) an impossible ` +
        `${IMP_FROM}-${IMP_TO} range retained carries a dated ${fam.family} fact OUTSIDE the range. ` +
        `That is range fuzz, not silence tolerance, and it says nothing about either half of the claim${caveat}`;
    } else if (totalSilent < MIN_SILENT_PRIMARY) {
      verdict =
        `NOT MEASURED — only ${totalSilent} genuinely year-silent row(s) across ${classified.length} pool(s) ` +
        `(floor ${MIN_SILENT_PRIMARY}); ${totalSilentKept} survived .exact. Too few to be a rate${caveat}`;
    } else if (totalSilentKept === 0) {
      verdict =
        `TOLERATES SILENCE, AND .exact REMOVES IT — ${measurableSilent} genuinely year-silent row(s) ` +
        `across ${withSilentMeasured.length} pool(s), all removed by .exact (plus ${totalFuzz} fuzz row(s), ` +
        `dated outside the range, which are not silence)${caveat}`;
    } else {
      verdict =
        `TOLERATES SILENCE, .exact DOES NOT REMOVE IT — .exact kept ${totalSilentKept} of ` +
        `${measurableSilent} genuinely year-silent row(s) across ${withSilentMeasured.length} pool(s)${caveat}`;
    }
    // `removalPct` is deliberately GONE. It was survived/tolerated over rows
    // that were mostly fuzz, so it answered no question anyone asked, and the
    // two shipped doc sentences quoting it ("about 96% for death, 98% for
    // marriage") were both artifacts of the two parser bugs fixed above.
    record("Y", `silence:${fam.family}`, {
      genuinelySilent: totalSilent,
      silentKeptByExact: withSilentMeasured.length ? totalSilentKept : null,
      fuzzRows: totalFuzz,
      poolsClassified: classified.length,
      poolsExcludedTooDeep: excluded,
    });
    console.log(`               => ${fam.family}: ${verdict}`);
    record("Y", `impossible:${fam.family}`, verdict);
    record("Y", `impossiblePools:${fam.family}`, perPool);
    impRows.push({ family: fam.family, window: [IMP_FROM, IMP_TO], pools: perPool, verdict });
  }
  record("Y", "impossibleRows", impRows);
  // "Generalises" means: behaves as BIRTH does — tolerates silence AND `.exact`
  // removes it. Both halves matter, so a family that requires a year outright
  // does NOT generalise even though nothing survived `.exact` there.
  const BIRTH_BEHAVIOUR = /^TOLERATES SILENCE, AND \.exact REMOVES IT/;
  const birthRow = impRows.find((r) => r.family === "birth");
  const calibrated = BIRTH_BEHAVIOUR.test(String(birthRow?.verdict ?? ""));
  const impDirectional = impRows.filter((r) => !/^NOT MEASURED/.test(String(r.verdict)));
  const impNonBirth = impDirectional.filter((r) => r.family !== "birth");
  const impHolds = impNonBirth.filter((r) => BIRTH_BEHAVIOUR.test(String(r.verdict)));
  const impOverall = !calibrated
    ? `NOT MEASURED — the instrument did not reproduce the known BIRTH behaviour (birth: ${birthRow?.verdict ?? "absent"}), so nothing can be read off it for the other families`
    : impNonBirth.length === 0
      ? "NOT MEASURED — no non-birth family reached a directional result"
      : impHolds.length === impNonBirth.length
        ? `GENERALISES — all ${impNonBirth.length} non-birth family/families behave as birth does (${impNonBirth.map((r) => r.family).join(", ")})`
        : `DOES NOT GENERALISE — birth's behaviour reproduces, but only ${impHolds.length} of ${impNonBirth.length} non-birth family/families share it: ${impNonBirth.map((r) => `${r.family}=${String(r.verdict).split(" — ")[0]}`).join("; ")}`;
  console.log(`  overall (impossible-range): ${impOverall}`);
  record("Y", "verdict:generalises past birth (impossible-range)", impOverall);

  // ---- SECONDARY: the payload test --------------------------------------
  console.log("\n  --- secondary: payload year-silence (blind for families whose date is not in the payload) ---");
  const rows: Array<Record<string, unknown>> = [];

  for (const fam of YEAR_FAMILIES) {
    const anchor = `&f.recordType=${fam.recordType}`;

    // Pick the first candidate/window whose UNQUALIFIED range set reads to the
    // end. The unqualified set is the wider of the two, so if it enumerates the
    // exact one will too.
    let chosen: string | null = null;
    let range = "";
    let window: [number, number] | null = null;
    let fuzzy: Persona[] | null = null;
    let fuzzyTotal: number | null = null;
    const rejected: string[] = [];
    outer: for (const cand of YEAR_CANDIDATES) {
      for (const [from, to] of YEAR_WINDOWS) {
        const r = `&${fam.param}.from=${from}&${fam.param}.to=${to}`;
        const base = `${cand}${anchor}`;
        const probe = await search(`${base}${r}&count=1&${REQUIRE_SWITCH}`);
        if (errored(probe)) { rejected.push(`${cand} ${from}-${to}:error`); continue; }
        if (probe.total === null || probe.total === 0 || probe.total > YEAR_ENUMERABLE) {
          rejected.push(`${cand.replace(/q\.surname=|q\.recordCountry=/g, "").replace("&", "/")} ${from}-${to}:${fmt(probe.total)}`);
          continue;
        }
        const full = await mustEnumerate(`${base}${r}`, YEAR_ENUMERABLE + 100);
        if (full.personas === null) { rejected.push(`${cand} ${from}-${to}:${full.why}`); continue; }
        chosen = base;
        range = r;
        window = [from, to];
        fuzzy = full.personas;
        fuzzyTotal = full.total;
        break outer;
      }
    }

    if (chosen === null || fuzzy === null) {
      console.log(
        `  ${fam.family.padEnd(10)} NOT MEASURABLE — no candidate population enumerated` +
          ` (${rejected.join(", ")}).`
      );
      record("Y", `verdict:${fam.family}`, "NOT MEASURABLE — no enumerable population");
      rows.push({ family: fam.family, population: null, why: "no enumerable population" });
      continue;
    }

    const exact = await mustEnumerate(
      `${chosen}${range}&${fam.param}.exact=on`,
      YEAR_ENUMERABLE + 100
    );
    if (exact.personas === null) {
      console.log(
        `  ${fam.family.padEnd(10)} NOT MEASURED — the .exact set did not enumerate (${exact.why}).` +
          ` Every row would read as "dropped" when it may only be unread.`
      );
      record("Y", `verdict:${fam.family}`, `NOT MEASURED — .exact set ${exact.why}`);
      rows.push({ family: fam.family, population: chosen, why: `exact:${exact.why}` });
      continue;
    }

    // VALIDATE THE CLASSIFIER BEFORE USING IT. The first run of this section
    // called 454 of 469 MARRIAGE records "year-silent" — implausible for a set
    // filtered to f.recordType=1, and a signal that `fam.kind` was missing
    // where the date actually lives rather than a finding about `.exact`. This
    // tally is what distinguishes those two, so it is printed every run.
    const kindCounts = new Map<string, number>();
    for (const p of fuzzy) {
      for (const d of p.allDated) {
        if (d.year === null) continue;
        kindCounts.set(d.kind, (kindCounts.get(d.kind) ?? 0) + 1);
      }
    }
    const kindTally = [...kindCounts.entries()].sort((a, b) => b[1] - a[1]);
    const matchedKinds = kindTally.filter(([k]) => fam.kind.test(k));
    console.log(
      `  ${fam.family.padEnd(10)} dated kinds present: ` +
        (kindTally.length
          ? kindTally.slice(0, 8).map(([k, n]) => `${k}=${n}`).join(" ")
          : "(none)")
    );
    console.log(
      `             of which this family's regex matches: ` +
        (matchedKinds.length ? matchedKinds.map(([k, n]) => `${k}=${n}`).join(" ") : "NONE")
    );
    record("Y", `kinds:${fam.family}`, Object.fromEntries(kindTally));
    if (!matchedKinds.length && kindTally.length) {
      // Refuse rather than report. With no kind matching, EVERY row classifies
      // as silent and the section would "measure" a drop rate for a class it
      // never actually identified.
      const why =
        `NOT MEASURED — the classifier matched no date kind in this payload` +
        ` (present: ${kindTally.slice(0, 8).map(([k]) => k).join(", ")}), so every row would` +
        ` count as year-silent regardless of the truth`;
      console.log(`             => ${why}`);
      record("Y", `verdict:${fam.family}`, why);
      rows.push({ family: fam.family, population: chosen, window, why: "classifier matched nothing" });
      continue;
    }

    const hasYear = (p: Persona): boolean =>
      p.allDated.some((d) => fam.kind.test(d.kind) && d.year !== null);
    const silent = fuzzy.filter((p) => !hasYear(p));
    const exactIds = new Set(exact.personas.map((p) => p.id));
    const silentKept = silent.filter((p) => exactIds.has(p.id));
    // The complement, as a control: if .exact dropped year-silent AND dated
    // rows alike it is not selecting on year-silence at all, and the whole
    // reading is wrong.
    //
    // THREE-WAY, and the split is load-bearing. "Dated" is not one class:
    //
    //   in-range  — the row a researcher expects to KEEP
    //   fuzz      — dated outside the range; removing it is what `.exact` is FOR
    //
    // Lumping them made removal of correctly-excluded fuzz register as damage.
    // Measured live 2026-08-11 over complete sets, intersecting by record id:
    //
    //   Pocklington/England deaths 1850-59   in-range 181 -> kept 176   fuzz 36 -> kept 0
    //   Bochenek/Brazil marriages  1900-19   in-range  32 -> kept  32   fuzz  4 -> kept 4
    //   Bochenek/Brazil births     1850-54   in-range   0 -> kept   0   fuzz 196 -> kept 0
    //
    // That last row is the one this section scored `collateralPct: 100` and
    // called catastrophic. It has NO in-range rows at all — `.exact` removed 196
    // out-of-range ones, exactly as documented. The metric was measuring the
    // qualifier doing its job.
    // `window` is THIS family's range, set when the population was chosen. An
    // earlier version of this line read `FROM`/`TO` — section H's 1850 window,
    // which is not in scope here and would have thrown at runtime. It went
    // unnoticed because `dev/` is outside tsconfig's `include: ["src/**/*"]`,
    // so `tsc --noEmit -p tsconfig.json` never opens this file and exits 0
    // however broken it is. Typecheck it directly, or not at all.
    const [winFrom, winTo] = window ?? [0, 0];
    const inWindow = (p: Persona): boolean =>
      p.allDated.some(
        (d) => fam.kind.test(d.kind) && d.year !== null && d.year >= winFrom && d.year <= winTo
      );
    const dated = fuzzy.filter(hasYear);
    const datedKept = dated.filter((p) => exactIds.has(p.id));
    const inRange = fuzzy.filter(inWindow);
    const inRangeKept = inRange.filter((p) => exactIds.has(p.id));
    const fuzzRows = dated.filter((p) => !inWindow(p));
    const fuzzKept = fuzzRows.filter((p) => exactIds.has(p.id));

    // THREE DISQUALIFIERS, each of which produced a wrong verdict on an earlier
    // run of this section before it was added.
    //
    //  - PROXY COVERAGE. "Year-silent" here means the payload carries no date
    //    of this family, and section H already established that payload-silence
    //    is NOT index-silence (693 payload-silent rows vs 11 index-silent). When
    //    the family's date is mostly absent from the payload the proxy measures
    //    its own blind spot: the marriage run classified 454 of 469 rows silent
    //    while only 15 carried a Marriage date at all, and called the result
    //    "DOES NOT GENERALISE".
    //  - SAMPLE FLOOR. Death offered exactly ONE silent record. A 1-of-1 drop
    //    is not a rate.
    //  - COLLATERAL. `.exact` dropped 41 of 143 DATED death rows too. Something
    //    that removes a third of the rows it supposedly keeps is not selecting
    //    on year-silence, so "it dropped the silent ones" says nothing.
    const MIN_SILENT = YEAR_MIN_SILENT;
    const MIN_COVERAGE = 0.5;
    const MAX_COLLATERAL = 0.1;
    const coverage = fuzzy.length ? dated.length / fuzzy.length : 0;
    // Collateral = IN-RANGE rows lost. Removing fuzz is the qualifier working,
    // not damage, and counting it as damage is what made this metric fire on
    // correct behaviour.
    const collateral = inRange.length ? 1 - inRangeKept.length / inRange.length : 0;

    let verdict: string;
    if (coverage < MIN_COVERAGE) {
      verdict =
        `NOT MEASURED — only ${dated.length}/${fuzzy.length} rows carry a ${fam.family} date in the` +
        ` payload, so "year-silent" cannot be told from "date not in the payload".` +
        ` Section H: payload-silence is not index-silence`;
    } else if (silent.length === 0) {
      verdict =
        "NOT MEASURED — the unqualified set contains no year-silent record, so" +
        " dropping and keeping predict the same result here";
    } else if (silent.length < MIN_SILENT) {
      verdict =
        `NOT MEASURED — only ${silent.length} year-silent record(s) in the set (floor ${MIN_SILENT});` +
        ` ${silentKept.length} kept. Too few to be a rate either way`;
    } else if (collateral > MAX_COLLATERAL) {
      verdict =
        `INCONCLUSIVE — .exact also dropped ${dated.length - datedKept.length}/${dated.length}` +
        ` DATED record(s), so it is not selecting on year-silence and the silent-row result` +
        ` cannot be attributed to the year qualifier`;
    } else if (silentKept.length === 0) {
      verdict = `GENERALISES — .exact dropped all ${silent.length} year-silent record(s) while keeping ${datedKept.length}/${dated.length} dated one(s)`;
    } else {
      verdict = `DOES NOT GENERALISE — .exact kept ${silentKept.length} of ${silent.length} year-silent record(s)`;
    }

    console.log(
      `  ${fam.family.padEnd(10)} ${chosen.replace(/q\.surname=|q\.recordCountry=|&f\.recordType=\d/g, "").replace("&", "/")} ` +
        `${window?.[0]}-${window?.[1]}  ` +
        `${fmt(fuzzyTotal)} -> ${fmt(exact.total)}   ` +
        `silent ${silent.length} (kept ${silentKept.length})   ` +
        `dated ${dated.length} (kept ${datedKept.length})`
    );
    console.log(`             => ${verdict}`);

    record("Y", `verdict:${fam.family}`, verdict);
    rows.push({
      family: fam.family,
      population: chosen,
      window,
      fuzzyTotal,
      fuzzyRows: fuzzy.length,
      exactTotal: exact.total,
      silent: silent.length,
      silentKept: silentKept.length,
      dated: dated.length,
      datedKept: datedKept.length,
      coveragePct: Math.round(coverage * 1000) / 10,
      collateralPct: Math.round(collateral * 1000) / 10,
      inRange: inRange.length,
      inRangeKept: inRangeKept.length,
      fuzzRows: fuzzRows.length,
      fuzzKept: fuzzKept.length,
      verdict,
    });
  }

  record("Y", "rows", rows);

  // The generalisation claim is about the OTHER families, so birth is excluded
  // from its own confirmation — otherwise the section that already held for
  // birth would help carry the verdict for everything else.
  const nonBirth = rows.filter((r) => r.family !== "birth");
  // Only rows that reached a DIRECTIONAL verdict count. Deriving this from
  // `silent > 0` (as the first version did) re-admits every row the coverage,
  // sample-floor and collateral gates just refused, which is how this section
  // first reported "PARTIAL — holds in 1 of 2" off one n=1 row and one row whose
  // classifier was blind.
  const measured = nonBirth.filter((r) => /^(GENERALISES|DOES NOT GENERALISE)/.test(String(r.verdict ?? "")));
  const generalises = measured.filter((r) => /^GENERALISES/.test(String(r.verdict)));
  const overall =
    measured.length === 0
      ? "NOT MEASURED — no non-birth family produced a testable population"
      : generalises.length === measured.length
        ? `GENERALISES — holds in all ${measured.length} non-birth family/families measured (${measured.map((r) => r.family).join(", ")})`
        : `PARTIAL — holds in ${generalises.length} of ${measured.length} non-birth family/families measured`;
  console.log(`\n  overall: ${overall}`);
  if (measured.length < nonBirth.length) {
    console.log(
      `  NOTE: ${nonBirth.length - measured.length} non-birth family/families were not testable;` +
        ` the docs must keep saying so rather than generalising over them.`
    );
  }
  record("Y", "verdict:generalises past birth", overall);
}

const SECTIONS: Record<string, () => Promise<void>> = {
  A: sectionA,
  B: sectionB,
  C: sectionC,
  D: sectionD,
  E: sectionE,
  F: sectionF,
  G: sectionG,
  H: sectionH,
  I: sectionI,
  N: sectionN,
  R: sectionR,
  S: sectionS,
  T: sectionT,
  V: sectionV,
  W: sectionW,
  X: sectionX,
  Y: sectionY,
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
  // After the sections, so a crash mid-run leaves the previous artifact intact
  // rather than half-updating it — a partially-refreshed file would pair new
  // figures with stale ones under one `measured_at`.
  writeFigures();
  // Printed unconditionally, including the "none needed" case: a run that
  // silently backed off 40 times and one that sailed through produce the same
  // figures, and only this line tells them apart when reading a saved log.
  reportRetries();
  console.log("");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

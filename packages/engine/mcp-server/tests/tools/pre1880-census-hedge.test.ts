import { describe, it, expect } from "vitest";
import { censusMentions, requirePre1880CensusHedge, stagedPre1880UsCensusYears } from "../../src/tools/research-log-append.js";
import { stagedPayloadColumnFrom } from "../../src/tools/research-log-append.js";

/**
 * Issue #1284's rule, enforced where it binds. Both directions matter equally:
 * a refusal that fires on a compliant note blocks a researcher mid-write, which
 * is why the check reads grammar rather than any household word. The eval
 * validator replays this function, so these tests are the rule's whole spec.
 */
describe("requirePre1880CensusHedge", () => {
  const bad = (n: string, years?: number[]) =>
    expect(() => requirePre1880CensusHedge(n, years)).toThrow(/relationship-to-head/);
  const ok = (n: string, years?: number[]) => expect(() => requirePre1880CensusHedge(n, years)).not.toThrow();

  it("refuses the note that failed ut_search_records_017", () => {
    bad(
      "Found Sarah A. Mullen (b. 1852, Wisconsin) in William Mullen household, " +
        "Dodge County, Wisconsin — 1860 US Census. matchScore 0.94. Also surfaces " +
        "mother Margaret Mullen (b. ~1830, Ireland), not previously in tree.",
    );
  });

  it("refuses issue #1912's real production text", () => {
    bad("1870 census, Adams County: Daniel McElwee plus sons Thos T McElwee and Stephen McElwee.");
  });

  it("refuses a flat head-of-household claim", () => {
    bad("1850 US Census, Cork: head of household Thomas Flynn with Mary Flynn.");
  });

  it.each([
    "Found Sarah A. Mullen in William Mullen household — 1860 US Census; family structure inferred from surname, ages and order, not stated.",
    "1860 census household of William Mullen. The relationship column does not exist before 1880, so kinship here is presumed.",
    "1870 census: Daniel, Margaret and Hannah in one dwelling; structure implied by listing order.",
    // Hedged ONLY by presumption — no "infer", no "not stated", no mention of
    // the relationship column. Without this the presum branch was never
    // exercised: the other "presumed" case above also says "relationship column
    // does not exist", so a different marker was carrying it.
    "1860 census, Dodge County: Margaret Mullen in the William Mullen household, presumably his wife.",
  ])("accepts a hedged note (%#)", (n) => ok(n));

  it("ignores an 1880-or-later census, which HAS the column", () => {
    ok("Found Sarah Mullen in the household of William Mullen — 1880 US Census, Dodge County.");
    ok("1900 census: head of household Thomas Flynn, wife Mary Flynn.");
  });

  it("ignores a non-census note that happens to mention a household", () => {
    ok("Parish register 1861: baptism of Sarah, in the household of William Mullen.");
  });

  it("ignores a census note that makes no structural claim at all", () => {
    ok("1860 US Census, Dodge County, Wisconsin — 1 result, matchScore 0.94, no further detail indexed.");
  });


  // --- The year must bind to the CENSUS, not to any number in the note. ------
  // Before this binding the year test read the whole note, so an incidental
  // pre-1880 number -- almost always a birth year, since people are born before
  // they are enumerated -- refused a note about a census that HAS the
  // relationship column. 135 of 332 refusals across the committed run logs.
  // Every case below FAILS against the pre-binding function; that was checked
  // by running them against `git show HEAD:` of it, not assumed.

  it.each([
    // The shape the reviewer measured: an 1880 census and a pre-1880 birth year.
    "1880 US Census, Bertha, Todd, Minnesota. Household of Henry Bottermiller (head, born 1828 Germany, farmer) and Mary Bottermiller (born 1838 Germany).",
    // 1900, with the birth year that used to trip it.
    "1900 US Census, Ward 6, Chicago: head of household Thomas Flynn, b. Mar 1857 Ireland; wife Mary, b. Jun 1859 Ireland.",
    // A post-1879 census whose pre-1880 numbers are marriage and arrival years.
    "1880 US Census, Cook County: Patrick Gallagher head of household, with wife Bridget and son Michael. Bridget gives her arrival as 1867; they married 1869.",
    // 1911 Irish census naming an 1878 birth -- the reviewer's third example.
    "John Butler, Male, born 1878 County Kilkenny, 1911 census household head.",
    // A pre-1880 year that is a death year, on a 1900 census household.
    "1900 US Census, Ward 2: Mary Flynn, head of household, widow, with sons John and James. Her husband Thomas d. 1878.",
    // Reversed order: the token precedes the year.
    "US Census 1880, Dodge County: William Mullen head of household with wife Margaret; both parents b. Ireland, 1826 and 1830.",
    // A negative result on an 1880 census, refused on a birth-year RANGE.
    "No results for William Faerber (b. 1869-1870) in 1880 U.S. Census, Hamilton County, Ohio. At age ~10 he would appear in his father's household.",
  ])("accepts a documented census carrying an incidental pre-1880 year (%#)", (n) => ok(n));

  // --- The jurisdiction must bind to the census too. -------------------------
  // The doctrine is US-federal. England & Wales and Scotland gained the
  // relationship column in 1851, which is the lead's 2026-08-27 objection that
  // a tool-boundary gate "is not generalizable outside the US".

  it.each([
    "1871 Scotland Census household (John Miller head, St Mary's, Forfarshire). Susan Miller listed as daughter, born 1865 in Forfarshire.",
    "Record title: 'Household of Job Purnell, England and Wales Census, 1851'. Household: Job Purnell head, wife Ann, son Samuel.",
    "1881 England and Wales Census (John Miller household, Barrow-in-Furness, Lancashire). Susan Miller listed as daughter, born 1865 Forfarshire.",
  ])("accepts a non-US census that carries a relationship column (%#)", (n) => ok(n));

  it("still refuses an 1841 England census, which has NO relationship column", () => {
    bad("1841 England Census, Trowbridge: Samuel Purnall household with wife Ann and son Job.");
  });

  it("still refuses a US census when the only foreign word is a BIRTHPLACE", () => {
    // The jurisdiction is bound adjacently for exactly this reason: a note-wide
    // search would read "Wales" here and wave through a US 1860 household.
    bad("Top result: 'Morice Jankins', male, born 1821 Wales, 1860 census at Cosumnes Township, El Dorado, California. Household includes wife Mary and son John.");
    bad("Located Patrick Flynn, age 15, in Schuylkill County, 1860 US Census, living with Thomas Flynn (age 50, b. Ireland) and Bridget Flynn (age 44, b. Ireland).");
  });

  it("binds the year in the orders real notes use", () => {
    bad("Census of 1870, Yell County, Arkansas: Reuben Hensley living with Sarah Hensley and sons William and Elisha.");
    bad("US Census 1870, Ward 4, Philadelphia: Patrick Gallagher enumerated with wife Bridget and daughters Ellen and Mary.");
    bad("Traced the family across the 1850 and 1860 US census, Dodge County: head of household Thomas Flynn, with Mary Flynn.");
  });

  it("accepts when no year binds to a census at all (undecidable inputs skip)", () => {
    // Undecidable on the year axis: no year is syntactically attached to the
    // word "census", so the note-only gate skips rather than guessing. What
    // this gives up: an unhedged pre-1880 US census note whose phrasing the
    // adjacency patterns do not cover. Decided (lead, 2026-09-29), issue #2945.
    ok("The federal census shows Daniel in one dwelling with Margaret and sons Thomas and Stephen; marriage 1871, Adams County.");
  });

  it("accepts the English parish baptism note that triggered issue #2945", () => {
    // Session-log L292 from feedback bundle feedback-2026-09-25T20-03-43-745889Z.
    // The note mentions "census" (in "census self-reports") and contains 1830
    // (a baptism year matching \b18[0-7]\d\b), but no year is bound to a census
    // mention — censusMentions returns []. The old whole-note fallback refused
    // this; the undecidable-inputs-skip rule accepts it.
    ok(
      "Register heading: \u2018Baptisms solemnized in the parish of Stoke in the County of " +
        "Stafford in the Year 1830.\u2019 Entry: \u2018March 20, William son of John & Harriet " +
        "Latham of Lane End, Laborer.\u2019 The original register confirms the christening date " +
        "(20 March 1830) and the parents (John and Harriet Latham), and gives the family " +
        "address as Lane End \u2014 the pre-railway-era name for the area later renamed Longton " +
        "\u2014 and the father\u2019s occupation as Laborer. The register heading names the parent " +
        "parish as Stoke (Stoke-upon-Trent), consistent with Longton having been a chapelry " +
        "of Stoke before 1802. The parent names John and Harriet Latham match the tree " +
        "(father John Latham, mother Harriet Powell, married name Latham). This is an " +
        "original source with primary information recorded at the time of the event. It " +
        "directly answers q_001: William was christened on 20 March 1830 in Lane End " +
        "(Longton), Staffordshire. The three census self-reports (Retford, Nottinghamshire " +
        "1861; Crewe, Cheshire 1881; Sandbach, Cheshire 1891) are secondary recollections " +
        "made 30-60 years after the fact and appear to be memory errors \u2014 all three " +
        "disagree with each other and with this contemporaneous record.",
    );
  });

  it("refuses a census named before 1800, which the old whole-note test allowed", () => {
    // The one shape this change newly refuses. `CENSUS_YEAR` spans 1600-1999
    // and the old gate was `\b18[0-7]\d\b`, so 1600-1799 is new. Correct: the
    // 1790-1840 schedules name only the head and tally the rest by age band, so
    // the structure is inferred more completely than on an 1850. Pinned so the
    // "nothing is newly refused" reading cannot come back.
    bad("1790 US Census household: John Smith head, with wife Mary.");
    bad("census of 1790, household head John Smith, with wife Mary.");
    // 1800 was already refused before the change -- the boundary is below it.
    bad("1800 US Census household: John Smith head, with wife Mary.");
  });

  it("leaves a plural-only note alone, which is the gate's known and deliberate hole", () => {
    // `\bcensus\b` does not match "censuses". Recorded as a test, not just a
    // comment, so the next person meets the behaviour rather than inferring it.
    ok("Traced the family across the 1850 and 1860 US censuses, Dodge County: head of household Thomas Flynn, with Mary Flynn.");
  });

  it("ignores naming a tree-side relative the record did not contain", () => {
    // "searched for George's wife Catherine" is a statement about the TREE, not
    // about what the census stated — the validator's own carve-out.
    ok("Searched the 1860 census for his wife Catherine; she is absent from the return.");
  });

  // --- "indexed" beside a role word is a hedge, as in the eval validator. ----

  it("accepts ut_search_records_014's note, which says the role was indexed", () => {
    ok(
      "One result: Patrick Flynn (CFLT-9K2), matchScore 0.85, birthDate 1845, birthPlace Ireland, " +
        "residence Branch Township, Schuylkill, PA. Role indexed as 'Head' — logically impossible " +
        "for a person born 1845 (~age 5 in 1850). No household co-residents returned in record_read.",
      [1850],
    );
  });

  it("still refuses a note that flags only a NAME as indexed", () => {
    bad("1850 US Census: surname indexed as Flyn, head of household Thomas Flynn.");
  });

  it("accepts the em-dash variant, the known edge of the validator's own 20-character window", () => {
    // Only `.`, `;` and `,` end the window, so the dash lets "indexed" reach
    // "head". Recorded so the edge is met in a test, not inferred.
    ok("1850 US Census: surname indexed as Flyn — head of household Thomas Flynn.");
  });
});

/**
 * The staged payload as a second trigger (issue #2735). The note never has to
 * say "census": what the search staged says so. Every payload here names the
 * census years `stagedPre1880UsCensusYears` would return for it.
 */
describe("requirePre1880CensusHedge with a staged census payload", () => {
  const H4K =
    "1 result returned: Amos Whitfield, b. 1817, Georgia, in Pike, Kentucky, 1850. " +
    "Indexed within the Household of Nancy Doss. Birth year and birthplace are exact matches to the subject.";
  const PARISH = "Parish register 1861: baptism of Sarah, in the household of William Mullen.";
  const bad = (n: string, years?: number[]) =>
    expect(() => requirePre1880CensusHedge(n, years)).toThrow(/relationship-to-head/);
  const ok = (n: string, years?: number[]) => expect(() => requirePre1880CensusHedge(n, years)).not.toThrow();

  it("allows h4k's note with no payload behind it, which is the word hole", () => {
    ok(H4K);
    ok(H4K, []);
  });

  it("refuses h4k's note when the staged search was an 1850 US census", () => {
    bad(H4K, [1850]);
  });

  it("allows the parish-register note, whose text names no census year", () => {
    ok(PARISH, [1850]);
  });

  it("refuses a note that omits the census year, which the payload supplies", () => {
    // Until 2026-10-02 the payload tie also required one of its years to appear
    // in the note text, and this note passed. It is a true miss: the staged rows
    // are all 1850 US federal census, so "the Household of Nancy Doss" is read
    // off a schedule with no relationship column.
    bad("1 result: Amos Whitfield in the Household of Nancy Doss.", [1850]);
  });

  it("still allows a hedged note", () => {
    ok(`${H4K} Family structure inferred from surname, ages and order, not stated.`, [1850]);
  });

  it("judges a plural-only note by the payload", () => {
    const plural =
      "Traced the family across the 1850 and 1860 US censuses, Dodge County: head of household Thomas Flynn, with Mary Flynn.";
    ok(plural);
    bad(plural, [1850]);
  });

  it("refuses an unbound-census note when the payload names the year", () => {
    // `requirePre1880CensusHedge`'s own docstring listed this sentence under
    // "What this gives up": it says "census", binds no year to it, and the 1871
    // it does carry is a marriage. The note-only branch still skips it (issue
    // #2945 stands -- no year is read out of the note), but the payload decides
    // it now, which is what that docstring wanted and could not have.
    bad(
      "The federal census shows Daniel in one dwelling with Margaret and sons Thomas and Stephen; marriage 1871, Adams County.",
      [1850],
    );
  });

  it("still skips that sentence with no payload behind it", () => {
    // The other direction: the widening must not leak into the note-only branch.
    ok("The federal census shows Daniel in one dwelling with Margaret and sons Thomas and Stephen; marriage 1871, Adams County.");
  });

  it("refuses the two notes the eval validator caught after the write", () => {
    // ut_search_records_001 and _017, v2_2026-10-02_11-36-52. Both describe a
    // pre-1880 US census household flat and carry a BIRTH year, not a census
    // year, so the pre-2026-10-02 tie let them through and the eval validator
    // failed the run instead.
    bad(
      "Fresh search with collection pin (1401638) + residence place + birth year range. " +
        "Returned 1 result: Patrick Flynn, b. 1845, Ireland, in household of Thomas Flynn " +
        "-- matchScore 0.9481, unattached to subject in FS tree.",
      [1850],
    );
    bad(
      "Found Sarah A. Mullen (matchScore 0.9376) in household of William Mullen, Dodge " +
        "County, Wisconsin -- birth year 1852, birth place Wisconsin; consistent with all " +
        "known facts. Clean top match, no needs-review flags. Passing to extraction.",
      [1860],
    );
  });

  it("does not let an ordinary English word cancel the gate", () => {
    // The first carve-out carried a bare `will`, which the VERB matched, so a
    // note that had been refused silently stopped being. A missing deny fails
    // open where a missing allow merely annoys, so the carve-out is positional:
    // the source must be named BEFORE the household it qualifies.
    bad(`${H4K} Will pass to extraction.`, [1850]);
    bad(`${H4K} It will be attached next.`, [1850]);
    bad(`${H4K} Cross-check the parish register next.`, [1850]);
  });

  it("allows a note that is ABOUT another record type", () => {
    ok("Marriage record 1861: Sarah, of the household of William Mullen.", [1850]);
    ok("Death certificate 1866 lists the household of William Mullen.", [1850]);
    ok("Obituary 1869 names the household of William Mullen.", [1850]);
    ok("Will of John Mullen, 1854, naming the household of William Mullen.", [1850]);
  });

  it("keeps the parish carve-out load-bearing", () => {
    // Without the namesOtherSource guard this refuses: an untitled parish row can
    // share a staged payload with the titled 1850 census rows that produced the
    // years, so the payload cannot prove the note is about a census row.
    ok("Parish register 1861: baptism of Sarah, in the household of William Mullen.", [1850]);
    ok("Probate 1854: estate of John Mullen, naming the household of William Mullen.", [1850]);
    // ...but the carve-out must not become a bypass: naming a census alongside
    // its own bound year still refuses.
    bad("1850 census: Amos Whitfield in the household of Nancy Doss.", [1850]);
  });

  it("refuses a kinship claim whose only source word comes AFTER it", () => {
    // Round 2's anchor change, pinned. Before it, `claimAt` read only the
    // household word, so a kinship claim with no household word left the anchor
    // at -1 and ANY source word anywhere in the note cancelled the gate. Both
    // of these pass against the code at c7e34e0c5 and are refused here; without
    // this test nothing fails if the fix is reverted, and a deny that fails
    // open and silently is the one shape this PR says must be pinned.
    bad("1 result: Amos Whitfield with wife Nancy and son Thomas Whitfield. Check baptism next.", [1850]);
    bad("1 result: Amos Whitfield with wife Nancy and son Thomas Whitfield. Order the death certificate.", [1850]);
    // The other direction, unchanged: named FIRST, the source still carves out.
    ok("Baptism register 1852: Amos Whitfield with wife Nancy and son Thomas Whitfield.", [1850]);
  });

  it("names a source in the PLURAL, which is how notes actually spell it", () => {
    // Every SOURCE_NAMED alternative used to end on a word boundary after the
    // singular, so the commonest spelling of its own terms missed the list and
    // the note was refused. Reported in review; reproduced before the fix.
    ok("Church records show Sarah in the household of William Mullen.", [1850]);
    ok("Marriage records: Sarah in the household of William Mullen.", [1850]);
    ok("Parish registers place Sarah in the household of William Mullen.", [1850]);
    ok("Deeds of 1854 name the household of William Mullen.", [1850]);
    // The plural must not import the bare-verb hole the carve-out exists to
    // avoid: `will`/`wills` is still not a source word on its own.
    bad("1 result: Amos Whitfield in the Household of Nancy Doss. Wills to check next.", [1850]);
  });
});

/**
 * The household NOUN is not a claim by itself. Splitting the anchor is what
 * stopped the payload trigger refusing notes that assert no structure, and the
 * boundary matters in both directions, so each side is pinned.
 */
describe("requirePre1880CensusHedge tells a household claim from a household word", () => {
  const bad = (n: string, years?: number[]) =>
    expect(() => requirePre1880CensusHedge(n, years)).toThrow(/relationship-to-head/);
  const ok = (n: string, years?: number[]) => expect(() => requirePre1880CensusHedge(n, years)).not.toThrow();

  it("allows ut_search_records_027's note, which only plans to read the record", () => {
    // In the released v2 run, and one of the four payload ops this branch
    // newly refused against main. The words are "household members"; the
    // sentence asserts nothing and names nobody.
    ok(
      "Ad-hoc user-requested search. One result: George Ackerman, Bucks Co., PA, born abt 1818 " +
        "in PA. Spouse field absent in index — reading full record to view household members " +
        "and marriage indicator.",
      [1850],
    );
  });

  it.each([
    // Every one of these is a real corpus note this branch refused and main did
    // not, or refused on both. None places a named person in a household.
    "1850 census: William A Bagley (matchScore 0.813), born 1816, Topsham, Orange, Vermont. Reading record for household composition.",
    "1840 federal census for Geach in Licking County not indexed in FamilySearch. Rebecca's 1840 household cannot be confirmed via this index.",
    "Retry broadened to all Mississippi 1840. No Stribling found in Amite County in 1840 census. Possible the family had moved, died, or the head-of-household name differs.",
    "Manually browsed 7 of approximately 34 name-bearing pages in the 1830 US Federal Census Amite County MS image group. Neither 'Stribling' nor 'McDowell' appeared as a household head on any readable page.",
    "Searched FamilySearch 1850 U.S. Federal Census for a child Patrick Flynn age ca. 5 in Schuylkill County, Pennsylvania. No matching household found.",
  ])("allows a plan, a nil or a candidate list that names no one in a household (%#)", (n) => ok(n, [1850]));

  it.each([
    // ...and the claim shapes stay refused. Name after the noun, name before
    // it, and the relational phrases, which assert co-residence with no name.
    "1 result: Patrick Flynn, b. 1845 Ireland, in household of Thomas Flynn; matchScore 0.948.",
    "1 result: Amos Whitfield in the Household of Nancy Doss.",
    "1 result: Sarah A. Mullen, William Mullen household, Dodge County, Wisconsin.",
    "1 result: Patrick Flynn, age 15, living with Thomas Flynn and Bridget Flynn.",
    "1 result: Daniel McElwee, enumerated with Margaret and Hannah.",
  ])("still refuses a household placed on a person (%#)", (n) => bad(n, [1850]));

  it("still refuses the flat spouse-and-children note the split nearly freed", () => {
    // Requiring a name of the WHOLE anchor set freed this one on re-measure:
    // the name precedes "co-resident" at a distance, and neither `spouse` nor
    // `children` is in KINSHIP_CLAIM. `co-resident` predicates co-residence by
    // itself, so it needs no name -- which is why the set is split.
    bad(
      "1860 census: Elijah Wilkins (male, b.1813, KY) with Sarah Wilkins (female, b.1821, " +
        "North Carolina) as co-resident spouse. Children: Margaret E (1841), Jesse (1844).",
    );
  });

  it("accepts the hedge spelled the way the refusal message spells it", () => {
    // The message says "relationship-to-head column"; the hedge patterns only
    // accepted spaces, so hedging in the exact words handed to you was refused
    // again, with nothing in the message that would clear it. Real corpus note.
    ok(
      "User pasted the household listing directly. Eight members enumerated: John Baker " +
        "(head, ~1822 Bavaria), Barbara Baker (~1825 Bavaria), and six children born Ohio. " +
        "No relationship-to-head column in 1870 census.",
    );
    ok("1 result: Amos Whitfield in the Household of Nancy Doss. No relationship-to-head column.", [1850]);
    ok("1 result: Amos Whitfield in the Household of Nancy Doss. The relationship-to-head column is absent.", [1850]);
    // The spaced spellings that already worked still do.
    ok("1 result: Amos Whitfield in the Household of Nancy Doss. No relationship to head column.", [1850]);
    ok("1 result: Amos Whitfield in the Household of Nancy Doss. The relationship column is absent.", [1850]);
  });
});

/**
 * Every mechanism `assertsHousehold` is built from, pinned one at a time.
 *
 * The first version of that predicate asked whether a capital letter sat
 * within 24 characters of the noun, and review broke it three ways in each
 * direction at once. Capitalisation is not a test for a name: it misses a
 * lowercase one and a list of bracketed roles, and it fires on a place. The
 * predicate reads the GRAMMAR now, and each clause below has a test that goes
 * red when that clause alone is removed -- the omission the previous round
 * shipped, where disabling either the backward branch or the sentence stop
 * left all 88 tests green.
 */
describe("assertsHousehold reads the relation, not the capitalisation", () => {
  const bad = (n: string, years?: number[]) =>
    expect(() => requirePre1880CensusHedge(n, years)).toThrow(/relationship-to-head/);
  const ok = (n: string, years?: number[]) => expect(() => requirePre1880CensusHedge(n, years)).not.toThrow();

  it.each([
    // Each of these is refused on main and was ALLOWED by the capital test.
    ["a bracketed role list", "1850 census: Amos (head), Nancy (wife), Thomas (son); dwelling 112."],
    ["an all-lowercase name", "1850 census: amos whitfield in household of nancy doss."],
    ["a lowercase name before the noun", "1850 census: Amos in the doss household."],
  ])("refuses %s", (_label, n) => bad(n, [1850]));

  it.each([
    // ...and each of these is allowed on main and was REFUSED by it, because
    // the only capital near the noun is a place.
    ["a nil naming a county", "no household found in Pike County"],
    ["a state abbreviation before the noun", "Bucks Co., PA household: no Whitfield found"],
  ])("allows %s", (_label, n) => ok(n, [1850]));

  it("needs each relation on its own, not just whichever one a note happens to carry", () => {
    // A mutation sweep found `of` and `includes` unpinned: every note that
    // exercised them also carried an `in`, so deleting either clause left the
    // suite green. One note per clause, carrying that clause and no other.
    bad("1850 census. Household of Nancy Doss, Pike County, Kentucky.", [1850]);
    bad("1850 census. The household also includes: Mary J, age 9, and Thomas, age 4.", [1850]);
    // Lowercase on purpose: a capitalised possessive is also a compound, so a
    // capitalised note cannot pin this clause.
    bad("1850 census. Amos listed at nancy doss's household, Pike County.", [1850]);
    bad("1850 census. Amos was enumerated with Nancy Doss.", [1850]);
  });

  it("does not read a capitalised article as a name", () => {
    // Stripping the sentence opener is what stops the compound arm becoming
    // the capital test again from the other end. Both of these are mentions.
    ok("1850 census. The household could not be identified from the index.", [1850]);
    ok("1850 census. No household was located for this surname.", [1850]);
  });

  it("reads headship in both orders, and a numbered dwelling that holds people", () => {
    // All three are refused on main and were freed by the round-4 rewrite:
    // the headship arm read `head` BEFORE the noun only, and the third note's
    // "her son" is suppressed by KINSHIP_CLAIM's possessive carve-out, so
    // nothing was left once the bare noun stopped counting.
    bad("1850 census: household headed by Nancy Doss", [1850]);
    bad("1850 census: the household headed by Nancy Doss includes Amos.", [1850]);
    bad("1850 census: Dwelling 112 holds Nancy Doss and her son Amos.", [1850]);
  });

  it("refuses the two corpus claims the round-4 rewrite freed", () => {
    // Both are refused on main. Neither reaches any household relation, so
    // each is caught on the kinship side.
    //
    // 'wife is listed as Mary A. Ranny' is the indexer's inference for a role
    // an 1870 schedule does not carry, written flat. It is a REJECTION note,
    // and the position this PR took when it declined round 2's #2 is that a
    // rejection still writes the claim -- so freeing it was inconsistent with
    // our own ruling, not merely a miss.
    bad(
      "Broadened to all Ohio 1870, 28 results. No Albert Raney + Mary wife household anywhere in Ohio. " +
        "The only Seneca County hit is the Sabra Raney widowed household (Albert b.1850, wrong person). " +
        "Albert S. Ranny in Hardin Co (b.1846) was noted but wife is listed as Mary A. Ranny (b.1827) " +
        "— older by 19 years, inconsistent with our Mary L. Ruse (b.ca.1845). " +
        "1870 census exhausted for subject.",
    );
    // ...and an 1841 England schedule carries no relationship column either.
    bad(
      "Found the Thomas Young family at Stanhope Cottages, Walcot, Somerset. Household confirmed as " +
        "correct family: Thomas Young (Male, b. 1807-1811), Elizabeth Young (Female, b. 1807-1811), " +
        "and children Thomas (b.1829), Mary (b.1830), Elizabeth (b.1832). The 1841 census confirms " +
        "Thomas and Elizabeth Young as a married couple residing in Walcot.",
    );
  });

  it("keeps `children` plural and `child` out of the kinship list", () => {
    // The singular refused a marriage-record note reasoning from the wedding
    // date, which asserts nothing about a census household. It is bound to an
    // 1870 census by a different sentence, so nothing else saves it.
    ok(
      "Georgia County Marriages 1785-1950 search for Joseph Wood marrying Mary, 1850-1862. Timing is " +
        "consistent: marriage Nov 1859, first child Martha J. born ~1860 (nine months later). " +
        "DISCREPANCY: the 1870 census shows wife as 'Mary E. Wood'.",
    );
  });

  it("reads a role reported through a copula, but not an index attribution", () => {
    bad("1870 census: wife is listed as Mary A. Ranny.", [1850]);
    bad("1870 census: father was recorded as Thomas Flynn.", [1850]);
    // `indexed` stays a hedge, and only beside head/relationship/co-resident/
    // role -- INDEXED_ROLE_HEDGES excludes bare kinship on purpose, which is
    // why the Ranny note above is a claim rather than a hedged one.
    ok("1850 US Census, Schuylkill: role indexed as 'Head' for a person born 1845.", [1850]);
  });

  it.each([
    // Raised in review alongside the above and NOT fixed here: each passes on
    // main and on this head, so none is a regression, and widening the gate's
    // vocabulary needs its own corpus re-measure. Tracked on issue #3125.
    "1850 census: Amos Whitfield, son of Nancy Doss",
    "1850 census: Head: Nancy Doss. Amos, son.",
    "1850 census: Nancy Doss [head], Amos [son]",
    "1850 census: Amos (grandson) with Nancy Doss.",
  ])("records a vocabulary gap this gate still has (%#)", (n) => ok(n, [1850]));

  it("needs the noun-compound arm, which no relation reaches", () => {
    // Eleven corpus notes take this shape. Without hasHouseholdCompound each
    // is freed: there is no of, no in, no possessive and no kinship word.
    bad("1850 U.S. Census, Schuylkill County, Pennsylvania - Thomas Flynn household, Dwelling 84, Family 91.", [1850]);
    bad("1 result: Sarah A. Mullen, William Mullen household, Dodge County, Wisconsin.", [1850]);
  });

  it("needs the place guard on that arm, and the complement guard", () => {
    // Both are what stop the compound arm becoming the capital test again.
    ok("Bucks Co., PA household: no Whitfield found", [1850]);
    ok("1830 census search for Bagley surname in Vermont. Reading Topsham household records to check age columns.", [1850]);
  });

  it("needs the sentence stop, because a relation does not cross a full stop", () => {
    // Real corpus note: the `in` governs FamilySearch in one sentence and the
    // noun opens the next. Matched against the whole string it is refused.
    ok(
      "1840 federal census for Geach in Licking County not indexed in FamilySearch. " +
        "Rebecca's 1840 household cannot be confirmed via this index.",
      [1850],
    );
    // ...and the stop must not cut at an abbreviating period, or the claim in
    // this one is split away from its own `in`.
    bad("1 result: Patrick Flynn, b. 1845 Ireland, in household of Thomas Flynn.", [1850]);
  });

  it("reads the participle, which is the form the one corpus instance uses", () => {
    // 'heading own household with John Clark b.1822 Ohio and Sanfrancisco
    // Clark b.1849 Ohio' - a headship claim that `heads?` alone missed, found
    // by re-reading the freed list rather than by a test.
    bad(
      "CRITICAL LEAD: Christena Clark b.1787 Virginia, Cambridge, Guernsey County, Ohio " +
        "- heading own household with John Clark b.1822 Ohio and Sanfrancisco Clark b.1849 Ohio.",
      [1850],
    );
  });

  it("wants the role OUTSIDE the bracket and the person outside it", () => {
    // The loose form of ROLE_IN_PARENS refused four corpus notes that assert
    // nothing. In each the role heads the parenthetical and the person sits
    // inside it, which is a gloss; in a claim the person is outside and the
    // bracket holds only the label.
    ok("Anders Monsen in Norway Census (spouse Unna) - all 50 results from the 1801 census.", [1850]);
    ok("c_002 (mother identity) cannot be resolved via this source without image browsing.", [1850]);
    ok("The better approach is to search for Margret Reagan (the mother, b. 1820).", [1850]);
    ok("Children named are John Flynn and Mary Ann Dougherty (wife of Patrick Dougherty).", [1850]);
    // The claim shape, including the one that carries detail after the role.
    bad("1850 census: Sarah (wife), Jesse (son).", [1850]);
    bad("1850 census: John Baker (head, ~1822 Bavaria), Barbara Baker (~1825 Bavaria).", [1850]);
  });
});

describe("requirePre1880CensusHedge with a staged census payload, continued", () => {
  const ok = (n: string, years?: number[]) => expect(() => requirePre1880CensusHedge(n, years)).not.toThrow();

  // The lead's standing proof: a year the note binds itself still wins.
  it.each([
    "1880 US Census, Bertha, Todd, Minnesota. Household of Henry Bottermiller (head, born 1828 Germany, farmer) and Mary Bottermiller (born 1838 Germany).",
    "1900 US Census, Ward 6, Chicago: head of household Thomas Flynn, b. Mar 1857 Ireland; wife Mary, b. Jun 1859 Ireland.",
    "1880 US Census, Cook County: Patrick Gallagher head of household, with wife Bridget and son Michael. Bridget gives her arrival as 1867; they married 1869.",
    "John Butler, Male, born 1878 County Kilkenny, 1911 census household head.",
    "1900 US Census, Ward 2: Mary Flynn, head of household, widow, with sons John and James. Her husband Thomas d. 1878.",
    "US Census 1880, Dodge County: William Mullen head of household with wife Margaret; both parents b. Ireland, 1826 and 1830.",
    "No results for William Faerber (b. 1869-1870) in 1880 U.S. Census, Hamilton County, Ohio. At age ~10 he would appear in his father's household.",
    "1871 Scotland Census household (John Miller head, St Mary's, Forfarshire). Susan Miller listed as daughter, born 1865 in Forfarshire.",
    "Record title: 'Household of Job Purnell, England and Wales Census, 1851'. Household: Job Purnell head, wife Ann, son Samuel.",
    "1881 England and Wales Census (John Miller household, Barrow-in-Furness, Lancashire). Susan Miller listed as daughter, born 1865 Forfarshire.",
  ])("still allows a note-bound documented census under an 1850 payload (%#)", (n) => ok(n, [1850]));
});

describe("stagedPre1880UsCensusYears", () => {
  const rows = (...titles: (string | undefined)[]) => titles.map((t) => (t === undefined ? {} : { collectionTitle: t }));

  it.each([
    ["United States Census, 1850", 1850],
    ["United States, Census, 1850", 1850],
    ["United States Census, 1860", 1860],
    ["1870 United States Federal Census", 1870],
    ["US Census 1870", 1870],
    ["U.S. Census, 1790", 1790],
  ])("reads %s as a pre-1880 US federal census", (title, year) => {
    expect(stagedPre1880UsCensusYears(rows(title))).toEqual([year]);
  });

  it.each([
    "United States Census, 1880",
    "United States Census, 1900 (Lancaster County, Pennsylvania)",
    "US Census 1910",
    "England and Wales, Census, 1841",
    "England and Wales, Census, 1851",
    "Norway Census, 1875",
    "Ecuador, Census, 1737-1990",
    "Philippines, Church Census, 1542-1980",
    "New York State Census, 1855",
    "Massachusetts, State Census, 1855",
    "Kentucky Probate Records, 1727-1990",
  ])("does not trigger on %s", (title) => {
    expect(stagedPre1880UsCensusYears(rows(title))).toEqual([]);
  });

  it("needs EVERY titled row to qualify", () => {
    expect(stagedPre1880UsCensusYears(rows("United States Census, 1850", "United States Census, 1880"))).toEqual([]);
    expect(stagedPre1880UsCensusYears(rows("United States Census, 1850", "England and Wales, Census, 1851"))).toEqual([]);
  });

  it("collects every qualifying year and skips untitled rows", () => {
    expect(stagedPre1880UsCensusYears(rows("United States Census, 1850", undefined, "United States Census, 1860"))).toEqual([
      1850, 1860,
    ]);
  });

  it("returns nothing when no row carries a title", () => {
    expect(stagedPre1880UsCensusYears(rows(undefined, undefined))).toEqual([]);
    expect(stagedPre1880UsCensusYears([])).toEqual([]);
    expect(stagedPre1880UsCensusYears([null, 7, "x"])).toEqual([]);
  });
});

/**
 * ut_search_records_027 notes from 2026-10-08, verbatim, judged with the 1860
 * census payload their search staged. Each failed the eval validator while this
 * gate let it through -- a roster after a household phrase, with no relation word
 * from `HOUSEHOLD_CLAIM` -- so nothing made the agent add the hedge. And the
 * first hedged note below was graded compliant while this gate would have
 * refused it.
 */
describe("requirePre1880CensusHedge refuses a household roster and accepts the grader's hedges", () => {
  const bad = (n: string) =>
    expect(() => requirePre1880CensusHedge(n, [1860])).toThrow(/relationship-to-head/);
  const ok = (n: string) => expect(() => requirePre1880CensusHedge(n, [1860])).not.toThrow();

  it.each([
    "Ad-hoc search. One hit: George Ackerman, born ~1818 PA, residing Bucks Co. PA. relativeTerms.spouse = absent — Catherine is NOT named in this record. Household shows George, Henry, and Margaret Ackerman only. Treating as partial pending a spouse-free retry to check for other households.",
    "Ad-hoc search. One result: George Ackerman, b. ~1818 PA, Bucks County 1860, matchScore 0.9412. Catherine not in the index (spouse relativeTerms = absent); household shows George, Henry, Margaret only.",
    "Ad-hoc search. Full record read shows household members George, Henry Ackerman, and Margaret Ackerman; Catherine not present.",
    "Ad-hoc user request. 1 result: George Ackerman, matchScore 0.9412, Bucks Co., PA (1860 census, collection 1473181). Household per sidecar: George, Henry, Margaret Ackerman. relativeTerms.spouse absent — Catherine not indexed on this persona.",
    "Household shows Henry Ackerman and Margaret Ackerman with George.",
    // Any lower-case linking words between the noun and the list, not a verb list.
    "One result: George Ackerman, Bucks County, PA, 1860 (collection 1473181). Household indexed as George, Henry, and Margaret Ackerman — spouse Catherine is absent from the index (relativeTerms.spouse: absent). Original image must be examined to determine whether Catherine appears on the page but was not indexed. Ad-hoc user-requested search; no plan item.",
    "Household as returned: George, Henry and Margaret Ackerman.",
  ])("refuses the roster %#", (n) => bad(n));

  it.each([
    "Ad-hoc user search. One result: George Ackerman, born ~1818, Pennsylvania, residing Bucks County 1860 (M7QZ-8KD, matchScore 0.9412). Spouse field absent in index stub; sidecar co-residents are Henry and Margaret Ackerman only — Catherine not present. Project objective specifies Berks County; this result is Bucks County — possible county mismatch or indexing error. Project already holds M4QZ-7YT (src_001, 7 assertions); live read of that record needed to confirm the Berks County household and Catherine's presence.",
    "Sidecar co-residents are Henry and Margaret Ackerman only.",
  ])("refuses the plural co-residents %#", (n) => bad(n));

  it("refuses 'household of' one named person, which no roster reaches", () => {
    bad("Amos Whitfield listed under the Household of Nancy Doss.");
  });

  it("refuses a plural role parted from its names by punctuation, not a singular field label", () => {
    bad("James M McElwee (b. 1817 Louisiana) plus sons, Thos T McElwee (b. 1839) and Stephen McElwee (b. 1842).");
    ok("Marriage entry matches the christening. Groom's father: Christopher Jespersen, a new name.");
  });

  it("refuses a possessive kinship claim only against a staged census payload", () => {
    const n = "Amos Whitfield (b. 1817, Georgia), 1850 census entry filed under Nancy Doss. Ezra and Noah Whitfield, also in that entry, are Amos's children.";
    bad(n);
    expect(() => requirePre1880CensusHedge(n)).not.toThrow();
    ok("Ezra and Noah Whitfield, also in that entry, are likely Amos's children, inferred from surname and age.");
  });

  it.each([
    "Mary Flynn listed as wife.",
    "Thomas Flynn as head, Mary as wife.",
    "Household head Thomas Flynn, b. 1822.",
  ])("refuses a role stated with 'as' or after 'household head' %#", (n) => bad(n));

  it.each([
    // A negative result names no head.
    "1850 census: no Stribling appeared as a household head on any readable page.",
    // What another record states, in the sentence that names it, initial and all.
    "Born ~1785 per 1870 census. Gerusha's identity is ruled out by the death records naming Sarah A. Bagley as mother.",
    "Top matches are child baptism records attached to KN3K-9Q3 (Chresten Nielsen as father).",
    // An index attribution is a hedge.
    "Thomas Flynn indexed as head.",
  ])("leaves a role 'as' alone where it is not a census claim %#", (n) => ok(n));

  it.each([
    "One result: Patrick Flynn. No co-residents listed.",
    "One result: Patrick Flynn. Co-residents not checked.",
  ])("does not read plural co-residents with no names as a claim %#", (n) => ok(n));

  it("reads state and country names in a roster as places, but not a state that is also a given name", () => {
    ok("Household search covered Ohio, Indiana and Kentucky.");
    ok("Household shows New York and Ireland as birthplaces.");
    bad("Household lists George and Virginia.");
  });

  it("reads a punctuated plural role only against a staged payload", () => {
    const n = "Searched 1850 census for children, Mary and John: nil.";
    expect(() => requirePre1880CensusHedge(n)).not.toThrow();
    bad(n);
  });

  it("takes 'before' off the year it touches, not every year in the run", () => {
    expect(censusMentions("before 1880 and 1880 census")).toEqual([
      { year: 1879, columnFrom: 1880 },
      { year: 1880, columnFrom: 1880 },
    ]);
  });

  it.each([
    // A tree-side role in a nil note is the tree's claim, not the census's.
    "Searched the 1860 census for Margaret Flynn, recorded in the tree as wife of Thomas; 0 results in Adams Co.",
    // A list of spellings is not a list of people.
    "1860 census nil. Household spellings tried: Flynn, Flinn and Flynne; none found.",
    // A list ending in a plural place noun is a list of places.
    "1850 census: household search of Fayette, Greene and Washington counties found no Ackerman.",
    // "None" after the colon names nobody.
    "Co-residents: None listed on the index.",
  ])("leaves a nil or search note alone that only looks like a claim %#", (n) => ok(n));

  it("still reads a roster after 'names', which lists people", () => {
    bad("Household names: George, Henry and Margaret.");
  });

  it("does not read 'spouse' as a role: in the corpus it is a search anchor", () => {
    ok("Anders Monsen in Norway Census with spouse Unna. All 50 results from 1801 census.");
  });

  it("accepts plural co-residents beside an index hedge", () => {
    ok("Co-residents indexed: Henry and Margaret Ackerman.");
  });

  it.each([
    "Ad-hoc user-requested search. One George Ackerman found in Bucks County, PA, born about 1818 in Pennsylvania. Household lists George, Henry Ackerman, and Margaret Ackerman — no Catherine appears. Full record read confirms three household members only; no relationships stated (pre-1880 census). The 1860 schedule does not record marriage year or relationship to head.",
    "Household shows George, Henry, and Margaret Ackerman; relationships inferred, not stated.",
    "Household lists George, Henry and Margaret; no relationship given.",
    "Household lists George and Henry. The 1860 schedule does not record relationship to head.",
  ])("accepts the hedged roster %#", (n) => ok(n));

  it.each([
    // A plan naming no one, and a nil: no roster follows the phrase.
    "Spouse field absent in index -- reading full record to view household members and marriage indicator.",
    "Bucks Co., PA household: no Whitfield found.",
    // One name is a subject, not a roster.
    "Household shows George only; Catherine absent.",
    // A list of places is not a list of people.
    "Household shows Bucks Co., PA and Pike Co., KY as residences.",
  ])("leaves a non-roster alone %#", (n) => ok(n));

  it("reads 'pre-1880 census' as a columnless census, not as 1880", () => {
    // Bound as 1880 it skipped the note outright, payload or not.
    expect(() =>
      requirePre1880CensusHedge("Household lists George, Henry and Margaret Ackerman (pre-1880 census)."),
    ).toThrow(/relationship-to-head/);
    expect(() =>
      requirePre1880CensusHedge("Household lists George and Henry (pre-1880 census); structure inferred."),
    ).not.toThrow();
    expect(censusMentions("pre-1880 census")).toEqual([{ year: 1879, columnFrom: 1880 }]);
    expect(censusMentions("1880 census")).toEqual([{ year: 1880, columnFrom: 1880 }]);
  });

  it("does not take 'does not record' about another field as a hedge", () => {
    bad("Household lists George, wife Margaret and son Henry. The schedule does not record the street address.");
  });
});

/**
 * Issue #3409: a staged British payload supplies the jurisdiction of an
 * UNQUALIFIED census mention. It never skips the check: 1841 stays refused.
 */
describe("the staged payload supplies an unqualified mention's jurisdiction (#3409)", () => {
  const gate = (n: string, columnFrom?: number) => () => requirePre1880CensusHedge(n, [], columnFrom);
  const JOB = "1851 census, Trowbridge: Job Purnell head of household, wife Ann.";
  const BRIERLEY = "Abel Brierley, b. 1858 Cheshire (1861 census, Abel's household). Father James Brierley, mother Mary.";
  const PURNELL_1841 =
    "1841 census: Household of Samuell Purnell, Thomas Street, Trowbridge. Members: Elizabeth Purnell (wife), Job Purnell (son).";
  const rows = (...titles: string[]) => titles.map((collectionTitle) => ({ collectionTitle }));
  const read = (...sources: { id: string; title: string }[]) => [{ recordId: "ark:/61903/1:1:X", gedcomx: { sources } }];

  it("accepts an unqualified 1851 mention against a British payload", () => {
    expect(gate(JOB, 1851)).not.toThrow();
    expect(gate(BRIERLEY, 1851)).not.toThrow();
  });

  it("still refuses the same notes with no payload", () => {
    expect(gate(JOB)).toThrow(/pre-1880 US census.*relationship-to-head/);
    expect(gate(BRIERLEY)).toThrow(/relationship-to-head/);
  });

  it("still refuses an unqualified 1841 mention against a British payload, in British words", () => {
    expect(gate(PURNELL_1841, 1851)).toThrow(/pre-1851 British census.*relationship-to-head/);
    expect(gate(PURNELL_1841, 1851)).not.toThrow(/\bUS\b/);
  });

  it("never re-jurisdictions an explicitly US mention", () => {
    expect(gate("1860 US census, Ohio: John Smith with wife Mary.", 1851)).toThrow(/pre-1880 US census/);
    expect(gate("1860 federal census, Ohio: John Smith with wife Mary.", 1851)).toThrow(/pre-1880 US census/);
  });

  it("names the 1841 British census in the refusal even with no payload", () => {
    expect(gate("1841 England Census, Trowbridge: Samuel Purnall household with wife Ann and son Job.")).toThrow(
      /pre-1851 British census/,
    );
  });

  it("keeps the US wording when a British and a US mention both fire", () => {
    expect(gate("1841 England census and 1860 US census: John Smith with wife Mary.")).toThrow(/pre-1880 US census/);
  });

  it("treats a non-place qualifier as unqualified", () => {
    expect(gate("1851 population census, Trowbridge: Job Purnell with wife Ann.", 1851)).not.toThrow();
  });

  it.each([
    ["England 1851 rows", rows("England and Wales, Census, 1851"), 1851],
    ["England 1871 + Cheshire school records", rows("England and Wales, Census, 1871", "England, Cheshire, School Records, 1796-1950"), 1851],
    ["Wiltshire church records", rows("England, Wiltshire, Church Records, 1518-1990"), 1851],
    ["untitled rows beside British ones", [{}, ...rows("England and Wales, Census, 1851")], 1851],
    ["US rows", rows("United States Census, 1850"), undefined],
    ["mixed England + US", rows("England and Wales, Census, 1851", "United States Census, 1850"), undefined],
    ["mixed US + England", rows("United States Census, 1850", "England and Wales, Census, 1851"), undefined],
    ["Norway (undocumented)", rows("Norway, Census, 1865"), undefined],
    ["Ecuador", rows("Ecuador, Census, 1737-1990"), undefined],
    ["no titled rows", [{}, { collectionTitle: 7 }], undefined],
    ["no rows", [], undefined],
  ])("record_search: %s", (_l, r, want) => expect(stagedPayloadColumnFrom("record_search", r)).toBe(want));

  it("record_read: reads the sd_c_ collection description", () => {
    expect(
      stagedPayloadColumnFrom(
        "record_read",
        read(
          { id: "sd_c_1493745", title: "England and Wales, Census, 1851" },
          { id: "sd_p_1", title: 'Job Purnell, "England and Wales, Census, 1851"' },
        ),
      ),
    ).toBe(1851);
  });

  it("record_read: ignores a British title on any source other than sd_c_", () => {
    expect(stagedPayloadColumnFrom("record_read", read({ id: "src_r_1", title: "England and Wales, Census, 1851" }))).toBe(undefined);
    expect(
      stagedPayloadColumnFrom(
        "record_read",
        read({ id: "src_r_1", title: "England and Wales, Census, 1851" }, { id: "sd_c_2", title: "United States Census, 1850" }),
      ),
    ).toBe(undefined);
  });

  it("record_read: no sources array, and a record_search row's collectionTitle, give nothing", () => {
    expect(stagedPayloadColumnFrom("record_read", [{ gedcomx: { sources: { _first_n: [] } } }])).toBe(undefined);
    expect(stagedPayloadColumnFrom("record_read", rows("England and Wales, Census, 1851"))).toBe(undefined);
  });

  it("any other tool gives nothing", () => {
    expect(stagedPayloadColumnFrom("fulltext_search", rows("England and Wales, Census, 1851"))).toBe(undefined);
    expect(
      stagedPayloadColumnFrom("fulltext_search", read({ id: "sd_c_1", title: "England and Wales, Census, 1851" })),
    ).toBe(undefined);
  });

  it.each([
    "1860 United States census, Ohio: John Smith with wife Mary.",
    "1860 U.S. census, Ohio: John Smith with wife Mary.",
    "1860 census of the United States, Ohio: John Smith with wife Mary.",
    "1860 census of the U.S. John Smith with wife Mary.",
    "Pre-1880 census: John Smith with wife Mary.",
    "1860 census for the USA: John Smith with wife Mary.",
  ])("keeps a US-worded mention US against a British payload (%#)", (n) => {
    expect(gate(n, 1851)).toThrow(/pre-1880 US census/);
  });

  it("uses the US wording when US payload rows alone fire", () => {
    expect(() => requirePre1880CensusHedge("Household: John Smith head, wife Mary, son Tom.", [1860])).toThrow(
      /pre-1880 US census/,
    );
  });

  it.each([
    ["the real title shape, no comma after Wales", "England and Wales Census, 1851", 1851],
    ["Scotland", "Scotland Census, 1861", 1851],
    ["a British word only after the first comma", "United States, Records of British Subjects, 1850", undefined],
    ["New England", "New England, Births and Deaths, 1650-1880", undefined],
    ["British Columbia", "British Columbia, Census, 1871", undefined],
  ])("record_search title: %s", (_l, title, want) =>
    expect(stagedPayloadColumnFrom("record_search", rows(title))).toBe(want),
  );

  it("record_read: an id-less source does not hide the sd_c_ one", () => {
    expect(
      stagedPayloadColumnFrom("record_read", read({ title: "x" } as never, { id: "sd_c_1", title: "England and Wales, Census, 1851" })),
    ).toBe(1851);
  });
});

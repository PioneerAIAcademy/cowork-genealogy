import { describe, it, expect } from "vitest";
import { requirePre1880CensusHedge, stagedPre1880UsCensusYears } from "../../src/tools/research-log-append.js";

/**
 * Issue #1284's rule, enforced where it binds. Both directions matter equally:
 * a refusal that fires on a compliant note blocks a researcher mid-write, which
 * is why the check is narrower than the eval validator's.
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

  it("falls back to the whole-note year when no year binds to a census at all", () => {
    // Undecidable on the year axis, so behaviour is unchanged rather than
    // silently permissive -- this is the one branch the binding does not reach.
    bad("The federal census shows Daniel in one dwelling with Margaret and sons Thomas and Stephen; marriage 1871, Adams County.");
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

  it("allows a note that omits the census year, the limit the tie accepts", () => {
    ok("1 result: Amos Whitfield in the Household of Nancy Doss.", [1850]);
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

  it("does not let a note-only refusal through when the payload year is absent", () => {
    // Says "census", binds no year, payload year not in the note: the old
    // whole-note fallback still runs, so nothing refused before is allowed now.
    bad(
      "The federal census shows Daniel in one dwelling with Margaret and sons Thomas and Stephen; marriage 1871, Adams County.",
      [1850],
    );
  });

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

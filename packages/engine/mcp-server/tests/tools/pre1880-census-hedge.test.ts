import { describe, it, expect } from "vitest";
import { requirePre1880CensusHedge } from "../../src/tools/research-log-append.js";

/**
 * Issue #1284's rule, enforced where it binds. Both directions matter equally:
 * a refusal that fires on a compliant note blocks a researcher mid-write, which
 * is why the check is narrower than the eval validator's.
 */
describe("requirePre1880CensusHedge", () => {
  const bad = (n: string) => expect(() => requirePre1880CensusHedge(n)).toThrow(/relationship-to-head/);
  const ok = (n: string) => expect(() => requirePre1880CensusHedge(n)).not.toThrow();

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

  it("ignores naming a tree-side relative the record did not contain", () => {
    // "searched for George's wife Catherine" is a statement about the TREE, not
    // about what the census stated — the validator's own carve-out.
    ok("Searched the 1860 census for his wife Catherine; she is absent from the return.");
  });
});

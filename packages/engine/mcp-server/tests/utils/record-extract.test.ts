/**
 * Tests for the code extractor (issue #2937).
 *
 * Every document here is a REAL captured `record_read` sidecar
 * (`tests/fixtures/record-extract/`, written by
 * `dev/capture-extract-fixtures.ts`), not a hand-built shape. That matters more
 * than usual on this card: the plan's first draft was built on two assumptions
 * about what FamilySearch returns, and the live probe refuted both
 * (`SOURCE_PERSON_NBR` does not exist on the schedules its rule was written for;
 * the 1870 census carries `PR_RELATIONSHIP_TO_HEAD="Head"` with no relationship
 * column). A hand-written fixture would have encoded those assumptions and
 * passed.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
  extractRecord,
  detectRecordType,
  censusStatedRelationships,
  normalizeFactType,
  censusKin,
  EXTRACTED_SOURCE_CLASSIFICATION,
  type ExtractDocument,
  type ExtractedAssertion,
} from "../../src/utils/record-extract.js";
import {
  relationshipCategory,
  subjectRoleInValue,
} from "../../src/tools/research-append.js";

const FIXTURES = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
  "record-extract",
);

function load(name: string): ExtractDocument {
  return JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), "utf8")).element;
}

function run(name: string) {
  return extractRecord(load(name), { logEntryId: "l_001", questionIds: ["q_001"] });
}

/** role for a person, looked up by their `name` assertion's value. */
function roleOf(assertions: ExtractedAssertion[], name: string): string | undefined {
  return assertions.find((a) => a.fact_type === "name" && a.value === name)?.record_role;
}

const rels = (as: ExtractedAssertion[]) => as.filter((a) => a.fact_type === "relationship");

// ─────────────────────────────────────────────────────────────────────────────

describe("censusStatedRelationships — the hard-coded year table", () => {
  it("US from 1880, not before", () => {
    expect(censusStatedRelationships("Ohio, United States", 1880)).toBe(true);
    expect(censusStatedRelationships("Ohio, United States", 1900)).toBe(true);
    expect(censusStatedRelationships("Ohio, United States", 1870)).toBe(false);
    expect(censusStatedRelationships("Ohio, United States", 1850)).toBe(false);
  });

  it("England and Wales from 1851, not before", () => {
    expect(censusStatedRelationships("Worcestershire, England", 1851)).toBe(true);
    expect(censusStatedRelationships("Worcestershire, England", 1861)).toBe(true);
    expect(censusStatedRelationships("Worcestershire, England", 1841)).toBe(false);
  });

  it("returns null for a jurisdiction not in the table", () => {
    // Null, not false, so the caller can SAY it did not know. It still
    // withholds relationship assertions — the conservative direction.
    expect(censusStatedRelationships("Parana, Brazil", 1880)).toBeNull();
    expect(censusStatedRelationships(undefined, 1880)).toBeNull();
    expect(censusStatedRelationships("Ohio, United States", undefined)).toBeNull();
  });
});

describe("a census WITHOUT a relationship column (US 1870)", () => {
  const out = run("census-1870-no-relationship-column");

  it("is a census, and the table says it states no relationships", () => {
    expect(out.recordType).toBe("census");
    expect(out.censusStatesRelationships).toBe(false);
  });

  it("assigns the lead's role vocabulary positionally", () => {
    // Head 25, wife 21 (same surname, opposite sex, plausible gap); the 79- and
    // 65-year-old Millers are a DIFFERENT surname from the head and far too old
    // to be his children, so they are household members, not kin.
    expect(roleOf(out.assertions, "John Boyer")).toBe("head_of_household");
    expect(roleOf(out.assertions, "Anna Boyer")).toBe("wife");
    expect(roleOf(out.assertions, "Henry Miller")).toBe("household_member_1");
    expect(roleOf(out.assertions, "Catharine Miller")).toBe("household_member_2");
  });

  it("writes ZERO relationship assertions — item 4, the whole point", () => {
    expect(rels(out.assertions)).toHaveLength(0);
  });

  it("does not let the indexer's 'Head' value decide the column", () => {
    // This record CARRIES PR_RELATIONSHIP_TO_HEAD="Head" on its first person.
    // The 1870 schedule has no relationship column, so a rule keyed on the
    // field's presence would have called this a stated-relationship census and
    // written parent-child assertions the record never made.
    const doc = load("census-1870-no-relationship-column");
    expect(doc.indexFields?.[Object.keys(doc.indexFields ?? {})[0]]?.relationshipToHead)
      .toBe("Head");
    expect(out.censusStatesRelationships).toBe(false);
    expect(rels(out.assertions)).toHaveLength(0);
  });
});

describe("a census WITHOUT a relationship column and without the field (US 1850)", () => {
  const out = run("census-1850-no-relationship-column");

  it("still assigns positional roles with no relationship field at all", () => {
    expect(out.recordType).toBe("census");
    expect(out.censusStatesRelationships).toBe(false);
    const roles = new Set(out.assertions.map((a) => a.record_role));
    expect(roles.has("head_of_household")).toBe(true);
    expect([...roles].some((r) => /^child_\d+$/.test(r))).toBe(true);
  });

  it("writes zero relationship assertions", () => {
    expect(rels(out.assertions)).toHaveLength(0);
  });
});

describe("a census WITH a relationship column (US 1880)", () => {
  const out = run("census-1880-with-relationship-column");

  it("reads the stated relation rather than guessing positionally", () => {
    expect(out.censusStatesRelationships).toBe(true);
    expect(roleOf(out.assertions, "Charles Miller")).toBe("head_of_household");
    const roles = new Set(out.assertions.map((a) => a.record_role));
    expect(roles.has("wife")).toBe(true);
    expect([...roles].filter((r) => /^child_\d+$/.test(r)).length).toBeGreaterThan(5);
  });

  it("DOES write relationship assertions, each anchored to the head", () => {
    const r = rels(out.assertions);
    expect(r.length).toBeGreaterThan(0);
    for (const a of r) {
      expect(a.record_basis).toBe("stated");
      expect(a.structured_value?.related_person_role).toBe("head_of_household");
      expect(a.value).toMatch(/ of Charles Miller$/);
    }
  });

  it("declares the SUBJECT's own role, in the direction the writer enforces", () => {
    // `validateRelationshipDirection` parses the value and refuses when it
    // disagrees with `relationship_type`. Cross-checked against the real
    // validator below.
    const wife = rels(out.assertions).find((a) => a.record_role === "wife")!;
    expect(wife.structured_value?.relationship_type).toBe("spouse");
    expect(wife.value).toBe("wife of Charles Miller");
  });
});

describe("a marriage record", () => {
  const out = run("marriage");

  it("types as a marriage although no PERSON carries a Marriage fact", () => {
    // The Marriage fact is on the Couple relationship. Counting person facts
    // typed this record as a birth, because all six personas carry a Birth.
    expect(out.recordType).toBe("marriage");
  });

  it("picks the couple carrying the marriage fact, not the first couple edge", () => {
    // This record lists the GROOM'S PARENTS' couple first. Taking couples[0]
    // made the groom's father the groom.
    expect(roleOf(out.assertions, "Chancey F. Miller")).toBe("groom");
    expect(roleOf(out.assertions, "Olive E. Durfey")).toBe("bride");
  });

  it("names the parents on each side", () => {
    expect(roleOf(out.assertions, "Frank Miller")).toBe("father_of_groom");
    expect(roleOf(out.assertions, "Ellen Traxler")).toBe("mother_of_groom");
    expect(roleOf(out.assertions, "S.d. Jackson")).toBe("father_of_bride");
    expect(roleOf(out.assertions, "Banks")).toBe("mother_of_bride");
  });

  it("classifies the parties' own facts at self/primary", () => {
    const groomName = out.assertions.find(
      (a) => a.record_role === "groom" && a.fact_type === "name",
    )!;
    expect(groomName.informant_proximity).toBe("self");
    expect(groomName.information_quality).toBe("primary");
  });
});

describe("a death record", () => {
  const out = run("death");

  it("types as a death and roles the principal deceased", () => {
    expect(out.recordType).toBe("death");
    expect(out.assertions.some((a) => a.record_role === "deceased")).toBe(true);
  });

  it("classifies the decedent's biography at family_not_present/secondary", () => {
    const name = out.assertions.find((a) => a.fact_type === "name")!;
    expect(name.informant_proximity).toBe("family_not_present");
    expect(name.information_quality).toBe("secondary");
  });

  it("classifies the death event itself at official_duty/primary", () => {
    const ev = out.assertions.find((a) => a.fact_type === "death");
    if (ev) {
      expect(ev.informant_proximity).toBe("official_duty");
      expect(ev.information_quality).toBe("primary");
    }
  });
});

describe("a christening record", () => {
  const out = run("baptism");

  it("roles the principal as the child and names the parents", () => {
    expect(out.recordType).toBe("christening");
    expect(out.assertions.some((a) => a.record_role === "child")).toBe(true);
    const roles = new Set(out.assertions.map((a) => a.record_role));
    expect(roles.has("father") || roles.has("mother")).toBe(true);
  });

  it("never classifies a christened infant's own facts as self", () => {
    // A christened infant cannot report. The presenting parent supplied them.
    for (const a of out.assertions.filter((a) => a.record_role === "child")) {
      expect(a.informant_proximity).not.toBe("self");
    }
  });

  it("works with NO index fields at all", () => {
    // This fixture carries none — the path a non-census record takes.
    expect(load("baptism").indexFields).toBeUndefined();
    expect(out.assertions.length).toBeGreaterThan(0);
  });
});

describe("classification, basis and provenance across every fixture", () => {
  const names = [
    "census-1880-with-relationship-column",
    "census-1870-no-relationship-column",
    "census-1850-no-relationship-column",
    "marriage",
    "death",
    "baptism",
  ];

  it("never emits the literal record_role 'absent'", () => {
    // Negative evidence is the caller's: it is a claim about a person the
    // record does NOT contain, which no document can supply.
    for (const n of names) {
      for (const a of run(n).assertions) expect(a.record_role).not.toBe("absent");
    }
  });

  it("sets record_persona_id PER PERSONA, never one id across the record", () => {
    // The auto-fill bug this replaces stamped the searched persona's id onto
    // assertions about someone else, 16 times in the e2e corpus.
    for (const n of names) {
      const out = run(n);
      const doc = load(n);
      const personIds = new Set((doc.gedcomx.persons ?? []).map((p) => p.id));
      const seen = new Set(out.assertions.map((a) => a.record_persona_id));
      for (const id of seen) expect(personIds.has(id as string)).toBe(true);
      if ((doc.gedcomx.persons ?? []).length > 1) expect(seen.size).toBeGreaterThan(1);
    }
  });

  it("stamps the log entry and the caller's questions on every assertion", () => {
    for (const n of names) {
      for (const a of run(n).assertions) {
        expect(a.log_entry_id).toBe("l_001");
        expect(a.extracted_for_question_ids).toEqual(["q_001"]);
      }
    }
  });

  it("emits only in-enum classification values", () => {
    const quality = new Set(["primary", "secondary", "indeterminate"]);
    const proximity = new Set([
      "self", "witness", "household_member", "family_not_present",
      "researcher", "official_duty", "unknown",
    ]);
    const basis = new Set(["stated", "inferred", "absent"]);
    for (const n of names) {
      for (const a of run(n).assertions) {
        expect(quality.has(a.information_quality)).toBe(true);
        expect(proximity.has(a.informant_proximity)).toBe(true);
        expect(basis.has(a.record_basis)).toBe(true);
      }
    }
  });

  it("honours precondition 2 — unknown proximity implies indeterminate", () => {
    // The writer refuses otherwise, so an extractor that broke this would be
    // refused on every call.
    for (const n of names) {
      for (const a of run(n).assertions) {
        if (a.informant_proximity === "unknown") {
          expect(a.information_quality).toBe("indeterminate");
        }
      }
    }
  });

  it("marks a derived birth year inferred and the birthplace stated", () => {
    const out = run("census-1870-no-relationship-column");
    const births = out.assertions.filter((a) => a.fact_type === "birth");
    const dated = births.filter((a) => a.date);
    const placed = births.filter((a) => a.place);
    expect(dated.length).toBeGreaterThan(0);
    expect(placed.length).toBeGreaterThan(0);
    // Atomic: no assertion carries both, because they do not share a basis.
    for (const b of births) expect(!!(b.date && b.place)).toBe(false);
    for (const b of dated) {
      expect(b.record_basis).toBe("inferred");
      expect(b.date_certainty).toBe("approximate");
    }
    for (const b of placed) expect(b.record_basis).toBe("stated");
  });
});

describe("the defaulted-classification report", () => {
  it("names every assertion that fell to the default", () => {
    // A record type with no table row must be VISIBLE: `unknown` switches off
    // contradictionIsCredible, so a silent default weakens a guard.
    const doc: ExtractDocument = {
      recordId: "rec1",
      gedcomx: {
        sources: [{ resource_type: "http://gedcomx.org/Collection", title: "Ohio, Probate Records" }],
        persons: [
          { id: "p1", principal: true, names: [{ given: "Thomas", surname: "Doyle" }] },
        ],
      },
    };
    const out = extractRecord(doc, { logEntryId: "l_001", questionIds: [] });
    expect(out.recordType).toBe("other");
    expect(out.defaultedClassifications.length).toBeGreaterThan(0);
    expect(out.defaultedClassifications[0]).toMatch(/unknown\/indeterminate/);
    expect(out.defaultedClassifications[0]).toMatch(/contradiction/i);
    for (const a of out.assertions) {
      expect(a.informant_proximity).toBe("unknown");
      expect(a.information_quality).toBe("indeterminate");
    }
  });

  it("reports NOTHING defaulted when every row is a real table entry", () => {
    // The other direction: a report that always fires is not a report.
    for (const n of ["census-1870-no-relationship-column", "marriage", "death"]) {
      expect(run(n).defaultedClassifications).toEqual([]);
    }
  });
});

describe("cross-check against the writer that will accept these", () => {
  it("every relationship category the extractor emits is one the writer knows", () => {
    // record-extract.ts cannot import RELATION_CATEGORY (utils -> tools is
    // banned), so this test is what keeps the two vocabularies in step.
    for (const rel of ["Head", "Wife", "Son", "Dau", "Daughter", "Father", "Mother", "Brother", "Sister"]) {
      const kin = censusKin(rel);
      if (!kin) continue;
      expect(relationshipCategory(kin.category)).toBe(kin.category);
    }
  });

  it("every value the extractor builds parses back to the category it declared", () => {
    // This is the exact check `validateRelationshipDirection` performs before
    // accepting the write. A disagreement here is a refusal in production.
    for (const n of ["census-1880-with-relationship-column", "marriage", "baptism"]) {
      for (const a of rels(run(n).assertions)) {
        const declared = a.structured_value?.relationship_type as string;
        const stated = subjectRoleInValue(a.value);
        expect(
          stated,
          `value ${JSON.stringify(a.value)} did not parse to a subject role`,
        ).toBeTruthy();
        expect(stated, `value ${JSON.stringify(a.value)} vs type ${declared}`).toBe(declared);
      }
    }
  });
});

describe("helpers", () => {
  it("normalizes fact-type casing", () => {
    // ~8% of corpus assertions carry the PascalCase spelling.
    expect(normalizeFactType("Name")).toBe("name");
    expect(normalizeFactType("Birth")).toBe("birth");
    expect(normalizeFactType("Residence")).toBe("residence");
    expect(normalizeFactType("http://gedcomx.org/MaritalStatus")).toBe("marital_status");
    expect(normalizeFactType("CauseOfDeath")).toBe("cause_of_death");
    expect(normalizeFactType(undefined)).toBe("");
  });

  it("maps census relation spellings, and declines the non-kin ones", () => {
    expect(censusKin("Dau")).toEqual({ word: "daughter", category: "child" });
    expect(censusKin("Son")).toEqual({ word: "son", category: "child" });
    expect(censusKin("Wife")).toEqual({ word: "wife", category: "spouse" });
    // Co-residence is not kinship.
    expect(censusKin("Boarder")).toBeUndefined();
    expect(censusKin("Servant")).toBeUndefined();
    expect(censusKin(undefined)).toBeUndefined();
  });

  it("states what it sets for source_classification, and why", () => {
    // What was read is the INDEX, not the schedule. Calling it `original`
    // claims an examination that did not happen.
    expect(EXTRACTED_SOURCE_CLASSIFICATION).toBe("derivative");
  });

  it("detects a record type from an empty document without throwing", () => {
    expect(detectRecordType({})).toBe("other");
    expect(() => extractRecord({ recordId: "r", gedcomx: {} }, { logEntryId: "l", questionIds: [] })).not.toThrow();
  });
});

describe("record-type detection by collection title", () => {
  const titled = (title: string) => ({
    recordId: "r",
    gedcomx: {
      sources: [{ resource_type: "http://gedcomx.org/Collection", title }],
      persons: [{ id: "p1", principal: true, names: [{ given: "A", surname: "B" }] }],
    },
  });

  it("does not read a place name containing 'land' as a land record", () => {
    // A real defect the scorer caught, and not merely a mislabel: every
    // "Scotland, Civil Registration" record in the corpus typed as a land deed,
    // which applies the death/burial-adjacent `other` table to a BIRTH record.
    // /land/i matches all of these.
    for (const t of [
      "Scotland, Civil Registration, 1855-1875",
      "Ireland, Catholic Parish Registers",
      "Maryland, Births and Christenings",
      "Finland, Church Census",
      "Netherlands, Civil Registration",
      "England, Cumberland Parish Registers",
    ]) {
      expect(detectRecordType(titled(t).gedcomx), t).not.toBe("land");
    }
  });

  it("still detects a real land record", () => {
    for (const t of [
      "United States, Bureau of Land Management Tract Books, 1800-c. 1955",
      "Ohio, Wills and Deeds, ca. 1700s-2017",
      "Texas, Land Grants",
      "Kentucky, Land Patents",
    ]) {
      expect(detectRecordType(titled(t).gedcomx), t).toBe("land");
    }
  });

  it("detects a draft registration without matching every 'registration'", () => {
    expect(
      detectRecordType(titled("United States, World War I Draft Registration Cards, 1917-1918").gedcomx),
    ).toBe("draft_registration");
    // "Civil Registration" is not a draft card.
    expect(detectRecordType(titled("Scotland, Civil Registration, 1855-1875").gedcomx)).not.toBe(
      "draft_registration",
    );
  });

  it("gives a land record grantee/grantor roles", () => {
    const doc = {
      recordId: "r",
      gedcomx: {
        sources: [{ resource_type: "http://gedcomx.org/Collection", title: "Tract Books" }],
        persons: [
          { id: "p1", principal: true, names: [{ given: "A", surname: "B" }] },
          { id: "p2", names: [{ given: "C", surname: "D" }] },
        ],
      },
    };
    const out = extractRecord(doc, { logEntryId: "l", questionIds: [] });
    expect(out.recordType).toBe("land");
    const roles = new Set(out.assertions.map((a) => a.record_role));
    expect(roles.has("grantee")).toBe(true);
    expect(roles.has("grantor_1")).toBe(true);
  });
});

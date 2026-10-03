/**
 * Tests for the per-persona index-field lift (issue #2937).
 *
 * The shapes here are trimmed from real raw-GedcomX bodies observed by
 * `dev/probe-census-persona-fields.ts` — the label ids, the `_ORIG` twins, and
 * the fact-level `EVENT_*` labels are all as FamilySearch returns them.
 */

import { describe, it, expect } from "vitest";
import {
  personaIndexFields,
  recordIndexFields,
} from "../../src/utils/record-index-fields.js";

/** A raw person carrying the labels a US 1880 census persona actually has. */
const census1880Person = {
  id: "p_269703797",
  fields: [
    {
      values: [
        { labelId: "PR_RELATIONSHIP_TO_HEAD_ORIG", text: "Dau" },
        { labelId: "PR_RELATIONSHIP_TO_HEAD", text: "Daughter" },
      ],
    },
    { values: [{ labelId: "FS_SORT_KEY", text: "0000000005162011_00746_009" }] },
    { values: [{ labelId: "SOURCE_PERSON_NBR_ORIG", text: "9" }] },
    { values: [{ labelId: "PR_EXT_LINE_NBR_ORIG", text: "00079" }] },
    { values: [{ labelId: "SOURCE_HOUSEHOLD_ID_ORIG", text: "5982156" }] },
    { values: [{ labelId: "PR_AGE_ORIG", text: "18" }, { labelId: "PR_AGE", text: "18" }] },
    { values: [{ labelId: "PR_FTHR_BIR_PLACE", text: "Pennsylvania, United States" }] },
    { values: [{ labelId: "PR_MTHR_BIR_PLACE", text: "Ohio, United States" }] },
  ],
};

describe("personaIndexFields", () => {
  it("lifts every label a census persona carries", () => {
    expect(personaIndexFields(census1880Person)).toEqual({
      relationshipToHead: "Daughter",
      sortKey: "0000000005162011_00746_009",
      personNbr: "9",
      lineNbr: "00079",
      householdId: "5982156",
      age: "18",
      fatherBirthPlace: "Pennsylvania, United States",
      motherBirthPlace: "Ohio, United States",
    });
  });

  it("prefers the normalized value over its _ORIG twin", () => {
    // Observed live on one record: `Dau` in _ORIG, `Daughter` normalized. A
    // role rule matching on "Daughter" must not be handed "Dau".
    expect(personaIndexFields(census1880Person)!.relationshipToHead).toBe("Daughter");
  });

  it("falls back to _ORIG when only that is present", () => {
    const p = {
      id: "p_1",
      fields: [{ values: [{ labelId: "PR_RELATIONSHIP_TO_HEAD_ORIG", text: "Wife" }] }],
    };
    expect(personaIndexFields(p)!.relationshipToHead).toBe("Wife");
  });

  it("reads only PERSON-level fields, never fact-level ones", () => {
    // `EVENT_*` labels hang off facts and are not per-person index data. A
    // walker that descended into facts would pick up the household's census
    // place as though it were this person's, which is why the reader stops at
    // `person.fields`.
    const p = {
      id: "p_1",
      facts: [
        {
          type: "http://gedcomx.org/Census",
          fields: [
            { values: [{ labelId: "PR_AGE", text: "999" }] },
            { values: [{ labelId: "EVENT_PLACE", text: "Bath, Summit, Ohio" }] },
          ],
        },
      ],
    };
    expect(personaIndexFields(p)).toBeUndefined();
  });

  it("returns undefined for a persona with no fields at all", () => {
    // The ordinary shape of a co-resident in a record_SEARCH response.
    expect(personaIndexFields({ id: "p_1" })).toBeUndefined();
    expect(personaIndexFields({ id: "p_1", fields: [] })).toBeUndefined();
  });

  it("ignores blank and non-string values rather than lifting them", () => {
    const p = {
      id: "p_1",
      fields: [
        { values: [{ labelId: "FS_SORT_KEY", text: "   " }] },
        { values: [{ labelId: "PR_AGE", text: 42 }] },
        { values: [{ labelId: "SOURCE_HOUSEHOLD_ID_ORIG", text: "144" }] },
      ],
    };
    expect(personaIndexFields(p)).toEqual({ householdId: "144" });
  });

  it("survives malformed input without throwing", () => {
    for (const bad of [null, undefined, 42, "x", { fields: "no" }, { fields: [null] }]) {
      expect(() => personaIndexFields(bad)).not.toThrow();
    }
  });
});

describe("recordIndexFields", () => {
  it("keys each persona's fields by its person id", () => {
    const body = {
      persons: [
        census1880Person,
        {
          id: "p_269703795",
          fields: [{ values: [{ labelId: "FS_SORT_KEY", text: "..._007" }] }],
        },
      ],
    };
    const out = recordIndexFields(body)!;
    expect(Object.keys(out).sort()).toEqual(["p_269703795", "p_269703797"]);
    expect(out.p_269703795).toEqual({ sortKey: "..._007" });
  });

  it("omits a persona that carries nothing, rather than storing an empty object", () => {
    const body = {
      persons: [
        { id: "p_1", fields: [{ values: [{ labelId: "FS_SORT_KEY", text: "k" }] }] },
        { id: "p_2" },
      ],
    };
    const out = recordIndexFields(body)!;
    expect(out.p_2).toBeUndefined();
    expect(Object.keys(out)).toEqual(["p_1"]);
  });

  it("returns undefined when NO persona carries anything", () => {
    // The whole map is then omitted from the staged element, so a record type
    // with no index fields stages exactly what it staged before this existed.
    expect(recordIndexFields({ persons: [{ id: "p_1" }, { id: "p_2" }] })).toBeUndefined();
  });

  it("skips a person with no usable id", () => {
    const body = {
      persons: [
        { fields: [{ values: [{ labelId: "FS_SORT_KEY", text: "k" }] }] },
        { id: "", fields: [{ values: [{ labelId: "FS_SORT_KEY", text: "k" }] }] },
      ],
    };
    expect(recordIndexFields(body)).toBeUndefined();
  });

  it("returns undefined for a body with no persons array", () => {
    for (const bad of [null, undefined, {}, { persons: "no" }, 42]) {
      expect(recordIndexFields(bad)).toBeUndefined();
    }
  });

  it("carries the 1870 shape the year table exists for", () => {
    // Measured live (dev/try-record-read-index-fields.ts, record MZGS-1BH): the
    // 1870 US schedule has NO relationship column, yet the index supplies
    // "Head" on the first person and nothing on the rest. A rule that decided
    // "this census states relationships" from the field's presence would be
    // wrong on exactly this record.
    const body = {
      persons: [
        {
          id: "p_260900945",
          fields: [
            { values: [{ labelId: "PR_RELATIONSHIP_TO_HEAD", text: "Head" }] },
            { values: [{ labelId: "FS_SORT_KEY", text: "..._000" }] },
            { values: [{ labelId: "SOURCE_HOUSEHOLD_ID_ORIG", text: "144" }] },
          ],
        },
        {
          id: "p_260900946",
          fields: [
            { values: [{ labelId: "FS_SORT_KEY", text: "..._001" }] },
            { values: [{ labelId: "SOURCE_HOUSEHOLD_ID_ORIG", text: "144" }] },
          ],
        },
      ],
    };
    const out = recordIndexFields(body)!;
    expect(out.p_260900945.relationshipToHead).toBe("Head");
    expect(out.p_260900946.relationshipToHead).toBeUndefined();
    // Same household, so roles are assigned across both.
    expect(out.p_260900945.householdId).toBe(out.p_260900946.householdId);
  });
});

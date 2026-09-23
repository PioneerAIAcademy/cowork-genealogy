import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { singleOk, failure, errorsOf } from "../helpers/narrow.js";
import { mkdtemp, writeFile, readFile, rm, mkdir, access } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

// Stub the network place resolver so the composite place-lever tests are
// offline and deterministic. The wrong-geocode mapping (England → Cameroon)
// reproduces the silent-wrong-standard_place theme the country guard catches.
vi.mock("../../src/utils/place-resolver.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/utils/place-resolver.js")>();
  return {
    ...actual,
    resolveStandardPlace: vi.fn(async (text: string) => {
      if (text === "Schuylkill County, Pennsylvania") return "Schuylkill, Pennsylvania, United States";
      if (text === "West Bromwich, England") return "Bamenda, Mezam, Northwest Region, Cameroon";
      if (text === "West Bromwich, Staffordshire, England")
        return "West Bromwich, Staffordshire, England, United Kingdom";
      return null;
    }),
  };
});

import { researchAppend, countryConsistency } from "../../src/tools/research-append.js";
import { validateProject } from "../../src/validation/validator.js";
import {
  recordImageReadCap,
  sourceImageCapState,
  __clearTruncatedSourceImagesForTests,
} from "../../src/utils/image-store.js";
import { extractionAppend } from "../../src/tools/extraction-append.js";
import { __testing, exampleHints } from "../../src/tools/research-append-examples.js";
import { resolveStandardPlace } from "../../src/utils/place-resolver.js";

const citationDetail = {
  who: "Census enumerator",
  what: "1850 U.S. Census",
  when_created: "1850",
  when_accessed: "2026-01-01",
  where: "Schuylkill County, Pennsylvania",
  where_within: "dwelling 201",
};
const validSource = (id: string) => ({
  id,
  gedcomx_source_description_id: "SD-001",
  citation: "1850 U.S. Census, Schuylkill County, PA",
  citation_detail: citationDetail,
  source_classification: "original",
  repository: "NARA",
  access_date: "2026-01-01",
});
const validAssertion = (id: string, sourceId = "src_001") => ({
  id,
  source_id: sourceId,
  record_id: "rec1",
  record_role: "principal",
  fact_type: "birth",
  value: "1850",
  information_quality: "primary",
  informant: "self",
  informant_proximity: "self",
  record_basis: "stated",
  extracted_for_question_ids: [],
});

// Explicitly typed: with a bare `return { ... }` TypeScript infers every
// empty-array field as `never[]`, so a test that later assigns a real entry
// (`research.person_evidence = [{ ... }]`) fails to assign to `never`. The
// arrays are heterogeneous fixture shapes rather than the strict schema types,
// so `Record<string, unknown>[]` is the honest annotation — it says "objects,
// shape checked by the validator under test", which is what these fixtures are.
function baseResearch(): {
  project: Record<string, unknown>;
  questions: Record<string, unknown>[];
  plans: Record<string, unknown>[];
  log: Record<string, unknown>[];
  sources: Record<string, unknown>[];
  assertions: Record<string, unknown>[];
  person_evidence: Record<string, unknown>[];
  conflicts: Record<string, unknown>[];
  hypotheses: Record<string, unknown>[];
  timelines: Record<string, unknown>[];
  proof_summaries: Record<string, unknown>[];
  evaluations: Record<string, unknown>[];
} {
  return {
    project: { id: "rp_001", objective: "Test", status: "active", created: "2026-01-01", updated: "2026-01-01" },
    questions: [],
    plans: [],
    log: [],
    sources: [validSource("src_001")],
    assertions: [validAssertion("a_001")],
    person_evidence: [],
    conflicts: [],
    hypotheses: [],
    timelines: [],
    proof_summaries: [],
    evaluations: [],
  };
}
const baseTree = {
  persons: [{ id: "I1", gender: "Male", names: [{ id: "N1", given: "John", surname: "Smith" }] }],
  relationships: [],
  sources: [{ id: "SD-001", title: "1850 U.S. Census" }],
};

describe("research_append (Phase 1)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "research-append-test-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writeProject(research: any = baseResearch(), tree: any = baseTree) {
    await writeFile(join(dir, "research.json"), JSON.stringify(research, null, 2));
    await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify(tree, null, 2));
  }
  const readResearch = async () => JSON.parse(await readFile(join(dir, "research.json"), "utf-8"));

  // ─── #2472: an assertion correction reaches the fact minted from it ─────────
  //
  // Shapes chosen from the committed e2e corpus, not from what is easiest to
  // assert: of the 145 assertion-`update` ops touching the mirrored four,
  // 127 set `standard_place` alone, 6 `value` alone, 6 `date`+`value`,
  // 4 `place`+`date`+`value`, and 2 `place`+`standard_place`+`value`
  // (re-measured 2026-09-14 over eval/runlogs/e2e/*/run-*.json).

  describe("assertion update rewrites the linked tree fact (#2472)", () => {
    /** An assertion carrying a place/date/value, with the schema's required fields. */
    const backlinkAssertion = (over: Record<string, unknown> = {}) => ({
      id: "a_011",
      source_id: "src_001",
      record_id: "rec1",
      record_role: "principal",
      fact_type: "immigration",
      value: "Immigrated to Canada, 1924; destination Odessa, Saskatchewan",
      date: "1924",
      place: "Wellburn, Thames Centre, Middlesex, Ontario, Canada",
      standard_place: "Thames Centre Township, Middlesex, Ontario, Canada",
      information_quality: "primary",
      informant: "self",
      informant_proximity: "self",
      record_basis: "stated",
      extracted_for_question_ids: [],
      ...over,
    });

    /** A tree whose I1 holds one backlinked fact. */
    const treeWithBacklink = (fact: Record<string, unknown> = {}) => ({
      persons: [
        {
          id: "I1",
          gender: "Male",
          names: [{ id: "N1", given: "John", surname: "Smith" }],
          facts: [
            {
              id: "F4",
              type: "Immigration",
              date: "1924",
              place: "Wellburn, Thames Centre, Middlesex, Ontario, Canada",
              standard_place: "Thames Centre Township, Middlesex, Ontario, Canada",
              assertion_id: "a_011",
              sources: [{ ref: "SD-001", quality: 3 }],
              ...fact,
            },
          ],
        },
      ],
      relationships: [],
      sources: [{ id: "SD-001", title: "1850 U.S. Census" }],
    });

    const withAssertion = (a: Record<string, unknown>) => {
      const r = baseResearch();
      r.assertions = [a];
      return r;
    };

    const readTree = async () => JSON.parse(await readFile(join(dir, "tree.gedcomx.json"), "utf-8"));
    const factF4 = async () =>
      (await readTree()).persons.find((p: any) => p.id === "I1").facts.find((f: any) => f.id === "F4");

    it("(1) the dominant shape: `standard_place` alone is rewritten, `place` left alone", async () => {
      await writeProject(withAssertion(backlinkAssertion()), treeWithBacklink());

      const r = await researchAppend({
        projectPath: dir,
        section: "assertions",
        op: "update",
        entryId: "a_011",
        fields: { standard_place: "Odessa, Francis No. 127, Saskatchewan, Canada" },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.filesWritten).toContain("tree.gedcomx.json");

      const f = await factF4();
      expect(f.standard_place).toBe("Odessa, Francis No. 127, Saskatchewan, Canada");
      // Untouched by this op, so it still mirrors the assertion.
      expect(f.place).toBe("Wellburn, Thames Centre, Middlesex, Ontario, Canada");
      expect(f.assertion_id).toBe("a_011");
    });

    it("(2) `place`+`date`+`value` on an EVENT fact rewrites place and date but NOT value", async () => {
      // #711: `factCandidate` never copies an assertion's `value` onto an event
      // fact, so neither may the rewrite — the assertion's value is a prose
      // sentence, and writing it into an Immigration fact's `value` would be a
      // fresh defect rather than a fix.
      await writeProject(withAssertion(backlinkAssertion()), treeWithBacklink());

      const r = await researchAppend({
        projectPath: dir,
        section: "assertions",
        op: "update",
        entryId: "a_011",
        fields: {
          place: "Odessa, Francis No. 127, Saskatchewan, Canada",
          date: "1925",
          value: "Immigrated to Canada, 1925; destination Odessa, Saskatchewan (manifest image)",
        },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;

      const f = await factF4();
      expect(f.place).toBe("Odessa, Francis No. 127, Saskatchewan, Canada");
      expect(f.date).toBe("1925");
      expect(f.value).toBeUndefined();
    });

    it("(3) `place`+`standard_place`+`value` on a VALUE-BEARING fact rewrites all three", async () => {
      await writeProject(
        withAssertion(backlinkAssertion({ fact_type: "occupation", value: "Farmer" })),
        // `value` mirrors the assertion's pre-call reading: a fact holding a
        // value the assertion never asserted is another source's evidence, and
        // the provenance guard leaves it alone.
        treeWithBacklink({ type: "Occupation", value: "Farmer" }),
      );

      const r = await researchAppend({
        projectPath: dir,
        section: "assertions",
        op: "update",
        entryId: "a_011",
        fields: {
          place: "Odessa, Francis No. 127, Saskatchewan, Canada",
          standard_place: "Odessa, Francis No. 127, Saskatchewan, Canada",
          value: "Blacksmith",
        },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;

      const f = await factF4();
      expect(f.place).toBe("Odessa, Francis No. 127, Saskatchewan, Canada");
      expect(f.standard_place).toBe("Odessa, Francis No. 127, Saskatchewan, Canada");
      expect(f.value).toBe("Blacksmith");
    });

    it("(4) a country contradiction clears the fact's standard_place and warns, without failing", async () => {
      // No shipped path writes a contradicting standard_place: research_append's
      // append arm errors, tree_edit clears + warns, gedcomx-convert omits. This
      // rewrite must not become the first.
      await writeProject(
        withAssertion(backlinkAssertion({ standard_place: "Bamenda, Mezam, Northwest Region, Cameroon" })),
        treeWithBacklink(),
      );

      const r = await researchAppend({
        projectPath: dir,
        section: "assertions",
        op: "update",
        entryId: "a_011",
        fields: { place: "West Bromwich, England" },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;

      const f = await factF4();
      expect(f.place).toBe("West Bromwich, England");
      expect(f.standard_place).toBeUndefined();
      expect(r.validation.warnings.join(" ")).toMatch(/cleared \(left unset\)/);
    });

    it("(5) `place: null` clears the fact's place rather than writing a null", async () => {
      // The tree schema types these `string` with no null branch, so assigning
      // null would make the fact invalid. `Object.hasOwn`, not truthiness, is
      // what makes a null count as a correction at all.
      await writeProject(withAssertion(backlinkAssertion()), treeWithBacklink());

      const r = await researchAppend({
        projectPath: dir,
        section: "assertions",
        op: "update",
        entryId: "a_011",
        fields: { place: null },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;

      const f = await factF4();
      expect("place" in f).toBe(false);
      expect(f.standard_place).toBe("Thames Centre Township, Middlesex, Ontario, Canada");
    });

    it("(6) warns — scoped to the op — when the corrected assertion has no linked fact", async () => {
      const tree = treeWithBacklink();
      delete (tree.persons[0].facts[0] as any).assertion_id;
      await writeProject(withAssertion(backlinkAssertion()), tree);

      const r = await researchAppend({
        projectPath: dir,
        section: "assertions",
        op: "update",
        entryId: "a_011",
        fields: { standard_place: "Odessa, Francis No. 127, Saskatchewan, Canada" },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.validation.warnings.join(" ")).toMatch(/no tree fact is linked to it/);
      expect(r.filesWritten).not.toContain("tree.gedcomx.json");
    });

    it("(7) stays silent when the op touches no mirrored field", async () => {
      // Every fact in every pre-backlink project lacks assertion_id, so an
      // unscoped warning would fire on essentially every call.
      const tree = treeWithBacklink();
      delete (tree.persons[0].facts[0] as any).assertion_id;
      await writeProject(withAssertion(backlinkAssertion()), tree);

      const r = await researchAppend({
        projectPath: dir,
        section: "assertions",
        op: "update",
        entryId: "a_011",
        fields: { informant: "official" },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.validation.warnings.join(" ")).not.toMatch(/no tree fact is linked/);
      expect(r.filesWritten).not.toContain("tree.gedcomx.json");
    });

    it("(8) fires through extraction_append too, not just research_append", async () => {
      await writeProject(withAssertion(backlinkAssertion()), treeWithBacklink());

      const r = await extractionAppend({
        projectPath: dir,
        section: "assertions",
        op: "update",
        entryId: "a_011",
        fields: { standard_place: "Odessa, Francis No. 127, Saskatchewan, Canada" },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect((await factF4()).standard_place).toBe("Odessa, Francis No. 127, Saskatchewan, Canada");
    });

    it("(9) rewrites every fact carrying the id, and no fact carrying another", async () => {
      const tree = treeWithBacklink();
      tree.persons[0].facts.push(
        { id: "F5", type: "Immigration", place: "Wellburn, Thames Centre, Middlesex, Ontario, Canada", assertion_id: "a_011", sources: [{ ref: "SD-001" }] } as any,
        { id: "F6", type: "Immigration", place: "Wellburn, Thames Centre, Middlesex, Ontario, Canada", assertion_id: "a_999", sources: [{ ref: "SD-001" }] } as any,
      );
      await writeProject(withAssertion(backlinkAssertion()), tree);

      const r = await researchAppend({
        projectPath: dir,
        section: "assertions",
        op: "update",
        entryId: "a_011",
        fields: { place: "Odessa, Francis No. 127, Saskatchewan, Canada" },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;

      const facts = (await readTree()).persons[0].facts;
      const by = (id: string) => facts.find((f: any) => f.id === id);
      expect(by("F4").place).toBe("Odessa, Francis No. 127, Saskatchewan, Canada");
      expect(by("F5").place).toBe("Odessa, Francis No. 127, Saskatchewan, Canada");
      expect(by("F6").place).toBe("Wellburn, Thames Centre, Middlesex, Ontario, Canada");
    });

    it("(10) does NOT clobber an attribute a different assertion corroborated onto the fact", async () => {
      // The corroboration branch fills an attribute the fact lacks from another
      // assertion, and the fact keeps that source's ref. Overwriting it destroys
      // the other source's evidence while the fact still cites it.
      const research = withAssertion(backlinkAssertion({ date: null }));
      await writeProject(research, treeWithBacklink({ date: "3 January 1855" }));

      const r = await researchAppend({
        projectPath: dir,
        section: "assertions",
        op: "update",
        entryId: "a_011",
        fields: { date: "1856" },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;

      const f = await factF4();
      expect(f.date).toBe("3 January 1855");
      expect(r.validation.warnings.join(" ")).toMatch(/did not assert/);
    });

    it("(11) a non-string value leaves the fact alone instead of deleting its value", async () => {
      // `validator.ts` type-checks an assertion's date/place/standard_place but
      // not its `value`, so a malformed value reaches the rewrite. Read as
      // "withdrawn" it silently deleted tree data.
      await writeProject(
        withAssertion(backlinkAssertion({ fact_type: "occupation", value: "Farmer" })),
        treeWithBacklink({ type: "Occupation", value: "Farmer" }),
      );

      const r = await researchAppend({
        projectPath: dir,
        section: "assertions",
        op: "update",
        entryId: "a_011",
        fields: { value: 1924 as unknown as string },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;

      expect((await factF4()).value).toBe("Farmer");
      expect(r.validation.warnings.join(" ")).toMatch(/non-string 'value'/);
    });

    it("(12) warns when a place correction leaves an un-corrected standard_place", async () => {
      // The card's own harm one level down: the display string reads corrected
      // while the place-AUTHORITY value still names the old jurisdiction. Both
      // the assertion and the fact carry it, so the agreement guard cannot see it.
      await writeProject(withAssertion(backlinkAssertion()), treeWithBacklink());

      const r = await researchAppend({
        projectPath: dir,
        section: "assertions",
        op: "update",
        entryId: "a_011",
        fields: { place: "Odessa, Francis No. 127, Saskatchewan, Canada" },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;

      const f = await factF4();
      expect(f.place).toBe("Odessa, Francis No. 127, Saskatchewan, Canada");
      expect(f.standard_place).toBe("Thames Centre Township, Middlesex, Ontario, Canada");
      expect(r.validation.warnings.join(" ")).toMatch(/place authority value was not part of this correction/);
    });

    it("(13) warns loudly when the rewritten fact is a concluded (primary) value", async () => {
      // proof-conclusion lands the concluded value by setting `primary`, and
      // `primary` is not a detach trigger, so the backlink survives a
      // conclusion. The correction must still land — a known-wrong concluded
      // value on the upload target is worse — but never quietly.
      await writeProject(withAssertion(backlinkAssertion()), treeWithBacklink({ primary: true }));

      const r = await researchAppend({
        projectPath: dir,
        section: "assertions",
        op: "update",
        entryId: "a_011",
        fields: { standard_place: "Odessa, Francis No. 127, Saskatchewan, Canada" },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;

      expect((await factF4()).standard_place).toBe("Odessa, Francis No. 127, Saskatchewan, Canada");
      expect(r.validation.warnings.join(" ")).toMatch(/marked primary \(a concluded value\)/);
    });

    it("(14) stays silent for a fact_type that can never become a person fact", async () => {
      // 24 of the 145 corpus ops correct a name/relationship/marriage/age/sex
      // assertion. None of those materializes as a person fact, so "re-check it
      // with person_read" sends the caller after something that cannot exist.
      const tree = treeWithBacklink();
      delete (tree.persons[0].facts[0] as any).assertion_id;
      await writeProject(
        withAssertion(backlinkAssertion({ fact_type: "name", value: "Anna Weichel" })),
        tree,
      );

      const r = await researchAppend({
        projectPath: dir,
        section: "assertions",
        op: "update",
        entryId: "a_011",
        fields: { value: "Anna Wendel" },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.validation.warnings.join(" ")).not.toMatch(/no tree fact is linked to it/);
    });

    it("(15) warns when a correction DELETES a fact field, blank string included", async () => {
      // A blank string withdraws a claim exactly as null does, and is the
      // likelier typo. Either way it deleted data from the upload target, so it
      // must not be silent — the shape the malformed branch was added for.
      for (const blank of ["", "   "]) {
        await writeProject(
          withAssertion(backlinkAssertion({ fact_type: "occupation", value: "Farmer" })),
          treeWithBacklink({ type: "Occupation", value: "Farmer" }),
        );
        const r = await researchAppend({
          projectPath: dir,
          section: "assertions",
          op: "update",
          entryId: "a_011",
          fields: { value: blank },
        });
        expect(r.ok, blank).toBe(true);
        if (!r.ok) return;
        expect((await factF4()).value, blank).toBeUndefined();
        expect(r.validation.warnings.join(" "), blank).toMatch(/lost its 'value'/);
      }
    });

    it("(16) two ops on one assertion and one field do not accuse the call of corroboration", async () => {
      // The provenance test reads the fact's PRE-CALL value. Reading the live
      // one made the second op mistake the first op's own write for another
      // source's evidence.
      await writeProject(withAssertion(backlinkAssertion()), treeWithBacklink());

      const r = await researchAppend({
        projectPath: dir,
        ops: [
          { section: "assertions", op: "update", entryId: "a_011", fields: { place: "Odessa, Francis No. 127, Saskatchewan, Canada" } },
          { section: "assertions", op: "update", entryId: "a_011", fields: { place: "Regina, Saskatchewan, Canada" } },
        ],
      } as never);
      expect(r.ok).toBe(true);
      if (!r.ok) return;

      expect((await factF4()).place).toBe("Regina, Saskatchewan, Canada");
      expect(r.validation.warnings.join(" ")).not.toMatch(/did not assert/);
    });

    it("(17) does not claim a place was corrected when the rewrite did not apply", async () => {
      // Two shapes: an echo that changes nothing, and a place the provenance
      // guard refuses. Both previously emitted "its place was corrected",
      // the second one directly contradicting the refusal beside it.
      await writeProject(withAssertion(backlinkAssertion()), treeWithBacklink());
      const echo = await researchAppend({
        projectPath: dir, section: "assertions", op: "update", entryId: "a_011",
        fields: { place: "Wellburn, Thames Centre, Middlesex, Ontario, Canada" },
      });
      expect(echo.ok).toBe(true);
      if (!echo.ok) return;
      expect(echo.validation.warnings.join(" ")).not.toMatch(/place authority value/);

      await writeProject(
        withAssertion(backlinkAssertion()),
        treeWithBacklink({ place: "Somewhere another source supplied" }),
      );
      const refused = await researchAppend({
        projectPath: dir, section: "assertions", op: "update", entryId: "a_011",
        fields: { place: "Odessa, Francis No. 127, Saskatchewan, Canada" },
      });
      expect(refused.ok).toBe(true);
      if (!refused.ok) return;
      const w = refused.validation.warnings.join(" ");
      expect(w).toMatch(/did not assert/);
      expect(w).not.toMatch(/place authority value/);
    });

    it("(18) leaves the fact alone when the assertion has been RE-CLASSIFIED", async () => {
      // The mirror of tree_edit's retype detach: `assertionFactAttr` keys the
      // event / value-bearing rule on the FACT's type, so rewriting across that
      // seam wrote a birth year into an Occupation fact's `value`.
      await writeProject(
        withAssertion(backlinkAssertion({ fact_type: "occupation", value: "Farmer" })),
        treeWithBacklink({ type: "Occupation", value: "Farmer" }),
      );

      const r = await researchAppend({
        projectPath: dir,
        section: "assertions",
        op: "update",
        entryId: "a_011",
        fields: { fact_type: "birth", value: "1850" },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;

      const f = await factF4();
      expect(f.type).toBe("Occupation");
      expect(f.value).toBe("Farmer");
      expect(r.validation.warnings.join(" ")).toMatch(/is a Birth, so the fact was left alone/);
    });

    it("(19) a fold the TOOL made is not a re-classification, so the correction still lands", async () => {
      // `canonicalizeAssertionLabels` folds `fact_type` through FACT_TYPE_ALIASES
      // on every assertion update whether or not the op names it, so a stored
      // `birthplace` becomes `birth` mid-call. Keyed on the folded value, the
      // retype guard refused the tool's own change: the correction never reached
      // the fact, which is this card's bug, and the message blamed the
      // researcher. 80 person-fact-eligible corpus assertions would fold.
      await writeProject(
        withAssertion(backlinkAssertion({ fact_type: "birthplace", value: "Ireland" })),
        treeWithBacklink({ type: "Birthplace" }),
      );

      const r = await researchAppend({
        projectPath: dir,
        section: "assertions",
        op: "update",
        entryId: "a_011",
        fields: { standard_place: "Odessa, Francis No. 127, Saskatchewan, Canada" },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;

      // The tool folded the assertion to `birth`...
      expect((await readResearch()).assertions[0].fact_type).toBe("birth");
      // ...and the correction still reached the fact.
      expect((await factF4()).standard_place).toBe("Odessa, Francis No. 127, Saskatchewan, Canada");
      expect(r.validation.warnings.join(" ")).not.toMatch(/so the fact was left alone/);
    });
  });

  it("a pre-existing unrelated drift does not block a write; it rides as a warning (#1572)", async () => {
    // `project` carries a legacy additionalProperties key this call never touches
    // (the call updates an assertion). Before #1572 the whole-document validation
    // froze the write; now it succeeds and the drift is surfaced as a warning.
    const research = baseResearch();
    (research.project as any).legacy_field = "legacy drift";
    await writeProject(research);

    const r = await researchAppend({
      projectPath: dir,
      section: "assertions",
      op: "update",
      entryId: "a_001",
      fields: { date: "1850" },
    });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Surfaced as a single summary line (a count + a pointer), not one warning
    // per drifted field — see the #1476-wall note in validateIntroduced.
    expect(r.validation.warnings.join(" ")).toMatch(/1 pre-existing schema error/);
    expect(r.validation.warnings.join(" ")).toMatch(/validate_research_schema/);
    // the update landed
    expect((await readResearch()).assertions.find((a: any) => a.id === "a_001").date).toBe("1850");
  });

  // Same class as record_search's recordType: `SECTIONS[section]` and
  // `EXAMPLES[section]` walk the prototype chain, so "constructor" indexed out
  // `Object` — truthy, so `!config` failed to reject — and the rejection path
  // then threw `TypeError: entry.split is not a function` out of the tool.
  it("rejects an inherited Object.prototype key as section, with the actionable error", async () => {
    await writeProject();
    for (const key of Object.getOwnPropertyNames(Object.prototype)) {
      const r = await researchAppend({
        projectPath: dir,
        section: key as never,
        op: "append",
        entry: { value: "x" },
      });
      expect(r.ok, `section '${key}' was not rejected`).toBe(false);
      if (r.ok) return;
      expect(r.errors.join(" ")).toMatch(/is not supported by research_append/);
    }
  });

  it("rejects an append entry that carries a real id (the tool assigns ids)", async () => {
    await writeProject();
    const r = await researchAppend({
      projectPath: dir,
      section: "sources",
      op: "append",
      entry: validSource("src_999"),
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/must not carry an id/);
  });

  it("appends a source (no id) → src_002 and validates", async () => {
    await writeProject();
    const { id: _omit, ...sourceNoId } = validSource("x");
    const r = await researchAppend({ projectPath: dir, section: "sources", op: "append", entry: sourceNoId });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(singleOk(r).entryId).toBe("src_002");
    expect(r.filesWritten).toEqual(["research.json"]);
    const research = await readResearch();
    expect(research.sources.map((s: any) => s.id)).toEqual(["src_001", "src_002"]);
  });

  it("normalizes a human-format source access_date to ISO", async () => {
    // Models routinely supply access_date as "12 July 2026" (or "July 12, 2026"),
    // which the schema (ISO YYYY-MM-DD) rejects — a hard fail persisted verbatim.
    // The tool should rewrite a parseable human date to ISO. An already-ISO value
    // is untouched; an unparseable value is left for the validator to reject.
    await writeProject();
    for (const [supplied, expected] of [
      ["12 July 2026", "2026-07-12"],
      ["July 12, 2026", "2026-07-12"],
      ["2026-07-12", "2026-07-12"],
    ] as const) {
      const { id: _omit, ...src } = { ...validSource("x"), access_date: supplied };
      const r = await researchAppend({ projectPath: dir, section: "sources", op: "append", entry: src });
      expect(r.ok, `${supplied} should append`).toBe(true);
      if (!r.ok) continue;
      const research = await readResearch();
      const persisted = research.sources.find((s: any) => s.id === singleOk(r).entryId);
      expect(persisted.access_date, `${supplied} → ISO`).toBe(expected);
    }
  });

  describe("transcription_truncated is derived at the write boundary (#2457)", () => {
    afterEach(() => __clearTruncatedSourceImagesForTests());
    const imageSource = (over: Record<string, unknown>) => {
      const { id: _omit, ...src } = validSource("x");
      return { ...src, image_filename: "images/x.jpg", transcription: "first half of the page", ...over };
    };

    it("marks a source truncated when image_transcribe capped the cited image", async () => {
      await writeProject();
      recordImageReadCap(dir, "images/x.jpg", true);
      const r = await researchAppend({
        projectPath: dir,
        section: "sources",
        op: "append",
        entry: imageSource({}),
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const persisted = (await readResearch()).sources.find((s: any) => s.id === singleOk(r).entryId);
      expect(persisted.transcription_truncated).toBe(true);
    });

    it("leaves the field absent when no read of the cited image reached the write boundary (not established)", async () => {
      await writeProject();
      // No recordImageReadCap → the image is not in the add-only cap set, so its
      // state is "not established" and the marker is left absent.
      const r = await researchAppend({
        projectPath: dir,
        section: "sources",
        op: "append",
        entry: imageSource({}),
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const persisted = (await readResearch()).sources.find((s: any) => s.id === singleOk(r).entryId);
      expect("transcription_truncated" in persisted).toBe(false);
    });

    it("is authoritative — strips an agent-asserted flag the tool did not record", async () => {
      await writeProject();
      // The image read was NOT capped, but the caller asserts it was. The field
      // is derived from the tool's record, so the false assertion is dropped
      // rather than persisted (the failure mode #2457 removes the agent from).
      const r = await researchAppend({
        projectPath: dir,
        section: "sources",
        op: "append",
        entry: imageSource({ transcription_truncated: true }),
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const persisted = (await readResearch()).sources.find((s: any) => s.id === singleOk(r).entryId);
      expect("transcription_truncated" in persisted).toBe(false);
    });

    it("strips an agent-asserted flag even on a source with no image_filename to join", async () => {
      await writeProject();
      // No image_filename → nothing to join, but the field is still derived-only.
      // Without stripping here the agent's guess persists verbatim, exactly where
      // the join key that would override it is absent (#2457 review, blocker 4c).
      const { id: _omit, ...src } = validSource("x");
      const r = await researchAppend({
        projectPath: dir,
        section: "sources",
        op: "append",
        entry: { ...src, transcription: "first half of the page", transcription_truncated: true },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const persisted = (await readResearch()).sources.find((s: any) => s.id === singleOk(r).entryId);
      expect("transcription_truncated" in persisted).toBe(false);
    });

    it("does not derive (and so does not self-reject) a capped image whose op carries no transcription text (#2457 review, blocker 1)", async () => {
      await writeProject();
      recordImageReadCap(dir, "images/x.jpg", true);
      const entry = imageSource({});
      delete (entry as Record<string, unknown>).transcription;
      const r = await researchAppend({ projectPath: dir, section: "sources", op: "append", entry });
      expect(r.ok).toBe(true); // pre-fix: false — true beside no transcription is rejected
      if (!r.ok) return;
      const persisted = (await readResearch()).sources.find((s: any) => s.id === singleOk(r).entryId);
      expect("transcription_truncated" in persisted).toBe(false);
    });

    it("marks the source on a two-op sequence — append {image_filename}, then a later update {transcription} that omits it (#2457 r10 [0])", async () => {
      await writeProject();
      recordImageReadCap(dir, "images/x.jpg", true);
      // Op 1: the source arrives with its image_filename but no transcription yet.
      const entry = imageSource({});
      delete (entry as Record<string, unknown>).transcription;
      const app = await researchAppend({ projectPath: dir, section: "sources", op: "append", entry });
      expect(app.ok).toBe(true);
      if (!app.ok) return;
      const id = singleOk(app).entryId;
      expect("transcription_truncated" in (await readResearch()).sources.find((s: any) => s.id === id)).toBe(false);
      // Op 2 (a later call): the transcription arrives, WITHOUT re-sending image_filename —
      // the shape research/SKILL.md encourages. The derivation must fall back to the
      // persisted source's image_filename and mark it. Pre-fix: no marker, silently.
      const upd = await researchAppend({
        projectPath: dir,
        section: "sources",
        op: "update",
        entryId: id,
        fields: { transcription: "Row 1: Anna … rtway down the pag" },
      } as any);
      expect(upd.ok).toBe(true);
      const after = (await readResearch()).sources.find((s: any) => s.id === id);
      expect(after.transcription).toBe("Row 1: Anna … rtway down the pag");
      expect(after.transcription_truncated).toBe(true); // pre-fix: marker missing
    });

    it("permits an in-place transcription refinement of a persisted-true source; the marker survives and over-reports by design (#2457 rulings, C 2026-09-21)", async () => {
      await writeProject();
      recordImageReadCap(dir, "images/x.jpg", true);
      const app = await researchAppend({ projectPath: dir, section: "sources", op: "append", entry: imageSource({}) });
      expect(app.ok).toBe(true);
      if (!app.ok) return;
      const id = singleOk(app).entryId;
      expect((await readResearch()).sources.find((s: any) => s.id === id).transcription_truncated).toBe(true);
      // Ruling C removed the update guard: an in-place refinement (e.g. replacing the
      // partial text with the fuller indexed-record reading) SUCCEEDS. The derivation
      // only ever deletes the marker from the patch, so the merge keeps the persisted
      // `true` — the badge over-reports the now-fuller text, which the ruling accepts
      // as an unneeded badge (never a false "verified whole"). Nothing moves partial→whole.
      const upd = await researchAppend({
        projectPath: dir,
        section: "sources",
        op: "update",
        entryId: id,
        fields: { transcription: "the complete page text now" },
      } as any);
      expect(upd.ok).toBe(true);
      const after = (await readResearch()).sources.find((s: any) => s.id === id);
      expect(after.transcription).toBe("the complete page text now"); // refinement took
      expect(after.transcription_truncated).toBe(true); // marker survives (over-reports by design), never false
    });

    it("B1 regression: a narrower uncapped re-read does not flip a capped image to whole — append persists true (#2457 B1 ruling 2026-09-19)", async () => {
      await writeProject();
      // Praise's reproduction, at the derivation+store level: read 1 caps, read 2
      // (narrower lookingFor) comes back uncapped, then a source carrying read 1's
      // partial text is appended. Pre-ruling this persisted `false` ("verified
      // whole") on partial text; sticky-true + true-or-delete must persist `true`.
      recordImageReadCap(dir, "images/x.jpg", true);  // read 1: capped
      recordImageReadCap(dir, "images/x.jpg", false); // read 2: narrower, uncapped
      const r = await researchAppend({
        projectPath: dir,
        section: "sources",
        op: "append",
        entry: imageSource({ transcription: "Row 1: Anna … rtway down the pag" }),
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const persisted = (await readResearch()).sources.find((s: any) => s.id === singleOk(r).entryId);
      expect(persisted.transcription_truncated).toBe(true); // pre-fix: false — a false "verified whole" on partial text
    });

    it("an image not in the cap set: append leaves the marker absent, and a later in-place transcription update is permitted (#2457 rulings, C 2026-09-21)", async () => {
      await writeProject();
      // The image was never recorded as capped (a whole read records nothing —
      // add-only). The marker stays absent on append, and a later in-place
      // transcription update goes through (nothing is written to block it).
      const app = await researchAppend({ projectPath: dir, section: "sources", op: "append", entry: imageSource({}) });
      expect(app.ok).toBe(true);
      if (!app.ok) return;
      const id = singleOk(app).entryId;
      expect("transcription_truncated" in (await readResearch()).sources.find((s: any) => s.id === id)).toBe(false);
      const upd = await researchAppend({
        projectPath: dir,
        section: "sources",
        op: "update",
        entryId: id,
        fields: { image_filename: "images/x.jpg", transcription: "a corrected fuller reading" },
      } as any);
      expect(upd.ok).toBe(true);
      const after = (await readResearch()).sources.find((s: any) => s.id === id);
      expect("transcription_truncated" in after).toBe(false); // still absent, update permitted
    });

    it("does not discard a good op when a sibling capped op carries no transcription (#2457 review, blocker 1)", async () => {
      await writeProject();
      recordImageReadCap(dir, "images/x.jpg", true);
      const before = (await readResearch()).sources.length;
      const good = imageSource({ image_filename: "images/other.jpg", transcription: "the complete page text" });
      const bad = imageSource({});
      delete (bad as Record<string, unknown>).transcription;
      const r = await researchAppend({
        projectPath: dir,
        ops: [
          { section: "sources", op: "append", entry: good },
          { section: "sources", op: "append", entry: bad },
        ],
      } as any);
      expect(r.ok).toBe(true); // pre-fix: false — the whole batch is discarded, losing `good` too
      const after = (await readResearch()).sources.length;
      expect(after - before).toBe(2);
    });

    it("marks the source on the MIRROR two-op sequence — append {transcription}, then a later update {image_filename} that omits it (#2457 r11 [0])", async () => {
      await writeProject();
      recordImageReadCap(dir, "images/x.jpg", true);
      // r10 gave `image_filename` a persisted fallback and `transcription` none, so
      // this order derived nothing while its mirror derived `true`, on the SAME final
      // document. Both fields now fall back, so op order cannot decide the marker.
      const noRef = imageSource({});
      delete (noRef as Record<string, unknown>).image_filename;
      const app = await researchAppend({ projectPath: dir, section: "sources", op: "append", entry: noRef });
      expect(app.ok).toBe(true);
      if (!app.ok) return;
      const id = singleOk(app).entryId;
      const upd = await researchAppend({
        projectPath: dir,
        section: "sources",
        op: "update",
        entryId: id,
        fields: { image_filename: "images/x.jpg" },
      } as any);
      expect(upd.ok).toBe(true);
      const after = (await readResearch()).sources.find((s: any) => s.id === id);
      expect(after.transcription).toBe("first half of the page");
      expect(after.transcription_truncated).toBe(true); // pre-fix: absent — a partial read reading as whole
    });

    it("an update that REMOVES the image does not stamp the badge — an explicit null is not an omission (#2457 r11 [0b])", async () => {
      await writeProject();
      // Cap recorded AFTER the append, so the source carries NO persisted marker and
      // the only thing that could stamp it is this update's own derivation.
      const app = await researchAppend({ projectPath: dir, section: "sources", op: "append", entry: imageSource({}) });
      expect(app.ok).toBe(true);
      if (!app.ok) return;
      const id = singleOk(app).entryId;
      expect("transcription_truncated" in (await readResearch()).sources.find((s: any) => s.id === id)).toBe(false);
      recordImageReadCap(dir, "images/x.jpg", true);
      // The r10 fallback keyed on truthiness, so an explicit `null` — the caller
      // REMOVING the reference — looked identical to not re-sending it, and the badge
      // was derived from the very scan this op deletes. Keyed on presence now.
      const upd = await researchAppend({
        projectPath: dir,
        section: "sources",
        op: "update",
        entryId: id,
        fields: { image_filename: null, transcription: "text with no scan behind it" },
      } as any);
      expect(upd.ok).toBe(true);
      const after = (await readResearch()).sources.find((s: any) => s.id === id);
      expect(after.image_filename).toBeNull();
      expect("transcription_truncated" in after).toBe(false); // pre-fix: true — badged a source citing no scan
    });

    it("does not stamp a source a later op in the same batch empties, and so does not refuse its own write (#2457 r11 [0c])", async () => {
      await writeProject();
      // Cap recorded AFTER the append: the document holds NO marker, so any `true` the
      // batch trips over is one this loop put there. (Nulling the text of a source that
      // genuinely carries a persisted `true` is a DIFFERENT case and is correctly
      // refused — ruling C keeps that loud failure.)
      const app = await researchAppend({ projectPath: dir, section: "sources", op: "append", entry: imageSource({}) });
      expect(app.ok).toBe(true);
      if (!app.ok) return;
      const id = singleOk(app).entryId;
      expect("transcription_truncated" in (await readResearch()).sources.find((s: any) => s.id === id)).toBe(false);
      recordImageReadCap(dir, "images/x.jpg", true);
      // Per-op derivation stamped `true` from op[0] and then the validator refused the
      // batch — "do not null the partial transcription of a truncated source" — for a
      // value only the tool had set. The fold reads what the batch actually leaves.
      const r = await researchAppend({
        projectPath: dir,
        ops: [
          { section: "sources", op: "update", entryId: id, fields: { transcription: "partial" } },
          { section: "sources", op: "update", entryId: id, fields: { transcription: null } },
        ],
      } as any);
      expect(r.ok).toBe(true); // pre-fix: false — the tool rejected a write only it had made
      const after = (await readResearch()).sources.find((s: any) => s.id === id);
      expect(after.transcription).toBeNull();
      expect("transcription_truncated" in after).toBe(false);
    });

    it("is authoritative on an UPDATE too — strips an agent-asserted flag on a never-capped source (#2457 r11 mutation 1)", async () => {
      await writeProject();
      // Both pre-existing authority tests use `append`, so restricting the strip to
      // appends survived the whole suite while an asserted flag rode an update
      // through onto a source whose image was never capped. That defeats "derived
      // here, never asserted by the agent" on the very path this PR is about.
      const app = await researchAppend({ projectPath: dir, section: "sources", op: "append", entry: imageSource({}) });
      expect(app.ok).toBe(true);
      if (!app.ok) return;
      const id = singleOk(app).entryId;
      const upd = await researchAppend({
        projectPath: dir,
        section: "sources",
        op: "update",
        entryId: id,
        fields: { transcription: "still partial", transcription_truncated: true },
      } as any);
      expect(upd.ok).toBe(true);
      const after = (await readResearch()).sources.find((s: any) => s.id === id);
      expect("transcription_truncated" in after).toBe(false); // the image was never capped
    });

    it("an EMPTY-STRING image_filename is a removal too, not an omission (#2457 r11 mutation 2)", async () => {
      await writeProject();
      // The spec sentence this PR added says "an explicit `image_filename: null` or
      // `\"\"`". Testing only `null` left the other spelling of the same removal
      // uncovered, and `""` is schema-legal for this field.
      const app = await researchAppend({ projectPath: dir, section: "sources", op: "append", entry: imageSource({}) });
      expect(app.ok).toBe(true);
      if (!app.ok) return;
      const id = singleOk(app).entryId;
      recordImageReadCap(dir, "images/x.jpg", true);
      const upd = await researchAppend({
        projectPath: dir,
        section: "sources",
        op: "update",
        entryId: id,
        fields: { image_filename: "", transcription: "text with no scan behind it" },
      } as any);
      expect(upd.ok).toBe(true);
      const after = (await readResearch()).sources.find((s: any) => s.id === id);
      expect("transcription_truncated" in after).toBe(false);
    });

    it("an EMPTY-STRING transcription empties the source too — the batch is not refused (#2457 r11 mutation 3)", async () => {
      await writeProject();
      const app = await researchAppend({ projectPath: dir, section: "sources", op: "append", entry: imageSource({}) });
      expect(app.ok).toBe(true);
      if (!app.ok) return;
      const id = singleOk(app).entryId;
      recordImageReadCap(dir, "images/x.jpg", true);
      const r = await researchAppend({
        projectPath: dir,
        ops: [
          { section: "sources", op: "update", entryId: id, fields: { transcription: "partial" } },
          { section: "sources", op: "update", entryId: id, fields: { transcription: "" } },
        ],
      } as any);
      expect(r.ok).toBe(true); // folding the persisted text back in would stamp, then self-reject
      const after = (await readResearch()).sources.find((s: any) => s.id === id);
      expect("transcription_truncated" in after).toBe(false);
    });

    it("whitespace-only transcription is no text — the .trim() is load-bearing (#2457 r11 mutation 4)", async () => {
      await writeProject();
      recordImageReadCap(dir, "images/x.jpg", true);
      // validate_research_schema rejects `true` beside a .trim()-empty transcription,
      // so dropping the .trim() here makes the tool stamp a state its own validator
      // refuses. Nothing supplied whitespace-only text before.
      const r = await researchAppend({
        projectPath: dir,
        section: "sources",
        op: "append",
        entry: imageSource({ transcription: "   \n\t " }),
      });
      expect(r.ok).toBe(true); // pre-fix mutant: false — the tool self-rejects
      if (!r.ok) return;
      const persisted = (await readResearch()).sources.find((s: any) => s.id === singleOk(r).entryId);
      expect("transcription_truncated" in persisted).toBe(false);
    });

    it("the fold ACCUMULATES across a source's ops — a later unrelated op does not reset it (#2457 r11 mutation 5)", async () => {
      await writeProject();
      // The only other two-op test asserts the ABSENCE of a stamp, so a fold that
      // re-seeds from the persisted entry on every op — gutting the accumulation this
      // change exists for — passed the whole suite. Here the badge MUST land: the text
      // arrives in op[0] and the last op touching the source carries neither field.
      const noText = imageSource({});
      delete (noText as Record<string, unknown>).transcription;
      const app = await researchAppend({ projectPath: dir, section: "sources", op: "append", entry: noText });
      expect(app.ok).toBe(true);
      if (!app.ok) return;
      const id = singleOk(app).entryId;
      recordImageReadCap(dir, "images/x.jpg", true);
      const r = await researchAppend({
        projectPath: dir,
        ops: [
          { section: "sources", op: "update", entryId: id, fields: { transcription: "partial" } },
          { section: "sources", op: "update", entryId: id, fields: { notes: ["unrelated bookkeeping"] } },
        ],
      } as any);
      expect(r.ok).toBe(true);
      const after = (await readResearch()).sources.find((s: any) => s.id === id);
      expect(after.transcription_truncated).toBe(true); // mutant re-seeding per op: absent
    });
  });

  it("appends an assertion referencing an existing source", async () => {
    await writeProject();
    const { id: _omit, ...assertionNoId } = validAssertion("x", "src_001");
    const r = await researchAppend({ projectPath: dir, section: "assertions", op: "append", entry: assertionNoId });
    expect(r.ok && singleOk(r).entryId).toBe("a_002");
  });

  it("normalizes a GedcomX date object ({original}) on an appended assertion to a plain string", async () => {
    await writeProject();
    const { id: _omit, ...assertionNoId } = validAssertion("x", "src_001");
    // The model routinely emits `date` as a GedcomX object instead of the
    // schema's plain string (observed in the record-extraction eval,
    // ut_record_extraction_003). Without normalization this fails
    // validate_research_schema (`date` is not of type string/null).
    const r = await researchAppend({
      projectPath: dir,
      section: "assertions",
      op: "append",
      entry: { ...assertionNoId, date: { original: "~1818", formal: "+1818" } as any },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const appended = (await readResearch()).assertions.find((a: any) => a.id === singleOk(r).entryId);
    expect(appended.date).toBe("~1818");
  });

  it("normalizes a date object on an assertion update too", async () => {
    await writeProject();
    const r = await researchAppend({
      projectPath: dir,
      section: "assertions",
      op: "update",
      entryId: "a_001",
      fields: { date: { formal: "+1850" } as any },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const updated = (await readResearch()).assertions.find((a: any) => a.id === "a_001");
    expect(updated.date).toBe("+1850");
  });

  it("canonicalizes assertion fact_type casing + semantic aliases at the tool boundary", async () => {
    // fact_type is an OPEN enum, so the model emits casing variants (`Name`,
    // `CauseOfDeath`) and role-prefixed aliases (`father_name`) that make one
    // logical fact read as several distinct labels downstream. The tool maps a
    // recognized alias to its canonical spelling; an unrecognized value passes
    // through unchanged (best-effort translator, not a closed allow-list).
    await writeProject();
    for (const [supplied, expected] of [
      ["Name", "name"],
      ["father_name", "name"],
      ["mother_name", "name"],
      ["CauseOfDeath", "cause_of_death"],
      ["Cause of Death", "cause_of_death"],
      ["Parentage", "relationship"],
      ["Gender", "gender"],
      // Event place/date are attributes of the event fact, so place variants
      // fold into the event type (birthplace → birth, deathplace → death); the
      // date-claim `Birth` also folds to `birth`. Field population (place vs
      // date), not the type name, distinguishes the two.
      ["Birth", "birth"],
      ["deathplace", "death"],
      // Unrecognized fact type → left untouched (open enum).
      ["immigration_year", "immigration_year"],
    ] as const) {
      const { id: _omit, ...a } = { ...validAssertion("x", "src_001"), fact_type: supplied };
      const r = await researchAppend({ projectPath: dir, section: "assertions", op: "append", entry: a });
      expect(r.ok, `${supplied} should append`).toBe(true);
      if (!r.ok) continue;
      const persisted = (await readResearch()).assertions.find((x: any) => x.id === singleOk(r).entryId);
      expect(persisted.fact_type, `${supplied} → ${expected}`).toBe(expected);
    }
  });

  it("folds a birthplace fact_type into `birth` and lifts the place value into the `place` field", async () => {
    // birthplace is a `birth` assertion with the place attribute set — so the
    // fact_type folds to `birth` and, when the model left `place` empty, the
    // place value is lifted from `value` so the folded assertion stays a
    // machine-readable place-claim (place != null) distinct from a date-claim.
    await writeProject();
    // Case 1: model put the place only in `value` → tool lifts it into `place`.
    {
      const { id: _omit, ...a } = {
        ...validAssertion("x", "src_001"),
        fact_type: "BirthPlace",
        value: "Ireland",
        place: null as any,
        standard_place: null as any,
        date: null as any,
      };
      const r = await researchAppend({ projectPath: dir, section: "assertions", op: "append", entry: a });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const p = (await readResearch()).assertions.find((x: any) => x.id === singleOk(r).entryId);
      expect(p.fact_type).toBe("birth");
      expect(p.place).toBe("Ireland");
    }
    // Case 2: model already populated `place` → left as-is, no clobber.
    {
      const { id: _omit, ...a } = {
        ...validAssertion("x", "src_001"),
        fact_type: "birthplace",
        value: "born in Ireland",
        place: "Ireland",
        date: null as any,
      };
      const r = await researchAppend({ projectPath: dir, section: "assertions", op: "append", entry: a });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const p = (await readResearch()).assertions.find((x: any) => x.id === singleOk(r).entryId);
      expect(p.fact_type).toBe("birth");
      expect(p.place).toBe("Ireland");
    }
  });

  it("canonicalizes assertion fact_type on an update too", async () => {
    await writeProject();
    const r = await researchAppend({
      projectPath: dir,
      section: "assertions",
      op: "update",
      entryId: "a_001",
      fields: { fact_type: "father_name" as any },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const updated = (await readResearch()).assertions.find((a: any) => a.id === "a_001");
    expect(updated.fact_type).toBe("name");
  });

  it("appends a person_evidence link, stamps created, references an existing assertion + tree person", async () => {
    await writeProject();
    const r = await researchAppend({
      projectPath: dir,
      section: "person_evidence",
      op: "append",
      entry: { assertion_id: "a_001", person_id: "I1", confidence: "confident", rationale: "Name + birth year match", superseded_by: null },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(singleOk(r).entryId).toBe("pe_001");
    const pe = (await readResearch()).person_evidence[0];
    expect(pe.person_id).toBe("I1");
    expect(typeof pe.created).toBe("string"); // tool-stamped
    expect(pe.created.length).toBeGreaterThanOrEqual(10);
  });

  it("appends a locality → loc_001, initializes the optional section, stamps created", async () => {
    await writeProject();
    const r = await researchAppend({
      projectPath: dir,
      section: "localities",
      op: "append",
      entry: {
        place: "Norway",
        for_place: "Ringebu, Oppland, Norway",
        jurisdictions: [{ name: "Ringebu, Oppland, Norway", date_range: "1838-" }],
        collections: [{ id: "4237104", title: "Norway, Church Books", date_range: "1797-1958" }],
        quirks: ["Indexed only at county level."],
        pages_read: [{ section: "home", url: "u1", found: true }],
        source: "locality-guide",
      },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(singleOk(r).entryId).toBe("loc_001");
    const loc = (await readResearch()).localities[0];
    expect(loc.place).toBe("Norway");
    expect(loc.source).toBe("locality-guide");
    expect(typeof loc.created).toBe("string"); // tool-stamped
    expect(loc.created.length).toBeGreaterThanOrEqual(10);
  });

  it("assigns max + 1, not count + 1", async () => {
    const research = baseResearch();
    research.sources = [validSource("src_001"), validSource("src_003")];
    await writeProject(research);
    const { id: _omit, ...sourceNoId } = validSource("x");
    const r = await researchAppend({ projectPath: dir, section: "sources", op: "append", entry: sourceNoId });
    expect(r.ok && singleOk(r).entryId).toBe("src_004");
  });

  it("updates a field on an existing entry, preserving the id", async () => {
    await writeProject();
    const r = await researchAppend({
      projectPath: dir,
      section: "assertions",
      op: "update",
      entryId: "a_001",
      fields: { value: "1851" },
    });
    expect(r.ok).toBe(true);
    const a = (await readResearch()).assertions[0];
    expect(a.id).toBe("a_001");
    expect(a.value).toBe("1851");
  });

  it("supports the person_evidence supersede pattern (append new + update old's superseded_by)", async () => {
    const research = baseResearch();
    research.person_evidence = [
      { id: "pe_001", assertion_id: "a_001", person_id: "I1", confidence: "probable", rationale: "first guess", created: "2026-01-01", superseded_by: null },
    ];
    await writeProject(research);

    const appended = await researchAppend({
      projectPath: dir,
      section: "person_evidence",
      op: "append",
      entry: { assertion_id: "a_001", person_id: "I1", confidence: "confident", rationale: "stronger match", superseded_by: null },
    });
    expect(appended.ok && singleOk(appended).entryId).toBe("pe_002");

    const superseded = await researchAppend({
      projectPath: dir,
      section: "person_evidence",
      op: "update",
      entryId: "pe_001",
      fields: { superseded_by: "pe_002" },
    });
    expect(superseded.ok).toBe(true);
    const pe = await readResearch();
    expect(pe.person_evidence).toHaveLength(2); // old entry not deleted
    expect(pe.person_evidence.find((e: any) => e.id === "pe_001").superseded_by).toBe("pe_002");
  });

  it("rejects update of a non-existent id and writes nothing", async () => {
    await writeProject();
    const before = await readFile(join(dir, "research.json"), "utf-8");
    const r = await researchAppend({ projectPath: dir, section: "assertions", op: "update", entryId: "a_999", fields: { value: "x" } });
    expect(r.ok).toBe(false);
    expect(await readFile(join(dir, "research.json"), "utf-8")).toBe(before);
  });

  it("writes nothing when the appended entry would invalidate the project", async () => {
    await writeProject();
    const before = await readFile(join(dir, "research.json"), "utf-8");
    const { id: _omit, ...assertionNoId } = validAssertion("x", "src_999"); // dangling source_id
    const r = await researchAppend({ projectPath: dir, section: "assertions", op: "append", entry: assertionNoId });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/src_999|source/);
    expect(await readFile(join(dir, "research.json"), "utf-8")).toBe(before);
  });

  it("rejects an unknown section name", async () => {
    await writeProject();
    const r = await researchAppend({ projectPath: dir, section: "bogus_section", op: "append", entry: {} });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/not supported/);
  });

  it("refuses to write a source whose citation_detail carries an unknown key, and writes nothing", async () => {
    // The persisted-location incident: a run appended a source with
    // citation_detail.location and the hand-maintained validator let it
    // through — only the harness's JSON-Schema gate (additionalProperties:
    // false on citation_detail) caught it. The closed-shape check must stop
    // it at the tool boundary.
    await writeProject();
    const before = await readFile(join(dir, "research.json"), "utf-8");
    const { id: _omit, ...sourceNoId } = validSource("x");
    const r = await researchAppend({
      projectPath: dir,
      section: "sources",
      op: "append",
      entry: {
        ...sourceNoId,
        citation_detail: { ...citationDetail, location: "district 40, p. 3" },
      },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/unexpected property 'location'/);
    expect(await readFile(join(dir, "research.json"), "utf-8")).toBe(before);
  });
});

// ─── Phase 2 ───────────────────────────────────────────────────────────────

const validQuestion = (id: string) => ({
  id,
  question: "Who were the parents of John Smith?",
  rationale: "Timeline gap before 1850",
  selection_basis: "objective_decomposition",
  priority: "high",
  status: "open",
  depends_on: [],
  unblocks: [],
  created: "2026-01-01",
  resolved: null,
  resolution_assertion_ids: [],
  exhaustive_declaration: { declared: false, log_entry_ids: [] },
});
/** `items` defaults to EMPTY, which is only legal while something else in the
 *  same call fills it (a `plan_items` op) — the validator refuses a plan that
 *  ends a call with no items. Pass `[seededPlanItem(...)]` for a plan that has
 *  to stand on its own. */
const validPlan = (id: string, questionId: string, status = "active", items: any[] = []) => ({
  id,
  question_id: questionId,
  status,
  created: "2026-01-01",
  items,
});
const validPlanItem = () => ({
  sequence: 1,
  record_type: "census",
  jurisdiction: "Schuylkill, Pennsylvania, United States",
  date_range: "1850-1860",
  repository: "NARA",
  rationale: "Census should list the household",
  fallback_for: null,
  status: "planned",
});
/** A plan item as it appears INSIDE a plan (carrying its own id), as opposed to
 *  `validPlanItem()`, which is an append payload the tool assigns an id to. */
const seededPlanItem = (id = "pli_001") => ({ id, ...validPlanItem() });
const validConflict = () => ({
  conflict_type: "fact",
  description: "Two different birth years",
  competing_assertion_ids: ["a_001", "a_002"],
  status: "unresolved",
  blocks_question_ids: [],
  disputed_attribute: "birth_year",
});
const validHypothesis = () => ({
  claim: "John is the son of Robert",
  status: "active",
  supporting_assertion_ids: [],
  contradicting_assertion_ids: [],
  ruled_out: false,
  related_question_ids: [],
});

describe("research_append (Phase 2)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "research-append-p2-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function phase2Research() {
    const r = baseResearch();
    r.assertions.push(validAssertion("a_002")); // a second assertion for fact-conflict competing
    r.questions = [validQuestion("q_001")];
    return r;
  }
  async function writeProject(research: any = phase2Research(), tree: any = baseTree) {
    await writeFile(join(dir, "research.json"), JSON.stringify(research, null, 2));
    await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify(tree, null, 2));
  }
  const readResearch = async () => JSON.parse(await readFile(join(dir, "research.json"), "utf-8"));

  it("appends a question and stamps created", async () => {
    await writeProject();
    const { id: _o, created: _c, ...q } = validQuestion("x");
    const r = await researchAppend({ projectPath: dir, section: "questions", op: "append", entry: q });
    expect(r.ok && singleOk(r).entryId).toBe("q_002");
    const created = (await readResearch()).questions.find((x: any) => x.id === "q_002").created;
    expect(typeof created).toBe("string");
  });

  /**
   * `question_status` has no retire value, so there is no way to close a
   * question by status other than the two transitions the schema spec assigns
   * to research-exhaustiveness (`exhaustive_declared`) and proof-conclusion
   * (`resolved`).
   *
   * This is pinned because `question-selection/SKILL.md` instructed exactly
   * these two values — "to retire one, `op: 'update'` its `status`
   * (`superseded` / `answered`)" — in three separate places until #1135. The
   * write was rejected every time an agent followed it, and nothing recorded
   * that the values were illegal in the first place.
   */
  it("rejects retiring a question with a status outside question_status", async () => {
    await writeProject();
    for (const status of ["superseded", "answered"]) {
      const r = await researchAppend({
        projectPath: dir,
        section: "questions",
        op: "update",
        entryId: "q_001",
        fields: { status },
      });
      expect(r.ok, `status '${status}' must be rejected`).toBe(false);
    }
    // Nothing was written on either attempt.
    expect((await readResearch()).questions[0].status).toBe("open");
  });

  it("appends a plan, then rejects a second active plan for the same question", async () => {
    await writeProject();
    // Inline items, because a single-op plan append has no item ops to fill
    // them and an itemless plan is refused. `research-plan` batches instead.
    const { id: _o, ...plan } = validPlan("x", "q_001", "active", [seededPlanItem()]);
    const first = await researchAppend({ projectPath: dir, section: "plans", op: "append", entry: plan });
    expect(first.ok && singleOk(first).entryId).toBe("pl_001");

    const { id: _o2, ...plan2 } = validPlan("y", "q_001", "active", [seededPlanItem("pli_002")]);
    const second = await researchAppend({ projectPath: dir, section: "plans", op: "append", entry: plan2 });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.errors.join(" ")).toMatch(/already has an active plan/);
  });

  it("rejects an update that flips a superseded plan back to active when one is already active", async () => {
    const research = phase2Research();
    research.plans = [validPlan("pl_001", "q_001", "active"), validPlan("pl_002", "q_001", "superseded")];
    await writeProject(research);
    const before = await readFile(join(dir, "research.json"), "utf-8");
    const r = await researchAppend({
      projectPath: dir,
      section: "plans",
      op: "update",
      entryId: "pl_002",
      fields: { status: "active" }, // would create a second active plan for q_001
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/already has an active plan/);
    expect(await readFile(join(dir, "research.json"), "utf-8")).toBe(before);
  });

  it("appends a plan_item into the named plan", async () => {
    const research = phase2Research();
    research.plans = [validPlan("pl_001", "q_001", "active")];
    await writeProject(research);
    const r = await researchAppend({
      projectPath: dir,
      section: "plan_items",
      op: "append",
      planId: "pl_001",
      entry: validPlanItem(),
    });
    expect(r.ok && singleOk(r).entryId).toBe("pli_001");
    const items = (await readResearch()).plans[0].items;
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("pli_001");
  });

  it("requires planId for plan_items", async () => {
    await writeProject();
    const r = await researchAppend({ projectPath: dir, section: "plan_items", op: "append", entry: validPlanItem() });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/requires a 'planId'/);
  });

  it("appends a fact conflict referencing two assertions", async () => {
    await writeProject();
    const r = await researchAppend({ projectPath: dir, section: "conflicts", op: "append", entry: validConflict() });
    expect(r.ok && singleOk(r).entryId).toBe("c_001");
  });

  it("rejects resolving a conflict without the resolution analysis fields", async () => {
    const research = phase2Research();
    research.conflicts = [{ ...validConflict(), id: "c_001" }];
    await writeProject(research);
    const r = await researchAppend({
      projectPath: dir,
      section: "conflicts",
      op: "update",
      entryId: "c_001",
      fields: { status: "resolved", preferred_assertion_id: "a_001" }, // missing weighing/independence/rationale
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/weighing_analysis|independence_analysis|resolution_rationale/);
  });

  it("rejects a resolved conflict whose preferred_assertion_id is not among the competing", async () => {
    const research = phase2Research();
    research.conflicts = [{ ...validConflict(), id: "c_001" }];
    await writeProject(research);
    const r = await researchAppend({
      projectPath: dir,
      section: "conflicts",
      op: "update",
      entryId: "c_001",
      fields: {
        status: "resolved",
        independence_analysis: "independent sources",
        weighing_analysis: "census outweighs the later record",
        resolution_rationale: "primary informant",
        preferred_assertion_id: "a_999",
      },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/preferred_assertion_id/);
  });

  it("accepts a fully-resolved conflict", async () => {
    const research = phase2Research();
    research.conflicts = [{ ...validConflict(), id: "c_001" }];
    await writeProject(research);
    const r = await researchAppend({
      projectPath: dir,
      section: "conflicts",
      op: "update",
      entryId: "c_001",
      fields: {
        status: "resolved",
        independence_analysis: "independent sources",
        weighing_analysis: "census outweighs the later record",
        resolution_rationale: "primary informant",
        preferred_assertion_id: "a_001",
      },
    });
    expect(r.ok).toBe(true);
    expect((await readResearch()).conflicts[0].status).toBe("resolved");
  });

  // `moot` settles a conflict for every gate that reads `status`, including the
  // completion gate — and it was the one settling write with no precondition at
  // all, so a bare `{status: "moot"}` cleared that gate while asserting nothing.
  // The claim it makes ("this no longer matters") is a genealogical judgment, so
  // it owes the same written reason a `resolved` does; it owes only the one,
  // because there is nothing to weigh or to declare independent when the
  // conflict has stopped bearing on the question.
  it("rejects mooting a conflict without a rationale", async () => {
    const research = phase2Research();
    research.conflicts = [{ ...validConflict(), id: "c_001" }];
    await writeProject(research);
    const r = await researchAppend({
      projectPath: dir,
      section: "conflicts",
      op: "update",
      entryId: "c_001",
      fields: { status: "moot" },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/resolution_rationale/);
    expect((await readResearch()).conflicts[0].status).toBe("unresolved"); // nothing written
  });

  // A whitespace-only string asserts exactly as much as an absent one, and this
  // is an LLM-facing tool, so a degenerate value is a real shape rather than a
  // hypothetical. Both settling writes are checked the same way, and both are
  // free on the corpus: 0 of 1 moot and 0 of 85 resolved conflicts carry a
  // blank-or-non-string analysis field.
  it("rejects mooting a conflict with a whitespace-only rationale", async () => {
    const research = phase2Research();
    research.conflicts = [{ ...validConflict(), id: "c_001" }];
    await writeProject(research);
    const r = await researchAppend({
      projectPath: dir,
      section: "conflicts",
      op: "update",
      entryId: "c_001",
      fields: { status: "moot", resolution_rationale: "   " },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/resolution_rationale/);
    expect((await readResearch()).conflicts[0].status).toBe("unresolved"); // nothing written
  });

  it("rejects resolving a conflict whose analysis fields are whitespace only", async () => {
    const research = phase2Research();
    research.conflicts = [{ ...validConflict(), id: "c_001" }];
    await writeProject(research);
    const r = await researchAppend({
      projectPath: dir,
      section: "conflicts",
      op: "update",
      entryId: "c_001",
      fields: {
        status: "resolved",
        independence_analysis: "   ",
        weighing_analysis: "\t\n",
        resolution_rationale: " ",
        preferred_assertion_id: "a_001",
      },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/independence_analysis|weighing_analysis|resolution_rationale/);
    expect((await readResearch()).conflicts[0].status).toBe("unresolved"); // nothing written
  });

  it("accepts mooting a conflict with a rationale", async () => {
    const research = phase2Research();
    research.conflicts = [{ ...validConflict(), id: "c_001" }];
    await writeProject(research);
    const r = await researchAppend({
      projectPath: dir,
      section: "conflicts",
      op: "update",
      entryId: "c_001",
      fields: {
        status: "moot",
        resolution_rationale: "Superseded: the certificate was re-attributed to the correct person.",
      },
    });
    expect(r.ok).toBe(true);
    expect((await readResearch()).conflicts[0].status).toBe("moot");
  });

  it("rejects ruling out a hypothesis without a reason (validator)", async () => {
    const research = phase2Research();
    research.hypotheses = [{ ...validHypothesis(), id: "h_001" }];
    await writeProject(research);
    const r = await researchAppend({
      projectPath: dir,
      section: "hypotheses",
      op: "update",
      entryId: "h_001",
      fields: { ruled_out: true, status: "ruled_out" },
    });
    expect(r.ok).toBe(false);
  });

  it("treats re-declaring an already-declared question as a no-op", async () => {
    const research = phase2Research();
    research.questions = [
      { ...validQuestion("q_001"), status: "exhaustive_declared", exhaustive_declaration: { declared: true, log_entry_ids: ["log_001"], stop_criteria: {} } },
    ];
    research.log = [
      { id: "log_001", plan_item_id: null, performed: "2026-01-01T00:00:00Z", tool: "record_search", query: {}, outcome: "negative", results_examined: 0, external_site: null, results_ref: null },
    ];
    await writeProject(research);
    const before = await readFile(join(dir, "research.json"), "utf-8");
    const r = await researchAppend({
      projectPath: dir,
      section: "questions",
      op: "update",
      entryId: "q_001",
      fields: { exhaustive_declaration: { declared: true, log_entry_ids: ["log_001", "log_002"], stop_criteria: {} } },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.filesWritten).toEqual([]); // no-op, nothing written
    expect(await readFile(join(dir, "research.json"), "utf-8")).toBe(before);
  });

  it("does NOT no-op a bundled update that re-declares AND changes another field", async () => {
    const sc = {
      goal_alignment: true, repository_breadth: true, original_substitution: true,
      independent_verification: true, evidence_class: true, conflict_resolution: true, overturn_risk: true,
    };
    const research = phase2Research();
    research.questions = [
      { ...validQuestion("q_001"), status: "exhaustive_declared", priority: "high", exhaustive_declaration: { declared: true, log_entry_ids: ["log_001"], stop_criteria: sc } },
    ];
    research.log = [
      { id: "log_001", plan_item_id: null, performed: "2026-01-01T00:00:00Z", tool: "record_search", query: {}, outcome: "negative", results_examined: 0, external_site: null, results_ref: null },
    ];
    await writeProject(research);
    const r = await researchAppend({
      projectPath: dir,
      section: "questions",
      op: "update",
      entryId: "q_001",
      fields: { priority: "low", exhaustive_declaration: { declared: true, log_entry_ids: ["log_001"], stop_criteria: sc } },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.filesWritten).toEqual(["research.json"]); // wrote — not a no-op
    expect((await readResearch()).questions[0].priority).toBe("low");
  });
});

// ─── Phase 3 ───────────────────────────────────────────────────────────────

describe("research_append (Phase 3)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "research-append-p3-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function phase3Research() {
    const r = baseResearch();
    r.questions = [validQuestion("q_001")];
    return r;
  }
  async function writeProject(research: any = phase3Research(), tree: any = baseTree) {
    await writeFile(join(dir, "research.json"), JSON.stringify(research, null, 2));
    await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify(tree, null, 2));
  }
  const readResearch = async () => JSON.parse(await readFile(join(dir, "research.json"), "utf-8"));

  it("appends a timeline and stamps `generated` (datetime), refs an existing person", async () => {
    await writeProject();
    const r = await researchAppend({
      projectPath: dir,
      section: "timelines",
      op: "append",
      entry: { label: "John Smith timeline", person_ids: ["I1"], events: [], gaps: [] },
    });
    expect(r.ok && singleOk(r).entryId).toBe("t_001");
    const t = (await readResearch()).timelines[0];
    expect(t.generated).toMatch(/T.*:/); // ISO datetime, not a bare date
  });

  // `shortfall` vs the tier is a single-object rule, so ADR-0011's first
  // question puts it at the write boundary rather than in prose. Until
  // 2026-09-21 it lived only in the agent body and the eval validator, and
  // {tier: "probable", shortfall: "none"} validated clean in production.
  describe("shortfall must match the tier's conclusiveness", () => {
    const append = (tier: string, shortfall: string) =>
      researchAppend({
        projectPath: dir,
        section: "proof_summaries",
        op: "append",
        entry: {
          question_id: "q_001",
          tier,
          vehicle: "summary",
          shortfall,
          supporting_assertion_ids: ["a_001"],
          resolved_conflict_ids: [],
          exhaustive_search_summary: "Searched census + vitals",
          narrative_markdown: "## Conclusion\n...",
        },
      } as never);

    // Both conclusive tiers, not just `proved`: dropping "disproved" from the
    // set left a proved-only version of this block green, which is how the
    // first version of this rule shipped wrong in the first place.
    it.each([
      ["proved", "ceiling"], ["proved", "gap"], ["proved", "conflict"],
      ["disproved", "ceiling"], ["disproved", "gap"], ["disproved", "conflict"],
    ])("refuses tier '%s' with shortfall '%s'", async (tier, shortfall) => {
      await writeProject();
      const r = await append(tier, shortfall);
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.errors.join(" ")).toContain("conclusive answer");
    });

    it.each(["proved", "disproved"])(
      "accepts shortfall 'none' on conclusive tier '%s'",
      async (tier) => {
        // A conclusive tier ALSO needs the question already declared
        // exhaustive — the sibling arm of this same function. Without that
        // setup these refuse for the other reason and prove nothing about
        // shortfall.
        const research = baseResearch();
        research.questions = [
          {
            ...validQuestion("q_001"),
            status: "exhaustive_declared",
            exhaustive_declaration: {
              declared: true,
              log_entry_ids: ["log_001"],
              stop_criteria: {},
            },
          },
        ];
        research.log = [
          {
            id: "log_001", plan_item_id: null, performed: "2026-01-01T00:00:00Z",
            tool: "record_search", query: {}, outcome: "negative",
            results_examined: 0, external_site: null, results_ref: null,
          },
        ];
        await writeProject(research);
        expect((await append(tier, "none")).ok).toBe(true);
      },
    );

    it.each(["probable", "possible", "not_proved"])(
      "refuses shortfall 'none' on tier '%s', which reached no answer",
      async (tier) => {
        await writeProject();
        const r = await append(tier, "none");
        expect(r.ok).toBe(false);
        if (r.ok) return;
        expect(r.errors.join(" ")).toContain("reached no conclusive answer");
      },
    );

    it("accepts the pairings that do agree", async () => {
      await writeProject();
      expect((await append("probable", "gap")).ok).toBe(true);
    });

    it("says nothing when shortfall is a non-string — that is checkEnum's job", async () => {
      // The `typeof === "string"` guard, which nothing tested: loosening it to
      // `!== undefined` left this whole block green while a null shortfall
      // collected BOTH this refusal and checkEnum's, for one defect.
      // Must be a CONCLUSIVE tier: on a lower one neither arm reaches the
      // comparison, so the loosened guard is indistinguishable there.
      const research = baseResearch();
      research.questions = [
        {
          ...validQuestion("q_001"),
          status: "exhaustive_declared",
          exhaustive_declaration: {
            declared: true, log_entry_ids: ["log_001"], stop_criteria: {},
          },
        },
      ];
      research.log = [
        {
          id: "log_001", plan_item_id: null, performed: "2026-01-01T00:00:00Z",
          tool: "record_search", query: {}, outcome: "negative",
          results_examined: 0, external_site: null, results_ref: null,
        },
      ];
      await writeProject(research);
      const r = await researchAppend({
        projectPath: dir,
        section: "proof_summaries",
        op: "append",
        entry: {
          question_id: "q_001", tier: "proved", vehicle: "summary",
          shortfall: null, supporting_assertion_ids: ["a_001"],
          resolved_conflict_ids: [], exhaustive_search_summary: "s",
          narrative_markdown: "## C\n...",
        },
      } as never);
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.errors.join(" ")).not.toContain("conclusive answer");
    });

    it("says nothing when shortfall is absent — that is checkRequired's job", async () => {
      // Two diagnoses for one defect is what makes an agent repair the wrong
      // thing; the same reason the resolved_conflict_ids guard exists.
      await writeProject();
      const r = await researchAppend({
        projectPath: dir,
        section: "proof_summaries",
        op: "append",
        entry: {
          question_id: "q_001",
          tier: "probable",
          vehicle: "summary",
          supporting_assertion_ids: ["a_001"],
          resolved_conflict_ids: [],
          exhaustive_search_summary: "s",
          narrative_markdown: "## C\n...",
        },
      } as never);
      expect(r.ok).toBe(false);
      if (r.ok) return;
      const msg = r.errors.join(" ");
      expect(msg).toContain("missing required field 'shortfall'");
      expect(msg).not.toContain("reached no conclusive answer");
    });
  });

  it("appends a proof_summary referencing an existing question", async () => {
    await writeProject();
    const r = await researchAppend({
      projectPath: dir,
      section: "proof_summaries",
      op: "append",
      entry: {
        question_id: "q_001",
        tier: "probable",
        vehicle: "summary",
        shortfall: "gap",
        supporting_assertion_ids: ["a_001"],
        resolved_conflict_ids: [],
        exhaustive_search_summary: "Searched census + vitals",
        narrative_markdown: "## Conclusion\n...",
      },
    });
    expect(r.ok && singleOk(r).entryId).toBe("ps_001");
  });


  // The conclusion and its resolution are ONE write — the shape proof-conclusion
  // emits. Both properties below are load-bearing and neither is obvious:
  //
  //  - Order matters WITHIN the batch. The resolve gate reads the project as the
  //    batch applies, not a pre-call snapshot, so the summary op satisfies it for
  //    an op later in the same call. Reverse them and it refuses.
  //  - All-or-nothing means a question is never left resolved with nothing behind
  //    it. That is the reason for one call rather than two.
  it("accepts a proof summary and its question resolve in ONE batch", async () => {
    await writeProject();
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        {
          section: "proof_summaries",
          op: "append",
          entry: {
            question_id: "q_001",
            tier: "probable",
            vehicle: "summary",
            shortfall: "gap",
            supporting_assertion_ids: ["a_001"],
            resolved_conflict_ids: [],
            exhaustive_search_summary: "Searched census + vitals",
            narrative_markdown: "## Conclusion\n...",
          },
        },
        {
          section: "questions",
          op: "update",
          entryId: "q_001",
          fields: { status: "resolved", resolution_assertion_ids: ["a_001"] },
        },
      ],
    });
    expect(r.ok, `batch was refused: ${JSON.stringify((r as any).errors)}`).toBe(true);
    const after = await readResearch();
    expect(after.proof_summaries).toHaveLength(1);
    expect(after.questions[0].status).toBe("resolved");
  });

  it("refuses the same two ops in the reverse order, and writes nothing", async () => {
    await writeProject();
    const before = await readFile(join(dir, "research.json"), "utf-8");
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        {
          section: "questions",
          op: "update",
          entryId: "q_001",
          fields: { status: "resolved", resolution_assertion_ids: ["a_001"] },
        },
        {
          section: "proof_summaries",
          op: "append",
          entry: {
            question_id: "q_001",
            tier: "probable",
            vehicle: "summary",
            shortfall: "gap",
            supporting_assertion_ids: ["a_001"],
            resolved_conflict_ids: [],
            exhaustive_search_summary: "Searched census + vitals",
            narrative_markdown: "## Conclusion\n...",
          },
        },
      ],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    // The message must teach the ordering, since that is the whole fix.
    expect(r.errors.join(" ")).toContain("order the proof_summaries append BEFORE");
    expect(await readFile(join(dir, "research.json"), "utf-8")).toBe(before);
  });


  // ── a broader place containing a narrower one is not a conflict (#2028) ──
  //
  // "Ireland" and "County Cork, Ireland" are one claim at two levels of
  // precision. The reported defect is the agent filing that pair as a dispute.
  // Measured before landing: 0 of the 113 competing assertions in the scenario
  // corpus carry `standard_place`, so the check reads free-text `place`; and 0
  // existing conflicts are in a containment relationship, so nothing shipped
  // starts out refused.
  describe("place containment is not a disagreement", () => {
    const placed = (conflictIds: string[], places: Record<string, string>) => ({
      project: { objective: "x" },
      questions: [{ id: "q_001", question: "born where?", status: "open" }],
      sources: [{ id: "src_001", citation: "1850 census" }],
      assertions: Object.entries(places).map(([id, place]) => ({
        id,
        source_id: "src_001",
        fact_type: "birth",
        value: place,
        place,
      })),
      conflicts: conflictIds.length
        ? [
            {
              id: "c_001",
              conflict_type: "fact",
              description: "birthplace",
              disputed_attribute: "birthplace",
              competing_assertion_ids: conflictIds,
              status: "unresolved",
              blocks_question_ids: [],
            },
          ]
        : [],
      proof_summaries: [],
    });
    const appendConflict = (ids: string[]) => ({
      projectPath: dir,
      section: "conflicts" as const,
      op: "append" as const,
      entry: {
        conflict_type: "fact",
        description: "birthplace",
        competing_assertion_ids: ids,
        status: "unresolved",
        blocks_question_ids: [],
        disputed_attribute: "birthplace",
      },
    });

    it.each([
      ["broader first", { a_001: "Ireland", a_002: "County Cork, Ireland" }],
      ["narrower first", { a_001: "County Cork, Ireland", a_002: "Ireland" }],
      ["deeper hierarchy", {
        a_001: "Pennsylvania, United States",
        a_002: "Schuylkill, Pennsylvania, United States",
      }],
    ])("refuses a conflict over a containment pair: %s", async (_label, places) => {
      await writeProject(placed([], places as Record<string, string>));
      const r = await researchAppend(appendConflict(["a_001", "a_002"]));
      expect(r.ok).toBe(false);
      const msg = JSON.stringify((r as any).errors);
      expect(msg).toContain("two levels of precision");
      expect(msg).toContain("a_001");
      expect(msg).toContain("a_002");
    });

    // The other direction, which is the half a "break it and watch it fail"
    // pass cannot show: the guard must leave real disputes alone. Both rows
    // are live in the committed corpus.
    it.each([
      ["different countries", { a_001: "Ireland", a_002: "Pennsylvania" }],
      ["sibling counties", {
        a_001: "Schuylkill, Pennsylvania, United States",
        a_002: "Allegheny, Pennsylvania, United States",
      }],
    ])("still allows a real disagreement: %s", async (_label, places) => {
      await writeProject(placed([], places as Record<string, string>));
      const r = await researchAppend(appendConflict(["a_001", "a_002"]));
      expect(r.ok, `refused: ${JSON.stringify((r as any).errors)}`).toBe(true);
    });

    // REPRO for the reviewer's blocker: three competing assertions where two
    // agree and one genuinely disagrees. This is the dominant corpus shape
    // (34 of the 37 corpus fact conflicts carry three all-`birth` assertions;
    // exactly two is 1), and every other test here uses exactly two
    // assertions, which is why inverting the comparator reds 6 tests without
    // ever exercising it.
    it("allows the live 3-assertion Ireland-vs-Pennsylvania conflict", async () => {
      await writeProject(placed([], {
        a_001: "Ireland",
        a_002: "Ireland",
        a_003: "Pennsylvania",
      }));
      const r = await researchAppend(appendConflict(["a_001", "a_002", "a_003"]));
      expect(r.ok, `refused: ${JSON.stringify((r as any).errors)}`).toBe(true);
    });

    // Equal places are compatible but are not containment — neither says less
    // than the other. Whatever is wrong with a conflict recorded over two
    // identical places, it is not the defect this guard names.
    it("allows a conflict over two identical places", async () => {
      await writeProject(placed([], { a_001: "Ireland", a_002: "Ireland" }));
      const r = await researchAppend(appendConflict(["a_001", "a_002"]));
      expect(r.ok, `refused: ${JSON.stringify((r as any).errors)}`).toBe(true);
    });

    // Containment still fires when it is the ONLY relationship present, even
    // with a third assertion in the entry that agrees with one side.
    it("still refuses containment when a third assertion agrees", async () => {
      await writeProject(placed([], {
        a_001: "Ireland",
        a_002: "County Cork, Ireland",
        a_003: "Ireland",
      }));
      const r = await researchAppend(appendConflict(["a_001", "a_002", "a_003"]));
      expect(r.ok).toBe(false);
      expect(JSON.stringify((r as any).errors)).toContain("two levels of precision");
    });

    // Exercises the anyDisagreement clause specifically: a containment pair
    // AND a genuine disagreement in the same entry. The conflict is real —
    // Pennsylvania contradicts both Irish places — so the entry stands even
    // though two of its assertions are one claim at two precisions.
    it("allows containment when some other pair genuinely disagrees", async () => {
      await writeProject(placed([], {
        a_001: "Ireland",
        a_002: "County Cork, Ireland",
        a_003: "Pennsylvania",
      }));
      const r = await researchAppend(appendConflict(["a_001", "a_002", "a_003"]));
      expect(r.ok, `refused: ${JSON.stringify((r as any).errors)}`).toBe(true);
    });

    it("ignores an assertion carrying no place — nothing to compare", async () => {
      await writeProject(placed([], { a_001: "Ireland" }));
      const r = await researchAppend(appendConflict(["a_001", "a_002"]));
      // a_002 does not exist, and that is NOT refused here — nothing
      // reference-checks competing_assertion_ids on this path. Pin the outcome
      // as well as the absent substring: asserting only that a substring is
      // missing passes when the write is refused for any other reason at all.
      expect(r.ok, `refused: ${JSON.stringify((r as any).errors)}`).toBe(true);
      expect(JSON.stringify((r as any).errors ?? [])).not.toContain(
        "two levels of precision",
      );
    });

    // The blocker: the guard read no `disputed_attribute`, so a dispute about
    // the YEAR between two places in a containment relationship was refused
    // with a message saying they "do not disagree" — false about the axis
    // actually in dispute. `disputed_attribute` is free text (28 distinct
    // values across 102 corpus fact conflicts), so the allow-list is exact.
    it.each([
      ["birth_year", "a plain non-place attribute"],
      ["birth_year_and_birthplace", "a compound naming a non-place axis too"],
      ["surname_spelling", "another axis entirely"],
      ["Father's name: 'John W. Spriggs' vs 'Wm. Spriggs'", "free-text prose"],
    ])("does not fire when disputed_attribute is %s (%s)", async (attr) => {
      await writeProject(placed([], {
        a_001: "Ireland",
        a_002: "County Cork, Ireland",
      }));
      const base = appendConflict(["a_001", "a_002"]);
      const r = await researchAppend({
        ...base,
        entry: { ...base.entry, disputed_attribute: attr },
      });
      expect(r.ok, `refused: ${JSON.stringify((r as any).errors)}`).toBe(true);
    });

    // A blank or comma-only place is "no place", not a disagreement. Reading it
    // as one silently disabled the guard for the whole entry.
    it.each([["", "blank"], [" , ", "comma-only"]])(
      "is not disabled by a %s place on a third assertion (%s)",
      async (blank) => {
        await writeProject(placed([], {
          a_001: "Ireland",
          a_002: "County Cork, Ireland",
          a_003: blank,
        }));
        const r = await researchAppend(appendConflict(["a_001", "a_002", "a_003"]));
        expect(r.ok).toBe(false);
        expect(JSON.stringify((r as any).errors)).toContain("two levels of precision");
      },
    );

    // Depth counts normalized segments, as the comparator does. A raw comma
    // count disagrees in both directions.
    it("treats a trailing comma as the same depth, not a containment", async () => {
      await writeProject(placed([], { a_001: "Ireland", a_002: "Ireland," }));
      const r = await researchAppend(appendConflict(["a_001", "a_002"]));
      expect(r.ok, `refused: ${JSON.stringify((r as any).errors)}`).toBe(true);
    });

    it("still sees containment through a trailing comma", async () => {
      await writeProject(placed([], { a_001: "Ireland,", a_002: "Cork, Ireland" }));
      const r = await researchAppend(appendConflict(["a_001", "a_002"]));
      expect(r.ok).toBe(false);
      expect(JSON.stringify((r as any).errors)).toContain("two levels of precision");
    });

    it("does not fire on an identity conflict", async () => {
      await writeProject(placed([], { a_001: "Ireland", a_002: "County Cork, Ireland" }));
      const r = await researchAppend({
        ...appendConflict(["a_001", "a_002"]),
        entry: {
          ...appendConflict(["a_001", "a_002"]).entry,
          conflict_type: "identity",
          identity_question: "same Patrick?",
        },
      });
      expect(JSON.stringify((r as any).errors ?? [])).not.toContain(
        "two levels of precision",
      );
    });

    // The freeze #2354 had to design around: a project written before this
    // rule existed must stay editable. The arm is scoped to ops that (re)set
    // the pairing, so an unrelated field update passes.
    it("does not refuse an unrelated update to a pre-existing containment conflict", async () => {
      await writeProject(
        placed(["a_001", "a_002"], { a_001: "Ireland", a_002: "County Cork, Ireland" }),
      );
      const r = await researchAppend({
        projectPath: dir,
        section: "conflicts",
        op: "update",
        entryId: "c_001",
        fields: { description: "birthplace, restated" },
      });
      expect(r.ok, `refused: ${JSON.stringify((r as any).errors)}`).toBe(true);
    });

    it("does fire on an update that re-sets competing_assertion_ids", async () => {
      await writeProject(
        placed(["a_001"], { a_001: "Ireland", a_002: "County Cork, Ireland" }),
      );
      const r = await researchAppend({
        projectPath: dir,
        section: "conflicts",
        op: "update",
        entryId: "c_001",
        fields: { competing_assertion_ids: ["a_001", "a_002"] },
      });
      expect(r.ok).toBe(false);
      expect(JSON.stringify((r as any).errors)).toContain("two levels of precision");
    });
  });

  // ── two dates that cannot be ordered are warned about, not refused (#2028) ──
  describe("unorderable competing dates raise a warning", () => {
    const dated = (rows: [string, string, string][]) => ({
      project: { objective: "x" },
      questions: [{ id: "q_001", question: "when?", status: "open" }],
      sources: [{ id: "src_001", citation: "a source" }],
      assertions: rows.map(([id, fact_type, date]) => ({
        id,
        source_id: "src_001",
        fact_type,
        value: `${fact_type} ${date}`,
        date,
      })),
      conflicts: [],
      proof_summaries: [],
    });
    const appendConflict = (ids: string[]) => ({
      projectPath: dir,
      section: "conflicts" as const,
      op: "append" as const,
      entry: {
        conflict_type: "fact",
        description: "temporal impossibility",
        disputed_attribute: "event_order",
        competing_assertion_ids: ids,
        status: "unresolved",
        blocks_question_ids: [],
      },
    });
    const warningsOf = (r: any) => JSON.stringify(r.validation?.warnings ?? []);

    it("warns on the reported incident — an arrival inside a year-only death", async () => {
      await writeProject(
        dated([["a_001", "immigration", "1856-12-15"], ["a_002", "death", "1856"]]),
      );
      const r = await researchAppend(appendConflict(["a_001", "a_002"]));
      // The write SUCCEEDS. This is an advisory, not a gate.
      expect(r.ok, `refused: ${JSON.stringify((r as any).errors)}`).toBe(true);
      expect(warningsOf(r)).toContain("cannot be ordered");
      expect(warningsOf(r)).toContain("a_001");
      expect(warningsOf(r)).toContain("a_002");
    });

    it("stays silent when the two events are genuinely ordered", async () => {
      await writeProject(
        dated([["a_001", "immigration", "1853"], ["a_002", "death", "1908-03-12"]]),
      );
      const r = await researchAppend(appendConflict(["a_001", "a_002"]));
      expect(r.ok, `refused: ${JSON.stringify((r as any).errors)}`).toBe(true);
      expect(warningsOf(r)).not.toContain("cannot be ordered");
    });

    // The noise check. A birthplace conflict is two `birth` assertions whose
    // dates overlap by construction; warning there would fire on 35 of the 37
    // corpus conflicts and teach the reader to skip this channel.
    it("stays silent on a same-fact_type value disagreement", async () => {
      await writeProject(
        dated([["a_001", "birth", "~1845"], ["a_002", "birth", "1845"]]),
      );
      const r = await researchAppend(appendConflict(["a_001", "a_002"]));
      expect(r.ok).toBe(true);
      expect(warningsOf(r)).not.toContain("cannot be ordered");
    });

    // Regression guard for the bug this nearly shipped with: `getDayRange`
    // returns null for `~approx` and ISO, and `compatibleDate` reads null as
    // "incompatible", so skipping `stdDate` makes the check silently say
    // nothing on exactly the imprecise dates it exists to flag.
    it("normalizes through stdDate — an approx year still overlaps a day date", async () => {
      await writeProject(
        dated([["a_001", "residence", "~1856"], ["a_002", "death", "1856-12-15"]]),
      );
      const r = await researchAppend(appendConflict(["a_001", "a_002"]));
      expect(warningsOf(r)).toContain("cannot be ordered");
    });

    // Covers the outer fact_type-span guard specifically. Without it, a pair
    // where only ONE side declares a fact_type reaches the date comparison —
    // the inner same-type `continue` cannot catch that, because a string never
    // equals undefined. An assertion that does not say what kind of event it
    // records gives no reason to read the pair as an ordering claim.
    // Ask 7: `compatibleDate` widens imperfect dates by 365 days, so it calls
    // a death of "1856" unorderable against a burial on 1857-12-31 — and the
    // warning would then tell the agent neither is known to come first, which
    // is false. `isABeforeB` is three-valued at fudge 0 and says nothing here.
    it.each([
      ["1857-12-31", "a year later — ordered, despite the 365-day fudge"],
      ["1855-06-01", "a year earlier — ordered the other way"],
    ])("stays silent on a genuinely ordered pair: %s (%s)", async (other) => {
      await writeProject(dated([["a_001", "death", "1856"], ["a_002", "burial", other]]));
      const r = await researchAppend(appendConflict(["a_001", "a_002"]));
      expect(r.ok, `refused: ${JSON.stringify((r as any).errors)}`).toBe(true);
      expect(warningsOf(r)).not.toContain("cannot be ordered");
    });

    it("says nothing when only one side declares a fact_type", async () => {
      await writeProject({
        project: { objective: "x" },
        questions: [{ id: "q_001", question: "when?", status: "open" }],
        sources: [{ id: "src_001", citation: "a source" }],
        assertions: [
          { id: "a_001", source_id: "src_001", fact_type: "death", value: "d", date: "1856" },
          { id: "a_002", source_id: "src_001", value: "untyped", date: "1856-12-15" },
        ],
        conflicts: [],
        proof_summaries: [],
      });
      const r = await researchAppend(appendConflict(["a_001", "a_002"]));
      expect(r.ok, `refused: ${JSON.stringify((r as any).errors)}`).toBe(true);
      expect(warningsOf(r)).not.toContain("cannot be ordered");
    });

    it("says nothing when either date is absent", async () => {
      await writeProject(
        dated([["a_001", "immigration", "1856-12-15"], ["a_002", "relationship", ""]]),
      );
      const r = await researchAppend(appendConflict(["a_001", "a_002"]));
      expect(r.ok, `refused: ${JSON.stringify((r as any).errors)}`).toBe(true);
      expect(warningsOf(r)).not.toContain("cannot be ordered");
    });
  });

  // ── correlation presupposes identity (lead ruling, 2026-08-19) ──
  //
  // A conclusion may not out-tier the reliability of the sources it rests on.
  // The rule moved into the tool after five successive wordings of the agent's
  // own gate failed to hold it — the last of them recording a birthplace
  // conflict as "non-blocking, it doesn't touch identity" while its own body
  // named birthplace an identifying attribute.
  //
  // Blast radius, measured across all 88 committed scenarios before landing:
  // 83 carry no unresolved conflict so the rule cannot fire, 1 carries
  // conflicts that share no source with a conclusion, and 4 would fire — all
  // of them the flynn-* fixtures built to exercise conflict handling.
  describe("a conclusion may not out-tier a disputed source", () => {
    const conflicted = () => ({
      project: { objective: "x" },
      questions: [{ id: "q_001", question: "parents?", status: "open" }],
      sources: [{ id: "src_001", citation: "1850 census" }, { id: "src_004", citation: "death cert" }],
      assertions: [
        // The conflict disputes the death certificate's birthplace...
        { id: "a_012", source_id: "src_004", value: "Born 1845, Pennsylvania" },
        { id: "a_002", source_id: "src_001", value: "Ireland" },
        // ...and the conclusion leans on that same death certificate for the father.
        { id: "a_013", source_id: "src_004", value: "Father: Thomas Flynn" },
        { id: "a_004", source_id: "src_001", value: "in Thomas's household" },
      ],
      conflicts: [
        { id: "c_001", status: "unresolved", competing_assertion_ids: ["a_002", "a_012"] },
      ],
      proof_summaries: [],
    });

    const summary = (tier: string, supporting: string[]) => ({
      question_id: "q_001",
      tier,
      vehicle: "summary",
      shortfall: "gap",
      supporting_assertion_ids: supporting,
      resolved_conflict_ids: [],
      exhaustive_search_summary: "census + vitals",
      narrative_markdown: "## Conclusion\n...",
    });

    it.each(["possible", "probable"])(
      "refuses tier '%s' when an open conflict disputes a source the conclusion relies on",
      async (tier) => {
        await writeProject(conflicted());
        const before = await readFile(join(dir, "research.json"), "utf-8");
        const r = await researchAppend({
          projectPath: dir,
          section: "proof_summaries",
          op: "append",
          entry: summary(tier, ["a_004", "a_013"]),
        });
        expect(r.ok).toBe(false);
        if (r.ok) return;
        const msg = r.errors.join(" ");
        expect(msg).toContain("c_001");
        expect(msg).toContain("src_004");
        // The message must leave a working move, or it repeats the bypass this
        // whole guardrail exists to stop.
        expect(msg).toContain("not_proved");
        expect(await readFile(join(dir, "research.json"), "utf-8")).toBe(before);
      },
    );

    it("allows not_proved — recording the blocked attempt is the sanctioned move", async () => {
      await writeProject(conflicted());
      const r = await researchAppend({
        projectPath: dir,
        section: "proof_summaries",
        op: "append",
        entry: summary("not_proved", ["a_004", "a_013"]),
      });
      expect(r.ok, `refused: ${JSON.stringify((r as any).errors)}`).toBe(true);
    });

    it("does NOT fire when the conflict shares no source with the conclusion", async () => {
      // The narrow case that keeps this from becoming "any open conflict
      // blocks everything": a dispute confined to sources the conclusion does
      // not lean on leaves the correlation intact.
      const state = conflicted();
      state.conflicts = [
        { id: "c_002", status: "unresolved", competing_assertion_ids: ["a_002"] },
      ];
      await writeProject(state);
      const r = await researchAppend({
        projectPath: dir,
        section: "proof_summaries",
        op: "append",
        entry: summary("probable", ["a_013"]), // src_004 only; c_002 disputes src_001
      });
      expect(r.ok, `refused: ${JSON.stringify((r as any).errors)}`).toBe(true);
    });

    it("does NOT fire once the conflict is resolved", async () => {
      const state = conflicted();
      state.conflicts[0].status = "resolved";
      await writeProject(state);
      const r = await researchAppend({
        projectPath: dir,
        section: "proof_summaries",
        op: "append",
        entry: summary("probable", ["a_004", "a_013"]),
      });
      expect(r.ok, `refused: ${JSON.stringify((r as any).errors)}`).toBe(true);
    });


    it("refuses an update that leaves a forbidden tier standing, without naming tier", async () => {
      // The 2026-08-21 escape, replayed. The agent updated the summary's other
      // fields and never mentioned `tier`, so the stale `probable` stayed —
      // and a rule gated on "did this op set the tier" never ran. The tier did
      // not need to be touched; it was already wrong.
      const state = conflicted() as any;
      state.proof_summaries = [
        { id: "ps_001", ...summary("probable", ["a_004", "a_013"]) },
      ];
      await writeProject(state);
      const before = await readFile(join(dir, "research.json"), "utf-8");
      const r = await researchAppend({
        projectPath: dir,
        section: "proof_summaries",
        op: "update",
        entryId: "ps_001",
        fields: { narrative_markdown: "## Conclusion\nrewritten, tier untouched" },
      });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.errors.join(" ")).toContain("c_001");
      expect(await readFile(join(dir, "research.json"), "utf-8")).toBe(before);
    });

    it("accepts the same update when it brings the tier down in the same call", async () => {
      // The deny has to stay satisfiable: fixing the entry is one call, not a
      // deadlock where you cannot edit it without first editing it.
      const state = conflicted() as any;
      state.proof_summaries = [
        { id: "ps_001", ...summary("probable", ["a_004", "a_013"]) },
      ];
      await writeProject(state);
      const r = await researchAppend({
        projectPath: dir,
        section: "proof_summaries",
        op: "update",
        entryId: "ps_001",
        fields: { tier: "not_proved", narrative_markdown: "## Conclusion\nidentity unsettled" },
      });
      expect(r.ok, `refused: ${JSON.stringify((r as any).errors)}`).toBe(true);
    });


    it("refuses to resolve the question while the conflict blocks the conclusion", async () => {
      // The 2026-08-21 escape. Everything else was right — probable refused,
      // not_proved recorded, no tree written — and then the question was closed
      // anyway, on evidence that had never been correlated.
      const state = conflicted() as any;
      state.proof_summaries = [
        { id: "ps_001", ...summary("not_proved", ["a_004", "a_013"]) },
      ];
      await writeProject(state);
      const before = await readFile(join(dir, "research.json"), "utf-8");
      const r = await researchAppend({
        projectPath: dir,
        section: "questions",
        op: "update",
        entryId: "q_001",
        fields: { status: "resolved", resolution_assertion_ids: ["a_004", "a_013"] },
      });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.errors.join(" ")).toContain("c_001");
      expect(await readFile(join(dir, "research.json"), "utf-8")).toBe(before);
    });

    it("still allows not_proved to close a question that was simply empty", async () => {
      // The distinction this rule turns on, and the one it must not break:
      // `not_proved` legitimately closes a question researched and found empty.
      // Only a question the researcher was PREVENTED from concluding stays open.
      const state = conflicted() as any;
      state.conflicts = [];  // nothing disputed
      state.proof_summaries = [
        { id: "ps_001", ...summary("not_proved", ["a_004", "a_013"]) },
      ];
      await writeProject(state);
      const r = await researchAppend({
        projectPath: dir,
        section: "questions",
        op: "update",
        entryId: "q_001",
        fields: { status: "resolved", resolution_assertion_ids: ["a_004"] },
      });
      expect(r.ok, `refused: ${JSON.stringify((r as any).errors)}`).toBe(true);
    });

    it("allows the resolve once the conflict touches no source the conclusion uses", async () => {
      const state = conflicted() as any;
      // c_002 disputes src_001 only; the conclusion leans on src_004 only.
      state.conflicts = [
        { id: "c_002", status: "unresolved", competing_assertion_ids: ["a_002"] },
      ];
      state.proof_summaries = [{ id: "ps_001", ...summary("probable", ["a_013"]) }];
      await writeProject(state);
      const r = await researchAppend({
        projectPath: dir,
        section: "questions",
        op: "update",
        entryId: "q_001",
        fields: { status: "resolved", resolution_assertion_ids: ["a_013"] },
      });
      expect(r.ok, `refused: ${JSON.stringify((r as any).errors)}`).toBe(true);
    });

    it("cannot be cleared by resolving the conflict in the same batch", async () => {
      // Same discipline as the exhaustiveness gate: read from the PRE-CALL
      // snapshot, so a batch may not manufacture its own precondition.
      await writeProject(conflicted());
      const r = await researchAppend({
        projectPath: dir,
        ops: [
          {
            section: "conflicts",
            op: "update",
            entryId: "c_001",
            // A FULLY VALID resolution, so the batch's only remaining defect is
            // the one under test. With a partial resolution the batch is
            // refused for a missing weighing/rationale instead, and this test
            // passes with the rule disconnected entirely — which it did.
            fields: {
              status: "resolved",
              preferred_assertion_id: "a_002",
              independence_analysis: "separate records, separate informants",
              weighing_analysis: "two censuses outweigh a later secondary informant",
              resolution_rationale: "contemporaneous household enumeration preferred",
            },
          },
          { section: "proof_summaries", op: "append", entry: summary("probable", ["a_004", "a_013"]) },
        ],
      });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.errors.join(" ")).toContain("c_001");
    });
  });


  // ── one conclusion per question ──
  //
  // The ownership manifest has required this since it landed and nothing
  // enforced it. Observed 2026-08-20: blocked from concluding at `probable`,
  // the agent recorded a correct `not_proved` summary by APPENDING it, leaving
  // the stale `probable` entry beside it — two contradictory conclusions on one
  // question, with nothing marking which is current.
  describe("a question carries only one proof summary", () => {
    const withSummary = () => ({
      project: { objective: "x" },
      questions: [{ id: "q_001", question: "parents?", status: "open" }],
      sources: [{ id: "src_001", citation: "1850 census" }],
      assertions: [{ id: "a_004", source_id: "src_001", value: "in household" }],
      conflicts: [],
      proof_summaries: [
        {
          id: "ps_001",
          question_id: "q_001",
          tier: "probable",
          vehicle: "summary",
          shortfall: "gap",
          supporting_assertion_ids: ["a_004"],
          resolved_conflict_ids: [],
          exhaustive_search_summary: "census",
          narrative_markdown: "## Conclusion\n...",
        },
      ],
    });

    const entry = (tier: string) => ({
      question_id: "q_001",
      tier,
      vehicle: "summary",
      shortfall: "gap",
      supporting_assertion_ids: ["a_004"],
      resolved_conflict_ids: [],
      exhaustive_search_summary: "census",
      narrative_markdown: "## Conclusion\n...",
    });

    it("refuses a second append, and names the id to update instead", async () => {
      await writeProject(withSummary());
      const before = await readFile(join(dir, "research.json"), "utf-8");
      const r = await researchAppend({
        projectPath: dir,
        section: "proof_summaries",
        op: "append",
        entry: entry("not_proved"),
      });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      const msg = r.errors.join(" ");
      expect(msg).toContain("ps_001");
      // The deny must leave a working move — the id to retry against.
      expect(msg).toContain('op: "update"');
      expect(await readFile(join(dir, "research.json"), "utf-8")).toBe(before);
    });


    it("refuses an UPDATE that repoints a summary onto a question that already has one", async () => {
      // The append gate was the same mistake as the tier gate two commits
      // earlier: it asked "is this op an append" when the rule is "does this
      // question end up with two summaries". An update that sets question_id
      // walks straight past it and leaves the exact state the deny message
      // describes — two contradictory conclusions, nothing saying which wins.
      const state = withSummary() as any;
      state.questions.push({ id: "q_002", question: "birth?", status: "open" });
      state.proof_summaries.push({
        id: "ps_002",
        ...entry("possible"),
        question_id: "q_002",
      });
      await writeProject(state);
      const before = await readFile(join(dir, "research.json"), "utf-8");
      const r = await researchAppend({
        projectPath: dir,
        section: "proof_summaries",
        op: "update",
        entryId: "ps_002",
        fields: { question_id: "q_001" },
      });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.errors.join(" ")).toContain("ps_001");
      expect(await readFile(join(dir, "research.json"), "utf-8")).toBe(before);
    });

    it("allows updating the existing summary", async () => {
      await writeProject(withSummary());
      const r = await researchAppend({
        projectPath: dir,
        section: "proof_summaries",
        op: "update",
        entryId: "ps_001",
        fields: { tier: "not_proved" },
      });
      expect(r.ok, `refused: ${JSON.stringify((r as any).errors)}`).toBe(true);
      expect((await readResearch()).proof_summaries).toHaveLength(1);
    });

    it("allows a first summary for a DIFFERENT question", async () => {
      const state = withSummary();
      state.questions.push({ id: "q_002", question: "birth?", status: "open" });
      await writeProject(state);
      const r = await researchAppend({
        projectPath: dir,
        section: "proof_summaries",
        op: "append",
        entry: { ...entry("probable"), question_id: "q_002" },
      });
      expect(r.ok, `refused: ${JSON.stringify((r as any).errors)}`).toBe(true);
    });

    it("catches two appends for one question inside a single batch", async () => {
      // Reads live state rather than the pre-call snapshot, so the second op
      // collides with the first. A snapshot-based check would let a batch
      // create the duplicate it exists to prevent.
      const state = withSummary();
      state.proof_summaries = [];
      await writeProject(state);
      const r = await researchAppend({
        projectPath: dir,
        ops: [
          { section: "proof_summaries", op: "append", entry: entry("possible") },
          { section: "proof_summaries", op: "append", entry: entry("not_proved") },
        ],
      });
      expect(r.ok).toBe(false);
    });
  });

  // docs/specs/guardrail-enforcement-spec.md §5 — tier/exhaustiveness cross-field guardrail.
  it("rejects tier 'proved' when the question's exhaustive_declaration.declared is false", async () => {
    await writeProject(); // phase3Research(): q_001 defaults to exhaustive_declaration.declared: false
    const before = await readFile(join(dir, "research.json"), "utf-8");
    const r = await researchAppend({
      projectPath: dir,
      section: "proof_summaries",
      op: "append",
      entry: {
        question_id: "q_001",
        tier: "proved",
        vehicle: "summary",
        shortfall: "none",
        supporting_assertion_ids: ["a_001"],
        resolved_conflict_ids: [],
        exhaustive_search_summary: "Searched census + vitals",
        narrative_markdown: "## Conclusion\n...",
      },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/exhaustive_declaration\.declared === true/);
    expect(await readFile(join(dir, "research.json"), "utf-8")).toBe(before);
  });

  it("rejects a single batch that declares exhaustiveness and consumes it for tier 'proved' in the same call (TOCTOU)", async () => {
    await writeProject();
    const before = await readFile(join(dir, "research.json"), "utf-8");
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        {
          section: "questions",
          op: "update",
          entryId: "q_001",
          fields: {
            exhaustive_declaration: { declared: true, log_entry_ids: ["log_001"], stop_criteria: {} },
          },
        },
        {
          section: "proof_summaries",
          op: "append",
          entry: {
            question_id: "q_001",
            tier: "proved",
            vehicle: "summary",
            shortfall: "none",
            supporting_assertion_ids: ["a_001"],
            resolved_conflict_ids: [],
            exhaustive_search_summary: "Searched census + vitals",
            narrative_markdown: "## Conclusion\n...",
          },
        },
      ],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/exhaustive_declaration\.declared === true/);
    // All-or-nothing: neither op landed, including the exhaustiveness declaration.
    expect(await readFile(join(dir, "research.json"), "utf-8")).toBe(before);
  });

  const fullStopCriteria = () => ({
    goal_alignment: true,
    repository_breadth: true,
    original_substitution: true,
    independent_verification: true,
    evidence_class: true,
    conflict_resolution: true,
    overturn_risk: true,
  });
  const declaredExhaustiveLog = () => [
    {
      id: "log_001",
      plan_item_id: null,
      performed: "2026-01-01T00:00:00Z",
      tool: "record_search",
      query: {},
      outcome: "negative",
      results_examined: 0,
      external_site: null,
      results_ref: null,
    },
  ];

  it("allows tier 'proved' when exhaustive_declaration.declared was already true from an earlier, separate call", async () => {
    const r0 = phase3Research();
    r0.questions = [
      {
        ...validQuestion("q_001"),
        status: "exhaustive_declared",
        exhaustive_declaration: { declared: true, log_entry_ids: ["log_001"], stop_criteria: fullStopCriteria() },
      },
    ];
    r0.log = declaredExhaustiveLog();
    await writeProject(r0);
    const r = await researchAppend({
      projectPath: dir,
      section: "proof_summaries",
      op: "append",
      entry: {
        question_id: "q_001",
        tier: "proved",
        vehicle: "summary",
        shortfall: "none",
        supporting_assertion_ids: ["a_001"],
        resolved_conflict_ids: [],
        exhaustive_search_summary: "Searched census + vitals",
        narrative_markdown: "## Conclusion\n...",
      },
    });
    expect(r.ok && singleOk(r).entryId).toBe("ps_001");
  });

  it("does not re-trigger the tier guardrail on an unrelated update to an already-proved entry", async () => {
    const r0 = phase3Research();
    r0.questions = [
      {
        ...validQuestion("q_001"),
        status: "exhaustive_declared",
        exhaustive_declaration: { declared: true, log_entry_ids: ["log_001"], stop_criteria: fullStopCriteria() },
      },
    ];
    r0.log = declaredExhaustiveLog();
    r0.proof_summaries = [
      {
        id: "ps_001",
        question_id: "q_001",
        tier: "proved",
        vehicle: "summary",
        shortfall: "none",
        supporting_assertion_ids: ["a_001"],
        resolved_conflict_ids: [],
        exhaustive_search_summary: "Searched census + vitals",
        narrative_markdown: "## Conclusion\n...",
      },
    ];
    await writeProject(r0);
    const r = await researchAppend({
      projectPath: dir,
      section: "proof_summaries",
      op: "update",
      entryId: "ps_001",
      fields: { narrative_markdown: "## Conclusion\nRevised wording." },
    });
    expect(r.ok).toBe(true);
  });

  it("appends an evaluation and stamps `timestamp` (datetime)", async () => {
    await writeProject();
    const r = await researchAppend({
      projectPath: dir,
      section: "evaluations",
      op: "append",
      entry: {
        focus: "conclusion-readiness",
        target_id: "q_001",
        target_type: "question",
        verdict: "looks_solid",
        file_path: "evaluations/ev_001.md",
        superseded_by: null,
      },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(singleOk(r).entryId).toBe("ev_001");
    expect((await readResearch()).evaluations[0].timestamp).toMatch(/T.*:/);
  });

  it("appends a known_holding and stamps `created` (date)", async () => {
    await writeProject();
    const r = await researchAppend({
      projectPath: dir,
      section: "known_holdings",
      op: "append",
      entry: { holding_type: "document", description: "Family bible", confidence: "confident", promoted: false },
    });
    expect(r.ok && singleOk(r).entryId).toBe("kh_001");
    const kh = (await readResearch()).known_holdings[0];
    expect(kh.created).toMatch(/^\d{4}-\d{2}-\d{2}$/); // bare date
  });
});

describe("research_append (project singleton section)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "research-append-project-test-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  async function writeProject(research: any = baseResearch(), tree: any = baseTree) {
    await writeFile(join(dir, "research.json"), JSON.stringify(research, null, 2));
    await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify(tree, null, 2));
  }
  const readResearch = async () => JSON.parse(await readFile(join(dir, "research.json"), "utf-8"));

  it("updates project.status and stamps project.updated (bare date)", async () => {
    await writeProject();
    const r = await researchAppend({
      projectPath: dir,
      section: "project",
      op: "update",
      fields: { status: "completed" },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(singleOk(r).entryId).toBe("project"); // singleton echoes the section name
    expect(r.filesWritten).toEqual(["research.json"]);
    const research = await readResearch();
    expect(research.project.status).toBe("completed");
    expect(research.project.updated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("rejects op 'append' on the project singleton", async () => {
    await writeProject();
    const r = await researchAppend({
      projectPath: dir,
      section: "project",
      op: "append",
      entry: { status: "completed" },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/only op 'update'/);
  });

  it("creates researcher_profile on first write when the section is absent", async () => {
    // The seed never fabricates a profile — an observed run invented
    // "intermediate experience, no paid subscriptions" the user was never asked
    // for — so the object has to appear on the first REAL write. Without
    // createWhenAbsent the singleton branch throws "missing or not an object"
    // and the section stays writable by nothing.
    const r0 = baseResearch();
    expect((r0 as Record<string, unknown>).researcher_profile).toBeUndefined();
    await writeProject(r0);
    const r = await researchAppend({
      projectPath: dir,
      section: "researcher_profile",
      op: "update",
      fields: {
        experience_level: "professional",
        subscriptions: ["Ancestry"],
        narration_guidance: "Terse; assume GPS fluency.",
      },
    } as never);
    expect(r.ok).toBe(true);
    const research = await readResearch();
    expect(research.researcher_profile.experience_level).toBe("professional");
    expect(research.researcher_profile.narration_guidance).toBe("Terse; assume GPS fluency.");
  });

  it("lets a researcher correct their profile afterwards — it is not set-once", async () => {
    await writeProject();
    const first = await researchAppend({
      projectPath: dir,
      section: "researcher_profile",
      op: "update",
      fields: { experience_level: "novice" },
    } as never);
    expect(first.ok).toBe(true);
    const second = await researchAppend({
      projectPath: dir,
      section: "researcher_profile",
      op: "update",
      fields: { experience_level: "professional" },
    } as never);
    expect(second.ok).toBe(true);
    const research = await readResearch();
    expect(research.researcher_profile.experience_level).toBe("professional");
  });

  it("stamps no timestamp on researcher_profile", async () => {
    // Its schema is additionalProperties:false with no timestamp field, so a
    // stamp would fail validation on every write.
    await writeProject();
    const r = await researchAppend({
      projectPath: dir,
      section: "researcher_profile",
      op: "update",
      fields: { intended_audience: "family" },
    } as never);
    expect(r.ok).toBe(true);
    const research = await readResearch();
    expect(Object.keys(research.researcher_profile)).toEqual(["intended_audience"]);
  });

  it("rejects a field that is on no allow-list at all (e.g. created)", async () => {
    await writeProject();
    const r = await researchAppend({
      projectPath: dir,
      section: "project",
      op: "update",
      fields: { created: "2020-01-01" },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/not updatable on 'project'/);
  });

  it("sets objective, title and subject_person_ids once on a fresh project", async () => {
    // The whole point of the widening: init-project holds no writer tool today
    // and creates the project with a bare `Write`, which the lockdown denies.
    const r0 = baseResearch();
    r0.project = { ...r0.project, objective: "", subject_person_ids: [] };
    delete (r0.project as Record<string, unknown>).title;
    await writeProject(r0);
    const r = await researchAppend({
      projectPath: dir,
      section: "project",
      op: "update",
      fields: {
        objective: "Identify the parents of John Smith",
        title: "Smith parentage",
        subject_person_ids: ["I1"],
      },
    } as never);
    expect(r.ok).toBe(true);
    const research = await readResearch();
    expect(research.project.objective).toBe("Identify the parents of John Smith");
    expect(research.project.title).toBe("Smith parentage");
    expect(research.project.subject_person_ids).toEqual(["I1"]);
  });

  it("treats an empty string and an empty array as unset, not as set", async () => {
    // `subject_person_ids` is seeded as `[]` rather than omitted, so a
    // truthiness test would have refused the very first legitimate write.
    const r0 = baseResearch();
    r0.project = { ...r0.project, objective: "   ", subject_person_ids: [] };
    await writeProject(r0);
    const r = await researchAppend({
      projectPath: dir,
      section: "project",
      op: "update",
      fields: { objective: "Real objective", subject_person_ids: ["I1"] },
    } as never);
    expect(r.ok).toBe(true);
  });

  it("still allows status through, which is not set-once", async () => {
    await writeProject();
    const r = await researchAppend({
      projectPath: dir,
      section: "project",
      op: "update",
      fields: { status: "paused" },
    } as never);
    expect(r.ok).toBe(true);
  });

  it("refuses to rewrite an objective that is already set", async () => {
    // `objective` moved onto allowedFields so init-project can write it once.
    // The refusal it now hits is the set-once one, not the not-allowed one —
    // the ownership declaration's stated harm is a skill REWRITING the goal
    // every later step plans against.
    await writeProject(); // baseResearch() seeds objective: "Test"
    const r = await researchAppend({
      projectPath: dir,
      section: "project",
      op: "update",
      fields: { objective: "rewritten" },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/already set on 'project' and not rewritable: objective/);
    const research = await readResearch();
    expect(research.project.objective).toBe("Test"); // nothing written
  });

  it("rejects an invalid status value (whole-project validation)", async () => {
    await writeProject();
    const r = await researchAppend({
      projectPath: dir,
      section: "project",
      op: "update",
      fields: { status: "done" },
    });
    expect(r.ok).toBe(false);
  });

  it("requires a fields object for a project update", async () => {
    await writeProject();
    const r = await researchAppend({ projectPath: dir, section: "project", op: "update" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/requires a .?fields/);
  });

  // ── Completed-gate: unresolved blocking conflicts refuse the transition ──
  // (wilkins-death-kentucky e2e finding: an agent logged an unresolved
  // identity conflict and completed the project anyway. The gate makes the
  // GPS Component 4 rule deterministic at the status transition.)

  const conflictBase = () => ({
    id: "c_001",
    conflict_type: "identity",
    // identity_question is the question's TEXT (schema: string|null), not a
    // boolean flag — issue #1001. An identity conflict carrying a non-empty
    // string here is what marks it "identity" for the completed-gate.
    identity_question: "Is the 1857 death certificate the same John Wilkins as the profile?",
    description: "Certificate birth year contradicts the profile by 43 years.",
    competing_assertion_ids: ["a_001", "a_002"],
    status: "unresolved",
    blocks_question_ids: [],
  });
  const withConflict = (conflict: any) => {
    const r = baseResearch();
    r.assertions.push(validAssertion("a_002"));
    (r.conflicts as any[]).push(conflict);
    return r;
  };
  const complete = () =>
    researchAppend({ projectPath: dir, section: "project", op: "update", fields: { status: "completed" } });

  it("refuses completed while an unresolved identity conflict exists (even with empty blocks_question_ids)", async () => {
    // #1001 regression: a string identity_question with empty blocks_question_ids
    // must still block. The old gate keyed on `identity_question === true`, so
    // this schema-valid (string) case slipped through.
    await writeProject(withConflict(conflictBase()));
    const r = await complete();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const msg = r.errors.join(" ");
    expect(msg).toMatch(/cannot set project\.status/);
    expect(msg).toMatch(/c_001/);
    expect(msg).toMatch(/conflict-resolution/);
    const research = await readResearch();
    expect(research.project.status).toBe("active"); // nothing written
  });

  it("refuses completed while an unresolved conflict blocks a question", async () => {
    await writeProject(withConflict({ ...conflictBase(), blocks_question_ids: ["q_001"] }));
    const r = await complete();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/unresolved blocking conflict/);
  });

  it("allows completed once the blocking conflict is resolved", async () => {
    await writeProject(
      withConflict({
        ...conflictBase(),
        status: "resolved",
        independence_analysis: "The two records have independent informants.",
        weighing_analysis: "The original register outweighs the derivative index.",
        resolution_rationale: "The 1857 candidate is a different person; link rejected.",
        preferred_assertion_id: "a_001",
      }),
    );
    const r = await complete();
    expect(r.ok).toBe(true);
  });

  it("allows completed when the blocking conflict is moot", async () => {
    await writeProject(
      withConflict({
        ...conflictBase(),
        status: "moot",
        resolution_rationale: "Superseded: the certificate was re-attributed to the correct person.",
      }),
    );
    const r = await complete();
    expect(r.ok).toBe(true);
  });

  it("allows completed with an unresolved but non-blocking conflict (fact-type, empty blocks)", async () => {
    await writeProject(
      withConflict({
        ...conflictBase(),
        conflict_type: "fact",
        disputed_attribute: "birth_date",
        // A fact conflict carries no identity question; null here is what keeps
        // the fixed identity predicate from treating it as blocking (#1001).
        identity_question: null,
        description: "Minor date variance between two censuses; does not bear on any open question.",
      }),
    );
    const r = await complete();
    expect(r.ok).toBe(true);
  });

  // ── Completed-gate: a conflict that names no question but disputes one's
  // evidence. 42 of the 75 conflicts in the committed e2e corpus carry neither
  // `identity_question` nor `blocks_question_ids`, so the two declared arms
  // above are blind to 56% of them; deriving the link from the disputed
  // assertions sees all 14 unresolved conflicts held by completed runs instead
  // of 5. Every fixture above is built from `validAssertion`, whose
  // `extracted_for_question_ids` is `[]`, which is why all five pass unchanged
  // after the widening and these three carry its only coverage.
  const derivedConflict = () => ({
    id: "c_001",
    conflict_type: "fact",
    disputed_attribute: "birth_date",
    // Both declared arms empty: this is the shape the gate could not see.
    identity_question: null,
    blocks_question_ids: [],
    description: "Two registrations give different birth years for the subject.",
    competing_assertion_ids: ["a_001", "a_002"],
    status: "unresolved",
  });
  /** `tiedTo` goes on the competing assertion `a_002`; `[]` is the pass case. */
  const withDerivedConflict = (tiedTo: string[]) => {
    const r = baseResearch();
    r.questions.push(validQuestion("q_001"));
    r.assertions.push({ ...validAssertion("a_002"), extracted_for_question_ids: tiedTo });
    (r.conflicts as any[]).push(derivedConflict());
    return r;
  };

  it("refuses completed while an unresolved conflict disputes a question-tied assertion", async () => {
    await writeProject(withDerivedConflict(["q_001"]));
    const r = await complete();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const msg = r.errors.join(" ");
    expect(msg).toMatch(/cannot set project\.status/);
    expect(msg).toMatch(/c_001/);
    // The refusal names WHY it fired: a derived link is inferred, so naming the
    // assertion and the question is what makes it actionable (ADR-0011).
    expect(msg).toMatch(/a_002/);
    expect(msg).toMatch(/q_001/);
    // And the shape that settles a conflict nobody can settle, since neither
    // 'resolved' nor 'moot' reads true for one that was weighed and deferred.
    expect(msg).toMatch(/preferred_assertion_id/);
    const research = await readResearch();
    expect(research.project.status).toBe("active"); // nothing written
  });

  it("allows completed when the unresolved conflict's competing assertions are tied to no question", async () => {
    await writeProject(withDerivedConflict([]));
    const r = await complete();
    expect(r.ok).toBe(true);
  });

  it("a batch cannot resolve its own derived-blocking conflict and complete", async () => {
    // The pre-call-snapshot arm, on a conflict only the derived arm sees. The
    // sibling test below covers this for a declared identity conflict; without
    // this one, widening the live arm alone would pass every existing test.
    await writeProject(withDerivedConflict(["q_001"]));
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        {
          section: "conflicts",
          op: "update",
          entryId: "c_001",
          fields: {
            status: "resolved",
            resolution_rationale: "The 1857 registration names a different child.",
            independence_analysis: "Sources are independent.",
            weighing_analysis: "The parish register is decisive.",
            preferred_assertion_id: "a_001",
          },
        },
        { section: "project", op: "update", fields: { status: "completed" } },
      ],
    } as never);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/c_001/);
    const research = await readResearch();
    expect(research.project.status).toBe("active");
  });

  // ── Completed-gate: the mentor verdict (issue #1490 phase 1) ──
  // Prose carried this rule since PR #811 ("verify BOTH gates, in order — do
  // not write completed until both hold"; #1029 touched the file but not that
  // row) and 29 of 128 completed runs in the committed e2e corpus reach
  // `completed` with at least one uncritiqued summary anyway — 23%, of which
  // 23 predate the prose. This is that rule at the write boundary.

  const resolvedQuestion = () => ({
    id: "q_001",
    question: "Who were the parents of John Smith?",
    rationale: "Objective-answering question.",
    selection_basis: "objective_decomposition",
    priority: "high",
    status: "resolved",
    depends_on: [],
    unblocks: [],
    created: "2026-01-01",
    resolved: "2026-01-02",
    resolution_assertion_ids: ["a_001"],
    exhaustive_declaration: { declared: false, log_entry_ids: [], stop_criteria: {} },
  });
  const summary = (id = "ps_001", questionId = "q_001") => ({
    id,
    question_id: questionId,
    tier: "proved",
    vehicle: "summary",
    shortfall: "none",
    supporting_assertion_ids: ["a_001"],
    resolved_conflict_ids: [],
    exhaustive_search_summary: "Every identified repository was searched.",
    narrative_markdown: "The evidence establishes the parentage.",
  });
  const critique = (targetId = "ps_001", extra: Record<string, unknown> = {}) => ({
    id: "ev_001",
    focus: "proof-critique",
    target_id: targetId,
    target_type: "proof_summary",
    verdict: "looks_solid",
    file_path: "evaluations/proof-critique-ps_001.json",
    timestamp: "2026-01-02T00:00:00Z",
    superseded_by: null,
    ...extra,
  });
  const withProof = (evaluations: Record<string, unknown>[] = []) => {
    const r = baseResearch();
    r.questions.push(resolvedQuestion());
    r.proof_summaries.push(summary());
    r.evaluations.push(...evaluations);
    return r;
  };

  // ── questions: `resolved` requires a proof summary ──
  // `status: "resolved"` is the orchestrator's stop condition and was a free
  // write — neither proof-conclusion nor question-selection claims it, and it
  // landed from 11 different skill contexts across the corpus. Measured cost of
  // this gate: 0 refusals across all 150 questions that ever reached resolved.

  it("refuses status resolved when no proof summary references the question", async () => {
    const r0 = baseResearch();
    r0.questions.push({ ...resolvedQuestion(), status: "open", resolved: null });
    await writeProject(r0);
    const r = await researchAppend({
      projectPath: dir,
      section: "questions",
      op: "update",
      entryId: "q_001",
      fields: { status: "resolved" },
    } as never);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const msg = r.errors.join(" ");
    expect(msg).toMatch(/q_001/);
    expect(msg).toMatch(/proof-conclusion/);
    const research = await readResearch();
    expect(research.questions[0].status).toBe("open"); // nothing written
  });

  it("refuses the `resolved` DATE with no summary, not just the status", async () => {
    // The two fields are one transition. Gating only `status` left the date as
    // an ungated synonym, so an agent refused above could reach the same state
    // by writing the date instead — and `project_context` would then report the
    // question resolved while this gate had never seen it.
    const r0 = baseResearch();
    r0.questions.push({ ...resolvedQuestion(), status: "open", resolved: null });
    await writeProject(r0);
    const r = await researchAppend({
      projectPath: dir,
      section: "questions",
      op: "update",
      entryId: "q_001",
      fields: { resolved: "2026-01-02" },
    } as never);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/q_001/);
    const research = await readResearch();
    expect(research.questions[0].resolved).toBe(null); // nothing written
  });

  it("allows status resolved once a summary references it", async () => {
    const r0 = baseResearch();
    r0.questions.push({ ...resolvedQuestion(), status: "open", resolved: null });
    r0.proof_summaries.push(summary());
    await writeProject(r0);
    const r = await researchAppend({
      projectPath: dir,
      section: "questions",
      op: "update",
      entryId: "q_001",
      fields: { status: "resolved" },
    } as never);
    expect(r.ok).toBe(true);
  });

  it("allows the summary and the resolve in ONE batch, summary first", async () => {
    // Reads live state on purpose: the summary and the resolve are two halves of
    // one author's conclusion, unlike the mentor verdict which must come from a
    // different actor. 7 of 154 corpus resolve-calls do exactly this, all with
    // the summary ordered first — a pre-call snapshot would refuse all 7.
    const r0 = baseResearch();
    r0.questions.push({ ...resolvedQuestion(), status: "open", resolved: null });
    await writeProject(r0);
    // tier `possible` — a proved/probable summary additionally requires a prior
    // exhaustive declaration, which is a different invariant than the one under
    // test and would mask it.
    // `possible` reached no conclusive answer, so it owes a real shortfall —
    // the helper's `none` belongs to its default `proved` tier.
    const { id: _id, ...summaryEntry } = {
      ...summary(),
      tier: "possible",
      shortfall: "gap",
    };
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        { section: "proof_summaries", op: "append", entry: summaryEntry as never },
        { section: "questions", op: "update", entryId: "q_001", fields: { status: "resolved" } },
      ],
    } as never);
    expect(r.ok).toBe(true);
  });

  it("does not re-trigger on an unrelated update to an already-resolved question", async () => {
    // The op must be the one SETTING status, or every later edit to a resolved
    // question re-runs the gate — the same discipline the tier invariant uses.
    const r0 = baseResearch();
    r0.questions.push(resolvedQuestion());
    r0.proof_summaries.push(summary());
    await writeProject(r0);
    const r = await researchAppend({
      projectPath: dir,
      section: "questions",
      op: "update",
      entryId: "q_001",
      fields: { rationale: "Clarified after review." },
    } as never);
    expect(r.ok).toBe(true);
  });

  it("a batch cannot resolve its own blocking conflict and complete", async () => {
    // The conflict gate used to read `research.conflicts` LIVE, and applyOne
    // mutates in place per op — so one batch could settle the conflict and
    // complete in the same call. Same defect the mentor gate's snapshot avoids.
    await writeProject(withConflict(conflictBase()));
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        {
          section: "conflicts",
          op: "update",
          entryId: "c_001",
          fields: {
            status: "resolved",
            resolution_rationale: "The certificate names a different man.",
            independence_analysis: "Sources are independent.",
            weighing_analysis: "The parish register is decisive.",
            preferred_assertion_id: "a_001",
          },
        },
        { section: "project", op: "update", fields: { status: "completed" } },
      ],
    } as never);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/c_001/);
    const research = await readResearch();
    expect(research.project.status).toBe("active");
  });

  it("refuses completed when a resolved question's proof summary has no mentor verdict", async () => {
    await writeProject(withProof());
    const r = await complete();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const msg = r.errors.join(" ");
    expect(msg).toMatch(/cannot set project\.status/);
    expect(msg).toMatch(/ps_001/);
    expect(msg).toMatch(/proof-critique/);
    const research = await readResearch();
    expect(research.project.status).toBe("active"); // nothing written
  });

  it("allows completed once the summary carries a proof-critique verdict", async () => {
    await writeProject(withProof([critique()]));
    const r = await complete();
    expect(r.ok).toBe(true);
  });

  // ── Completed-gate: the tree-encoding WARNING (issue #1490 phase 2) ──
  // A tier->=-probable conclusion is expected to leave a fact or relationship on
  // the tree. This warns — never refuses (2026-08-24 no-override ruling) — when a
  // completed project holds one whose evidence persons gained nothing since the
  // starting-tree.gedcomx.json baseline. Fires only on the completing call.

  const writeBaseline = async (tree: any) =>
    writeFile(join(dir, "starting-tree.gedcomx.json"), JSON.stringify(tree, null, 2));
  const withEvidence = (research: any) => {
    research.person_evidence.push({
      id: "pe_001", assertion_id: "a_001", person_id: "I1",
      confidence: "confident", match_score: 0.9, rationale: "match", created: "2026-01-02", superseded_by: null,
    });
    return research;
  };

  it("warns on completion when a probable conclusion added no tree structure (#1490)", async () => {
    // Baseline == current tree, so I1 (linked to the summary via a_001) gained
    // nothing this session — the conclusion was reached and left un-encoded.
    await writeProject(withEvidence(withProof([critique()])), baseTree);
    await writeBaseline(baseTree);
    const r = await complete();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const w = r.validation.warnings.join(" ");
    expect(w).toMatch(/ps_001/);
    expect(w).toMatch(/no tree person it draws evidence from/);
  });

  it("is silent when the conclusion's person gained a tree fact (#1490)", async () => {
    // The current tree adds a Birth fact for I1 that the baseline lacked, so the
    // conclusion is encoded and no warning fires.
    const current = {
      ...baseTree,
      persons: [
        {
          id: "I1", gender: "Male", names: [{ id: "N1", given: "John", surname: "Smith" }],
          facts: [{ id: "f1", type: "Birth", date: "1850", standard_date: "+1850" }],
        },
      ],
    };
    await writeProject(withEvidence(withProof([critique()])), current);
    await writeBaseline(baseTree);
    const r = await complete();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.validation.warnings.join(" ")).not.toMatch(/no tree person it draws evidence from/);
  });

  it("does not warn when the project predates the baseline (fail-open) (#1490)", async () => {
    // No starting-tree.gedcomx.json on disk — a legacy project. The check must
    // fail open (no warning), never treat every fact as new.
    await writeProject(withEvidence(withProof([critique()])), baseTree);
    const r = await complete();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.validation.warnings.join(" ")).not.toMatch(/no tree person it draws evidence from/);
  });

  it("does not count a superseded verdict", async () => {
    // If a newer verdict replaced it, that one is itself in evaluations[] and
    // satisfies the gate. If nothing replaced it, the critique no longer stands.
    await writeProject(withProof([critique("ps_001", { superseded_by: "ev_002" })]));
    const r = await complete();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/ps_001/);
  });

  it("a batch cannot satisfy its own precondition", async () => {
    // The critique set is snapshotted before any op applies, so appending the
    // verdict and completing in one call must still refuse. Read live, the gate
    // would grade its own homework.
    await writeProject(withProof());
    // The tool assigns entry ids, so an append entry must not carry one.
    const { id: _id, ...critiqueEntry } = critique();
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        { section: "evaluations", op: "append", entry: critiqueEntry as never },
        { section: "project", op: "update", fields: { status: "completed" } },
      ],
    } as never);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/ps_001/);
    const research = await readResearch();
    expect(research.project.status).toBe("active");
  });

  it("a resolved question with no proof summary passes vacuously, on seeded state", async () => {
    // Still deliberate, but the state is now reachable only by seeding it:
    // questionResolvedInvariants refuses the transition through the tool. What
    // this pins is that an already-seeded document still LOADS and completes —
    // a gate on a transition must not retroactively invalidate documents that
    // predate it.
    const r0 = baseResearch();
    r0.questions.push({ ...resolvedQuestion(), resolution_assertion_ids: [] });
    await writeProject(r0);
    const r = await complete();
    expect(r.ok).toBe(true);
  });

  it("counts a question resolved by DATE alone toward the critique requirement", async () => {
    // `resolved` is an ISO date or null, so the old `=== true` never matched and
    // a date-resolved question's summary escaped the mentor gate entirely.
    // `question-state.ts` has always read this field as truthy-or-not, so the
    // two disagreed about the same question.
    const r0 = baseResearch();
    r0.questions.push({ ...resolvedQuestion(), status: "exhaustive_declared" });
    r0.proof_summaries.push(summary());
    await writeProject(r0);
    const r = await complete();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/ps_001/);
  });

  it("ignores a summary whose question is not resolved", async () => {
    const r0 = baseResearch();
    r0.questions.push({ ...resolvedQuestion(), status: "open", resolved: null });
    r0.proof_summaries.push(summary());
    await writeProject(r0);
    const r = await complete();
    expect(r.ok).toBe(true);
  });
});

// ─── Batch ops ───────────────────────────────────────────────────────────────

const noId = (o: any) => {
  const { id: _omit, ...rest } = o;
  return rest;
};

describe("research_append (batch ops)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "research-append-batch-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  async function writeProject(research: any = baseResearch(), tree: any = baseTree) {
    await writeFile(join(dir, "research.json"), JSON.stringify(research, null, 2));
    await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify(tree, null, 2));
  }
  const readResearch = async () => JSON.parse(await readFile(join(dir, "research.json"), "utf-8"));

  it("(a/c) applies a homogeneous batch, returns ordered ids, sequences intra-batch", async () => {
    await writeProject(); // seeded with sources [src_001]
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        { section: "sources", op: "append", entry: noId(validSource("x")) },
        { section: "sources", op: "append", entry: noId(validSource("y")) },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok || !("results" in r)) return;
    expect(r.results.map((x) => x.entryId)).toEqual(["src_002", "src_003"]); // op #2 sees op #1's append
    expect(r.filesWritten).toEqual(["research.json"]);
    expect((await readResearch()).sources.map((s: any) => s.id)).toEqual(["src_001", "src_002", "src_003"]);
  });

  it("(d) applies a heterogeneous record in one write; assertion references a source from the same batch", async () => {
    await writeProject();
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        { section: "sources", op: "append", entry: noId(validSource("x")) }, // → src_002
        { section: "assertions", op: "append", entry: noId(validAssertion("x", "src_002")) }, // forward ref to op #0
        { section: "assertions", op: "append", entry: noId(validAssertion("y", "src_002")) },
        {
          section: "person_evidence",
          op: "append",
          entry: { assertion_id: "a_002", person_id: "I1", confidence: "confident", rationale: "match", superseded_by: null },
        },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok || !("results" in r)) return;
    expect(r.results.map((x) => `${x.section}:${x.entryId}`)).toEqual([
      "sources:src_002",
      "assertions:a_002",
      "assertions:a_003",
      "person_evidence:pe_001",
    ]);
    const research = await readResearch();
    expect(research.sources).toHaveLength(2);
    expect(research.assertions.map((a: any) => a.id)).toEqual(["a_001", "a_002", "a_003"]);
    expect(research.assertions[1].source_id).toBe("src_002"); // intra-batch forward ref persisted + validated
    expect(research.person_evidence).toHaveLength(1);
  });

  it("(d2) appends a plan + its items in one batch, referencing the predicted plan id pl_001", async () => {
    const research = baseResearch();
    research.questions = [validQuestion("q_001")];
    await writeProject(research);
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        { section: "plans", op: "append", entry: noId(validPlan("x", "q_001", "active")) }, // → pl_001
        { section: "plan_items", op: "append", entry: validPlanItem(), planId: "pl_001" }, // → pli_001
        { section: "plan_items", op: "append", entry: validPlanItem(), planId: "pl_001" }, // → pli_002
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok || !("results" in r)) return;
    expect(r.results.map((x) => x.entryId)).toEqual(["pl_001", "pli_001", "pli_002"]);
    const out = await readResearch();
    expect(out.plans[0].id).toBe("pl_001");
    expect(out.plans[0].items.map((i: any) => i.id)).toEqual(["pli_001", "pli_002"]);
  });

  it("(d2-misroute) names the wrong planId when the created plan ends empty — writes nothing", async () => {
    // The observed corruption: nine plan_items ops carrying a hard-coded
    // `planId: "pl_001"` appended themselves to a pre-existing COMPLETED plan
    // for another question, and the plan the same batch created ended with no
    // items. "missing required field 'items'" named the symptom, and the retry
    // answered it with `"items": []` — which used to validate.
    const research = baseResearch();
    research.questions = [validQuestion("q_001"), validQuestion("q_002")];
    research.plans = [
      { ...validPlan("pl_001", "q_002", "completed", [seededPlanItem("pli_001")]) },
    ] as any;
    await writeProject(research);
    const before = await readFile(join(dir, "research.json"), "utf-8");

    const r = await researchAppend({
      projectPath: dir,
      ops: [
        { section: "plans", op: "append", entry: noId(validPlan("x", "q_001", "active")) }, // → pl_002
        { section: "plan_items", op: "append", entry: validPlanItem(), planId: "pl_001" }, // wrong plan
        { section: "plan_items", op: "append", entry: validPlanItem(), planId: "pl_001" },
      ],
    });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    // Read the ERROR, not the joined list: the worked example is appended to it
    // and legitimately contains the id-prediction rule, so a negative
    // assertion over the join would be satisfied by the hint.
    const msg = r.errors[0];
    // The distinctive half is the CAUSE. "is empty" alone is what sent the
    // model round the loop, so a refusal that only says that fails this test.
    expect(msg).toMatch(/plan 'pl_002' was created for question 'q_001' and ends this call with no items/);
    expect(msg).toMatch(/the items went to a plan this call did not create/);
    expect(msg).toMatch(/'pl_001' \(completed plan for q_002\)/);
    expect(msg).toMatch(/which is 'pl_002' for this one/);
    expect(msg).toMatch(/Never a hard-coded 'pl_001'/);
    // Blamed on the plans append op, and the hint teaches the batched shape.
    expect(msg).toMatch(/^ops\[0\]:/);
    expect(r.errors.join(" ")).toContain("worked example for 'plans'");
    expect(await readFile(join(dir, "research.json"), "utf-8")).toBe(before);
  });

  it("(d2-misroute) stays silent when the batch fills the plan it created AND an existing one", async () => {
    // The narrowing that keeps this from being a new deny on a legitimate
    // shape: a batch may add an item to another plan, so long as the plan it
    // created is not left empty.
    const research = baseResearch();
    research.questions = [validQuestion("q_001"), validQuestion("q_002")];
    research.plans = [
      { ...validPlan("pl_001", "q_002", "active", [seededPlanItem("pli_001")]) },
    ] as any;
    await writeProject(research);

    const r = await researchAppend({
      projectPath: dir,
      ops: [
        { section: "plans", op: "append", entry: noId(validPlan("x", "q_001", "active")) }, // → pl_002
        { section: "plan_items", op: "append", entry: validPlanItem(), planId: "pl_002" }, // the new plan
        { section: "plan_items", op: "append", entry: validPlanItem(), planId: "pl_001" }, // an existing one
      ],
    });

    expect(errorsOf(r) ?? []).toEqual([]);
    expect(r.ok).toBe(true);
    const out = await readResearch();
    expect(out.plans.find((pl: any) => pl.id === "pl_002").items).toHaveLength(1);
    expect(out.plans.find((pl: any) => pl.id === "pl_001").items).toHaveLength(2);
  });

  it("(d2-misroute) falls through to the document validator when the batch names no other plan", async () => {
    // No plan_items op at all: there is no misroute to name, so the refusal is
    // the document-level one. This is the boundary between the two messages.
    const research = baseResearch();
    research.questions = [validQuestion("q_001")];
    await writeProject(research);
    const before = await readFile(join(dir, "research.json"), "utf-8");

    const r = await researchAppend({
      projectPath: dir,
      ops: [{ section: "plans", op: "append", entry: noId(validPlan("x", "q_001", "active", [])) }],
    });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    const joined = r.errors.join(" ");
    expect(joined).toMatch(/is empty — a plan carries at least one plan item/);
    // Anchored on a substring the CAUSE message actually contains. The first
    // draft asserted /the items went to a different plan/, which round 2's
    // rewrite had already replaced — the string existed nowhere in src, so this
    // half of the boundary could not fail.
    expect(joined).not.toMatch(/ends this call with no items/);
    expect(await readFile(join(dir, "research.json"), "utf-8")).toBe(before);
  });

  it("(d2-misroute) a call creating TWO plans and feeding one names the sibling, not a misroute", async () => {
    // Two plans in one call, item ops naming only the second. The items did NOT
    // go to "a different plan" in the hard-coded-pl_001 sense — they went to a
    // plan this same call created. Prescribing the misroute fix here ("put
    // pl_002 on every item op") would empty the sibling and reproduce the loop
    // with the two plans swapped.
    //
    // Provenance, stated exactly: TWO-PLANS-IN-ONE-CALL is a corpus shape
    // (laurie-scotland-parents run-2026-07-15_14-44-20 issues two such calls),
    // but those carry inline non-empty `items` and no `plan_items` ops, so they
    // return early here. This exact combination — two created plans, one left
    // empty, items supplied by op — has ZERO corpus instances. It is guarded
    // because the message was wrong for it, not because it has been observed.
    const research = baseResearch();
    research.questions = [validQuestion("q_001"), validQuestion("q_002")];
    await writeProject(research);
    const before = await readFile(join(dir, "research.json"), "utf-8");

    const r = await researchAppend({
      projectPath: dir,
      ops: [
        { section: "plans", op: "append", entry: noId(validPlan("x", "q_001", "active")) }, // → pl_001, left empty
        { section: "plans", op: "append", entry: noId(validPlan("y", "q_002", "active")) }, // → pl_002
        { section: "plan_items", op: "append", entry: validPlanItem(), planId: "pl_002" },
      ],
    });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    const msg = r.errors[0]; // not the join — the worked example rides along
    expect(msg).toMatch(/plan 'pl_001' was created for question 'q_001' and ends this call with no items/);
    expect(msg).toMatch(/named only 'pl_002', which this same call also created/);
    expect(msg).toMatch(/which is 'pl_001' for this one/);
    // The wrong prescription, and the id arithmetic that is wrong for a second plan.
    expect(msg).not.toMatch(/the items went to a plan this call did not create/);
    expect(msg).not.toMatch(/highest existing pl_/);
    expect(msg).toMatch(/^ops\[0\]:/); // blamed on the empty plan's own op
    expect(await readFile(join(dir, "research.json"), "utf-8")).toBe(before);
  });

  it("(d2-misroute) ignores a plan_items UPDATE op — it is not a misdirected item", async () => {
    // An update targets an item that already lives in the plan it names, so it
    // is not an item that went astray, and "re-issue with planId pl_002" would
    // fail on a missing entryId. Only appends can misroute.
    const research = baseResearch();
    research.questions = [validQuestion("q_001"), validQuestion("q_002")];
    research.plans = [
      { ...validPlan("pl_001", "q_002", "active", [seededPlanItem("pli_001")]) },
    ] as any;
    await writeProject(research);

    const r = await researchAppend({
      projectPath: dir,
      ops: [
        { section: "plans", op: "append", entry: noId(validPlan("x", "q_001", "active", [])) }, // → pl_002, empty
        { section: "plan_items", op: "update", planId: "pl_001", entryId: "pli_001", fields: { status: "searched" } },
      ],
    });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    const joined = r.errors.join(" ");
    // Falls through to the document check, which is the honest verdict here.
    expect(joined).toMatch(/is empty — a plan carries at least one plan item/);
    expect(joined).not.toMatch(/ends this call with no items/);
  });

  it("repairs a legacy empty plan: appending an item to it is allowed and clears the error", async () => {
    // The escape hatch the refusal prescribes, on a project that already holds
    // an empty plan — the state issue #2051 says production persisted. The
    // pre-existing error is demoted, so the repair write is not blocked by the
    // very rule it satisfies. Without this the rule would be a trap: the
    // document reports invalid and no write can fix it.
    const research = baseResearch();
    research.questions = [validQuestion("q_001")];
    research.plans = [{ ...validPlan("pl_001", "q_001", "active", []) }] as any;
    await writeProject(research);

    const r = await researchAppend({
      projectPath: dir,
      section: "plan_items",
      op: "append",
      planId: "pl_001",
      entry: validPlanItem(),
    });

    expect(errorsOf(r) ?? []).toEqual([]);
    expect(r.ok).toBe(true);
    const out = await readResearch();
    expect(out.plans[0].items).toHaveLength(1);
    // And the document is clean afterwards, not merely written.
    const check = await validateProject(dir);
    expect(check.errors.filter((e: any) => e.path.includes("plans[0]/items"))).toEqual([]);
  });

  it("(d2-misroute) two created plans BOTH left empty get a per-plan prescription, not two contradictory ones", async () => {
    // Each plan's own message used to say "put MY id on every item op", so
    // following either emptied the other and reproduced the loop with the two
    // plans swapped. With more than one created plan ending empty there is no
    // single id to add, and the message must say that instead of naming one.
    const research = baseResearch();
    research.questions = [validQuestion("q_001"), validQuestion("q_002")];
    research.plans = [
      { ...validPlan("pl_001", "q_002", "completed", [seededPlanItem("pli_001")]) },
    ] as any;
    await writeProject(research);

    const r = await researchAppend({
      projectPath: dir,
      ops: [
        { section: "plans", op: "append", entry: noId(validPlan("x", "q_001", "active")) }, // → pl_002, empty
        { section: "plans", op: "append", entry: { ...noId(validPlan("y", "q_002", "active")), question_id: "q_002" } as any }, // → pl_003, empty
        { section: "plan_items", op: "append", entry: validPlanItem(), planId: "pl_001" },
      ],
    });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    const joined = r.errors.join(" ");
    expect(joined).toMatch(/2 of the plans this call created \(pl_002, pl_003\) end it with no items/);
    expect(joined).toMatch(/give each plan_items op the id of the plan ITS item belongs to/);
    // The contradiction: neither message may prescribe a single id.
    expect(joined).not.toMatch(/which is 'pl_002' for this one/);
    expect(joined).not.toMatch(/which is 'pl_003' for this one/);
  });

  it("(d2-misroute) does not blame pl_001 when the caller never wrote it", async () => {
    // The tail clauses were unconditional: a caller who wrote 'pl_007' was told
    // never to hard-code 'pl_001', a string absent from its own call.
    const research = baseResearch();
    research.questions = [validQuestion("q_001"), validQuestion("q_002")];
    research.plans = [
      { ...validPlan("pl_001", "q_002", "completed", [seededPlanItem("pli_001")]) },
      { ...validPlan("pl_002", "q_002", "completed", [seededPlanItem("pli_002")]) },
    ] as any;
    await writeProject(research);

    const r = await researchAppend({
      projectPath: dir,
      ops: [
        { section: "plans", op: "append", entry: noId(validPlan("x", "q_001", "active")) }, // → pl_003
        { section: "plan_items", op: "append", entry: validPlanItem(), planId: "pl_002" },
      ],
    });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    const msg = r.errors[0];
    expect(msg).toMatch(/wrote into 'pl_002' \(completed plan for q_002\)/);
    expect(msg).not.toMatch(/pl_001/); // never named a plan the caller did not write
    expect(msg).toMatch(/belongs to a different question/);
  });

  it("(d2-misroute) does not call a SAME-question plan another question's", async () => {
    // The other unconditional clause: a superseded plan for the same question
    // was described as "another question's plan" in the same sentence that
    // correctly printed its question id.
    const research = baseResearch();
    research.questions = [validQuestion("q_001")];
    research.plans = [
      { ...validPlan("pl_001", "q_001", "superseded", [seededPlanItem("pli_001")]) },
    ] as any;
    await writeProject(research);

    const r = await researchAppend({
      projectPath: dir,
      ops: [
        { section: "plans", op: "append", entry: noId(validPlan("x", "q_001", "active")) }, // → pl_002
        { section: "plan_items", op: "append", entry: validPlanItem(), planId: "pl_001" },
      ],
    });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    const msg = r.errors[0];
    expect(msg).toMatch(/wrote into 'pl_001' \(superseded plan for q_001\)/);
    expect(msg).not.toMatch(/different question/);
    expect(msg).not.toMatch(/another question/);
  });

  it("(d2-misroute) reports the EMPTY count, not the created count", async () => {
    // The first draft rendered emptyCreated.length as "This call created N
    // plans", so three created plans with two left empty read "created 2".
    const research = baseResearch();
    research.questions = [validQuestion("q_001"), validQuestion("q_002"), validQuestion("q_003")];
    await writeProject(research);

    const r = await researchAppend({
      projectPath: dir,
      ops: [
        { section: "plans", op: "append", entry: noId(validPlan("a", "q_001", "active")) }, // → pl_001, empty
        { section: "plans", op: "append", entry: { ...noId(validPlan("b", "q_002", "active")), question_id: "q_002" } as any }, // → pl_002, empty
        { section: "plans", op: "append", entry: { ...noId(validPlan("c", "q_003", "active")), question_id: "q_003" } as any }, // → pl_003, filled
        { section: "plan_items", op: "append", entry: validPlanItem(), planId: "pl_003" },
      ],
    });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    const joined = r.errors.join(" ");
    expect(joined).toMatch(/2 of the plans this call created \(pl_001, pl_002\) end it with no items/);
    expect(joined).not.toMatch(/created 2 plans/); // the miscount
  });

  it("(d2-misroute) does not call a MIXED target list all-different-question", async () => {
    // One same-question and one different-question target. A `.some()` gate
    // printed a singular "it belongs to a different question" over both.
    const research = baseResearch();
    research.questions = [validQuestion("q_001"), validQuestion("q_002")];
    research.plans = [
      { ...validPlan("pl_001", "q_002", "completed", [seededPlanItem("pli_001")]) },
      { ...validPlan("pl_002", "q_001", "superseded", [seededPlanItem("pli_002")]) },
    ] as any;
    await writeProject(research);

    const r = await researchAppend({
      projectPath: dir,
      ops: [
        { section: "plans", op: "append", entry: noId(validPlan("x", "q_001", "active")) }, // → pl_003 for q_001
        { section: "plan_items", op: "append", entry: validPlanItem(), planId: "pl_001" }, // q_002
        { section: "plan_items", op: "append", entry: validPlanItem(), planId: "pl_002" }, // q_001, SAME question
      ],
    });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    const msg = r.errors[0];
    expect(msg).toMatch(/wrote into 'pl_001' \(completed plan for q_002\), 'pl_002' \(superseded plan for q_001\)/);
    expect(msg).not.toMatch(/different question/); // not all of them are
    expect(msg).not.toMatch(/None of them belongs to this question/);
  });

  it("(d2-misroute) reports the cause AND every other document error in the batch", async () => {
    // The limitation a reviewer asked me to file: the early return meant a
    // batch carrying a misroute plus an unrelated document error reported only
    // the misroute, so the caller needed a second round trip to see the rest.
    // Fixed rather than filed, because the misroute set is a strict subset of
    // the validation-failing set, so merging the lists needs no reordering.
    const research = baseResearch();
    research.questions = [validQuestion("q_001"), validQuestion("q_002")];
    research.plans = [
      { ...validPlan("pl_001", "q_002", "completed", [seededPlanItem("pli_001")]) },
    ] as any;
    await writeProject(research);
    const before = await readFile(join(dir, "research.json"), "utf-8");

    const r = await researchAppend({
      projectPath: dir,
      ops: [
        { section: "plans", op: "append", entry: noId(validPlan("x", "q_001", "active")) }, // → pl_002, left empty
        { section: "plan_items", op: "append", entry: validPlanItem(), planId: "pl_001" },  // misroute
        // An unrelated document-level error, in the same batch.
        {
          section: "hypotheses",
          op: "append",
          entry: {
            claim: "Same man",
            status: "NOT_A_STATUS",
            supporting_assertion_ids: [],
            contradicting_assertion_ids: [],
            ruled_out: false,
            ruled_out_reason: null,
            notes: null,
            related_question_ids: [],
          },
        } as any,
      ],
    });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    const joined = r.errors.join(" ");
    // BOTH, not one: the cause first, the document error still present.
    expect(joined).toMatch(/ends this call with no items/);
    expect(joined).toMatch(/hypothesis_status|NOT_A_STATUS/);
    // And the cause still leads, because it names what to change.
    expect(r.errors[0]).toMatch(/ends this call with no items/);
    expect(await readFile(join(dir, "research.json"), "utf-8")).toBe(before);
  });

  it("(d2-misroute) leaves a NON-ARRAY items to its own type error", async () => {
    // The misroute diagnosis says the plan "ends this call with no items". For
    // `items: "none"` that describes the document wrongly — it ends the call
    // with a string, which has its own error. Added when the fix for the
    // two-plan case was reviewed: the fix is a code change and can shift a
    // boundary of its own.
    const research = baseResearch();
    research.questions = [validQuestion("q_001"), validQuestion("q_002")];
    research.plans = [
      { ...validPlan("pl_001", "q_002", "completed", [seededPlanItem("pli_001")]) },
    ] as any;
    await writeProject(research);
    const before = await readFile(join(dir, "research.json"), "utf-8");

    const r = await researchAppend({
      projectPath: dir,
      ops: [
        { section: "plans", op: "append", entry: { ...noId(validPlan("x", "q_001", "active")), items: "none" } as any },
        { section: "plan_items", op: "append", entry: validPlanItem(), planId: "pl_001" },
      ],
    });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    const joined = r.errors.join(" ");
    expect(joined).toMatch(/must be an array of plan items — got string/);
    expect(joined).not.toMatch(/ends this call with no items/);
    expect(await readFile(join(dir, "research.json"), "utf-8")).toBe(before);
  });

  it("(d2-misroute) still names the cause when items is NULL", async () => {
    // `items: null` genuinely does end the call with no items, so the cause
    // diagnosis is right there — the boundary above is the non-array case only.
    const research = baseResearch();
    research.questions = [validQuestion("q_001"), validQuestion("q_002")];
    research.plans = [
      { ...validPlan("pl_001", "q_002", "completed", [seededPlanItem("pli_001")]) },
    ] as any;
    await writeProject(research);

    const r = await researchAppend({
      projectPath: dir,
      ops: [
        { section: "plans", op: "append", entry: { ...noId(validPlan("x", "q_001", "active")), items: null } as any },
        { section: "plan_items", op: "append", entry: validPlanItem(), planId: "pl_001" },
      ],
    });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toMatch(/ends this call with no items/);
    expect(r.errors[0]).toMatch(/the items went to a plan this call did not create/);
  });

  it("does not CRASH on a legacy plans: [null] neighbour", async () => {
    // The writer half of the crash the validator arm fixes. `plans: [null]`
    // made planActiveInvariants throw `Cannot read properties of null`, so
    // research_append died on exactly the shape validate_research_schema now
    // reports cleanly. The stray element is pre-existing drift, so the write
    // itself must go through.
    const research = baseResearch();
    research.questions = [validQuestion("q_001")];
    research.plans = [null] as any;
    await writeProject(research);

    const r = await researchAppend({
      projectPath: dir,
      ops: [
        { section: "plans", op: "append", entry: noId(validPlan("x", "q_001", "active", [seededPlanItem()])) },
      ],
    });

    expect(errorsOf(r) ?? []).toEqual([]);
    expect(r.ok).toBe(true);
    const out = await readResearch();
    expect(out.plans[1].id).toBe("pl_001");
  });

  it("(b) rolls back the whole batch on a mid-batch validation failure — writes nothing", async () => {
    await writeProject();
    const before = await readFile(join(dir, "research.json"), "utf-8");
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        { section: "sources", op: "append", entry: noId(validSource("x")) }, // valid on its own
        { section: "assertions", op: "append", entry: noId(validAssertion("y", "src_999")) }, // dangling → whole-project validation fails
      ],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    // mapValidationErrors remaps the whole-doc validation error onto the op that induced it
    expect(r.errors.some((e) => e.startsWith("ops[1]:"))).toBe(true);
    expect(await readFile(join(dir, "research.json"), "utf-8")).toBe(before); // including the valid op #0
  });

  it("(b2) indexes a per-op precondition failure as ops[i] and writes nothing", async () => {
    await writeProject();
    const before = await readFile(join(dir, "research.json"), "utf-8");
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        { section: "sources", op: "append", entry: noId(validSource("x")) }, // op 0 ok
        { section: "assertions", op: "append", entry: validAssertion("z", "src_001") }, // op 1 carries an id → throws
      ],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toMatch(/^ops\[1\]:/);
    expect(r.errors.join(" ")).toMatch(/must not carry an id/);
    expect(await readFile(join(dir, "research.json"), "utf-8")).toBe(before);
  });

  it("(b3) enforces section invariants across the batch (second active plan → ops[1])", async () => {
    const research = baseResearch();
    research.questions = [validQuestion("q_001")];
    await writeProject(research);
    const before = await readFile(join(dir, "research.json"), "utf-8");
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        { section: "plans", op: "append", entry: noId(validPlan("x", "q_001", "active")) },
        { section: "plans", op: "append", entry: noId(validPlan("y", "q_001", "active")) }, // same question, second active plan
      ],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toMatch(/^ops\[1\]:.*already has an active plan/);
    expect(await readFile(join(dir, "research.json"), "utf-8")).toBe(before);
  });

  it("rejects an empty ops array", async () => {
    await writeProject();
    const r = await researchAppend({ projectPath: dir, ops: [] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/non-empty/);
  });

  it("(d3) applies a project-singleton update inside a batch and writes once", async () => {
    await writeProject();
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        { section: "sources", op: "append", entry: noId(validSource("x")) },
        { section: "project", op: "update", fields: { status: "completed" } },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok || !("results" in r)) return;
    expect(r.results).toContainEqual({ section: "project", op: "update", entryId: "project" });
    expect(r.filesWritten).toEqual(["research.json"]);
    const research = await readResearch();
    expect(research.project.status).toBe("completed");
    expect(research.project.updated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(research.sources).toHaveLength(2);
  });

  it("(d3b) fails the whole batch on an invalid project status — writes nothing", async () => {
    await writeProject();
    const before = await readFile(join(dir, "research.json"), "utf-8");
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        { section: "sources", op: "append", entry: noId(validSource("x")) }, // valid op #0
        { section: "project", op: "update", fields: { status: "done" } }, // invalid enum → whole batch fails
      ],
    });
    expect(r.ok).toBe(false);
    expect(await readFile(join(dir, "research.json"), "utf-8")).toBe(before);
  });

  // ── String-coercion: the model sometimes serializes a large `ops` batch as a
  // JSON *string* (see coerce-json-arg.ts). The tool recovers it rather than
  // rejecting it and driving the model into slow one-op-per-call writes.
  it("(coerce) applies an ops batch that arrives as a JSON string", async () => {
    await writeProject(); // seeded with sources [src_001]
    const opsArray = [
      { section: "sources", op: "append", entry: noId(validSource("x")) },
      { section: "sources", op: "append", entry: noId(validSource("y")) },
    ];
    const r = await researchAppend({
      projectPath: dir,
      ops: JSON.stringify(opsArray) as any,
    });
    expect(r.ok).toBe(true);
    if (!r.ok || !("results" in r)) return;
    expect(r.results.map((x) => x.entryId)).toEqual(["src_002", "src_003"]);
    expect((await readResearch()).sources.map((s: any) => s.id)).toEqual(["src_001", "src_002", "src_003"]);
  });

  it("(coerce) recovers a stringified ops batch even with redundant top-level section/op (the observed record-extraction failure)", async () => {
    await writeProject();
    const opsArray = [
      { section: "sources", op: "append", entry: noId(validSource("x")) }, // → src_002
      { section: "assertions", op: "append", entry: noId(validAssertion("x", "src_002")) }, // forward ref
    ];
    // Exactly what Sonnet emitted: ops as a JSON string AND leftover top-level
    // section/op (ignored once ops is present).
    const r = await researchAppend({
      projectPath: dir,
      section: "sources",
      op: "append",
      ops: JSON.stringify(opsArray) as any,
    });
    expect(r.ok).toBe(true);
    if (!r.ok || !("results" in r)) return;
    expect(r.results.map((x) => `${x.section}:${x.entryId}`)).toEqual(["sources:src_002", "assertions:a_002"]);
    expect((await readResearch()).assertions[1].source_id).toBe("src_002");
  });

  it("(coerce) applies a single-op append whose entry arrives as a JSON string", async () => {
    await writeProject();
    const r = await researchAppend({
      projectPath: dir,
      section: "sources",
      op: "append",
      entry: JSON.stringify(noId(validSource("x"))) as any,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((await readResearch()).sources.map((s: any) => s.id)).toEqual(["src_001", "src_002"]);
  });

  it("(coerce) leaves a non-JSON ops string alone → the existing non-empty-array error, writes nothing", async () => {
    await writeProject();
    const before = await readFile(join(dir, "research.json"), "utf-8");
    const r = await researchAppend({
      projectPath: dir,
      ops: "not valid json" as any,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/non-empty/);
    expect(await readFile(join(dir, "research.json"), "utf-8")).toBe(before);
  });
});

// ─── Composite persist (D1) + enforcement (D2) + place guards ────────────────

describe("research_append (composite persist + enforcement)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "research-append-composite-"));
    vi.mocked(resolveStandardPlace).mockClear();
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writeProject(research: any = baseResearch(), tree: any = baseTree) {
    await writeFile(join(dir, "research.json"), JSON.stringify(research, null, 2));
    await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify(tree, null, 2));
  }
  const readResearch = async () => JSON.parse(await readFile(join(dir, "research.json"), "utf-8"));
  const readTree = async () => JSON.parse(await readFile(join(dir, "tree.gedcomx.json"), "utf-8"));
  const exists = async (rel: string) => access(join(dir, rel)).then(() => true, () => false);

  const searchLogEntry = (resultsRef: string | null) => ({
    id: "log_001",
    plan_item_id: null,
    performed: "2026-01-01T00:00:00Z",
    tool: "record_search",
    query: {},
    outcome: "positive",
    results_examined: 1,
    external_site: null,
    results_ref: resultsRef,
  });

  const sidecarRecord = () => ({
    recordId: "ark:/61903/1:1:ABCD-123",
    primaryId: "p_1",
    gedcomx: {
      persons: [
        {
          id: "p_1",
          facts: [
            {
              id: "F1",
              type: "Residence",
              place: "Pottsville, Pennsylvania",
              standard_place: "Pottsville, Schuylkill, Pennsylvania, United States",
            },
          ],
        },
        { id: "p_2" },
      ],
    },
  });

  async function writeSidecar(records: any[] = [sidecarRecord()]) {
    await mkdir(join(dir, "results"), { recursive: true });
    await writeFile(
      join(dir, "results", "log_001.json"),
      JSON.stringify(
        {
          log_id: "log_001",
          tool: "record_search",
          retrieved: "2026-01-01T00:00:00Z",
          returned_count: records.length,
          payload: { results: records },
        },
        null,
        2,
      ),
    );
  }

  /** research seeded with a search log entry pointing at the sidecar. */
  function sidecarResearch() {
    const r = baseResearch();
    r.log = [searchLogEntry("results/log_001.json")] as any;
    return r;
  }

  const sourceOpNoRef = () => {
    const { id: _i, gedcomx_source_description_id: _g, ...rest } = validSource("x");
    return rest;
  };

  // ── D1: composite create + reuse-or-create ──

  it("creates the tree S entry from sourceDescription, stamps the source op, writes both files (tree first)", async () => {
    await writeProject();
    const r = await researchAppend({
      projectPath: dir,
      sourceDescription: { title: "1850 U.S. Federal Census", author: "U.S. Census Bureau", url: "https://example.org" },
      ops: [
        { section: "sources", op: "append", entry: sourceOpNoRef() },
        // record_id must be fresh — "rec1" already has a source (src_001), which
        // would trigger §3.4.1 reuse detection instead of the create path.
        { section: "assertions", op: "append", entry: { ...noId(validAssertion("x", "src_002")), record_id: "rec-new" } },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok || !("results" in r)) return;
    expect(r.sourceDescriptionId).toBe("S1");
    expect(r.filesWritten).toEqual(["tree.gedcomx.json", "research.json"]);
    const tree = await readTree();
    expect(tree.sources.map((s: any) => s.id)).toEqual(["SD-001", "S1"]);
    expect(tree.sources[1]).toEqual({
      id: "S1",
      title: "1850 U.S. Federal Census",
      author: "U.S. Census Bureau",
      url: "https://example.org",
    });
    const research = await readResearch();
    expect(research.sources[1].gedcomx_source_description_id).toBe("S1");
    expect(await exists("tree.gedcomx.json.bak")).toBe(false); // no readable .bak copy of the tree
  });

  it("accepts a sources append that reuses an existing S id (multi-repository pattern); tree untouched", async () => {
    await writeProject();
    const treeBefore = await readFile(join(dir, "tree.gedcomx.json"), "utf-8");
    const { id: _i, ...src } = validSource("x"); // carries gedcomx_source_description_id: "SD-001"
    const r = await researchAppend({
      projectPath: dir,
      ops: [{ section: "sources", op: "append", entry: src }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok || !("results" in r)) return;
    expect(r.filesWritten).toEqual(["research.json"]);
    expect(r.sourceDescriptionId).toBeUndefined();
    expect(await readFile(join(dir, "tree.gedcomx.json"), "utf-8")).toBe(treeBefore);
    expect(await exists("tree.gedcomx.json.bak")).toBe(false);
  });

  it("rejects a sources append whose gedcomx_source_description_id is dangling — as an op error with opsReceived", async () => {
    await writeProject();
    const before = await readFile(join(dir, "research.json"), "utf-8");
    const { id: _i, ...src } = validSource("x");
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        { section: "sources", op: "append", entry: { ...src, gedcomx_source_description_id: "S99" } },
        { section: "assertions", op: "append", entry: noId(validAssertion("x", "src_002")) },
      ],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toMatch(/^ops\[0\]:.*'S99' not found/);
    expect(r.errors[0]).toMatch(/sourceDescription/); // actionable: how to create it
    expect(r.opsReceived).toBe(2);
    expect(await readFile(join(dir, "research.json"), "utf-8")).toBe(before);
  });

  it("rejects a sources append with neither sourceDescription nor an S reference", async () => {
    await writeProject();
    const r = await researchAppend({
      projectPath: dir,
      ops: [{ section: "sources", op: "append", entry: sourceOpNoRef() }],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toMatch(/^ops\[0\]:.*either.*sourceDescription.*or.*gedcomx_source_description_id/s);
  });

  it("rejects sourceDescription combined with an op-supplied S reference (use one)", async () => {
    await writeProject();
    const { id: _i, ...src } = validSource("x"); // has SD-001
    const r = await researchAppend({
      projectPath: dir,
      sourceDescription: { title: "T" },
      ops: [{ section: "sources", op: "append", entry: src }],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/use one/);
  });

  it("rejects sourceDescription when the batch has no (or 2+) sources append ops", async () => {
    await writeProject();
    const none = await researchAppend({
      projectPath: dir,
      sourceDescription: { title: "T" },
      ops: [{ section: "assertions", op: "append", entry: noId(validAssertion("x")) }],
    });
    expect(none.ok).toBe(false);
    if (none.ok) return;
    expect(none.errors.join(" ")).toMatch(/exactly one sources append op.*found 0/);

    const two = await researchAppend({
      projectPath: dir,
      sourceDescription: { title: "T" },
      ops: [
        { section: "sources", op: "append", entry: sourceOpNoRef() },
        { section: "sources", op: "append", entry: sourceOpNoRef() },
      ],
    });
    expect(two.ok).toBe(false);
    if (two.ok) return;
    expect(two.errors.join(" ")).toMatch(/found 2/);
  });

  it("supports the composite on the single-op form too", async () => {
    await writeProject();
    const r = await researchAppend({
      projectPath: dir,
      section: "sources",
      op: "append",
      entry: sourceOpNoRef(),
      sourceDescription: { title: "1850 U.S. Federal Census" },
    });
    expect(r.ok).toBe(true);
    if (!r.ok || "results" in r) return;
    expect(r.entryId).toBe("src_002");
    expect(r.sourceDescriptionId).toBe("S1");
    expect(r.filesWritten).toEqual(["tree.gedcomx.json", "research.json"]);
  });

  // ── D1: source_id auto-stamp ──

  it("auto-stamps source_id on assertions that omit it when the batch has exactly one sources append", async () => {
    await writeProject();
    // fresh record_id: "rec1" would engage §3.4.1 reuse (same repository)
    const { source_id: _s, ...assertionNoSource } = { ...noId(validAssertion("x")), record_id: "rec-new" };
    const r = await researchAppend({
      projectPath: dir,
      sourceDescription: { title: "T" },
      ops: [
        { section: "sources", op: "append", entry: sourceOpNoRef() },
        { section: "assertions", op: "append", entry: assertionNoSource },
        { section: "assertions", op: "append", entry: { ...assertionNoSource, source_id: null } },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const research = await readResearch();
    expect(research.assertions[1].source_id).toBe("src_002"); // omitted → stamped
    expect(research.assertions[2].source_id).toBe("src_002"); // null → stamped
  });

  it("an explicit source_id always wins over the auto-stamp", async () => {
    await writeProject();
    const r = await researchAppend({
      projectPath: dir,
      sourceDescription: { title: "T" },
      ops: [
        { section: "sources", op: "append", entry: sourceOpNoRef() }, // → src_002
        // fresh record_id keeps §3.4.1 out of the picture (explicit source_id is the subject here)
        { section: "assertions", op: "append", entry: { ...noId(validAssertion("x", "src_001")), record_id: "rec-new" } }, // explicit, pre-existing
      ],
    });
    expect(r.ok).toBe(true);
    expect((await readResearch()).assertions[1].source_id).toBe("src_001");
  });

  it("does NOT auto-stamp in a batch with two sources appends — the omitted source_id fails validation", async () => {
    await writeProject();
    const before = await readFile(join(dir, "research.json"), "utf-8");
    const { id: _i, ...src } = validSource("x"); // SD-001 exists, precondition passes
    const { source_id: _s, ...assertionNoSource } = noId(validAssertion("x"));
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        { section: "sources", op: "append", entry: src },
        { section: "sources", op: "append", entry: src },
        { section: "assertions", op: "append", entry: assertionNoSource },
      ],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/source_id/);
    expect(r.errors.join(" ")).toMatch(/ops\[2\]/); // validation error mapped back to the op
    expect(r.opsReceived).toBe(3);
    expect(await readFile(join(dir, "research.json"), "utf-8")).toBe(before);
  });

  // ── D2: persona/record-id matrix ──

  it("auto-fills record_persona_id from the sidecar and canonicalizes record_id to the sidecar's form", async () => {
    await writeProject(sidecarResearch());
    await writeSidecar();
    const { source_id: _s, ...a } = noId(validAssertion("x"));
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        {
          section: "assertions",
          op: "append",
          entry: {
            ...a,
            source_id: "src_001",
            // URL form on purpose — the sidecar stores the bare-ARK form
            record_id: "https://www.familysearch.org/ark:/61903/1:1:ABCD-123",
            log_entry_id: "log_001",
          },
        },
      ],
    });
    expect(r.ok).toBe(true);
    const persisted = (await readResearch()).assertions[1];
    expect(persisted.record_persona_id).toBe("p_1"); // auto-filled, never silently null
    expect(persisted.record_id).toBe("ark:/61903/1:1:ABCD-123"); // canonicalized
  });

  // ── D2: non-persona producers (fulltext_search / external_links_search) ──
  // These stage a sidecar keyed on `id`, with no GedcomX persona (#2038).
  const ftsResearch = () => {
    const r = baseResearch();
    r.log = [{ ...searchLogEntry("results/log_001.json"), tool: "fulltext_search" }] as any;
    return r;
  };
  // A fulltext result: bare-ARK `id` (a 3:1: image entry), no `recordId`, no gedcomx.
  const writeFtsSidecar = () => writeSidecar([{ id: "ark:/61903/3:1:S3HT-XYZ" }]);

  it("canonicalizes a fulltext_search record_id from the sidecar's `id`, never auto-filling a persona (#2038)", async () => {
    await writeProject(ftsResearch());
    await writeFtsSidecar();
    const { source_id: _s, ...a } = noId(validAssertion("x"));
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        {
          section: "assertions",
          op: "append",
          entry: {
            ...a,
            source_id: "src_001",
            // URL form on purpose — the sidecar stores the bare-ARK 3:1: form
            record_id: "https://www.familysearch.org/ark:/61903/3:1:S3HT-XYZ",
            log_entry_id: "log_001",
          },
        },
      ],
    });
    expect(r.ok).toBe(true);
    const persisted = (await readResearch()).assertions[1];
    expect(persisted.record_id).toBe("ark:/61903/3:1:S3HT-XYZ"); // canonicalized from `id`
    expect(persisted.record_persona_id ?? null).toBeNull(); // FTS carries no persona — never auto-filled
  });

  it("rejects a record_persona_id on a fulltext_search-sourced assertion with a named error (#2038)", async () => {
    await writeProject(ftsResearch());
    await writeFtsSidecar();
    const before = await readFile(join(dir, "research.json"), "utf-8");
    const { source_id: _s, ...a } = noId(validAssertion("x"));
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        {
          section: "assertions",
          op: "append",
          entry: {
            ...a,
            source_id: "src_001",
            record_id: "ark:/61903/3:1:S3HT-XYZ",
            record_persona_id: "p_1",
            log_entry_id: "log_001",
          },
        },
      ],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatch(/record_persona_id must be null/);
    expect(r.errors[0]).toMatch(/fulltext_search-sourced/);
    expect(r.errors[0]).toMatch(/no GedcomX personas/);
    expect(await readFile(join(dir, "research.json"), "utf-8")).toBe(before); // nothing written
  });

  it("auto-fills across a multi-assertion batch when all ops share one record_id and one record_role", async () => {
    await writeProject(sidecarResearch());
    await writeSidecar();
    const base = {
      ...noId(validAssertion("x", "src_001")),
      record_id: "ark:/61903/1:1:ABCD-123",
      log_entry_id: "log_001",
    };
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        { section: "assertions", op: "append", entry: { ...base } },
        { section: "assertions", op: "append", entry: { ...base, fact_type: "residence", value: "Pottsville" } },
      ],
    });
    expect(r.ok).toBe(true);
    const research = await readResearch();
    expect(research.assertions[1].record_persona_id).toBe("p_1");
    expect(research.assertions[2].record_persona_id).toBe("p_1");
  });

  it("hard-errors omitted personas in a multi-role batch on a multi-persona record, naming the searched persona", async () => {
    await writeProject(sidecarResearch());
    await writeSidecar();
    const before = await readFile(join(dir, "research.json"), "utf-8");
    const base = {
      ...noId(validAssertion("x", "src_001")),
      record_id: "ark:/61903/1:1:ABCD-123",
      log_entry_id: "log_001",
    };
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        { section: "assertions", op: "append", entry: { ...base, record_role: "deceased" } },
        {
          section: "assertions",
          op: "append",
          entry: { ...base, record_role: "father_of_deceased", fact_type: "name", value: "Thomas Flynn" },
        },
      ],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    // Both omitted-persona ops are named; stamping p_1 onto the father's
    // assertions was the observed silent corruption this scoping closes.
    expect(r.errors).toHaveLength(2);
    expect(r.errors[0]).toMatch(/^ops\[0\]:.*multiple personas in this record \(p_1, p_2\)/);
    expect(r.errors[1]).toMatch(/^ops\[1\]:/);
    expect(r.errors[0]).toMatch(/supply record_persona_id per assertion/);
    expect(r.errors[0]).toMatch(/searched persona is 'p_1'/);
    expect(await readFile(join(dir, "research.json"), "utf-8")).toBe(before); // nothing written
  });

  it("explicit record_persona_ids are unaffected by the multi-role scoping (verified as before)", async () => {
    await writeProject(sidecarResearch());
    await writeSidecar();
    const base = {
      ...noId(validAssertion("x", "src_001")),
      record_id: "ark:/61903/1:1:ABCD-123",
      log_entry_id: "log_001",
    };
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        { section: "assertions", op: "append", entry: { ...base, record_role: "deceased", record_persona_id: "p_1" } },
        {
          section: "assertions",
          op: "append",
          entry: {
            ...base,
            record_role: "father_of_deceased",
            fact_type: "name",
            value: "Thomas Flynn",
            record_persona_id: "p_2",
          },
        },
      ],
    });
    expect(r.ok).toBe(true);
    const research = await readResearch();
    expect(research.assertions[1].record_persona_id).toBe("p_1");
    expect(research.assertions[2].record_persona_id).toBe("p_2");
  });

  it("still auto-fills in a multi-role batch when the record holds a single persona (nothing to confuse)", async () => {
    await writeProject(sidecarResearch());
    await writeSidecar([
      { recordId: "ark:/61903/1:1:ABCD-123", primaryId: "p_1", gedcomx: { persons: [{ id: "p_1" }] } },
    ]);
    const base = {
      ...noId(validAssertion("x", "src_001")),
      record_id: "ark:/61903/1:1:ABCD-123",
      log_entry_id: "log_001",
    };
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        { section: "assertions", op: "append", entry: { ...base, record_role: "deceased" } },
        {
          section: "assertions",
          op: "append",
          entry: { ...base, record_role: "informant", fact_type: "name", value: "Mary Flynn" },
        },
      ],
    });
    expect(r.ok).toBe(true);
    const research = await readResearch();
    expect(research.assertions[1].record_persona_id).toBe("p_1");
    expect(research.assertions[2].record_persona_id).toBe("p_1");
  });

  it("hard-errors when a supplied record_persona_id contradicts the sidecar, naming the expected personas", async () => {
    await writeProject(sidecarResearch());
    await writeSidecar();
    const before = await readFile(join(dir, "research.json"), "utf-8");
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        {
          section: "assertions",
          op: "append",
          entry: {
            ...noId(validAssertion("x", "src_001")),
            record_id: "ark:/61903/1:1:ABCD-123",
            record_persona_id: "p_9",
            log_entry_id: "log_001",
          },
        },
      ],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toMatch(/^ops\[0\]:.*'p_9' does not resolve/);
    expect(r.errors[0]).toMatch(/p_1, p_2/); // names the expected values
    expect(r.errors[0]).toMatch(/primary persona: p_1/);
    expect(await readFile(join(dir, "research.json"), "utf-8")).toBe(before);
  });

  it("hard-errors when a supplied record_id contradicts the sidecar (persona claimed), naming the stored recordIds", async () => {
    await writeProject(sidecarResearch());
    await writeSidecar();
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        {
          section: "assertions",
          op: "append",
          entry: {
            ...noId(validAssertion("x", "src_001")),
            record_id: "ark:/61903/1:1:ZZZZ-999",
            record_persona_id: "p_1",
            log_entry_id: "log_001",
          },
        },
      ],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toMatch(/^ops\[0\]:.*'ark:\/61903\/1:1:ZZZZ-999' does not match any result/);
    expect(r.errors[0]).toMatch(/ABCD-123/); // names the expected value
  });

  it("allows a non-matching record_id when no persona is claimed (negative evidence against a collection)", async () => {
    await writeProject(sidecarResearch());
    await writeSidecar();
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        {
          section: "assertions",
          op: "append",
          entry: {
            ...noId(validAssertion("x", "src_001")),
            record_id: "1850-census-schuylkill",
            record_role: "absent",
            informant_proximity: "researcher",
            record_basis: "absent",
            log_entry_id: "log_001",
          },
        },
      ],
    });
    expect(r.ok).toBe(true);
    expect((await readResearch()).assertions[1].record_persona_id).toBeUndefined();
  });

  // ── #699 staging gap: a producer search that RETURNED results but staged no
  // sidecar. D2 can't resolve record_persona_id from a sidecar that was never
  // written, so the append is rejected (identity would be silently lost) rather
  // than persisted with a null. The false-positive guards below confirm this
  // fires ONLY on the anomaly, never on legitimate sidecar-less entries.

  it("hard-errors an ABSENT record_persona_id when a producer search returned results but staged no sidecar (#699)", async () => {
    const research = baseResearch();
    research.log = [searchLogEntry(null)] as any; // record_search, positive, results_examined 1, results_ref null
    await writeProject(research);
    const before = await readFile(join(dir, "research.json"), "utf-8");
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        {
          section: "assertions",
          op: "append",
          entry: { ...noId(validAssertion("x", "src_001")), log_entry_id: "log_001" },
        },
      ],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toMatch(/returned results but staged no sidecar/);
    expect(r.errors[0]).toMatch(/record_persona_id/);
    expect(r.errors[0]).toMatch(/Re-run the search WITH projectPath/);
    expect(await readFile(join(dir, "research.json"), "utf-8")).toBe(before);
  });

  it("hard-errors a SUPPLIED record_persona_id under the same staging gap (#699)", async () => {
    const research = baseResearch();
    research.log = [searchLogEntry(null)] as any;
    await writeProject(research);
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        {
          section: "assertions",
          op: "append",
          entry: {
            ...noId(validAssertion("x", "src_001")),
            record_persona_id: "p_1",
            log_entry_id: "log_001",
          },
        },
      ],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toMatch(/returned results but staged no sidecar/);
    expect(r.errors[0]).toMatch(/record_persona_id/);
  });

  it("hard-errors when a fulltext_search returned results but staged no sidecar", async () => {
    const research = baseResearch();
    research.log = [{ ...searchLogEntry(null), tool: "fulltext_search" }] as any;
    await writeProject(research);
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        {
          section: "assertions",
          op: "append",
          entry: { ...noId(validAssertion("x", "src_001")), log_entry_id: "log_001" },
        },
      ],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toMatch(/returned results but staged no sidecar/);
    expect(r.errors[0]).toMatch(/retained transcript/);
    expect(r.errors[0]).not.toMatch(/record_persona_id/);
  });

  it("does NOT fire for a nil/negative producer search with no sidecar (legit — no false positive)", async () => {
    const research = baseResearch();
    research.log = [
      { ...searchLogEntry(null), outcome: "negative", results_examined: 0 },
    ] as any;
    await writeProject(research);
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        {
          section: "assertions",
          op: "append",
          entry: {
            ...noId(validAssertion("x", "src_001")),
            record_role: "absent",
            informant_proximity: "researcher",
            record_basis: "absent",
            log_entry_id: "log_001",
          },
        },
      ],
    });
    expect(r.ok).toBe(true);
  });

  it("does NOT fire for a non-producer sidecar-less entry (record_read) — still enforces persona-id-must-be-null", async () => {
    const research = baseResearch();
    research.log = [
      { ...searchLogEntry(null), tool: "record_read" },
    ] as any;
    await writeProject(research);

    // absent persona id → accepted (legit no-sidecar source)
    const ok = await researchAppend({
      projectPath: dir,
      ops: [
        {
          section: "assertions",
          op: "append",
          entry: { ...noId(validAssertion("x", "src_001")), log_entry_id: "log_001" },
        },
      ],
    });
    expect(ok.ok).toBe(true);

    // supplied persona id → the original "must be null" guard still applies
    const bad = await researchAppend({
      projectPath: dir,
      ops: [
        {
          section: "assertions",
          op: "append",
          entry: {
            ...noId(validAssertion("y", "src_001")),
            record_persona_id: "p_1",
            log_entry_id: "log_001",
          },
        },
      ],
    });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.errors[0]).toMatch(/record_persona_id must be null/);
  });

  // ── Joint write: nothing written on failure ──

  it("writes NEITHER file when the research side fails validation after the in-memory tree mutation", async () => {
    await writeProject();
    const researchBefore = await readFile(join(dir, "research.json"), "utf-8");
    const treeBefore = await readFile(join(dir, "tree.gedcomx.json"), "utf-8");
    // fresh record_id so §3.4.1 doesn't divert to reuse; missing required `informant`
    const { informant: _i, ...badAssertion } = { ...noId(validAssertion("x", "src_002")), record_id: "rec-new" };
    const r = await researchAppend({
      projectPath: dir,
      sourceDescription: { title: "T" }, // would create S1 in the in-memory tree
      ops: [
        { section: "sources", op: "append", entry: sourceOpNoRef() },
        { section: "assertions", op: "append", entry: badAssertion },
      ],
    });
    expect(r.ok).toBe(false);
    expect(await readFile(join(dir, "research.json"), "utf-8")).toBe(researchBefore);
    expect(await readFile(join(dir, "tree.gedcomx.json"), "utf-8")).toBe(treeBefore); // S1 never persisted
    expect(await exists("tree.gedcomx.json.bak")).toBe(false); // no backup of a write that never happened
  });

  // ── Place levers ──

  it("resolves an omitted standard_place (geocode), echoes it in resolvedPlaces, and warns when no country to cross-check", async () => {
    await writeProject();
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        {
          section: "assertions",
          op: "append",
          entry: { ...noId(validAssertion("x", "src_001")), place: "Schuylkill County, Pennsylvania" },
        },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok || !("results" in r)) return;
    expect(r.resolvedPlaces).toEqual([
      {
        place: "Schuylkill County, Pennsylvania",
        standardPlace: "Schuylkill, Pennsylvania, United States",
        source: "geocoded",
      },
    ]);
    expect(r.validation.warnings.join(" ")).toMatch(/names no country/);
    expect((await readResearch()).assertions[1].standard_place).toBe("Schuylkill, Pennsylvania, United States");
  });

  it("copies the sidecar's resolved standard_place for the same place string instead of geocoding", async () => {
    await writeProject(sidecarResearch());
    await writeSidecar();
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        {
          section: "assertions",
          op: "append",
          entry: {
            ...noId(validAssertion("x", "src_001")),
            record_id: "ark:/61903/1:1:ABCD-123",
            log_entry_id: "log_001",
            place: "Pottsville, Pennsylvania",
          },
        },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok || !("results" in r)) return;
    expect(r.resolvedPlaces).toEqual([
      {
        place: "Pottsville, Pennsylvania",
        standardPlace: "Pottsville, Schuylkill, Pennsylvania, United States",
        source: "sidecar",
      },
    ]);
    expect(vi.mocked(resolveStandardPlace)).not.toHaveBeenCalled(); // sidecar copy, no geocode
    expect((await readResearch()).assertions[1].standard_place).toBe(
      "Pottsville, Schuylkill, Pennsylvania, United States",
    );
  });

  it("rejects a geocode whose country contradicts the place text (England → Cameroon), writes nothing", async () => {
    await writeProject();
    const before = await readFile(join(dir, "research.json"), "utf-8");
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        {
          section: "assertions",
          op: "append",
          entry: { ...noId(validAssertion("x", "src_001")), place: "West Bromwich, England" },
        },
      ],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toMatch(/^ops\[0\]:.*Cameroon.*contradicts.*West Bromwich, England/);
    expect(await readFile(join(dir, "research.json"), "utf-8")).toBe(before);
  });

  it("rejects a SUPPLIED standard_place whose country contradicts the place text", async () => {
    await writeProject();
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        {
          section: "assertions",
          op: "append",
          entry: {
            ...noId(validAssertion("x", "src_001")),
            place: "West Bromwich, England",
            standard_place: "Bamenda, Mezam, Northwest Region, Cameroon",
          },
        },
      ],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toMatch(/contradicts/);
  });

  it("accepts a resolution whose country agrees with the place text, with no country warning", async () => {
    await writeProject();
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        {
          section: "assertions",
          op: "append",
          entry: { ...noId(validAssertion("x", "src_001")), place: "West Bromwich, Staffordshire, England" },
        },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok || !("results" in r)) return;
    expect(r.resolvedPlaces?.[0]?.standardPlace).toBe("West Bromwich, Staffordshire, England, United Kingdom");
    expect(r.validation.warnings.join(" ")).not.toMatch(/names no country/);
  });

  it("standard_place: null is an explicit opt-out — no resolution, no guard", async () => {
    await writeProject();
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        {
          section: "assertions",
          op: "append",
          entry: { ...noId(validAssertion("x", "src_001")), place: "West Bromwich, England", standard_place: null },
        },
      ],
    });
    expect(r.ok).toBe(true);
    expect(vi.mocked(resolveStandardPlace)).not.toHaveBeenCalled();
    expect((await readResearch()).assertions[1].standard_place).toBeNull();
  });

  it("warns (never fails) when geocoding resolves nothing — the field is left unset", async () => {
    await writeProject();
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        {
          section: "assertions",
          op: "append",
          entry: { ...noId(validAssertion("x", "src_001")), place: "Nowhere Particular" }, // resolver mock → null
        },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok || !("results" in r)) return;
    expect(r.validation.warnings.join(" ")).toMatch(/could not resolve standard_place for 'Nowhere Particular'/);
    expect(r.resolvedPlaces).toBeUndefined();
    expect((await readResearch()).assertions[1].standard_place).toBeUndefined();
  });

  it("rejects an in-batch update of an id appended earlier in the same batch", async () => {
    await writeProject();
    const before = await readFile(join(dir, "research.json"), "utf-8");
    const { id: _i, ...src } = validSource("x"); // carries SD-001
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        { section: "sources", op: "append", entry: src }, // → src_002
        { section: "sources", op: "update", entryId: "src_002", fields: { repository: "Ancestry" } },
      ],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toMatch(/^ops\[1\]:.*appended earlier in this batch/);
    expect(await readFile(join(dir, "research.json"), "utf-8")).toBe(before);
  });

  it("resolveStandardPlace: false skips geocoding but the sidecar copy still applies", async () => {
    await writeProject(sidecarResearch());
    await writeSidecar();
    const r = await researchAppend({
      projectPath: dir,
      resolveStandardPlace: false,
      ops: [
        {
          section: "assertions",
          op: "append",
          entry: {
            ...noId(validAssertion("x", "src_001")),
            record_id: "ark:/61903/1:1:ABCD-123",
            log_entry_id: "log_001",
            place: "Pottsville, Pennsylvania",
          },
        },
        {
          section: "assertions",
          op: "append",
          entry: {
            ...noId(validAssertion("x", "src_001")),
            record_id: "ark:/61903/1:1:ABCD-123",
            log_entry_id: "log_001",
            place: "Somewhere Unstaged, Pennsylvania",
          },
        },
      ],
    });
    expect(r.ok).toBe(true);
    expect(vi.mocked(resolveStandardPlace)).not.toHaveBeenCalled();
    const research = await readResearch();
    expect(research.assertions[1].standard_place).toBe("Pottsville, Schuylkill, Pennsylvania, United States");
    expect(research.assertions[2].standard_place).toBeUndefined();
  });

  // ── §3.4.1: source-reuse auto-detection ──

  /** A schema-valid source without id/S-ref, with an overridable repository. */
  const reuseSourceOp = (repository = "NARA", extra: Record<string, unknown> = {}) => ({
    ...sourceOpNoRef(),
    repository,
    ...extra,
  });
  /** A schema-valid assertion without id/source_id, citing `recordId`. */
  const reuseAssertionOp = (recordId: string) => {
    const { source_id: _s, ...rest } = noId(validAssertion("x"));
    return { ...rest, record_id: recordId };
  };

  it("created: no existing source for the record_id → S created, sourceReuse echoed", async () => {
    await writeProject();
    const r = await researchAppend({
      projectPath: dir,
      sourceDescription: { title: "1850 U.S. Federal Census" },
      ops: [
        { section: "sources", op: "append", entry: reuseSourceOp() },
        { section: "assertions", op: "append", entry: reuseAssertionOp("rec-new") },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok || !("results" in r)) return;
    expect(r.sourceReuse).toEqual({ action: "created", srcId: "src_002", sId: "S1" });
    expect(r.sourceDescriptionId).toBe("S1");
    expect(r.filesWritten).toEqual(["tree.gedcomx.json", "research.json"]);
  });

  it("updated_existing: same record_id + same repository → append converted to update, no new src/S", async () => {
    await writeProject();
    const treeBefore = await readFile(join(dir, "tree.gedcomx.json"), "utf-8");
    const r = await researchAppend({
      projectPath: dir,
      sourceDescription: { title: "ignored — reuse wins" },
      ops: [
        { section: "sources", op: "append", entry: reuseSourceOp("NARA", { notes: "refined on re-extraction" }) },
        { section: "assertions", op: "append", entry: reuseAssertionOp("rec1") },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok || !("results" in r)) return;
    expect(r.sourceReuse).toEqual({ action: "updated_existing", srcId: "src_001", sId: "SD-001" });
    expect(r.sourceDescriptionId).toBeUndefined(); // sourceDescription ignored, no S created
    expect(r.filesWritten).toEqual(["research.json"]); // research-only write
    expect(r.results[0]).toEqual({ section: "sources", op: "update", entryId: "src_001" });
    const research = await readResearch();
    expect(research.sources).toHaveLength(1); // no duplicate source
    expect(research.sources[0].notes).toBe("refined on re-extraction"); // fields merged
    expect(research.sources[0].gedcomx_source_description_id).toBe("SD-001"); // S link kept
    expect(research.assertions[1].source_id).toBe("src_001"); // stamped with the existing src
    expect(await readFile(join(dir, "tree.gedcomx.json"), "utf-8")).toBe(treeBefore);
    expect(await exists("tree.gedcomx.json.bak")).toBe(false);
  });

  it("derives transcription_truncated THROUGH a §3.4.1 reuse fold — pins the derivation after the rewrite (#2457 r11 [0e])", async () => {
    await writeProject();
    // The derivation must run AFTER the reuse rewrite, and since r10 that is
    // load-bearing rather than decorative: before the fold this op is an `append`
    // carrying no entryId, so the persisted-entry fallback cannot resolve it; after
    // the fold it is an `update` on src_001 and it can. Moving the block earlier in
    // prepareOps leaves the whole suite green EXCEPT this test.
    await researchAppend({
      projectPath: dir,
      section: "sources",
      op: "update",
      entryId: "src_001",
      fields: { image_filename: "images/x.jpg" },
    } as any);
    recordImageReadCap(dir, "images/x.jpg", true);
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        { section: "sources", op: "append", entry: reuseSourceOp("NARA", { transcription: "first half of the page" }) },
        { section: "assertions", op: "append", entry: reuseAssertionOp("rec1") },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok || !("results" in r)) return;
    expect(r.sourceReuse?.action).toBe("updated_existing"); // the fold happened
    const folded = (await readResearch()).sources.find((s: any) => s.id === "src_001");
    expect(folded.transcription_truncated).toBe(true); // reds if the derivation runs before the rewrite
    __clearTruncatedSourceImagesForTests();
  });

  it("updated_existing: repository matches on normalized form (case + whitespace)", async () => {
    await writeProject();
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        { section: "sources", op: "append", entry: reuseSourceOp("  nara ") },
        { section: "assertions", op: "append", entry: reuseAssertionOp("rec1") },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok || !("results" in r)) return;
    expect(r.sourceReuse?.action).toBe("updated_existing");
    expect(r.sourceReuse?.srcId).toBe("src_001");
  });

  it("new_source_reused_s: same record_id, different repository → new src_ citing the existing S; no S created", async () => {
    await writeProject();
    const treeBefore = await readFile(join(dir, "tree.gedcomx.json"), "utf-8");
    const r = await researchAppend({
      projectPath: dir,
      sourceDescription: { title: "ignored — the record's S already exists" },
      ops: [
        { section: "sources", op: "append", entry: reuseSourceOp("Ancestry") },
        { section: "assertions", op: "append", entry: reuseAssertionOp("rec1") },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok || !("results" in r)) return;
    expect(r.sourceReuse).toEqual({ action: "new_source_reused_s", srcId: "src_002", sId: "SD-001" });
    expect(r.sourceDescriptionId).toBeUndefined();
    expect(r.filesWritten).toEqual(["research.json"]); // tree untouched
    const research = await readResearch();
    expect(research.sources).toHaveLength(2);
    expect(research.sources[1].id).toBe("src_002");
    expect(research.sources[1].repository).toBe("Ancestry");
    expect(research.sources[1].gedcomx_source_description_id).toBe("SD-001"); // reused S
    expect(research.assertions[1].source_id).toBe("src_002"); // auto-stamp with the NEW src
    expect(await readFile(join(dir, "tree.gedcomx.json"), "utf-8")).toBe(treeBefore);
  });

  it("explicit gedcomx_source_description_id keeps today's semantics — no detection, no sourceReuse echo", async () => {
    await writeProject();
    const { id: _i, ...src } = validSource("x"); // carries SD-001 explicitly, repository NARA
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        { section: "sources", op: "append", entry: src },
        { section: "assertions", op: "append", entry: reuseAssertionOp("rec1") },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok || !("results" in r)) return;
    expect(r.sourceReuse).toBeUndefined();
    const research = await readResearch();
    expect(research.sources).toHaveLength(2); // a second NARA source was created as asked
    expect(research.sources[1].id).toBe("src_002");
  });

  it("multi-repo edge: updates the repository-equal source, not the first; a third repo reuses the FIRST match's S", async () => {
    const research = baseResearch();
    research.sources = [
      validSource("src_001"), // NARA, SD-001
      { ...validSource("src_002"), repository: "Ancestry", gedcomx_source_description_id: "SD-002" },
    ];
    research.assertions = [
      validAssertion("a_001", "src_001"), // rec1 via NARA
      validAssertion("a_002", "src_002"), // rec1 via Ancestry
    ];
    const tree = { ...baseTree, sources: [...baseTree.sources, { id: "SD-002", title: "Same census via Ancestry" }] };
    await writeProject(research, tree);

    // (a) repository matches the SECOND source → that one is updated.
    const a = await researchAppend({
      projectPath: dir,
      ops: [
        { section: "sources", op: "append", entry: reuseSourceOp("Ancestry") },
        { section: "assertions", op: "append", entry: reuseAssertionOp("rec1") },
      ],
    });
    expect(a.ok).toBe(true);
    if (!a.ok || !("results" in a)) return;
    expect(a.sourceReuse).toEqual({ action: "updated_existing", srcId: "src_002", sId: "SD-002" });

    // (b) a third repository → new src_003 reusing the FIRST match's S (sources order).
    const b = await researchAppend({
      projectPath: dir,
      ops: [
        { section: "sources", op: "append", entry: reuseSourceOp("MyHeritage") },
        { section: "assertions", op: "append", entry: reuseAssertionOp("rec1") },
      ],
    });
    expect(b.ok).toBe(true);
    if (!b.ok || !("results" in b)) return;
    expect(b.sourceReuse).toEqual({ action: "new_source_reused_s", srcId: "src_003", sId: "SD-001" });
  });

  it("matches canonicalized record_id forms (resolver URL vs bare ARK vs type-prefixed)", async () => {
    const research = baseResearch();
    research.assertions = [
      { ...validAssertion("a_001"), record_id: "https://www.familysearch.org/ark:/61903/1:1:MXYZ-TP4" },
    ];
    await writeProject(research);
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        { section: "sources", op: "append", entry: reuseSourceOp("NARA") },
        { section: "assertions", op: "append", entry: reuseAssertionOp("1:1:MXYZ-TP4") },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok || !("results" in r)) return;
    expect(r.sourceReuse?.action).toBe("updated_existing");
    expect(r.sourceReuse?.srcId).toBe("src_001");
  });

  it("no assertion appends in the batch → detection stays out (no sourceReuse)", async () => {
    await writeProject();
    const r = await researchAppend({
      projectPath: dir,
      sourceDescription: { title: "T" },
      ops: [{ section: "sources", op: "append", entry: reuseSourceOp() }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok || !("results" in r)) return;
    expect(r.sourceReuse).toBeUndefined();
    expect(r.sourceDescriptionId).toBe("S1");
  });
});

describe("countryConsistency heuristic", () => {
  it.each([
    ["West Bromwich, England", "West Bromwich, Staffordshire, England, United Kingdom", "ok"],
    ["West Bromwich, England", "Bamenda, Mezam, Northwest Region, Cameroon", "contradiction"],
    ["Oslo, Norway", "Oslo, Oslo, Norway", "ok"],
    ["Boston, USA", "Boston, Suffolk, Massachusetts, United States", "ok"], // alias
    ["Dublin, Ireland", "Belfast, Antrim, Northern Ireland, United Kingdom", "ok"], // historic-Ireland carve-out
    ["Glasgow, Scotland", "Cardiff, Wales, United Kingdom", "contradiction"], // different UK constituent
    ["Glasgow, Scotland", "Glasgow, Lanarkshire, United Kingdom", "ok"], // constituent within UK
    ["Schuylkill County, Pennsylvania", "Schuylkill, Pennsylvania, United States", "unverifiable"], // no country named
  ])("%s vs %s → %s", (place, standard, expected) => {
    expect(countryConsistency(place as string, standard as string)).toBe(expected);
  });
});

// ─── Identity over-reach gate (#700) ────────────────────────────────────────
//
// Conjunctive by design: uncertain reading AND no corroborating record. The
// eval fixture corpus carries no `[?]` at all, so nothing in eval/ exercises
// this — these tests are the only coverage.

describe("research_append — person_evidence epistemic gate", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "research-append-pe-gate-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  /** src_001/a_001 exist from baseResearch(); add the ones each case needs. */
  function researchWith(assertions: any[], personEvidence: any[] = []) {
    const r = baseResearch();
    r.assertions = [...r.assertions, ...assertions] as any;
    r.person_evidence = personEvidence as any;
    return r;
  }
  const uncertain = (id: string, recordId: string) => ({
    ...validAssertion(id),
    record_id: recordId,
    fact_type: "name",
    value: "Father: Thomas Fl[?]nn",
  });
  const clean = (id: string, recordId: string) => ({
    ...validAssertion(id),
    record_id: recordId,
    fact_type: "name",
    value: "Father: Thomas Flynn",
  });
  async function write(research: any) {
    await writeFile(join(dir, "research.json"), JSON.stringify(research, null, 2));
    await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify(baseTree, null, 2));
  }
  const link = (assertionId: string, confidence: string) => ({
    projectPath: dir,
    section: "person_evidence",
    op: "append" as const,
    entry: {
      assertion_id: assertionId,
      person_id: "I1",
      confidence,
      rationale: "Names match the subject.",
      match_score: null,
      created: "2026-07-18",
      superseded_by: null,
    },
  });

  it("rejects 'confident' on an uncertain reading with no corroborating record", async () => {
    await write(researchWith([uncertain("a_010", "rec_A")]));
    const r = await researchAppend(link("a_010", "confident"));
    expect(r.ok).toBe(false);
    expect(failure(r).errors?.join(" ")).toMatch(/uncertain reading/i);
  });

  it("allows 'probable' on the same uncertain, uncorroborated reading", async () => {
    await write(researchWith([uncertain("a_010", "rec_A")]));
    const r = await researchAppend(link("a_010", "probable"));
    expect(r.ok).toBe(true);
  });

  // The ut_person_evidence_001 shape: a single death certificate that plainly
  // names its subject. Gating on record-count alone would wrongly reject this.
  it("allows 'confident' on a single CLEAN record (no [?])", async () => {
    await write(researchWith([clean("a_011", "rec_A")]));
    const r = await researchAppend(link("a_011", "confident"));
    expect(r.ok).toBe(true);
  });

  it("allows 'confident' on an uncertain reading once a second record corroborates", async () => {
    await write(
      researchWith(
        [uncertain("a_010", "rec_A"), clean("a_012", "rec_B")],
        [
          {
            id: "pe_001",
            assertion_id: "a_012",
            person_id: "I1",
            confidence: "probable",
            rationale: "Independent record tying the same person.",
            match_score: null,
            created: "2026-07-18",
            superseded_by: null,
          },
        ],
      ),
    );
    const r = await researchAppend(link("a_010", "confident"));
    expect(r.ok).toBe(true);
  });

  it("does not count a superseded pe row as corroboration", async () => {
    await write(
      researchWith(
        [uncertain("a_010", "rec_A"), clean("a_012", "rec_B")],
        [
          {
            id: "pe_001",
            assertion_id: "a_012",
            person_id: "I1",
            confidence: "probable",
            rationale: "Superseded link.",
            match_score: null,
            created: "2026-07-18",
            superseded_by: "pe_002",
          },
        ],
      ),
    );
    const r = await researchAppend(link("a_010", "confident"));
    expect(r.ok).toBe(false);
  });

  it("does not count another record tied to a DIFFERENT person as corroboration", async () => {
    const r0 = researchWith(
      [uncertain("a_010", "rec_A"), clean("a_012", "rec_B")],
      [
        {
          id: "pe_001",
          assertion_id: "a_012",
          person_id: "I2",
          confidence: "probable",
          rationale: "Different person entirely.",
          match_score: null,
          created: "2026-07-18",
          superseded_by: null,
        },
      ],
    );
    await writeFile(join(dir, "research.json"), JSON.stringify(r0, null, 2));
    await writeFile(
      join(dir, "tree.gedcomx.json"),
      JSON.stringify(
        {
          ...baseTree,
          persons: [
            ...baseTree.persons,
            { id: "I2", gender: "Female", names: [{ id: "N2", given: "Mary", surname: "Smith" }] },
          ],
        },
        null,
        2,
      ),
    );
    const r = await researchAppend(link("a_010", "confident"));
    expect(r.ok).toBe(false);
  });
});

// ─── Worked examples (#697) ─────────────────────────────────────────────────
//
// The point of the registry is that a rejected append is handed a shape the
// model can copy. An example that does not itself validate would teach the
// wrong shape — worse than no example — so every one is round-tripped through
// the real tool here. This test is the reason to trust the registry.

describe("research_append — worked examples are themselves valid", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "research-append-examples-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  /** A project carrying every id the examples reference as a foreign key. */
  function exampleFixture() {
    const r: any = baseResearch();
    r.log = [
      {
        id: "log_004",
        plan_item_id: null,
        performed: "2026-07-18",
        tool: "record_search",
        query: "Patrick Flynn death 1908 Schuylkill",
        outcome: "positive",
        results_examined: 1,
        results_ref: "results/log_004.json",
        results_available: 1,
        notes: null,
        external_site: null,
      },
    ];
    r.sources = [validSource("src_001"), { ...validSource("src_004") }];
    r.assertions = [
      validAssertion("a_001"),
      { ...validAssertion("a_013", "src_004"), record_id: "ark:/61903/1:1:MDEF" },
      { ...validAssertion("a_025", "src_004"), record_id: "ark:/61903/1:1:MDEF" },
    ];
    r.questions = [
      {
        id: "q_002",
        question: "Who were the parents of Patrick Flynn?",
        rationale: "Seed question for the example fixture.",
        selection_basis: "objective_decomposition",
        priority: "high",
        status: "open",
        depends_on: [],
        unblocks: [],
        created: "2026-07-18",
        resolved: null,
        resolution_assertion_ids: [],
        exhaustive_declaration: { declared: false, justification: null, log_entry_ids: [], stop_criteria: null },
      },
      {
        id: "q_003",
        question: "Where was Patrick Flynn born in Ireland?",
        rationale: "Spare question with no active plan, for the `plans` example.",
        selection_basis: "objective_decomposition",
        priority: "medium",
        status: "open",
        depends_on: [],
        unblocks: [],
        created: "2026-07-18",
        resolved: null,
        resolution_assertion_ids: [],
        exhaustive_declaration: { declared: false, justification: null, log_entry_ids: [], stop_criteria: null },
      },
    ];
    r.plans = [
      {
        id: "pl_001",
        question_id: "q_002",
        status: "active",
        created: "2026-07-18",
        items: [
          {
            id: "pli_001",
            sequence: 1,
            record_type: "census",
            jurisdiction: "Schuylkill County, Pennsylvania",
            date_range: "1850-1860",
            repository: "FamilySearch",
            rationale: "Seed item — a plan carries at least one.",
            fallback_for: null,
            status: "planned",
          },
        ],
      },
    ];
    r.conflicts = [
      {
        id: "c_001",
        conflict_type: "fact",
        description: "Seed conflict for the example fixture.",
        disputed_attribute: "birth_year",
        identity_question: null,
        competing_assertion_ids: ["a_013", "a_025"],
        independence_analysis: "Independent sources.",
        weighing_analysis: "Weighed.",
        preferred_assertion_id: "a_013",
        resolution_rationale: "Resolved for the fixture.",
        status: "resolved",
        blocks_question_ids: [],
      },
    ];
    return r;
  }

  /** Staged search results for log_004 — the assertions example names it as its
   *  log_entry_id, and the #699 staging gate requires the sidecar to exist. */
  const sidecar = {
    log_id: "log_004",
    tool: "record_search",
    retrieved: "2026-07-18T14:00:00Z",
    returned_count: 1,
    payload: {
      results: [
        {
          recordId: "ark:/61903/1:1:MDEF",
          primaryId: "p1",
          gedcomx: { persons: [{ id: "p1" }] },
        },
      ],
    },
  };

  const SECTIONS_WITH_EXAMPLES = [
    "sources",
    "assertions",
    "person_evidence",
    "questions",
    "plans",
    "plan_items",
    "conflicts",
    "hypotheses",
    "timelines",
    "proof_summaries",
    "evaluations",
    "known_holdings",
  ];

  it.each(SECTIONS_WITH_EXAMPLES)("the '%s' example validates", async (section) => {
    // A fresh project per case so examples never depend on each other.
    await writeFile(join(dir, "research.json"), JSON.stringify(exampleFixture(), null, 2));
    await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify(baseTree, null, 2));
    await mkdir(join(dir, "results"), { recursive: true });
    await writeFile(join(dir, "results", "log_004.json"), JSON.stringify(sidecar, null, 2));

    const entry = JSON.parse(__testing.EXAMPLES[section]);
    // `plans` already has an active plan for q_002 in the fixture (the
    // one-active-plan invariant); point the example at a fresh question.
    if (section === "plans") entry.question_id = "q_003";

    // `plans` is the one section whose example is not a standalone append: the
    // shell omits `items`, so the `plan_items` op that fills it belongs in the
    // SAME call. Round-trip the batched call `exampleFor("plans")` actually
    // renders, not a single-op append the tool would refuse — otherwise the
    // shape the model is shown for `plans` loses its only validity check. The
    // fixture holds pl_001, so the shell is assigned pl_002.
    if (section === "plans") {
      const batched = await researchAppend({
        projectPath: dir,
        ops: [
          { section: "plans", op: "append", entry },
          {
            section: "plan_items",
            op: "append",
            planId: "pl_002",
            entry: JSON.parse(__testing.EXAMPLES.plan_items),
          },
        ],
      } as any);
      expect(errorsOf(batched) ?? []).toEqual([]);
      expect(batched.ok).toBe(true);
      const written = JSON.parse(await readFile(join(dir, "research.json"), "utf-8"));
      expect(written.plans[1].id).toBe("pl_002");
      expect(written.plans[1].items).toHaveLength(1);
      return;
    }

    const r = await researchAppend({
      projectPath: dir,
      section,
      op: "append",
      entry,
      ...(section === "plan_items" ? { planId: "pl_001" } : {}),
      // The evaluations example is a pointer with no file_path by design; the
      // composite `verdict` arg is what fills it.
      ...(section === "evaluations" ? { verdict: { strengths: [], must_address: [] } } : {}),
      ...(section === "sources"
        ? {
            sourceDescription: {
              title: "Pennsylvania Death Certificate — Patrick Flynn (1908)",
              author: "Pennsylvania Department of Health",
              url: "https://www.familysearch.org/ark:/61903/1:1:MDEF",
            },
          }
        : {}),
    } as any);
    expect(errorsOf(r) ?? []).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("attaches the section's worked example to a rejection", async () => {
    await writeFile(join(dir, "research.json"), JSON.stringify(exampleFixture(), null, 2));
    await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify(baseTree, null, 2));
    // The exact shape the closing report saw 4+ times: the verdict body
    // appended instead of the pointer entry.
    const r = await researchAppend({
      projectPath: dir,
      section: "evaluations",
      op: "append",
      entry: {
        focus: "conclusion-readiness",
        target_id: "q_002",
        target_type: "question",
        verdict: "consider_addressing",
        strengths: ["well sourced"],
        must_address: ["no parents named"],
      },
    } as any);
    expect(r.ok).toBe(false);
    const joined = (failure(r).errors ?? []).join("\n");
    expect(joined).toMatch(/worked example for 'evaluations'/);
    expect(joined).toMatch(/file_path/);
  });
});

// ─── Composite verdict persist (gps-mentor write path) ──────────────────────
//
// evaluations[].file_path is the same design as log[].results_ref: a pointer in
// research.json to a sidecar only the host writes. Writing both in one call is
// what makes a dangling file_path impossible.

describe("research_append — evaluations verdict composite", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "research-append-verdict-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const VERDICT = {
    focus: "conclusion-readiness",
    target_id: "q_002",
    target_type: "question",
    verdict: "address_first",
    strengths: ["Independence analysis on c_001 is correct (Standard 46)."],
    must_address: [
      {
        standard: "Standard 14 — topical breadth",
        issue: "No probate search planned for Schuylkill County 1875-1890.",
        what_would_change_my_mind: "An executed probate search, even a nil result.",
        suggested_skill: "research-plan",
        specific_action: "Add a probate plan item.",
      },
    ],
    narrative_for_user: "You are close. The probate gap is the one thing standing between this and a defensible conclusion.",
  };
  const pointer = () => ({
    focus: "conclusion-readiness",
    target_id: "q_002",
    target_type: "question",
    verdict: "address_first",
    timestamp: "2026-07-18T14:05:00Z",
    superseded_by: null,
  });
  async function writeProject() {
    const r: any = baseResearch();
    r.questions = [
      {
        id: "q_002",
        question: "Who were the parents of Patrick Flynn?",
        rationale: "Seed.",
        selection_basis: "objective_decomposition",
        priority: "high",
        status: "open",
        depends_on: [],
        unblocks: [],
        created: "2026-07-18",
        resolved: null,
        resolution_assertion_ids: [],
        exhaustive_declaration: { declared: false, justification: null, log_entry_ids: [], stop_criteria: null },
      },
    ];
    await writeFile(join(dir, "research.json"), JSON.stringify(r, null, 2));
    await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify(baseTree, null, 2));
  }

  it("writes the sidecar, stamps file_path, and keeps the body out of research.json", async () => {
    await writeProject();
    const r = await researchAppend({
      projectPath: dir,
      section: "evaluations",
      op: "append",
      entry: pointer(),
      verdict: VERDICT,
    } as any);
    expect(errorsOf(r) ?? []).toEqual([]);
    expect(r.ok).toBe(true);

    const research = JSON.parse(await readFile(join(dir, "research.json"), "utf-8"));
    const ev = research.evaluations[0];
    expect(ev.file_path).toBe("evaluations/conclusion-readiness-q_002-2026-07-18T14-05-00.json");
    // The pointer stays a pointer: no verdict body leaked into research.json.
    expect(ev.strengths).toBeUndefined();
    expect(ev.must_address).toBeUndefined();

    // …and the file it names actually exists, with the body.
    const written = JSON.parse(await readFile(join(dir, ev.file_path), "utf-8"));
    expect(written.must_address[0].standard).toMatch(/Standard 14/);
    expect(written.narrative_for_user).toMatch(/probate gap/);
  });

  it("rejects verdict + an explicit file_path (ambiguous ownership)", async () => {
    await writeProject();
    const r = await researchAppend({
      projectPath: dir,
      section: "evaluations",
      op: "append",
      entry: { ...pointer(), file_path: "evaluations/hand-written.json" },
      verdict: VERDICT,
    } as any);
    expect(r.ok).toBe(false);
    expect(failure(r).errors?.join(" ")).toMatch(/use one/i);
  });

  it("rejects verdict on a non-evaluations section", async () => {
    await writeProject();
    const r = await researchAppend({
      projectPath: dir,
      section: "hypotheses",
      op: "append",
      entry: {
        claim: "Test claim.",
        status: "active",
        supporting_assertion_ids: [],
        contradicting_assertion_ids: [],
        ruled_out: false,
        ruled_out_reason: null,
        notes: null,
        related_question_ids: [],
      },
      verdict: VERDICT,
    } as any);
    expect(r.ok).toBe(false);
    expect(failure(r).errors?.join(" ")).toMatch(/only valid on an `evaluations` append/);
  });

  // The failure mode the composite exists to prevent: a rejected call must not
  // leave an orphan verdict file behind for a pointer that was never persisted.
  it("writes no sidecar when the document fails validation", async () => {
    await writeProject();
    const r = await researchAppend({
      projectPath: dir,
      section: "evaluations",
      op: "append",
      entry: { ...pointer(), target_id: "q_nonexistent" },
      verdict: VERDICT,
    } as any);
    expect(r.ok).toBe(false);
    await expect(access(join(dir, "evaluations"))).rejects.toThrow();
  });

  it("still supports the pointer-only form (caller wrote the file itself)", async () => {
    await writeProject();
    const r = await researchAppend({
      projectPath: dir,
      section: "evaluations",
      op: "append",
      entry: { ...pointer(), file_path: "evaluations/hand-written.json" },
    } as any);
    expect(errorsOf(r) ?? []).toEqual([]);
    expect(r.ok).toBe(true);
  });
});

describe("research_append — relationship direction and the sibling value (#2535)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ra-reldir-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writeProject(research: any = baseResearch(), tree: any = baseTree) {
    await writeFile(join(dir, "research.json"), JSON.stringify(research, null, 2));
    await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify(tree, null, 2));
  }

  async function appendRelationship(value: string, structured_value: any) {
    await writeProject();
    return researchAppend({
      projectPath: dir,
      ops: [
        {
          section: "assertions",
          op: "append",
          entry: {
            ...noId(validAssertion("x", "src_001")),
            fact_type: "relationship",
            value,
            structured_value,
          },
        },
      ],
    });
  }

  // --- refuse ------------------------------------------------------------

  it("refuses a sibling typed as a child — the live, reproducing defect", async () => {
    // 5 sightings across three of the five current record-extraction run logs, every
    // one `relationship_type: "child"` beside a `sibling of …` value. The
    // agent was never told `sibling` was legal, so it picked the nearest of
    // the three values it had been given.
    const r = await appendRelationship("sibling of Grace (Whitaker) Tolman", {
      relationship_type: "child",
      related_person_role: "sibling_1",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toMatch(/states the subject is a sibling/);
    // The refusal must name the satisfying value, because the agent body and
    // this deny can land in either order and a refusal that does not say
    // `sibling` exists leaves the caller guessing between three wrong values.
    expect(r.errors[0]).toMatch(
      /categories are "parent", "child", "spouse" and "sibling"/,
    );
    expect(r.errors[0]).toMatch(/record SUBJECT's own role/);
  });

  it("refuses a direction inversion — the edge written backwards", async () => {
    const r = await appendRelationship("child of Jim Neal", {
      relationship_type: "parent",
      related_person_role: "father_of_deceased",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toMatch(/states the subject is a child/);
  });

  // --- accept: the three branches the corpus never exercises -------------

  it("accepts a value that LABELS the other party rather than the subject", async () => {
    // `father named as Casper` says who the father IS; it does not say the
    // subject is a parent. Comparing relation words without regard to
    // position refused 22 of the 37 it flagged over the e2e run logs, which
    // is how two earlier guards on this field got their refusal rates.
    // Re-derive: `measure_relationship_direction.py --counterfactual`.
    // Both shapes, because they are kept out by DIFFERENT mechanisms and a
    // test using only the first proves nothing about the second. "father named
    // as X" carries no " of ", so the position regex never matches it at all;
    // "Father of groom named as X" does carry " of " and is excluded by the
    // role guard, because `groom` is a role word rather than a name.
    const bare = await appendRelationship(
      "father named as Casper A. Battermiller on death certificate",
      { relationship_type: "child", related_person_role: "father_of_deceased" },
    );
    expect(bare.ok).toBe(true);
    const viaRole = await appendRelationship(
      "Father of groom named as Tellef Aadnesen in 1840 marriage register",
      { relationship_type: "child", related_person_role: "father_of_groom" },
    );
    expect(viaRole.ok).toBe(true);
    // The third shape: a role word followed by a COLON rather than "named as".
    // The role guard must accept both spellings, or this is refused while the
    // identical "Father of groom named as X" is skipped. No corpus assertion
    // has this shape today -- deleting the guard changes the measured refusal
    // set not at all -- so without this case it is a branch no test can reach.
    const labelledRole = await appendRelationship(
      "father of the bride: Jan Roelfs Harkema",
      { relationship_type: "child", related_person_role: "father_of_bride" },
    );
    expect(labelledRole.ok).toBe(true);
  });

  it("accepts a value naming several relations where the type matches one", async () => {
    const r = await appendRelationship(
      "child of Thomas Flynn and brother of Mary Flynn",
      { relationship_type: "child", related_person_role: "head_of_household" },
    );
    expect(r.ok).toBe(true);
  });

  it("accepts an unknown spelling rather than guessing at it", async () => {
    // `_relationship_category` returning undefined is the designed fail-open.
    // 63 assertions across 16 spellings sit outside the four categories
    // over the e2e run logs (73 across 18 over the full population)
    // (`grandparent`, `ParentChild`, `administrator`…) and every one must be
    // skipped, not refused.
    // The value must carry a relation word the table DOES know, or the
    // position regex bails first and the fail-open is never reached — which
    // is why `stepfather of Charles Ferber` alone proves nothing here.
    const r = await appendRelationship("brother of John Grice", {
      relationship_type: "godchild",
      related_person_role: "head_of_household",
    });
    expect(r.ok).toBe(true);
    const stepped = await appendRelationship("stepfather of Charles Ferber", {
      relationship_type: "stepfather",
      related_person_role: "child",
    });
    expect(stepped.ok).toBe(true);
  });

  it("accepts a gendered spelling without normalising it away", async () => {
    // `father` 17, `mother` 12, `son` 4, `daughter` 2, `wife` 1 in the corpus,
    // and the spec's canonical example uses `son`.
    const r = await appendRelationship("son of Emma Ferber", {
      relationship_type: "son",
      related_person_role: "mother_of_deceased",
    });
    expect(r.ok).toBe(true);
  });

  it("refuses an _inferred type too — the corpus shape of the sibling defect", async () => {
    // Every one of the three committed `brother of John Grice` defects is
    // typed `child_inferred`, not `child`. A rule that compares the spelling
    // without stripping the suffix misses all of them.
    const r = await appendRelationship("brother of John Grice (inferred)", {
      relationship_type: "child_inferred",
      related_person_role: "head_of_household",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toMatch(/states the subject is a sibling/);
  });

  it("ignores a relation word that is not the value's opening claim", async () => {
    // Only the LEADING `<relation> of <name>` states the subject's role. A
    // relation named later is describing somebody else, and comparing against
    // it is what made the previous check refuse 22 of the 37 it flagged
    // over the e2e run logs.
    const r = await appendRelationship(
      "named in the will of his brother John Grice",
      { relationship_type: "child", related_person_role: "testator" },
    );
    expect(r.ok).toBe(true);
  });

  it("refuses on the UPDATE path too, not only on append", async () => {
    // The spec row advertises "append OR update". Deleting the update call
    // site left the whole suite green, so half the stated surface had no test.
    await writeProject();
    const added = await researchAppend({
      projectPath: dir,
      ops: [
        {
          section: "assertions",
          op: "append",
          entry: {
            ...noId(validAssertion("x", "src_001")),
            fact_type: "relationship",
            value: "child of Jim Neal",
            structured_value: {
              relationship_type: "child",
              related_person_role: "father_of_deceased",
            },
          },
        },
      ],
    });
    expect(added.ok).toBe(true);
    if (!added.ok) return;

    const r = await researchAppend({
      projectPath: dir,
      section: "assertions",
      op: "update",
      entryId: (added as any).results[0].entryId,
      fields: { structured_value: { relationship_type: "parent" } },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(failure(r).errors?.join(" ")).toMatch(/states the subject is a child/);
  });

  it("refuses a RETYPE into relationship that exposes a contradiction", async () => {
    // The scoping above keys off `value`/`structured_value`, but `fact_type`
    // is the third input to the same comparison: an assertion may sit outside
    // the guard's domain carrying a contradiction, and one `fact_type` edit
    // moves it inside without either compared field being touched.
    await writeProject();
    const added = await researchAppend({
      projectPath: dir,
      ops: [
        {
          section: "assertions",
          op: "append",
          entry: {
            ...noId(validAssertion("x", "src_001")),
            fact_type: "residence",
            value: "child of Jim Neal",
            structured_value: { relationship_type: "parent" },
          },
        },
      ],
    });
    expect(added.ok).toBe(true);
    if (!added.ok) return;

    const r = await researchAppend({
      projectPath: dir,
      section: "assertions",
      op: "update",
      entryId: (added as any).results[0].entryId,
      fields: { fact_type: "relationship" },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(failure(r).errors?.join(" ")).toMatch(/states the subject is a child/);
  });

  it("skips an inherited Object key, rather than refusing it", async () => {
    // The category table is indexed by a model-supplied string, so every key
    // on Object.prototype reads back as a truthy non-category. The documented
    // contract is that an unknown spelling yields no category and is SKIPPED;
    // `constructor` is an unknown spelling.
    await writeProject();
    for (const spelling of ["constructor", "toString", "__proto__"]) {
      const r = await researchAppend({
        projectPath: dir,
        ops: [
          {
            section: "assertions",
            op: "append",
            entry: {
              ...noId(validAssertion("x", "src_001")),
              fact_type: "relationship",
              value: "child of Jim Neal",
              structured_value: { relationship_type: spelling },
            },
          },
        ],
      });
      expect(r.ok, `${spelling}: ${r.ok ? "" : errorsOf(r)?.join(" ")}`).toBe(true);
    }
  });

  it("binds extraction_append too, which is the path record-extractor uses", async () => {
    // `extractionAppend` delegates to `researchAppend`, so one precondition
    // covers both writers — but nothing tested the delegated path, and it is
    // the one the agent this card edits actually calls.
    await writeProject();
    const r = await extractionAppend({
      projectPath: dir,
      ops: [
        {
          section: "assertions",
          op: "append",
          entry: {
            ...noId(validAssertion("x", "src_001")),
            fact_type: "relationship",
            value: "sibling of Grace (Whitaker) Tolman",
            structured_value: {
              relationship_type: "child",
              related_person_role: "sibling_1",
            },
          },
        },
      ],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(failure(r).errors?.join(" ")).toMatch(/states the subject is a sibling/);
  });

  it("refuses a capitalised value — the case-insensitive flag is load-bearing", async () => {
    const r = await appendRelationship("Sibling of Grace (Whitaker) Tolman", {
      relationship_type: "child",
      related_person_role: "sibling_1",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toMatch(/states the subject is a sibling/);
  });

  it("accepts a role word followed by a colon rather than \"named as\"", async () => {
    const r = await appendRelationship("father of the bride: Jan Roelfs Harkema", {
      relationship_type: "child",
      related_person_role: "father_of_bride",
    });
    expect(r.ok).toBe(true);
  });

  it("leaves a legacy assertion editable for unrelated fields", async () => {
    // The spec promises "a project holding an assertion written before this
    // rule stays writable". The update arm validates the MERGED entry, so an
    // unconditional call breaks that promise for the commonest edit there is:
    // `research_append` resolves and writes `standard_place` on every
    // place-carrying assertion. Scoped to ops that set `value` or
    // `structured_value`, per the place-containment row's precedent.
    await writeProject();
    const added = await researchAppend({
      projectPath: dir,
      ops: [
        {
          section: "assertions",
          op: "append",
          entry: {
            ...noId(validAssertion("x", "src_001")),
            fact_type: "relationship",
            value: "child of Jim Neal",
            structured_value: { relationship_type: "child" },
          },
        },
      ],
    });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    const id = (added as any).results[0].entryId;

    // Make it legacy-shaped by hand: a contradiction the rule would refuse.
    const research = JSON.parse(
      await readFile(join(dir, "research.json"), "utf-8"),
    );
    const bad = research.assertions.find((a: any) => a.id === id);
    bad.structured_value.relationship_type = "parent";
    await writeFile(join(dir, "research.json"), JSON.stringify(research, null, 2));

    const r = await researchAppend({
      projectPath: dir,
      section: "assertions",
      op: "update",
      entryId: id,
      fields: { place: "Schuylkill County, Pennsylvania" },
    });
    expect(r.ok).toBe(true);
  });

  it("does not reach past fact_type relationship", async () => {
    // The refusal-table row and the measurement script both scope to
    // `fact_type: relationship`. 81 corpus assertions outside it carry a
    // categorised `relationship_type` — `marriage` most of them — and none
    // would be refused today, but a guard reaching a population nobody
    // measured is a rate nobody can trust.
    await writeProject();
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        {
          section: "assertions",
          op: "append",
          entry: {
            ...noId(validAssertion("x", "src_001")),
            fact_type: "marriage",
            value: "child of Jim Neal",
            structured_value: { relationship_type: "parent" },
          },
        },
      ],
    });
    expect(r.ok).toBe(true);
  });

  it("ACCEPTS the sibling value the agent body now instructs", async () => {
    // The satisfying value. The agent body names `sibling`, the refusal
    // message advertises it verbatim, and ADR-0011 limit 2 turns on a caller
    // being able to reach a legal state — but nothing proved the writer takes
    // it. Ship the deny without this and a sister typed `child` is refused
    // into a value the writer might also reject.
    const r = await appendRelationship("sibling of Grace (Whitaker) Tolman", {
      relationship_type: "sibling",
      related_person_role: "sibling_1",
    });
    expect(r.ok).toBe(true);
  });

  it("accepts a correctly directed relationship", async () => {
    const r = await appendRelationship("child of Jim Neal", {
      relationship_type: "child",
      related_person_role: "father_of_deceased",
    });
    expect(r.ok).toBe(true);
  });
});

describe("research_append — negative evidence role invariant", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ra-negev-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writeProject(research: any = baseResearch(), tree: any = baseTree) {
    await writeFile(join(dir, "research.json"), JSON.stringify(research, null, 2));
    await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify(tree, null, 2));
  }

  it("rejects record_basis: absent with a non-absent record_role", async () => {
    await writeProject();
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        {
          section: "assertions",
          op: "append",
          entry: {
            ...noId(validAssertion("x", "src_001")),
            record_role: "father_of_deceased",
            record_basis: "absent",
          },
        },
      ],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toMatch(/negative evidence always uses the literal record_role "absent"/);
  });

  it("rejects record_role: absent paired with a non-negative record_basis", async () => {
    await writeProject();
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        {
          section: "assertions",
          op: "append",
          entry: {
            ...noId(validAssertion("x", "src_001")),
            record_role: "absent",
            record_basis: "stated",
          },
        },
      ],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toMatch(/record_role "absent" \(the PERSON was not in the record\) is reserved for/);
  });

  it("accepts record_basis: absent paired with record_role: absent", async () => {
    await writeProject();
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        {
          section: "assertions",
          op: "append",
          entry: {
            ...noId(validAssertion("x", "src_001")),
            record_role: "absent",
            informant_proximity: "researcher",
            record_basis: "absent",
          },
        },
      ],
    });
    expect(r.ok).toBe(true);
  });

  it("re-checks the invariant on update, against the merged (not just patched) fields", async () => {
    await writeProject();
    const created = await researchAppend({
      projectPath: dir,
      ops: [
        {
          section: "assertions",
          op: "append",
          entry: {
            ...noId(validAssertion("x", "src_001")),
            record_role: "absent",
            informant_proximity: "researcher",
            record_basis: "absent",
          },
        },
      ],
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const entryId = (created as any).results[0].entryId as string;

    // Flips record_basis back to direct without also fixing record_role —
    // the merged result violates the invariant even though this one update
    // only names one field.
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        { section: "assertions", op: "update", entryId, fields: { record_basis: "stated" } },
      ],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toMatch(/record_role "absent" \(the PERSON was not in the record\) is reserved for/);
  });

  it("the role message names the predeceased case and the two-field fix", async () => {
    // Fires the ROLE arm (record_role is NOT absent), which the proximity
    // tests below never reach. Without this, reverting the role message to its
    // pre-#986 wording left all 497 tests green: the pre-existing test matches
    // "negative evidence always uses the literal record_role \"absent\"",
    // a phrase common to both wordings.
    await writeProject();
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        {
          section: "assertions",
          op: "append",
          entry: {
            ...noId(validAssertion("x", "src_001")),
            record_role: "spouse_1",
            informant_proximity: "researcher",
            record_basis: "absent",
          },
        },
      ],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    // The predeceased carve-out: record-extractor.md calls this "equally
    // common", and a message claiming a stated fact is always `direct` would
    // send exactly this shape the wrong way.
    expect(r.errors[0]).toMatch(/even when the record NAMES the person/);
    expect(r.errors[0]).toMatch(/change both fields/);
    expect(r.errors[0]).toMatch(/write no assertion/);
  });

  it("no message prescribes a fix another arm refuses", async () => {
    // Regression guard. The first proximity message said "it is record_basis
    // \"direct\", not \"negative\" — change that rather than the proximity",
    // and following that instruction on an absent-role assertion was refused
    // by the converse role arm. A message that buys the wrong relabel
    // reproduces the failure this whole change exists to stop.
    await writeProject();
    const violating = {
      ...noId(validAssertion("x", "src_001")),
      record_role: "absent",
      informant_proximity: "official_duty",
      record_basis: "absent",
    };
    const first = await researchAppend({
      projectPath: dir,
      ops: [{ section: "assertions", op: "append", entry: violating }],
    });
    expect(first.ok).toBe(false);
    if (first.ok) return;

    // Whatever the message says, the edit it prescribes must be ACCEPTED.
    const prescribed = await researchAppend({
      projectPath: dir,
      ops: [{
        section: "assertions", op: "append",
        entry: { ...violating, informant_proximity: "researcher" },
      }],
    });
    expect(prescribed.ok).toBe(true);

    // And it must not tell the caller to flip record_basis on its own, which
    // the converse role arm refuses.
    expect(first.errors[0]).not.toMatch(/change that rather than the proximity/);
    const evidenceTypeOnly = await researchAppend({
      projectPath: dir,
      ops: [{
        section: "assertions", op: "append",
        entry: { ...violating, record_basis: "stated" },
      }],
    });
    expect(evidenceTypeOnly.ok).toBe(false);
  });

  // ── The informant_proximity clause (#986).
  //
  // Each of these asserts validateNegativeEvidenceRole's OWN message rather
  // than `ok === false`. That is load-bearing: the document-tier rule in
  // validator.ts refuses the same append through validateIntroduced, so a bare
  // `ok === false` passes with this whole clause reverted and proves nothing.

  it("rejects record_basis: absent with a non-researcher informant_proximity", async () => {
    await writeProject();
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        {
          section: "assertions",
          op: "append",
          entry: {
            ...noId(validAssertion("x", "src_001")),
            record_role: "absent",
            informant_proximity: "self",
            record_basis: "absent",
          },
        },
      ],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    // A phrase unique to THIS tier AT RUNTIME. The document tier refuses the
    // same append, so any phrase the two messages share passes with this whole
    // clause reverted. Break-testing caught that twice: first on "negative
    // evidence is the researcher's own conclusion", then again on "no record
    // informant reported an absence" after the validator message was reworded
    // to include it. Check both messages before changing this regex.
    expect(r.errors[0]).toMatch(/changing record_basis alone is refused/);
  });

  it("names the absence test as the discriminator, not just the field to change", async () => {
    // The refusal message is the part with evidence behind it: in
    // ut_record_extraction_028 the role arm's field-naming message bought a
    // relabel (record_role flipped to "absent", same blank-field defect
    // re-sent and accepted). So this message must give the caller a way to
    // tell whether the assertion is negative evidence AT ALL — the Charles
    // Ferber shape (a marital status the record states) is a mislabel, not a
    // proximity slip. It must do that WITHOUT prescribing an edit the
    // converse role arm then refuses; the test below pins that half.
    await writeProject();
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        {
          section: "assertions",
          op: "append",
          entry: {
            ...noId(validAssertion("x", "src_001")),
            record_role: "absent",
            informant_proximity: "self",
            record_basis: "absent",
          },
        },
      ],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toMatch(/not an absence at all/);
    expect(r.errors[0]).toMatch(/record_role must change from "absent"/);
  });

  it("re-checks the proximity clause on update, against the merged fields", async () => {
    // Seeded by writing research.json DIRECTLY, never by appending through
    // research_append — an append of this shape is refused by the document
    // tier too, so seeding that way could not reach the update at all. The
    // update then names an UNRELATED field: this is the one shape validator.ts
    // cannot also refuse, because #1572's tolerance demotes a pre-existing
    // error, and so it is the only proof this clause adds reach of its own.
    const research = baseResearch();
    research.assertions = [
      { ...validAssertion("a_001", "src_001"), record_role: "absent",
        informant_proximity: "self", record_basis: "absent" },
    ] as any;
    await writeProject(research);
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        { section: "assertions", op: "update", entryId: "a_001", fields: { value: "1851" } },
      ],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toMatch(/changing record_basis alone is refused/);
  });

  it("accepts the update once the same call also fixes the proximity (self-healing)", async () => {
    // The freeze above is deliberate but must not be a dead end: the check
    // runs on the MERGED entry, so the repair rides in the same call.
    const research = baseResearch();
    research.assertions = [
      { ...validAssertion("a_001", "src_001"), record_role: "absent",
        informant_proximity: "self", record_basis: "absent" },
    ] as any;
    await writeProject(research);
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        { section: "assertions", op: "update", entryId: "a_001",
          fields: { value: "1851", informant_proximity: "researcher" } },
      ],
    });
    expect(r.ok).toBe(true);
  });

  it("accepts a plain direct assertion carrying a non-researcher proximity", async () => {
    // The other direction: the clause must not leak onto non-negative rows.
    await writeProject();
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        {
          section: "assertions",
          op: "append",
          entry: {
            ...noId(validAssertion("x", "src_001")),
            record_role: "deceased",
            informant_proximity: "official_duty",
            record_basis: "stated",
          },
        },
      ],
    });
    expect(r.ok).toBe(true);
  });

  it("reports BOTH arms at once when an entry is wrong on both fields", async () => {
    // a_012's pre-retag shape. Throwing the role arm first hid the proximity
    // error until the caller had spent a round trip, which is this change's own
    // thesis (a one-field refusal buys a relabel) turned on itself.
    await writeProject();
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        {
          section: "assertions",
          op: "append",
          entry: {
            ...noId(validAssertion("x", "src_001")),
            record_role: "deceased",
            informant_proximity: "family_not_present",
            record_basis: "absent",
          },
        },
      ],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    // ARM-UNIQUE phrases. `record_role "absent"` now appears in BOTH messages,
    // because each one spells out the conforming shape — so matching it counts
    // two and proves nothing about which arms fired.
    expect(r.errors.filter((e) => /always uses the literal record_role/.test(e))).toHaveLength(1);
    expect(r.errors.filter((e) => /changing record_basis alone is refused/.test(e))).toHaveLength(1);
  });

  // ── The field-ABSENT shape. Both arms decide it deliberately (no presence
  // guard, so `!==` is true for a missing key and the rule still fires), and
  // nothing pinned that: two different ways of adding a presence guard each
  // left all 298 tests green.

  it("still refuses a negative whose record_role key is missing entirely", async () => {
    await writeProject();
    const entry: Record<string, unknown> = {
      ...noId(validAssertion("x", "src_001")),
      informant_proximity: "researcher",
      record_basis: "absent",
    };
    delete entry.record_role;
    const r = await researchAppend({
      projectPath: dir,
      ops: [{ section: "assertions", op: "append", entry } as any],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    // Assert THIS arm fired, not merely that the call failed: the document
    // tier's checkRequired refuses a missing record_role anyway, so `ok ===
    // false` stays true with a presence guard added here and proves nothing.
    // Break-testing caught exactly that.
    expect(r.errors.some((e) => /always uses the literal record_role/.test(e))).toBe(true);
  });

  it("still refuses a negative whose informant_proximity key is missing entirely", async () => {
    await writeProject();
    const entry: Record<string, unknown> = {
      ...noId(validAssertion("x", "src_001")),
      record_role: "absent",
      record_basis: "absent",
    };
    delete entry.informant_proximity;
    const r = await researchAppend({
      projectPath: dir,
      ops: [{ section: "assertions", op: "append", entry } as any],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => /changing record_basis alone is refused/.test(e))).toBe(true);
  });

  it("does not fire for non-assertion sections (no record_basis field)", async () => {
    await writeProject();
    const r = await researchAppend({
      projectPath: dir,
      ops: [{ section: "sources", op: "append", entry: noId(validSource("x")) }],
    });
    expect(r.ok).toBe(true);
  });
});

describe("research_append — sources-without-assertions nudge (#1478)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "research-append-1478-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  // A project with n sources and m assertions, all valid. Sources carry
  // gedcomx_source_description_id "SD-001" (present in baseTree), which also
  // keeps source-reuse auto-detection from engaging on the appended source —
  // reuse needs a source append with NO S id plus an assertion in the same
  // batch (§3.4.1), neither of which these single-source appends do.
  const researchWith = (nSources: number, nAssertions: number) => ({
    ...baseResearch(),
    sources: Array.from({ length: nSources }, (_, i) => validSource(`src_${String(i + 1).padStart(3, "0")}`)),
    assertions: Array.from({ length: nAssertions }, (_, i) =>
      validAssertion(`a_${String(i + 1).padStart(3, "0")}`, "src_001"),
    ),
  });
  const write = async (research: any) => {
    await writeFile(join(dir, "research.json"), JSON.stringify(research, null, 2));
    await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify(baseTree, null, 2));
  };
  const WARN = /source\(s\) recorded but zero assertions drawn from them/;
  const warned = (warnings: string[]) => warnings.some((w) => WARN.test(w));

  it("warns when a source lands leaving ≥3 sources and 0 assertions — and never blocks", async () => {
    await write(researchWith(3, 0));
    const r = await researchAppend({ projectPath: dir, section: "sources", op: "append", entry: noId(validSource("x")) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // never blocks: the source still persisted
    expect(r.filesWritten).toContain("research.json");
    const research = JSON.parse(await readFile(join(dir, "research.json"), "utf-8"));
    expect(research.sources).toHaveLength(4);
    const warn = r.validation.warnings.find((w) => WARN.test(w));
    expect(warn, "expected the sources-without-assertions warning").toBeTruthy();
    expect(warn).toContain("4 source(s)"); // post-write total, not the batch count
  });

  it("stays silent below the threshold (2 sources, 0 assertions)", async () => {
    await write(researchWith(1, 0));
    const r = await researchAppend({ projectPath: dir, section: "sources", op: "append", entry: noId(validSource("x")) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(warned(r.validation.warnings)).toBe(false);
  });

  it("stays silent when any assertion already exists", async () => {
    await write(researchWith(5, 1));
    const r = await researchAppend({ projectPath: dir, section: "sources", op: "append", entry: noId(validSource("x")) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(warned(r.validation.warnings)).toBe(false);
  });

  it("does not nag an unrelated write that adds no source", async () => {
    await write(researchWith(5, 0));
    const { id: _o, created: _c, ...q } = validQuestion("x");
    const r = await researchAppend({ projectPath: dir, section: "questions", op: "append", entry: q });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(warned(r.validation.warnings)).toBe(false);
  });

  it("fires through extraction_append with a tool-neutral message", async () => {
    await write(researchWith(3, 0));
    const r = await extractionAppend({ projectPath: dir, section: "sources", op: "append", entry: noId(validSource("x")) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const warn = r.validation.warnings.find((w) => WARN.test(w));
    expect(warn).toBeTruthy();
    // record-extractor is denied research_append — the nudge must not name it
    expect(warn).not.toContain("research_append");
  });
});

// #1006: warn-only (the write still succeeds) when a `confident` person_evidence
// link records no numeric match_score. Distinct from the epistemic gate above,
// which REJECTS — this only adds an advisory to validation.warnings.
describe("research_append — person_evidence match_score warning (#1006)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "research-append-pe-score-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  // Clean reading (no [?]) so the epistemic gate never fires — isolates the
  // match_score warning from the rejection path.
  async function writeProject(personEvidence: any[] = []) {
    const r = baseResearch();
    r.assertions = [
      ...r.assertions,
      { ...validAssertion("a_010"), record_id: "rec_A", fact_type: "name", value: "Father: Thomas Flynn" },
    ] as any;
    r.person_evidence = personEvidence as any;
    await writeFile(join(dir, "research.json"), JSON.stringify(r, null, 2));
    await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify(baseTree, null, 2));
  }

  const link = (overrides: any = {}) => ({
    projectPath: dir,
    section: "person_evidence",
    op: "append" as const,
    entry: {
      assertion_id: "a_010",
      person_id: "I1",
      confidence: "confident",
      rationale: "Names match the subject.",
      match_score: null,
      created: "2026-07-18",
      superseded_by: null,
      ...overrides,
    },
  });

  it("warns, but still writes, when a confident link records no match_score", async () => {
    await writeProject();
    const r = await researchAppend(link({ match_score: null }));
    expect(r.ok).toBe(true); // warn-only: the write is NOT blocked
    if (!r.ok) return;
    expect(r.validation.warnings.join(" ")).toMatch(/records no usable match_score/);
    const saved = JSON.parse(await readFile(join(dir, "research.json"), "utf-8"));
    expect(saved.person_evidence).toHaveLength(1);
  });

  it("does not warn when a confident link carries a numeric match_score", async () => {
    await writeProject();
    const r = await researchAppend(link({ match_score: 0.92 }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.validation.warnings.join(" ")).not.toMatch(/match_score/);
  });

  it("still warns when match_score is a number outside 0–1 — validator.ts does not bound the range", async () => {
    // The runtime validator carries match_score in its field allow-list but does
    // not enforce the schema's 0–1 minimum/maximum, so an out-of-range number is
    // accepted at the write and would otherwise silence the warning (review #1550).
    await writeProject();
    const r = await researchAppend(link({ match_score: 5 }));
    expect(r.ok).toBe(true); // not rejected — the range is unenforced at runtime
    if (!r.ok) return;
    expect(r.validation.warnings.join(" ")).toMatch(/records no usable match_score/);
  });

  it("warns on a probable link too — the gate is reachability, not confidence (#1429)", async () => {
    // Was the inverse assertion until #1429. Gating on `confident` meant the
    // warning said nothing at all about the ~two-thirds of links written at
    // `probable`, which is exactly where a skipped score hides: measured in
    // v1_2026-08-27_11-28-52, ut_person_evidence_022/_024 each wrote probable
    // links with a null score and no same_person call anywhere in the run.
    await writeProject();
    const r = await researchAppend(link({ confidence: "probable", match_score: null }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.validation.warnings.join(" ")).toMatch(/records no usable match_score/);
  });

  // --- the reachability gate itself (#1429) ---------------------------------
  // Silent where nothing could be scored, loud with a named route where
  // something could. Before #1429 this warning knew nothing about provenance:
  // it fired on image- and full-text-sourced links nothing can ever score, and
  // its escape ("if no comparable FamilySearch persona exists to score against,
  // leave match_score null") invited the agent to read a null
  // `record_persona_id` as that case. It is not: `same_person` never reads that
  // field.

  /** A project whose a_010 hangs off one log entry of the given shape. */
  async function writeProjectWithProvenance(
    logEntry: Record<string, unknown>,
    assertionOverrides: Record<string, unknown> = {},
  ) {
    const r = baseResearch();
    r.log = [logEntry] as any;
    r.assertions = [
      ...r.assertions,
      {
        ...validAssertion("a_010"),
        record_id: "https://www.familysearch.org/ark:/61903/1:1:MXHY-TP4",
        fact_type: "name",
        value: "Father: Thomas Flynn",
        log_entry_id: logEntry.id,
        ...assertionOverrides,
      },
    ] as any;
    await writeFile(join(dir, "research.json"), JSON.stringify(r, null, 2));
    await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify(baseTree, null, 2));
  }

  const unreachable: [string, Record<string, unknown>][] = [
    // An FTS result carries transcript text, names and places but no gedcomx —
    // and a retained sidecar does not change that, which is why this lane is
    // exempt even WITH a results_ref.
    ["fulltext_search with a retained sidecar", { id: "log_001", tool: "fulltext_search", results_ref: "results/log_001.json" }],
    ["fulltext_search with no sidecar", { id: "log_001", tool: "fulltext_search", results_ref: null }],
    ["image_transcribe", { id: "log_001", tool: "image_transcribe", results_ref: null }],
    ["image_read", { id: "log_001", tool: "image_read", results_ref: null }],
    ["external_site", { id: "log_001", tool: "external_site", results_ref: null }],
    ["record_search whose sidecar was not retained", { id: "log_001", tool: "record_search", results_ref: null }],
  ];

  it.each(unreachable)("stays silent when the assertion came from %s", async (_label, logEntry) => {
    await writeProjectWithProvenance(logEntry);
    const r = await researchAppend(link({ match_score: null }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.validation.warnings.join(" ")).not.toMatch(/match_score/);
  });

  // Since #1731 the warning names ONE call whatever the provenance, because
  // `same_person`'s project-relative arm resolves the record itself. The three
  // tests these replace pinned a per-route retrieval recipe (record_read /
  // sidecar / record_persona_id), and each told the agent to hand-build a
  // `primaryId1` — the expensive shape the 94% skip rate was a symptom of.
  // Still pinned: the warning names the CALL, not just the absence. A warning
  // that only says "missing" is what the agent talked its way past.
  for (const [name, entry] of [
    ["record_read", { id: "log_001", tool: "record_read", results_ref: null }],
    ["a retained sidecar", { id: "log_001", tool: "record_search", results_ref: "results/log_001.json" }],
  ] as const) {
    it(`names the project-relative call when the assertion came from ${name}`, async () => {
      await writeProjectWithProvenance(entry as any);
      const r = await researchAppend(link({ match_score: null }));
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const w = r.validation.warnings.join(" ");
      expect(w).toMatch(/records no usable match_score/);
      expect(w).toMatch(/call same_person\(/);
      expect(w).toMatch(/assertionId: 'a_010'/);
      expect(w).toMatch(/treePersonId: 'I1'/);
      // The retired shape must not come back: naming it steers the agent
      // straight back to the cost this card exists to remove.
      expect(w).not.toMatch(/primaryId1/);
      expect(w).not.toMatch(/gedcomx1/);
    });
  }

  it("tells a two-party assertion to name which party the link is about", async () => {
    await writeProjectWithProvenance(
      { id: "log_001", tool: "record_search", results_ref: "results/log_001.json" },
      { record_persona_id: "p_293161675629", fact_type: "relationship", record_role: "groom" },
    );
    const r = await researchAppend(link({ match_score: null }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const w = r.validation.warnings.join(" ");
    expect(w).toMatch(/recordRole/);
    expect(w).toMatch(/'groom'/);
  });

  it("does NOT ask a single-party assertion to name a party", async () => {
    // The other direction: the recordRole sentence is noise on an assertion
    // that names only one person, and noise in a warning is how the whole
    // warning stops being read.
    await writeProjectWithProvenance(
      { id: "log_001", tool: "record_search", results_ref: "results/log_001.json" },
      { record_persona_id: "p_293161675629" },
    );
    const r = await researchAppend(link({ match_score: null }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.validation.warnings.join(" ")).not.toMatch(/recordRole/);
  });

  it("warns on unresolvable provenance — an absent log_entry_id is not an exemption", async () => {
    // Exempting on a MISSING field is the bypass this gate exists to refuse:
    // write the assertion with no log_entry_id and the requirement would vanish.
    await writeProject();
    const r = await researchAppend(link({ match_score: null }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.validation.warnings.join(" ")).toMatch(/records no usable match_score/);
  });

  it("names the circular case as a legitimate null, so it does not badger a minted stub", async () => {
    // The warning drove ut_person_evidence_n7v to score the groom persona against
    // the stub it had just minted from that persona (v1_2026-08-27_12-36-32) — a
    // comparison that can only confirm itself. The tool cannot DETECT the case
    // (by write time the stub is an ordinary tree person), so the text has to
    // name it as a sanctioned exception.
    await writeProjectWithProvenance({ id: "log_001", tool: "record_read", results_ref: null });
    const r = await researchAppend(link({ match_score: null }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const w = r.validation.warnings.join(" ");
    expect(w).toMatch(/minted from the very persona/);
    expect(w).toMatch(/circular/);
  });

  it("tells the agent a null record_persona_id is not a reason to skip", async () => {
    // The old text's escape, inverted. same_person takes two gedcomx documents
    // plus a focus id inside each and never reads record_persona_id.
    await writeProjectWithProvenance({ id: "log_001", tool: "record_read", results_ref: null });
    const r = await researchAppend(link({ match_score: null }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const w = r.validation.warnings.join(" ");
    expect(w).toMatch(/null record_persona_id is\s+NOT a reason to skip/);
    expect(w).not.toMatch(/no comparable FamilySearch persona exists/);
  });
});

describe("research_append — the two exhaustiveness gates (#1335, Phase 4)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "research-append-exh-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  /** A project with one question and one plan whose items carry the given
   *  statuses. `planQuestionId` defaults to the question, so a caller can point
   *  the plan at a DIFFERENT question to exercise the matching rule. */
  function exhResearch(itemStatuses: string[], planQuestionId = "q_001") {
    const r = baseResearch();
    r.questions = [validQuestion("q_001")];
    const plan: any = validPlan("pl_001", planQuestionId);
    plan.items = itemStatuses.map((status, i) => ({
      ...validPlanItem(),
      id: `pli_00${i + 1}`,
      sequence: i + 1,
      status,
    }));
    r.plans = [plan];
    return r;
  }
  async function writeProject(research: any) {
    await writeFile(join(dir, "research.json"), JSON.stringify(research, null, 2));
    await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify(baseTree, null, 2));
  }
  const DECLARATION = {
    declared: true,
    justification: "Census, vital and probate all searched; three independent sources agree.",
    log_entry_ids: ["log_001"],
    stop_criteria: {
      goal_alignment: "Yes — three sources name the father.",
      repository_breadth: "Census, vital records and probate searched.",
      original_substitution: "Originals accessed.",
      independent_verification: "Three independent informants.",
      evidence_class: "1860 census, original/primary.",
      conflict_resolution: "No conflicts identified.",
      overturn_risk: "Low.",
    },
  };

  // --- G2: the plan-completeness gate ------------------------------------

  it("refuses a declaration while a plan item is in_progress, and names the item", async () => {
    await writeProject(exhResearch(["completed", "in_progress"]));
    const r = await researchAppend({
      projectPath: dir,
      section: "questions",
      op: "update",
      entryId: "q_001",
      fields: { exhaustive_declaration: DECLARATION },
    });
    const errs = failure(r).errors.join(" ");
    expect(errs).toMatch(/pli_002/);
    expect(errs).toMatch(/in_progress/);
  });

  it("refuses the antonio-lucas-spouse shape: the item flips are BATCHED ahead of the declaration", async () => {
    // The corpus call issue #1335 was filed from is one research_append with
    // three ops — the pli flips first, the declaration last. Read LIVE those
    // flips satisfy the gate the declaration must pass, so the run that
    // motivated this whole phase would sail through. This vector is the reason
    // G2 reads the pre-call snapshot, and a single-op vector cannot pin it.
    await writeProject(exhResearch(["in_progress", "planned"]));
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        { section: "plan_items", op: "update", planId: "pl_001", entryId: "pli_001", fields: { status: "completed" } },
        { section: "plan_items", op: "update", planId: "pl_001", entryId: "pli_002", fields: { status: "skipped" } },
        { section: "questions", op: "update", entryId: "q_001", fields: { exhaustive_declaration: DECLARATION } },
      ],
    } as any);
    expect(failure(r).errors.join(" ")).toMatch(/pli_001/);
  });

  it("allows a declaration when every item is completed or skipped", async () => {
    await writeProject(exhResearch(["completed", "skipped"]));
    const r = await researchAppend({
      projectPath: dir,
      section: "questions",
      op: "update",
      entryId: "q_001",
      fields: { exhaustive_declaration: DECLARATION },
    });
    expect(singleOk(r).ok).toBe(true);
  });

  it("allows a declaration while items are still `planned` — the licensed early consultation", async () => {
    // research/SKILL.md routes here deliberately before the plan is drained.
    // 122 corpus items sit at `planned` across 31 correct declarations; a gate
    // built from the skill body's stricter opening sentence refuses all 31.
    await writeProject(exhResearch(["completed", "planned", "planned"]));
    const r = await researchAppend({
      projectPath: dir,
      section: "questions",
      op: "update",
      entryId: "q_001",
      fields: { exhaustive_declaration: DECLARATION },
    });
    expect(singleOk(r).ok).toBe(true);
  });

  it("ignores an in_progress item on a plan belonging to a DIFFERENT question", async () => {
    // Synthetic: all 205 corpus plans carry a question_id, so the looser
    // reading that also counts unattached plans is indistinguishable on real
    // data. This vector is the only thing pinning the matching rule.
    await writeProject(exhResearch(["in_progress"], "q_999"));
    const r = await researchAppend({
      projectPath: dir,
      section: "questions",
      op: "update",
      entryId: "q_001",
      fields: { exhaustive_declaration: DECLARATION },
    });
    expect(singleOk(r).ok).toBe(true);
  });

  it("the refusal names no plan_items action — the agent's lane cannot reach it", async () => {
    // After the conversion the agent holds {questions} and no plan_items write.
    // A refusal telling it to complete or skip the item names a locked door,
    // which guard_project_files.py's OWNER_REASON comment records as the thing
    // that produces bypasses. It also must not invite the status flip, which is
    // the falsification route. Naming the blocking item and stopping is the
    // whole message.
    await writeProject(exhResearch(["in_progress"]));
    const errs = failure(await researchAppend({
      projectPath: dir,
      section: "questions",
      op: "update",
      entryId: "q_001",
      fields: { exhaustive_declaration: DECLARATION },
    })).errors.join(" ");
    expect(errs).not.toMatch(/mark .{0,20}(completed|skipped)/i);
    expect(errs).not.toMatch(/updat\w* (its|the item's) status/i);
    expect(errs).not.toMatch(/set .{0,20}status/i);
  });

  // --- G1: the declaration/status agreement gate ---------------------------

  it("refuses status exhaustive_declared when the declaration does not carry it", async () => {
    // Synthetic — zero corpus instances across the 125 ops that set this
    // status. The shape is reachable: exhaustive_declaration is a required
    // question property so it is always present, and 219 corpus writes set
    // declared:false.
    await writeProject(exhResearch(["completed"]));
    const errs = failure(await researchAppend({
      projectPath: dir,
      section: "questions",
      op: "update",
      entryId: "q_001",
      fields: { status: "exhaustive_declared" },
    })).errors.join(" ");
    expect(errs).toMatch(/exhaustive_declaration\.declared/);
  });

  it("allows the status and the declaration set in the SAME op", async () => {
    // 123 of 125 corpus ops take this shape. A pre-call snapshot here would
    // refuse every one of them, which is why G1 reads the merged entry.
    await writeProject(exhResearch(["completed"]));
    const r = await researchAppend({
      projectPath: dir,
      section: "questions",
      op: "update",
      entryId: "q_001",
      fields: { status: "exhaustive_declared", exhaustive_declaration: DECLARATION },
    });
    expect(singleOk(r).ok).toBe(true);
  });


  // --- vectors from the high-effort code review -------------------------

  it("a superseded plan's stale in_progress item does not block forever", async () => {
    // research-plan supersedes by flipping `plans.status` alone — items keep
    // whatever status they held — and then forbids touching that plan again.
    // Blocking on its items makes the declaration permanently unwritable: the
    // agent may not reach plan_items, and the search skills may not edit a
    // superseded plan. ADR-0011's first limit is exactly this.
    const research = exhResearch(["completed"]);
    const stale: any = validPlan("pl_000", "q_001", "superseded");
    stale.items = [{ ...validPlanItem(), id: "pli_099", status: "in_progress" }];
    (research.plans as any[]).unshift(stale);
    await writeProject(research);
    const r = await researchAppend({
      projectPath: dir,
      section: "questions",
      op: "update",
      entryId: "q_001",
      fields: { exhaustive_declaration: DECLARATION },
    });
    expect(singleOk(r).ok).toBe(true);
  });

  it("a completed plan's items do not block either", async () => {
    const research = exhResearch(["completed"]);
    const done: any = validPlan("pl_000", "q_001", "completed");
    done.items = [{ ...validPlanItem(), id: "pli_098", status: "in_progress" }];
    (research.plans as any[]).unshift(done);
    await writeProject(research);
    expect(singleOk(await researchAppend({
      projectPath: dir,
      section: "questions",
      op: "update",
      entryId: "q_001",
      fields: { exhaustive_declaration: DECLARATION },
    })).ok).toBe(true);
  });

  it("refuses lowering `declared` to false while the status still claims exhaustive", async () => {
    // The mirror image of the status-side vector, and the one a status-only
    // gate misses. It is the agent's own documented re-invocation path: write
    // `declared: false`, leave `status` alone — which on an already-declared
    // question leaves `exhaustive_declared` standing over nothing.
    const research = exhResearch(["completed"]);
    (research.questions[0] as any).exhaustive_declaration = DECLARATION;
    (research.questions[0] as any).status = "exhaustive_declared";
    await writeProject(research);
    const errs = failure(await researchAppend({
      projectPath: dir,
      section: "questions",
      op: "update",
      entryId: "q_001",
      fields: {
        exhaustive_declaration: {
          declared: false,
          justification: "Terminating: probate destroyed in an 1862 fire.",
          log_entry_ids: ["log_001"],
          stop_criteria: null,
        },
      },
    })).errors.join(" ");
    expect(errs).toMatch(/exhaustive_declaration\.declared/);
  });

  it("allows the status when the declaration landed in an EARLIER call", async () => {
    // The hannah-earnest-children / jens-nielsen shape: declare at one call,
    // flip the status at the next. Both were misread as violations while the
    // replay engine was dropping stripped updates.
    const research = exhResearch(["completed"]);
    (research.questions[0] as any).exhaustive_declaration = DECLARATION;
    await writeProject(research);
    const r = await researchAppend({
      projectPath: dir,
      section: "questions",
      op: "update",
      entryId: "q_001",
      fields: { status: "exhaustive_declared" },
    });
    expect(singleOk(r).ok).toBe(true);
  });
});

describe("research_append — the declaring worked example is aimed, not blanket", () => {
  // The example teaches the seven-key stop_criteria object, and it is attached
  // to a REJECTION. Returning it for every failing `questions` update handed a
  // caller refused on, say, a `resolved` write a full `declared: true` payload
  // — which on the main thread is the one shape the plugin hook denies. A hint
  // that teaches the next refusal is worse than no hint.
  it("teaches the seven keys when the failing op named exhaustive_declaration", () => {
    const hints = exampleHints([
      { section: "questions", op: "update", fields: ["exhaustive_declaration"] },
    ]);
    expect(hints.join("\n")).toContain("overturn_risk");
    expect(hints.join("\n")).toContain("goal_alignment");
  });

  it("falls back to the generic skeleton for any other questions update", () => {
    const hints = exampleHints([
      { section: "questions", op: "update", fields: ["status", "resolved"] },
    ]);
    expect(hints.join("\n")).not.toContain("overturn_risk");
    expect(hints.join("\n")).not.toContain("declared: true");
    expect(hints.join("\n")).toContain("only the fields you are changing");
  });

  it("falls back when the failing op names no fields at all", () => {
    const hints = exampleHints([{ section: "questions", op: "update" }]);
    expect(hints.join("\n")).not.toContain("overturn_risk");
  });
});

// ─── #2086: the `supported` evidence floor as a write-boundary precondition ──
//
// Ported from the landed eval validator
// (`eval/harness/validators/test_hypothesis_tracking.py::test_supported_requires_evidence_floor`).
// Lead ruling 2026-09-07: forward direction only, the refusal naming which half
// failed and the ids involved.
describe("supported evidence floor (#2086)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "research-append-floor-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writeProject(research: any, tree: any = baseTree) {
    await writeFile(join(dir, "research.json"), JSON.stringify(research, null, 2), "utf-8");
    await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify(tree, null, 2), "utf-8");
  }

  /** An assertion with an explicit record_basis/source_id, everything else valid. */
  const ev = (id: string, recordBasis: string, sourceId = "src_001") => ({
    ...validAssertion(id, sourceId),
    record_basis: recordBasis,
  });

  const hyp = (over: Record<string, unknown> = {}) => ({
    ...validHypothesis(),
    id: "h_001",
    ...over,
  });

  // ── Deny: three input shapes, each walking a different path into the gate ──

  it("rejects promoting a hypothesis to supported on a single indirect assertion", async () => {
    const research = baseResearch();
    research.sources = [validSource("src_001")];
    research.assertions = [ev("a_001", "inferred", "src_001")];
    await writeProject(research);

    const { id: _omit, ...entry } = hyp({
      status: "supported",
      supporting_assertion_ids: ["a_001"],
    });
    const r = await researchAppend({
      projectPath: dir,
      section: "hypotheses",
      op: "append",
      entry,
    } as never);

    expect(r.ok).toBe(false);
    const joined = failure(r).errors.join("\n");
    expect(joined).toMatch(/no stated supporting assertion/);
    expect(joined).toMatch(/only 1 distinct inferred source/);
    expect(joined).toMatch(/needs >=1 record_basis "stated" or >=2 distinct sources at record_basis "inferred"/);
  });

  it("rejects an update to supported when two indirect assertions share one source", async () => {
    const research = baseResearch();
    research.sources = [validSource("src_001")];
    research.assertions = [ev("a_001", "inferred", "src_001"), ev("a_002", "inferred", "src_001")];
    research.hypotheses = [hyp({ supporting_assertion_ids: ["a_001", "a_002"] })];
    await writeProject(research);

    const r = await researchAppend({
      projectPath: dir,
      section: "hypotheses",
      op: "update",
      entryId: "h_001",
      fields: { status: "supported" },
    } as never);

    expect(r.ok).toBe(false);
    const joined = failure(r).errors.join("\n");
    // Two assertions, one source ⇒ 1 distinct indirect source, not 2.
    expect(joined).toMatch(/hypotheses\[h_001\]/);
    expect(joined).toMatch(/only 1 distinct inferred source/);
  });

  it("rejects an update to supported while a conflict naming its assertions is unresolved", async () => {
    const research = baseResearch();
    research.sources = [validSource("src_001")];
    research.assertions = [ev("a_001", "stated", "src_001"), ev("a_002", "stated", "src_001")];
    research.hypotheses = [hyp({ supporting_assertion_ids: ["a_001"] })];
    research.conflicts = [
      { ...validConflict(), id: "c_001", competing_assertion_ids: ["a_001", "a_002"], status: "unresolved" },
    ];
    await writeProject(research);

    const r = await researchAppend({
      projectPath: dir,
      section: "hypotheses",
      op: "update",
      entryId: "h_001",
      fields: { status: "supported" },
    } as never);

    expect(r.ok).toBe(false);
    const joined = failure(r).errors.join("\n");
    expect(joined).toMatch(/hypotheses\[h_001\]/);
    expect(joined).toMatch(/conflict\(s\) \[c_001\] naming its assertions are unresolved/);
    // The ruling requires the refusal to say what to do, not only what is wrong.
    expect(joined).toMatch(/settle each as "resolved".*or "moot"/s);
    // Half (a) short-circuits: the evidence floor is moot once this already fails.
    expect(joined).not.toMatch(/no stated supporting assertion/);
  });

  // ── Accept: the direction a replay cannot test ──

  it("allows supported beside an unresolved conflict on the same question naming other assertions", async () => {
    // The `flynn-unresolved-conflict` shape. Matching conflicts by shared
    // `question_id` rather than by assertion overlap refuses this shipped fixture.
    const research = baseResearch();
    research.sources = [validSource("src_001")];
    research.assertions = [
      ev("a_004", "inferred", "src_001"),
      ev("a_013", "stated", "src_001"),
      ev("a_002", "inferred", "src_001"),
      ev("a_009", "inferred", "src_001"),
    ];
    research.hypotheses = [hyp({ supporting_assertion_ids: ["a_004", "a_013"] })];
    research.conflicts = [
      {
        ...validConflict(),
        id: "c_001",
        competing_assertion_ids: ["a_002", "a_009"],
        status: "unresolved",
        blocks_question_ids: ["q_001"],
      },
    ];
    await writeProject(research);

    const r = await researchAppend({
      projectPath: dir,
      section: "hypotheses",
      op: "update",
      entryId: "h_001",
      fields: { status: "supported" },
    } as never);

    expect(errorsOf(r) ?? []).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("leaves a hypothesis at active alone even when it clears the floor", async () => {
    // One-directional: the gate flags a hypothesis that IS supported and fails
    // the floor, never one that clears it and was left active.
    const research = baseResearch();
    research.sources = [validSource("src_001")];
    research.assertions = [ev("a_001", "stated", "src_001")];
    research.hypotheses = [hyp({ supporting_assertion_ids: ["a_001"] })];
    await writeProject(research);

    const r = await researchAppend({
      projectPath: dir,
      section: "hypotheses",
      op: "update",
      entryId: "h_001",
      fields: { notes: "Still gathering; not promoting yet." },
    } as never);

    expect(errorsOf(r) ?? []).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("allows supported on a single direct supporting assertion", async () => {
    const research = baseResearch();
    research.sources = [validSource("src_001")];
    research.assertions = [ev("a_001", "stated", "src_001")];
    await writeProject(research);

    const { id: _omit, ...entry } = hyp({
      status: "supported",
      supporting_assertion_ids: ["a_001"],
    });
    const r = await researchAppend({
      projectPath: dir,
      section: "hypotheses",
      op: "append",
      entry,
    } as never);

    expect(errorsOf(r) ?? []).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("allows a narrative-only update to a hypothesis already sitting at supported", async () => {
    // The gate is scoped to the op that SETS the status, so an entry promoted
    // in an earlier call — legitimately or not — stays editable.
    const research = baseResearch();
    research.sources = [validSource("src_001")];
    research.assertions = [ev("a_001", "inferred", "src_001")];
    research.hypotheses = [hyp({ status: "supported", supporting_assertion_ids: ["a_001"] })];
    await writeProject(research);

    const r = await researchAppend({
      projectPath: dir,
      section: "hypotheses",
      op: "update",
      entryId: "h_001",
      fields: { notes: "Added a paragraph about the 1860 enumeration." },
    } as never);

    expect(errorsOf(r) ?? []).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("counts an id resolving to no assertion as nothing, and still accepts", async () => {
    // Reaches the gate — an earlier version of this test left the entry at
    // `active` and sent only `notes`, so `statusTouchedThisOp` was false and the
    // predicate never ran. Deleting the `if (!a) continue` guard left the whole
    // engine suite green, which is how a vacuous test hides a load-bearing one.
    //
    // Nothing cross-references `supporting_assertion_ids` against `assertions`,
    // so a dangling id reaches the floor. Without the guard this call throws
    // `TypeError: Cannot read properties of undefined (reading 'record_basis')`
    // instead of returning a refusal.
    const research = baseResearch();
    research.sources = [validSource("src_001")];
    research.assertions = [ev("a_001", "stated", "src_001")];
    research.hypotheses = [hyp({ supporting_assertion_ids: ["a_999", "a_001"] })];
    await writeProject(research);

    const r = await researchAppend({
      projectPath: dir,
      section: "hypotheses",
      op: "update",
      entryId: "h_001",
      fields: { status: "supported" },
    } as never);

    // a_999 counts as nothing; a_001 carries the floor on its own.
    expect(errorsOf(r) ?? []).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("refuses supported when supporting_assertion_ids is empty", async () => {
    // The issue's accept-list item 5 called an empty list "unaffected, not
    // treated as violations". It is a DENY: an empty list carries no evidence,
    // so it fails half (b) — and the Python validator agrees. Measured, not
    // assumed; the PR body records that the card's wording is wrong here.
    const research = baseResearch();
    research.sources = [validSource("src_001")];
    research.assertions = [ev("a_001", "stated", "src_001")];
    research.hypotheses = [hyp({ supporting_assertion_ids: [] })];
    await writeProject(research);

    const r = await researchAppend({
      projectPath: dir,
      section: "hypotheses",
      op: "update",
      entryId: "h_001",
      fields: { status: "supported" },
    } as never);

    expect(r.ok).toBe(false);
    expect(failure(r).errors.join("\n")).toMatch(/only 0 distinct inferred source/);
  });

  it("refuses resolving a conflict and promoting on it in the same batch", async () => {
    // ADR-0011: "Snapshot when the precondition must be satisfied by someone
    // else." `conflicts` belongs to skill:conflict-resolution, not to
    // hypothesis-tracking, so half (a) reads the pre-call snapshot and a settle
    // made inside this call does not clear the gate. Both sections are
    // enforceableAt ["unit"] only, so a live read would let a session satisfy
    // this gate from inside the very call it gates.
    //
    // The satisfying shape is the same two ops in two calls; the refusal says so.
    const research = baseResearch();
    research.sources = [validSource("src_001")];
    research.assertions = [ev("a_133", "stated", "src_001"), ev("a_135", "stated", "src_001")];
    research.hypotheses = [hyp({ supporting_assertion_ids: ["a_133", "a_135"] })];
    research.conflicts = [
      {
        ...validConflict(),
        id: "c_001",
        competing_assertion_ids: ["a_133", "a_135"],
        status: "unresolved",
      },
    ];
    await writeProject(research);

    const settleOp = {
      section: "conflicts",
      op: "update",
      entryId: "c_001",
      fields: {
        status: "resolved",
        preferred_assertion_id: "a_133",
        independence_analysis: "Two separately created records, no shared informant.",
        weighing_analysis: "The earlier enumeration is closer to the event.",
        resolution_rationale: "a_133 preferred; a_135 is a later derivative reading.",
      },
    };
    const promoteOp = {
      section: "hypotheses",
      op: "update",
      entryId: "h_001",
      fields: { status: "supported" },
    };

    const batched = await researchAppend({
      projectPath: dir,
      ops: [settleOp, promoteOp],
    } as never);
    expect(batched.ok).toBe(false);
    const joined = failure(batched).errors.join("\n");
    expect(joined).toMatch(/conflict\(s\) \[c_001\] naming its assertions are unresolved/);
    // Satisfiability: the refusal must tell the agent to split the call, or it
    // retries the same batch forever.
    expect(joined).toMatch(/in an EARLIER call/);

    // The same two ops, split across two calls, both succeed — so the deny is
    // satisfiable and the batch is refused for its shape, not its content.
    const settle = await researchAppend({ projectPath: dir, ...settleOp } as never);
    expect(errorsOf(settle) ?? []).toEqual([]);
    const promote = await researchAppend({ projectPath: dir, ...promoteOp } as never);
    expect(errorsOf(promote) ?? []).toEqual([]);
    expect(promote.ok).toBe(true);
  });

  // ── The coupled-field arm: three calls that landed `ok: true` before it ──
  //
  // Each names one of the two id lists and leaves `status` alone, so a
  // `status`-only gate never ran and the forbidden state persisted. Watched
  // failing against the narrow gate before the widening landed.

  it("refuses narrowing supporting_assertion_ids below the floor without naming status", async () => {
    const research = baseResearch();
    research.sources = [validSource("src_001"), validSource("src_003")];
    research.assertions = [ev("a_001", "inferred", "src_001"), ev("a_002", "inferred", "src_003")];
    // Stands legitimately at `supported`: two indirect, two distinct sources.
    research.hypotheses = [
      hyp({ status: "supported", supporting_assertion_ids: ["a_001", "a_002"] }),
    ];
    await writeProject(research);

    // Drops to one source. No `status` key.
    const r = await researchAppend({
      projectPath: dir,
      section: "hypotheses",
      op: "update",
      entryId: "h_001",
      fields: { supporting_assertion_ids: ["a_001"] },
    } as never);

    expect(r.ok).toBe(false);
    expect(failure(r).errors.join("\n")).toMatch(/only 1 distinct inferred source/);
  });

  it("refuses adding a supporting assertion an unresolved conflict names, without naming status", async () => {
    const research = baseResearch();
    research.sources = [validSource("src_001")];
    research.assertions = [ev("a_001", "stated", "src_001"), ev("a_002", "stated", "src_001")];
    research.hypotheses = [hyp({ status: "supported", supporting_assertion_ids: ["a_001"] })];
    research.conflicts = [
      {
        ...validConflict(),
        id: "c_001",
        competing_assertion_ids: ["a_002", "a_001"],
        status: "unresolved",
      },
    ];
    await writeProject(research);

    const r = await researchAppend({
      projectPath: dir,
      section: "hypotheses",
      op: "update",
      entryId: "h_001",
      fields: { supporting_assertion_ids: ["a_001", "a_002"] },
    } as never);

    expect(r.ok).toBe(false);
    expect(failure(r).errors.join("\n")).toMatch(/conflict\(s\) \[c_001\]/);
  });

  it("refuses linking contradicting evidence an unresolved conflict names — the skill's own documented call", async () => {
    // `hypothesis-tracking/SKILL.md` tells the agent that adding contradicting
    // evidence "does not automatically require a status downgrade — only link
    // the evidence and leave the status unchanged". That is this exact op, and
    // it reached no precondition under the narrow gate.
    const research = baseResearch();
    research.sources = [validSource("src_001")];
    research.assertions = [ev("a_001", "stated", "src_001"), ev("a_002", "stated", "src_001")];
    research.hypotheses = [hyp({ status: "supported", supporting_assertion_ids: ["a_001"] })];
    research.conflicts = [
      {
        ...validConflict(),
        id: "c_001",
        competing_assertion_ids: ["a_002", "a_001"],
        status: "unresolved",
      },
    ];
    await writeProject(research);

    const r = await researchAppend({
      projectPath: dir,
      section: "hypotheses",
      op: "update",
      entryId: "h_001",
      fields: { contradicting_assertion_ids: ["a_002"] },
    } as never);

    expect(r.ok).toBe(false);
    expect(failure(r).errors.join("\n")).toMatch(/conflict\(s\) \[c_001\]/);
  });

  it("still accepts an id-list edit that keeps the floor satisfied", async () => {
    // The other direction: the widened arm must not refuse a legitimate list
    // edit. Swaps one indirect source for another, staying at two distinct.
    const research = baseResearch();
    research.sources = [validSource("src_001"), validSource("src_003")];
    research.assertions = [
      ev("a_001", "inferred", "src_001"),
      ev("a_002", "inferred", "src_003"),
      ev("a_003", "inferred", "src_003"),
    ];
    research.hypotheses = [
      hyp({ status: "supported", supporting_assertion_ids: ["a_001", "a_002"] }),
    ];
    await writeProject(research);

    const r = await researchAppend({
      projectPath: dir,
      section: "hypotheses",
      op: "update",
      entryId: "h_001",
      fields: { supporting_assertion_ids: ["a_001", "a_003"] },
    } as never);

    expect(errorsOf(r) ?? []).toEqual([]);
    expect(r.ok).toBe(true);
  });


  // ── Half (b)'s same-call behaviour, both directions ──
  //
  // Nothing covered this before. Half (b) reads the pre-call snapshot too, so an
  // assertion appended earlier in the same batch is invisible to it — and the
  // refusal has to say so, or the agent retries the batch it just sent.

  it("refuses promoting on an assertion appended in the same call, and says the append does not count", async () => {
    const research = baseResearch();
    research.sources = [validSource("src_001")];
    research.assertions = [];
    research.hypotheses = [hyp({ supporting_assertion_ids: [] })];
    await writeProject(research);

    const r = await researchAppend({
      projectPath: dir,
      ops: [
        {
          section: "assertions",
          op: "append",
          entry: {
            source_id: "src_001",
            record_id: "rec1",
            record_role: "principal",
            fact_type: "birth",
            value: "1850",
            information_quality: "primary",
            informant: "self",
            informant_proximity: "self",
            record_basis: "stated",
            extracted_for_question_ids: [],
          },
        },
        {
          section: "hypotheses",
          op: "update",
          entryId: "h_001",
          fields: { status: "supported", supporting_assertion_ids: ["a_001"] },
        },
      ],
    } as never);

    expect(r.ok).toBe(false);
    const joined = failure(r).errors.join("\n");
    expect(joined).toMatch(/no stated supporting assertion/);
    // Satisfiability: without this the agent is told there is no direct
    // assertion one op after appending one, and retries the same batch.
    expect(joined).toMatch(/appended in THIS call do not count/);
    expect(joined).toMatch(/append them in an earlier call, then promote/);
  });

  it("accepts the same two ops split across two calls", async () => {
    // The satisfying shape the refusal above names. Proves the deny is
    // satisfiable rather than a dead end.
    const research = baseResearch();
    research.sources = [validSource("src_001")];
    research.assertions = [];
    research.hypotheses = [hyp({ supporting_assertion_ids: [] })];
    await writeProject(research);

    const append = await researchAppend({
      projectPath: dir,
      section: "assertions",
      op: "append",
      entry: {
        source_id: "src_001",
        record_id: "rec1",
        record_role: "principal",
        fact_type: "birth",
        value: "1850",
        information_quality: "primary",
        informant: "self",
        informant_proximity: "self",
        record_basis: "stated",
        extracted_for_question_ids: [],
      },
    } as never);
    expect(errorsOf(append) ?? []).toEqual([]);
    const assertionId = singleOk(append).entryId;

    const promote = await researchAppend({
      projectPath: dir,
      section: "hypotheses",
      op: "update",
      entryId: "h_001",
      fields: { status: "supported", supporting_assertion_ids: [assertionId] },
    } as never);

    expect(errorsOf(promote) ?? []).toEqual([]);
    expect(promote.ok).toBe(true);
  });

});

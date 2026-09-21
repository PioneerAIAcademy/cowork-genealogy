import { describe, it, expect } from "vitest";
import {
  RECORD_PERSONA_SKIP_TYPES,
  materializesToPersonFact,
  projectRecordPersonas,
  projectedRecordDocument,
  projectsToRecordPersonaFact,
} from "../../src/utils/record-persona.js";

/**
 * The record-side projection (issue #1731 step 1, lead ruling 2026-09-11).
 *
 * The point of these tests is not that the mapping runs — `materialize_facts`'
 * own suite already covers the lifted half — but that the projection asks a
 * DIFFERENT question from the tree write and keeps answering it differently.
 */

function a(over: Record<string, unknown> = {}): any {
  return {
    id: "a_001",
    record_id: "ark:/61903/1:1:ABCD-123",
    record_role: "principal",
    fact_type: "birth",
    value: "",
    date: "12 May 1843",
    place: "Schuylkill County, Pennsylvania",
    evidence_type: "direct",
    ...over,
  };
}

describe("projectsToRecordPersonaFact vs materializesToPersonFact", () => {
  // The regression this guards: collapsing the two predicates would drop
  // `marriage` from every projected persona — 286 of 11,340 corpus assertions
  // (2.5%) — and `marriage` is MEASURED to move the score by 0.145 on the live
  // API (dev/try-same-person-project.ts).
  it("is NOT the same predicate — marriage projects, but never materializes", () => {
    const assertion = a({ fact_type: "marriage" });
    expect(
      projectsToRecordPersonaFact(assertion),
      "marriage must reach a record persona",
    ).toBe(true);
    expect(
      materializesToPersonFact(assertion),
      "marriage must still NOT become a tree-person fact",
    ).toBe(false);
  });

  it("excludes `age`, which the match API measurably ignores", () => {
    // Probed live: an age of 42 and an age of 999 score identically on an
    // unsaturated pairing, 0 of 356 facts on real record personas are `Age`,
    // and a tree person can never carry one to compare against. Admitting it
    // was payload that could not move a score. Both predicates agree here.
    const assertion = a({ fact_type: "age" });
    expect(projectsToRecordPersonaFact(assertion)).toBe(false);
    expect(materializesToPersonFact(assertion)).toBe(false);
  });

  it("still excludes the pure two-party edges", () => {
    for (const factType of RECORD_PERSONA_SKIP_TYPES) {
      expect(projectsToRecordPersonaFact(a({ fact_type: factType }))).toBe(false);
    }
  });

  it("excludes negative evidence, as the ruling requires", () => {
    expect(projectsToRecordPersonaFact(a({ evidence_type: "negative" }))).toBe(false);
  });

  it("agrees with the tree filter on an ordinary event", () => {
    const assertion = a({ fact_type: "birth" });
    expect(projectsToRecordPersonaFact(assertion)).toBe(true);
    expect(materializesToPersonFact(assertion)).toBe(true);
  });
});

describe("projectRecordPersonas", () => {
  it("groups by record_role, one person per party", () => {
    const groups = projectRecordPersonas([
      a({ id: "a_1", record_role: "head_of_household", fact_type: "name", value: "Patrick Flynn" }),
      a({ id: "a_2", record_role: "head_of_household", fact_type: "occupation", value: "Labourer" }),
      a({ id: "a_3", record_role: "wife", fact_type: "name", value: "Mary Flynn" }),
    ]);
    expect(groups.map((g) => g.role).sort()).toEqual(["head_of_household", "wife"]);
    const head = groups.find((g) => g.role === "head_of_household")!;
    expect(head.person.names?.[0]).toMatchObject({ given: "Patrick", surname: "Flynn" });
    // The occupation rode along as a fact.
    expect(head.person.facts?.map((f) => f.type)).toContain("Occupation");
  });

  // Two separate rules, tested separately ON PURPOSE. A single fixture setting
  // BOTH `record_role: "absent"` and `evidence_type: "negative"` passes even
  // when either guard is deleted, because the other one still catches it — the
  // first version of this test did exactly that and survived a break-test of
  // the `absent` rule.
  it("drops record_role 'absent' even when the evidence is not marked negative", () => {
    const groups = projectRecordPersonas([
      a({ id: "a_1", record_role: "principal", fact_type: "name", value: "Patrick Flynn" }),
      a({
        id: "a_2",
        record_role: "absent",
        evidence_type: "direct",
        fact_type: "name",
        value: "Nobody Here",
      }),
    ]);
    expect(groups.map((g) => g.role)).toEqual(["principal"]);
  });

  it("drops negative evidence even when the role is an ordinary one", () => {
    const groups = projectRecordPersonas([
      a({ id: "a_1", record_role: "principal", fact_type: "name", value: "Patrick Flynn" }),
      a({
        id: "a_2",
        record_role: "wife",
        evidence_type: "negative",
        fact_type: "name",
        value: "Nobody Here",
      }),
    ]);
    expect(groups.map((g) => g.role)).toEqual(["principal"]);
  });

  it("sets gender from a gender/sex assertion rather than making it a fact", () => {
    const [g] = projectRecordPersonas([a({ fact_type: "sex", value: "female" })]);
    expect(g.person.gender).toBe("Female");
    expect(g.person.facts ?? []).toEqual([]);
  });

  it("reports every distinct name in a role, so an ambiguous group is detectable", () => {
    const [g] = projectRecordPersonas([
      a({ id: "a_1", fact_type: "name", value: "Anders Fincke" }),
      a({ id: "a_2", fact_type: "name", value: "Anders Jonsson" }),
    ]);
    expect(g.names).toEqual(["Anders Fincke", "Anders Jonsson"]);
    // No persona id agreed on, which is what makes it ambiguous rather than aliased.
    expect(g.personaId).toBeNull();
  });

  it("agrees a single persona id when every assertion carries the same one", () => {
    // The 18-of-22 shape: one persona, several name spellings (maiden name,
    // scribal variant). This must NOT read as two people.
    const [g] = projectRecordPersonas([
      a({ id: "a_1", fact_type: "name", value: "Willa Mae McClerkin", record_persona_id: "p_1" }),
      a({ id: "a_2", fact_type: "name", value: "Willa Mae Ogletree", record_persona_id: "p_1" }),
    ]);
    expect(g.names).toHaveLength(2);
    expect(g.personaId).toBe("p_1");
  });
});

describe("projectedRecordDocument", () => {
  it("anchors the focus persona on the record's ARK and carries no relationships", () => {
    const groups = projectRecordPersonas([
      a({ id: "a_1", record_role: "principal", fact_type: "name", value: "Patrick Flynn" }),
      a({ id: "a_2", record_role: "wife", fact_type: "name", value: "Mary Flynn" }),
    ]);
    const doc = projectedRecordDocument(groups, "principal", "ark:/61903/1:1:ABCD-123");
    expect(doc.persons?.find((p) => p.id === "principal")?.ark).toBe(
      "ark:/61903/1:1:ABCD-123",
    );
    // The non-focus party gets no ARK — it is not what the record id names.
    expect(doc.persons?.find((p) => p.id === "wife")?.ark).toBeUndefined();
    // Deliberate: record_role is an open enum, so edges cannot be inferred from
    // role names, and a wrong edge scores worse than no edge.
    expect(doc.relationships).toBeUndefined();
  });

  it("does not invent an ARK for a non-ARK record id", () => {
    const groups = projectRecordPersonas([
      a({ id: "a_1", record_id: "004516861_00304", fact_type: "name", value: "Anders" }),
    ]);
    const doc = projectedRecordDocument(groups, "principal", "004516861_00304");
    expect(doc.persons?.[0]?.ark).toBeUndefined();
  });
});

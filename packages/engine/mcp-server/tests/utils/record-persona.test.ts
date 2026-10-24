import { describe, it, expect } from "vitest";
import {
  RECORD_PERSONA_SKIP_TYPES,
  materializesToPersonFact,
  personaRolesById,
  projectRecordPersonas,
  projectedRecordDocument,
  recordPartyKeyer,
  projectsToRecordPersonaFact,
  factTypeKey,
  isCoupleEventFactType,
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
    record_basis: "stated",
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

  it("excludes an absent-basis assertion, as the ruling requires", () => {
    expect(projectsToRecordPersonaFact(a({ record_basis: "absent" }))).toBe(false);
  });

  it("agrees with the tree filter on an ordinary event", () => {
    const assertion = a({ fact_type: "birth" });
    expect(projectsToRecordPersonaFact(assertion)).toBe(true);
    expect(materializesToPersonFact(assertion)).toBe(true);
  });
});

describe("couple events never materialize onto a person", () => {
  // The point of folding rather than listing raw spellings: `fact_type` is an
  // open enum, so one event arrives spelled several ways. Each live spelling
  // below came out of a real e2e run.
  it.each([
    "marriage",
    "marriage_intention",
    "marriage_bann",
    "marriage_date",
    "Marriage Banns",
    "MarriageBanns",
    "marriage-licence",
    "MARRIAGE_LICENSE",
    "divorce",
    "Annulment",
  ])("%s is a couple event, so it is not a person fact", (factType) => {
    expect(isCoupleEventFactType(factType)).toBe(true);
    expect(materializesToPersonFact({ fact_type: factType })).toBe(false);
  });

  // The other direction: folding must not swallow an ordinary person fact that
  // merely looks adjacent. A guard that over-reaches here would silently stop
  // materializing real evidence.
  it.each([
    "birth",
    "death",
    "residence",
    "marriage_record_number",
    "remarriage_of_mother",
    "marital_status",
  ])("%s is NOT a couple event and still materializes", (factType) => {
    expect(isCoupleEventFactType(factType)).toBe(false);
    expect(materializesToPersonFact({ fact_type: factType })).toBe(true);
  });

  it("factTypeKey folds case and every separator to one key", () => {
    const key = factTypeKey("marriage_banns");
    for (const spelling of ["Marriage Banns", "MarriageBanns", "marriage-banns", "MARRIAGE__BANNS"]) {
      expect(factTypeKey(spelling)).toBe(key);
    }
    // Non-strings are folded, not thrown on: fact_type reaches this from JSON.
    expect(factTypeKey(undefined)).toBe("");
    expect(factTypeKey(null)).toBe("");
    expect(factTypeKey(42)).toBe("42");
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
  it("drops record_role 'absent' even when the basis is not itself absent", () => {
    const groups = projectRecordPersonas([
      a({ id: "a_1", record_role: "principal", fact_type: "name", value: "Patrick Flynn" }),
      a({
        id: "a_2",
        record_role: "absent",
        record_basis: "stated",
        fact_type: "name",
        value: "Nobody Here",
      }),
    ]);
    expect(groups.map((g) => g.role)).toEqual(["principal"]);
  });

  it("drops an absent-basis assertion even when the role is an ordinary one", () => {
    const groups = projectRecordPersonas([
      a({ id: "a_1", record_role: "principal", fact_type: "name", value: "Patrick Flynn" }),
      a({
        id: "a_2",
        record_role: "wife",
        record_basis: "absent",
        fact_type: "name",
        value: "Nobody Here",
      }),
    ]);
    expect(groups.map((g) => g.role)).toEqual(["principal"]);
  });

  it("still excludes a LEGACY evidence_type: negative assertion", () => {
    // record_basis replaced evidence_type mid-flight. `recordBasisOf` reads the
    // new field first and falls back, so a half-migrated document keeps
    // excluding negative evidence. Without the fallback this projects a person
    // the record says was NOT there, and every suite stays green because the
    // other tests all use the new field.
    const groups = projectRecordPersonas([
      a({ id: "a_1", record_role: "principal", fact_type: "name", value: "Patrick Flynn" }),
      a({
        id: "a_2",
        record_role: "wife",
        record_basis: undefined,
        evidence_type: "negative",
        fact_type: "name",
        value: "Nobody Here",
      } as any),
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

  it("keeps one party together when a re-extraction left off its persona id", () => {
    const groups = projectRecordPersonas([
      a({ id: "a_1", record_role: "deceased", fact_type: "name", value: "Ana Bardales", record_persona_id: "p_1", log_entry_id: "log_001" }),
      a({ id: "a_2", record_role: "deceased", fact_type: "death", date: "1950", log_entry_id: "log_002" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].personaId).toBe("p_1");
  });

  it("splits a household an extraction stamped with one persona id", () => {
    const groups = projectRecordPersonas([
      a({ id: "a_1", record_role: "head_of_household", fact_type: "name", value: "John Spriggs", record_persona_id: "p_1" }),
      a({ id: "a_2", record_role: "wife", fact_type: "name", value: "Ann Spriggs", record_persona_id: "p_1" }),
    ]);
    expect(groups.map((g) => g.role).sort()).toEqual(["head_of_household", "wife"]);
    expect(groups.map((g) => g.personaId)).toEqual([null, null]);
  });
});

describe("recordPartyKeyer (#2537)", () => {
  it("keys a re-extraction's id-less assertion to the one persona carrying its role", () => {
    const list = [
      a({ record_role: "deceased", record_persona_id: "p_1", log_entry_id: "log_001" }),
      a({ record_role: "deceased", log_entry_id: "log_002" }),
    ];
    const key = recordPartyKeyer(list);
    expect(list.map(key)).toEqual(["p_1", "p_1"]);
  });

  // Code review: a register page holds several people at one role.
  it("keeps the role for an id-less party inside an extraction that set ids", () => {
    const list = [
      a({ record_role: "child", record_persona_id: "p_1", log_entry_id: "log_001" }),
      a({ record_role: "child", log_entry_id: "log_001" }),
    ];
    expect(list.map(recordPartyKeyer(list))).toEqual(["p_1", "child"]);
  });

  it("keeps the role when the id-less extraction names two people at it", () => {
    const list = [
      a({ record_role: "child", record_persona_id: "p_1", log_entry_id: "log_001" }),
      a({ record_role: "child", fact_type: "name", value: "Ann", log_entry_id: "log_002" }),
      a({ record_role: "child", fact_type: "name", value: "Mary", log_entry_id: "log_002" }),
    ];
    expect(list.slice(1).map(recordPartyKeyer(list))).toEqual(["child", "child"]);
  });

  it("keeps the role when two personas carry it", () => {
    const list = [
      a({ record_role: "child", record_persona_id: "p_1", log_entry_id: "log_001" }),
      a({ record_role: "child", record_persona_id: "p_2", log_entry_id: "log_001" }),
      a({ record_role: "child", log_entry_id: "log_002" }),
    ];
    expect(list.map(recordPartyKeyer(list))).toEqual(["p_1", "p_2", "child"]);
  });

  it("keys on the role when one persona id is worn by several roles", () => {
    const list = [
      a({ record_role: "father", record_persona_id: "p_1" }),
      a({ record_role: "child", record_persona_id: "p_1" }),
    ];
    expect(list.map(recordPartyKeyer(list))).toEqual(["father", "child"]);
  });

  it("does not count an absent role as one the persona carries", () => {
    const list = [
      a({ record_role: "principal", record_persona_id: "p_1" }),
      a({ record_role: "absent", record_persona_id: "p_1" }),
    ];
    expect(recordPartyKeyer(list)(list[0])).toBe("p_1");
  });

  it("returns null for an assertion with neither", () => {
    expect(recordPartyKeyer([])(a({ record_role: undefined }))).toBeNull();
  });
});

describe("personaRolesById", () => {
  it("collects the distinct roles each persona id carries, in order of first appearance", () => {
    const roles = personaRolesById([
      a({ record_role: "child", record_persona_id: "p_1" }),
      a({ record_role: "father", record_persona_id: "p_2" }),
      a({ record_role: "child", record_persona_id: "p_1" }),
      a({ record_role: "father", record_persona_id: "p_1" }),
    ]);
    expect([...roles.keys()]).toEqual(["p_1", "p_2"]);
    expect([...(roles.get("p_1") ?? [])]).toEqual(["child", "father"]);
    expect([...(roles.get("p_2") ?? [])]).toEqual(["father"]);
  });

  it("leaves out negative evidence, and assertions with no persona id or no role", () => {
    const roles = personaRolesById([
      a({ record_role: "absent", record_persona_id: "p_1" }),
      a({ record_role: "child", record_persona_id: null }),
      a({ record_role: "child", record_persona_id: "" }),
      a({ record_role: null, record_persona_id: "p_2" }),
      a({ record_role: "", record_persona_id: "p_3" }),
      a({ record_role: "mother", record_persona_id: "p_4" }),
    ]);
    expect([...roles.keys()]).toEqual(["p_4"]);
  });

  it("is the rule recordPartyKeyer keys on: an id with two roles keys on its role", () => {
    const list = [
      a({ record_role: "child", record_persona_id: "p_1" }),
      a({ record_role: "father", record_persona_id: "p_1" }),
    ];
    expect(personaRolesById(list).get("p_1")?.size).toBe(2);
    expect(list.map(recordPartyKeyer(list))).toEqual(["child", "father"]);
  });
});

describe("projectedRecordDocument", () => {
  it("gives NO party the record's ARK, and carries no relationships", () => {
    // A `1:1:` record id names ONE persona (normally the principal), but every
    // assertion of the record carries it whatever its role. Stamping it on the
    // focus party meant scoring the bride built a person wearing the
    // principal's persona ARK, which buildRawWithAnchor writes into the
    // Persistent identifier it POSTs. Nothing is lost by omitting it: two live
    // probes show an ARK-less focus person scores normally.
    const groups = projectRecordPersonas([
      a({ id: "a_1", record_role: "principal", fact_type: "name", value: "Patrick Flynn" }),
      a({ id: "a_2", record_role: "wife", fact_type: "name", value: "Mary Flynn" }),
    ]);
    for (const focus of ["principal", "wife"]) {
      const doc = projectedRecordDocument(groups);
      expect(doc.persons?.every((p) => p.ark === undefined), focus).toBe(true);
      expect(doc.persons?.map((p) => p.id)?.sort()).toEqual(["principal", "wife"]);
    }
    // Deliberate: record_role is an open enum, so edges cannot be inferred from
    // role names, and a wrong edge scores worse than no edge.
    expect(projectedRecordDocument(groups).relationships).toBeUndefined();
  });
});

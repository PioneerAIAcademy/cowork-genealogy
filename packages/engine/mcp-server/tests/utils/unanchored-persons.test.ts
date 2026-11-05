import { describe, it, expect } from "vitest";
import { removeUnanchoredPersons, unanchoredMintedPersonIds } from "../../src/utils/unanchored-persons.js";
import { ATTACHMENT_LINK_RATIONALE } from "../../src/utils/tree-person.js";

// The pure half of the last-question removal (lead ruling 2026-11-04, issue
// #3032). research-append.test.ts drives it end to end.

const person = (id: string) => ({ id, names: [{ id: `N_${id}`, given: id }] });
const none = () => false;

describe("unanchoredMintedPersonIds", () => {
  it("anchors a person FamilySearch has a record attached to", () => {
    const tree = { persons: [person("I1"), person("I2"), person("I3")], relationships: [{ id: "R1", type: "Couple", person1: "I1", person2: "I2" }] };
    const research = {
      person_evidence: [{ id: "pe_001", person_id: "I1", rationale: ATTACHMENT_LINK_RATIONALE, confidence: "speculative" }],
    };
    expect(unanchoredMintedPersonIds(tree, research, none)).toEqual(["I3"]);
  });

  it("keeps a person a proof summary's claim names", () => {
    const tree = { persons: [person("KWCB-100"), person("I2"), person("I3")], relationships: [] };
    const research = { proof_summaries: [{ id: "ps_001", claims: [{ relationship: { parent: "I2", child: "KWCB-100" } }] }] };
    expect(unanchoredMintedPersonIds(tree, research, (id) => id === "KWCB-100")).toEqual(["I3"]);
  });

  it("keeps a project subject even when nothing else marks it imported", () => {
    const tree = { persons: [person("I1"), person("I2")], relationships: [] };
    expect(unanchoredMintedPersonIds(tree, { project: { subject_person_ids: ["I1"] } }, none)).toEqual(["I2"]);
  });

  it("keeps a person a warning justification names", () => {
    const tree = { persons: [person("KWCB-100"), person("I2"), person("I3")], relationships: [] };
    const research = { warning_justifications: [{ warning_id: "w1", justification: "checked", person_ids: ["I2"] }] };
    expect(unanchoredMintedPersonIds(tree, research, (id) => id === "KWCB-100")).toEqual(["I3"]);
  });

  it("keeps the person holding the last proof-gate links behind a proof, and what it reaches", () => {
    const tree = {
      persons: [person("KWCB-100"), person("I2"), person("I3"), person("I4")],
      relationships: [{ id: "R1", type: "Couple", person1: "I2", person2: "I3" }],
    };
    const research = {
      person_evidence: [{ id: "pe_001", assertion_id: "a_001", person_id: "I2", confidence: "probable", superseded_by: null }],
      proof_summaries: [{ id: "ps_001", tier: "disproved", supporting_assertion_ids: ["a_001"] }],
    };
    expect(unanchoredMintedPersonIds(tree, research, (id) => id === "KWCB-100")).toEqual(["I4"]);
    // At not_proved the gate does not apply, so the proof keeps no one.
    research.proof_summaries[0].tier = "not_proved";
    expect(unanchoredMintedPersonIds(tree, research, (id) => id === "KWCB-100")).toEqual(["I2", "I3", "I4"]);
  });

  it("finds nothing when no anchor exists", () => {
    const tree = { persons: [person("I1"), person("I2")], relationships: [] };
    expect(unanchoredMintedPersonIds(tree, {}, none)).toEqual([]);
  });
});

describe("removeUnanchoredPersons", () => {
  it("drops the persons, their edges, their links and their rejections, and reports each", () => {
    const tree = {
      persons: [person("I1"), person("I2"), person("I3")],
      relationships: [
        { id: "R1", type: "Couple", person1: "I1", person2: "I2" },
        { id: "R2", type: "ParentChild", parent: "I2", child: "I3" },
      ],
    };
    const research = {
      person_evidence: [{ id: "pe_001", person_id: "I1" }, { id: "pe_002", person_id: "I3" }],
      rejected_links: [{ id: "rj_001", person_id: "I3" }, { id: "rj_002", person_id: "I1" }],
    };
    const removed = removeUnanchoredPersons(tree, research, ["I3"]);
    expect(tree.persons.map((p) => p.id)).toEqual(["I1", "I2"]);
    expect(tree.relationships.map((r) => r.id)).toEqual(["R1"]);
    expect(research.person_evidence.map((pe) => pe.id)).toEqual(["pe_001"]);
    expect(research.rejected_links.map((rj) => rj.id)).toEqual(["rj_002"]);
    expect(removed).toEqual({ persons: [{ id: "I3", name: "I3" }], relationshipCount: 1, personEvidenceCount: 1, rejectedLinkCount: 1 });
  });

  it("counts a removed relationship that has no id", () => {
    const tree = { persons: [person("I1"), person("I2")], relationships: [{ type: "Couple", person1: "I1", person2: "I2" }] };
    expect(removeUnanchoredPersons(tree, {}, ["I2"]).relationshipCount).toBe(1);
    expect(tree.relationships).toEqual([]);
  });
});

/**
 * Tests for the TypeScript project validator.
 *
 * Port of test_validate_project.py with additional coverage.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { validateProject } from "../../src/validation/validator.js";

describe("Project Validator", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "validator-test-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  const minimalResearch = {
    project: {
      id: "rp_001",
      objective: "Test project",
      status: "active",
      created: "2026-01-01",
      updated: "2026-01-01",
    },
    questions: [],
    plans: [],
    log: [],
    sources: [],
    assertions: [],
    person_evidence: [],
    conflicts: [],
    hypotheses: [],
    timelines: [],
    proof_summaries: [],
  };

  const minimalTree = {
    persons: [],
    relationships: [],
    sources: [],
  };

  async function writeProject(research: any, tree: any) {
    await writeFile(
      join(testDir, "research.json"),
      JSON.stringify(research, null, 2)
    );
    await writeFile(
      join(testDir, "tree.gedcomx.json"),
      JSON.stringify(tree, null, 2)
    );
  }

  describe("Valid projects", () => {
    it("accepts a minimal valid project", async () => {
      await writeProject(minimalResearch, minimalTree);
      const result = await validateProject(testDir);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("accepts optional researcher_profile", async () => {
      const research = {
        ...minimalResearch,
        researcher_profile: {
          experience_level: "intermediate",
          subscriptions: ["Ancestry", "MyHeritage"],
          narration_guidance: "Be concise",
        },
      };
      await writeProject(research, minimalTree);
      const result = await validateProject(testDir);
      expect(result.valid).toBe(true);
    });

    it("accepts timeline with new optional fields", async () => {
      const research = {
        ...minimalResearch,
        timelines: [
          {
            id: "t_001",
            label: "Test Timeline",
            person_ids: [],
            generated: "2026-01-01T00:00:00Z",
            events: [
              {
                date: "1850",
                date_certainty: "exact",
                event_type: "census",
                description: "Test event",
                assertion_ids: [],
                conflict_ids: ["c_001"],
                conflict_note: "Related to conflict",
              },
            ],
            gaps: [
              {
                start: "1860-01-01",
                end: "1870-01-01",
                expected_events: ["census"],
                severity: "high",
                notes: "Missing decade of records",
              },
            ],
            impossibilities: [],
          },
        ],
      };
      await writeProject(research, minimalTree);
      const result = await validateProject(testDir);
      expect(result.valid).toBe(true);
    });
  });

  describe("Missing files", () => {
    it("reports missing research.json", async () => {
      await writeFile(
        join(testDir, "tree.gedcomx.json"),
        JSON.stringify(minimalTree)
      );
      const result = await validateProject(testDir);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes("research.json"))).toBe(
        true
      );
    });

    it("reports missing tree.gedcomx.json", async () => {
      await writeFile(
        join(testDir, "research.json"),
        JSON.stringify(minimalResearch)
      );
      const result = await validateProject(testDir);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes("tree.gedcomx.json"))).toBe(
        true
      );
    });
  });

  describe("Missing required fields", () => {
    it("reports missing project.id", async () => {
      const research = {
        ...minimalResearch,
        project: { ...minimalResearch.project, id: undefined },
      };
      await writeProject(research as any, minimalTree);
      const result = await validateProject(testDir);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) =>
          e.message.includes("missing required field 'id'")
        )
      ).toBe(true);
    });

    it("reports null for non-nullable required field", async () => {
      const research = {
        ...minimalResearch,
        project: { ...minimalResearch.project, objective: null },
      };
      await writeProject(research as any, minimalTree);
      const result = await validateProject(testDir);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.message.includes("'objective' is null"))
      ).toBe(true);
    });
  });

  describe("ID prefix validation", () => {
    it("reports incorrect project ID prefix", async () => {
      const research = {
        ...minimalResearch,
        project: { ...minimalResearch.project, id: "proj_001" },
      };
      await writeProject(research, minimalTree);
      const result = await validateProject(testDir);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.message.includes("should start with 'rp_'"))
      ).toBe(true);
    });

    it("reports incorrect question ID prefix", async () => {
      const research = {
        ...minimalResearch,
        questions: [
          {
            id: "question_001",
            question: "Test?",
            rationale: "Testing",
            selection_basis: "user_directed",
            priority: "high",
            status: "open",
            depends_on: [],
            unblocks: [],
            created: "2026-01-01",
            resolved: null,
            resolution_assertion_ids: [],
            exhaustive_declaration: {
              declared: false,
              log_entry_ids: [],
              stop_criteria: null,
            },
          },
        ],
      };
      await writeProject(research, minimalTree);
      const result = await validateProject(testDir);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.message.includes("should start with 'q_'"))
      ).toBe(true);
    });
  });

  describe("Enum validation", () => {
    it("reports invalid project status", async () => {
      const research = {
        ...minimalResearch,
        project: { ...minimalResearch.project, status: "invalid" },
      };
      await writeProject(research, minimalTree);
      const result = await validateProject(testDir);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.message.includes("not a valid project_status"))
      ).toBe(true);
    });

    it("reports invalid experience_level", async () => {
      const research = {
        ...minimalResearch,
        researcher_profile: {
          experience_level: "expert",
        },
      };
      await writeProject(research, minimalTree);
      const result = await validateProject(testDir);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) =>
          e.message.includes("not a valid experience_level")
        )
      ).toBe(true);
    });

    it("reports invalid subscription", async () => {
      const research = {
        ...minimalResearch,
        researcher_profile: {
          subscriptions: ["Ancestry", "InvalidSite"],
        },
      };
      await writeProject(research, minimalTree);
      const result = await validateProject(testDir);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) =>
          e.message.includes("not a valid subscription value")
        )
      ).toBe(true);
    });

    it("reports invalid date_certainty for timeline event", async () => {
      const research = {
        ...minimalResearch,
        timelines: [
          {
            id: "t_001",
            label: "Test",
            person_ids: [],
            generated: "2026-01-01T00:00:00Z",
            events: [
              {
                date: "1850",
                date_certainty: "before", // not valid for timeline events
                event_type: "census",
                description: "Test",
                assertion_ids: [],
              },
            ],
            gaps: [],
            impossibilities: [],
          },
        ],
      };
      await writeProject(research, minimalTree);
      const result = await validateProject(testDir);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) =>
          e.message.includes("not valid for timeline events")
        )
      ).toBe(true);
    });
  });

  describe("Cross-file reference validation", () => {
    it("reports source referencing non-existent gedcomx source", async () => {
      const research = {
        ...minimalResearch,
        sources: [
          {
            id: "src_001",
            gedcomx_source_description_id: "SD-NONEXISTENT",
            citation: "Test citation",
            citation_detail: {
              who: "Test",
              what: "Test",
              when_created: "2020",
              when_accessed: "2026-01-01",
              where: "Test",
              where_within: "Test",
            },
            source_classification: "original",
            repository: "Test",
            access_date: "2026-01-01",
          },
        ],
      };
      await writeProject(research, minimalTree);
      const result = await validateProject(testDir);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) =>
          e.message.includes("not found in tree.gedcomx.json sources")
        )
      ).toBe(true);
    });

    it("reports person_evidence referencing non-existent person", async () => {
      const research = {
        ...minimalResearch,
        assertions: [
          {
            id: "a_001",
            source_id: "src_001",
            record_id: "test",
            record_role: "principal",
            fact_type: "birth",
            value: "1850",
            information_quality: "primary",
            informant: "self",
            informant_proximity: "self",
            evidence_type: "direct",
            extracted_for_question_ids: [],
          },
        ],
        sources: [
          {
            id: "src_001",
            gedcomx_source_description_id: "SD-001",
            citation: "Test",
            citation_detail: {
              who: "Test",
              what: "Test",
              when_created: "2020",
              when_accessed: "2026-01-01",
              where: "Test",
              where_within: "Test",
            },
            source_classification: "original",
            repository: "Test",
            access_date: "2026-01-01",
          },
        ],
        person_evidence: [
          {
            id: "pe_001",
            assertion_id: "a_001",
            person_id: "NONEXISTENT",
            confidence: "confident",
            rationale: "Test",
            created: "2026-01-01",
            superseded_by: null,
          },
        ],
      };
      const tree = {
        ...minimalTree,
        sources: [{ id: "SD-001", title: "Test Source" }],
      };
      await writeProject(research, minimalTree);
      const result = await validateProject(testDir);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) =>
          e.message.includes("not found in tree.gedcomx.json persons")
        )
      ).toBe(true);
    });
  });

  describe("Conflict validation", () => {
    it("requires disputed_attribute for fact conflicts", async () => {
      const research = {
        ...minimalResearch,
        assertions: [
          { id: "a_001", source_id: "src_001", record_id: "1", record_role: "principal", fact_type: "birth", value: "1850", information_quality: "primary", informant: "self", informant_proximity: "self", evidence_type: "direct", extracted_for_question_ids: [] },
          { id: "a_002", source_id: "src_001", record_id: "2", record_role: "principal", fact_type: "birth", value: "1851", information_quality: "primary", informant: "self", informant_proximity: "self", evidence_type: "direct", extracted_for_question_ids: [] },
        ],
        sources: [
          { id: "src_001", gedcomx_source_description_id: "SD-001", citation: "Test", citation_detail: { who: "Test", what: "Test", when_created: "2020", when_accessed: "2026-01-01", where: "Test", where_within: "Test" }, source_classification: "original", repository: "Test", access_date: "2026-01-01" },
        ],
        conflicts: [
          {
            id: "c_001",
            conflict_type: "fact",
            description: "Birth year conflict",
            competing_assertion_ids: ["a_001", "a_002"],
            status: "unresolved",
            blocks_question_ids: [],
            // missing disputed_attribute
          },
        ],
      };
      const tree = {
        ...minimalTree,
        sources: [{ id: "SD-001", title: "Test" }],
      };
      await writeProject(research, tree);
      const result = await validateProject(testDir);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) =>
          e.message.includes("fact conflict requires disputed_attribute")
        )
      ).toBe(true);
    });

    it("requires identity_question for identity conflicts", async () => {
      const research = {
        ...minimalResearch,
        assertions: [
          { id: "a_001", source_id: "src_001", record_id: "1", record_role: "principal", fact_type: "birth", value: "1850", information_quality: "primary", informant: "self", informant_proximity: "self", evidence_type: "direct", extracted_for_question_ids: [] },
        ],
        sources: [
          { id: "src_001", gedcomx_source_description_id: "SD-001", citation: "Test", citation_detail: { who: "Test", what: "Test", when_created: "2020", when_accessed: "2026-01-01", where: "Test", where_within: "Test" }, source_classification: "original", repository: "Test", access_date: "2026-01-01" },
        ],
        conflicts: [
          {
            id: "c_001",
            conflict_type: "identity",
            description: "Identity question",
            competing_assertion_ids: ["a_001"],
            status: "unresolved",
            blocks_question_ids: [],
            // missing identity_question
          },
        ],
      };
      const tree = {
        ...minimalTree,
        sources: [{ id: "SD-001", title: "Test" }],
      };
      await writeProject(research, tree);
      const result = await validateProject(testDir);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) =>
          e.message.includes("identity conflict requires identity_question")
        )
      ).toBe(true);
    });
  });

  describe("GedcomX validation", () => {
    it("requires at least one name for each person", async () => {
      const tree = {
        persons: [
          {
            id: "P1",
            gender: "Male",
            names: [], // empty names array
          },
        ],
        relationships: [],
        sources: [],
      };
      await writeProject(minimalResearch, tree);
      const result = await validateProject(testDir);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) =>
          e.message.includes("person must have at least one name")
        )
      ).toBe(true);
    });

    it("reports invalid gender enum", async () => {
      const tree = {
        persons: [
          {
            id: "P1",
            gender: "NotValid",
            names: [{ id: "N1", given: "John", surname: "Doe", preferred: true }],
          },
        ],
        relationships: [],
        sources: [],
      };
      await writeProject(minimalResearch, tree);
      const result = await validateProject(testDir);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.message.includes("not a valid gender"))
      ).toBe(true);
    });

    it("reports ParentChild relationship with missing parent", async () => {
      const tree = {
        persons: [
          { id: "P1", gender: "Male", names: [{ id: "N1", given: "John", surname: "Doe", preferred: true }] },
        ],
        relationships: [
          {
            id: "R1",
            type: "ParentChild",
            parent: "NONEXISTENT",
            child: "P1",
          },
        ],
        sources: [],
      };
      await writeProject(minimalResearch, tree);
      const result = await validateProject(testDir);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.message.includes("not found in persons"))
      ).toBe(true);
    });

    it("reports fact type not in PascalCase", async () => {
      const tree = {
        persons: [
          {
            id: "P1",
            gender: "Male",
            names: [{ id: "N1", given: "John", surname: "Doe", preferred: true }],
            facts: [{ id: "F1", type: "birth" }], // should be "Birth"
          },
        ],
        relationships: [],
        sources: [],
      };
      await writeProject(minimalResearch, tree);
      const result = await validateProject(testDir);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.message.includes("should be PascalCase"))
      ).toBe(true);
    });
  });

  describe("Sidecar validation", () => {
    it("reports missing sidecar file", async () => {
      const research = {
        ...minimalResearch,
        log: [
          {
            id: "log_001",
            plan_item_id: null,
            performed: "2026-01-01T00:00:00Z",
            tool: "fulltext_search",
            query: {},
            outcome: "positive",
            results_examined: 5,
            results_ref: "results/log_001.json", // file doesn't exist
            external_site: null,
          },
        ],
      };
      await writeProject(research, minimalTree);
      const result = await validateProject(testDir);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.message.includes("does not exist"))
      ).toBe(true);
    });

    it("validates D2: returned_count matches actual results", async () => {
      const research = {
        ...minimalResearch,
        log: [
          {
            id: "log_001",
            plan_item_id: null,
            performed: "2026-01-01T00:00:00Z",
            tool: "fulltext_search",
            query: {},
            outcome: "positive",
            results_examined: 5,
            results_ref: "results/log_001.json",
            external_site: null,
          },
        ],
      };

      const sidecar = {
        log_id: "log_001",
        tool: "fulltext_search",
        retrieved: "2026-01-01T00:00:00Z",
        returned_count: 10, // says 10 but only 5 results
        payload: {
          results: [{}, {}, {}, {}, {}], // only 5 results
        },
      };

      await writeProject(research, minimalTree);
      await mkdir(join(testDir, "results"));
      await writeFile(
        join(testDir, "results/log_001.json"),
        JSON.stringify(sidecar)
      );

      const result = await validateProject(testDir);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) =>
          e.message.includes("payload may be truncated")
        )
      ).toBe(true);
    });

    it("reports orphan sidecar files", async () => {
      await writeProject(minimalResearch, minimalTree);
      await mkdir(join(testDir, "results"));
      await writeFile(
        join(testDir, "results/orphan.json"),
        JSON.stringify({ log_id: "orphan", tool: "test", retrieved: "2026-01-01T00:00:00Z", returned_count: 0, payload: { results: [] } })
      );

      const result = await validateProject(testDir);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.message.includes("orphan sidecar"))
      ).toBe(true);
    });

    it("validates D5: record_persona_id resolution", async () => {
      const research = {
        ...minimalResearch,
        log: [
          {
            id: "log_001",
            plan_item_id: null,
            performed: "2026-01-01T00:00:00Z",
            tool: "record_search",
            query: {},
            outcome: "positive",
            results_examined: 1,
            results_ref: "results/log_001.json",
            external_site: null,
          },
        ],
        sources: [
          { id: "src_001", gedcomx_source_description_id: "SD-001", citation: "Test", citation_detail: { who: "Test", what: "Test", when_created: "2020", when_accessed: "2026-01-01", where: "Test", where_within: "Test" }, source_classification: "original", repository: "Test", access_date: "2026-01-01" },
        ],
        assertions: [
          {
            id: "a_001",
            source_id: "src_001",
            record_id: "ark_001",
            record_role: "principal",
            record_persona_id: "NONEXISTENT", // doesn't exist in record's gedcomx
            fact_type: "birth",
            value: "1850",
            information_quality: "primary",
            informant: "self",
            informant_proximity: "self",
            evidence_type: "direct",
            extracted_for_question_ids: [],
            log_entry_id: "log_001",
          },
        ],
      };

      const sidecar = {
        log_id: "log_001",
        tool: "record_search",
        retrieved: "2026-01-01T00:00:00Z",
        returned_count: 1,
        payload: {
          results: [
            {
              arkUrl: "ark_001",
              gedcomx: {
                persons: [{ id: "PERSON1" }, { id: "PERSON2" }],
              },
            },
          ],
        },
      };

      const tree = {
        ...minimalTree,
        sources: [{ id: "SD-001", title: "Test" }],
      };

      await writeProject(research, tree);
      await mkdir(join(testDir, "results"));
      await writeFile(
        join(testDir, "results/log_001.json"),
        JSON.stringify(sidecar)
      );

      const result = await validateProject(testDir);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) =>
          e.message.includes("does not resolve to a person in record")
        )
      ).toBe(true);
    });
  });
});

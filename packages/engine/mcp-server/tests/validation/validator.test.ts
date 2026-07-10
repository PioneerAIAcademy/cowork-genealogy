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
    evaluations: [],
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
        result.errors.some((e) => e.message.includes("must start with an uppercase letter"))
      ).toBe(true);
    });

    it("rejects an unexpected property on a tree source", async () => {
      // Guards the proof_002 bug: an update_source op that writes citation text
      // under `description` (not `citation`) must fail validation and not be
      // persisted, matching the schema's additionalProperties:false.
      const tree = {
        persons: [],
        relationships: [],
        sources: [{ id: "SD-001", title: "Test", description: "1850 census" }],
      };
      await writeProject(minimalResearch, tree);
      const result = await validateProject(testDir);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) =>
          e.message.includes("unexpected property 'description'")
        )
      ).toBe(true);
    });

    it("accepts every allowed tree-source property", async () => {
      const tree = {
        persons: [],
        relationships: [],
        sources: [
          {
            id: "SD-001",
            title: "Test",
            citation: "Full citation",
            author: "A. Author",
            url: "https://example.com/record",
          },
        ],
      };
      await writeProject(minimalResearch, tree);
      const result = await validateProject(testDir);
      expect(result.valid).toBe(true);
    });

    it("rejects a typo'd fact property, matching the schema's additionalProperties:false", async () => {
      const tree = {
        persons: [
          {
            id: "P1",
            gender: "Male",
            names: [{ id: "N1", given: "John", surname: "Doe" }],
            facts: [{ id: "F1", type: "Birth", standrad_date: "2 Oct 1876" }],
          },
        ],
        relationships: [],
        sources: [],
      };
      await writeProject(minimalResearch, tree);
      const result = await validateProject(testDir);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.message.includes("unexpected property 'standrad_date'"))
      ).toBe(true);
    });

    it("rejects preferred:false on a name — the schema pins it to const true", async () => {
      const tree = {
        persons: [
          {
            id: "P1",
            gender: "Male",
            names: [{ id: "N1", given: "John", surname: "Doe", preferred: false }],
          },
        ],
        relationships: [],
        sources: [],
      };
      await writeProject(minimalResearch, tree);
      const result = await validateProject(testDir);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.message.includes("'preferred' must be true when present"))
      ).toBe(true);
    });

    it("rejects an out-of-range quality on a source reference", async () => {
      const tree = {
        persons: [
          {
            id: "P1",
            gender: "Male",
            names: [{ id: "N1", given: "John", surname: "Doe" }],
            facts: [{ id: "F1", type: "Birth", sources: [{ ref: "S1", quality: 5 }] }],
          },
        ],
        relationships: [],
        sources: [{ id: "S1", title: "Census" }],
      };
      await writeProject(minimalResearch, tree);
      const result = await validateProject(testDir);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.message.includes("'quality' must be an integer between 0 and 3"))
      ).toBe(true);
    });

    it("resolves source refs inside Couple-relationship facts — a former blind spot", async () => {
      const tree = {
        persons: [
          { id: "P1", gender: "Male", names: [{ id: "N1", given: "John", surname: "Doe" }] },
          { id: "P2", gender: "Female", names: [{ id: "N2", given: "Mary", surname: "Doe" }] },
        ],
        relationships: [
          {
            id: "R1",
            type: "Couple",
            person1: "P1",
            person2: "P2",
            facts: [{ id: "F1", type: "Marriage", sources: [{ ref: "S9-DANGLING" }] }],
          },
        ],
        sources: [],
      };
      await writeProject(minimalResearch, tree);
      const result = await validateProject(testDir);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.message.includes("references source 'S9-DANGLING'"))
      ).toBe(true);
    });

    it("rejects person-level sources and an unknown top-level section", async () => {
      const tree = {
        persons: [
          {
            id: "P1",
            gender: "Male",
            names: [{ id: "N1", given: "John", surname: "Doe" }],
            sources: [{ ref: "S1" }],
          },
        ],
        relationships: [],
        sources: [{ id: "S1", title: "Census" }],
        places: [{ id: "PL1", name: "Ireland" }],
      };
      await writeProject(minimalResearch, tree);
      const result = await validateProject(testDir);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.message.includes("unexpected property 'sources'"))
      ).toBe(true);
      expect(
        result.errors.some((e) => e.message.includes("unexpected property 'places'"))
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
              recordId: "ark_001",
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

    it("D5: matches record_id to recordId by canonical ARK form, not exact string", async () => {
      const research = {
        ...minimalResearch,
        log: [
          { id: "log_001", plan_item_id: null, performed: "2026-01-01T00:00:00Z", tool: "record_search", query: {}, outcome: "positive", results_examined: 1, results_ref: "results/log_001.json", external_site: null },
        ],
        sources: [
          { id: "src_001", gedcomx_source_description_id: "SD-001", citation: "Test", citation_detail: { who: "Test", what: "Test", when_created: "2020", when_accessed: "2026-01-01", where: "Test", where_within: "Test" }, source_classification: "original", repository: "Test", access_date: "2026-01-01" },
        ],
        assertions: [
          {
            id: "a_001",
            source_id: "src_001",
            // Full resolver URL; the sidecar stores the bare ARK — they match by canonical form.
            record_id: "https://www.familysearch.org/ark:/61903/1:1:MXHY-TP4",
            record_role: "principal",
            record_persona_id: "PERSON1",
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
        log_id: "log_001", tool: "record_search", retrieved: "2026-01-01T00:00:00Z", returned_count: 1,
        payload: { results: [{ recordId: "ark:/61903/1:1:MXHY-TP4", gedcomx: { persons: [{ id: "PERSON1" }] } }] },
      };
      const tree = { ...minimalTree, sources: [{ id: "SD-001", title: "Test" }] };
      await writeProject(research, tree);
      await mkdir(join(testDir, "results"));
      await writeFile(join(testDir, "results/log_001.json"), JSON.stringify(sidecar));

      const result = await validateProject(testDir);
      // URL record_id matched bare-ARK recordId by canonical form, persona resolved → no D5 errors.
      expect(result.errors.some((e) => e.message.includes("does not match any result's recordId"))).toBe(false);
      expect(result.errors.some((e) => e.message.includes("does not resolve to a person in record"))).toBe(false);
    });

    it("D5: a record_id for a different entity still fails to match (canonical, not wildcard)", async () => {
      const research = {
        ...minimalResearch,
        log: [
          { id: "log_001", plan_item_id: null, performed: "2026-01-01T00:00:00Z", tool: "record_search", query: {}, outcome: "positive", results_examined: 1, results_ref: "results/log_001.json", external_site: null },
        ],
        sources: [
          { id: "src_001", gedcomx_source_description_id: "SD-001", citation: "Test", citation_detail: { who: "Test", what: "Test", when_created: "2020", when_accessed: "2026-01-01", where: "Test", where_within: "Test" }, source_classification: "original", repository: "Test", access_date: "2026-01-01" },
        ],
        assertions: [
          { id: "a_001", source_id: "src_001", record_id: "ark:/61903/1:1:DIFFERENT", record_role: "principal", record_persona_id: "PERSON1", fact_type: "birth", value: "1850", information_quality: "primary", informant: "self", informant_proximity: "self", evidence_type: "direct", extracted_for_question_ids: [], log_entry_id: "log_001" },
        ],
      };
      const sidecar = {
        log_id: "log_001", tool: "record_search", retrieved: "2026-01-01T00:00:00Z", returned_count: 1,
        payload: { results: [{ recordId: "ark:/61903/1:1:MXHY-TP4", gedcomx: { persons: [{ id: "PERSON1" }] } }] },
      };
      const tree = { ...minimalTree, sources: [{ id: "SD-001", title: "Test" }] };
      await writeProject(research, tree);
      await mkdir(join(testDir, "results"));
      await writeFile(join(testDir, "results/log_001.json"), JSON.stringify(sidecar));

      const result = await validateProject(testDir);
      expect(result.errors.some((e) => e.message.includes("does not match any result's recordId"))).toBe(true);
    });
  });

  describe("Evaluations", () => {
    it("flags missing evaluations top-level section", async () => {
      const research = { ...minimalResearch };
      // Remove `evaluations` to confirm requiredSections fires.
      delete (research as Record<string, unknown>).evaluations;
      await writeProject(research, minimalTree);

      const result = await validateProject(testDir);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) =>
          e.message.includes("missing top-level section 'evaluations'")
        )
      ).toBe(true);
    });

    it("accepts a valid evaluation entry referencing a question", async () => {
      const research = {
        ...minimalResearch,
        questions: [
          {
            id: "q_001",
            question: "Test question?",
            rationale: "test",
            selection_basis: "user_directed",
            priority: "medium",
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
        evaluations: [
          {
            id: "ev_001",
            focus: "pre-exhaustiveness",
            target_id: "q_001",
            target_type: "question",
            verdict: "looks_solid",
            file_path: "evaluations/pre-exhaustiveness-q_001-2026-06-02T14-30-00.json",
            timestamp: "2026-06-02T14:30:00Z",
            superseded_by: null,
          },
        ],
      };
      await writeProject(research, minimalTree);

      const result = await validateProject(testDir);
      expect(result.errors).toEqual([]);
      expect(result.valid).toBe(true);
    });

    it("flags invalid focus enum", async () => {
      const research = {
        ...minimalResearch,
        evaluations: [
          {
            id: "ev_001",
            focus: "bogus-focus",
            target_id: "project",
            target_type: "project",
            verdict: "looks_solid",
            file_path: "evaluations/x.json",
            timestamp: "2026-06-02T14:30:00Z",
            superseded_by: null,
          },
        ],
      };
      await writeProject(research, minimalTree);

      const result = await validateProject(testDir);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.message.includes("evaluation_focus"))
      ).toBe(true);
    });

    it("flags invalid verdict enum", async () => {
      const research = {
        ...minimalResearch,
        evaluations: [
          {
            id: "ev_001",
            focus: "on-demand",
            target_id: "project",
            target_type: "project",
            verdict: "totally_fine",
            file_path: "evaluations/x.json",
            timestamp: "2026-06-02T14:30:00Z",
            superseded_by: null,
          },
        ],
      };
      await writeProject(research, minimalTree);

      const result = await validateProject(testDir);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.message.includes("evaluation_verdict"))
      ).toBe(true);
    });

    it("flags wrong id prefix", async () => {
      const research = {
        ...minimalResearch,
        evaluations: [
          {
            id: "eval_001",
            focus: "on-demand",
            target_id: "project",
            target_type: "project",
            verdict: "looks_solid",
            file_path: "evaluations/x.json",
            timestamp: "2026-06-02T14:30:00Z",
            superseded_by: null,
          },
        ],
      };
      await writeProject(research, minimalTree);

      const result = await validateProject(testDir);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.message.includes("should start with 'ev_'"))
      ).toBe(true);
    });

    it("flags target_id that does not match a known question", async () => {
      const research = {
        ...minimalResearch,
        evaluations: [
          {
            id: "ev_001",
            focus: "pre-exhaustiveness",
            target_id: "q_missing",
            target_type: "question",
            verdict: "address_first",
            file_path: "evaluations/x.json",
            timestamp: "2026-06-02T14:30:00Z",
            superseded_by: null,
          },
        ],
      };
      await writeProject(research, minimalTree);

      const result = await validateProject(testDir);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) =>
          e.message.includes("references question 'q_missing'")
        )
      ).toBe(true);
    });

    it("flags target_id != 'project' when target_type is project", async () => {
      const research = {
        ...minimalResearch,
        evaluations: [
          {
            id: "ev_001",
            focus: "on-demand",
            target_id: "q_001",
            target_type: "project",
            verdict: "looks_solid",
            file_path: "evaluations/x.json",
            timestamp: "2026-06-02T14:30:00Z",
            superseded_by: null,
          },
        ],
      };
      await writeProject(research, minimalTree);

      const result = await validateProject(testDir);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) =>
          e.message.includes("target_id for target_type 'project' must be \"project\"")
        )
      ).toBe(true);
    });

    it("accepts superseded_by referencing another evaluation in the array", async () => {
      const research = {
        ...minimalResearch,
        evaluations: [
          {
            id: "ev_001",
            focus: "on-demand",
            target_id: "project",
            target_type: "project",
            verdict: "address_first",
            file_path: "evaluations/x.json",
            timestamp: "2026-06-02T14:30:00Z",
            superseded_by: "ev_002",
          },
          {
            id: "ev_002",
            focus: "on-demand",
            target_id: "project",
            target_type: "project",
            verdict: "looks_solid",
            file_path: "evaluations/y.json",
            timestamp: "2026-06-02T15:00:00Z",
            superseded_by: null,
          },
        ],
      };
      await writeProject(research, minimalTree);

      const result = await validateProject(testDir);
      expect(result.errors).toEqual([]);
      expect(result.valid).toBe(true);
    });

    it("flags superseded_by referencing a non-existent evaluation", async () => {
      const research = {
        ...minimalResearch,
        evaluations: [
          {
            id: "ev_001",
            focus: "on-demand",
            target_id: "project",
            target_type: "project",
            verdict: "address_first",
            file_path: "evaluations/x.json",
            timestamp: "2026-06-02T14:30:00Z",
            superseded_by: "ev_999",
          },
        ],
      };
      await writeProject(research, minimalTree);

      const result = await validateProject(testDir);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) =>
          e.message.includes("superseded_by references 'ev_999'")
        )
      ).toBe(true);
    });

    it("flags an invalid ISO 8601 timestamp", async () => {
      const research = {
        ...minimalResearch,
        evaluations: [
          {
            id: "ev_001",
            focus: "on-demand",
            target_id: "project",
            target_type: "project",
            verdict: "looks_solid",
            file_path: "evaluations/x.json",
            timestamp: "not-a-date",
            superseded_by: null,
          },
        ],
      };
      await writeProject(research, minimalTree);

      const result = await validateProject(testDir);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.message.includes("is not a valid ISO 8601 date-time"))
      ).toBe(true);
    });
  });
});

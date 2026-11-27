import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { stepSpawn } from "../../src/utils/step-spawn.js";
import { questionStates, type QuestionStatus } from "../../src/utils/question-state.js";

const status = (over: Partial<QuestionStatus>): QuestionStatus => ({
  id: "q_001",
  state: "evidence-gathered",
  nextStep: null,
  openConflictIds: [],
  storedStatus: "in_progress",
  unregisteredDisagreements: [],
  competingParentSets: [],
  ...over,
});

const research = {
  assertions: [
    { id: "a_001", extracted_for_question_ids: ["q_001"] },
    { id: "a_002", extracted_for_question_ids: ["q_001"] },
    { id: "a_009", extracted_for_question_ids: ["q_002"] },
  ],
};

describe("stepSpawn", () => {
  it("hands person-evidence the question's assertion ids", () => {
    const s = stepSpawn("/p", research, status({ nextStep: "person-evidence — none of this question's 2 assertions is linked to a person" }));
    expect(s?.agent).toBe("person-evidence");
    expect(s?.prompt.split("\n")).toEqual([
      "projectPath: /p",
      "questionId: q_001",
      "assertionIds: a_001, a_002",
      "userPresent: yes",
      "reason: person-evidence — none of this question's 2 assertions is linked to a person",
    ]);
  });

  it("hands conflict-resolution the competing assertions of each unregistered disagreement", () => {
    const s = stepSpawn(
      "/p",
      research,
      status({
        nextStep: "conflict-resolution — unregistered disagreement: I2 birth place (a_001, a_002)",
        unregisteredDisagreements: [{ personId: "I2", fact: "birth place", assertionIds: ["a_001", "a_002"] }],
      }),
    );
    expect(s?.agent).toBe("conflict-resolution");
    expect(s?.prompt).toContain("competingAssertionIds: a_001, a_002 (I2 birth place)");
  });

  it("hands conflict-resolution an open conflict's id", () => {
    const s = stepSpawn("/p", research, status({ nextStep: "conflict-resolution — unresolved c_003", openConflictIds: ["c_003"] }));
    expect(s?.prompt).toContain("conflictIds: c_003");
  });

  it("hands hypothesis-tracking each competing parent set", () => {
    const s = stepSpawn(
      "/p",
      research,
      status({
        nextStep: "hypothesis-tracking — competing parent sets: I1 (I2, I3, I4)",
        competingParentSets: [{ personId: "I1", parentIds: ["I2", "I3", "I4"] }],
      }),
    );
    expect(s?.agent).toBe("hypothesis-tracking");
    expect(s?.prompt).toContain("personId: I1; parentIds: I2, I3, I4");
  });

  it("hands person-evidence the subject's id, which the unreached-subject step names only in words", () => {
    const dir = join(dirname(fileURLToPath(import.meta.url)), "../../../../../eval/fixtures/scenarios/flynn-household-skeleton");
    const r = JSON.parse(readFileSync(join(dir, "research.json"), "utf-8"));
    const tree = JSON.parse(readFileSync(join(dir, "tree.gedcomx.json"), "utf-8"));
    const st = questionStates(r, tree).find((q) => q.nextStep?.includes("reaches the project subject"))!;
    const s = stepSpawn("/p", r, st, tree);
    expect(s?.agent).toBe("person-evidence");
    expect(s?.prompt).toMatch(/^personIds: I1$/m);
  });

  it("hands hypothesis-tracking the unlinked kin's ids, which the step names only in words", () => {
    const dir = join(dirname(fileURLToPath(import.meta.url)), "../../../../../eval/fixtures/scenarios/unregistered-sibling-premise-scopes-searches");
    const r = JSON.parse(readFileSync(join(dir, "research.json"), "utf-8"));
    const tree = JSON.parse(readFileSync(join(dir, "tree.gedcomx.json"), "utf-8"));
    const st = questionStates(r, tree).find((q) => q.nextStep?.includes("unlinked kin"))!;
    const s = stepSpawn("/p", r, st, tree);
    expect(s?.agent).toBe("hypothesis-tracking");
    expect(s?.prompt).toContain("personIds: I2, I3");
    expect(s?.prompt).toContain("reason: hypothesis-tracking — unlinked kin: Nora Stowers, Lois E. Stowers");
  });

  it.each([
    ["research-exhaustiveness, then proof-conclusion", "research-exhaustiveness"],
    ["proof-conclusion — concluded while blocked: re-conclude ps_001", "proof-conclusion"],
  ])("names the agent %s opens with", (nextStep, agent) => {
    const s = stepSpawn("/p", research, status({ nextStep }));
    expect(s?.agent).toBe(agent);
    expect(s?.prompt).toContain(`reason: ${nextStep}`);
  });

  it.each([
    [null],
    ["research-plan"],
    ["search-records"],
    ["extraction (extraction_append for FamilySearch records, record-structurer for any other source)"],
    ["researcher's choice: research-plan or proof-conclusion (default research-plan)"],
  ])("writes no spawn for nextStep %s", (nextStep) => {
    expect(stepSpawn("/p", research, status({ nextStep }))).toBeNull();
  });

  it("on the research suite's unregistered-conflict scenario, spawns conflict-resolution", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const dir = join(here, "..", "..", "..", "..", "..", "eval", "fixtures", "scenarios", "research-unregistered-census-conflicts");
    const r = JSON.parse(readFileSync(join(dir, "research.json"), "utf-8"));
    const t = JSON.parse(readFileSync(join(dir, "tree.gedcomx.json"), "utf-8"));
    const [q] = questionStates(r, t);
    const s = stepSpawn("/p", r, q);
    expect(s?.agent).toBe("conflict-resolution");
    expect(s?.prompt).toContain("competingAssertionIds: a_007, a_023, a_044 (I2 birth place)");
  });
});

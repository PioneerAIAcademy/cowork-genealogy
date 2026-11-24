// A question's next agent step, written out as the spawn the router sends.
//
// `nextStep` names the agent in prose with its ids inline; a cheaper router read
// past it, walked the routing table to another agent, or wrote no spawn at all
// (Haiku 5.5 low: ut_research_h22, rx4, 9k4). The agent and every id it takes are
// in the project documents, so the tool writes the delegation (ADR-0011).
// research-plan is left out: its rung does not know whether the question's
// jurisdiction has had its locality survey, which comes first.

import { questionAssertions } from "./assertion-liveness.js";
import type { QuestionStatus } from "./question-state.js";

export interface StepSpawn {
  agent: "conflict-resolution" | "person-evidence" | "hypothesis-tracking" | "research-exhaustiveness" | "proof-conclusion";
  prompt: string;
}

const SPAWNED = new Set<StepSpawn["agent"]>([
  "conflict-resolution",
  "person-evidence",
  "hypothesis-tracking",
  "research-exhaustiveness",
  "proof-conclusion",
]);

/** The spawn for a question whose `nextStep` names one of `SPAWNED`, else null. */
export function stepSpawn(projectPath: string, research: any, status: QuestionStatus): StepSpawn | null {
  const next = status.nextStep;
  if (typeof next !== "string") return null;
  const agent = next.match(/^([a-z-]+)/)?.[1] as StepSpawn["agent"] | undefined;
  if (!agent || !SPAWNED.has(agent)) return null;
  const lines = [`projectPath: ${projectPath}`, `questionId: ${status.id}`];
  if (agent === "person-evidence") {
    const ids = questionAssertions(research, status.id)
      .map((a: any) => a?.id)
      .filter((id: unknown): id is string => typeof id === "string");
    lines.push(`assertionIds: ${ids.join(", ")}`, "userPresent: yes");
  } else if (agent === "conflict-resolution") {
    if (next.includes("unregistered disagreement")) {
      for (const d of status.unregisteredDisagreements) {
        lines.push(`competingAssertionIds: ${d.assertionIds.join(", ")} (${d.personId} ${d.fact})`);
      }
    } else if (status.openConflictIds.length > 0) {
      lines.push(`conflictIds: ${status.openConflictIds.join(", ")}`);
    }
  } else if (agent === "hypothesis-tracking") {
    for (const p of status.competingParentSets) {
      lines.push(`personId: ${p.personId}; parentIds: ${p.parentIds.join(", ")}`);
    }
  }
  lines.push(`reason: ${next}`);
  return { agent, prompt: lines.join("\n") };
}

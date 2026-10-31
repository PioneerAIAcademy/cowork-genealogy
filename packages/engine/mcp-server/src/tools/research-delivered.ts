/**
 * The carrier for "I delivered what this message asked for".
 *
 * On BOTH hosted planes a `PreToolUse` hook matches this tool's NAME and ends the turn
 * before the tool executes, so this body never runs there. It is a signal, not an
 * action: it writes no project state.
 *
 * It exists as a real tool rather than as a sentence in a skill body because a hook
 * can match a tool name exactly, and cannot rely on prose the model may not honour --
 * the same reason a decision exit would match `AskUserQuestion`. It is deliberately NOT
 * AskUserQuestion: an ask waits for an answer and a delivery waits for nothing, so one
 * tool carrying both would leave the hook with no way to tell them apart.
 *
 * Everywhere else there is no such hook, and the tool must return something harmless
 * and truthful rather than erroring or claiming an effect it did not have -- so the
 * reply says plainly that the signal was recorded and the run continues.
 *
 * Which environments those are, checked rather than assumed: the e2e harness binds the
 * REAL engine server and grants `mcp__genealogy` as a server-prefix wildcard, so the
 * tool is advertised and callable there with nothing intercepting it -- the inert arm
 * below is what runs. Cowork is the same shape. The UNIT harness binds a mock server
 * registering only fixture-backed tools plus `LIVE_TOOLS`; this tool is a `LIVE_TOOL`
 * there, so the inert arm runs and the call is recorded -- which is what lets a unit
 * test grade whether the model made it.
 */

export interface ResearchDeliveredInput {
  /** What was delivered, in the researcher's terms. */
  summary: string;
}

export interface ResearchDeliveredResult {
  acknowledged: true;
  summary: string;
  note: string;
}

export function researchDelivered(
  input: ResearchDeliveredInput
): ResearchDeliveredResult {
  const summary = (input?.summary ?? "").trim();
  return {
    acknowledged: true,
    summary,
    // Truthful in BOTH environments: where the hook binds, the turn has already ended
    // and nobody reads this; where it does not, the run genuinely does carry on.
    note:
      "Signal received. Where this run is managed, the turn ends here; otherwise it carries on.",
  };
}

export const researchDeliveredSchema = {
  name: "research_delivered",
  description:
    "Signal that you have delivered this turn's deliverable and are stopping on purpose. Use this for a request bounded to one or more deliverables, once this turn's one is produced — the only one asked for, or the first of several (name the others and end on the next one's \"Continue with …?\" offer, then call this; that offer is not a question) — a plan the user asked you to stop after, a single record lookup, or a status question — so a managed run can end here instead of continuing past what was asked. Do NOT use it when the project's research objective is complete (the run ends on its own), and do NOT use it in place of a question only the researcher can answer (use the question tool, which waits for an answer).",
  inputSchema: {
    type: "object" as const,
    properties: {
      summary: {
        type: "string",
        description:
          "One sentence naming what was delivered, in the researcher's terms.",
      },
    },
    required: ["summary"],
  },
};

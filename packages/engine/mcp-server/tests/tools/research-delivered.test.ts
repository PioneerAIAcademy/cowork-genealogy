import { describe, it, expect } from "vitest";
import { researchDelivered, researchDeliveredSchema } from "../../src/tools/research-delivered.js";

describe("research_delivered", () => {
  it("acknowledges and echoes the trimmed summary", () => {
    const r = researchDelivered({ summary: "  the plan you asked for  " });
    expect(r.acknowledged).toBe(true);
    expect(r.summary).toBe("the plan you asked for");
  });

  it("writes nothing, claims no stop it did not cause, and tells the model to stop", () => {
    // Where the hosted PreToolUse hook binds, the turn has already ended and nobody
    // reads this. Where it does not (Cowork, both harnesses), nothing ends the turn but
    // the model itself, so the note must not claim the turn stopped -- and must not say
    // the run "carries on" either, which the model read as leave to keep working.
    const r = researchDelivered({ summary: "x" });
    expect(r.note).toMatch(/make no further tool calls and end your turn/);
    expect(r.note).not.toMatch(/carries on/);
    expect(r.note).not.toMatch(/the turn has ended\b/);
  });

  it("does not throw on a missing or null summary", () => {
    // The server checks argument names, not types, so the body is what has to cope.
    expect(() => researchDelivered({} as never)).not.toThrow();
    expect(researchDelivered({ summary: null } as never).summary).toBe("");
  });

  it("the schema names the tool and requires a summary", () => {
    // The hook matches the QUALIFIED name; the prompt names the bare one. Both derive
    // from this.
    expect(researchDeliveredSchema.name).toBe("research_delivered");
    expect(researchDeliveredSchema.inputSchema.required).toEqual(["summary"]);
  });

  it("the description draws both boundaries the guidance does", () => {
    // Two ways this misfires and both must be excluded where the model reads them:
    // calling it when the OBJECTIVE is finished (that run ends on its own), and
    // calling it instead of asking a question (an ask waits, a delivery does not).
    const d = researchDeliveredSchema.description.toLowerCase();
    expect(d).toContain("objective");
    // NOT /ask|question/: both match elsewhere in the description, so that assertion
    // cannot fail. Pin the clause itself.
    expect(d).toContain("do not use it in place of a question only the researcher can answer");
  });

  it("the description follows step mode: one deliverable per turn, the offer is not a question", () => {
    // "once every one is produced" contradicted step mode on a compound bounded ask: the
    // model held the call back until the second deliverable existed, or produced both in
    // one turn to earn it (ut_research_c1k failed both ways).
    const d = researchDeliveredSchema.description.toLowerCase();
    expect(d).toContain("the only one asked for, or the first of several");
    expect(d).toContain("that offer is not a question");
    expect(d).not.toContain("every one is produced");
  });
});

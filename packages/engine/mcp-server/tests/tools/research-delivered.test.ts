import { describe, it, expect } from "vitest";
import { researchDelivered, researchDeliveredSchema } from "../../src/tools/research-delivered.js";

describe("research_delivered", () => {
  it("acknowledges and echoes the trimmed summary", () => {
    const r = researchDelivered({ summary: "  the plan you asked for  " });
    expect(r.acknowledged).toBe(true);
    expect(r.summary).toBe("the plan you asked for");
  });

  it("writes nothing and says so truthfully for BOTH environments", () => {
    // Where the hosted PreToolUse hook binds, the turn has already ended and nobody
    // reads this. Where it does not (Cowork, the unit harness), the run genuinely
    // carries on -- so the note must not claim the turn stopped.
    const r = researchDelivered({ summary: "x" });
    expect(r.note).toMatch(/otherwise it carries on/);
    expect(r.note).not.toMatch(/the turn has ended\b/);
  });

  it("does not throw on a missing or null summary", () => {
    // The server does not validate inputSchema, so the body is what has to cope.
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
    expect(d).toMatch(/ask|question/);
  });
});

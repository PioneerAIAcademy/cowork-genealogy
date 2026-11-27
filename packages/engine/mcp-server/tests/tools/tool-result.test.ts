import { describe, it, expect } from "vitest";
import {
  CONNECTOR_REFUSAL_NOTE,
  connectorToolResult,
  markRefusal,
  writerToolResult,
  OK_FALSE_IS_FAILURE,
} from "../../src/tool-result.js";

describe("connectorToolResult — a refusal is not an error in front of a chat user", () => {
  const text = (out: { content: Array<{ text: string }> }) => out.content[0].text;

  it("returns a refused write as an ordinary result, under a note the model reads first", () => {
    const result = { ok: false, errors: ["ops[0]: say the structure is inferred"], opsReceived: 1 };
    const out = connectorToolResult(writerToolResult(result));
    expect("isError" in out).toBe(false);
    const body = JSON.parse(text(out));
    expect(Object.keys(body)[0]).toBe("refused");
    expect(body).toEqual({ refused: CONNECTOR_REFUSAL_NOTE, ...result });
    // The note says what the mark said: nothing was done, and what to do next.
    expect(CONNECTOR_REFUSAL_NOTE).toMatch(/^Refused, and nothing was written or changed\./);
    expect(CONNECTOR_REFUSAL_NOTE).toMatch(/send the call again\.$/);
  });

  it("leaves the envelope every other surface gets exactly as it was", () => {
    const result = { ok: false, errors: ["bad"] };
    const envelope = writerToolResult(result);
    connectorToolResult(envelope);
    expect(envelope).toEqual({ content: [{ type: "text", text: JSON.stringify(result) }], isError: true });
  });

  it("returns a success, and the no-project answer, as the very same object", () => {
    const ok = writerToolResult({ ok: true });
    const noProject = writerToolResult({ ok: false, reason: "no_project" });
    expect(connectorToolResult(ok)).toBe(ok);
    expect(connectorToolResult(noProject)).toBe(noProject);
  });

  it("says nothing a returned fault would make false", () => {
    // A tool may return a fault as ok:false: project_create returns a failed FamilySearch
    // read as its refusal, a 5xx included. The note cannot tell that from a broken rule,
    // so it must not call the cause a rule or say that nothing is broken.
    const fault = { ok: false, errors: ["FamilySearch API error 503: Service Unavailable"] };
    const body = JSON.parse(text(connectorToolResult(writerToolResult(fault))));
    expect(body.errors).toEqual(fault.errors);
    expect(body.refused).not.toMatch(/broken|rule/i);
  });

  it("goes by the tag on the envelope, never by its text: a thrown error and an untagged ok:false stay errors", () => {
    // What a catch arm builds for a thrown error, and a hand-built ok:false no tool tagged.
    const thrown = { content: [{ type: "text" as const, text: JSON.stringify({ error: "FamilySearch did not answer" }) }], isError: true };
    const lookalike = { content: [{ type: "text" as const, text: JSON.stringify({ ok: false, errors: ["x"] }) }], isError: true };
    expect(connectorToolResult(thrown)).toBe(thrown);
    expect(connectorToolResult(lookalike)).toBe(lookalike);
  });

  it("covers a refusal the dispatcher itself makes, whose body is { error }", () => {
    const refusal = markRefusal({ content: [{ type: "text" as const, text: JSON.stringify({ error: "bogus is not a parameter" }) }], isError: true });
    const out = connectorToolResult(refusal);
    expect("isError" in out).toBe(false);
    expect(JSON.parse(text(out))).toEqual({ refused: CONNECTOR_REFUSAL_NOTE, error: "bogus is not a parameter" });
  });

  it.each([["text that is not JSON", "plain words"], ["a JSON array", "[1,2]"], ["a JSON string", '"x"'], ["null", "null"]])(
    "returns a tagged envelope whose body is %s unchanged, error mark and all",
    (_label, body) => {
      const envelope = markRefusal({ content: [{ type: "text" as const, text: body }], isError: true });
      expect(connectorToolResult(envelope)).toBe(envelope);
    },
  );
});

describe("writerToolResult", () => {
  it("sets isError on a returned failure", () => {
    // Bound to a const, not passed inline: `OkFalseResult` is deliberately
    // index-signature-free (see tool-result.ts), so an inline literal carrying
    // a tool's own payload fields trips excess-property checking. Real callers
    // pass a concrete result value, which this mirrors.
    const result = { ok: false, errors: ["bad"] };
    const out = writerToolResult(result);
    expect(out.isError).toBe(true);
  });

  it("leaves isError unset on success, so a successful envelope is unchanged", () => {
    // Unset rather than `false`: the pre-change arms emitted no `isError` key at
    // all, and anything reading a successful result must not see a new shape.
    const result = { ok: true, filesWritten: ["research.json"] };
    const out = writerToolResult(result);
    expect(out.isError).toBeUndefined();
    expect("isError" in out).toBe(false);
  });

  it("leaves isError unset on the no-project answer (issue #1695)", () => {
    // The ONE ok:false exemption. The user is not in a research project, so
    // nothing was asked of a project that exists — marking it would tell the
    // model its work failed when only the record of it is missing. Mirrored by
    // `_tool_envelope` in eval/harness/harness/mock_mcp.py.
    const result = { ok: false, reason: "no_project", errors: ["not a project"] };
    const out = writerToolResult(result);
    expect(out.isError).toBeUndefined();
    expect("isError" in out).toBe(false);
  });

  it("still sets isError on a failure carrying an unrelated reason", () => {
    // Guards the discriminator against being read as "any reason exempts".
    const result = { ok: false, reason: "validation", errors: ["bad"] };
    expect(writerToolResult(result).isError).toBe(true);
  });

  it("carries the tool's payload through verbatim", () => {
    const result = { ok: false, errors: ["nope"], opsReceived: 2 };
    const out = writerToolResult(result);
    expect(out.content).toEqual([
      { type: "text", text: JSON.stringify(result) },
    ]);
  });

  it("treats a missing ok as success — only an explicit false is a failure", () => {
    // Guards against a tool whose result omits `ok` being flagged as failed.
    expect(writerToolResult({}).isError).toBeUndefined();
  });

  describe("OK_FALSE_IS_FAILURE", () => {
    it("excludes merge_warnings, whose ok:false is its answer, not its failure", () => {
      // A dry run reporting that a merge WOULD be rejected is the tool working.
      // Marking it isError would tell the agent its preview crashed.
      expect(OK_FALSE_IS_FAILURE).not.toContain("merge_warnings");
    });

    it("excludes validate_research_schema, which answers with valid, not ok", () => {
      expect(OK_FALSE_IS_FAILURE).not.toContain("validate_research_schema");
    });

    it("has no duplicates", () => {
      expect(new Set(OK_FALSE_IS_FAILURE).size).toBe(OK_FALSE_IS_FAILURE.length);
    });
  });
});

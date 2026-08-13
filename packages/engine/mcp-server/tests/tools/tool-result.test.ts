import { describe, it, expect } from "vitest";
import {
  writerToolResult,
  OK_FALSE_IS_FAILURE,
} from "../../src/tool-result.js";

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

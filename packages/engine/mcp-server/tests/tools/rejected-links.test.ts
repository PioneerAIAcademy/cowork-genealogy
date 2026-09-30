import { describe, it, expect } from "vitest";
import { isRejectedPair, rejectionFor } from "../../src/utils/rejected-links.js";

// Phase 3 item 3, ruled option 3: a rejection is its OWN record, not a fourth
// confidence value. `person_evidence.confidence` means "how sure are we this IS a
// match" (confident | probable | speculative) -- "rejected" is the opposite claim,
// not a degree of it.
//
// The reported failure: a researcher challenged an assumption and the agent reverted
// to it, because nothing recorded the rivals. So the refusal to re-link a rejected
// pair is decidable from research.json alone, which per ADR-0011 makes it a writer
// precondition rather than prose a model may not follow.

const rej = (assertion_id: string, person_id: string, over = {}): Record<string, unknown> => ({
  id: "rj_001", assertion_id, person_id, created: "2026-09-30", ...over
});

describe("isRejectedPair", () => {
  it("refuses the exact pair a researcher rejected", () => {
    expect(isRejectedPair("a_001", "I1", [rej("a_001", "I1")])).toBe(true);
  });

  it("allows the same assertion against a DIFFERENT person", () => {
    // Rejecting "this record is not Mary" says nothing about her sister.
    expect(isRejectedPair("a_001", "I2", [rej("a_001", "I1")])).toBe(false);
  });

  it("allows a different assertion against the same person", () => {
    expect(isRejectedPair("a_002", "I1", [rej("a_001", "I1")])).toBe(false);
  });

  it("allows everything when nothing has been rejected", () => {
    expect(isRejectedPair("a_001", "I1", [])).toBe(false);
  });

  it("is not fooled by a missing or malformed record", () => {
    const bad = [{}, { assertion_id: "a_001" }, null] as unknown as Record<string, unknown>[];
    expect(isRejectedPair("a_001", "I1", bad)).toBe(false);
  });

  it("allows the pair again once the rejection is withdrawn", () => {
    // A rejection is a fact the researcher can change their mind about; the record
    // going away is how they do it.
    expect(isRejectedPair("a_001", "I1", [rej("a_002", "I3")])).toBe(false);
  });
});

describe("rejectionFor", () => {
  it("returns the record so the refusal can quote the researcher's reason", () => {
    const r = rejectionFor("a_001", "I1", [rej("a_001", "I1", { reason: "different birth year" })]);
    expect(r?.reason).toBe("different birth year");
  });

  it("returns the record even when no reason was given", () => {
    // "never a demand for the right answer" -- a reason is optional, and a rejection
    // without one is still binding.
    expect(rejectionFor("a_001", "I1", [rej("a_001", "I1")])).not.toBeNull();
  });

  it("returns null when the pair was never rejected", () => {
    expect(rejectionFor("a_009", "I9", [rej("a_001", "I1")])).toBeNull();
  });
});

// --- The refusal, through the real writer tool -------------------------------------
//
// The checker being correct is worth nothing if research_append never calls it -- a
// correct function nothing invokes looks identical to a working feature.

import { researchAppend } from "../../src/tools/research-append.js";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function project(research: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), "rej-"));
  mkdirSync(join(dir, "results"), { recursive: true });
  writeFileSync(join(dir, "research.json"), JSON.stringify({
    project: { id: "rp_t", status: "active" },
    questions: [], plans: [], log: [], sources: [],
    assertions: [{ id: "a_001" }], person_evidence: [],
    conflicts: [], hypotheses: [], timelines: [], proof_summaries: [],
    evaluations: [], localities: [], known_holdings: [],
    ...research
  }), "utf8");
  writeFileSync(join(dir, "tree.gedcomx.json"),
    JSON.stringify({ persons: [{ id: "I1" }], relationships: [], sources: [] }), "utf8");
  return dir;
}

describe("research_append refuses a rejected pair", () => {
  it("refuses the link, naming the rejection", async () => {
    const dir = project({
      rejected_links: [{ id: "rj_001", assertion_id: "a_001", person_id: "I1",
                         reason: "different birth year", created: "2026-09-30" }]
    });
    const out = await researchAppend({
      projectPath: dir, section: "person_evidence", op: "append",
      entry: { assertion_id: "a_001", person_id: "I1", confidence: "probable", rationale: "x" }
    } as never, undefined as never).catch((e: Error) => e);
    const text = out instanceof Error ? out.message : JSON.stringify(out);
    expect(text).toMatch(/rejected as not a match/);
    expect(text).toMatch(/different birth year/);
  });

  it("allows the same assertion against a different person", async () => {
    const dir = project({
      rejected_links: [{ id: "rj_001", assertion_id: "a_001", person_id: "I2",
                         created: "2026-09-30" }]
    });
    const out = await researchAppend({
      projectPath: dir, section: "person_evidence", op: "append",
      entry: { assertion_id: "a_001", person_id: "I1", confidence: "probable", rationale: "x" }
    } as never, undefined as never).catch((e: Error) => e);
    const text = out instanceof Error ? out.message : JSON.stringify(out);
    expect(text).not.toMatch(/rejected as not a match/);
  });
});

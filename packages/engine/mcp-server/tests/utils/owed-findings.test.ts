// Owed findings (docs/plan/conclusion-tree.md Decision 33) over the shared
// vectors in docs/specs/schemas/owed-findings-vectors.json.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { owedFindings } from "../../src/utils/owed-findings.js";
import { questionStatus } from "../../src/utils/question-state.js";
import { ID_PREFIXES } from "../../src/validation/validator.js";

const vectors = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "..", "..", "..", "..", "docs", "specs", "schemas", "owed-findings-vectors.json"), "utf-8"),
);

describe("owed findings vectors", () => {
  it.each<[string, any]>(vectors.cases.map((c: any) => [c.name, c]))("%s", (_name: string, c: any) => {
    const got = owedFindings(c.research, c.tree);
    expect(got).toHaveLength(c.expect.length);
    c.expect.forEach((want: any, i: number) => expect(got[i]).toMatchObject(want));
  });
});

// The status answer repeats `nextStep` to the researcher and must name no id
// (lead, 2026-10-06), so `ref` carries the id and `nextStep` names none (lead,
// 2026-11-19, #4661). The pattern matches the eval's `_PROJECT_ID_RE`
// (eval/harness/validators/test_research.py): every research prefix plus tree ids.
const ID_RE = new RegExp(
  `\\b(?:(?:${Object.values(ID_PREFIXES).join("|")})\\d+|[FINRS]\\d+)\\b`,
);

describe("owed findings name no id in nextStep (#4661)", () => {
  const findings: [string, string, string][] = vectors.cases.flatMap((c: any) =>
    owedFindings(c.research, c.tree).map((f) => [c.name, f.kind, f.nextStep] as [string, string, string]),
  );

  it("the vectors exercise every kind", () => {
    const kinds = new Set(findings.map(([, k]) => k));
    for (const k of ["extract", "conclude", "hypothesis", "encode", "raise", "claims", "frame"]) expect(kinds).toContain(k);
  });

  it.each(findings)("%s: %s", (_name, _kind, nextStep) => {
    expect(nextStep).not.toMatch(ID_RE);
  });

  it("the pattern catches an id of every prefix and a tree id", () => {
    for (const p of Object.values(ID_PREFIXES)) expect(`re-conclude ${p}001`).toMatch(ID_RE);
    for (const t of ["I2", "S3", "F1"]) expect(`encode father from ${t}`).toMatch(ID_RE);
    expect("encode father").not.toMatch(ID_RE);
    expect("encode claims[0]").not.toMatch(ID_RE);
  });

  it("the concluded-while-blocked arm names no proof summary id", () => {
    const research = {
      questions: [{ id: "q_001", status: "open" }],
      plans: [],
      log: [],
      assertions: [],
      proof_summaries: [{ id: "ps_007", question_id: "q_001", tier: "not_proved" }],
    };
    const s = questionStatus(research, research.questions[0]);
    expect(s.nextStep).toMatch(/concluded while blocked/);
    expect(s.nextStep).not.toMatch(ID_RE);
  });
});

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
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
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
    evaluations: [], localities: [],
    ...research
  }), "utf8");
  writeFileSync(join(dir, "tree.gedcomx.json"),
    JSON.stringify({ persons: [{ id: "I1" }, { id: "I2" }], relationships: [], sources: [] }), "utf8");
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

  it("refuses an append even when the new entry is already superseded", async () => {
    // Pins the `op.op === "append"` arm independently of the re-raise clause. A create
    // is a create whatever its fields say, and an entry arriving already-superseded is
    // the one shape where the re-raise clause alone would let a rejected pair through.
    const dir = project({
      rejected_links: [{ id: "rj_001", assertion_id: "a_001", person_id: "I1",
                         reason: "different birth year", created: "2026-09-30" }]
    });
    const out = await researchAppend({
      projectPath: dir, section: "person_evidence", op: "append",
      entry: { assertion_id: "a_001", person_id: "I1", confidence: "probable",
               rationale: "x", superseded_by: "pe_999" }
    } as never, undefined as never).catch((e: Error) => e);
    const text = out instanceof Error ? out.message : JSON.stringify(out);
    expect(text).toMatch(/rejected as not a match/);
  });

  // ── Retiring a link that was rejected AFTER it was made ──────────────────
  // The normal sequence: a link exists, the researcher then rejects the pair. The
  // invariant fired on every person_evidence op, updates included, so that wrong link
  // could never afterwards be annotated, downgraded or superseded — it and the facts it
  // materialized stayed live for good. The refusal even said to "remove the rejection",
  // which this tool cannot do: there is no delete and the spec says never delete.

  const withLiveLink = () => project({
    person_evidence: [{ id: "pe_001", assertion_id: "a_001", person_id: "I1",
                        confidence: "probable", rationale: "made before the rejection" }],
    rejected_links: [{ id: "rj_001", assertion_id: "a_001", person_id: "I1",
                       reason: "different birth year", created: "2026-09-30" }],
  });

  /** Returns the response text, having first proved the call was actually accepted —
   *  an update rejected for an unrelated reason (a wrong parameter name, say) also fails
   *  to match /rejected as not a match/, so without this the three tests below pass
   *  without ever reaching the invariant they exist to exercise. */
  const update = async (fields: Record<string, unknown>) => {
    const out = await researchAppend({
      projectPath: withLiveLink(), section: "person_evidence", op: "update",
      entryId: "pe_001", fields,
    } as never, undefined as never).catch((e: Error) => e);
    const text = out instanceof Error ? out.message : JSON.stringify(out);
    expect(text, `the update itself failed, so the invariant was never reached: ${text}`)
      .not.toMatch(/requires an .entryId.|unknown section|no such entry/);
    return text;
  };

  it("lets a rejected link be given a rationale", async () => {
    expect(await update({ rationale: "superseded by the 1880 census" }))
      .not.toMatch(/rejected as not a match/);
  });

  it("lets a rejected link be downgraded to speculative", async () => {
    expect(await update({ confidence: "speculative" })).not.toMatch(/rejected as not a match/);
  });

  it("lets a rejected link be superseded", async () => {
    // The one route that actually retires it, and the one the refusal blocked.
    expect(await update({ superseded_by: "pe_002" })).not.toMatch(/rejected as not a match/);
  });

  it("still refuses an update that brings a superseded link back", async () => {
    // The other direction: clearing `superseded_by` re-raises the link, which IS a
    // re-link of a rejected pair and must stay refused. Without this the narrowing
    // would be a hole rather than a fix.
    const dir = project({
      person_evidence: [{ id: "pe_001", assertion_id: "a_001", person_id: "I1",
                          confidence: "probable", rationale: "retired",
                          superseded_by: "pe_002" }],
      rejected_links: [{ id: "rj_001", assertion_id: "a_001", person_id: "I1",
                         reason: "different birth year", created: "2026-09-30" }],
    });
    const out = await researchAppend({
      projectPath: dir, section: "person_evidence", op: "update",
      entryId: "pe_001", fields: { superseded_by: null },
    } as never, undefined as never).catch((e: Error) => e);
    const text = out instanceof Error ? out.message : JSON.stringify(out);
    expect(text).toMatch(/rejected as not a match/);
  });

  it("lets a live link be restated as live while it is downgraded", async () => {
    // `superseded_by: null` on a link that was never retired re-raises nothing.
    expect(await update({ superseded_by: null, confidence: "speculative" }))
      .not.toMatch(/rejected as not a match/);
  });

  it("does not tell the caller to remove the rejection", async () => {
    // No research_append operation can remove or retire a rejected_links entry.
    const dir = project({
      rejected_links: [{ id: "rj_001", assertion_id: "a_001", person_id: "I1",
                         created: "2026-09-30" }]
    });
    const out = await researchAppend({
      projectPath: dir, section: "person_evidence", op: "append",
      entry: { assertion_id: "a_001", person_id: "I1", confidence: "probable", rationale: "x" }
    } as never, undefined as never).catch((e: Error) => e);
    const text = out instanceof Error ? out.message : JSON.stringify(out);
    expect(text).toMatch(/rejected as not a match/);
    expect(text).not.toMatch(/remove the rejection/);
  });

  // ── An update that moves a live link onto the rejected pair ──────────────
  // Gating on whether the op named `superseded_by` let these through: a pair move
  // names neither, and `""` is falsy to the materializer but not `== null`.

  const movable = (link: Record<string, unknown>) => project({
    assertions: [{ id: "a_001" }, { id: "a_002" }],
    person_evidence: [{ id: "pe_001", confidence: "probable", rationale: "x", ...link }],
    rejected_links: [{ id: "rj_001", assertion_id: "a_001", person_id: "I1",
                       created: "2026-09-30" }],
  });
  const tryUpdate = async (dir: string, fields: Record<string, unknown>) => {
    const out = await researchAppend({
      projectPath: dir, section: "person_evidence", op: "update", entryId: "pe_001", fields,
    } as never, undefined as never).catch((e: Error) => e);
    return out instanceof Error ? out.message : JSON.stringify(out);
  };

  it("refuses moving a live link's person onto the rejected pair", async () => {
    const dir = movable({ assertion_id: "a_001", person_id: "I2" });
    expect(await tryUpdate(dir, { person_id: "I1" })).toMatch(/rejected as not a match/);
  });

  it("refuses moving a live link's assertion onto the rejected pair", async () => {
    const dir = movable({ assertion_id: "a_002", person_id: "I1" });
    expect(await tryUpdate(dir, { assertion_id: "a_001" })).toMatch(/rejected as not a match/);
  });

  it("refuses reviving a retired link with an empty superseded_by", async () => {
    const dir = movable({ assertion_id: "a_001", person_id: "I1", superseded_by: "pe_002" });
    expect(await tryUpdate(dir, { superseded_by: "" })).toMatch(/rejected as not a match/);
  });

  it("allows moving a retired link onto the rejected pair while it stays retired", async () => {
    const dir = movable({ assertion_id: "a_001", person_id: "I2", superseded_by: "pe_002" });
    const text = await tryUpdate(dir, { person_id: "I1" });
    expect(text).not.toMatch(/rejected as not a match/);
    expect(text).toMatch(/"ok":true/);
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

describe("a rejection must name an assertion that exists", () => {
  const reject = async (assertion_id: string) => {
    const out = await researchAppend({
      projectPath: project({}), section: "rejected_links", op: "append",
      entry: { assertion_id, person_id: "I1", reason: "different birth year",
               researcher_words: "That's not her, she was born in 1850" },
    } as never, undefined as never).catch((e: Error) => e);
    return out instanceof Error ? out.message : JSON.stringify(out);
  };

  it("refuses a mistyped assertion id, which would protect nothing", async () => {
    expect(await reject("a_999")).toMatch(/assertion 'a_999' which does not exist/);
  });

  it("accepts one that exists", async () => {
    expect(await reject("a_001")).toMatch(/"ok":true/);
  });
});

// --- #3601: only the researcher rejects, and a rejection undoes its link -----------

const appendRejection = async (dir: string, entry: Record<string, unknown>) => {
  const out = await researchAppend({
    projectPath: dir, section: "rejected_links", op: "append", entry,
  } as never, undefined as never).catch((e: Error) => e);
  return out instanceof Error ? out.message : JSON.stringify(out);
};

describe("a rejection carries the researcher's own words", () => {
  for (const [label, words] of [
    ["absent", undefined],
    ["blank", "   "],
    ["not a string", 42],
  ] as const) {
    it(`refuses an append whose researcher_words is ${label}`, async () => {
      const entry: Record<string, unknown> = { assertion_id: "a_001", person_id: "I1", reason: "agent's analysis" };
      if (words !== undefined) entry.researcher_words = words;
      const text = await appendRejection(project({}), entry);
      expect(text).toMatch(/needs `researcher_words`/);
      expect(text).not.toMatch(/"ok":true/);
    });
  }

  it("stores the words verbatim", async () => {
    const dir = project({});
    const text = await appendRejection(dir, {
      assertion_id: "a_001", person_id: "I1", researcher_words: "No, that's not him, wrong wife",
    });
    expect(text).toMatch(/"ok":true/);
    const research = JSON.parse(readFileSync(join(dir, "research.json"), "utf8"));
    expect(research.rejected_links[0].researcher_words).toBe("No, that's not him, wrong wife");
  });
});

describe("a rejection is immutable except for its reason", () => {
  const withRejection = () => project({
    assertions: [{ id: "a_001" }, { id: "a_002" }],
    rejected_links: [{ id: "rj_001", assertion_id: "a_001", person_id: "I1",
                       researcher_words: "not him", created: "2026-09-30" }],
  });
  const update = async (fields: Record<string, unknown>) => {
    const out = await researchAppend({
      projectPath: withRejection(), section: "rejected_links", op: "update", entryId: "rj_001", fields,
    } as never, undefined as never).catch((e: Error) => e);
    return out instanceof Error ? out.message : JSON.stringify(out);
  };

  for (const fields of [
    { person_id: "I2" },
    { assertion_id: "a_002" },
    { researcher_words: "something else" },
    { reason: "fine", person_id: "I2" },
  ]) {
    it(`refuses an update setting ${Object.keys(fields).join(" + ")}`, async () => {
      expect(await update(fields)).toMatch(/not updatable on 'rejected_links'/);
    });
  }

  it("allows an update to the reason", async () => {
    expect(await update({ reason: "the 1880 census puts him in Luzerne" })).toMatch(/"ok":true/);
  });
});

describe("a rejection on a linked pair undoes the link and its facts", () => {
  // I1 holds three facts from a_001's record (S1): one minted from the link
  // alone, one a second record (S2) corroborated, and one with no backlink. I2
  // holds a fact from the same assertion, which the rejection of I1 says nothing about.
  const linkedProject = (over: Record<string, unknown> = {}) => {
    const dir = mkdtempSync(join(tmpdir(), "rej-undo-"));
    mkdirSync(join(dir, "results"), { recursive: true });
    writeFileSync(join(dir, "research.json"), JSON.stringify({
      project: { id: "rp_t", status: "active" },
      questions: [], plans: [], log: [],
      sources: [{ id: "src_001", gedcomx_source_description_id: "S1" }],
      assertions: [{ id: "a_001", source_id: "src_001" }],
      person_evidence: [
        { id: "pe_001", assertion_id: "a_001", person_id: "I1", confidence: "probable",
          rationale: "x", created: "2026-09-01" },
        { id: "pe_002", assertion_id: "a_001", person_id: "I2", confidence: "probable",
          rationale: "x", created: "2026-09-01" },
      ],
      conflicts: [], hypotheses: [], timelines: [], proof_summaries: [],
      evaluations: [], localities: [],
      ...over,
    }), "utf8");
    writeFileSync(join(dir, "tree.gedcomx.json"), JSON.stringify({
      persons: [
        { id: "I1", facts: [
          { id: "F1", type: "Birth", date: "1845", assertion_id: "a_001", sources: [{ ref: "S1" }] },
          { id: "F2", type: "Residence", place: "Luzerne", assertion_id: "a_001",
            sources: [{ ref: "S1" }, { ref: "S2" }] },
          { id: "F3", type: "Death", date: "1901", sources: [{ ref: "S1" }] },
        ] },
        { id: "I2", facts: [
          { id: "F4", type: "Birth", date: "1845", assertion_id: "a_001", sources: [{ ref: "S1" }] },
        ] },
      ],
      relationships: [],
      sources: [{ id: "S1" }, { id: "S2" }],
    }), "utf8");
    return dir;
  };
  const read = (dir: string) => ({
    research: JSON.parse(readFileSync(join(dir, "research.json"), "utf8")),
    tree: JSON.parse(readFileSync(join(dir, "tree.gedcomx.json"), "utf8")),
  });
  const rejectI1 = (dir: string) =>
    appendRejection(dir, { assertion_id: "a_001", person_id: "I1", researcher_words: "No, that's not him" });

  it("supersedes the live link with the rejection's id", async () => {
    const dir = linkedProject();
    expect(await rejectI1(dir)).toMatch(/"ok":true/);
    const { research } = read(dir);
    expect(research.person_evidence.find((pe: any) => pe.id === "pe_001").superseded_by).toBe("rj_001");
    // The same assertion's link to a different person is untouched.
    expect(research.person_evidence.find((pe: any) => pe.id === "pe_002").superseded_by).toBeUndefined();
  });

  it("removes the fact the link minted, and only that one", async () => {
    const dir = linkedProject();
    const text = await rejectI1(dir);
    const { tree } = read(dir);
    const ids = (pid: string) => tree.persons.find((p: any) => p.id === pid).facts.map((f: any) => f.id);
    expect(ids("I1")).not.toContain("F1");
    expect(ids("I1")).toContain("F3");
    expect(ids("I2")).toContain("F4");
    expect(text).toMatch(/removed F1 from I1/);
    expect(text).toMatch(/may still carry names or relationships/);
  });

  it("keeps a fact a second record also cites, and names it", async () => {
    const dir = linkedProject();
    const text = await rejectI1(dir);
    const { tree } = read(dir);
    expect(tree.persons[0].facts.map((f: any) => f.id)).toContain("F2");
    expect(text).toMatch(/F2 on I1 came from a_001 but also cites another record/);
  });

  it("refuses a later re-link of the retired pair", async () => {
    const dir = linkedProject();
    await rejectI1(dir);
    const out = await researchAppend({
      projectPath: dir, section: "person_evidence", op: "append",
      entry: { assertion_id: "a_001", person_id: "I1", confidence: "probable", rationale: "x" },
    } as never, undefined as never).catch((e: Error) => e);
    expect(out instanceof Error ? out.message : JSON.stringify(out)).toMatch(/rejected as not a match/);
  });

  it("writes nothing when the rejection is refused", async () => {
    const dir = linkedProject();
    const before = read(dir);
    const text = await appendRejection(dir, { assertion_id: "a_001", person_id: "I1" });
    expect(text).toMatch(/needs `researcher_words`/);
    expect(read(dir)).toEqual(before);
  });

  it("touches neither file's links or facts when the pair has no live link", async () => {
    const dir = linkedProject({
      person_evidence: [{ id: "pe_001", assertion_id: "a_001", person_id: "I1", confidence: "probable",
                          rationale: "x", created: "2026-09-01", superseded_by: "pe_009" }],
    });
    expect(await rejectI1(dir)).toMatch(/"ok":true/);
    const { research, tree } = read(dir);
    expect(research.person_evidence[0].superseded_by).toBe("pe_009");
    expect(tree.persons[0].facts.map((f: any) => f.id)).toEqual(["F1", "F2", "F3"]);
  });
});

// --- A merge must not void the rejection (should-fix 9 of the #3262 self-review) ----

import { iteratePersonIdRefs, PERSON_ID_REF_FIELDS } from "../../src/validation/person-id-refs.js";

describe("rejected_links survives a merge", () => {
  it("is a declared person-id reference field", () => {
    // The walker is the single source of truth for both the validator's dangling-ref
    // check and the merge remap, so a field missing here is missing from BOTH.
    expect(PERSON_ID_REF_FIELDS).toContain("rejected_links");
  });

  it("repoints the rejected person to the survivor", () => {
    // Without this the merge rewrites every other reference, the rejection keeps
    // pointing at a person no longer on the tree, `isRejectedPair` stops matching,
    // and the pair the researcher rejected becomes linkable again — silently.
    const research = {
      rejected_links: [
        { id: "rj_001", assertion_id: "a_001", person_id: "I2", created: "2026-09-30" },
      ],
    };
    for (const ref of iteratePersonIdRefs(research)) {
      if (ref.pid === "I2") ref.set("I1");
    }
    expect(research.rejected_links[0].person_id).toBe("I1");
  });

  it("and the rejection still matches the pair afterwards", () => {
    // The point of the remap, stated as the behaviour rather than the field write.
    const rejected = [{ id: "rj_001", assertion_id: "a_001", person_id: "I1", created: "2026-09-30" }];
    expect(isRejectedPair("a_001", "I1", rejected)).toBe(true);
  });
});


// --- #3601: the document validator's half ------------------------------------------

import { validateParsed } from "../../src/validation/validator.js";

describe("validator: researcher_words and a link a rejection retired", () => {
  const doc = (over: Record<string, unknown>) => ({
    project: { id: "rp_t", status: "active" },
    assertions: [{ id: "a_001" }],
    person_evidence: [],
    ...over,
  });
  const messages = async (research: Record<string, unknown>) =>
    (await validateParsed(research, { persons: [{ id: "I1" }] })).errors.map((e: any) => e.message);
  const rj = (over = {}) => ({ id: "rj_001", assertion_id: "a_001", person_id: "I1", created: "2026-09-30", ...over });
  const pe = (superseded_by: unknown) => ({
    id: "pe_001", assertion_id: "a_001", person_id: "I1", confidence: "probable",
    rationale: "x", created: "2026-09-01", superseded_by,
  });

  it("accepts a row written before researcher_words existed", async () => {
    expect((await messages(doc({ rejected_links: [rj()] }))).join("\n")).not.toMatch(/researcher_words/);
  });

  for (const bad of ["", "  ", 7, null]) {
    it(`refuses researcher_words ${JSON.stringify(bad)}`, async () => {
      expect((await messages(doc({ rejected_links: [rj({ researcher_words: bad })] }))).join("\n"))
        .toMatch(/researcher_words must be a non-empty string/);
    });
  }

  it("accepts a link superseded by a rejection that exists", async () => {
    const out = await messages(doc({ rejected_links: [rj()], person_evidence: [pe("rj_001")] }));
    expect(out.join("\n")).not.toMatch(/rejected link/);
  });

  it("refuses a link superseded by a rejection that does not exist", async () => {
    const out = await messages(doc({ rejected_links: [rj()], person_evidence: [pe("rj_009")] }));
    expect(out.join("\n")).toMatch(/references rejected link 'rj_009' which does not exist/);
  });

  it("refuses it when the document holds no rejections at all", async () => {
    const out = await messages(doc({ person_evidence: [pe("rj_001")] }));
    expect(out.join("\n")).toMatch(/references rejected link 'rj_001' which does not exist/);
  });

  it("leaves a pe_ supersede pointer as it was", async () => {
    const out = await messages(doc({ person_evidence: [pe("pe_002")] }));
    expect(out.join("\n")).not.toMatch(/rejected link/);
  });
});

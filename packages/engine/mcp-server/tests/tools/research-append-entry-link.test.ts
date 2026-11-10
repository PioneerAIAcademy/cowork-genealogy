// #4226 — a link means the record ENTRY, not the one fact.
//
// Lead ruling 2026-11-04: once the person in role X of record Y is linked to
// tree person Z, every one-party fact of that entry belongs to Z, and
// `research_append` writes the rest of the rows.
//
// ADR-0011:470 asks a gate for a LABELLED CASE SET — must-fire in at least two
// distinct shapes, plus must-not-fire. Both directions are marked below, and
// the must-not-fire cases are the ones that matter here: a refusal reading ANY
// live link (rather than only one-party links) would refuse 1,138 further
// (entry, person) pairs across the committed corpus. `dev/replay-entry-link.ts`
// is the measurement.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, readFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { researchAppend } from "../../src/tools/research-append.js";
import { recordMatchScore } from "../../src/utils/match-scores.js";
import { ATTACHMENT_LINK_RATIONALE } from "../../src/utils/tree-person.js";

const source = {
  id: "src_001",
  gedcomx_source_description_id: "SD-001",
  citation: "1850 U.S. Census, Schuylkill County, PA",
  citation_detail: "p. 4, dwelling 12, line 7",
  source_classification: "original",
  repository: "NARA",
  access_date: "2026-01-01",
};

/** One fact of one party of one record. Defaults put every assertion on the
 *  same entry (`rec1` / `principal`), which is what makes the expansion fire. */
const assertion = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  source_id: "src_001",
  record_id: "rec1",
  record_role: "principal",
  record_persona_id: null,
  fact_type: "birth",
  value: "1850",
  information_quality: "primary",
  informant: "self",
  informant_proximity: "self",
  record_basis: "stated",
  extracted_for_question_ids: [],
  ...over,
});

const linkRow = (id: string, assertion_id: string, person_id: string, over: Record<string, unknown> = {}) => ({
  id,
  assertion_id,
  person_id,
  confidence: "confident",
  match_score: 0.9,
  rationale: "match",
  created: "2026-01-02",
  superseded_by: null,
  ...over,
});

const project = (over: Record<string, unknown> = {}) => ({
  project: { id: "rp_001", objective: "Test", status: "active", created: "2026-01-01", updated: "2026-01-01" },
  questions: [], plans: [], log: [], conflicts: [], hypotheses: [], timelines: [],
  proof_summaries: [], evaluations: [],
  sources: [source],
  assertions: [assertion("a_001")],
  person_evidence: [],
  ...over,
});

const tree = {
  persons: [
    { id: "I1", gender: "Male", names: [{ id: "N1", given: "John", surname: "Smith" }] },
    { id: "I2", gender: "Male", names: [{ id: "N2", given: "Thomas", surname: "Smith" }] },
  ],
  relationships: [],
  sources: [{ id: "SD-001", title: "1850 U.S. Census" }],
};

describe("#4226 a link means the record entry", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "entry-link-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const write = async (research: any) => {
    await writeFile(join(dir, "research.json"), JSON.stringify(research, null, 2), "utf-8");
    await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify(tree, null, 2), "utf-8");
  };
  const read = async () => JSON.parse(await readFile(join(dir, "research.json"), "utf-8"));

  /** The score gate refuses an unscored link to a reachable persona, and these
   *  fixtures carry no log, so every link in them is reachable. Attest the
   *  TRIGGER only: whether a DERIVED row needs its own score is the thing
   *  several cases below are about. */
  const attest = async (assertionId: string, personId = "I1") => {
    await recordMatchScore(dir, {
      record_id: "rec1", record_persona_id: null, record_role: "principal",
      tree_person_id: personId, score: 0.9, scorer: "familysearch", model: null,
      assertion_id: assertionId, record_source: "record_read", computed: "2026-09-24T00:00:00Z",
    });
  };

  const link = (assertion_id: string, person_id = "I1", over: Record<string, unknown> = {}) =>
    researchAppend({
      projectPath: dir,
      section: "person_evidence",
      op: "append",
      entry: { assertion_id, person_id, confidence: "confident", rationale: "match", superseded_by: null, ...over },
    });

  const links = async () => (await read()).person_evidence as any[];

  // ── The rule fires ────────────────────────────────────────────────────────

  it("expands a one-party link to the entry's other one-party facts", async () => {
    await write(project({
      assertions: [assertion("a_001"), assertion("a_002", { fact_type: "residence", value: "Schuylkill" })],
    }));
    await attest("a_001");
    const r = await link("a_001");
    expect(r.ok).toBe(true);
    const rows = await links();
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ assertion_id: "a_002", person_id: "I1", confidence: "confident", match_score: null });
    expect(rows[1].rationale).toMatch(/^Derived from the link on a_001: the same record entry \(rec1\/principal\)/);
  });

  it("derived rows carry no score and are not refused for the want of one", async () => {
    // Only a_001 is attested. a_002's pairing has no score and cannot get one:
    // the attestation is keyed on the ASSERTION. If the derived row were held
    // to the gate, this call would fail.
    await write(project({ assertions: [assertion("a_001"), assertion("a_002", { fact_type: "residence", value: "X" })] }));
    await attest("a_001");
    expect((await link("a_001")).ok).toBe(true);
    expect(await links()).toHaveLength(2);
  });

  it("inherits move_bridge, so a bridged trigger expands instead of dropping every row", async () => {
    // `unexplainedMoveInvariants` reads the move off the RECORD and the PARTY,
    // the same ones a derived row sits on, and returns early only on a
    // non-empty bridge. Without inheritance every derived row of a bridged
    // entry is refused and the entry silently does not expand -- the bug this
    // card exists to fix, surviving on a named class.
    await write(project({ assertions: [assertion("a_001"), assertion("a_002", { fact_type: "residence", value: "X" })] }));
    await attest("a_001");
    const r = await link("a_001", "I1", { move_bridge: "the family moved with the mill" });
    expect(r.ok).toBe(true);
    const rows = await links();
    expect(rows).toHaveLength(2);
    expect(rows[1].move_bridge).toBe("the family moved with the mill");
  });

  it("keys the entry on record_role when the record named no persona", async () => {
    // Every assertion here carries `record_persona_id: null`, as every
    // assertion in mid-research-flynn does. A persona-id-only key expands
    // nothing at all.
    await write(project({
      assertions: [
        assertion("a_001"),
        assertion("a_002", { fact_type: "residence", value: "X" }),
        assertion("a_003", { record_role: "head_of_household", fact_type: "name", value: "Thomas" }),
      ],
    }));
    await attest("a_001");
    expect((await link("a_001")).ok).toBe(true);
    const rows = await links();
    // a_002 shares the role, a_003 does not.
    expect(rows.map((r) => r.assertion_id)).toEqual(["a_001", "a_002"]);
  });

  // ── MUST-FIRE 1: the entry is already another person's ─────────────────────

  it("MUST FIRE: refuses a one-party link whose entry a one-party link already gives someone else", async () => {
    await write(project({
      assertions: [assertion("a_001"), assertion("a_002", { fact_type: "residence", value: "X" })],
      person_evidence: [linkRow("pe_001", "a_002", "I2")],
    }));
    await attest("a_001");
    const r = await link("a_001");
    expect(r.ok).toBe(false);
    const errs = "errors" in r ? r.errors.join("\n") : "";
    expect(errs).toContain("already this project's entry for I2");
    expect(errs).toContain("a_002");
    // Actionable, per ADR-0011: it names what to do, not just what is wrong.
    expect(errs).toMatch(/supersede the existing link|rejected_links/);
    expect(await links()).toHaveLength(1); // nothing written
  });

  // ── MUST-FIRE 2: a gate refuses a derived row ──────────────────────────────

  it("MUST FIRE: a derived row the rejected-links gate refuses is skipped and reported, not raised", async () => {
    await write(project({
      assertions: [assertion("a_001"), assertion("a_002", { fact_type: "residence", value: "X" })],
      rejected_links: [{
        id: "rj_001", assertion_id: "a_002", person_id: "I1",
        rejected_reason: "a different Smith", rejected_by: "researcher", created: "2026-01-02",
      }],
    }));
    await attest("a_001");
    const r = await link("a_001");
    // The caller's own link still lands: they did not write the refused row.
    expect(r.ok).toBe(true);
    const rows = await links();
    expect(rows).toHaveLength(1);
    expect(rows[0].assertion_id).toBe("a_001");
    expect("skippedDerivedLinks" in r ? r.skippedDerivedLinks : undefined).toBeDefined();
  });

  // ── MUST NOT FIRE ──────────────────────────────────────────────────────────

  it("MUST NOT FIRE: a two-party fact never triggers expansion", async () => {
    await write(project({
      assertions: [
        assertion("a_001", { fact_type: "relationship", value: "child of Thomas" }),
        assertion("a_002", { fact_type: "residence", value: "X" }),
      ],
    }));
    await attest("a_001");
    expect((await link("a_001")).ok).toBe(true);
    expect(await links()).toHaveLength(1);
  });

  it("MUST NOT FIRE: a two-party fact is never produced BY an expansion", async () => {
    await write(project({
      assertions: [assertion("a_001"), assertion("a_002", { fact_type: "relationship", value: "child of Thomas" })],
    }));
    await attest("a_001");
    expect((await link("a_001")).ok).toBe(true);
    expect(await links()).toHaveLength(1);
  });

  it("MUST NOT FIRE: a two-party holder does not make the entry someone else's", async () => {
    // THE case the corpus measurement is about. I2 holds the entry only through
    // a relationship assertion, which says nothing about WHICH party it is. A
    // refusal counting any live link refuses 1,138 further pairs across the
    // committed corpus, and would refuse pe_001 in mid-research-flynn itself.
    await write(project({
      assertions: [
        assertion("a_001"),
        assertion("a_002", { fact_type: "relationship", value: "child of Thomas" }),
      ],
      person_evidence: [linkRow("pe_001", "a_002", "I2")],
    }));
    await attest("a_001");
    const r = await link("a_001");
    expect(r.ok).toBe(true);
  });

  it("MUST NOT FIRE: negative evidence is not part of the entry", async () => {
    // `recordPartyKeyer` returns the PERSONA ID for an absent-role assertion
    // that carries one, so negative evidence filed against a persona lands
    // inside its party unless dropped at the key. anders-monsen's a_029 is
    // "Unna absent from 1801 Hamre" filed on ANDERS' persona and linked to
    // Unna; left in, it both derives a wrong row and makes Unna a holder of
    // Anders' entry.
    //
    // EVERY assertion carries the SAME record_persona_id, which is what makes
    // this test able to fail. With `record_persona_id: null` the keyer falls
    // through to the role -- and the role of negative evidence is literally
    // "absent", so it lands in its own entry and is never derived whatever the
    // filter does. A first draft did that: removing the filter outright left
    // all 12 tests green. The corpus shape is this one (anders-monsen a_029:
    // role "absent", persona id the HEAD's), where the keyer's first branch
    // returns the persona id and puts it in the principal's entry.
    //
    // Two rows, because the filter has two disjuncts and `recordBasisOf` never
    // reads `record_role`: a_002 carries the basis, a_003 carries ONLY the role
    // and no basis at all, which `recordBasisOf` answers `undefined` for. Drop
    // the `record_role` half and a_003 is derived.
    // (The corpus's own negative evidence also carries a retired third
    // spelling. It is not planted here: `retired-field-names.test.ts` bans the
    // token repo-wide, and `recordBasisOf` maps it, under its own tests.)
    await write(project({
      assertions: [
        assertion("a_001", { record_persona_id: "p_1" }),
        assertion("a_002", { record_persona_id: "p_1", record_role: "absent", record_basis: "absent", fact_type: "residence", value: "not listed" }),
        assertion("a_003", { record_persona_id: "p_1", record_role: "absent", record_basis: undefined, fact_type: "residence", value: "not listed" }),
      ],
    }));
    await attest("a_001");
    expect((await link("a_001")).ok).toBe(true);
    expect(await links()).toHaveLength(1);
  });

  it("MUST NOT FIRE: an attachment-shaped link does not expand", async () => {
    // The baseline step assumes every FamilySearch attachment is correct and
    // runs no same_person; expanding there multiplies an assumption.
    await write(project({
      assertions: [assertion("a_001"), assertion("a_002", { fact_type: "residence", value: "X" })],
    }));
    // Attested because the score-gate exemption for this shape belongs to
    // `extraction_append`'s internal flag, which a public call does not carry.
    // Without it the call is refused for want of a score and the test would
    // pass for the wrong reason.
    await attest("a_001");
    const r = await link("a_001", "I1", {
      confidence: "speculative", match_score: null, rationale: ATTACHMENT_LINK_RATIONALE,
    });
    expect(r.ok).toBe(true);
    expect(await links()).toHaveLength(1);
  });

  it("MUST NOT FIRE: a derived row does not itself trigger a second expansion", async () => {
    await write(project({
      assertions: [
        assertion("a_001"),
        assertion("a_002", { fact_type: "residence", value: "X" }),
        assertion("a_003", { fact_type: "occupation", value: "miner" }),
      ],
    }));
    await attest("a_001");
    expect((await link("a_001")).ok).toBe(true);
    const rows = await links();
    expect(rows).toHaveLength(3);
    // Exactly two derived, both from a_001 -- not a chain.
    const derived = rows.filter((r) => String(r.rationale).startsWith("Derived from"));
    expect(derived).toHaveLength(2);
    for (const d of derived) expect(d.rationale).toContain("the link on a_001");
  });

  // ── Only the tool may write the derived rationale (review of PR #4355) ─────
  //
  // `circularCorroborationCallCheck` and `namesakeCallCheck` skip a row whose
  // rationale starts with the prefix, and they read the finished document --
  // which cannot say who wrote the row. So the prefix has to be refused at the
  // boundary, or a caller writes its way past both gates.

  it("MUST FIRE: refuses a caller-written rationale carrying the derived prefix (append)", async () => {
    await write(project({ assertions: [assertion("a_001")] }));
    await attest("a_001");
    const r = await link("a_001", "I1", {
      rationale: "Derived from the link on a_999: the same record entry (rec1/principal), which that link identified as this person.",
    });
    expect(r.ok).toBe(false);
    const errs = "errors" in r ? r.errors.join("\n") : "";
    expect(errs).toContain("written only by research_append");
    expect(errs).toContain("ops[0]");
    expect(await links()).toHaveLength(0); // nothing written
  });

  it("MUST FIRE: refuses the derived prefix on an update's fields too", async () => {
    await write(project({
      assertions: [assertion("a_001")],
      person_evidence: [linkRow("pe_001", "a_001", "I1")],
    }));
    const r = await researchAppend({
      projectPath: dir,
      section: "person_evidence",
      op: "update",
      entryId: "pe_001",
      fields: { rationale: "Derived from the link on a_001: the same record entry (rec1/principal)." },
    });
    expect(r.ok).toBe(false);
    expect("errors" in r ? r.errors.join("\n") : "").toContain("written only by research_append");
    // The stored row is untouched.
    expect((await links())[0].rationale).toBe("match");
  });

  it("MUST NOT FIRE: a rationale that mentions the prefix without starting with it is fine", async () => {
    // The exact prefix, mid-string. It is the boundary between `startsWith`
    // and `includes`: widening the predicate would refuse this legitimate link
    // AND would skip real rows past the namesake and circular gates.
    await write(project({ assertions: [assertion("a_001")] }));
    await attest("a_001");
    const r = await link("a_001", "I1", {
      rationale: "Independent of the row Derived from the link on a_999: this rests on the page image itself.",
    });
    expect(r.ok).toBe(true);
    expect(await links()).toHaveLength(1);
  });

  // ── Correcting a wrong link takes ONE call (review of PR #4355) ────────────
  //
  // The refusal tells the caller to supersede the link or reject the pairing.
  // The holder list is built from the PRE-CALL document, so doing either in the
  // same call used to be refused anyway and the advice only worked across two.

  it("MUST NOT FIRE: a rejected_links entry in the SAME call clears the holder", async () => {
    await write(project({
      assertions: [assertion("a_001"), assertion("a_002", { fact_type: "residence", value: "X" })],
      person_evidence: [linkRow("pe_001", "a_002", "I2")],
    }));
    await attest("a_001");
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        {
          section: "rejected_links",
          op: "append",
          entry: {
            assertion_id: "a_002", person_id: "I2",
            reason: "The residence belongs to a different Flynn household in the same county.",
            researcher_words: "No, that's not him, wrong household",
          },
        },
        {
          section: "person_evidence",
          op: "append",
          entry: { assertion_id: "a_001", person_id: "I1", confidence: "confident", rationale: "match", superseded_by: null },
        },
      ],
    });
    expect(r.ok).toBe(true);
    const rows = await links();
    // The old link is retired by the rejection, and the new one expanded.
    expect(rows.find((x) => x.id === "pe_001").superseded_by).toMatch(/^rj_/);
    expect(rows.some((x) => x.assertion_id === "a_001" && x.person_id === "I1")).toBe(true);
  });

  it("MUST NOT FIRE: superseding the holder in the SAME call clears it", async () => {
    await write(project({
      assertions: [assertion("a_001"), assertion("a_002", { fact_type: "residence", value: "X" })],
      person_evidence: [linkRow("pe_001", "a_002", "I2")],
    }));
    await attest("a_001");
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        { section: "person_evidence", op: "update", entryId: "pe_001", fields: { superseded_by: "RETRACTED" } },
        {
          section: "person_evidence",
          op: "append",
          entry: { assertion_id: "a_001", person_id: "I1", confidence: "confident", rationale: "match", superseded_by: null },
        },
      ],
    });
    expect(r.ok).toBe(true);
    expect((await links()).some((x) => x.assertion_id === "a_001" && x.person_id === "I1")).toBe(true);
  });
});

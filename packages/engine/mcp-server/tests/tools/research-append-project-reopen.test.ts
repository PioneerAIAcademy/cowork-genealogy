// Issue #4698. A project stayed `completed` after a new open question was
// added, so a researcher's second question was researched inside a completed
// project. `research_append` now reopens it.
//
// A new file rather than `research-append.test.ts`: the issue asks for one, and
// that file is the busiest in the suite.
//
// Every case asserts `ok: true` with no refusal before asserting the outcome.
// Without that a case can go green on a REFUSED call — which is how the
// original "a resolved-question append does not reopen" case was wrong: an
// append always sets `resolutionTouchedThisOp`, so it was refused for having no
// proof summary, and would have stayed green under a rule that reopened
// unconditionally.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, copyFile, readFile, writeFile, rm } from "fs/promises";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { researchAppend } from "../../src/tools/research-append.js";

const SCENARIO = resolve(__dirname, "../../../../../eval/fixtures/scenarios/mid-research-flynn");

/** The scenario's shape this file depends on, asserted in a test below so a
 *  fixture edit fails loudly instead of quietly voiding a case:
 *  q_001 in_progress with ps_001 referencing it; q_002 resolved; pl_001
 *  (q_002's plan) fully completed, so the exhaustiveness case does not trip
 *  `planCompleteInvariants`. */
const REOPENED = /project reopened: status completed → active/;

describe("research_append — reopening a completed project (#4698)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "research-append-reopen-"));
    for (const f of ["research.json", "tree.gedcomx.json"]) await copyFile(join(SCENARIO, f), join(dir, f));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const read = async () => JSON.parse(await readFile(join(dir, "research.json"), "utf-8"));
  const write = async (d: unknown) => writeFile(join(dir, "research.json"), JSON.stringify(d, null, 2), "utf-8");

  /** Put the project at `status` before the call.
   *
   *  For the APPEND cases this also resolves every question and completes every
   *  plan item, because `research_append` refuses a new question while another
   *  is still open ("a new question cannot be opened while another is still
   *  open"). That is not a workaround: a genuinely completed project HAS no
   *  open question — it is exactly the state the reported incident started
   *  from, with q_001 concluded and the project marked completed before the
   *  researcher's second question was written. */
  const projectAt = async (status: string, settleQuestions = false) => {
    const d = await read();
    d.project.status = status;
    if (settleQuestions) {
      for (const q of d.questions) {
        q.status = "resolved";
        q.resolved = q.resolved ?? "2026-05-04";
      }
      for (const pl of d.plans) for (const i of pl.items) i.status = "completed";
    }
    await write(d);
  };

  const newQuestion = (status = "open") => ({
    section: "questions",
    op: "append",
    entry: {
      question: "Was Patrick enumerated in the 1925 state census?",
      rationale: "The researcher named it as the second question.",
      selection_basis: "objective_decomposition",
      priority: "high",
      status,
      depends_on: [],
      unblocks: [],
      resolved: null,
      resolution_assertion_ids: [],
      search_stop: { stopped_because: null, justification: null, log_entry_ids: [], stop_criteria: null, not_reached: [] },
    },
  });

  /** Run a call and fail loudly on a refusal, so no case can pass on one. */
  const call = async (body: object) => {
    const r: any = await researchAppend({ projectPath: dir, ...body } as never);
    if (!r.ok) throw new Error(`call was REFUSED, so this case proves nothing: ${JSON.stringify(r.errors)}`);
    return r;
  };

  const warnings = (r: any): string => (r?.validation?.warnings ?? []).join(" | ");

  it("the fixture still has the shape these cases rely on", async () => {
    const d = await read();
    expect(d.questions.find((q: any) => q.id === "q_001").status).toBe("in_progress");
    expect(d.questions.find((q: any) => q.id === "q_002").status).toBe("resolved");
    expect(d.proof_summaries.some((s: any) => s.question_id === "q_001")).toBe(true);
    const pl001 = d.plans.find((p: any) => p.id === "pl_001");
    expect(pl001.question_id).toBe("q_002");
    expect(pl001.items.every((i: any) => i.status === "completed")).toBe(true);
  });

  // ── 1. the reported incident ────────────────────────────────────────────
  it("reopens when an open question is appended to a completed project", async () => {
    await projectAt("completed", true);
    const r = await call(newQuestion("open"));
    const d = await read();
    expect(d.project.status).toBe("active");
    expect(warnings(r)).toMatch(REOPENED);
    expect(warnings(r)).toMatch(/is open/);
    // `updated` is a date, not an ISO datetime — the project singleton stamps
    // `kind: "date"`, and this write happens outside `applyOne`.
    expect(d.project.updated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  // ── 2. the other direction ──────────────────────────────────────────────
  it("changes nothing and warns nothing on an active project", async () => {
    await projectAt("active", true);
    const r = await call(newQuestion("open"));
    expect((await read()).project.status).toBe("active");
    expect(warnings(r)).not.toMatch(REOPENED);
  });

  // ── 3. resolving a question must NOT reopen ─────────────────────────────
  it("does not reopen when the call resolves a question", async () => {
    // An UPDATE, not an append: an append always sets `resolutionTouchedThisOp`
    // and is refused for having no proof summary. q_001 has ps_001, so the
    // update clears that gate and the call actually runs.
    await projectAt("completed");
    const r = await call({ section: "questions", op: "update", entryId: "q_001", fields: { status: "resolved" } });
    expect((await read()).project.status).toBe("completed");
    expect(warnings(r)).not.toMatch(REOPENED);
  });

  // ── 4. the outcome, not the op ──────────────────────────────────────────
  it("reopens when an UPDATE moves a resolved question back to open", async () => {
    // The regression the file's own comment at the oneSummaryPerQuestion gate
    // warns about: gate on `op.op === "append"` and an update walks past.
    await projectAt("completed");
    const r = await call({ section: "questions", op: "update", entryId: "q_002", fields: { status: "open", resolved: null } });
    expect((await read()).project.status).toBe("active");
    expect(warnings(r)).toMatch(REOPENED);
  });

  // ── 5. only `completed` reopens ─────────────────────────────────────────
  it("leaves a paused project paused — the researcher chose that", async () => {
    await projectAt("paused", true);
    const r = await call(newQuestion("open"));
    expect((await read()).project.status).toBe("paused");
    expect(warnings(r)).not.toMatch(REOPENED);
  });

  // ── 6. every status but `resolved`, not just `open` ─────────────────────
  it("reopens on exhaustive_declared, which is not `open`", async () => {
    // `QUESTION_STILL_OPEN` is derived from the enum. Written as
    // `status === "open"` the rule passes cases 1-5 and misses this one — and
    // the issue's own measurement puts 7 of ~15 real instances here.
    //
    // Two refusal gates to clear: `declarationStatusInvariants` needs
    // `search_stop.stopped_because` at a gate value, so it is pre-seeded; and
    // setting `search_stop` in the op would make `declarationTouchedThisOp`
    // true and run `planCompleteInvariants`, so `status` is updated ALONE.
    // A single-field `status` update is never the `applyOne` no-op branch,
    // which needs the stop gate satisfied on both sides.
    const d = await read();
    const q2 = d.questions.find((q: any) => q.id === "q_002");
    q2.status = "in_progress";
    q2.resolved = null;
    // q_002 already carries a VALID gate-satisfied stop in the fixture. Seeding
    // a hand-built one with `log_entry_ids: []` and `stop_criteria: null` makes
    // the document schema-invalid: the validator requires both to be populated
    // once `stopped_because` is a gate value. The call still succeeds, because
    // `validateIntroduced` blocks only on errors this call introduced — so the
    // case would have run against a state research_append can never produce,
    // and quietly reported two pre-existing schema errors alongside the reopen.
    q2.search_stop = { ...q2.search_stop, stopped_because: "record_exhausted" };
    d.project.status = "completed";
    await write(d);

    const r = await call({ section: "questions", op: "update", entryId: "q_002", fields: { status: "exhaustive_declared" } });
    const after = await read();
    expect(after.questions.find((q: any) => q.id === "q_002").status).toBe("exhaustive_declared");
    expect(after.project.status).toBe("active");
    expect(warnings(r)).toMatch(REOPENED);
    // The warning names the real status, not "open" — it fires for three.
    expect(warnings(r)).toMatch(/is exhaustive_declared/);
  });

  // ── a write that writes nothing must not claim it reopened ──────────────
  it("stays silent on a no-op question write, which never reaches disk", async () => {
    // The trigger reads `applied` (non-noop), not `ops`. `anyMutation` is
    // computed ABOVE the rule and gates the only research.json write, while
    // the warning channel is spliced in unconditionally — so an `ops`-derived
    // trigger would answer `project reopened` on a call that changed no file.
    // The reachable shape: a single-field `search_stop` update on a question
    // whose stop gate is already satisfied, which `applyOne` no-ops.
    const d = await read();
    const q1 = d.questions.find((q: any) => q.id === "q_001");
    q1.status = "exhaustive_declared";
    // Borrowed from q_002, which carries a valid gate-satisfied stop — a
    // hand-built one with empty `log_entry_ids` is schema-invalid (see the
    // exhaustive_declared case above).
    q1.search_stop = { ...d.questions.find((q: any) => q.id === "q_002").search_stop };
    for (const pl of d.plans) for (const i of pl.items) i.status = "completed";
    d.project.status = "completed";
    await write(d);

    const r = await call({
      section: "questions",
      op: "update",
      entryId: "q_001",
      fields: { search_stop: { ...q1.search_stop, stopped_because: "question_answered" } },
    });
    expect(warnings(r)).toMatch(/no-op/);
    expect(warnings(r)).not.toMatch(REOPENED);
    expect((await read()).project.status).toBe("completed");
  });

  // ── a malformed status must fail SAFE, not be skipped ───────────────────
  it("reopens on a question whose status is off-enum, rather than skipping it", async () => {
    // Tested as `!== "resolved"` rather than `QUESTION_STILL_OPEN.has(...)`:
    // `has()` is false for undefined, null and any off-enum value, so the
    // malformed case — which is what a legacy or hand-edited document actually
    // produces — would leave the question sitting in a completed project. The
    // bad status is PRE-EXISTING here, so `validateIntroduced` lets the call
    // through; only errors a call introduces block it.
    const d = await read();
    const q2 = d.questions.find((q: any) => q.id === "q_002");
    q2.status = "nonsense_status";
    q2.resolved = null;
    d.project.status = "completed";
    await write(d);

    const r = await call({
      section: "questions",
      op: "update",
      entryId: "q_002",
      fields: { rationale: "Re-opened by the researcher after the 1925 census question." },
    });
    expect((await read()).project.status).toBe("active");
    expect(warnings(r)).toMatch(REOPENED);
  });

  // ── only a question THIS CALL wrote reopens ─────────────────────────────
  it("does not reopen on a non-questions write while a stale question sits open", async () => {
    // The rule's central scope decision, and the one every other case misses:
    // each of them writes the question it then checks, so a rule reading "any
    // non-noop write + any open question in the end state" passes 8 of the 9.
    // That rule would reopen a completed project on a bare log or assertions
    // write whenever some stale question happened to be open.
    const d = await read();
    d.questions.find((q: any) => q.id === "q_001").status = "open";
    d.project.status = "completed";
    await write(d);

    const r = await call({
      section: "hypotheses",
      op: "append",
      entry: {
        claim: "Patrick's father may be the Thomas Flynn of the 1850 household.",
        status: "active",
        supporting_assertion_ids: [],
        contradicting_assertion_ids: [],
        ruled_out: false,
        related_question_ids: ["q_001"],
      },
    });
    expect((await read()).project.status).toBe("completed");
    expect(warnings(r)).not.toMatch(REOPENED);
  });

  // ── the caller's own assertion wins, when it asserts something ──────────
  it("reopens even when the call re-asserts the status the project already had", async () => {
    // Suppression is keyed on a CHANGE, not on the field being present. Keyed
    // on presence, this batch reproduced the incident the rule exists to fix:
    // an open question written beside `{status: "completed"}` on a project
    // already completed, with no warning. Re-asserting `completed` asserts
    // nothing, so it does not buy the caller a suppression.
    await projectAt("completed", true);
    const r = await call({
      ops: [newQuestion("open"), { section: "project", op: "update", fields: { status: "completed" } }],
    });
    expect((await read()).project.status).toBe("active");
    expect(warnings(r)).toMatch(REOPENED);
  });

  it("leaves a real caller assertion alone — a status the project did NOT have", async () => {
    // The other direction, and the reason the rule reads the prior status
    // rather than ignoring caller writes altogether: `paused` is a change, so
    // the caller means it and the engine must not overwrite it with `active`.
    await projectAt("completed", true);
    const r = await call({
      ops: [newQuestion("open"), { section: "project", op: "update", fields: { status: "paused" } }],
    });
    expect((await read()).project.status).toBe("paused");
    expect(warnings(r)).not.toMatch(REOPENED);
  });
});

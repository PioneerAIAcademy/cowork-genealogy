/**
 * `research_append` fills a written `search_stop.log_entry_ids` with every log
 * entry the question owns, across every plan, then any other entry the caller
 * cited. A caller listing only the active plan's entries left the earlier
 * plans' searches out of the declaration (issue #2475).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { researchAppend } from "../../src/tools/research-append.js";
import { writeProjectFileSync } from "../helpers/project-files.js";

let dir: string;

const STOP = { stopped_because: null, log_entry_ids: [], stop_criteria: null, not_reached: [] };

function question(id: string) {
  return {
    id,
    question: `Question ${id}?`,
    status: "in_progress",
    priority: "high",
    created: "2026-01-01",
    rationale: "Under research.",
    selection_basis: "user_directed",
    depends_on: [],
    unblocks: [],
    resolved: null,
    resolution_assertion_ids: [],
    search_stop: { ...STOP },
  };
}

function item(id: string, sequence: number) {
  return {
    id,
    sequence,
    record_type: "census",
    jurisdiction: "Hordaland, Norway",
    date_range: "1865",
    repository: "FamilySearch",
    rationale: "Why this item was planned.",
    fallback_for: null,
    status: "completed",
  };
}

function entry(id: string, planItemId: string | null) {
  return {
    id,
    performed: "2026-01-02T00:00:00Z",
    tool: "record_search",
    plan_item_id: planItemId,
    query: { surname: "Monsen" },
    results_examined: 1,
    outcome: "negative",
  };
}

function seed() {
  const research = {
    project: { id: "rp_001", objective: "Test", status: "active", created: "2026-01-01", updated: "2026-01-01" },
    questions: [question("q_001"), question("q_002")],
    plans: [
      { id: "pl_001", question_id: "q_001", status: "superseded", created: "2026-01-01", items: [item("pli_001", 1)] },
      { id: "pl_002", question_id: "q_001", status: "active", created: "2026-01-02", items: [item("pli_002", 1)] },
      { id: "pl_003", question_id: "q_002", status: "active", created: "2026-01-02", items: [item("pli_003", 1)] },
    ],
    log: [
      entry("log_001", "pli_001"),
      entry("log_002", "pli_001"),
      entry("log_003", "pli_002"),
      entry("log_004", "pli_003"),
      entry("log_005", null),
    ],
    sources: [],
    assertions: [],
    person_evidence: [],
    conflicts: [],
    hypotheses: [],
    timelines: [],
    proof_summaries: [],
    evaluations: [],
  };
  writeProjectFileSync(join(dir, "research.json"), JSON.stringify(research, null, 2), "utf-8");
  writeFileSync(join(dir, "tree.gedcomx.json"), JSON.stringify({ persons: [], relationships: [], sources: [] }), "utf-8");
}

const decline = (log_entry_ids?: string[]) => ({
  stopped_because: "resources_spent",
  ...(log_entry_ids ? { log_entry_ids } : {}),
  stop_criteria: null,
  justification: "Overturn risk: low. Probate was not searched.",
  not_reached: [],
});

async function writeStop(search_stop: unknown) {
  return researchAppend({
    projectPath: dir,
    section: "questions",
    op: "update",
    entryId: "q_001",
    fields: { search_stop },
  } as any);
}

function stored(qid = "q_001") {
  const r = JSON.parse(readFileSync(join(dir, "research.json"), "utf-8"));
  return r.questions.find((q: any) => q.id === qid).search_stop;
}

describe("research_append: search_stop.log_entry_ids covers every plan", () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ra-stop-log-ids-"));
    seed();
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("adds the earlier plan's entries to a list naming only the active plan's", async () => {
    const r = await writeStop(decline(["log_003"]));
    expect(r.ok, JSON.stringify((r as any).errors)).toBe(true);
    expect(stored().log_entry_ids).toEqual(["log_001", "log_002", "log_003"]);
  });

  it("fills an empty or missing list, and never takes another question's entries", async () => {
    for (const ids of [[], undefined]) {
      const r = await writeStop(decline(ids));
      expect(r.ok, JSON.stringify((r as any).errors)).toBe(true);
      expect(stored().log_entry_ids).toEqual(["log_001", "log_002", "log_003"]);
    }
  });

  it("keeps an ad-hoc entry the caller cited, after the question's own", async () => {
    const r = await writeStop(decline(["log_005", "log_003"]));
    expect(r.ok, JSON.stringify((r as any).errors)).toBe(true);
    expect(stored().log_entry_ids).toEqual(["log_001", "log_002", "log_003", "log_005"]);
  });

  it("leaves a cleared stop (stopped_because null) citing nothing", async () => {
    const r = await writeStop({ ...STOP });
    expect(r.ok, JSON.stringify((r as any).errors)).toBe(true);
    expect(stored().log_entry_ids).toEqual([]);
  });

  it("leaves search_stop alone on a write that does not touch it", async () => {
    const r = await researchAppend({
      projectPath: dir,
      section: "questions",
      op: "update",
      entryId: "q_001",
      fields: { priority: "low" },
    } as any);
    expect(r.ok, JSON.stringify((r as any).errors)).toBe(true);
    expect(stored().log_entry_ids).toEqual([]);
    expect(stored("q_002").log_entry_ids).toEqual([]);
  });
});

/**
 * Characterization tests for the read-failure path of every tool that uses a
 * private readJson / readProjectJson helper. A project directory missing a
 * required JSON file, or holding invalid JSON, must return { ok: false } with
 * the canonical error message — never throw.
 *
 * Written first (before the consolidation refactor in issue #988) and verified
 * against main, so they pin existing behaviour rather than the refactor.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

// Stub place resolver so research_append and tree_edit don't hit the network.
vi.mock("../../src/utils/place-resolver.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/utils/place-resolver.js")>();
  return { ...actual, resolveStandardPlace: vi.fn(async () => null) };
});

import { researchAppend } from "../../src/tools/research-append.js";
import { treeEdit } from "../../src/tools/tree-edit.js";
import { materializeFacts } from "../../src/tools/materialize-facts.js";
import { researchLogAppend } from "../../src/tools/research-log-append.js";
import { researchQuery } from "../../src/tools/research-query.js";

// ── minimal valid fixtures ────────────────────────────────────────────────────

const minimalResearch = {
  project: { id: "rp_001", objective: "Test", status: "active", created: "2026-01-01", updated: "2026-01-01" },
  questions: [], plans: [], log: [], sources: [], assertions: [],
  person_evidence: [], conflicts: [], hypotheses: [], timelines: [],
  proof_summaries: [], evaluations: [],
};

const minimalTree = { persons: [], relationships: [], sources: [] };

// ── helpers ───────────────────────────────────────────────────────────────────

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "read-failure-test-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function writeResearch(data: any = minimalResearch) {
  return writeFile(join(dir, "research.json"), JSON.stringify(data, null, 2));
}
function writeTree(data: any = minimalTree) {
  return writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify(data, null, 2));
}
function writeBadJson(filename: string) {
  return writeFile(join(dir, filename), "{not json");
}

// ── research_append ───────────────────────────────────────────────────────────

describe("research_append read failures", () => {
  // Reads research.json first, then tree.gedcomx.json.
  const call = () =>
    researchAppend({
      projectPath: dir,
      section: "sources",
      op: "append",
      entry: { id: "src_001" },
    });

  it("missing research.json → ok:false", async () => {
    await writeTree();
    const r = await call();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/research\.json not found in projectPath/);
  });

  it("invalid research.json → ok:false", async () => {
    await writeTree();
    await writeBadJson("research.json");
    const r = await call();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/research\.json is not valid JSON/);
  });

  it("missing tree.gedcomx.json → ok:false", async () => {
    await writeResearch();
    const r = await call();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/tree\.gedcomx\.json not found in projectPath/);
  });

  it("invalid tree.gedcomx.json → ok:false", async () => {
    await writeResearch();
    await writeBadJson("tree.gedcomx.json");
    const r = await call();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/tree\.gedcomx\.json is not valid JSON/);
  });
});

// ── tree_edit ─────────────────────────────────────────────────────────────────

describe("tree_edit read failures", () => {
  // Reads tree.gedcomx.json first, then research.json.
  const call = () =>
    treeEdit({
      projectPath: dir,
      ops: [{ op: "add_person", person: { gender: "Male" } }],
    } as any);

  it("missing research.json → ok:false", async () => {
    await writeTree();
    const r = await call();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/research\.json not found in projectPath/);
  });

  it("invalid research.json → ok:false", async () => {
    await writeTree();
    await writeBadJson("research.json");
    const r = await call();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/research\.json is not valid JSON/);
  });

  it("missing tree.gedcomx.json → ok:false", async () => {
    await writeResearch();
    const r = await call();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/tree\.gedcomx\.json not found in projectPath/);
  });

  it("invalid tree.gedcomx.json → ok:false", async () => {
    await writeResearch();
    await writeBadJson("tree.gedcomx.json");
    const r = await call();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/tree\.gedcomx\.json is not valid JSON/);
  });
});

// ── materialize_facts ─────────────────────────────────────────────────────────

describe("materialize_facts read failures", () => {
  // Reads tree.gedcomx.json first, then research.json.
  const call = () =>
    materializeFacts({
      projectPath: dir,
      ops: [{ op: "materialize", personId: "P1", factType: "birth" }],
    } as any);

  it("missing research.json → ok:false", async () => {
    await writeTree();
    const r = await call();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/research\.json not found in projectPath/);
  });

  it("invalid research.json → ok:false", async () => {
    await writeTree();
    await writeBadJson("research.json");
    const r = await call();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/research\.json is not valid JSON/);
  });

  it("missing tree.gedcomx.json → ok:false", async () => {
    await writeResearch();
    const r = await call();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/tree\.gedcomx\.json not found in projectPath/);
  });

  it("invalid tree.gedcomx.json → ok:false", async () => {
    await writeResearch();
    await writeBadJson("tree.gedcomx.json");
    const r = await call();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/tree\.gedcomx\.json is not valid JSON/);
  });
});

// ── research_log_append ───────────────────────────────────────────────────────

describe("research_log_append read failures", () => {
  // Reads research.json first, then tree.gedcomx.json.
  const call = () =>
    researchLogAppend({
      projectPath: dir,
      ops: [{
        op: "append",
        entry: {
          id: "log_001",
          plan_item_id: null,
          performed: "2026-01-01T00:00:00.000Z",
          tool: "record_search",
          query: {},
          outcome: "negative",
          results_examined: 0,
          external_site: null,
          results_ref: null,
        },
      }],
    } as any);

  it("missing research.json → ok:false", async () => {
    await writeTree();
    const r = await call();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/research\.json not found in projectPath/);
  });

  it("invalid research.json → ok:false", async () => {
    await writeTree();
    await writeBadJson("research.json");
    const r = await call();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/research\.json is not valid JSON/);
  });
});

// ── research_query ────────────────────────────────────────────────────────────

describe("research_query read failures", () => {
  // Reads research.json only.
  const call = () =>
    researchQuery({ projectPath: dir, section: "sources" });

  it("missing research.json → ok:false", async () => {
    const r = await call();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/research\.json not found in projectPath/);
  });

  it("invalid research.json → ok:false", async () => {
    await writeBadJson("research.json");
    const r = await call();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/research\.json is not valid JSON/);
  });
});

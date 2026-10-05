// research_append as an MCP caller reaches it may change one field on an
// assertion, `informant_bias_notes`; every other assertions write is refused,
// whole call, with nothing written (genealogist ruling 2026-10-05, option B).
// extraction_append writes assertions through `researchAppend` directly and is
// covered by its own suite.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, copyFile, readFile, rm } from "fs/promises";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { researchAppendFromCaller } from "../../src/tools/research-append.js";

const SCENARIO = resolve(__dirname, "../../../../../eval/fixtures/scenarios/mid-research-flynn");

describe("research_append from a caller — assertions are extraction's", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "research-append-caller-"));
    for (const f of ["research.json", "tree.gedcomx.json"]) await copyFile(join(SCENARIO, f), join(dir, f));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const files = async () =>
    Promise.all(["research.json", "tree.gedcomx.json"].map((f) => readFile(join(dir, f), "utf-8")));

  it.each([
    ["an append", { section: "assertions", op: "append", entry: { record_role: "principal", fact_type: "name", value: "X" } }],
    ["an update of the value", { section: "assertions", op: "update", entryId: "a_001", fields: { value: "Tannetje van Noord" } }],
    ["an update of the value alongside the notes", { section: "assertions", op: "update", entryId: "a_001", fields: { value: "Y", informant_bias_notes: "re-read" } }],
    ["an update with no fields", { section: "assertions", op: "update", entryId: "a_001", fields: {} }],
  ])("refuses %s and writes nothing", async (_label, call) => {
    const before = await files();
    const r = await researchAppendFromCaller({ projectPath: dir, ...(call as object) } as never);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toMatch(/does not write assertions/);
    expect(await files()).toEqual(before);
  });

  it("refuses a batch carrying an assertions op, names it, and writes none of its ops", async () => {
    const before = await files();
    const r = await researchAppendFromCaller({
      projectPath: dir,
      ops: [
        { section: "questions", op: "update", entryId: "q_001", fields: { status: "in_progress" } },
        { section: "assertions", op: "update", entryId: "a_001", fields: { value: "Z" } },
      ],
    } as never);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatch(/^ops\[1\]: research_append does not write assertions/);
    expect(r.opsReceived).toBe(2);
    expect(await files()).toEqual(before);
  });

  it("refuses an assertions op inside a stringified batch", async () => {
    const r = await researchAppendFromCaller({
      projectPath: dir,
      ops: JSON.stringify([{ section: "assertions", op: "append", entry: { value: "Z" } }]),
    } as never);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toMatch(/^ops\[0\]: research_append does not write assertions/);
  });

  it("accepts an update that sets only informant_bias_notes", async () => {
    const r = await researchAppendFromCaller({
      projectPath: dir,
      section: "assertions",
      op: "update",
      entryId: "a_001",
      fields: { informant_bias_notes: "The researcher reads the first letter as T on the image." },
    } as never);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const research = JSON.parse((await files())[0]);
    const a = research.assertions.find((x: { id: string }) => x.id === "a_001");
    expect(a.informant_bias_notes).toBe("The researcher reads the first letter as T on the image.");
  });

  it("passes every other section through untouched", async () => {
    const r = await researchAppendFromCaller({
      projectPath: dir,
      section: "questions",
      op: "update",
      entryId: "q_001",
      fields: { status: "in_progress" },
    } as never);
    expect(r.ok, JSON.stringify(r)).toBe(true);
  });
});

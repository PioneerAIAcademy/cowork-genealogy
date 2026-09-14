import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, writeFile, readFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

/**
 * The fact-rewrite rollback (#2472), in its own file because it needs
 * `validateIntroduced` to fail and that mock must not reach any other test.
 *
 * Why the valve exists: writers block on call-introduced errors only (commit
 * `7cd6a19b9`), and a fact rewrite IS call-introduced — so a rewritten fact
 * that failed validation would refuse the assertion correction itself, which is
 * the legitimate write the caller actually asked for. The lead's ruling on #2472
 * requires the rewrite to degrade to a warning rather than fail the call.
 *
 * **No ordinary input is known to reach it.** The rewrite only ever writes a
 * trimmed non-empty string into one of four fields the tree schema types
 * `string`, or deletes the key; `checkTreeStrings` is the only thing validating
 * those, and both directions strictly reduce the error set. That is precisely
 * why the branch is mocked here rather than driven: an untested safety valve
 * that nothing can trigger is indistinguishable from one that does not work.
 */

const failOnce = { remaining: 0 };
/** The `after` tree each validateIntroduced pass was handed, deep-copied at call
 *  time. The retry's copy is what proves `undo()` actually restored — asserting
 *  only on the files would pass with a no-op undo, since the rollback path does
 *  not write the tree either way. */
const seenTrees: any[] = [];

vi.mock("../../src/validation/introduced-errors.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/validation/introduced-errors.js")>();
  return {
    ...actual,
    validateIntroduced: vi.fn(async (before: any, after: any, options: any) => {
      seenTrees.push(structuredClone(after.tree));
      if (failOnce.remaining > 0) {
        failOnce.remaining--;
        return {
          valid: false as const,
          errors: [{ path: "tree.gedcomx.json/persons[id=I1]/facts[id=F4]", message: "synthetic failure" }],
          warnings: [],
        };
      }
      return actual.validateIntroduced(before, after, options);
    }),
  };
});

const { researchAppend } = await import("../../src/tools/research-append.js");

const research = () => ({
  project: { id: "rp_001", objective: "Test", status: "active", created: "2026-01-01", updated: "2026-01-01" },
  questions: [], plans: [], log: [],
  sources: [{
    id: "src_001",
    gedcomx_source_description_id: "SD-001",
    citation: "1850 U.S. Census",
    citation_detail: { who: "", what: "", when_created: "", when_accessed: "", where: "", where_within: "" },
    source_classification: "original",
    repository: "NARA",
    access_date: "2026-01-01",
  }],
  assertions: [{
    id: "a_011", source_id: "src_001", record_id: "rec1", record_role: "principal",
    fact_type: "immigration", value: "Immigrated 1924",
    place: "Wellburn, Thames Centre, Middlesex, Ontario, Canada",
    standard_place: "Thames Centre Township, Middlesex, Ontario, Canada",
    information_quality: "primary", informant: "self", informant_proximity: "self",
    evidence_type: "direct", extracted_for_question_ids: [],
  }],
  person_evidence: [], conflicts: [], hypotheses: [], timelines: [],
  proof_summaries: [], evaluations: [],
});

const tree = () => ({
  persons: [{
    id: "I1", gender: "Male", names: [{ id: "N1", given: "John", surname: "Smith" }],
    facts: [{
      id: "F4", type: "Immigration",
      place: "Wellburn, Thames Centre, Middlesex, Ontario, Canada",
      assertion_id: "a_011", sources: [{ ref: "SD-001" }],
    }],
  }],
  relationships: [],
  sources: [{ id: "SD-001", title: "1850 U.S. Census" }],
});

describe("fact-rewrite rollback (#2472)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ra-degrade-"));
    failOnce.remaining = 0;
    seenTrees.length = 0;
    await writeFile(join(dir, "research.json"), JSON.stringify(research(), null, 2), "utf-8");
    await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify(tree(), null, 2), "utf-8");
  });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  const read = async (f: string) => JSON.parse(await readFile(join(dir, f), "utf-8"));

  it("a rewrite that fails validation is rolled back; the assertion correction still lands", async () => {
    failOnce.remaining = 1; // first pass fails, the post-undo retry runs for real

    const r = await researchAppend({
      projectPath: dir, section: "assertions", op: "update", entryId: "a_011",
      fields: { place: "Odessa, Francis No. 127, Saskatchewan, Canada" },
    });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // The legitimate write landed.
    expect((await read("research.json")).assertions[0].place)
      .toBe("Odessa, Francis No. 127, Saskatchewan, Canada");
    // The tree was rolled back and not written.
    expect(r.filesWritten).toEqual(["research.json"]);
    expect((await read("tree.gedcomx.json")).persons[0].facts[0].place)
      .toBe("Wellburn, Thames Centre, Middlesex, Ontario, Canada");
    expect(r.validation.warnings.join(" ")).toMatch(/could not be updated from this correction/);

    // `undo()` really restored: the first pass saw the rewritten place, the
    // retry saw the original. Without this the branch could return the right
    // files and warning while leaving the tree mutated in memory — and the
    // retry's verdict is taken from that tree.
    expect(seenTrees).toHaveLength(2);
    expect(seenTrees[0].persons[0].facts[0].place)
      .toBe("Odessa, Francis No. 127, Saskatchewan, Canada");
    expect(seenTrees[1].persons[0].facts[0].place)
      .toBe("Wellburn, Thames Centre, Middlesex, Ontario, Canada");
  });

  it("a failure the rewrite did not cause still fails the call, with nothing written", async () => {
    failOnce.remaining = 2; // both the first pass and the post-undo retry fail

    const r = await researchAppend({
      projectPath: dir, section: "assertions", op: "update", entryId: "a_011",
      fields: { place: "Odessa, Francis No. 127, Saskatchewan, Canada" },
    });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/synthetic failure/);
    // Nothing persisted — neither document moved.
    expect((await read("research.json")).assertions[0].place)
      .toBe("Wellburn, Thames Centre, Middlesex, Ontario, Canada");
    expect((await read("tree.gedcomx.json")).persons[0].facts[0].place)
      .toBe("Wellburn, Thames Centre, Middlesex, Ontario, Canada");
  });
  it("rolls back correctly when ONE batch updates the same assertion twice", async () => {
    // The undo stack replays per (op, fact) pair. Two ops on one assertion
    // snapshot the same fact twice, and the second snapshot captures the state
    // AFTER the first rewrite — so replaying them in insertion order restores
    // the first rewrite instead of the original. The single-op test above
    // cannot see it.
    failOnce.remaining = 1;

    const r = await researchAppend({
      projectPath: dir,
      ops: [
        { section: "assertions", op: "update", entryId: "a_011", fields: { place: "Odessa, Francis No. 127, Saskatchewan, Canada" } },
        { section: "assertions", op: "update", entryId: "a_011", fields: { date: "1925" } },
      ],
    } as any);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.filesWritten).toEqual(["research.json"]);

    // The retry must validate the ORIGINAL tree, or a genuinely rewrite-caused
    // failure would fail again and the call would be refused — the one thing
    // the ruling forbids.
    expect(seenTrees).toHaveLength(2);
    const retried = seenTrees[1].persons[0].facts[0];
    expect(retried.place).toBe("Wellburn, Thames Centre, Middlesex, Ontario, Canada");
    expect(retried.date).toBeUndefined();

    // And the persisted tree is untouched.
    const onDisk = (await read("tree.gedcomx.json")).persons[0].facts[0];
    expect(onDisk.place).toBe("Wellburn, Thames Centre, Middlesex, Ontario, Canada");
    expect(onDisk.date).toBeUndefined();
  });
});

import { describe, it, expect } from "vitest";
import { crossLogDuplicates } from "../../dev/count-cross-log-duplicates.js";

const a = (id: string, log: string, over: Record<string, unknown> = {}) => ({
  id,
  source_id: "src_001",
  record_id: "ark:/61903/1:1:XHLG-T8R",
  record_persona_id: "p_1",
  record_role: "head_of_household",
  fact_type: "birth",
  value: "1777",
  log_entry_id: log,
  ...over,
});

const research = (assertions: unknown[]) => ({
  log: [
    { id: "log_001", tool: "record_search" },
    { id: "log_002", tool: "record_search" },
    { id: "log_003", tool: "image_transcribe" },
    { id: "log_004", tool: "image_search" },
  ],
  assertions,
});

describe("crossLogDuplicates", () => {
  it("counts one fact re-extracted under a second non-image log entry", () => {
    const c = crossLogDuplicates(research([a("a_001", "log_001"), a("a_002", "log_002", { value: "abt 1777" })]));
    expect(c.groups).toHaveLength(1);
    expect(c.groups[0].logEntryIds).toEqual(["log_001", "log_002"]);
    expect(c.groups[0].assertions.map((x) => x.id)).toEqual(["a_001", "a_002"]);
  });

  it("folds fact-type aliases and ARK spellings the way the guard does", () => {
    const c = crossLogDuplicates(
      research([a("a_001", "log_001"), a("a_002", "log_002", { fact_type: "Birth", record_id: "1:1:XHLG-T8R" })]),
    );
    expect(c.groups).toHaveLength(1);
  });

  it("counts a missing log entry as its own extraction pass", () => {
    const c = crossLogDuplicates(research([a("a_001", "log_001"), a("a_002", "", { log_entry_id: undefined })]));
    expect(c.groups[0].logEntryIds).toEqual(["log_001", ""]);
  });

  it("does not count two same-keyed assertions under one log entry", () => {
    const c = crossLogDuplicates(research([a("a_001", "log_001"), a("a_002", "log_001", { value: "Vermont" })]));
    expect(c.groups).toEqual([]);
  });

  it("excludes an image-pass reading, whether logged as a transcription or an image search", () => {
    const c = crossLogDuplicates(research([a("a_001", "log_001"), a("a_002", "log_003"), a("a_003", "log_004")]));
    expect(c.groups).toEqual([]);
    expect(c.imagePassExcluded).toBe(2);
  });

  it("does not pair different persons, records, sources or fact types", () => {
    const c = crossLogDuplicates(
      research([
        a("a_001", "log_001"),
        a("a_002", "log_002", { record_persona_id: "p_2" }),
        a("a_003", "log_002", { record_id: "ark:/61903/1:1:OTHER" }),
        a("a_004", "log_002", { source_id: "src_002" }),
        a("a_005", "log_002", { fact_type: "death" }),
      ]),
    );
    expect(c.groups).toEqual([]);
  });

  it("leaves negative evidence and malformed assertions uncompared", () => {
    const c = crossLogDuplicates(
      research([
        a("a_001", "log_001", { record_role: "absent", record_persona_id: undefined }),
        a("a_002", "log_002", { record_role: "absent", record_persona_id: undefined }),
        { id: "a_003", log_entry_id: "log_001" },
      ]),
    );
    expect(c.groups).toEqual([]);
    expect(c.notComparable).toBe(3);
  });

  it("tolerates a document with no log or assertions", () => {
    expect(crossLogDuplicates({})).toEqual({ assertions: 0, imagePassExcluded: 0, notComparable: 0, groups: [] });
  });
});

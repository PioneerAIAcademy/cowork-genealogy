import { describe, it, expect } from "vitest";
import { uploadReadPlan } from "../../src/utils/upload-read-plan.js";

const row = (name: string, hasText: boolean) => ({ name, uploaded: "2026-08-10T15:00:00.000Z", hasText });

describe("uploadReadPlan", () => {
  it("says nothing when there are no uploads", () => {
    expect(uploadReadPlan([], true)).toEqual({ uploads: [] });
    expect(uploadReadPlan([], false)).toEqual({ uploads: [] });
  });

  it("a folder project: files, and no row names a reader", () => {
    const plan = uploadReadPlan([row("a.pdf", true), row("b.png", false), row("c.txt", false)], false);
    expect(plan.uploadsAre).toBe("files");
    for (const u of plan.uploads) expect(Object.keys(u).sort()).toEqual(["hasText", "name", "uploaded"]);
  });

  it("a stored project: each row names its reader", () => {
    const plan = uploadReadPlan([row("a.pdf", true), row("b.png", false), row("c.txt", false), row("D.TXT", false)], true);
    expect(plan.uploadsAre).toBe("stored");
    expect(plan.uploads.map((u) => [u.name, u.readWith, u.ref])).toEqual([
      ["a.pdf", "sidecar_read", "uploads/a.pdf.txt"],
      ["b.png", "image_transcribe", undefined],
      ["c.txt", "sidecar_read", "uploads/c.txt"],
      ["D.TXT", "sidecar_read", "uploads/D.TXT"],
    ]);
    expect("ref" in plan.uploads[1]).toBe(false);
  });

  it("drops a reader a row arrived with when the project is a folder", () => {
    const stored = uploadReadPlan([row("a.pdf", true)], true).uploads;
    expect(uploadReadPlan(stored, false).uploads[0]).toEqual(row("a.pdf", true));
  });
});

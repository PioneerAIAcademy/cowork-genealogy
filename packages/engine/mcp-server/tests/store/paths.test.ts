import { describe, it, expect } from "vitest";
import { assertRelativeRef, ProjectEscapeError } from "../../src/store/paths.js";

// The pure ref guard the Postgres/S3 backend keys every row by. It runs here
// without a stack so the escape rule is proven in CI even when the conformance
// suite that also exercises it (pg-s3-project-store.test.ts) is skipped.

describe("assertRelativeRef", () => {
  it("returns a normalised POSIX ref for every legitimate spelling", () => {
    expect(assertRelativeRef("research.json")).toBe("research.json");
    expect(assertRelativeRef("results/log_001.json")).toBe("results/log_001.json");
    expect(assertRelativeRef("./research.json")).toBe("research.json");
    expect(assertRelativeRef("results//log_001.json")).toBe("results/log_001.json");
    expect(assertRelativeRef("results/")).toBe("results");
    expect(assertRelativeRef("results/./.staging/x.json")).toBe("results/.staging/x.json");
    expect(assertRelativeRef(".tree-before-forget.gedcomx.json")).toBe(".tree-before-forget.gedcomx.json");
    expect(assertRelativeRef("images\\scan.jpg")).toBe("images/scan.jpg");
  });

  it("refuses every way a ref can leave the project", () => {
    const escapes: unknown[] = [
      "",
      undefined,
      null,
      42,
      "/etc/passwd",
      "C:\\Users\\x.json",
      "c:/x.json",
      "..",
      "../outside.json",
      "../../etc/passwd",
      "results/../../x",
      "results/../research.json",
      "a/..",
      "..\\x.json",
      "results\\..\\..\\x",
      "research.json\u0000",
      ".",
      "./",
    ];
    for (const ref of escapes) {
      expect(() => assertRelativeRef(ref), String(ref)).toThrow(/escapes the project/);
      expect(() => assertRelativeRef(ref), String(ref)).toThrow(ProjectEscapeError);
    }
  });
});

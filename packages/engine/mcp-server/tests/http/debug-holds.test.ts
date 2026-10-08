import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEBUG_HOLD_ENV, debugHoldStartupLine } from "../../src/debug-holds.js";

// build/http.js prints this line at start-up so a hold left set on a deployed tool server
// shows in its logs. http-entrypoint-exit.test.ts checks the entrypoint prints it.

const [BEFORE, AFTER] = DEBUG_HOLD_ENV;

describe("debugHoldStartupLine", () => {
  it("is null when neither hold is set, or both are empty", () => {
    expect(debugHoldStartupLine({})).toBeNull();
    expect(debugHoldStartupLine({ [BEFORE]: "", [AFTER]: "  " })).toBeNull();
  });

  it("names the one set hold and its value, and not the unset one", () => {
    const line = debugHoldStartupLine({ [BEFORE]: "180000", [AFTER]: "" });
    expect(line).toBe(`debug holds set (never in production): ${BEFORE}="180000"\n`);
    expect(line).not.toContain(AFTER);
  });

  it("names both when both are set, whatever the value", () => {
    const line = debugHoldStartupLine({ [BEFORE]: "0", [AFTER]: "not-a-number" });
    expect(line).toBe(`debug holds set (never in production): ${BEFORE}="0", ${AFTER}="not-a-number"\n`);
  });
});

describe("DEBUG_HOLD_ENV", () => {
  it("is exactly the GENEALOGY_DEBUG_* variables research-append.ts reads", async () => {
    const src = await readFile(
      resolve(dirname(fileURLToPath(import.meta.url)), "../../src/tools/research-append.ts"),
      "utf-8",
    );
    const read = new Set([...src.matchAll(/process\.env(?:\.|\[["'])(GENEALOGY_DEBUG_\w+)/g)].map((m) => m[1]));
    expect(read).toEqual(new Set(DEBUG_HOLD_ENV));
  });
});

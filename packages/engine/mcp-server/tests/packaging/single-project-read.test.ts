import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

// Guards the #988 consolidation. Six tools had grown private, byte-identical
// copies of the project-file read, and the sixth (research-query.ts) was
// written three days AFTER the shared helper landed — the doc comment on
// readProjectJson recorded that and ended "Nothing enforces the line above."
// That was true, which is how one copy became six. Consolidating without a
// guard just resets the counter, so this is the guard: utils/project-io.ts is
// the only place these two messages may be phrased.
//
// Modelled on no-bare-fetch.test.ts, same shape and same reason.

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(here, "..", "..", "src");
const CANONICAL = join(srcRoot, "utils", "project-io.ts");

// The two messages every private copy carried. Matching the STRINGS rather than
// a helper name is deliberate: the copies were named readJson, readProjectJson
// and nothing at all (inlined), so a name-based check misses the inlined case,
// which is exactly the one that slipped in last time.
const MESSAGES = ["not found in projectPath", "is not valid JSON"];

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...collectTsFiles(full));
    else if (entry.endsWith(".ts")) out.push(full);
  }
  return out;
}

describe("one project-file read", () => {
  it("only utils/project-io.ts phrases the project-read errors", () => {
    const offenders: string[] = [];
    for (const file of collectTsFiles(srcRoot)) {
      if (file === CANONICAL) continue;
      const content = readFileSync(file, "utf8");
      for (const msg of MESSAGES) {
        if (content.includes(msg)) offenders.push(`${relative(srcRoot, file)} — ${msg}`);
      }
    }
    expect(
      offenders,
      "a private copy of the project-file read is back. Call readProjectJson() " +
        "from utils/project-io.ts and re-throw through the tool's own error " +
        `class (see tree-forget.ts):\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});

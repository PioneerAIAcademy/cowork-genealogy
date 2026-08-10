import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

// Guards against reintroducing the 236-minute hang (issue #1369): every
// network call in src/ must go through fetchWithTimeout() in utils/http.ts,
// the only file allowed to call the global fetch directly. Node's fetch has
// no timeout of its own, so a bare fetch() elsewhere hangs forever on a
// stalled upstream connection with no CI signal to catch it.

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(here, "..", "..", "src");
const EXEMPT = join(srcRoot, "utils", "http.ts");

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectTsFiles(full));
    } else if (entry.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

describe("no bare fetch() outside utils/http.ts", () => {
  it("only utils/http.ts calls the global fetch directly", () => {
    const offenders: string[] = [];
    for (const file of collectTsFiles(srcRoot)) {
      if (file === EXEMPT) continue;
      const content = readFileSync(file, "utf8");
      if (/\bfetch\(/.test(content)) {
        offenders.push(relative(srcRoot, file));
      }
    }
    expect(
      offenders,
      `bare fetch() found outside utils/http.ts — use fetchWithTimeout() instead:\n${offenders.join("\n")}`
    ).toEqual([]);
  });
});

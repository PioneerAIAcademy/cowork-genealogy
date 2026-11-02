// The engine store locks the same files the plugin hook protects (issue #1499).
// The hook's tuple and the store's set are two copies in two languages; a name
// added to one and not the other is either unlocked on disk or locked with no
// hook deny to explain it.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PROTECTED_FILES } from "../../src/store/fs-project-store.js";

const GUARD_HOOK = join(
  dirname(fileURLToPath(import.meta.url)),
  "..", "..", "..", "plugin", "hooks", "guard_project_files.py",
);

/** The names in the hook's PROTECTED_PROJECT_FILES; throws rather than returning
 *  empty, which would make the comparison below vacuous. */
function hookProtectedFiles(): string[] {
  const body = readFileSync(GUARD_HOOK, "utf8").match(/^PROTECTED_PROJECT_FILES(?:\s*:[^=\n]+)?\s*=\s*\(([^)]*)\)/m)?.[1];
  const names = [...(body ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  if (names.length === 0) throw new Error(`PROTECTED_PROJECT_FILES not found or empty in ${GUARD_HOOK}`);
  return names;
}

describe("protected project files", () => {
  it("the store locks exactly the files the hook protects", () => {
    expect([...PROTECTED_FILES].sort()).toEqual(hookProtectedFiles().sort());
  });
});

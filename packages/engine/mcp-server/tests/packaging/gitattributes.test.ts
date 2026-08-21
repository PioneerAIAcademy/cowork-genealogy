import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * `.gitattributes` line-ending policy.
 *
 * `* text=auto eol=lf` pins every text file to LF in the index AND in the
 * working tree, on Windows too. No local config can opt out — `core.autocrlf`
 * in all three settings and `core.eol=crlf` are all overridden by the
 * attribute — so the only way the policy breaks is an edit to a
 * `.gitattributes`.
 *
 * The specific break this exists for is a REORDER, because later rules win:
 * the blanket line sits above `*.sh` and `*.bat`, and moved below them it
 * takes `*.bat` to LF. Every Windows batch script then checks out with LF, and
 * a `.bat` with LF endings fails in ways that do not name their cause. Nothing
 * else in the repo notices — the index does not change, no test reads a `.bat`
 * byte-for-byte, and CI runs on Linux.
 *
 * Resolution is asked of `git check-attr` rather than parsed out of the file.
 * Parsing would re-implement git's precedence rules, and could then be wrong
 * in exactly the way the file is — a lint agreeing with the bug it is meant to
 * catch.
 *
 * Two things make `check-attr` quietly useless if either is skipped, so both
 * are load-bearing below:
 *
 *  - **cwd.** It resolves its pathspec relative to the current directory, and
 *    vitest runs with cwd `packages/engine/mcp-server` (engine-tests.yml sets
 *    working-directory). From there `scripts/windows/install.bat` names a file
 *    that does not exist; unanchored patterns like `*.bat` still match it, so
 *    the assertions below would pass, but an anchored pattern would report
 *    `unspecified` and git would still exit 0. Hence `cwd: projectRoot`.
 *  - **existence.** `check-attr` matches patterns, not files, and answers for
 *    a path that was never there. Without the existsSync assertion a rename
 *    leaves every expectation below green over paths that no longer exist.
 */

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, "..", "..", "..", "..", "..");

/** Resolved attribute values for one path, as git itself computes them. */
function checkAttr(attrs: string[], path: string): Record<string, string> {
  const out = execFileSync("git", ["check-attr", "-z", ...attrs, "--", path], {
    cwd: projectRoot,
    encoding: "utf8",
  });
  // -z output is a flat NUL-separated <path> <attr> <value> triple stream, and
  // splitting leaves one trailing empty field.
  const fields = out.split("\0");
  const resolved: Record<string, string> = {};
  for (let i = 0; i + 2 < fields.length; i += 3) {
    resolved[fields[i + 1]] = fields[i + 2];
  }
  return resolved;
}

/**
 * One row per behaviour the policy has to keep, not one per file — each names
 * a distinct way the rules can be got wrong.
 */
const TEXT_FILES: Array<{ path: string; text: string; eol: string; why: string }> = [
  {
    path: "scripts/windows/install.bat",
    text: "set",
    eol: "crlf",
    why: "the *.bat rule must survive the blanket rule; a reorder takes this to lf",
  },
  {
    path: "eval/Setup.bat",
    text: "set",
    eol: "crlf",
    why: "22 of the 44 .bat files sit outside scripts/windows/, so the rule has to hold there too",
  },
  {
    path: "scripts/git-hooks/shim.sh",
    text: "set",
    eol: "lf",
    why: "an explicit *.sh rule, kept because a CRLF #!/bin/sh does not run under Git Bash",
  },
  {
    path: "scripts/git-hooks/post-checkout",
    text: "auto",
    eol: "lf",
    why: "extensionless: covered only by the blanket rule, and by nothing at all before it",
  },
  {
    path: "packages/engine/mcp-server/src/index.ts",
    text: "auto",
    eol: "lf",
    why: "an ordinary source file — the blanket rule's main case",
  },
];

/**
 * `text=auto` decides "binary?" from a NUL byte in the first 8000 bytes only,
 * which an uncompressed or ASCII-heavy scan can slip past. These four
 * extensions are pinned `binary` so a scanned evidence document cannot be
 * silently mangled by the blanket rule.
 */
const BINARY_FILES = [
  "eval/slides/junior-kickoff.pdf",
  "eval/tests/e2e/kenneth-quass-death/provided-documents/ancestry-texas-death-cert-quass.pdf",
  "apps/electron/build/icon.png",
  "apps/electron/build/icon.ico",
  "apps/electron/build/icon.icns",
];

describe(".gitattributes line-ending policy", () => {
  for (const { path, text, eol, why } of TEXT_FILES) {
    it(`resolves ${path} to text=${text} eol=${eol} — ${why}`, () => {
      expect(existsSync(join(projectRoot, path)), `${path} no longer exists`).toBe(true);
      expect(checkAttr(["text", "eol"], path)).toEqual({ text, eol });
    });
  }

  for (const path of BINARY_FILES) {
    it(`leaves ${path} unconverted`, () => {
      expect(existsSync(join(projectRoot, path)), `${path} no longer exists`).toBe(true);
      expect(checkAttr(["text"], path).text).toBe("unset");
    });
  }
});

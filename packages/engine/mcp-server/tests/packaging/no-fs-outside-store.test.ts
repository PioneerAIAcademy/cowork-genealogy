import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

// Every read and write of project state goes through src/store/ (`ProjectStore`).
// A module that imports `fs` reaches the project directory around that seam —
// which works on the desktop and does nothing, or the wrong thing, under a
// backend that is not a directory. So the import is banned everywhere but the
// file backend itself, auth (per-user files under ~/.familysearch-mcp, which
// are not project state) and the bundled-data reader. Porting every tool proves
// forty-eight existentials; this proves the universal.

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(here, "..", "..", "src");

const EXEMPT = new Set([
  "store/fs-project-store.ts",
  "auth/config.ts",
  "auth/tokenManager.ts",
  "utils/name-variants.ts",
]);

// Any way a module can bind the fs module: a static import with or without a
// binding list (reflowed across lines or not), a bare side-effect import,
// `require()`, and a dynamic `import()`; the `node:` prefix and the `/promises`
// subpath included. The quote must sit directly against `fs`, so a relative
// module that merely starts with "fs" (`./fs-project-store.js`) never matches.
const FS_MODULE = String.raw`["'](?:node:)?fs(?:/promises)?["']`;
const FS_REFERENCE = new RegExp(
  [
    String.raw`\bfrom\s*${FS_MODULE}`,
    String.raw`\bimport\s*${FS_MODULE}`,
    String.raw`\brequire\s*\(\s*${FS_MODULE}\s*\)`,
    String.raw`\bimport\s*\(\s*${FS_MODULE}\s*\)`,
  ].join("|"),
);

/** Comments are prose, not bindings — a docstring that says `import "fs"` is
 *  not an import. Strip them before matching. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

function referencesFs(source: string): boolean {
  return FS_REFERENCE.test(withoutComments(source));
}

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

describe("no fs import outside the project store", () => {
  it("flags every way a module can bind fs", () => {
    const offenders = [
      `import { readFile } from "fs/promises";`,
      `import {\n  readFile,\n  writeFile,\n} from "node:fs/promises";`,
      `import * as fs from 'node:fs';`,
      `import fs from "fs";`,
      `import "fs";`,
      `const fs = require("fs");`,
      `const fsp = require('node:fs/promises');`,
      `const { readFile } = await import("node:fs/promises");`,
    ];
    for (const source of offenders) {
      expect(referencesFs(source), source).toBe(true);
    }
  });

  it("accepts legitimate imports, including reflowed ones and modules whose name starts with fs", () => {
    const fine = [
      `import { join } from "path";`,
      `import {\n  join,\n  resolve,\n} from "node:path";`,
      `import { FsProjectStore } from "./fs-project-store.js";`,
      `import { fetchFsImageBytes } from "../utils/fs-image-fetch.js";`,
      `import { AsyncLocalStorage } from "node:async_hooks";`,
      `// a comment may say import "fs" without importing it`,
      `/* import { readFile } from "fs/promises"; — commented out */`,
      `const label = "fs";`,
    ];
    for (const source of fine) {
      expect(referencesFs(source), source).toBe(false);
    }
  });

  it("only the file backend, auth and the bundled-data reader import fs", () => {
    const offenders: string[] = [];
    for (const file of collectTsFiles(srcRoot)) {
      const rel = relative(srcRoot, file).split("\\").join("/");
      if (EXEMPT.has(rel)) continue;
      if (referencesFs(readFileSync(file, "utf8"))) offenders.push(rel);
    }
    expect(
      offenders,
      `fs imported outside src/store/ — read and write project state through ` +
        `getProjectStore() (or the utils/project-io, results-staging, image-store ` +
        `helpers) instead:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("every exemption is still needed", () => {
    // An exemption for a file that no longer imports fs is a hole nothing
    // tests. Fail so the list shrinks when the port reaches it.
    const stale = [...EXEMPT].filter(
      (rel) => !referencesFs(readFileSync(join(srcRoot, rel), "utf8")),
    );
    expect(stale, `exempt files that no longer import fs: ${stale.join(", ")}`).toEqual([]);
  });
});

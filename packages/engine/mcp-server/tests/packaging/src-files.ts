import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

/**
 * The engine source tree for the import lints in this directory
 * (`no-fs-outside-store.test.ts`, `credential-reads-in-auth.test.ts`): every
 * `.ts` file under `src/`, as `{ rel, source }` with `rel` in POSIX form so an
 * exemption list reads the same on Windows.
 */
export const srcRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src");

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

export function srcFiles(): Array<{ rel: string; source: string }> {
  return collectTsFiles(srcRoot).map((file) => ({
    rel: relative(srcRoot, file).split("\\").join("/"),
    source: readFileSync(file, "utf8"),
  }));
}

/** One file's source by its POSIX path under `src/`. */
export function srcSource(rel: string): string {
  return readFileSync(join(srcRoot, rel), "utf8");
}

/** Comments are prose, not bindings — a docstring that says `import "fs"` is
 *  not an import. Strip them before matching. */
export function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

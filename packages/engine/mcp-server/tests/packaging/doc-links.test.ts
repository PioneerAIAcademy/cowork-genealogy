import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  citedMakeTargets,
  citedPaths,
  headingAnchors,
  makefileTargets,
  markdownLinkTargets,
  pathResolves,
} from "./repo-paths.js";

/**
 * Staleness lint for the process doc and the Claude Code tooling under
 * `.claude/`.
 *
 * `adr-links.test.ts` does this for ADRs; this is the same check pointed at
 * two surfaces that had nothing linting them. The reason is on the record:
 * three subagents under `.claude/agents/` were deleted on 2026-08-02 (issue
 * #1161) because their paths rotted silently after `packages/engine/` was
 * introduced, and nothing noticed. `docs/task-lifecycle.md` names ~15 repo
 * paths, several make targets, and a CI workflow, and is read *while someone
 * is working* — a wrong pointer there is a wrong answer someone acts on.
 *
 * The extraction rule, and everything deliberately left unchecked, is
 * documented at the top of `./repo-paths.ts`. Three things resolve here:
 *
 *  1. backticked repo-root-anchored paths (placeholders globbed),
 *  2. markdown link destinations, relative to the citing file, plus same-file
 *     `#anchor` links against that file's own headings,
 *  3. `make <target>` written in code, against the root Makefile.
 *
 * Not checked, on purpose:
 *  - anchors into *other* files (their heading set is not this file's, and a
 *    homemade slugifier applied across files is a false-positive generator),
 *  - `http(s)://` and `mailto:` links (no network in a unit test),
 *  - paths written relative to a directory the prose established earlier
 *    (`dev/try-login.ts` after a `cd packages/engine/mcp-server`) — resolving
 *    those means guessing the cwd,
 *  - bare commands other than `make` (`gh`, `git`, `npx tsx`), which are not
 *    repo state.
 */

const here = dirname(fileURLToPath(import.meta.url));
const engineRoot = join(here, "..", "..", ".."); // packages/engine/
const projectRoot = join(engineRoot, "..", ".."); // repo root

/**
 * Process docs under `docs/` that are linted. Deliberately a list and not all
 * of `docs/`: the rest of the directory has never been swept, and widening it
 * is its own task with its own backlog of real breaks to fix.
 */
const LINTED_DOCS = ["docs/task-lifecycle.md"];

/** Claude Code subagents and slash commands. Every `.md` in each is linted. */
const LINTED_DIRS = [".claude/agents", ".claude/commands"];

/**
 * A path a document names *because it is gone*. Citing a retired file is not
 * rot, it is the record of a decision — so the exception is listed by name
 * with its reason, rather than inferred from the surrounding sentence. An
 * entry that stops firing fails the suite below, so this list cannot quietly
 * outlive the prose it excuses.
 */
const KNOWN_ABSENT: { file: string; path: string; why: string }[] = [];

function lintedFiles(): string[] {
  const files = [...LINTED_DOCS];
  for (const dir of LINTED_DIRS) {
    if (!existsSync(join(projectRoot, dir))) continue;
    for (const f of readdirSync(join(projectRoot, dir)).sort()) {
      if (f.endsWith(".md")) files.push(`${dir}/${f}`);
    }
  }
  return files;
}

function isExempt(file: string, path: string): boolean {
  return KNOWN_ABSENT.some((e) => e.file === file && e.path === path);
}

describe("doc and .claude/ tooling links", () => {
  const files = lintedFiles();

  it("covers every surface it claims to", () => {
    for (const doc of LINTED_DOCS) {
      expect(
        existsSync(join(projectRoot, doc)),
        `${doc} is linted by this test but does not exist. If it moved, update LINTED_DOCS; ` +
          `do not drop it — an unlinted process doc is how the deleted subagents rotted.`,
      ).toBe(true);
    }
    for (const dir of LINTED_DIRS) {
      const found = files.filter((f) => f.startsWith(`${dir}/`));
      expect(
        found.length,
        `${dir}/ has no .md files, so this lint is covering nothing there`,
      ).toBeGreaterThan(0);
    }
  });

  it.each(files)("%s cites only paths that still exist", (file) => {
    const body = readFileSync(join(projectRoot, file), "utf8");
    const missing = citedPaths(body).filter(
      (p) => !pathResolves(projectRoot, p) && !isExempt(file, p),
    );

    expect(
      missing,
      `${file} cites paths that no longer exist: ${missing.join(", ")}\n` +
        `Fix the citation in the same PR that moved the code. If the path is named ` +
        `*because* it was retired, add it to KNOWN_ABSENT in this test with the reason.`,
    ).toEqual([]);
  });

  it.each(files)("%s links only to files that still exist", (file) => {
    const abs = join(projectRoot, file);
    const body = readFileSync(abs, "utf8");
    const anchors = headingAnchors(body);
    const broken: string[] = [];

    for (const target of markdownLinkTargets(body)) {
      if (/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(target)) continue; // http(s), mailto, tel
      if (target.startsWith("#")) {
        // Same-file anchor: check it against this file's own headings.
        if (!anchors.has(target.slice(1).toLowerCase())) broken.push(target);
        continue;
      }
      const [pathPart] = target.split("#");
      if (!pathPart) continue;
      if (!pathResolves(dirname(abs), decodeURIComponent(pathPart))) broken.push(target);
    }

    expect(
      broken,
      `${file} has links that go nowhere: ${broken.join(", ")}\n` +
        `Link targets resolve relative to the file that contains them; ` +
        `a "#anchor" must match a heading in the same file.\n` +
        `This file's headings produce: ${[...anchors].join(", ")}`,
    ).toEqual([]);
  });

  it.each(files)("%s names only make targets that still exist", (file) => {
    const body = readFileSync(join(projectRoot, file), "utf8");
    const targets = makefileTargets(projectRoot);
    const missing = citedMakeTargets(body).filter((t) => !targets.has(t));

    expect(
      missing,
      `${file} tells the reader to run make targets the Makefile does not define: ` +
        `${missing.join(", ")}\nRename the citation or restore the target.`,
    ).toEqual([]);
  });

  it("keeps no KNOWN_ABSENT exception the prose has stopped needing", () => {
    const stale = KNOWN_ABSENT.filter((e) => {
      const abs = join(projectRoot, e.file);
      if (!existsSync(abs)) return true;
      return !citedPaths(readFileSync(abs, "utf8")).includes(e.path);
    });

    expect(
      stale.map((e) => `${e.file} -> ${e.path}`),
      `these KNOWN_ABSENT entries no longer match anything cited, so they are now ` +
        `blanket exemptions nobody can see: ${stale.map((e) => `${e.file} -> ${e.path}`).join(", ")}\n` +
        `Delete them from ${relative(projectRoot, fileURLToPath(import.meta.url))}.`,
    ).toEqual([]);
  });
});

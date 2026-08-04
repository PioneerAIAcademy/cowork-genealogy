import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  citedMakeTargets,
  citedPaths,
  citedSlashCommands,
  headingAnchors,
  makefileTargets,
  markdownLinkTargets,
  pathResolves,
} from "./repo-paths.js";

/**
 * Staleness lint for the process doc and the Claude Code tooling under
 * `.claude/`.
 *
 * `adr-links.test.ts` does this for ADRs; this is the same check pointed at the
 * surfaces that had nothing linting them. The reason is on the record: three
 * subagents under `.claude/agents/` were deleted on 2026-08-02 (issue #1161)
 * because their paths rotted silently after `packages/engine/` was introduced,
 * and nothing noticed. `.claude/skills/` is in scope for the same reason — its
 * six skills cite eval paths heavily, and eval paths move. Both it and
 * `docs/task-lifecycle.md` are read *while someone is working*, so a wrong
 * pointer is a wrong answer someone acts on.
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

/**
 * Claude Code subagents, slash commands, and project skills. Every `.md` at or
 * below each is linted — `.claude/skills/` nests one level
 * (`<skill>/SKILL.md`), so the walk recurses.
 */
const LINTED_DIRS = [".claude/agents", ".claude/commands", ".claude/skills"];

/**
 * A cited path the lint cannot resolve *and should not*: either it is named
 * because it is gone, or it never exists on disk at rest. Each is listed by
 * name with its reason rather than inferred from the surrounding sentence, and
 * an entry that stops firing fails the suite below — so this list cannot
 * quietly become a blanket exemption nobody can see.
 *
 * **An invented name in a worked example does not belong here.** Write it as a
 * `<slug>` placeholder instead: the glob resolves, the example stops naming a
 * fixture that does not exist, and no entry is needed. That is what the
 * `interpret-e2e-result` example does.
 */
const KNOWN_ABSENT: { file: string; path: string; why: string }[] = [
  {
    file: ".claude/skills/author-e2e-fixture/SKILL.md",
    path: "eval/e2e-project/<slug>/",
    why: "created at runtime by `make e2e-project`; gitignored, so it is absent at rest",
  },
  {
    file: ".claude/skills/mine-unit-test/SKILL.md",
    path: "eval/e2e-project/<slug>/",
    why: "created at runtime by `make e2e-project`; gitignored, so it is absent at rest",
  },
];

/**
 * Slash commands that ship with Claude Code, so no file in this repo defines
 * them. Listed by name with a reason, the same shape as `KNOWN_ABSENT` — a
 * regex escape hatch here would exempt the repo's own commands too, which are
 * the ones that rot.
 */
const BUILT_INS: Record<string, string> = {
  "code-review": "ships with Claude Code; step 6 of docs/task-lifecycle.md",
  review: "ships with Claude Code; used when reviewing someone else's PR",
  "security-review": "ships with Claude Code; step 5 of docs/task-lifecycle.md",
  rewind: "ships with Claude Code; named in step 6's warning about --fix",
};

/**
 * Tokens shaped like a slash command (`/word`) that are not one — an absolute
 * filesystem path (`/tmp`, `/etc`), a REST route (`/search`), a directory-tree
 * line in a fenced example. `citedSlashCommands` cannot tell these apart from a
 * real command by syntax alone (`/search` vs `/research`), so without this a
 * doc that shows one in a code span or fenced block would fail the lint below
 * claiming a broken command, and the only escapes would be to misuse BUILT_INS
 * or reword the doc. Listed by name with a reason, the same shape and
 * self-cleaning guarantee as BUILT_INS/KNOWN_ABSENT — an entry the prose stops
 * naming fails the suite below, so this cannot quietly widen into a regex
 * escape hatch that would also swallow the repo's own rotting commands.
 */
const KNOWN_NON_COMMANDS: Record<string, string> = {};

/**
 * Where a repo-defined slash command's body lives. A command resolves if any
 * root has it: `.claude/commands/` and `.claude/skills/` are this repo's own
 * Claude Code tooling, and `packages/engine/plugin/skills/` is the shipped
 * Cowork plugin, whose skills the `.claude/` tooling legitimately names
 * (`/research` in author-e2e-fixture).
 */
const COMMAND_ROOTS = [
  (name: string) => `.claude/commands/${name}.md`,
  (name: string) => `.claude/skills/${name}/SKILL.md`,
  (name: string) => `packages/engine/plugin/skills/${name}/SKILL.md`,
];

/**
 * Own-property membership. `name in obj` walks the prototype chain, so a cited
 * `/constructor`, `/tostring`, or `/valueof` would match an inherited
 * Object.prototype key and be silently treated as exempt — defeating the very
 * staleness check this file exists to run.
 */
const has = (obj: Record<string, string>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(obj, key);

function slashCommandResolves(name: string): boolean {
  if (has(BUILT_INS, name)) return true;
  return COMMAND_ROOTS.some((root) => existsSync(join(projectRoot, root(name))));
}

function walkMarkdown(dir: string, out: string[]): void {
  for (const entry of readdirSync(join(projectRoot, dir)).sort()) {
    const rel = `${dir}/${entry}`;
    if (statSync(join(projectRoot, rel)).isDirectory()) walkMarkdown(rel, out);
    else if (entry.endsWith(".md")) out.push(rel);
  }
}

function lintedFiles(): string[] {
  const files = [...LINTED_DOCS];
  for (const dir of LINTED_DIRS) {
    if (!existsSync(join(projectRoot, dir))) continue;
    walkMarkdown(dir, files);
  }
  return files;
}

function isExempt(file: string, path: string): boolean {
  return KNOWN_ABSENT.some((e) => e.file === file && e.path === path);
}

describe("doc and .claude/ tooling links", () => {
  const files = lintedFiles();
  // Parsed once for the suite — the Makefile is identical across every linted
  // file, so re-reading it inside the per-file it.each below was redundant work
  // that grew linearly with LINTED_DIRS.
  const makeTargets = makefileTargets(projectRoot);
  // Every slash command the corpus cites — the input both exemption-staleness
  // guards below filter against. Built once, not per guard.
  const citedCommands = new Set(
    files.flatMap((f) => citedSlashCommands(readFileSync(join(projectRoot, f), "utf8"))),
  );

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
    const missing = citedMakeTargets(body).filter((t) => !makeTargets.has(t));

    expect(
      missing,
      `${file} tells the reader to run make targets the Makefile does not define: ` +
        `${missing.join(", ")}\nRename the citation or restore the target.`,
    ).toEqual([]);
  });

  it.each(files)("%s names only slash commands that still exist", (file) => {
    const body = readFileSync(join(projectRoot, file), "utf8");
    const missing = citedSlashCommands(body).filter(
      (c) => !slashCommandResolves(c) && !has(KNOWN_NON_COMMANDS, c),
    );

    expect(
      missing,
      `${file} tells the reader to run slash commands that resolve to nothing: ` +
        `${missing.map((c) => `/${c}`).join(", ")}\n` +
        `A repo command is .claude/commands/<name>.md, .claude/skills/<name>/SKILL.md, ` +
        `or packages/engine/plugin/skills/<name>/SKILL.md. If it ships with Claude Code, ` +
        `add it to BUILT_INS in this test with the reason. If it is not a command at all ` +
        `(a filesystem path, a REST route), add it to KNOWN_NON_COMMANDS with the reason.`,
    ).toEqual([]);
  });

  it.each([
    ["BUILT_INS", BUILT_INS],
    ["KNOWN_NON_COMMANDS", KNOWN_NON_COMMANDS],
  ] as const)("keeps no %s entry the prose has stopped naming", (label, map) => {
    const stale = Object.keys(map).filter((name) => !citedCommands.has(name));

    expect(
      stale.map((c) => `/${c}`),
      `these ${label} entries are no longer cited anywhere, so they are exemptions ` +
        `nobody can see: ${stale.map((c) => `/${c}`).join(", ")}\n` +
        `Delete them from ${relative(projectRoot, fileURLToPath(import.meta.url))}.`,
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

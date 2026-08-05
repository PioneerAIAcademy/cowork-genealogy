import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  citedLineNumbers,
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
 * `/constructor` would match an inherited Object.prototype key and be silently
 * treated as exempt — defeating the very staleness check this file exists to
 * run. `constructor` is the only reachable one: `citedSlashCommands` extracts
 * with a lowercase-only pattern, and every other Object.prototype key
 * (`toString`, `valueOf`, `hasOwnProperty`) is camelCase.
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
  // Every slash command the corpus cites — the input the BUILT_INS staleness
  // guard below filters against. Built once, alongside the Makefile parse.
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
    const missing = citedSlashCommands(body).filter((c) => !slashCommandResolves(c));

    expect(
      missing,
      `${file} tells the reader to run slash commands that resolve to nothing: ` +
        `${missing.map((c) => `/${c}`).join(", ")}\n` +
        `A repo command is .claude/commands/<name>.md, .claude/skills/<name>/SKILL.md, ` +
        `or packages/engine/plugin/skills/<name>/SKILL.md. If it ships with Claude Code, ` +
        `add it to BUILT_INS in this test with the reason.`,
    ).toEqual([]);
  });

  it("keeps no BUILT_INS entry the prose has stopped naming", () => {
    const stale = Object.keys(BUILT_INS).filter((name) => !citedCommands.has(name));

    expect(
      stale.map((c) => `/${c}`),
      `these BUILT_INS entries are no longer cited anywhere, so they are exemptions ` +
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

/**
 * Source citations that pin a line number, as they stood on 2026-08-04. Frozen
 * so the ban below blocks *new* ones without demanding a 56-site sweep in the
 * same PR that introduces the rule.
 *
 * These are not benign. Of three sampled in `research-append-tool-spec.md`,
 * three already pointed at the wrong code — `validator.ts:417` is cited as the
 * `exhaustive_declaration` coupling check and is the `stop_criteria` shape
 * allow-list. Until each is converted to a symbol reference, this list is the
 * honest record of what is known-wrong-shaped.
 *
 * `docs/plan/` is excluded from the walk entirely, not listed here: a plan is
 * deleted when its work ships, so a cite inside one cannot outlive its subject.
 *
 * Removing a cite from a doc without removing it here fails the drift check
 * below, so this list cannot quietly outlive the sweep that empties it.
 */
const GRANDFATHERED_LINE_CITES: Record<string, string[]> = {
  "docs/adrs/ADR-0008-sync-schema-copies-eliminate-generate-or-lint.md": [
    "packages/schema/src/index.ts:269",
    "scripts/build-mcpb.mjs:26-27",
  ],
  "docs/agentic-system-critique.md": [
    "allowed_tools.py:59",
    "allowed_tools.py:61-68",
    "allowed_tools.py:98-103",
    "harness/orchestrator.py:206",
    "real_agent.py:132-139",
    "research-append.ts:622",
    "research-query.ts:243-244",
    "research-query.ts:29",
    "skill_runner.py:57",
  ],
  "docs/architecture.md": [
    "apps/server/app/agent/real_agent.py:130",
    "eval/harness/e2e/orchestrator.py:175",
    "packages/engine/plugin/hooks/guard_project_files.py:36",
    "src/index.ts:736",
  ],
  "docs/realtime-architecture.md": [
    "apps/server/app/models.py:45",
    "local.py:195",
    "runner.py:65",
  ],
  "docs/record-search-compaction-scope.md": ["results-staging.ts:108-124"],
  "docs/specs/image-reader-opus-agent-spec.md": [
    "e2e/orchestrator.py:752",
    "index.ts:291-297",
    "subprocess_cli.py:30",
  ],
  "docs/specs/match-merge-workflow-spec.md": ["gedcomx.ts:161"],
  "docs/specs/merge-gedcomx-spec.md": [
    "packages/engine/mcp-server/src/types/gedcomx.ts:112",
    "packages/engine/mcp-server/src/types/gedcomx.ts:120",
    "packages/engine/mcp-server/src/types/gedcomx.ts:139",
  ],
  "docs/specs/rank-search-matches-tool-spec.md": [
    "relatives.ts:34",
    "results-staging.ts:108-114",
    "same-person.ts:199-206",
    "same-person.ts:22",
    "same-person.ts:67-91",
    "validator.ts:1100-1114",
  ],
  "docs/specs/research-append-tool-spec.md": [
    "validator.ts:417",
    "validator.ts:607",
    "validator.ts:637",
  ],
  "docs/specs/research-log-editor-spec.md": [
    "src/validation/validator.ts:431",
    "src/validation/validator.ts:953",
    "validator.ts:1012",
    "validator.ts:1022",
    "validator.ts:1024",
    "validator.ts:953",
  ],
  "docs/specs/same-person-match-relatives-spec.md": ["src/utils/mob.ts:299-336"],
  "docs/specs/search-result-staging-spec.md": [
    "src/tools/fulltext-search.ts:206",
    "src/tools/record-search.ts:511",
    "src/validation/validator.ts:1034",
    "src/validation/validator.ts:988",
  ],
  "docs/specs/tree-edit-tool-spec.md": [
    "src/types/gedcomx.ts:104",
    "tests/tools/tree-edit.test.ts:950",
  ],
  "docs/specs/tree-materialization-spec.md": ["merge-warnings.ts:64"],
  "docs/specs/validate-project-refactor-spec.md": [
    "packages/engine/mcp-server/src/validation/validator.ts:104",
    "src/tools/validate-research-schema.ts:20",
    "validator.ts:104",
    "validator.ts:236",
    "validator.ts:737",
    "validator.ts:988",
  ],
};

/** Every `.md` under `docs/`, except `docs/plan/` (see the note above). */
function docsMarkdown(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry === "plan") continue;
        walk(full);
      } else if (entry.endsWith(".md")) {
        out.push(relative(root, full));
      }
    }
  };
  walk(join(root, "docs"));
  return out.sort();
}

describe("docs/ cite symbols, not line numbers", () => {
  it("bans new source-line citations under docs/", () => {
    const offenders: string[] = [];
    for (const rel of docsMarkdown(projectRoot)) {
      const allowed = new Set(GRANDFATHERED_LINE_CITES[rel] ?? []);
      for (const cite of citedLineNumbers(readFileSync(join(projectRoot, rel), "utf8"))) {
        if (!allowed.has(cite)) offenders.push(`${rel} cites \`${cite}\``);
      }
    }
    expect(
      offenders,
      "A line number is a copy of state the file owns, and nothing keeps the copy " +
        "honest — 3 of 3 sampled cites in this repo already pointed at the wrong " +
        "code. Cite the symbol (`validateExhaustiveDeclaration`), not the line; " +
        "`citedPaths` already proves the file exists.",
    ).toEqual([]);
  });

  it("has no stale grandfathered entries", () => {
    const stale: string[] = [];
    for (const [rel, cites] of Object.entries(GRANDFATHERED_LINE_CITES)) {
      const full = join(projectRoot, rel);
      if (!existsSync(full)) {
        stale.push(`${rel} (file gone)`);
        continue;
      }
      const present = new Set(citedLineNumbers(readFileSync(full, "utf8")));
      for (const c of cites) {
        if (!present.has(c)) stale.push(`${rel} no longer cites \`${c}\``);
      }
    }
    expect(
      stale,
      "An exemption that stopped firing means the sweep reached it — delete the " +
        "entry so the list keeps shrinking instead of becoming a blanket nobody reads.",
    ).toEqual([]);
  });
});

/**
 * Repo issue references per contract document, as they stood on 2026-08-05.
 *
 * **A spec owns the contract; GitHub owns the status.** An `#1234` in a spec is
 * a copy of state that closes without telling anyone, and keeping the copy
 * honest is a standing edit tax nobody signed up for — `CLAUDE.md` had five
 * issue numbers in one sentence purely to explain which ticket carried which
 * half of a since-split piece of work, and that sentence had already been
 * rewritten once when one of them closed.
 *
 * The durable form is the **fact, not the ticket**: "all three copies stay and
 * nothing asserts they agree" survives forever; "tracked as #1129" does not.
 * If the conclusion is worth keeping, write it down — then the number adds
 * nothing. If it is not, the number does not save you.
 *
 * Exempt, deliberately:
 *  - **`owner/repo#N`** (`anthropics/claude-code#34573`). Evidence for a claim
 *    about someone else's software, not ours to close, and dropping it removes
 *    the reader's ability to check the claim.
 *  - **`docs/adrs/`**. An ADR is a dated decision record; "three subagents were
 *    deleted, issue #1161" stays true forever. History, not status.
 *  - **`docs/architecture.md` §9.4**. The one surface whose *job* is tracking
 *    what is unbuilt. It should stay the only one.
 *
 * A RATCHET, not a freeze: the count must match exactly, so removing a
 * reference fails until the number here comes down with it, and adding one
 * fails outright. Sweeping a file to zero deletes its entry.
 */
const ISSUE_REF_BASELINE: Record<string, number> = {
  "CLAUDE.md": 14,
  "docs/specs/e2e-test-spec.md": 17,
  "docs/specs/feedback-case-spec.md": 1,
  "docs/specs/gps-mentor-agent-spec.md": 1,
  "docs/specs/guardrail-enforcement-spec.md": 32,
  "docs/specs/hosted-web-workbench-spec.md": 4,
  "docs/specs/image-reader-agent-spec.md": 3,
  "docs/specs/image-reader-opus-agent-spec.md": 1,
  "docs/specs/match-merge-workflow-spec.md": 3,
  "docs/specs/merge-gedcomx-spec.md": 8,
  "docs/specs/place-search-tool-spec.md": 1,
  "docs/specs/record-search-tool-spec-v2.md": 3,
  "docs/specs/research-append-tool-spec.md": 2,
  "docs/specs/research-query-tool-spec.md": 5,
  "docs/specs/research-schema-spec.md": 1,
  "docs/specs/same-person-match-relatives-spec.md": 1,
  "docs/specs/sandbox-provider-spec.md": 1,
  "docs/specs/search-result-staging-spec.md": 1,
  "docs/specs/skill-rewrites-for-persistence-tools-spec.md": 2,
  "docs/specs/task-review-spec.md": 5,
  "docs/specs/tree-forget-tool-spec.md": 1,
  "docs/specs/tree-materialization-spec.md": 7,
  "docs/specs/unit-test-spec-v2.md": 1,
  "docs/specs/unit-test-spec.md": 7,
};

/** `#1234`, but not `owner/repo#1234` and not a `#anchor`. */
function repoIssueRefs(text: string): string[] {
  const upstreamStripped = text.replace(/[\w.-]+\/[\w.-]+#\d+/g, "");
  return [...upstreamStripped.matchAll(/(?<![\w&#/])#(\d{3,5})\b/g)].map((m) => m[0]);
}

describe("specs state the fact, not the ticket", () => {
  it("holds the issue-reference ratchet on contract docs", () => {
    const scanned = [
      ...docsMarkdown(projectRoot).filter((f) => f.startsWith("docs/specs/")),
      "README.md",
      "CLAUDE.md",
    ];
    const drift: string[] = [];
    for (const rel of scanned) {
      const full = join(projectRoot, rel);
      if (!existsSync(full)) continue;
      const actual = repoIssueRefs(readFileSync(full, "utf8")).length;
      const allowed = ISSUE_REF_BASELINE[rel] ?? 0;
      if (actual > allowed) {
        drift.push(
          `${rel}: ${actual} issue refs, baseline ${allowed} — state the fact, not the ticket`,
        );
      } else if (actual < allowed) {
        drift.push(`${rel}: down to ${actual} refs — lower its ISSUE_REF_BASELINE entry to ${actual}`);
      }
    }
    expect(drift, "docs/adrs/ and upstream `owner/repo#N` refs are exempt.").toEqual([]);
  });

  it("has no baseline entry for a file that is gone or already clean", () => {
    const stale = Object.keys(ISSUE_REF_BASELINE).filter(
      (rel) => !existsSync(join(projectRoot, rel)),
    );
    expect(stale, "delete the entry when its file goes").toEqual([]);
  });
});

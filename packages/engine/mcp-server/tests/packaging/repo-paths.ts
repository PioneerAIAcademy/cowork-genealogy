import { existsSync, readFileSync, readdirSync, statSync, type Dirent } from "node:fs";
import { join } from "node:path";

/**
 * Shared citation-resolving helpers for the doc-staleness lints in this
 * directory (`adr-links.test.ts`, `doc-links.test.ts`).
 *
 * The lints all answer one question — *does the thing this document names
 * still exist?* — over documents that are mostly prose. So the extraction rule
 * has to be conservative: a lint with false positives gets `skip`ped inside a
 * month, and a `skip`ped lint is worse than none because it still looks like
 * protection.
 *
 * **The rule for "this string is a repo path I should check":** it is inside a
 * single-backtick code span, it contains a `/`, and it starts with one of
 * `REPO_ROOTS`. Everything else is left alone. That deliberately excludes bare
 * filenames (`research.json`, `PLAN.md`), tool names (`record_search`),
 * flags (`-m 'not e2e'`), variables (`$ARGUMENTS`), home-relative paths
 * (`~/feedback/<slug>/`), and paths written relative to somewhere other than
 * the repo root (`dev/try-login.ts`) — none of which can be resolved without
 * guessing, and guessing is what produces the false positive.
 *
 * Placeholders inside an otherwise-real path — `<skill>`, `$ARGUMENTS`,
 * `{N}`, `<tool>` — are not skipped, because skipping them would blind the
 * lint to exactly the parameterised paths the `.claude/` tooling is built from.
 * They are turned into `*` and globbed instead: the citation passes if at
 * least one real file or directory matches. So
 * `eval/tests/unit/<skill>/rubric.md` still catches a rename of
 * `eval/tests/unit/`, while tolerating that `<skill>` names no one directory.
 */

/** Top-level dirs a cited path may start with. */
export const REPO_ROOTS = [
  "docs/",
  "packages/",
  "apps/",
  "eval/",
  "scripts/",
  ".github/",
  ".claude/",
];

/** Backticked tokens that look like repo paths. */
export function citedPaths(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/`([^`\n]+)`/g)) {
    // First word only: a span is often a command with arguments
    // (`scripts/setup-feedback-case.sh <zip>`), and only the head is a path.
    // Known false negative: when the head is itself a command (`cd`, `npx`,
    // `make`), the whole span is dropped — including any repo path later in
    // it, e.g. `cd packages/engine/mcp-server && npx tsx dev/try-<tool>.ts`
    // contributes nothing.
    const token = m[1].trim().split(/\s+/)[0];
    if (!token.includes("/")) continue;
    if (!REPO_ROOTS.some((r) => token.startsWith(r))) continue;
    // Strip a trailing line/anchor reference: path.ts:123 or path.md#section
    found.add(token.replace(/[:#].*$/, ""));
  }
  return [...found];
}

/**
 * Backticked source citations that pin a LINE NUMBER — `validator.ts:417`,
 * `eval/harness/e2e/orchestrator.py:962-980`. Returns the full cited token.
 *
 * `citedPaths` above strips the `:NNN` and resolves the file, so a cite whose
 * line number has drifted still passes that lint while pointing at the wrong
 * code. That is not hypothetical: of three sampled in
 * `research-append-tool-spec.md`, three were already wrong — one claimed to be
 * the `exhaustive_declaration` coupling check and is the `stop_criteria` shape
 * allow-list. A line number is a copy of state whose owner is the file, and
 * nothing keeps the copy honest, so the style is banned rather than checked.
 * Cite the symbol instead; `citedPaths` already verifies the file exists.
 *
 * Deliberately narrow, same doctrine as the extractor above: source and
 * markdown files only (`.py`/`.ts`/`.mjs`/`.md`), inside a backtick span, line
 * number required. A `.md:NNN` cite rots the same way — a skill or spec is
 * edited far more often than it is renamed. A range may use a hyphen or an en
 * dash (`SKILL.md:98–110`), and the whole range is reported. A bare
 * `orchestrator.py` is fine, `docs/foo.md#section` is fine (an anchor moves
 * with its heading), and `9:30` or `1:1:QL69-GBJC` are not source cites.
 */
export function citedLineNumbers(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/`([^`\n]+)`/g)) {
    for (const t of m[1].matchAll(/[\w./-]+\.(?:py|ts|mjs|md):\d+(?:[-–]\d+)?/g)) {
      found.add(t[0]);
    }
  }
  return [...found];
}

/**
 * Placeholder spellings used across this repo's docs and `.claude/` prompts:
 * `<skill>`, `{N}`, `$ARGUMENTS`, `${VAR}`. Each stands for "one path segment
 * I cannot name here", so each becomes a `*`.
 */
const PLACEHOLDER = /<[^<>/]*>|\{[^{}/]*\}|\$\{[A-Za-z_][A-Za-z0-9_]*\}|\$[A-Za-z_][A-Za-z0-9_]*/g;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** A directory's entries, without following symlinks; empty when unreadable. */
function entriesOf(dir: string): Dirent[] {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/**
 * Directories a `**` may descend into. Symlinks are not followed, and
 * `node_modules` and dot-directories (`.venv`, `.next`) are skipped: a developer
 * checkout holds thousands of directories in them, so following them makes the
 * lint slow and its answer differ from CI's. A few tracked files do live in a
 * dot-directory (`packages/engine/plugin/.claude-plugin/plugin.json`), so a `**`
 * glob never matches them; cite such a file by its full path.
 */
function walkableDirs(dir: string): string[] {
  return entriesOf(dir)
    .filter((e) => e.isDirectory() && e.name !== "node_modules" && !e.name.startsWith("."))
    .map((e) => join(dir, e.name));
}

/**
 * Does at least one real file or directory match this glob? `*` matches within
 * one segment. `**` matches zero or more directories, so `eval/`, `**`,
 * `research.json` joined by slashes names a corpus rather than one file. A trailing `**` needs at least one entry under it, as
 * gitignore's `a/**` does, so it cannot pass on an empty directory.
 */
function globMatches(dir: string, segments: string[]): boolean {
  if (segments.length === 0) return true;
  const [segment, ...rest] = segments;

  if (segment === "**") {
    if (rest.length === 0) return entriesOf(dir).length > 0;
    if (globMatches(dir, rest)) return true;
    return walkableDirs(dir).some((sub) => globMatches(sub, segments));
  }

  const isLast = rest.length === 0;
  const fits = (child: string) => (isLast ? true : isDir(child)) && globMatches(child, rest);
  if (!segment.includes("*")) {
    const child = join(dir, segment);
    return existsSync(child) && fits(child);
  }
  const re = new RegExp(`^${segment.split("*").map(escapeRe).join("[^/]*")}$`);
  return entriesOf(dir).some((e) => re.test(e.name) && fits(join(dir, e.name)));
}

function globResolves(projectRoot: string, pattern: string): boolean {
  return globMatches(projectRoot, pattern.split("/").filter((s) => s.length > 0));
}

/** Does a cited repo path (possibly containing placeholders) still resolve? */
export function pathResolves(projectRoot: string, cited: string): boolean {
  // A run of placeholders fills one segment (`<a><b>`), so it becomes one `*`,
  // never a `**` globstar.
  const pattern = cited.replace(new RegExp(`(?:${PLACEHOLDER.source})+`, "g"), "*");
  if (!pattern.includes("*")) return existsSync(join(projectRoot, pattern));
  return globResolves(projectRoot, pattern);
}

/** Fenced ```code``` blocks, contents only. */
export function fencedBlocks(text: string): string[] {
  return [...text.matchAll(/^```[^\n]*\n([\s\S]*?)^```/gm)].map((m) => m[1]);
}

/** Markdown link destinations: the `target` of `[text](target)`. */
export function markdownLinkTargets(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/\[[^\]\n]*\]\(([^)\s]+)\)/g)) found.add(m[1]);
  return [...found];
}

/**
 * GitHub's heading-anchor slug (github-slugger, applied to the rendered text):
 * drop inline markup, lowercase, delete every character that is not a letter,
 * mark, number, connector (`_`), space or hyphen, then turn EACH space into a
 * hyphen. Spaces are not collapsed, so `Place → collection scope` becomes
 * `place--collection-scope`, and the result is not trimmed after the strip.
 * Underscores survive (`Places_Search_resource`) unless they are emphasis
 * delimiters outside a code span (`_word_`). Only used to check *same-file*
 * `#anchor` links, where both halves are computed from the same text.
 */
export function slugifyHeading(heading: string): string {
  const rendered = heading
    .trim()
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // [text](url) -> text
    .split(/(`[^`]*`)/)
    .map((part) =>
      part.startsWith("`")
        ? part.slice(1, -1)
        : part
            .replace(/[*~]/g, "")
            .replace(/(^|[^\p{L}\p{N}_])(_+)(?=\S)(.+?)(?<=\S)\2(?=[^\p{L}\p{N}_]|$)/gu, "$1$3"),
    )
    .join("");
  return rendered
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "")
    .replace(/ /g, "-");
}

/**
 * Anchors a reader could link to in this file, GitHub-style. A repeated
 * heading gets `-1`, `-2`, ... in order, as GitHub renders it, so all six
 * `## If you're asked to…` sections in docs/architecture.md are linkable.
 */
export function headingAnchors(text: string): Set<string> {
  const outsideFences = text.replace(/^```[^\n]*\n[\s\S]*?^```/gm, "");
  const anchors = new Set<string>();
  const seen = new Map<string, number>();
  for (const m of outsideFences.matchAll(/^#{1,6}\s+(.+?)\s*$/gm)) {
    // A closing sequence (`## Title ##`) is not part of the heading text.
    const slug = slugifyHeading(m[1].replace(/\s+#+$/, ""));
    // github-slugger: count up from the slug's last suffix until the name is
    // unused, so `Foo`, `Foo 1`, `Foo` gives foo, foo-1, foo-2.
    let n = seen.get(slug) ?? 0;
    let anchor = n === 0 ? slug : `${slug}-${n}`;
    while (anchors.has(anchor)) anchor = `${slug}-${++n}`;
    seen.set(slug, n + 1);
    anchors.add(anchor);
  }
  return anchors;
}

/**
 * `make <target>` citations. Read only from code — inline spans and fenced
 * blocks — never from prose, because "make sure", "make the call", and "make
 * it fail" all parse as `make <target>` otherwise.
 *
 * A target may name a family with `*` after a literal prefix (`make e2e-*`);
 * `makeTargetResolves` reads that as a glob. A target that is only a
 * placeholder (`make <target>`) names no target and is not extracted.
 */
const MAKE_TARGET = String.raw`[A-Za-z0-9_.-]+(?:\*[A-Za-z0-9_.-]*)*`;

export function citedMakeTargets(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/`([^`\n]+)`/g)) {
    const inline = m[1].trim().match(new RegExp(`^make\\s+(${MAKE_TARGET})`));
    if (inline) found.add(inline[1]);
  }
  for (const block of fencedBlocks(text)) {
    for (const m of block.matchAll(new RegExp(`^[ \\t]*make\\s+(${MAKE_TARGET})`, "gm"))) found.add(m[1]);
  }
  return [...found];
}

/** Does a cited make target exist? A `*` matches one or more characters of one target name. */
export function makeTargetResolves(targets: Set<string>, cited: string): boolean {
  if (!cited.includes("*")) return targets.has(cited);
  const re = new RegExp(`^${cited.split("*").map(escapeRe).join("[A-Za-z0-9_.-]+")}$`);
  return [...targets].some((t) => re.test(t));
}

/**
 * Slash-command citations: `/critique-plan`, `/code-review`. Read from code
 * only — inline spans and fenced blocks, the same rule as `citedMakeTargets`
 * — because prose is full of tokens that parse as one otherwise
 * (`annotations: complete/partial/absent`, `and/or`, a bare URL path).
 *
 * A command may carry arguments in the citation (`/critique-plan PLAN.md`,
 * `/review <N>`), so only the leading token is taken.
 */
export function citedSlashCommands(text: string): string[] {
  const found = new Set<string>();
  const add = (token: string) => {
    const m = token.match(/^\/([a-z][a-z0-9-]+)$/);
    if (m) found.add(m[1]);
  };
  for (const m of text.matchAll(/`([^`\n]+)`/g)) add(m[1].trim().split(/\s+/)[0]);
  for (const block of fencedBlocks(text)) {
    for (const line of block.split("\n")) {
      const first = line.trim().split(/\s+/)[0];
      if (first) add(first);
    }
  }
  return [...found];
}

/** Every target name the root Makefile defines, including `.PHONY` lists. */
export function makefileTargets(projectRoot: string): Set<string> {
  const text = readFileSync(join(projectRoot, "Makefile"), "utf8");
  const targets = new Set<string>();
  for (const m of text.matchAll(/^([A-Za-z0-9_.\-/ ]+):(?!=)/gm)) {
    for (const name of m[1].trim().split(/\s+/)) targets.add(name);
  }
  for (const m of text.matchAll(/^\.PHONY:\s*(.+)$/gm)) {
    for (const name of m[1].trim().split(/\s+/)) targets.add(name);
  }
  return targets;
}

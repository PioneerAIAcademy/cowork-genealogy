import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
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
    const token = m[1].trim().split(/\s+/)[0];
    if (!token.includes("/")) continue;
    if (!REPO_ROOTS.some((r) => token.startsWith(r))) continue;
    // Strip a trailing line/anchor reference: path.ts:123 or path.md#section
    found.add(token.replace(/[:#].*$/, ""));
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

/** Does at least one real file or directory match this single-`*` glob? */
function globResolves(projectRoot: string, pattern: string): boolean {
  const segments = pattern.split("/").filter((s) => s.length > 0);
  let candidates = [projectRoot];

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const next: string[] = [];

    for (const dir of candidates) {
      if (!segment.includes("*")) {
        const child = join(dir, segment);
        if (existsSync(child)) next.push(child);
        continue;
      }
      const re = new RegExp(`^${segment.split("*").map(escapeRe).join("[^/]*")}$`);
      let entries: string[];
      try {
        entries = readdirSync(dir);
      } catch {
        continue;
      }
      for (const entry of entries) if (re.test(entry)) next.push(join(dir, entry));
    }

    if (next.length === 0) return false;
    candidates = i === segments.length - 1 ? next : next.filter(isDir);
  }

  return candidates.length > 0;
}

/** Does a cited repo path (possibly containing placeholders) still resolve? */
export function pathResolves(projectRoot: string, cited: string): boolean {
  const pattern = cited.replace(PLACEHOLDER, "*");
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
 * GitHub's heading-anchor slug: drop inline markup and punctuation, lowercase,
 * spaces to hyphens. Only used to check *same-file* `#anchor` links, where both
 * halves are computed from the same text.
 */
export function slugifyHeading(heading: string): string {
  return heading
    .trim()
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // [text](url) -> text
    .replace(/[`*_~]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N} -]/gu, "")
    .trim()
    .replace(/\s+/g, "-");
}

/** Anchors a reader could link to in this file, GitHub-style. */
export function headingAnchors(text: string): Set<string> {
  const outsideFences = text.replace(/^```[^\n]*\n[\s\S]*?^```/gm, "");
  const anchors = new Set<string>();
  for (const m of outsideFences.matchAll(/^#{1,6}\s+(.+?)\s*$/gm)) {
    anchors.add(slugifyHeading(m[1]));
  }
  return anchors;
}

/**
 * `make <target>` citations. Read only from code — inline spans and fenced
 * blocks — never from prose, because "make sure", "make the call", and "make
 * it fail" all parse as `make <target>` otherwise.
 */
export function citedMakeTargets(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/`([^`\n]+)`/g)) {
    const inline = m[1].trim().match(/^make\s+([A-Za-z0-9_.-]+)/);
    if (inline) found.add(inline[1]);
  }
  for (const block of fencedBlocks(text)) {
    for (const m of block.matchAll(/^[ \t]*make\s+([A-Za-z0-9_.-]+)/gm)) found.add(m[1]);
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

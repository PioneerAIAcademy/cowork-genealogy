/**
 * YAML frontmatter block-sequence parsing, shared by the two packaging lints
 * that read a plugin agent's `tools:` or a skill's `allowed-tools:`.
 *
 * It lives here rather than in either test because a bug in it empties BOTH
 * guards at once and neither would say so: `agent-tool-names.test.ts` asserts
 * spellings over the entries it parses, and `ownership-manifest.test.ts` asserts
 * that every writer-tool holder is declared in the ownership manifest. Read
 * nothing and both report a clean pass. That shared failure mode is what makes
 * one copy right and two wrong.
 */

/**
 * Parse a named block-sequence out of YAML frontmatter.
 *
 * Four shapes cost a naive scan the grants it is meant to read. The first two
 * are live in the tree today; the last two are not yet, and are handled because
 * both callers fail OPEN on them:
 *
 *  - **Comment lines inside the list.** `record-extractor.md` carries a 10-line
 *    `#` comment block between `tools:` and its first entry. A scan that stops
 *    at the first line which is not `- …` reads zero grants for that agent.
 *  - **A later top-level key.** Several skills put `description:` *after*
 *    `allowed-tools:`, so the list has to end at the next unindented key — but
 *    an unindented comment is not one.
 *  - **A trailing comment on an entry.** `- mcp__genealogy__tree_forget  # …`
 *    must yield the tool name, not the name with the comment glued to it. A
 *    mangled entry matches no tool, so the ownership guard stops seeing the
 *    grant and passes — and on a SKILL.md nothing else reads `allowed-tools:`,
 *    so nothing else would catch it. Comments inside these lists are already
 *    house style (see the first shape), which is what makes this reachable.
 *  - **A quoted scalar.** `- "tree_forget"` must yield `tree_forget`. Kept
 *    quoted, it matches no tool and fails open exactly as the trailing comment
 *    does. Only one matching outer pair is stripped: an unpaired quote, or one
 *    inside the entry (`Bash(echo "x")`), belongs to the entry.
 *
 * Returns the entries in file order; `[]` when the key is absent. Throws when
 * there is no frontmatter at all, which is a malformed file rather than an
 * empty list.
 */
export function extractList(text: string, key: string): string[] {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!frontmatter) throw new Error("no YAML frontmatter");

  const lines = frontmatter[1].split(/\r?\n/);
  const start = lines.findIndex((l) => new RegExp(`^${key}:`).test(l));
  if (start === -1) return [];

  const items: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\S/.test(lines[i]) && !/^\s*#/.test(lines[i])) break; // next top-level key
    const item = /^\s*-\s+(.+?)(?:\s+#.*)?\s*$/.exec(lines[i]);
    if (item) items.push(item[1].replace(/^(["'])(.*)\1$/, "$2"));
  }
  return items;
}

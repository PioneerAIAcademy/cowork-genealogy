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
 *    does. A quoted scalar is read as a unit, so a ` #` inside the quotes is
 *    part of the value (`"foo #bar"` → `foo #bar`) and `''` in a single-quoted
 *    one is an escaped quote. Only a complete matching pair counts: an
 *    unpaired quote, or one inside a plain entry (`Bash(echo "x")`), belongs to
 *    the entry. A PLAIN scalar still ends at ` #` wherever it falls — that is
 *    YAML's own rule, so `Bash(echo "a #b")` really is `Bash(echo "a`.
 *
 * Returns the entries in file order; `[]` when the key is absent. Throws when
 * there is no frontmatter at all, which is a malformed file rather than an
 * empty list.
 */
export function extractList(text: string, key: string): string[] {
  const frontmatter = frontmatterBlock(text);
  if (frontmatter === null) throw new Error("no YAML frontmatter");

  const lines = frontmatter.split(/\r?\n/);
  const start = lines.findIndex((l) => new RegExp(`^${key}:`).test(l));
  if (start === -1) return [];

  // A value on the key line itself: a flow sequence `[a, "b"]`, or the
  // comma-separated form Claude Code documents for a subagent's `tools:`
  // (`tools: Read, Grep`). Read as empty, either one silently drops every grant.
  const inline = stripComment(lines[start].slice(key.length + 1).trim());
  if (inline !== "") {
    const flow = /^\[(.*)\]$/.exec(inline);
    return (flow ? flow[1] : inline)
      .split(",")
      .map((s) => unquote(s.trim()))
      .filter((s) => s !== "");
  }

  const items: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    // The next top-level key ends the list. An unindented `- ` does not: YAML
    // allows a block sequence at its key's own indent.
    if (/^\S/.test(lines[i]) && !/^#/.test(lines[i]) && !/^-\s/.test(lines[i])) break;
    const quoted = QUOTED_ENTRY.exec(lines[i]);
    if (quoted) {
      items.push(quoted[1] ?? quoted[2].replace(/''/g, "'"));
      continue;
    }
    const plain = PLAIN_ENTRY.exec(lines[i]);
    if (plain) items.push(plain[1]);
  }
  return items;
}

/** A value with its trailing ` # comment` removed, unless the `#` is quoted. */
function stripComment(value: string): string {
  if (/^["'\[]/.test(value)) return value.replace(/\s+#[^"'\]]*$/, "").trim();
  return value.replace(/\s+#.*$/, "").trim();
}

/** One matching pair of outer quotes removed; anything else returned as is. */
function unquote(s: string): string {
  const d = /^"([^"]*)"$/.exec(s);
  if (d) return d[1];
  const q = /^'((?:[^']|'')*)'$/.exec(s);
  return q ? q[1].replace(/''/g, "'") : s;
}

/** A `- "…"` or `- '…'` entry, then an optional ` # comment`. */
const QUOTED_ENTRY = /^\s*-\s+(?:"([^"]*)"|'((?:[^']|'')*)')(?:\s+#.*)?\s*$/;

/** A plain `- …` entry; the value ends at the first ` #`. */
const PLAIN_ENTRY = /^\s*-\s+(.+?)(?:\s+#.*)?\s*$/;

/**
 * The text between a file's opening `---` and closing `---`, or `null` when
 * it has none. The one copy of this regex: every packaging lint that reads
 * frontmatter goes through it, so a fix here (a BOM, trailing spaces after
 * `---`) reaches all of them at once.
 */
export function frontmatterBlock(text: string): string | null {
  return /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? null;
}

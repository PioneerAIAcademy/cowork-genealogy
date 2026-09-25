/**
 * YAML frontmatter parsing, shared by the packaging lints that read a plugin
 * agent's `tools:`, a skill's `allowed-tools:`, and an agent's `name:`.
 *
 * It lives here rather than in either test because a bug in it empties BOTH
 * guards at once and neither would say so: `agent-tool-names.test.ts` asserts
 * spellings over the entries it parses, and `ownership-manifest.test.ts` asserts
 * that every writer-tool holder is declared in the ownership manifest. Read
 * nothing and both report a clean pass. That shared failure mode is what makes
 * one copy right and two wrong.
 */

/**
 * Parse a named sequence out of YAML frontmatter text.
 *
 * Every shape below cost an earlier scan the grants it is meant to read. Only
 * the first two are live in the tree today; the rest are handled because both
 * callers fail OPEN on a grant they cannot read:
 *
 *  - **Comment lines inside the list.** `record-extractor.md` carries a 10-line
 *    `#` comment block between `tools:` and its first entry.
 *  - **A later top-level key.** Several skills put `description:` *after*
 *    `allowed-tools:`, so the list ends at the next unindented key — but an
 *    unindented comment is not one, and nor is an unindented `- `: YAML allows a
 *    block sequence at its key's own indent.
 *  - **A trailing comment on an entry.** `- mcp__genealogy__tree_forget  # …`
 *    yields the tool name, not the name with the comment glued to it.
 *  - **A quoted scalar.** `- "tree_forget"` yields `tree_forget`, read as a
 *    unit: a ` #` inside the quotes is part of the value, `''` in a
 *    single-quoted one is an escaped quote, and a comment after the closing
 *    quote may contain anything. Only a complete matching pair counts — an
 *    unpaired quote, or one inside a plain entry (`Bash(echo "x")`), belongs to
 *    the entry. A PLAIN block entry still ends at ` #` wherever it falls, which
 *    is YAML's own rule: `- Bash(echo "a #b")` really is `Bash(echo "a`.
 *  - **A null entry.** `- # note` is an entry with no value; it is skipped,
 *    never returned as the string `# note`.
 *  - **A value on the key line.** A flow sequence `tools: [a, "b"]  # c`, or the
 *    comma form Claude Code documents for a subagent (`tools: Read, Grep`).
 *    Both are split on commas OUTSIDE quotes, and a trailing comment is found
 *    outside quotes and brackets, so `[a, b] # don't drop` and
 *    `a, "Bash(x, y)"` read as two entries each. An unterminated flow sequence
 *    throws rather than returning a mangled entry nothing would match.
 *
 * Returns the entries in file order; `[]` when the key is absent. Throws when
 * there is no frontmatter at all, which is a malformed file rather than an
 * empty list.
 */
export function extractList(text: string, key: string): string[] {
  const block = frontmatterBlock(text);
  if (block === null) throw new Error("no YAML frontmatter");
  return listFromBlock(block, key);
}

/** `extractList` over an already-extracted frontmatter block. */
export function listFromBlock(block: string, key: string): string[] {
  const lines = block.split(/\r?\n/);
  const start = lines.findIndex((l) => new RegExp(`^${key}:`).test(l));
  if (start === -1) return [];

  const inline = lines[start].slice(key.length + 1).trim();
  if (inline !== "" && !inline.startsWith("#")) return inlineItems(inline);

  const items: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\S/.test(lines[i]) && !/^#/.test(lines[i]) && !/^-(\s|$)/.test(lines[i])) break;
    const entry = /^\s*-(?:\s+(.*))?$/.exec(lines[i]);
    if (!entry) continue;
    const value = readScalar((entry[1] ?? "").trim());
    if (value !== null) items.push(value);
  }
  return items;
}

/** A top-level scalar key's value — comment removed, quotes resolved — or null. */
export function scalarValue(block: string, key: string): string | null {
  const line = block.split(/\r?\n/).find((l) => new RegExp(`^${key}:`).test(l));
  return line === undefined ? null : readScalar(line.slice(key.length + 1).trim());
}

/**
 * The text between a file's opening `---` and closing `---`, or `null` when
 * it has none. The one copy of this regex: every packaging lint that reads
 * frontmatter goes through it, so a fix here (a BOM, trailing spaces after
 * `---`) reaches all of them at once.
 */
export function frontmatterBlock(text: string): string | null {
  return /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? null;
}

/** Entries of a key-line value: a flow sequence, or the comma form. */
function inlineItems(value: string): string[] {
  let body: string;
  if (value.startsWith("[")) {
    const end = closingBracket(value);
    if (end === -1) throw new Error(`unterminated flow sequence: ${value}`);
    const rest = value.slice(end + 1);
    if (!isCommentOrEmpty(rest)) throw new Error(`text after a flow sequence: ${value}`);
    body = value.slice(1, end);
  } else {
    body = value.slice(0, commentStart(value));
  }
  return splitOutsideQuotes(body, ",")
    .map((s) => readScalar(s.trim()))
    .filter((s): s is string => s !== null && s !== "");
}

/**
 * One scalar: `null` for an empty or comment-only value, the resolved content
 * of a complete quoted scalar followed by nothing or a comment, and otherwise
 * a plain scalar cut at its first ` #`.
 */
function readScalar(value: string): string | null {
  if (value === "" || value.startsWith("#")) return null;
  if (value[0] === '"' || value[0] === "'") {
    const end = closingQuote(value, 0);
    if (end !== -1 && isCommentOrEmpty(value.slice(end + 1))) {
      const inner = value.slice(1, end);
      return value[0] === "'"
        ? inner.replace(/''/g, "'")
        : inner.replace(/\\(["\\])/g, "$1");
    }
  }
  const cut = /\s#/.exec(value);
  return (cut ? value.slice(0, cut.index) : value).trim();
}

/** Index of the quote closing the one at `start`, or -1. */
function closingQuote(s: string, start: number): number {
  const q = s[start];
  for (let i = start + 1; i < s.length; i++) {
    if (q === '"' && s[i] === "\\") {
      i++;
      continue;
    }
    if (s[i] !== q) continue;
    if (q === "'" && s[i + 1] === "'") {
      i++;
      continue;
    }
    return i;
  }
  return -1;
}

/** Index of the `]` closing the `[` at 0, outside quotes, or -1. */
function closingBracket(s: string): number {
  for (let i = 1; i < s.length; i++) {
    if (s[i] === '"' || s[i] === "'") {
      const end = closingQuote(s, i);
      if (end === -1) return -1;
      i = end;
    } else if (s[i] === "]") {
      return i;
    }
  }
  return -1;
}

/** Where a ` #` comment starts outside quotes, or the string's length. */
function commentStart(s: string): number {
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '"' || s[i] === "'") {
      const end = closingQuote(s, i);
      if (end === -1) break;
      i = end;
    } else if (s[i] === "#" && (i === 0 || /\s/.test(s[i - 1]))) {
      return i;
    }
  }
  return s.length;
}

function isCommentOrEmpty(rest: string): boolean {
  return rest.trim() === "" || /^\s+#/.test(rest);
}

/** Split on `sep` wherever it falls outside a quoted run. */
function splitOutsideQuotes(s: string, sep: string): string[] {
  const out: string[] = [];
  let from = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '"' || s[i] === "'") {
      const end = closingQuote(s, i);
      if (end !== -1) i = end;
    } else if (s[i] === sep) {
      out.push(s.slice(from, i));
      from = i + 1;
    }
  }
  out.push(s.slice(from));
  return out;
}

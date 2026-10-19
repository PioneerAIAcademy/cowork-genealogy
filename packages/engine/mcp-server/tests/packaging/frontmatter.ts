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
 *
 * The block is parsed by a real YAML parser (`yaml`, a devDependency), the same
 * reading the Python side gets from `yaml.safe_load`. A hand-rolled subset
 * parser was tried first and failed open on one more shape each review round —
 * a trailing comment, a quoted scalar, a flow sequence, a block scalar — and
 * every shape it missed dropped a grant from both guards silently. Malformed
 * YAML throws here, which is a malformed file, never an empty list.
 */
import { parse } from "yaml";

/**
 * Parse a named tool list out of a file's YAML frontmatter.
 *
 * Returns the entries in file order; `[]` when the key is absent or null.
 * Throws when there is no frontmatter at all, when the frontmatter is not valid
 * YAML, and when the key holds something that is neither a list nor a string.
 */
export function extractList(text: string, key: string): string[] {
  const block = frontmatterBlock(text);
  if (block === null) throw new Error("no YAML frontmatter");
  return listFromBlock(block, key);
}

/**
 * `extractList` over an already-extracted frontmatter block.
 *
 * A YAML sequence yields its string items (null items skipped). A string value
 * is the key-line form Claude Code also accepts — `tools: Read, Grep` for a
 * subagent, and the space-delimited `allowed-tools: Read Grep` the Agent Skills
 * standard documents — and is split on commas and whitespace outside
 * parentheses and quotes, so `Bash(npm run test:*)` stays one entry. A block
 * scalar (`tools: |`) reads the same way, as the string it is.
 */
export function listFromBlock(block: string, key: string): string[] {
  const value = parseFrontmatter(block)[key];
  if (value === undefined || value === null) return [];
  if (typeof value === "string") return splitToolString(value);
  if (!Array.isArray(value)) {
    throw new Error(`${key}: expected a list or a string, got ${typeof value}`);
  }
  const items: string[] = [];
  for (const item of value) {
    if (item === null) continue;
    if (typeof item !== "string") {
      throw new Error(`${key}: expected every entry to be a string, got ${JSON.stringify(item)}`);
    }
    const trimmed = item.trim();
    if (trimmed !== "") items.push(trimmed);
  }
  return items;
}

/** A top-level scalar key's value as a string, or null when absent or null. */
export function scalarValue(block: string, key: string): string | null {
  const value = parseFrontmatter(block)[key];
  if (value === undefined || value === null) return null;
  return typeof value === "string" ? value : String(value);
}

/**
 * The frontmatter block as a mapping. `{}` for an empty block; throws on
 * invalid YAML or on a block that parses to something other than a mapping.
 */
export function parseFrontmatter(block: string): Record<string, unknown> {
  const doc: unknown = parse(block);
  if (doc === null || doc === undefined) return {};
  if (typeof doc !== "object" || Array.isArray(doc)) {
    throw new Error("frontmatter is not a YAML mapping");
  }
  return doc as Record<string, unknown>;
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

/**
 * Split a string tool list on commas and whitespace that fall outside
 * parentheses and quotes; a token wrapped in a matching pair of quotes is
 * unquoted.
 */
function splitToolString(value: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let depth = 0;
  let quote: string | null = null;
  for (const ch of value) {
    if (quote !== null) {
      current += ch;
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      current += ch;
      quote = ch;
    } else if (ch === "(") {
      depth++;
      current += ch;
    } else if (ch === ")") {
      depth = Math.max(0, depth - 1);
      current += ch;
    } else if (depth === 0 && (ch === "," || /\s/.test(ch))) {
      if (current !== "") tokens.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current !== "") tokens.push(current);
  return tokens.map((t) =>
    t.length >= 2 && (t[0] === '"' || t[0] === "'") && t[t.length - 1] === t[0] ? t.slice(1, -1) : t,
  );
}

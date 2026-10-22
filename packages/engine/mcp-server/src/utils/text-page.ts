// Paging for a long text answer. `sidecar_read` and the two wiki tools cut a text into
// parts that a caller walks with `offset` / `nextOffset`.
//
// The bound that matters is on the SERIALIZED answer, not on the raw text: the server
// JSON.stringifies a result, which escapes every `"`, `\` and control character, and
// Claude Code saves any tool result over 50,000 characters to a file that an agent
// without Bash cannot read back. So a part is shrunk until its JSON-escaped body fits the
// caller's cap (docs/specs/sidecar-read-tool-spec.md §4), and a markdown part is then
// moved back to a heading or a line boundary (docs/specs/wiki-page-tool-spec.md,
// "Pagination").

/** Reject-not-coerce, the same posture as research_query's `offset`: a stringified "50"
 *  reaches the tool as a string (the `wiki_read`, `wiki_place_page` and `sidecar_read` arms
 *  of src/server.ts pass arguments through untouched) and would otherwise be silently
 *  coerced by `slice`. */
export function requireWholeNumber(name: string, value: unknown, min: number): number {
  if (!Number.isInteger(value) || (value as number) < min) {
    const got =
      typeof value === "number" && !Number.isFinite(value) ? String(value) : JSON.stringify(value);
    throw new Error(
      `${name} must be a whole number ≥ ${min} (got ${got}). Send it as a number, not a string.`,
    );
  }
  return value as number;
}

/**
 * The page after the serialized-envelope shrink and the surrogate step. Exported so a
 * test can pin the bound on the function itself as well as on the wrapped envelope.
 * Invariant: for `offset < text.length` the page is never empty, so `nextOffset` always
 * advances and a caller paging "until truncated is false" terminates.
 */
export function fitPage(text: string, offset: number, maxChars: number): string {
  let page = text.slice(offset, offset + maxChars);
  // The bound is on the ESCAPED BODY — JSON.stringify's two wrapping quotes excluded —
  // so a plain-text page is exactly maxChars, and it is the caller's `maxChars`, not a
  // fixed constant: two callers cap differently. A raw character serializes to between
  // 1 (plain) and 6 (`\u0001`) characters, so cutting `ceil(over / 6)` always makes
  // progress; with a 40,000 cap that also kept the page from ever cutting to nothing
  // (one character always fits). A smaller cap breaks that, since a lone surrogate or
  // control character escapes to 6 and so does not fit a `maxChars` under 6: the page is
  // never cut below one unit, which is what keeps `nextOffset` advancing.
  for (;;) {
    const over = JSON.stringify(page).length - 2 - maxChars;
    if (over <= 0 || page.length <= 1) break;
    page = page.slice(0, Math.max(1, page.length - Math.max(1, Math.ceil(over / 6))));
  }
  // Never split a surrogate PAIR across two pages: when the page ends on a high
  // surrogate and the very next unit of the text is its low surrogate, move the
  // boundary. Backwards by one unit normally; forwards by one unit when the page is that
  // single high surrogate (maxChars: 1, or an offset landing on the pair), because
  // backing off would leave an empty page with nextOffset === offset — a paging loop that
  // never terminates. A lone high surrogate with no low surrogate after it is not a pair
  // and stays put.
  const lastCode = page.charCodeAt(page.length - 1);
  const nextCode = text.charCodeAt(offset + page.length);
  if (isHighSurrogate(lastCode) && isLowSurrogate(nextCode)) {
    page = page.length > 1 ? page.slice(0, -1) : text.slice(offset, offset + 2);
  }
  return page;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/**
 * Move the end of a page back to where a reader would want it: the start of a heading
 * line, else the end of a line. `page` is `fitPage`'s page for `offset`.
 *
 *  1. The last line that starts with `#` and starts past the page's midpoint: the page
 *     ends just before its `#`. A page that already ends where a heading line starts is
 *     left as it is, which is the same rule with the page's own end as a candidate.
 *  2. Otherwise the last `\n` past the midpoint: the page ends just after it.
 *  3. Otherwise the page is left as `fitPage` cut it.
 *
 * Neither rule alone is enough. A page with one heading and one 46,000-character table
 * row has no heading past the midpoint and no line break either, so it keeps the
 * mid-line cut. The last page of a text is never cut back, and a cut only ever moves
 * toward the start, so the page stays inside its cap, is never empty (a cut is past the
 * midpoint) and never splits a surrogate pair (it falls beside a `\n` or a `#`).
 */
export function cutAtBoundary(text: string, offset: number, page: string): string {
  const end = offset + page.length;
  if (end >= text.length) return page;
  const midpoint = page.length / 2;
  // Rule 1. The last "\n#" that starts at or before `end - 1` has its `#` at `end` or earlier, so
  // `cut` is where the last heading line starts, counted from the page's start; `cut` equal to
  // the page's length is a page that already ends at one. A "\n#" before the page gives a `cut`
  // of 0 or less, which is never past the midpoint.
  const cut = text.lastIndexOf("\n#", end - 1) + 1 - offset;
  if (cut > midpoint) return page.slice(0, cut);
  // Rule 2.
  const lineBreak = page.lastIndexOf("\n");
  return lineBreak > midpoint ? page.slice(0, lineBreak + 1) : page;
}

export interface TextPaging {
  /** Length of the whole text in UTF-16 code units. */
  totalChars: number;
  /** Where this part starts (clamped to `totalChars`). */
  offset: number;
  /** `offset + content.length < totalChars`. */
  truncated: boolean;
  /** `offset + content.length`: present only when `truncated`. */
  nextOffset?: number;
}

/**
 * One part of `text`, starting at `offset` (a caller-validated whole number, or
 * undefined for the start), at most `maxChars` characters once JSON-escaped, cut at a
 * boundary. `paging` is present only when the call passed an `offset` or the part is
 * truncated, so a text that fits and was asked for from the start comes back as the
 * bare `content`, exactly as before paging existed.
 */
export function pageText(
  text: string,
  offset: number | undefined,
  maxChars: number,
): { content: string; paging?: TextPaging } {
  const totalChars = text.length;
  const start = Math.min(offset ?? 0, totalChars);
  const content = cutAtBoundary(text, start, fitPage(text, start, maxChars));
  const end = start + content.length;
  const truncated = end < totalChars;
  if (offset === undefined && !truncated) return { content };
  return {
    content,
    paging: { totalChars, offset: start, truncated, ...(truncated ? { nextOffset: end } : {}) },
  };
}

// The wiki's navigation sidebar, removed from the page text `wiki_read` and `wiki_place_page`
// return (docs/specs/wiki-page-tool-spec.md, "The sidebar"). Most wiki pages carry it: a
// one-column table under an empty header, whose row naming `<place> Wiki Topics` heads rows of
// links to the place's topic pages. The same box repeats on every page of a country or state,
// so it costs an agent thousands of characters a page and says nothing about the page itself.

/** The words every spelling of the sidebar's row carries. */
const SIDEBAR_ROW_WORDS = "Wiki Topics";

const isTableLine = (line: string): boolean => line.startsWith("|");

/**
 * `text` without its sidebar tables.
 *
 * A sidebar row is a line that starts with `|` and contains `Wiki Topics`. The wiki spells the
 * row several ways (`[X Wiki Topics](url)`, `**X Wiki Topics**`, `[**X Wiki Topics**](url)`,
 * `**[X Wiki Topics](url "X Genealogy")**`), so the rule matches the words, never a spelling.
 * The table is the run of consecutive lines that start with `|` around that row: up through the
 * empty header and the separator above it, down to its last row. The run goes, and so does the
 * blank line after it, so the text on either side joins as it did around the table. Every such
 * table goes, wherever it sits on the page. Anything else, other tables included, stays, and a
 * text with no sidebar row comes back as the same string.
 */
export function stripWikiSidebar(text: string): string {
  if (!text.includes(SIDEBAR_ROW_WORDS)) return text;
  const lines = text.split("\n");
  const dropped = new Set<number>();
  for (let i = 0; i < lines.length; i++) {
    if (dropped.has(i) || !isTableLine(lines[i]) || !lines[i].includes(SIDEBAR_ROW_WORDS)) continue;
    let first = i;
    while (first > 0 && isTableLine(lines[first - 1])) first--;
    let last = i;
    while (last + 1 < lines.length && isTableLine(lines[last + 1])) last++;
    if (last + 1 < lines.length && lines[last + 1].trim() === "") last++;
    for (let j = first; j <= last; j++) dropped.add(j);
  }
  if (dropped.size === 0) return text;
  return lines.filter((_, i) => !dropped.has(i)).join("\n");
}

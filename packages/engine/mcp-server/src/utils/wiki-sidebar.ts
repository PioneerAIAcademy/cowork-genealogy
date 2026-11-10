// The wiki's navigation sidebar, removed from the page text `wiki_read` and `wiki_place_page`
// return. The rule, and the shapes it was checked on: docs/specs/wiki-page-tool-spec.md, "The sidebar".

/** The words every spelling of the sidebar's row carries. */
const SIDEBAR_ROW_WORDS = "Wiki Topics";

/** A markdown table's separator row, in any number of columns: `| --- |`, `| --- | --- |`. */
const SEPARATOR_ROW = /^\|(\s*:?-{3,}:?\s*\|)+\s*$/;

const isTableLine = (line: string): boolean => line.startsWith("|");

/**
 * `text` without its sidebar tables, each with the blank line after it.
 *
 * A table is a run of consecutive lines that start with `|`. It is the sidebar when one of its
 * lines contains `Wiki Topics` (the words, never one spelling of them) and it is one table, with
 * a single separator row. A run holding two tables, one touching the box with no blank line
 * between them, is left whole: keeping a box costs characters, cutting a table loses content.
 * Everything else comes back as it was.
 */
export function stripWikiSidebar(text: string): string {
  if (!text.includes(SIDEBAR_ROW_WORDS)) return text;
  const lines = text.split("\n");
  const kept: string[] = [];
  let i = 0;
  while (i < lines.length) {
    if (!isTableLine(lines[i])) {
      kept.push(lines[i++]);
      continue;
    }
    let end = i + 1;
    while (end < lines.length && isTableLine(lines[end])) end++;
    const table = lines.slice(i, end);
    const isSidebar =
      table.some((line) => line.includes(SIDEBAR_ROW_WORDS)) &&
      table.filter((line) => SEPARATOR_ROW.test(line)).length === 1;
    // Row by row: spreading a table's rows into one push overflows the stack past ~10^5 rows.
    if (!isSidebar) for (const line of table) kept.push(line);
    else if (end < lines.length && lines[end].trim() === "") end++;
    i = end;
  }
  return kept.join("\n");
}

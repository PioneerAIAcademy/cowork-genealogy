import { describe, expect, it } from "vitest";
import { stripWikiSidebar } from "../../src/utils/wiki-sidebar.js";
import { SHAPES } from "../helpers/wiki-pages.js";
import {
  ARGENTINA,
  ARGENTINA_SIDEBAR,
  ARGENTINA_STRIPPED,
  ARGENTINA_TABLE,
  ENGLAND_HEAD,
  ENGLAND_POPULATION_TABLE,
  ENGLAND_ROW,
  ENGLAND_SIDEBAR,
  ENGLAND_STRIPPED,
  SASKATCHEWAN_HEAD,
  SASKATCHEWAN_SIDEBAR,
  SASKATCHEWAN_STRIPPED,
  linesIn,
  linesOf,
  without,
} from "../helpers/wiki-sidebar-pages.js";

/** `text` with line `n` replaced by `line`. */
function withLine(text: string, n: number, line: string): string {
  const lines = linesOf(text);
  lines[n] = line;
  return lines.join("\n");
}

const ENGLAND_BOX = linesIn(ENGLAND_HEAD, ENGLAND_SIDEBAR);
const POPULATION_TABLE = linesIn(ENGLAND_HEAD, ENGLAND_POPULATION_TABLE);

describe("the copied pages are the shapes these tests rely on", () => {
  it("England_Census: a one-column sidebar, a blank line, and the population table under it", () => {
    const lines = linesOf(ENGLAND_HEAD);
    const [start, end] = ENGLAND_SIDEBAR;
    expect(lines.slice(start, start + 2)).toEqual(["|  |", "| --- |"]);
    expect(lines[ENGLAND_ROW]).toContain("England Wiki Topics");
    expect(lines[end - 1].startsWith("|")).toBe(true);
    expect(lines[end]).toBe("");
    const [table] = ENGLAND_POPULATION_TABLE;
    expect(lines.slice(table, table + 3)).toEqual(["|  |", "| --- |", "|  |"]);
    expect(lines[table + 3]).toContain("Historical Populations");
    expect(lines[ENGLAND_POPULATION_TABLE[1]]).toBe("");
    expect(lines).toHaveLength(ENGLAND_POPULATION_TABLE[1] + 1);
  });

  it("Argentina: a data table, a blank line, the sidebar, a blank line, then text", () => {
    const lines = linesOf(ARGENTINA);
    expect(lines[ARGENTINA_TABLE[0]].startsWith("|")).toBe(true);
    expect(lines[ARGENTINA_TABLE[1]]).toBe("");
    const [start, end] = ARGENTINA_SIDEBAR;
    expect(lines.slice(start, start + 2)).toEqual(["|  |", "| --- |"]);
    expect(lines[start + 2]).toContain("Argentina Wiki Topics");
    expect(lines[end]).toBe("");
    expect(lines[end + 1]).toMatch(/^This website requires a paid subscription/);
  });

  it("Saskatchewan: a two-column sidebar, a blank line, then text", () => {
    const lines = linesOf(SASKATCHEWAN_HEAD);
    const [start, end] = SASKATCHEWAN_SIDEBAR;
    expect(lines.slice(start, start + 2)).toEqual(["|  |  |", "| --- | --- |"]);
    expect(lines[start + 2]).toContain("Saskatchewan Wiki Topics");
    expect(lines[end - 1].startsWith("|")).toBe(true);
    expect(lines[end]).toBe("");
    expect(lines[end + 1]).toMatch(/^Guide to \*\*Saskatchewan/);
  });
});

describe("stripWikiSidebar", () => {
  it("removes England_Census's sidebar from its empty header down, with the blank line after it", () => {
    const out = stripWikiSidebar(ENGLAND_HEAD);
    expect(out).toBe(ENGLAND_STRIPPED);
    expect(out).not.toContain("Wiki Topics");
    // The page's title and the blank lines under it are untouched.
    expect(out.startsWith("# England Census\n\n\n\n[England](")).toBe(true);
  });

  it("keeps England_Census's population table, which opens with the same empty header and sits before the first ##", () => {
    // The real page's next lines: the blank line this copy ends on, then the first `##` heading.
    // Cutting everything above that heading would cut the table too.
    const out = stripWikiSidebar(`${ENGLAND_HEAD}\n## Resources\n`);
    expect(out).toBe(`${ENGLAND_STRIPPED}\n## Resources\n`);
    expect(out).toContain(POPULATION_TABLE);
    expect(out).toContain("| 1801 | 8,305,362 | — |");
  });

  // The row is spelled at least four ways on the wiki. The real table stays around it; only
  // the row line is swapped.
  const ROW_SPELLINGS: Array<[string, string]> = [
    ["a link", "[England Wiki Topics](https://www.familysearch.org/en/wiki/England_Genealogy)"],
    ["bold", "**England Wiki Topics**"],
    ["a link around bold", '[**England Wiki Topics**](https://www.familysearch.org/en/wiki/England_Genealogy "England Genealogy")'],
    ["bold around a titled link", '**[England Wiki Topics](https://www.familysearch.org/en/wiki/England_Genealogy "England Genealogy")**'],
  ];
  it.each(ROW_SPELLINGS)("removes the table when the row is %s", (_label, row) => {
    expect(stripWikiSidebar(withLine(ENGLAND_HEAD, ENGLAND_ROW, `| ${row} |`))).toBe(ENGLAND_STRIPPED);
  });

  it("removes a two-column sidebar and keeps the text under it", () => {
    const out = stripWikiSidebar(SASKATCHEWAN_HEAD);
    expect(out).toBe(SASKATCHEWAN_STRIPPED);
    expect(out).not.toContain("Wiki Topics");
    expect(out).toContain("\n\nGuide to **Saskatchewan");
    expect(out.endsWith("## Saskatchewan Information\n")).toBe(true);
  });

  it("removes a sidebar lower on the page and keeps the table above it and the text below it", () => {
    const out = stripWikiSidebar(ARGENTINA);
    expect(out).toBe(ARGENTINA_STRIPPED);
    expect(out).toContain(linesIn(ARGENTINA, ARGENTINA_TABLE));
    const lines = linesOf(ARGENTINA);
    expect(out).toContain(`${lines[ARGENTINA_TABLE[1] - 1]}\n\n${lines[ARGENTINA_SIDEBAR[1] + 1]}`);
  });

  it("removes every sidebar on the page, not just the first", () => {
    const out = stripWikiSidebar(`${ENGLAND_HEAD}\n${ARGENTINA}`);
    expect(out).toBe(`${ENGLAND_STRIPPED}\n${ARGENTINA_STRIPPED}`);
    expect(out).not.toContain("Wiki Topics");
  });

  it("removes a sidebar that ends the text, with or without a line break after it", () => {
    expect(stripWikiSidebar(`# A page\n\nSome text.\n\n${ENGLAND_BOX}`)).toBe("# A page\n\nSome text.\n");
    expect(stripWikiSidebar(`# A page\n\nSome text.\n\n${ENGLAND_BOX}\n`)).toBe("# A page\n\nSome text.\n");
  });

  it("removes a sidebar that opens the text", () => {
    expect(stripWikiSidebar(`${ENGLAND_BOX}\n\n# A page\n`)).toBe("# A page\n");
  });

  it("keeps a table of any length after the box, without running out of stack", () => {
    // 200,000 rows: more lines than one call can take as arguments.
    const table = `| Value |\n| --- |\n${"| row |\n".repeat(200_000)}`;
    expect(stripWikiSidebar(`${ENGLAND_BOX}\n\n${table}`)).toBe(table);
  });

  describe("leaves the box alone when a content table touches it, so the table is never cut with it", () => {
    it("a table directly above it: Argentina without the blank line between its collections and the box", () => {
      const page = without(ARGENTINA, [ARGENTINA_TABLE[1], ARGENTINA_TABLE[1] + 1]);
      expect(stripWikiSidebar(page)).toBe(page);
    });

    it("a table directly under it: England's box with the population table straight after", () => {
      const page = `${ENGLAND_BOX}\n${POPULATION_TABLE}\n`;
      expect(stripWikiSidebar(page)).toBe(page);
    });
  });

  describe("a page with no sidebar comes back as it was", () => {
    it.each(SHAPES)("the generated page of %s", (_label, make) => {
      const page = make();
      expect(stripWikiSidebar(page)).toBe(page);
    });

    it("England_Census with its sidebar already gone", () => {
      expect(stripWikiSidebar(ENGLAND_STRIPPED)).toBe(ENGLAND_STRIPPED);
    });

    it("a page that names the Wiki Topics box in prose, outside any table", () => {
      const page = `# A page\n\nThe England Wiki Topics box links the country's pages.\n\n${ENGLAND_STRIPPED}`;
      expect(stripWikiSidebar(page)).toBe(page);
    });

    it("the empty page", () => {
      expect(stripWikiSidebar("")).toBe("");
    });
  });
});

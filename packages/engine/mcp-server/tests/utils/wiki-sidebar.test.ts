import { describe, expect, it } from "vitest";
import { stripWikiSidebar } from "../../src/utils/wiki-sidebar.js";
import { SHAPES } from "../helpers/wiki-pages.js";
import {
  ARGENTINA,
  ARGENTINA_STRIPPED,
  ENGLAND_HEAD,
  ENGLAND_STRIPPED,
  linesOf,
} from "../helpers/wiki-sidebar-pages.js";

/** `text` with line `n` replaced by `line`. */
function withLine(text: string, n: number, line: string): string {
  const lines = linesOf(text);
  lines[n] = line;
  return lines.join("\n");
}

describe("the copied pages are the shapes these tests rely on", () => {
  it("England_Census: the sidebar's two header lines, its row, and the population table under it", () => {
    const lines = linesOf(ENGLAND_HEAD);
    expect(lines.slice(4, 6)).toEqual(["|  |", "| --- |"]);
    expect(lines[6]).toContain("England Wiki Topics");
    expect(lines[19].startsWith("|")).toBe(true);
    expect(lines[20]).toBe("");
    expect(lines.slice(27, 30)).toEqual(["|  |", "| --- |", "|  |"]);
    expect(lines[30]).toContain("Historical Populations");
    expect(lines[46]).toBe("");
  });

  it("Argentina: a data table above, the sidebar below it, text after", () => {
    const lines = linesOf(ARGENTINA);
    expect(lines[8].startsWith("|")).toBe(true);
    expect(lines[12]).toBe("");
    expect(lines.slice(13, 15)).toEqual(["|  |", "| --- |"]);
    expect(lines[15]).toContain("Argentina Wiki Topics");
    expect(lines[29]).toBe("");
    expect(lines[30]).toMatch(/^This website requires a paid subscription/);
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
    // Line 47 of the real page, the first `##` heading: cutting everything above it would also cut the table.
    const page = `${ENGLAND_HEAD}## Resources\n`;
    const table = linesOf(ENGLAND_HEAD).slice(27, 46).join("\n");
    const out = stripWikiSidebar(page);
    expect(out).toBe(`${ENGLAND_STRIPPED}## Resources\n`);
    expect(out).toContain(table);
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
    const page = withLine(ENGLAND_HEAD, 6, `| ${row} |`);
    expect(stripWikiSidebar(page)).toBe(ENGLAND_STRIPPED);
  });

  it("removes a sidebar lower on the page and keeps the table above it and the text below it", () => {
    const out = stripWikiSidebar(ARGENTINA);
    expect(out).toBe(ARGENTINA_STRIPPED);
    const kept = linesOf(ARGENTINA);
    expect(out).toContain(kept.slice(8, 12).join("\n"));
    expect(out).toContain(`${kept[11]}\n\n${kept[30]}`);
  });

  it("removes every sidebar on the page, not just the first", () => {
    const out = stripWikiSidebar(`${ENGLAND_HEAD}\n${ARGENTINA}`);
    expect(out).toBe(`${ENGLAND_STRIPPED}\n${ARGENTINA_STRIPPED}`);
    expect(out).not.toContain("Wiki Topics");
  });

  it("removes a sidebar that ends the text, with or without a line break after it", () => {
    const table = linesOf(ENGLAND_HEAD).slice(4, 20).join("\n");
    expect(stripWikiSidebar(`# A page\n\nSome text.\n\n${table}`)).toBe("# A page\n\nSome text.\n");
    expect(stripWikiSidebar(`# A page\n\nSome text.\n\n${table}\n`)).toBe("# A page\n\nSome text.\n");
  });

  it("removes a sidebar that opens the text", () => {
    const table = linesOf(ENGLAND_HEAD).slice(4, 20).join("\n");
    expect(stripWikiSidebar(`${table}\n\n# A page\n`)).toBe("# A page\n");
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

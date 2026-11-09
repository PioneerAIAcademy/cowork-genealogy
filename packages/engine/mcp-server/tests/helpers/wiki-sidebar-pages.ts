/**
 * Real wiki pages for the sidebar tests, copied byte for byte from
 * `GET {DEFAULT_WIKI_API_URL}/page/<slug>` on 2026-11-09 into `tests/fixtures/wiki/`. A copy, not
 * a live fetch, so the expected text does not move when the wiki is edited; a real page, not a
 * generated one, so the rule is tested on the wiki's own tables. Each line range below is named
 * once, `[start, end)` like `slice`; the shape test in `tests/utils/wiki-sidebar.test.ts` pins them.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { headingPage } from "./wiki-pages.js";

const fixture = (name: string): string =>
  readFileSync(join(import.meta.dirname, "../fixtures/wiki", name), "utf-8");

export const linesOf = (text: string): string[] => text.split("\n");

/** Lines `[start, end)` of `text`, joined back. */
export const linesIn = (text: string, [start, end]: readonly [number, number]): string =>
  linesOf(text).slice(start, end).join("\n");

/** `text` without lines `[start, end)`. */
export function without(text: string, [start, end]: readonly [number, number]): string {
  const lines = linesOf(text);
  return [...lines.slice(0, start), ...lines.slice(end)].join("\n");
}

/**
 * England_Census lines 0–46: a one-column sidebar (empty header, separator, then the
 * `England Wiki Topics` row) and the blank line after it, then the population table, which opens
 * with the same empty header and must stay. On the real page the first `##` heading follows the
 * blank line that ends this copy.
 */
export const ENGLAND_HEAD = fixture("england-census-head.md");
export const ENGLAND_SIDEBAR: readonly [number, number] = [4, 20];
export const ENGLAND_ROW = 6;
export const ENGLAND_POPULATION_TABLE: readonly [number, number] = [27, 46];

/** Each page as the tools must serve it: the sidebar gone, and the one blank line after it. */
export const ENGLAND_STRIPPED = without(ENGLAND_HEAD, [ENGLAND_SIDEBAR[0], ENGLAND_SIDEBAR[1] + 1]);

/** Argentina_Online_Genealogy_Records, whole: a data table, a blank line, then the sidebar lower down,
 *  with a blank line and text after it. */
export const ARGENTINA = fixture("argentina-online-genealogy-records.md");
export const ARGENTINA_TABLE: readonly [number, number] = [8, 12];
export const ARGENTINA_SIDEBAR: readonly [number, number] = [13, 29];
export const ARGENTINA_STRIPPED = without(ARGENTINA, [ARGENTINA_SIDEBAR[0], ARGENTINA_SIDEBAR[1] + 1]);

/** Saskatchewan,_Canada_Genealogy lines 0–25: a two-column sidebar (`|  |  |`, `| --- | --- |`). */
export const SASKATCHEWAN_HEAD = fixture("saskatchewan-head.md");
export const SASKATCHEWAN_SIDEBAR: readonly [number, number] = [8, 22];
export const SASKATCHEWAN_STRIPPED = without(SASKATCHEWAN_HEAD, [SASKATCHEWAN_SIDEBAR[0], SASKATCHEWAN_SIDEBAR[1] + 1]);

/** A page long enough to be cut into parts, opening with England's sidebar, and the same page without it. */
export const LONG_PAGE = ENGLAND_HEAD + headingPage();
export const LONG_PAGE_STRIPPED = ENGLAND_STRIPPED + headingPage();

/**
 * Two real wiki pages for the sidebar tests, copied byte for byte from
 * `GET {DEFAULT_WIKI_API_URL}/page/<slug>` on 2026-11-09 into `tests/fixtures/wiki/`. A copy, not
 * a live fetch, so the expected text does not move when the wiki is edited; a real page, not a
 * generated one, so the rule is tested on the wiki's own table.
 *
 * - `england-census-head.md`: England_Census lines 0–46. The sidebar is lines 4–19 (`|  |`,
 *   `| --- |`, then the `England Wiki Topics` row) and line 20 is the blank line after it. The
 *   population table, lines 27–45, opens with the same empty header and must stay.
 * - `argentina-online-genealogy-records.md`: the whole page. A data table sits at lines 8–11,
 *   and the sidebar comes after it, at lines 13–28, with a blank line at 29.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const fixture = (name: string): string =>
  readFileSync(join(import.meta.dirname, "../fixtures/wiki", name), "utf-8");

export const ENGLAND_HEAD = fixture("england-census-head.md");
export const ARGENTINA = fixture("argentina-online-genealogy-records.md");

export const linesOf = (text: string): string[] => text.split("\n");

/** `text` without its lines `from` to `to`, both included, counted from 0. */
export function without(text: string, from: number, to: number): string {
  const lines = linesOf(text);
  return [...lines.slice(0, from), ...lines.slice(to + 1)].join("\n");
}

/** Each page as the tools must serve it: the sidebar and the blank line after it gone. */
export const ENGLAND_STRIPPED = without(ENGLAND_HEAD, 4, 20);
export const ARGENTINA_STRIPPED = without(ARGENTINA, 13, 29);

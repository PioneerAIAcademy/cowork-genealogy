import { TOOL_RESULT_CHAR_BUDGET } from "../constants.js";

export interface WikiReadInput {
  url: string;
  /** UTF-16 code-unit offset of the first character to return. Default 0. */
  offset?: number;
}

export interface WikiPageResult {
  url: string;
  content: string;
  /** The four members below are present only when the page came back in parts or the
   *  call passed `offset`; a page that fits, asked for from the start, carries none of
   *  them. docs/specs/wiki-page-tool-spec.md, "Pagination". */
  totalChars?: number;
  offset?: number;
  truncated?: boolean;
  /** Present only when `truncated`. */
  nextOffset?: number;
}

/** The most one part of a page may hold: the JSON-escaped body of `content`, in
 *  characters. It is the shared `TOOL_RESULT_CHAR_BUDGET`, used by `wiki_read` and
 *  `wiki_place_page`. */
export const WIKI_PAGE_MAX_CHARS = TOOL_RESULT_CHAR_BUDGET;

/** What both wiki page tools say about paging in their description. The continuation
 *  sentence is the one thing an agent needs; agent bodies do not repeat it. It carries no
 *  figure: a tool description describes the behaviour, and the cap lives in
 *  `WIKI_PAGE_MAX_CHARS` and the spec (`measured-figures.test.ts` holds descriptions to it). */
export const WIKI_PAGING_NOTE =
  "A long page comes back in parts, cut at a heading or line break where it can; the " +
  "result then carries `totalChars`, `offset`, `truncated` and `nextOffset`, and when " +
  "`truncated` is true, call again with `offset: nextOffset` until it is false. A page " +
  "that fits is returned whole.";

/** The `offset` input of both wiki page tools: the same name, unit (UTF-16 code units) and
 *  validation as `sidecar_read`'s. `research_query`'s `offset` shares the name and the
 *  reject-not-coerce check but counts matches, not characters. */
export const WIKI_OFFSET_PROPERTY = {
  type: "number",
  description:
    "0-based character offset to start reading from. Default 0. When a result says " +
    "`truncated: true`, pass its `nextOffset` here to read the next part. Must be a " +
    "non-negative whole number.",
};

// Hand-maintained copy of the `locality_page_section` closed enum, kept as a
// literal tuple so `WikiPageSection` stays a literal union (the engine is
// outside the pnpm workspace and cannot import the generated one, and
// VALIDATOR_ENUMS' Set<string> cannot yield one). Bound to the validator's set
// by tests/tools/wiki-place-page.test.ts.
export const WIKI_PAGE_SECTIONS = [
  "home",
  "getting_started",
  "online_records",
  "research_tips",
] as const;

export type WikiPageSection = (typeof WIKI_PAGE_SECTIONS)[number];

export interface WikiPlacePageInput {
  standardPlace: string;
  section: WikiPageSection;
  /** UTF-16 code-unit offset of the first character to return. Default 0. */
  offset?: number;
}

export interface WikiPlacePageResult extends WikiPageResult {
  standardPlace: string;
  placeName: string;
}

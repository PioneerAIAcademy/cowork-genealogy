export interface WikiReadInput {
  url: string;
}

export interface WikiPageResult {
  url: string;
  content: string;
}

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
}

export interface WikiPlacePageResult extends WikiPageResult {
  standardPlace: string;
  placeName: string;
}

export interface WikiReadInput {
  url: string;
}

export interface WikiPageResult {
  url: string;
  content: string;
}

export type WikiPageSection =
  | "home"
  | "getting_started"
  | "online_records"
  | "research_tips";

export interface WikiPlacePageInput {
  standardPlace: string;
  section: WikiPageSection;
}

export interface WikiPlacePageResult extends WikiPageResult {
  standardPlace: string;
  placeName: string;
}

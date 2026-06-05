export interface WikiReadInput {
  url: string;
}

export interface WikiPageResult {
  url: string;
  content: string;
}

export interface WikiCountryInput {
  standardPlace: string;
}

export interface WikiCountryResult extends WikiPageResult {
  standardPlace: string;
  placeName: string;
}

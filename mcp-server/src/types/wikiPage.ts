export interface WikiFetchPageInput {
  url: string;
}

export interface WikiPageResult {
  url: string;
  content: string;
  cached: boolean;
}

export interface WikiCountryInput {
  placeRepId: string;
}

export interface WikiCountryResult extends WikiPageResult {
  placeRepId: string;
  placeName: string;
}

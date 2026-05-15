export interface WikiFetchPageInput {
  url: string;
}

export interface WikiPageResult {
  url: string;
  content: string;
}

export interface WikiCountryInput {
  placeId: string;
}

export interface WikiCountryResult extends WikiPageResult {
  placeId: string;
  placeName: string;
}

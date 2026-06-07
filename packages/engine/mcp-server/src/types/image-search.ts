// Types for the image_search tool.
//
// Given an imageGroupNumber, the tool resolves it to a group and returns
// all image IDs in that group. See docs/specs/image-search-tool-spec.md.

export interface ImageSearchInput {
  imageGroupNumber: string;
}

// children/names endpoint returns a flat object mapping apid → imageId.
export type ChildrenNamesResponse = Record<string, string>;

export interface ImageSearchResult {
  imageIds: string[];
}

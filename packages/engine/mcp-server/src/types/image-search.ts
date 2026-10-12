// Types for the image_search tool.
//
// Given an imageGroupNumber, the tool resolves it to a group and returns
// all image IDs in that group. With `item` (and optionally `itemImage`) on a
// bare film, it resolves one item of the film instead. See
// docs/specs/image-search-tool-spec.md.

export interface ImageSearchInput {
  imageGroupNumber: string;
  /** The film's `item`-th image group, counted among groups that hold images. */
  item?: number;
  /** With `item`: the image counted within that item, 1 = its first. */
  itemImage?: number;
}

// children/names endpoint returns a flat object mapping apid → imageId.
export type ChildrenNamesResponse = Record<string, string>;

export interface ImageSearchResult {
  imageIds: string[];
  /** With `item` only: the item's group, passable back to image_search. */
  imageGroupNumber?: string;
  /** With `item` only: FamilySearch's own name, or composed from the position. */
  imageGroupNumberFrom?: "name" | "position";
  /** With `item` only: the item's coverage place, null when unreadable. */
  place?: string | null;
  /** With `itemImage` only: the `itemImage`-th image of the item. */
  imageId?: string;
}

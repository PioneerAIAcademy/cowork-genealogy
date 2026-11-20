// Types for the image_search tool.
//
// Given an imageGroupNumber, the tool resolves it to a group and returns its
// image count and image-id ranges. With `item` (and optionally `itemImage`) on a
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

/** One unbroken run of image ids, both ends inclusive. A lone image is `[id, id]`. */
export type ImageIdRange = [firstId: string, lastId: string];

export interface ImageSearchResult {
  /** Every image in the group (or item), including any past a truncated range list. */
  imageCount: number;
  /** One pair per run of ids whose 5-digit suffix rises by 1, in id order. */
  imageIdRanges: ImageIdRange[];
  /** Present when runs past the 500th were left off. */
  truncated?: true;
  /** With `item` only: the item's group, passable back to image_search. */
  imageGroupNumber?: string;
  /** With `item` only: the item's coverage place, null when unreadable. */
  place?: string | null;
  /** With `itemImage` only: the `itemImage`-th image of the item. */
  imageId?: string;
}

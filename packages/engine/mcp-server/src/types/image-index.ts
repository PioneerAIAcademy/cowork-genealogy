// Types for the image_index tool: the records FamilySearch has indexed on one
// page image, with the personas and names on each. See
// docs/specs/image-index-tool-spec.md.

export interface ImageIndexInput {
  /** The page's document-image ARK in any form (`ark:/61903/3:1:...`, bare
   *  `3:1:...`, or a FamilySearch URL containing it). */
  imageId: string;
  /** FamilySearch's collection id, sent as `cc`. */
  collectionId?: string;
  /** The position in FamilySearch's record list to start reading from. */
  offset?: number;
}

export interface ImageIndexPersona {
  /** The persona's `ark:/61903/1:1:...`, from its Persistent identifier. */
  personaArk?: string;
  /** The indexed name as FamilySearch writes it out (`fullText`). */
  name?: string;
  /** GedcomX's `principal` flag on the persona. */
  principal: boolean;
  /** FamilySearch's `display.role` ("Principal", "Father", ...), when sent. */
  role?: string;
  /** The relationship-to-head index field, when the record carries one. */
  relationshipToHead?: string;
  /** FamilySearch's `FS_SORT_KEY` index field, when the record carries one.
   *  Passed through; not verified as the line order on the page. */
  sortKey?: string;
}

export interface ImageIndexEntry {
  /** Position in FamilySearch's list for the image, NOT a line on the page. */
  index: number;
  /** `ark:/61903/1:2:...`, from the list entry's record link. Absent when the
   *  link was not a FamilySearch record link. */
  recordArk?: string;
  /** The record was read and its personas are below. */
  hydrated: boolean;
  personas: ImageIndexPersona[];
  /** Why the record was not read, when `hydrated` is false. */
  error?: string;
}

export interface ImageIndexResult {
  imageArk: string;
  /** Present only when one was sent as `cc`. */
  collectionId?: string;
  /** How many records FamilySearch lists for the image. */
  total: number;
  offset: number;
  /** `entries.length`. */
  returned: number;
  entries: ImageIndexEntry[];
  /** Where the next call starts, present only when entries remain. */
  nextOffset?: number;
  /** Always false: the list's order is not verified as page order. */
  ordered: false;
  /** Some record in this call's window was still unread at the deadline. */
  hydrationTimedOut: boolean;
}

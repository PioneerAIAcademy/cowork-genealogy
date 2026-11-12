// What `record_search` adds to an answer to say how to search next: the census
// block and the note on a children search held to one collection or place.
//
// Every part is computed from the call's own arguments, so the tool and the eval
// mock run this one function and cannot disagree.

import { censusNote, type CensusNote, type CensusNoteInput } from "./census-note.js";

export interface ChildrenSearchNote {
  /** The arguments that hold the search to one source or place. */
  heldBy: string[];
  note: string;
}

export interface SearchAdvice {
  census?: CensusNote;
  childrenSearch?: ChildrenSearchNote;
}

/** The keys of `SearchAdvice`, in the order they are serialized before `results`. */
export const SEARCH_ADVICE_KEYS = ["childrenSearch", "census"] as const;

export type SearchAdviceInput = CensusNoteInput & Record<string, unknown>;

const EVENTS = ["birth", "death", "marriage", "residence", "any"] as const;
const PARENTS = ["father", "mother", "parent"] as const;

const text = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined);

function namesAny(input: SearchAdviceInput, roles: readonly string[]): boolean {
  return roles.some((r) => text(input[`${r}GivenName`]) !== undefined || text(input[`${r}Surname`]) !== undefined);
}

/**
 * The note on a search that names a parent and no child and is held to one
 * collection, batch or place, or `undefined`. It fires whatever the search
 * returned: the children it did not return are the ones filed elsewhere.
 */
export function childrenSearchNote(input: SearchAdviceInput): ChildrenSearchNote | undefined {
  if (!namesAny(input, PARENTS) || text(input.givenName) !== undefined) return undefined;
  const heldBy = [
    ...(["collectionId", "batchNumber"] as const).filter((k) => text(input[k]) !== undefined),
    ...EVENTS.map((e) => `${e}Place`).filter((k) => text(input[k]) !== undefined),
  ];
  if (heldBy.length === 0) return undefined;
  return {
    heldBy,
    note:
      "This search names a parent and no child, and is held to " +
      heldBy.map((k) => `\`${k}\``).join(", ") +
      ". A couple's children are indexed across collections and places. Before reporting their children, " +
      "send it once more with no `collectionId`, `batchNumber` or place, anchored on `recordCountry`.",
  };
}

/** Everything `record_search` adds to one answer; an empty object when nothing applies. */
export function searchAdvice(input: SearchAdviceInput): SearchAdvice {
  const advice: SearchAdvice = {};
  const children = childrenSearchNote(input);
  if (children) advice.childrenSearch = children;
  const census = censusNote(input);
  if (census) advice.census = census;
  return advice;
}

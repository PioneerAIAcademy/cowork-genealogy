// What `fulltext_search` adds to an answer to say how to search next: the note
// on a keywords search that found nothing, and the note on one that found more
// than can be read.
//
// Both are computed from the call's own arguments and the answer's total, so the
// tool and the eval mock run this one function and cannot disagree.

export interface FulltextAdvice {
  nameFieldRetry?: string;
  tooManyResults?: string;
}

/** The keys of `FulltextAdvice`, in the order they are serialized before `results`. */
export const FULLTEXT_ADVICE_KEYS = ["nameFieldRetry", "tooManyResults"] as const;

/** Above this total a keywords search is narrowed before it is triaged. */
export const TOO_MANY_RESULTS = 500;

export const NAME_FIELD_RETRY_NOTE =
  "This keywords search found nothing. The Name field searches a different index. If no earlier " +
  "search in this task found this person, and you have not yet sent the name in `name` (no `+`, " +
  "no place or year filters), send it once before reporting the person not found.";

export const TOO_MANY_RESULTS_NOTE =
  "More than 500 results. Do not add another `+required` term: it drops records that lack that " +
  "exact word. Add probable words without `+` (occupation, an associate's name, a place word) so " +
  "likely records rise to the top, or scope to one collection from an `includeFacets` response. " +
  "Probable words do not lower the total; once they are in, triage the top hits.";

/** Arguments that hold a search to part of the index. A nil under one of them
 *  is retried without it before the Name field is tried. */
const FILTERS = [
  "place",
  "collectionId",
  "imageGroupNumber",
  "yearFrom",
  "yearTo",
  "recordType",
  "recordPlace0",
  "recordPlace1",
  "recordPlace2",
  "recordPlace3",
] as const;

/** Sent, as `buildUrl` reads it: a non-blank string or a finite number. */
function sent(v: unknown): boolean {
  if (typeof v === "string") return v.trim() !== "";
  return typeof v === "number" && Number.isFinite(v);
}

/** Everything `fulltext_search` adds to one answer; an empty object when nothing applies. */
export function fulltextAdvice(input: Record<string, unknown>, totalResults: unknown): FulltextAdvice {
  const advice: FulltextAdvice = {};
  if (!sent(input.keywords) || sent(input.nlQuery)) return advice;
  if (typeof totalResults !== "number" || !Number.isFinite(totalResults)) return advice;

  if (totalResults === 0 && !sent(input.name) && !FILTERS.some((k) => sent(input[k]))) {
    advice.nameFieldRetry = NAME_FIELD_RETRY_NOTE;
  }
  const firstPage = !sent(input.offset) || input.offset === 0;
  if (totalResults > TOO_MANY_RESULTS && firstPage) {
    advice.tooManyResults = TOO_MANY_RESULTS_NOTE;
  }
  return advice;
}

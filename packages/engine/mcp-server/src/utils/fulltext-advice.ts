// What `fulltext_search` adds to an answer to say how to search next: the note
// on a keywords search that found nothing, the note on one that found more than
// can be read, and the note on a query spelled with a letter English does not use.
//
// All are computed from the call's own arguments and the answer's total, so the
// tool and the eval mock run this one function and cannot disagree.

export interface FulltextAdvice {
  nameFieldRetry?: string;
  tooManyResults?: string;
  wordListRead?: string;
}

/** The keys of `FulltextAdvice`, in the order they are serialized before `results`. */
export const FULLTEXT_ADVICE_KEYS = ["nameFieldRetry", "tooManyResults", "wordListRead"] as const;

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

export const WORD_LIST_READ_NOTE =
  "This query has a letter English does not use, so the records are probably not in English. If " +
  "you have not yet read that language's `{Language}_Genealogical_Word_List` wiki page with " +
  "`wiki_read` in this task, read it before you report. Transcripts carry the abbreviations and " +
  "spellings it lists: check your search terms against them, search any that would change the " +
  "query, and say in your report which you checked.";

/** A letter outside ASCII: an accented vowel, ñ, ß, a non-Latin script. */
const NON_ENGLISH_LETTER = /[^\u0000-\u007f]/u;

function hasNonEnglishLetter(v: unknown): boolean {
  if (typeof v !== "string") return false;
  return [...v].some((ch) => NON_ENGLISH_LETTER.test(ch) && /\p{L}/u.test(ch));
}

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
  if (sent(input.nlQuery)) return advice;
  const firstPage = !sent(input.offset) || input.offset === 0;
  const wordList =
    firstPage && (hasNonEnglishLetter(input.keywords) || hasNonEnglishLetter(input.name));

  if (sent(input.keywords) && typeof totalResults === "number" && Number.isFinite(totalResults)) {
    if (totalResults === 0 && !sent(input.name) && !FILTERS.some((k) => sent(input[k]))) {
      advice.nameFieldRetry = NAME_FIELD_RETRY_NOTE;
    }
    if (totalResults > TOO_MANY_RESULTS && firstPage) {
      advice.tooManyResults = TOO_MANY_RESULTS_NOTE;
    }
  }
  if (wordList) advice.wordListRead = WORD_LIST_READ_NOTE;
  return advice;
}

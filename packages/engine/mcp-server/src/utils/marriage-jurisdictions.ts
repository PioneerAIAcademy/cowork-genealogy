import type {
  SimplifiedFact,
  SimplifiedPerson,
  SimplifiedRelationship,
} from "../types/gedcomx.js";
import { getStandardDate } from "./fact-helpers.js";
import { earliestYear } from "./date-helpers.js";

/**
 * Candidate jurisdictions for a marriage search, derived from the tree.
 *
 * A marriage is filed where the wedding happened, not where the couple later
 * lived. So when a marriage search comes back empty in one place, the other
 * places these people are known to have been are worth trying.
 *
 * This exists because the alternative is asking the model to remember it on
 * every search, which it does not do: across four scored runs of the
 * `jimmie-jewel-neal` benchmark every marriage search stayed in the family's
 * later residence — the jurisdiction the tree's own marriage fact named — while
 * the answering record sat in the husband's birth state, a fact already present
 * in the same tree.
 *
 * ## Ordering, and why it is not "earliest first"
 *
 * The first version of this ranked candidates by absolute earliest year. That is
 * wrong, and measurably harmful: it ranked the subject's THIRD husband's 1847
 * birthplace above the relevant husband's 1857 one, because 1847 is simply
 * smaller. In the verification run the agent followed that top candidate — nine
 * searches scoped to it against one for the jurisdiction that mattered — and
 * ended up minting two wrong parents there. A run *without* this hint had
 * correctly declined to name parents at all, so the bad ordering turned a
 * cautious run into an over-claiming one.
 *
 * What actually discriminates is **distance from the marriage's own date
 * window**. The last place someone is known to have lived *before* a wedding is
 * a good guess for where they married; a place they were twenty years earlier,
 * or forty years later, is not. So:
 *
 *   1. places dated at or before the window, most recent first
 *   2. undated places
 *   3. places dated after the window — they say nothing about the wedding
 *
 * With no window in the search arguments there is no proximity signal, and the
 * function falls back to earliest-first over the whole set.
 */
export interface JurisdictionCandidate {
  /** The place as written on the fact (`standard_place` preferred). */
  place: string;
  /** Earliest possible year for the fact, or null when the fact is undated. */
  earliestYear: number | null;
  /**
   * `persons[].id` of whoever contributed the fact, or the literal `"couple"`
   * when it came from a Couple relationship rather than a person. The note tells
   * the caller each entry says whose fact it is, so a shared relationship fact
   * must not be reported as the subject's own.
   */
  whose: string;
  /** The fact type the place came from, e.g. `Birth`, `Residence`, `Marriage`. */
  fromFact: string;
}

/** What the calling search knew, used for exclusion and ranking. */
export interface MarriageSearchContext {
  /** `marriagePlace` as the caller spelled it — excluded from the results. */
  searchedPlace?: string;
  marriageYearFrom?: number;
  marriageYearTo?: number;
}

/** The subset of a simplified-GedcomX tree this reads. */
interface TreeLike {
  persons?: SimplifiedPerson[];
  relationships?: SimplifiedRelationship[];
}

/**
 * Comparable tokens for a place string, so differently-spelled forms of one
 * jurisdiction match. `"Hill County, Texas"` and `"Hill, Texas, United States"`
 * both reduce to `["hill","texas"]`.
 *
 * Necessary because the caller spells places however FamilySearch's search
 * expects, while the tree stores standardized forms — and an exact-string
 * comparison let the place just searched reappear as its own alternative.
 */
const COUNTRY_TERMS = new Set(["united states", "usa", "us"]);

/**
 * One comma part with any `County`/`Co` qualifier replaced by `","`, so the caller
 * can split on it. Runs on the ORIGINAL case, because the rule below turns on a
 * case signal that `.toLowerCase()` destroys.
 *
 * `CO` is also Colorado's postal abbreviation, and the model does write postal
 * abbreviations. Eating it reduced `"Denver, CO"` to `["denver"]`, and `samePlace`
 * is a subset test, so a Colorado-scoped search that came back empty suppressed a
 * tree place of `"Denver, Iowa"` from its own candidate list — deleting the one
 * alternative jurisdiction most worth trying.
 *
 * The qualifier is stripped when **any** of these holds, and kept otherwise:
 *
 *   1. it carries a dot — `Co.`, `co.`; or
 *   2. another token follows it in the same comma part; or
 *   3. it is spelled with a lowercase `o` — `Co` or `co`.
 *
 * So it survives only as bare uppercase `CO` ending its comma part. None of the
 * three tests works alone: requiring the dot breaks `"Hill Co Texas"`, the
 * token-follows test alone breaks `"Hill Co., Texas"` (the dot ends that comma
 * part), and a postal-abbreviation set is fifty entries to maintain against a
 * signal already present in the string.
 *
 * Knowingly accepted: `"Denver, Co"` — Colorado written with a lowercase `o` —
 * still strips, so it still compares equal to `"Denver, Iowa"`. That is the price
 * of catching `"Hill Co"`, which has no other tell. Do not "fix" it without
 * reopening the ruling.
 *
 * The `i` flag is what makes this readable as case-insensitive when it is not:
 * matching is deliberately case-blind so the callback can inspect the spelling it
 * captured. `County`, at any casing, is never an abbreviation and always strips.
 */
function stripCountyQualifier(part: string): string {
  return part.replace(
    /(?<![\p{L}\p{N}_-])(county|co)(?![\p{L}\p{N}_-])(\.?)/giu,
    (match, word: string, dot: string, offset: number) => {
      if (word.length > 2) return ","; // `County`, never an abbreviation
      if (dot) return ","; // rule 1
      if (word !== "CO") return ","; // rule 3
      return part.slice(offset + match.length).trim() === "" ? match : ","; // rule 2
    },
  );
}

/**
 * Comma-separated locality parts, lowercased, with `County`/`Co.` consumed as a
 * part separator — except for the postal abbreviation `CO`, which
 * `stripCountyQualifier` above keeps, and which is why the strip runs before the
 * lowercasing rather than after it.
 *
 * A separator and not a deletion, because the qualifier marks a locality boundary
 * whether or not a comma also does. Deleting it left the levels fused into one
 * token: `"Hill Co. Texas"` became `["hill texas"]`, which no comma-separated
 * spelling of the same jurisdiction can ever equal, so `samePlace` did not match
 * `"Hill, Texas, United States"` and the exclusion failed. Replacing it with `","`
 * makes all three spellings — `"Hill Co. Texas"`, `"Hill County Texas"` and
 * `"Hill, Texas"` — reduce to `["hill","texas"]`. Whitespace is collapsed *after*
 * the split for the same reason: collapsing first left the two spaces that used to
 * flank an internal qualifier.
 *
 * The trailing dot is part of the qualifier and must go with it, so it sits
 * OUTSIDE the closing boundary assertion — `(?!…)\.?`, never `\.?(?!…)`. Putting
 * it inside cannot work: having consumed `co.`, the assertion fails against a
 * following word character, the engine backtracks to bare `co`, and the assertion
 * now passes against the `.` it just gave up — leaving a `"."` that survives the
 * empty-string filter and counts as a locality. That stray token made
 * `"Hill Co., Texas"` tokenize as `["hill .", "texas"]`, so `samePlace` did not
 * match the tree's `"Hill, Texas, United States"` and the jurisdiction a search had
 * just come back empty on was offered back as an alternative — with its sub-places
 * alongside it, and counted twice, since `placeTokens(...).join("|")` is also the
 * dedupe key. One `\.?` after the shared assertion covers both spellings, so
 * `"County."` strips clean too.
 *
 * The boundary is a `[\p{L}\p{N}_-]` lookaround pair rather than `\b` because `\b`
 * is defined over `[A-Za-z0-9_]` only, so every non-ASCII letter reads as a word
 * edge and a leading `co` matches as a whole word inside it: `"Coïmbra"` tokenized
 * as `"ïmbra"`. `\p{L}` alone is not enough — `-` is not a letter either, so
 * `"Co-operative Township"` still lost its first two letters.
 *
 * Exported for the boundary tests, which cannot be written against
 * `marriageJurisdictionCandidates`. The mangling is consistent on both sides of
 * every comparison — `"Coïmbra"` reduced to `["ïmbra"]` whether it arrived as the
 * searched place or as the candidate — so the exclusion still matched and every
 * behavioural assertion passed with the defect present. The tokens are the only
 * level at which it is observable.
 */
export function placeParts(place: string): string[] {
  return place
    .split(",")
    .flatMap((part) => stripCountyQualifier(part).split(","))
    .map((part) => part.trim().toLowerCase().replace(/\s+/g, " "))
    .filter((part) => part !== "");
}

/**
 * True when `place` names something narrower than a whole country.
 *
 * The hint is gated on this. A search scoped to a country, or scoped to nothing
 * at all, is not a search that missed *somewhere* — every candidate the tree can
 * offer was already inside it, so naming localities within it is noise, and the
 * note's "did not find the subject in the place searched" would be false.
 *
 * Exported rather than duplicating the country set into `record-search.ts`,
 * because `placeTokens` below deliberately collapses the distinction this
 * predicate needs: its empty-fallback makes a country-only place look like any
 * other single-token place.
 *
 * Deliberately `boolean` and NOT a `place is string` type predicate, though it
 * was written that way first. The predicate is unsound in its negative branch:
 * `isSubCountryPlace("United States")` is false while `place` is very much a
 * string, so TypeScript would narrow the `else` to `undefined` and hand the first
 * author who writes one a compiler-blessed lie. Callers that need the string
 * narrowed check `!== undefined` themselves, one token, no unsoundness.
 */
export function isSubCountryPlace(place: string | undefined): boolean {
  if (!place) return false;
  return placeParts(place).some((part) => !COUNTRY_TERMS.has(part));
}

function placeTokens(place: string): string[] {
  const parts = placeParts(place);
  const withoutCountry = parts.filter((part) => !COUNTRY_TERMS.has(part));
  // A country-only place ("United States") must not reduce to [], or the
  // comparison below has nothing to work with and the searched place is offered
  // straight back as its own alternative.
  return withoutCountry.length > 0 ? withoutCountry : parts;
}

/**
 * True when `candidate` is the same jurisdiction as `searched`, or narrower than
 * it. Deliberately **one-directional**.
 *
 * Searching a state suppresses its counties: they are inside what was just
 * covered. Searching a county must NOT suppress the state, because a statewide
 * search is a different search — it reaches the *other* counties, and dropping a
 * locality level when the narrow one comes back empty is the single most useful
 * broadening move there is. A bidirectional test deleted exactly that lead: with
 * `Arkansas, United States` and `Yell, Arkansas` in the tree, searching
 * `"Yell County, Arkansas"` returned no candidates at all.
 */
function samePlace(candidate: string, searched: string): boolean {
  const tc = placeTokens(candidate);
  const ts = placeTokens(searched);
  if (tc.length === 0 || ts.length === 0) return false;
  return ts.every((token) => tc.includes(token));
}

export function marriageJurisdictionCandidates(
  tree: TreeLike,
  subjectId: string,
  context: MarriageSearchContext,
): JurisdictionCandidate[] {
  if (!tree || typeof tree !== "object") return [];

  const persons = Array.isArray(tree.persons) ? tree.persons : [];
  const subject = persons.find((p) => p?.id === subjectId);
  if (!subject) return [];

  const relationships = Array.isArray(tree.relationships)
    ? tree.relationships
    : [];

  // Spouses, plus the couple's own facts — a Marriage fact names a jurisdiction
  // in its own right.
  const spouseIds = new Set<string>();
  const coupleFacts: SimplifiedFact[] = [];
  for (const rel of relationships) {
    if (rel?.type !== "Couple") continue;
    if (rel.person1 === subjectId && rel.person2) spouseIds.add(rel.person2);
    else if (rel.person2 === subjectId && rel.person1)
      spouseIds.add(rel.person1);
    else continue;
    for (const fact of rel.facts ?? []) coupleFacts.push(fact);
  }

  // Every spouse contributes. Filtering to "the spouse in this marriage" is not
  // possible in practice: the search that exposed the ordering bug named no
  // spouse at all, only the subject plus a year range. Ranking, not exclusion,
  // is what keeps an irrelevant spouse's places out of the way.
  const contributions: Array<{ whose: string; fact: SimplifiedFact }> = [];
  for (const fact of subject.facts ?? [])
    contributions.push({ whose: subjectId, fact });
  for (const spouseId of spouseIds) {
    const spouse = persons.find((p) => p?.id === spouseId);
    for (const fact of spouse?.facts ?? [])
      contributions.push({ whose: spouseId, fact });
  }
  for (const fact of coupleFacts)
    contributions.push({ whose: "couple", fact });

  const windowStart = context.marriageYearFrom ?? context.marriageYearTo;
  const windowEnd = context.marriageYearTo ?? context.marriageYearFrom;
  const hasWindow = windowStart !== undefined && windowEnd !== undefined;

  // Sentinels chosen to stay well inside exact-integer range. An earlier version
  // used MAX_SAFE_INTEGER as the after-window base, which lands above 2^53 where
  // doubles are spaced 2 apart, so adjacent years collided and the bucket sorted
  // out of order (1902, 1900, 1901 came back 1900, 1902, 1901). Ordering is the
  // load-bearing part of this feature; it must not look nondeterministic.
  const UNDATED_KEY = 100_000; // between the two dated buckets, see below
  const AFTER_WINDOW_BASE = 1_000_000;

  /**
   * Lower sorts earlier. With a window: places at or before it rank by how close
   * they sit to it, then undated, then places after it.
   *
   * Undated sits in the MIDDLE deliberately: an undated residence still tells you
   * these people were there, which is more use for locating a wedding than a
   * residence recorded thirty years afterwards.
   */
  const rankKey = (year: number | null): number => {
    if (!hasWindow) return year === null ? Number.POSITIVE_INFINITY : year;
    if (year === null) return UNDATED_KEY;
    if (year > (windowEnd as number)) return AFTER_WINDOW_BASE + year;
    return (windowStart as number) - year; // most recent before → smallest
  };

  const byPlace = new Map<string, JurisdictionCandidate>();
  for (const { whose, fact } of contributions) {
    const place = fact?.standard_place || fact?.place;
    if (!place) continue;
    if (context.searchedPlace && samePlace(place, context.searchedPlace))
      continue;

    const standardized = getStandardDate(fact);
    const year = standardized ? earliestYear(standardized) : null;

    // Key on tokens so two spellings of one jurisdiction collapse together.
    const key = placeTokens(place).join("|") || place.toLowerCase();
    const existing = byPlace.get(key);
    if (!existing || rankKey(year) < rankKey(existing.earliestYear)) {
      byPlace.set(key, {
        place,
        earliestYear: year,
        whose,
        fromFact: fact.type ?? "",
      });
    }
  }

  return [...byPlace.values()].sort(
    (a, b) => rankKey(a.earliestYear) - rankKey(b.earliestYear),
  );
}

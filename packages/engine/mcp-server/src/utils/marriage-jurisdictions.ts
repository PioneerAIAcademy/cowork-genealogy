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
  /** `persons[].id` of whoever contributed the fact. */
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
function placeTokens(place: string): string[] {
  const DROP = new Set(["county", "co", "united states", "usa", "us", ""]);
  return place
    .toLowerCase()
    .split(",")
    .map((part) => part.trim().replace(/\s+/g, " "))
    .map((part) => part.replace(/\bcounty\b|\bco\.?\b/g, "").trim())
    .filter((part) => !DROP.has(part));
}

/**
 * True when two place strings denote the same jurisdiction, or one contains the
 * other. Containment counts in both directions: searching a whole state should
 * suppress its counties, and searching a county should suppress the bare state
 * form of the same place.
 */
function samePlace(a: string, b: string): boolean {
  const ta = placeTokens(a);
  const tb = placeTokens(b);
  if (ta.length === 0 || tb.length === 0) return false;
  const [shorter, longer] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  return shorter.every((token) => longer.includes(token));
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
    contributions.push({ whose: subjectId, fact });

  const windowStart = context.marriageYearFrom ?? context.marriageYearTo;
  const windowEnd = context.marriageYearTo ?? context.marriageYearFrom;
  const hasWindow = windowStart !== undefined && windowEnd !== undefined;

  /** Lower sorts earlier. Distance from the window when we have one. */
  const rankKey = (year: number | null): number => {
    if (year === null) return Number.POSITIVE_INFINITY;
    if (!hasWindow) return year;
    if (year > (windowEnd as number)) {
      // After the wedding: keep, but behind everything informative.
      return Number.MAX_SAFE_INTEGER - (windowEnd as number) + year;
    }
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

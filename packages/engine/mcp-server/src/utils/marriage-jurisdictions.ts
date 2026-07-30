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
 * lived — and marriage usually *precedes* migration. So when a marriage search
 * has been scoped to one place, every other place either spouse is known to
 * have been is a candidate, earliest first.
 *
 * This exists because the alternative is asking the model to remember it on
 * every search, which it does not do reliably: across four scored runs of the
 * `jimmie-jewel-neal` benchmark, every marriage search was anchored to the
 * family's *later* residence (Hill County, Texas) because that is where the
 * tree's own marriage fact pointed, while the record that answers the question
 * sits in the husband's birth state (Arkansas) — a fact already present in the
 * same tree. Choosing which jurisdictions to try is date arithmetic over places
 * the tree already holds, so the tool can just do it.
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

/** The subset of a simplified-GedcomX tree this reads. */
interface TreeLike {
  persons?: SimplifiedPerson[];
  relationships?: SimplifiedRelationship[];
}

/** Case- and whitespace-insensitive place key, so "  hill, TEXAS " matches. */
function placeKey(place: string): string {
  return place.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Other jurisdictions worth searching for this subject's marriage, earliest
 * first. Undated places sort last — they are still worth trying, just with no
 * evidence they precede anything.
 *
 * Never throws: a malformed tree, an unknown `subjectId`, or a spouse missing
 * from `persons` all yield `[]`. This runs inside a search response, so a bad
 * tree must not turn a successful search into an error.
 */
export function marriageJurisdictionCandidates(
  tree: TreeLike,
  subjectId: string,
  searchedPlace: string | undefined,
): JurisdictionCandidate[] {
  if (!tree || typeof tree !== "object") return [];

  const persons = Array.isArray(tree.persons) ? tree.persons : [];
  const subject = persons.find((p) => p?.id === subjectId);
  if (!subject) return [];

  const relationships = Array.isArray(tree.relationships)
    ? tree.relationships
    : [];

  // Spouses, plus the couple's own facts (a Marriage fact names a jurisdiction
  // in its own right, and is often the earliest dated place the couple share).
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

  // Both spouses contribute. Looking only at the subject is the specific way
  // this goes wrong: the decisive place is frequently the *other* spouse's
  // birthplace, which the subject's own facts never mention.
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

  const searchedKey = searchedPlace ? placeKey(searchedPlace) : null;

  const byPlace = new Map<string, JurisdictionCandidate>();
  for (const { whose, fact } of contributions) {
    const place = fact?.standard_place || fact?.place;
    if (!place) continue;

    const key = placeKey(place);
    if (searchedKey && key === searchedKey) continue;

    const standardized = getStandardDate(fact);
    const year = standardized ? earliestYear(standardized) : null;

    const existing = byPlace.get(key);
    const isEarlier =
      year !== null &&
      (existing?.earliestYear === null ||
        existing === undefined ||
        year < existing.earliestYear);

    if (!existing || isEarlier) {
      byPlace.set(key, {
        place,
        earliestYear: year,
        whose,
        fromFact: fact.type ?? "",
      });
    }
  }

  return [...byPlace.values()].sort((a, b) => {
    if (a.earliestYear === null && b.earliestYear === null) return 0;
    if (a.earliestYear === null) return 1;
    if (b.earliestYear === null) return -1;
    return a.earliestYear - b.earliestYear;
  });
}

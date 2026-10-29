/**
 * The standard_place the engine gives a written place, and the rule a writer
 * applies to one an agent supplies (lead, 2026-10-26: "Mis-standardizing a place
 * is worse than not standardizing it"; "have the engine take FamilySearch's
 * standardization from the record a tree fact cites").
 *
 * The engine's answer for a place text, in order:
 * 1. On a fact that cites records, the standard_place the project stores for the
 *    same text, case and accents aside, on those records: an assertion from one
 *    of them, or a fact of one of them in a sidecar such an assertion came from.
 *    Two different values are doubt, and doubt is no standard_place.
 * 2. Otherwise the writer's own lookup.
 * A non-place phrase ("Same House") has none, and an answer naming a different
 * country than the text is dropped.
 *
 * A writer keeps a supplied standard_place only when it is that answer;
 * otherwise the answer replaces it, or none is kept, and a warning says which
 * and why. FamilySearch's standardization on any other record is never a reason
 * to keep one. An agent that knows more writes it into the place text.
 */
import { countryConsistency, isNonPlacePhrase, placeSegments } from "./place-resolver.js";

/** A place text as the rule compares it: case, accents and spacing aside. */
export function placeTextKey(place: string): string {
  return place.trim().toLowerCase().replace(/\s+/g, " ").normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

export type PlaceAnswer =
  | { standardPlace: string; from: "record" | "lookup" }
  | {
      standardPlace: null;
      why: "not_a_place" | "records_disagree" | "not_found" | "other_country";
      /** The answer dropped for naming another country. */
      dropped?: string;
      reason: string;
    };

/** The engine's answer for `place`, given the distinct standard_places its cited
 *  records store for it (`stored`) and the writer's own lookup. */
export async function placeAnswer(
  place: string,
  stored: readonly string[],
  lookup: () => Promise<string | null>,
): Promise<PlaceAnswer> {
  if (isNonPlacePhrase(place)) {
    return { standardPlace: null, why: "not_a_place", reason: `'${place}' names no place` };
  }
  if (stored.length > 1) {
    return {
      standardPlace: null,
      why: "records_disagree",
      reason: `the records it cites store different standard places for it (${stored.join("; ")})`,
    };
  }
  const answer = stored[0] ?? (await lookup().catch(() => null));
  if (!answer) {
    return {
      standardPlace: null,
      why: "not_found",
      reason:
        placeSegments(place).length > 1
          ? "the engine's place lookup found no place for this text, or failed"
          : "the engine leaves a one-part place unstandardized unless it can tell which place it is; " +
            'write its parent jurisdictions into the place text (e.g. "Springfield, Illinois")',
    };
  }
  if (countryConsistency(place, answer) === "contradiction") {
    return {
      standardPlace: null,
      why: "other_country",
      dropped: answer,
      reason: `'${answer}' names a different country than the text`,
    };
  }
  return { standardPlace: answer, from: stored.length === 1 ? "record" : "lookup" };
}

const KEPT_ONLY =
  "A supplied standard_place is kept only when it is the engine's own answer for the place text: the " +
  "standard place the records the fact cites store for that text, else the engine's lookup. To " +
  'standardize a place differently, write the fuller place into the text (e.g. "Springfield, Illinois").';

/** What a writer stores when a caller supplied `supplied` for `place`, given the
 *  engine's `answer` (null when there is no place text), and the warning that
 *  says why when that is not `supplied`. */
export function judgeSupplied(
  place: unknown,
  supplied: string,
  answer: PlaceAnswer | null,
): { standardPlace: string | null; warning?: string } {
  if (answer === null) {
    return {
      standardPlace: null,
      warning: `standard_place '${supplied}' was not kept: there is no place text to standardize. ${KEPT_ONLY}`,
    };
  }
  if (answer.standardPlace === supplied) return { standardPlace: supplied };
  if (answer.standardPlace !== null) {
    const whose = answer.from === "record" ? "the standard place the cited record stores" : "the engine's lookup";
    return {
      standardPlace: answer.standardPlace,
      warning: `standard_place '${supplied}' for '${place}' was replaced by '${answer.standardPlace}', ${whose}. ${KEPT_ONLY}`,
    };
  }
  return {
    standardPlace: null,
    warning: `standard_place '${supplied}' for '${place}' was not kept, and the place has none: ${answer.reason}. ${KEPT_ONLY}`,
  };
}

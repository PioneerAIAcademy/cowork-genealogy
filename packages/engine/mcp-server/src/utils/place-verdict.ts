/**
 * The standard_place a writer stores for a fact's place (lead, 2026-10-29: the
 * place bar is about 80% right, coarser and finer answers counted right;
 * 2026-10-26: "have the engine take FamilySearch's standardization from the
 * record a tree fact cites").
 *
 * A supplied standard_place is kept when the fact has a place, the value names
 * no other country than that place, and FamilySearch's place search finds a
 * place whose full name is the value, case and accents aside. A failed search
 * keeps it. Otherwise the engine's own answer replaces it, or none is kept, and
 * a warning says which and why.
 *
 * The engine's own answer for a place text, which also fills a fact with none:
 * 1. FamilySearch's own standardization of the same text on the record personas
 *    the fact is about (record-standards.ts). Two different values are doubt,
 *    and doubt is no standard_place;
 * 2. otherwise the writer's own lookup.
 * A non-place phrase ("Same House") has none, and an answer naming a different
 * country than the text is dropped.
 */
import { countryConsistency, isFamilySearchPlace, isNonPlacePhrase, placeSegments } from "./place-resolver.js";

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

/** The engine's answer for `place`, given FamilySearch's own distinct
 *  standard_places for it on the records the fact cites (`fromRecords`) and the
 *  writer's own lookup. */
export async function placeAnswer(
  place: string,
  fromRecords: readonly string[],
  lookup: () => Promise<string | null>,
): Promise<PlaceAnswer> {
  if (isNonPlacePhrase(place)) {
    return { standardPlace: null, why: "not_a_place", reason: `'${place}' names no place` };
  }
  if (fromRecords.length > 1) {
    return {
      standardPlace: null,
      why: "records_disagree",
      reason: `FamilySearch standardized it differently on the record it cites (${fromRecords.join("; ")})`,
    };
  }
  const answer = fromRecords[0] ?? (await lookup().catch(() => null));
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
  return { standardPlace: answer, from: fromRecords.length === 1 ? "record" : "lookup" };
}

/** Why a supplied standard_place is not kept for `place`, or null when it is. */
export async function whyNotKept(place: unknown, supplied: string): Promise<string | null> {
  if (typeof place !== "string" || place.trim() === "") return "the fact has no place";
  if (isNonPlacePhrase(place)) return `'${place}' names no place`;
  if (countryConsistency(place, supplied) === "contradiction") return "it names a different country than the place";
  return (await isFamilySearchPlace(supplied)) === false ? "FamilySearch's place standard has no place of that name" : null;
}

const KEPT_WHEN =
  "A supplied standard_place is kept when it is a FamilySearch standard place (a place_search result) " +
  "for the fact's own place.";

/** What a writer stores when a caller supplied `supplied` for `place`, and the
 *  warning that says why when that is not `supplied`. `answer` is the engine's
 *  own answer for the place text, asked only when `supplied` is not kept. */
export async function judgeSupplied(
  place: unknown,
  supplied: string,
  answer: (place: string) => Promise<PlaceAnswer>,
): Promise<{ standardPlace: string | null; warning?: string }> {
  const why = await whyNotKept(place, supplied);
  if (why === null) return { standardPlace: supplied };
  const text = typeof place === "string" && place.trim() !== "" ? place : undefined;
  const head = `standard_place '${supplied}'${text === undefined ? "" : ` for '${text}'`}`;
  const a = text === undefined || isNonPlacePhrase(text) ? null : await answer(text);
  if (a !== null && a.standardPlace !== null) {
    const whose = a.from === "record" ? "FamilySearch's standardization of the same place on the record it cites" : "the engine's lookup";
    return { standardPlace: a.standardPlace, warning: `${head} was replaced by '${a.standardPlace}', ${whose}: ${why}. ${KEPT_WHEN}` };
  }
  const none = a === null ? "" : `, and the engine has none for it: ${a.reason}`;
  return { standardPlace: null, warning: `${head} was not kept: ${why}${none}. ${KEPT_WHEN}` };
}

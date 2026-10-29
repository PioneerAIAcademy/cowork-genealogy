/**
 * The standard_place a writer stores for a fact's place (lead, 2026-10-29: the
 * place bar is about 80% right, coarser and finer answers counted right;
 * 2026-10-26: "have the engine take FamilySearch's standardization from the
 * record a tree fact cites").
 *
 * A supplied standard_place is kept when the fact has a place, the value names
 * no other country than that place, the place text confirms it
 * (`unconfirmedByText`), and FamilySearch's place search finds a place whose
 * full name is the value, case and accents aside. It is kept in FamilySearch's
 * spelling. A failed search keeps it as written. Otherwise the engine's own
 * answer replaces it, or none is kept, and a warning says which and why.
 *
 * The engine's own answer for a place text, which also fills a fact with none:
 * 1. FamilySearch's own standardization of the same text on the record personas
 *    the fact is about (record-standards.ts). Two different values are doubt,
 *    and doubt is no standard_place;
 * 2. otherwise the writer's own lookup, kept only when the text confirms it.
 * A non-place phrase ("Same House") has none, and an answer naming a different
 * country than the text is dropped.
 */
import {
  canonicalCountry,
  countryConsistency,
  familySearchFullName,
  isNonPlacePhrase,
  placeSegments,
  standardPlaceNamedInText,
} from "./place-resolver.js";
import { oneWordListPlace } from "./one-word-places.js";

/** A place text as the rule compares it: case, accents and spacing aside. */
export function placeTextKey(place: string): string {
  return place.trim().toLowerCase().replace(/\s+/g, " ").normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

/**
 * Why the place text does not confirm `standardPlace`, or null when it does:
 * research_append's check on a place taken from a fact's value, which also
 * keeps a phrase that names no place ("with his daughter", "at the home of her
 * daughter") from taking one. Only a pair the country check cannot judge is in
 * question. When the text's last comma part names a country the check knows,
 * the standard place names none it knows. Otherwise its own name, its first
 * segment, must be one of the text's comma parts, unless the text is one word,
 * which the resolver's one-word rule judges, or the standard place is the
 * one-word list's entry for the text: neither need spell the text ("Ky" is
 * Kentucky, "W. Va." West Virginia).
 */
export function unconfirmedByText(place: string, standardPlace: string): string | null {
  if (countryConsistency(place, standardPlace) !== "unverifiable") return null;
  const parts = placeSegments(place);
  if (canonicalCountry(parts[parts.length - 1] ?? "") !== null) return "does not name the country the text names";
  const oneWord = parts.length === 1 && !/\s/.test(parts[0]);
  const listed = oneWordListPlace(place);
  if (oneWord || (listed !== null && placeTextKey(listed) === placeTextKey(standardPlace))) return null;
  return standardPlaceNamedInText(place, standardPlace)
    ? null
    : "could not be confirmed, as the text names neither a country nor that place";
}

export type PlaceAnswer =
  | { standardPlace: string; from: "record" | "lookup" }
  | {
      standardPlace: null;
      why: "not_a_place" | "records_disagree" | "not_found" | "other_country" | "unconfirmed";
      /** The answer dropped for naming another country, or for the text not confirming it. */
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
  const unconfirmed = fromRecords.length === 0 ? unconfirmedByText(place, answer) : null;
  if (unconfirmed !== null) {
    return {
      standardPlace: null,
      why: "unconfirmed",
      dropped: answer,
      reason: `the engine's place lookup answer '${answer}' ${unconfirmed}`,
    };
  }
  return { standardPlace: answer, from: fromRecords.length === 1 ? "record" : "lookup" };
}

/** What a writer keeps of a supplied standard_place for `place`: the value in
 *  FamilySearch's spelling (as written when the search failed), or why none. */
export async function keptSupplied(place: unknown, supplied: string): Promise<{ kept: string } | { why: string }> {
  if (typeof place !== "string" || place.trim() === "") return { why: "the fact has no place" };
  if (isNonPlacePhrase(place)) return { why: `'${place}' names no place` };
  if (countryConsistency(place, supplied) === "contradiction") return { why: "it names a different country than the place" };
  const unconfirmed = unconfirmedByText(place, supplied);
  if (unconfirmed !== null) return { why: `it ${unconfirmed}` };
  const spelled = await familySearchFullName(supplied);
  if (spelled === false) return { why: "FamilySearch's place standard has no place of that name" };
  return { kept: spelled ?? supplied };
}

const KEPT_WHEN =
  "A supplied standard_place is kept when it is a FamilySearch standard place (a place_search result) " +
  "for the fact's own place.";

/** What a writer stores when a caller supplied `supplied` for `place`: the
 *  value, in FamilySearch's spelling, with no warning when it is kept;
 *  otherwise the engine's own answer for the place text (`answer`, asked only
 *  then), or null, with a warning that says which and why. */
export async function judgeSupplied(
  place: unknown,
  supplied: string,
  answer: (place: string) => Promise<PlaceAnswer>,
): Promise<{ standardPlace: string | null; warning?: string }> {
  const k = await keptSupplied(place, supplied);
  if ("kept" in k) return { standardPlace: k.kept };
  const why = k.why;
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

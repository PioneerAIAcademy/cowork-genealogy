/**
 * The standard_place a writer stores for a fact's place (lead, 2026-10-29: the
 * place bar is about 80% right, coarser and finer answers counted right;
 * 2026-10-26: "have the engine take FamilySearch's standardization from the
 * record a tree fact cites").
 *
 * A supplied standard_place is kept when the fact has a place that is not a
 * non-place phrase and the value fits that place's text (`fitsText`; lead,
 * 2026-10-29: the place must fit the fact's own text, "yes, definitely"): it
 * is a FamilySearch standard place the text names, in no other state,
 * province or country than the text names. It is kept in FamilySearch's
 * spelling. A failed lookup keeps it as written. Otherwise the engine's own
 * answer replaces it, or none is kept, and a warning says which and why.
 *
 * The engine's own answer for a place text, which also fills a fact with none:
 * 1. FamilySearch's own standardization of the same text on the records the
 *    fact cites (`RecordStandards`, research_append's Lever B copy). Two
 *    different values are doubt, and doubt is no standard_place;
 * 2. otherwise the writer's own lookup, as `main` fills it.
 * A non-place phrase ("Same House") has none, and an answer naming a different
 * country than the text is dropped. A lookup that replaces a supplied value
 * must fit the text as the value had to.
 */
import {
  canonicalCountry,
  countryConsistency,
  countryContradiction,
  divisionContradiction,
  endsWithItsJurisdiction,
  familySearchPlace,
  isNonPlacePhrase,
  placeSegments,
  standardPlaceNamedInText,
  textNamesPlace,
} from "./place-resolver.js";
import { oneWordListPlace } from "./one-word-places.js";

/** A place text as the rule compares it: case, accents and spacing aside. */
export function placeTextKey(place: string): string {
  return place.trim().toLowerCase().replace(/\s+/g, " ").normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

/**
 * Why the place text does not confirm `standardPlace`, or null when it does:
 * research_append's check on a place taken from a fact's value, and the one a
 * lookup standing in for a refused value must pass to store that value
 * silently (`judgeSupplied`), which keeps a phrase that names no place ("at
 * the home of her daughter") from taking one. Only a pair the country check
 * cannot judge is in question. When the text's last comma part names a
 * country the check knows, the standard place names none it knows. Otherwise
 * its own name, its first segment, must be one of the text's comma parts,
 * unless the text is one word, which the resolver's one-word rule judges, or
 * the standard place is the one-word list's entry for the text: neither need
 * spell the text ("Ky" is Kentucky, "W. Va." West Virginia).
 */
export function unconfirmedByText(place: string, standardPlace: string): string | null {
  if (countryConsistency(place, standardPlace) !== "unverifiable") return null;
  const parts = placeSegments(place);
  if (canonicalCountry(parts[parts.length - 1] ?? "") !== null) return "does not name the country the text names";
  const oneWord = parts.length === 1 && !/\s/.test(parts[0]);
  if (oneWord || isListAnswer(place, standardPlace)) return null;
  return standardPlaceNamedInText(place, standardPlace)
    ? null
    : "could not be confirmed, as the text names neither a country nor that place";
}

/** `standardPlace` is the one-word list's entry for `place`, case and accents
 *  aside: "Ky" is Kentucky, "W. Va." West Virginia. */
function isListAnswer(place: string, standardPlace: string): boolean {
  const listed = oneWordListPlace(place);
  return listed !== null && placeTextKey(listed) === placeTextKey(standardPlace);
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

/** A standard place that fits a place text, in FamilySearch's spelling, or why
 *  it does not; `unnamed` when the text's not naming it is the only reason. */
type Fit = { kept: string } | { why: string; unnamed?: true };

/**
 * Whether `value` fits place text `place`: it names no other country than the
 * text (`countryConsistency`); FamilySearch's place search finds a place whose
 * full name is the value, case and accents aside; that place lies in no other
 * US state, Puerto Rico or Canadian province than the text ends with
 * (`divisionContradiction`) and in no other country than the text names
 * (`countryContradiction`), the two checks `record_read` makes of
 * FamilySearch's own choice; and some part of the text names it, as
 * `record_read` checks a fact's own text (`textNamesPlace`), or it is the
 * one-word list's entry for the text. The engine's own lookup (`lookup`), found
 * from the text, may instead lie in the state or province the text ends with,
 * or in its country and in a jurisdiction a part of the text names
 * (`endsWithItsJurisdiction`): "near Nueva Italia, Michoacán, Mexico" takes
 * "Nueva Italia de Ruiz, Múgica, Michoacan, Mexico", while "Laibach, Krain,
 * Austria" takes no "Krainberg, Villach Land, Carinthia, Austria", nor "Boght
 * Reformed, Church" "Church, Hillsdale, Michigan, United States". A failed
 * lookup fits it as written.
 */
export async function fitsText(place: string, value: string, lookup = false): Promise<Fit> {
  if (countryConsistency(place, value) === "contradiction") return { why: "it names a different country than the place" };
  const found = await familySearchPlace(value);
  if (found === false) return { why: "FamilySearch's place standard has no place of that name" };
  if (found === null) return { kept: value };
  if (divisionContradiction(place, found.fullName)) return { why: "it names a different state or province than the place" };
  if (await countryContradiction(place, found)) return { why: "it lies in a different country than the place" };
  const named =
    isListAnswer(place, found.fullName) ||
    (await textNamesPlace(found, place)) !== false ||
    (lookup && endsWithItsJurisdiction(place, found.fullName));
  return named ? { kept: found.fullName } : { why: "no part of the place text names that place", unnamed: true };
}

/** What a writer keeps of a supplied standard_place for `place`: the value in
 *  FamilySearch's spelling (as written when a lookup failed), or why none. */
export async function keptSupplied(place: unknown, supplied: string): Promise<Fit> {
  if (typeof place !== "string" || place.trim() === "") return { why: "the fact has no place" };
  if (isNonPlacePhrase(place)) return { why: `'${place}' names no place` };
  return fitsText(place, supplied);
}

const KEPT_WHEN =
  "A supplied standard_place is kept when it is a FamilySearch standard place (a place_search result) " +
  "for the fact's own place.";

/** What a writer stores when a caller supplied `supplied` for `place`: the
 *  value, in FamilySearch's spelling, with no warning when it is kept;
 *  otherwise the engine's own answer for the place text (`answer`, asked only
 *  then), or null, with a warning that says which and why. The lookup's answer
 *  replaces the value only when it fits the text as a lookup must (`fitsText`);
 *  FamilySearch's own from the record is not judged. An answer that is the
 *  supplied value itself, case and accents aside, is stored with no warning:
 *  FamilySearch's from the record, or the lookup's when the text's not naming
 *  the value was the only reason to refuse it and the text confirms the lookup
 *  (`unconfirmedByText`) or ends with the state or province it lies in
 *  (`endsWithItsJurisdiction`): "Balto., Md." keeps "Baltimore, Maryland,
 *  United States", which the lookup gives too, and "at the home of her
 *  daughter" no "Of, Trabzon, Türkiye". */
export async function judgeSupplied(
  place: unknown,
  supplied: string,
  answer: (place: string) => Promise<PlaceAnswer>,
): Promise<{ standardPlace: string | null; warning?: string }> {
  const k = await keptSupplied(place, supplied);
  if ("kept" in k) return { standardPlace: k.kept };
  const text = typeof place === "string" && place.trim() !== "" ? place : undefined;
  const head = `standard_place '${supplied}'${text === undefined ? "" : ` for '${text}'`}`;
  const notKept = (reason?: string) => ({
    standardPlace: null,
    warning: `${head} was not kept: ${k.why}${reason === undefined ? "" : `, and the engine has none for it: ${reason}`}. ${KEPT_WHEN}`,
  });
  const replaced = (standardPlace: string, whose: string) => ({
    standardPlace,
    warning: `${head} was replaced by '${standardPlace}', ${whose}: ${k.why}. ${KEPT_WHEN}`,
  });
  if (text === undefined || isNonPlacePhrase(text)) return notKept();
  const a = await answer(text);
  const isSupplied = (value: string) => placeTextKey(value) === placeTextKey(supplied);
  if (a.standardPlace !== null && a.from === "record") {
    return isSupplied(a.standardPlace)
      ? { standardPlace: a.standardPlace }
      : replaced(a.standardPlace, "FamilySearch's standardization of the same place on the record it cites");
  }
  if (a.standardPlace === null) return notKept(a.reason);
  const looked = a.standardPlace;
  const unconfirmed = unconfirmedByText(text, looked);
  if (k.unnamed === true && (unconfirmed === null || endsWithItsJurisdiction(text, looked)) && isSupplied(looked)) {
    return { standardPlace: looked };
  }
  const fit = await fitsText(text, looked, true);
  if ("kept" in fit) return replaced(fit.kept, "the engine's lookup");
  return notKept(`the engine's place lookup answer '${looked}' ${unconfirmed ?? `does not fit it either: ${fit.why}`}`);
}

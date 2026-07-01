// English sentence templates for the person-quality-score service.
//
// Source of truth: FamilySearch "Data Quality Score – English Sentence
// Templates" (docs reference: Person-Data-Quality-Score-Sentences.pdf). Each
// live issue the quality API returns carries an `issueType` and a
// `conclusionType`; this module maps that pair to the human English sentence
// shown in the FamilySearch "Show Quality Details" panel, filling the
// {placeholders} from the issue's own JSON fields.
//
// See docs/specs/person-quality-tool-spec.md ("Issue → sentence mapping").
//
// Placeholder conventions inside a template string:
//   {Article}          → "The" / "A" (sentence-start, capitalized), chosen
//                         from the issue's conclusionType (definite vs
//                         indefinite group below).
//   {conclusionType}   → the conclusionType, humanized (e.g. BURIAL → "burial").
//   {firstConclusionType} / {secondConclusionType} → humanized, for event-order.
//   {anyOtherField}    → issue[field], inserted verbatim (e.g. {originalPlace}).

// A quality issue as returned under personScores.issues[]. Only issueType and
// conclusionType are needed for lookup; the rest are interpolation sources.
export interface QualityIssue {
  issueType?: string;
  conclusionType?: string;
  scoreType?: string;
  [key: string]: unknown;
}

// conclusionTypes that take the definite article ("The"); the rest of the
// event-bearing types (MARRIAGE, RESIDENCE) take "A". Non-event conclusion
// types (NAME, GENDER) never appear in an {Article} template.
const DEFINITE_ARTICLE_TYPES = new Set([
  "BIRTH",
  "BURIAL",
  "CREMATION",
  "CHRISTENING",
  "DEATH",
]);

// Humanize a conclusionType enum for prose: BURIAL → "burial",
// PARENT_BIRTH → "parent birth".
export function humanizeConclusionType(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.toLowerCase().replace(/_/g, " ");
}

// "The" or "A" for a sentence-start {Article}, from the conclusionType.
function article(conclusionType: unknown, capitalized: boolean): string {
  const definite =
    typeof conclusionType === "string" &&
    DEFINITE_ARTICLE_TYPES.has(conclusionType);
  if (definite) return capitalized ? "The" : "the";
  return capitalized ? "A" : "a";
}

// ─── Templates keyed by issueType ───────────────────────────────────────────
// Templates whose only conclusionType dependence is the article use the
// {Article} token so one entry covers both the "The birth…" and "A marriage…"
// forms. Templates that don't vary by conclusionType bake the article in.
const BY_ISSUE_TYPE: Record<string, string> = {
  // COMPLETENESS
  DAY_NOT_SPECIFIED: "{Article} {conclusionType} date is missing a day.",
  MONTH_NOT_SPECIFIED: "{Article} {conclusionType} date is missing a month.",
  // "Current" wording per the PDF (a "Proposed" alternate reads "…is imprecise.").
  YEAR_NOT_SPECIFIED: "{Article} {conclusionType} date is missing a year.",
  MISSING_EVENT: "The person is missing a {conclusionType}.",
  MISSING_EVENT_PLACE: "{Article} {conclusionType} place is missing.",
  MISSING_PLACE_JURISDICTIONS: "{Article} {conclusionType} place is missing a city.",
  MISSING_EVENT_DATE: "{Article} {conclusionType} date is missing.",
  NON_STANDARD_PLACE:
    "{Article} {conclusionType} is missing a standardized location for {originalPlace}.",
  NON_STANDARD_DATE:
    "{Article} {conclusionType} is missing a standardized date for {originalDate}.",
  NO_GIVEN_NAME_FOUND: "The first name is missing.",
  NO_SURNAME_FOUND: "The last name is missing.",
  NO_GENDER_FOUND: "Male or female is not specified.",

  // VERIFIABILITY
  MISSING_TAGGED_SOURCE: "The {conclusionType} has no tagged sources.",
  MISSING_TAGGED_SOURCE_INFORMATIONAL: "A {conclusionType} has no tagged sources.",
  TOO_FEW_TAGGED_SOURCES:
    "The {conclusionType} has fewer than {numTagsNeeded} tagged sources.",
  TOO_FEW_TAGGED_SOURCES_INFORMATIONAL:
    "A {conclusionType} has fewer than {numTagsNeeded} tagged sources.",
  MISSING_EXPECTED_CENSUS:
    'This person appears to have lived in {normalizedPlace} in {collectionYear}. ' +
    'If this is true, they would likely have a source in the "{collectionName}" collection.',
  MULTIPLE_TAGS_IN_SAME_CENSUS:
    "This person has multiple sources from the same census year attached to them, " +
    "this is highly unlikely to be correct.",

  // CONSISTENCY
  DATE_MISMATCH:
    "This person has a {conclusionType} date of {conclusionOriginalDate}, which does " +
    "not match the date {sourceOriginalDate}. {sourceTitle}",
  DATE_PARTIAL_MISMATCH:
    "This person has a {conclusionType} date of {conclusionOriginalDate}, which does " +
    "not match the date {sourceOriginalDate}. {sourceTitle}",
  GENDER_MISMATCH:
    "This person's sex does not match the information in this source. {sourceTitle}",
  PLACE_MISMATCH:
    "This person has a {conclusionType} place of {conclusionOriginalPlace}, which does " +
    "not match the place {sourceOriginalPlace}. {sourceTitle}",
  GIVEN_NAME_MISMATCH:
    "This person has a first name of {conclusionName}, which does not match the name " +
    "{sourceName}. {sourceTitle}",
  SURNAME_MISMATCH:
    "This person has a last name of {conclusionName}, which does not match the last " +
    "name {sourceName}. {sourceTitle}",
  MISSING_SURNAME:
    "This person is missing a last name. A possible last name is in this source. {sourceTitle}",
  NO_SOURCES: "This person has no sources.",
  NO_INDEXED_SOURCES: "This person has no indexed sources.",
  GIVEN_NAME_FIELD_MISMATCH:
    "This person doesn't have any first names, but your Last Names field has multiple " +
    "names, which could include the first names.",
  SURNAME_FIELD_MISMATCH:
    "This person doesn't have any last names, but your First Names field has multiple " +
    "names, which could include the last names.",

  // COHERENCE
  CHILD_COUNT:
    "This person has {actualChildCount} children. Most people had {profileChildCount} or fewer.",
  DELAYED_BURIAL:
    "The burial date is {actualDays} days after the death date. Burial usually happened " +
    "within {profileDays} days of death.",
  OLD_CHRISTENING:
    "This person is listed as having been christened at age {actualAge}. Christening " +
    "normally happened by age {profileAge}.",
  OLD_DEATH:
    "This person's birth and death dates indicate death at age {actualAge}, which is older than usual.",
  OLD_MARRIAGE:
    "This person's birth and marriage dates indicate marriage at age {actualAge}, which is older than usual.",
  YOUNG_MARRIAGE:
    "This person's birth and marriage dates indicate marriage at age {actualAge}, which is younger than usual.",
  PARENT_DIED_TOO_YOUNG_FOR_CHILDREN:
    "This person's parent {youngPersonGivenName} died at age {youngDeathAge}.",
  DIED_TOO_YOUNG_FOR_CHILDREN:
    "This person shows as having children, even though they died at age {youngDeathAge}.",
  COPARENT_DIED_TOO_YOUNG_FOR_CHILDREN:
    "This person shows as having children, even though their coparent {youngPersonGivenName} " +
    "died at age {youngDeathAge}.",
  DIED_TOO_YOUNG_FOR_COUPLE_RELATIONSHIP:
    "This person shows as being in a couple relationship, even though they died at age {youngDeathAge}.",
  PARTNER_DIED_TOO_YOUNG_FOR_COUPLE_RELATIONSHIP:
    "This person shows as being in a couple relationship with {youngPersonGivenName}, even " +
    "though {youngPersonGivenName} died at age {youngDeathAge}.",
  BORN_BEFORE_PARENTS_MARRIED:
    "This person was born in {childBirthYear}, {yearsBeforeMarriage} years before " +
    "{marriageYear}, when their parents {parent1GivenName} and {parent2GivenName} were married.",
  CHILD_BORN_BEFORE_MARRIAGE:
    "{childGivenName} was born in {childBirthYear}, {yearsBeforeMarriage} years before " +
    "{marriageYear}, when {parent1GivenName} and {parent2GivenName} were married.",
  CHILD_OF_CHILDLESS_COUPLE:
    'This person was born to {parent1GivenName} and {parent2GivenName}, who have a fact ' +
    'listed as "No Children."',
  DATE_PLACE_MISMATCH_UNKNOWN_FROM_YEAR:
    'The standard "{placeNormalized}" (ID: {placeRepId}) is used for dates up to ' +
    "{placeNormalizedToYear}. This conflicts with the {conclusionType} date of {conclusionNormalizedDate}.",
  DATE_PLACE_MISMATCH:
    'The standard "{placeNormalized}" (ID: {placeRepId}) is used for {placeNormalizedFromYear} ' +
    "to {placeNormalizedToYear}. This conflicts with the {conclusionType} date of {conclusionNormalizedDate}.",
  DATE_PLACE_MISMATCH_UNKNOWN_TO_YEAR:
    'The standard "{placeNormalized}" (ID: {placeRepId}) is used for dates from ' +
    "{placeNormalizedToYear} onward. This conflicts with the {conclusionType} date of {conclusionNormalizedDate}.",
  CHILDREN_BORN_TOO_CLOSE:
    "This person gave birth to {youngerSiblingGivenName} {ageGapInMonths} months after " +
    "{olderSiblingGivenName} was born.",
  COPARENTS_CHILDREN_BORN_TOO_CLOSE:
    "This person's coparent {motherGivenName} gave birth to {youngerSiblingGivenName} " +
    "{ageGapInMonths} months after {olderSiblingGivenName} was born.",
  ALTERNATING_LOCATIONS:
    "This person had life events in {returnedToPlaceName}, then in {movedToPlaceName}, and " +
    "then in {returnedToPlaceName} again. These places are {actualDistanceMiles} miles away, " +
    "making this unlikely. This may indicate a bad merge.",
  FATHER_COUNT: "This person has {count} biological fathers.",
  MOTHER_COUNT: "This person has {count} biological mothers.",
  NO_COUPLE_RELATIONSHIPS_CONFLICT:
    'This person has one or more couple relationships but has a fact listed as "No Couple Relationships."',
  NO_CHILDREN_CONFLICT:
    'This person has children but has a fact listed as "No Children."',
  COUPLE_NEVER_HAD_CHILDREN_FACT_YET_HAS_CHILDREN:
    '{parent1GivenName} and {parent2GivenName} have children, but have a fact listed as "No Children."',
  STILLBIRTH_CONFLICT: "This person is marked as stillborn but lived to age {age}.",
};

// ─── issueTypes whose template varies by conclusionType (beyond article) ─────
// Keyed by `${issueType}:${conclusionType}`.
const BY_ISSUE_AND_CONCLUSION: Record<string, string> = {
  "OLD_BIRTH:CHILD_BIRTH":
    "If {childGivenName} was born {childOriginalBirthDate}, this person would have been " +
    "{actualAge}, which is normally after child bearing years.",
  "OLD_BIRTH:PARENT_BIRTH":
    "If this person was born {childOriginalBirthDate}, {parentGivenName} would have been " +
    "{actualAge}, which is normally after child bearing years.",
  "YOUNG_BIRTH:CHILD_BIRTH":
    "If {childGivenName} was born {childOriginalBirthDate}, this person would have been " +
    "{actualAge}, which is normally before child bearing years.",
  "YOUNG_BIRTH:PARENT_BIRTH":
    "If this person was born {childOriginalBirthDate}, {parentGivenName} would have been " +
    "{actualAge}, which is normally before child bearing years.",
};

// ─── IMPOSSIBLE_EVENT_ORDER ──────────────────────────────────────────────────
// These issues carry firstConclusionType/secondConclusionType instead of a
// single conclusionType. Relative-person orderings (parent/spouse/child) have
// bespoke sentences; plain event-vs-event orderings use articles on both sides.
const EVENT_ORDER_BESPOKE: Record<string, string> = {
  "DEATH:PARENT_BIRTH": "This person died before their parent, {parentGivenName}, was born.",
  "DEATH:SPOUSE_BIRTH": "This person died before their spouse, {spouseGivenName}, was born.",
  "SPOUSE_DEATH:BIRTH":
    "This person's spouse, {spouseGivenName}, died before this person was born.",
  "CHRISTENING:PARENT_BIRTH":
    "This person was christened before the birth of their parent, {parentGivenName}.",
  "BIRTH:PARENT_BIRTH":
    "This person's birth happened before the birth of their parent, {parentGivenName}.",
  "PARENT_DEATH:BIRTH":
    "This person's parent, {parentGivenName}, died before this person was born.",
  "DEATH:CHILD_BIRTH":
    "This person's death happened before the birth of their child, {childGivenName}.",
  "CHILD_BIRTH:BIRTH":
    "This birth of this person's child, {childGivenName}, happened before this person was born.",
};

function resolveEventOrderTemplate(issue: QualityIssue): string | null {
  const first = issue.firstConclusionType;
  const second = issue.secondConclusionType;
  if (typeof first !== "string" || typeof second !== "string") return null;
  const bespoke = EVENT_ORDER_BESPOKE[`${first}:${second}`];
  if (bespoke) return bespoke;
  // Plain event-vs-event: "{The/A} {first} happened before {the/a} {second}."
  const a1 = article(first, true);
  const a2 = article(second, false);
  return `${a1} {firstConclusionType} happened before ${a2} {secondConclusionType}.`;
}

// ─── Lookup + render ─────────────────────────────────────────────────────────

// Returns the template string for an issue, or null when none matches.
export function lookupTemplate(issue: QualityIssue): string | null {
  const { issueType, conclusionType } = issue;
  if (typeof issueType !== "string") return null;
  if (issueType === "IMPOSSIBLE_EVENT_ORDER") {
    return resolveEventOrderTemplate(issue);
  }
  if (typeof conclusionType === "string") {
    const specific = BY_ISSUE_AND_CONCLUSION[`${issueType}:${conclusionType}`];
    if (specific) return specific;
  }
  return BY_ISSUE_TYPE[issueType] ?? null;
}

// Fill {placeholders} in a template from the issue. {Article} and
// {conclusionType} / {firstConclusionType} / {secondConclusionType} get special
// handling; every other {token} is replaced by issue[token] verbatim (missing
// fields collapse to an empty string).
export function interpolate(template: string, issue: QualityIssue): string {
  return template
    .replace(/\{Article\}/g, article(issue.conclusionType, true))
    .replace(/\{conclusionType\}/g, humanizeConclusionType(issue.conclusionType))
    .replace(/\{firstConclusionType\}/g, humanizeConclusionType(issue.firstConclusionType))
    .replace(/\{secondConclusionType\}/g, humanizeConclusionType(issue.secondConclusionType))
    .replace(/\{(\w+)\}/g, (_match, key: string) => {
      const value = issue[key];
      return value === undefined || value === null ? "" : String(value);
    })
    .replace(/\s{2,}/g, " ")
    .trim();
}

// Fallback for issueTypes with no template (blank/"Coming Soon" PDF rows, or a
// new issueType the API adds). Never throws; never drops the issue silently.
export function fallbackSentence(issue: QualityIssue): string {
  const category = humanizeConclusionType(issue.scoreType) || "quality";
  const kind = typeof issue.issueType === "string" ? issue.issueType : "unknown issue";
  const on = issue.conclusionType
    ? ` on the ${humanizeConclusionType(issue.conclusionType)}`
    : "";
  return `A ${category} issue (${kind}) was found${on}.`;
}

// The one entry point: render an issue to its finished English sentence.
export function renderIssueSentence(issue: QualityIssue): string {
  const template = lookupTemplate(issue);
  if (template === null) return fallbackSentence(issue);
  return interpolate(template, issue);
}

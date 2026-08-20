import { getValidToken } from "../auth/refresh.js";
import { BROWSER_USER_AGENT } from "../constants.js";
import {
  toSimplified,
  standardizePlaces,
  collectFacts,
} from "../utils/gedcomx-convert.js";
import type {
  GedcomX,
  SimplifiedGedcomX,
  SimplifiedPerson,
  SimplifiedRelationship,
} from "../types/gedcomx.js";
import type {
  KinPrefix,
  KinTerm,
  RelativeTermFinding,
  RelativeTerms,
} from "../types/relative-terms.js";
import type {
  FSSearchResponse,
  FSSearchEntry,
  FSGedcomx,
  FSPerson,
  FSFact,
  RecordSearchInput,
  RecordSearchResult,
  RecordSearchEvent,
  TreeMatch,
  RecordSearchToolResponse,
} from "../types/record-search.js";
import {
  isFourDigitYear,
  normalizeSex,
  parseUpstreamErrorBody,
  echoQuery,
} from "../utils/search-helpers.js";
import { toArk } from "../utils/ark.js";
import { stageSearchResults } from "../utils/results-staging.js";
import { readProjectJson } from "../utils/project-io.js";
import { withRetry } from "../utils/place-resolver.js";
import { fetchWithTimeout } from "../utils/http.js";
import {
  isSubCountryPlace,
  marriageJurisdictionCandidates,
} from "../utils/marriage-jurisdictions.js";
import { rankSearchMatches } from "./rank-search-matches.js";

// Re-exported so existing importers (and tests) keep resolving it here.
export { parseUpstreamErrorBody };

const FS_SEARCH_URL =
  "https://www.familysearch.org/service/search/hr/v2/personas";

// Per-attempt ceiling for the FamilySearch search fetch. FS search can be slow;
// without a timeout a stalled connection hangs until the OS/transport kills it,
// which surfaces upstream as a dead turn mid-search rather than an actionable
// error (issue #1316). Retried up to 3× by fetchSearchWithRetry, so worst-case
// wall time before the terminal error is ~3×25s plus backoff.
const SEARCH_TIMEOUT_MS = 25_000;

const PAGINATION_CAP = 4999;
/** Most jurisdiction candidates a nil marriage search will offer. See below. */
const MAX_JURISDICTION_HINTS = 8;
/**
 * Emitted on every `projectPath`-carrying search that names no subject — 112 of
 * the 171 calls (65.5%) across the six committed `jimmie-jewel-neal` runlogs, the
 * complement of the 59 that carried `subjectId`. Kept short on purpose: at that
 * rate its cost is paid per call while its benefit is being un-forgettable.
 *
 * The "omit it when" clause mirrors the tool schema's own wording rather than
 * narrowing it. A person not yet in the tree is the second legitimate reason to
 * omit, and since this note is re-delivered on two thirds of all searches, a
 * narrower phrasing here is the one that would get reinforced.
 */
const RANKING_SKIPPED_NOTE =
  "No `subjectId`, so match-score ranking and marriage jurisdiction hints did " +
  "not run. Pass the tree person this search is about as `subjectId` to enable " +
  "both. Omit it only when the search is not about a specific tree person — a " +
  "broad survey, or a person not yet in the tree.";
const PERSISTENT_ID_URI = "http://gedcomx.org/Persistent";
const COLLECTION_RESOURCE_TYPE = "http://gedcomx.org/Collection";

const MARITAL_STATUS_VALUES = new Set([
  "Married",
  "Single",
  "Divorced",
  "Widowed",
]);
const RECORD_TYPE_TO_INT: Record<string, number> = {
  birth: 0,
  marriage: 1,
  death: 2,
  census: 3,
  immigration: 4,
  military: 5,
  probate: 6,
  other: 7,
};

interface EventGroup {
  prefix: string;
  apiDate: string;
  apiPlace: string;
}

const EVENT_GROUPS: EventGroup[] = [
  { prefix: "birth", apiDate: "q.birthLikeDate", apiPlace: "q.birthLikePlace" },
  { prefix: "death", apiDate: "q.deathLikeDate", apiPlace: "q.deathLikePlace" },
  {
    prefix: "marriage",
    apiDate: "q.marriageLikeDate",
    apiPlace: "q.marriageLikePlace",
  },
  {
    prefix: "residence",
    apiDate: "q.residenceDate",
    apiPlace: "q.residencePlace",
  },
  { prefix: "any", apiDate: "q.anyDate", apiPlace: "q.anyPlace" },
];

interface KinGroup {
  // Narrowed from `string` so `resolveRelativeTerms` can key a `RelativeTerms`
  // map off this without a cast (#1324).
  prefix: KinPrefix;
  apiGiven: string;
  apiSurname: string;
}

const KIN_GROUPS: KinGroup[] = [
  { prefix: "spouse", apiGiven: "q.spouseGivenName", apiSurname: "q.spouseSurname" },
  { prefix: "father", apiGiven: "q.fatherGivenName", apiSurname: "q.fatherSurname" },
  { prefix: "mother", apiGiven: "q.motherGivenName", apiSurname: "q.motherSurname" },
  { prefix: "parent", apiGiven: "q.parentGivenName", apiSurname: "q.parentSurname" },
  { prefix: "other", apiGiven: "q.otherGivenName", apiSurname: "q.otherSurname" },
];

/** Results per page when the caller doesn't say.
 *
 *  50 when ranking is active, 20 otherwise. `count: 50` was previously a
 *  SKILL.md instruction justified by "fetch a deep-enough pool for the match
 *  re-ranker" — but prose rules decay: measured over one real session it held
 *  at 100% while the skill body was resident and fell to 45% after compaction
 *  evicted it, while the re-ranker call it existed to serve fell to 3%. The
 *  session therefore paid for deep pools it never triaged.
 *
 *  Coupling the default to `subjectId` makes the pair inseparable by
 *  construction: a deep pool is only fetched when something will cut it back.
 *  See docs/plan/research-performance-2026-07-27.md §5.3. */
export function defaultCount(input: RecordSearchInput): number {
  return input.subjectId && input.projectPath ? 50 : 20;
}

export function applyAltNameAutoPair(input: RecordSearchInput): RecordSearchInput {
  const out = { ...input };
  if (out.surnameAlt && !out.givenNameAlt && out.givenName) {
    out.givenNameAlt = out.givenName;
  }
  if (out.givenNameAlt && !out.surnameAlt && out.surname) {
    out.surnameAlt = out.surname;
  }
  return out;
}

// `batchNumber` anchors on its own. The rule exists because unanchored queries
// are expensive, and a batch is the cheapest filter the API takes: a batch alone
// returns just its own extraction, not an open-ended scan. Requiring a second
// field alongside it was worse than redundant — the natural companion is
// `recordCountry`, a matching one is inert, and a MISMATCHED one silently
// returns 0, the same signal a wrong batch gives. Totals are not quoted here
// (they drift between runs); `dev/probe-batch-anchor.ts` reproduces all five
// legs and derives each verdict from its own run.
export function validateInput(input: RecordSearchInput): void {
  if (!input.surname && !input.recordCountry && !input.batchNumber) {
    throw new Error(
      "search needs at least one anchor: surname, recordCountry or batchNumber. Searches without an anchor are too expensive on the FamilySearch API."
    );
  }

  // Structural anchor for the rule above, not a second opinion on it.
  // A record-jurisdiction filter on a batch search is inert at best and
  // destructive at worst, and the destructive case is silent — a mismatched country returns 0,
  // which is the same signal a wrong batch gives. Five prose surfaces say not to
  // pair them; prose survives about three compactions (docs/architecture.md
  // §3.1), and the pairing is exactly what a half-remembered "every query needs
  // surname or recordCountry" produces. Rejecting costs nothing because a
  // MATCHING country changes no result — measured, see probe-batch-anchor.ts.
  if (input.batchNumber && (input.recordCountry || input.recordSubdivision)) {
    throw new Error(
      "do not combine batchNumber with recordCountry or recordSubdivision: a batch anchors on its own, and a record-jurisdiction filter that does not match the batch silently returns 0 (indistinguishable from a wrong batch). Drop them and send the batch alone; narrow with surname if needed."
    );
  }

  if (input.count !== undefined) {
    if (!Number.isInteger(input.count) || input.count < 1 || input.count > 100) {
      throw new Error("count must be between 1 and 100.");
    }
  }
  if (input.offset !== undefined) {
    if (!Number.isInteger(input.offset) || input.offset < 0) {
      throw new Error("offset must be non-negative.");
    }
  }
  // Ranking active (subjectId supplied) justifies a deep pool: the re-ranker
  // cuts it back host-side, so the model never sees 50 raw stubs. Without
  // ranking a deep pool is pure context waste, so the default stays 20. See
  // docs/plan/research-performance-2026-07-27.md §5.3 — the two are coupled.
  const count = input.count ?? defaultCount(input);
  const offset = input.offset ?? 0;
  if (offset + count > PAGINATION_CAP) {
    throw new Error(
      "offset + count must be <= 4999 (FamilySearch search depth limit). Narrow the query instead of paging deeper."
    );
  }

  for (const group of EVENT_GROUPS) {
    const fromKey = `${group.prefix}YearFrom` as keyof RecordSearchInput;
    const toKey = `${group.prefix}YearTo` as keyof RecordSearchInput;
    const from = input[fromKey] as number | undefined;
    const to = input[toKey] as number | undefined;
    if (from !== undefined && !isFourDigitYear(from)) {
      throw new Error(
        `${String(fromKey)} must be a 4-digit year (e.g., 1809).`
      );
    }
    if (to !== undefined && !isFourDigitYear(to)) {
      throw new Error(
        `${String(toKey)} must be a 4-digit year (e.g., 1809).`
      );
    }
    if ((from === undefined) !== (to === undefined)) {
      throw new Error(
        `${group.prefix}YearFrom and ${group.prefix}YearTo must be provided together.`
      );
    }
    if (from !== undefined && to !== undefined && from > to) {
      throw new Error(
        `${group.prefix}YearFrom must be <= ${group.prefix}YearTo.`
      );
    }
  }

  if (input.recordSubdivision && !input.recordCountry) {
    throw new Error("recordSubdivision requires recordCountry.");
  }

  if (input.sex !== undefined) {
    const normalized = normalizeSex(input.sex);
    if (!normalized) {
      throw new Error(
        "sex must be 'Male', 'Female', or 'Unknown' (case-insensitive)."
      );
    }
  }

  if (
    input.maritalStatus !== undefined &&
    !MARITAL_STATUS_VALUES.has(input.maritalStatus)
  ) {
    throw new Error(
      "maritalStatus must be exactly one of: 'Married', 'Single', 'Divorced', 'Widowed' (case-sensitive)."
    );
  }

  // Object.hasOwn, not `in`: `in` walks the prototype chain, so the
  // LLM-supplied `recordType: "constructor"` would satisfy the guard and then
  // index out `Object` at the buildSearchUrl call below, sending
  // `f.recordType=function%20Object()%20{...}` upstream instead of rejecting.
  if (
    input.recordType !== undefined &&
    !Object.hasOwn(RECORD_TYPE_TO_INT, input.recordType)
  ) {
    throw new Error(
      "recordType must be one of: birth, marriage, death, census, immigration, military, probate, other."
    );
  }
}

export function buildSearchUrl(input: RecordSearchInput): string {
  const params: string[] = [];
  const add = (key: string, value: string | number | boolean): void => {
    params.push(`${key}=${encodeURIComponent(String(value))}`);
  };

  if (input.surname) add("q.surname", input.surname);
  if (input.givenName) add("q.givenName", input.givenName);
  if (input.surnameAlt) add("q.surname.1", input.surnameAlt);
  if (input.givenNameAlt) add("q.givenName.1", input.givenNameAlt);

  if (input.sex) {
    const normalized = normalizeSex(input.sex);
    if (normalized) add("q.sex", normalized);
  }

  if (input.surnameExact) {
    add("q.surname.exact", "on");
    if (input.surnameAlt) add("q.surname.exact.1", "on");
  }
  if (input.givenNameExact) {
    add("q.givenName.exact", "on");
    if (input.givenNameAlt) add("q.givenName.exact.1", "on");
  }

  for (const group of EVENT_GROUPS) {
    const fromKey = `${group.prefix}YearFrom` as keyof RecordSearchInput;
    const toKey = `${group.prefix}YearTo` as keyof RecordSearchInput;
    const exactKey = `${group.prefix}YearExact` as keyof RecordSearchInput;
    const placeKey = `${group.prefix}Place` as keyof RecordSearchInput;
    const placeExactKey = `${group.prefix}PlaceExact` as keyof RecordSearchInput;

    const from = input[fromKey] as number | undefined;
    const to = input[toKey] as number | undefined;
    if (from !== undefined && to !== undefined) {
      add(`${group.apiDate}.from`, from);
      add(`${group.apiDate}.to`, to);
    }
    if (input[exactKey]) add(`${group.apiDate}.exact`, "on");

    const place = input[placeKey] as string | undefined;
    if (place) add(group.apiPlace, place);
    if (input[placeExactKey]) add(`${group.apiPlace}.exact`, "on");
  }

  for (const group of KIN_GROUPS) {
    const givenKey = `${group.prefix}GivenName` as keyof RecordSearchInput;
    const surnameKey = `${group.prefix}Surname` as keyof RecordSearchInput;
    const givenExactKey = `${group.prefix}GivenNameExact` as keyof RecordSearchInput;
    const surnameExactKey = `${group.prefix}SurnameExact` as keyof RecordSearchInput;

    const given = input[givenKey] as string | undefined;
    const surname = input[surnameKey] as string | undefined;
    if (given) add(group.apiGiven, given);
    if (surname) add(group.apiSurname, surname);
    if (input[givenExactKey]) add(`${group.apiGiven}.exact`, "on");
    if (input[surnameExactKey]) add(`${group.apiSurname}.exact`, "on");
  }

  if (input.collectionId !== undefined) add("f.collectionId", input.collectionId);
  if (input.imageGroupNumber) add("q.filmNumber", input.imageGroupNumber);
  // Verified live 2026-08-11: `q.batchNumber=M01048-5` returns several thousand
  // records, a nonsense batch returns 0 rather than being ignored, and it
  // combines with a surname to search within one batch. Totals are not quoted:
  // no committed probe section produces them, so a figure here would trace to
  // nothing. The parameter existed upstream all along; the tool simply
  // never exposed it, so the parish-enumeration strategy the collection-quirks
  // reference documents was unexecutable from this skill.
  if (input.batchNumber) add("q.batchNumber", input.batchNumber);
  if (input.recordCountry) add("q.recordCountry", input.recordCountry);
  if (input.recordSubdivision && input.recordCountry) {
    add(
      "q.recordSubcountry",
      `${input.recordCountry},${input.recordSubdivision}`
    );
  }
  // hasOwn again, not just a truthiness check: buildSearchUrl is exported and
  // reachable without validateInput, so the emit site keeps the invariant on
  // its own rather than trusting the caller to have validated first.
  if (input.recordType && Object.hasOwn(RECORD_TYPE_TO_INT, input.recordType)) {
    add("f.recordType", RECORD_TYPE_TO_INT[input.recordType]);
  }
  if (input.maritalStatus) add("f.maritalStatus", input.maritalStatus);
  if (input.isPrincipal !== undefined) add("q.isPrincipal", input.isPrincipal);

  add("count", input.count ?? defaultCount(input));
  add("offset", input.offset ?? 0);

  add("m.queryRequireDefault", "on");
  add("m.defaultFacets", "off");

  return `${FS_SEARCH_URL}?${params.join("&")}`;
}

/**
 * How confidently the persona was identified inside the entry.
 *
 * `ark` is a positive identification: the entry's own id matched a persistent
 * identifier on that person. `principal` is a fallback guess, and #1093's live
 * probe showed why it cannot be trusted to anchor relatives — when the search
 * matched the father himself, resolving relatives against the principal returns
 * the searched person and "makes a silent record look like a contradicting
 * one." `resolveRelativeTerms` refuses to answer on a `principal` anchor.
 */
export type PersonaAnchor = "ark" | "principal";

export function findRepresentedPerson(
  entry: FSSearchEntry,
): { person: FSPerson; anchor: PersonaAnchor } | null {
  const persons = entry.content?.gedcomx?.persons ?? [];
  if (persons.length === 0) return null;

  const entryId = entry.id;
  if (entryId) {
    for (const p of persons) {
      const arks = p.identifiers?.[PERSISTENT_ID_URI] ?? [];
      if (arks.some((url) => url.endsWith(entryId))) {
        return { person: p, anchor: "ark" };
      }
    }
  }

  const principal = persons.find((p) => p.principal === true);
  return principal ? { person: principal, anchor: "principal" } : null;
}

/** Which relative terms the caller supplied a NAME for, and the names (#1324).
 *
 * The `*Exact` booleans deliberately do not count: `fatherGivenNameExact` with
 * no `fatherGivenName` sends no `q.fatherGivenName` at all, so no father
 * constraint was applied and there is nothing to report on.
 */
export function suppliedKinTerms(input: RecordSearchInput): KinTerm[] {
  const out: KinTerm[] = [];
  const record = input as unknown as Record<string, unknown>;
  for (const group of KIN_GROUPS) {
    const given = record[`${group.prefix}GivenName`];
    const surname = record[`${group.prefix}Surname`];
    if (!given && !surname) continue;
    out.push({
      prefix: group.prefix,
      ...(typeof given === "string" ? { given } : {}),
      ...(typeof surname === "string" ? { surname } : {}),
    });
  }
  return out;
}

/** `present` with a name when one can be built, without when it cannot.
 *
 * `simplifyName` writes `given`/`surname` and no `fullText`, so the
 * `display?.name` path `mapEntry` uses for its own `personName` is unavailable
 * here and the parts must be joined. 7 of 83 real parents carry no `surname`,
 * so the join tolerates a missing half; if it yields nothing we still report
 * `present`, because presence is established by the relationship, not the name.
 */
function presentWithName(person: SimplifiedPerson): RelativeTermFinding {
  const name = [person.names?.[0]?.given, person.names?.[0]?.surname]
    .filter(Boolean)
    .join(" ");
  return name ? { status: "present", name } : { status: "present" };
}

/**
 * `father` / `mother` / `parent` against the persona's ParentChild rows.
 *
 * Three ordered branches, and the order is the whole safety property:
 *
 *   1. `present` — a parent of the asked-for sex is on the record.
 *   2. `unknown` — some parent's sex could not be established (absent `gender`,
 *      the literal `"Unknown"`, or an endpoint id naming nobody in `persons[]`).
 *   3. `absent`  — every parent was established and none is that sex, or there
 *      are no parent rows at all.
 *
 * Indeterminacy is checked BEFORE absence so "we could not establish the sex"
 * can never become a denial. But absence is still reachable: a record naming
 * only the mother genuinely IS evidence that no father was indexed, and that is
 * the signal #1324 exists to surface. 20 of the 384 surveyed results sit in that
 * cell, so collapsing this to a single "not provably Male → unknown" predicate
 * would quietly destroy the feature's main output on exactly the records that
 * carry the most information.
 */
function resolveParentTerm(
  relationships: SimplifiedRelationship[],
  persons: Map<string, SimplifiedPerson>,
  primaryId: string,
  prefix: "father" | "mother" | "parent",
): RelativeTermFinding {
  const wantedSex =
    prefix === "father" ? "Male" : prefix === "mother" ? "Female" : undefined;

  const candidates: SimplifiedPerson[] = [];
  let unresolvableEndpoint = false;

  for (const rel of relationships) {
    if (rel.type !== "ParentChild" || rel.child !== primaryId) continue;
    if (rel.parent === undefined) {
      unresolvableEndpoint = true;
      continue;
    }
    const parent = persons.get(rel.parent);
    if (!parent) {
      unresolvableEndpoint = true;
      continue;
    }
    candidates.push(parent);
  }

  // `parent` is sex-agnostic — it mirrors `q.parentGivenName`, which is what a
  // caller uses precisely when they do not know the sex. The sex gate must not
  // leak into it.
  if (wantedSex === undefined) {
    if (candidates.length > 0) return presentWithName(candidates[0]);
    return unresolvableEndpoint ? { status: "unknown" } : { status: "absent" };
  }

  const match = candidates.find((p) => p.gender === wantedSex);
  if (match) return presentWithName(match);

  const anyUnprovableSex = candidates.some(
    (p) => p.gender !== "Male" && p.gender !== "Female",
  );
  if (unresolvableEndpoint || anyUnprovableSex) return { status: "unknown" };

  return { status: "absent" };
}

/** `spouse` against the persona's Couple rows.
 *
 * Reports the endpoint that is NOT the persona. A Couple row is symmetric and
 * the persona may be either `person1` or `person2`, so reading a fixed side
 * would report the searched person as their own spouse on half the records.
 * When both endpoints are the persona, or the other endpoint names nobody in
 * `persons[]`, the answer is `unknown` rather than `absent`.
 */
function resolveSpouseTerm(
  relationships: SimplifiedRelationship[],
  persons: Map<string, SimplifiedPerson>,
  primaryId: string,
): RelativeTermFinding {
  let unresolvableEndpoint = false;

  for (const rel of relationships) {
    if (rel.type !== "Couple") continue;
    const { person1, person2 } = rel;
    if (person1 !== primaryId && person2 !== primaryId) continue;

    const otherId = person1 === primaryId ? person2 : person1;
    if (otherId === undefined || otherId === primaryId) {
      unresolvableEndpoint = true;
      continue;
    }
    const spouse = persons.get(otherId);
    if (!spouse) {
      unresolvableEndpoint = true;
      continue;
    }
    // First in document order. `name` is one name, not a list; a caller needing
    // the full picture reads the record.
    return presentWithName(spouse);
  }

  return unresolvableEndpoint ? { status: "unknown" } : { status: "absent" };
}

/** Case- and punctuation-insensitive comparison of one name part. */
function namePartMatches(queried: string | undefined, found: string | undefined): boolean {
  if (!queried) return true; // caller did not constrain this half
  if (!found) return false;
  const norm = (s: string) => s.toLowerCase().replace(/[.,'`-]/g, "").trim();
  return norm(queried) === norm(found);
}

/**
 * `other` — a co-occurring person of unspecified relationship.
 *
 * Unlike the other four prefixes there is no relationship role to resolve
 * against, so the only available question is whether any co-person's NAME
 * answers the query. That makes its status vocabulary genuinely narrower, and
 * pretending otherwise is what makes this field dangerous:
 *
 * - `present` — a co-person's name matches. A real positive, and `name` says who.
 * - `unknown` — co-people exist, none matches by name. NOT `absent`: we compare
 *   names exactly (bar case and punctuation) while FamilySearch matched fuzzily,
 *   so a `Wm.`-vs-`William` miss here means "we could not confirm it", never
 *   "the person is not on this record".
 * - `absent` — the record carries no co-person at all. Rare: all 384 surveyed
 *   real results are multi-person, since search entries carry the whole
 *   household. Kept because a one-person entry is legal, not because it is common.
 *
 * The `absent` that IS reachable for father/mother/spouse rests on the record
 * positively naming someone else in that role. No such evidence exists here, so
 * no such denial is offered.
 */
function resolveOtherTerm(
  persons: Map<string, SimplifiedPerson>,
  primaryId: string,
  term: KinTerm,
): RelativeTermFinding {
  let coPersonCount = 0;
  for (const [id, person] of persons) {
    if (id === primaryId) continue;
    coPersonCount += 1;
    const name = person.names?.[0];
    if (
      namePartMatches(term.given, name?.given) &&
      namePartMatches(term.surname, name?.surname)
    ) {
      return presentWithName(person);
    }
  }
  return coPersonCount === 0 ? { status: "absent" } : { status: "unknown" };
}

/**
 * Per-result answer to "is the relative I anchored on actually on this record?"
 *
 * Pure — no I/O — and reads the SIMPLIFIED doc `mapEntry` has already built, so
 * every case is unit-testable without a fetch mock.
 *
 * Returns `undefined` when the caller supplied no relative name, so the field is
 * omitted rather than emitted empty.
 */
export function resolveRelativeTerms(
  gedcomx: SimplifiedGedcomX | undefined,
  primaryId: string | undefined,
  terms: readonly KinTerm[],
  anchor: PersonaAnchor,
): RelativeTerms | undefined {
  if (terms.length === 0) return undefined;

  const allUnknown = (): RelativeTerms =>
    Object.fromEntries(
      terms.map((t) => [t.prefix, { status: "unknown" as const }]),
    ) as RelativeTerms;

  // Anchor is a guess — see `PersonaAnchor`.
  if (anchor !== "ark") return allUnknown();
  // The persona could not be identified inside the graph at all.
  if (!primaryId) return allUnknown();

  const persons = new Map<string, SimplifiedPerson>();
  for (const p of gedcomx?.persons ?? []) {
    if (p.id) persons.set(p.id, p);
  }

  // No graph to read. An empty array is NOT the same as "resolves cleanly and
  // yields nobody": we cannot tell "no father recorded" from "relationships not
  // returned for this entry", so all three shapes are `unknown`. `other` is
  // exempt — it reads `persons[]`, not the relationship graph, so a missing
  // graph does not blind it.
  const relationships = gedcomx?.relationships ?? [];
  const graphUnusable = relationships.length === 0;

  const out: RelativeTerms = {};
  for (const term of terms) {
    if (term.prefix === "other") {
      out.other = resolveOtherTerm(persons, primaryId, term);
    } else if (graphUnusable) {
      out[term.prefix] = { status: "unknown" };
    } else if (term.prefix === "spouse") {
      out.spouse = resolveSpouseTerm(relationships, persons, primaryId);
    } else {
      out[term.prefix] = resolveParentTerm(
        relationships,
        persons,
        primaryId,
        term.prefix,
      );
    }
  }
  return out;
}

export function extractEvent(fact: FSFact): RecordSearchEvent | null {
  const date = fact.date?.original;
  const place = fact.place?.original;
  const value = fact.value;
  if (!date && !place && !value) return null;

  const segments = fact.type.split("/");
  const type = segments[segments.length - 1] || fact.type;

  const event: RecordSearchEvent = { type };
  if (date) event.date = date;
  if (place) event.place = place;
  if (value) event.value = value;
  return event;
}

function lastPathSegment(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const segments = value.split("/");
  return segments[segments.length - 1] || undefined;
}

// Hints carry tree-person ARKs like "ark:/61903/4:1:GQWZ-GPX". The bare
// tree-person ID (what /platform/tree/persons/{id} expects) is the suffix
// after the last colon.
function parseTreePersonId(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const lastSlashSegment = value.split("/").pop() ?? "";
  const segments = lastSlashSegment.split(":");
  return segments[segments.length - 1] || undefined;
}

function endsWithBirth(type: string): boolean {
  return type.endsWith("/Birth");
}
function endsWithDeath(type: string): boolean {
  return type.endsWith("/Death");
}

function pickFactOriginal(
  facts: FSFact[],
  predicate: (type: string) => boolean,
  field: "date" | "place"
): string | undefined {
  for (const fact of facts) {
    if (!predicate(fact.type)) continue;
    if (field === "date" && fact.date?.original) return fact.date.original;
    if (field === "place" && fact.place?.original) return fact.place.original;
  }
  return undefined;
}

/**
 * The extraction batch a record came out of, read off the gedcomx ROOT's
 * `fields[]`. Feed it back as `batchNumber` to enumerate the rest of the batch
 * (#1592) — the step that closes the loop `collection-quirks.md` has prescribed
 * since before the input parameter existed.
 *
 * Matched on `labelId` ALONE, never on the `type` URI, and that is the whole
 * reason this is a named function rather than an inline find. The type suffix is
 * spelled BOTH `UdeBatchNbr` and `UdeBatchNumber` depending on the collection —
 * `q.batchNumber=B01883-5` and an English IGI batch return the former, while
 * collection 1494474 (Germany) and `q.batchNumber=8317102` return the latter,
 * with nothing caller-visible to predict it from. `labelId` was
 * `FS_UDE_BATCH_NBR` on every record measured, across both spellings.
 *
 * Keying on one type spelling — which is what issue #1592's own quoted payload
 * would have led to — returns nothing on the collections using the other, and a
 * batch that is present upstream but unread here is indistinguishable from a
 * record that has none, so the miss is silent. Matching type as well as labelId
 * would carry that same risk forward for a third spelling while excluding
 * nothing: no other field in the corpus uses this labelId. See
 * `dev/probe-batch-field.ts`.
 *
 * Reads only the ROOT array. `fields` also appears on persons, names, facts and
 * places, where it carries `PR_AGE` / `Role` and never a batch.
 */
function extractBatchNumber(
  gedcomx: FSGedcomx | undefined,
): string | undefined {
  for (const field of gedcomx?.fields ?? []) {
    for (const value of field.values ?? []) {
      if (value.labelId === "FS_UDE_BATCH_NBR" && value.text) return value.text;
    }
  }
  return undefined;
}

export function mapEntry(
  entry: FSSearchEntry,
  terms: readonly KinTerm[] = [],
): RecordSearchResult | null {
  const represented = findRepresentedPerson(entry);
  if (!represented) return null;
  const { person, anchor } = represented;
  if (!entry.id) return null;

  const facts = person.facts ?? [];
  const display = person.display;

  const personName =
    display?.name ?? person.names?.[0]?.nameForms?.[0]?.fullText;

  let sex: string | undefined;
  if (display?.gender) {
    sex = display.gender;
  } else if (person.gender?.type) {
    sex = lastPathSegment(person.gender.type);
  }

  const birthDate =
    display?.birthDate ?? pickFactOriginal(facts, endsWithBirth, "date");
  const birthPlace =
    display?.birthPlace ?? pickFactOriginal(facts, endsWithBirth, "place");
  const deathDate =
    display?.deathDate ?? pickFactOriginal(facts, endsWithDeath, "date");
  const deathPlace =
    display?.deathPlace ?? pickFactOriginal(facts, endsWithDeath, "place");

  const events: RecordSearchEvent[] = [];
  for (const fact of facts) {
    if (endsWithBirth(fact.type) || endsWithDeath(fact.type)) continue;
    const event = extractEvent(fact);
    if (event) events.push(event);
  }

  // Canonical 1:1: record-persona ARK. Prefer the persona's Persistent ARK
  // (the URL FamilySearch returns); fall back to constructing one from
  // entry.id (always a 1:1: persona in this search).
  const personaArkUrl = person.identifiers?.[PERSISTENT_ID_URI]?.[0];
  const recordId = personaArkUrl
    ? toArk(personaArkUrl)
    : /^\d:\d:/.test(entry.id)
      ? toArk(entry.id)
      : `ark:/61903/1:1:${entry.id}`;

  const sourceDescriptions = entry.content?.gedcomx?.sourceDescriptions ?? [];
  const collectionSd = sourceDescriptions.find(
    (sd) => sd.resourceType === COLLECTION_RESOURCE_TYPE
  );
  let collectionId: string | undefined;
  let collectionTitle: string | undefined;
  let collectionUrl: string | undefined;
  if (collectionSd) {
    collectionUrl = collectionSd.about;
    collectionTitle = collectionSd.titles?.[0]?.value;
    if (collectionUrl) {
      const match = collectionUrl.match(/\/collections\/([^/?#]+)/);
      if (match) collectionId = match[1];
    }
  }

  const recordSd = sourceDescriptions.find(
    (sd) => sd !== collectionSd && (sd.titles?.length || sd.identifiers)
  );
  const recordTitle = recordSd?.titles?.[0]?.value;
  const recordSourceArkUrl = recordSd?.identifiers?.[PERSISTENT_ID_URI]?.[0];

  const treeMatches: TreeMatch[] = (entry.hints ?? [])
    .map((hint) => {
      const id = parseTreePersonId(hint.id);
      if (!id) return null;
      return { treePersonId: id, stars: hint.stars ?? 0 };
    })
    .filter((m): m is TreeMatch => m !== null)
    .sort((a, b) => b.stars - a.stars);

  const result: RecordSearchResult = {
    recordId,
    events,
    treeMatches,
  };
  if (personName) result.personName = personName;
  if (entry.score !== undefined) result.score = entry.score;
  if (entry.confidence !== undefined) result.confidence = entry.confidence;
  if (sex) result.sex = sex;
  if (birthDate) result.birthDate = birthDate;
  if (birthPlace) result.birthPlace = birthPlace;
  if (deathDate) result.deathDate = deathDate;
  if (deathPlace) result.deathPlace = deathPlace;
  if (collectionId) result.collectionId = collectionId;
  if (collectionTitle) result.collectionTitle = collectionTitle;
  if (collectionUrl) result.collectionUrl = collectionUrl;
  if (recordTitle) result.recordTitle = recordTitle;
  if (recordSourceArkUrl) result.recordArk = toArk(recordSourceArkUrl);

  // Carry the simplified GedcomX so downstream tools (same_person)
  // get the real records, not a hand-rebuilt approximation. The FS search
  // payload is full GedcomX at runtime; FSGedcomx is just a narrower
  // declaration of the fields mapEntry reads, hence the cast.
  const rawGedcomx = entry.content?.gedcomx;
  if (rawGedcomx) {
    result.gedcomx = toSimplified(rawGedcomx as unknown as GedcomX);
  }
  if (person.id) result.primaryId = person.id;

  // Read off the RAW gedcomx, not `result.gedcomx`: `toSimplified` does not
  // carry the root `fields[]` into the simplified document, and — like
  // `relativeTerms` below — this has to be resolved before the staged slim block
  // deletes `result.gedcomx` anyway.
  const batchNumber = extractBatchNumber(rawGedcomx);
  if (batchNumber) result.batchNumber = batchNumber;

  // Resolved HERE, before the staged slim block deletes `result.gedcomx`, so the
  // finding survives into both the inline response and the staged sidecar
  // (#1324). Resolving it downstream of the slim would be resolving against
  // nothing.
  const relativeTerms = resolveRelativeTerms(
    result.gedcomx,
    result.primaryId,
    terms,
    anchor,
  );
  if (relativeTerms) result.relativeTerms = relativeTerms;

  return result;
}

/**
 * One FamilySearch search fetch with a per-attempt timeout, shaped for retry by
 * `withRetry` (#1316). The retryable-vs-terminal decision is made by throw-vs-return,
 * so `withRetry`'s "retry every thrown error" contract is exactly right and needs no
 * predicate:
 *   - THROW on transient states — 429, 5xx, and any `fetch` rejection (network error
 *     or the AbortSignal.timeout firing) — so `withRetry` retries them.
 *   - RETURN the response for 2xx and for permanent 4xx (400/401/403/404), so the
 *     caller's `!response.ok` block handles them once, without retrying.
 * `fetchWithTimeout` creates a fresh `AbortSignal.timeout` on every call, i.e. per
 * attempt, because `withRetry` invokes this function anew each time (an aborted
 * signal can't be reused).
 */
async function fetchSearchWithRetry(
  url: string,
  token: string
): Promise<Response> {
  const response = await fetchWithTimeout(
    url,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Accept-Language": "en",
        "User-Agent": BROWSER_USER_AGENT,
      },
    },
    SEARCH_TIMEOUT_MS
  );
  if (response.status === 429 || response.status >= 500) {
    throw new Error(
      `FamilySearch search API error: ${response.status} ${response.statusText}`
    );
  }
  return response;
}

export async function recordSearchTool(
  input: RecordSearchInput
): Promise<RecordSearchToolResponse> {
  validateInput(input);

  const normalizedInput: RecordSearchInput = { ...input };
  if (normalizedInput.sex) {
    normalizedInput.sex = normalizeSex(normalizedInput.sex) ?? normalizedInput.sex;
  }
  const paired = applyAltNameAutoPair(normalizedInput);

  const token = await getValidToken();
  const url = buildSearchUrl(paired);

  // #1316: a timed-out or transiently-failed search must surface as an explicit,
  // distinguishable error the agent reacts to — never as a short/empty result set
  // that reads like an exhaustive search. A bare fetch had no timeout (a slow FS
  // connection hung the turn) and no retry (one blip was fatal). fetchSearchWithRetry
  // adds a per-attempt timeout and THROWS on transient states (429/5xx, network,
  // timeout) so withRetry retries them; permanent 4xx (400/401/403) are RETURNED
  // and handled unchanged by the `!response.ok` block below (retrying them is
  // pointless). getValidToken() stays outside the retry so an auth failure surfaces
  // immediately without re-authenticating per attempt.
  let response: Response;
  try {
    response = await withRetry(() => fetchSearchWithRetry(url, token), {
      attempts: 3,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `FamilySearch record search did not complete after 3 attempts ` +
        `(network timeout or transient error): ${detail}. This is a transient ` +
        `failure, NOT an empty result — coverage is unknown.`
    );
  }

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error(
        "FamilySearch session not accepted; call the login tool to re-authenticate."
      );
    }
    if (response.status === 403) {
      throw new Error(
        "FamilySearch search blocked the request. The User-Agent header was rejected by the WAF — check that the MCP server is running an unmodified build."
      );
    }
    if (response.status === 400) {
      let detail: string | null = null;
      try {
        const body = await response.json();
        detail = parseUpstreamErrorBody(body);
      } catch {
        detail = null;
      }
      if (detail) {
        throw new Error(`FamilySearch search rejected the query: ${detail}.`);
      }
      throw new Error(
        `FamilySearch search rejected the query (400 ${response.statusText}).`
      );
    }
    // Only NON-retryable non-OK statuses reach here (e.g. 404). 429/5xx are
    // intercepted and thrown inside fetchSearchWithRetry, so they are retried
    // and, if still failing, surface via the terminal error above — never here.
    throw new Error(
      `FamilySearch search API error: ${response.status} ${response.statusText}`
    );
  }

  const data: FSSearchResponse = await response.json();
  const entries = data.entries ?? [];
  // Not point-free: `.map(mapEntry)` would pass the array index as `terms`.
  const kinTerms = suppliedKinTerms(input);
  const results = entries
    .map((entry) => mapEntry(entry, kinTerms))
    .filter((r): r is RecordSearchResult => r !== null);

  // Standardize places across the whole response in one pass (dedup spans all
  // entries; the resolver caches identical strings). Best-effort — never throws.
  await standardizePlaces(
    results.flatMap((r) => (r.gedcomx ? collectFacts(r.gedcomx) : [])),
  );

  const out: RecordSearchToolResponse = {
    query: echoQuery(input),
    totalMatches: data.results ?? 0,
    paginationCappedAt: PAGINATION_CAP,
    returned: results.length,
    offset: data.index ?? input.offset ?? 0,
    hasMore: data.links?.next?.href != null,
    // Placed before `results` because the run-log capture bounds response size
    // and `results` is the largest field, so a trailing field is what gets
    // dropped first. Belt and braces with the capture fix in
    // `eval/harness/e2e/orchestrator.py`: this response has more than one
    // consumer and only one of them is being widened here.
    //
    // The condition is `projectPath` present and `subjectId` absent, and NOTHING
    // else. No tree read, no name/date matching, no attempt to judge whether the
    // search "looked like" it was about a tree person — that test is a heuristic,
    // and gating the signal on an unvalidated heuristic would bias the very
    // coverage measurement the signal exists to produce. A caller running a
    // legitimate broad survey gets one extra short field; whether an omission was
    // legitimate is answered at analysis time from the args already in the runlog.
    //
    // Truthiness, not `=== undefined`, on `subjectId`, so an empty string reports
    // the same way the ranking gate below treats it.
    //
    // The two conditions are NOT equivalent, in two directions, and the note's
    // contract is the weaker of them — "absence means a subject was named", never
    // "ranking ran":
    //   - ranking additionally needs `out.staged`, so a nil search WITH a subject
    //     skips ranking and correctly gets no note (4 of the 18 subject-carrying
    //     calls in `run-2026-07-31_13-02-13`);
    //   - and this uses `projectPath !== undefined` where ranking uses truthiness
    //     plus successful staging, so `projectPath: ""` or a path that does not
    //     exist emits the note while supplying `subjectId` would still enable
    //     nothing. Both leave a `stagingError` on the response, which is the
    //     accurate signal for that case; per #1073 this condition is the args
    //     alone and must not start reading staging state.
    ...(input.projectPath !== undefined && !input.subjectId
      ? { rankingSkipped: RANKING_SKIPPED_NOTE }
      : {}),
    results,
  };

  // Host-side result staging (search-result-staging-spec.md). Purely additive
  // and best-effort: a staging failure never fails a successful search.
  if (input.projectPath !== undefined) {
    try {
      // `rankingSkipped` is withheld from what gets staged. The staged envelope
      // becomes `results/<logId>.json` — shared project state that moves between
      // machines, and a record of what the upstream search RETURNED. This field
      // is neither: it is a model-facing instruction about how to call the tool
      // better next time, and it would otherwise be retained in 112 of 171
      // sidecars on a real run. Same reasoning as the `projectPath`/`subjectId`
      // strip inside `finalizeStagedResults`.
      //
      // Withheld HERE and not inside `stageSearchResults`, which is shared by
      // `record_search`, `fulltext_search` and `external_links_search` and should
      // not know one caller's field names. Destructuring a copy also keeps `out`
      // itself untouched, so the live response the model reads is unaffected and
      // the key order (`rankingSkipped` before `results`) is preserved in both.
      const { rankingSkipped: _advisory, ...persistable } = out;
      out.staged = await stageSearchResults({
        projectPath: input.projectPath,
        tool: "record_search",
        response: persistable,
      });
    } catch (error) {
      out.staged = null;
      out.stagingError = error instanceof Error ? error.message : String(error);
    }
  }

  // Whenever results were staged, slim the INLINE projection so a broad search
  // can't overflow the model's context — the bulk lives in the staged file,
  // which rank_search_matches (and record_read) read host-side, and the
  // remaining flat stub fields still carry names/dates/places for triage. This
  // is unconditional (no opt-in flag): once staged, nothing needs the dropped
  // fields inline, so the overflow protection can't be forgotten by the caller.
  //
  // Safe because the staged file is already serialized to disk by the awaited
  // stageSearchResults above, so mutating the inline copy cannot corrupt the
  // sidecar — the sidecar, the viewer's SidecarResultCard, and the eval fixtures
  // all keep full fidelity. Never slim when `staged` is null (an un-staged
  // exploratory search — nothing was retained to re-read from).
  //
  // Measured against the 3,380 rows of a real 140-search session: gedcomx aside,
  // collectionUrl was 14.0% of row bytes, collectionTitle 9.4%, empty
  // treeMatches 2.9%. primaryId (4.6%) is deliberately KEPT — rank_search_matches
  // skips any candidate lacking it (rank-search-matches.ts), so dropping it would
  // silently disable the re-ranker.
  //
  // `batchNumber` is KEPT for the same class of reason (#1592): it is the only
  // route to a batch the agent can enumerate, and the staged case is the normal
  // one — dropping it here would leave the field working only in the exploratory
  // searches nobody logs. Being flat and top-level, it survives this block by
  // construction; the test that pins it is what stops a future `delete`.
  //
  // It is not free on every call shape, and the cheap-looking dedupe is declined
  // deliberately. On an ordinary search most rows carry none. On a
  // BATCH-ANCHORED search every row repeats the batch the caller just sent —
  // ~25 bytes x `count`, already echoed in `query.batchNumber`. Suppressing it
  // when it equals `input.batchNumber` would save that, at the cost of making
  // presence depend on how the search was phrased: the same record would carry
  // the field or not depending on the query, and a row read out of the staged
  // sidecar (where `query` is a sibling, not an ancestor) would lose its only
  // copy. A field whose meaning is stable is worth more here than 2.5 KB on the
  // one call shape where the caller demonstrably already knows the value.
  if (out.staged) {
    const collections: Record<string, string> = {};
    for (const r of out.results) {
      delete r.gedcomx;

      // Derivable from collectionId; nothing reads it off the inline stub.
      delete r.collectionUrl;

      // Hoist the repeated per-row title into one response-level map.
      if (r.collectionId && r.collectionTitle) {
        collections[r.collectionId] = r.collectionTitle;
        delete r.collectionTitle;
      }

      // `treeMatches: []` on most rows — say nothing instead of saying "none".
      if (Array.isArray(r.treeMatches) && r.treeMatches.length === 0) {
        delete (r as Partial<RecordSearchResult>).treeMatches;
      }

      // FamilySearch repeats identical event entries (e.g. the same Census
      // date+place twice). Exact-duplicate removal only — no type filtering,
      // since Race/MaritalStatus are real triage signal.
      if (Array.isArray(r.events) && r.events.length > 1) {
        const seen = new Set<string>();
        r.events = r.events.filter((e) => {
          const k = JSON.stringify(e);
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });
      }
    }
    if (Object.keys(collections).length > 0) out.collections = collections;
  }

  // Rank host-side when the caller named a subject. This is the "always call
  // rank_search_matches" rule turned into a tool contract — a documented step
  // decays under compaction (77% → 3% in one measured session), a contract
  // cannot. `rank_search_matches` remains a standalone tool: it is still the
  // way to re-rank a finalized results/<log_id>.json later, and the way to rank
  // against a different subject than the one searched for.
  //
  // Strictly best-effort. The original reason these were separate tools was
  // graceful degradation — "a matcher throttle slows ranking, not search" — and
  // that property is preserved here: any ranking failure leaves the search
  // result intact and merely sets `rankingError`. Ranking is read-only
  // (scoring + a staged-file read), so unlike a folded log write it introduces
  // no partial-failure state.
  if (out.staged && input.subjectId && input.projectPath) {
    try {
      out.ranked = await rankSearchMatches({
        projectPath: input.projectPath,
        stagedResultsRef: out.staged.resultsRef,
        subjectId: input.subjectId,
        checkAttachments: true,
      });
    } catch (error) {
      out.rankingError = error instanceof Error ? error.message : String(error);
    }
  }

  // A nil marriage search is a prompt, not a finding. Same reasoning as the
  // ranking contract above: the rule "when a marriage search comes back empty,
  // try where the couple were EARLIER, because marriage precedes migration" is
  // one the model is supposed to remember and measurably does not. Across four
  // scored `jimmie-jewel-neal` runs every marriage search stayed in the family's
  // later residence — the jurisdiction the tree's own marriage fact named —
  // while the answering record sat in the husband's birth state, a fact already
  // present in the same tree. Computing the alternatives is date arithmetic over
  // places the tree already holds, so the tool does it instead of asking.
  //
  // Fires on a search that did not find the subject here — either literally no
  // hits, or hits that ranking judged to hold no match (`subjectResolvable`
  // false). The ranker sets that in TWO branches — a scoreable subject against a
  // pool with no match, and a subject too thin to discriminate — and the hint
  // fires on both deliberately; see the spec's `subjectResolvable` paragraph.
  // Nil-only was too narrow: in one verification run it fired once, at 121 of 180
  // minutes. A search that returned rows but matched nobody is an equally good
  // moment to offer the alternative.
  //
  // Also gated on the search having been scoped to something NARROWER THAN A
  // COUNTRY. Unscoped and country-wide are the same situation: every candidate
  // the tree can offer was already inside the search, so naming localities within
  // it is noise and the note's "in the place searched" would be false. Across the
  // six committed runlogs, 9 of 26 marriage-scoped searches carried no place
  // scope at all — latent only because all 9 also omitted `subjectId`.
  //
  // Strictly best-effort and advisory — a tree that cannot be read leaves the
  // search untouched, exactly like the ranking block.
  const isMarriageSearch =
    input.recordType === "marriage" ||
    input.marriagePlace !== undefined ||
    input.marriageYearFrom !== undefined ||
    input.marriageYearTo !== undefined;

  const foundNobody =
    out.totalMatches === 0 || out.ranked?.subjectResolvable === false;

  // The place that was just searched is not always `marriagePlace`. In practice
  // the caller usually scopes a marriage search with `recordCountry` +
  // `recordSubdivision` instead — 6 of 7 marriage searches in one run, 4 of 5 in
  // another. Reading only `marriagePlace` left `searchedPlace` undefined on those,
  // so nothing was excluded and the jurisdiction that had just come back empty was
  // offered back as its own top alternative.
  const searchedPlace =
    input.marriagePlace ||
    [input.recordSubdivision, input.recordCountry].filter(Boolean).join(", ") ||
    undefined;

  if (
    isMarriageSearch &&
    foundNobody &&
    // Explicit, rather than leaning on `isSubCountryPlace` to narrow: that
    // predicate is intentionally not a type guard (see its comment), and this is
    // what makes `jurisdictionHints.searchedPlace` a sound required `string`.
    searchedPlace !== undefined &&
    isSubCountryPlace(searchedPlace) &&
    input.subjectId &&
    input.projectPath
  ) {
    try {
      const tree = await readProjectJson(input.projectPath, "tree.gedcomx.json");
      const candidates = marriageJurisdictionCandidates(tree, input.subjectId, {
        searchedPlace,
        marriageYearFrom: input.marriageYearFrom,
        marriageYearTo: input.marriageYearTo,
      });
      if (candidates.length > 0) {
        out.jurisdictionHints = {
          searchedPlace,
          // Capped: 4 spouses x 8 placed facts is 40 objects, and this lands in a
          // response whose own assembly above deliberately strips `gedcomx`, hoists
          // `collectionTitle` and drops empty `treeMatches` for context economy.
          // The tail of a distance-ordered list is the least useful part of it.
          candidates: candidates.slice(0, MAX_JURISDICTION_HINTS),
          note:
            "This marriage search did not find the subject in the place searched. A " +
            "marriage is filed where the wedding happened, not where the couple later " +
            "lived, and a couple usually married BEFORE they migrated. Listed below are " +
            "other places these people are on record as having been, ordered by how " +
            "close they sit to this search's date window — most recent BEFORE the " +
            "window first, since that is the best guess for where they were when they " +
            "married; undated places next; places dated after the window last. Search " +
            "these before concluding no marriage record exists. " +
            "These are places to LOOK, not evidence of anything: a jurisdiction " +
            "appearing here is not a reason to attach a person found there. Each entry " +
            "says whose fact it came from and when, because a place contributed by a " +
            "spouse from a much later marriage may have no bearing on this one.",
        };
      }
    } catch {
      // A missing or malformed tree is not a search failure. Stay silent.
    }
  }

  return out;
}

export const recordSearchToolSchema = {
  name: "record_search",
  description:
    "Search FamilySearch's historical record index for a specific person. " +
    "Requires at least one anchor: surname, recordCountry or batchNumber. Other fields " +
    "narrow ranking. Returns ranked person matches with key facts, " +
    "persistent URLs, source-record details, and Family-Tree-person match " +
    "suggestions. Requires authentication — call the login tool first if " +
    "not logged in. For ambiguous place names, call the places tool first. " +
    "To scope to a specific record collection, call the collections tool " +
    "first to find the right collectionId. " +
    "EXACT-MATCH TOGGLES: without an `*Exact` flag a name field also matches " +
    "fuzzy spellings, and on a RELATIVE's name field it additionally keeps " +
    "records that name no such person at all. Setting the flag excludes both, " +
    "so it only ever narrows and can drop the target. Whether the principal " +
    "`surname`/`givenName` toggles also drop records with that field empty is " +
    "not established. Years behave differently — see `birthYearExact`. Place " +
    "toggles are a different mechanism — see `birthPlaceExact`.",
  // The `*Exact` descriptions below state only what is specific to each
  // parameter; the rule they share lives in the tool-level description above and
  // is deliberately not repeated per parameter. They cover the effect on the
  // result SET and on ranking — `.exact` removes records and reorders the ones it
  // keeps — rather than restating the mechanism. Measured live against
  // /service/search/hr/v2/personas 2026-08-04 (issue #1093), re-done over
  // COMPLETE result sets on 2026-08-10/11: `.exact` REMOVES records and
  // REORDERS the ones it keeps. On the two enumerable `surname` marriage pools
  // (Brazil/Bochenek 521 -> 81, England/Pocklington 469 -> 423) the exact set
  // held 0 records absent from the fuzzy set, so it is a strict SUBSET and
  // cannot surface a record a fuzzy search buried — but 54 shared records moved
  // in the second pool, the largest by 34 positions, and 6 of those crossed
  // rows carrying a different relevance score, against a same-query noise floor
  // of 0. Count inflation is a separate totals-only argument: Zsigmondy
  // (108,848 -> 634, 172x), Mingazzini (40,908 -> 1,796, 23x), Geach
  // (roughly 18.5 million -> about 23,200, 799x). No displacement diff was run for places; what
  // was measured there is one target's rank — a county-scoped marriage search
  // measured about 35,500 fuzzy vs 2 exact with the target ranked first in both, and
  // the WRONG county returned the same total as the right one to within 0.1%
  // (about 35,500 each). `surnameExact` is additionally harmful: on a
  // record indexed `Neill`, surname `Neal` + surnameExact returns 0 where fuzzy
  // returns the record. A relative anchor NARROWS: holding a query constant,
  // adding `fatherGivenName` moved 948 -> 886. The 947 -> 1,478 "widening" in
  // issue #1088 was a confounded comparison — the marriage-year range was
  // dropped in the same call. Full figures and method:
  // docs/specs/record-search-tool-spec-v2.md.
  inputSchema: {
    type: "object",
    properties: {
      surname: { type: "string", description: "Family name of the searched person. Strongest anchor for genealogy queries. At least one of `surname`, `recordCountry` or `batchNumber` must be supplied." },
      givenName: { type: "string", description: "Given (first) name of the searched person." },
      surnameAlt: { type: "string", description: "Alternate family name (e.g., a woman's maiden name when also searching by married surname). Triggers a UNION search — results match either `surname` OR `surnameAlt`. The tool auto-fills `givenNameAlt = givenName` if only this side is supplied." },
      givenNameAlt: { type: "string", description: "Alternate given name. UNION with `givenName`. The tool auto-fills `surnameAlt = surname` if only this side is supplied." },
      sex: { type: "string", enum: ["Male", "Female", "Unknown"], description: "Sex of the searched person. Case-insensitive on input — `'male'` is normalized to `'Male'`." },
      surnameExact: { type: "boolean", description: "Restrict the surname to its exact spelling. Narrows the set and reorders what it keeps; it never surfaces a record the fuzzy search buried. Fuzzy is what bridges an index misspelling, so this can drop the target. Applies to `surnameAlt`." },
      givenNameExact: { type: "boolean", description: "Restrict the given name to its exact spelling. Excludes period diminutives (`Betty` for `Elizabeth`) — pass a variant as its own `givenName`. On initials it pins the order, dropping the `W J` that `J W` reaches. Applies to `givenNameAlt`." },

      birthYearFrom: { type: "number", description: "Lower bound of the birth-year range. 4-digit year (e.g., 1850). Must be paired with `birthYearTo`." },
      birthYearTo: { type: "number", description: "Upper bound of the birth-year range. 4-digit year (e.g., 1859). Must be paired with `birthYearFrom`." },
      birthYearExact: { type: "boolean", description: "When `true`, the birth-year range is matched hard, not fuzzed. It is meant to exclude records dated just outside the range, though that fuzz is only weakly evidenced. What it does to records carrying no indexed year is NOT established, and neither is whether an unqualified range keeps them — so do not rely on a year range, set or unset, to include or exclude undated records. Whether it drops in-range approximate dates is NOT established either. Use only with a firm date." },
      birthPlace: { type: "string", description: "Birth place name (e.g., `'Kentucky'`, `'Hardin, Kentucky, United States'`). For ambiguous place names, call the `place_search` tool first to disambiguate." },
      birthPlaceExact: { type: "boolean", description: "Stop upward expansion to parent jurisdictions (it still descends). A different mechanism from the rule above — expansion, not fuzz. Large effect on the count; set it when the count must mean something." },

      deathYearFrom: { type: "number", description: "Lower bound of the death-year range. 4-digit year (e.g., 1900). Must be paired with `deathYearTo`." },
      deathYearTo: { type: "number", description: "Upper bound of the death-year range. 4-digit year (e.g., 1920). Must be paired with `deathYearFrom`." },
      deathYearExact: { type: "boolean", description: "As `birthYearExact`, for the death-year range." },
      deathPlace: { type: "string", description: "Death place name. For ambiguous place names, call the `place_search` tool first to disambiguate." },
      deathPlaceExact: { type: "boolean", description: "As `birthPlaceExact`, for the death place." },

      marriageYearFrom: { type: "number", description: "Lower bound of the marriage-year range. 4-digit year (e.g., 1830). Must be paired with `marriageYearTo`." },
      marriageYearTo: { type: "number", description: "Upper bound of the marriage-year range. 4-digit year (e.g., 1840). Must be paired with `marriageYearFrom`." },
      marriageYearExact: { type: "boolean", description: "As `birthYearExact`, for the marriage-year range." },
      marriagePlace: { type: "string", description: "Marriage place name. For ambiguous place names, call the `place_search` tool first to disambiguate." },
      marriagePlaceExact: { type: "boolean", description: "As `birthPlaceExact`, for the marriage place." },

      residenceYearFrom: { type: "number", description: "Lower bound of the residence-year range (typically census-style anchor). 4-digit year (e.g., 1860). Must be paired with `residenceYearTo`." },
      residenceYearTo: { type: "number", description: "Upper bound of the residence-year range. 4-digit year (e.g., 1870). Must be paired with `residenceYearFrom`." },
      residenceYearExact: { type: "boolean", description: "As `birthYearExact`, for the residence-year range." },
      residencePlace: { type: "string", description: "Residence place name. For ambiguous place names, call the `place_search` tool first to disambiguate." },
      residencePlaceExact: { type: "boolean", description: "As `birthPlaceExact`, for the residence place." },

      anyYearFrom: { type: "number", description: "Lower bound of an any-event year range. 4-digit year (e.g., 1850). Use when the event type is unknown or doesn't matter. Must be paired with `anyYearTo`." },
      anyYearTo: { type: "number", description: "Upper bound of an any-event year range. 4-digit year (e.g., 1880). Must be paired with `anyYearFrom`." },
      anyYearExact: { type: "boolean", description: "As `birthYearExact`, for the any-event year range (never measured on this family)." },
      anyPlace: { type: "string", description: "Place name for an event of any type. For ambiguous place names, call the `place_search` tool first to disambiguate." },
      anyPlaceExact: { type: "boolean", description: "As `birthPlaceExact`, for the any-event place." },

      spouseGivenName: { type: "string", description: "Spouse's given name (a person mentioned alongside the searched person as their spouse on the record). A record that names no spouse at all is kept too, since silence is not a contradiction — read `relativeTerms.spouse` on each result to see which." },
      spouseSurname: { type: "string", description: "Spouse's family name. A record that names no spouse at all is kept too, since silence is not a contradiction — read `relativeTerms.spouse` on each result to see which." },
      spouseGivenNameExact: { type: "boolean", description: "Require the spouse's given name to be present and match exactly. Enumerated on two marriage populations: every spouse-silent record is dropped." },
      spouseSurnameExact: { type: "boolean", description: "Require the spouse's family name to be present and match exactly. Same trade-off as `spouseGivenNameExact`." },
      fatherGivenName: { type: "string", description: "Father's given name (a person mentioned on the record as the searched person's father). A record that names no father at all is kept too, since silence is not a contradiction — read `relativeTerms.father` on each result to see which." },
      fatherSurname: { type: "string", description: "Father's family name. A record that names no father at all is kept too, since silence is not a contradiction — read `relativeTerms.father` on each result to see which." },
      fatherGivenNameExact: { type: "boolean", description: "Require the father's given name to be present and match exactly. Unqualified, the field keeps records that name no father at all; this drops them. Rarely worth it." },
      fatherSurnameExact: { type: "boolean", description: "Require the father's family name to be present and match exactly. Same trade-off as `fatherGivenNameExact`." },
      motherGivenName: { type: "string", description: "Mother's given name (a person mentioned on the record as the searched person's mother). A record that names no mother at all is kept too, since silence is not a contradiction — read `relativeTerms.mother` on each result to see which." },
      motherSurname: { type: "string", description: "Mother's family name. A record that names no mother at all is kept too, since silence is not a contradiction — read `relativeTerms.mother` on each result to see which." },
      motherGivenNameExact: { type: "boolean", description: "Require the mother's given name to be present and match exactly. Assumed to behave as `fatherGivenNameExact`; only the father and spouse families were enumerated." },
      motherSurnameExact: { type: "boolean", description: "Require the mother's family name to be present and match exactly. Assumed, as `motherGivenNameExact`." },
      parentGivenName: { type: "string", description: "A parent's given name when the parent's sex is unknown. Use instead of `fatherGivenName` / `motherGivenName` when you don't know which parent. A record that names no parent at all is kept too, since silence is not a contradiction — read `relativeTerms.parent` on each result to see which." },
      parentSurname: { type: "string", description: "A parent's family name when the parent's sex is unknown. A record that names no parent at all is kept too, since silence is not a contradiction — read `relativeTerms.parent` on each result to see which." },
      parentGivenNameExact: { type: "boolean", description: "Require the parent's given name to be present and match exactly. Assumed, as `motherGivenNameExact`." },
      parentSurnameExact: { type: "boolean", description: "Require the parent's family name to be present and match exactly. Assumed, as `motherGivenNameExact`." },
      otherGivenName: { type: "string", description: "Given name of a person who appears on the record alongside the searched person, of unknown relationship (use when you know two names co-occur but not how they relate). `relativeTerms.other` reports whether a co-person on the record carries this name: `present` (one does), `unknown` (co-people exist, none matches — names are compared exactly, so a spelling variant lands here), `absent` (the record names nobody else)." },
      otherSurname: { type: "string", description: "Family name of a person who appears on the record alongside the searched person, of unknown relationship. `relativeTerms.other` reports whether a co-person on the record carries this name: `present` (one does), `unknown` (co-people exist, none matches — names are compared exactly, so a spelling variant lands here), `absent` (the record names nobody else)." },
      otherGivenNameExact: { type: "boolean", description: "Require the co-occurring given name to be present and match exactly. Assumed, as `motherGivenNameExact`." },
      otherSurnameExact: { type: "boolean", description: "Require the co-occurring family name to be present and match exactly. Assumed, as `motherGivenNameExact`." },

      collectionId: { type: "string", description: "A single FamilySearch collection ID — the `id` string returned by the `collections_search` tool (e.g., `\"1743384\"`). Call `collections_search` first to find the right ID for a place or topic. Note: this is a different ID system from the `place_search` tool's IDs — pass a place *name* to `collections_search`, not a place ID." },
      batchNumber: { type: "string", description: "IGI batch number (e.g., `\"M01048-5\"`), the extraction batch behind a legacy parish register. OBTAIN ONE from the `batchNumber` field on a previous result (search the collection by name, then scan the hits for one that carries it — most records carry none, and a hit without one says nothing about the collection); `ranked[]` stubs carry it too. A very strong filter and the canonical way to enumerate one parish: send it ALONE and it returns that batch's records, and adding a name searches within the batch. It anchors by itself — adding `recordCountry` or `recordSubdivision` is REJECTED by the tool, because a country that does not match the batch silently returns 0 (a batch number carries no country information, so there is nothing to guess it from). A nonexistent batch returns 0 rather than being ignored. Paging stops at `offset + count = 4999`, so a batch bigger than that cannot be walked end to end — partition it with `surname`, not by paging deeper. Shape varies: a batch may lead with a digit or with a letter, and may carry a trailing `-digit`. Attested live: `B01883-5`, `M01048-5`, and the all-numeric `8317102`. Always pass it as a quoted string, keeping any leading zeros; pass it exactly as the source gives it, do not reject or reformat one on shape, and treat no shape rule here as exhaustive." },
      imageGroupNumber: { type: "string", description: "Filter to a specific digitized volume by image group number (e.g., `'004010852'`). Also accepts split DGS format (e.g., `'004010852_001_M9QY-X6Y'`). Use the `volume_search` tool first to find the image group number for a place and date range." },
      recordCountry: { type: "string", description: "Country where the record was created (e.g., `'United States'`, `'England'`). Acts as an anchor — at least one of `surname`, `recordCountry` or `batchNumber` must be supplied. Combining it (or `recordSubdivision`) with `batchNumber` is REJECTED (the batch anchors on its own): a country that does not match the batch silently returns 0, which is indistinguishable from a wrong batch." },
      recordSubdivision: { type: "string", description: "State, province, or first-level subdivision within the country (e.g., `'Alabama'`). Requires `recordCountry` to be supplied alongside it." },
      recordType: { type: "string", enum: ["birth", "marriage", "death", "census", "immigration", "military", "probate", "other"], description: "Type of record. Mapped to the upstream's integer recordType encoding by the tool." },
      maritalStatus: { type: "string", enum: ["Married", "Single", "Divorced", "Widowed"], description: "Marital status of the searched person. Case-sensitive — must be supplied with the exact capitalization shown. Many records leave this field unfilled, so filtering on it excludes records where the field is blank." },
      isPrincipal: { type: "boolean", description: "Filter by the searched person's role in the record. `true` returns only records where the matched person is the principal subject (e.g., the deceased on a death certificate, the bride/groom on a marriage). `false` returns only records where the matched person is mentioned but is not the principal (e.g., as a parent, witness, sibling). Omit the parameter to return both — the broadest set, recommended for most natural-language searches." },

      subjectId: { type: "string", description: "A `persons[].id` from the project's tree.gedcomx.json (e.g. `\"I1\"`). Supply it together with `projectPath` and the tool ALSO ranks the results against that subject with FamilySearch's own matcher and returns them under `ranked` — match-scored, attachment-checked, best first. This replaces a separate `rank_search_matches` call. Supply it for any search where you know which tree person you are looking for, which is nearly all of them. Ranking never fails the search: on a ranking error you still get `results`, plus `rankingError`. Omit it only when the search is not about a specific tree person (a broad survey, or a person not yet in the tree)." },
      count: { type: "number", description: "Number of results per page. Max 100. Default 50 when `subjectId` is supplied — ranking cuts a deep pool back host-side, so fetching one is worth it — and 20 otherwise, since an unranked deep pool is just more stubs for you to read. Override only for a deliberate reason." },
      offset: { type: "number", description: "Pagination offset. Default 0. The combined value `offset + count` must be at most 4999 (FamilySearch's hard search-depth limit)." },

      projectPath: { type: "string", description: "Absolute path to the active project directory. Supply it whenever the search will be logged (the normal case): the tool then stages its raw results host-side and returns a `staged.resultsRef` handle. The inline results come back as compact stubs — no per-result `gedcomx`, no `collectionUrl` (derive it from `collectionId`), no `treeMatches` key when there are none, and no per-row `collectionTitle`: those are hoisted into a single response-level `collections` map of `collectionId` → title. Stubs DO keep `relativeTerms` when you searched on a relative's name: it reports, per result, whether that relative is actually named on the record (`present`, with their name), definitely not on it (`absent`), or undetermined (`unknown`). Check it before writing that a record confirms a relationship — `absent` means the record is merely consistent with that relative, not evidence for them. The full-fidelity rows live in the staged file, so a broad search can't overflow the context. Pass the `staged.resultsRef` to `rank_search_matches` to re-rank by match score, and to `research_log_append` as `stagedResultsRef` so the results are retained in the log sidecar without you re-serializing them (that also lets you omit `query` — the staged payload already carries it). Only omit `projectPath` for a throwaway exploratory search you are certain you will not log: results come back inline at full fidelity but nothing reaches disk, and logging such a search anyway leaves a log entry whose raw response is gone for good (`research_log_append` warns when that happens)." },
    },
  },
};

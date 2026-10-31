// research_append — structured writer for the mutable research.json sections
// (everything except the append-only `log`, which is research_log_append's job).
//
// One tool with a `section` + `op` discriminator. The LLM supplies the analytical
// content; the tool assigns the section's prefix id, stamps tool-owned timestamps,
// enforces supersede-not-delete (no delete op), runs the section invariants as
// preconditions, validates the whole project, and writes research.json atomically.
//
// Composite persist (D1, record-extraction consolidation): an optional top-level
// `sourceDescription` lets one call persist a whole record — the tool creates the
// tree.gedcomx.json `S` entry via the shared write layer, stamps the sources op's
// `gedcomx_source_description_id`, auto-stamps assertion `source_id`s, enforces
// the persona/record-id matrix against the log entry's sidecar (D2), resolves
// `standard_place` (sidecar copy first), and commits BOTH documents together
// (tree first, then research).
//
// Phased per docs/specs/research-append-tool-spec.md §7; SECTIONS now covers
// all three phases (sources/assertions/person_evidence, the status-transition
// sections, the phase-3 sections, and the `project` singleton).

import { rejectionFor, type RejectedLink } from "../utils/rejected-links.js";
import { isLiveAssertion, RETRACTED } from "../utils/assertion-liveness.js";
import { assertionReferrers, personsNamedFromRetracted } from "../utils/assertion-retirement.js";
import { compoundJurisdictionError, planItemFlags, planWindowFlag } from "../utils/plan-item-plausibility.js";
import { readStartingTree, startingPersonIdsOf } from "../utils/starting-tree.js";
import { isSettledConflict, VALIDATOR_ENUMS } from "../validation/validator.js";
import { validateIntroduced } from "../validation/introduced-errors.js";
import { sanitizeTree } from "../validation/tree-sanitize.js";
import {
  competingParentSets,
  conflictBlocksCompletion,
  conflictCoverageLogIds,
  datetimeMs,
  endsOnConflict,
  isAnalysed,
  questionLastSearchedMs,
  questionOwnedLogEntries,
  questionTiedAssertionIds,
  unsettledConflictEnding,
  whyConflictBlocksCompletion,
} from "../utils/question-state.js";
import {
  atomicWriteJson,
  atomicWriteBoth,
  readProjectJson,
  formatIssues,
  withProjectLock,
  NoProjectError,
  noProjectResult,
} from "../utils/project-io.js";
import { coerceJsonArg, jsonParseFailure, V8_POSITION_SUFFIX } from "../utils/coerce-json-arg.js";
import {
  readMatchScores,
  findRecordedScore,
  type MatchScoreFile,
  type ScoredPersona,
} from "../utils/match-scores.js";
import { compatiblePlace } from "../utils/date-comparison.js";
import { normalizeString } from "../utils/string-similarity.js";
import { getDayRange, isABeforeB } from "../utils/date-helpers.js";
import {
  placeSegments,
  canonicalCountry,
  standardPlaceToCoords,
  UK_CONSTITUENTS,
  placeTypeKey,
  resolveStandardPlace,
  repIdToStandardPlace,
  countryConsistency,
  countryOfPlace,
  isNonPlacePhrase,
  checkFirstPlace,
  samePlace,
  type PlaceCoords,
} from "../utils/place-resolver.js";
import { isProse, judgeSupplied, placeAnswer, unconfirmedByText } from "../utils/place-verdict.js";
import { isSuspiciousText, TRAILING_DOUBT, WITHHELD_SUSPICIOUS } from "../utils/record-extract.js";
import { birthThresholdMiles, lookupWithin } from "../utils/place-coords.js";
import { haversineDistance } from "./distance.js";
import { exampleHints } from "./research-append-examples.js";
import { gcUnreferencedImages, sourceImageCapState } from "../utils/image-store.js";
import { nextId } from "../utils/gedcomx-ids.js";
import { arkToBareId } from "../utils/ark.js";
import { PERSONA_BEARING_PRODUCERS, isAcceptedHint, sidecarReader } from "../utils/results-staging.js";
import { isStopGateSatisfied, getStoppedBecause } from "../utils/question-stop.js";

// Re-exported for back-compat: tests and any other importer that reaches this
// check via research-append.ts (its original home) keep working unchanged.
// The implementation now lives in place-resolver.ts, shared with tree-edit.ts.
export { countryConsistency };
import { stdDate } from "../utils/date-standardize.js";
import { MONTH_NUM } from "../utils/date-constants.js";
import { treeDiff } from "./tree-diff.js";
import {
  collectionKey,
  loadStoredCollectionUrls,
  readExternalCollections,
  EXTERNAL_COLLECTIONS_FILE,
  type StoredCollectionUrls,
  type ExternalCollectionsDoc,
  type StoredCollectionRow,
} from "../utils/external-collections-store.js";
import {
  ASSERTION_FACT_ATTRS,
  assertionFactAttr,
  assertionTreeFactType,
  factText,
  materializesToPersonFact,
  type AssertionFactAttr,
  factTypeKey,
  isTwoParty,
  recordPartyKeyer,
  personaRolesById,
  sameRecord,
} from "../utils/record-persona.js";
import { gatherRelatives, isRealGivenName, PLACEHOLDER_GIVEN } from "../utils/relatives.js";
import { factsEquivalent, namesEquivalent, relationshipMatches } from "../utils/merge-gedcomx.js";
import type { SimplifiedGedcomX, SimplifiedFact } from "../types/gedcomx.js";
import { recordBasisOf } from "../utils/record-basis.js";
import { countsForProofGate, isAttachmentLink } from "../utils/tree-person.js";
import { awaitingUploadItemIds } from "../utils/awaiting-hand-offs.js";

// ─── Section configuration (the per-section table phases 2–3 extend) ─────────

interface SectionConfig {
  /** id prefix, including the trailing underscore (e.g. "src_"). */
  prefix: string;
  /** Tool-owned timestamp stamped on append when the entry omits it. With
   *  `everyWrite`, stamped on every append and update, overwriting the caller's;
   *  `restampOn` narrows the updates that move it to those setting one of its fields. */
  stampTimestamp?: {
    field: string;
    kind: "date" | "datetime";
    everyWrite?: boolean;
    restampOn?: readonly string[];
  };
  /** Nested section: entries live in `<parent>[<param>].<field>` (plan_items). */
  nested?: { parent: string; param: "planId"; field: string };
  /** List sections only: the fields an `update` op may set. Absent, every field
   *  but `id` is updatable. `namesakes` uses it so a row is never re-pointed. */
  updatableFields?: string[];
  /** Singleton object section (e.g. `project`): `op:"update"` shallow-merges
   *  `fields` (restricted to `allowedFields`) onto the object in place — no
   *  array, no id, no append. The tool stamps `stampTimestamp` on every write. */
  singleton?: {
    allowedFields: string[];
    stampTimestamp?: { field: string; kind: "date" | "datetime" };
    /** Fields that may be SET once and never rewritten — legal while the
     *  current value is absent or empty, refused after. `init-project` fills
     *  these at creation; nothing else may change them afterwards.
     *
     *  **What this constrains is the system, not the researcher.** A human who
     *  mistyped their objective edits `research.json` directly; the raw-write
     *  lockdown binds the agent, never a text editor, and preventing a person
     *  from editing their own files is explicitly not a goal of this layer. So
     *  this needs no override path — the override is the file itself. */
    initOnlyFields?: string[];
    /** Create the object when the document has no such section yet, rather than
     *  refusing. Only for sections a project may legitimately lack. */
    createWhenAbsent?: boolean;
  };
}

const CREATED_DATE = { field: "created", kind: "date" } as const;

/** Fire the "sources without assertions" nudge only once a project has
 *  accumulated this many sources with still-zero assertions. 1–2 sources before
 *  any assertion is the normal record-then-extract rhythm; ≥3 with none drawn is
 *  the reported pathology (issue #1478 bundle 1: 13 sources, 0 assertions).
 *  Tunable; mirrors research-log-append's `resultsAvailable > 0` warn gate. */
const SOURCES_WITHOUT_ASSERTIONS_WARN_THRESHOLD = 3;

const SECTIONS: Record<string, SectionConfig> = {
  // Phase 1
  sources: { prefix: "src_" },
  assertions: { prefix: "a_" },
  person_evidence: { prefix: "pe_", stampTimestamp: CREATED_DATE },
  // Immutable but for `reason`: re-pointing a rejection would move it onto a
  // linked pair without retiring that link, and `researcher_words` is a record.
  rejected_links: { prefix: "rj_", stampTimestamp: CREATED_DATE, updatableFields: ["reason"] },
  // Phase 2
  questions: { prefix: "q_", stampTimestamp: CREATED_DATE },
  plans: { prefix: "pl_", stampTimestamp: CREATED_DATE },
  plan_items: { prefix: "pli_", nested: { parent: "plans", param: "planId", field: "items" } },
  conflicts: { prefix: "c_" },
  hypotheses: { prefix: "h_" },
  // Phase 3
  timelines: { prefix: "t_", stampTimestamp: { field: "generated", kind: "datetime" } },
  // `updated` is what `narrativeAndSearchSummaryTogether` compares the
  // question's log against, so it moves on every write that checks either text
  // against the log, not just the first, and never on one that checks neither.
  proof_summaries: {
    prefix: "ps_",
    stampTimestamp: {
      field: "updated",
      kind: "datetime",
      everyWrite: true,
      restampOn: ["narrative_markdown", "exhaustive_search_summary"],
    },
  },
  evaluations: { prefix: "ev_", stampTimestamp: { field: "timestamp", kind: "datetime" } },
  localities: { prefix: "loc_", stampTimestamp: CREATED_DATE },
  // A row is never retired and never re-pointed: person_id is the person it
  // shadows, so it is not among the fields an update may set.
  namesakes: {
    prefix: "ns_",
    stampTimestamp: CREATED_DATE,
    updatableFields: ["name", "place", "time_period", "record_ids", "log_entry_ids", "notes"],
  },
  // Singleton metadata (one object, not a list): update-only field writes.
  // proof-conclusion sets `project.status: "completed"` here at the end of a
  // GPS cycle; the tool stamps `project.updated` (iso_date).
  project: {
    prefix: "",
    singleton: {
      // `status` is freely updatable — proof-conclusion flips it to "completed".
      // The other three are set ONCE, by whoever creates the project, and never
      // rewritten: the ownership declaration's own statement of the harm is "a
      // skill rewrites the objective, and every later skill plans against a
      // changed goal it never agreed to."
      allowedFields: ["status", "objective", "title", "subject_person_ids"],
      initOnlyFields: ["objective", "title", "subject_person_ids"],
      stampTimestamp: { field: "updated", kind: "date" },
    },
  },
  // The researcher profile: written at project creation by init-project, and
  // correctable afterwards — NOT init-only. Every skill reads
  // `narration_guidance` from here, and a researcher who picked the wrong
  // experience level needs a route that is not "start over".
  //
  // `createWhenAbsent` because a project may legitimately have no profile: the
  // section is optional in the schema, and an agent must never fabricate one
  // (a project was observed created with "intermediate experience, no paid
  // subscriptions" that the user was never asked for). So the object appears on
  // the first real write rather than being seeded with invented values.
  //
  // No `stampTimestamp`: the schema is `additionalProperties: false` with no
  // timestamp field, so stamping one fails validation on every write.
  researcher_profile: {
    prefix: "",
    singleton: {
      allowedFields: [
        "experience_level",
        "subscriptions",
        "narration_guidance",
        "intended_audience",
      ],
      createWhenAbsent: true,
    },
  },
};

// A terminal plan is a settled audit trail, so it takes no new items —
// research-plan's own prose said so in two places and did not bind, which is
// what makes this a writer-tool precondition rather than a SKILL.md rule
// (ADR-0011's first question: decidable from the documents alone).
//
// DERIVED from `plan_status`, not hand-listed: terminal means "not active", so
// a value added to the enum is terminal here the moment it exists rather than
// silently escaping the deny. A hand-written `{completed, superseded}` is the
// stale copy `tool-schema-enums.test.ts` refuses, and it caught exactly that
// here. Today the set is {completed, superseded} — the `exhausted` status the
// 2026-09-07 ruling anticipated never arrived (issue #2077 closed not planned).
const TERMINAL_PLAN_STATUSES = new Set(
  [...VALIDATOR_ENUMS.plan_status].filter((s) => s !== "active"),
);

// Section invariants the project validator does NOT already enforce. (It already
// checks conflict competing-counts, hypothesis ruled_out⇒reason, and
// exhaustive-declaration completeness — those are left to validate-before-persist.)
// Each returns error strings on the post-mutation entry; empty = ok.

// A broader place containing a narrower one is not a disagreement. "Ireland"
// and "County Cork, Ireland" are the same claim at two levels of precision, so
// a conflict entry pairing them asserts a dispute the sources do not have
// (issue #2028, widened by the 2026-09-09 ruling on #1965). Decidable from
// research.json alone, so it is a precondition rather than a line of SKILL.md
// prose: ADR-0011's first question.
//
// `compatiblePlace` is the existing comparator and its own worked example is
// this exact pair. It reads the free-text `place` because that is the value
// the comparator is built for and the one every assertion carries however it
// was authored — NOT because `standard_place` is empty. It is empty on the
// hand-authored fixtures only; `research_append` resolves and writes it
// itself on every assertion append carrying a place.
// `disputed_attribute` is free text — 28 distinct values across the 102 fact
// conflicts in the corpus, including whole sentences and two compounds
// ("birth_year_and_birthplace"). So this is an exact allow-list of the
// attributes that are about place and nothing else. A conflict over
// `birth_year` between "Ireland" and "County Cork, Ireland" is a real dispute
// about the year; refusing it, with a message saying the two "do not disagree",
// is false about the axis actually in dispute. A compound attribute names a
// non-place axis too, so it is left alone for the same reason.
const PLACE_ONLY_DISPUTED_ATTRIBUTES = new Set([
  "place",
  "birthplace",
  "birth_place",
  "deathplace",
  "death_place",
  "marriage_place",
  "burial_place",
  "residence_place",
]);

export function placeContainmentErrors(entry: any, research: any): string[] {
  if (entry.conflict_type !== "fact") return [];
  const attr = typeof entry.disputed_attribute === "string"
    ? entry.disputed_attribute.trim().toLowerCase()
    : "";
  if (!PLACE_ONLY_DISPUTED_ATTRIBUTES.has(attr)) return [];
  const ids: string[] = Array.isArray(entry.competing_assertion_ids)
    ? entry.competing_assertion_ids
    : [];
  const byId = new Map<string, any>(
    ((research.assertions ?? []) as any[])
      .filter((a) => a && typeof a.id === "string")
      .map((a) => [a.id, a]),
  );
  // A missing or place-less neighbour is not this entry's problem — the
  // document validator reports dangling ids, and an assertion with no place
  // states nothing to compare. `placeSegments` is what decides "no place":
  // a blank or comma-only string passed a `typeof === "string"` test, then read
  // as a disagreement (nothing is compatible with ""), which silently disabled
  // the whole guard for the entry.
  const placed = ids
    .map((id) => byId.get(id))
    .filter((a) => a && typeof a.place === "string" && placeSegments(a.place).length > 0);

  // `compatiblePlace` is true for EQUAL places as well as for containment — its
  // own docstring lists "County Cork, Ireland" against itself as compatible. So
  // "some pair is compatible" is the wrong predicate: the canonical Flynn
  // conflict is Ireland / Ireland / Pennsylvania, where the two Irelands are
  // compatible with each other while Pennsylvania genuinely disagrees.
  //
  // Refused only when BOTH hold: no pair disagrees at all, and at least one
  // pair is a *strict* containment — compatible with differing hierarchy depth,
  // so one side genuinely says less. Depth counts normalized segments, matching
  // what the comparator itself does; a raw comma count disagrees with it in
  // both directions ("Ireland" vs "Ireland," wrongly refused, "Cork, Ireland"
  // vs "Ireland," wrongly allowed).
  const depth = (place: string) => placeSegments(place).length;
  let anyDisagreement = false;
  const containment: Array<[any, any]> = [];
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i];
      const b = placed[j];
      if (!compatiblePlace(a.place, b.place)) {
        anyDisagreement = true;
        continue;
      }
      if (depth(a.place) !== depth(b.place)) containment.push([a, b]);
    }
  }
  if (anyDisagreement || containment.length === 0) return [];
  return containment.map(([a, b]) => {
    const [broad, narrow] = depth(a.place) < depth(b.place) ? [a, b] : [b, a];
    return (
      `competing assertions '${broad.id}' ("${broad.place}") and '${narrow.id}' ` +
      `("${narrow.place}") name the same place at two levels of precision, so they ` +
      `do not disagree about '${entry.disputed_attribute}' — the first simply says ` +
      `less. Record the dispute over an attribute the sources actually contradict, ` +
      `or drop this conflict entry: removing one assertion would leave fewer than ` +
      `the two a fact conflict requires.`
    );
  });
}

// A year-only date cannot be ordered against a day-precision date inside that
// same year. The reported defect is an agent telling a researcher that an
// arrival of 15 Dec 1856 conflicted with a death recorded only as "1856" — it
// derived the ordering by reading two date strings, and no tool was consulted.
//
// A warning, not a refusal, and the distinction is load-bearing. Whether a
// conflict entry *claims* an ordering is not declarable today: `conflict_type`
// is only fact|identity and `disputed_attribute` is free text. A gate would
// therefore have to infer the claim, and a wrong inference refuses legitimate
// work. A warning that is wrong costs one line of text, so the shape below can
// be used as the trigger without that risk.
//
// The trigger is the ordering *shape*: competing assertions spanning more than
// one fact_type. A value disagreement is two assertions of the SAME type with
// different values (35 of the 37 corpus fact conflicts are all-`birth`; 34 of
// those carry three assertions, not two),
// and warning there would fire on every birthplace conflict — true, irrelevant,
// and the fastest way to teach a reader to ignore this channel.
//
// `stdDate` first, always: `getDayRange` returns null for ISO and `~approx`
// forms, which are 191 of the 391 assertion dates in the corpus, and
// `compatibleDate` reads null as "incompatible" — i.e. raw input would make
// this silently say nothing on precisely the imprecise dates it exists to flag.
function unorderableDateWarnings(entry: any, research: any): string[] {
  if (entry.conflict_type !== "fact") return [];
  const ids: string[] = Array.isArray(entry.competing_assertion_ids)
    ? entry.competing_assertion_ids
    : [];
  const byId = new Map<string, any>(
    ((research.assertions ?? []) as any[])
      .filter((a) => a && typeof a.id === "string")
      .map((a) => [a.id, a]),
  );
  const present = ids.map((i) => byId.get(i)).filter(Boolean);
  const factTypes = new Set(
    present.map((a) => a.fact_type).filter((t) => typeof t === "string"),
  );
  if (factTypes.size < 2) return [];
  const out: string[] = [];
  for (let i = 0; i < present.length; i++) {
    for (let j = i + 1; j < present.length; j++) {
      const a = present[i];
      const b = present[j];
      if (a.fact_type === b.fact_type) continue;
      if (typeof a.date !== "string" || typeof b.date !== "string") continue;
      // `isABeforeB`, not `compatibleDate`: the latter widens imperfect dates by
      // DEFAULT_IMPERFECT_FUDGE_DAYS (365), so a death of "1856" reads as
      // unorderable against a burial on 1857-12-31 — and the warning would then
      // tell the agent that neither is known to come first, which is false.
      // `isABeforeB` is three-valued at fudge 0 and returns null for exactly the
      // case this warns about: the ranges overlap, so neither is established as
      // earlier. It was already exported with zero callers.
      // `isABeforeB` returns null for TWO reasons — the ranges overlap, or a
      // date is unparseable — and only the first is what this warns about.
      // Parse both first, or a blank or garbage date reads as "unorderable"
      // and warns about a comparison that never happened.
      const ra = getDayRange(stdDate(a.date));
      const rb = getDayRange(stdDate(b.date));
      if (!ra || !rb) continue;
      if (isABeforeB(stdDate(a.date), stdDate(b.date)) !== null) continue;
      out.push(
        `'${a.id}' (${a.fact_type}, ${a.date}) and '${b.id}' (${b.fact_type}, ` +
          `${b.date}) cannot be ordered against each other: their possible-day ranges ` +
          `overlap, so neither is established as earlier. If ` +
          `this conflict rests on one event postdating the other, it is not ` +
          `established — say what else makes them incompatible, or withdraw it.`,
      );
    }
  }
  return out;
}

// A timeline event with no assertion_ids came from the tree or the user, not
// from a record, and a reply that presents it beside record-backed events
// reads it as established (issue #3516). A warning, not a refusal: refusal was
// rejected 2026-10-18 and the 2026-10-19 ruling kept this a warning, though it
// withdrew the "tree-built first pass" premise for person-mode timelines.
// research-append-tool-spec.md §5.5 has the detail.
function unsourcedTimelineEventWarnings(entry: any): string[] {
  const events: any[] = Array.isArray(entry.events) ? entry.events : [];
  const unsourced = events.filter(
    (e) => Array.isArray(e?.assertion_ids) && e.assertion_ids.length === 0,
  ).length;
  if (unsourced === 0) return [];
  return [
    `${unsourced} of ${events.length} events in ${entry.id} cite no record ` +
      `(assertion_ids empty); they come from the tree or the user and are ` +
      `unchecked. Say so to the user.`,
  ];
}

// The US 1890 federal census does not survive and can never fill a gap
// (ADR-0012, issue #2261) -- `expected_events` naming it, bare or with a
// destruction caveat attached, is a false claim prose alone let through 4
// times across 3 unit tests (issue #2797, commit 8f1621b0b). This is a single
// fact fixed in code, not a per-country survival table (issue #3255, lead
// ruling 2026-10-08): it knows only that the US 1890 census is gone, nothing
// about any other year or jurisdiction.
//
// Attribution differs from the harness's own backstop
// (`test_us_1890_never_expected`), which reads `tool_calls` to see which
// `{Country}_Census` wiki page was fetched -- a writer precondition sees only
// the document being written, not the run's tool history. Three arms, checked
// in order:
//
//   1. An entry naming the US outright fires regardless of the timeline's
//      places.
//   2. An entry naming some OTHER jurisdiction explicitly stays silent,
//      regardless of the timeline's places -- "Denmark census 1890" must
//      never be refused just because the same timeline also has a US-placed
//      event (an emigrant's own timeline, the exact shape this guard exists
//      for, routinely has both). Detected structurally: a capitalized word
//      immediately before "census" -- not a per-country table, which
//      ADR-0012 forbids, and not "any capitalized word anywhere in the
//      entry", which a review round found caught ordinary sentence-initial
//      or parenthetical capitals ("The 1890 census", "1890 census
//      (Destroyed in 1921 fire)", "Household listing in 1890 census") and
//      so silenced entries that name no jurisdiction at all and should fire
//      via arm 3. Requiring direct adjacency to "census" is what a mere
//      exclusion list cannot give: a word three tokens away from "census"
//      says nothing about what the entry is naming. The adjacent word is
//      then checked against the timeline's OWN recorded places (every
//      alphabetic token in a US-placed event's `place`/`standard_place`) --
//      if it matches, it names a US STATE OR COUNTY, not a foreign country
//      ("Pennsylvania census 1890" / "Schuylkill census 1890" on the
//      Schuylkill County timeline both fire, resolving a limitation the
//      first cut of this arm had), and arm 2 does not apply. Otherwise the
//      word names some other, non-US jurisdiction and arm 2 silences it.
//      Knowingly lets through, in the direction that now costs a refusal
//      rather than a false allow: a foreign-country reference NOT
//      immediately adjacent to "census" ("the 1890 census in Denmark",
//      "Denmark's 1890 census") is not recognized by arm 2 and falls to
//      arm 3, which fires if the timeline has a US-placed event elsewhere --
//      narrowing arm 2 for precision costs this shape, deliberately, since
//      the alternative (any capitalized word) cost the four phrasings above.
//      A SECOND, structural knowingly-lets-through: `usPlaceWords` only knows
//      THIS timeline's own recorded places, not US geography in general, so
//      a real US state or county the timeline has never mentioned ("New York
//      census 1890", "Pottsville census 1890" on a timeline that has only
//      ever recorded Schuylkill County) is indistinguishable from a foreign
//      one and arm 2 silences it -- a false allow (the entry should fire,
//      since the federal census is equally gone in New York). Deliberate,
//      not an oversight: the only fix that closes it is a US-places
//      reference wider than this one document, which is the per-jurisdiction
//      table ADR-0012 forbids in different clothing, and ADR-0011 limit 1
//      prefers exactly this direction of error (a false allow over a false
//      refusal) when the two trade off. Found by an independent review,
//      2026-10-11; not separately put to the lead, since it is a cost of the
//      no-table design the ruling itself chose, not a deviation from it.
//   3. An entry naming no jurisdiction at all falls back to the timeline's
//      own events -- it fires when ANY non-null `standard_place` ends in
//      "United States". Not "every": an immigrant's own timeline routinely
//      carries a non-US birth or baptism event (born in Ireland, enumerated
//      and died in Pennsylvania), and the 1860-1908 Schuylkill County gap
//      that motivated this rule is exactly that shape -- an `every` check
//      stayed silent on it because the birth event alone broke the
//      unanimity, found by the --runs-per-test 3 stability check this
//      precondition was built to pass (ut_timeline_005, run 3/3,
//      2026-10-09). This particular choice -- "any" over "every" -- was
//      made unilaterally against evidence the original ruling did not have;
//      it is shipped here measured and tested, with the Schuylkill County
//      case put to the lead on #3255 for a retroactive ruling, not decided
//      silently. A timeline with zero US-placed events is still never
//      refused on an ambiguous entry.
//
// Stays silent on the 1890 veterans schedule, which partly survives. Does
// NOT match on bare "federal" as a US signal -- several federal states call
// their own census a federal census, so a bare match risks reading an
// unrelated jurisdiction's correct, surviving census as the US one. The
// ordinary US phrasing ("1890 federal census" with no "United States"/"U.S."
// in the string) is still caught, not by the explicit-naming regex but by
// arm 3's fallback, whenever the timeline actually has a US-placed event --
// which is the only context that makes a bare "federal census" mean the US
// census in the first place. `\bUS\b`/`\bUSA\b` are matched case-SENSITIVELY
// and separately from the case-insensitive spellings: a case-insensitive
// `\bus\b` matches the ordinary pronoun "us" ("not available to us") in
// running prose, which would wrongly fire on a non-US timeline naming no
// jurisdiction at all. "USA" carries no such ordinary-word collision, but is
// kept on the same case-sensitive regex for consistency.
const TIMELINE_CENSUS_RE = /census/i;
const TIMELINE_1890_RE = /(?<!\d)1890(?!\d)/;
// Any 18xx/19xx year, not just 1890 -- round-7 review: `ut_timeline_001`
// wrote `expected_events: ["census","census","census","census"]` for a gap
// whose own `notes` call 1870/1880/1890/1900 "four surviving federal census
// years" and then say the 1890 schedules did not survive. None of the four
// entries names ANY year, so `TIMELINE_1890_RE` -- which only ever looks for
// the literal digits "1890" -- cannot see that one of the four is the
// non-surviving census this whole guard exists to catch; the entry reads as
// "not about 1890" and passes, which is exactly backwards. The tool can
// decide this from the entry alone: a census-type `expected_events` string
// that names no year at all is too vague to verify against anything, 1890
// included, so it is refused outright rather than silently let through.
// This is a SEPARATE condition from the 1890-specific one below, not the
// same check with a wider net -- a bare "census" entry on an all-1870s
// timeline is refused here for being unverifiable, never because it is
// mistaken for 1890.
//
// Matches any 4-digit year, not just 18xx/19xx -- round-8 review: the
// earlier `1[89]\d\d` cut refused "1790 census", "census_1790", "1787
// Denmark census" and "1769 census of Norway" for naming no year, when each
// names a real, surviving year outside the 1800-1999 window this guard
// happened to check. A census-type entry naming ANY year is verifiable
// against something, so this arm has no business narrowing to two
// centuries; the 1890-specific checks below are what actually decide
// whether a given year is the non-surviving one.
const TIMELINE_ANY_YEAR_RE = /(?<!\d)\d{4}(?!\d)/;
// A year span/range that covers 1890 -- round-8 review: `ut_timeline_001`'s
// bug (four surviving census years folded into one unverifiable entry) also
// shows up written as a single range, "federal censuses 1870-1900" or
// "censuses 1880 to 1900", which names two real years and never writes
// "1890" literally, so `TIMELINE_1890_RE` cannot see that the range spans
// the non-surviving year. Only a range connector ("-"/an en or em dash/"to"/
// "through"/"thru") counts -- "1880 and 1900 census" names two specific,
// surviving years with no claim about anything in between, and must stay
// allowed; bare "and" is deliberately not a range connector here.
const TIMELINE_YEAR_SPAN_RE =
  /(?<!\d)(\d{4})\s*(?:-|–|—|\bto\b|\bthrough\b|\bthru\b)\s*(\d{4}|\d{2})(?!\d)(?![-/.]\d)/gi;
// "between X and Y" -- round-9 review: this is the one shape where "and" DOES
// act as a range connector. "1880 and 1900 census" names two specific years
// with no claim about what lies between them (allowed, above), but "between
// 1880 and 1900" is the range itself written out in English, so "and" here
// carries the same meaning as "to"/"-" elsewhere. The leading "between" is
// what distinguishes the two; this regex is checked in addition to, not
// instead of, the connector list above.
const TIMELINE_BETWEEN_SPAN_RE =
  /\bbetween\b\s*(\d{4})\s*and\s*(\d{4}|\d{2})(?!\d)(?![-/.]\d)/gi;
// The end year must not be followed by another separator and digit: in a date
// ("1880-06-01") the month is not a two-digit end year.
// Round-10 review: every range in the entry is read, not just the first
// ("federal censuses 1850-1860 and 1880-1900" spans 1890 in its second), and
// a two-digit end year is read in the century of the first, rolling over
// when it would fall before it ("1880-90" is 1880-1890, "1895-05" 1895-1905).
function timelineSpanCovers1890(text: string): boolean {
  for (const re of [TIMELINE_YEAR_SPAN_RE, TIMELINE_BETWEEN_SPAN_RE]) {
    for (const m of text.matchAll(re)) {
      const a = parseInt(m[1], 10);
      let b = parseInt(m[2], 10);
      if (m[2].length === 2) {
        b += Math.floor(a / 100) * 100;
        if (b < a) b += 100;
      }
      if (Math.min(a, b) <= 1890 && 1890 <= Math.max(a, b)) return true;
    }
  }
  return false;
}
const TIMELINE_VETERAN_RE = /veteran/i;
const TIMELINE_NAMES_US_RE = /united states|u\.s\./i;
const TIMELINE_NAMES_US_ABBREV_RE = /\bUS\b|\bUSA\b/;
// A capitalized word before "census" -- not "Census"/"Federal" (part of the
// phrase being classified, not a jurisdiction) or "United"/"States" (already
// covered by TIMELINE_NAMES_US_RE, checked first -- reaching this regex at
// all means the text did not match it case-insensitively in any form). Also
// not "Population"/"Decennial"/"Eleventh"/"County" -- round-5 review found
// all four allowed through on the Schuylkill timeline: "1890 Federal
// Population Census" and "1890 Population Census" (the record's actual
// bureau name), "1890 Decennial Census" (the common descriptive name),
// "Eleventh Census, 1890" (the 1890 census's own formal ordinal name -- the
// 11th US federal census), and "Schuylkill County census 1890" whenever the
// timeline's events carry only `standard_place`, which never literally
// contains the word "County". These describe the census itself or a
// jurisdiction's administrative LEVEL, never a jurisdiction's NAME -- adding
// them to the exclusion is a small, closed set of English census-descriptive
// vocabulary, not a per-country table. "Eleventh" alone is excluded, not
// every ordinal: this guard only ever fires on the literal year 1890
// (TIMELINE_1890_RE), so no other ordinal can appear beside "Census" and
// still pass that check.
//
// The jurisdiction word need not be adjacent to "census": a second,
// independent review found the exclusion words above also work as FILLER
// between a real foreign jurisdiction and "census" -- "Essex County
// census", "Cork County census", "Danish Population Census", "Swedish
// Decennial Census" each capture nothing (the adjacent word is excluded)
// and fall through to arm 3, which fires on this timeline's own US event
// regardless of the entry actually naming Essex, Cork, Denmark, or Sweden.
// The trailing `(?:\s(?:Population|Decennial|Eleventh|County))*` lets the
// same exclusion words sit as descriptors AFTER a real jurisdiction word
// rather than only ruling out that word itself, so the jurisdiction is
// found wherever it sits relative to the descriptive filler, not just when
// nothing else sits between it and "census".
//
// "Federal" is excluded from the filler list, not just the capture-start
// list: round-6 review found it let an ORDINARY capitalized word that
// starts the entry get captured as a fake jurisdiction whenever "Federal"
// sat between it and "Census" -- "The Federal Census 1890", "Missing
// Federal Census 1890" each captured "The"/"Missing" as the jurisdiction,
// which isn't in usPlaceWords, so both were wrongly silenced on the
// Schuylkill timeline despite naming no country at all. No foreign census
// this arm exists to allow is ever called a "federal census" in English
// usage -- that phrasing names the US bureau specifically -- so "Federal"
// never needs to bridge a real jurisdiction to "census" the way
// "Population"/"Decennial"/"County" legitimately do, and dropping it from
// the filler set (while keeping it in the capture-start exclusion, since
// "1890 Federal Population Census" must still fall through entirely) costs
// nothing on a real foreign-jurisdiction phrasing.
//
// That alone does not close every such phrasing: "The Population Census of
// 1890" has the exact same shape as "Danish Population Census" (a
// capitalized word, "Population", "Census", in that order) and
// "Population" must stay in the filler set for the Danish/Swedish cases to
// keep matching, so adjacency repair alone cannot tell "The" from
// "Danish" here. The two are different grammatically, not just
// semantically: "The"/"A"/"An"/"This"/"That"/"These"/"Those" are English
// articles and demonstrative determiners -- a fixed, closed class of
// function words, not a per-country table in different clothing -- and
// none of them can themselves be a jurisdiction's name. Added to the same
// capture-start exclusion as "Census"/"Federal"/etc., which makes "The
// Population Census of 1890" fall through entirely (no other word in the
// string is a valid capture start either), exactly like the bureau-name
// phrasings above.
//
// What this still lets through: a jurisdiction name that happens to BE one
// of the excluded determiners or census-descriptive words is not
// constructible in English (there is no country or county named "The" or
// "Population"), so no real phrasing is newly silenced by this exclusion.
// A capitalized ordinary adjective that isn't an article or one of the
// census-descriptive words ("Missing Population Census 1890") is not
// addressed by this round's fix and is still wrongly treated as a foreign
// jurisdiction (captures "Missing"); closing that fully would require
// either enumerating ordinary English adjectives (unbounded, unlike the
// closed article/descriptor sets above) or a real word list of
// jurisdiction names, which ADR-0012 forbids. ADR-0011 limit 1 prefers
// this direction of error (a false allow) over a false refusal.
//
// Captured so the caller can check it against the timeline's own recorded
// US places. "[Cc]ensus" deliberately, not a trailing /i flag -- an /i flag
// would also make the leading `[A-Z][a-z]+` match a lowercase word,
// defeating the whole point of requiring a CAPITALIZED word. An independent
// review found the first cut's bare lowercase "census" meant "Denmark
// Census 1890" (capital C) never matched this regex at all and fell
// through to arm 3's fallback -- the exact silencing this arm exists to
// provide, lost on nothing but a capitalization choice.
const TIMELINE_NAMES_OTHER_JURISDICTION_RE =
  /\b(?!Census\b|Federal\b|United\b|States\b|Population\b|Decennial\b|Eleventh\b|County\b|The\b|A\b|An\b|This\b|That\b|These\b|Those\b)([A-Z][a-z]+)(?:\s(?:Population|Decennial|Eleventh|County))*\s[Cc]ensus\b/;

export function timelineCensus1890Invariants(entry: any): string[] {
  const gaps: any[] = Array.isArray(entry.gaps) ? entry.gaps : [];
  if (gaps.length === 0) return [];

  const events: any[] = Array.isArray(entry.events) ? entry.events : [];
  const standardPlaces = events
    .map((e: any) => e?.standard_place)
    .filter((p: unknown): p is string => typeof p === "string" && p.length > 0);
  const anyEventIsUS = standardPlaces.some((p: string) => p.endsWith("United States"));
  // Every alphabetic word appearing in a US-placed event's own `place` or
  // `standard_place` -- "Pennsylvania"/"Schuylkill" census 1890 on this
  // timeline names a US state or county, not a foreign country, and arm 2
  // must not silence it.
  const usPlaceWords = new Set<string>();
  for (const e of events) {
    const sp = e?.standard_place;
    if (typeof sp !== "string" || !sp.endsWith("United States")) continue;
    for (const src of [sp, e?.place]) {
      if (typeof src !== "string") continue;
      for (const word of src.match(/[A-Za-z]+/g) ?? []) usPlaceWords.add(word);
    }
  }

  const errs: string[] = [];
  for (const gap of gaps) {
    const expectedEvents: any[] = Array.isArray(gap?.expected_events) ? gap.expected_events : [];
    for (const item of expectedEvents) {
      const text = String(item ?? "");
      if (!TIMELINE_CENSUS_RE.test(text)) continue;
      if (TIMELINE_VETERAN_RE.test(text)) continue;
      if (!TIMELINE_ANY_YEAR_RE.test(text)) {
        errs.push(
          `gaps[].expected_events entry '${text}' names a census but no year -- name the ` +
            "specific surviving year this gap expects (e.g. '1870 census'), not a bare " +
            "record-type placeholder, since there is no way to tell it apart from the " +
            "non-surviving US 1890 federal census otherwise.",
        );
        continue;
      }
      if (!TIMELINE_1890_RE.test(text) && !timelineSpanCovers1890(text)) continue;
      const namesUS = TIMELINE_NAMES_US_RE.test(text) || TIMELINE_NAMES_US_ABBREV_RE.test(text);
      if (!namesUS) {
        const otherJurisdiction = text.match(TIMELINE_NAMES_OTHER_JURISDICTION_RE);
        if (otherJurisdiction && !usPlaceWords.has(otherJurisdiction[1])) continue;
        if (!otherJurisdiction && !anyEventIsUS) continue;
      }
      errs.push(
        `gaps[].expected_events entry '${text}' names the US 1890 federal census, which does ` +
          "not survive and can never fill a gap -- move the mention to this gap's `notes` " +
          "instead and drop it from `expected_events`.",
      );
    }
  }
  return errs;
}

function conflictInvariants(entry: any): string[] {
  // `moot` settles a conflict for every gate that reads `status` — the
  // completion gate included — and was the one settling write with no
  // precondition, so a bare `{status: "moot"}` cleared that gate while
  // asserting nothing. It owes the reason, because "this no longer matters" is
  // a genealogical judgment; it owes only the reason, because there is nothing
  // to weigh or to declare independent once the conflict has stopped bearing
  // on the question. Measured cost: 0 of the 1 moot conflict in the committed
  // e2e corpus (`ogletree-children` c_006, which carries one).
  if (entry.status === "moot") {
    const rationale = entry.resolution_rationale;
    // Trimmed, and type-checked: a whitespace-only string asserts exactly as
    // much as an absent one, and a non-string (a number, an object) satisfies
    // no `=== ""` comparison at all. Same reading as `isIdentityConflict`.
    return typeof rationale !== "string" || rationale.trim() === ""
      ? [
          "a moot conflict requires 'resolution_rationale' — say why the conflict no " +
            "longer bears on the question. To settle it on the evidence instead, use " +
            "status 'resolved' with independence_analysis, weighing_analysis and " +
            "resolution_rationale.",
        ]
      : [];
  }
  if (entry.status !== "resolved") return [];
  const errs: string[] = [];
  for (const f of ["independence_analysis", "weighing_analysis", "resolution_rationale"]) {
    const v = entry[f];
    // Same trimmed, type-checked reading as the `moot` arm above: this had
    // admitted `"   "` for all three since it shipped, which satisfies the
    // field and states nothing. Free on the corpus — 0 of 85 resolved
    // conflicts carry a blank or non-string analysis field.
    if (typeof v !== "string" || v.trim() === "") {
      errs.push(`a resolved conflict requires '${f}'`);
    }
  }
  const competing = Array.isArray(entry.competing_assertion_ids) ? entry.competing_assertion_ids : [];
  if (entry.preferred_assertion_id != null && !competing.includes(entry.preferred_assertion_id)) {
    errs.push("preferred_assertion_id must be one of competing_assertion_ids");
  }
  return errs;
}

/** The `conflicts` fields a resolve can set. An update naming none of them
 *  leaves the resolution as it stood, so the kind rule does not re-judge it. */
const RESOLUTION_FIELDS = [
  "status",
  "resolution_kind",
  "preferred_assertion_id",
  "resolved_value",
  "resolution_rationale",
] as const;

/** Distinct `src_` / `a_` ids a rationale cites. */
function citedEvidenceIds(text: string): Set<string> {
  return new Set([...text.matchAll(/\b(?:src|a)_\d+\b/gi)].map((m) => m[0].toLowerCase()));
}

/** A resolve must say how it was settled (research-append-tool-spec.md §5).
 *
 *  `resolution_kind` is required on a conflict that lands `resolved`, and each
 *  kind carries its own proof: `competitor` names the winning assertion
 *  (`preferred_assertion_id`, one of `competing_assertion_ids`); `tree` keeps
 *  the tree's existing conclusion and owes nothing more; `synthesis` builds a
 *  value no single assertion states (`resolved_value`), and its
 *  `resolution_rationale` cites at least two distinct `src_`/`a_` ids. Before
 *  this rule a resolve could name no winner and say nothing about why — 12 of
 *  68 resolved conflicts in the committed e2e corpus do.
 *
 *  Scoped like the place-containment rule below: an append that lands
 *  resolved, and an update that touches the resolution (status, the kind, the
 *  winner, the value or the rationale). An unrelated edit to a conflict
 *  resolved before this rule existed is not refused. `moot` is untouched:
 *  `conflictInvariants` owns it. No override (ADR-0011, 2026-08-24). */
function resolutionKindInvariants(entry: any, op: { op: string; fields?: Record<string, unknown> }): string[] {
  if (entry?.status !== "resolved") return [];
  const fields = op.fields ?? {};
  if (op.op !== "append" && !RESOLUTION_FIELDS.some((f) => Object.hasOwn(fields, f))) return [];
  const requirements =
    "Name how it was settled with resolution_kind: 'competitor' — one competing assertion wins, " +
    "named in preferred_assertion_id (one of competing_assertion_ids); 'tree' — the tree's existing " +
    "conclusion stands and nothing more is owed; 'synthesis' — no single assertion wins, so give the " +
    "value built from several in resolved_value and cite at least two src_/a_ ids in " +
    "resolution_rationale.";
  const kind = entry.resolution_kind;
  if (!VALIDATOR_ENUMS.resolution_kind.has(kind)) {
    return [
      `a resolved conflict requires 'resolution_kind'${kind == null ? "" : ` (got ${JSON.stringify(kind)})`}. ${requirements}`,
    ];
  }
  const competing = Array.isArray(entry.competing_assertion_ids) ? entry.competing_assertion_ids : [];
  if (kind === "competitor") {
    const winner = entry.preferred_assertion_id;
    if (typeof winner !== "string" || winner.trim() === "" || !competing.includes(winner)) {
      return [
        "resolution_kind 'competitor' requires preferred_assertion_id naming one of " +
          `competing_assertion_ids (${competing.join(", ") || "none"}). If no single assertion wins, ` +
          "use 'tree' (the tree's existing conclusion stands) or 'synthesis' (a value built from " +
          "several, with resolved_value and a rationale citing at least two src_/a_ ids).",
      ];
    }
    return [];
  }
  if (kind === "synthesis") {
    const errs: string[] = [];
    const value = entry.resolved_value;
    if (typeof value !== "string" || value.trim() === "") {
      errs.push(
        "resolution_kind 'synthesis' requires resolved_value — the value the evidence supports " +
          "when no single assertion states it (e.g. \"about 1844\").",
      );
    }
    const rationale = typeof entry.resolution_rationale === "string" ? entry.resolution_rationale : "";
    const cited = citedEvidenceIds(rationale);
    if (cited.size < 2) {
      errs.push(
        "resolution_kind 'synthesis' requires a resolution_rationale citing at least two distinct " +
          `src_/a_ ids — the records the value is built from (it cites ${cited.size}).`,
      );
    }
    return errs;
  }
  return [];
}

/** A [?] assertion cannot win a conflict on its own evidence — it needs
 *  corroboration from a different record with the same fact_type, same value
 *  (once [?] is stripped, whitespace collapsed and case folded), no [?] of its
 *  own, and tied to the same person. Reads live `research`. */
function uncertainPreferenceInvariants(entry: any, research: any): string[] {
  if (entry.preferred_assertion_id == null) return [];
  const assertions: any[] = (research.assertions ?? []).filter(isLiveAssertion);
  const byId = new Map<string, any>(assertions.map((a: any) => [a.id, a]));
  const preferred = byId.get(entry.preferred_assertion_id);
  if (!preferred || !hasUncertainReading(preferred)) return [];

  const competing: string[] = Array.isArray(entry.competing_assertion_ids)
    ? entry.competing_assertion_ids
    : [];
  const preferredRecord = preferred.record_id ?? preferred.source_id ?? null;
  const normalizedPreferredValue = normalizeUncertainValue(preferred.value);

  // Build set of person_ids the preferred assertion is linked to via live
  // person_evidence rows.
  const preferredPersonIds = new Set<string>();
  for (const pe of research.person_evidence ?? []) {
    if (pe && pe.assertion_id === entry.preferred_assertion_id && pe.superseded_by == null) {
      if (pe.person_id != null) preferredPersonIds.add(pe.person_id);
    }
  }

  // Build a map from assertion_id → set of person_ids for fast lookup.
  const assertionToPersonIds = new Map<string, Set<string>>();
  for (const pe of research.person_evidence ?? []) {
    if (pe && pe.superseded_by == null && pe.person_id != null) {
      let s = assertionToPersonIds.get(pe.assertion_id);
      if (!s) {
        s = new Set<string>();
        assertionToPersonIds.set(pe.assertion_id, s);
      }
      s.add(pe.person_id);
    }
  }

  for (const a of assertions) {
    if (!a || a.id === entry.preferred_assertion_id) continue;
    // Condition 1: no [?] on the corroborator.
    if (hasUncertainReading(a)) continue;
    // Condition 2: different record.
    const aRecord = a.record_id ?? a.source_id ?? null;
    if (aRecord == null || aRecord === preferredRecord) continue;
    // Condition 3: same fact_type, equal value once [?] removed + normalized.
    if (a.fact_type !== preferred.fact_type) continue;
    if (typeof a.value !== "string") continue;
    if (normalizeUncertainValue(a.value) !== normalizedPreferredValue) continue;
    // Condition 4: same person — in competing_assertion_ids, or linked to
    // the same person via live person_evidence.
    const inCompeting = competing.includes(a.id);
    if (!inCompeting) {
      const aPersonIds = assertionToPersonIds.get(a.id);
      if (!aPersonIds || !setsOverlap(aPersonIds, preferredPersonIds)) continue;
    }
    // All four conditions met — corroborated.
    return [];
  }

  return [
    `preferred_assertion_id '${entry.preferred_assertion_id}' carries an uncertain reading ` +
      `([?]) and no assertion from a different record corroborates it. To settle the conflict: ` +
      `find a second record whose reading agrees. A reading the user confirms is one more reading ` +
      `to weigh in this conflict's rationale, not a correction: assertion ` +
      `'${entry.preferred_assertion_id}' was written by extraction and is final, and a conflict ` +
      `write cannot change an assertion. Leaving ` +
      `preferred_assertion_id null — a deferral is a finding, not an omission — stays legal: leave ` +
      `the conflict unresolved, or resolve it with resolution_kind 'tree' when the tree's existing ` +
      `conclusion stands.`,
  ];
}

/** Strip [?], collapse whitespace, fold case — for value comparison. */
function normalizeUncertainValue(v: string): string {
  return v.replace(/\[\?\]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

/** True when two sets share at least one element. */
function setsOverlap(a: Set<string>, b: Set<string>): boolean {
  const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a];
  for (const x of smaller) {
    if (larger.has(x)) return true;
  }
  return false;
}

function planActiveInvariants(entry: any, research: any): string[] {
  if (entry.status !== "active") return [];
  // `p &&`: a legacy `plans: [null]` made this throw
  // `Cannot read properties of null`, so the writer crashed on the very shape
  // the document validator now reports. A malformed neighbour is not this
  // entry's problem — the validator reports it, and this call is not refused
  // for it (the introduced-error diff demotes pre-existing drift).
  const conflicting = (research.plans ?? []).filter(
    (p: any) => p && p !== entry && p.question_id === entry.question_id && p.status === "active",
  );
  if (conflicting.length > 0) {
    const plan = conflicting[0];
    const items: any[] = Array.isArray(plan.items) ? plan.items : [];
    const searchedOut =
      items.length > 0 &&
      items.every((it: any) => it?.status === "completed" || it?.status === "skipped");
    if (searchedOut) {
      return [
        `question '${entry.question_id}' already has an active plan (${plan.id}) whose items are all searched out; complete it first: {section:'plans', op:'update', entryId:'${plan.id}', fields:{status:'completed'}}`,
      ];
    }
    return [
      `question '${entry.question_id}' already has an active plan (${plan.id}); supersede it before adding another`,
    ];
  }
  return [];
}

/** The mechanical floor a hypothesis must clear to stand at `supported`
 *  (`research-schema-spec.md` §5.9; lead ruling 2026-09-07 on issue #2086).
 *
 *  Ported from the landed eval validator — `test_supported_requires_evidence_floor`
 *  in `eval/harness/validators/test_hypothesis_tracking.py`. The two planes must
 *  agree; change both or neither.
 *
 *  Conflicts are matched by **assertion overlap, never by shared `question_id`**.
 *  `eval/fixtures/scenarios/flynn-unresolved-conflict` is the fixture that
 *  separates the two: its `h_001` is `supported` while `c_001` is unresolved and
 *  blocks the same question, but names entirely different assertions. Matching
 *  by question refuses that shipped, correct fixture.
 *
 *  **One-directional.** A hypothesis that clears the floor and was left `active`
 *  is not a violation. The spec's third condition — evidence consistency, no
 *  logical or geographic impossibility — is a genealogist's judgment call and is
 *  deliberately not attempted here.
 *
 *  Reads the **pre-call snapshot**, both halves, per ADR-0011's rule: "Snapshot
 *  when the precondition must be satisfied by someone else. Read live when it is
 *  the same author's own prior step." Neither half is this author's own step —
 *  `ownership.json` gives `hypotheses.callers` as `["agent:hypothesis-tracking"]`
 *  while `conflicts` belongs to `skill:conflict-resolution` and `assertions` is
 *  written only by `extraction_append`. `conflicts` is `enforceableAt: ["unit"]`
 *  only (no hook arm, no tool arm), so under a live read nothing would stop a
 *  session from writing the satisfying conflict in the same batch as the promote
 *  and clearing this gate from inside the call it gates. (`assertions` gained a
 *  tool arm on 2026-10-05: a caller's assertions write is refused before this
 *  runs, so only `extraction_append`'s own batches can carry one.)
 *
 *  Measured cost of the snapshot read: **0 refusals** across the calibration
 *  corpus — no batch appends an assertion ahead of the promote, and neither of
 *  the two carrying a `conflicts` op ahead of it is affected (one has no
 *  assertion overlap, the other's conflict is already `resolved`). The single
 *  batch that would be refused is in `_2491-exploratory-quarantine`, which is
 *  exploratory-only by lead ruling #2491 and crosses two ownership lanes in one
 *  call. A same-batch resolve-then-promote is refused, and the remedy is to
 *  split the call.
 *
 *  The snapshot does NOT close the conflicts side: a conflict written anywhere
 *  in the same batch is invisible to it, in either order, and the
 *  promote-then-append ordering leaks under a live read too. Measured both
 *  ways 2026-09-17 — see `guardrail-enforcement-spec.md` §5 for the table. */
function hypothesisSupportedInvariants(entry: any, preCallResearch: any): string[] {
  if (entry?.status !== "supported") return [];
  const hid = entry.id ?? "?";
  const supporting: string[] = Array.isArray(entry.supporting_assertion_ids)
    ? entry.supporting_assertion_ids
    : [];
  const contradicting: string[] = Array.isArray(entry.contradicting_assertion_ids)
    ? entry.contradicting_assertion_ids
    : [];
  const linked = new Set<string>([...supporting, ...contradicting]);

  // `c &&`: a legacy `conflicts: [null]` element must not take the writer down
  // — the same guard planActiveInvariants carries, for the same reason.
  const unresolved = (preCallResearch?.conflicts ?? [])
    .filter(
      (c: any) =>
        c &&
        (Array.isArray(c.competing_assertion_ids) ? c.competing_assertion_ids : []).some(
          (aid: string) => linked.has(aid),
        ) &&
        !isSettledConflict(c),
    )
    .map((c: any) => c.id);
  if (unresolved.length > 0) {
    // Returns rather than falling through: the validator `continue`s here, so
    // the evidence floor is moot once this already fails, and reporting both
    // halves for one hypothesis would differ from the other plane.
    //
    // The remedy clause is a deliberate, one-directional divergence from the
    // Python text, which was written to be read by a human in a pytest failure.
    // The ruling asks for a refusal the agent can act on, and every
    // neighbouring refusal in this file names the remedy.
    return [
      `hypotheses[${hid}]: supported but conflict(s) [${unresolved.join(", ")}] naming its ` +
        `assertions are unresolved; settle each as "resolved" (independence, weighing and ` +
        `rationale) or "moot" (with a rationale) in an EARLIER call — settling it in this same ` +
        `call does not clear the gate — or drop the contested assertion from ` +
        `supporting_assertion_ids`,
    ];
  }

  const byId = new Map<string, any>();
  for (const a of preCallResearch?.assertions ?? []) {
    if (a && a.id != null) byId.set(a.id, a);
  }
  // The floor is "one record STATED it, or two independent records let us
  // infer it". It is a mechanical PROXY for the GPS rule it descends from —
  // GPS direct evidence answers the research question by itself, and a value a
  // record states is not always direct evidence FOR THIS QUESTION (a stated age
  // is indirect evidence of a birth year). The proxy predates this rename and is
  // unchanged by it; what changed is that the prose can no longer borrow the
  // GPS's authority by reusing its word. research-schema-spec.md § Status
  // transitions states the gap; do not re-derive it here.
  let stated = 0;
  const inferredSources = new Set<string>();
  for (const aid of supporting) {
    const a = byId.get(aid);
    if (!a) continue; // an id resolving to no assertion counts as nothing
    if (recordBasisOf(a) === "stated") stated += 1;
    // Skipping a null/absent `source_id` diverges from the Python, which adds
    // `None` to the set and so could count "no source" as a distinct source.
    // Unreachable through this tool — `source_id` is required and typed
    // `string` in research.schema.json, and every writer validates before
    // persisting — so the two planes cannot observably disagree.
    else if (recordBasisOf(a) === "inferred" && typeof a.source_id === "string") {
      inferredSources.add(a.source_id);
    }
  }
  if (stated < 1 && inferredSources.size < 2) {
    // The same-call clause matters as much here as in half (a), and for the
    // same reason: this half also reads the pre-call snapshot, so an assertion
    // appended earlier in THIS batch is invisible and the agent is told there is
    // no direct assertion immediately after appending one. Without the clause it
    // retries the same batch, or mints further assertions to satisfy a floor it
    // has already met — the ADR-0011 satisfiability limit.
    return [
      `hypotheses[${hid}]: supported with no stated supporting assertion and only ` +
        `${inferredSources.size} distinct inferred source(s) (needs >=1 record_basis ` +
        `"stated" or >=2 distinct sources at record_basis "inferred"). Assertions ` +
        `appended in THIS call do not count — ` +
        `append them in an earlier call, then promote`,
    ];
  }
  return [];
}

/** An uncertain transcription rides in the assertion's `value` as `[?]` — the
 *  record-extractor contract ("Keep the uncertain reading in `value` with
 *  `[?]`"). Nothing else in the entry marks doubt structurally. */
function hasUncertainReading(assertion: any): boolean {
  return typeof assertion?.value === "string" && assertion.value.includes("[?]");
}

/** Distinct records (falling back to source) that already tie other, still-live
 *  person_evidence rows to this person — excluding this entry and its own
 *  record. Size 0 ⇒ the identity rests on this single record alone. */
function corroboratingRecordCount(entry: any, research: any, byId: Map<string, any>): number {
  const own = byId.get(entry.assertion_id);
  const ownRecord = own?.record_id ?? own?.source_id ?? null;
  const distinct = new Set<string>();
  for (const pe of research.person_evidence ?? []) {
    if (pe === entry || pe.id === entry.id) continue;
    if (pe.person_id !== entry.person_id) continue;
    if (pe.superseded_by != null) continue;
    const a = byId.get(pe.assertion_id);
    const rec = a?.record_id ?? a?.source_id ?? null;
    if (rec != null && rec !== ownRecord) distinct.add(rec);
  }
  return distinct.size;
}

/** Epistemic gate for identity over-reach (the record-extractor's tentative-cap,
 *  enforced at the link point rather than left to prose).
 *
 *  Deliberately CONJUNCTIVE: an uncertain reading AND no corroborating record.
 *  A `confident` link off a single *clean* record stays legal — that is the
 *  ordinary case (a death certificate that plainly names its subject), and
 *  gating on record-count alone would reject it. Doubt only becomes
 *  disqualifying when nothing independent backs it up. */
/**
 * Refuse a link the researcher has already rejected.
 *
 * Exact pair only: rejecting "this record is not Mary" says nothing about her sister,
 * and nothing about a different record for Mary. A broader rule would silently block
 * work nobody objected to.
 *
 * The message quotes the researcher's own reason when they gave one, because a refusal
 * a person cannot trace back to their own decision reads as the tool being broken.
 */
function rejectedLinkInvariants(
  entry: Record<string, unknown>,
  research: Record<string, unknown>,
): string[] {
  const assertionId = typeof entry?.assertion_id === "string" ? entry.assertion_id : "";
  const personId = typeof entry?.person_id === "string" ? entry.person_id : "";
  if (!assertionId || !personId) return [];
  const rejected = Array.isArray(research?.rejected_links)
    ? (research.rejected_links as RejectedLink[])
    : [];
  const hit = rejectionFor(assertionId, personId, rejected);
  if (!hit) return [];
  const because = typeof hit.reason === "string" && hit.reason.trim()
    ? ` The researcher's reason: ${hit.reason}`
    : "";
  return [
    `${assertionId} and ${personId} were rejected as not a match (${String(hit.id)}), ` +
    `so this link is refused. Record new evidence instead.${because}`,
  ];
}

function personEvidenceInvariants(entry: any, research: any): string[] {
  if (entry.confidence !== "confident") return [];
  const assertions: any[] = research.assertions ?? [];
  const byId = new Map<string, any>(assertions.map((a: any) => [a.id, a]));
  const linked = byId.get(entry.assertion_id);
  // Missing FK is already reported by the document validator; don't double-fault.
  if (!linked || !hasUncertainReading(linked)) return [];
  if (corroboratingRecordCount(entry, research, byId) > 0) return [];
  return [
    `confidence 'confident' is not available here: assertion '${entry.assertion_id}' carries an ` +
      `uncertain reading ([?]) and no other record independently ties person '${entry.person_id}' ` +
      `to this identity. Use 'probable' (or 'speculative'), keep the [?] in the assertion value, ` +
      `and record what would resolve it — a second independent record, or the original image. ` +
      `A confident wrong parent is worse than a flagged uncertain one.`,
  ];
}

/** Assertions naming two people. The link may be about either side, so the
 *  assertion's own party identifiers cannot be assumed to describe the person
 *  being linked. */
export const RELATIONAL_FACT_TYPES: ReadonlySet<string> = new Set([
  "relationship", "parentage", "parentchild", "marriage",
]);

/** A christening date IS comparable to a birth date (a baptism follows birth
 *  closely); a christening PLACE is not comparable to a birth place. Hence two
 *  sets rather than one. */
const BIRTH_DATE_FACT_TYPES: ReadonlySet<string> = new Set([
  "birth", "christening", "baptism", "baptized",
]);

/** Years. The tree side is routinely a circa year, so a day-level comparison
 *  would read every `~1845` as a contradiction. */
const MAX_BIRTH_YEAR_GAP = 5;

const YEAR_PATTERN = /\b(1[0-9]{3}|20[0-9]{2})\b/;

/** First 4-digit year in a date string, tolerating `~1845`, `11Jan1758`,
 *  `1858-03-12` and `about 1832`. Null when none is present -- an unparseable
 *  date states nothing to compare, which must not read as a contradiction. */
function yearOf(value: unknown): number | null {
  const m = YEAR_PATTERN.exec(String(value ?? ""));
  return m ? Number(m[1]) : null;
}

/** A core identifier the RECORD states, contradicted by what the tree person
 *  already attests, caps the link at `speculative` — detected, not self-reported.
 *
 *  This is the third instrument tried on `ut_person_evidence_012` / `_024`, and
 *  the first that does not ask the agent to police itself. The other two failed
 *  the same way and the failure is on record: the rule stated in the agent body
 *  (with the same 0.85 figure as the test) did not bind; a Step 3 forcing
 *  function made the agent WRITE the verdict and it argued past it; and the
 *  self-declared `core_identifier_conflict` field was simply left null or
 *  omitted while the higher tier was written anyway (measured 2026-09-23 —
 *  `_012` wrote `probable` with the field present and null).
 *
 *  Place uses `birthPlacesAgree`: equality and containment are both
 *  compatible, so only an outright disagreement counts. A place-less assertion
 *  states nothing and is skipped, and so does a non-place phrase ("Same
 *  House"). A disagreement then counts only when the two places are in
 *  different countries or further apart than `birthThresholdMiles` allows for
 *  the era (lead ruling 2026-10-13, issue #3390): a research question's premise
 *  "near Nueva Italia, Michoacán" and a record's "La Unión, Guerrero", 85 mi
 *  apart in 1910, are not a contradiction. When the distance cannot be computed
 *  (no standard_place on a side, no coordinates, a side that is a whole region,
 *  two counties, no year) the cap fires. A place-only assertions update
 *  re-resolves its standard_place in `prepareOps`, so a stale one does not stand
 *  for the corrected place.
 *
 *  Scope is deliberately narrow: only the record's own assertions, only against
 *  the tree person's BIRTH fact, and only where both sides actually state a
 *  value. It cannot see a conflict nobody wrote down, which is the honest limit
 *  of any document-side gate.
 */
/** Only a BIRTH place compares against the tree person's birth place. A
 *  christening place is where the church is, not where the child was born:
 *  3 of the corpus's false positives were a christening at Ashton-under-Lyne
 *  against a birth at Preston, which is an ordinary Lancashire life, not a
 *  contradiction. The DATE arm is the other way round -- a christening follows
 *  birth closely, so its date IS comparable. */
const BIRTH_PLACE_FACT_TYPES: ReadonlySet<string> = new Set(["birth"]);

/** Whether a record's birth place and the tree's agree, on their text or, when
 *  both carry one, on their resolved `standard_place` -- either agreeing is
 *  enough, since two resolutions of the same text can differ. Agreement is
 *  `compatiblePlace`, which lets "Staffordshire, England" agree with "West
 *  Bromwich, Staffordshire, England, United Kingdom" and "Georgia" with
 *  "Georgia, United States". Lining the two up from the country instead refused
 *  1,067 committed confident/probable links on place, almost all that shape. */
function birthPlacesAgree(assertion: any, birth: any): boolean {
  if (compatiblePlace(String(assertion.place), String(birth.place))) return true;
  const sa = assertion?.standard_place;
  const sb = birth?.standard_place;
  return (
    typeof sa === "string" && placeSegments(sa).length > 0 &&
    typeof sb === "string" && placeSegments(sb).length > 0 &&
    compatiblePlace(sa, sb)
  );
}

/** An informant with no proximity to the birth cannot contradict it. Senior
 *  genealogist ruling 2026-09-23 (John Mark Peter-Brown): "A baptismal record
 *  carries weight of birth assertion than a death record with a secondary
 *  information by someone who does not have firsthand information about the
 *  birth." 35 of the corpus's 38 false positives were exactly that -- a death
 *  record's `Born 1845, Pennsylvania` against a tree attesting Ireland, at
 *  `information_quality: "secondary"`, `informant_proximity:
 *  "family_not_present"`. Capping a sound identity link because a death
 *  certificate misreported a birthplace would make the tool worse.
 *
 *  This reads `informant_proximity` to decide whether a contradiction is
 *  CREDIBLE, which is evidence weighing. It is not the same as citing it to
 *  justify a tier, which `agents/person-evidence.md` forbids -- that rule is
 *  about raising confidence on source quality alone. Flagged here because the
 *  two sit close enough to be confused. */
const WEAK_INFORMANT_PROXIMITY: ReadonlySet<string> = new Set([
  "family_not_present", "researcher", "unknown",
]);

/** Whether this assertion's stated value is credible enough to contradict the
 *  tree. Measured over every committed scenario fixture 2026-09-24: with these
 *  two gates the arm refuses **0 of 323** confident/probable person_evidence
 *  entries, against 38 without them and 274 comparing any place at all. An
 *  assertion a resolved conflict decided against, on the attribute that conflict
 *  disputed, is not credible either (`resolvedAgainstIds`). */
function contradictionIsCredible(assertion: any, resolvedAgainst: ReadonlySet<string>): boolean {
  if (resolvedAgainst.has(assertion?.id)) return false;
  if (assertion?.information_quality === "secondary") return false;
  return !WEAK_INFORMANT_PROXIMITY.has(
    String(assertion?.informant_proximity ?? "unknown"),
  );
}

/** `disputed_attribute` values that settle each arm, matched exactly after
 *  lower-casing and folding spaces and hyphens to underscores. The field is free
 *  text, so anything else ("birth year of John Laurie (GPZR-3X2)") settles
 *  neither arm and the assertion still caps, which fails safe. */
const BIRTH_PLACE_DISPUTES: ReadonlySet<string> = new Set([
  "birthplace", "birth_place", "place_of_birth",
]);
const BIRTH_DATE_DISPUTES: ReadonlySet<string> = new Set([
  "birth_year", "birth_date", "birthdate", "date_of_birth", "year_of_birth",
  "christening_date", "baptism_date",
]);

export interface ResolvedAgainst {
  place: ReadonlySet<string>;
  date: ReadonlySet<string>;
}

/** Assertions a RESOLVED FACT conflict decided against, per arm: every
 *  competitor that is not its `preferred_assertion_id`, released only on the
 *  arm its `disputed_attribute` names. A contradiction the project has already
 *  weighed and set aside is not a live one, so it cannot cap the link; one it did
 *  not weigh (a birthplace dispute says nothing about the same record's
 *  christening date) still does. An identity conflict releases nothing: its
 *  loser was judged to be a different person, so a link through it to the
 *  rejected identity is exactly what must stay capped. Read from the document as
 *  this op sees it, so a conflict resolved LATER in the same batch still
 *  refuses, which fails safe. Figures: `dev/measure-core-identifier-gate.ts`. */
function resolvedAgainstIds(research: any): ResolvedAgainst {
  const place = new Set<string>();
  const date = new Set<string>();
  for (const c of (research?.conflicts ?? []) as any[]) {
    if (c?.status !== "resolved" || c.conflict_type !== "fact") continue;
    if (typeof c.preferred_assertion_id !== "string") continue;
    const attr = String(c.disputed_attribute ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
    const into = BIRTH_PLACE_DISPUTES.has(attr) ? place : BIRTH_DATE_DISPUTES.has(attr) ? date : null;
    if (!into) continue;
    for (const id of (c.competing_assertion_ids ?? []) as unknown[]) {
      if (typeof id === "string" && id !== c.preferred_assertion_id) into.add(id);
    }
  }
  return { place, date };
}

/** A person_evidence link as the contradiction gate needs it: which assertion,
 *  to which person, at what tier. `id` is absent on a link this call appends;
 *  `fromBatch` marks a link an op of this call wrote, which the gate checks on
 *  that op itself. */
export interface PersonLink {
  assertion_id: string;
  person_id: string;
  id?: string;
  confidence?: unknown;
  fromBatch?: boolean;
}

/** The record an assertion belongs to, for grouping a record's assertions. */
function recordIdOf(a: any): string | null {
  return a?.record_id ?? a?.source_id ?? null;
}

function isRelational(a: any): boolean {
  return RELATIONAL_FACT_TYPES.has(String(a?.fact_type ?? "").toLowerCase());
}

/** Every assertion of `recordId` among `assertions`, and the party key over
 *  them (`recordPartyKeyer`: the persona id, else the role, read across the
 *  whole record). The contradiction gate, its two-party arm and the move gate
 *  all key parties through here so they cannot drift apart. */
function recordParties(assertions: Iterable<any>, recordId: string) {
  const onRecord = [...assertions].filter((a) => isLiveAssertion(a) && recordIdOf(a) === recordId);
  return { onRecord, partyKey: recordPartyKeyer(onRecord) };
}

/** Links the gate can see for this call: the project's live person_evidence
 *  with this batch's person_evidence ops replayed over it, whatever order the
 *  ops arrive in. An update that supersedes a link removes it, and one that
 *  re-points `person_id` or `assertion_id` moves it, so a link retired in the
 *  same call cannot pair and a link moved onto a person does. */
function batchPersonLinks(research: any, ops: ResearchAppendOp[]): PersonLink[] {
  type Replayed = { id?: string; assertion_id: unknown; person_id: unknown; confidence: unknown; superseded: boolean; fromBatch: boolean };
  const byId = new Map<string, Replayed>();
  const appended: Replayed[] = [];
  const live: any[] = Array.isArray(research?.person_evidence) ? research.person_evidence : [];
  for (const e of live) {
    if (e && typeof e.id === "string") {
      byId.set(e.id, {
        id: e.id, assertion_id: e.assertion_id, person_id: e.person_id, confidence: e.confidence,
        superseded: !!e.superseded_by, fromBatch: false,
      });
    }
  }
  for (const op of ops) {
    if (op.section !== "person_evidence") continue;
    if (op.op === "append") {
      const e = (op as any).entry;
      if (e) {
        appended.push({
          assertion_id: e.assertion_id, person_id: e.person_id, confidence: e.confidence,
          superseded: !!e.superseded_by, fromBatch: true,
        });
      }
    } else if (op.op === "update" && typeof op.entryId === "string") {
      const cur = byId.get(op.entryId);
      const f = (op as any).fields ?? {};
      if (!cur) continue;
      cur.fromBatch = true;
      if (Object.prototype.hasOwnProperty.call(f, "superseded_by")) cur.superseded = !!f.superseded_by;
      if (typeof f.person_id === "string") cur.person_id = f.person_id;
      if (typeof f.assertion_id === "string") cur.assertion_id = f.assertion_id;
      if (Object.prototype.hasOwnProperty.call(f, "confidence")) cur.confidence = f.confidence;
    }
  }
  const out: PersonLink[] = [];
  for (const l of [...byId.values(), ...appended]) {
    if (!l.superseded && typeof l.assertion_id === "string" && typeof l.person_id === "string") {
      out.push({
        ...(l.id ? { id: l.id } : {}),
        assertion_id: l.assertion_id, person_id: l.person_id, confidence: l.confidence, fromBatch: l.fromBatch,
      });
    }
  }
  return out;
}

/** How a gate reads an assertion's record and party, and whether it names a
 *  second person. */
interface PartyKeys {
  recordOf: (a: any) => unknown;
  partyOf: (a: any) => unknown;
  twoParty: (a: any) => boolean;
}

/** Whether `linked`, a two-party assertion, is about its OWN party when linked
 *  to `entry.person_id`: true when some other link ties a one-party assertion of
 *  the same record and the same party to that same person. `keys` says how
 *  record and party are read. */
function ownPartyLinkedTo(
  linked: any,
  entry: any,
  recordId: unknown,
  assertionById: ReadonlyMap<string, any>,
  personLinks: ReadonlyArray<PersonLink> | undefined,
  keys: PartyKeys,
): boolean {
  if (!personLinks || personLinks.length === 0) return false;
  const party = keys.partyOf(linked);
  if (party === null) return false;
  return personLinks.some((l) => {
    if (l.person_id !== entry.person_id || l.assertion_id === entry.assertion_id) return false;
    const other = assertionById.get(l.assertion_id);
    if (!other) return false;
    if (keys.twoParty(other)) return false;
    return keys.recordOf(other) === recordId && keys.partyOf(other) === party;
  });
}

/** The two parties a two-party assertion names: its own, and the one its
 *  `structured_value.related_person_role` names (null when it names none). */
function relationalParties(linked: any, partyKey: (a: any) => string | null): string[] {
  const own = partyKey(linked);
  const relatedRole = linked?.structured_value?.related_person_role;
  const related =
    typeof relatedRole === "string" && relatedRole !== "" ? partyKey({ record_role: relatedRole }) : null;
  return [own, related].filter((k): k is string => k !== null);
}

/** Which parties of `linked`, a two-party assertion, its link to `personId`
 *  may be about: those some other link ties to that same person through a
 *  one-party assertion of the same record. Empty when no link does. When links
 *  tie BOTH parties to the person, both are returned and both are checked: one
 *  person cannot be both, and dropping the link out of scope there let a
 *  throwaway link to the other party carry a contradicted one through. */
function partiesLinkedTo(
  linked: any,
  personId: unknown,
  onRecord: ReadonlyArray<any>,
  partyKey: (a: any) => string | null,
  personLinks?: ReadonlyArray<PersonLink>,
): string[] {
  if (!personLinks || personLinks.length === 0) return [];
  const parties = new Set(relationalParties(linked, partyKey));
  const byId = new Map(onRecord.map((a) => [a.id, a]));
  const found = new Set<string>();
  for (const l of personLinks) {
    if (l.person_id !== personId || l.assertion_id === linked.id) continue;
    const other = byId.get(l.assertion_id);
    if (!other || isRelational(other)) continue;
    const k = partyKey(other);
    if (k !== null && parties.has(k)) found.add(k);
  }
  return [...found];
}

/** Coordinates of standard places, looked up in `prepareOps` because the gate
 *  below is synchronous. A name that is absent or null was not resolved. */
export type BirthPlaceCoords = ReadonlyMap<string, PlaceCoords | null>;

/** Places types (as `placeTypeKey` reads them) that name a whole region rather
 *  than somewhere a person is born. Their coordinates are the region's centre,
 *  so a distance from one is not computable and the pair caps. A county,
 *  department or municipality still gets a distance: the cruz-corona-ancestry
 *  record is a Mexican municipality. Two counties against each other cap,
 *  though: two different counties named as a birthplace are two different
 *  places (Perthshire against Forfarshire), not one place measured twice. */
const REGION_PLACE_TYPES: ReadonlySet<string> = new Set([
  "continent", "country", "dependency or protectorate", "colony", "state", "province", "territory",
  "region", "prefecture", "governorate", "principality or emirate",
]);

/** The write path's whole budget for those lookups. Over it, a pair has no
 *  coordinates and the cap fires. */
const BIRTH_PLACE_COORDS_BUDGET_MS = 10_000;

/** The country a birth place names: the last segment, read from the end, that
 *  `canonicalCountry` recognizes. A trailing United Kingdom gives way to a
 *  country named before it, so "Bath, Somerset, England" and "Bath, Somerset,
 *  England, United Kingdom" both read England, while England against Scotland,
 *  or against "Dublin, Ireland, United Kingdom", still differs. Null when no
 *  segment is recognized. A US state is not read as the United States: "CA" is
 *  also Canada, and a US place's standard_place names its country anyway. Not
 *  `placeCountry`: that groups countries whose borders moved, which suits a
 *  residence move and would let a census's "born Ireland" against "born
 *  England" through here. */
function birthCountry(place: unknown): string | null {
  if (typeof place !== "string") return null;
  const segments = placeSegments(place);
  for (let i = segments.length - 1; i >= 0; i--) {
    const country = canonicalCountry(segments[i]);
    if (!country) continue;
    if (country === "united kingdom") {
      for (let k = i - 1; k >= 0; k--) {
        const inner = canonicalCountry(segments[k]);
        if (inner && inner !== "united kingdom") return inner;
      }
    }
    return country;
  }
  return null;
}

/** The country a standard place names. A FamilySearch standard place always
 *  ends at its country, so the last segment is read as one even when
 *  `canonicalCountry` does not know it ("Zagreb, Croatia"). */
function standardPlaceCountry(standardPlace: unknown): string | null {
  const known = birthCountry(standardPlace);
  if (known) return known;
  if (typeof standardPlace !== "string") return null;
  const segments = placeSegments(standardPlace);
  return segments.length > 1 ? normalizeString(segments[segments.length - 1]) : null;
}

/** Both sides name a country and the two differ. Read from the place text, or
 *  from the standard_place when the text names none. A bare United Kingdom
 *  does not differ from a constituent: it names no constituent to differ from.
 *  Offline. */
function birthCountriesDiffer(assertion: any, birth: any): boolean {
  const a = birthCountry(assertion?.place) ?? standardPlaceCountry(assertion?.standard_place);
  const b = birthCountry(birth?.place) ?? standardPlaceCountry(birth?.standard_place);
  if (a === null || b === null || a === b) return false;
  const ukPair = (x: string, y: string) => x === "united kingdom" && UK_CONSTITUENTS.has(y);
  return !ukPair(a, b) && !ukPair(b, a);
}

/** Every year `yearOf` would find in each value, not only the first. */
function yearsIn(...values: unknown[]): number[] {
  const out: number[] = [];
  for (const v of values) {
    for (const m of String(v ?? "").matchAll(new RegExp(YEAR_PATTERN, "g"))) out.push(Number(m[1]));
  }
  return out;
}

/** Whether two birth places that do not agree are far enough apart to be a
 *  contradiction (lead ruling 2026-10-13, issue #3390): different countries, or
 *  further apart than `birthThresholdMiles` allows for the era the dates span.
 *  Fails closed: with no country difference, the pair counts as far apart unless
 *  both sides carry a standard_place with coordinates finer than a region
 *  (`REGION_PLACE_TYPES`), they are not two counties, and some year is known.
 *  `unresolvedIsNear` opens the one case a slow lookup decides: a standard
 *  place the lookup returned no coordinates for. */
function birthPlacesFarApart(assertion: any, birth: any, coords?: BirthPlaceCoords, unresolvedIsNear = false): boolean {
  if (birthCountriesDiffer(assertion, birth)) return true;
  const sa = assertion?.standard_place;
  const sb = birth?.standard_place;
  if (typeof sa !== "string" || typeof sb !== "string") return true;
  const pa = coords?.get(sa);
  const pb = coords?.get(sb);
  if (!pa || !pb) return !unresolvedIsNear;
  if (REGION_PLACE_TYPES.has(placeTypeKey(pa.type)) || REGION_PLACE_TYPES.has(placeTypeKey(pb.type))) return true;
  if (placeTypeKey(pa.type) === "county" && placeTypeKey(pb.type) === "county") return true;
  const years = yearsIn(birth.date, birth.standard_date, assertion.date);
  if (years.length === 0) return true;
  const { miles } = haversineDistance(pa.latitude, pa.longitude, pb.latitude, pb.longitude);
  return miles > birthThresholdMiles(Math.min(...years), Math.max(...years));
}

interface ContradictionScope {
  birth: any;
  sameRecord: any[];
  resolvedAgainst: ResolvedAgainst;
}

/** Every assertion this call can resolve: the document's, plus this batch's
 *  predicted appends. Reading only `research.assertions` let a batch that puts
 *  its assertion appends AFTER the person_evidence ops silence the gates, the
 *  ordering bypass the score gate already closed. */
function resolvableAssertions(research: any, batchAssertions?: Map<string, any>): Map<string, any> {
  const assertionById = new Map<string, any>();
  for (const a of (research?.assertions ?? []) as any[]) {
    if (isLiveAssertion(a) && typeof a.id === "string") assertionById.set(a.id, a);
  }
  if (batchAssertions) for (const [id, a] of batchAssertions) assertionById.set(id, { ...a, id });
  return assertionById;
}

/** What the gate compares for one link, or null when the link is out of scope:
 *  not confident/probable, no resolvable record, a two-party assertion no other
 *  link says the party of, or a tree person with no Birth fact. */
function contradictionScope(
  entry: any,
  research: any,
  tree: any,
  personLinks?: ReadonlyArray<PersonLink>,
  batchAssertions?: Map<string, any>,
): ContradictionScope | null {
  if (entry.confidence !== "confident" && entry.confidence !== "probable") return null;
  const assertionById = resolvableAssertions(research, batchAssertions);
  const linked = assertionById.get(entry.assertion_id);
  if (!linked) return null;
  const recordId = recordIdOf(linked);
  if (recordId == null) return null;
  const { onRecord, partyKey } = recordParties(assertionById.values(), recordId);

  // A relationship assertion bears on BOTH people it names, and its own party
  // is only one of them: `a_004` ("listed in household of Thomas Flynn,
  // position consistent with son") carries the CHILD's role while the link may
  // be to the father. Comparing the child's stated birth of 1845 against a
  // father the tree puts at 1818 produced 14 refusals that are one household,
  // not one contradiction. The assertion alone cannot say which side a link is
  // about, so a two-party assertion is out of scope -- UNLESS another link ties
  // one of its two parties to the same person through a one-party assertion.
  // Then the link is about that party, and skipping it let a baptism's
  // relationship assertion carry `confident` onto the very person its
  // christening date had just been refused on (ut_person_evidence_024,
  // 2026-09-29: a_003 capped, a_001 from the same child persona persisted).
  // Which link lands first does not matter: a later one-party link re-checks
  // the relationship links it scopes (`relationalLinksScopedBy`, #2537).
  //
  // Both arms run here. The place arm was held back while `compatiblePlace`
  // read "Ohio" against "Ohio, United States" as a contradiction (247 would-be
  // refusals, 2026-09-29). With that fixed (#2537), measured 2026-10-21 over 350
  // documents (10,607 links, live coordinates): the two-party links refused rise
  // from 11 to 51, and every added refusal cites an assertion the one-party arm
  // already refuses in the same document (Maine vs New Brunswick, North Carolina
  // vs Kentucky, a 9-year birth gap). No new class; it closes the side door
  // round refusals that already stand.
  const own = partyKey(linked);
  const parties = isRelational(linked)
    ? partiesLinkedTo(linked, entry.person_id, onRecord, partyKey, personLinks)
    : own === null ? [] : [own];
  if (parties.length === 0) return null;

  const person = ((tree?.persons ?? []) as any[]).find((p: any) => p?.id === entry.person_id);
  if (!person) return null;
  const birth = ((person.facts ?? []) as any[]).find(
    (f: any) => String(f?.type ?? "").toLowerCase() === "birth",
  );
  if (!birth) return null;

  // Every assertion this record makes about THE SAME PARTY as the link.
  //
  // Scoping to the record alone is wrong and was measured wrong: a census or a
  // baptism names several people, and comparing a son's stated birth of 1845
  // against a father who the tree says was born 1818 produced 30 refusals that
  // are all one household, not one contradiction.
  const sameRecord = onRecord.filter((a: any) => parties.includes(partyKey(a) as string));
  return { birth, sameRecord, resolvedAgainst: resolvedAgainstIds(research) };
}

/** The record's birth-place assertions that disagree with the tree's Birth
 *  place, before the distance test. */
function disagreeingBirthPlaces(scope: ContradictionScope): any[] {
  const { birth, sameRecord, resolvedAgainst } = scope;
  if (typeof birth.place !== "string" || placeSegments(birth.place).length === 0) return [];
  return sameRecord.filter((a: any) =>
    // Like for like. An ANY-place comparison refuses 274 of 323 committed
    // confident/probable entries (85%) because a marriage or census place is
    // not a claim about birthplace: a man born in Ireland appears in a
    // Pennsylvania census, and that is biography, not contradiction.
    BIRTH_PLACE_FACT_TYPES.has(String(a.fact_type ?? "").toLowerCase()) &&
    contradictionIsCredible(a, resolvedAgainst.place) &&
    typeof a.place === "string" &&
    placeSegments(a.place).length > 0 &&
    // "Same House" names no place, so it states nothing, like a place-less one.
    !isNonPlacePhrase(a.place) &&
    !birthPlacesAgree(a, birth),
  );
}

/** The standard places the distance test needs for one link: both sides of
 *  every disagreeing pair whose countries are not already known to differ. */
export function birthPlaceCoordNames(
  entry: any,
  research: any,
  tree: any,
  personLinks?: ReadonlyArray<PersonLink>,
  batchAssertions?: Map<string, any>,
): string[] {
  const scope = contradictionScope(entry, research, tree, personLinks, batchAssertions);
  if (!scope) return [];
  const names: string[] = [];
  for (const a of disagreeingBirthPlaces(scope)) {
    if (birthCountriesDiffer(a, scope.birth)) continue;
    if (typeof a.standard_place !== "string" || typeof scope.birth.standard_place !== "string") continue;
    names.push(a.standard_place, scope.birth.standard_place);
  }
  return names;
}

/** What contradicts the tree person's birth on this link's record party, one
 *  clause per arm; empty when nothing does or the link is out of scope. */
function contradictionFindings(
  entry: any,
  research: any,
  tree: any,
  personLinks?: ReadonlyArray<PersonLink>,
  batchAssertions?: Map<string, any>,
  birthPlaceCoords?: BirthPlaceCoords,
  unresolvedIsNear = false,
): string[] {
  const scope = contradictionScope(entry, research, tree, personLinks, batchAssertions);
  if (!scope) return [];
  const { birth, sameRecord, resolvedAgainst } = scope;

  const findings: string[] = [];

  // ── place ────────────────────────────────────────────────────────────────
  const far = disagreeingBirthPlaces(scope).find((a) => birthPlacesFarApart(a, birth, birthPlaceCoords, unresolvedIsNear));
  if (far) {
    findings.push(
      `the record states '${far.place}' (assertion '${far.id}') where the tree person ` +
        `attests '${birth.place}'`,
    );
  }

  // ── date ─────────────────────────────────────────────────────────────────
  // Unlike place, a CHRISTENING date is comparable to a birth date: a baptism
  // follows birth closely, so a wide gap is a presumptive contradiction rather
  // than date noise. Senior genealogist ruling 2026-09-23 on the 13-year Flynn
  // gap: "Yes, the gap is too wide. This is something to scrutinize."
  //
  // The threshold is years, not days, because the tree side is routinely a
  // circa year (`~1845`) and a day-level comparison would read every circa date
  // as a contradiction. 5 years is wide enough to absorb a circa estimate and a
  // genuinely late baptism, and narrow enough to catch the 13-year case;
  // measured over every committed scenario fixture it refuses none.
  const treeBirthYear = yearOf(birth.date);
  if (treeBirthYear != null) {
    for (const a of sameRecord) {
      if (!BIRTH_DATE_FACT_TYPES.has(String(a.fact_type ?? "").toLowerCase())) continue;
      if (!contradictionIsCredible(a, resolvedAgainst.date)) continue;
      const stated = yearOf(a.date);
      if (stated == null) continue;
      if (Math.abs(stated - treeBirthYear) > MAX_BIRTH_YEAR_GAP) {
        findings.push(
          `the record states ${a.fact_type} in ${stated} (assertion '${a.id}') where the tree ` +
            `person attests a birth in ${treeBirthYear}, a ${Math.abs(stated - treeBirthYear)}-year gap`,
        );
        break;
      }
    }
  }

  return findings;
}

export function coreIdentifierContradictionInvariants(
  entry: any,
  research: any,
  tree: any,
  // Optional so every existing caller compiles unchanged; absent, a two-party
  // assertion stays out of scope exactly as before.
  personLinks?: ReadonlyArray<PersonLink>,
  batchAssertions?: Map<string, any>,
  // Prefetched in `prepareOps`. Absent, every same-country pair counts as far
  // apart, which is the place arm before the distance test.
  birthPlaceCoords?: BirthPlaceCoords,
  // Merges only: a place the lookup did not resolve is not a contradiction.
  unresolvedIsNear = false,
): string[] {
  const findings = contradictionFindings(entry, research, tree, personLinks, batchAssertions, birthPlaceCoords, unresolvedIsNear);
  if (findings.length === 0) return [];
  return [
    `confidence '${entry.confidence}' is not available on this link: ${findings.join("; ")}. ` +
      `A contradicted core identifier caps the link at 'speculative' regardless of the match ` +
      `score, and the user is asked before it stands. Use 'speculative' and name the ` +
      `contradiction in the rationale, or resolve it first — a confident wrong identity is ` +
      `worse than a flagged uncertain one.`,
  ];
}

/** The confident/probable relationship links that `entry`, a one-party link,
 *  gives a party to: live links to the same person, on a two-party
 *  assertion of the same record, one of whose two parties is `entry`'s. Links an
 *  op of this call writes are left out; that op is gated on its own. */
export function relationalLinksScopedBy(
  entry: any,
  research: any,
  personLinks?: ReadonlyArray<PersonLink>,
  batchAssertions?: Map<string, any>,
): PersonLink[] {
  if (!personLinks || personLinks.length === 0) return [];
  const assertionById = resolvableAssertions(research, batchAssertions);
  const own = assertionById.get(entry?.assertion_id);
  if (!own || isRelational(own)) return [];
  const recordId = recordIdOf(own);
  if (recordId == null) return [];
  const { partyKey } = recordParties(assertionById.values(), recordId);
  const party = partyKey(own);
  if (party === null) return [];
  return personLinks.filter((l) => {
    if (l.fromBatch || l.person_id !== entry.person_id) return false;
    if (l.confidence !== "confident" && l.confidence !== "probable") return false;
    const rel = assertionById.get(l.assertion_id);
    return !!rel && isRelational(rel) && recordIdOf(rel) === recordId &&
      relationalParties(rel, partyKey).includes(party);
  });
}

/** A one-party link that turns an earlier relationship link into a refused one
 *  is refused itself (#2537). Linking "son of Thomas" `confident` first and the
 *  same child's 1858 christening `speculative` afterwards left the relationship
 *  link standing, though the gate refuses it whenever the christening link is
 *  already there (ut_person_evidence_024). Re-checking here makes the verdict
 *  the same in either order. The way out is in the same call: lower the
 *  relationship link, or link this assertion to someone else. */
export function scopedRelationalLinkInvariants(
  entry: any,
  research: any,
  tree: any,
  personLinks?: ReadonlyArray<PersonLink>,
  batchAssertions?: Map<string, any>,
  birthPlaceCoords?: BirthPlaceCoords,
): string[] {
  const errors: string[] = [];
  // The links as they would stand without this one. A relationship link
  // already refused without it (one written under an earlier rule) is not this
  // link's doing, and refusing every later link for it would leave the party
  // unlinkable until someone edits the old link.
  const without = (personLinks ?? []).filter(
    (l) => !(l.fromBatch && l.assertion_id === entry.assertion_id && l.person_id === entry.person_id),
  );
  for (const l of relationalLinksScopedBy(entry, research, personLinks, batchAssertions)) {
    const findings = contradictionFindings(l, research, tree, personLinks, batchAssertions, birthPlaceCoords);
    if (findings.length === 0) continue;
    if (contradictionFindings(l, research, tree, without, batchAssertions, birthPlaceCoords).length > 0) continue;
    const which = l.id ? `'${l.id}'` : `the link on '${l.assertion_id}'`;
    errors.push(
      `linking '${entry.assertion_id}' to '${entry.person_id}' says the relationship link ${which} ` +
        `(assertion '${l.assertion_id}', '${l.confidence}') is about the same record party, and on ` +
        `that party ${findings.join("; ")}. A contradicted core identifier caps that link at ` +
        `'speculative'. In this same call, update ${which} to 'speculative' and name the ` +
        `contradiction in its rationale, or link '${entry.assertion_id}' to a different person.`,
    );
  }
  return errors;
}

const US_STATES: ReadonlySet<string> = new Set([
  "alabama", "alaska", "arizona", "arkansas", "california", "colorado", "connecticut", "delaware",
  "district of columbia", "florida", "georgia", "hawaii", "idaho", "illinois", "indiana", "iowa",
  "kansas", "kentucky", "louisiana", "maine", "maryland", "massachusetts", "michigan", "minnesota",
  "mississippi", "missouri", "montana", "nebraska", "nevada", "new hampshire", "new jersey",
  "new mexico", "new york", "north carolina", "north dakota", "ohio", "oklahoma", "oregon",
  "pennsylvania", "rhode island", "south carolina", "south dakota", "tennessee", "texas", "utah",
  "vermont", "virginia", "washington", "west virginia", "wisconsin", "wyoming",
]);
const US_STATE_CODES: ReadonlySet<string> = new Set([
  "al", "ak", "az", "ar", "ca", "co", "ct", "de", "dc", "fl", "ga", "hi", "id", "il", "in", "ia",
  "ks", "ky", "la", "me", "md", "ma", "mi", "mn", "ms", "mo", "mt", "ne", "nv", "nh", "nj", "nm",
  "ny", "nc", "nd", "oh", "ok", "or", "pa", "ri", "sc", "sd", "tn", "tx", "ut", "vt", "va", "wa",
  "wv", "wi", "wy",
]);
/** Countries whose borders moved across the years genealogy records cover, so a
 *  place named under one and a later record under another can be the same
 *  village. A move inside one group is never read as a move between countries:
 *  Ireland was in the United Kingdom until 1922, Prussian Posen is Polish
 *  Poznań, and Norway shared a crown with Denmark and then Sweden. */
const COUNTRY_GROUPS: ReadonlyMap<string, string> = new Map([
  ...["united kingdom", "england", "scotland", "wales", "northern ireland", "ireland"].map(
    (c) => [c, "british isles"] as [string, string],
  ),
  ...["germany", "poland", "austria", "hungary", "russia", "switzerland"].map(
    (c) => [c, "central europe"] as [string, string],
  ),
  ...["norway", "sweden", "denmark"].map((c) => [c, "scandinavia"] as [string, string]),
]);

/** The country group a free-text place names, or null when its last comma
 *  segment is not a country `canonicalCountry` recognizes (or a US state or
 *  state code, read as the United States). Country, never state: a state line
 *  is crossed by a short move as often as a long one, and the tool cannot tell
 *  which (#2537). */
export function placeCountry(place: unknown): string | null {
  if (typeof place !== "string") return null;
  const segments = placeSegments(place);
  const last = segments[segments.length - 1];
  if (!last) return null;
  const lower = last.toLowerCase();
  if (US_STATES.has(lower) || US_STATE_CODES.has(lower)) return "united states";
  const country = canonicalCountry(last);
  if (!country) return null;
  return COUNTRY_GROUPS.get(country) ?? country;
}

const HEAD_ROLES: ReadonlySet<string> = new Set(["head", "principal", "self"]);

const RESIDENCE_FACT_TYPES: ReadonlySet<string> = new Set(["residence", "census"]);
const TREE_RESIDENCE_FACT_TYPES: ReadonlySet<string> = new Set(["residence", "census"]);

/** A `confident` link across an unexplained move between countries is refused.
 *
 *  The move is read from the documents alone (ADR-0011's first question): the
 *  record's residence country, from any residence or census assertion on the
 *  linked record, against the countries of the Residence facts the tree person
 *  carries. A Residence fact whose every source is a record this person is linked
 *  to only below `confident` does not count, so the first capped link cannot
 *  vouch for the next record in the same new place. No attested residence, no
 *  cluster, no refusal. The agent clears it by naming what bridges the move in
 *  `move_bridge`; `probable` is never refused. The body's prose cap held about
 *  two runs in three (ut_person_evidence_g7m, 2026-10-06), which is why it is
 *  enforced here. */
export function unexplainedMoveInvariants(
  entry: any,
  research: any,
  tree: any,
  batchAssertions?: Map<string, any>,
): string[] {
  if (entry?.confidence !== "confident") return [];
  if (typeof entry.move_bridge === "string" && entry.move_bridge.trim() !== "") return [];
  const assertionById = resolvableAssertions(research, batchAssertions);
  const linked = assertionById.get(entry.assertion_id);
  if (!linked) return [];
  const recordId = recordIdOf(linked);
  if (recordId == null) return [];
  const { onRecord, partyKey } = recordParties(assertionById.values(), recordId);

  // The linked party's own residence; failing that, the household head's (a
  // census lists the residence once, on the head). Never another party's: an
  // informant living elsewhere says nothing about where the subject lived.
  const residenceOf = (pick: (a: any) => boolean) => {
    const countries = new Set<string>();
    let place: string | null = null;
    for (const a of onRecord) {
      if (!RESIDENCE_FACT_TYPES.has(String(a.fact_type ?? "").toLowerCase())) continue;
      if (!pick(a)) continue;
      const c = placeCountry(a.place);
      if (c) {
        countries.add(c);
        place ??= a.place;
      }
    }
    return { countries, place };
  };
  const linkedParty = partyKey(linked);
  let { countries: recordCountries, place: recordPlace } = residenceOf(
    (a) => linkedParty !== null && partyKey(a) === linkedParty,
  );
  if (recordCountries.size === 0) {
    ({ countries: recordCountries, place: recordPlace } = residenceOf((a) =>
      HEAD_ROLES.has(String(a.record_role ?? "").toLowerCase()),
    ));
  }
  if (recordCountries.size === 0) return [];

  const person = ((tree?.persons ?? []) as any[]).find((p: any) => p?.id === entry.person_id);
  if (!person) return [];

  // Tree S id -> research source id, and which research sources carry a
  // confident link to this person.
  const researchSourceByTreeRef = new Map<string, string>();
  for (const src of (research?.sources ?? []) as any[]) {
    if (src && typeof src.gedcomx_source_description_id === "string" && typeof src.id === "string") {
      researchSourceByTreeRef.set(src.gedcomx_source_description_id, src.id);
    }
  }
  const linkedBelowConfident = new Set<string>();
  const linkedConfident = new Set<string>();
  for (const pe of (research?.person_evidence ?? []) as any[]) {
    // The entry under write is already in the array; it must not vouch for itself.
    if (!pe || pe === entry || (entry.id && pe.id === entry.id)) continue;
    if (pe.person_id !== entry.person_id || pe.superseded_by) continue;
    // An attachment link reuses the import's S, which an imported residence
    // fact cites. Counting it here would stop that fact vouching, and so turn
    // this gate off for exactly the subjects the baseline step links.
    if (isAttachmentLink(pe)) continue;
    const a = assertionById.get(pe.assertion_id);
    if (!a || typeof a.source_id !== "string") continue;
    (pe.confidence === "confident" ? linkedConfident : linkedBelowConfident).add(a.source_id);
  }

  const residenceCountries = new Set<string>();
  let residencePlace: string | null = null;
  for (const f of (person.facts ?? []) as any[]) {
    const kind = typeof f?.type === "string" ? f.type.split("/").pop()!.toLowerCase() : "";
    if (!TREE_RESIDENCE_FACT_TYPES.has(kind)) continue;
    const c = placeCountry(f.place);
    if (!c) continue;
    // A Residence fact vouches only through a source other than the record being
    // judged, and not one this person is linked to only below confident. An
    // unmapped ref (a tree source with no research entry) is pre-existing
    // evidence and vouches; so does a fact with no sources at all.
    const refs = ((f.sources ?? []) as any[]).map((r: any) => researchSourceByTreeRef.get(r?.ref) ?? null);
    const vouches =
      refs.length === 0 ||
      refs.some(
        (id) =>
          id === null ||
          (id !== linked.source_id && !(linkedBelowConfident.has(id) && !linkedConfident.has(id))),
      );
    if (!vouches) continue;
    residenceCountries.add(c);
    residencePlace ??= f.place;
  }
  if (residenceCountries.size === 0) return [];
  for (const c of recordCountries) if (residenceCountries.has(c)) return [];

  return [
    `confidence 'confident' is not available on this link: the record places the person in ` +
      `'${recordPlace}' while the tree attests residence only in '${residencePlace}', a move ` +
      `between countries that nothing on the entry explains. Measure it (place_search, then ` +
      `place_distance), read the destination's {Jurisdiction}_Emigration_and_Immigration wiki ` +
      `page, and look for a record of the move. If a page sentence naming arrivals from the ` +
      `person's prior country, or a record, bridges it, quote it in move_bridge and keep ` +
      `'confident'; otherwise write 'probable' and name the gap in the rationale.`,
  ];
}

/** A declared core-identifier conflict caps the link at `speculative`.
 *
 *  Decidable from the write payload alone: it reads the entry's own
 *  `core_identifier_conflict` and nothing else, so it needs neither the tree nor
 *  a re-reading of the record. That is what makes it a precondition rather than
 *  a prompt rule (ADR-0011's first question).
 *
 *  Why this one refuses on a DECLARED conflict rather than an inferred one: an
 *  inferred cap would hit live traffic (`speculative` is 344 of 22,050 committed
 *  person_evidence writes, 1.6%). This fires only where the agent has ITSELF
 *  declared a conflict, and the field is new, so it refuses exactly zero writes
 *  that exist today.
 *
 *  The rule it replaces was prose, twice: the agent body already carried
 *  "a qualitative conflict caps confidence regardless of score" using the same
 *  0.85 figure as the test that kept failing, and a Step 3 forcing function that
 *  made the agent WRITE the verdict still let it argue past the verdict in the
 *  next clause (ut_person_evidence_012 and _024, 2026-09-23). Declaring the
 *  conflict is now what binds, not describing it.
 */
function coreIdentifierConflictInvariants(entry: any): string[] {
  const declared = entry.core_identifier_conflict;
  if (typeof declared !== "string" || declared.trim() === "") return [];
  if (entry.confidence === "speculative") return [];
  return [
    `confidence '${entry.confidence}' is not available on a link that declares a core-identifier ` +
      `conflict (core_identifier_conflict: ${JSON.stringify(declared)}). A contradicted core ` +
      `identifier caps the link at 'speculative' regardless of the match score, and the user is ` +
      `asked before it stands. Either set confidence to 'speculative', or — if the conflict is ` +
      `explained and does not bear on identity — say so in the rationale and clear ` +
      `core_identifier_conflict to null rather than keeping both.`,
  ];
}

/** Step 3 of the lead's 2026-09-07 ruling: the writer requires a recorded score.
 *
 *  TWO rules live here and only the first is gated on reachability:
 *
 *   * REQUIRING a score applies where one could have been obtained, which is
 *     what `personaReachable` decides.
 *   * FORBIDDING a fabricated score on a pairing the tool can prove CIRCULAR
 *     applies everywhere. A number there did not come from that comparison
 *     whatever route retrieved the record, so retrieval has no bearing on it.
 *
 *  Conflating them leaves the fabrication case unreachable: `a_005` in
 *  `flynn-stub-needed` is full-text sourced, so a reachability short-circuit
 *  returns before the circular check runs and the defect
 *  `ut_person_evidence_014` exists to catch -- scoring I1/I2/I3, then putting
 *  one of those numbers on the I4 it just minted -- is written unchallenged.
 *
 *  PR A made the call cheap and made it record; this is the half that makes the
 *  record mean something. Until it shipped, `match_score` was caller-fabricable
 *  and ADR-0009 constraint 2 conceded the point.
 */
function personEvidenceScoreInvariants(
  entry: any,
  research: any,
  tree: any,
  matchScores: Map<string, MatchScoreFile>,
  batchAssertions?: Map<string, any>,
  // Only an append must PRODUCE a score; an update that writes the field is
  // here for the fabrication arm alone.
  isAppend = true,
  // Persons present in starting-tree.gedcomx.json, read in `prepareOps`. Empty
  // for a legacy project with no baseline, which falls back to the PID test.
  startingPersonIds?: ReadonlySet<string>,
  // Assertion ids this very call creates. They cannot carry a score yet, and the
  // refusal has to say so rather than prescribe an impossible `same_person` call.
  createdAssertions?: ReadonlySet<string>,
): string[] {
  const assertions: any[] = research?.assertions ?? [];
  // The batch map first: it carries the ids this call's own assertion appends
  // will take, so a link written BEFORE its assertion in the same `ops` array
  // still resolves. Reading only the live document let that ordering skip the
  // gate entirely.
  const createdHere = createdAssertions?.has(entry.assertion_id) ?? false;
  const assertion =
    batchAssertions?.get(entry.assertion_id) ??
    assertions.find((a: any) => a?.id === entry.assertion_id);
  const recordId = assertion?.record_id ?? null;
  if (typeof recordId !== "string" || recordId === "") {
    // No record side to score, or an assertion nothing in this call can resolve.
    // There is nothing to attest against, so a null score is the honest value
    // and a number cannot have come from a call. Returning [] unconditionally
    // here made a missing field the bypass -- drop `assertion_id` from a link,
    // or order the batch so the assertion lands later, and the gate vanished.
    if (entry.match_score == null) return [];
    return [
      `person_evidence for '${entry.person_id}' carries match_score ` +
        `${JSON.stringify(entry.match_score)}, but assertion '${entry.assertion_id}' names ` +
        `no record to score against. Leave match_score null and say why in the rationale.`,
    ];
  }

  if (mintedFromThisRecord(entry.person_id, recordId, research, tree, startingPersonIds)) {
    // Exempt from NEEDING a score, but not free to carry one.
    if (entry.match_score == null) return [];
    return [
      `person_evidence for '${entry.person_id}' carries match_score ` +
        `${JSON.stringify(entry.match_score)}, but that person was minted from the very ` +
        `record this link cites ('${recordId}'). Scoring a persona against a person created ` +
        `out of it can only confirm itself, so there is no score to carry: leave match_score ` +
        `null and say why in the rationale. The worked example below shows the ordinary scored ` +
        `case; this pairing is the exception to it.`,
    ];
  }

  // Append, or an update that leaves a NUMBER behind. A `match_score: null`
  // update is a RETRACTION -- there is nothing to fabricate and nothing to
  // prove -- and refusing it left a bad score unremovable on any reachable
  // link while still letting `confidence` be escalated on it.
  if (!isAppend && entry.match_score == null) return [];
  // Reachability excuses a MISSING score, never a fabricated one. Gating the
  // whole arm on it left ut_person_evidence_014's actual defect open: a stub
  // minted by `tree_edit add_person` carries no source ref, so the circular walk
  // returns false, and its assertion is full-text sourced, so this predicate
  // returns false too -- both arms off, and a 0.005 copied from another pairing
  // landed unchallenged. 274 of 711 run-added persons (38%) are ref-less, so
  // that route is not an edge case. Refusing a carried score regardless of
  // reachability costs 3 refusals across the 192-run corpus.
  // `personaReachable` resolves the assertion from the live document, which is
  // only partly applied mid-batch. Every other arm here reads `batchAssertions`,
  // so without this view the same semantic batch got opposite verdicts from op
  // ORDER alone -- and the losing order was handed a remedy an unreachable lane
  // cannot deliver.
  const reachabilityView =
    assertion !== undefined && !assertions.some((a: any) => a?.id === entry.assertion_id)
      ? { ...research, assertions: [...assertions, { ...assertion, id: entry.assertion_id }] }
      : research;
  if (entry.match_score == null && !personaReachable(entry, reachabilityView)) return [];

  // Exact lookup on (assertion, tree person) first -- the pair the writer was
  // called with and the pair this entry carries. Keying on the PARTY instead
  // could not see a score written by the fetched route, which resolves a real
  // persons[].id where the assertion carries null. Then the persona arm: a score
  // that compared this assertion's verified persona with this tree person
  // answers for every fact of that persona (#3552; match-scores.ts header). A
  // second persona of the record is a different persona, so ADR-0009
  // constraint 3 holds.
  const file = matchScores.get(recordId) ?? null;
  const persona = scoredPersonaOf(assertion, recordId, assertions, batchAssertions);
  if (findRecordedScore(file, entry.assertion_id, entry.person_id, persona) !== null) return [];

  // Name `recordRole` when the assertion has one. Without it the agent takes the
  // call literally, `same_person` scores the assertion's OWN party against this
  // person, and a two-party record (a marriage naming groom and bride) yields a
  // number from the wrong comparison. The key does not encode which party was
  // compared, so nothing downstream can catch that -- the message is the only
  // place it can be said.
  const role = typeof assertion?.record_role === "string" ? assertion.record_role : null;
  const roleHint = role
    ? ` This assertion's own party is '${role}'; if '${entry.person_id}' is a DIFFERENT party ` +
      `on the same record, pass that party's recordRole so the score compares the right two ` +
      `people.`
    : "";
  // The persona arm is why one call is enough per persona; say so, or the agent
  // repeats the identical call for each fact.
  const personaHint = persona
    ? ` One score covers every fact of persona '${persona.personaId}' on this record: score it ` +
      `once for '${entry.person_id}' and the links for its other facts need no further call.`
    : "";
  // An assertion this same call CREATES cannot already have a score: `same_person`
  // reads research.json and throws on an assertion that is not in it, and the
  // whole batch is discarded on refusal, so the assertion never lands either.
  // Prescribing the call verbatim there sends the agent to an error. Split the
  // batch instead -- which is the only executable order.
  if (createdHere) {
    return [
      `person_evidence for '${entry.person_id}' records match_score ` +
        `${JSON.stringify(entry.match_score)}, but assertion '${entry.assertion_id}' is created ` +
        `by this same call, so no same_person score can exist for it yet. Split the call: append ` +
        `the assertion on its own first, then same_person({ projectPath, assertionId: ` +
        `'<the id it was given>', treePersonId: '${entry.person_id}' }), then write the link with ` +
        `the score it returns.${roleHint}`,
    ];
  }
  return [
    `person_evidence for '${entry.person_id}' (assertion '${entry.assertion_id}') records ` +
      `match_score ${JSON.stringify(entry.match_score)} with no same_person score behind it. ` +
      `Call same_person({ projectPath, assertionId: '${entry.assertion_id}', treePersonId: ` +
      `'${entry.person_id}' }) first, then write the link with the score it returns. The tool ` +
      `assembles both sides itself, so this costs one call and no payload. If that call cannot ` +
      `score the pairing, or if '${entry.person_id}' was created out of this very record, do NOT ` +
      `score it: leave match_score null and say why in the rationale.${roleHint}${personaHint}`,
  ];
}

/** The persona a link's assertion is about, with the roles its record gives it,
 *  or undefined when no score can be shared: the assertion carries no persona
 *  id; it names a second person (`isTwoParty`), so its link may be about that
 *  other party; or the record gives the id to more than one role, so it names no
 *  single party (`same_person` passes over such an id the same way). The
 *  record's assertions are gathered with `sameRecord`, the rule `same_person`
 *  scores by, from `batchAssertions` (the document plus this call's appends)
 *  when given. */
function scoredPersonaOf(
  assertion: any,
  recordId: string,
  assertions: readonly any[],
  batchAssertions?: Map<string, any>,
): ScoredPersona | undefined {
  const personaId = assertion?.record_persona_id;
  if (typeof personaId !== "string" || personaId === "" || isTwoParty(assertion?.fact_type)) return undefined;
  const pool = batchAssertions ? [...batchAssertions.values()] : assertions;
  const roles = personaRolesById(pool.filter((a) => sameRecord(a?.record_id, recordId))).get(personaId);
  return roles !== undefined && roles.size === 1 ? { personaId, roles } : undefined;
}

/** Whether a record persona `same_person` could score against is reachable for
 *  this assertion — decidable from the project documents alone, which is what
 *  makes it a tool-side question rather than a prose one.
 *
 *  `same_person` takes two GedcomX documents plus a focus id inside each. It
 *  never reads `record_persona_id`; that field points into a retained search
 *  sidecar, so a null value proves only that no sidecar was kept. What decides
 *  reachability is the tool that produced the assertion:
 *
 *   - non-null `record_persona_id` — verified against the record's
 *     `gedcomx.persons[]` at write time (§3.5), so the persona exists;
 *   - `record_read` — returns a SimplifiedGedcomX with a persons array, so the
 *     record can be re-opened from its `record_id`;
 *   - `person_record_matches` — a FamilySearch hint the researcher accepted
 *     (search-hints' record mode). Its ark is a `1:1:` record persona, which is
 *     how record-extraction fetches it (`record_read`), so it re-opens the same
 *     way;
 *   - `record_search` with a retained `results_ref` — the sidecar result carries
 *     the record's `gedcomx`.
 *
 *  Everything else cannot: image-, external-site- and PDF-sourced assertions, a
 *  search whose sidecar was not retained, and every `fulltext_search` hit (an FTS
 *  result carries transcript text, names and places but no GedcomX, and its ARK
 *  is a `3:1:`/`3:2:` image entry `record_read` cannot open). Unresolvable
 *  provenance counts as reachable, so an assertion written with no `log_entry_id`
 *  cannot shed the requirement by omission.
 *
 *  Kept in step with `_persona_reachable` in `eval/harness/harness/
 *  skill_invocation.py`, which is the same predicate on the eval side. */
export function personaReachable(entry: any, research: any): boolean {
  const assertions: any[] = research.assertions ?? [];
  const assertion = assertions.find((a: any) => a?.id === entry.assertion_id);
  if (!assertion) return true; // unresolvable — provenance unknown, not proof
  if (assertion.record_persona_id) return true;
  const log: any[] = research.log ?? [];
  const logEntry = log.find((l: any) => l?.id === assertion.log_entry_id);
  if (!logEntry) return true; // no log entry — provenance unknown
  if (logEntry.tool === "record_read" || logEntry.tool === "person_record_matches") return true;
  if (logEntry.tool === "record_search" && logEntry.results_ref) return true;
  return false;
}

/** Whether this tree person exists only because of the record now being linked.
 *
 *  The lead's step-3 wording is "a tree person whose only source ref is this
 *  record", and it is NOT decidable from the tree alone: refs hang off the
 *  person itself, its `names[]` and its `facts[]`, and a tree source
 *  description carries `id/title/citation/author/url` and no record id. So the
 *  walk is six hops and ends in `research.json`:
 *
 *    tree person/names[]/facts[].sources[].ref -> tree sources[].id
 *      -> research sources[].gedcomx_source_description_id
 *      -> research sources[].id -> assertions[].source_id
 *      -> assertions[].record_id
 *
 *  An EMPTY ref set is deliberately NOT exempt. Measured over 192 committed
 *  e2e final states (9,223 links), exempting it would cover 1,131 more links
 *  on top of the 1,381 that genuinely resolve to this record alone. No
 *  refs means provenance unknown, not minted-from-this-record, and the match
 *  engine scores stubs fine (lead ruling 2026-09-11). ADR-0009 already refuted
 *  a tree-source-ref basis on exactly this ground.
 */
/** A FamilySearch person id, e.g. `LKFW-9XH`. A person carrying one came FROM
 *  FamilySearch and was therefore not minted here. Measured over the 192
 *  committed e2e final trees: of the 706 run-added persons in the 191 runs that
 *  have a committed `starting-tree.gedcomx.json`, 0 carry a PID-shaped id, and
 *  1,139 of the 1,142 PID-shaped ids belong to starting-tree persons. The other
 *  3 are all in `william-ferber-ancestry`, the one fixture with NO committed
 *  baseline -- so they cannot be checked either way, and that is precisely the
 *  fail-open case this test exists to serve. The implication it relies on --
 *  PID-shaped => pre-existing -- therefore has no confirmed counterexample and
 *  3 unverifiable cases, rather than none at all. */
const FS_PERSON_PID = /^[A-Z0-9]{4}-[A-Z0-9]{3,4}$/;

export function mintedFromThisRecord(
  personId: string,
  recordId: string,
  research: any,
  tree: any,
  startingPersonIds?: ReadonlySet<string>,
): boolean {
  // "Minted from this record" must mean the person was CREATED out of it. The
  // ref walk below cannot tell that on its own: a long-standing FamilySearch
  // person who simply has one record attached so far satisfies it too, and
  // calling that circular hard-refuses a legitimate score. Two cheap
  // discriminators come first, both measured: a FamilySearch PID, and presence
  // in the write-once starting-tree baseline. Without them the exemption
  // refused 232 committed links, 206 of which were pre-existing people (184
  // caught by both discriminators, 22 by the starting-tree baseline alone).
  if (pidOrStartingPerson(personId, startingPersonIds)) return false;
  // A person with an attachment link came from FamilySearch: only an imported
  // person has records attached there. Without this, reusing the import's S for
  // an attached record makes that person's only ref reach this record, and a
  // project with no starting-tree baseline would read them as minted from it,
  // exempting any caller's link to them from the score gate.
  if (((research?.person_evidence ?? []) as any[]).some((pe) => pe?.person_id === personId && isAttachmentLink(pe))) {
    return false;
  }
  const person = ((tree?.persons ?? []) as any[]).find((p: any) => p?.id === personId);
  if (!person) return false;
  const refs = personSourceRefs(person);
  if (refs.size === 0) return false; // provenance unknown, not circular
  // Every record this person's refs reach is the one under scrutiny.
  const { recordIds } = refsReach(refs, research);
  return recordIds.size > 0 && [...recordIds].every((r) => r === recordId);
}

/** Whether this person was not made during the run: a FamilySearch person id,
 *  or a person in the write-once starting tree. The two discriminators
 *  `mintedFromThisRecord` applies first, measured in its docblock. */
export function pidOrStartingPerson(personId: string, startingPersonIds?: ReadonlySet<string>): boolean {
  return FS_PERSON_PID.test(personId) || startingPersonIds?.has(personId) === true;
}

/** Every source ref a tree person carries. Person-level refs count too (#2696):
 *  "only source ref" means every ref the person carries, and person_read
 *  attaches FamilySearch's at this level. */
export function personSourceRefs(person: any): Set<string> {
  return new Set(
    [
      person,
      ...((Array.isArray(person?.names) ? person.names : []) as any[]),
      ...((Array.isArray(person?.facts) ? person.facts : []) as any[]),
    ].flatMap(sourceRefsOf),
  );
}

/** What tree source refs reach in research.json:
 *
 *    ref -> tree sources[].id -> research sources[].gedcomx_source_description_id
 *        -> research sources[].id -> assertions[].record_id
 *
 *  An S entry reaches EVERY research source that cites it. Two sources can cite
 *  one S entry (source reuse across repositories), and keeping only the last
 *  one, as this walk once did, hid a record or showed one depending on source
 *  order. A ref no research source cites reaches nothing. */
export function refsReach(
  refs: Iterable<string>,
  research: any,
): { sourceIds: Set<string>; recordIds: Set<string> } {
  const sourcesByDescription = new Map<string, string[]>();
  for (const src of (research?.sources ?? []) as any[]) {
    const gid = src?.gedcomx_source_description_id;
    if (typeof gid !== "string" || gid === "" || typeof src.id !== "string") continue;
    const list = sourcesByDescription.get(gid);
    if (list) list.push(src.id);
    else sourcesByDescription.set(gid, [src.id]);
  }
  const sourceIds = new Set<string>();
  for (const ref of refs) {
    const bare = ref.startsWith("#") ? ref.slice(1) : ref;
    for (const id of sourcesByDescription.get(bare) ?? []) sourceIds.add(id);
  }
  const recordIds = new Set<string>();
  for (const a of (research?.assertions ?? []) as any[]) {
    if (typeof a?.record_id !== "string" || a.record_id === "") continue;
    if (sourceIds.has(a.source_id)) recordIds.add(a.record_id);
  }
  return { sourceIds, recordIds };
}

/** Whether this person was made out of one document alone: not a FamilySearch
 *  or starting-tree person, and every source its refs reach cites the same S
 *  entry as research source `sourceId`. The namesake cap asks it of a relative,
 *  who cannot vouch for the record it was made from. */
export function mintedFromThisSource(
  personId: string,
  sourceId: string,
  research: any,
  tree: any,
  startingPersonIds?: ReadonlySet<string>,
): boolean {
  if (pidOrStartingPerson(personId, startingPersonIds)) return false;
  const person = ((tree?.persons ?? []) as any[]).find((p: any) => p?.id === personId);
  if (!person) return false;
  const { sourceIds } = refsReach(personSourceRefs(person), research);
  if (sourceIds.size === 0) return false;
  const description = new Map<string, unknown>();
  for (const src of (research?.sources ?? []) as any[]) {
    if (typeof src?.id === "string") description.set(src.id, src.gedcomx_source_description_id);
  }
  const own = description.get(sourceId);
  return typeof own === "string" && [...sourceIds].every((s) => description.get(s) === own);
}

// ─── Circular corroboration (issue #2943) ───────────────────────────────────
//
// A doubted record "proved" by tree facts that were added because of that same
// record. A starting-tree person linked at `probable` or `confident` to a record
// is refused when the only corroboration the tree can offer is the record's own:
// every source on the baseline relationship between the person and each parent
// or spouse the record names reaches this record, or a copy of it. Specified in
// docs/specs/research-append-tool-spec.md, "Circular corroboration".

/** Tree-as-source: a description of the FamilySearch tree itself is the tree
 *  vouching for itself, so it counts as no source at all. */
function isTreeAsSource(description: any): boolean {
  return (
    /family\s*search\s+family\s+tree/i.test(String(description?.title ?? "")) ||
    /familysearch\.org\/tree\//i.test(String(description?.url ?? ""))
  );
}

const CIRCULAR_CHILD_LIKE: ReadonlySet<string> = new Set([
  "child", "baptized", "baptised", "baptized_child", "deceased", "principal", "subject", "registrant", "son",
  "daughter", "born", "newborn", "infant",
]);
const CIRCULAR_SPOUSAL: ReadonlyMap<string, "male" | "female" | null> = new Map([
  ["husband", "male"], ["wife", "female"], ["spouse", null], ["groom", "male"], ["bride", "female"], ["partner", null],
]);
const PARENT_ROLE = /^(father|mother|parent)(?:_of_(.+))?$/;

const normalizedRole = (role: unknown): string =>
  String(role ?? "").toLowerCase().trim().replace(/_\d+$/, "");

/** What a record party's role makes it to a party in role `subject`: the tree
 *  relation (parent or spouse only) and the gender the role states, or null when
 *  the roles name no such relation. `father_of_groom` is the parent of a groom
 *  only; the other parent named beside a father or mother is the spouse, and so
 *  is a `mother_of_<x>` beside a `father_of_<x>`, the same `<x>` only, never a
 *  `mother_of_bride` beside a `father_of_groom` (chesworthrm, 2026-10-29). */
export function coPartyRelation(
  subject: string,
  co: string,
): { relation: "parent" | "spouse"; gender: "male" | "female" | null } | null {
  const m = PARENT_ROLE.exec(co);
  if (m) {
    const gender = m[1] === "father" ? "male" : m[1] === "mother" ? "female" : null;
    const s = PARENT_ROLE.exec(subject);
    if (s) {
      if (m[2] === undefined) return { relation: "spouse", gender };
      return m[2] === s[2] && co !== subject ? { relation: "spouse", gender } : null;
    }
    if (m[2] !== undefined && m[2] !== subject && !(CIRCULAR_CHILD_LIKE.has(m[2]) && CIRCULAR_CHILD_LIKE.has(subject))) {
      return null;
    }
    return { relation: "parent", gender };
  }
  if (co === subject) return null;
  if (CIRCULAR_SPOUSAL.has(co) && (CIRCULAR_SPOUSAL.has(subject) || HOUSEHOLD_HEADS.has(subject))) {
    return { relation: "spouse", gender: CIRCULAR_SPOUSAL.get(co) ?? null };
  }
  if (HOUSEHOLD_HEADS.has(co) && CIRCULAR_SPOUSAL.has(subject)) return { relation: "spouse", gender: null };
  return null;
}

const ENTRY_EVENTS: ReadonlySet<string> = new Set(["birth", "christening", "baptism"]);
/** Facts a register-entry index carries. A record with any other fact (a death, a
 *  residence, an occupation) is another kind of record, not a copy of the entry. */
const ENTRY_FACTS: ReadonlySet<string> = new Set(["name", "gender", "relationship", ...ENTRY_EVENTS]);
const FULL_DATE = /^(?:\d{4}-\d{2}-\d{2}|\d{1,2} [A-Za-z]{3,9} \d{4})$/;

/** One record or its copies: the bare record ids, research sources and source
 *  descriptions that are the same register entry as an assertion's record.
 *  Joined when they share a record id, a research source, a source description,
 *  or a party's birth, christening or baptism with the same full date, the same
 *  place and the same given name (two indexes of one entry share no identifier;
 *  lead, 2026-10-18), on records that carry only names, genders, relationships and
 *  those events. A year-only date matches nothing, and a record with any other
 *  fact (a death certificate repeating the birth date) is another record. */
export function sameEntryOf(
  research: any,
  seed: any,
): { records: Set<string>; sources: Set<string>; descriptions: Set<string> } | null {
  if (typeof seed?.record_id !== "string" || seed.record_id === "") return null;
  const assertions = ((Array.isArray(research?.assertions) ? research.assertions : []) as any[]).filter(
    (a) => isLiveAssertion(a) && typeof a.record_id === "string" && a.record_id !== "",
  );
  const descriptionOf = new Map<string, string>();
  for (const s of (Array.isArray(research?.sources) ? research.sources : []) as any[]) {
    if (typeof s?.id === "string" && typeof s.gedcomx_source_description_id === "string") {
      descriptionOf.set(s.id, s.gedcomx_source_description_id);
    }
  }
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(x, root);
    return root;
  };
  const add = (x: string) => {
    if (!parent.has(x)) parent.set(x, x);
  };
  const joinOn = (firsts: Map<string, string>, key: string, record: string) => {
    const first = firsts.get(key);
    if (first === undefined) firsts.set(key, record);
    else parent.set(find(record), find(first));
  };
  const bySource = new Map<string, string>();
  const byDescription = new Map<string, string>();
  const byEvent = new Map<string, string>();
  const partyOf = capPartyKeyer(assertions);
  const given = new Map<string, string>();
  for (const a of assertions) {
    if (String(a.fact_type ?? "").toLowerCase() !== "name") continue;
    const first = nameKey(a.value)?.split(" ")[0];
    if (first && !given.has(partyOf(a))) given.set(partyOf(a), first);
  }
  const otherKinds = new Set(
    assertions
      .filter((a) => !ENTRY_FACTS.has(String(a.fact_type ?? "").toLowerCase()))
      .map((a) => arkToBareId(a.record_id)),
  );
  for (const a of assertions) {
    const record = arkToBareId(a.record_id);
    add(record);
    if (typeof a.source_id === "string" && a.source_id !== "") {
      joinOn(bySource, a.source_id, record);
      const d = descriptionOf.get(a.source_id);
      if (d !== undefined) joinOn(byDescription, d, record);
    }
    if (!ENTRY_EVENTS.has(String(a.fact_type ?? "").toLowerCase())) continue;
    const date = typeof a.date === "string" ? stdDate(a.date) : "";
    const place = capNorm(a.standard_place ?? a.place);
    const first = given.get(partyOf(a));
    if (FULL_DATE.test(date) && place !== "" && first && !otherKinds.has(record)) joinOn(byEvent, `${date}\u0000${place}\u0000${first}`, record);
  }
  const root = find(arkToBareId(seed.record_id));
  const records = new Set<string>();
  const sources = new Set<string>();
  const descriptions = new Set<string>();
  for (const a of assertions) {
    const record = arkToBareId(a.record_id);
    if (find(record) !== root) continue;
    records.add(record);
    if (typeof a.source_id === "string" && a.source_id !== "") {
      sources.add(a.source_id);
      const d = descriptionOf.get(a.source_id);
      if (d !== undefined) descriptions.add(d);
    }
  }
  return { records, sources, descriptions };
}

type TreeSourceRef = { ref: string; description: any };

/** The sources, bar tree-as-source, on every relationship in a tree between two
 *  persons: parent-child either way, or a couple. A duplicate relationship with
 *  no source adds nothing. */
function edgeSources(tree: any, a: string, b: string): TreeSourceRef[] {
  const descriptions = new Map<string, any>(
    ((Array.isArray(tree?.sources) ? tree.sources : []) as any[])
      .filter((s) => s && typeof s.id === "string")
      .map((s) => [s.id, s]),
  );
  const out: TreeSourceRef[] = [];
  for (const r of (Array.isArray(tree?.relationships) ? tree.relationships : []) as any[]) {
    const ends = r?.type === "ParentChild" ? [r.parent, r.child] : r?.type === "Couple" ? [r.person1, r.person2] : [];
    if (!(ends.includes(a) && ends.includes(b))) continue;
    for (const ref of sourceRefsOf(r)) {
      const bare = ref.startsWith("#") ? ref.slice(1) : ref;
      const description = descriptions.get(bare);
      if (description !== undefined && isTreeAsSource(description)) continue;
      out.push({ ref: bare, description });
    }
  }
  return out;
}

/** Whether a tree source is this entry: its url names one of the entry's record
 *  ids, or a research source of the entry cites its description. A source it
 *  cannot place reads as another record. */
function treeSourceIsEntry(
  s: TreeSourceRef,
  entry: { records: Set<string>; sources: Set<string> },
  research: any,
): boolean {
  const url = typeof s.description?.url === "string" ? arkToBareId(s.description.url) : "";
  if (url !== "" && entry.records.has(url)) return true;
  const { sourceIds, recordIds } = refsReach([s.ref], research);
  return (
    [...sourceIds].some((x) => entry.sources.has(x)) || [...recordIds].some((r) => entry.records.has(arkToBareId(r)))
  );
}

export interface CircularVerdict {
  refused: boolean;
  kind: "relationship" | "subject";
  /** The linked assertion's record. */
  record: string;
  /** Each role-matched parent or spouse the baseline holds, and whether the
   *  sources on that relationship are all this entry (`circular`) or a new source
   *  or record clears it (`cleared`). Empty for the subject-alone arm. */
  relatives: Array<{ id: string; relation: "parent" | "spouse"; circular: boolean; cleared: boolean }>;
}

/** The verdict on one live probable or confident link, or null when the gate
 *  does not apply: no baseline, a person the baseline does not hold, an
 *  assertion with no record, negative evidence, or a two-party assertion. `tree` is the live tree,
 *  which can only clear a refusal; `baseline` decides circularity. */
export function circularCorroborationVerdict(entry: any, research: any, tree: any, baseline: any): CircularVerdict | null {
  if (!baseline || !isStrongConfidence(entry?.confidence) || entry.superseded_by) return null;
  const personId = entry.person_id;
  const subject = ((Array.isArray(baseline.persons) ? baseline.persons : []) as any[]).find((p) => p?.id === personId);
  if (!subject) return null;
  const assertions = ((Array.isArray(research?.assertions) ? research.assertions : []) as any[]).filter(isLiveAssertion);
  const linked = assertions.find((a) => a?.id === entry.assertion_id);
  // A two-party assertion (a relationship or a marriage) names the person it is
  // linked to, not its own party, so its role says nothing about who that person
  // is on the record.
  if (!linked || recordBasisOf(linked) === "absent" || isTwoParty(linked.fact_type)) return null;
  const here = sameEntryOf(research, linked);
  if (!here) return null;
  const record = arkToBareId(linked.record_id);

  const partyOf = capPartyKeyer(assertions);
  const own = partyOf(linked);
  const subjectRole = normalizedRole(linked.record_role);
  const coRoles = new Set<string>();
  for (const a of assertions) {
    if (typeof a?.record_id === "string" && here.records.has(arkToBareId(a.record_id)) && partyOf(a) !== own) {
      coRoles.add(normalizedRole(a.record_role));
    }
  }

  // Records outside this entry that a live strong link ties to a person.
  const recordsLinked = (id: string): Set<string> => {
    const out = new Set<string>();
    for (const e of (Array.isArray(research?.person_evidence) ? research.person_evidence : []) as any[]) {
      if (!isLiveStrong(e) || e.person_id !== id) continue;
      const a = assertions.find((x) => x?.id === e.assertion_id);
      if (typeof a?.record_id !== "string" || a.record_id === "") continue;
      const r = arkToBareId(a.record_id);
      if (!here.records.has(r)) out.add(r);
    }
    return out;
  };

  const relatives: CircularVerdict["relatives"] = [];
  for (const [id, { relation, person }] of relativesById(baseline, personId)) {
    if (relation === "child") continue;
    const gender = String(person?.gender ?? "").toLowerCase();
    const named = [...coRoles].some((co) => {
      const m = coPartyRelation(subjectRole, co);
      return m !== null && m.relation === relation && (m.gender === null || gender === "" || gender === m.gender);
    });
    if (!named) continue;
    const base = edgeSources(baseline, personId, id);
    if (base.length === 0) {
      relatives.push({ id, relation, circular: false, cleared: false });
      continue;
    }
    const circular = base.every((s) => treeSourceIsEntry(s, here, research));
    const cleared =
      circular &&
      (edgeSources(tree, personId, id).some((s) => !treeSourceIsEntry(s, here, research)) ||
        [...recordsLinked(personId)].some((r) => recordsLinked(id).has(r)));
    relatives.push({ id, relation, circular, cleared });
  }
  if (relatives.length > 0) {
    return { refused: relatives.every((r) => r.circular && !r.cleared), kind: "relationship", record, relatives };
  }
  // Nothing in the record names a relative the baseline holds: the subject
  // alone. Only `confident` rests on more than the record's own attachment.
  const descriptions = new Map<string, any>(
    ((Array.isArray(baseline.sources) ? baseline.sources : []) as any[]).filter((s) => s && typeof s.id === "string").map((s) => [s.id, s]),
  );
  const refs: TreeSourceRef[] = [...personSourceRefs(subject)]
    .map((ref) => (ref.startsWith("#") ? ref.slice(1) : ref))
    .map((ref) => ({ ref, description: descriptions.get(ref) }))
    .filter((s) => s.description === undefined || !isTreeAsSource(s.description));
  const circular = refs.length > 0 && refs.every((s) => treeSourceIsEntry(s, here, research));
  return { refused: circular && entry.confidence === "confident", kind: "subject", record, relatives };
}

function circularCorroborationRefusal(entry: any, verdict: CircularVerdict): string {
  const p = entry.person_id;
  const settle = `Find a record independent of '${verdict.record}' that corroborates it, or lower confidence to 'speculative'.`;
  if (verdict.kind === "subject") {
    return (
      `confidence 'confident' is not available on link '${entry.id}' to '${p}': every source on '${p}' in the ` +
      `starting tree is record '${verdict.record}' or a copy of it, so nothing but its own attachment supports ` +
      `the link. 'probable' is available. ${settle}`
    );
  }
  const who = verdict.relatives.map((r) => `'${r.id}' (${r.relation})`).join(", ");
  return (
    `confidence '${entry.confidence}' is not available on link '${entry.id}' to '${p}': the starting tree's ` +
    `only sources for '${p}''s relationship to ${who}, named by this record, are record '${verdict.record}' ` +
    `or a copy of it, so those tree facts came from the record and cannot confirm it. ${settle} A record naming ` +
    `'${p}' together with the relative, linked at 'probable' or 'confident' to both, or a source on that ` +
    `relationship from another record, settles it.`
  );
}

/** The gate on one research_append call, judged on its end state: one finding per
 *  link the call asserts (a live probable or confident pairing not standing
 *  before, or raised above the strongest standing link of its pairing), keyed to
 *  the last op that wrote it. */
export function circularCorroborationCallCheck(
  before: { research: any },
  after: { research: any; tree: any },
  applied: ReadonlyArray<{ section: string; entryId: string }>,
  baseline: any,
): Array<{ index: number | null; message: string }> {
  if (!baseline) return [];
  const strongBefore = new Map<string, any>();
  for (const e of (Array.isArray(before.research?.person_evidence) ? before.research.person_evidence : []) as any[]) {
    if (!isLiveStrong(e)) continue;
    const prev = strongBefore.get(pairingKey(e));
    if (!prev || CONFIDENCE_RANK[e.confidence] > CONFIDENCE_RANK[prev.confidence]) strongBefore.set(pairingKey(e), e);
  }
  const findings: Array<{ index: number | null; message: string }> = [];
  for (const e of (Array.isArray(after.research?.person_evidence) ? after.research.person_evidence : []) as any[]) {
    if (!isLiveStrong(e) || typeof e.id !== "string" || typeof e.person_id !== "string") continue;
    const prev = strongBefore.get(pairingKey(e));
    if (prev && CONFIDENCE_RANK[e.confidence] <= CONFIDENCE_RANK[prev.confidence]) continue;
    const verdict = circularCorroborationVerdict(e, after.research, after.tree, baseline);
    if (!verdict?.refused) continue;
    let index: number | null = null;
    for (let i = applied.length - 1; i >= 0; i--) {
      if (applied[i].section === "person_evidence" && applied[i].entryId === e.id) {
        index = i;
        break;
      }
    }
    findings.push({ index, message: circularCorroborationRefusal(e, verdict) });
  }
  return findings;
}

// ─── The namesake cap (issue #3363) ─────────────────────────────────────────
//
// A recorded namesake (`namesakes[]`) is a different person who shares a tree
// person's name, place and time. While one is recorded, a probable or confident
// link to that person stands only when something in its record ties it to them:
// (a) another party of the same source linked strongly to their spouse, parent or
// child, or (b) the same street address or occupation as a record already
// linked to them. A name, a date and a place alone fit the namesake as well.

/** Probable or confident: the confidence a recorded namesake caps. */
const isStrongConfidence = (c: unknown): boolean => c === "probable" || c === "confident";
const CONFIDENCE_RANK: Readonly<Record<string, number>> = { speculative: 0, probable: 1, confident: 2 };

function isLiveStrong(e: any): boolean {
  return !!e && !e.superseded_by && isStrongConfidence(e.confidence);
}

/** A link's (assertion_id, person_id) pairing as one key. */
export function pairingKey(e: { assertion_id?: unknown; person_id?: unknown }): string {
  return `${String(e?.assertion_id)}\u0000${String(e?.person_id)}`;
}

/** The source a link is judged on. A document extracted with one record id per
 *  persona keeps its parties together under its source. */
function capSource(a: any): unknown {
  return typeof a?.source_id === "string" && a.source_id !== "" ? a.source_id : (a?.record_id ?? null);
}

/** The sources a call's person_evidence appends link from, each with the op
 *  indices under it. Keyed by `capSource`, so a document that keeps each party
 *  on its own record id is one source; a record id is compared bare and shown
 *  as first written. An assertion not in research.json before the call is not
 *  counted. */
export function personEvidenceAppendSources(
  ops: readonly ResearchAppendOp[],
  research: any,
): Map<string, { shown: string; ops: number[] }> {
  const byId = new Map<string, any>();
  for (const a of (research?.assertions ?? []) as any[]) if (typeof a?.id === "string") byId.set(a.id, a);
  const out = new Map<string, { shown: string; ops: number[] }>();
  ops.forEach((op, i) => {
    if (op?.section !== "person_evidence" || op.op !== "append") return;
    const a = byId.get((op.entry as any)?.assertion_id);
    const src = capSource(a);
    if (typeof src !== "string" || src === "") return;
    const key = src === a.source_id ? src : arkToBareId(src);
    const seen = out.get(key);
    if (seen) seen.ops.push(i);
    else out.set(key, { shown: src, ops: [i] });
  });
  return out;
}

function oneSourcePerCallError(sources: Map<string, { shown: string; ops: number[] }>): string {
  const listed = [...sources.values()].map((s) => `'${s.shown}' (ops ${s.ops.join(", ")})`).join("; ");
  return (
    `these person_evidence appends link assertions from ${sources.size} sources: ${listed}. ` +
    "Send one research_append call per source, written as soon as that source's links are decided; " +
    "nothing in this call was written."
  );
}

/** A record party: the bare record id with the party `recordPartyKeyer` reads
 *  across that record's assertions. Under one source, two personas that share a
 *  role on separate records stay apart. */
function capPartyKeyer(assertions: Iterable<any>): (a: any) => string {
  const byRecord = new Map<string | null, any[]>();
  for (const a of assertions) {
    const r = recordIdOf(a);
    const list = byRecord.get(r);
    if (list) list.push(a);
    else byRecord.set(r, [a]);
  }
  const keyers = new Map<string | null, (a: any) => string | null>();
  return (a) => {
    const r = recordIdOf(a);
    let keyer = keyers.get(r);
    if (!keyer) {
      keyer = recordPartyKeyer(byRecord.get(r) ?? [a]);
      keyers.set(r, keyer);
    }
    const rec = typeof a?.record_id === "string" ? arkToBareId(a.record_id) : "";
    return `${rec}\u0000${String(keyer(a))}`;
  };
}

type NamesakeRelation = "parent" | "spouse" | "child";
type TieRelation = NamesakeRelation | "sibling";

function relativesById(tree: any, personId: string): Map<string, { relation: NamesakeRelation; person: any }> {
  const byRole = gatherRelatives(tree ?? {}, personId);
  const out = new Map<string, { relation: NamesakeRelation; person: any }>();
  for (const relation of ["parent", "spouse", "child"] as const) {
    for (const p of byRole[relation]) {
      if (typeof p.id === "string" && !out.has(p.id)) out.set(p.id, { relation, person: p });
    }
  }
  return out;
}

/** `relativesById`, and with `withSiblings` the persons who share a parent with
 *  `personId` too. */
function tieRelativesById(
  tree: any,
  personId: string,
  withSiblings: boolean,
): Map<string, { relation: TieRelation; person: any }> {
  const out: Map<string, { relation: TieRelation; person: any }> = relativesById(tree, personId);
  if (!withSiblings) return out;
  const parents = new Set<string>();
  for (const r of (tree?.relationships ?? []) as any[]) {
    if (r?.type === "ParentChild" && r.child === personId && typeof r.parent === "string") parents.add(r.parent);
  }
  const persons = new Map<string, any>();
  for (const p of (tree?.persons ?? []) as any[]) if (p && typeof p.id === "string") persons.set(p.id, p);
  for (const r of (tree?.relationships ?? []) as any[]) {
    if (r?.type !== "ParentChild" || !parents.has(r.parent) || r.child === personId || out.has(r.child)) continue;
    const p = persons.get(r.child);
    if (p) out.set(r.child, { relation: "sibling", person: p });
  }
  return out;
}

/** The words of a given name that name someone: lower case, dots and brackets
 *  dropped, placeholder words ("Mrs.", "Wife", "Unknown") and "of" left out. */
function ownGivenWords(given: unknown): string[] {
  if (typeof given !== "string") return [];
  return given
    .toLowerCase()
    .replace(/[.[\]]/g, " ")
    .split(/\s+/)
    .filter((w) => w !== "" && w !== "of" && /\p{L}/u.test(w) && !PLACEHOLDER_GIVEN.has(w));
}

/** Why a relative's names cannot separate namesakes, or null when one can. A
 *  relative separates them only through a given name of their own: not a
 *  placeholder, and not one that only repeats the given name of the relative's
 *  own spouse, the way an unnamed wife is recorded ({prefix "Mrs.", given
 *  "James"}, "Mrs. James", "Wife of James", "Mrs. J." for the wife of James). */
function givenNameProblem(person: any, tree: any): string | null {
  const names = (Array.isArray(person?.names) ? person.names : []) as any[];
  if (!names.some((n) => isRealGivenName(n?.given))) return "has no given name";
  const spouseGiven = new Set<string>();
  for (const s of gatherRelatives(tree ?? {}, String(person?.id)).spouse) {
    for (const n of (Array.isArray(s?.names) ? s.names : []) as any[]) {
      const words = ownGivenWords(n?.given);
      if (words.length > 0) spouseGiven.add(words.join(" "));
    }
  }
  const own = names.some((n) => {
    const words = ownGivenWords(n?.given);
    if (!isRealGivenName(n?.given) || words.length === 0 || spouseGiven.has(words.join(" "))) return false;
    const marked =
      PLACEHOLDER_GIVEN.has(String(n?.prefix ?? "").toLowerCase().replace(/\./g, "").trim()) ||
      String(n?.given).toLowerCase().replace(/[.[\]]/g, " ").split(/\s+/).some((w) => PLACEHOLDER_GIVEN.has(w));
    return !(marked && words.length === 1 && words[0].length === 1 && [...spouseGiven].some((g) => g.startsWith(words[0])));
  });
  return own ? null : "has no given name of their own, only their spouse's";
}

/** A household head's role, whose co-residents' roles state their relation. */
const HOUSEHOLD_HEADS: ReadonlySet<string> = new Set(["head", "head_of_household", "self"]);
/** The relation a co-resident's role states, read from the head. */
const HOUSEHOLD_RELATION: ReadonlyMap<string, NamesakeRelation> = new Map([
  ["wife", "spouse"], ["husband", "spouse"], ["spouse", "spouse"],
  ["son", "child"], ["daughter", "child"], ["child", "child"],
  ["father", "parent"], ["mother", "parent"], ["parent", "parent"],
]);
const INVERSE_RELATION: ReadonlyMap<string, string> = new Map([
  ["parent", "child"], ["child", "parent"], ["spouse", "spouse"], ["sibling", "sibling"],
]);
const NAME_SUFFIXES: ReadonlySet<string> = new Set(["jr", "sr", "ii", "iii", "iv", "junior", "senior"]);

/** A name as the co-resident exclusion compares it: the first given name and
 *  the surname, lower case, a generational suffix dropped. */
function nameKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let v = value.toLowerCase();
  if (v.includes(",")) {
    const [surname, given] = v.split(",", 2);
    v = `${given} ${surname}`;
  }
  const words = v.replace(/[^\p{L}\s'-]/gu, " ").split(/\s+/).filter((w) => w && !NAME_SUFFIXES.has(w));
  if (words.length === 0) return null;
  return words.length === 1 ? words[0] : `${words[0]} ${words[words.length - 1]}`;
}

function capNorm(v: unknown): string {
  return String(v ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** A house number: `#12`, `house 12`, `no. 12`; a number before a street name,
 *  past a direction letter or as an ordinal street (`530 Baldwin`, `6906 W.
 *  Lloyd`, `350 12th Street`); or a number after a street word (`Hauptstraße
 *  12`, `Via Roma 12`). A number from 1000 to 2200 before a name reads as a
 *  year unless a street suffix is present; a month, census or measure word
 *  after the number is not a street; and a number after a division word
 *  (`District No. 7`, `Ward 12`, `Route 2`, `Dwelling 45`) is the division's. */
const HOUSE_TOKEN = new RegExp(
  [
    String.raw`(?:#\s?(\d+))`,
    String.raw`(?:(?<![\p{L}\p{N}_])(?:house|no\.?|nr\.?)\s?#?\s?(\d+))`,
    String.raw`(?:(?<![\p{L}\p{N}_#])(\d{1,5})[a-z]?\s+(?:(?:n|s|e|w|ne|nw|se|sw|north|south|east|west)\.?\s+)?(\p{L}\p{L}+|\d+(?:st|nd|rd|th)))`,
    String.raw`(?:(?<![\p{L}\p{N}_])(?:\p{L}*(?:strasse|straße|gasse|straat|weg|laan|gracht|platz|allee)|(?:via|viale|calle|rue|rua|avenida|piazza|plaza|ulica)\s+\p{L}[\p{L}'.-]*(?:\s+\p{L}[\p{L}'.-]*){0,3})\s+(\d{1,4})[a-z]?(?![\p{L}\p{N}]))`,
  ].join("|"),
  "giu",
);
const NOT_A_STREET: ReadonlySet<string> = new Set([
  "jan", "january", "feb", "february", "mar", "march", "apr", "april", "may", "jun", "june", "jul",
  "july", "aug", "august", "sep", "sept", "september", "oct", "october", "nov", "november", "dec",
  "december", "census", "district", "precinct", "ward", "militia", "township", "beat", "federal",
  "national", "state", "and", "in", "of", "years", "yrs", "age", "ed", "ad", "mile", "miles", "mi",
  "km", "dwelling", "dwellings", "family", "families", "line", "sheet", "page", "lot", "lots",
  "block", "acre", "acres", "rods", "chains", "feet", "ft", "persons", "children", "index",
]);
/** A division whose number is not a house's: `District No. 7`, `Ward #3`,
 *  `R.F.D. No. 2`, `Route 2`, `Ward 12 ED 83`, `Sheet 4A line 12`. */
const DIVISION_WORDS: ReadonlySet<string> = new Set([
  "district", "dist", "precinct", "pct", "ward", "militia", "township", "twp", "beat", "route", "rt",
  "rte", "rfd", "rr", "box", "ed", "ad", "enumeration", "dwelling", "family", "line", "sheet", "page",
  "lot", "block", "section", "sec", "range", "tract", "plat", "parish", "apt", "apartment", "unit",
  "suite", "room",
]);
const STREET_SUFFIX =
  /\b(?:st|street|ave|avenue|rd|road|lane|ln|blvd|boulevard|court|ct|row|terrace|square|sq|way|drive|dr|strasse|gasse|calle|rue)\b/;

/** The word just before `index`, dots dropped (`r.f.d.` reads `rfd`). */
function wordBefore(v: string, index: number): string {
  const m = /([\p{L}.]+)[\s,;:]*$/u.exec(v.slice(0, index));
  return m ? m[1].replace(/\./g, "").toLowerCase() : "";
}

function hasHouseNumber(v: string): boolean {
  for (const m of v.matchAll(HOUSE_TOKEN)) {
    if (DIVISION_WORDS.has(wordBefore(v, m.index ?? 0))) continue;
    if (m[1] !== undefined || m[2] !== undefined || m[5] !== undefined) return true;
    if (NOT_A_STREET.has(m[4].toLowerCase())) continue;
    const n = Number(m[3]);
    if (n >= 1000 && n <= 2200 && !STREET_SUFFIX.test(v)) continue;
    return true;
  }
  return false;
}

type CapField = "occupation" | "street address";

/** The occupation, or the street address of a residence or census entry, an
 *  assertion records. A town, a district or a date is not an address: the
 *  value must carry a house number and differ from the assertion's place. */
function capFields(a: any): Array<{ field: CapField; value: string }> {
  const type = String(a?.fact_type ?? "").toLowerCase();
  const value = capNorm(a?.value);
  if (!value) return [];
  if (type === "occupation") return [{ field: "occupation", value }];
  if (type !== "residence" && type !== "census") return [];
  if (stdDate(value) !== "" || value === capNorm(a?.place) || !hasHouseNumber(value)) return [];
  return [{ field: "street address", value }];
}

// ─── Tree-derived namesake pairs (issue #3681) ──────────────────────────────
//
// A father and son, or two siblings, of one first given name are each other's
// namesakes before any search records a row: a record naming either could be the
// other's. The pair is read from the tree, and a link to a member stands only
// when its record rules every other member out and still fits the linked person
// (age, lifespan, adult role, same record, family limit), on dates that come
// from somewhere other than that record. Specified in
// docs/specs/research-append-tool-spec.md, "Tree-derived namesake pairs".

export type PairRelation = "parent" | "child" | "sibling";
export type PairTest = "age" | "lifespan" | "adult role" | "same record" | "family limit";

export interface NamesakePartner {
  personId: string;
  relation: PairRelation;
  /** Siblings with one birth year, who may be one person entered twice. */
  sameBirthYear: boolean;
}

/** The first given word of each of a person's names: accents folded, placeholder
 *  words dropped, initials skipped. */
function firstGivenWords(person: any): Set<string> {
  const out = new Set<string>();
  for (const n of (Array.isArray(person?.names) ? person.names : []) as any[]) {
    const first = ownGivenWords(n?.given)
      .map((w) => w.normalize("NFD").replace(/\p{M}/gu, ""))
      .find((w) => w.length > 1);
    if (first) out.add(first);
  }
  return out;
}

function knownSex(person: any): "male" | "female" | null {
  const g = String(person?.gender ?? "").toLowerCase();
  return g === "male" || g === "female" ? g : null;
}

const LIFE_BIRTH_FACTS: ReadonlySet<string> = new Set(["birth", "christening", "baptism"]);
const LIFE_DEATH_FACTS: ReadonlySet<string> = new Set(["death", "burial"]);

/** The earliest birth-type year among a person's facts, whatever they cite. */
function anyBirthYear(person: any): number | null {
  let out: number | null = null;
  for (const f of (Array.isArray(person?.facts) ? person.facts : []) as any[]) {
    if (!LIFE_BIRTH_FACTS.has(String(f?.type ?? "").toLowerCase())) continue;
    const y = yearOf(f?.standard_date) ?? yearOf(f?.date);
    if (y !== null && (out === null || y < out)) out = y;
  }
  return out;
}

/** The persons `personId` forms a namesake pair with: a parent, a child or a
 *  sibling (one shared parent) who shares a first given name with them and is
 *  not known to be of the other sex. */
export function derivedNamesakePairs(tree: any, personId: string): NamesakePartner[] {
  const persons = new Map<string, any>();
  for (const p of (tree?.persons ?? []) as any[]) if (p && typeof p.id === "string") persons.set(p.id, p);
  const me = persons.get(personId);
  const mine = firstGivenWords(me);
  if (!me || mine.size === 0) return [];
  const parentsOf = new Map<string, Set<string>>();
  for (const r of (tree?.relationships ?? []) as any[]) {
    if (r?.type !== "ParentChild" || typeof r.parent !== "string" || typeof r.child !== "string") continue;
    const set = parentsOf.get(r.child);
    if (set) set.add(r.parent);
    else parentsOf.set(r.child, new Set([r.parent]));
  }
  const myParents = parentsOf.get(personId) ?? new Set<string>();
  const related = new Map<string, PairRelation>();
  for (const p of myParents) related.set(p, "parent");
  for (const [child, ps] of parentsOf) {
    if (child === personId || related.has(child)) continue;
    if (ps.has(personId)) related.set(child, "child");
    else if ([...ps].some((p) => myParents.has(p))) related.set(child, "sibling");
  }
  const mySex = knownSex(me);
  const myBirth = anyBirthYear(me);
  const out: NamesakePartner[] = [];
  for (const [id, relation] of related) {
    const q = persons.get(id);
    if (!q || ![...firstGivenWords(q)].some((g) => mine.has(g))) continue;
    const qSex = knownSex(q);
    if (mySex !== null && qSex !== null && mySex !== qSex) continue;
    const sameBirthYear = relation === "sibling" && myBirth !== null && myBirth === anyBirthYear(q);
    out.push({ personId: id, relation, sameBirthYear });
  }
  return out.sort((x, y) => x.personId.localeCompare(y.personId));
}

const PAIR_EVENT_TYPES: ReadonlySet<string> = new Set([
  "marriage", "death", "burial", "christening", "baptism", "census", "residence", "census_residence",
  "immigration", "probate", "naturalization", "birth_registration", "death_registration",
  "marriage_intention", "event",
]);
const PAIR_BIRTH_TYPES: ReadonlySet<string> = new Set(["birth", "birth_date", "christening", "baptism"]);
/** Facts that show a persona dead by the record's date: their death, burial or estate. */
const PAIR_POSTHUMOUS_TYPES: ReadonlySet<string> = new Set([
  "death", "burial", "cremation", "death_registration", "probate", "obituary",
]);
/** A house number before a street name, which a value's year must not be read from. */
const PAIR_HOUSE_NUMBER =
  /\b\d{3,5}\s+(?:[NSEW]\.?\s+)?(?:(?:\d+(?:st|nd|rd|th)|[A-Z][\p{L}'.-]*)\s+){1,3}(?:St|Street|Ave|Avenue|Rd|Road|Ln|Lane|Blvd|Boulevard|Dr|Drive|Pl|Place|Ct|Court|Way|Ter|Terrace|Pike|Hwy|Highway|Alley|Row)\b\.?/gu;
/** Roles that need someone 15 or older at the record's date. */
const PAIR_ADULT_ROLE =
  /^(groom|bride|head_of_household|head|wife|husband|spouse|father|mother|father_of_.*|mother_of_.*|witness.*|godparent.*|godfather|godmother|informant|grantor|grantee|testator|executor|parent.*|sponsor.*)$/;
const PAIR_AGE_TOLERANCE = 10;
const PAIR_ADULT_AGE = 15;
const PAIR_PARENT_GAP = 15;
/** The lifespan test's one year either side: a death or burial one year off the
 *  tree's falls across a year boundary, so "differs" reads "more than one year
 *  apart", and a record one year before the birth year does not rule its
 *  persona out (chesworthrm, 2026-10-29). The age test keeps its 10. */
const PAIR_LIFESPAN_TOLERANCE = 1;

export interface PairRecordFacts {
  /** The role of the persona the person is linked to, lower case; null when no
   *  one-party link of theirs names a persona on the record. */
  role: string | null;
  persona: string | null;
  /** The record's own year. */
  year: number | null;
  birth: number | null;
  death: number | null;
  /** The record shows its persona dead: a death, burial or estate of theirs. */
  dead: boolean;
}

/** The assertions of `assertion`'s record, matched on the bare record id, and the
 *  cap's party key over them (`recordPartyKeyer`), which joins a party whose
 *  re-extraction carries no persona ids. */
function pairRecordParties(research: any, assertion: any) {
  const record = arkToBareId(String(assertion?.record_id ?? ""));
  const same = ((research?.assertions ?? []) as any[]).filter(
    (a) => isLiveAssertion(a) && arkToBareId(String(a.record_id ?? "")) === record,
  );
  return { record, same, partyOf: recordPartyKeyer(same) };
}

/** What the linked record says about the persona `personId` is linked to: its
 *  role, its birth year (stated, or the record's year less a stated age), its
 *  death or burial year, and the record's own year (its latest event, else its
 *  latest birth, else the source's date). The persona is the linked assertion's
 *  own; a two-party assertion speaks for two people, so for one the persona is
 *  the one `personId`'s one-party links on the record name most, else none. */
export function pairRecordFacts(research: any, assertion: any, personId: string): PairRecordFacts {
  const { same, partyOf } = pairRecordParties(research, assertion);
  const ownParty = !!assertion && !isTwoParty(assertion.fact_type);
  let persona: string | null = ownParty ? partyOf(assertion) : null;
  if (!ownParty) {
    const byId = new Map<string, any>(same.map((a) => [a.id, a]));
    const counts = new Map<string, number>();
    for (const e of (research?.person_evidence ?? []) as any[]) {
      if (!e || e.superseded_by || e.person_id !== personId) continue;
      const a = byId.get(e.assertion_id);
      const party = a && !isTwoParty(a.fact_type) ? partyOf(a) : null;
      if (party !== null) counts.set(party, (counts.get(party) ?? 0) + 1);
    }
    persona = [...counts].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0]?.[0] ?? null;
  }
  const mine = persona === null ? [] : same.filter((a) => partyOf(a) === persona);
  const role = mine.find((a) => !isTwoParty(a.fact_type))?.record_role;
  const type = (a: any) => String(a?.fact_type ?? "").toLowerCase();
  const yearIn = (a: any) => yearOf(a?.date) ?? yearOf(String(a?.value ?? "").replace(PAIR_HOUSE_NUMBER, " "));
  const latest = (pick: (a: any) => boolean): number | null => {
    let out: number | null = null;
    for (const a of same) {
      if (!pick(a)) continue;
      const y = yearIn(a);
      if (y !== null && (out === null || y > out)) out = y;
    }
    return out;
  };
  let year = latest((a) => PAIR_EVENT_TYPES.has(type(a))) ?? latest((a) => PAIR_BIRTH_TYPES.has(type(a)));
  if (year === null) {
    const src = ((research?.sources ?? []) as any[]).find((s) => s?.id === assertion?.source_id);
    year = yearOf(src?.citation_detail?.when_created);
  }
  let birth: number | null = null;
  for (const a of mine) {
    if (PAIR_BIRTH_TYPES.has(type(a)) && (birth = yearIn(a)) !== null) break;
  }
  if (birth === null && year !== null) {
    for (const a of mine) {
      if (type(a) !== "age") continue;
      const n = Number(a.structured_value?.age ?? String(a.value ?? "").match(/\d+/)?.[0]);
      if (Number.isFinite(n) && n < 120) {
        birth = year - n;
        break;
      }
    }
  }
  let death: number | null = null;
  for (const a of mine) {
    if (LIFE_DEATH_FACTS.has(type(a)) && (death = yearIn(a)) !== null) break;
  }
  const dead = mine.some((a) => PAIR_POSTHUMOUS_TYPES.has(type(a)));
  return { role: typeof role === "string" ? role.toLowerCase() : null, persona, year, birth, death, dead };
}

export interface PairLife {
  birth: number | null;
  death: number | null;
}

/** A person's birth and death years from the facts that do not come from record
 *  `recordId` (rule 3 of #3681). A fact counts when the starting tree carries one
 *  of its type and year on the same person, whatever either cites; else when its
 *  own assertion is another record's; else, with no assertion of its own, when a
 *  ref reaches a research source citing another record, or is the FamilySearch
 *  tree's own source, which no research source registers. A date copied from
 *  `recordId` never counts, even through a source spanning several record ids. */
export function independentLife(
  person: any,
  recordId: string,
  research: any,
  tree: any,
  startingTree: any,
): PairLife {
  const judged = arkToBareId(String(recordId ?? ""));
  const start = ((startingTree?.persons ?? []) as any[]).find((p) => p?.id === person?.id);
  const started = new Set(
    ((start?.facts ?? []) as any[]).map(
      (f) => `${String(f?.type ?? "").toLowerCase()}:${yearOf(f?.standard_date) ?? yearOf(f?.date)}`,
    ),
  );
  const assertionById = new Map<string, any>();
  for (const a of (research?.assertions ?? []) as any[]) if (a && typeof a.id === "string") assertionById.set(a.id, a);
  const descriptions = new Map<string, any>();
  for (const s of (tree?.sources ?? []) as any[]) if (s && typeof s.id === "string") descriptions.set(s.id, s);
  const counts = (f: any, type: string, y: number): boolean => {
    if (started.has(`${type}:${y}`)) return true;
    const own = typeof f?.assertion_id === "string" ? assertionById.get(f.assertion_id) : undefined;
    if (own) return arkToBareId(String(own.record_id ?? "")) !== judged;
    for (const ref of sourceRefsOf(f)) {
      const { sourceIds, recordIds } = refsReach([ref], research);
      if (sourceIds.size === 0) {
        if (isTreeAsSource(descriptions.get(ref.startsWith("#") ? ref.slice(1) : ref))) return true;
      } else if ([...recordIds].some((r) => arkToBareId(r) !== judged)) {
        return true;
      }
    }
    return false;
  };
  const life: PairLife = { birth: null, death: null };
  for (const f of (Array.isArray(person?.facts) ? person.facts : []) as any[]) {
    const type = String(f?.type ?? "").toLowerCase();
    const isBirth = LIFE_BIRTH_FACTS.has(type);
    if (!isBirth && !LIFE_DEATH_FACTS.has(type)) continue;
    const y = yearOf(f?.standard_date) ?? yearOf(f?.date);
    if (y === null || !counts(f, type, y)) continue;
    const key = isBirth ? "birth" : "death";
    if (life[key] === null || y < life[key]!) life[key] = y;
  }
  return life;
}

/** The tests by which a person of life `life` cannot be the record's persona. */
function pairRuledOutBy(life: PairLife, rf: PairRecordFacts): PairTest[] {
  if (rf.role === null) return [];
  const out: PairTest[] = [];
  if (rf.birth !== null && life.birth !== null && Math.abs(rf.birth - life.birth) > PAIR_AGE_TOLERANCE) out.push("age");
  // A parent named on a child's record may be dead by then, and so is the persona
  // of a record showing their own death or estate; anyone else must be alive.
  const alive = !rf.dead && (!/(_of_|^father$|^mother$|grand)/.test(rf.role) || rf.role === "head_of_household");
  if (
    (rf.death !== null && life.death !== null && Math.abs(rf.death - life.death) > PAIR_LIFESPAN_TOLERANCE) ||
    (rf.year !== null && life.birth !== null && rf.year < life.birth - PAIR_LIFESPAN_TOLERANCE) ||
    (alive && rf.year !== null && life.death !== null && rf.year > life.death + PAIR_LIFESPAN_TOLERANCE)
  ) {
    out.push("lifespan");
  }
  if (PAIR_ADULT_ROLE.test(rf.role) && rf.year !== null && life.birth !== null && rf.year - life.birth < PAIR_ADULT_AGE) {
    out.push("adult role");
  }
  return out;
}

export interface PairJudgement {
  /** The record does not rule the linked person out. */
  fits: boolean;
  /** One tie per partner the record rules out, by the first test that does. */
  ties: Array<{ partner: string; relation: PairRelation; test: PairTest }>;
  reasons: string[];
}

/** The five tests of #3681 for one link of `personId` on `assertion`'s record:
 *  whether the record still fits them and rules out each partner. */
export function pairJudgement(
  personId: string,
  assertion: any,
  partners: readonly NamesakePartner[],
  research: any,
  tree: any,
  startingTree: any,
): PairJudgement {
  const rf = pairRecordFacts(research, assertion, personId);
  const recordId = String(assertion?.record_id ?? "");
  const persons = new Map<string, any>();
  for (const p of (tree?.persons ?? []) as any[]) if (p && typeof p.id === "string") persons.set(p.id, p);
  const lifeOf = (id: string) => independentLife(persons.get(id), recordId, research, tree, startingTree);
  // A person's birth year bounded by their parents' and children's, 15 years each way.
  const familyRuledOut = (id: string): boolean => {
    if (rf.role === null) return false;
    let latest: number | null = null;
    let earliest: number | null = null;
    for (const r of (tree?.relationships ?? []) as any[]) {
      if (r?.type !== "ParentChild") continue;
      if (r.parent === id) {
        const b = lifeOf(r.child).birth;
        if (b !== null && (latest === null || b - PAIR_PARENT_GAP < latest)) latest = b - PAIR_PARENT_GAP;
      }
      if (r.child === id) {
        const b = lifeOf(r.parent).birth;
        if (b !== null && (earliest === null || b + PAIR_PARENT_GAP > earliest)) earliest = b + PAIR_PARENT_GAP;
      }
    }
    return (
      (rf.birth !== null && latest !== null && rf.birth > latest + PAIR_AGE_TOLERANCE) ||
      (rf.birth !== null && earliest !== null && rf.birth < earliest - PAIR_AGE_TOLERANCE) ||
      (rf.year !== null && earliest !== null && rf.year < earliest) ||
      (rf.year !== null && earliest !== null && PAIR_ADULT_ROLE.test(rf.role) && rf.year - earliest < PAIR_ADULT_AGE)
    );
  };
  const { record, partyOf } = pairRecordParties(research, assertion);
  const assertionById = new Map<string, any>();
  for (const a of (research?.assertions ?? []) as any[]) if (a && typeof a.id === "string") assertionById.set(a.id, a);
  const onAnotherPersona = (id: string): boolean =>
    ((research?.person_evidence ?? []) as any[]).some((e) => {
      if (!e || e.superseded_by || e.person_id !== id) return false;
      const a = assertionById.get(e.assertion_id);
      return !!a && arkToBareId(String(a.record_id ?? "")) === record && !isTwoParty(a.fact_type) && partyOf(a) !== rf.persona;
    });

  const reasons: string[] = [];
  if (rf.role === null) {
    reasons.push(`No one-party assertion of this record is linked to '${personId}', so it names no persona to compare.`);
  }
  const ownOut = [...pairRuledOutBy(lifeOf(personId), rf), ...(familyRuledOut(personId) ? ["family limit" as const] : [])];
  if (ownOut.length > 0) reasons.push(`The record does not fit '${personId}' (${ownOut.join(", ")}).`);
  const ties: PairJudgement["ties"] = [];
  for (const q of partners) {
    const tests: PairTest[] = [...pairRuledOutBy(lifeOf(q.personId), rf)];
    if (onAnotherPersona(q.personId)) tests.push("same record");
    if (familyRuledOut(q.personId)) tests.push("family limit");
    if (tests.length > 0) {
      ties.push({ partner: q.personId, relation: q.relation, test: tests[0] });
      continue;
    }
    const life = lifeOf(q.personId);
    const lacks =
      rf.role === null
        ? "no persona to compare"
        : life.birth === null && life.death === null
          ? `'${q.personId}' has no birth or death year from a record other than this one`
          : rf.birth === null && rf.death === null && rf.year === null
            ? "the record gives its persona no date or age"
            : "their dates and the record's fit either of them";
    reasons.push(`Nothing rules out '${q.personId}', '${personId}''s ${q.relation} of the same given name: ${lacks}.`);
  }
  return { fits: rf.role !== null && ownOut.length === 0, ties, reasons };
}

export type NamesakeTie =
  | { kind: "a"; link: string; relative: string; relation: TieRelation; crossRecord: boolean }
  | { kind: "b"; voucher: string; field: CapField; value: string }
  | { kind: "pair"; partner: string; relation: PairRelation; test: PairTest };

export interface NamesakeVerdict {
  allowed: boolean;
  /** Every tie found; `crossRecord` marks a co-party on another record id of
   *  the same source. */
  ties: NamesakeTie[];
  /** The link's source. */
  source: string;
  /** Why nothing ties the link, one clause each; empty when it is allowed. */
  reasons: string[];
  /** The rules that voided a tie the link would otherwise have had: the role
   *  check, the co-resident exclusion, grounding, or a namesake in the tree the
   *  record would tie as well. Empty when allowed. */
  blockedBy: NamesakeBlock[];
}

export type NamesakeBlock = "role" | "co-resident" | "grounding" | "pair";

export interface NamesakeVerdicts {
  /** The person's namesake rows. */
  rows: any[];
  /** The person's namesakes in the tree; empty unless `derivedPairs` was asked. */
  pairs: NamesakePartner[];
  /** Keyed on person_evidence id: every live probable or confident link to the
   *  person whose assertion is not absent basis. */
  verdicts: Map<string, NamesakeVerdict>;
}

/** The cap's verdict on every live probable or confident link to `personId`,
 *  or null when no namesake of theirs is recorded (and, with `derivedPairs`, none
 *  is in the tree).
 *
 *  Tie (a) reads relatives from `tree` and links from `research`. Tie (b) takes
 *  its voucher from the links whose pairing is in `voucherPairs` (default: every
 *  judged link). A link whose assertion is absent basis is neither judged nor a
 *  tie. With `derivedPairs`, a person with no row but a namesake in the tree
 *  (`derivedNamesakePairs`) is judged too. A pair member's tie (a) or (b), row or
 *  no row, counts only when the record would not tie a partner as well, reading
 *  the partner's siblings among the partner's relatives, and with no row a link
 *  also stands when `pairJudgement` rules every partner out. A row
 *  holder still needs tie (a) or (b), since the pair tests say nothing about a
 *  stranger. */
export function namesakeVerdicts(
  personId: string,
  research: any,
  tree: any,
  opts: {
    startingPersonIds?: ReadonlySet<string>;
    voucherPairs?: ReadonlySet<string>;
    /** Judge only these links; every strong link still counts as a voucher. */
    only?: ReadonlySet<string>;
    /** Judge namesakes in the tree as well as rows (#3681). */
    derivedPairs?: boolean;
    /** The project's starting tree, for the pair tests' dates. */
    startingTree?: any;
    /** Tie (a) also reads the person's siblings: how a partner's ties are read. */
    siblingRelatives?: boolean;
    /** Judge by ties (a) and (b) alone, row or no row: the partner check's own call. */
    tiesOnly?: boolean;
  } = {},
): NamesakeVerdicts | null {
  const rows = (Array.isArray(research?.namesakes) ? research.namesakes : []).filter(
    (r: any) => r && r.person_id === personId,
  );
  const pairs = opts.derivedPairs ? derivedNamesakePairs(tree, personId) : [];
  if (rows.length === 0 && pairs.length === 0 && !opts.tiesOnly) return null;

  const assertionById = new Map<string, any>();
  const bySource = new Map<unknown, any[]>();
  for (const a of (Array.isArray(research?.assertions) ? research.assertions : []) as any[]) {
    if (!isLiveAssertion(a) || typeof a.id !== "string") continue;
    assertionById.set(a.id, a);
    const s = capSource(a);
    const list = bySource.get(s);
    if (list) list.push(a);
    else bySource.set(s, [a]);
  }
  const capParty = capPartyKeyer(assertionById.values());
  const capKeys: PartyKeys = { recordOf: capSource, partyOf: capParty, twoParty: (a) => isTwoParty(a?.fact_type) };
  const absent = (a: any) => recordBasisOf(a) === "absent";
  const live = (Array.isArray(research?.person_evidence) ? research.person_evidence : []).filter(
    (e: any) => e && !e.superseded_by && typeof e.assertion_id === "string" && typeof e.person_id === "string",
  ) as any[];
  const liveLinks: PersonLink[] = live.map((e) => ({ assertion_id: e.assertion_id, person_id: e.person_id }));
  const judged = live.filter(
    (e) =>
      e.person_id === personId &&
      typeof e.id === "string" &&
      isStrongConfidence(e.confidence) &&
      assertionById.has(e.assertion_id) &&
      !absent(assertionById.get(e.assertion_id)),
  );
  const relatives = tieRelativesById(tree, personId, opts.siblingRelatives === true);
  const voucherPairs = opts.voucherPairs ?? new Set(judged.map(pairingKey));
  const fieldKeys = (a: any) => new Set(capFields(a).map((f) => `${f.field}\u0000${f.value}`));
  const linkFields = new Map<string, Set<string>>(
    judged.map((m) => [m.id, fieldKeys(assertionById.get(m.assertion_id))]),
  );

  // Each record party's role and name, for the role check and the co-resident
  // exclusion.
  const partyRole = new Map<string, string>();
  const partyName = new Map<string, { key: string; shown: string }>();
  for (const x of assertionById.values()) {
    const party = capParty(x);
    if (typeof x.record_role === "string" && !partyRole.has(party)) partyRole.set(party, x.record_role.toLowerCase());
    if (String(x.fact_type ?? "").toLowerCase() === "name" && !partyName.has(party)) {
      const key = nameKey(x.value);
      if (key) partyName.set(party, { key, shown: String(x.value) });
    }
  }
  /** The name of another party of `source` that `party` shares, or null. */
  const sameNamed = (source: unknown, party: string): string | null => {
    const own = partyName.get(party);
    if (!own) return null;
    for (const b of bySource.get(source) ?? []) {
      const other = partyName.get(capParty(b));
      if (capParty(b) !== party && other?.key === own.key) return other.shown;
    }
    return null;
  };
  /** Why the record says the co-party is not Q's `relation` to P, or null. A
   *  two-party assertion linked to the party it names stands for that party, so
   *  only the role it names is read. `own` are the parties P's own one-party
   *  assertions show P to be; the roles are read only from those, not from the
   *  party a link naming P falls back to. */
  const roleProblem = (
    al: any,
    l: any,
    source: unknown,
    speaking: ReadonlySet<string>,
    own: ReadonlySet<string>,
    relation: TieRelation,
  ): string | null => {
    // Stating nothing, the roles still say what the two parties are to each
    // other, read as circular corroboration reads them (chesworthrm, 2026-10-29).
    // A numbered head heads one household of several on the page, so, as in the
    // household check, only a plain head's roles are read.
    const numberedHead = (role: unknown) => {
      const r = String(role ?? "").toLowerCase().trim();
      return /_\d+$/.test(r) && HOUSEHOLD_HEADS.has(r.replace(/_\d+$/, ""));
    };
    // Only the principal's own family is read: the principal, a spouse or head,
    // and a parent of the principal (a bare father or mother, or a father_of_<x>
    // whose <x> is no parent itself); a grandparent's role reads wrongly there.
    const familyRole = (r: string): boolean => {
      if (CIRCULAR_CHILD_LIKE.has(r) || CIRCULAR_SPOUSAL.has(r) || HOUSEHOLD_HEADS.has(r)) return true;
      const p = PARENT_ROLE.exec(r);
      return p !== null && (p[2] === undefined || !(PARENT_ROLE.test(p[2]) || /grand/.test(p[2])));
    };
    const rolesSay = (role: unknown): string | null => {
      const theirs = normalizedRole(role);
      for (const sp of own) {
        if (numberedHead(partyRole.get(sp)) || numberedHead(role)) continue;
        const mine = normalizedRole(partyRole.get(sp));
        if (!familyRole(mine) || !familyRole(theirs)) continue;
        const back = coPartyRelation(theirs, mine)?.relation ?? null;
        const implied = coPartyRelation(mine, theirs)?.relation ?? (back === "parent" ? "child" : back);
        if (implied !== null && implied !== relation) {
          return `the record's roles ('${mine}' beside '${theirs}') make that party the ${implied} of '${personId}''s party`;
        }
      }
      return null;
    };
    if (isTwoParty(al.fact_type) && !ownPartyLinkedTo(al, l, source, assertionById, liveLinks, capKeys)) {
      const named = al.structured_value?.related_person_role;
      return typeof named === "string" && named.trim() !== "" ? rolesSay(named) : null;
    }
    const party = capParty(al);
    const listed = HOUSEHOLD_RELATION.get(String(al.record_role ?? "").toLowerCase().replace(/_\d+$/, ""));
    for (const sp of speaking) {
      if (HOUSEHOLD_HEADS.has(partyRole.get(sp) ?? "") && listed && listed !== relation) {
        return `'${personId}''s party heads the household and the record lists that party as its '${al.record_role}'`;
      }
    }
    const stated = new Set<string>();
    for (const st of bySource.get(source) ?? []) {
      if (String(st.fact_type ?? "").toLowerCase() !== "relationship") continue;
      const type = relationshipCategory(st.structured_value?.relationship_type);
      if (!type || type !== subjectRoleInValue(String(st.value ?? ""))) continue;
      const related = String(st.structured_value?.related_person_role ?? "").toLowerCase();
      for (const sp of speaking) {
        if (capParty(st) === party && related === partyRole.get(sp)) stated.add(type);
        else if (capParty(st) === sp && related === partyRole.get(party)) stated.add(INVERSE_RELATION.get(type) ?? type);
      }
    }
    if (stated.size > 0) {
      return stated.has(relation) ? null : `the record states that party is '${[...stated].sort()[0]}' of '${personId}''s party`;
    }
    return rolesSay(al.record_role);
  };

  interface Pending {
    e: any;
    source: unknown;
    tieA: NamesakeTie[];
    reasons: string[];
    fields: Array<{ field: CapField; value: string; vouchers: string[]; excluded: string[]; sameCall: boolean; sameNamed: string | null }>;
    blocked: Set<NamesakeBlock>;
    pair: PairJudgement | null;
    /** The record parties the link speaks for. */
    speaking: Set<string>;
  }
  // With `only`, the links judged and every link that could vouch for one of
  // them, by an occupation or street address anywhere on its source; the rest
  // cannot change their verdicts, so the partner check's own call stays small.
  let needed: Set<string> | null = null;
  if (opts.only) {
    needed = new Set(judged.filter((e) => opts.only!.has(e.id)).map((e) => String(e.id)));
    const queue = judged.filter((e) => needed!.has(String(e.id)));
    for (let e = queue.pop(); e; e = queue.pop()) {
      const keys = new Set(
        (bySource.get(capSource(assertionById.get(e.assertion_id))) ?? []).flatMap((b: any) => [...fieldKeys(b)]),
      );
      if (keys.size === 0) continue;
      for (const m of judged) {
        if (needed.has(String(m.id)) || ![...linkFields.get(m.id)!].some((k) => keys.has(k))) continue;
        needed.add(String(m.id));
        queue.push(m);
      }
    }
  }
  const pending: Pending[] = [];
  for (const e of judged) {
    if (needed && !needed.has(String(e.id))) continue;
    const a = assertionById.get(e.assertion_id);
    const source = capSource(a);
    // The record parties this link speaks for: its own, unless its assertion
    // names a second person and nothing else of that party is linked to this
    // person; then the parties of this source whose own assertions are.
    let speakers = new Set<string>([capParty(a)]);
    if (isTwoParty(a.fact_type) && !ownPartyLinkedTo(a, e, source, assertionById, liveLinks, capKeys)) {
      speakers = new Set();
      for (const l of liveLinks) {
        if (l.person_id !== personId) continue;
        const x = assertionById.get(l.assertion_id);
        if (x && !isTwoParty(x.fact_type) && capSource(x) === source) speakers.add(capParty(x));
      }
    }
    const speaking = speakers.size > 0 ? speakers : new Set([capParty(a)]);

    // Tie (a).
    const ties: NamesakeTie[] = [];
    const reasons: string[] = [];
    const blocked = new Set<NamesakeBlock>();
    let strongCoParty = false;
    for (const l of live) {
      if (l.person_id === personId) continue;
      const al = assertionById.get(l.assertion_id);
      if (!al || absent(al) || capSource(al) !== source || speakers.has(capParty(al))) continue;
      const rel = relatives.get(l.person_id);
      const who = `'${l.id}' links another party ('${al.record_role ?? "unknown role"}') to '${l.person_id}'`;
      if (!isStrongConfidence(l.confidence)) {
        if (rel) reasons.push(`${who}, '${personId}''s ${rel.relation}, only at '${l.confidence}'.`);
        continue;
      }
      strongCoParty = true;
      if (!rel) {
        reasons.push(`${who}, who is not a spouse, parent or child of '${personId}' in the tree.`);
      } else if (mintedFromThisSource(l.person_id, String(source), research, tree, opts.startingPersonIds)) {
        reasons.push(`${who}, '${personId}''s ${rel.relation}, but '${l.person_id}' was created from this source alone.`);
      } else {
        const named = givenNameProblem(rel.person, tree);
        const role = named ? null : roleProblem(al, l, source, speaking, speakers, rel.relation);
        if (named) {
          reasons.push(`${who}, '${personId}''s ${rel.relation}, but '${l.person_id}' ${named}.`);
        } else if (role) {
          reasons.push(`${who}, '${personId}''s ${rel.relation}, but ${role}.`);
          blocked.add("role");
        } else {
          const crossRecord = arkToBareId(String(al.record_id ?? "")) !== arkToBareId(String(a.record_id ?? ""));
          ties.push({ kind: "a", link: String(l.id), relative: l.person_id, relation: rel.relation, crossRecord });
        }
      }
    }
    if (!strongCoParty) {
      reasons.unshift("No other party of this source is linked at 'probable' or better to anyone else in the tree.");
    }

    // Tie (b) candidates: a party the link speaks for has an occupation or
    // street address on the source equal to one on another source's link to
    // this person that was already standing. Neither record may list a second
    // party of the same name, which the match could not tell apart.
    const keys = new Map<string, { field: CapField; value: string; party: string }>();
    for (const b of bySource.get(source) ?? []) {
      if (!speaking.has(capParty(b)) || absent(b)) continue;
      for (const k of capFields(b)) keys.set(`${k.field}\u0000${k.value}`, { ...k, party: capParty(b) });
    }
    const fields: Pending["fields"] = [];
    for (const [key, k] of keys) {
      const here = sameNamed(source, k.party);
      const vouchers: string[] = [];
      const excluded: string[] = [];
      let shown: string | null = null;
      let sameCall = false;
      for (const m of judged) {
        if (m.id === e.id || !linkFields.get(m.id)!.has(key)) continue;
        const am = assertionById.get(m.assertion_id);
        if (capSource(am) === source) continue;
        if (!voucherPairs.has(pairingKey(m))) {
          sameCall = true;
          continue;
        }
        const theirs = here ?? sameNamed(capSource(am), capParty(am));
        if (theirs) {
          excluded.push(String(m.id));
          shown ??= theirs;
        } else {
          vouchers.push(String(m.id));
        }
      }
      fields.push({ field: k.field, value: k.value, vouchers, excluded, sameCall, sameNamed: shown });
    }
    // The pair tests say nothing about a stranger, so a row holder is not judged by them.
    const pair =
      pairs.length > 0 && rows.length === 0 ? pairJudgement(personId, a, pairs, research, tree, opts.startingTree) : null;
    pending.push({ e, source, tieA: ties, reasons, fields, blocked, pair, speaking });
  }
  /** A link of a person with no row that the pair tests tie: the record fits
   *  them and rules out every partner. */
  const pairStands = (j: Pending): boolean => j.pair !== null && j.pair.fits && j.pair.ties.length === pairs.length;

  // A pair member's tie counts only when the record would not tie a partner as
  // well, row or no row: the link judged as the partner's, by ties (a) and (b),
  // with the partner's siblings among their relatives (chesworthrm, 2026-10-29).
  // The person's assertions on the source that name a second person go with it,
  // and so do their own entries of the parties the link speaks for: a "child of"
  // naming the person names the persona judged, and the father's own entry beside
  // his daughter's "child of" him is that persona, so either left behind would tie
  // the partner through the person.
  const sharedWith = new Map<string, { partner: NamesakePartner; ties: NamesakeTie[] }>();
  if (pairs.length > 0) {
    for (const j of pending) {
      if (j.tieA.length === 0 && !j.fields.some((f) => f.vouchers.length > 0)) continue;
      const carried = new Set<string>([String(j.e.id)]);
      for (const x of live) {
        const ax = assertionById.get(x.assertion_id);
        if (
          x.person_id === personId &&
          ax &&
          capSource(ax) === j.source &&
          (isTwoParty(ax.fact_type) || j.speaking.has(capParty(ax)))
        ) {
          carried.add(String(x.id));
        }
      }
      for (const q of pairs) {
        const moved = {
          ...research,
          person_evidence: live.map((x) => (carried.has(String(x.id)) ? { ...x, person_id: q.personId } : x)),
        };
        const v = namesakeVerdicts(q.personId, moved, tree, {
          startingPersonIds: opts.startingPersonIds,
          voucherPairs: opts.voucherPairs,
          only: new Set([j.e.id]),
          siblingRelatives: true,
          tiesOnly: true,
        });
        const theirs = v?.verdicts.get(j.e.id);
        if (theirs?.allowed) {
          sharedWith.set(String(j.e.id), { partner: q, ties: theirs.ties });
          break;
        }
      }
    }
  }
  const tiesCount = (j: Pending): boolean => !sharedWith.has(String(j.e.id));

  // Grounding: a voucher counts only when it is itself allowed, so the allowed
  // set grows from the links tie (a) holds, through grounded vouchers, until
  // nothing changes.
  const allowedIds = new Set(
    pending.filter((j) => (j.tieA.length > 0 && tiesCount(j)) || pairStands(j)).map((j) => String(j.e.id)),
  );
  for (let grew = true; grew; ) {
    grew = false;
    for (const j of pending) {
      if (allowedIds.has(String(j.e.id)) || !tiesCount(j)) continue;
      if (!j.fields.some((f) => f.vouchers.some((v) => allowedIds.has(v)))) continue;
      allowedIds.add(String(j.e.id));
      grew = true;
    }
  }

  const verdicts = new Map<string, NamesakeVerdict>();
  for (const j of pending) {
    if (opts.only && !opts.only.has(j.e.id)) continue;
    const counted = tiesCount(j);
    const ties: NamesakeTie[] = counted ? [...j.tieA] : [];
    const reasons = [...j.reasons];
    for (const f of j.fields) {
      const grounded = f.vouchers.filter((v) => allowedIds.has(v));
      if (counted) for (const v of grounded) ties.push({ kind: "b", voucher: v, field: f.field, value: f.value });
      if (grounded.length > 0) continue;
      const head =
        `The ${f.field} '${f.value}' on this source matches no record linked to '${personId}' at ` +
        `'probable' or better before this call that is itself tied`;
      if (f.excluded.length > 0) {
        reasons.push(`${head} (its record lists another '${f.sameNamed}', so the match cannot tell them apart).`);
        if (f.excluded.some((v) => allowedIds.has(v))) j.blocked.add("co-resident");
      } else if (f.vouchers.length > 0) {
        reasons.push(`${head} (its voucher '${f.vouchers[0]}' is not tied).`);
        j.blocked.add("grounding");
      } else {
        reasons.push(head + (f.sameCall ? " (a link cannot vouch in the call that writes it)." : "."));
      }
    }
    const shared = sharedWith.get(String(j.e.id));
    if (shared) {
      const q = shared.partner;
      const through = shared.ties.map((t) =>
        t.kind === "a" ? `'${t.relative}', their ${t.relation}` : t.kind === "b" ? `the ${t.field} on '${t.voucher}'` : "",
      );
      reasons.push(
        `Its ties cannot tell '${personId}' from '${q.personId}', '${personId}''s ${q.relation} of the same given ` +
          `name: the record ties '${q.personId}' as well (through ${[...new Set(through)].join("; ")}).`,
      );
      j.blocked.add("pair");
    }
    if (pairStands(j)) for (const t of j.pair!.ties) ties.push({ kind: "pair", ...t });
    if (j.pair) reasons.unshift(...j.pair.reasons);
    const allowed = ties.length > 0;
    verdicts.set(j.e.id, {
      allowed,
      ties,
      source: String(j.source),
      reasons: allowed ? [] : reasons,
      blockedBy: allowed ? [] : [...j.blocked].sort(),
    });
  }
  return { rows, pairs, verdicts };
}

/** The reason clauses of a refused verdict, without the refusal's routing. */
export function namesakeReasonText(verdict: NamesakeVerdict): string {
  return verdict.reasons.join(" ");
}

function namesakeRowsText(rows: any[], addedInCall: ReadonlySet<string>): string {
  const describe = (r: any) =>
    [r.name, r.place, r.time_period].filter((s) => typeof s === "string" && s.trim() !== "").join(", ");
  const parts = rows.filter((r) => !addedInCall.has(r.id)).map((r) => `${r.id}: ${describe(r)}`);
  const fresh = rows.filter((r) => addedInCall.has(r.id)).map(describe);
  if (fresh.length > 0) parts.push(`added in this call: ${fresh.join("; ")}`);
  return parts.join("; ");
}

/** The namesakes in the tree, as a refusal names them. */
export function namesakePairsText(personId: string, pairs: readonly NamesakePartner[]): string {
  return pairs.map((q) => `'${q.personId}', '${personId}''s ${q.relation} of the same given name`).join("; ");
}

/** The merge route a refusal offers when a pair may be one person entered twice
 *  (chesworthrm, 2026-10-29: after the speculative way out; a merge is tree-edit's). */
export function namesakeMergeRoute(personId: string, pairs: readonly NamesakePartner[]): string {
  const twins = pairs.filter((q) => q.sameBirthYear).map((q) => `'${q.personId}'`);
  if (twins.length === 0) return "";
  return (
    ` If '${personId}' and ${twins.join(" or ")} are one person entered twice (the same parents and the ` +
    `same birth year), hand the merge to tree-edit.`
  );
}

function namesakeRefusal(
  entry: any,
  rows: any[],
  verdict: NamesakeVerdict,
  addedInCall: ReadonlySet<string>,
  pairs: readonly NamesakePartner[] = [],
): string {
  const p = entry.person_id;
  if (rows.length === 0) {
    return (
      `confidence '${entry.confidence}' is not available on link '${entry.id}' to '${p}': '${p}' has a ` +
      `namesake in the tree (${namesakePairsText(p, pairs)}), and nothing in source '${verdict.source}' tells ` +
      `assertion '${entry.assertion_id}' apart from them. ${namesakeReasonText(verdict)} A namesake in the ` +
      `tree caps this link at 'speculative' whatever the match score. Write it as 'speculative' naming the ` +
      `namesake in the rationale; or, if the record belongs to '${p}', first link what tells them apart: a ` +
      `record that dates '${p}' or the namesake (a date read from this record does not count), another party ` +
      `of this source linked to a spouse, parent or child of '${p}' (counted only while no party of this ` +
      `source is linked to a spouse, parent, child or sibling of the namesake), or, in an earlier call, a record with the ` +
      `same street address or occupation that is itself tied to '${p}'.` +
      namesakeMergeRoute(p, pairs)
    );
  }
  const alsoPaired = pairs.length > 0 ? ` '${p}' also has a namesake in the tree (${namesakePairsText(p, pairs)}).` : "";
  return (
    `confidence '${entry.confidence}' is not available on link '${entry.id}' to '${p}': namesake(s) of ` +
    `'${p}' are recorded (${namesakeRowsText(rows, addedInCall)}), and nothing in source ` +
    `'${verdict.source}' ties assertion '${entry.assertion_id}' to '${p}'. ${namesakeReasonText(verdict)} ` +
    `A recorded namesake caps this link at 'speculative' whatever the match score. Write it as ` +
    `'speculative' naming the namesake in the rationale; or, if the record belongs to '${p}', first link ` +
    `what ties it: another party of this source to a spouse, parent or child of '${p}' (in this call or ` +
    `earlier), or, in an earlier call, a record with the same street address or occupation that is itself ` +
    `tied to '${p}'.` +
    alsoPaired
  );
}

/** The cap on one person_evidence entry, judged statically on `research` as it
 *  stands: `[]` when the entry is allowed or not judged, one refusal otherwise.
 *  The guard-case replay binds this; a write is judged by `namesakeCallCheck`. */
export function namesakeTieInvariants(
  entry: any,
  research: any,
  tree?: any,
  startingPersonIds?: ReadonlySet<string>,
  startingTree?: any,
): string[] {
  if (!entry || typeof entry.person_id !== "string") return [];
  const v = namesakeVerdicts(entry.person_id, research, tree, { startingPersonIds, derivedPairs: true, startingTree });
  const verdict = v?.verdicts.get(entry.id);
  if (!v || !verdict || verdict.allowed) return [];
  return [namesakeRefusal(entry, v.rows, verdict, new Set(), v.pairs)];
}

/** The links one research_append call ASSERTS to a person with a namesake row
 *  or a namesake in the tree after the call, each with the cap's verdict: a link
 *  live and probable or confident after the call whose pairing was not before,
 *  or whose confidence is above that pairing's strongest live link before the
 *  call (an append, a re-point, an un-supersede, a raise). Only those links are
 *  judged. Vouchers are the pairings live and probable or better both before and
 *  after the call, so a link cannot vouch in the call that writes it. Links the
 *  call did not assert are not returned. */
export function assertedNamesakeVerdicts(
  before: { research: any },
  after: { research: any; tree: any },
  startingPersonIds?: ReadonlySet<string>,
  opts: { startingTree?: any } = {},
): Array<{ entry: any; rows: any[]; pairs: NamesakePartner[]; verdict: NamesakeVerdict }> {
  const rows = Array.isArray(after.research?.namesakes) ? after.research.namesakes : [];
  const rowHolders = new Set(rows.map((r: any) => r?.person_id).filter((p: unknown) => typeof p === "string"));
  const paired = new Map<string, boolean>();
  const holders = {
    has(p: string): boolean {
      if (rowHolders.has(p)) return true;
      let v = paired.get(p);
      if (v === undefined) paired.set(p, (v = derivedNamesakePairs(after.tree, p).length > 0));
      return v;
    },
  };
  // The strongest live entry of each pairing before the call, so a weaker
  // duplicate of a standing link never makes it read as raised.
  const strongBefore = new Map<string, any>();
  for (const e of (Array.isArray(before.research?.person_evidence) ? before.research.person_evidence : []) as any[]) {
    if (!isLiveStrong(e)) continue;
    const prev = strongBefore.get(pairingKey(e));
    if (!prev || CONFIDENCE_RANK[e.confidence] > CONFIDENCE_RANK[prev.confidence]) strongBefore.set(pairingKey(e), e);
  }
  const assertedBy = new Map<string, Set<string>>();
  for (const e of (Array.isArray(after.research?.person_evidence) ? after.research.person_evidence : []) as any[]) {
    if (!isLiveStrong(e) || typeof e.id !== "string") continue;
    const prev = strongBefore.get(pairingKey(e));
    if (prev && CONFIDENCE_RANK[e.confidence] <= CONFIDENCE_RANK[prev.confidence]) continue;
    // Only now, for a link this call asserts, are the person's pairs read from the tree.
    if (!holders.has(e.person_id)) continue;
    const ids = assertedBy.get(e.person_id);
    if (ids) ids.add(e.id);
    else assertedBy.set(e.person_id, new Set([e.id]));
  }
  if (assertedBy.size === 0) return [];
  const voucherPairs = vouchingPairs(before, after);
  const entryById = new Map<string, any>();
  for (const e of (after.research.person_evidence ?? []) as any[]) if (e && typeof e.id === "string") entryById.set(e.id, e);

  const out: Array<{ entry: any; rows: any[]; pairs: NamesakePartner[]; verdict: NamesakeVerdict }> = [];
  for (const p of [...assertedBy.keys()].sort()) {
    const v = namesakeVerdicts(p, after.research, after.tree, {
      startingPersonIds,
      voucherPairs,
      only: assertedBy.get(p),
      derivedPairs: true,
      startingTree: opts.startingTree,
    });
    if (!v) continue;
    for (const [id, verdict] of v.verdicts) out.push({ entry: entryById.get(id), rows: v.rows, pairs: v.pairs, verdict });
  }
  return out;
}

/** The pairings live and probable or better both before and after a call:
 *  the links that may vouch in it, so a link cannot vouch in the call that
 *  writes it. */
function vouchingPairs(before: { research: any }, after: { research: any }): Set<string> {
  const strong = (research: any) =>
    new Set(
      ((Array.isArray(research?.person_evidence) ? research.person_evidence : []) as any[])
        .filter(isLiveStrong)
        .map(pairingKey),
    );
  const was = strong(before.research);
  return new Set([...strong(after.research)].filter((k) => was.has(k)));
}

/** Where a tree fact's evidence comes from, read as the namesake cap reads
 *  parties: its `assertion_id`'s source and party when that resolves, else
 *  every research source its refs reach, any party (`party: null`). */
export function factEvidenceParties(
  fact: any,
  research: any,
  partyOf: (a: any) => string = capPartyKeyer(Array.isArray(research?.assertions) ? research.assertions : []),
  assertionOf: (id: string) => any = (id) =>
    ((Array.isArray(research?.assertions) ? research.assertions : []) as any[]).find((x) => x?.id === id),
): Array<{ source: unknown; party: string | null }> {
  const a = typeof fact?.assertion_id === "string" ? assertionOf(fact.assertion_id) : undefined;
  if (a) return [{ source: capSource(a), party: partyOf(a) }];
  return [...refsReach(sourceRefsOf(fact), research).sourceIds].map((source) => ({ source, party: null }));
}

/** Item 10 of #3363 (chesworthrm, 2026-10-24): stamps `record_persona_ids` on
 *  each row the call appended, or updated through `record_ids` or
 *  `log_entry_ids`, from the row's own search sidecars, so the first runs can
 *  count what a persona-keyed refusal would catch. Overwrites whatever the
 *  caller supplied; an update cannot set the field (`updatableFields`). A found
 *  record id is stored in the sidecar's form, as an assertion's is. */
export async function stampNamesakePersonas(
  research: any,
  ops: ReadonlyArray<ResearchAppendOp>,
  applied: ReadonlyArray<AppliedOp>,
  readResults: (ref: string) => Promise<any[] | null>,
): Promise<void> {
  const logById = new Map<string, any>(
    (Array.isArray(research?.log) ? research.log : [])
      .filter((e: any) => e && typeof e.id === "string")
      .map((e: any) => [e.id, e]),
  );
  const rows = (Array.isArray(research?.namesakes) ? research.namesakes : []) as any[];
  for (const a of applied) {
    if (a.section !== "namesakes" || a.noop) continue;
    const fields = (ops[a.opIndex] as any)?.fields;
    if (a.op === "update" && !("record_ids" in (fields ?? {})) && !("log_entry_ids" in (fields ?? {}))) continue;
    const row = rows.find((r) => r && r.id === a.entryId);
    if (!row) continue;
    const stamp: Record<string, string> = {};
    const recordIds = (Array.isArray(row.record_ids) ? row.record_ids : []).map(async (id: unknown) => {
      if (typeof id !== "string") return id;
      for (const logId of Array.isArray(row.log_entry_ids) ? row.log_entry_ids : []) {
        const entry = logById.get(logId);
        if (!entry || !PERSONA_BEARING_PRODUCERS.has(entry.tool) || typeof entry.results_ref !== "string") continue;
        const hit = (await readResults(entry.results_ref))?.find(
          (r) => r && typeof r.recordId === "string" && arkToBareId(r.recordId) === arkToBareId(id),
        );
        if (!hit) continue;
        if (typeof hit.primaryId === "string" && hit.primaryId !== "") stamp[hit.recordId] = hit.primaryId;
        return hit.recordId;
      }
      // Accepted unstamped, unlike #699's assertions: the cap reads only that a row exists, so this loses a count, not identity.
      return id;
    });
    row.record_ids = await Promise.all(recordIds);
    if (Object.keys(stamp).length > 0) row.record_persona_ids = stamp;
    else delete row.record_persona_ids;
  }
}

/** What the namesake warning lists for one person. */
export interface NamesakeRowListing {
  personId: string;
  /** The rows the call wrote for them. */
  rows: any[];
  /** The live probable or confident links to them the cap refuses. */
  refused: any[];
  /** The facts on them whose party holds a refused link and no allowed one. */
  facts: any[];
  /** Their names citing a refused link's source. */
  names: any[];
}

/** For each person whose row the call appended or updated: the live probable
 *  or confident links to them the cap refuses, judged as the call's own links
 *  are (vouchers are the pairings strong before and after the call), and the
 *  facts and names those links' parties carry onto them. A refused link the
 *  call asserted already fails the call, so a call that succeeds lists only
 *  links that stood before it. */
export function namesakeRowListings(
  before: { research: any },
  after: { research: any; tree: any },
  applied: ReadonlyArray<{ section: string; entryId: string }>,
  startingPersonIds?: ReadonlySet<string>,
): NamesakeRowListing[] {
  const written = new Set(applied.filter((a) => a.section === "namesakes").map((a) => a.entryId));
  if (written.size === 0) return [];
  const rows = (Array.isArray(after.research?.namesakes) ? after.research.namesakes : []) as any[];
  const holders = [
    ...new Set(
      rows.filter((r) => r && written.has(r.id) && typeof r.person_id === "string").map((r) => r.person_id as string),
    ),
  ].sort();
  const voucherPairs = vouchingPairs(before, after);
  const assertions = ((Array.isArray(after.research?.assertions) ? after.research.assertions : []) as any[]).filter(isLiveAssertion);
  const assertionById = new Map<string, any>(
    assertions.filter((a) => a && typeof a.id === "string").map((a) => [a.id, a]),
  );
  const partyOf = capPartyKeyer(assertions);
  const entries = (
    (Array.isArray(after.research?.person_evidence) ? after.research.person_evidence : []) as any[]
  ).filter((e) => e && typeof e.id === "string");
  const sourceOf = (e: any) => capSource(assertionById.get(e.assertion_id));
  const partyKey = (source: unknown, party: string) => `${String(source)}\u0000${party}`;
  const partyKeyOf = (e: any) => {
    const a = assertionById.get(e.assertion_id);
    return a ? partyKey(capSource(a), partyOf(a)) : null;
  };
  const out: NamesakeRowListing[] = [];
  for (const p of holders) {
    const v = namesakeVerdicts(p, after.research, after.tree, { startingPersonIds, voucherPairs });
    if (!v) continue;
    const refused = entries.filter((e) => v.verdicts.get(e.id)?.allowed === false);
    if (refused.length === 0) continue;
    const allowed = entries.filter((e) => v.verdicts.get(e.id)?.allowed === true);
    const refusedParties = new Set(refused.map(partyKeyOf));
    const allowedParties = new Set(allowed.map(partyKeyOf));
    const refusedSources = new Set(refused.map(sourceOf));
    const allowedSources = new Set(allowed.map(sourceOf));
    const person = ((after.tree?.persons ?? []) as any[]).find((x) => x?.id === p);
    const facts = ((person?.facts ?? []) as any[]).filter((f) =>
      factEvidenceParties(f, after.research, partyOf, (id) => assertionById.get(id)).some(({ source, party }) =>
        party === null
          ? refusedSources.has(source) && !allowedSources.has(source)
          : refusedParties.has(partyKey(source, party)) && !allowedParties.has(partyKey(source, party)),
      ),
    );
    const names = ((person?.names ?? []) as any[]).filter((n) =>
      [...refsReach(sourceRefsOf(n), after.research).sourceIds].some((s) => refusedSources.has(s)),
    );
    out.push({ personId: p, rows: rows.filter((r) => r && r.person_id === p && written.has(r.id)), refused, facts, names });
  }
  return out;
}

function sourceRefsOf(x: any): string[] {
  return ((Array.isArray(x?.sources) ? x.sources : []) as any[])
    .map((s) => s?.ref)
    .filter((r): r is string => typeof r === "string" && r !== "");
}

/** The namesake warning (spec §5.6): `namesakeRowListings`, one warning per
 *  person. The row is written either way. */
export function namesakeRowWarnings(
  before: { research: any },
  after: { research: any; tree: any },
  applied: ReadonlyArray<{ section: string; entryId: string }>,
  startingPersonIds?: ReadonlySet<string>,
): string[] {
  const assertionById = new Map<string, any>(
    ((Array.isArray(after.research?.assertions) ? after.research.assertions : []) as any[])
      .filter((a) => a && typeof a.id === "string")
      .map((a) => [a.id, a]),
  );
  return namesakeRowListings(before, after, applied, startingPersonIds).map(({ personId: p, rows, refused, facts, names }) => {
    const rowText = rows
      .map((r) => {
        const about = [r.name, r.place, r.time_period].filter((x) => typeof x === "string" && x !== "");
        return about.length > 0 ? `'${r.id}' (${about.join(", ")})` : `'${r.id}'`;
      })
      .join(", ");
    const linkText = refused
      .map((e) => {
        const a = assertionById.get(e.assertion_id);
        return `'${e.id}' (assertion '${e.assertion_id}' on source '${String(capSource(a))}', ${String(a?.fact_type ?? "")})`;
      })
      .join(", ");
    const factText =
      facts.length === 0
        ? ""
        : ` ${facts.length} fact(s) on '${p}' were copied through them: ` +
          facts
            .map((f) => {
              const refs = sourceRefsOf(f);
              return `'${f.id}' ${String(f.type ?? "")}${refs.length > 0 ? ` (cites ${refs.join(", ")})` : ""}`;
            })
            .join(", ") +
          ".";
    const nameText =
      names.length === 0
        ? ""
        : ` ${names.length} name(s) on '${p}' also cite those records and stay, since no tool removes a name.`;
    return (
      `namesake ${rowText} recorded for '${p}': ${refused.length} probable or confident link(s) to '${p}' ` +
      `stand with nothing in their record tying them to '${p}': ${linkText}.${factText}${nameText} The row is recorded ` +
      `and these stay as they are, but materialize_facts will not copy any further fact onto '${p}' through these ` +
      `links, and tree_edit and tree_correct will not cite their records' S entries onto '${p}''s facts or names ` +
      `unless another record on the same S entry ties to '${p}'. ` +
      "For each link, person-evidence either ties it or lowers it to 'speculative' naming the " +
      "namesake." +
      (facts.length === 0
        ? ""
        : ` Remove a listed fact that belongs to the namesake with tree_correct (operation 'remove', its ` +
          `factId and personId '${p}').`)
    );
  });
}

// ─── The namesake check on tree writes (issue #3363, item 8) ────────────────
//
// A record cited onto a fact or name of a person with a namesake row must tie
// to that person: each ref needs, among the research sources it reaches, one
// with a live probable or confident link from it to the person that the cap
// allows. Relationships, and facts on them, are left to Rule T (#3032).

/** A citation one tree write adds onto a person's fact or name. */
export interface IntroducedCitation {
  /** The op that added it; null in the single op form. */
  index: number | null;
  personId: string;
  kind: "fact" | "name";
  nodeId: string;
  /** How the node reads in a refusal. */
  label: string;
  /** Whether the op made the node, rather than changed it. */
  added: boolean;
  /** The bare refs (no leading `#`) the op added to the node. */
  refs: string[];
}

/** The citations onto the facts and names of `holders` that `after` holds and
 *  `before` does not: every ref of a new node, and the refs an existing node
 *  gained, compared bare. A node is matched by id on the same person, so a
 *  fact id reused on another person is not read as this one. */
export function introducedCitations(
  before: any,
  after: any,
  holders: ReadonlySet<string>,
  index: number | null,
): IntroducedCitation[] {
  const out: IntroducedCitation[] = [];
  const beforeById = new Map<string, any>(
    ((before?.persons ?? []) as any[]).filter((p) => p && typeof p.id === "string").map((p) => [p.id, p]),
  );
  for (const person of (after?.persons ?? []) as any[]) {
    if (!person || !holders.has(person.id)) continue;
    const prior = beforeById.get(person.id);
    for (const kind of ["fact", "name"] as const) {
      const nodes = ((kind === "fact" ? person.facts : person.names) ?? []) as any[];
      const priorNodes = ((kind === "fact" ? prior?.facts : prior?.names) ?? []) as any[];
      for (const node of nodes) {
        if (!node) continue;
        const was = typeof node.id === "string" ? priorNodes.find((n) => n?.id === node.id) : undefined;
        const had = new Set(bareRefsOf(was));
        const refs = [...new Set(bareRefsOf(node))].filter((r) => !had.has(r));
        if (refs.length === 0) continue;
        const label =
          kind === "fact"
            ? `fact '${node.id ?? "(new)"}' (${String(node.type ?? "")})`
            : `name '${node.id ?? "(new)"}' (${[node.given, node.surname].filter((x) => typeof x === "string" && x !== "").join(" ")})`;
        out.push({ index, personId: person.id, kind, nodeId: String(node.id ?? ""), label, added: !was, refs });
      }
    }
  }
  return out;
}

/** The per op citations a whole call still adds: a ref a node did not carry
 *  before the call and does after it. A ref one op drops and a later op puts
 *  back, or one op adds and a later op drops, is not charged; a ref several ops
 *  add is charged once, on the last of them. */
export function netIntroducedCitations(
  perOp: ReadonlyArray<IntroducedCitation>,
  before: any,
  after: any,
  holders: ReadonlySet<string>,
): IntroducedCitation[] {
  const nodeKey = (c: IntroducedCitation) => `${c.personId}\u0000${c.kind}\u0000${c.nodeId}`;
  const net = new Map(introducedCitations(before, after, holders, null).map((c) => [nodeKey(c), new Set(c.refs)]));
  const lastOp = new Map<string, number>();
  perOp.forEach((c, i) => {
    for (const r of c.refs) if (net.get(nodeKey(c))?.has(r)) lastOp.set(`${nodeKey(c)}\u0000${r}`, i);
  });
  return perOp
    .map((c, i) => ({ ...c, refs: c.refs.filter((r) => lastOp.get(`${nodeKey(c)}\u0000${r}`) === i) }))
    .filter((c) => c.refs.length > 0);
}

/** The check on tree writes: for each ref an introduced citation onto a person
 *  with a namesake row adds, one finding per research source the ref reaches,
 *  unless one of them has a live probable or confident link to that person
 *  that `namesakeVerdicts` allows. An S entry can back several research
 *  sources, one per persona of a record, so one tied source is enough. A ref
 *  that reaches no research source is not judged. `tree` is the tree the cap
 *  reads relatives from: the caller passes the tree as it stood before the
 *  call. */
export function namesakeCitationRefusals(
  research: any,
  tree: any,
  introduced: ReadonlyArray<IntroducedCitation>,
  startingPersonIds?: ReadonlySet<string>,
): Array<{ index: number | null; message: string }> {
  if (!Array.isArray(research?.namesakes) || research.namesakes.length === 0 || introduced.length === 0) return [];
  const assertionById = new Map<string, any>(
    ((Array.isArray(research?.assertions) ? research.assertions : []) as any[])
      .filter((a) => a && typeof a.id === "string")
      .map((a) => [a.id, a]),
  );
  const entries = ((Array.isArray(research?.person_evidence) ? research.person_evidence : []) as any[]).filter(
    (e) => e && !e.superseded_by && typeof e.id === "string",
  );
  const reached = new Map<string, string[]>();
  const sourcesOf = (ref: string) => {
    let ids = reached.get(ref);
    if (!ids) reached.set(ref, (ids = [...refsReach([ref], research).sourceIds]));
    return ids;
  };
  const verdictsOf = new Map<string, NamesakeVerdicts | null>();
  const findings: Array<{ index: number | null; message: string }> = [];
  for (const c of introduced) {
    const own = namesakeRowsOf(research, c.personId);
    if (own.length === 0) continue;
    if (!verdictsOf.has(c.personId)) {
      verdictsOf.set(c.personId, namesakeVerdicts(c.personId, research, tree, { startingPersonIds }));
    }
    const v = verdictsOf.get(c.personId) ?? null;
    const mine = entries.filter((e) => e.person_id === c.personId);
    const strongFrom = (src: string) =>
      mine.filter((e) => capSource(assertionById.get(e.assertion_id)) === src).filter(isLiveStrong);
    const ties = (src: string) => strongFrom(src).some((e) => v?.verdicts.get(e.id)?.allowed === true);
    const judged = new Set<string>();
    for (const ref of c.refs) {
      if (sourcesOf(ref).some(ties)) continue;
      for (const src of sourcesOf(ref)) {
        if (judged.has(src)) continue;
        judged.add(src);
        const strong = strongFrom(src);
        const judgedStrong = strong.find((e) => v?.verdicts.get(e.id) !== undefined);
        const reason =
          strong.length === 0
            ? `it has no probable or confident link to '${c.personId}'`
            : judgedStrong === undefined
              ? `its only link to '${c.personId}' rests on an assertion that records an absence, which ties nothing`
              : `its link '${judgedStrong.id}' to '${c.personId}' is not tied: ${(v?.verdicts.get(judgedStrong.id)?.reasons[0] ?? "nothing in the record ties it").replace(/\.$/, "")}`;
        findings.push({
          index: c.index,
          message:
            `'${c.personId}' has a recorded namesake (${own.map((r) => `'${r.id}'`).join(", ")}), so a record goes ` +
            `onto '${c.personId}''s facts and names only when something in it ties it to '${c.personId}'. The ` +
            `${c.label} this op ${c.added ? "adds" : "changes"} cites ${ref} (research source '${src}'), and ${reason}. ` +
            `Nothing was written. Cite only records that tie to '${c.personId}', or hand the link to the ` +
            "person-evidence agent, which owns person_evidence, to tie it first; a relationship added in this same " +
            "call does not count, so add it in an earlier call.",
        });
      }
    }
  }
  return findings;
}

/** The namesake cap on one research_append call, judged on its end state: one
 *  finding per asserted link the cap refuses (`assertedNamesakeVerdicts`),
 *  keyed to the last op that wrote it. */
export function namesakeCallCheck(
  before: { research: any },
  after: { research: any; tree: any },
  applied: ReadonlyArray<{ section: string; entryId: string }>,
  startingPersonIds?: ReadonlySet<string>,
  startingTree?: any,
): Array<{ index: number | null; message: string }> {
  const rowIdsBefore = new Set(
    (Array.isArray(before.research?.namesakes) ? before.research.namesakes : []).map((r: any) => r?.id),
  );
  const addedInCall = new Set<string>(
    (Array.isArray(after.research?.namesakes) ? after.research.namesakes : [])
      .map((r: any) => r?.id)
      .filter((id: unknown) => !rowIdsBefore.has(id)),
  );
  const findings: Array<{ index: number | null; message: string }> = [];
  for (const { entry, rows, pairs, verdict } of assertedNamesakeVerdicts(before, after, startingPersonIds, { startingTree })) {
    if (verdict.allowed) continue;
    let index: number | null = null;
    for (let i = applied.length - 1; i >= 0; i--) {
      if (applied[i].section === "person_evidence" && applied[i].entryId === entry.id) {
        index = i;
        break;
      }
    }
    findings.push({ index, message: namesakeRefusal(entry, rows, verdict, addedInCall, pairs) });
  }
  return findings;
}

// ─── The namesake checks on a merge (issue #3363) ───────────────────────────
//
// A merge moves the links of one person onto another. When either carries a
// namesake row, each moved link must pass the cap as a link to the row holder
// (part 1), and nothing may come across from a record whose links to the pair
// all fail it (part 3). Both read the project as it stood before the merge,
// keyed on whoever holds the row, so the order a pair is written in cannot
// skip them. Pure and synchronous: merge_tree_persons calls them, never
// researchAppend.

/** One direction of one merge pair: `T` holds a namesake row, and the merge
 *  would move the links of `G`, the other member, onto it. */
export interface MergeDirection {
  survivor: string;
  folded: string;
  T: string;
  G: string;
  rows: any[];
  /** The cap's verdict on each of G's live probable or confident links,
   *  judged as a link to T on the project before the merge. */
  moved: Map<string, NamesakeVerdict>;
  /** The same for T's own live probable or confident links, on the same
   *  projection, so part 3 reads T's links as part 1 does. */
  own: Map<string, NamesakeVerdict>;
}

function namesakeRowsOf(research: any, personId: string): any[] {
  return (Array.isArray(research?.namesakes) ? research.namesakes : []).filter(
    (r: any) => r && r.person_id === personId,
  );
}

/** Every direction of every pair in which a member holds a row, with G's links
 *  judged on T: G's links point at T, and only T's own links from before the
 *  merge can vouch. A spouse, parent or child of T whom this call merges with
 *  someone is judged as the person the merge makes, the way it will stand after
 *  the merge: the survivor's id, both copies' names and refs, and each copy's
 *  links pointed at it. */
export function mergeDirections(
  before: { research: any; tree: any },
  merges: ReadonlyArray<readonly [string, string]>,
  startingPersonIds?: ReadonlySet<string>,
): MergeDirection[] {
  if (!Array.isArray(before.research?.namesakes) || before.research.namesakes.length === 0) return [];
  const survivorOf = new Map<string, string>();
  for (const [s, c] of merges) survivorOf.set(c, s);
  const group = (id: string) => survivorOf.get(id) ?? id;
  const evidence = (Array.isArray(before.research?.person_evidence) ? before.research.person_evidence : []) as any[];
  const out: MergeDirection[] = [];
  for (const [s, c] of merges) {
    for (const [T, G] of [[s, c], [c, s]] as const) {
      const rows = namesakeRowsOf(before.research, T);
      if (rows.length === 0) continue;
      // Each member of a merge group holding one of T's relatives, keyed to the
      // group's survivor.
      const merged = new Map<string, string>();
      for (const r of relativesById(before.tree, T).keys()) {
        const g = group(r);
        if (r === s || r === c || g === T || g === G) continue;
        const members = [g, ...[...survivorOf].filter(([, sv]) => sv === g).map(([m]) => m)];
        if (members.length < 2) continue;
        for (const m of members) merged.set(m, g);
      }
      const tree = merged.size === 0 ? before.tree : mergedPersonsTree(before.tree, merged);
      const projected = {
        ...before.research,
        person_evidence: evidence.map((e) => {
          if (!e || e.superseded_by || typeof e.person_id !== "string") return e;
          if (e.person_id === G) return { ...e, person_id: T };
          const g = merged.get(e.person_id);
          return g === undefined || g === e.person_id ? e : { ...e, person_id: g };
        }),
      };
      const voucherPairs = new Set(evidence.filter((e) => isLiveStrong(e) && e.person_id === T).map(pairingKey));
      const v = namesakeVerdicts(T, projected, tree, { startingPersonIds, voucherPairs });
      const moved = new Map<string, NamesakeVerdict>();
      const own = new Map<string, NamesakeVerdict>();
      for (const e of evidence) {
        const verdict = e && !e.superseded_by ? v?.verdicts.get(e.id) : undefined;
        if (!verdict) continue;
        if (e.person_id === G) moved.set(e.id, verdict);
        else if (e.person_id === T) own.set(e.id, verdict);
      }
      out.push({ survivor: s, folded: c, T, G, rows, moved, own });
    }
  }
  return out;
}

/** The tree with each merge group in `merged` (member id to survivor id) made
 *  one person under the survivor's id, holding every member's names, facts and
 *  person-level sources, with every relationship pointed at it. */
function mergedPersonsTree(tree: any, merged: ReadonlyMap<string, string>): any {
  const persons = (Array.isArray(tree?.persons) ? tree.persons : []) as any[];
  const members = new Map<string, any[]>();
  for (const p of persons) {
    const g = typeof p?.id === "string" ? merged.get(p.id) : undefined;
    if (g === undefined) continue;
    const list = members.get(g) ?? [];
    if (p.id === g) list.unshift(p);
    else list.push(p);
    members.set(g, list);
  }
  const all = (list: any[], field: string) => list.flatMap((m) => (Array.isArray(m?.[field]) ? m[field] : []));
  const outPersons: any[] = [];
  for (const p of persons) {
    const g = typeof p?.id === "string" ? merged.get(p.id) : undefined;
    if (g === undefined) outPersons.push(p);
    else if (p.id === g) {
      const list = members.get(g) ?? [p];
      outPersons.push({ ...p, names: all(list, "names"), facts: all(list, "facts"), sources: all(list, "sources") });
    }
  }
  const map = (id: unknown) => (typeof id === "string" ? (merged.get(id) ?? id) : id);
  const relationships = ((Array.isArray(tree?.relationships) ? tree.relationships : []) as any[]).map((r) =>
    r
      ? {
          ...r,
          ...(r.parent !== undefined ? { parent: map(r.parent) } : {}),
          ...(r.child !== undefined ? { child: map(r.child) } : {}),
          ...(r.person1 !== undefined ? { person1: map(r.person1) } : {}),
          ...(r.person2 !== undefined ? { person2: map(r.person2) } : {}),
        }
      : r,
  );
  return { ...tree, persons: outPersons, relationships };
}

const MERGE_LINK_ROUTING =
  "Nothing was written. Each person_evidence link listed above would stand under a recorded namesake with " +
  "nothing in its record tying it to that person as the tree stood before this merge. To merge, tie each " +
  "listed record to the row holder: if it names a spouse, parent or child whom the tree holds twice, once for " +
  "each person in the pair, add that duplicate pair to this same merge; if it names a spouse, parent or child " +
  "of the row holder not yet recorded as such, record that relationship first (tree_edit add_relationship), " +
  "then merge again. A link not marked 'do not lower it' may instead be lowered to 'speculative' by " +
  "person-evidence, naming the namesake; the facts and relationships listed from that record must then come " +
  "off the other person too. If the record is the namesake's, do not merge.";

/** Part 1: each probable or confident link the merge would move onto a person
 *  with a namesake row must pass the cap as that person's link. One line per
 *  refused link, then the routing; `[]` when nothing is refused. A link tied on
 *  its own person (made from that record, or tied by that person's own
 *  relatives or earlier links) is marked "do not lower it": lowering it would
 *  give up a correct link to make the merge pass. */
export function mergeNamesakeRefusals(
  before: { research: any; tree: any },
  merges: ReadonlyArray<readonly [string, string]>,
  startingPersonIds?: ReadonlySet<string>,
): string[] {
  const entryById = new Map<string, any>();
  for (const e of (before.research?.person_evidence ?? []) as any[]) if (e && typeof e.id === "string") entryById.set(e.id, e);
  const lines: string[] = [];
  for (const d of mergeDirections(before, merges, startingPersonIds)) {
    let onG: NamesakeVerdicts | null | undefined;
    for (const [id, verdict] of d.moved) {
      if (verdict.allowed) continue;
      const e = entryById.get(id);
      let mark = "";
      if (mintedFromThisSource(d.G, verdict.source, before.research, before.tree, startingPersonIds)) {
        mark = ` Do not lower it: '${d.G}' was created from this record.`;
      } else {
        onG ??= namesakeVerdicts(
          d.G,
          { ...before.research, namesakes: d.rows.map((r) => ({ ...r, person_id: d.G })) },
          before.tree,
          { startingPersonIds },
        );
        if (onG?.verdicts.get(id)?.allowed) {
          mark =
            ` Do not lower it: on '${d.G}' it is tied by '${d.G}''s own relatives or earlier links, which ` +
            `'${d.T}' does not share in the tree.`;
        }
      }
      const rows = d.rows.map((r) => `'${r.id}'`).join(", ");
      lines.push(
        `person_evidence '${id}' on '${d.G}' would stand under the namesake row${d.rows.length > 1 ? "s" : ""} ` +
          `${rows} of '${d.T}' after this merge: nothing in source '${verdict.source}' ties assertion ` +
          `'${e.assertion_id}' to '${d.T}'. ${namesakeReasonText(verdict)}${mark}`,
      );
    }
  }
  return lines.length > 0 ? [...lines, MERGE_LINK_ROUTING] : [];
}

/** Something the merge carries from G onto T, and the refs to judge it on. */
interface CarriedItem {
  label: string;
  folded: boolean;
  refs: string[];
}

function bareRefsOf(x: any): string[] {
  const out: string[] = [];
  for (const r of (Array.isArray(x?.sources) ? x.sources : []) as any[]) {
    if (typeof r?.ref === "string" && r.ref !== "") out.push(r.ref.startsWith("#") ? r.ref.slice(1) : r.ref);
  }
  return out;
}

/** The merge's own equivalence classes: each item joins the first class with a
 *  member it is equivalent to, in list order (mergeNames, mergeFacts). */
function mergeClasses<X>(items: X[], equivalent: (a: X, b: X) => boolean): X[][] {
  const classes: X[][] = [];
  for (const item of items) {
    const cls = classes.find((c) => c.some((m) => equivalent(m, item)));
    if (cls) cls.push(item);
    else classes.push([item]);
  }
  return classes;
}

/** G's names, facts, person-level refs and relationships as the merge would
 *  carry them onto T. An item that folds into one of T's is judged only on the
 *  refs it adds, and is left out when it adds none. A person-level ref T
 *  already holds adds nothing. The relationship joining G and T is part 2's. */
function carriedItems(tree: any, d: MergeDirection, survivorOf: ReadonlyMap<string, string>): CarriedItem[] {
  const persons = new Map<string, any>();
  for (const p of (Array.isArray(tree?.persons) ? tree.persons : []) as any[]) if (p && typeof p.id === "string") persons.set(p.id, p);
  const survivor = persons.get(d.survivor);
  const folded = persons.get(d.folded);
  const g = persons.get(d.G);
  const items: CarriedItem[] = [];
  const unique = (refs: string[]) => [...new Set(refs)];

  const judgeLists = <X>(field: "names" | "facts", equivalent: (a: X, b: X) => boolean, label: (x: X) => string) => {
    const fromG = new Set<X>((g?.[field] ?? []) as X[]);
    const classes = mergeClasses<X>([...((survivor?.[field] ?? []) as X[]), ...((folded?.[field] ?? []) as X[])], equivalent);
    for (const cls of classes) {
      const fromT = cls.filter((x) => !fromG.has(x));
      const held = new Set(fromT.flatMap(bareRefsOf));
      for (const x of cls) {
        if (!fromG.has(x)) continue;
        const refs = unique(bareRefsOf(x).filter((r) => fromT.length === 0 || !held.has(r)));
        if (refs.length === 0) continue;
        items.push({ label: label(x), folded: fromT.length > 0, refs });
      }
    }
  };
  judgeLists<any>("names", namesEquivalent, (n) => `name '${[n?.given, n?.surname].filter(Boolean).join(" ")}'`);
  judgeLists<any>("facts", factsEquivalent, (f) => `fact '${f?.id}' (${f?.type})`);

  const tHolds = new Set(bareRefsOf(persons.get(d.T)));
  for (const r of unique(bareRefsOf(g))) {
    if (!tHolds.has(r)) items.push({ label: `source ref '${r}'`, folded: false, refs: [r] });
  }

  const merged = (id: unknown) => (typeof id === "string" ? (survivorOf.get(id) ?? id) : id);
  const remap = (r: any) => ({
    ...r,
    ...(r.parent !== undefined ? { parent: merged(r.parent) } : {}),
    ...(r.child !== undefined ? { child: merged(r.child) } : {}),
    ...(r.person1 !== undefined ? { person1: merged(r.person1) } : {}),
    ...(r.person2 !== undefined ? { person2: merged(r.person2) } : {}),
  });
  const touches = (r: any, id: string) => r.parent === id || r.child === id || r.person1 === id || r.person2 === id;
  const relRefs = (r: any) => [...bareRefsOf(r), ...((Array.isArray(r?.facts) ? r.facts : []) as any[]).flatMap(bareRefsOf)];
  const rels = (Array.isArray(tree?.relationships) ? tree.relationships : []) as any[];
  for (const r of rels) {
    if (!r || !touches(r, d.G) || touches(r, d.T)) continue;
    const mapped = remap(r);
    const fromT = rels.filter((x) => x && x !== r && touches(x, d.T) && !touches(x, d.G) && relationshipMatches(remap(x), mapped));
    const held = new Set(fromT.flatMap(relRefs));
    const refs = unique(relRefs(r).filter((x) => fromT.length === 0 || !held.has(x)));
    if (refs.length === 0) continue;
    const other = [r.parent, r.child, r.person1, r.person2].find((id) => id !== undefined && id !== d.G);
    items.push({ label: `relationship '${r.id}' (${r.type} with '${other}')`, folded: fromT.length > 0, refs });
  }
  return items;
}

/** Part 3's trigger for one direction: each research source that some link of
 *  G or T comes from, at any confidence, live or withdrawn, and whose live
 *  probable or confident links to them are all refused (both judged as part 1
 *  judges them, in `d`), with the reason for each link. A link from an
 *  absent-basis assertion is ignored both ways, and a source with no link to
 *  either never triggers, which covers a relative's records. */
export function carryTriggerSources(
  before: { research: any; tree: any },
  d: MergeDirection,
): Map<string, string[]> {
  const assertionById = new Map<string, any>();
  for (const a of (before.research?.assertions ?? []) as any[]) if (a && typeof a.id === "string") assertionById.set(a.id, a);
  const bySource = new Map<string, any[]>();
  for (const e of (before.research?.person_evidence ?? []) as any[]) {
    if (!e || (e.person_id !== d.G && e.person_id !== d.T)) continue;
    const a = assertionById.get(e.assertion_id);
    if (!a || typeof a.source_id !== "string" || recordBasisOf(a) === "absent") continue;
    const list = bySource.get(a.source_id);
    if (list) list.push(e);
    else bySource.set(a.source_id, [e]);
  }
  const out = new Map<string, string[]>();
  for (const [sourceId, named] of bySource) {
    const allowed = named.some(
      (e) => isLiveStrong(e) && (e.person_id === d.G ? d.moved : d.own).get(e.id)?.allowed,
    );
    if (allowed) continue;
    out.set(
      sourceId,
      named.map((e) =>
        e.superseded_by
          ? `'${e.id}' withdrawn`
          : !isStrongConfidence(e.confidence)
            ? `'${e.id}' ${e.confidence}`
            : e.person_id === d.G
              ? `'${e.id}' refused above`
              : `'${e.id}' untied on '${d.T}'`,
      ),
    );
  }
  return out;
}

/** Part 3: nothing comes across onto T from a record that names G or T while
 *  none of its probable or confident links to them passes the cap. One line
 *  per item and source, then the routing for that pair; `[]` when nothing is
 *  refused. Which sources trigger is `carryTriggerSources`. */
export function mergeCarryRefusals(
  before: { research: any; tree: any },
  merges: ReadonlyArray<readonly [string, string]>,
  startingPersonIds?: ReadonlySet<string>,
): string[] {
  const directions = mergeDirections(before, merges, startingPersonIds);
  if (directions.length === 0) return [];
  const survivorOf = new Map<string, string>();
  for (const [s, c] of merges) survivorOf.set(c, s);
  const out: string[] = [];
  for (const d of directions) {
    const triggers = carryTriggerSources(before, d);
    const lines: string[] = [];
    for (const item of carriedItems(before.tree, d, survivorOf)) {
      for (const ref of item.refs) {
        for (const sourceId of refsReach([ref], before.research).sourceIds) {
          const reasons = triggers.get(sourceId);
          if (!reasons) continue;
          const head = item.folded
            ? `${item.label} on '${d.G}' would fold into '${d.T}''s and add the citation '${ref}' (research source '${sourceId}')`
            : `${item.label} on '${d.G}' cites '${ref}' (research source '${sourceId}')`;
          lines.push(
            `${head}, and no probable or confident link from that record to '${d.G}' or '${d.T}' passes the ` +
              `namesake cap (${reasons.join(", ")}). The merge would carry it onto '${d.T}', who has a recorded namesake.`,
          );
        }
      }
    }
    if (lines.length === 0) continue;
    out.push(
      ...lines,
      `Nothing was written. Remove each listed fact or relationship from '${d.G}' with tree_correct (operation ` +
        `'remove', factId or relationshipId), then merge again; '${d.T}''s own matching fact or relationship ` +
        `stays. Remove nothing from a record whose link above says 'do not lower it': that record is '${d.G}''s, ` +
        `so tie it to '${d.T}' or do not merge. No tool removes a name or a person-level source, so for a listed ` +
        `name or person-level source, or a citation a matching name would add: if the record belongs to ` +
        `'${d.T}', have person-evidence tie a link from it to '${d.T}'; otherwise do not merge.`,
    );
  }
  return out;
}

/** A merge cannot bring a rejected pair back (lead, 2026-10-20). Refused in both
 *  directions: (a) a live link the merge moves lands on a pair the researcher
 *  rejected for the survivor, and (b) a rejection the merge moves lands on a pair
 *  the survivor links live. Only pairs the merge creates: a link and a rejection
 *  that already stood together before it are not this merge's doing. Nothing
 *  overrides it. One line per pair, then the routing; `[]` when nothing is refused. */
function mergeRejectedPairRefusals(
  before: { research: any },
  after: { research: any },
  survivorOf: ReadonlyMap<string, string>,
): string[] {
  const live = (doc: any): any[] =>
    ((doc?.person_evidence ?? []) as any[]).filter(
      (e) => e && !e.superseded_by && typeof e.assertion_id === "string" && typeof e.person_id === "string",
    );
  const rejections = (doc: any): RejectedLink[] =>
    Array.isArray(doc?.rejected_links) ? (doc.rejected_links as RejectedLink[]) : [];
  // By link id: the merge remaps person ids, so a pre-merge pair key never
  // matches the post-merge one.
  const alreadyRejected = new Set(
    live(before.research)
      .filter((e) => rejectionFor(e.assertion_id, e.person_id, rejections(before.research)))
      .map((e) => e.id),
  );
  const priorPersonOf = new Map<string, string>(live(before.research).map((e) => [e.id, e.person_id]));
  const movedLinks = new Set(
    live(before.research).filter((e) => survivorOf.has(e.person_id)).map((e) => e.id),
  );
  const movedRejections = new Set(
    rejections(before.research)
      .filter((r) => typeof r?.person_id === "string" && survivorOf.has(r.person_id))
      .map((r) => r.id),
  );
  const lines: string[] = [];
  for (const e of live(after.research)) {
    const hit = rejectionFor(e.assertion_id, e.person_id, rejections(after.research));
    if (!hit || !(movedLinks.has(e.id) || movedRejections.has(hit.id))) continue;
    if (alreadyRejected.has(e.id)) continue;
    lines.push(
      `person_evidence '${e.id}' and rejection '${String(hit.id)}' would both stand on ` +
        `(${e.assertion_id}, ${e.person_id}) after this merge: the researcher rejected that pair, and the ` +
        `merge would leave a live link on it. The link stands today on ` +
        `(${e.assertion_id}, ${priorPersonOf.get(e.id) ?? e.person_id}).`,
    );
  }
  if (lines.length === 0) return [];
  return [
    ...lines,
    "Nothing was written, and no justification overrides this. Ask the researcher whether each listed " +
      "link's record is the person it stands on today. If they say it is not, have person-evidence record " +
      "their rejection of that pair, which retires the link, then merge again. Otherwise do not merge.",
  ];
}

/** Issue #2537: each live link the merge moves onto a survivor must pass the
 *  checks a `research_append` update re-pointing it there would: the
 *  contradiction cap, the move rule and the score gate's fabrication arm. Judged
 *  on the project after the merge (`after`: the remapped research and the merged
 *  tree), where the survivor holds both copies' facts. A birth place the lookup
 *  does not resolve is not a contradiction here, so a slow lookup cannot refuse
 *  a correct merge; a different country still is. A move is an update, not
 *  an append, so a link with no score is not asked for one; a scored link needs
 *  a `same_person` score recorded for the survivor. One line per finding, then
 *  the routing; `[]` when nothing is refused. */
export async function mergeLinkCheckRefusals(
  projectPath: string,
  before: { research: any },
  after: { research: any; tree: any },
  merges: ReadonlyArray<readonly [string, string]>,
  startingPersonIds?: ReadonlySet<string>,
): Promise<string[]> {
  const survivorOf = new Map<string, string>();
  for (const [s, c] of merges) survivorOf.set(c, s);
  // Before the early return below: a merge that moves only a rejection can
  // still land it on a pair the survivor links live.
  const rejectedPairs = mergeRejectedPairRefusals(before, after, survivorOf);
  if (rejectedPairs.length > 0) return rejectedPairs;
  const moved: Array<{ entry: any; from: string }> = [];
  for (const e of (before.research?.person_evidence ?? []) as any[]) {
    if (!e || e.superseded_by || typeof e.person_id !== "string") continue;
    const to = survivorOf.get(e.person_id);
    if (to) moved.push({ entry: { ...e, person_id: to }, from: e.person_id });
  }
  if (moved.length === 0) return [];

  const ops: ResearchAppendOp[] = moved.map(({ entry }) => ({
    section: "person_evidence",
    op: "update",
    entryId: entry.id,
    fields: { person_id: entry.person_id },
  }) as ResearchAppendOp);
  const batchAssertions = batchAssertionsById(after.research, []);
  const personLinks = batchPersonLinks(after.research, []);
  const birthPlaceCoords = await prefetchBirthPlaceCoords(after.research, ops, after.tree, personLinks, batchAssertions);
  const matchScores = new Map<string, MatchScoreFile>();
  for (const recordId of recordIdsForPersonEvidence(after.research, ops)) {
    const file = await readMatchScores(projectPath, recordId);
    if (file !== null) matchScores.set(recordId, file);
  }

  const lines: string[] = [];
  for (const { entry, from } of moved) {
    const findings = [
      ...coreIdentifierContradictionInvariants(entry, after.research, after.tree, personLinks, batchAssertions, birthPlaceCoords, true),
      ...unexplainedMoveInvariants(entry, after.research, after.tree, batchAssertions),
      ...personEvidenceScoreInvariants(
        entry, after.research, after.tree, matchScores, batchAssertions, false, startingPersonIds, new Set<string>(),
      ),
    ];
    for (const f of findings) {
      lines.push(`person_evidence '${entry.id}' would move from '${from}' to '${entry.person_id}' in this merge: ${f}`);
    }
  }
  if (lines.length === 0) return [];
  return [
    ...lines,
    "Nothing was written. A merge moves each link onto the survivor, so it must pass the checks a link written " +
      "there directly would. Before merging again, fix each listed link where it stands: record the same_person " +
      "score for the survivor, or have person-evidence lower the link or name its move_bridge. If the record " +
      "does not belong to the survivor, do not merge.",
  ];
}

/** Non-blocking nudge (issue #1478). Returns a warning when THIS call appended a
 *  source and the resulting project holds ≥THRESHOLD sources but zero assertions;
 *  null otherwise. Gated on a real (non-noop) `sources` append so it fires at the
 *  moment of sourcing and never nags an unrelated write in an already-imbalanced
 *  project, and self-silences the instant one assertion lands. The `op:"append"`
 *  gate covers the real reported shape: the composite `sourceDescription` persist
 *  requires exactly one `sources` append op, while a source-reuse fold converts it
 *  to `op:"update"` (which does not grow `sources.length`) and is correctly
 *  skipped. Tool-name neutral on purpose — it also fires for `extraction_append`
 *  (which routes through researchAppend), whose `record-extractor` caller is
 *  denied `research_append`, so it must not name a specific write tool. */
function sourcesWithoutAssertionsWarning(research: any, applied: AppliedOp[]): string | null {
  const appendedSource = applied.some(
    (a) => a.section === "sources" && a.op === "append" && !a.noop,
  );
  if (!appendedSource) return null;
  const sources = Array.isArray(research.sources) ? research.sources : [];
  const assertions = Array.isArray(research.assertions) ? research.assertions : [];
  if (assertions.length > 0 || sources.length < SOURCES_WITHOUT_ASSERTIONS_WARN_THRESHOLD) {
    return null;
  }
  return (
    `${sources.length} source(s) recorded but zero assertions drawn from them. ` +
    `Each source should support at least one assertion extracted from the record ` +
    `(a name, date, place, or relationship), or you should record why it could not. ` +
    `Append the assertions this evidence supports before continuing.`
  );
}

/** ADVISORY ONLY (issue #2256, folded into #2937): a `sources` entry that lands
 *  a non-empty `transcription` with no `image_filename` is worth a line saying
 *  where that text came from — a transcription is a claim about a page, and the
 *  page it came from is normally nameable.
 *
 *  **Never a refusal, and the reason matters.** Two legitimate shapes reach here
 *  with no filename: a PDF capture, and an `image_transcribe` run with no
 *  `projectPath` (nothing was staged, so there is no file to name); a full-text
 *  hit's source stores no page at all and is skipped. Refusing either would block correct work to catch a documentation gap, which is the
 *  wrong trade for a provenance nudge — `guardrail-enforcement-spec.md` marks it
 *  advisory in the instrument table for exactly that reason.
 *
 *  Returns one warning per offending entry, so a batch sourcing several records
 *  names each rather than collapsing to a count the caller cannot act on. Fires
 *  on `update` as well as `append`: a transcription added to an existing source
 *  by a later op is the same gap. Reads the persisted entry rather than the op's
 *  `fields`, so an update that sets only `transcription` is judged against the
 *  `image_filename` already on disk instead of re-warning about one that is
 *  there. */
function transcriptionWithoutImageWarnings(research: any, applied: AppliedOp[]): string[] {
  const sources = Array.isArray(research.sources) ? research.sources : [];
  const out: string[] = [];
  for (const a of applied) {
    if (a.section !== "sources" || a.noop) continue;
    const entry = sources.find((s: any) => s && s.id === a.entryId);
    if (!entry) continue;
    if (factText(entry.transcription) === undefined) continue;
    if (factText(entry.image_filename) !== undefined) continue;
    // A full-text hit's text is FamilySearch's own transcript: no page is stored
    // for it, so there is no filename to name.
    const logged = (Array.isArray(research.log) ? research.log : []).find((e: any) => e?.id === entry.log_entry_id);
    if (logged?.tool === "fulltext_search") continue;
    out.push(
      `source '${a.entryId}' records a transcription but no image_filename — name the ` +
        `page the text was read from, so a later reader can check it. The value is the ` +
        `stored image's filename, which image_read/image_transcribe return as ` +
        `\`imageRef\` when called with a projectPath. Leave it null only when there is ` +
        `genuinely no stored page (a PDF capture, or a transcribe run without a ` +
        `projectPath); this is advisory and nothing is blocked either way.`,
    );
  }
  return out;
}

/** Tier/exhaustiveness cross-field guardrail (docs/specs/guardrail-enforcement-spec.md
 *  §4.2). `proved`/`disproved` claim the research is reasonably exhaustive by
 *  definition, so either tier requires the referenced question's
 *  `search_stop.stopped_because` to already be a stop-gate value — checked against
 *  `preCallExhaustiveDeclared`, a snapshot taken BEFORE this call's ops began
 *  applying, never the live-mutating `research` object. Checking the live
 *  object would let one batch call both declare exhaustiveness and consume it
 *  for a tier in the same atomic write — `applyOne` mutates `research` in
 *  place per op, so an earlier op in the same batch has already "happened" by
 *  the time a later op in that batch is checked. This function only runs when
 *  the *current* op is the one setting/changing `tier` (see call site), so an
 *  unrelated update to an already-legitimately-proved entry (proved in an
 *  earlier, separate call) never re-triggers it. */
/**
 * A question may only be marked `resolved` once a proof summary exists for it.
 *
 * **Why this gate exists.** `status: "resolved"` is the orchestrator's stop
 * condition, and today it is a free write: neither `proof-conclusion` nor
 * `question-selection` claims it — each body explicitly points at the other —
 * so it lands in whichever skill happens to be running when the agent decides
 * it is done. Measured over 154 committed e2e runs: 150 questions reached
 * `resolved`, written from **11 different skill contexts**.
 *
 * **Why it reads `research` LIVE, unlike the sibling completion gates.** Those
 * snapshot before the call so a batch cannot satisfy its own precondition. That
 * discipline is right when the precondition must be met by a *different actor* —
 * the exhaustive-search declaration a proof summary needs is
 * research-exhaustiveness's to write, not something the proof's author may
 * append for itself in the same batch. Here
 * the summary and the resolve are two halves of one author's single conclusion,
 * and requiring separate calls would be friction with no safety gained.
 * Measured: 7 of 154 resolve-calls append the summary in the same batch, and all
 * 7 order the summary first — so a pre-call snapshot would refuse 7 correct
 * writes while live state refuses none.
 *
 * The general rule, worth stating once: **snapshot when the precondition must be
 * satisfied by someone else; read live when it is the same author's own prior
 * step.**
 *
 * **Both spellings of resolved are gated, deliberately.** A question carries a
 * `status` enum AND a `resolved` date, and gating only `status` left the date as
 * an ungated synonym: an agent refused here could write `resolved: "2026-01-02"`
 * with `status` untouched, and `project_context` would then report the question
 * resolved (`question-state.ts` reads `Boolean(question.resolved)`) while this
 * gate had never seen it. That is the shape ADR-0011 warns about — a blocked
 * agent improvises toward another route — and it is not hypothetical: the same
 * inconsistency is why the completion gate's `q.resolved === true` was dead.
 *
 * **Cost, measured before it was written: zero, on both arms.** Replayed over
 * the committed corpus: 142 writes set `status: "resolved"` and 4 set the date
 * alone; **none of the 146** would have been refused. All 150 questions that
 * reached `resolved` have a proof summary.
 *
 * Deliberately NOT gated here, because both would refuse real runs and a false
 * deny is the asymmetric risk: a prior exhaustive declaration (14 of 150 lack
 * one) and non-empty `resolution_assertion_ids` (9 of 150 are empty). Both are
 * surfaced advisorily by `project_context`'s `questionStatuses` instead.
 */
function questionResolvedInvariants(
  entry: any,
  research: any,
  beforeResearch?: any,
): string[] {
  const resolving = entry?.status === "resolved" || Boolean(entry?.resolved);
  if (!resolving) return [];
  const summaries = Array.isArray(research?.proof_summaries) ? research.proof_summaries : [];

  // A conclusion blocked by an unresolved conflict does not close its question.
  //
  // `not_proved` legitimately resolves a question that was researched and came
  // back empty — the message below says so. What it must not do is close a
  // question the researcher was PREVENTED from concluding: there the work is
  // unfinished, not finished-with-nothing. The two are told apart by the same
  // test the tier rule uses — does an open conflict dispute a source this
  // conclusion leans on. Conflicts read from the pre-call snapshot so a batch
  // cannot resolve one and spend it here; summaries read live so a summary
  // written earlier in the same batch counts.
  //
  // Observed 2026-08-21: correctly refused `probable`, correctly recorded
  // `not_proved`, correctly wrote no tree — and then marked the question
  // resolved anyway, closing a question whose evidence had never been
  // correlated.
  if (beforeResearch) {
    const disputed = disputedSourceIds(beforeResearch);
    const assertionSource = new Map<string, string>();
    for (const a of Array.isArray(beforeResearch?.assertions) ? beforeResearch.assertions : []) {
      if (a?.id && typeof a.source_id === "string") assertionSource.set(a.id, a.source_id);
    }
    const blocking = new Set<string>();
    for (const ps of summaries) {
      if (ps?.question_id !== entry?.id) continue;
      for (const aid of Array.isArray(ps?.supporting_assertion_ids) ? ps.supporting_assertion_ids : []) {
        const src = assertionSource.get(aid);
        for (const cid of (src ? disputed.get(src) : undefined) ?? []) blocking.add(cid);
      }
    }
    // Reaching the conflicts through the summary's cited assertions misses the
    // case that matters most: a `not_proved` summary citing NOTHING. Its
    // `supporting_assertion_ids` is empty, so the loop above finds nothing to
    // dispute and the question resolves straight over an open conflict -- which
    // is exactly what decision 12 says must not happen, and exactly the shape a
    // wrap-up produces. A conflict naming this question in `blocks_question_ids`
    // is blocking it by its own declaration, with no assertion needed -- so this
    // runs even when no source is disputed at all.
    for (const c of Array.isArray(beforeResearch?.conflicts) ? beforeResearch.conflicts : []) {
      if (isSettledConflict(c) || typeof c?.id !== "string") continue;
      const blocks = Array.isArray(c?.blocks_question_ids) ? c.blocks_question_ids : [];
      if (blocks.includes(entry?.id)) blocking.add(c.id);
    }
    if (blocking.size > 0) {
      return [
        `question ${entry?.id ?? "(no id)"} cannot be marked resolved while ` +
          `${[...blocking].sort().join(", ")} ${blocking.size === 1 ? "is" : "are"} ` +
          "unresolved: that conflict disputes evidence the conclusion relies on, so the " +
          "sources behind it have never been correlated. This is not the same as a question " +
          "researched and found empty, which `not_proved` does close — here the work is " +
          "unfinished rather than finished with nothing. Leave the question open and record the " +
          "attempt at the tier reached (`not_proved` when the conflict blocks identity), then " +
          (inConflictEnding(beforeResearch, entry?.id, [...blocking])
            ? CONFLICT_ENDING_MOVE
            : "invoke conflict-resolution; resolve it after."),
      ];
    }
  }

  if (summaries.some((s: any) => s?.question_id === entry?.id)) return [];
  return [
    `question ${entry?.id ?? "(no id)"} cannot be marked resolved (via \`status\` or the ` +
      "`resolved` date): no proof summary references it. A question is resolved by concluding " +
      "it — invoke proof-conclusion, which writes the proof_summaries entry carrying " +
      "question_id. A question closed with nothing found is still concluded: write a " +
      "`not_proved` summary saying so. If you are writing both in one batch, order the " +
      "proof_summaries append BEFORE this update.",
  ];
}

/** Sources an unresolved conflict disputes, from the PRE-CALL project state.
 *
 *  A conflict names the assertions that compete; each assertion names the
 *  source it came from. Those sources are the ones whose reliability is
 *  currently in question. A `moot` conflict disputes nothing: it is settled
 *  like a `resolved` one, so both refusals built on this name only conflicts
 *  that really are unresolved (issue #2359). */
function disputedSourceIds(research: any): Map<string, string[]> {
  const assertionSource = new Map<string, string>();
  for (const a of Array.isArray(research?.assertions) ? research.assertions : []) {
    if (a?.id && isLiveAssertion(a) && typeof a.source_id === "string") assertionSource.set(a.id, a.source_id);
  }
  const bySource = new Map<string, string[]>();
  for (const c of Array.isArray(research?.conflicts) ? research.conflicts : []) {
    if (!c || isSettledConflict(c)) continue;
    for (const aid of Array.isArray(c.competing_assertion_ids) ? c.competing_assertion_ids : []) {
      const src = assertionSource.get(aid);
      if (!src) continue;
      const seen = bySource.get(src) ?? [];
      if (!seen.includes(c.id)) seen.push(c.id);
      bySource.set(src, seen);
    }
  }
  return bySource;
}

// ─── A conflict resolved in prose must reach conflicts[] ─────────────────────
//
// A port of `find_unpersisted_conflict_resolutions` (eval/harness/harness/
// skill_invocation.py). The two must agree on every case in the shared case file,
// tests/guard-cases/unpersisted-conflict-resolution.json, which both planes replay
// (ADR-0011, "The bar is inspection, not a rate"). Keep the vocabulary below in
// step with the Python copy: the case file is what catches a divergence.

/** A stop-criterion carrying one of these says there was no conflict to persist. */
const NO_CONFLICT_SUBSTRINGS = [
  "no conflict",
  "no material conflict",
  "no remaining conflict",
  "no unresolved conflict",
  "no discrepanc",
  "without conflict",
  "no resolution",
];
/** Whole-field values (trimmed, lowercased) meaning the same, matched exactly. */
const NO_CONFLICT_EXACT = new Set(["", "none", "n/a", "na", "not applicable"]);
/** Positive resolution language. `\b` keeps `resolved` from matching inside `unresolved`. */
const RESOLUTION_MARKER_RE =
  /\b(resolv(?:ed|es|ing)|resolution|reconcil(?:ed|es|ing)|outweigh(?:s|ed|ing)?|adjudicated|preferred assertion)\b/i;
/** A stop-criterion opening by negating a resolution ("UNRESOLVED.", "Not met —"). */
const NON_RESOLUTION_OPENER_RE = /^[ \t\n\r\f\v]*(unresolved|not met|partial|partially met|n\/?a\b|not applicable|none)/i;
/** The one whitespace set both planes trim: JavaScript's `trim()` and Python's
 *  `strip()` remove different Unicode characters, and the planes must agree. */
const ASCII_EDGE_WHITESPACE_RE = /^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$/g;

/** The stop-criterion text when it claims a conflict was resolved, else null. */
function claimedConflictResolution(question: any): string | null {
  // New shape first; fall back to legacy for documents written before #2539.
  const cr =
    question?.search_stop?.stop_criteria?.conflict_resolution ??
    question?.exhaustive_declaration?.stop_criteria?.conflict_resolution;
  if (typeof cr !== "string") return null;
  const crl = cr.replace(ASCII_EDGE_WHITESPACE_RE, "").toLowerCase();
  if (NO_CONFLICT_EXACT.has(crl)) return null;
  if (NO_CONFLICT_SUBSTRINGS.some((s) => crl.includes(s))) return null;
  if (NON_RESOLUTION_OPENER_RE.test(crl)) return null;
  if (!RESOLUTION_MARKER_RE.test(crl)) return null;
  return cr;
}

const conflictKey = (value: unknown): string | null =>
  typeof value === "string" && value !== "" ? value.toLowerCase() : null;

/** A `proof_summaries` write whose question's
 *  `search_stop.stop_criteria.conflict_resolution` claims a conflict
 *  was resolved, while `conflicts[]` holds no record of it — the resolution lives
 *  only in prose, the viewer's Conflicts section is blank, and every conflict
 *  gate here passes vacuously because each one iterates the array that was never
 *  written. research-append-tool-spec.md §5.
 *
 *  Backed, and allowed, when: a settled (`resolved`/`moot`) conflict is cited on
 *  this summary's `resolved_conflict_ids` or names this question in its
 *  `blocks_question_ids`; a `c_` id the stop-criterion names exists in
 *  `conflicts[]` at any status; or the prose names no id and `conflicts[]` holds
 *  any entry. The question is "was it persisted", not "was it resolved": a
 *  recorded but open conflict is not this miss, and `proof-conclusion` is told to
 *  write a `not_proved` summary in exactly that state. Ids compare
 *  case-insensitively.
 *
 *  Scoped to the entry being written and its own question, never every summary
 *  in the document, so one violating summary does not refuse every later write.
 *  Reads the LIVE document for both halves: the requirement is that the record
 *  is PRESENT, and a pre-call snapshot would refuse the very call that supplies
 *  a same-batch `questions` update. Not tier-gated: most violations stand at
 *  `probable`/`possible`, so a `proved`-only gate would reach almost none.
 *
 *  What it knowingly lets through (ADR-0011 limit 1). The reliance signal is a
 *  text heuristic over one prose field: a stop-criterion containing "no
 *  conflicts remain" is read as "there was no conflict", even beside a
 *  resolution sentence. The same makes rewording the stop-criterion a way to
 *  launder the refusal, which is why the message never suggests it. When the
 *  prose names no `c_` id, ANY `conflicts[]` entry backs it — an open conflict,
 *  or one about another question — so in a multi-question project one recorded
 *  conflict turns this off for every id-less resolution claim; the harness rule
 *  before graduation required a resolved one. And a
 *  resolution-claiming stop-criterion written AFTER the summary is not caught,
 *  because the `questions` write is not gated here; in every committed run that
 *  fires, the declaration was written first. */
export function unpersistedConflictResolutionInvariants(entry: any, research: any): string[] {
  if (!entry || typeof entry !== "object") return [];
  const qid = entry.question_id;
  if (qid === undefined || qid === null || qid === "") return [];
  const questions = Array.isArray(research?.questions) ? research.questions : [];
  const question = questions.find((q: any) => q && typeof q === "object" && q.id && q.id === qid);
  if (!question) return [];
  const claimed = claimedConflictResolution(question);
  if (claimed === null) return [];

  const conflicts = Array.isArray(research?.conflicts) ? research.conflicts : [];
  const recorded = new Set<string>();
  const settled = new Set<string>();
  const settledBlocked = new Set<unknown>();
  for (const c of conflicts) {
    if (!c || typeof c !== "object") continue;
    const key = conflictKey(c.id);
    if (key) recorded.add(key);
    if (isSettledConflict(c)) {
      if (key) settled.add(key);
      for (const q of Array.isArray(c.blocks_question_ids) ? c.blocks_question_ids : []) settledBlocked.add(q);
    }
  }
  const cited = Array.isArray(entry.resolved_conflict_ids) ? entry.resolved_conflict_ids : [];
  const named = new Set([...claimed.matchAll(/\bc_\d+\b/gi)].map((m) => m[0].toLowerCase()));
  const backed =
    cited.some((rc: unknown) => {
      const key = conflictKey(rc);
      return key !== null && settled.has(key);
    }) ||
    settledBlocked.has(qid) ||
    [...named].some((id) => recorded.has(id)) ||
    (named.size === 0 && recorded.size > 0);
  if (backed) return [];

  const quote = claimed.length > 300 ? `${claimed.slice(0, 300)}…` : claimed;
  const missing =
    named.size > 0
      ? `it names ${[...named].join(", ")}, which conflicts[] does not hold`
      : "conflicts[] is empty";
  return [
    `proof_summaries ${entry.id ?? "(new entry)"}: question ${qid}'s ` +
      `search_stop.stop_criteria.conflict_resolution says a conflict was resolved — ` +
      `"${quote}" — but conflicts[] holds no record of it (${missing}). A resolution that lives ` +
      `only in prose never reaches the Conflicts section, and no conflict gate can see it. ` +
      `Record the conflict and its resolution with conflict-resolution, the only writer of ` +
      `conflicts[] (from an agent, hand back to the main thread and name it), then cite the ` +
      `settled c_ id on this summary's resolved_conflict_ids and send this write again.`,
  ];
}

/** A conclusion may not out-tier the reliability of the sources it rests on.
 *
 *  **Correlation presupposes identity** (lead ruling, 2026-08-19). When an
 *  unresolved conflict disputes an assertion drawn from a source the summary
 *  also relies on, the sources have not been established as describing the
 *  same person — so they cannot be correlated at ANY tier above `not_proved`.
 *  Tiering down does not repair it, because tiering happens *after* identity
 *  is settled, not instead of it.
 *
 *  The worked case: a birthplace conflict on a parentage question reads as
 *  "collateral" — different fact, so seemingly harmless. But the death
 *  certificate disputing the birthplace was also the only DIRECT evidence of
 *  parentage, so the dispute impeached the very correlation the conclusion
 *  rested on. Prose could not hold this: told in its own body that birthplace
 *  is an identifying attribute, the agent still recorded the conflict
 *  "non-blocking — it doesn't touch identity" and concluded at `probable`,
 *  across five successive wordings.
 *
 *  Read from the PRE-CALL snapshot, the same discipline the exhaustiveness
 *  gate uses: a batch may not resolve a conflict and spend that resolution on
 *  a tier in the same call. `not_proved` is always available — recording the
 *  blocked attempt is the sanctioned move, not silence. */
function conflictedSourceInvariants(entry: any, beforeResearch: any): string[] {
  const tier = entry?.tier;
  if (typeof tier !== "string" || tier === "not_proved" || tier === "disproved") return [];
  const disputed = disputedSourceIds(beforeResearch);
  if (disputed.size === 0) return [];

  const assertionSource = new Map<string, string>();
  for (const a of Array.isArray(beforeResearch?.assertions) ? beforeResearch.assertions : []) {
    if (a?.id && typeof a.source_id === "string") assertionSource.set(a.id, a.source_id);
  }
  const supporting = Array.isArray(entry?.supporting_assertion_ids)
    ? entry.supporting_assertion_ids
    : [];
  const hits = new Map<string, string[]>();
  for (const aid of supporting) {
    const src = assertionSource.get(aid);
    const conflicts = src ? disputed.get(src) : undefined;
    if (src && conflicts) hits.set(src, conflicts);
  }
  if (hits.size === 0) return [];

  const shared = [...hits.keys()].sort();
  const blocking = [...new Set([...hits.values()].flat())].sort();
  const ending = inConflictEnding(beforeResearch, entry?.question_id, blocking);
  return [
    `tier '${tier}' is not available while ${blocking.join(", ")} ` +
      `${blocking.length === 1 ? "is" : "are"} unresolved: ` +
      `${blocking.length === 1 ? "that conflict disputes" : "those conflicts dispute"} ` +
      `evidence from ${shared.join(", ")}, which this conclusion also relies on. ` +
      "Correlating sources assumes they describe the same person, and that is " +
      "what the open conflict puts in question — so no tier above `not_proved` " +
      "is reachable, and tiering down to `possible` does not repair it. Record " +
      (ending
        ? "the attempt at `not_proved`, naming the conflict, then " + CONFLICT_ENDING_MOVE
        : "the attempt at `not_proved`, naming the conflict and what would settle it, then " +
          "invoke conflict-resolution. Re-conclude by updating that same summary once the " +
          "conflict is resolved."),
  ];
}

const CONFLICT_ENDING_MOVE =
  "give the summary `shortfall: \"conflict\"` and stop there: conflict-resolution has " +
  "already weighed every log entry and found nothing left to search, so invoking it " +
  "again would weigh the same evidence again.";

/** Whether a refusal over unresolved conflicts meets section E's ending, where
 *  invoking conflict-resolution again weighs the same evidence again. Read with
 *  the ladder's own predicate, and only when every conflict the refusal names
 *  was itself found searched out over the log it covers now: a conflict on a
 *  cited source that blocks another question may never have been weighed, or
 *  that question may have been searched since. */
function inConflictEnding(research: any, questionId: unknown, conflictIds: string[]): boolean {
  const question = (Array.isArray(research?.questions) ? research.questions : []).find(
    (q: any) => q?.id === questionId,
  );
  const conflicts = Array.isArray(research?.conflicts) ? research.conflicts : [];
  const weighed = conflictIds.every((id) => {
    const c = conflicts.find((x: any) => x?.id === id);
    if (!Array.isArray(c?.weighed_log_entry_ids)) return false;
    const stamped = new Set(c.weighed_log_entry_ids);
    return conflictCoverageLogIds(research, c).every((logId) => stamped.has(logId));
  });
  return Boolean(question) && weighed && unsettledConflictEnding(research, question);
}

/** One conclusion per question — the manifest's own rule, now enforced.
 *
 *  `docs/specs/schemas/ownership.json` has required this since the manifest
 *  landed ("never more than one summary per `question_id`") and nothing checked
 *  it. Observed 2026-08-20: told by another precondition that it could not
 *  conclude at `probable`, the agent recorded a correct `not_proved` summary —
 *  by APPENDING it, leaving the stale `probable` entry beside it. The project
 *  then carried two contradictory conclusions for one question, and the newer,
 *  correct one did not win: every reader that scans `proof_summaries` for a
 *  question sees both.
 *
 *  Re-concluding is legitimate and common; it is an `update` of the existing
 *  `ps_NNN`, never a second append. The message names the id so the caller can
 *  retry as an update without a lookup. */
function oneSummaryPerQuestion(entry: any, research: any, appendedId: string | undefined): string[] {
  const qid = entry?.question_id;
  if (typeof qid !== "string" || qid === "") return [];
  const existing = (Array.isArray(research?.proof_summaries) ? research.proof_summaries : []).filter(
    (ps: any) => ps?.question_id === qid && ps?.id !== appendedId,
  );
  if (existing.length === 0) return [];
  const ids = existing.map((ps: any) => ps?.id).filter(Boolean);
  return [
    `question '${qid}' already has a proof summary (${ids.join(", ")}), and a question may ` +
      "carry only one. Re-concluding is an UPDATE of that entry, not a second append: retry " +
      `with { section: "proof_summaries", op: "update", entryId: "${ids[0]}", fields: { … } }, ` +
      "passing only the fields that changed — but if the question has been searched since the " +
      "summary was written, `narrative_markdown` and `exhaustive_search_summary` count as one, so " +
      "pass both or neither. Appending here would leave two contradictory " +
      "conclusions on one question, with nothing to say which is current.",
  ];
}

/** A summary's narrative and its `exhaustive_search_summary` are rewritten
 *  together once the question has been searched since the summary was written.
 *
 *  Both say what was searched and what could still resolve the question, so a
 *  later search that changes one changes the other. Observed 2026-10-09 (issue
 *  #3177, G9GJ-959): after three more searches, `ps_002`'s summary was rewritten
 *  to report them and its narrative's "What could resolve it" was left
 *  recommending all three, while `ps_001` got the reverse — a new narrative over
 *  a summary still calling the same images "Not completed". The re-invocation
 *  rule said to pass only the fields that changed, and each update did.
 *
 *  Scoped to that case: a one-field update is refused only when a `log[]` entry
 *  attributed to the summary's question (through a plan item of one of its
 *  plans) was performed after the summary's pre-op `updated` stamp. In section
 *  E's ending the question's owned entries count instead, so the upload that
 *  closes a hand-off counts too, and an update sending neither field goes to
 *  `staleEndingRefresh`; both read the live research's questions, plans and
 *  conflicts. With no later search, a one-field edit — a tier change with a
 *  reworded narrative — is ordinary and passes. A summary with no `updated`
 *  predates the stamp and is never refused. `log` is not a `research_append`
 *  section, so live and pre-call research carry the same log.
 *
 *  Update-only: an append already requires both. Passing a field's current
 *  text again satisfies it — the point is that the caller re-checked it. */
function narrativeAndSearchSummaryTogether(
  op: any,
  entry: any,
  priorUpdated: unknown,
  research: any,
): string[] {
  if (op?.op !== "update") return [];
  const fields = op.fields ?? {};
  const has = (k: string) => Object.prototype.hasOwnProperty.call(fields, k);
  const narrative = has("narrative_markdown");
  const summary = has("exhaustive_search_summary");
  if (narrative && summary) return [];
  const since = typeof priorUpdated === "string" ? datetimeMs(priorUpdated) : NaN;
  if (Number.isNaN(since)) return [];
  const qid = entry?.question_id;
  if (typeof qid !== "string" || qid === "") return [];
  if (!narrative && !summary) return staleEndingRefresh(op, qid, priorUpdated, research);
  // In section E's ending the ladder counts an upload as a search, so the
  // rule does too: a refresh that ends the research must cover it.
  const question = (Array.isArray(research?.questions) ? research.questions : []).find(
    (q: any) => q?.id === qid,
  );
  const itemIds = new Set<string>();
  for (const plan of Array.isArray(research?.plans) ? research.plans : []) {
    if (plan?.question_id !== qid) continue;
    for (const item of Array.isArray(plan.items) ? plan.items : []) {
      if (typeof item?.id === "string") itemIds.add(item.id);
    }
  }
  const entries =
    question && unsettledConflictEnding(research, question)
      ? questionOwnedLogEntries(research, qid)
      : (Array.isArray(research?.log) ? research.log : []).filter(
          (e: any) => e && itemIds.has(e.plan_item_id),
        );
  const later = entries
    .filter((e: any) => e && typeof e.performed === "string" && datetimeMs(e.performed) > since)
    .map((e: any) => e.id ?? "(no id)");
  if (later.length === 0) return [];
  const [set, missing] = narrative
    ? ["narrative_markdown", "exhaustive_search_summary"]
    : ["exhaustive_search_summary", "narrative_markdown"];
  return [
    `proof_summaries update of ${op.entryId ?? "(no entryId)"} sets \`${set}\` without ` +
      `\`${missing}\`, and question ${qid} has been searched since this summary was last ` +
      `written (${later.join(", ")}). Both fields say what was searched and what could still ` +
      "resolve the question, so read those log entries, rewrite both, and pass both in this one " +
      `update. A small change to either can go in \`edits\` rather than re-sending the field. If ` +
      `\`${missing}\` is still accurate after you check it against them, pass its current text ` +
      "unchanged. Leaving one stale is how a narrative ends up recommending records its own " +
      "summary says were searched.",
  ];
}

/** Section E: an update that sends neither text field leaves `updated` where it
 *  was (`restampOn`), so in the ending a summary older than the question's
 *  latest search would stay older on every pass and the ladder would send the
 *  question back to proof-conclusion forever. There, the refresh must rewrite
 *  the text. "Older" is the ladder's own test (`endsOnConflict`), so an upload
 *  counts as a search; outside the ending a field-only update is ordinary. */
function staleEndingRefresh(op: any, qid: string, priorUpdated: unknown, research: any): string[] {
  const question = (Array.isArray(research?.questions) ? research.questions : []).find(
    (q: any) => q?.id === qid,
  );
  if (!question || !unsettledConflictEnding(research, question)) return [];
  const lastSearched = questionLastSearchedMs(research, qid);
  if (endsOnConflict({ shortfall: "conflict", updated: priorUpdated }, lastSearched)) return [];
  return [
    `proof_summaries update of ${op.entryId ?? "(no entryId)"} sends neither ` +
      "`narrative_markdown` nor `exhaustive_search_summary`, but question " +
      `${qid} has been searched since this summary was last written, and it is ending on an ` +
      "unsettled conflict. The summary ends the research only once it is rewritten over that " +
      "evidence: read the newer log entries, rewrite both fields, and pass both in this update " +
      "with `shortfall: \"conflict\"`.",
  ];
}

/** A `proof_summaries` write when the persons this proof bears on — its
 *  `claims[].relationship.child` entries (when `claims[]` is present; scalar
 *  proofs with no `claims[]` are not in scope, as assertions carry no
 *  `relationship` field) — have more than two distinct `ParentChild` parents in
 *  the pre-call tree, while fewer than two hypotheses in `preCallResearch` list
 *  the proof's `question_id` in `related_question_ids`.
 *
 *  Uses the pre-call tree and pre-call research snapshots so a same-batch
 *  hypothesis write does not satisfy the precondition. */
export function competingParentSetsInvariants(
  entry: any,
  preCallResearch: any,
  tree: any,
): string[] {
  const tier = entry?.tier;
  if (typeof tier === "string" && (tier === "not_proved" || tier === "disproved")) return [];

  const qid = entry?.question_id;
  if (typeof qid !== "string" || qid === "") return [];

  // In-scope: only persons whose parentage this proof is actually concluding.
  // Claims-based proofs: persons named as a child in a ParentChild claim.
  // Scalar proofs (no claims[]) are not in scope — assertions have no
  // `relationship` field, so there is no reliable way to derive the child
  // person id from supporting_assertion_ids alone.
  // Subject_person_ids alone is too broad — it includes parents and siblings,
  // causing false refusals on children/marriage proofs where the subject happens
  // to have a data-quality tree issue unrelated to the question.
  const extraPersonIds = new Set<string>();
  for (const c of Array.isArray(entry.claims) ? entry.claims : []) {
    if (c?.relationship?.type === "ParentChild" && typeof c.relationship.child === "string") {
      extraPersonIds.add(c.relationship.child);
    }
  }
  if (extraPersonIds.size === 0) return [];

  const competing = competingParentSets(preCallResearch, tree, qid, new Set(), extraPersonIds);
  if (competing.length === 0) return [];

  const details = competing
    .map(({ personId, parentIds }) => `${personId} (${parentIds.join(", ")})`)
    .join("; ");
  return [
    `proof_summaries ${entry.id ?? "(new entry)"}: question ${qid} has persons with competing ` +
      `parent sets — ${details} — but fewer than two hypotheses in hypotheses[] list "${qid}" in ` +
      `related_question_ids. Decline to conclude; name hypothesis-tracking as the next step.`,
  ];
}

/** A conclusion above `not_proved` may not rest on evidence no identity decision
 *  has touched: refused when none of the summary's supporting assertions carries
 *  a live `person_evidence` link that is not speculative (`countsForProofGate`)
 *  in the pre-call document. A speculative link is a candidate, not an identity,
 *  and an unchecked FamilySearch attachment is always speculative.
 *
 *  None, not all. A household record leaves its children and wife unlinked once
 *  the subject is linked, so an all-linked rule would refuse 27 of 211 committed
 *  e2e proofs. This rule refuses 5 of 206 (re-counted 2026-10-20). 3 come from
 *  runs with no live link at all (chresten-nielsen-daughter 2026-08-09,
 *  victoriano-macatangay-parents 2026-08-13 ×2): the identity step never run,
 *  the case worth refusing. LZJF-J13 (issue #3177) concluded `probable` on
 *  "correlation across several independent entries" with 0 of 15 assertions
 *  linked. The other 2 rest on speculative links only (cruz-corona-ancestry
 *  ps_001 proved, robert-lord-children ps_001 disproved).
 *
 *  Pre-call snapshot, as the conflict gates: a batch may not supply the link and
 *  spend it on a tier in the same call. `person_evidence` is written by
 *  person-evidence and, for unchecked attachments only, by extraction_append —
 *  never by the agent writing the proof. */
export function unlinkedProofInvariants(entry: any, preCallResearch: any): string[] {
  const tier = entry?.tier;
  if (typeof tier !== "string" || tier === "not_proved") return [];
  const known = new Set(
    (Array.isArray(preCallResearch?.assertions) ? preCallResearch.assertions : []).map((a: any) => a?.id),
  );
  const supporting = (Array.isArray(entry?.supporting_assertion_ids) ? entry.supporting_assertion_ids : []).filter(
    (id: unknown) => typeof id === "string" && known.has(id),
  );
  if (supporting.length === 0) return [];
  const linked = new Set(
    (Array.isArray(preCallResearch?.person_evidence) ? preCallResearch.person_evidence : [])
      .filter(countsForProofGate)
      .map((pe: any) => pe?.assertion_id),
  );
  if (supporting.some((id: string) => linked.has(id))) return [];
  return [
    `proof_summaries ${entry.id ?? "(new entry)"}: tier '${tier}' rests on ${supporting.length} ` +
      `supporting assertion(s), and none is linked to a person in person_evidence by a link that ` +
      `is not speculative (a speculative link is a candidate, not an identity). A conclusion ` +
      `correlates records about the same person, and no identity decision says these records ` +
      `are about anyone. Run person-evidence on those assertions first (from an agent, hand back ` +
      `to the main thread and name it), then send this write again. Recording the attempt at ` +
      `'not_proved' is allowed now.`,
  ];
}

const GRANDPARENT_ROLES = new Set(["father_of_mother", "mother_of_mother", "father_of_father", "mother_of_father"]);

/** The parent side a record role names: `father`, `mother` or `parent`, read as
 *  an underscore-delimited token because `record_role` is an open enum
 *  (`father_of_deceased`, `mother_of_child_1`, `groom_father`, …). Grandparents,
 *  godparents and in-laws are not the subject's parents. */
export function parentSide(role: unknown): "father" | "mother" | "parent" | null {
  if (typeof role !== "string") return null;
  const r = role.toLowerCase();
  if (GRANDPARENT_ROLES.has(r) || /grand|god|in_law/.test(r)) return null;
  const tokens = r.split("_");
  for (const side of ["father", "mother", "parent"] as const) {
    if (tokens.includes(side)) return side;
  }
  return null;
}

/** A conclusion above `not_proved` may not rest on a parent nobody identified:
 *  refused when a parent side the summary cites has no cited parent-role
 *  assertion carrying a live, non-speculative `person_evidence` link
 *  (`countsForProofGate`) in the pre-call document.
 *
 *  A side is cited by a parent-role assertion, or by an UNLINKED assertion whose
 *  `structured_value.related_person_role` is a parent role ("child of William
 *  Barker"), so dropping the parent's own assertions from the citation does not
 *  evade it. A linked "child of" assertion cites nothing: its parent is usually
 *  identified on another record, and counting it refused 26 legitimate e2e proofs.
 *
 *  Per side, not per persona: proof-conclusion's gate is satisfied per person, so
 *  the father linked as `father_of_bride` on the marriage satisfies his unlinked
 *  `father` persona on the baptism. A linked `parent` assertion satisfies either
 *  side, and either side satisfies `parent`. Over the 251 committed proofs above
 *  `not_proved` it refuses 5; one is a known false refusal (in-laws' fathers cited
 *  as negative evidence), accepted because the rule cannot tell whose father a
 *  role names without a tree lookup. Mined from MHGK-WT7 (#3659): `probable`
 *  naming William Barker and Martha Edwards with every parent assertion unlinked. */
export function unlinkedParentProofInvariants(entry: any, preCallResearch: any): string[] {
  const tier = entry?.tier;
  if (typeof tier !== "string" || tier === "not_proved" || tier === "disproved") return [];
  const byId = new Map<string, any>(
    (Array.isArray(preCallResearch?.assertions) ? preCallResearch.assertions : [])
      .filter((a: any) => typeof a?.id === "string")
      .map((a: any) => [a.id, a]),
  );
  const cited = [
    ...(Array.isArray(entry?.supporting_assertion_ids) ? entry.supporting_assertion_ids : []),
    ...(Array.isArray(entry?.claims) ? entry.claims : []).flatMap((c: any) =>
      Array.isArray(c?.supporting_assertion_ids) ? c.supporting_assertion_ids : [],
    ),
  ].filter((id: unknown, i: number, all: unknown[]) => typeof id === "string" && byId.has(id) && all.indexOf(id) === i);
  const linked = new Set(
    (Array.isArray(preCallResearch?.person_evidence) ? preCallResearch.person_evidence : [])
      .filter(countsForProofGate)
      .map((pe: any) => pe?.assertion_id),
  );

  const citing = new Map<string, string[]>();
  const satisfied = new Set<string>();
  for (const id of cited as string[]) {
    const a = byId.get(id);
    const side = parentSide(a?.record_role);
    if (side) {
      citing.set(side, [...(citing.get(side) ?? []), id]);
      if (linked.has(id)) satisfied.add(side);
    }
    const related = a?.structured_value && typeof a.structured_value === "object"
      ? parentSide(a.structured_value.related_person_role)
      : null;
    if (related && !linked.has(id)) citing.set(related, [...(citing.get(related) ?? []), id]);
  }
  const ok = (side: string) =>
    satisfied.has(side) ||
    (side === "parent" && (satisfied.has("father") || satisfied.has("mother"))) ||
    (side !== "parent" && satisfied.has("parent"));
  const unsatisfied = [...citing].filter(([side]) => !ok(side));
  if (unsatisfied.length === 0) return [];
  const detail = unsatisfied.map(([side, ids]) => `${side} (${ids.join(", ")})`).join("; ");
  return [
    `proof_summaries ${entry.id ?? "(new entry)"}: tier '${tier}' cites a parent no identity ` +
      `decision has identified — ${detail} — and none of the cited parent assertions on that side ` +
      `is linked to a person in person_evidence, so nobody has decided who that parent is. ` +
      `Removing these ids from supporting_assertion_ids or a claim and sending the write again ` +
      `does NOT fix this: a conclusion that still names, relies on or encodes that parent is the ` +
      `same unproved parentage with its evidence hidden. Do one of: (1) run person-evidence on ` +
      `those assertions first (from an agent, hand back to the main thread and name it), then ` +
      `send this write again with the ids still cited; (2) record the attempt at 'not_proved' ` +
      `now; (3) only if the question does not ask who the parents are, rewrite the conclusion ` +
      `so it no longer states or depends on who that parent is, and create no tree person or ` +
      `ParentChild relationship for them.`,
  ];
}

const PARENTAGE_FINDING =
  /\b(?:(?:the\s+)?(?:son|daughter|child)\s+of|(?:his|her|their)\s+(?:father|mother|parents)\s+(?:was|were|is|are)|born\s+to)\b/gi;

/** A record as the subject of a verb reporting what it says: "the index records
 *  Jonathan, son of William". The verb alone is not enough: "the evidence shows",
 *  "given the correlation" and "United States" open findings, not record reports. */
const RECORD_REPORTING =
  /\b(?:register|index|entry|record|certificate|census|transcript(?:ion)?|abstract|image|page)s?\s+(?:\w+\s+){0,2}?(?:reads?|reading|records?|recording|shows?|showing|lists?|listing|names?|naming|gives?|giving|states?|stating|describes?|describing|calls?|calling|transcribes?|transcribing)\b/i;

/** Quoted record text says what a record reads, not what the proof concludes. */
function stripQuoted(text: string): string {
  return text
    .replace(/"[^"\n]*"|“[^”\n]*”/g, " ")
    .replace(/(^|[\s(])'[^'\n]+'(?=[\s.,;:)]|$)/g, "$1 ");
}

/** A conclusion above `not_proved` may not STATE a parent nobody identified.
 *
 *  `unlinkedParentProofInvariants` reads the citation, so dropping the parent's
 *  assertions from it passes. This reads the prose: refused when the narrative
 *  or a claim asserts parentage ("the son of", "his parents were", "born to")
 *  naming, within the sentence, the given name of a parent who appears in an
 *  unlinked parent-role name assertion on a record the summary cites, and no
 *  name assertion linked (live, not speculative) to anyone but the subject
 *  carries that name: a namesake son's own name does not identify his father. Quoted record text is ignored, and so is a phrase whose sentence reports
 *  a record before it ("the index records Jonathan, son of William"): a proof
 *  may report what a record reads, as may "the christening of a Jonathan, son of
 *  William". The parent must be the SUBJECT's, the person most of the cited,
 *  linked assertions are about: a bare `father` when the subject is linked on
 *  that record, `father_of_bride` when the bride is (mcaloney-mother states the
 *  mother's own parents, which concludes nothing about the subject). An
 *  appositive with no reporting verb ("born
 *  at Whitehaven, son of William Barker") is a finding, and is refused. So is
 *  "the daughter of a different István", which sets a family aside rather than
 *  naming a parent (rozal-sarman-daughter, the one false refusal measured).
 *  Mined from ut_proof_conclusion_32f (#3659), which failed 3/3 with the ids
 *  dropped and "the son of William Barker … and Martha Edwards" in the prose. */
export function unlinkedParentNarrativeInvariants(entry: any, preCallResearch: any): string[] {
  const tier = entry?.tier;
  if (typeof tier !== "string" || tier === "not_proved" || tier === "disproved") return [];
  const assertions: any[] = Array.isArray(preCallResearch?.assertions) ? preCallResearch.assertions : [];
  const byId = new Map<string, any>(assertions.filter((a) => typeof a?.id === "string").map((a) => [a.id, a]));
  const claims: any[] = Array.isArray(entry?.claims) ? entry.claims : [];
  const cited = [
    ...(Array.isArray(entry?.supporting_assertion_ids) ? entry.supporting_assertion_ids : []),
    ...claims.flatMap((c: any) => (Array.isArray(c?.supporting_assertion_ids) ? c.supporting_assertion_ids : [])),
  ];
  const records = new Set(cited.map((id: unknown) => byId.get(id as string)?.record_id).filter((r) => typeof r === "string"));
  if (records.size === 0) return [];
  const personOf = new Map<string, string>(
    (Array.isArray(preCallResearch?.person_evidence) ? preCallResearch.person_evidence : [])
      .filter((pe: any) => countsForProofGate(pe) && typeof pe?.person_id === "string")
      .map((pe: any) => [pe.assertion_id, pe.person_id]),
  );
  const linked = new Set(personOf.keys());
  // The subject: the person most of the cited, linked assertions are about.
  const counts = new Map<string, number>();
  for (const id of cited) {
    const p = personOf.get(id as string);
    if (p) counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  const subject = [...counts].sort((x, y) => y[1] - x[1])[0]?.[0];
  if (!subject) return [];
  // Whose parent a role names: `father_of_bride` and `groom_father` the named
  // party's, a bare `father` or `mother_1` the record's principal's.
  const isSubjectsParent = (a: any) => {
    const role = String(a.record_role).toLowerCase();
    const party = /^(?:father|mother|parent)_of_(.+)$/.exec(role)?.[1] ?? /^(.+)_(?:father|mother|parent)$/.exec(role)?.[1];
    return assertions.some(
      (b) =>
        b?.record_id === a.record_id &&
        personOf.get(b.id) === subject &&
        (party ? String(b.record_role).toLowerCase() === party : !parentSide(b.record_role)),
    );
  };
  const nameOf = (a: any) => {
    const sv = a?.structured_value;
    const given = sv && typeof sv === "object" && typeof sv.given === "string" ? sv.given.trim() : "";
    const surname = sv && typeof sv === "object" && typeof sv.surname === "string" ? sv.surname.trim() : "";
    return { given, surname };
  };
  const identified = assertions
    .filter((a) => a?.fact_type === "name" && linked.has(a.id) && personOf.get(a.id) !== subject)
    .map(nameOf);
  const isIdentified = (n: { given: string; surname: string }) =>
    identified.some(
      (m) =>
        m.given.toLowerCase() === n.given.toLowerCase() &&
        (!m.surname || !n.surname || m.surname.toLowerCase() === n.surname.toLowerCase()),
    );
  const unidentified = new Map<string, string[]>();
  for (const a of assertions) {
    if (a?.fact_type !== "name" || linked.has(a.id) || !records.has(a.record_id) || !parentSide(a.record_role)) continue;
    if (!isSubjectsParent(a)) continue;
    const n = nameOf(a);
    if (n.given.length < 2 || isIdentified(n)) continue;
    unidentified.set(n.given, [...(unidentified.get(n.given) ?? []), a.id]);
  }
  if (unidentified.size === 0) return [];

  const texts = [
    typeof entry?.narrative_markdown === "string" ? entry.narrative_markdown : "",
    ...claims.map((c: any) => (typeof c?.claim === "string" ? c.claim : "")),
  ];
  const named = new Map<string, string[]>();
  for (const text of texts) {
    const prose = stripQuoted(text);
    for (const m of prose.matchAll(PARENTAGE_FINDING)) {
      const rest = prose.slice(m.index! + m[0].length, m.index! + m[0].length + 160);
      const sentence = rest.split(/\.\s|\n/)[0];
      if (/^\s*[*_]*(?:a|an|another|some)\b/i.test(sentence)) continue;
      const before = prose.slice(0, m.index!);
      const opening = before.slice(Math.max(before.lastIndexOf(". "), before.lastIndexOf("\n")) + 1);
      if (RECORD_REPORTING.test(opening)) continue;
      // "the christening of a Jonathan, son of William": a record's child, not the subject.
      if (/\b(?:a|an)\s+[A-Z][\w'’-]*,?\s*$/.test(opening)) continue;
      for (const [given, ids] of unidentified) {
        const escaped = given.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        if (new RegExp(`\\b${escaped}\\b`, "i").test(sentence)) named.set(given, ids);
      }
    }
  }
  if (named.size === 0) return [];
  const detail = [...named].map(([given, ids]) => `${given} (${ids.join(", ")})`).join("; ");
  return [
    `proof_summaries ${entry.id ?? "(new entry)"}: tier '${tier}' states as a finding that the ` +
      `subject is the child of a parent no identity decision has identified — ${detail} — and no ` +
      `name assertion for that parent is linked to a person in person_evidence. Do one of: ` +
      `(1) run person-evidence on those assertions first (from an agent, hand back to the main ` +
      `thread and name it), then send this write again; (2) record the attempt at 'not_proved' ` +
      `now; (3) if the question does not ask who the parents are, remove the parentage from the ` +
      `conclusion: the narrative may quote what a record reads ("child of William Barker") but ` +
      `may not state "the son of", "his parents were" or "born to" that parent.`,
  ];
}

/** A question's `status` may not claim an exhaustiveness that its stop decision
 *  does not carry.
 *
 *  **Why both spellings need gating.** `status: "exhaustive_declared"` is what
 *  every downstream reader treats as "GPS Component 1 is satisfied", and
 *  `search_stop.stopped_because` being a gate value is the record that backs it.
 *  The harness has asserted one direction since the validator shipped —
 *  `test_declared_implies_exhaustive_declared_status`, gate value ⟹ status — and
 *  nothing has ever asserted the other, which is the direction that leaves a
 *  question looking finished with no stop decision behind it.
 *
 *  **Reads the MERGED entry, deliberately.** `applyOne` shallow-merges `fields`
 *  before invariants run, so `entry.search_stop` is "set by this op,
 *  or already gate-valued from an earlier call" — exactly the live read ADR-0011
 *  prescribes when the precondition is the same author's own prior step. A
 *  pre-call snapshot would refuse the 123 corpus writes that declare and set the
 *  status in one op, which is the common and correct shape.
 *
 *  **A zero-violation arm, and named as one.** Replayed over 157 committed e2e
 *  runs: 125 ops set this status and none of them would be refused. It ships as
 *  a cheap invariant closing a reachable hole — `search_stop` is a required
 *  question property so it is always present, and corpus writes use non-gate
 *  `stopped_because` values — not as a gate with demonstrated catches. Its test
 *  vector is synthetic for that reason. */
function declarationStatusInvariants(entry: any): string[] {
  if (entry?.status !== "exhaustive_declared") return [];
  if (isStopGateSatisfied(entry)) return [];
  const sb = getStoppedBecause(entry);
  return [
    `status 'exhaustive_declared' requires search_stop.stopped_because to be a stop-gate value ` +
      `('question_answered', 'record_exhausted', or 'nothing_further_reachable') on ` +
      `question '${entry?.id}', and it is ` +
      `${sb === null ? "absent or null" : JSON.stringify(sb)}. ` +
      "That status is what every later reader treats as GPS Component 1 satisfied, so it may " +
      "not stand without the stop decision that backs it. Set both in this call, or leave the " +
      "status alone: an honest early termination sets stopped_because to a non-gate value and " +
      "keeps `status: \"in_progress\"`.",
  ];
}

/** Exhaustiveness may not be declared while the question's own plan says a
 *  search is still running.
 *
 *  **A bookkeeping gate, not a doctrine one** (lead ruling, 2026-08-23). It
 *  second-guesses no genealogical judgment — it only refuses a declaration that
 *  contradicts the project's own plan state, which is why it can be scoped this
 *  tightly. The classification no longer buys an exemption from anything:
 *  ADR-0011 retired the overridable-doctrine tier on 2026-08-24 and NO gate
 *  carries an override. What still bites is the route: measured 2026-08-23, no
 *  skill can move a plan item out of `in_progress` on the FamilySearch path, so
 *  a researcher who believes the search is done had no way to say so. Since
 *  issue #3516, `extraction_append` completes an item once a record its
 *  `record_search` found is extracted; an item whose searches all found
 *  nothing still waits on research-plan's Dispose.
 *
 *  **`planned` BLOCKS, decided 2026-10-05 on issue #1830.** It did not until
 *  then. Dallan's `c78efb0b7` (#1847, 23 August) put "`planned` does NOT block"
 *  here and the #1843 ruling shipped it, both resting on a skip having nowhere
 *  to record its reason — the same ruling deferred the skip-reason field to
 *  #1830 because it was a schema change. `skip_category` is that field, so the
 *  premise lapsed and the ruling with it.
 *
 *  What decided it was not the vote. Six genealogists chose this and none chose
 *  otherwise, but their shared argument — an unexplained leftover cannot be told
 *  from a forgotten one — was already written in the skill bodies as prose, and
 *  across 199 committed e2e runs it produced 38 leftover `planned` items and
 *  ZERO recorded reasons. A rule with no compliance in prose belongs at the
 *  write boundary. The decision, the case against it and the conditions it
 *  ships under are on issue #1830.
 *
 *  The orchestrator still consults this gate BEFORE the plan is drained
 *  (`research/SKILL.md:146`, unchanged): the judgement stays here, and only the
 *  route taken on a refusal changed, to dispose of the named items rather than
 *  extend the plan. Were disposal to happen first, the planner would be making
 *  this gate's call for it.
 *
 *  **Reads the PRE-CALL snapshot, unlike the sibling above, and the asymmetry is
 *  the whole gate.** Plan-item completion is the search work's step, not this
 *  writer's: `docs/specs/schemas/ownership.json` lists six permitted writers of
 *  `plan_items` and `research-exhaustiveness` is not among them. So the
 *  precondition must be satisfied by someone else, which is exactly ADR-0011's
 *  snapshot condition. Read live it would be self-satisfying — measured, three
 *  corpus calls batch the item flips ahead of the declaration in one op list,
 *  including `antonio-lucas-spouse`, the run issue #1335 was filed from. Live,
 *  this refuses 2 of 170; snapshotted, 5.
 *
 *  Matching is on `plans[].question_id`; a plan attached to another question is
 *  not evidence about this one. All 205 corpus plans carry the field, so the
 *  looser reading that also counts unattached plans is indistinguishable today —
 *  it is pinned here and by a synthetic test rather than by the corpus. */
function planCompleteInvariants(entry: any, preCallResearch: any): string[] {
  if (!isStopGateSatisfied(entry)) return [];
  const qid = entry?.id;
  if (typeof qid !== "string" || qid === "") return [];
  // Of `plan_item_status`'s four, the two that are not disposed. Derived from
  // the enum rather than listed so a status added later blocks by default: this
  // gate should not wave through an item whose disposition it has never heard
  // of, and a block here is recoverable — the plan's owner disposes of it —
  // where a silent pass is the exhaustive declaration #1830 exists to stop.
  const blocking = activePlanItems(
    preCallResearch,
    (plan) => plan.question_id === qid,
    [...VALIDATOR_ENUMS.plan_item_status].filter((s) => s !== "completed" && s !== "skipped"),
  );
  const inFlight = blocking.filter((i) => i.status === "in_progress").map((i) => i.itemId);
  const undisposed = blocking.filter((i) => i.status === "planned").map((i) => i.itemId);
  if (inFlight.length === 0 && undisposed.length === 0) return [];

  // Both arms name the blocking items and stop. Neither tells the caller to
  // change a status: the exhaustiveness agent holds `questions` and no
  // `plan_items` write, so a refusal naming an action it cannot take names a
  // locked door — which `guard_project_files.py`'s OWNER_REASON records as the
  // thing that produces bypasses. Pinned by "the refusal names no plan_items
  // action". Disposal is the plan owner's, reached through research/SKILL.md's
  // route for a refused declaration.
  const clauses: string[] = [];
  if (inFlight.length > 0) {
    const ids = inFlight.sort().join(", ");
    clauses.push(
      `${ids} ${inFlight.length === 1 ? "is" : "are"} still 'in_progress' — the plan says that ` +
        "search has not finished, so the declaration would rest on work still running",
    );
  }
  if (undisposed.length > 0) {
    const ids = undisposed.sort().join(", ");
    const one = undisposed.length === 1;
    clauses.push(
      `${ids} ${one ? "is" : "are"} still 'planned' — ${one ? "it has" : "they have"} not been ` +
        `disposed of, so the record cannot say whether ${one ? "it was" : "they were"} answered ` +
        `by what you already hold or simply never run (#1830)`,
    );
  }
  return [
    `question '${qid}' cannot be declared exhaustive while ${clauses.join("; and ")}. ` +
      `Report ${inFlight.length + undisposed.length === 1 ? "this item" : "these items"} as the ` +
      "blocker and hand back; the plan's owner disposes of what is left, and declaring is " +
      "available on the next call once the plan reflects it.",
  ];
}

/** Every item on an ACTIVE plan the predicate accepts whose status is in
 *  `statuses`, read from the given snapshot. Shared by the in-flight gates so
 *  which plans and items count is decided once.
 *
 *  `statuses` defaults to `in_progress` alone. No caller takes that default any
 *  more: `planCompleteInvariants` passes `planned` too (issue #1830) -- an
 *  undisposed item leaves the record unable to say whether it was answered by
 *  what is already held or simply never run -- and the new-question gate passes
 *  `PLAN_ITEM_OUTSTANDING`, every status but `completed` and `skipped`, because
 *  step mode's rule is about a question with work left rather than work running.
 *  The two gates ask different questions of the same plan, so the status set is
 *  the caller's. */
export function activePlanItems(
  research: any,
  includePlan: (plan: any) => boolean,
  statuses: readonly string[] = ["in_progress"],
): { itemId: string; planId: string; questionId: unknown; status: string }[] {
  const found: { itemId: string; planId: string; questionId: unknown; status: string }[] = [];
  for (const plan of Array.isArray(research?.plans) ? research.plans : []) {
    if (!plan || !includePlan(plan)) continue;
    // ONLY the active plan blocks, and this is what keeps the gate escapable.
    // `research-plan` supersedes a plan by flipping `plans.status` alone — its
    // items keep whatever status they held — and then forbids touching it ever
    // again ("Never modify a superseded plan — it is part of the audit trail").
    // So a question re-planned while one item sat `in_progress` carries that
    // item forever. Blocking on it would make the declaration permanently
    // unwritable: the exhaustiveness agent may not reach `plan_items`, the
    // search skills may not edit a superseded plan, and no other route exists.
    // That is the unrecoverable false deny ADR-0011's first limit exists to
    // prevent, and it costs nothing to avoid — a superseded or completed plan
    // is not the plan the question is being worked from.
    if (plan.status !== "active") continue;
    for (const item of Array.isArray(plan.items) ? plan.items : []) {
      if (typeof item?.id !== "string" || typeof item?.status !== "string") continue;
      if (statuses.includes(item.status)) {
        found.push({ itemId: item.id, planId: plan.id, questionId: plan.question_id, status: item.status });
      }
    }
  }
  return found;
}

/** Statuses that mean a question is still being worked: every one but
 *  `resolved`. Derived, not listed, so a status added later blocks by default —
 *  the safe direction, and the one the enum lint asks for. */
const QUESTION_STILL_OPEN = new Set(
  [...VALIDATOR_ENUMS.question_status].filter((s) => s !== "resolved"),
);

/** Plan-item statuses that mean the item is still to do: every one but
 *  `completed` and `skipped`. Derived for the same reason. */
const PLAN_ITEM_OUTSTANDING = [...VALIDATOR_ENUMS.plan_item_status].filter(
  (s) => s !== "completed" && s !== "skipped",
);

/** The same rule for a batch: `newQuestionWhileAnotherIsOpenInvariants` below
 *  reads the pre-call snapshot, so a question appended by an EARLIER op of this
 *  call is invisible to it, and one `ops` batch could open several questions
 *  at once (decision 4: one question per run). Any question in the working
 *  document that the snapshot lacks, other than this op's own, was opened in
 *  this call and blocks this one. */
function secondQuestionInOneCallInvariants(entry: any, research: any, preCallResearch: any): string[] {
  const before = new Set<string>(
    (Array.isArray(preCallResearch?.questions) ? preCallResearch.questions : [])
      .map((q: any) => q?.id)
      .filter((id: unknown): id is string => typeof id === "string"),
  );
  const openedThisCall = (Array.isArray(research?.questions) ? research.questions : [])
    .map((q: any) => q?.id)
    .filter((id: unknown): id is string => typeof id === "string" && !before.has(id) && id !== entry?.id);
  if (openedThisCall.length === 0) return [];
  return [
    `a new question cannot be opened while another is still open: ${openedThisCall.sort().join(", ")} ` +
      "was opened earlier in this same call. Open one question at a time: write the first, " +
      "and offer the next one when the first is concluded.",
  ];
}

/** A new question may not be opened while another question is still open.
 *
 *  Step mode (decision 25, section E) replaces the older in-flight gate, which
 *  keyed on `plan_items` standing at `in_progress`. That gate let a second
 *  question start whenever the first happened to have no running item — between
 *  two steps, or before planning had begun — so "one question at a time" held
 *  only by accident of timing. This keys on the QUESTION, which is the thing
 *  the rule is actually about.
 *
 *  **The one exemption: a question with a proof summary and nothing left to do.**
 *  proof-conclusion can conclude a question and still have to leave it open — an
 *  identity conflict at `not_proved` (`agents/proof-conclusion.md:144-150`) —
 *  and such a question must not lock the project against every new one. Both
 *  halves are needed: E's own route can hand a concluded question fresh searches
 *  (conflict-resolution, then research-plan), and while those are open a second
 *  question waits, exactly as the old gate required of an in-flight item.
 *
 *  **A `resources_spent` stop does not unlock the project.** The "not
 *  exhaustive" choice writes one, and admitting a new question there would leave
 *  the old one unconcluded without the researcher ever being asked. The refusal
 *  is what sends that case to the wrap-up offer, which is the point: a wrap-up
 *  DOES unlock the project, because dispose closes every open item and
 *  proof-conclusion writes the summary.
 *
 *  An item waiting only on an upload does not count as work in progress
 *  (section I): the researcher is the blocker there, and the question would
 *  otherwise be locked by a hand-off nobody can close from inside the project.
 *
 *  Decidable from the documents alone — `questions[].status`,
 *  `proof_summaries[].question_id`, `plans[].items[].status` and `log[]` — so
 *  ADR-0011 puts it here rather than in a skill body.
 */
function newQuestionWhileAnotherIsOpenInvariants(_entry: any, preCallResearch: any): string[] {
  const concluded = new Set<string>(
    (Array.isArray(preCallResearch?.proof_summaries) ? preCallResearch.proof_summaries : [])
      .map((summary: any) => summary?.question_id)
      .filter((id: unknown): id is string => typeof id === "string"),
  );
  const waitingOnUpload = awaitingUploadItemIds(preCallResearch?.log);
  const blocking: string[] = [];
  for (const question of Array.isArray(preCallResearch?.questions) ? preCallResearch.questions : []) {
    if (typeof question?.id !== "string" || !QUESTION_STILL_OPEN.has(question.status)) continue;
    const outstanding = activePlanItems(
      preCallResearch,
      (plan) => plan.question_id === question.id,
      PLAN_ITEM_OUTSTANDING,
    ).filter((item) => !waitingOnUpload.has(item.itemId));
    if (concluded.has(question.id) && outstanding.length === 0) continue;
    blocking.push(
      outstanding.length === 0
        ? `${question.id} (${question.status}, no proof summary)`
        : `${question.id} (${question.status}, ${outstanding.map((i) => i.itemId).sort().join(", ")} still to do)`,
    );
  }
  if (blocking.length === 0) return [];
  return [
    `a new question cannot be opened while another is still open: ${blocking.sort().join("; ")}. ` +
      "Write no question now. Report which question is open and offer to wrap it up: a wrap-up " +
      "disposes its remaining items and writes its proof summary, which is what frees the " +
      "project for the next question. The one question that does NOT block is one that already " +
      "has a proof summary and no `planned` or `in_progress` item left on its active plan — a " +
      "conclusion that had to leave the question open, such as an identity conflict at " +
      "`not_proved`. A `resources_spent` search stop is not a conclusion and does not unlock it.",
  ];
}

/** A `fan_pivot` question exists to advance a question whose direct evidence
 *  ran out, so its `unblocks` must name a question still open in the pre-call
 *  snapshot. Decidable from `questions[]` alone (ADR-0011). Every committed e2e
 *  `fan_pivot` append that left `unblocks` empty (3 of 4) depended on an open
 *  `q_001` it would have advanced. */
function fanPivotUnblocksInvariants(entry: any, preCallResearch: any): string[] {
  if (entry?.selection_basis !== "fan_pivot") return [];
  const open = (Array.isArray(preCallResearch?.questions) ? preCallResearch.questions : [])
    .filter((q: any) => typeof q?.id === "string" && QUESTION_STILL_OPEN.has(q.status))
    .map((q: any) => q.id as string);
  const unblocks = Array.isArray(entry?.unblocks) ? entry.unblocks : [];
  if (unblocks.some((id: unknown) => typeof id === "string" && open.includes(id))) return [];
  return [
    "a `fan_pivot` question must name in `unblocks` the open question whose direct evidence ran out" +
      (open.length > 0 ? ` (open: ${open.sort().join(", ")})` : " — no question is open, so there is none to pivot from") +
      ". Its family, associates and neighbors are researched to advance that question.",
  ];
}

/** A plan item may not stand at `completed` unless some `log[]` entry carries
 *  its id in `plan_item_id`. Completing an item asserts the search it names was
 *  done; the log is where a search is recorded, so an item completed with
 *  nothing attributed to it claims work no part of the document evidences.
 *
 *  Both halves — `plan_items[].status` and `log[].plan_item_id` — live in
 *  `research.json`, so ADR-0011's first question ("decidable from the documents
 *  alone?") answers yes and the rule belongs here rather than in a skill body.
 *  It is not stated in one: the three bodies that instruct the completed write
 *  document the satisfying call shape (`planItemId: "pli_NNN"`) without stating
 *  the rule, which is why an eval reviewer left the analogous check
 *  report-only. That reading was reversed by the 2026-09-22 ruling now recorded
 *  in ADR-0011's "Rulings that generalize".
 *
 *  **Reads LIVE research, and the choice is provably free.** `log` is not a
 *  `research_append` section — it is absent from `SECTIONS` above, and
 *  `ownership.json` gives it to `research_log_append` alone, which is
 *  append-only — so no op in a batch can change `log[]` and the live document
 *  and the pre-call snapshot carry an identical `log`. Live is what ADR-0011's
 *  "same author's own prior step" asks for anyway: `research_log_append`
 *  persists before `research_append` is called in every satisfying corpus run.
 *
 *  **An append carrying `status: "completed"` is always refused.** The id is
 *  assigned by this tool, so no log entry can already name it. That is not a
 *  false deny — it is the same defect in a different shape. Measured at
 *  4791ea9cb, the corpus holds 1 such append in the unit plane and 4 in e2e.
 *
 *  Forward direction only: the entry must END at `completed`. An item already
 *  sitting there when an unrelated field is edited is untouched, the same
 *  discipline as the `questions` and `hypotheses` arms. */
function planItemLogAttributionInvariants(
  entry: any,
  research: any,
  isAppend = false,
): string[] {
  if (entry?.status !== "completed") return [];
  const pid = entry?.id;
  // Guarded for shape rather than assumed: this fires BEFORE document
  // validation, so a hand-edited research.json can reach it with the id absent
  // — the same reason the terminal-plan deny guards `parent.status`. An item
  // with no id is the document validator's problem, not this rule's.
  if (typeof pid !== "string" || pid === "") return [];
  // `e &&`: a legacy `log: [null]` must not take the writer down — the same
  // guard planActiveInvariants and hypothesisSupportedInvariants carry.
  const named = (Array.isArray(research?.log) ? research.log : []).some(
    (e: any) => e && e.plan_item_id === pid,
  );
  if (named) return [];
  // The remedy names a move the agent can actually make. `research_log_append`
  // only appends — every op allocates `nextLogId`, there is no update op — so
  // an entry already written with `planItemId: null` cannot be re-attributed,
  // and telling the agent to "fix the log entry" would be an instruction it
  // cannot follow. `planItemId: null` is itself a legitimate documented shape
  // for an ad-hoc browse, so the message says which of the two it got wrong.
  //
  // The second clause resolves the case where the search WAS already logged
  // unattributed (review-ready ruling 2026-09-22): the item stays
  // `in_progress`. Re-logging writes a durable duplicate that every reader of
  // `log[]` counts twice; `skipped` states the search was not done, which is
  // false. An open item misstates nothing.
  //
  // An APPEND gets its own remedy. Its id is assigned inside this call, so "log
  // it with planItemId first" is impossible, and `in_progress` is the one status
  // that blocks the question's exhaustive declaration. `planned` is wrong too:
  // search-records runs the next planned item, which would repeat the search.
  // A search already done is cited where the declaration reads it instead.
  if (isAppend) {
    return [
      `plan_items[${pid}]: an appended item cannot arrive 'completed' — its id is assigned in ` +
        `this call, so no log[] entry can name it. Don't add a plan item for a search that ` +
        `was already done: cite that search's log id in the question's ` +
        `search_stop.log_entry_ids when you declare. If the search has not been ` +
        `done yet, append the item as 'planned', then complete it after logging the search ` +
        `with research_log_append({ planItemId: "<its id>", ... }).`,
    ];
  }
  return [
    `plan_items[${pid}]: no log[] entry names ${pid}, so completing it would claim a search ` +
      `nothing in the document records. Log the search that satisfies this item with ` +
      `research_log_append({ planItemId: "${pid}", ... }) before completing it — ` +
      `planItemId: null is only for an ad-hoc search that matches no plan item. If that ` +
      `search was already logged with planItemId: null, leave this item 'in_progress' ` +
      `rather than logging the same search twice.`,
  ];
}

/**
 * Starter vocabulary per plan-item `record_type`: the terms whose presence in an
 * attributed `log[]` entry's tool/notes/query confirms the completing search
 * touched this record type. **Ported verbatim from the eval validator
 * `RECORD_TYPE_TERMS` in `eval/harness/validators/test_search_full_text.py`; the
 * two planes must agree — change both or neither.** A `record_type` absent here
 * gets the structural check (`planItemLogAttributionInvariants`) only, never a
 * content assertion it has no vocabulary for.
 */
const RECORD_TYPE_TERMS: Record<string, readonly string[]> = {
  probate: [
    // No bare "estate": it is land in "real estate" (American) and in
    // British/Irish estate records, so it passed the deed/land note this guard
    // exists to refuse. The specific terms below carry probate without it (#3592).
    "executor", "executrix", "administrator", "administratrix",
    "appraise", "appraisement", "inventory", "bequeath", "testament",
    "heir", "legatee", "probate",
  ],
  church: ["baptism", "baptismal", "christen", "confirmation", "burial"],
  church_record: ["baptism", "baptismal", "christen", "confirmation", "burial"],
  vital: ["birth", "death", "marriage"],
  vital_record: ["birth", "death", "marriage"],
  marriage: ["marriage", "wedding", "banns", "matrimon"],
  census: ["census", "household", "dwelling", "enumerat"],
  naturalization: ["naturaliz", "declaration of intent"],
  obituary: ["obituary", "death notice"],
};

/**
 * A plan item with a vocabulary-bearing `record_type` may not stand at
 * `completed` unless some `log[]` entry attributed to it names a search of THAT
 * record type. Completing a probate item off a deed/land search — the
 * `ut_search_full_text_016`/`_020` shape, deep-dive #1651 finding 3 — claims
 * probate work no part of the document evidences.
 *
 * This is the CONTENT half of the completion check; `planItemLogAttributionInvariants`
 * is the STRUCTURAL half (some entry must name the item at all). The two never
 * double-report: when nothing is attributed this returns [] and leaves the
 * refusal to that gate; a `record_type` outside `RECORD_TYPE_TERMS` gets the
 * structural check only. Keyed to the same trigger as that gate (the entry ends
 * at `completed`) and reads the same LIVE `research.log` for the same reason —
 * `log[]` is append-only and owned by `research_log_append`, so the live
 * document and the pre-call snapshot carry an identical log.
 *
 * Mirrors the eval validator `test_plan_item_completion_matches_its_own_record_type`,
 * including its haystack (each attributed entry's `tool`, `notes` and JSON-
 * serialized `query`, lowercased). Decidable from `research.json` alone
 * (ADR-0011's first question), so it is a writer-tool precondition rather than
 * the agent-body prose it was first diagnosed as (#3592).
 */
export function planItemCompletionRecordTypeInvariants(entry: any, research: any): string[] {
  if (entry?.status !== "completed") return [];
  const pid = entry?.id;
  if (typeof pid !== "string" || pid === "") return [];
  const terms = RECORD_TYPE_TERMS[String(entry?.record_type ?? "").toLowerCase()];
  if (!terms) return []; // record_type outside the starter table — structural check only
  const attributed = (Array.isArray(research?.log) ? research.log : []).filter(
    (e: any) => e && e.plan_item_id === pid,
  );
  if (attributed.length === 0) return []; // planItemLogAttributionInvariants' job, not this one's
  const haystack = attributed
    .map((e: any) => `${e.tool ?? ""} ${e.notes ?? ""} ${JSON.stringify(e.query ?? {})}`)
    .join(" ")
    .toLowerCase();
  // Leading word-boundary only (`\bterm`), not `\bterm\b`: several terms are
  // deliberate stems (`naturaliz`, `enumerat`, `christen`, `appraise`) and
  // need to match plurals (`baptism`→"baptisms"), which a trailing boundary
  // would miss; the leading boundary still rejects a substring inside a word
  // ("their" ≠ `heir`). The eval validator uses the same rule (#3592).
  if (terms.some((t) => new RegExp(`\\b${t}`).test(haystack))) return [];
  return [
    `plan_items[${pid}]: record_type '${entry.record_type}', but no log[] entry attributed to it ` +
      `names a ${entry.record_type} search — none mentions any of ` +
      `${terms.map((t) => `'${t}'`).join(", ")}. Completing it would claim a ${entry.record_type} ` +
      `search the document does not record. Run and log the ${entry.record_type} search this item ` +
      `calls for with research_log_append({ planItemId: "${pid}", ... }) before completing it, or ` +
      `skip it with a skip_category if that search will not be done.`,
  ];
}

// A plan item whose external-site search is still awaiting a capture must not
// be marked terminal (`completed`/`skipped`): search-external-sites cannot
// search a paywalled site — it hands the user a URL and waits for a PDF — so a
// terminal status claims a search that did not happen, and
// research-exhaustiveness then declares the question exhaustively researched.
// Decidable from research.json alone (ADR-0011's first question), so it is a
// writer-tool precondition rather than the SKILL.md Step-6 prose that did not
// bind it: with that prose in place the search-records run still drifted to
// `skipped` on 1 of 3 samples (#1226; #2484).
//
// Mirrors the eval guard `assert_capture_pending_item_not_terminal`
// (validators_lib.py): the LATEST log entry naming the item decides, across
// every tool — a later FamilySearch hit or any positive non-link search closes
// it, so an older external-site handoff further up the log is not how it ended.
// A capture that arrived is a later entry, and step 6 does not carry
// `planItemId` onto it, so an arrival is matched on `(site, url_generated)`
// (which every external-site entry carries) under this item's id or a null one.
//
// Two documented `skipped` paths are exempt (`CAPTURE_PENDING_SKIP_EXEMPT`):
// `search-external-sites.md` step 4 tells the agent to mark an external-site
// item `skipped` when no user is present to make the capture or the site cannot
// be reached (`inaccessible`), or when the user asked to skip it
// (`user_declined`). Refusing those denies the skill's own instruction, and the
// "leave it in_progress" remedy would stall an autonomous run — exhaustiveness
// will not declare while an item is `in_progress` (EdmondOware review,
// 2026-10-14). `completed` is never exempt (it claims the search happened), and
// a `skipped` with any other category — the `ut_search_records_026` escalation
// shape, where a real user capture is still outstanding — is still refused.
const CAPTURE_PENDING_SKIP_EXEMPT = new Set(["inaccessible", "user_declined"]);

export function planItemCapturePendingInvariants(entry: any, research: any): string[] {
  if (entry?.status !== "completed" && entry?.status !== "skipped") return [];
  if (entry?.status === "skipped" && CAPTURE_PENDING_SKIP_EXEMPT.has(entry?.skip_category)) {
    return [];
  }
  const pid = entry?.id;
  // Guarded for shape rather than assumed — fires before document validation,
  // the same reason planItemLogAttributionInvariants guards its id.
  if (typeof pid !== "string" || pid === "") return [];
  const log = Array.isArray(research?.log) ? research.log : [];
  let latest: any = null;
  const captured = new Set<string>();
  for (const e of log) {
    if (!e) continue; // a legacy `log: [null]` must not take the writer down
    const tool = e.tool;
    if (
      e.plan_item_id === pid &&
      (tool === "external_site" ||
        (e.outcome === "positive" && tool !== "external_links_search"))
    ) {
      latest = e;
    }
    if (tool === "external_site") {
      const d = e.external_site || {};
      if (d.capture_received === true && d.site && d.url_generated) {
        captured.add(JSON.stringify([e.plan_item_id ?? null, d.site, d.url_generated]));
      }
    }
  }
  if (!latest || latest.tool !== "external_site") return [];
  const site = latest.external_site || {};
  if (site.capture_received === true) return [];
  if (
    captured.has(JSON.stringify([pid, site.site, site.url_generated])) ||
    captured.has(JSON.stringify([null, site.site, site.url_generated]))
  ) {
    return [];
  }
  return [
    `plan_items[${pid}]: its latest external-site search (${latest.id}) is still awaiting a ` +
      `capture (capture_received=false), so marking it '${entry.status}' claims a paywalled ` +
      `search that has not happened — research-exhaustiveness would then read the question as ` +
      `exhaustively searched. The way through: if no user can make the capture or the site ` +
      `cannot be reached, skip it with skip_category: "inaccessible"; if the user asked to skip ` +
      `it, skip_category: "user_declined"; otherwise leave it 'in_progress' until the capture ` +
      `arrives as a later log entry (or re-plan). See #1226.`,
  ];
}

/** The search tools whose log entry, tied to a plan item, means the item's
 *  search ran. An image browse logs `image_search`; a volume lookup or one page
 *  read is not the item's search. */
const SEARCH_THAT_RAN = new Set(["record_search", "fulltext_search", "image_search"]);

/** A search that ran is never marked skipped (lead, 2026-10-20, issue #3516).
 *  `skipped` says nothing was searched, and research-exhaustiveness reads a
 *  disposed item as settled, so a skip after a search misstates the record. A
 *  searched item is `completed` instead, which passes attribution because the
 *  search's entry names the item. An `error` entry is not a search that ran,
 *  and an external hand-off counts only once its capture arrived.
 *
 *  **Exemption 1: the deferred external hand-off.** search-records runs
 *  three nil searches, then hands the item to search-external-sites, which,
 *  with no user present to capture, logs a deferred entry and skips the item
 *  `inaccessible`. `completed` is refused there by capture-pending, so refusing
 *  the skip too would leave the item `in_progress` for good and the question
 *  undeclarable (lead, 2026-10-20). So wherever capture-pending would refuse
 *  `completed`, this rule stays silent and capture-pending answers alone: it
 *  lets an `inaccessible` or `user_declined` skip stand, and refuses any other
 *  category with a message naming those two. Capture-pending itself decides
 *  which entry is latest, so the two rules cannot disagree.
 *
 *  **Exemption 2: the wrong record type.** Wherever the completion record-type
 *  check would refuse `completed` (no attributed search names the item's
 *  record type), this rule is silent too, so the skip is the item's exit (#3592). */
export function planItemSearchedSkipInvariants(entry: any, research: any): string[] {
  if (entry?.status !== "skipped") return [];
  const pid = entry?.id;
  if (typeof pid !== "string" || pid === "") return [];
  const log = Array.isArray(research?.log) ? research.log : [];
  const ran = log.find(
    (e: any) =>
      e &&
      e.plan_item_id === pid &&
      ((SEARCH_THAT_RAN.has(e.tool) && e.outcome !== "error") ||
        (e.tool === "external_site" && e.external_site?.capture_received === true)),
  );
  if (!ran) return [];
  if (planItemCapturePendingInvariants({ ...entry, status: "completed" }, research).length > 0) return [];
  // Record-type escape hatch (mirrors the capture-pending one above): if the
  // item cannot be completed because its searches are all the wrong record type
  // (planItemCompletionRecordTypeInvariants would refuse), then skipping is the
  // honest exit — otherwise it deadlocks at 'in_progress', neither completable
  // nor skippable (the stuck state #3682's dispose flow removed). #3592.
  if (planItemCompletionRecordTypeInvariants({ ...entry, status: "completed" }, research).length > 0) return [];
  return [
    `plan_items[${pid}]: ${ran.id} (${ran.tool}, ${ran.outcome}) shows this item's search ran, ` +
      `so it cannot be marked 'skipped', which says nothing was searched. Set it to 'completed' ` +
      `instead: ${ran.id} names this item, so the completion is attributed.`,
  ];
}

/** A plan item names one place (`compoundJurisdictionError`). Checked on an
 *  append and on a change to `jurisdiction` only, so a compound item written
 *  before this rule does not strand an unrelated edit. */
function compoundJurisdictionInvariants(item: any, research: any): string[] {
  const localities = Array.isArray(research?.localities) ? research.localities : [];
  const error = compoundJurisdictionError(item ?? {}, localities);
  return error ? [`plan_items[${item?.id ?? "(new)"}]: ${error}`] : [];
}

/** The seven `skip_category` values, for the refusal message. Kept as a literal
 *  rather than read from the schema: the validator already enforces membership,
 *  and what this list is for is telling the agent what to pick. */
const SKIP_CATEGORIES =
  "answered, inaccessible, no_coverage, fallback_not_triggered, out_of_scope, " +
  "premise_invalidated, user_declined";

/** A `skipped` item must say WHY it was skipped, and must not say it in
 *  `rationale`.
 *
 *  Why this is a writer precondition and not prose (ADR-0011's first question):
 *  it is decidable from the entry alone. Six skills may write a plan item's
 *  status, so a prose rule would have to be repeated in six bodies and would
 *  bind in none of them reliably; the tool covers all six at once and cannot be
 *  argued with.
 *
 *  Without it, `skipped` is a way to satisfy the exhaustiveness gate without
 *  searching: the gate treats `completed`-or-`skipped` as a disposed item, and
 *  a bare `skipped` tells it nothing about whether the source was ever reached.
 *  Once every new skip carries a category, the gate has something to read —
 *  which is why the gate itself was NOT changed to treat a missing value as
 *  "not searched" (lead ruling 2026-09-30). Existing projects carry bare
 *  `skipped` items that will never gain one, and `research-exhaustiveness` is
 *  not a permitted writer of `plan_items`, so a question blocked that way would
 *  have no route to repair — the unrecoverable false deny ADR-0011's first
 *  limit exists to prevent.
 *
 *  The `rationale` clause is the other half of the same defect. `rationale`
 *  means why the item was PLANNED and is required; with nowhere else to put it,
 *  the model was observed rewriting it with the skip reason, destroying the
 *  planning record to store something `skip_reason` now holds.
 */
function planItemSkipInvariants(
  item: any,
  fields: Record<string, unknown>,
  isAppend: boolean,
  storedRationale?: unknown,
): string[] {
  const pid = item?.id ?? "(new)";
  const errors: string[] = [];
  if (item?.status === "skipped" && !item?.skip_category) {
    errors.push(
      `plan_items[${pid}]: status 'skipped' needs a skip_category saying why, or the ` +
        `exhaustiveness gate cannot tell a source you decided against from one you could ` +
        `not reach. Pick one of: ${SKIP_CATEGORIES}. Put the detail in skip_reason — not ` +
        `in rationale, which records why the item was planned.`,
    );
  }
  // Narrowed to a SKIP deliberately, not every status move. The defect is the
  // model folding the skip reason into `rationale` for want of anywhere else,
  // and `skip_reason` is the place to send it instead — so on a skip the
  // refusal names a remedy. On a `completed` or `in_progress` move there is no
  // such field, so the same refusal would be a deny with no route out, which is
  // the false deny ADR-0011's first limit exists to prevent. Re-wording the
  // rationale while completing an item is a documented, legitimate edit
  // (`(d4-logattr) ACCEPTS an update re-sending status: completed …`).
  //
  // It fires on a CHANGED rationale, not merely a present one. An agent that
  // re-sends the whole entry unchanged alongside the status move has destroyed
  // nothing, and refusing it would be a refusal for no defect — the shape a
  // batched update takes most naturally (review, 2026-10-01).
  const rationaleTouched =
    Object.prototype.hasOwnProperty.call(fields ?? {}, "rationale") &&
    fields.rationale !== storedRationale;
  if (!isAppend && fields?.status === "skipped" && rationaleTouched) {
    errors.push(
      `plan_items[${pid}]: this op sets status 'skipped' and rewrites rationale in the same ` +
        `call. rationale is why the item was PLANNED — overwriting it while disposing of the ` +
        `item destroys the planning record. Leave rationale alone and put why it was skipped ` +
        `in skip_reason.`,
    );
  }
  return errors;
}

/** Plan items an op APPENDS: a `plan_items` append's entry, or a `plans` append's
 *  inline `items[]`. An update is not an append, so a status change never warns. */
function appendedPlanItems(ops: readonly ResearchAppendOp[]): any[] {
  const out: any[] = [];
  for (const op of ops as any[]) {
    if (op?.op !== "append") continue;
    if (op.section === "plan_items" && op.entry && typeof op.entry === "object") out.push(op.entry);
    if (op.section === "plans" && Array.isArray(op.entry?.items)) out.push(...op.entry.items.filter((i: unknown) => i && typeof i === "object"));
  }
  return out;
}

const PLACE_NOISE = /\b(county|parish|co\.|township|twp\.?|city of)\b/gi;

/** The stored collections that fit an external-site item appended without a
 *  `collection_url`: rows of every stored place whose first part ("Schuylkill",
 *  "Pennsylvania") names a part of the item's free-text jurisdiction, narrowed to
 *  the item's record type when both carry one. A WARNING, so the loose place match
 *  is acceptable here; it could not decide a refusal (lead ruling, 2026-10-23). */
export function storedCollectionsHint(item: any, doc: ExternalCollectionsDoc | null): string | undefined {
  const repository = typeof item?.repository === "string" ? item.repository : "";
  if (repository === "" || /familysearch/i.test(repository) || item?.collection_url) return undefined;
  const parts = new Set(
    String(item?.jurisdiction ?? "")
      .replace(PLACE_NOISE, " ")
      .split(",")
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean),
  );
  const type = typeof item?.record_type === "string" ? item.record_type.toLowerCase() : "";
  const fits: StoredCollectionRow[] = [];
  for (const [place, entry] of Object.entries(doc?.places ?? {})) {
    if (!parts.has(place.split(",")[0].trim().toLowerCase())) continue;
    for (const row of Array.isArray(entry?.rows) ? entry.rows : []) {
      const types = (row?.record_types ?? []).map((t) => String(t).toLowerCase());
      if (type && types.length > 0 && !types.includes(type)) continue;
      if (typeof row?.url === "string" && !fits.some((f) => f.url === row.url)) fits.push(row);
    }
  }
  if (fits.length === 0) return undefined;
  const shown = fits.slice(0, 8).map((r) => `${r.url} (${r.link_text})`).join("; ");
  const more = fits.length > 8 ? `; and ${fits.length - 8} more` : "";
  return (
    `${/^[aeiou]/i.test(repository) ? "An" : "A"} ${repository} plan item (${item?.record_type ?? "?"}, ` +
    `${item?.jurisdiction ?? "?"}) was added with no ` +
    `collection_url, and ${EXTERNAL_COLLECTIONS_FILE} holds ${fits.length} collection(s) that fit it: ${shown}${more}. ` +
    `Set collection_url to one of these urls, or leave it off for a site-wide search.`
  );
}

/** Whether any op sets a plan item's `collection_url`, directly or on an inline
 *  `items[]` entry of a `plans` op. Reads the fields, never a serialization: an op
 *  can hold a value JSON cannot encode. */
function opsSetCollectionUrl(ops: readonly ResearchAppendOp[]): boolean {
  const has = (o: unknown) => !!o && typeof o === "object" && Object.hasOwn(o, "collection_url");
  return ops.some((op: any) =>
    [op?.entry, op?.fields].some(
      (body) => has(body) || (Array.isArray(body?.items) && body.items.some(has)),
    ),
  );
}

/** A plan item's `collection_url` must be a curated collection FamilySearch
 *  returned for a place, not one recalled from memory (#2995). Decidable from
 *  `external-collections.json` alone, so it is a writer precondition (ADR-0011).
 *  Only a url this op SETS is checked: one stored before a re-fetch dropped it
 *  is left alone, or an unrelated edit to that item would be refused. A
 *  non-string value is the validator's type error, not this rule's. */
function collectionUrlInvariants(
  item: any,
  stored: StoredCollectionUrls | undefined,
  previous?: unknown,
): string[] {
  const url = item?.collection_url;
  if (typeof url !== "string" || url === "" || url === previous) return [];
  const pid = item?.id ?? "(new)";
  const remedy =
    "Copy a row's url from research_query({section: \"external_collections\", place, recordType}), " +
    "or omit collection_url for a site-wide search.";
  if (!stored) return [];
  if ("error" in stored) {
    return [
      `plan_items[${pid}]: collection_url cannot be checked: ${EXTERNAL_COLLECTIONS_FILE} could not be ` +
        `read (${stored.error}). Re-fetch the place with external_links_search({standardPlace, projectPath}), ` +
        "or omit collection_url.",
    ];
  }
  if (stored.keys.size === 0) {
    return [
      `plan_items[${pid}]: collection_url '${url}' is not a stored curated collection — nothing is ` +
        `stored for this project yet. Fetch the place with external_links_search({standardPlace, ` +
        `projectPath}) first, then ${remedy.charAt(0).toLowerCase()}${remedy.slice(1)}`,
    ];
  }
  if (!stored.keys.has(collectionKey(url))) {
    return [
      `plan_items[${pid}]: collection_url '${url}' is not in ${EXTERNAL_COLLECTIONS_FILE}. ${remedy}`,
    ];
  }
  return [];
}

/** The two tiers that are a final answer rather than a stalled one: `proved`
 *  establishes the claim, `disproved` affirmatively refutes it. `not_proved` is
 *  deliberately absent — it is a non-answer, so something IS holding it back. */
const CONCLUSIVE_TIERS = new Set(["proved", "disproved"]);

function proofSummaryInvariants(
  entry: any,
  preCallExhaustiveDeclared: Map<string, boolean> | undefined,
): string[] {
  const tier = entry?.tier;
  // Every finding is reported, not the first: the other proof-summary invariant
  // calls in `applyOne` all accumulate, and a summary that breaks two rules and
  // is told about one is sent round again for the other.
  const errors: string[] = [];

  // `shortfall` answers "why is this conclusion not higher?", so a conclusive
  // tier owes `none` and nothing else may claim it. Both fields sit on THIS
  // object, so ADR-0011's first question — can it be decided from the documents
  // alone? — answers yes, and the rule belongs here rather than only in the
  // agent body and the eval validator, where it lived until 2026-09-21.
  //
  // Checked ahead of the conclusive-tier early return below, because the
  // `none`-on-a-lower-tier half applies to every tier.
  const shortfall = entry?.shortfall;
  if (typeof shortfall === "string") {
    if (CONCLUSIVE_TIERS.has(tier) && shortfall !== "none") {
      errors.push(
        `tier '${tier}' is a conclusive answer — it reached a verdict, so nothing ` +
          `is holding it back and shortfall must be 'none'; got '${shortfall}'. ` +
          `Use 'ceiling', 'gap' or 'conflict' only on a tier that did NOT reach ` +
          `one (probable, possible, not_proved).`,
      );
    }
    if (!CONCLUSIVE_TIERS.has(tier) && shortfall === "none") {
      errors.push(
        `shortfall 'none' says nothing is holding this conclusion back, but tier ` +
          `'${tier}' reached no conclusive answer — so something is. Name it: ` +
          `'ceiling' (the reachable record is exhausted), 'gap' (a reachable ` +
          `source is still unsearched), or 'conflict' (an unresolved conflict ` +
          `names this question in its blocks_question_ids).`,
      );
    }
  }

  if (!CONCLUSIVE_TIERS.has(tier)) return errors;
  const declaredBeforeThisCall = preCallExhaustiveDeclared?.get(entry?.question_id) === true;
  if (!declaredBeforeThisCall) {
    errors.push(
      `tier '${tier}' requires question '${entry?.question_id}' to already have its stop gate ` +
        `satisfied (search_stop.stopped_because is 'question_answered', 'record_exhausted', or ` +
        `'nothing_further_reachable') from BEFORE this call (a batch may not declare exhaustiveness ` +
        `and consume it for a tier in the same call) — invoke research-exhaustiveness first, in its ` +
        `own call.`,
    );
  }
  return errors;
}

/** The most words a narrative should run, by proof vehicle: the budgets in
 *  "Select the proof conclusion form" in packages/engine/plugin/agents/proof-conclusion.md
 *  (statement up to ~150, summary ~300-500, argument up to ~800). Only the upper
 *  bounds are budgets. The one definition in the engine. A Map, not an object, so
 *  a model-supplied `vehicle: "constructor"` cannot index the prototype (the
 *  reason `PROOF_TIER_RANK` is one too). */
export const NARRATIVE_WORD_BUDGET: ReadonlyMap<string, number> = new Map([
  ["statement", 150],
  ["summary", 500],
  ["argument", 800],
]);

/** Whitespace-separated words of `text`, markdown syntax included. */
function narrativeWordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed === "" ? 0 : trimmed.split(/\s+/).length;
}

/** A WARNING, never a refusal, when a narrative runs over its vehicle's budget.
 *  Refusing is not on the table: the budgets in the agent body are approximate,
 *  and a narrative over one is not wrong enough to lose the write. Names the
 *  vehicle and its budget. Silent for a vehicle that is
 *  not one of the three or a narrative that is not text, which the document
 *  validator reports in its own words. */
export function narrativeLengthWarnings(entry: any): string[] {
  const budget = NARRATIVE_WORD_BUDGET.get(entry?.vehicle);
  const text = entry?.narrative_markdown;
  if (budget === undefined || typeof text !== "string") return [];
  const words = narrativeWordCount(text);
  if (words <= budget) return [];
  return [
    `proof_summaries ${entry.id}: narrative_markdown is ${words} words, over the ${budget}-word budget ` +
      `for the '${entry.vehicle}' vehicle. Written as is; keep to the budget by citing evidence already ` +
      `quoted elsewhere instead of restating it.`,
  ];
}

export type ResearchAppendSection = keyof typeof SECTIONS | string;

/** One mutation. The body of a single call, or one element of a batch `ops`. */
export interface ResearchAppendOp {
  section: ResearchAppendSection;
  op: "append" | "update";
  entry?: Record<string, unknown>; // op = append (no id — the tool assigns it)
  entryId?: string; // op = update
  fields?: Record<string, unknown>; // op = update (shallow-merged; id immutable)
  edits?: NarrativeEdit[]; // op = update of proof_summaries: exact-match edits, expanded into `fields`
  planId?: string; // required for section = "plan_items"
}

/** One exact-match edit to a proof summary's narrative or search summary. */
export interface NarrativeEdit {
  field: string;
  old: string;
  new: string;
}

/** The tree `S` entry payload for the composite persist. camelCase param at the
 *  boundary; the payload keys are exactly the simplified-GedcomX source fields. */
export interface SourceDescriptionInput {
  title: string;
  author?: string;
  url?: string;
}

export interface ResearchAppendInput {
  projectPath: string;
  // Single-op form — supply section + op plus the relevant per-op fields:
  section?: ResearchAppendSection;
  op?: "append" | "update";
  entry?: Record<string, unknown>;
  entryId?: string;
  fields?: Record<string, unknown>;
  edits?: NarrativeEdit[];
  planId?: string;
  // Batch form — supply ops; when present the single-op fields above (edits included) are ignored.
  // Every op applies to one in-memory document; the tool validates once and
  // writes once (all-or-nothing). Ids assigned earlier in the batch are visible
  // to later ops (the allocators scan the live document).
  ops?: ResearchAppendOp[];
  // Composite persist: create the tree.gedcomx.json `S` entry for this call's
  // single sources append op and stamp its `gedcomx_source_description_id`.
  sourceDescription?: SourceDescriptionInput;
  // Composite persist (evaluations): the structured verdict body. When present
  // on an `evaluations` append, the tool writes it to
  // `evaluations/<focus>-<target_id>-<short_iso>.json` and stamps the entry's
  // `file_path` itself — the same shape as the search-results sidecar, where
  // `log[].results_ref` points at a file only the host writes. Writing the
  // pointer and its payload in one call is what makes a dangling `file_path`
  // structurally impossible; the agent never hand-serializes the verdict.
  verdict?: Record<string, unknown>;
  // Default true: auto-resolve standard_place for an assertion append that has a
  // `place` but omits `standard_place` (sidecar copy first, then geocoding).
  // Pass false to skip the geocoding network call (sidecar copy still applies).
  resolveStandardPlace?: boolean;
}

/** A place the tool resolved (echoed so the caller can sanity-check geocoding
 *  without re-reading files). `source` says where the value came from. */
export interface ResolvedPlaceEcho {
  place: string;
  standardPlace: string;
  source: "sidecar" | "geocoded";
}

/** The §3.4.1 source-reuse decision, echoed whenever auto-detection engaged
 *  so the caller can relay it without re-reading files. */
export interface SourceReuseEcho {
  action: "created" | "updated_existing" | "new_source_reused_s";
  /** The research source the batch wrote (existing id, or the assigned src_NNN). */
  srcId: string;
  /** The tree S entry that source cites. */
  sId: string | null;
}

interface SingleSuccess {
  ok: true;
  section: string;
  op: "append" | "update";
  entryId: string;
  sourceDescriptionId?: string;
  sourceReuse?: SourceReuseEcho;
  resolvedPlaces?: ResolvedPlaceEcho[];
  /** Places looked up and left with no standard_place (§3.6). */
  unresolvedPlaces?: string[];
  filesWritten: string[];
  validation: { valid: true; warnings: string[] };
}
interface BatchSuccess {
  ok: true;
  results: { section: string; op: "append" | "update"; entryId: string }[];
  sourceDescriptionId?: string;
  sourceReuse?: SourceReuseEcho;
  resolvedPlaces?: ResolvedPlaceEcho[];
  unresolvedPlaces?: string[];
  filesWritten: string[];
  validation: { valid: true; warnings: string[] };
  /** Set only by `extraction_append`'s EXTRACTOR MODE, which builds its own ops
   *  from a record's sidecar. The caller never sees that record, so `results[]`
   *  alone would tell it how many entries landed without saying what they say —
   *  and reporting the extraction is the caller's job. `research_append` never
   *  sets this. */
  extraction?: ExtractionEcho;
}

/** What extractor mode extracted, for the caller to report. */
export interface ExtractionEcho {
  recordType: string;
  /** Present only for a census: whether the schedule stated relationships,
   *  decided by the hard-coded year table rather than by reading the field. */
  censusStatesRelationships?: boolean;
  assertionCount: number;
  /** Distinct roles assigned, so a reader can see the household shape without
   *  the assertions. */
  roles: string[];
  notes: string[];
}
export type ResearchAppendResult =
  | SingleSuccess
  | BatchSuccess
  // `reason: "no_project"` marks the one ok:false that is an answer rather than
  // a failure (see noProjectResult). Optional field on the existing arm, NOT a
  // third arm — every `if (!r.ok) r.errors…` keeps narrowing as it does today.
  | { ok: false; errors: string[]; opsReceived?: number; reason?: "no_project" };

/** Carries one or more user-facing messages: the single form echoes them
 *  verbatim; the batch form prefixes each with `ops[i]:`. */
class ResearchAppendError extends Error {
  errors: string[];
  constructor(errors: string | string[]) {
    const arr = Array.isArray(errors) ? errors : [errors];
    super(arr.join("; "));
    this.errors = arr;
  }
}

async function readJson(projectPath: string, filename: string): Promise<any> {
  try {
    return await readProjectJson(projectPath, filename);
  } catch (e) {
    // NoProjectError is an ANSWER, not a failure — the outer catch turns it into
    // noProjectResult(). Flattening it into ResearchAppendError here would lose
    // the `reason` discriminator and ship it with isError.
    if (e instanceof NoProjectError) throw e;
    throw new ResearchAppendError(e instanceof Error ? e.message : String(e));
  }
}

/** Tree-encoding completion check (issue #1490), shadow → WARNING.
 *
 * A tier->=-probable conclusion is expected to leave a trace in the tree. This
 * warns — never refuses, per the 2026-08-24 no-override ruling — when a
 * completed project holds such a conclusion but none of the tree persons its
 * evidence touches gained any new fact or relationship since the opening tree.
 *
 * A SHAPE match, not a foreign key: a proof summary carries no tree reference, so
 * "the conclusion's person" is the union of persons its supporting assertions have
 * person_evidence for (person_evidence is the only link table). Deliberately
 * broad — it warns only when NONE of those persons gained ANY structure — because
 * the measured fire rate is low and a noisy warning on correct work is worse than
 * a missed one. Fails open when the baseline is absent (legacy projects).
 *
 * Corpus reading (3 fires, 2 false denies on documented negatives) confirmed
 * warning-only; see docs/specs/research-append-tool-spec.md §5.2. */
function treeEncodingCompletionWarnings(
  research: any,
  currentTree: SimplifiedGedcomX,
  startingTree: SimplifiedGedcomX | null,
): string[] {
  if (startingTree === null) return [];
  const gained = new Set(
    treeDiff({ before: startingTree, after: currentTree }).personsWithNewStructure,
  );
  const personEvidence = Array.isArray(research?.person_evidence) ? research.person_evidence : [];
  const warnings: string[] = [];
  for (const ps of Array.isArray(research?.proof_summaries) ? research.proof_summaries : []) {
    if (!ps || (ps.tier !== "proved" && ps.tier !== "probable")) continue;
    const supporting = new Set(
      Array.isArray(ps.supporting_assertion_ids) ? ps.supporting_assertion_ids : [],
    );
    const personIds = new Set<string>(
      personEvidence
        .filter((e: any) => e && supporting.has(e.assertion_id) && typeof e.person_id === "string")
        .map((e: any) => e.person_id as string),
    );
    if (personIds.size === 0) continue; // no evidence-linked person to check
    if ([...personIds].some((p) => gained.has(p))) continue; // encoded — no warning
    warnings.push(
      `proof summary ${ps.id} (tier ${ps.tier}) concludes ${ps.question_id ?? "a question"}, ` +
        "but no tree person it draws evidence from gained a new fact or relationship this " +
        "session. Verify the conclusion is encoded in tree.gedcomx.json — a proved/probable " +
        "finding is normally reflected as a fact or relationship on the person it is about.",
    );
  }
  return warnings;
}

/** Next `<prefix>NNN` id (max + 1, zero-padded to 3) for a research section.
 *  `reserved` holds ids the entries do not show but that still count as taken:
 *  the ones an op that failed would have had (see `everyOpFailure`). */
function nextResearchId(entries: any[], prefix: string, reserved?: ReadonlySet<string>): string {
  let max = 0;
  const re = new RegExp(`^${prefix}(\\d+)$`);
  const see = (id: unknown) => {
    const m = typeof id === "string" ? id.match(re) : null;
    if (m) {
      const n = Number(m[1]);
      if (n > max) max = n;
    }
  };
  for (const e of entries) see(e?.id);
  if (reserved) for (const id of reserved) see(id);
  return `${prefix}${String(max + 1).padStart(3, "0")}`;
}

/** The entries whose ids an append to `section` has to clear: its own list, or
 *  for a nested section every parent's list, since those ids are unique across
 *  all parents. */
function idPoolOf(research: any, section: string, config: SectionConfig): any[] {
  if (config.nested) {
    const parents = research?.[config.nested.parent];
    const field = config.nested.field;
    return (Array.isArray(parents) ? parents : []).flatMap((p: any) => (Array.isArray(p?.[field]) ? p[field] : []));
  }
  const list = research?.[section];
  return Array.isArray(list) ? list : [];
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function now(): string {
  return new Date().toISOString();
}

/** What `applyOne` reports about one op it applied. */
interface AppliedByApplyOne {
  section: string;
  op: "append" | "update";
  entryId: string;
  /** Top-level array index of the touched entry (append or update) for
   *  mapping whole-document validation errors back to the op that caused
   *  them. Absent for nested (plan_items) and singleton sections. */
  arrayIndex?: number;
  /** A settled no-op (e.g. re-declaring an already-exhaustive question): the
   *  document was not mutated, so the caller may skip the write. */
  noop?: boolean;
  warnings?: string[];
}

/** An op that applied, with its place in the batch: every check that sees only
 *  the ops that applied (the failure path leaves the failed ones out) names an
 *  op by `ops[opIndex]`, so none has to keep an index map of its own. */
interface AppliedOp extends AppliedByApplyOne {
  opIndex: number;
}

// ─── #2472: carry an assertion correction onto the fact it minted ────────────

interface FactRewriteResult {
  /** True when at least one fact attribute actually changed. */
  mutated: boolean;
  /** Advisories about the CALL's state, true whether or not the rewrite
   *  survives: no fact carries the backlink, the assertion's value is malformed,
   *  the fact holds another source's evidence. */
  warnings: string[];
  /** Advisories that DESCRIBE a change made to the tree. A rollback discards
   *  the change, so these must be discarded with it — otherwise the response
   *  tells a researcher to re-read a proof summary for an edit that never
   *  landed, or says a `standard_place` was cleared after `undo()` restored it. */
  mutationWarnings: string[];
  /** Restore every touched fact to its pre-rewrite attributes. */
  undo: () => void;
}

/**
 * Rewrite the mirrored attributes of every tree fact carrying the
 * `assertion_id` of an assertion this call updated.
 *
 * Why a post-apply pass and not part of `applyOne` or `prepareOps`: `prepareOps`
 * runs BEFORE the apply loop, and `applyOne` receives `research` only — no
 * `tree`, and no way to report a tree mutation. It reads values off the
 * assertion entry in `research` AFTER apply rather than off `op.fields`, because
 * `normalizeDateFields` and `canonicalizeAssertionLabels` run inside `applyOne`
 * and a rewrite keyed on the raw payload would persist the un-normalized form.
 *
 * Person facts only. Nothing can stamp a relationship fact — `materialize_facts`
 * never writes relationship facts, and `tree_edit` rejects a caller-supplied
 * `assertion_id` — so scanning them would be dead code. The harness's
 * tree-fact/assertion agreement check scans both anyway; a validator with a
 * blind spot is worse than one that can never fire there.
 */
function rewriteLinkedFacts(
  applied: AppliedOp[],
  ops: ResearchAppendOp[],
  research: any,
  beforeResearch: any,
  tree: SimplifiedGedcomX,
): FactRewriteResult {
  const warnings: string[] = [];
  const mutationWarnings: string[] = [];
  const concludedTouched = new Set<SimplifiedFact>();
  let mutated = false;

  const assertions: any[] = Array.isArray(research?.assertions) ? research.assertions : [];
  const allFacts: SimplifiedFact[] = (tree?.persons ?? []).flatMap((p) => p.facts ?? []);

  /** Snapshot the mirrored attributes so a failed validation can roll back.
   *
   *  ONCE PER FACT, keyed on the object. A batch may update the same assertion
   *  twice, which reaches the same fact twice; a second snapshot would capture
   *  the state left by the first rewrite, and replaying the two in order would
   *  restore that instead of the original. The retry would then validate a tree
   *  that still carries the rewrite, so a genuinely rewrite-caused failure would
   *  fail again and refuse the assertion correction — exactly what this valve
   *  exists to prevent. Keying on the fact makes the rollback order-independent
   *  rather than relying on a stack discipline someone has to maintain. */
  const snapshots = new Map<SimplifiedFact, Map<AssertionFactAttr, string | undefined>>();
  const snapshot = (fact: SimplifiedFact): Map<AssertionFactAttr, string | undefined> => {
    let before = snapshots.get(fact);
    if (before === undefined) {
      before = new Map<AssertionFactAttr, string | undefined>(
        ASSERTION_FACT_ATTRS.map((a) => [a, fact[a]]),
      );
      snapshots.set(fact, before);
    }
    return before;
  };

  for (let i = 0; i < applied.length; i++) {
    const a = applied[i];
    if (a.section !== "assertions" || a.op !== "update" || a.noop) continue;
    const fields = ops[i]?.fields;
    if (!fields || typeof fields !== "object") continue;
    // `Object.hasOwn`, not truthiness: `place: null` is a real correction — it
    // withdraws the claim — and must clear the fact's place, not be skipped.
    const touched = ASSERTION_FACT_ATTRS.filter((attr) => Object.hasOwn(fields, attr));
    if (touched.length === 0) continue;

    const assertion = assertions.find((e: any) => e && e.id === a.entryId);
    if (!assertion) continue;
    // The same assertion as it stood BEFORE this call. `beforeResearch` is the
    // pre-mutation clone the validator already uses; the provenance test below
    // reads it rather than re-deriving one.
    const priorAssertion = (Array.isArray(beforeResearch?.assertions) ? beforeResearch.assertions : [])
      .find((e: any) => e && e.id === a.entryId);

    const linked = allFacts.filter((f) => f.assertion_id === a.entryId);
    if (linked.length === 0) {
      // 24 of the 145 corpus ops correct an assertion whose fact_type can
      // never become a person fact — `name` becomes a tree name, `gender` sets
      // the scalar, and `relationship`/`marriage`/`parentage`/`age` are
      // two-party links or non-facts. Telling that caller to "re-check it with
      // person_read" sends them after something that does not exist.
      if (!materializesToPersonFact(assertion)) continue;
      // Scoped to THIS op, deliberately. Every fact written before the backlink
      // existed lacks the field, so a warning phrased as "a fact has no
      // assertion_id" would fire on essentially every call. No heuristic
      // fallback either — the point of the backlink is that the join stops
      // being a guess.
      warnings.push(
        `assertion '${a.entryId}' was corrected but no tree fact is linked to it, so nothing ` +
          "in tree.gedcomx.json was updated. If this assertion has been materialized, the fact " +
          "predates the assertion_id backlink — read the fact in tree.gedcomx.json and correct " +
          "it with tree_correct.",
      );
      continue;
    }

    for (const fact of linked) {
      const before = snapshot(fact);
      // A concluded fact is the value proof-conclusion landed, and a proof
      // summary may cite it. Correcting a misread record still has to reach it —
      // leaving a known-wrong concluded value on the upload target is worse —
      // but it must never happen quietly.
      const concluded = fact.primary === true;
      // A re-CLASSIFIED assertion no longer describes this fact's type, and the
      // event / value-bearing split decides whether its `value` may be written
      // here at all. Rewriting across that seam put a birth year into an
      // Occupation fact's `value`. `tree_edit` detaches on a fact retype; the
      // mirror case is an assertion retype, which only this side can see.
      // A fact with no `type` fails this too: `EVENT_TREE_TYPES.has("")` is
      // false, so the event/value-bearing gate would let the assertion's prose
      // `value` through. A typeless fact is already schema-invalid, but the
      // rewrite must not be the thing that compounds it.
      //
      // ONLY when the CALLER retyped it. `canonicalizeAssertionLabels` folds
      // `fact_type` through FACT_TYPE_ALIASES on every assertion update whether
      // or not the op named it, so a stored `birthplace` silently becomes
      // `birth` mid-call. Keyed on the folded value, this guard refused the
      // tool's own re-classification: the correction never reached the fact,
      // which is bug #2472 itself, and the message blamed the researcher for a
      // retype they did not make. 80 person-fact-eligible assertions in the
      // committed corpus would fold on their next update. A fold the caller did
      // not ask for leaves the fact's own type as the one that was minted,
      // which is what the event/value-bearing gate should keep reading.
      const retypedByCaller = Object.hasOwn(fields, "fact_type");
      const assertionType = assertionTreeFactType(assertion.fact_type);
      if (retypedByCaller && assertionType !== "" && fact.type !== assertionType) {
        warnings.push(
          `fact '${fact.id}' is a ${fact.type ?? "(typeless)"} but assertion '${a.entryId}' is a ` +
            `${assertionType}, so the fact was left alone. Re-materialize the assertion, or ` +
            "correct the fact directly with tree_correct, which unlinks the two.",
        );
        continue;
      }
      let placeRewritten = false;
      let standardPlaceRewritten = false;
      for (const attr of touched) {
        const action = assertionFactAttr(assertion, attr, fact.type);
        // null: materialize would never have written this attribute (a `value`
        // on an event fact). Leave whatever is there alone.
        if (action === null) continue;
        if ("malformed" in action) {
          warnings.push(
            `assertion '${a.entryId}' has a non-string '${attr}', so fact '${fact.id}' was left ` +
              "unchanged. A malformed value is not a withdrawn one: set the field to a string, " +
              "or to null to withdraw the claim.",
          );
          continue;
        }
        // PROVENANCE: only rewrite what THIS assertion put there. The
        // corroboration branch fills an attribute the fact lacks from a
        // DIFFERENT assertion, and the fact keeps that source's ref — so a fact
        // holding a value this assertion never asserted is carrying someone
        // else's evidence, and overwriting it destroys it. Compared against the
        // assertion's PRE-CALL state, which is what the fact was mirroring
        // before this correction.
        // Read off the PRE-CALL snapshot, not the live fact: a batch may update
        // one assertion twice, and reading the live value would make this pass
        // mistake its own earlier write for a third party's evidence and send
        // the agent into conflict-resolution over nothing.
        const current = factText(before.get(attr));
        const priorClaim = factText(priorAssertion?.[attr]);
        if (current !== undefined && current !== priorClaim) {
          warnings.push(
            `fact '${fact.id}' holds a '${attr}' that assertion '${a.entryId}' did not assert ` +
              `('${current}') — another source corroborated it, or it was corrected by hand — so ` +
              "it was left alone. Reconcile the two readings through conflict-resolution.",
          );
          continue;
        }
        if ("clear" in action) {
          if (fact[attr] !== undefined) {
            delete fact[attr];
            mutated = true;
            if (attr === "place") placeRewritten = true;
            if (attr === "standard_place") standardPlaceRewritten = true;
            if (concluded) concludedTouched.add(fact);
            // Never silent. A blank string withdraws a claim exactly as `null`
            // does, and it is also the likelier typo; either way this deleted
            // data from the upload target.
            mutationWarnings.push(
              `fact '${fact.id}' lost its '${attr}' because assertion '${a.entryId}' no longer ` +
                "asserts one. If that was a typo rather than a withdrawal, set the field back.",
            );
          }
          continue;
        }
        if (fact[attr] !== action.set) {
          fact[attr] = action.set;
          mutated = true;
          if (attr === "place") placeRewritten = true;
          if (attr === "standard_place") standardPlaceRewritten = true;
          if (concluded) concludedTouched.add(fact);
        }
      }
      if (
        touched.includes("date") &&
        typeof fact.standard_date === "string" &&
        fact.standard_date !== undefined &&
        before.get("date") !== fact.date
      ) {
        // The same asymmetry the place side gets an advisory for. An assertion
        // has no `standard_date` to mirror, so a corrected date leaves the
        // fact's GEDCOM-canonical sidecar naming the old one, and the agreement
        // check does not compare it.
        mutationWarnings.push(
          `fact '${fact.id}' kept standard_date '${fact.standard_date}' while its date was ` +
            `corrected from assertion '${a.entryId}' — an assertion carries no standard_date, so ` +
            "the sidecar was not part of this correction. Re-check it with tree_correct.",
        );
      }
      // Country-contradiction guard on the pair this rewrite just produced.
      // Clears + warns, mirroring tree-edit.ts's guard on the same object;
      // research_append's own append-path guard errors and gedcomx-convert's
      // read path omits. No shipped path writes a contradicting standard_place,
      // and this must not become the first. Clearing does not read as drift to
      // the agreement check either: that compares only where both sides hold a
      // value, so an absent standard_place is skipped.
      //
      // ONLY when this rewrite actually produced the pair. Ungated it fired on
      // every linked fact whenever the op named any of the four fields, so a
      // `date`-only correction deleted a PRE-EXISTING contradiction the call
      // never touched — writing the tree solely to destroy data, and editing
      // exactly the pre-existing drift commit 7cd6a19b9 says a writer must
      // leave alone. Worse, it deleted a `standard_place` the provenance test
      // one block up had just refused to rewrite because it belonged to another
      // source, so one response both promised to leave it alone and removed it.
      if (
        (placeRewritten || standardPlaceRewritten) &&
        typeof fact.place === "string" &&
        typeof fact.standard_place === "string" &&
        countryConsistency(fact.place, fact.standard_place) === "contradiction"
      ) {
        mutationWarnings.push(
          `standard_place '${fact.standard_place}' contradicts place '${fact.place}' on fact ` +
            `'${fact.id}' (from assertion '${a.entryId}') — the place text names a different ` +
            "country; cleared (left unset). Correct the assertion's standard_place.",
        );
        delete fact.standard_place;
        mutated = true;
      }
    }
  }

  for (const fact of concludedTouched) {
    mutationWarnings.push(
      `fact '${fact.id}' is marked primary (a concluded value) and was rewritten from its ` +
        "assertion. Re-read the proof summary that cites it: the conclusion was written against " +
        "the earlier reading.",
    );
  }

  const undo = () => {
    for (const [fact, before] of snapshots) {
      for (const [attr, value] of before) {
        if (value === undefined) delete fact[attr];
        else fact[attr] = value;
      }
    }
  };
  return { mutated, warnings, mutationWarnings, undo };
}

// ─── #3601: a rejection undoes its link ──────────────────────────────────────

/**
 * Retire every live link on a pair this call rejected, and remove the tree facts
 * that link minted.
 *
 * A rejection is the researcher saying the record is not this person, so the link
 * and the facts it put on the person go with it, in the same write. The link's
 * `superseded_by` names the rejection, so the audit trail says why it ended.
 *
 * A fact is "minted by the link" when it sits on the rejected person and carries
 * the rejected `assertion_id`. One whose `sources[]` also cites a ref other than
 * that assertion's own source description holds another record's evidence, so it
 * is kept and named. Names and relationships carry no `assertion_id`, so they are
 * never removed; the response says the person may still carry them.
 *
 * A post-apply pass for the reason `rewriteLinkedFacts` is one: `applyOne` has no
 * way to report a tree mutation.
 */
function retireRejectedLinks(
  applied: AppliedOp[],
  research: any,
  tree: SimplifiedGedcomX,
): { mutated: boolean; warnings: string[] } {
  const warnings: string[] = [];
  let mutated = false;
  const rejections: any[] = Array.isArray(research?.rejected_links) ? research.rejected_links : [];
  const links: any[] = Array.isArray(research?.person_evidence) ? research.person_evidence : [];
  const assertions: any[] = Array.isArray(research?.assertions) ? research.assertions : [];
  const sources: any[] = Array.isArray(research?.sources) ? research.sources : [];

  for (const a of applied) {
    if (a.section !== "rejected_links" || a.op !== "append" || a.noop) continue;
    const rj = rejections.find((r) => r && r.id === a.entryId);
    if (!rj || typeof rj.assertion_id !== "string" || typeof rj.person_id !== "string") continue;
    const live = links.filter(
      (pe) => pe && !pe.superseded_by && pe.assertion_id === rj.assertion_id && pe.person_id === rj.person_id,
    );
    if (live.length === 0) continue;
    for (const pe of live) pe.superseded_by = rj.id;

    const assertion = assertions.find((x) => x && x.id === rj.assertion_id);
    const source = sources.find((s) => s && s.id === assertion?.source_id);
    const ownRef = source?.gedcomx_source_description_id;
    const person = (tree?.persons ?? []).find((p) => p && p.id === rj.person_id);
    const removed: string[] = [];
    const kept: string[] = [];
    if (person && Array.isArray(person.facts)) {
      person.facts = person.facts.filter((f) => {
        if (!f || f.assertion_id !== rj.assertion_id) return true;
        const otherEvidence = (f.sources ?? []).some((s) => typeof s?.ref === "string" && s.ref !== ownRef);
        if (otherEvidence) {
          kept.push(f.id ?? f.type ?? "(fact)");
          return true;
        }
        removed.push(f.id ?? f.type ?? "(fact)");
        return false;
      });
    }
    if (removed.length > 0) mutated = true;

    const retired = live.map((pe) => pe.id).join(", ");
    warnings.push(
      `${rj.id} retired ${retired} (superseded_by '${rj.id}')` +
        (removed.length > 0 ? ` and removed ${removed.join(", ")} from ${rj.person_id}` : "") +
        `. ${rj.person_id} may still carry names or relationships from ${rj.assertion_id}'s record; ` +
        "check them with person_read and correct with tree_correct.",
    );
    if (kept.length > 0) {
      warnings.push(
        `${kept.join(", ")} on ${rj.person_id} came from ${rj.assertion_id} but also cites another ` +
          "record, so it was kept. Check whether that other record still supports it.",
      );
    }
  }
  return { mutated, warnings };
}

/**
 * A plan this call CREATED that ends the call with no items, while the same
 * call's `plan_items` ops wrote into a different plan — the misroute that
 * persisted a schema-invalid `research.json`.
 *
 * Nine `plan_items` ops carrying a hard-coded `planId: "pl_001"` appended
 * themselves to a pre-existing `completed` plan for another question, and the
 * plan the same batch had just created ended with no `items` key. The document
 * validator refused that with "missing required field 'items'", which names the
 * symptom; the model's next call added `"items": []` to the shell, kept the
 * wrong `planId`, and was accepted. The error string is what drives the next
 * move, so it has to name the cause.
 *
 * This refuses nothing that was not already refused: a created plan with no
 * items fails `checkRequired` when `items` is absent and the non-empty check
 * when it is `[]`, both introduced by this call and neither demotable. What it
 * changes is which sentence the model reads.
 *
 * Silent unless the created plan is EMPTY, so a batch that legitimately adds an
 * item to an existing plan alongside a populated new one is untouched.
 */
function emptyCreatedPlanErrors(
  ops: ResearchAppendOp[],
  research: any,
  applied: AppliedOp[],
  // Plans that a refused `plan_items` op named. Such a plan is empty because that op
  // was refused, which says nothing about where this call's other items went, and the
  // message would send the caller to put them in the wrong plan.
  namedByRefusedItems?: ReadonlySet<string>,
): Array<{ index: number; message: string }> {
  const created = applied.filter((a) => a.section === "plans" && a.op === "append" && typeof a.entryId === "string");
  const createdIds = created.map((a) => a.entryId);
  if (createdIds.length === 0) return [];
  // APPENDS only. A `plan_items` update targets an item that already exists in
  // the plan it names, so it is not a misdirected item and the prescription
  // below ("re-issue with planId X") would make it fail on a missing entryId.
  const itemPlanIds = ops
    .filter((o) => o.section === "plan_items" && o.op === "append" && typeof o.planId === "string")
    .map((o) => o.planId as string);
  if (itemPlanIds.length === 0) return [];

  const plans = Array.isArray(research.plans) ? research.plans : [];
  const byId = new Map<string, any>(
    plans.filter((pl: any) => pl && typeof pl.id === "string").map((pl: any) => [pl.id, pl]),
  );
  const createdSet = new Set(createdIds);

  const describe = (id: string): string => {
    const other = byId.get(id);
    const status = other && typeof other.status === "string" ? other.status : "unknown-status";
    const q = other && typeof other.question_id === "string" ? other.question_id : "an unknown question";
    return `'${id}' (${status} plan for ${q})`;
  };

  // Which created plans end EMPTY. When more than one does, "put this id on
  // every item op" is wrong for both of them: following either empties the
  // other. That case gets a per-plan prescription instead.
  const emptyCreated = createdIds.filter((id) => {
    const pl = byId.get(id);
    return pl && !namedByRefusedItems?.has(id) && !(Array.isArray(pl.items) && pl.items.length > 0) &&
      !("items" in pl && pl.items !== null && !Array.isArray(pl.items));
  });

  const out: Array<{ index: number; message: string }> = [];
  for (let k = 0; k < createdIds.length; k++) {
    const newId = createdIds[k];
    const pl = byId.get(newId);
    if (!pl) continue;
    if (namedByRefusedItems?.has(newId)) continue;
    if (Array.isArray(pl.items) && pl.items.length > 0) continue; // the items landed here
    // A present-but-non-array `items` gets its own type error from the document
    // validator; calling that "ends this call with no items" would describe the
    // document wrongly.
    if ("items" in pl && pl.items !== null && !Array.isArray(pl.items)) continue;
    const elsewhere = [...new Set(itemPlanIds.filter((id) => id !== newId))];
    if (elsewhere.length === 0) continue;
    const preExisting = elsewhere.filter((id) => !createdSet.has(id));
    const alsoCreated = elsewhere.filter((id) => createdSet.has(id));
    const forQuestion =
      typeof pl.question_id === "string" ? ` for question '${pl.question_id}'` : "";

    // Every clause below is conditional on the state that makes it TRUE. The
    // first draft asserted all of them unconditionally, so it told a caller who
    // wrote `pl_007` never to hard-code `pl_001`, and called a superseded plan
    // for the SAME question "another question's plan".
    const prescription =
      emptyCreated.length > 1
        ? `${emptyCreated.length} of the plans this call created (${emptyCreated.join(", ")}) end it with no items, so there is no single id to add: give each plan_items op the id of the plan ITS item belongs to.`
        : `A plan_items op must carry the id the tool assigned the plan the item belongs to, which is '${newId}' for this one.`;

    let cause: string;
    if (preExisting.length > 0) {
      const named = preExisting.map(describe).join(", ");
      // EVERY named plan, not `.some()`: with one same-question and one
      // different-question target, a `.some()` gate printed a singular "it
      // belongs to a different question" over a list where one of them does not.
      const otherQuestion = preExisting.every((id) => {
        const o = byId.get(id);
        return o && typeof o.question_id === "string" && o.question_id !== pl.question_id;
      });
      const hardCoded = preExisting.includes("pl_001") && newId !== "pl_001";
      const tail = hardCoded
        ? " Never a hard-coded 'pl_001': in an ongoing project that is the first plan in the file, not yours."
        : otherQuestion
          ? (preExisting.length === 1
              ? " It belongs to a different question, so its audit trail is not yours to append to."
              : " None of them belongs to this question, so their audit trails are not yours to append to.")
          : "";
      cause =
        `this call's plan_items ops wrote into ${named} instead — the items went to a plan this ` +
        `call did not create. ${prescription}${tail}`;
    } else {
      cause =
        `this call's plan_items ops named only ${alsoCreated.map((id) => `'${id}'`).join(", ")}, ` +
        `which this same call also created. ${prescription}`;
    }

    out.push({
      index: created[k].opIndex,
      message:
        `plan '${newId}' was created${forQuestion} and ends this call with no items, which cannot be ` +
        `persisted. ${cause} Do not add "items": [] to the plan shell instead; that is what makes the ` +
        "document schema-invalid.",
    });
  }
  return out;
}

/** Apply ONE mutation to the in-memory research document. Mutates `research` in
 *  place and returns a descriptor; throws ResearchAppendError on any precondition
 *  failure so a batch aborts before anything is written. Does NOT validate or
 *  persist — the caller validates the whole document once and writes once. */
// The model routinely emits a GedcomX-style date object (`{original, formal}`)
// for a simplified `date` / `standard_date`, which the schema requires to be a
// plain string. The `original` (or `formal`) field IS that string, so normalize
// it at the boundary — a lossless unwrap that keeps a well-formed extraction
// from being rejected over a wrapper the model added. A string/null value, or
// an object without a usable string, passes through untouched (the validator
// then reports the real problem). Mutates `entry` in place.
function normalizeDateFields(entry: Record<string, unknown>): void {
  for (const key of ["date", "standard_date"] as const) {
    const v = entry[key];
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const o = v as Record<string, unknown>;
      const s = typeof o.original === "string" ? o.original : typeof o.formal === "string" ? o.formal : undefined;
      if (s !== undefined) entry[key] = s;
    }
  }
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DD_MON_YYYY_RE = /^(\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4})$/;

/** Convert a human-written date to ISO `YYYY-MM-DD`, or null if it can't be
 *  resolved unambiguously to a full day. Reuses the genealogical `stdDate`
 *  standardizer (handles i18n month names, `July 12, 2026`, dashed forms, etc.),
 *  which yields a canonical `DD Mon YYYY`; a form without a day (`Jul 2026`) or a
 *  range/modifier does not match and returns null. */
function humanDateToIso(raw: string): string | null {
  if (ISO_DATE_RE.test(raw)) return raw;
  const m = DD_MON_YYYY_RE.exec(stdDate(raw));
  if (!m) return null;
  const monNum = MONTH_NUM.get(m[2]);
  if (monNum === undefined) return null;
  return `${m[3]}-${String(monNum).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

/** Normalize a source's `access_date` to ISO in place. The schema requires ISO
 *  `YYYY-MM-DD`; models routinely supply a human form (`12 July 2026`), which is
 *  persisted verbatim and then hard-fails the JSON-Schema validator. Rewrite a
 *  parseable human date to ISO; leave an ISO/absent/non-string value untouched,
 *  and leave an unparseable value in place so the joint validator reports the
 *  real problem (a rejection the caller can then correct) rather than the tool
 *  silently inventing a date. Only sources carry `access_date`, so this is a
 *  no-op for every other section. */
function normalizeAccessDate(entry: Record<string, unknown>): void {
  const v = entry.access_date;
  if (typeof v !== "string" || ISO_DATE_RE.test(v)) return;
  const iso = humanDateToIso(v);
  if (iso) entry.access_date = iso;
}

/** Canonical assertion `fact_type` spellings, plus the common non-canonical
 *  forms the model emits, keyed by a *normalized comparison form* (lowercased,
 *  every non-alphanumeric character stripped) so casing/underscore/camelCase
 *  variants all collapse to one key: `Cause of Death`, `cause_of_death`, and
 *  `CauseOfDeath` all key on `causeofdeath`.
 *
 *  `fact_type` is an OPEN enum (`fact_type_recommended` in enums.schema.json),
 *  so this is a best-effort *translator*, NOT a closed allow-list: a value whose
 *  normalized key is not present passes through UNCHANGED (an unrecognized fact
 *  type is legal, just left un-normalized). Two things this buys us that the
 *  eval validator's own casefolding cannot: (1) mapping *semantic* aliases the
 *  casefold can't reach — `father_name`→`name`, `parentage`→`relationship` —
 *  and (2) one canonical spelling in the persisted file for downstream skills
 *  and the judge.
 *
 *  Event place/date are ATTRIBUTES of the event fact, not their own fact types
 *  (matching the tree + GedcomX, which have no `Birthplace`/`Deathplace` type —
 *  birthplace is the `place` of a `Birth` fact). So a place-of-event variant is
 *  folded into the event type — `birthplace`/`place_of_birth` → `birth`,
 *  `deathplace` → `death` — and `PLACE_VARIANT_KEYS` (below) additionally lifts
 *  the place VALUE into the machine-readable `place` field so the folded
 *  assertion is distinguishable from the event's date-claim by field population
 *  (`place != null` = the place-claim, `date != null` = the date-claim). This
 *  keeps birthplace and birth-date *independently classifiable* as separate
 *  `birth` assertions (census: a `direct` place-claim + an `indirect`
 *  computed-year claim) while giving downstream code one grouping key per event.
 *  `sex`/`gender` stay distinct — a model mislabeling those is a content error
 *  we surface, not silently "correct". */
const FACT_TYPE_ALIASES: Record<string, string> = {
  // name — plus the role-prefixed variants the model emits when it folds
  // "whose name" into the fact_type instead of leaving it to the record_role
  // (father_name on a father_of_deceased role → just `name`).
  name: "name",
  fathername: "name",
  mothername: "name",
  parentname: "name",
  spousename: "name",
  maidenname: "name",
  fullname: "name",
  givenname: "name",
  age: "age",
  // birth EVENT — date and place are attributes of the one `birth` fact, so the
  // place variants fold in here and PLACE_VARIANT_KEYS lifts the place value.
  birth: "birth",
  birthdate: "birth",
  dateofbirth: "birth",
  birthplace: "birth",
  placeofbirth: "birth",
  residence: "residence",
  occupation: "occupation",
  // relationship — plus the bare-structure aliases the model reaches for.
  relationship: "relationship",
  parentage: "relationship",
  familycomposition: "relationship",
  gender: "gender",
  sex: "sex",
  race: "race",
  // death / burial / christening EVENTS — place variants fold into the event.
  death: "death",
  deathdate: "death",
  dateofdeath: "death",
  deathplace: "death",
  placeofdeath: "death",
  causeofdeath: "cause_of_death",
  durationofillness: "duration_of_illness",
  burial: "burial",
  burialplace: "burial",
  placeofburial: "burial",
  christening: "christening",
  christeningplace: "christening",
  baptism: "christening",
  marriage: "marriage",
};

/** Normalized keys of the place-of-event fact_type variants. When the model
 *  labels an assertion with one of these, `liftVariantPlace` lifts the place
 *  value into the `place` field if it is not already there, and
 *  `canonicalizeAssertionLabels` folds the type into the event (via
 *  FACT_TYPE_ALIASES) — so the machine-readable place survives the fold and the
 *  assertion reads as the event's place-claim. */
const PLACE_VARIANT_KEYS = new Set([
  "birthplace",
  "placeofbirth",
  "deathplace",
  "placeofdeath",
  "burialplace",
  "placeofburial",
  "christeningplace",
]);

function isBlank(v: unknown): boolean {
  return typeof v !== "string" || v.trim() === "";
}

/** The place text `value` holds: the value without the `[?]` a doubted reading
 *  ends with, which stays in `value`, so the lifted place is as clean as a
 *  document's own `place`. "" for a non-string value. */
function valuePlaceText(entry: Record<string, unknown>): string {
  return typeof entry.value === "string" ? entry.value.replace(TRAILING_DOUBT, "") : "";
}

/** `value` may be lifted into `place`: neither `place` nor `standard_place` is
 *  set, the value holds text that is not a date (the assertion's own `date`, as
 *  a document's place variant given only a date carries it in `value` too, or
 *  any text `stdDate` reads), and the assertion is not an absence, whose value
 *  says what the record lacks rather than naming a place, nor flagged as
 *  suspicious text, which stays in `value`: as a place it would be carried onto
 *  the tree. */
function placeLiftable(entry: Record<string, unknown>): boolean {
  const text = valuePlaceText(entry);
  return (
    isBlank(entry.place) &&
    isBlank(entry.standard_place) &&
    !isBlank(text) &&
    text !== entry.date &&
    stdDate(text) === "" &&
    entry.record_basis !== "absent" &&
    !isSuspiciousText(entry.informant_bias_notes as string | undefined)
  );
}

/** A folded place-of-event variant must keep its place machine-readable: lift
 *  the human `value` (which for a place-claim IS the place string, e.g.
 *  "Ireland") into `place` when `placeLiftable`. Reads `fact_type` as given, so
 *  it runs before the fold renames it. Returns whether it lifted. `prepareOps`
 *  calls it before its place lookups, so a lifted place is standardized, as a
 *  value-derived place. */
function liftVariantPlace(entry: Record<string, unknown>): boolean {
  if (typeof entry.fact_type !== "string" || !PLACE_VARIANT_KEYS.has(factTypeKey(entry.fact_type)) || !placeLiftable(entry)) {
    return false;
  }
  entry.place = valuePlaceText(entry);
  return true;
}

/** Best-effort canonicalization of an assertion's `fact_type` in place. Maps a
 *  known alias (by normalized key) to its canonical spelling, and folds a
 *  place-of-event variant into the event type, whose place value `prepareOps`
 *  has already lifted into the `place` field (see the doc comment on
 *  FACT_TYPE_ALIASES). Leaves an unrecognized value untouched (open enum). No-op
 *  for a non-assertion entry (only assertions carry `fact_type`) or a non-string
 *  value. */
function canonicalizeAssertionLabels(entry: Record<string, unknown>): void {
  const ft = entry.fact_type;
  if (typeof ft !== "string") return;
  const key = factTypeKey(ft);
  // hasOwn, not a bare index — see the note on SECTIONS in applyOne. A bare
  // index on `constructor` yields `Object`, which is truthy, so the assignment
  // below would replace a string fact_type with a function.
  const canonical = Object.hasOwn(FACT_TYPE_ALIASES, key)
    ? FACT_TYPE_ALIASES[key]
    : undefined;
  if (canonical) entry.fact_type = canonical;
}

/** TWO DIFFERENT FIELDS SHARE THE VALUE `"absent"` IN THIS FUNCTION.
 *  `record_basis: "absent"` says the RECORD lacked the value;
 *  `record_role: "absent"` says the PERSON held no role in it because they were
 *  not there. Read the field name on every line, here and in every message.
 *
 *  Assertions with `record_basis: "absent"` must set `record_role` to the
 *  exact string `"absent"` (research-schema-spec.md §5.6, "Negative evidence") — and vice versa —
 *  and must set `informant_proximity` to `"researcher"`: no record informant
 *  reported an absence, whatever the record type, so a negative is always the
 *  researcher's own conclusion. None of these are independent judgment calls;
 *  each is a mechanical corollary of the record_basis decision, so this
 *  REJECTS rather than silently coercing. Silently overwriting `record_role`
 *  would risk masking an assertion whose `value` also failed to differentiate
 *  the person — observed live: three negative-evidence assertions on three
 *  different people sharing one generic `value` string ("preceded Harold
 *  Dean Whitaker in death"), with `record_role` as their only distinguishing
 *  field. No-op for a non-assertion entry (only assertions carry
 *  `record_basis`) or a non-string `record_basis`. This is a WRITER
 *  precondition, so it reads `record_basis` strictly and does NOT accept the
 *  pre-2026-09-18 spelling of this field (see the retired-identifier registry in
 *  enums.schema.json) — an entry carrying that is rejected as an unknown key by
 *  the shape check before it reaches here. The legacy reader
 *  (`utils/record-basis.ts`) is for documents already on disk, not for writes.
 *
 *  The `record_role` arm is bidirectional; the `informant_proximity` arm is
 *  FORWARD ONLY, matching the document tier — every `record_role: "absent"`
 *  assertion in the corpus already carries `record_basis: "absent"`, so the
 *  converse is an unexercised branch.
 *  `informant` is not checked at all: it is free text (ADR-0011 limit 1).
 *
 *  **Both messages name the ABSENCE TEST, not just the field to change**, and
 *  that is load-bearing rather than decorative. The discriminator is whether
 *  the finding is an absence — NOT whether the record states the fact, which
 *  is wrong for the predeceased pattern (a person the record names can still
 *  be absent from among the living). Neither message may prescribe an edit
 *  another arm refuses: an earlier draft told the caller to flip
 *  `record_basis` to "stated", which the converse role arm then rejected. In
 *  `eval/runlogs/unit/record-extraction/v1_2026-09-11_18-49-21.json`
 *  (`ut_record_extraction_028`) the role arm refused two blank-field negatives;
 *  the agent's very next call re-sent the same two defects with `record_role`
 *  flipped to `"absent"` and they were accepted. A message that names one field
 *  buys a relabel, not a fix. */
function validateNegativeEvidenceRole(entry: Record<string, unknown>): void {
  if (typeof entry.record_basis !== "string") return;
  const basisIsAbsent = entry.record_basis === "absent";
  const roleIsAbsent = entry.record_role === "absent";
  // Both arms are COLLECTED, not thrown one at a time. An entry wrong on both
  // fields is the commonest violating shape in the corpus (a_012's pre-retag
  // state is exactly it), and throwing the role arm first hid the proximity
  // error until the caller had already spent a round trip fixing the role.
  // That is this change's own thesis applied to itself: a refusal that names
  // one field at a time buys a relabel rather than a fix. The document tier
  // already reports both.
  const errors: string[] = [];
  if (basisIsAbsent && !roleIsAbsent) {
    errors.push(
      `assertion has record_basis "absent" but record_role '${entry.record_role}' ` +
        `— these are two different fields that share the value: record_basis "absent" ` +
        `means the RECORD lacked the value, record_role "absent" means the PERSON was ` +
        `not in it — and negative evidence always uses the literal record_role "absent", and that ` +
        `holds even when the record NAMES the person: an obituary's "preceded in death ` +
        `by his wife, Ruth" is still negative evidence about her vital status, so her ` +
        `role is "absent", not "spouse_1". Before changing the role, check the finding ` +
        `is an ABSENCE at all. A fact about a person PRESENT in the record is ` +
        `record_basis "stated" carrying that person's real record_role — change both fields ` +
        `together, not just this one. A blank field on a present person (no surname, no ` +
        `occupation) is silence: write no assertion. If it is an absence, keep the ` +
        `person's identity in \`value\` (e.g. "Walter Whitaker preceded Harold Dean ` +
        `Whitaker in death"), not a generic value shared across multiple people. A ` +
        `conforming negative is exactly: record_role "absent", informant_proximity ` +
        `"researcher", informant "the researcher" \u2014 the attached worked example shows ` +
        `a record_basis "stated" assertion and does not satisfy this rule.`,
    );
  }
  if (roleIsAbsent && !basisIsAbsent) {
    errors.push(
      `assertion has record_role "absent" but record_basis '${entry.record_basis}' ` +
        `— record_role "absent" (the PERSON was not in the record) is reserved for ` +
        `negative evidence, which carries record_basis "absent" (the RECORD lacked the ` +
        `value). Set record_basis to "absent", or give the person their real record_role.`,
    );
  }
  if (basisIsAbsent && entry.informant_proximity !== "researcher") {
    errors.push(
      `assertion has record_basis "absent" but informant_proximity ` +
        `'${entry.informant_proximity}' — negative evidence is the researcher's own ` +
        `conclusion, so it always takes informant_proximity "researcher": no record ` +
        `informant reported an absence, whatever the record type, and that holds even ` +
        `when the record names the person (the "preceded in death by" shape). Set ` +
        `informant_proximity to "researcher". Only if the finding is not an absence at ` +
        `all — a fact about a person present in the record — is "absent" the wrong ` +
        `record_basis, and then record_role must change from "absent" to that person's ` +
        `real role in the same edit; changing record_basis alone is refused. A ` +
        `conforming negative is exactly: record_role "absent", informant_proximity ` +
        `"researcher", informant "the researcher" \u2014 the attached worked example shows ` +
        `a record_basis "stated" assertion and does not satisfy this rule.`,
    );
  }
  if (errors.length) throw new ResearchAppendError(errors);
}

/** PRECONDITION 2 — `informant_proximity: "unknown"` implies
 *  `information_quality: "indeterminate"`.
 *
 *  If you cannot identify the informant, you cannot have established that they
 *  witnessed the fact, nor that they did not: the Layer-2 decision tree's
 *  question 1 ("do we know the informant?") answers NO and terminates at
 *  `indeterminate` without ever reaching question 2. So `unknown` paired with
 *  `primary` or `secondary` is not a judgment call this tool is second-guessing
 *  — it is a claim that contradicts its own premise.
 *
 *  **Why a writer precondition and not SKILL.md prose.** ADR-0011's first
 *  question — can this be decided by reading the project documents alone? —
 *  answers yes: both fields are on the entry in hand, so nothing needs a record
 *  re-read. It lived as prose (the burial-index paragraph in
 *  `agents/record-extractor.md`) from the finding in issue #2173, now carried by
 *  issue #2484, and prose did not hold: across the committed e2e corpus the
 *  model broke the rule on **248 of 982** `unknown` assertions. That is the
 *  measurement behind moving it into code (issue #2937).
 *
 *  **FORWARD ONLY, and deliberately not a biconditional.** `indeterminate` does
 *  NOT imply `unknown`: a NAMED informant whose relationship to the specific
 *  fact cannot be established is `indeterminate` at a known proximity — the
 *  decision tree's "CANNOT TELL" branch at question 2, which is reached only
 *  when question 1 answered YES. Tightening this into "iff" would refuse that
 *  whole branch, which is the ordinary shape of a census record read through
 *  the table in `research-append-tool-spec.md`.
 *
 *  Fires ONLY for the two in-enum values that claim a determination was made.
 *  A missing `information_quality` is already the schema's `required` error and
 *  an out-of-enum one is its enum error; reporting this on top of either would
 *  name the wrong fix. That is not hypothetical — `mid-research-flynn-bad-enum`
 *  a_001 is `unknown` + `tertiary`, and `ut_validate_schema_004` pins the
 *  validator at exactly ONE error for it. */
function validateInformantQualityFloor(entry: Record<string, unknown>): void {
  if (entry.informant_proximity !== "unknown") return;
  if (
    entry.information_quality !== "primary" &&
    entry.information_quality !== "secondary"
  ) {
    return;
  }
  throw new ResearchAppendError(
    `assertion has informant_proximity "unknown" but information_quality ` +
      `'${entry.information_quality}' — an unidentified informant cannot be shown to ` +
      `have witnessed the fact OR to have not witnessed it, so the classification ` +
      `terminates at "indeterminate". Either set information_quality to ` +
      `"indeterminate", or — if you can in fact name who supplied this fact — set ` +
      `informant_proximity to what they were (self, witness, household_member, ` +
      `family_not_present, official_duty) and keep the quality you chose. Do NOT ` +
      `reach for "unknown" because the SOURCE is an index or a transcript: an index ` +
      `of a marriage register still carries the register's informant, and indexing ` +
      `changed who stated the fact not at all.`,
  );
}

/** `structured_value.relationship_type` names the record subject's OWN role;
 *  `related_person_role` names the other party's (research-schema-spec.md
 *  §5.6.1). Nothing stated that until issue #2535, and the corpus wrote both
 *  readings — a death certificate naming the father persisted as `"child"` on
 *  one run and `"parent"` on another, each internally coherent. The harm is
 *  silent: `value` reads correctly either way, so the LLM judge passes it and
 *  a value-only matcher passes it too. Nothing in the engine reads
 *  `structured_value.relationship_type` today — `materialize-facts.ts` has
 *  `relationship` in SKIP_TYPES and reads only `related_person_role` — so
 *  the wrong value simply sits there until whoever reads the
 *  machine-readable layer gets the wrong family edge, or the right one
 *  backwards. Latent, not inert.
 *
 *  WHERE the relation word sits is what decides whose role it names, and this
 *  is the whole reason two earlier guards were abandoned on this field. A
 *  value opening `<relation> of <name>` states the SUBJECT's role and can be
 *  compared. `father named as Casper` and `father: Jan Roelfs` LABEL the other
 *  party and say nothing about the subject — comparing those refused 22 of
 *  the 37 it flagged over the e2e run logs (27 of 47 over run logs plus the
 *  unit logs, fixtures and seed), which is how the abandoned guards got
 *  their unacceptable rates. Re-derive with
 *  `measure_relationship_direction.py --counterfactual`.
 *
 *  Forward direction only, on the entry being written. A whole-document rule
 *  would make a project holding one pre-#2535 assertion unwritable by every
 *  tool; PR #2601 set that precedent for the same reason.
 *
 *  Skips rather than guesses on: an unknown spelling (`ward`, `godchild`,
 *  `grandparent` — 73 assertions across 18 spellings), a label form, a
 *  value naming no relation, and a non-assertion entry. An unknown type is not evidence of disagreement. */
// Prototype-less: the keys come from a model-supplied `relationship_type`,
// and on a plain object literal `constructor`, `toString` and `__proto__`
// all read back truthy — which turned an unknown spelling into a refusal
// quoting `a function Object() { [native code] } relation`, against the
// skip-never-refuse contract this rule documents. Fixed here rather than
// at each index site so a third one cannot reintroduce it, and so the
// lookup means what the Python mirror's `dict.get()` already meant.
// The relation-word tables lifted to `src/utils/relationship-category.ts` so
// rank-search-matches can reuse `relationshipCategory` without the packaging
// writer-tool check flagging the importer. Re-exported here for the
// cross-language drift lint (`tests/packaging/relationship-direction-drift.test.ts`),
// which asserts the pin against the Python copy and reads them from this file.
import {
  RELATION_CATEGORY,
  relationshipCategory,
  subjectRoleInValue,
} from "../utils/relationship-category.js";
export { RELATION_CATEGORY, relationshipCategory, subjectRoleInValue };

function validateRelationshipDirection(entry: Record<string, unknown>): void {
  // `fact_type: relationship` only, which is what the refusal-table row and
  // the measurement script both scope to. The exact match is right here
  // because `canonicalizeAssertionLabels` has already run on both the
  // append and the update arm, folding `parentage` and
  // `familycomposition` INTO `relationship`, so those are INSIDE this
  // scope, not outside it.
  // Genuinely outside: 81 assertions across 11 fact types still carry a
  // categorised `relationship_type` (`marriage` 54, `parentchild` 11,
  // `name` 4, …), re-derivable with
  // `measure_relationship_direction.py --domain`.
  // None would be refused today, so the measured rate is unchanged — but a
  // guard whose domain nobody has measured is a guard whose rate nobody can
  // trust, and `marriage` assertions use these fields differently enough that
  // widening is a decision, not an oversight.
  if (String(entry.fact_type ?? "").toLowerCase() !== "relationship") return;
  const sv = entry.structured_value;
  if (!sv || typeof sv !== "object" || Array.isArray(sv)) return;
  const declared = relationshipCategory(
    (sv as Record<string, unknown>).relationship_type,
  );
  const value = typeof entry.value === "string" ? entry.value : "";
  if (!declared || !value) return;
  const stated = subjectRoleInValue(value);
  if (!stated || stated === declared) return;
  throw new ResearchAppendError([
    `assertion has structured_value.relationship_type ` +
      `'${(sv as Record<string, unknown>).relationship_type}' (a ${declared} ` +
      `relation) but value='${value}' states the subject is a ${stated}. ` +
      `\`relationship_type\` is the record SUBJECT's own role and ` +
      `\`related_person_role\` is the other party's, so a death certificate ` +
      `naming the father is "child" on the deceased, not "parent". The legal ` +
      `categories are "parent", "child", "spouse" and "sibling" — "sibling" ` +
      `included, which earlier guidance omitted, so a brother or sister is ` +
      `"sibling" and never "child". Either correct the type to ` +
      `'${stated}', or, if the value is describing the OTHER party rather ` +
      `than the subject, rewrite it to say whose role it names.`,
  ]);
}

/** Section E. `weighed_log_entry_ids` marks the analysis that found nothing
 *  left to search, and holds the coverage set the ladder compares with the
 *  question's log to tell new evidence from evidence already weighed. Whether a
 *  decisive record is still unsearched cannot be read from the documents, so
 *  conflict-resolution declares it by sending the field; the value is computed
 *  here, from the helper the ladder reads, because by hand the set misses the
 *  uploads matched to their hand-offs by URL. An analysis that does not declare
 *  it clears it, as does settling the conflict: either way a stale finding
 *  would end the research on evidence that has moved. */
function stampWeighedLogEntryIds(entry: any, op: ResearchAppendOp, research: any): void {
  const written: Record<string, unknown> = (op.op === "append" ? op.entry : op.fields) ?? {};
  const declared = Object.prototype.hasOwnProperty.call(written, "weighed_log_entry_ids");
  const analysed = isAnalysed(written);
  if (declared && !analysed) {
    throw new ResearchAppendError(
      "`weighed_log_entry_ids` declares that the analysis in this write found nothing left " +
        "to search, so it is accepted only in a write that also carries a non-blank " +
        "`independence_analysis` (and `weighing_analysis`). Re-send it with the analysis, " +
        "or drop it.",
    );
  }
  if (entry?.status !== "unresolved") {
    delete entry.weighed_log_entry_ids;
    return;
  }
  if (!analysed) return;
  if (!declared) {
    delete entry.weighed_log_entry_ids;
    return;
  }
  const covered = conflictCoverageLogIds(research, entry);
  if (covered.length === 0) {
    throw new ResearchAppendError(
      "`weighed_log_entry_ids` declares that nothing is left to search, but this conflict " +
        "covers no log entry: it blocks no question, or no question it blocks has a log entry " +
        "yet, so there is no search to declare it over. Drop the field and name the record that " +
        "would settle the conflict.",
    );
  }
  entry.weighed_log_entry_ids = covered;
}

function applyOne(
  research: any,
  op: ResearchAppendOp,
  appendedThisBatch?: Set<string>,
  preCallExhaustiveDeclared?: Map<string, boolean>,
  preCallBlockingConflicts?: any[],
  preCallResearch?: any,
  // The tree is needed by `coreIdentifierContradictionInvariants`, which
  // compares a record's stated identifiers against what the tree person already
  // attests. Optional so every existing caller and test compiles unchanged; a
  // missing tree makes that gate silent rather than wrong.
  tree?: any,
  // Attestations read in `prepareOps`, because this function is synchronous and
  // holds no projectPath. Absent means "nothing recorded", which is what the
  // score gate refuses on.
  matchScores?: Map<string, MatchScoreFile>,
  // Every assertion this batch can resolve: those already in the document PLUS
  // the ids this batch's assertion appends will take. Without it the score gate
  // is bypassed by putting the person_evidence op FIRST, since the assertion it
  // names is not in `research` yet.
  batchAssertions?: Map<string, any>,
  // Ids in the write-once starting-tree baseline; a person there pre-existed
  // this research and cannot have been minted from the record being linked.
  startingPersonIds?: ReadonlySet<string>,
  createdAssertions?: ReadonlySet<string>,
  personLinks?: ReadonlyArray<PersonLink>,
  birthPlaceCoords?: BirthPlaceCoords,
  storedCollectionUrls?: StoredCollectionUrls,
  // `ResearchAppendOptions.attachmentLink`: only extraction_append's personId
  // mode sets it, as a function argument no tool input reaches.
  attachmentLink = false,
  // Ids that count as taken beyond the entries the document shows: the ones ops
  // that failed would have had. Only the failure path sets it.
  reservedIds?: ReadonlySet<string>,
): AppliedByApplyOne {
  const section = op.section;
  // hasOwn, not a bare index: `section` is LLM-supplied, and a bare index walks
  // the prototype chain — `constructor` yields the `Object` function, which is
  // truthy, so `!config` fails to reject and execution runs on past the error
  // this branch exists to raise.
  const config = Object.hasOwn(SECTIONS, section) ? SECTIONS[section] : undefined;
  if (!config) {
    throw new ResearchAppendError(
      `section '${section}' is not supported by research_append (supported: ${Object.keys(SECTIONS).join(", ")})`,
    );
  }

  // Singleton sections (e.g. `project`) are a single object, not an array:
  // `op:"update"` shallow-merges allowed fields in place — no id, no append.
  if (config.singleton) {
    if (op.op !== "update") {
      throw new ResearchAppendError(`section '${section}' supports only op 'update' (it is one object, not a list)`);
    }
    if (!op.fields || typeof op.fields !== "object") {
      throw new ResearchAppendError("update requires a `fields` object");
    }
    let target = research[section];
    if (!target || typeof target !== "object" || Array.isArray(target)) {
      // An optional section a project may legitimately lack (researcher_profile)
      // is created by its first write. A required one that is missing is a
      // malformed document, and saying so beats silently manufacturing it.
      if (config.singleton.createWhenAbsent && target === undefined) {
        target = {};
        research[section] = target;
        // Placed right after `project` so an agent paging a long research.json
        // finds it near the top. In place, because `research` is the caller's
        // object: delete and re-add every key that follows `project`.
        const keys = Object.keys(research);
        const projectAt = keys.indexOf("project");
        if (projectAt !== -1) {
          for (const k of keys.slice(projectAt + 1)) {
            if (k === section) continue;
            const value = research[k];
            delete research[k];
            research[k] = value;
          }
        }
      } else {
        throw new ResearchAppendError(`research.json '${section}' is missing or not an object`);
      }
    }
    const allowed = new Set(config.singleton.allowedFields);
    const rejected = Object.keys(op.fields).filter((k) => !allowed.has(k));
    if (rejected.length > 0) {
      throw new ResearchAppendError(
        `field(s) not updatable on '${section}': ${rejected.join(", ")} ` +
          `(allowed: ${config.singleton.allowedFields.join(", ")})`,
      );
    }
    // Set-once: legal while the current value is absent or empty, refused after.
    // Emptiness is per-type — "" for a string, [] for a list — because
    // `subject_person_ids` is seeded as an empty array rather than omitted.
    const initOnly = new Set(config.singleton.initOnlyFields ?? []);
    const alreadySet = Object.keys(op.fields).filter((k) => {
      if (!initOnly.has(k)) return false;
      const current = (target as Record<string, unknown>)[k];
      if (current === undefined || current === null) return false;
      if (typeof current === "string") return current.trim() !== "";
      if (Array.isArray(current)) return current.length > 0;
      return true;
    });
    if (alreadySet.length > 0) {
      throw new ResearchAppendError(
        `field(s) already set on '${section}' and not rewritable: ${alreadySet.join(", ")}. ` +
          "These are written once, when the project is created, because every later step " +
          "plans against them. To change one, edit research.json directly.",
      );
    }
    // Completed-gate (GPS Component 4, deterministic): refuse to mark the
    // project completed while a BLOCKING conflict is unresolved. Blocking =
    // status "unresolved" AND (blocks_question_ids non-empty OR it is an
    // identity conflict OR it disputes an assertion some question was built
    // on). "resolved" and "moot" both settle a conflict. This is a tool
    // precondition on the status transition, not a document-validity
    // rule — an already-completed project with such a conflict still loads.
    // Motivated by the wilkins-death-kentucky e2e run where an agent logged
    // an unresolved identity conflict (wrong-person death certificate,
    // 43-year birth mismatch) and completed the project anyway; prose-level
    // guardrails (warnings, mentor) fired and were rationalized away.
    //
    // The third arm is derived rather than declared, because the two declared
    // fields are not reliably written: 42 of the 75 conflicts in the committed
    // e2e corpus carry neither, so the two-arm gate saw 5 of the 14 unresolved
    // conflicts held by completed runs. Deriving sees all 14. The predicate is
    // shared with `question-state.ts`, which computes the per-question form of
    // the same reading for the router's advisory ladder.
    if (section === "project" && op.fields.status === "completed") {
      const tied = questionTiedAssertionIds(research);
      const live = (Array.isArray(research.conflicts) ? research.conflicts : []).filter(
        (c: any) => c && conflictBlocksCompletion(c, tied),
      );
      // Refuse on the UNION of the pre-call and live blocking sets, not on live
      // alone. `applyOne` mutates `research` in place per op, so a live-only read
      // let one batch resolve the conflict and complete in the same call — the
      // gate grading its own homework, the defect every pre-call snapshot in
      // this tool exists to prevent. The union is strictly stronger than either
      // half: the snapshot catches a conflict settled mid-batch, and the live
      // read still catches one this batch newly introduced.
      const blockingIds = new Set<string>(live.map((c: any) => c.id));
      const blocking = [...live];
      for (const c of preCallBlockingConflicts ?? []) {
        if (!blockingIds.has(c.id)) {
          blockingIds.add(c.id);
          blocking.push(c);
        }
      }
      if (blocking.length > 0) {
        const names = blocking
          .map(
            (c: any) =>
              `${c.id} (${c.conflict_type ?? "conflict"}; ${whyConflictBlocksCompletion(c, research)})`,
          )
          .join(", ");
        throw new ResearchAppendError(
          `cannot set project.status = "completed": unresolved blocking conflict(s) ${names}. ` +
            "GPS Component 4 requires conflicting evidence to be resolved before concluding. " +
            "Run conflict-resolution for each — set its status to 'resolved' (with " +
            "independence_analysis, weighing_analysis, resolution_rationale and a resolution_kind: " +
            "'competitor' naming the winning assertion, 'tree' where the tree's existing conclusion " +
            "stands, or 'synthesis' with a resolved_value) or 'moot' (with a rationale for why it " +
            "no longer matters) — then retry completing the project. A conflict you weighed and " +
            "could not settle STAYS 'unresolved' (decision 12): write all three analyses on it " +
            "and say in resolution_rationale what would settle it, but do NOT record it " +
            "'resolved' with resolution_kind 'tree'. That kind means the tree's existing " +
            "conclusion won the weighing, which is a finding about the evidence; \"I could not " +
            "tell\" is not that finding, and recording it as one makes an open question read as " +
            "a settled one. It is not 'moot' either, which means the conflict no longer matters. " +
            "Such a project does not complete: conclude the question at the tier the evidence " +
            "reaches, 'not_proved' included, and let the run end on that open conclusion. " +
            "A conflict settled in the same batch as this update does not count; complete it in " +
            "a later call.",
        );
      }
    }
    for (const [k, v] of Object.entries(op.fields)) target[k] = v;
    const stamp = config.singleton.stampTimestamp;
    if (stamp) target[stamp.field] = stamp.kind === "date" ? today() : now();
    // a singleton has no entry id — echo the section name
    return { section, op: "update", entryId: section };
  }

  // Resolve the target array and the pool to scan for the next id. Nested
  // sections (plan_items) live under a parent entry (plans[planId].items),
  // and their ids are unique across all parents.
  let array: any[];
  let idPool: any[];
  if (config.nested) {
    if (!op.planId) {
      throw new ResearchAppendError(`section '${section}' requires a 'planId'`);
    }
    const parents = research[config.nested.parent];
    const parent = Array.isArray(parents) ? parents.find((p) => p && p.id === op.planId) : undefined;
    if (!parent) {
      throw new ResearchAppendError(`${config.nested.parent} entry '${op.planId}' not found`);
    }
    // APPENDS only. An update targets an item already inside the plan, and
    // `research-plan` supersedes a plan by flipping `plans.status` alone — its
    // items keep whatever status they held. Denying updates would strand an
    // `in_progress` item in a terminal plan with no route to move it, which is
    // the unrecoverable false deny ADR-0011's first limit exists to prevent.
    //
    // `parent` is read LIVE, not from a pre-call snapshot: ops apply in order
    // over the mutated document, so a plan created (or flipped terminal)
    // earlier in this same batch is the same author's own prior step and must
    // be seen. A snapshot read cannot see a same-call plan at all.
    if (op.op === "append" && TERMINAL_PLAN_STATUSES.has(parent.status)) {
      // Both fields are guarded the way `emptyCreatedPlanErrors`' describe()
      // guards them: this fires BEFORE document validation, so a hand-edited
      // research.json can reach it with either field absent.
      const q = typeof parent.question_id === "string" ? `'${parent.question_id}'` : "an unknown question";
      const createdHere = [...(appendedThisBatch ?? [])].filter((id) => id.startsWith("pl_"));
      // This deny fires before `emptyCreatedPlanErrors` (applyOne throws, and
      // the batch returns at once), so it inherits that arm's job of naming the
      // plan this call created — the message, not the symptom, is what drives
      // the model's next move.
      const remedy =
        createdHere.length === 1
          ? `This call created plan '${createdHere[0]}' — re-issue these items with planId '${createdHere[0]}'.`
          : `Append to that question's active plan, or create one first; if these items belong to a ` +
            `different question, re-issue with that question's plan id.`;
      throw new ResearchAppendError(
        `${config.nested.parent} entry '${op.planId}' is '${parent.status}' (question ${q}) — ` +
          `a ${parent.status} plan is a settled audit trail and takes no new items. ${remedy}`,
      );
    }
    if (!Array.isArray(parent[config.nested.field])) parent[config.nested.field] = [];
    array = parent[config.nested.field];
    idPool = idPoolOf(research, section, config);
  } else {
    // Initialize an absent optional section (e.g. localities) on first write.
    if (research[section] === undefined) research[section] = [];
    if (!Array.isArray(research[section])) {
      throw new ResearchAppendError(`research.json '${section}' is not an array`);
    }
    array = research[section];
    idPool = array;
  }

  let entryId: string;
  let resultEntry: any;
  let arrayIndex: number | undefined;
  // The entry's own timestamp as it stood before this op restamped it.
  let priorStamp: unknown;
  // A proof summary's narrative before this op's fields merge.
  let priorNarrative: unknown;
  // An update's link pair and retired state as they stood BEFORE its fields merge,
  // so the rejected-link gate below can tell an edit from a re-link.
  let priorPair: { assertion_id: unknown; person_id: unknown; superseded_by: unknown } | undefined;
  let keptCompletedWarning: string | undefined;

  if (op.op === "append") {
    const entry = op.entry;
    if (!entry || typeof entry !== "object") {
      throw new ResearchAppendError("append requires an `entry` object");
    }
    if (entry.id !== undefined && entry.id !== null) {
      throw new ResearchAppendError("append `entry` must not carry an id — the tool assigns it");
    }
    entryId = nextResearchId(idPool, config.prefix, reservedIds);
    // Strip any id key before assigning so the spread can never clobber it.
    const rest: Record<string, unknown> = { ...entry };
    delete rest.id;
    const newEntry: Record<string, unknown> = { id: entryId, ...rest };
    normalizeDateFields(newEntry);
    normalizeAccessDate(newEntry);
    canonicalizeAssertionLabels(newEntry);
    validateNegativeEvidenceRole(newEntry);
    validateInformantQualityFloor(newEntry);
    validateRelationshipDirection(newEntry);
    const stamp = config.stampTimestamp;
    if (stamp && (stamp.everyWrite || newEntry[stamp.field] === undefined)) {
      newEntry[stamp.field] = stamp.kind === "date" ? today() : now();
    }
    array.push(newEntry);
    if (!config.nested) arrayIndex = array.length - 1;
    appendedThisBatch?.add(entryId);
    resultEntry = newEntry;
  } else if (op.op === "update") {
    if (!op.entryId) {
      throw new ResearchAppendError("update requires an `entryId`");
    }
    // Refused here, where it is first read as text: `.startsWith` below throws a
    // TypeError on a number or an object, which is a crash and not a refusal.
    if (typeof op.entryId !== "string") {
      throw new ResearchAppendError(
        `update \`entryId\` must be a string such as '${config.prefix}001', got ${Array.isArray(op.entryId) ? "array" : typeof op.entryId} ${JSON.stringify(op.entryId)?.slice(0, 60)}`,
      );
    }
    // §3.3: a later op may reference an id created earlier in the batch, but
    // may NOT update it — `append` assigns the id internally, so naming it for
    // an in-batch update means the caller predicted it. Do that update in a
    // follow-up call.
    if (appendedThisBatch?.has(op.entryId)) {
      throw new ResearchAppendError(
        `entryId '${op.entryId}' was appended earlier in this batch — updates to an id created in the same batch are not allowed; make the update in a follow-up call`,
      );
    }
    if (!op.entryId.startsWith(config.prefix)) {
      throw new ResearchAppendError(
        `entryId '${op.entryId}' does not match section '${section}' (prefix ${config.prefix})`,
      );
    }
    if (!op.fields || typeof op.fields !== "object") {
      throw new ResearchAppendError("update requires a `fields` object");
    }
    if ("id" in op.fields && op.fields.id !== op.entryId) {
      throw new ResearchAppendError("update `fields` must not change the entry id");
    }
    if (config.updatableFields) {
      const allowed = new Set(config.updatableFields);
      const rejected = Object.keys(op.fields).filter((k) => k !== "id" && !allowed.has(k));
      if (rejected.length > 0) {
        throw new ResearchAppendError(
          `field(s) not updatable on '${section}': ${rejected.join(", ")} ` +
            `(allowed: ${config.updatableFields.join(", ")})`,
        );
      }
    }
    const existingIndex = array.findIndex((e) => e && e.id === op.entryId);
    if (existingIndex === -1) {
      throw new ResearchAppendError(`entryId '${op.entryId}' not found in '${section}'`);
    }
    const existing = array[existingIndex];
    if (!config.nested) arrayIndex = existingIndex;
    priorPair = {
      assertion_id: existing?.assertion_id,
      person_id: existing?.person_id,
      superseded_by: existing?.superseded_by,
    };

    // Questions: re-declaring exhaustiveness on an already-declared question is
    // a no-op — never overwrite a settled GPS Component-1 record. Only when the
    // stop decision is the SOLE field being set, so a bundled update that also
    // changes other fields is not silently dropped.
    if (section === "questions" && Object.keys(op.fields).length === 1) {
      const newSs = op.fields.search_stop;
      if (
        isStopGateSatisfied(existing) &&
        isStopGateSatisfied(newSs !== undefined ? { search_stop: newSs } : op.fields)
      ) {
        return {
          section,
          op: op.op,
          entryId: op.entryId,
          noop: true,
          warnings: [`question '${op.entryId}' is already exhaustive_declared; no-op`],
        };
      }
    }

    priorStamp = config.stampTimestamp ? existing[config.stampTimestamp.field] : undefined;
    priorNarrative = existing.narrative_markdown;

    // A completed plan item stays completed. search-records writes
    // `in_progress` after every search it logs, and extraction_append completes
    // the item once a record it found is extracted, so a later search on the
    // same item would otherwise reopen it. The status is dropped from the op,
    // which also keeps every status-gated arm below from reading it as touched.
    if (
      section === "plan_items" &&
      existing.status === "completed" &&
      op.fields.status === "in_progress"
    ) {
      const { status: _dropped, ...rest } = op.fields;
      op.fields = rest;
      keptCompletedWarning = `plan item '${op.entryId}' is already completed; left completed`;
      if (Object.keys(rest).filter((k) => k !== "id").length === 0) {
        return { section, op: op.op, entryId: op.entryId, noop: true, warnings: [keptCompletedWarning] };
      }
    }
    // The same rule for items re-sent inline on a `plans` update, which reach
    // `items[]` directly: an item stored `completed` and sent `in_progress` is
    // kept `completed`. When that leaves the op changing nothing, it is a no-op.
    if (section === "plans" && Array.isArray(op.fields.items)) {
      const storedStatus = new Map<unknown, unknown>(
        (Array.isArray(existing.items) ? existing.items : [])
          .filter((it: any) => it && typeof it.id === "string")
          .map((it: any) => [it.id, it.status]),
      );
      const kept: string[] = [];
      const items = op.fields.items.map((it: any) => {
        if (it && storedStatus.get(it.id) === "completed" && it.status === "in_progress") {
          kept.push(it.id);
          return { ...it, status: "completed" };
        }
        return it;
      });
      if (kept.length > 0) {
        op.fields = { ...op.fields, items };
        keptCompletedWarning = kept.map((id) => `plan item '${id}' is already completed; left completed`).join("; ");
        const changesNothing = Object.entries(op.fields).every(
          ([k, v]) => k === "id" || JSON.stringify(existing[k]) === JSON.stringify(v),
        );
        if (changesNothing) {
          return { section, op: op.op, entryId: op.entryId, noop: true, warnings: [keptCompletedWarning] };
        }
      }
    }

    for (const [k, v] of Object.entries(op.fields)) {
      if (k === "id") continue;
      existing[k] = v;
    }
    const updateStamp = config.stampTimestamp;
    if (updateStamp?.everyWrite) {
      const moves = !updateStamp.restampOn ||
        updateStamp.restampOn.some((k) => Object.prototype.hasOwnProperty.call(op.fields, k));
      if (moves) existing[updateStamp.field] = updateStamp.kind === "date" ? today() : now();
      else if (priorStamp === undefined) delete existing[updateStamp.field];
      else existing[updateStamp.field] = priorStamp;
    }
    // Retiring an assertion says nothing about its content, and one written
    // before a later rule must still be retirable (#3678).
    if (!(section === "assertions" && isRetirementFields(op.fields))) {
      normalizeDateFields(existing);
      normalizeAccessDate(existing);
      canonicalizeAssertionLabels(existing);
      validateNegativeEvidenceRole(existing);
    }
    // The update arm validates the MERGED entry, so an op that sets only one of
    // the pair is checked against the value already on disk — which is the case
    // the rule exists for: flipping `informant_proximity` to "unknown" while
    // leaving a stale `secondary` behind is exactly how the 248 corpus
    // violations were reached. Scoped to ops that set one of the pair, like the
    // relationship-direction check below: an update that touches neither (a
    // question tie, a notes edit) says nothing about the pair, and re-checking
    // a legacy pair there would refuse the tie and leave the question with no
    // assertions, sent back to extraction on every pass.
    if (
      Object.prototype.hasOwnProperty.call(op.fields, "informant_proximity") ||
      Object.prototype.hasOwnProperty.call(op.fields, "information_quality")
    ) {
      validateInformantQualityFloor(existing);
    }
    // Scoped to ops that set one of the three inputs it compares.
    // `fact_type` is one of them because it decides whether the guard
    // applies at all, so a retype INTO `relationship` would otherwise move
    // a standing contradiction inside the domain without either compared
    // field being touched.
    //
    // The update arm validates the MERGED entry, so an unconditional call
    // refuses an unrelated edit — a plain `place` correction on an
    // assertion written before this rule existed — and `research_append`
    // resolves and writes `standard_place` on every place-carrying
    // assertion, so that is an ordinary edit, not a corner. Same discipline
    // as the place-containment check below and the
    // `hypothesisSupportedInvariants` floor: forward direction means the
    // ops being written, not the document.
    if (
      Object.prototype.hasOwnProperty.call(op.fields, "value") ||
      Object.prototype.hasOwnProperty.call(op.fields, "structured_value") ||
      Object.prototype.hasOwnProperty.call(op.fields, "fact_type")
    ) {
      validateRelationshipDirection(existing);
    }
    entryId = op.entryId;
    resultEntry = existing;
  } else {
    throw new ResearchAppendError(`unknown op '${op.op}' (expected 'append' or 'update')`);
  }
  if (section === "conflicts") stampWeighedLogEntryIds(resultEntry, op, research);

  // Section invariants the project validator does not already enforce.
  const invariantErrors: string[] = [];
  // Warn-only advisories: collected here, surfaced on the successful response's
  // validation.warnings (via the caller's flatMap over AppliedOp.warnings), never
  // thrown. Distinct from invariantErrors, which reject the write (#1006).
  const opWarnings: string[] = keptCompletedWarning ? [keptCompletedWarning] : [];
  // Only the researcher rejects a pair (lead, 2026-10-20), and the engine cannot
  // see who spoke. Their exact words make a rejection written on a hedge, or in a
  // turn they never spoke in, visible in the viewer and in feedback triage.
  if (section === "rejected_links" && op.op === "append") {
    const words = resultEntry.researcher_words;
    if (typeof words !== "string" || words.trim() === "") {
      invariantErrors.push(
        "a rejection needs `researcher_words`: the researcher's own message saying this record " +
          "is not this person, copied verbatim, not paraphrased. Only the researcher rejects a " +
          "pair. If they did not clearly say it is not a match, do not reject it; leave it unlinked.",
      );
    }
  }
  // A question may only reach `resolved` once a proof summary for it exists.
  // Same "only when THIS op sets it" discipline as the proof_summaries block
  // below — an unrelated update to an already-resolved question must not
  // re-trigger it.
  if (section === "questions") {
    // `resolved` is checked alongside `status` because it is the other spelling
    // of the same transition — see questionResolvedInvariants. Omitting it here
    // would leave the gate reachable only through one of the two fields.
    const fields = op.fields ?? {};
    const resolutionTouchedThisOp =
      op.op === "append" ||
      Object.prototype.hasOwnProperty.call(fields, "status") ||
      Object.prototype.hasOwnProperty.call(fields, "resolved");
    if (resolutionTouchedThisOp) {
      invariantErrors.push(...questionResolvedInvariants(resultEntry, research, preCallResearch));
    }
    // Both exhaustiveness gates run only when THIS op touches the field they
    // govern, the same discipline as the block above: an unrelated update to a
    // question that was legitimately declared in an earlier call must not
    // re-trigger either. `append` always sets both.
    const declarationTouchedThisOp =
      op.op === "append" ||
      Object.prototype.hasOwnProperty.call(fields, "search_stop");
    if (declarationTouchedThisOp) {
      invariantErrors.push(...planCompleteInvariants(resultEntry, preCallResearch));
    }
    if (op.op === "append") {
      invariantErrors.push(...newQuestionWhileAnotherIsOpenInvariants(resultEntry, preCallResearch));
      invariantErrors.push(...secondQuestionInOneCallInvariants(resultEntry, research, preCallResearch));
      invariantErrors.push(...fanPivotUnblocksInvariants(resultEntry, preCallResearch));
    }
    const statusTouchedThisOp =
      op.op === "append" || Object.prototype.hasOwnProperty.call(fields, "status");
    // EITHER side, because the invariant couples two fields and an op that
    // touches one can break it without naming the other. Gating on `status`
    // alone left the mirror-image hole open: an update changing
    // `search_stop.stopped_because` to a non-gate value on a question already
    // sitting at `status: "exhaustive_declared"` never ran the check and
    // persisted exactly the state it forbids. That is not hypothetical — it is
    // the agent's own documented re-invocation path, which may change the stop
    // reason and is told to leave `status` alone.
    if (statusTouchedThisOp || declarationTouchedThisOp) {
      invariantErrors.push(...declarationStatusInvariants(resultEntry));
    }
  }
  if (section === "conflicts") {
    invariantErrors.push(...conflictInvariants(resultEntry));
    invariantErrors.push(...resolutionKindInvariants(resultEntry, op));
    // Place containment: on append, and on an update that (re)sets the pairing.
    // Scoped that way so an unrelated edit to a conflict written before this
    // rule existed is not refused — the freeze #2354 had to design around.
    const conflictFields = op.fields ?? {};
    if (
      op.op === "append" ||
      Object.prototype.hasOwnProperty.call(conflictFields, "competing_assertion_ids")
    ) {
      invariantErrors.push(...placeContainmentErrors(resultEntry, research));
      // Non-blocking, on the same ops: the write succeeds and the agent is told
      // the two dates cannot be ordered. See unorderableDateWarnings for why
      // this is a warning rather than a precondition.
      opWarnings.push(...unorderableDateWarnings(resultEntry, research));
    }
    // Uncertain-preference guard: on append, or an update that (re)sets
    // preferred_assertion_id or status. Scoped so an unrelated edit to a
    // conflict written before this rule is not refused.
    if (
      op.op === "append" ||
      Object.prototype.hasOwnProperty.call(conflictFields, "preferred_assertion_id") ||
      Object.prototype.hasOwnProperty.call(conflictFields, "status")
    ) {
      invariantErrors.push(...uncertainPreferenceInvariants(resultEntry, research));
    }
  }
  // US 1890 census backstop: on append, or an update that (re)sets `gaps`.
  // Scoped that way so an unrelated edit to a timeline written before this
  // rule existed is not refused.
  if (section === "timelines") {
    const timelineFields = op.fields ?? {};
    if (op.op === "append" || Object.prototype.hasOwnProperty.call(timelineFields, "gaps")) {
      invariantErrors.push(...timelineCensus1890Invariants(resultEntry));
    }
    // Non-blocking, on the ops that set events. See
    // unsourcedTimelineEventWarnings for why this warns rather than refuses.
    if (op.op === "append" || Object.prototype.hasOwnProperty.call(timelineFields, "events")) {
      opWarnings.push(...unsourcedTimelineEventWarnings(resultEntry));
    }
  }
  // One active plan per question — enforced on append OR an update that
  // (re)sets status to "active"; the helper no-ops for non-active entries.
  if (section === "plans") {
    invariantErrors.push(...planActiveInvariants(resultEntry, research));
    // Completing an item claims a search the log must evidence — checked HERE
    // as well as in the `plan_items` arm below, because a plan op can land a
    // completed item without any `plan_items` op existing. The append branch
    // spreads the caller's entry wholesale (`{ ...entry }`) and the update
    // branch copies arbitrary keys, so `entry.items` and `fields: { items }`
    // both reach `items[]` directly. `research-append-tool-spec.md` §5 names
    // inline non-empty `items` as one of two satisfying shapes "both already in
    // use", so this is a documented route, not a corner.
    //
    // Measured at 4791ea9cb: of 376 tracked `plans` append ops, 363 omit
    // `items`, 8 carry non-empty inline `items` and 5 send `[]`; 6 of the 8
    // carry only `planned` items, and the other 2 carry a `completed` item on
    // calls already refused for other reasons. 0 `plans` update ops write
    // `items` at all. So this arm changes no outcome the corpus contains.
    //
    // Gated on the ops that can SET an item's status, the same discipline as
    // every arm around it: an unrelated update to a plan whose items were
    // already completed in an earlier call is untouched. And an update that
    // re-sends `items[]` whole checks only the items it newly completes — one
    // already `completed` in the stored plan before this call did not change,
    // and refusing it would strand a plan completed before this rule existed.
    const planFields = op.fields ?? {};
    const itemsTouchedThisOp =
      op.op === "append" || Object.prototype.hasOwnProperty.call(planFields, "items");
    if (itemsTouchedThisOp) {
      const storedPlan =
        op.op === "update"
          ? (Array.isArray(preCallResearch?.plans) ? preCallResearch.plans : []).find(
              (pl: any) => pl && pl.id === resultEntry?.id,
            )
          : undefined;
      const alreadyCompleted = new Set(
        (Array.isArray(storedPlan?.items) ? storedPlan.items : [])
          .filter((it: any) => it && it.status === "completed")
          .map((it: any) => it.id),
      );
      const alreadySkipped = new Set(
        (Array.isArray(storedPlan?.items) ? storedPlan.items : [])
          .filter((it: any) => it && it.status === "skipped")
          .map((it: any) => it.id),
      );
      const storedStatusById = new Map<string, unknown>(
        (Array.isArray(storedPlan?.items) ? storedPlan.items : [])
          .filter((it: any) => it && typeof it.id === "string")
          .map((it: any) => [it.id, it.status]),
      );
      for (const item of Array.isArray(resultEntry?.items) ? resultEntry.items : []) {
        // Before the completed-item skip: a `plans` update re-sending a completed
        // item whole could otherwise write a collection_url that was never stored.
        const storedItem = (Array.isArray(storedPlan?.items) ? storedPlan.items : []).find(
          (it: any) => it && item && it.id === item.id,
        );
        invariantErrors.push(
          ...collectionUrlInvariants(item, storedCollectionUrls, storedItem?.collection_url),
        );
        if (item && alreadyCompleted.has(item.id)) continue;
        invariantErrors.push(...planItemLogAttributionInvariants(item, research));
        if (item && storedItem?.jurisdiction !== item.jurisdiction) {
          invariantErrors.push(...compoundJurisdictionInvariants(item, research));
        }
        invariantErrors.push(...planItemCompletionRecordTypeInvariants(item, research));
        // Inline `items[]` on a `plans` op reaches the same field, so the skip
        // rule has to hold here too or it is one `{ ...entry }` spread away
        // from being bypassed. `isAppend: true` — an item arriving inline has
        // no prior rationale to overwrite, so only the category clause applies.
        if (item && !alreadySkipped.has(item.id)) {
          invariantErrors.push(...planItemSkipInvariants(item, {}, true));
          invariantErrors.push(...planItemSearchedSkipInvariants(item, research));
        }
        // The capture-pending guard reaches the same field for the same reason:
        // a `skipped`/`completed` item set inline on a `plans` op would bypass
        // the `plan_items` arm below. Gated on a genuine status change, so an
        // item re-sent at its stored status (an append has none) is untouched.
        if (item && storedStatusById.get(item.id) !== item.status) {
          invariantErrors.push(...planItemCapturePendingInvariants(item, research));
        }
      }
    }
  }
  // A plan item may only be completed once a log entry names it. Gated on the
  // ops that can set the status — `append` always sets it, `update` only when
  // `fields` names it — so an unrelated edit to an item legitimately completed
  // in an earlier call is not refused. The helper returns [] for every status
  // but `completed`, so `in_progress` and `skipped` moves are never touched.
  //
  // An `append` carrying `status: "completed"` is refused unconditionally: the
  // id is assigned inside this call, so no log entry can already name it.
  if (section === "plan_items") {
    const itemFields = op.fields ?? {};
    const statusTouchedThisOp =
      op.op === "append" || Object.prototype.hasOwnProperty.call(itemFields, "status");
    // An update re-sending `completed` on an item already completed before this
    // call changes nothing — the same skip the `plans` arm makes — so a project
    // completed before this rule existed is not refused for re-stating it.
    const wasCompleted =
      op.op === "update" &&
      (Array.isArray(preCallResearch?.plans) ? preCallResearch.plans : []).some(
        (pl: any) =>
          pl &&
          Array.isArray(pl.items) &&
          pl.items.some(
            (it: any) => it && it.id === resultEntry?.id && it.status === "completed",
          ),
      );
    if (statusTouchedThisOp && !wasCompleted) {
      invariantErrors.push(
        ...planItemLogAttributionInvariants(resultEntry, research, op.op === "append"),
      );
      invariantErrors.push(...planItemCompletionRecordTypeInvariants(resultEntry, research));
    }
    // Capture-pending guard (#1226): refuse moving an item INTO a terminal
    // status while its latest external-site search still awaits a capture.
    // Gated on a genuine status CHANGE so re-stating fixture state is not
    // refused — mirrors the eval validator's "items this run changed" scope.
    const priorItemStatus =
      op.op === "update"
        ? (Array.isArray(preCallResearch?.plans) ? preCallResearch.plans : [])
            .flatMap((pl: any) => (pl && Array.isArray(pl.items) ? pl.items : []))
            .find((it: any) => it && it.id === resultEntry?.id)?.status
        : undefined;
    if (statusTouchedThisOp && priorItemStatus !== resultEntry?.status) {
      invariantErrors.push(...planItemCapturePendingInvariants(resultEntry, research));
    }
    // A `skipped` item must carry a category. Gated the same way, and
    // additionally skipped when the item was ALREADY `skipped` before this
    // call: re-stating a bare skip written before this rule existed changes
    // nothing, and refusing it would strand every pre-existing project. Only a
    // NEW skip is held to it.
    const storedItem = (Array.isArray(preCallResearch?.plans) ? preCallResearch.plans : [])
      .flatMap((pl: any) => (pl && Array.isArray(pl.items) ? pl.items : []))
      .find((it: any) => it && it.id === resultEntry?.id);
    const wasSkipped = op.op === "update" && storedItem?.status === "skipped";
    if (statusTouchedThisOp && !wasSkipped) {
      invariantErrors.push(
        ...planItemSkipInvariants(
          resultEntry,
          itemFields,
          op.op === "append",
          storedItem?.rationale,
        ),
      );
      invariantErrors.push(...planItemSearchedSkipInvariants(resultEntry, research));
    }
    if (op.op === "append" || storedItem?.jurisdiction !== resultEntry?.jurisdiction) {
      invariantErrors.push(...compoundJurisdictionInvariants(resultEntry, research));
    }
    if (op.op === "append" || Object.prototype.hasOwnProperty.call(itemFields, "collection_url")) {
      invariantErrors.push(
        ...collectionUrlInvariants(
          resultEntry,
          storedCollectionUrls,
          op.op === "update" ? storedItem?.collection_url : undefined,
        ),
      );
    }
  }
  // The `supported` evidence floor (#2086, lead ruling 2026-09-07). Gated on
  // the op that SETS the status — the same discipline as the `questions` and
  // `proof_summaries` blocks — which is what makes the ruling's "a hypothesis
  // set to supported" true rather than "an entry that stands at supported", so
  // a narrative-only update to one promoted in an earlier call is not refused.
  //
  // Deliberately NOT the widened form `conflictedSourceInvariants` below uses.
  // That rule asks "does the entry STAND in a forbidden state"; the ruling chose
  // the narrow form here, and over the whole corpus the two are
  // indistinguishable, so widening buys nothing. The cost is that the gate is
  // unreachable from the `conflicts` side: a conflict written anywhere in the
  // same batch is invisible to it, in EITHER order (measured 2026-09-17 — not
  // order-sensitive, as an earlier draft of this comment claimed). Neither a
  // snapshot nor a live read closes the promote-then-append ordering. Recorded
  // in guardrail-enforcement-spec.md §5; closing it would widen the gate past
  // "forward direction only", which is the lead's call.
  if (section === "hypotheses") {
    // ANY of the three coupled fields, not `status` alone. The invariant couples
    // `status` to both id lists, so an op touching a list can break it without
    // naming `status` — the same mirror-image hole the `questions` arm above
    // found and closed, and it is not hypothetical here either: the skill's own
    // documented re-invocation path writes `fields: {contradicting_assertion_ids:
    // [...]}` and is told to "leave the status unchanged"
    // (`agents/hypothesis-tracking.md`). Gating on `status` alone left three
    // measured calls landing `ok: true` on exactly the state this refuses.
    //
    // Measured at 587d3c98d: 11 corpus update ops touch one of these lists
    // without naming `status`, across 5 run logs, against 17 ops that set
    // `status: "supported"` at all — so the ungated path was the size of the
    // gated one. Widening costs nothing: reconstructing each hypothesis's status
    // from the call ledger, **0 of those 11** stood at `supported` when the op
    // arrived, so the widened arm refuses no write the corpus actually made.
    //
    // Still the forward direction: the entry must END at `supported` and fail
    // the floor. `hypothesisSupportedInvariants` returns [] for every other
    // status, so a narrative-only update — naming none of the three — is
    // untouched.
    const hypothesisFields = op.fields ?? {};
    const floorFieldTouchedThisOp =
      op.op === "append" ||
      Object.prototype.hasOwnProperty.call(hypothesisFields, "status") ||
      Object.prototype.hasOwnProperty.call(hypothesisFields, "supporting_assertion_ids") ||
      Object.prototype.hasOwnProperty.call(hypothesisFields, "contradicting_assertion_ids");
    if (floorFieldTouchedThisOp) {
      invariantErrors.push(...hypothesisSupportedInvariants(resultEntry, preCallResearch));
    }
  }
  // Identity over-reach: runs on append AND on an update that raises confidence
  // to "confident"; the helper no-ops for every other confidence value.
  if (section === "person_evidence") {
    // A pair the researcher has REJECTED is not re-linked without new evidence.
    // Ruled 2026-09-30 and enforced here rather than in a skill body: whether a pair
    // was rejected is decidable from research.json alone, which per ADR-0011 makes it
    // a writer precondition. The reported failure is exactly this -- a researcher
    // challenged an assumption and the agent reverted to it, because nothing recorded
    // the rivals.
    // ...on a CREATE, or on an update that moves a link onto a new pair or brings a
    // retired link back. NOT on every
    // edit to a link that already exists: the normal sequence is to reject a pair whose
    // link is already there, and firing on updates too meant that wrong link could never
    // afterwards be given a rationale, lowered to `speculative`, or superseded — so the
    // bad link and the facts it materialized stayed live for good. The refusal even told
    // the caller to "remove the rejection", which `research_append` cannot do (no delete,
    // and the spec says never delete). Found in the self-review of #3262.
    // An update re-raises a link when it ends live AND either moves the pair (a new
    // `assertion_id` or `person_id`) or revives a link that was retired. Judged on the
    // stored state before the merge, not on which fields the op named: a pair move
    // names no `superseded_by`, and a revival may write `""`, which is not a retirement.
    const pairChanged =
      !!priorPair &&
      (priorPair.assertion_id !== resultEntry.assertion_id ||
        priorPair.person_id !== resultEntry.person_id);
    const wasRetired = !!priorPair?.superseded_by;
    const reRaising =
      op.op === "append" ||
      (op.op === "update" && !resultEntry.superseded_by && (pairChanged || wasRetired));
    if (reRaising) {
      invariantErrors.push(...rejectedLinkInvariants(resultEntry, research));
    }
    // An attachment link is only ever superseded. Raising it in place would skip
    // same_person: the score gate checks an update only when it writes
    // `match_score`, `assertion_id` or `person_id`, so a confidence edit alone
    // would turn an unchecked attachment into an identity.
    if (op.op === "update") {
      const stored = (Array.isArray(preCallResearch?.person_evidence) ? preCallResearch.person_evidence : []).find(
        (pe: any) => pe && pe.id === op.entryId,
      );
      const fieldKeys = Object.keys(op.fields ?? {}).filter((k) => k !== "id");
      if (
        stored &&
        isAttachmentLink(stored) &&
        !(fieldKeys.length === 1 && fieldKeys[0] === "superseded_by")
      ) {
        invariantErrors.push(
          `person_evidence ${op.entryId} is an unverified FamilySearch attachment link, which is only ` +
            `ever superseded. To raise it, score the pair with same_person({ projectPath, assertionId: ` +
            `'${stored.assertion_id}', treePersonId: '${stored.person_id}' }), append a new link at the ` +
            `confidence the score supports, then update this one with only { superseded_by: "<new pe_ id>" }.`,
        );
      }
    }
    invariantErrors.push(...personEvidenceInvariants(resultEntry, research));
    invariantErrors.push(...coreIdentifierConflictInvariants(resultEntry));
    // A REFUSAL, not a warning. The lead's standing ruling on issue #2272 is
    // "do not flip the warn to a reject as a one-line change", and the bar it
    // set is ADR-0011 limit 2: read the refusals individually rather than quote
    // a rate. All 38 that the un-gated arm produced were read (2026-09-24) and
    // every one is a false positive -- 35 death-record birthplaces at
    // `secondary`/`family_not_present`, 3 christening PLACES against a birth
    // place. Both classes are now excluded on genealogical grounds, and the
    // arm refuses 0 of 323 committed confident/probable entries.
    //
    // An UPDATE that sets `superseded_by` is retiring a link, not asserting
    // one. Refusing it would make a confident link on a contradicted persona
    // permanently unretractable through the section 6 supersede pattern
    // (append the corrected link, then set `superseded_by` on the old one) --
    // the trap the score gate avoids too. Keyed on the op, not the field: an
    // APPEND that arrives already carrying `superseded_by` is a new link, and
    // exempting it let any confident link on a contradicted persona through
    // with an invented supersede pointer (the validator does not check that
    // a person_evidence `superseded_by` names an existing entry).
    invariantErrors.push(
      ...(op.op === "update" && resultEntry.superseded_by
        ? []
        : coreIdentifierContradictionInvariants(resultEntry, research, tree, personLinks, batchAssertions, birthPlaceCoords)),
    );
    // Only when this op makes the pairing: a rationale edit on a link written
    // before this rule must stay possible.
    if (reRaising) {
      invariantErrors.push(
        ...scopedRelationalLinkInvariants(resultEntry, research, tree, personLinks, batchAssertions, birthPlaceCoords),
      );
    }
    // An update re-checks the move only when it sets the tier or the bridge,
    // re-points the link (a new pairing, as the score gate below reads it), or
    // clears `superseded_by` (a retired link brought back), so a rationale edit
    // on a link written before this rule stays possible.
    const touchesMove =
      op.op !== "update" ||
      ["confidence", "move_bridge", "assertion_id", "person_id", "superseded_by"].some((f) =>
        Object.prototype.hasOwnProperty.call(op.fields ?? {}, f),
      );
    invariantErrors.push(
      ...((op.op === "update" && resultEntry.superseded_by) || !touchesMove
        ? []
        : unexplainedMoveInvariants(resultEntry, research, tree, batchAssertions)),
    );
    // #1731 step 3. The two halves have different scope, and collapsing them
    // into "append only" left the CIRCULAR arm reachable in two calls: append
    // the circular link with a null score, then UPDATE it to 0.995. (An
    // unreachable link is a different matter and is deliberately untouched --
    // the gate is silent there on append too, so the update adds no escalation.)
    //
    //  * requires a recorded score -- append only. The ruling says "refuses a
    //    person_evidence append", and the supersede pattern (§6: append the
    //    corrected link, then update the old entry's superseded_by) would
    //    otherwise be refused on the update, making an unattested link
    //    permanently unretractable.
    //  * forbids a fabricated score -- also on an update that WRITES
    //    match_score. Not on every update: an update that leaves the field
    //    alone must stay legal or a legacy entry carrying a bad score could
    //    never be superseded, which is the same trap in a new place.
    // A re-point is a write. `person_evidence` declares no `allowedFields`, so
    // `assertion_id` and `person_id` are both updatable: moving an attested
    // link onto an unattested assertion, or onto a minted stub, carried the
    // score across untouched while the gate watched only `match_score`. Same
    // two-call shape as the update bypass above, one field over.
    const scoreFields = ["match_score", "assertion_id", "person_id"];
    const writesScore =
      op.op === "append" ||
      (op.op === "update" &&
        scoreFields.some((f) =>
          Object.prototype.hasOwnProperty.call((op as any).fields ?? {}, f),
        ));
    // An attachment link carries no score by design (lead, 2026-10-19: the
    // baseline step assumes every attachment is correct, with no same_person
    // gate). Exempt only on extraction_append's internal flag AND the entry's
    // full attachment shape, so neither half alone reaches the exemption.
    const exemptAttachment = attachmentLink && op.op === "append" && isAttachmentLink(resultEntry);
    if (writesScore && !exemptAttachment) {
      invariantErrors.push(
        ...personEvidenceScoreInvariants(
          resultEntry,
          research,
          tree,
          matchScores ?? new Map<string, MatchScoreFile>(),
          batchAssertions,
          // Not `op.op === "append"`: an update that writes the score or
          // re-points the link produces a NEW pairing, which must carry an
          // attestation exactly as an append does. Passing the raw op kind here
          // made the extended `writesScore` above inert -- the gate was called
          // and then returned empty on its first line.
          op.op === "append",
          startingPersonIds,
          createdAssertions,
        ),
      );
    }
  }
  // Only when THIS op is the one setting/changing tier — append always sets it;
  // update only when `fields` names it. An unrelated update to an entry already
  // legitimately proved (in an earlier, separate call) must not re-trigger this.
  if (section === "proof_summaries") {
    const tierTouchedThisOp =
      op.op === "append" || Object.prototype.hasOwnProperty.call(op.fields ?? {}, "tier");
    if (tierTouchedThisOp) {
      invariantErrors.push(...proofSummaryInvariants(resultEntry, preCallExhaustiveDeclared));
      // Tier-gated like the line above, so a narrative edit to a summary that
      // predates the rule is not refused.
      invariantErrors.push(...unlinkedProofInvariants(resultEntry, preCallResearch));
      invariantErrors.push(...unlinkedParentProofInvariants(resultEntry, preCallResearch));
    }
    // Also on a narrative or claims edit: a parentage can be stated in prose
    // after the tier is already set, by an update that leaves `tier` alone.
    if (
      tierTouchedThisOp ||
      Object.prototype.hasOwnProperty.call(op.fields ?? {}, "narrative_markdown") ||
      Object.prototype.hasOwnProperty.call(op.fields ?? {}, "claims")
    ) {
      invariantErrors.push(...unlinkedParentNarrativeInvariants(resultEntry, preCallResearch));
    }
    // NOT gated on `tierTouchedThisOp`, unlike the exhaustiveness check above.
    // That gate asks "is this op setting the tier"; this rule asks "does the
    // entry STAND at a tier the open conflict forbids", which an op can reach
    // without naming `tier` at all. Observed 2026-08-21: the agent updated a
    // summary's narrative and left the stale `probable` in place, and the rule
    // never ran. The tier had not been touched — it did not need to be, because
    // it was already wrong.
    //
    // The cost is that any edit to such an entry is refused until its tier
    // comes down, which is the rule applied consistently rather than a
    // side effect: a conclusion standing above `not_proved` on a disputed
    // source is invalid whether or not this call put it there. Lowering the
    // tier in the same update satisfies it, so the deny stays satisfiable.
    invariantErrors.push(...conflictedSourceInvariants(resultEntry, preCallResearch));
    // Also NOT tier-gated, and reads LIVE research: a conflict resolved only in
    // prose must reach conflicts[] before any summary relies on it. See
    // `unpersistedConflictResolutionInvariants` for scope and what it lets through.
    invariantErrors.push(...unpersistedConflictResolutionInvariants(resultEntry, research));
    // Reads LIVE research, not the pre-call snapshot: two appends inside one
    // batch must collide with each other, not just with what was already there.
    //
    // NOT gated on `op.op === "append"`, and for the same reason the rule above
    // is not gated on `tierTouchedThisOp`: the question is "does this question
    // end up with two summaries", which an UPDATE reaches by setting
    // `question_id`. The gate asked about the op instead of the outcome and an
    // update walked past it. `oneSummaryPerQuestion` excludes the entry by id,
    // so an ordinary update of an existing summary still passes.
    invariantErrors.push(...oneSummaryPerQuestion(resultEntry, research, resultEntry?.id));
    invariantErrors.push(...narrativeAndSearchSummaryTogether(op, resultEntry, priorStamp, research));
    // Reads PRE-CALL tree and PRE-CALL research: a same-batch hypothesis write
    // does not satisfy this precondition. Gated only on the entry's standing
    // tier (not_proved/disproved pass), not on which fields this op touches.
    invariantErrors.push(...competingParentSetsInvariants(resultEntry, preCallResearch, tree));
    // Judged only when THIS op sets what the budget reads: an append always does,
    // an update when it names the narrative or the vehicle. An unrelated edit to
    // a summary already over budget is not told again, and neither is a narrative
    // changed through `edits` unless the edit is what took it over.
    const setsBudgetInput =
      op.op === "append" ||
      Object.prototype.hasOwnProperty.call(op.fields ?? {}, "narrative_markdown") ||
      Object.prototype.hasOwnProperty.call(op.fields ?? {}, "vehicle");
    const overBudgetBeforeEdit =
      NARRATIVE_EDITED_OPS.has(op) &&
      !Object.prototype.hasOwnProperty.call(op.fields ?? {}, "vehicle") &&
      narrativeLengthWarnings({ ...resultEntry, narrative_markdown: priorNarrative }).length > 0;
    if (setsBudgetInput && !overBudgetBeforeEdit) {
      opWarnings.push(...narrativeLengthWarnings(resultEntry));
    }
  }
  if (invariantErrors.length > 0) {
    throw new ResearchAppendError(invariantErrors);
  }

  return {
    section,
    op: op.op,
    entryId,
    arrayIndex,
    warnings: opWarnings.length > 0 ? opWarnings : undefined,
  };
}

// ─── Composite persist + enforcement pre-pass ───────────────────────────────

/** The converter-resolved standard_place a sidecar record's simplified gedcomx
 *  gives one persona's own fact: the facts of `persona` (its own, and those of a
 *  relationship whose `person1` or `person2` it is; a ParentChild relationship's
 *  `parent`/`child` facts are not read) of type `factType` (`canonicalFactKey`)
 *  and with place `place` (trimmed, case-insensitive). The one name every such
 *  fact carries; every name, when they carry two or more, which the writers
 *  read as the record disagreeing with itself; else none. So one person's name
 *  never lands on another person's fact, and one fact's name never lands on
 *  another fact of the same person. An assertion naming no persona reads
 *  nothing. The one way the engine takes FamilySearch's standardization from a
 *  record: Lever B's copy, and `RecordStandards`. */
function sidecarStandardPlaces(gx: any, persona: unknown, factType: unknown, place: string): string[] {
  if (!gx || typeof gx !== "object" || typeof persona !== "string" || persona === "") return [];
  const facts: any[] = [];
  for (const p of Array.isArray(gx.persons) ? gx.persons : []) {
    if (p?.id === persona && Array.isArray(p.facts)) facts.push(...p.facts);
  }
  for (const r of Array.isArray(gx.relationships) ? gx.relationships : []) {
    if ((r?.person1 === persona || r?.person2 === persona) && Array.isArray(r.facts)) facts.push(...r.facts);
  }
  const want = place.trim().toLowerCase();
  const values = facts
    .filter(
      (f) =>
        typeof f?.place === "string" &&
        f.place.trim().toLowerCase() === want &&
        canonicalFactKey(f.type) === canonicalFactKey(factType),
    )
    .map((f) => f.standard_place);
  const names = [...new Set(values.filter((v): v is string => typeof v === "string"))];
  return names.length === 1 && values.some((v) => typeof v !== "string") ? [] : names;
}

/**
 * FamilySearch's standard_places for a place text on the records stored
 * assertions cite, read through one call's sidecar reader:
 * `sidecarStandardPlaces` on each assertion's record persona, in the result for
 * its `record_id` in the sidecar its log entry names, for its own `fact_type`
 * unless `factType` is given (a tree fact's own type). The distinct names those
 * records give: one is FamilySearch's answer, two or more are doubt.
 * `tree_edit` and `tree_correct` read a tree fact's cited records through it,
 * and a caller's timeline its events' assertions.
 */
export class RecordStandards {
  private readonly logRefs = new Map<string, string>();

  constructor(
    research: unknown,
    private readonly read: (ref: string) => Promise<any>,
  ) {
    const log = (research as any)?.log;
    for (const e of Array.isArray(log) ? log : []) {
      if (typeof e?.id === "string" && typeof e.results_ref === "string") this.logRefs.set(e.id, e.results_ref);
    }
  }

  async for(assertions: readonly any[], place: string, factType?: string): Promise<string[]> {
    const names = new Set<string>();
    for (const a of assertions) {
      const ref = this.logRefs.get(a?.log_entry_id);
      const results = ref ? (await this.read(ref))?.payload?.results : undefined;
      for (const r of Array.isArray(results) ? results : []) {
        if (typeof r?.recordId !== "string" || arkToBareId(r.recordId) !== arkToBareId(String(a.record_id ?? ""))) continue;
        for (const name of sidecarStandardPlaces(r.gedcomx, a.record_persona_id, factType ?? a.fact_type, place)) {
          names.add(name);
        }
      }
    }
    return [...names];
  }
}

/** A sidecar result's record id: record_search and record_read stage GedcomX
 *  personas keyed on `recordId`, the persona-less producers (full text,
 *  external links) transcripts keyed on `id` (#2038). */
function sidecarResultId(tool: string, r: any): string | undefined {
  const v = PERSONA_BEARING_PRODUCERS.has(tool) ? r?.recordId : r?.id;
  return typeof v === "string" ? v : undefined;
}

/**
 * The country of the sidecar record an assertion comes from, by its producer,
 * never read off the assertions' places (`countryOfPlace` names it, and says
 * which places are no country):
 * - a FamilySearch record (record_search, record_read): its Collection source's
 *   coverage place, the coverage's `standard_place` (a live `record_read`
 *   resolves it), else its `place_rep_id` resolved by id. A World collection
 *   gives none (matcher-lab m13's list builder, stage S2);
 * - a page `image_transcribe` read: its source's `place`, the coverage place of
 *   the FamilySearch image group (the film) it was read from (lead, 2026-10-29).
 *   A full-text record is extracted from its page this way.
 * Null when the record names no such place.
 */
async function recordCountryOf(producer: string | undefined, record: any): Promise<string | null> {
  if (producer === "image_transcribe") {
    return typeof record?.source?.place === "string" ? countryOfPlace(record.source.place) : null;
  }
  const sources: any[] = Array.isArray(record?.gedcomx?.sources) ? record.gedcomx.sources : [];
  const coverage = sources.find((s) => s?.resource_type === "Collection")?.coverage;
  let place: string | null = typeof coverage?.standard_place === "string" ? coverage.standard_place : null;
  if (!place && typeof coverage?.place_rep_id === "string") place = await repIdToStandardPlace(coverage.place_rep_id);
  return place ? countryOfPlace(place) : null;
}

/** The sidecar record an assertion's country comes from: the result its
 *  record_id names, else, for a page `image_transcribe` staged, that page. The
 *  sidecar holds the one transcription its log entry logged
 *  (`extraction_append` logs the staged ref it cites), and a record_id the
 *  caller chose ("capture:…", a record ARK) need not be the page's id. */
function countrySidecarRecord(producer: string | undefined, results: any[] | null, matched: any): any {
  if (matched) return matched;
  return producer === "image_transcribe" && results?.length === 1 ? results[0] : null;
}

interface PreparedOps {
  treeMutated: boolean;
  /** Attestations for every record a `person_evidence` op in this batch links
   *  to, read once here because `applyOne` is synchronous and holds no
   *  `projectPath`. Empty when nothing in the batch links. */
  matchScores: Map<string, MatchScoreFile>;
  birthPlaceCoords: BirthPlaceCoords;
  /** Existing assertions plus this batch's predicted appends, so the score gate
   *  resolves a link's assertion whatever order the ops arrive in. */
  batchAssertions: Map<string, any>;
  /** Person ids in the write-once starting-tree baseline. Empty when the
   *  project predates it, which the circular test treats as "unknown". */
  startingPersonIds: ReadonlySet<string>;
  /** The write-once starting tree itself (null for a legacy project): the
   *  baseline relationships the circular-corroboration gate reads. */
  startingTree: SimplifiedGedcomX | null;
  /** Assertion ids this call creates; they cannot already carry a score. */
  createdAssertions: ReadonlySet<string>;
  /** Live person_evidence plus this batch's appends, for the contradiction
   *  gate's two-party arm. */
  personLinks: PersonLink[];
  sourceDescriptionId?: string;
  sourceReuse?: SourceReuseEcho;
  resolvedPlaces: ResolvedPlaceEcho[];
  /** Places looked up and given no standard form, each also a warning. */
  unresolvedPlaces: string[];
  warnings: string[];
  /** Verdict sidecar to write iff the whole call validates. */
  verdictFile?: { relPath: string; body: unknown };
}

/** `YYYY-MM-DDTHH-MM-SS` — colons replaced for filesystem safety, matching the
 *  gps-mentor spec's `<short_iso>`. */
function shortIso(timestamp: unknown): string {
  const d = typeof timestamp === "string" ? new Date(timestamp) : new Date();
  const iso = (isNaN(d.getTime()) ? new Date() : d).toISOString();
  return iso.slice(0, 19).replace(/:/g, "-");
}

/** Filesystem-safe slug for the focus/target segments of the verdict filename. */
function fileSlug(v: unknown): string {
  return String(v ?? "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

/**
 * Composite verdict persist. On an `evaluations` append carrying `verdict`,
 * derive the sidecar path, stamp it onto the entry as `file_path`, and hand the
 * body back for the write phase. Nothing touches disk here — the file is only
 * written once the whole document validates, so a rejected call leaves no
 * orphan verdict file behind.
 */
function prepareVerdict(
  input: ResearchAppendInput,
  ops: ResearchAppendOp[],
  fmt: (i: number, msg: string) => string,
  errors: string[],
): PreparedOps["verdictFile"] {
  if (input.verdict === undefined) return undefined;
  const idxs = ops
    .map((o, i) => ({ o, i }))
    .filter(({ o }) => o.section === "evaluations" && o.op === "append");
  if (idxs.length === 0) {
    errors.push("`verdict` is only valid on an `evaluations` append op");
    return undefined;
  }
  if (idxs.length > 1) {
    errors.push("`verdict` applies to a single evaluations append; this call has more than one");
    return undefined;
  }
  const { o, i } = idxs[0];
  if (!input.verdict || typeof input.verdict !== "object" || Array.isArray(input.verdict)) {
    errors.push(fmt(i, "`verdict` must be an object (the structured verdict body)"));
    return undefined;
  }
  const entry = o.entry as any;
  if (!entry || typeof entry !== "object") return undefined;
  if (entry.file_path != null) {
    errors.push(
      fmt(
        i,
        "entry carries a file_path AND the call supplies `verdict` — use one: pass `verdict` " +
          "and let the tool write the file and stamp file_path, or write the file yourself and " +
          "pass file_path alone",
      ),
    );
    return undefined;
  }
  const focus = fileSlug(entry.focus);
  const target = fileSlug(entry.target_id);
  if (!focus || !target) {
    errors.push(fmt(i, "`verdict` requires the entry to carry `focus` and `target_id` (they name the file)"));
    return undefined;
  }
  const relPath = `evaluations/${focus}-${target}-${shortIso(entry.timestamp)}.json`;
  entry.file_path = relPath;
  return { relPath, body: input.verdict };
}

/** Normalized-exact repository comparison key (trim + casefold). */
function normalizeRepository(v: unknown): string {
  return typeof v === "string" ? v.trim().toLowerCase() : "";
}

/** The assertion ids an entry of `section` cites as evidence. */
function assertionIdsCited(section: unknown, e: any): string[] {
  if (!e || typeof e !== "object") return [];
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const one = (v: unknown) => (typeof v === "string" ? [v] : []);
  switch (section) {
    case "person_evidence":
      return one(e.assertion_id);
    case "conflicts":
      return [...list(e.competing_assertion_ids), ...one(e.preferred_assertion_id)];
    case "hypotheses":
      return [...list(e.supporting_assertion_ids), ...list(e.contradicting_assertion_ids)];
    case "proof_summaries":
      return [
        ...list(e.supporting_assertion_ids),
        ...(Array.isArray(e.claims) ? e.claims.flatMap((c: any) => list(c?.supporting_assertion_ids)) : []),
      ];
    case "timelines":
      return Array.isArray(e.events) ? e.events.flatMap((ev: any) => list(ev?.assertion_ids)) : [];
    case "questions":
      return list(e.resolution_assertion_ids);
    default:
      return [];
  }
}

/** #3678: refuse an op that newly cites a retired assertion as evidence. A cited id
 *  the stored entry already held is not new. */
function retiredAssertionCitations(
  ops: ResearchAppendOp[],
  research: any,
  fmt: (i: number, msg: string) => string,
): string[] {
  const retired = new Map<string, unknown>();
  for (const a of Array.isArray(research?.assertions) ? research.assertions : []) {
    if (typeof a?.id === "string" && !isLiveAssertion(a)) retired.set(a.id, a.superseded_by);
  }
  if (retired.size === 0) return [];
  const out: string[] = [];
  ops.forEach((op, i) => {
    const stored =
      op.op === "update" && Array.isArray(research?.[op.section as string])
        ? research[op.section as string].find((x: any) => x?.id === op.entryId)
        : undefined;
    const had = new Set(assertionIdsCited(op.section, stored));
    const cited = assertionIdsCited(op.section, op.op === "append" ? op.entry : op.fields);
    const bad = [...new Set(cited.filter((id) => retired.has(id) && !had.has(id)))];
    if (bad.length === 0) return;
    out.push(
      fmt(
        i,
        `cites ${bad.map((id) => `${id} (superseded_by ${retired.get(id)})`).join(", ")}: a re-extraction retired ` +
          `${bad.length === 1 ? "it" : "them"}, so ${bad.length === 1 ? "it is" : "they are"} not evidence. Cite the ` +
          "replacement, or nothing where it was retracted.",
      ),
    );
  });
  return out;
}

/** An assertions update that only retires the entry: `superseded_by` set non-null,
 *  plus at most `superseded_reason`. */
function isRetirementFields(fields: unknown): boolean {
  if (!fields || typeof fields !== "object") return false;
  const f = fields as Record<string, unknown>;
  const keys = Object.keys(f).filter((k) => k !== "id");
  return f.superseded_by != null && keys.every((k) => k === "superseded_by" || k === "superseded_reason");
}

/**
 * `extraction_append`'s re-extraction (#3678): the update ops that retire a
 * record's old assertions against this batch's new ones, or the refusals.
 *
 * Run on the document as read under the lock, so ids chosen from an earlier read
 * are checked again: each must still be live and on the record, and nothing may
 * rest on any of them (`assertionReferrers`). Old and new are paired by the person
 * in the record (`record_persona_id`, else `record_role`) and the canonical fact
 * type, in order; an old assertion with no counterpart is "retracted" with the
 * reason.
 */
function planRetirement(
  research: any,
  tree: any,
  ops: ResearchAppendOp[],
  retire: RetireAssertions,
): { errors: string[]; updates: ResearchAppendOp[]; retracted: Set<string> } {
  const byId = new Map<string, any>(
    (Array.isArray(research?.assertions) ? research.assertions : []).filter((a: any) => typeof a?.id === "string").map((a: any) => [a.id, a]),
  );
  const errors: string[] = [];
  const bare = arkToBareId(retire.recordId);
  for (const id of retire.ids) {
    const a = byId.get(id);
    if (!a) errors.push(`${id} is not an assertion in research.json.`);
    else if (!isLiveAssertion(a)) errors.push(`${id} is already retired (superseded_by ${a.superseded_by}).`);
    else if (typeof a.record_id !== "string" || arkToBareId(a.record_id) !== bare) {
      errors.push(`${id} is an assertion of ${a.record_id}, not of ${retire.recordId}.`);
    }
  }
  if (errors.length === 0) errors.push(...assertionReferrers(research, tree, new Set(retire.ids)));
  if (errors.length > 0) return { errors, updates: [], retracted: new Set() };

  const key = (a: any) =>
    `${typeof a.record_persona_id === "string" && a.record_persona_id !== "" ? `persona:${a.record_persona_id}` : `role:${a.record_role}`}\u0000${canonicalFactKey(a.fact_type)}`;
  const fresh = new Map<string, string[]>();
  for (const [id, entry] of predictedAssertions(research, ops)) {
    fresh.set(key(entry), [...(fresh.get(key(entry)) ?? []), id]);
  }
  const updates: ResearchAppendOp[] = [];
  const retracted = new Set<string>();
  for (const id of retire.ids) {
    const next = fresh.get(key(byId.get(id)))?.shift();
    if (next === undefined) retracted.add(id);
    updates.push({
      section: "assertions",
      op: "update",
      entryId: id,
      fields: next !== undefined
        ? { superseded_by: next }
        : { superseded_by: RETRACTED, superseded_reason: `re-extraction of ${retire.recordId} on ${today()} wrote no counterpart` },
    });
  }
  return { errors: [], updates, retracted };
}

/** §3.4.3 re-extraction key: which extracted fact an assertion is, for the
 *  guard below. `undefined` = not comparable (exempt or malformed). The key is
 *  (source, record, log entry, person in the record, canonical fact type):
 *  the person is `record_persona_id` when set, else `record_role`; the fact type
 *  goes through the same alias fold the tool applies at write; the log entry
 *  scopes it to ONE extraction pass, so an image-transcription pass (its own log
 *  entry) may add a second reading of a fact, while a re-run of the same pass —
 *  a resumed or re-delegated extractor, which reuses its log entry — may not.
 *  Values are ignored on purpose: a re-run re-decides its wording, so a value key
 *  misses exactly the duplicate this exists for. `record_role: "absent"`
 *  (negative evidence) is exempt — it names no persona, so its key cannot tell
 *  two absent people apart. Exported for dev/replay-reextraction-guard.ts. */
export function reextractionKey(a: any): string | undefined {
  if (!a || typeof a !== "object") return undefined;
  if (typeof a.source_id !== "string" || typeof a.record_id !== "string" || typeof a.fact_type !== "string") {
    return undefined;
  }
  if (a.record_role === "absent") return undefined;
  const who =
    typeof a.record_persona_id === "string" && a.record_persona_id !== ""
      ? `persona:${a.record_persona_id}`
      : typeof a.record_role === "string"
        ? `role:${a.record_role}`
        : undefined;
  if (who === undefined) return undefined;
  const log = typeof a.log_entry_id === "string" && a.log_entry_id !== "" ? a.log_entry_id : "";
  return [a.source_id, arkToBareId(a.record_id), log, who, canonicalFactKey(a.fact_type)].join("\u0000");
}

/** A fact type's comparison key after the `FACT_TYPE_ALIASES` fold: "Baptism",
 *  `baptism` and `christening` are one fact type, as are "BirthRegistration" and
 *  `birth_registration`. */
function canonicalFactKey(ft: unknown): string {
  const key = factTypeKey(ft);
  return Object.hasOwn(FACT_TYPE_ALIASES, key) ? factTypeKey(FACT_TYPE_ALIASES[key]) : key;
}

/** The canonical spelling of a fact_type for a message (the alias fold §3.7 applies). */
function factLabel(ft: unknown): string {
  if (typeof ft !== "string") return String(ft);
  const k = factTypeKey(ft);
  return Object.hasOwn(FACT_TYPE_ALIASES, k) ? FACT_TYPE_ALIASES[k] : ft;
}

/** §3.4.3 re-extraction guard: refuse an assertions append whose
 *  `reextractionKey` an assertion in the PRE-CALL document already holds — a
 *  second copy of an extracted fact reads downstream as independent
 *  corroboration. Batch-internal pairs are never compared: two same-typed facts
 *  in one pass are ordinary extraction (a birth date and a birth place). */
function reextractionCollisions(
  ops: ResearchAppendOp[],
  research: any,
  fmt: (i: number, msg: string) => string,
): string[] {
  // A retired assertion, or one this batch retires (#3678), is no longer the
  // record's reading, so a fresh copy of its fact is not a duplicate.
  const retiring = new Set(
    ops
      .filter((op) => op.section === "assertions" && op.op === "update" && isRetirementFields(op.fields))
      .map((op) => op.entryId),
  );
  const existing = new Map<string, string[]>();
  for (const a of Array.isArray(research.assertions) ? research.assertions : []) {
    if (!isLiveAssertion(a) || retiring.has(a.id)) continue;
    const k = reextractionKey(a);
    if (k === undefined || typeof a.id !== "string") continue;
    existing.set(k, [...(existing.get(k) ?? []), a.id]);
  }
  if (existing.size === 0) return [];
  const out: string[] = [];
  ops.forEach((op, i) => {
    if (op.section !== "assertions" || op.op !== "append") return;
    const e = op.entry as any;
    const k = reextractionKey(e);
    const ids = k === undefined ? undefined : existing.get(k);
    if (!ids) return;
    out.push(
      fmt(
        i,
        `record ${e.record_id} is already extracted on ${e.source_id}` +
          `${e.log_entry_id ? ` under ${e.log_entry_id}` : ""}: ${ids.join(", ")} already ` +
          `record${ids.length === 1 ? "s" : ""} ${factLabel(e.fact_type)} for this person (${
            e.record_persona_id ? `persona ${e.record_persona_id}` : `role ${e.record_role}`
          }). This batch re-persists the record, so it is a re-extraction: refine the existing ` +
          `assertion${ids.length === 1 ? "" : "s"} with an assertions \`update\` op by id instead of ` +
          `appending a second copy — a duplicate reads as independent corroboration. If you are ` +
          `retrying a call that timed out, it most likely committed and these ids are its own writes. If this ` +
          `is a genuinely distinct fact of the same type (a second relationship), append it in a call without ` +
          `the sources op — never \`update\` an existing assertion to a different fact. A fact ` +
          `type this person has no assertion for yet may still be appended.`,
      ),
    );
  });
  return out;
}

/**
 * The composite/enforcement pre-pass. Runs BEFORE the apply loop, mutating the
 * in-memory `tree` (S entry) and the ops' entries (stamps, auto-fills,
 * canonicalizations) in place. Collects every op-scoped error (all failing ops
 * are named at once) and throws a single ResearchAppendError when any exist.
 *
 * 0. Source-reuse auto-detection (§3.4.1): when the batch's assertion appends
 *    cite a `record_id` an existing research source already covers, convert
 *    the sources append into an update of that source (same repository) or
 *    stamp the existing S id onto it (different repository) — either way the
 *    S-create is skipped and the decision is echoed as `sourceReuse`.
 * 1. `sourceDescription` → create the tree `S` entry (shared id allocator) and
 *    stamp the batch's single sources append op's `gedcomx_source_description_id`.
 * 2. Every sources append op must reference an S entry that exists (created in
 *    step 1 or pre-existing — the multi-repository reuse pattern). Op-level
 *    precondition, NOT a document-validator rule.
 * 3. Auto-stamp `source_id`: exactly one sources append op in the batch → every
 *    assertions append op that omits `source_id` gets its (deterministic) id.
 * 4. D2 persona/record-id matrix per assertions append op (see spec §3.5).
 * 5. Place levers: sidecar-copy-first standard_place resolution + geocoding,
 *    and the country-contradiction guard.
 */
/** Every record id a `person_evidence` op in this batch will link to.
 *
 *  An `append` op must NOT carry an id -- the tool assigns it in `applyOne` --
 *  so an assertion appended earlier in the same `ops` array cannot be found by
 *  id. Its id is PREDICTED here by replaying the same assignment rule
 *  `applyOne` uses, in op order, which spec §3.3 explicitly permits a caller to
 *  do. Without this, a composite "append the assertion, then link it" batch
 *  resolves no record and the refusal denies every one of them.
 */
function batchAssertionsById(research: any, ops: ResearchAppendOp[]): Map<string, any> {
  const existing: any[] = Array.isArray(research?.assertions) ? research.assertions : [];
  const byId = new Map<string, any>();
  for (const a of existing) if (a && typeof a.id === "string") byId.set(a.id, a);
  for (const [id, e] of predictedAssertions(research, ops)) byId.set(id, e);
  return byId;
}

/** The assertions this batch's appends will create, by id: the ids are predicted
 *  by replaying the assignment over the document as it stood, in op order. */
function predictedAssertions(research: any, ops: ResearchAppendOp[]): Map<string, any> {
  const existing: any[] = Array.isArray(research?.assertions) ? research.assertions : [];
  const predicted = new Map<string, any>();
  const running = [...existing];
  for (const op of ops) {
    if (op.section !== "assertions" || op.op !== "append") continue;
    const entry = (op as any).entry;
    if (!entry || typeof entry !== "object") continue;
    const id = nextResearchId(running, "a_");
    predicted.set(id, entry);
    running.push({ ...entry, id });
  }
  return predicted;
}

/** The assertion ids this call CREATES, by the same replay. Distinct from "not
 *  in `research.assertions`": `applyOne` mutates that array as the batch
 *  applies, so an assertion appended earlier in the SAME call is already there
 *  by the time a later op is checked -- while still unpersisted, and so still
 *  invisible to `same_person`, which reads the file. */
function createdAssertionIds(research: any, ops: ResearchAppendOp[]): Set<string> {
  const existing: any[] = Array.isArray(research?.assertions) ? research.assertions : [];
  const running = [...existing];
  const out = new Set<string>();
  for (const op of ops) {
    if (op.section !== "assertions" || op.op !== "append") continue;
    const entry = (op as any).entry;
    if (!entry || typeof entry !== "object") continue;
    const id = nextResearchId(running, "a_");
    out.add(id);
    running.push({ ...entry, id });
  }
  return out;
}

/** Coordinates for every standard place the contradiction gate's distance test
 *  will need on this batch's person_evidence ops, under one budget. The ops are
 *  replayed in order, the way `applyOne` will apply them: an assertions update
 *  changes the assertion later links compare, and an update's link is its
 *  post-merge one. An update retiring a link is not checked. */
async function prefetchBirthPlaceCoords(
  research: any,
  ops: ResearchAppendOp[],
  tree: any,
  personLinks: ReadonlyArray<PersonLink>,
  batchAssertions: Map<string, any>,
): Promise<BirthPlaceCoords> {
  const assertions = new Map(batchAssertions);
  const live: any[] = Array.isArray(research?.person_evidence) ? research.person_evidence : [];
  const names: string[] = [];
  for (const op of ops) {
    const fields = (op as any).fields ?? {};
    if (op.section === "assertions" && op.op === "update" && typeof op.entryId === "string") {
      const cur = assertions.get(op.entryId);
      if (cur) assertions.set(op.entryId, { ...cur, ...fields });
      continue;
    }
    if (op.section !== "person_evidence") continue;
    let entry: any;
    // Whether the op makes the pairing, the condition `applyOne` re-checks
    // scoped relationship links on: an append, or an update that re-points or
    // revives a link.
    let reRaising = true;
    if (op.op === "update") {
      if (fields.superseded_by) continue;
      const prior = live.find((e: any) => e?.id === op.entryId) ?? {};
      entry = { ...prior, ...fields };
      reRaising =
        !!prior.superseded_by ||
        prior.assertion_id !== entry.assertion_id ||
        prior.person_id !== entry.person_id;
    } else {
      entry = (op as any).entry;
    }
    if (!entry || typeof entry !== "object") continue;
    names.push(...birthPlaceCoordNames(entry, research, tree, personLinks, assertions));
    if (!reRaising) continue;
    for (const l of relationalLinksScopedBy(entry, research, personLinks, assertions)) {
      names.push(...birthPlaceCoordNames(l, research, tree, personLinks, assertions));
    }
  }
  if (names.length === 0) return new Map();
  return lookupWithin(names, (name) => standardPlaceToCoords(name), BIRTH_PLACE_COORDS_BUDGET_MS);
}

function recordIdsForPersonEvidence(research: any, ops: ResearchAppendOp[]): Set<string> {
  const byId = batchAssertionsById(research, ops);
  const out = new Set<string>();
  const live: any[] = Array.isArray(research?.person_evidence) ? research.person_evidence : [];
  for (const op of ops) {
    if (op.section !== "person_evidence") continue;
    // An update's assertion is its POST-MERGE one: the field when the op sets
    // it, else the target entry's. Reading only `entry.assertion_id` loaded no
    // attestation for an update, so re-point ops refused work that was attested.
    let aid: unknown;
    if (op.op === "update") {
      const fields = (op as any).fields ?? {};
      aid = Object.prototype.hasOwnProperty.call(fields, "assertion_id")
        ? fields.assertion_id
        : live.find((e: any) => e?.id === (op as any).entryId)?.assertion_id;
    } else {
      aid = (op as any).entry?.assertion_id;
    }
    if (typeof aid !== "string") continue;
    const a = byId.get(aid);
    const rec = a?.record_id ?? null;
    if (typeof rec === "string" && rec !== "") out.add(rec);
  }
  return out;
}

/** Free text and single names are not checked: a lone name is where FamilySearch
 *  picks a wrong same-named place, and regions ("Pennsylvania Anthracite Coal
 *  Region") are not in the standard at all. */
const NOT_A_PLACE_LIST = /\sand\s|[()\u2014\u2013/;&]/i;

function isCheckablePlaceList(forPlace: unknown): forPlace is string {
  return (
    typeof forPlace === "string" &&
    !NOT_A_PLACE_LIST.test(forPlace) &&
    placeSegments(forPlace).length >= 2
  );
}

/**
 * Refuse a `localities` write whose `for_place` names a first place FamilySearch's
 * place standard does not have (issue #3696). Runs on an append, and on an update
 * that sets `for_place`. A failed lookup writes with a warning, never refuses. Skipped
 * when an earlier gate already refused the batch, so no lookup runs under the lock
 * for a call that fails anyway.
 * Deliberately not gated on `input.resolveStandardPlace`, which governs assertion
 * geocoding only.
 */
async function checkLocalityFirstPlaces(
  ops: ResearchAppendOp[],
  errors: string[],
  warnings: string[],
  fmt: (i: number, msg: string) => string,
): Promise<void> {
  if (errors.length > 0) return;
  for (const [i, op] of ops.entries()) {
    if (op.section !== "localities") continue;
    const body = op.op === "append" ? op.entry : op.op === "update" ? op.fields : undefined;
    if (!body || typeof body !== "object" || !Object.hasOwn(body, "for_place")) continue;
    const forPlace = (body as Record<string, unknown>).for_place;
    if (!isCheckablePlaceList(forPlace)) continue;
    const { status } = await checkFirstPlace(forPlace);
    if (status === "lookup_failed") {
      warnings.push(
        fmt(
          i,
          `for_place '${forPlace}' could not be checked against FamilySearch's place standard ` +
            "(the lookup failed); written unchecked",
        ),
      );
    } else if (status === "mismatch" || status === "not_found") {
      const segments = placeSegments(forPlace);
      const [first, context] = [segments[0], segments[segments.length - 1]];
      errors.push(
        fmt(
          i,
          `for_place '${forPlace}': FamilySearch's place standard has no place '${first}' there. ` +
            `Look up '${first}' with place_search, contextName '${context}'. If it returns a match, ` +
            "write for_place from that standard place and re-send. If it returns nothing, do not " +
            "write this entry: return to your caller saying the place did not resolve.",
        ),
      );
    }
  }
}

/**
 * A caller's own standard_place on a timeline event is judged as a tree fact's
 * is (place-verdict.ts): kept, in FamilySearch's spelling and with its
 * distances, when it is a FamilySearch standard place that fits the event's
 * place text (`fitsText`), else replaced by the engine's answer (FamilySearch's
 * own on the records of the event's assertions, `RecordStandards`, else the
 * resolver's when it fits the text) or null, with a warning. The distances
 * measured from it, on that event and the next, become null when the
 * replacement is another place, not the same place spelled another way.
 */
async function judgeTimelinePlaces(
  ops: ResearchAppendOp[],
  research: any,
  standards: RecordStandards,
  warnings: string[],
  fmt: (i: number, msg: string) => string,
): Promise<void> {
  for (const [i, op] of ops.entries()) {
    if (op.section !== "timelines") continue;
    const events = ((op.op === "append" ? op.entry : op.fields) as { events?: unknown } | undefined)?.events;
    if (!Array.isArray(events)) continue;
    for (const [k, event] of events.entries()) {
      const was = event?.standard_place;
      if (typeof was !== "string") continue;
      const judged = await judgeSupplied(event.place, was, async (place) =>
        placeAnswer(
          place,
          await standards.for(assertionsNamed(event.assertion_ids, research), place),
          () => resolveStandardPlace(place),
        ),
      );
      if (judged.standardPlace === was) continue;
      event.standard_place = judged.standardPlace;
      if (judged.warning === undefined) continue;
      if (judged.standardPlace === null || !(await samePlace(was, judged.standardPlace))) {
        for (const e of [event, events[k + 1]]) {
          if (typeof e?.distance_from_previous_km === "number") e.distance_from_previous_km = null;
        }
      }
      warnings.push(fmt(i, `events[${k}]: ${judged.warning}`));
    }
  }
}

/** The assertions `ids` names. */
function assertionsNamed(ids: unknown, research: any): any[] {
  const wanted = new Set(Array.isArray(ids) ? ids : []);
  return (Array.isArray(research?.assertions) ? research.assertions : []).filter((a: any) => wanted.has(a?.id));
}

/** The `payload.results` of a sidecar read through `sidecarReader`, or null. */
function sidecarResultsReader(read: (ref: string) => Promise<any>): (ref: string) => Promise<any[] | null> {
  return async (ref) => {
    const results = (await read(ref))?.payload?.results;
    return Array.isArray(results) ? results : null;
  };
}

/** Pre-processes a batch before commit: §3.4.1 source-reuse auto-detection
 *  (including updates-only batches), §3.4.2 verdict sidecar, §3.4.3 re-extraction
 *  guard, sourceDescription → tree S entry, auto-stamp source_id, D2 persona
 *  matrix, place levers, and match-score gates. Returns the prepared state or
 *  collected errors. */
async function prepareOps(
  input: ResearchAppendInput,
  ops: ResearchAppendOp[],
  research: any,
  tree: SimplifiedGedcomX,
  projectPath: string,
  fmt: (i: number, msg: string) => string,
  options: ResearchAppendOptions,
  readSidecar: (ref: string) => Promise<any>,
): Promise<PreparedOps> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const resolvedPlaces: ResolvedPlaceEcho[] = [];
  const unresolvedPlaces: string[] = [];
  let treeMutated = false;
  // Read the attestations this batch's person_evidence ops will be checked
  // against. Here rather than in `applyOne`, which is synchronous and holds no
  // projectPath. A record with no file yields no entry and the gate refuses.
  const matchScores = new Map<string, MatchScoreFile>();
  const batchAssertions = batchAssertionsById(research, ops);
  const createdAssertions = createdAssertionIds(research, ops);
  const personLinks = batchPersonLinks(research, ops);
  // Read once here: `applyOne` is synchronous. Fail-open (an absent baseline
  // yields an empty set) matches `readStartingTree`'s own contract.
  const startingTree = await readStartingTree(projectPath);
  const startingPersonIds = startingPersonIdsOf(startingTree);
  for (const recordId of recordIdsForPersonEvidence(research, ops)) {
    const file = await readMatchScores(projectPath, recordId);
    if (file !== null) matchScores.set(recordId, file);
  }
  let sourceDescriptionId: string | undefined;
  let sourceReuse: SourceReuseEcho | undefined;

  const findSourcesAppends = (): number[] =>
    ops
      .map((op, i) => ({ op, i }))
      .filter(({ op }) => op.section === "sources" && op.op === "append")
      .map(({ i }) => i);
  let sourcesAppendIdx = findSourcesAppends();

  // ── 0. Source-reuse auto-detection (§3.4.1) ──
  // Engages only for the composite record-persist shape: exactly one sources
  // append with NO explicit S reference (a caller-supplied
  // gedcomx_source_description_id keeps the verified-reuse semantics and is
  // never second-guessed), plus at least one assertions append carrying a
  // record_id — OR, when the batch has zero assertion appends, at least one
  // assertions update op whose pre-call target carries a record_id (and
  // whose fields do not set source_id). Record ids compare canonicalized
  // (arkToBareId), repositories by normalized exact match (trim + casefold).
  let reuseSkipsSourceDescription = false;
  let detectionEngaged = false;
  const assertionAppends = ops.filter(
    (op) => op.section === "assertions" && op.op === "append" && op.entry && typeof op.entry === "object",
  );
  const assertionUpdates = ops.filter(
    (op) => op.section === "assertions" && op.op === "update" && typeof op.entryId === "string",
  );
  if (sourcesAppendIdx.length === 1) {
    const srcOp = ops[sourcesAppendIdx[0]];
    const srcEntry = srcOp.entry as any;
    const batchRecordKeys = new Set(
      assertionAppends
        .map((op) => (op.entry as any).record_id)
        .filter((v: unknown): v is string => factText(v) !== undefined)
        .map((v: string) => arkToBareId(v)),
    );
    // When the batch has zero assertion appends, derive record keys from
    // update targets in the pre-call research.assertions (§3.4.1 updates-only).
    // Never mixed with append-derived keys: a mixed batch that extracts new
    // record X and corrects old record Y would fold X's source onto Y's.
    if (assertionAppends.length === 0 && assertionUpdates.length > 0) {
      const existingAssertions: any[] = Array.isArray(research.assertions) ? research.assertions : [];
      for (const uop of assertionUpdates) {
        // Skip any update op whose fields set source_id — it is re-pointing
        // the assertion, and a fold would leave it naming a source the batch
        // no longer creates.
        if (uop.fields && typeof uop.fields === "object" && Object.prototype.hasOwnProperty.call(uop.fields, "source_id")) continue;
        const target = existingAssertions.find((a: any) => a && a.id === uop.entryId);
        if (target && typeof target.record_id === "string") {
          const bare = arkToBareId(target.record_id);
          if (bare !== "") batchRecordKeys.add(bare);
        }
      }
    }
    if (
      srcEntry &&
      typeof srcEntry === "object" &&
      srcEntry.gedcomx_source_description_id == null &&
      batchRecordKeys.size > 0
    ) {
      detectionEngaged = true;
      // Existing sources covering any of the batch's record ids, in
      // research.sources array order (deterministic "first match").
      const sourceIdsForRecords = sourceIdsForRecordIds(research, batchRecordKeys);
      const matched = (Array.isArray(research.sources) ? research.sources : []).filter(
        (s: any) => s && typeof s === "object" && sourceIdsForRecords.has(s.id),
      );
      if (matched.length > 0) {
        const wantRepo = normalizeRepository(srcEntry.repository);
        const sameRepo =
          wantRepo !== "" ? matched.find((s: any) => normalizeRepository(s.repository) === wantRepo) : undefined;
        if (sameRepo) {
          // Same record + same repository → refine the existing source in
          // place instead of duplicating it. The append becomes an update;
          // the existing S link is kept (never overwritten by the merge).
          const fields: Record<string, unknown> = { ...srcEntry };
          delete fields.id;
          delete fields.gedcomx_source_description_id;
          ops[sourcesAppendIdx[0]] = { section: "sources", op: "update", entryId: sameRepo.id, fields };
          // The step-3 auto-stamp requires a sources APPEND, which no longer
          // exists — stamp the batch's assertions with the existing id here.
          for (const op of assertionAppends) {
            const e = op.entry as any;
            if (e.source_id === undefined || e.source_id === null) e.source_id = sameRepo.id;
          }
          sourceReuse = {
            action: "updated_existing",
            srcId: sameRepo.id,
            sId: typeof sameRepo.gedcomx_source_description_id === "string" ? sameRepo.gedcomx_source_description_id : null,
          };
          reuseSkipsSourceDescription = true;
          sourcesAppendIdx = findSourcesAppends();
        } else {
          // Same record, different repository → new research source, but the
          // record's S entry already exists: reuse the first match's S and
          // skip the S-create even when sourceDescription was supplied.
          const reusedS = matched
            .map((s: any) => s.gedcomx_source_description_id)
            .find((v: unknown): v is string => typeof v === "string" && v !== "");
          if (reusedS !== undefined) {
            srcEntry.gedcomx_source_description_id = reusedS;
            sourceReuse = {
              action: "new_source_reused_s",
              srcId: nextResearchId(Array.isArray(research.sources) ? research.sources : [], "src_"),
              sId: reusedS,
            };
            reuseSkipsSourceDescription = true;
          }
          // A legacy matched source with no S id falls through to the
          // created path (sourceDescription, when present, creates the S).
        }
      }
    }
  }

  // ── 1. sourceDescription → tree S entry ──
  // Ignored (not validated) when §3.4.1 already resolved the source's S —
  // "the tool detects reuse" must not force the caller to predict whether
  // supplying sourceDescription is legal.
  const sd = reuseSkipsSourceDescription ? undefined : input.sourceDescription;
  if (sd !== undefined) {
    if (!sd || typeof sd !== "object" || Array.isArray(sd)) {
      throw new ResearchAppendError("`sourceDescription` must be an object: { title, author?, url? }");
    }
    const extras = Object.keys(sd).filter((k) => !["title", "author", "url"].includes(k));
    if (extras.length > 0) {
      throw new ResearchAppendError(
        `sourceDescription accepts only title, author, url (unexpected: ${extras.join(", ")})`,
      );
    }
    if (typeof sd.title !== "string" || sd.title.trim() === "") {
      throw new ResearchAppendError("sourceDescription.title is required (non-empty string)");
    }
    if (sourcesAppendIdx.length !== 1) {
      throw new ResearchAppendError(
        `sourceDescription requires exactly one sources append op in the call (found ${sourcesAppendIdx.length})`,
      );
    }
    const srcOp = ops[sourcesAppendIdx[0]];
    if (srcOp.entry && typeof srcOp.entry === "object") {
      if ((srcOp.entry as any).gedcomx_source_description_id != null) {
        throw new ResearchAppendError(
          fmt(
            sourcesAppendIdx[0],
            "carries a gedcomx_source_description_id AND the call supplies sourceDescription — " +
              "use one: reference the existing S id (drop sourceDescription), or let sourceDescription create it",
          ),
        );
      }
      const sId = nextId(tree, "S");
      const sEntry: any = { id: sId, title: sd.title };
      if (sd.author !== undefined && sd.author !== null) sEntry.author = sd.author;
      if (sd.url !== undefined && sd.url !== null) sEntry.url = sd.url;
      tree.sources = [...(tree.sources ?? []), sEntry];
      (srcOp.entry as any).gedcomx_source_description_id = sId;
      treeMutated = true;
      sourceDescriptionId = sId;
    }
  }

  // §3.4.1 "created" echo: detection engaged but found no reusable source —
  // the S the composite just created is the answer.
  if (detectionEngaged && !sourceReuse && sourceDescriptionId !== undefined) {
    sourceReuse = {
      action: "created",
      srcId: nextResearchId(Array.isArray(research.sources) ? research.sources : [], "src_"),
      sId: sourceDescriptionId,
    };
  }

  // ── 2. Every sources append op must reference an existing S entry ──
  const treeSourceIds = new Set((tree.sources ?? []).map((s: any) => s?.id).filter(Boolean));
  for (const i of sourcesAppendIdx) {
    const entry = ops[i].entry;
    if (!entry || typeof entry !== "object") continue; // applyOne reports the missing entry
    const ref = (entry as any).gedcomx_source_description_id;
    if (ref == null) {
      errors.push(
        fmt(
          i,
          "a sources append requires either the top-level `sourceDescription` (the tool creates the " +
            "tree S entry and stamps this field) or a `gedcomx_source_description_id` referencing an existing S entry",
        ),
      );
    } else if (!treeSourceIds.has(ref)) {
      const known = [...treeSourceIds].slice(0, 8).join(", ") || "none";
      errors.push(
        fmt(
          i,
          `gedcomx_source_description_id '${ref}' not found in tree.gedcomx.json — pass \`sourceDescription\` ` +
            `to create the S entry, or reference an existing S id (existing: ${known})`,
        ),
      );
    }
  }

  // ── 3. Auto-stamp source_id (single-sources-append batches only) ──
  if (sourcesAppendIdx.length === 1) {
    const pool = Array.isArray(research.sources) ? research.sources : [];
    const autoSourceId = nextResearchId(pool, "src_");
    for (const op of ops) {
      if (op.section !== "assertions" || op.op !== "append") continue;
      const entry = op.entry as any;
      if (!entry || typeof entry !== "object") continue;
      if (entry.source_id === undefined || entry.source_id === null) {
        entry.source_id = autoSourceId; // explicit source_id always wins
      }
    }
  }

  // ── 4 + 5. D2 matrix + place levers, per assertions append op ──
  // D2 auto-fill scoping: the sidecar's primaryId is the SEARCHED persona, not
  // necessarily the persona an arbitrary assertion describes — sidecar personas
  // carry no role labels, so an assertion's record_role cannot be checked
  // against them. The sound proxy is batch shape: stamping primaryId onto every
  // omitted persona is safe only when the batch's assertion appends all cite
  // ONE canonical record_id and ONE distinct record_role (a single-focus
  // extraction). Unscoped auto-fill stamped the focus persona's id onto other
  // household members' assertions (observed silent corruption).
  const batchAssertionRecordKeys = new Set(
    assertionAppends
      .map((op) => (op.entry as any).record_id)
      .filter((v: unknown): v is string => factText(v) !== undefined)
      .map((v: string) => arkToBareId(v)),
  );
  const batchAssertionRoles = new Set(
    assertionAppends
      .map((op) => (op.entry as any).record_role)
      .filter((v: unknown): v is string => factText(v) !== undefined),
  );
  const autoFillScopeOk = batchAssertionRecordKeys.size === 1 && batchAssertionRoles.size === 1;
  const logById = new Map<string, any>();
  for (const e of Array.isArray(research.log) ? research.log : []) {
    if (e && typeof e === "object" && typeof e.id === "string") logById.set(e.id, e);
  }
  const readSidecarResults = sidecarResultsReader(readSidecar);
  const recordStandards = new RecordStandards(research, readSidecar);

  // A place variant's place given only in `value` ("birthplace") is lifted into
  // `place` here, before the lookups below and applyOne's fold. It is a
  // value-derived place, whose lookup applyPlaceLevers must confirm.
  const liftedFromValue = new Set<object>();
  for (const op of ops) {
    if (op.section === "assertions" && op.op === "append" && op.entry && typeof op.entry === "object") {
      const e = op.entry as Record<string, unknown>;
      if (liftVariantPlace(e)) liftedFromValue.add(e);
    }
  }

  // The other places each record's assertions name in this batch, each by its
  // standard_place when it has one, else its place: a bare place ("Shenandoah")
  // is resolved against them, not against the whole world. A record read's
  // named fact carries its as-written text ("Den Haag") as `place`, so the
  // standard is the one that still names the fact's jurisdictions.
  const placesByRecord = new Map<string, string[]>();
  for (const op of ops) {
    const e = op.section === "assertions" && op.op === "append" ? (op.entry as any) : null;
    const place = e ? (factText(e.standard_place) ?? factText(e.place)) : undefined;
    if (!place) continue;
    const key = String(e.record_id ?? "");
    placesByRecord.set(key, [...(placesByRecord.get(key) ?? []), place]);
  }

  /** Place levers (b) then (a) on one assertion's fields, in place. A
   *  standard_place contradicting the place's country is an error, unless
   *  `dropContradiction` or the place is `valueDerived` (lifted from `value`),
   *  when the lookup is dropped instead. A value-derived place, or one written
   *  as prose (`isProse`), keeps a geocoded answer only when its text confirms
   *  it (`unconfirmedByText`, which passes a one-word text and a one-word list
   *  answer). A dropped lookup is warned about and listed in unresolvedPlaces,
   *  never in resolvedPlaces. A place on an assertion flagged
   *  as suspicious text is never looked up, and a refusal shows it as
   *  WITHHELD_SUSPICIOUS. `matchedRecord` is an append's sidecar-matched record
   *  (D2), whose standard_place is copied. `countryRecord` is the sidecar record
   *  the assertion comes from and `countryProducer` the tool that staged it,
   *  which give the resolver the record's country (`recordCountryOf`). */
  const applyPlaceLevers = async (
    entry: any,
    i: number,
    {
      dropContradiction = false,
      valueDerived = false,
      countryProducer,
      countryRecord = null,
      matchedRecord = null,
    }: {
      dropContradiction?: boolean;
      valueDerived?: boolean;
      countryProducer?: string;
      countryRecord?: any;
      matchedRecord?: any;
    } = {},
  ): Promise<void> => {
    const flaggedText = isSuspiciousText(entry.informant_bias_notes);
    const unresolved = (why = "") => {
      warnings.push(`could not resolve standard_place for '${entry.place}' (left unset)${why}`);
      unresolvedPlaces.push(entry.place);
    };
    // ── Place lever (b): never geocode what the source record already
    // resolved — copy the standard_place the matched sidecar record gives this
    // assertion's own fact (same persona, fact type and place string,
    // `sidecarStandardPlaces`), and none when its values disagree.
    // `standard_place: null` is an explicit opt-out
    // (skip resolution + guard); only a fully omitted field triggers
    // resolution. A non-place phrase ("Same House") is left unset, silently: it
    // has no standard form.
    let filled: "sidecar" | "geocoded" | null = null;
    if (
      !flaggedText &&
      factText(entry.place) !== undefined &&
      entry.standard_place === undefined &&
      !isNonPlacePhrase(factText(entry.place)!)
    ) {
      const fromRecord = matchedRecord
        ? sidecarStandardPlaces(matchedRecord.gedcomx, entry.record_persona_id, entry.fact_type, entry.place)
        : [];
      let sp: string | null = fromRecord.length === 1 ? fromRecord[0] : null;
      if (sp) filled = "sidecar";
      if (fromRecord.length > 1) {
        unresolved(`: FamilySearch standardized it differently on its record (${fromRecord.join("; ")})`);
      } else if (!sp && input.resolveStandardPlace !== false) {
        // resolveStandardPlace returns null on a miss and can throw on a
        // failure (a bare name's top-hit search does), and the catch makes the
        // two look the same here — both warrant the warning (a silently
        // unresolved place is part of the wrong-geocode theme).
        try {
          const contextPlaces = (placesByRecord.get(String(entry.record_id ?? "")) ?? [])
            .filter((p) => p !== entry.place);
          const recordCountry = () => recordCountryOf(countryProducer, countryRecord);
          sp = (await resolveStandardPlace(entry.place, { contextPlaces, recordCountry })) ?? null;
        } catch {
          sp = null;
        }
        if (sp) filled = "geocoded";
        else unresolved();
      }
      if (sp) entry.standard_place = sp;
    }

    // ── Place lever (a): country-contradiction guard on the final pair
    // (supplied or resolved). Skipped when standard_place is null/absent.
    if (typeof entry.place !== "string" || typeof entry.standard_place !== "string") return;
    const sp: string = entry.standard_place;
    const verdict = countryConsistency(entry.place, sp);
    if (verdict === "contradiction" && (dropContradiction || valueDerived)) {
      delete entry.standard_place;
      unresolved(`: the lookup's answer '${sp}' names a different country`);
      return;
    }
    if (verdict === "contradiction") {
      errors.push(
        fmt(
          i,
          `standard_place '${sp}' contradicts place '${flaggedText ? WITHHELD_SUSPICIOUS : entry.place}' — the place text ` +
            "names a different country. Re-resolve with place_search / place_search_all and supply the " +
            "correct standard_place, or set standard_place: null if no standard form exists.",
        ),
      );
      return;
    }
    if (verdict === "unverifiable" && filled === "geocoded") {
      const unconfirmed = valueDerived || isProse(entry.place) ? unconfirmedByText(entry.place, sp) : null;
      if (unconfirmed) {
        delete entry.standard_place;
        unresolved(`: the lookup's answer '${sp}' ${unconfirmed}`);
        return;
      }
      warnings.push(
        `resolved standard_place '${sp}' for place '${entry.place}' — the country ` +
          "could not be cross-checked (either the place text names no country, or the standard place " +
          "names none that is recognized — e.g. a historical polity like 'Bohemia'); verify it is the " +
          "right place",
      );
    }
    if (filled) resolvedPlaces.push({ place: entry.place, standardPlace: sp, source: filled });
  };

  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    if (op.section !== "assertions" || op.op !== "append") continue;
    const entry = op.entry as any;
    if (!entry || typeof entry !== "object") continue;

    // ── D2: persona/record-id matrix against the log entry's sidecar ──
    let matchedRecord: any = null;
    let countryProducer: string | undefined;
    let countryRecord: any = null;
    const logId = entry.log_entry_id;
    const logEntry = typeof logId === "string" ? logById.get(logId) : undefined;
    if (logEntry) {
      // An accepted hint's entry stages nothing; extraction_append read the record
      // in the same call and names that staged read, which stands in for a sidecar.
      const hintRef = isAcceptedHint(logEntry) ? options.hintReads?.get(logEntry.id) : undefined;
      const ref = hintRef ?? logEntry.results_ref;
      const producer = hintRef ? "record_read" : logEntry.tool;
      if (!ref) {
        // Staging gap (#699): a record/full-text search that RETURNED results
        // but staged no sidecar. D2 auto-fill resolves record_persona_id from
        // the log entry's sidecar, and it cannot fill what was never staged —
        // proceeding would silently null out every persona id (identity
        // unrecoverable). Reject loudly and point at the fix (re-run WITH
        // projectPath so the host stages the results), rather than persisting
        // the null. Scoped to the staging producers and to searches that
        // actually found something, so legitimate sidecar-less entries below
        // (record_read/PDF/image/pasted, and nil/negative searches) never trip.
        const producerTools = new Set(["record_search", "fulltext_search"]);
        const foundResults =
          logEntry.outcome === "positive" ||
          logEntry.outcome === "partial" ||
          (typeof logEntry.results_examined === "number" &&
            logEntry.results_examined > 0);
        if (producerTools.has(logEntry.tool) && foundResults) {
          const personaBearing = PERSONA_BEARING_PRODUCERS.has(logEntry.tool);
          const lossClause = personaBearing
            ? "record_persona_id cannot be resolved and would be lost"
            : "the retained transcript and the record_id canonicalization would be lost";
          errors.push(
            fmt(
              i,
              `log entry '${logId}' (${logEntry.tool}) returned results but staged no sidecar ` +
                `(results_ref is null) — ${lossClause}. ` +
                "Re-run the search WITH projectPath so the results are staged, then re-append.",
            ),
          );
          continue;
        }
        // No sidecar (an unstaged record_read, PDF, image, pasted records, or a nil/negative
        // search): the field must be absent or null — there is no persona
        // document to point at.
        if (entry.record_persona_id != null) {
          errors.push(
            fmt(
              i,
              `record_persona_id must be null — log entry '${logId}' has no results sidecar ` +
                "(results_ref is null; a record_read logged without stagedResultsRef, or a PDF/image/pasted record, has no persona document to point at)",
            ),
          );
          continue;
        }
      } else if (typeof ref === "string") {
        const results = await readSidecarResults(ref);
        if (results) {
          // record_search and record_read stage GedcomX personas; their results key on
          // `recordId`. fulltext_search stages transcript text (and a legacy
          // external_links_search sidecar holds links) keyed on `id`, with no
          // persona document — matching them on `recordId` (a field they never
          // carry) matched nothing every time, which either rejected a persona-linked write with an empty
          // "expected one of:" list or silently skipped canonicalizing the id
          // (#2038). Pick the id field by producer.
          const personaBearing = PERSONA_BEARING_PRODUCERS.has(producer);
          const resultId = (r: any): string | undefined => sidecarResultId(producer, r);
          const key = arkToBareId(String(entry.record_id ?? ""));
          const matches = results.filter(
            (r) => r && typeof r === "object" && resultId(r) !== undefined && arkToBareId(resultId(r)!) === key,
          );

          // A non-persona producer carries no GedcomX persona, so
          // record_persona_id must be null. Reject a supplied one with a message
          // that says why — never the empty "expected one of:" list the old
          // recordId-only match produced for these sidecars.
          if (!personaBearing && entry.record_persona_id != null) {
            errors.push(
              fmt(
                i,
                `record_persona_id must be null — log entry '${logId}' is ${logEntry.tool}-sourced, ` +
                  "and full-text / external-link results carry transcript text, names and places " +
                  "but no GedcomX personas",
              ),
            );
            continue;
          }

          if (matches.length === 0) {
            // A record_id outside the sidecar is legal when no persona is
            // claimed (e.g. a negative assertion naming the collection
            // searched); with a persona it is a contradiction. Only reachable
            // for a persona-bearing producer — the non-persona persona case is
            // rejected above.
            if (entry.record_persona_id != null) {
              const known = results
                .map((r) => (r && typeof r.recordId === "string" ? r.recordId : null))
                .filter(Boolean)
                .slice(0, 5)
                .join(", ");
              errors.push(
                fmt(
                  i,
                  `record_id '${entry.record_id}' does not match any result in sidecar '${ref}' — ` +
                    `expected one of: ${known}`,
                ),
              );
              continue;
            }
          } else {
            matchedRecord = matches[0];
            // Canonicalize record_id to the sidecar's stored form (`recordId`
            // for record_search, `id` for the persona-less producers).
            const canonical = resultId(matchedRecord);
            if (typeof canonical === "string" && entry.record_id !== canonical) {
              entry.record_id = canonical;
            }
            if (personaBearing) {
              const personaIds: string[] = (
                Array.isArray(matchedRecord.gedcomx?.persons) ? matchedRecord.gedcomx.persons : []
              )
                .map((p: any) => (p && typeof p.id === "string" ? p.id : null))
                .filter(Boolean);
              if (entry.record_persona_id != null) {
                if (!personaIds.includes(entry.record_persona_id)) {
                  const primary =
                    typeof matchedRecord.primaryId === "string"
                      ? ` (primary persona: ${matchedRecord.primaryId})`
                      : "";
                  errors.push(
                    fmt(
                      i,
                      `record_persona_id '${entry.record_persona_id}' does not resolve to a person in ` +
                        `record '${matchedRecord.recordId}' — expected one of: ${personaIds.join(", ")}${primary}`,
                    ),
                  );
                  continue;
                }
              } else if (
                matches.length === 1 &&
                typeof matchedRecord.primaryId === "string" &&
                personaIds.includes(matchedRecord.primaryId)
              ) {
                if (personaIds.length === 1 || autoFillScopeOk) {
                  // Auto-fill the unambiguous case — never silently null. Safe
                  // because the record holds a single persona, or the batch is a
                  // single-record single-role extraction (see scoping note above).
                  entry.record_persona_id = matchedRecord.primaryId;
                } else {
                  errors.push(
                    fmt(
                      i,
                      `record_persona_id omitted — multiple personas in this record (${personaIds.join(", ")}) ` +
                        "and the batch spans multiple record_roles/record_ids, so the omission is ambiguous; " +
                        `supply record_persona_id per assertion (the searched persona is '${matchedRecord.primaryId}')`,
                    ),
                  );
                  continue;
                }
              }
            }
          }
        } else if (hintRef && entry.record_persona_id != null) {
          // The document validator cannot re-check a hint's persona later, so an
          // unreadable read refuses rather than skipping enforcement.
          errors.push(
            fmt(
              i,
              `record_persona_id '${entry.record_persona_id}' cannot be verified — the record read ` +
                `'${hintRef}' staged for hint entry '${logId}' is missing or unreadable`,
            ),
          );
          continue;
        }
        countryProducer = producer;
        countryRecord = countrySidecarRecord(producer, results, matchedRecord);
      }
    }

    await applyPlaceLevers(entry, i, { valueDerived: liftedFromValue.has(entry), countryProducer, countryRecord, matchedRecord });
  }

  /** The record country's source for an assertion update's lookups: the sidecar
   *  record the stored assertion comes from. No sidecar value is copied. */
  const updateCountrySource = async (view: any): Promise<{ countryProducer?: string; countryRecord: any }> => {
    const logEntry = typeof view.log_entry_id === "string" ? logById.get(view.log_entry_id) : undefined;
    const results = typeof logEntry?.results_ref === "string" ? await readSidecarResults(logEntry.results_ref) : null;
    const key = arkToBareId(String(view.record_id ?? ""));
    const record = results?.find((r) => {
      const id = sidecarResultId(logEntry.tool, r);
      return id !== undefined && arkToBareId(id) === key;
    });
    return { countryProducer: logEntry?.tool, countryRecord: countrySidecarRecord(logEntry?.tool, results, record) };
  };

  // An assertions update that corrects `place` to another place and says nothing of
  // `standard_place` gets the same levers, with the existing assertion as the
  // base: otherwise the old standard_place stands for the corrected place, and
  // the contradiction gate measures its distance from the wrong point. When
  // nothing resolves, the stale value is cleared rather than kept.
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    if (op.section !== "assertions" || op.op !== "update" || typeof op.entryId !== "string") continue;
    const fields = (op as any).fields;
    if (!fields || typeof fields !== "object") continue;
    if (Object.prototype.hasOwnProperty.call(fields, "standard_place")) continue;
    const cur = ((research.assertions ?? []) as any[]).find((a: any) => a?.id === op.entryId);
    if (!cur) continue;
    const setsPlace = Object.prototype.hasOwnProperty.call(fields, "place");
    // A stored place variant still holding its place in `value` gets it lifted
    // here, before the lookups. Onto the stored entry when the op leaves `place`
    // alone: a note or a question tie is not a place correction for
    // rewriteLinkedFacts to carry onto the tree. A stored `standard_place: null`
    // stays an opt-out, as on an append.
    const merged = { ...cur, ...fields };
    const lifted = liftVariantPlace(merged);
    if (lifted) {
      if (!setsPlace) {
        cur.place = merged.place;
        const view: any = { ...merged };
        await applyPlaceLevers(view, i, { dropContradiction: true, valueDerived: true, ...(await updateCountrySource(view)) });
        if (typeof view.standard_place === "string") cur.standard_place = view.standard_place;
        continue;
      }
      fields.place = merged.place;
    }
    if (!setsPlace) continue;
    const place = factText(fields.place);
    if (place === undefined || place === factText(cur.place)) continue;
    const view: any = { ...cur, ...fields, standard_place: undefined };
    await applyPlaceLevers(view, i, { dropContradiction: true, valueDerived: lifted, ...(await updateCountrySource(view)) });
    if (typeof view.standard_place === "string") {
      fields.standard_place = view.standard_place;
    } else if (typeof cur.standard_place === "string") {
      fields.standard_place = null;
      const shown = isSuspiciousText(view.informant_bias_notes) ? WITHHELD_SUSPICIOUS : place;
      warnings.push(
        `assertion '${op.entryId}': cleared standard_place '${cur.standard_place}' because its place ` +
          `was corrected to '${shown}' and no standard form was found for the new place`,
      );
    }
  }

  // ── Derive transcription_truncated at the write boundary (#2457) ──
  // The truncation of an image read is known to image_transcribe, not to
  // record-extractor (which only holds the relayed text). So research_append is
  // authoritative for it on any image-backed source — DERIVED here, never asserted
  // by the agent. Per the B1/B2 ruling (2026-09-19) the PERSISTED marker is
  // `true` or ABSENT, never `false`: the invariant is that nothing moves from
  // "partial" to "whole", in memory (sticky-`true` in the cap store) or in the
  // document (here). `false` lives only in the cap store; it is read below (as
  // "not true"), never written to research.json. So a wrong-but-resolvable
  // image_filename can only add an unneeded `true` badge, never a false
  // "verified whole" — which is why the agent-supplied join key is acceptable.
  // Absent means UNKNOWN, not whole.
  //
  // DERIVED FROM THE BATCH'S FINAL STATE PER SOURCE, not per op (#2457 r11).
  // Both fields can arrive in a different op from each other, and either can be
  // REMOVED by a later op in the same batch, so a per-op read got three things
  // wrong. Keyed on PRESENCE (`"x" in bag`) rather than truthiness, because an
  // explicit `null`/`""` is the caller REMOVING a field, which is the opposite of
  // not re-sending it:
  //   - `append {transcription}` then `update {image_filename}` derived nothing
  //     while the mirror order derived `true`, on the same final document;
  //   - `update {image_filename: null}` derived the badge from the very reference
  //     that op deletes, onto a source that ends up citing no scan;
  //   - two updates to one source, the second nulling the text, had op[0] stamp
  //     `true` and then the validator refuse the whole batch, blaming the caller
  //     for a value only this loop set.
  //
  // MUST RUN AFTER the §3.4.1 reuse rewrite above, and that is now load-bearing
  // rather than decorative: before the fold a reused source is still an `append`
  // carrying no entryId, so the persisted-entry lookup below cannot resolve it;
  // after the fold it is an `update` carrying `entryId` and it can. Pinned by
  // "derives through a §3.4.1 reuse fold" in research-append.test.ts — move this
  // block and that test reds.
  const persistedSourcesForDerive = Array.isArray(research.sources) ? research.sources : [];
  // Pass 1: strip any caller-supplied value from EVERY sources bag first. The field
  // is derived, so an agent's guess never persists — including on a source with no
  // joinable image_filename, and including an op that pass 2 never stamps. On an
  // `update` this also means the key is absent from the patch, so the merge keeps
  // the persisted value: that is how a persisted `true` survives an update after a
  // process restart emptied the store (the store, not the document, is what a
  // restart clears).
  const sourcesOpsForDerive: { op: (typeof ops)[number]; bag: Record<string, unknown> }[] = [];
  for (const op of ops) {
    if (op.section !== "sources") continue;
    const bag = (op.op === "append" ? op.entry : op.fields) as
      | Record<string, unknown>
      | undefined;
    if (!bag || typeof bag !== "object") continue;
    delete bag.transcription_truncated;
    sourcesOpsForDerive.push({ op, bag });
  }
  // Pass 2: fold each source's ops, in order, onto the entry already persisted, to
  // get the `image_filename` and `transcription` this batch will actually leave
  // behind. An append is its own source (§3.3 forbids updating an id appended in
  // the same batch), so it keys on its own bag; updates key on `entryId`.
  interface DeriveState {
    last: Record<string, unknown>;
    ref: unknown;
    text: unknown;
  }
  const deriveBySource = new Map<unknown, DeriveState>();
  for (const { op, bag } of sourcesOpsForDerive) {
    const key = op.op === "update" && op.entryId ? `u:${op.entryId}` : bag;
    let state = deriveBySource.get(key);
    if (!state) {
      const persisted =
        op.op === "update" && op.entryId
          ? persistedSourcesForDerive.find((s: any) => s && s.id === op.entryId)
          : undefined;
      state = {
        last: bag,
        ref: persisted?.image_filename,
        text: persisted?.transcription,
      };
      deriveBySource.set(key, state);
    }
    if ("image_filename" in bag) state.ref = bag.image_filename;
    if ("transcription" in bag) state.text = bag.transcription;
    state.last = bag;
  }
  // `true` is the only value persisted, and only beside a non-empty transcription:
  // the marker qualifies text, so it is meaningless without any, and `true` beside
  // empty/null transcription is a state validate_research_schema rejects (its
  // .trim()), which batched would discard every good op with it. Anything else —
  // the image not in the cap set (a whole read, or no read here), no surviving
  // image_filename, or no surviving text — leaves the key deleted by pass 1:
  // nothing but `true` is ever written (#2457 rulings, C 2026-09-21). So a
  // non-partial image permits an in-place transcription update (the patch omits
  // the marker and the merge keeps the persisted value); and a persisted `true`
  // survives such an update — the marker may over-report a since-refined read,
  // which the ruling accepts as an unneeded badge, never a false "verified whole".
  // The stamp lands on the last op touching that source. That is DEFENSIVE, not a
  // guarded invariant, and the comment says so rather than overclaiming: `applyOne`
  // merges an update key by key and pass 1 strips the key from every bag, so no
  // later op can carry a competing value and which bag holds the stamp is currently
  // unobservable (measured — stamping the FIRST op instead passes the whole suite).
  // It is kept so this block does not silently depend on that merge staying key-wise.
  for (const state of deriveBySource.values()) {
    const ref = state.ref;
    const text = state.text;
    if (typeof ref !== "string" || ref.length === 0) continue;
    if (typeof text !== "string" || text.trim() === "") continue;
    if (!sourceImageCapState(projectPath, ref)) continue;
    state.last.transcription_truncated = true;
  }

  // §3.4.3: only a batch that RE-PERSISTS a record already persisted on this
  // source (the §3.4.1 fold) is a re-extraction; a later single append adding a
  // distinct fact never re-sends the source and is not compared.
  if (sourceReuse?.action === "updated_existing") {
    errors.push(...reextractionCollisions(ops, research, fmt));
  }
  errors.push(...retiredAssertionCitations(ops, research, fmt));

  await checkLocalityFirstPlaces(ops, errors, warnings, fmt);
  if (options.judgeSuppliedPlaces === true) await judgeTimelinePlaces(ops, research, recordStandards, warnings, fmt);

  if (errors.length > 0) throw new ResearchAppendError(errors);
  const verdictFile = prepareVerdict(input, ops, fmt, errors);
  if (errors.length > 0) throw new ResearchAppendError(errors);
  // Last, so this batch's assertions carry the standard_place resolved above.
  const birthPlaceCoords = await prefetchBirthPlaceCoords(research, ops, tree, personLinks, batchAssertions);
  return { treeMutated, matchScores, batchAssertions, startingPersonIds, startingTree, createdAssertions, personLinks, sourceDescriptionId, sourceReuse, resolvedPlaces, unresolvedPlaces, warnings, verdictFile, birthPlaceCoords };
}

// ─── Entry point ─────────────────────────────────────────────────────────────

/** Lane scoping for a narrow caller (e.g. `extraction_append`).
 *
 *  This is a second FUNCTION PARAMETER, deliberately not a field on
 *  `ResearchAppendInput`: `server.ts` dispatches with `researchAppend(args)`, a
 *  single argument built from `request.params.arguments` (and refuses a key that
 *  is not a parameter first), so an extra key on the tool input can never reach
 *  this object. The restriction is therefore
 *  unforgeable from the LLM side — a caller cannot widen its own lane.
 *
 *  It also lives here, in the module, rather than in the dispatch layer, because
 *  `eval/harness/harness/mock_mcp.py` imports these functions directly and never
 *  routes through `server.ts`. A gate in dispatch would be invisible to every
 *  eval run. */
export interface ResearchAppendOptions {
  /** Sections this caller may write. Omitted = every section (`research_append`). */
  allowedSections?: ReadonlySet<string>;
  /** extraction_append's personId mode: its `person_evidence` appends of the
   *  attachment shape (`isAttachmentLink`) skip the score gate. Never set by a
   *  tool caller. */
  attachmentLink?: boolean;
  /** extraction_append's recordIds mode: accepted-hint log id -> the staged
   *  `record_read` of that record, made in the same call. D2 verifies persona ids
   *  under the hint's sidecar-less entry against it. Never set by a tool caller. */
  hintReads?: ReadonlyMap<string, string>;
  /** Tool name used in lane-rejection text, so a narrow caller names itself. */
  toolName?: string;
  /** Report only the first failing op, and do not judge the rest of the batch.
   *  For a caller that reads nothing but `ok` and then retries op by op
   *  (`extraction_append`'s whole-batch attempts): the rest of the judging is a
   *  second pass over a copy of the document, and its answer is thrown away. Never
   *  set by a tool caller. */
  firstFailureOnly?: boolean;
  /** Run on research.json as read under the lock, before any op: a returned
   *  message refuses the call, so a caller that chose its op from an earlier
   *  read writes nothing when that read went stale. */
  precondition?: (research: any) => string | null;
  /** Set only by `researchAppendFromCaller`: a timeline event's standard_place
   *  is the caller's own, so it is judged (`judgeTimelinePlaces`). A tool builds
   *  its timeline from the project's own standard places. */
  judgeSuppliedPlaces?: boolean;
  /** extraction_append's re-extraction (#3678): retire these assertions of
   *  `recordId` against the batch's appends, in the same write (`planRetirement`).
   *  Never set by a tool caller. */
  retireAssertions?: RetireAssertions;
}

export interface RetireAssertions {
  recordId: string;
  ids: readonly string[];
}

/**
 * The ids of the existing sources that already cover any of `bareRecordIds`,
 * read off the assertions that cite them (§3.4.1). Source-reuse detection here
 * passes one record's own id. `extraction_append`'s resend skip passes a wider
 * set: every persona ARK of a `record_read` sidecar that lists the requested id,
 * because a record extracted under one persona's ARK is the same record when
 * another persona's ARK asks for it.
 */
export function sourceIdsForRecordIds(research: any, bareRecordIds: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  for (const a of Array.isArray(research?.assertions) ? research.assertions : []) {
    if (
      a &&
      typeof a.record_id === "string" &&
      typeof a.source_id === "string" &&
      bareRecordIds.has(arkToBareId(a.record_id))
    ) {
      out.add(a.source_id);
    }
  }
  return out;
}

/** A tool argument as `researchAppend` reads it: one `JSON.parse` of a string that parses,
 *  nothing else. The only place that decides it, so `researchAppendFromCaller`'s guard and
 *  the apply path cannot judge different ops. */
function decodeArg(value: unknown): unknown {
  return coerceJsonArg(value);
}

/** The fields an `edits` op may change: the two long prose fields of a proof
 *  summary. Every other field is short enough to re-send in `fields`. */
const EDITABLE_NARRATIVE_FIELDS = new Set(["narrative_markdown", "exhaustive_search_summary"]);

/** Ops whose `narrative_markdown` an `edits` expansion wrote, so the length budget
 *  can tell a sentence edit from a narrative write. */
const NARRATIVE_EDITED_OPS = new WeakSet<object>();

/** Every start index of `needle` in `text`, overlapping ("--" is twice in "---"). */
function occurrences(text: string, needle: string): number[] {
  const at: number[] = [];
  for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + 1)) at.push(i);
  return at;
}

/**
 * Expand each op's `edits` into `fields`, in place, and return every refusal.
 *
 * A one-sentence change to a proof summary used to re-send the whole 6-17k
 * narrative (issue #3542, lead 2c). Each edit names a field, an `old` that must
 * occur exactly once in the field's current text, and its replacement. The text an
 * edit applies to is the field as an earlier op in this batch left it, else the
 * stored entry. Once expanded, every later guard (the narrative-and-search-summary
 * rule, the `updated` stamp, validation) sees an ordinary `fields` update.
 */
function expandNarrativeEdits(
  ops: ResearchAppendOp[],
  research: any,
  fmt: (i: number, msg: string) => string,
): string[] {
  const errors: string[] = [];
  const pending = new Map<string, unknown>();
  const key = (id: string, field: string) => `${id}\u0000${field}`;
  const stored = (id: string) =>
    (Array.isArray(research?.proof_summaries) ? research.proof_summaries : []).find((ps: any) => ps?.id === id);
  ops.forEach((op, i) => {
    if (!op || typeof op !== "object") return;
    // A null or empty `edits` is absent, as a null `entry` or `planId` is.
    if (op.edits == null || (Array.isArray(op.edits) && op.edits.length === 0)) delete op.edits;
    const fields = op.fields && typeof op.fields === "object" && !Array.isArray(op.fields) ? op.fields : undefined;
    if (!Object.prototype.hasOwnProperty.call(op, "edits")) {
      if (op.section === "proof_summaries" && op.op === "update" && typeof op.entryId === "string" && fields) {
        for (const f of EDITABLE_NARRATIVE_FIELDS) {
          if (Object.prototype.hasOwnProperty.call(fields, f)) pending.set(key(op.entryId, f), fields[f]);
        }
      }
      return;
    }
    const refuse = (msg: string) => errors.push(fmt(i, msg));
    if (op.section !== "proof_summaries" || op.op !== "update") {
      refuse("`edits` applies only to an update of `proof_summaries`; elsewhere, pass the new value in `fields`.");
      return;
    }
    if (op.fields !== undefined && !fields) {
      refuse("`fields` beside `edits` must be an object of the other fields to change.");
      return;
    }
    const edits = op.edits;
    if (!Array.isArray(edits)) {
      refuse("`edits` must be an array of { field, old, new }.");
      return;
    }
    const entry = typeof op.entryId === "string" ? stored(op.entryId) : undefined;
    if (!entry) {
      refuse(`\`edits\` needs \`entryId\` naming an existing proof summary; '${op.entryId ?? "(none)"}' is not one.`);
      return;
    }
    const before = errors.length;
    const next = new Map<string, string>();
    edits.forEach((e: any, j: number) => {
      const at = `edits[${j}]`;
      if (!e || typeof e !== "object" || !EDITABLE_NARRATIVE_FIELDS.has(e.field)) {
        refuse(`${at}: \`field\` must be "narrative_markdown" or "exhaustive_search_summary".`);
        return;
      }
      if (typeof e.old !== "string" || e.old === "" || typeof e.new !== "string") {
        refuse(`${at}: \`old\` must be a non-empty string and \`new\` a string.`);
        return;
      }
      if (e.new === e.old) {
        refuse(`${at}: \`new\` is the same as \`old\`; an edit must change the text.`);
        return;
      }
      if (fields && Object.prototype.hasOwnProperty.call(fields, e.field)) {
        refuse(`${at}: \`${e.field}\` is also set in \`fields\`; pass it one way, not both.`);
        return;
      }
      const k = key(op.entryId as string, e.field);
      const text = next.has(k) ? next.get(k) : pending.has(k) ? pending.get(k) : entry[e.field];
      if (typeof text !== "string") {
        refuse(`${at}: ${op.entryId} has no \`${e.field}\` text to edit.`);
        return;
      }
      const found = occurrences(text, e.old);
      if (found.length !== 1) {
        refuse(
          `${at}: \`old\` occurs ${found.length} times in ${op.entryId}'s \`${e.field}\`; it must occur ` +
            "exactly once. " +
            (found.length === 0
              ? "Copy it character for character from the field's current text."
              : "Include more of the surrounding text so it matches one place."),
        );
        return;
      }
      next.set(k, text.slice(0, found[0]) + e.new + text.slice(found[0] + e.old.length));
    });
    if (errors.length > before) return;
    const merged: Record<string, unknown> = { ...(fields ?? {}) };
    for (const f of EDITABLE_NARRATIVE_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(merged, f)) pending.set(key(op.entryId as string, f), merged[f]);
    }
    for (const [k, text] of next) {
      merged[k.split("\u0000")[1]] = text;
      pending.set(k, text);
    }
    op.fields = merged;
    // A caller that re-sends the same op object must not meet its own expansion
    // as a `fields` collision.
    delete op.edits;
    if (next.has(key(op.entryId as string, "narrative_markdown"))) NARRATIVE_EDITED_OPS.add(op);
  });
  return errors;
}

/** The one field a direct `research_append` call may change on an assertion. */
const CALLER_ASSERTION_FIELDS = new Set(["informant_bias_notes"]);

/** `research_append` as an MCP caller reaches it. Assertions are written only by
 *  `extraction_append`, which calls `researchAppend` directly and so never meets
 *  this check. A caller may update one existing assertion's
 *  `informant_bias_notes`, to record a re-reading or a doubt; any other
 *  `assertions` write is refused, whole call, before anything is read
 *  (genealogist ruling 2026-10-05, option B). */
export async function researchAppendFromCaller(
  input: ResearchAppendInput,
): Promise<ResearchAppendResult> {
  // Judged on the decode `researchAppend` will make, and made in the one place it is
  // made (`decodeArg`). The decoded value is NOT written back: `researchAppend` decodes
  // `input.ops` itself, so writing it back made a batch stringified twice arrive there
  // still a string, which it decoded a second time, after this guard had read the
  // string as an empty list. It is a string after one decode and so is refused.
  const decodedOps = decodeArg(input.ops) as ResearchAppendOp[] | undefined;
  const decodedFields = decodeArg(input.fields) as Record<string, unknown> | undefined;
  const isBatch = decodedOps !== undefined;
  const ops = isBatch
    ? (Array.isArray(decodedOps) ? decodedOps : [])
    : [{ section: input.section, op: input.op, fields: decodedFields } as ResearchAppendOp];
  const errors: string[] = [];
  ops.forEach((op, i) => {
    if (!op || (op as { section?: unknown }).section !== "assertions") return;
    const fields = (op as { fields?: unknown }).fields;
    const keys = fields && typeof fields === "object" && !Array.isArray(fields) ? Object.keys(fields) : [];
    const notesOnly =
      (op as { op?: unknown }).op === "update" && keys.length > 0 && keys.every((k) => CALLER_ASSERTION_FIELDS.has(k));
    if (notesOnly) return;
    const msg =
      "research_append does not write assertions: extraction_append writes them (a FamilySearch " +
      "record by recordIds; any other source through the record-structurer agent). The one change " +
      "allowed here is an update that sets only informant_bias_notes on an existing assertion, to " +
      "record a re-reading or a doubt. A disputed reading belongs in a conflict, not in the assertion's value.";
    errors.push(isBatch ? `ops[${i}]: ${msg}` : msg);
  });
  if (errors.length > 0) {
    return isBatch ? { ok: false, errors, opsReceived: ops.length } : { ok: false, errors };
  }
  return researchAppend(input, { judgeSuppliedPlaces: true });
}

export async function researchAppend(
  input: ResearchAppendInput,
  options: ResearchAppendOptions = {},
): Promise<ResearchAppendResult> {
  const { projectPath } = input;

  // Recover object/array args the model serialized as JSON strings (see
  // coerceJsonArg) before any shape checks, so a correct-but-stringified batch
  // isn't rejected as "`ops` must be a non-empty array" and driven into a slow
  // one-op-per-call fallback. Once: a value still a string after one decode is
  // not recovered, and is refused.
  input.ops = decodeArg(input.ops) as ResearchAppendOp[] | undefined;
  input.entry = decodeArg(input.entry) as Record<string, unknown> | undefined;
  input.fields = decodeArg(input.fields) as Record<string, unknown> | undefined;
  input.edits = decodeArg(input.edits) as NarrativeEdit[] | undefined;
  input.sourceDescription = decodeArg(input.sourceDescription) as SourceDescriptionInput | undefined;
  input.verdict = decodeArg(input.verdict) as Record<string, unknown> | undefined;

  const isBatch = input.ops !== undefined;
  const opsReceived = isBatch && Array.isArray(input.ops) ? input.ops.length : undefined;
  /** `hint` names the op(s) the failure is about; their worked examples are
   *  appended so a rejected call teaches the shape on the spot instead of
   *  depending on the right SKILL.md having been loaded. */
  const fail = (
    errors: string[],
    hint?: Array<{ section: string; op: "append" | "update"; fields?: readonly string[] }>,
  ): ResearchAppendResult => {
    const all = hint && hint.length > 0 ? [...errors, ...exampleHints(hint)] : errors;
    return opsReceived !== undefined ? { ok: false, errors: all, opsReceived } : { ok: false, errors: all };
  };

  // Serialize the whole read-modify-write against every other writer on this
  // project (issue #1715). Wraps extraction_append too, which routes here.
  return withProjectLock(projectPath, async () => {
  try {
    const research = await readJson(projectPath, "research.json");
    const stale = options.precondition?.(research);
    if (stale) return fail([stale]);
    // Snapshot BEFORE any op in this call/batch applies — see
    // proofSummaryInvariants. Must be taken here, not read off `research`
    // later, since applyOne mutates `research` in place per op.
    const preCallExhaustiveDeclared = new Map<string, boolean>(
      (Array.isArray(research.questions) ? research.questions : []).map((q: any) => [
        q?.id,
        isStopGateSatisfied(q),
      ]),
    );
    // Same discipline, for the conflict gate on project.status = "completed": the
    // conflicts that were blocking BEFORE this call's ops. Without it a single
    // batch could resolve the conflict and complete in one go.
    // Widened with the live arm, not instead of it: the gate refuses on the
    // union, so narrowing only one half would let a batch resolve a
    // derived-blocking conflict and complete in the same call.
    const preCallTiedAssertionIds = questionTiedAssertionIds(research);
    const preCallBlockingConflicts = (
      Array.isArray(research.conflicts) ? research.conflicts : []
    ).filter((c: any) => c && conflictBlocksCompletion(c, preCallTiedAssertionIds));
    // Heal legacy tree shapes in memory; the healed document is what a tree
    // write persists (same one-shot migration as tree_edit). Two things write
    // it: the composite `sourceDescription` S entry, and an assertion `update`
    // that rewrites the fact minted from it (#2472). A call doing neither
    // still never writes the tree.
    const sanitized = sanitizeTree(await readJson(projectPath, "tree.gedcomx.json"));
    const tree = sanitized.tree;
    // Pre-mutation snapshot (applyOne and prepareOps mutate research and tree
    // in place): block only on errors THIS call introduces, not pre-existing
    // drift in a section it never touched (#1572).
    const beforeResearch = structuredClone(research);
    const beforeTree = structuredClone(tree);

    let ops: ResearchAppendOp[];
    if (isBatch) {
      if (!Array.isArray(input.ops) || input.ops.length === 0) {
        return fail([opsNotAnArrayMessage(input.ops)]);
      }
      ops = input.ops;
    } else {
      if (!input.section || !input.op) {
        return fail(["provide either `ops` (batch) or `section` + `op` (single)"]);
      }
      ops = [
        {
          section: input.section,
          op: input.op,
          entry: input.entry,
          entryId: input.entryId,
          fields: input.fields,
          ...(input.edits != null ? { edits: input.edits } : {}),
          planId: input.planId,
        },
      ];
    }

    const fmt = (i: number, msg: string) => (isBatch ? `ops[${i}]: ${msg}` : msg);

    // ─── Lane gate ───────────────────────────────────────────────────────────
    // Runs BEFORE prepareOps: that pre-pass does live Places-API resolution and
    // mutates the tree in memory, so a call that was always going to be rejected
    // must not burn network round-trips first.
    //
    // The message names ONLY this tool and the sections it does write. It must
    // not name the broad tool or enumerate the denied sections — that string is
    // exactly the routing map a model needs to work around the lane.
    if (options.allowedSections) {
      const allowed = options.allowedSections;
      const toolName = options.toolName ?? "this tool";
      const writes = [...allowed].join(", ");
      // Every op outside the lane, not the first: a batch with three of them was
      // otherwise sent round three times. Each line names only its own op's section.
      const outsideLane: string[] = [];
      for (let i = 0; i < ops.length; i++) {
        const section = ops[i]?.section;
        if (typeof section !== "string" || !allowed.has(section)) {
          outsideLane.push(
            fmt(
              i,
              `section '${section}' is not writable by ${toolName} (it writes only: ${writes}). ` +
                "Another skill owns that section — surface the finding in your summary instead.",
            ),
          );
        }
      }
      if (outsideLane.length > 0) return fail(boundErrors(outsideLane));
    }

    // ─── One source per call (#3544) ─────────────────────────────────────────
    // All-or-nothing over several sources throws away every source's links for
    // one source's error: in the e2e corpus, 1,045 links from error-free sources
    // went with 48 refused multi-source calls. Refusing the shape keeps the call
    // atomic; it never commits part of a batch.
    if (!options.attachmentLink) {
      const sources = personEvidenceAppendSources(ops, research);
      if (sources.size > 1) return fail([oneSourcePerCallError(sources)]);
    }

    // Before prepareOps: a call refused here must not reach its network lookups,
    // and every guard after this sees an ordinary `fields` update.
    const editErrors = expandNarrativeEdits(ops, research, fmt);
    if (editErrors.length > 0) {
      // A refused op keeps its `edits`; one that expanded cleanly does not.
      const refused = ops.flatMap((op, i) => (op && Object.prototype.hasOwnProperty.call(op, "edits") ? [i] : []));
      return fail(
        [...(ops.length > 1 ? [editsCheckedOnlyLine(refused[0])] : []), ...boundErrors(editErrors)],
        refused.map((i) => ({ ...failedOpHint(ops[i], []), fields: ["edits"] })),
      );
    }

    let retracted = new Set<string>();
    if (options.retireAssertions) {
      const plan = planRetirement(research, tree, ops, options.retireAssertions);
      if (plan.errors.length > 0) {
        return fail(boundErrors(plan.errors.map((e) => `re-extraction of ${options.retireAssertions!.recordId} refused: ${e}`)));
      }
      ops.push(...plan.updates);
      retracted = plan.retracted;
    }

    // ─── Composite + enforcement pre-pass (stamps ids, mutates the tree) ─────
    const readSidecar = sidecarReader(projectPath);
    const prep = await prepareOps(input, ops, research, tree, projectPath, fmt, options, readSidecar);
    const minted = personsNamedFromRetracted(research, tree, retracted);
    if (minted.length > 0) {
      prep.warnings.push(
        `the retracted relationship claim (${[...retracted].join(", ")}) is the source of a name on ` +
          `${minted.join(", ")}: check whether that person rests on it alone.`,
      );
    }

    const storedCollectionUrls = opsSetCollectionUrl(ops)
      ? await loadStoredCollectionUrls(projectPath)
      : undefined;

    // ─── Apply every op in-memory ─────────────────────────────────────────────
    const applied: AppliedOp[] = [];
    const appendedThisBatch = new Set<string>();
    const applyOp: ApplyOp = (doc, op, opIndex, ctx) => ({
      ...applyOne(
        doc,
        op,
        ctx.appended,
        preCallExhaustiveDeclared,
        preCallBlockingConflicts,
        beforeResearch,
        tree,
        prep.matchScores,
        ctx.batchAssertions,
        prep.startingPersonIds,
        prep.createdAssertions,
        prep.personLinks,
        prep.birthPlaceCoords,
        storedCollectionUrls,
        options.attachmentLink === true,
        ctx.reserved,
      ),
      opIndex,
    });
    // The ops as the pre-pass left them. This loop mutates them (applyOne rewrites
    // `op.fields` in places, and the document shares their nested objects), and the
    // failure path below applies them again. A single op has nothing to look past.
    const opsBeforeApply = ops.length > 1 ? structuredClone(ops) : ops;
    let firstFailure: OpFailure | undefined;
    for (let i = 0; i < ops.length; i++) {
      try {
        applied.push(applyOp(research, ops[i], i, { appended: appendedThisBatch, batchAssertions: prep.batchAssertions }));
      } catch (e) {
        if (e instanceof ResearchAppendError) {
          // Nothing has been written, and nothing will be. The first failure is
          // not the only one, so the rest of the batch is judged below.
          firstFailure = { index: i, errors: e.errors };
          break;
        }
        throw e;
      }
    }
    if (firstFailure !== undefined) {
      const { index, errors } = firstFailure;
      /** What this call said before it looked past the first failure. */
      const firstOnly = () => fail(errors.map((m) => fmt(index, m)), [failedOpHint(ops[index], errors)]);
      if (ops.length === 1 || options.firstFailureOnly === true) return firstOnly();
      try {
        const every = await everyOpFailure({
          ops: opsBeforeApply,
          first: firstFailure,
          before: { research: beforeResearch, tree: beforeTree },
          tree,
          projectPath,
          startingPersonIds: prep.startingPersonIds,
          startingTree: prep.startingTree,
          applyOp,
          fmt,
        });
        return fail(every.errors, every.hints);
      } catch {
        // Best effort. The first failure always gets through: a later op that cannot
        // even be checked (a wrongly typed `entryId` throws a TypeError, not a
        // refusal) must not turn a clean refusal into a crash. Nothing has been
        // written on either path.
        return firstOnly();
      }
    }


    // #2472: carry an assertion correction onto the fact materialize_facts
    // minted from it, in this same call's atomic composite persist.
    const rewrite = rewriteLinkedFacts(applied, ops, research, beforeResearch, tree);
    // #3601: a rejection retires its pair's live link and that link's facts,
    // in this same all-or-nothing write.
    const retire = retireRejectedLinks(applied, research, tree);

    await stampNamesakePersonas(research, ops, applied, sidecarResultsReader(readSidecar));

    // The namesake cap (issue #3363), judged once on the call's end state, so op
    // order cannot matter: a link and the row, assertion or tie it depends on
    // may arrive in any order within the call.
    const namesakeMsgs = namesakeMessages({ research: beforeResearch }, { research, tree }, applied, prep.startingPersonIds, fmt, prep.startingTree);

    const opWarnings = [...prep.warnings, ...applied.flatMap((a) => a.warnings ?? []), ...retire.warnings];
    // Folded into locals rather than mutated onto `prep`: both the mutation test
    // and the write branch below have to see the rewrite's tree write, and the
    // degrade path below can take it back.
    let treeMutated = prep.treeMutated || rewrite.mutated || retire.mutated;
    let rewriteWarnings = [...rewrite.warnings, ...rewrite.mutationWarnings];
    const anyMutation = applied.some((a) => !a.noop) || treeMutated;

    // Tree-encoding completion check (issue #1490), shadow → WARNING. Only when
    // THIS call sets project.status = "completed" — the same trigger the
    // conflict gate uses — so it never re-warns on a later write to an
    // already-completed project. Reads the write-once baseline; fails open (no
    // warning) when the project predates it.
    const completingNow = ops.some(
      (o) => o.section === "project" && o.op === "update" && (o.fields as any)?.status === "completed",
    );
    let treeEncodingWarnings: string[] = [];
    if (completingNow) {
      const startingTree = await readStartingTree(projectPath);
      treeEncodingWarnings = treeEncodingCompletionWarnings(research, tree, startingTree);
    }

    // A planned next action unlikely to be usable: a jurisdiction outside every
    // recorded locality, or a date range that cannot contain the event. "Dead ends
    // become next actions" fails when the next actions are not usable -- in the
    // reported case 2 of 8, then 1 of 3 suggestions were viable, including COUNTY
    // records for a death in an independent city the locality guide had flagged.
    //
    // FLAGS, NEVER GATES, so it rides the warnings channel and refuses nothing:
    // searching a neighbouring jurisdiction can be deliberate and a year outside the
    // obvious window can be a fallback. Decided from the project documents alone, so
    // it needs no network call and works while the run is offline.
    const localitiesForPlan = Array.isArray(research?.localities) ? research.localities : [];
    const planItemWarnings: string[] = [];
    for (const planOp of ops) {
      if (planOp.section !== "plan_items") continue;
      const entry = ((planOp.op === "append" ? (planOp as any).entry : (planOp as any).fields) ?? {});
      for (const flag of planItemFlags(entry, localitiesForPlan)) {
        planItemWarnings.push(flag.message);
      }
    }
    // A plan short of its question's date window (issue #2424). Judged once per
    // question on the call's end state, so op order in a batch cannot matter, and
    // only on an op that can change coverage — a search agent's status-only item
    // update leaves the span alone and must not re-warn on every search.
    const endPlans: any[] = Array.isArray(research?.plans) ? research.plans : [];
    const planQuestion = (planId: unknown) => endPlans.find((p) => p?.id === planId)?.question_id;
    const windowQuestionIds = new Set<string>();
    for (const o of ops as any[]) {
      let qid: unknown;
      if (o.section === "plans") {
        if (o.op === "append") qid = o.entry?.question_id;
        else if (o.fields && "items" in o.fields) qid = planQuestion(o.entryId);
      } else if (o.section === "plan_items") {
        const f = o.op === "append" ? null : (o.fields ?? {});
        if (!f || "date_range" in f || f.status === "skipped") qid = planQuestion(o.planId);
      }
      if (typeof qid === "string") windowQuestionIds.add(qid);
    }
    for (const qid of windowQuestionIds) {
      const question = (Array.isArray(research?.questions) ? research.questions : []).find((q: any) => q?.id === qid);
      const flag = question ? planWindowFlag(question, endPlans) : null;
      if (flag) planItemWarnings.push(flag);
    }
    const appendedItems = appendedPlanItems(ops);
    if (appendedItems.some((i) => i.repository && !/familysearch/i.test(String(i.repository)) && !i.collection_url)) {
      let stored: ExternalCollectionsDoc | null = null;
      try {
        stored = await readExternalCollections(projectPath);
      } catch {
        // A malformed file is research_append's refusal only when a collection_url is set.
      }
      for (const i of appendedItems) {
        const hint = storedCollectionsHint(i, stored);
        if (hint) planItemWarnings.push(hint);
      }
    }

    // ─── Validate once, write once (both files when the tree changed) ────────
    let validationWarnings: string[] = [];
    let filesWritten: string[] = [];
    if (anyMutation) {
      let validation = await validateIntroduced({ research: beforeResearch, tree: beforeTree }, { research, tree }, { projectPath });
      // A fact rewrite is call-INTRODUCED, so a rewritten fact that fails
      // validation would refuse the assertion correction itself — the write the
      // caller actually asked for, and the legitimate one (writers block on
      // call-introduced errors only, commit 7cd6a19b9). Roll the rewrite back
      // and re-validate; if that clears it, the correction lands and the dropped
      // rewrite degrades to a warning. The retry runs only on a path that was
      // already failing, so it costs nothing in the normal case.
      if (!validation.valid && rewrite.mutated) {
        rewrite.undo();
        const retry = await validateIntroduced({ research: beforeResearch, tree: beforeTree }, { research, tree }, { projectPath });
        if (retry.valid) {
          validation = retry;
          treeMutated = prep.treeMutated || retire.mutated;
          // The mutation half described a tree change that no longer exists.
          rewriteWarnings = [
            ...rewrite.warnings,
            "the linked tree fact(s) could not be updated from this correction — the rewritten " +
              "fact failed validation, so the fact rewrite was rolled back. The assertion is " +
              "corrected; the fact still holds the earlier reading. (Any other write this call " +
              "made, including a composite source description, still landed — see filesWritten.)",
          ];
        }
      }
      const refused = documentFailure({ validation, namesake: namesakeMsgs, doc: research, ops, applied, isBatch, fmt });
      if (refused) return fail(refused.errors, refused.hints);
      validationWarnings = formatIssues(validation.warnings);
      // Verdict sidecar first: research.json's file_path pointer must never
      // name a file that does not exist. Written before the document commit so
      // a failure here aborts before the pointer is persisted.
      if (prep.verdictFile) {
        await atomicWriteJson(projectPath, prep.verdictFile.relPath, prep.verdictFile.body);
      }
      // Debug hold for the P1 resume probe (docs/plan/search-agent-prototype.md, P1):
      // keep a delegated extraction_append open before its commit so a harness can
      // kill the worker mid-write. Inert unless the env var is set.
      const holdMs = Number(process.env.GENEALOGY_DEBUG_HOLD_BEFORE_COMMIT_MS ?? 0);
      if (holdMs > 0 && options.toolName === "extraction_append") {
        await new Promise<void>((resolve) => setTimeout(resolve, holdMs));
      }
      if (treeMutated) {
        await atomicWriteBoth(projectPath, [
          { ref: "tree.gedcomx.json", data: tree }, // tree first —
          { ref: "research.json", data: research }, // — then research (commit order)
        ]);
        filesWritten = ["tree.gedcomx.json", "research.json"];
        validationWarnings = [...sanitized.warnings, ...validationWarnings];
      } else {
        await atomicWriteJson(projectPath, "research.json", research);
        filesWritten = ["research.json"];
      }
      if (prep.verdictFile) filesWritten = [...filesWritten, prep.verdictFile.relPath];
      // Second debug hold, after the commit and before the result returns: a kill
      // here leaves a committed write whose tool_result never reached the transcript.
      const holdAfterMs = Number(process.env.GENEALOGY_DEBUG_HOLD_AFTER_COMMIT_MS ?? 0);
      if (holdAfterMs > 0 && options.toolName === "extraction_append") {
        await new Promise<void>((resolve) => setTimeout(resolve, holdAfterMs));
      }
      // GC unreferenced source images (best-effort, TTL-gated) — design B, §8.5:
      // remove images/*.jpg no source cites and older than the TTL, so a
      // just-transcribed-but-unretained scan ages out instead of lingering.
      await gcUnreferencedImages(
        projectPath,
        new Set(
          (Array.isArray(research.sources) ? research.sources : [])
            .map((s: any) => s?.image_filename)
            .filter((f: unknown): f is string => typeof f === "string" && f.length > 0),
        ),
      ).catch(() => {});
    }

    // Persistence nudge (#1478): sources landing with no assertions drawn.
    // Non-blocking — rides validation.warnings, never touches `ok`.
    const persistenceWarning = anyMutation ? sourcesWithoutAssertionsWarning(research, applied) : null;
    // Provenance nudge (#2256): a transcription with no page named. Advisory,
    // like the one above — it rides validation.warnings and never touches `ok`.
    const transcriptionWarnings = anyMutation
      ? transcriptionWithoutImageWarnings(research, applied)
      : [];
    // The namesake warning (#3363, spec §5.6): a row written over links that
    // stand untied. Advisory, like the two above.
    const namesakeWarnings = anyMutation
      ? namesakeRowWarnings({ research: beforeResearch }, { research, tree }, applied, prep.startingPersonIds)
      : [];
    const validationBlock = {
      valid: true as const,
      warnings: [...validationWarnings, ...opWarnings, ...rewriteWarnings, ...treeEncodingWarnings, ...planItemWarnings, ...(persistenceWarning ? [persistenceWarning] : []), ...transcriptionWarnings, ...namesakeWarnings],
    };
    const extras: Pick<BatchSuccess, "sourceDescriptionId" | "sourceReuse" | "resolvedPlaces" | "unresolvedPlaces"> = {};
    if (prep.sourceDescriptionId) extras.sourceDescriptionId = prep.sourceDescriptionId;
    if (prep.sourceReuse) extras.sourceReuse = prep.sourceReuse;
    if (prep.resolvedPlaces.length > 0) extras.resolvedPlaces = prep.resolvedPlaces;
    if (prep.unresolvedPlaces.length > 0) extras.unresolvedPlaces = prep.unresolvedPlaces;

    if (isBatch) {
      return {
        ok: true,
        results: applied.map((a) => ({ section: a.section, op: a.op, entryId: a.entryId })),
        ...extras,
        filesWritten,
        validation: validationBlock,
      };
    }
    return {
      ok: true,
      section: applied[0].section,
      op: applied[0].op,
      entryId: applied[0].entryId,
      ...extras,
      filesWritten,
      validation: validationBlock,
    };
  } catch (e) {
    if (e instanceof NoProjectError) return noProjectResult();
    if (e instanceof ResearchAppendError) {
      // Single-op path (and pre-pass throws): the section is only known when
      // the caller used the non-batch form.
      return fail(
        e.errors,
        input.section ? [{ section: String(input.section), op: input.op === "update" ? "update" : "append" }] : undefined,
      );
    }
    throw e;
  }
  });
}

/** The refusal for an `ops` that is not a non-empty array. When it is a string
 *  that would not parse, `coerceJsonArg` had swallowed the reason, so say it:
 *  the engine's own message, plus the offset when the message holds none. */
function opsNotAnArrayMessage(ops: unknown): string {
  const failure = jsonParseFailure(ops);
  if (!failure) return "`ops` must be a non-empty array";
  const offset =
    failure.offset === null || V8_POSITION_SUFFIX.test(failure.message) ? "" : ` (offset ${failure.offset})`;
  return (
    "`ops` must be a non-empty array, but it arrived as a string that does not parse as JSON: " +
    `${failure.message}${offset}. Fix that and send \`ops\` as a JSON array.`
  );
}

/** Best-effort mapping of whole-document validation errors back to the batch op
 *  that touched the offending entry, so failure responses name the failing ops.
 *  Errors on entries no op touched keep their `research.json/…` path. */
function mapValidationErrors(errors: string[], applied: AppliedOp[], isBatch: boolean): string[] {
  if (!isBatch) return errors;
  const byLocation = new Map<string, number>();
  for (const a of applied) {
    if (a.arrayIndex !== undefined) byLocation.set(`${a.section}[${a.arrayIndex}]`, a.opIndex);
  }
  return errors.map((msg) => {
    const m = msg.match(/^research\.json\/([a-z_]+)\[(\d+)\]/);
    if (m) {
      const k = byLocation.get(`${m[1]}[${m[2]}]`);
      if (k !== undefined) return `ops[${k}]: ${msg}`;
    }
    return msg;
  });
}

/** What one failing op said; `index` is its place in the batch. */
interface OpFailure {
  index: number;
  errors: string[];
}

type ExampleHint = { section: string; op: "append" | "update"; fields?: readonly string[] };

/** The worked-example hint for an op that failed with `errors`. */
function failedOpHint(op: ResearchAppendOp, errors: readonly string[]): ExampleHint {
  let fields = Object.keys(op.fields ?? op.entry ?? {});
  // A proof summary's narrative fields select the `edits` example, so they are
  // dropped unless a refusal names one: a tier refusal on an op that also edits
  // the narrative is not taught a narrative edit.
  if (op.section === "proof_summaries" && !errors.some((m) => [...EDITABLE_NARRATIVE_FIELDS].some((f) => m.includes(f)))) {
    fields = fields.filter((f) => !EDITABLE_NARRATIVE_FIELDS.has(f));
  }
  return {
    section: String(op.section),
    op: op.op === "update" ? "update" : "append",
    // The field names the failing op actually set. The worked example
    // is keyed on these so a caller refused on one field is not handed
    // a payload for another — see exampleFor.
    fields,
  };
}

/** What `applyOne` reads beside the document it is given. */
interface ApplyContext {
  /** Ids this call has created so far: an update may not name one. */
  appended: Set<string>;
  /** Ids that count as taken though no entry shows them (see `everyOpFailure`). */
  reserved?: ReadonlySet<string>;
  /** Every assertion the batch can resolve: the document's, and the ones its appends will create. */
  batchAssertions: Map<string, any>;
}

/** `applyOne` with this call's context bound, so both passes apply an op the same way. */
type ApplyOp = (doc: any, op: ResearchAppendOp, opIndex: number, ctx: ApplyContext) => AppliedOp;

/** The lead line of a batch refused on its `edits`, which are checked before anything else
 *  in the batch: unlike `checkedWithoutLine`, nothing else was checked. */
function editsCheckedOnlyLine(firstIndex: number): string {
  return (
    `Fix the earliest failure first (ops[${firstIndex}]) and send the batch again. Only the batch's ` +
    "`edits` were checked, not its other ops, so the corrected batch may still be refused for something else."
  );
}

/** The line a refusal leads with when it looked past its first failure. It leads, and
 *  says what to do, because the errors after the first were found WITHOUT the failed
 *  ops: one may only follow from an earlier one, and the model that fixes every line
 *  at once edits ops that were never wrong. */
function checkedWithoutLine(firstIndex: number): string {
  return (
    `Fix the earliest failure first (ops[${firstIndex}]) and send the batch again. The rest of the batch ` +
    "was checked, and the document validated, without the failed ops applied, so an error listed after " +
    "it may only follow from an earlier one and go away once that is fixed, and an op that passed here " +
    "may still fail then."
  );
}

/** The most characters of error text a refused batch returns, the worked examples and
 *  the one leading line apart. A batch built by code can break one rule in every op:
 *  an extraction of sixty assertions was 129 KB of errors, and `extraction_append`
 *  returns the list twice (as `errors` and joined into `summary`). Claude Code saves a
 *  tool result over 50,000 characters to a file the agent may not be able to read, so
 *  this keeps a refused answer far under that line. */
const MAX_ERROR_CHARS = 8_000;

/** `ops[3]: message`: the op an error line names, and the message. */
const OP_LINE = /^ops\[(\d+)\]: ([\s\S]*)$/;

/** Lines that say the same thing about different ops, and differ only in the
 *  `ops[i]:` prefix, become one line naming those ops. Order is by first appearance. */
function collapseErrors(lines: readonly string[]): string[] {
  const groups = new Map<string, { message: string; ops: number[] | null }>();
  for (const line of lines) {
    const m = OP_LINE.exec(line);
    const key = `${m ? "op" : "plain"}:${m ? m[2] : line}`;
    let group = groups.get(key);
    if (!group) {
      group = { message: m ? m[2] : line, ops: m ? [] : null };
      groups.set(key, group);
    }
    if (m && !group.ops!.includes(Number(m[1]))) group.ops!.push(Number(m[1]));
  }
  return [...groups.values()].map((g) =>
    g.ops === null
      ? g.message
      : `${g.ops.sort((a, b) => a - b).map((i) => `ops[${i}]`).join(", ")}: ${g.message}`,
  );
}

/** The error lines of a refused batch, collapsed and capped at `MAX_ERROR_CHARS`. Every
 *  distinct message is kept in order until the cap, and the first always is. What is left
 *  out is counted in one last line, which says they are listed in full once the earlier
 *  ones are fixed. */
function boundErrors(lines: readonly string[]): string[] {
  const grouped = collapseErrors(lines);
  const kept: string[] = [];
  let used = 0;
  for (const line of grouped) {
    if (kept.length > 0 && used + line.length > MAX_ERROR_CHARS) break;
    kept.push(line);
    used += line.length;
  }
  const dropped = grouped.slice(kept.length);
  if (dropped.length === 0) return kept;
  const namedAbove = new Set(kept.flatMap((l) => [...l.matchAll(/ops\[(\d+)\]/g)].map((m) => m[1])));
  const opsLeft = new Set(
    dropped.flatMap((l) => [...l.matchAll(/ops\[(\d+)\]/g)].map((m) => m[1])).filter((i) => !namedAbove.has(i)),
  );
  return [
    ...kept,
    `${dropped.length} more error message${dropped.length === 1 ? "" : "s"}` +
      (opsLeft.size > 0 ? `, on ${opsLeft.size} more failing op${opsLeft.size === 1 ? "" : "s"},` : "") +
      " not listed here, to keep this answer short. They are listed in full once the earlier ones are fixed.",
  ];
}

/** The namesake cap's findings on a call, each labelled with the batch index of the op
 *  it is keyed to. `applied` is in step with the findings' own indexes. */
function namesakeMessages(
  before: { research: any },
  after: { research: any; tree: any },
  applied: readonly AppliedOp[],
  startingPersonIds: ReadonlySet<string>,
  fmt: (i: number, msg: string) => string,
  startingTree: SimplifiedGedcomX | null,
): string[] {
  return [
    ...namesakeCallCheck(before, after, applied, startingPersonIds, startingTree),
    ...circularCorroborationCallCheck(before, after, applied, startingTree),
  ].map((f) =>
    f.index === null ? f.message : fmt(applied[f.index].opIndex, f.message),
  );
}

/**
 * What the whole-document checks say about a call whose ops applied: the namesake
 * cap's findings and the document validator's, in the order the caller reads them,
 * and the worked examples that teach the shape. Undefined when nothing is wrong.
 * The success path and the failure path (`everyOpFailure`) both end here, so a check
 * added to one is in the other.
 *
 * The cause-naming misroute message leads the validator's errors, because it names
 * what to change, and is said only when the document is refused anyway: a created
 * plan that ends with no items always fails validation (`items` absent fails the
 * required check, `[]` the non-empty check, and a non-array is excluded from the
 * misroute set), so the misroute set is a subset of the validation-failing set and
 * carrying its message down to the validation failure loses nothing. It is computed
 * here, on the post-apply document, and never returned on its own: an early return
 * suppressed every other document-level error in the same batch.
 *
 * Only the sections the errors name get a worked example: in a wide batch, examples
 * for ops that validated fine would point away from the real problem.
 */
function documentFailure(c: {
  validation: Awaited<ReturnType<typeof validateIntroduced>>;
  namesake: string[];
  doc: any;
  /** The ops that applied, in step with `applied`. */
  ops: ResearchAppendOp[];
  applied: AppliedOp[];
  isBatch: boolean;
  fmt: (i: number, msg: string) => string;
  /** Plans a refused `plan_items` op named (failure path only). */
  namedByRefusedItems?: ReadonlySet<string>;
}): { errors: string[]; hints: ExampleHint[] } | undefined {
  const personEvidence: ExampleHint = { section: "person_evidence", op: "append" };
  if (c.validation.valid) {
    return c.namesake.length > 0 ? { errors: c.namesake, hints: [personEvidence] } : undefined;
  }
  // Shape errors surface here (the document validator, not applyOne), so this is the
  // site the evaluations rejections land on.
  const mapped = mapValidationErrors(formatIssues(c.validation.errors), c.applied, c.isBatch);
  const misroute = emptyCreatedPlanErrors(c.ops, c.doc, c.applied, c.namedByRefusedItems).map((m) =>
    c.fmt(m.index, m.message),
  );
  const blamed = c.ops.filter((o) => mapped.some((m) => m.includes(String(o.section))));
  return {
    errors: [...c.namesake, ...misroute, ...mapped],
    hints: [
      ...(c.namesake.length > 0 ? [personEvidence] : []),
      ...(misroute.length > 0
        ? [{ section: "plans", op: "append" as const }]
        : (blamed.length > 0 ? blamed : c.ops).map((o) => ({
            section: String(o.section),
            op: o.op === "update" ? ("update" as const) : ("append" as const),
          }))),
    ],
  };
}

/** The assertions `applyOne` reads for one op in the failure path: those of the document
 *  it is applying to, which that op may change, and the ones this batch's appends will
 *  create. Built from THAT document, not from the one the first pass changed: the first
 *  pass merged a refused op's fields into the live assertion objects, and a map that
 *  still held them blamed correct ops for a write that was refused. */
function assertionsOf(doc: any, predicted: ReadonlyMap<string, any>): Map<string, any> {
  const byId = new Map<string, any>();
  for (const a of Array.isArray(doc?.assertions) ? doc.assertions : []) {
    if (a && typeof a.id === "string") byId.set(a.id, a);
  }
  for (const [id, e] of predicted) byId.set(id, e);
  return byId;
}

/** `doc` with the one top-level section `op` writes copied, so `applyOne` can change that
 *  section without touching `doc`. `applyOne` changes nothing else: an op writes its own
 *  section (or a plan's items, for a nested one), and every other section it only reads. */
function sectionCopy(doc: any, op: ResearchAppendOp): any {
  const config = typeof op?.section === "string" && Object.hasOwn(SECTIONS, op.section) ? SECTIONS[op.section] : undefined;
  const key = config?.nested ? config.nested.parent : op?.section;
  const copy = { ...doc };
  if (typeof key === "string" && Object.hasOwn(copy, key)) copy[key] = structuredClone(copy[key]);
  return copy;
}

/** The id an `append` would take on `doc`; undefined for anything else (an update takes
 *  none, and a singleton or unknown section has no ids). */
function wouldBeId(doc: any, op: ResearchAppendOp, reserved: ReadonlySet<string>): string | undefined {
  if (op?.op !== "append" || typeof op.section !== "string" || !Object.hasOwn(SECTIONS, op.section)) return undefined;
  const config = SECTIONS[op.section];
  if (config.singleton) return undefined;
  return nextResearchId(idPoolOf(doc, op.section, config), config.prefix, reserved);
}

/**
 * A batch has a failing op: judge the rest of it too, so one call reports every
 * op's errors and the whole-document check, not one failure per round trip.
 *
 * `applyOne` mutates the document in place, and most of its refusals come after
 * the entry is already in it (an append is pushed, an update merged, and only
 * then do the section invariants run). So skipping a failed op is not enough: it
 * would stay in the document for every op after it and for the document check.
 * Each op is therefore applied to a copy of the section it writes, and the copy is
 * kept only when the op holds. A later op is then judged against the document
 * without the failed ops before it, which is what the leading line returned below
 * says. No dependency tracking: a later op can fail only because an earlier one
 * did, and the line says so.
 *
 * A failed append still takes its id, as far as the ops after it can tell: ids are
 * the highest in the section plus one, so skipping the op would hand its id to the
 * next append, and every message that names an id (and the maps `prepareOps`
 * predicted from the whole batch) would name the wrong one. Its would-be id is
 * reserved instead. A reference to that id is still refused as missing, since no
 * entry has it.
 *
 * Starts from the pre-call document and re-applies every op but the first
 * failure, whose errors are taken as the first pass found them. The ops must be
 * the pre-pass copies, since the first pass mutated the live ones. Nothing here
 * writes anything. An op that THROWS, rather than being refused, is reported as one
 * that could not be checked and does not hide the ops after it.
 *
 * When at least one op applied, the whole-document family the success path runs
 * runs on the ops that did: the misroute message, the namesake cap and the
 * introduced-errors validation. Not the fact rewrite, which only matters to a write.
 */
async function everyOpFailure(c: {
  ops: ResearchAppendOp[];
  first: OpFailure;
  before: { research: any; tree: any };
  tree: any;
  projectPath: string;
  startingPersonIds: ReadonlySet<string>;
  startingTree: SimplifiedGedcomX | null;
  applyOp: ApplyOp;
  fmt: (i: number, msg: string) => string;
}): Promise<{ errors: string[]; hints: ExampleHint[] }> {
  const { ops, first, before, fmt } = c;
  const failures: OpFailure[] = [];
  const applied: AppliedOp[] = [];
  const predicted = predictedAssertions(before.research, ops);
  const reserved = new Set<string>();
  // Shared with `before.research` until an op writes a section: each op copies the one
  // it writes, so nothing here ever changes what the other sections point at.
  let doc: any = { ...before.research };
  let appended = new Set<string>();

  const refuse = (i: number, errors: string[]) => {
    failures.push({ index: i, errors });
    const id = wouldBeId(doc, ops[i], reserved);
    if (id !== undefined) reserved.add(id);
  };
  for (let i = 0; i < ops.length; i++) {
    if (i === first.index) {
      refuse(i, first.errors);
      continue;
    }
    const trial = sectionCopy(doc, ops[i]);
    const trialAppended = new Set(appended);
    try {
      applied.push(c.applyOp(trial, ops[i], i, { appended: trialAppended, reserved, batchAssertions: assertionsOf(trial, predicted) }));
      doc = trial;
      appended = trialAppended;
    } catch (e) {
      refuse(i, e instanceof ResearchAppendError ? e.errors : [`could not be checked: ${e instanceof Error ? e.message : String(e)}`]);
    }
  }

  const lines = failures.flatMap((f) => f.errors.map((m) => fmt(f.index, m)));
  const hints = failures.map((f) => failedOpHint(ops[f.index], f.errors));
  let documentLines: string[] = [];
  if (applied.some((a) => !a.noop)) {
    const validation = await validateIntroduced(
      { research: before.research, tree: before.tree },
      { research: doc, tree: c.tree },
      { projectPath: c.projectPath },
    );
    const found = documentFailure({
      validation,
      namesake: namesakeMessages({ research: before.research }, { research: doc, tree: c.tree }, applied, c.startingPersonIds, fmt, c.startingTree),
      doc,
      ops: applied.map((a) => ops[a.opIndex]),
      applied,
      isBatch: true,
      fmt,
      namedByRefusedItems: new Set(
        failures
          .map((f) => ops[f.index])
          .filter((o) => o.section === "plan_items" && o.op === "append" && typeof o.planId === "string")
          .map((o) => o.planId as string),
      ),
    });
    if (found) {
      documentLines = found.errors;
      hints.push(...found.hints);
    }
  }
  // The line leads whenever the answer holds an error that may follow from a failed op:
  // one on an op after the first failure, or a document error, which was found without them.
  const lead = first.index < ops.length - 1 || documentLines.length > 0 ? [checkedWithoutLine(first.index)] : [];
  return { errors: [...lead, ...boundErrors([...lines, ...documentLines])], hints };
}

// ─── MCP schema ──────────────────────────────────────────────────────────────

/**
 * Writable `research.json` sections, declared once and spread into both the
 * top-level `section` and the batch `ops[].section` enums below.
 * Same pattern as `RESEARCH_QUERY_SECTIONS` in research-query.ts.
 */
export const RESEARCH_APPEND_SECTIONS = [
  "sources",
  "assertions",
  "person_evidence",
  "rejected_links",
  "questions",
  "plans",
  "plan_items",
  "conflicts",
  "hypotheses",
  "timelines",
  "proof_summaries",
  "evaluations",
  "localities",
  "namesakes",
  "project",
  "researcher_profile",
] as const;

/** `edits` on the top-level call and on each batch op. */
const EDITS_SCHEMA = {
  type: "array",
  description:
    "update of proof_summaries: change part of `narrative_markdown` or " +
    "`exhaustive_search_summary` without re-sending it. Each `old` is copied " +
    "exactly from the field's current text and must occur in it once; it is " +
    "replaced by `new`. Do not also set that field in `fields`.",
  items: {
    type: "object",
    properties: {
      field: { type: "string", enum: [...EDITABLE_NARRATIVE_FIELDS] },
      old: { type: "string" },
      new: { type: "string" },
    },
    required: ["field", "old", "new"],
  },
};

export const researchAppendSchema = {
  name: "research_append",
  description:
    "Write structured entries to the mutable research.json sections — append a new " +
    "entry (the tool assigns the id) or update an existing one in place (preserving " +
    "its id; there is no delete — supersede via a status/`superseded_by` field). Use " +
    "this for the analytical sections; use research_log_append for the research log, " +
    "and the merge / tree_edit tools for other tree.gedcomx.json edits.\n" +
    "\n" +
    "Supply each entry in its persisted snake_case shape WITHOUT an id; the tool " +
    "assigns the next `<prefix>NNN`, stamps tool-owned timestamps, validates the " +
    "whole project, and writes atomically. Returns a compact summary; on any failure " +
    "nothing is written.\n" +
    "\n" +
    "Assertions are written by extraction_append, never here: the one assertions " +
    "change accepted is an update that sets only `informant_bias_notes` on an existing " +
    "assertion, to record a re-reading or a doubt. Any other assertions write is " +
    "refused, and a disputed reading belongs in a conflict.\n" +
    "\n" +
    "To change a sentence or two of a proof summary's `narrative_markdown` or " +
    "`exhaustive_search_summary`, pass `edits: [{ field, old, new }]` on its update " +
    "instead of re-sending the whole field.\n" +
    "\n" +
    "To apply several mutations in one call, pass an `ops` array (each op is " +
    "`{ section, op, entry?/entryId?/fields?/edits?, planId? }`). Batches are " +
    "all-or-nothing: on failure nothing is written and errors name the failing ops " +
    "(`ops[i]: <msg>`) plus `opsReceived` so you can confirm no op was dropped.",
  inputSchema: {
    type: "object" as const,
    properties: {
      projectPath: {
        type: "string",
        description: "Absolute path to the project directory holding research.json.",
      },
      section: {
        type: "string",
        enum: [...RESEARCH_APPEND_SECTIONS],
        description:
          "The research.json section to write. List sections take append/update " +
          "by id; `project` is the singleton metadata object — use op 'update' " +
          'with fields (e.g. {"status": "completed"}); the tool stamps `updated`.',
      },
      op: {
        type: "string",
        enum: ["append", "update"],
        description:
          "append a new entry (tool assigns the id) or update an existing one by id.",
      },
      entry: {
        type: "object",
        description: "append: the new entry in snake_case, WITHOUT an id (the tool assigns it).",
      },
      entryId: {
        type: "string",
        description: "update: the id of the existing entry to modify (must match the section's prefix).",
      },
      fields: {
        type: "object",
        description: "update: the fields to shallow-merge onto the existing entry (the id is immutable).",
      },
      edits: EDITS_SCHEMA,
      planId: {
        type: "string",
        description: "Required for section 'plan_items' — the pl_ id of the parent plan to write into.",
      },
      ops: {
        type: "array",
        description:
          "Batch form: apply many mutations in one validate-once/write-once call " +
          "(all-or-nothing). When present, the top-level section/op/entry/entryId/" +
          "fields/edits/planId are ignored. Use this to persist a whole record at once.",
        items: {
          type: "object",
          properties: {
            section: {
              type: "string",
              enum: [...RESEARCH_APPEND_SECTIONS],
              description: "The research.json section this op writes.",
            },
            op: {
              type: "string",
              enum: ["append", "update"],
              description:
                "append (tool assigns id) or update by id.",
            },
            entry: { type: "object", description: "append: the new entry in snake_case, WITHOUT an id." },
            entryId: { type: "string", description: "update: the id of the existing entry to modify." },
            fields: { type: "object", description: "update: fields to shallow-merge (the id is immutable)." },
            edits: EDITS_SCHEMA,
            planId: { type: "string", description: "Required when section is 'plan_items' — the parent pl_ id." },
          },
          required: ["section", "op"],
        },
      },
      sourceDescription: {
        type: "object",
        description:
          "Composite persist: the tree.gedcomx.json source description to create for " +
          "this call's single sources append op. The tool assigns the S id, writes the " +
          "S entry, and stamps the source op's gedcomx_source_description_id — never " +
          "predict or pre-create the S yourself. Omit when the sources op references " +
          "an S entry that already exists.",
        properties: {
          title: { type: "string", description: "Required. The source description title." },
          author: { type: "string", description: "Optional author. Omit when not applicable (never null)." },
          url: { type: "string", description: "Optional URL. Omit when not applicable (never null)." },
        },
        required: ["title"],
      },
      verdict: {
        type: "object",
        description:
          "Composite persist for an `evaluations` append: the structured verdict body " +
          "(strengths, must_address, consider_addressing, narrative_for_user, …). The " +
          "tool writes it to evaluations/<focus>-<target_id>-<short_iso>.json and stamps " +
          "the entry's `file_path` itself — do NOT write the file yourself, and do NOT " +
          "set file_path when passing this. The entry stays a pointer record; the verdict " +
          "body never goes into research.json. Supplying both `verdict` and `file_path` " +
          "is rejected.",
      },
      resolveStandardPlace: {
        type: "boolean",
        description:
          "Default true: for an assertion append with a `place` but no `standard_place`, " +
          "the tool copies the sidecar record's resolved standard_place when available, " +
          "else geocodes the place text. Pass false to skip the geocoding lookup " +
          "(sidecar copy still applies). Supply `standard_place: null` on an entry to " +
          "opt a single assertion out entirely.",
      },
    },
    required: ["projectPath"],
  },
};

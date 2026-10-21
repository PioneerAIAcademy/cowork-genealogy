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
import { planItemFlags } from "../utils/plan-item-plausibility.js";
import { getProjectStore } from "../store/project-store.js";
import { readStartingTree, startingPersonIdsOf } from "../utils/starting-tree.js";
import { SETTLED_CONFLICT_STATUSES, VALIDATOR_ENUMS } from "../validation/validator.js";
import { validateIntroduced } from "../validation/introduced-errors.js";
import { sanitizeTree } from "../validation/tree-sanitize.js";
import {
  competingParentSets,
  conflictBlocksCompletion,
  questionTiedAssertionIds,
  whyConflictBlocksCompletion,
} from "../utils/question-state.js";
import {
  atomicWriteJson,
  atomicWriteBoth,
  isInsideProject,
  readProjectJson,
  formatIssues,
  withProjectLock,
  NoProjectError,
  noProjectResult,
} from "../utils/project-io.js";
import { coerceJsonArg } from "../utils/coerce-json-arg.js";
import {
  readMatchScores,
  findRecordedScore,
  type MatchScoreFile,
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
  countryConsistency,
  isNonPlacePhrase,
  type PlaceCoords,
} from "../utils/place-resolver.js";
import { birthThresholdMiles, lookupPlaceCoords } from "../utils/place-coords.js";
import { haversineDistance } from "./distance.js";
import { exampleHints } from "./research-append-examples.js";
import { gcUnreferencedImages, sourceImageCapState } from "../utils/image-store.js";
import { nextId } from "../utils/gedcomx-ids.js";
import { arkToBareId } from "../utils/ark.js";
import { PERSONA_BEARING_PRODUCERS } from "../utils/results-staging.js";
import { isStopGateSatisfied, getStoppedBecause } from "../utils/question-stop.js";

// Re-exported for back-compat: tests and any other importer that reaches this
// check via research-append.ts (its original home) keep working unchanged.
// The implementation now lives in place-resolver.ts, shared with tree-edit.ts.
export { countryConsistency };
import { stdDate } from "../utils/date-standardize.js";
import { MONTH_NUM } from "../utils/date-constants.js";
import { treeDiff } from "./tree-diff.js";
import {
  ASSERTION_FACT_ATTRS,
  assertionFactAttr,
  assertionTreeFactType,
  factText,
  materializesToPersonFact,
  type AssertionFactAttr,
  factTypeKey,
} from "../utils/record-persona.js";
import type { SimplifiedGedcomX, SimplifiedFact } from "../types/gedcomx.js";
import { recordBasisOf } from "../utils/record-basis.js";

// ─── Section configuration (the per-section table phases 2–3 extend) ─────────

interface SectionConfig {
  /** id prefix, including the trailing underscore (e.g. "src_"). */
  prefix: string;
  /** Tool-owned timestamp stamped on append when the entry omits it. */
  stampTimestamp?: { field: string; kind: "date" | "datetime" };
  /** Nested section: entries live in `<parent>[<param>].<field>` (plan_items). */
  nested?: { parent: string; param: "planId"; field: string };
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
  rejected_links: { prefix: "rj_", stampTimestamp: CREATED_DATE },
  // Phase 2
  questions: { prefix: "q_", stampTimestamp: CREATED_DATE },
  plans: { prefix: "pl_", stampTimestamp: CREATED_DATE },
  plan_items: { prefix: "pli_", nested: { parent: "plans", param: "planId", field: "items" } },
  conflicts: { prefix: "c_" },
  hypotheses: { prefix: "h_" },
  // Phase 3
  timelines: { prefix: "t_", stampTimestamp: { field: "generated", kind: "datetime" } },
  proof_summaries: { prefix: "ps_" },
  evaluations: { prefix: "ev_", stampTimestamp: { field: "timestamp", kind: "datetime" } },
  known_holdings: { prefix: "kh_", stampTimestamp: CREATED_DATE },
  localities: { prefix: "loc_", stampTimestamp: CREATED_DATE },
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

function placeContainmentErrors(entry: any, research: any): string[] {
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
  const assertions: any[] = research.assertions ?? [];
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
        c.status !== "resolved" &&
        c.status !== "moot",
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
const RELATIONAL_FACT_TYPES: ReadonlySet<string> = new Set([
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
 *  enough, since two resolutions of the same text can differ. Two places agree
 *  when one is `compatiblePlace` with the other, or when the top level one of
 *  them names appears in the other and every level below it matches. That second
 *  test is what lets "Staffordshire, England" agree with "West Bromwich,
 *  Staffordshire, England, United Kingdom" and "Georgia" with "Georgia, United
 *  States": `compatiblePlace` lines the two up from the country, so a place
 *  written without its country, or with an extra level above it, read as a
 *  different place. Over the committed fixture and e2e documents that refused
 *  1,067 confident/probable links on place, almost all of them that shape. */
function birthPlacesAgree(assertion: any, birth: any): boolean {
  const agree = (a: string, b: string): boolean =>
    compatiblePlace(a, b) || alignedBelowTop(a, b) || alignedBelowTop(b, a);
  if (agree(String(assertion.place), String(birth.place))) return true;
  const sa = assertion?.standard_place;
  const sb = birth?.standard_place;
  return (
    typeof sa === "string" && placeSegments(sa).length > 0 &&
    typeof sb === "string" && placeSegments(sb).length > 0 &&
    agree(sa, sb)
  );
}

/** True when `x`'s least-specific level appears in `y` and each level of `x`
 *  below it matches the level of `y` at the same depth. */
function alignedBelowTop(x: string, y: string): boolean {
  const xs = placeSegments(x).map(normalizeString).reverse();
  const ys = placeSegments(y).map(normalizeString).reverse();
  const at = ys.indexOf(xs[0]);
  if (at < 0) return false;
  const n = Math.min(xs.length, ys.length - at);
  for (let k = 0; k < n; k++) if (xs[k] !== ys[at + k]) return false;
  return true;
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
 *  entries, against 38 without them and 274 comparing any place at all. */
function contradictionIsCredible(assertion: any): boolean {
  if (assertion?.information_quality === "secondary") return false;
  return !WEAK_INFORMANT_PROXIMITY.has(
    String(assertion?.informant_proximity ?? "unknown"),
  );
}

/** A person_evidence link as the contradiction gate needs it: which assertion,
 *  to which person. */
export interface PersonLink {
  assertion_id: string;
  person_id: string;
}

/** The record party an assertion describes: `record_persona_id` when the
 *  sidecar kept one, `record_role` otherwise (required on every assertion). The
 *  same key `record-persona.ts` groups by; the contradiction gate and its
 *  two-party arm both read it from here so the two cannot drift apart. */
function partyKey(a: any): string | null {
  return a?.record_persona_id ?? a?.record_role ?? null;
}

/** Links the gate can see for this call: the project's live person_evidence
 *  with this batch's person_evidence ops replayed over it, whatever order the
 *  ops arrive in. An update that supersedes a link removes it, and one that
 *  re-points `person_id` or `assertion_id` moves it, so a link retired in the
 *  same call cannot pair and a link moved onto a person does. */
function batchPersonLinks(research: any, ops: ResearchAppendOp[]): PersonLink[] {
  const byId = new Map<string, { assertion_id: unknown; person_id: unknown; superseded: boolean }>();
  const appended: { assertion_id: unknown; person_id: unknown; superseded: boolean }[] = [];
  const live: any[] = Array.isArray(research?.person_evidence) ? research.person_evidence : [];
  for (const e of live) {
    if (e && typeof e.id === "string") {
      byId.set(e.id, { assertion_id: e.assertion_id, person_id: e.person_id, superseded: !!e.superseded_by });
    }
  }
  for (const op of ops) {
    if (op.section !== "person_evidence") continue;
    if (op.op === "append") {
      const e = (op as any).entry;
      if (e) appended.push({ assertion_id: e.assertion_id, person_id: e.person_id, superseded: !!e.superseded_by });
    } else if (op.op === "update" && typeof op.entryId === "string") {
      const cur = byId.get(op.entryId);
      const f = (op as any).fields ?? {};
      if (!cur) continue;
      if (Object.prototype.hasOwnProperty.call(f, "superseded_by")) cur.superseded = !!f.superseded_by;
      if (typeof f.person_id === "string") cur.person_id = f.person_id;
      if (typeof f.assertion_id === "string") cur.assertion_id = f.assertion_id;
    }
  }
  const out: PersonLink[] = [];
  for (const l of [...byId.values(), ...appended]) {
    if (!l.superseded && typeof l.assertion_id === "string" && typeof l.person_id === "string") {
      out.push({ assertion_id: l.assertion_id, person_id: l.person_id });
    }
  }
  return out;
}

/** Whether `linked`, a two-party assertion, is about its OWN party when linked
 *  to `entry.person_id`: true when some other link ties a one-party assertion of
 *  the same record and the same party to that same person. The party key is the
 *  one the gate below uses (`record_persona_id`, else `record_role`). */
function ownPartyLinkedTo(
  linked: any,
  entry: any,
  recordId: string,
  assertionById: ReadonlyMap<string, any>,
  personLinks?: ReadonlyArray<PersonLink>,
): boolean {
  if (!personLinks || personLinks.length === 0) return false;
  const party = partyKey(linked);
  if (party === null) return false;
  return personLinks.some((l) => {
    if (l.person_id !== entry.person_id || l.assertion_id === entry.assertion_id) return false;
    const other = assertionById.get(l.assertion_id);
    if (!other) return false;
    if (RELATIONAL_FACT_TYPES.has(String(other.fact_type ?? "").toLowerCase())) return false;
    return (other.record_id ?? other.source_id ?? null) === recordId && partyKey(other) === party;
  });
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
 *  (`REGION_PLACE_TYPES`), they are not two counties, and some year is known. */
function birthPlacesFarApart(assertion: any, birth: any, coords?: BirthPlaceCoords): boolean {
  if (birthCountriesDiffer(assertion, birth)) return true;
  const sa = assertion?.standard_place;
  const sb = birth?.standard_place;
  if (typeof sa !== "string" || typeof sb !== "string") return true;
  const pa = coords?.get(sa);
  const pb = coords?.get(sb);
  if (!pa || !pb) return true;
  if (REGION_PLACE_TYPES.has(placeTypeKey(pa.type)) || REGION_PLACE_TYPES.has(placeTypeKey(pb.type))) return true;
  if (placeTypeKey(pa.type) === "county" && placeTypeKey(pb.type) === "county") return true;
  const years = yearsIn(birth.date, birth.standard_date, assertion.date);
  if (years.length === 0) return true;
  const { miles } = haversineDistance(pa.latitude, pa.longitude, pb.latitude, pb.longitude);
  return miles > birthThresholdMiles(Math.min(...years), Math.max(...years));
}

interface ContradictionScope {
  twoParty: boolean;
  birth: any;
  sameRecord: any[];
}

/** What the gate compares for one link, or null when the link is out of scope:
 *  not confident/probable, no resolvable record, a two-party assertion about the
 *  other party, or a tree person with no Birth fact. */
function contradictionScope(
  entry: any,
  research: any,
  tree: any,
  personLinks?: ReadonlyArray<PersonLink>,
  batchAssertions?: Map<string, any>,
): ContradictionScope | null {
  if (entry.confidence !== "confident" && entry.confidence !== "probable") return null;
  // Every assertion this call can resolve: the document's, plus this batch's
  // predicted appends. Reading only `research.assertions` let a batch that puts
  // its assertion appends AFTER the person_evidence ops silence this gate, the
  // ordering bypass the score gate already closed.
  const assertionById = new Map<string, any>();
  for (const a of (research.assertions ?? []) as any[]) {
    if (a && typeof a.id === "string") assertionById.set(a.id, a);
  }
  if (batchAssertions) for (const [id, a] of batchAssertions) assertionById.set(id, { ...a, id });
  const assertions: any[] = [...assertionById.values()];
  const linked = assertionById.get(entry.assertion_id);
  if (!linked) return null;
  const recordId = linked.record_id ?? linked.source_id ?? null;
  if (recordId == null) return null;

  // A relationship assertion bears on BOTH people it names, and its own party
  // is only one of them: `a_004` ("listed in household of Thomas Flynn,
  // position consistent with son") carries the CHILD's role while the link may
  // be to the father. Comparing the child's stated birth of 1845 against a
  // father the tree puts at 1818 produced 14 refusals that are one household,
  // not one contradiction. The assertion alone cannot say which side a link is
  // about, so a two-party assertion is out of scope -- UNLESS another link ties
  // the same record party to the same person through a one-party assertion.
  // Then the link is about the assertion's own party, and skipping it let a
  // baptism's relationship assertion carry `confident` onto the very person
  // its christening date had just been refused on (ut_person_evidence_024,
  // 2026-09-29: a_003 capped, a_001 from the same child persona persisted).
  //
  // The widened reach checks the DATE arm only. Measured 2026-09-29 over 302
  // committed fixture and e2e documents (9,736 confident/probable links), running
  // the place arm too would add 247 refusals, and every one read was a
  // less-specific place ("Ohio" against "Ohio, United States"), which
  // `compatiblePlace`'s country-first prefix test calls a contradiction. That is
  // a comparator defect, not a contradiction, and this arm must not export it.
  // Date only, the same corpus gains 11 refusals, all read: 9 are a census
  // persona whose OWN birth assertion is more than 5 years from the tree birth,
  // which the one-party arm already refuses for that persona; 2 (one Spriggs run)
  // inherit an extraction that gave father and child one record_persona_id, which
  // already refuses every one-party link of that persona. No new class.
  const twoParty = RELATIONAL_FACT_TYPES.has(String(linked.fact_type ?? "").toLowerCase());
  if (twoParty) {
    if (!ownPartyLinkedTo(linked, entry, recordId, assertionById, personLinks)) {
      return null;
    }
  }

  const person = ((tree?.persons ?? []) as any[]).find((p: any) => p?.id === entry.person_id);
  if (!person) return null;
  const birth = ((person.facts ?? []) as any[]).find(
    (f: any) => String(f?.type ?? "").toLowerCase() === "birth",
  );
  if (!birth) return null;

  // Every assertion this record makes about THE SAME PARTY as the linked one.
  //
  // Scoping to the record alone is wrong and was measured wrong: a census or a
  // baptism names several people, and comparing a son's stated birth of 1845
  // against a father who the tree says was born 1818 produced 30 refusals that
  // are all one household, not one contradiction. The party key is the same one
  // `record-persona.ts` groups by -- `record_persona_id` when the sidecar kept
  // one, `record_role` otherwise, which is required on every assertion.
  const linkedParty = partyKey(linked);
  const sameRecord = assertions.filter(
    (a: any) =>
      a &&
      (a.record_id ?? a.source_id ?? null) === recordId &&
      partyKey(a) === linkedParty &&
      linkedParty !== null,
  );
  return { twoParty, birth, sameRecord };
}

/** The record's birth-place assertions that disagree with the tree's Birth
 *  place, before the distance test. */
function disagreeingBirthPlaces(scope: ContradictionScope): any[] {
  const { twoParty, birth, sameRecord } = scope;
  if (twoParty || typeof birth.place !== "string" || placeSegments(birth.place).length === 0) return [];
  return sameRecord.filter((a: any) =>
    // Like for like. An ANY-place comparison refuses 274 of 323 committed
    // confident/probable entries (85%) because a marriage or census place is
    // not a claim about birthplace: a man born in Ireland appears in a
    // Pennsylvania census, and that is biography, not contradiction.
    BIRTH_PLACE_FACT_TYPES.has(String(a.fact_type ?? "").toLowerCase()) &&
    contradictionIsCredible(a) &&
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
): string[] {
  const scope = contradictionScope(entry, research, tree, personLinks, batchAssertions);
  if (!scope) return [];
  const { birth, sameRecord } = scope;

  const findings: string[] = [];

  // ── place ────────────────────────────────────────────────────────────────
  const far = disagreeingBirthPlaces(scope).find((a) => birthPlacesFarApart(a, birth, birthPlaceCoords));
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
      if (!contradictionIsCredible(a)) continue;
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

  if (findings.length === 0) return [];
  return [
    `confidence '${entry.confidence}' is not available on this link: ${findings.join("; ")}. ` +
      `A contradicted core identifier caps the link at 'speculative' regardless of the match ` +
      `score, and the user is asked before it stands. Use 'speculative' and name the ` +
      `contradiction in the rationale, or resolve it first — a confident wrong identity is ` +
      `worse than a flagged uncertain one.`,
  ];
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
  const assertionById = new Map<string, any>();
  for (const a of (research?.assertions ?? []) as any[]) {
    if (a && typeof a.id === "string") assertionById.set(a.id, a);
  }
  if (batchAssertions) for (const [id, a] of batchAssertions) assertionById.set(id, { ...a, id });
  const linked = assertionById.get(entry.assertion_id);
  if (!linked) return [];
  const recordId = linked.record_id ?? linked.source_id ?? null;
  if (recordId == null) return [];

  // The linked party's own residence; failing that, the household head's (a
  // census lists the residence once, on the head). Never another party's: an
  // informant living elsewhere says nothing about where the subject lived.
  const residenceOf = (pick: (a: any) => boolean) => {
    const countries = new Set<string>();
    let place: string | null = null;
    for (const a of assertionById.values()) {
      if ((a.record_id ?? a.source_id ?? null) !== recordId) continue;
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

  // Exact lookup on (assertion, tree person) -- the pair the writer was called
  // with and the pair this entry carries, so the two sides cannot disagree.
  // Keying on the PARTY instead could not see a score written by the fetched
  // route, which resolves a real persons[].id where the assertion carries null:
  // the gate then refused precisely the links whose call HAD been made. Persona
  // granularity (ADR-0009 constraint 3) survives because an assertion is a
  // (record, party) pair, so a second persona is a different assertion.
  const file = matchScores.get(recordId) ?? null;
  if (findRecordedScore(file, entry.assertion_id, entry.person_id) !== null) return [];

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
      `score it: leave match_score null and say why in the rationale.${roleHint}`,
  ];
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
  if (FS_PERSON_PID.test(personId)) return false;
  if (startingPersonIds?.has(personId)) return false;
  const person = ((tree?.persons ?? []) as any[]).find((p: any) => p?.id === personId);
  if (!person) return false;
  const refs = new Set<string>();
  // Person-level refs count too (#2696): "only source ref" means every ref the
  // person carries, and person_read attaches FamilySearch's at this level.
  for (const src of (person.sources ?? []) as any[]) {
    if (typeof src?.ref === "string" && src.ref !== "") refs.add(src.ref);
  }
  for (const n of (person.names ?? []) as any[]) {
    for (const src of (n?.sources ?? []) as any[]) {
      if (typeof src?.ref === "string" && src.ref !== "") refs.add(src.ref);
    }
  }
  for (const f of (person.facts ?? []) as any[]) {
    for (const src of (f?.sources ?? []) as any[]) {
      if (typeof src?.ref === "string" && src.ref !== "") refs.add(src.ref);
    }
  }
  if (refs.size === 0) return false; // provenance unknown, not circular

  const bySourceDescription = new Map<string, any>();
  for (const src of (research?.sources ?? []) as any[]) {
    const gid = src?.gedcomx_source_description_id;
    if (typeof gid === "string" && gid !== "") bySourceDescription.set(gid, src);
  }
  const recordsBySourceId = new Map<string, Set<string>>();
  for (const a of (research?.assertions ?? []) as any[]) {
    const sid = a?.source_id;
    const rec = a?.record_id;
    if (typeof sid !== "string" || typeof rec !== "string" || rec === "") continue;
    if (!recordsBySourceId.has(sid)) recordsBySourceId.set(sid, new Set());
    recordsBySourceId.get(sid)!.add(rec);
  }

  const reached = new Set<string>();
  for (const ref of refs) {
    const bare = ref.startsWith("#") ? ref.slice(1) : ref;
    const src = bySourceDescription.get(bare);
    if (!src || typeof src.id !== "string") continue;
    for (const rec of recordsBySourceId.get(src.id) ?? []) reached.add(rec);
  }
  // Every record this person's refs reach is the one under scrutiny.
  return reached.size > 0 && [...reached].every((r) => r === recordId);
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
 *  `projectPath` (nothing was staged, so there is no file to name). Refusing
 *  either would block correct work to catch a documentation gap, which is the
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
    if (disputed.size > 0) {
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
      if (blocking.size > 0) {
        return [
          `question ${entry?.id ?? "(no id)"} cannot be marked resolved while ` +
            `${[...blocking].sort().join(", ")} ${blocking.size === 1 ? "is" : "are"} ` +
            "unresolved: that conflict disputes evidence the conclusion relies on, so the " +
            "sources behind it have never been correlated. This is not the same as a question " +
            "researched and found empty, which `not_proved` does close — here the work is " +
            "unfinished rather than finished with nothing. Leave the question open, record the " +
            "attempt at `not_proved`, and invoke conflict-resolution; resolve it after.",
        ];
      }
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
 *  currently in question. */
function disputedSourceIds(research: any): Map<string, string[]> {
  const assertionSource = new Map<string, string>();
  for (const a of Array.isArray(research?.assertions) ? research.assertions : []) {
    if (a?.id && typeof a.source_id === "string") assertionSource.set(a.id, a.source_id);
  }
  const bySource = new Map<string, string[]>();
  for (const c of Array.isArray(research?.conflicts) ? research.conflicts : []) {
    if (!c || c.status === "resolved") continue;
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
    if (SETTLED_CONFLICT_STATUSES.has(c.status)) {
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
  return [
    `tier '${tier}' is not available while ${blocking.join(", ")} ` +
      `${blocking.length === 1 ? "is" : "are"} unresolved: ` +
      `${blocking.length === 1 ? "that conflict disputes" : "those conflicts dispute"} ` +
      `evidence from ${shared.join(", ")}, which this conclusion also relies on. ` +
      "Correlating sources assumes they describe the same person, and that is " +
      "what the open conflict puts in question — so no tier above `not_proved` " +
      "is reachable, and tiering down to `possible` does not repair it. Record " +
      "the attempt at `not_proved`, naming the conflict and what would settle " +
      "it, then invoke conflict-resolution. Re-conclude by updating that same " +
      "summary once the conflict is resolved.",
  ];
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
      "passing only the fields that changed. Appending here would leave two contradictory " +
      "conclusions on one question, with nothing to say which is current.",
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
 *  a live `person_evidence` link in the pre-call document.
 *
 *  None, not all. A household record leaves its children and wife unlinked once
 *  the subject is linked, so an all-linked rule would refuse 27 of 211 committed
 *  e2e proofs; none-linked refuses 3, and every one of the 3 comes from a run
 *  with no `person_evidence` row at all (chresten-nielsen-daughter 2026-08-09,
 *  victoriano-macatangay-parents 2026-08-13 ×2). That is the identity step never
 *  run, which is the case worth refusing: LZJF-J13 (issue #3177) concluded
 *  `probable` on "correlation across several independent entries" with 0 of 15
 *  assertions linked.
 *
 *  Pre-call snapshot, as the conflict gates: a batch may not supply the link and
 *  spend it on a tier in the same call — and `person_evidence` is written only by
 *  person-evidence, never by the agent writing the proof. */
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
      .filter((pe: any) => pe?.superseded_by == null)
      .map((pe: any) => pe?.assertion_id),
  );
  if (supporting.some((id: string) => linked.has(id))) return [];
  return [
    `proof_summaries ${entry.id ?? "(new entry)"}: tier '${tier}' rests on ${supporting.length} ` +
      `supporting assertion(s), and none is linked to a person in person_evidence. A conclusion ` +
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
 *  assertion carrying a live `person_evidence` link in the pre-call document.
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
 *  side, and either side satisfies `parent`. Over the 249 committed proofs above
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
      .filter((pe: any) => pe?.superseded_by == null)
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

/** A verb that reports what a record says: "the index records Jonathan, son of William". */
const RECORD_REPORTING =
  /\b(?:reads?|reading|records?|recording|shows?|showing|shown|lists?|listing|listed|index(?:es|ed|ing)?|names?|naming|gives?|giving|given|states?|stating|describes?|describing|identif(?:y|ies|ied|ying)|calls?|calling|transcribe[sd]?|transcribing)\b/i;

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
 *  live-linked name assertion anywhere in the pre-call document carries that
 *  name. Quoted record text is ignored, and so is a phrase whose sentence reports
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
      .filter((pe: any) => pe?.superseded_by == null && typeof pe?.person_id === "string")
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
    .filter((a) => a?.fact_type === "name" && linked.has(a.id))
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
 *  `statuses` defaults to `in_progress` alone, which is what the new-question
 *  gate below asks for. `planCompleteInvariants` additionally passes `planned`
 *  (issue #1830): an undisposed item leaves the record unable to say whether it
 *  was answered by what is already held or simply never run. The two gates ask
 *  different questions of the same plan, so the status set is the caller's. */
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

/** A new question may not be created while any unresolved question has an
 *  active-plan item `in_progress`, with two exceptions.
 *
 *  (1) chesworthrm, 2026-09-29: the new question may target an unresolved
 *  conflict that blocks the in-flight question. Checked against `conflicts[]`
 *  — an `unresolved` conflict must list the in-flight question in
 *  `blocks_question_ids`, AND the new question's `unblocks` must name it. A
 *  filled-in `unblocks` alone proves nothing.
 *
 *  (2) issue #3259: a `person_warnings` contradiction on an in-scope person is
 *  Priority 1 the same way an unresolved conflict is, but a contradiction is
 *  never persisted anywhere in `research.json` -- `person_warnings` is a live,
 *  read-only call, and a `questions[]` entry carries no `personId` to check it
 *  against -- so there is no document this guard can read the way it reads
 *  `conflicts[]` for (1). Trusted on the new question's own
 *  `selection_basis: "unresolved_conflict"` alone, the same self-reported
 *  trust this guard already extends to every OTHER `selection_basis` value
 *  outside the in-progress scenario (`hypothesis_test`, `timeline_gap`, etc.
 *  are never verified here either). Unlike (1), not scoped to `unblocks`
 *  naming the specific in-flight question -- a contradiction found this call
 *  is not necessarily about whatever is already in progress, so requiring
 *  `unblocks` to name it would be a false claim the eval judge would
 *  rightly flag. A known, accepted gap (ADR-0011 limit 1: false-allow over
 *  false-refusal) until person_warnings output has somewhere to persist.
 *
 *  There is deliberately no general "add a question anyway" override: the tool
 *  cannot tell a real user override from a delegation that claims one, and the
 *  override's shape (`depends_on` naming the in-flight question) is exactly how
 *  `ut_question_selection_d01` fails. A user who wants to move on marks the
 *  in-flight item done or skipped first.
 *
 *  jud-sdev's review, 2026-10-16: as first shipped, `selfReportedContradiction`
 *  was a single boolean applied to every active-plan item, so it switched the
 *  WHOLE guard off -- including (1)'s conflict-scoped check and the no-override
 *  rule above -- for any append carrying that one `selection_basis` string,
 *  regardless of what else the entry claimed. Narrowed to also require an empty
 *  `depends_on`, which puts the `ut_question_selection_d01` guarantee back: an
 *  entry shaped like that override (naming the in-flight question in
 *  `depends_on`) is refused even when it also claims
 *  `selection_basis: "unresolved_conflict"`. NOT fully closed by this narrowing:
 *  a question with `unblocks` naming the in-flight question and no `depends_on`
 *  still takes (2)'s free pass even when it is actually about a conflict
 *  `conflicts[]` already documents -- in which case (1)'s stricter check (that
 *  conflict's `blocks_question_ids` must list the in-flight question) never
 *  gets a chance to run. jud-sdev's review (2026-10-19) found "ruled to leave
 *  it" here was never actually true -- that was an internal call in this
 *  session's own conversation, not an on-the-record decision from the lead who
 *  made the 2026-09-29 ruling this would narrow. Put to DallanQ on issue #3259
 *  (2026-10-19) instead; PENDING as of this commit. Current behavior:
 *  unscoped against `unblocks`, on the same self-reported trust the rest of
 *  this exception already rests on (`person_warnings` output has no document
 *  to verify the claim against either way), since tightening it further risks
 *  the false-refusal direction ADR-0011 limit 1 says to avoid -- but that
 *  tradeoff is exactly what is pending a ruling, not settled.
 *
 *  Same pre-call snapshot and active-plan discipline as
 *  `planCompleteInvariants`: a superseded plan's items are frozen and a resolved
 *  question's plan is settled, so neither blocks. */
function newQuestionWhileSearchInFlightInvariants(entry: any, preCallResearch: any): string[] {
  const unresolvedQuestions = new Set<string>(
    (Array.isArray(preCallResearch?.questions) ? preCallResearch.questions : [])
      .filter((q: any) => typeof q?.id === "string" && q.status !== "resolved")
      .map((q: any) => q.id),
  );
  const unblocks = new Set<string>(
    Array.isArray(entry?.unblocks) ? entry.unblocks.filter((u: unknown) => typeof u === "string") : [],
  );
  const conflictBlocked = new Set<string>();
  for (const c of Array.isArray(preCallResearch?.conflicts) ? preCallResearch.conflicts : []) {
    if (c?.status !== "unresolved" || !Array.isArray(c.blocks_question_ids)) continue;
    for (const q of c.blocks_question_ids) if (typeof q === "string") conflictBlocked.add(q);
  }
  const selfReportedContradiction =
    entry?.selection_basis === "unresolved_conflict" &&
    !(Array.isArray(entry?.depends_on) && entry.depends_on.length > 0);
  const refused = activePlanItems(
    preCallResearch,
    (plan) =>
      unresolvedQuestions.has(plan.question_id) &&
      !selfReportedContradiction &&
      !(conflictBlocked.has(plan.question_id) && unblocks.has(plan.question_id)),
  ).map((item) => `${item.itemId} (on ${item.questionId})`);
  if (refused.length === 0) return [];
  const ids = refused.sort().join(", ");
  return [
    `a new question cannot be opened while research is still running: ${ids} ` +
      `${refused.length === 1 ? "is" : "are"} still 'in_progress'. The plan says that search ` +
      "has not finished, whatever the request that reached you says. Write no question now: " +
      "report the in-flight item as the reason. Three exceptions: (1) a question that resolves " +
      "an unresolved conflict whose `blocks_question_ids` lists that question, with the new " +
      "question's `unblocks` naming it; (2) if this same call also resolves that question — " +
      "this check reads the project as it stood before the call, so write the resolution in " +
      "its own call and append the new question in the next one; (3) a question with " +
      "`selection_basis: \"unresolved_conflict\"` driven by a person_warnings contradiction.",
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
 *  **One exemption: the deferred external hand-off.** search-records runs
 *  three nil searches, then hands the item to search-external-sites, which,
 *  with no user present to capture, logs a deferred entry and skips the item
 *  `inaccessible`. `completed` is refused there by capture-pending, so refusing
 *  the skip too would leave the item `in_progress` for good and the question
 *  undeclarable (lead, 2026-10-20). So wherever capture-pending would refuse
 *  `completed`, this rule stays silent and capture-pending answers alone: it
 *  lets an `inaccessible` or `user_declined` skip stand, and refuses any other
 *  category with a message naming those two. Capture-pending itself decides
 *  which entry is latest, so the two rules cannot disagree. */
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
  return [
    `plan_items[${pid}]: ${ran.id} (${ran.tool}, ${ran.outcome}) shows this item's search ran, ` +
      `so it cannot be marked 'skipped', which says nothing was searched. Set it to 'completed' ` +
      `instead: ${ran.id} names this item, so the completion is attributed.`,
  ];
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

/** The two tiers that are a final answer rather than a stalled one: `proved`
 *  establishes the claim, `disproved` affirmatively refutes it. `not_proved` is
 *  deliberately absent — it is a non-answer, so something IS holding it back. */
const CONCLUSIVE_TIERS = new Set(["proved", "disproved"]);

function proofSummaryInvariants(
  entry: any,
  preCallExhaustiveDeclared: Map<string, boolean> | undefined,
): string[] {
  const tier = entry?.tier;

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
      return [
        `tier '${tier}' is a conclusive answer — it reached a verdict, so nothing ` +
          `is holding it back and shortfall must be 'none'; got '${shortfall}'. ` +
          `Use 'ceiling', 'gap' or 'conflict' only on a tier that did NOT reach ` +
          `one (probable, possible, not_proved).`,
      ];
    }
    if (!CONCLUSIVE_TIERS.has(tier) && shortfall === "none") {
      return [
        `shortfall 'none' says nothing is holding this conclusion back, but tier ` +
          `'${tier}' reached no conclusive answer — so something is. Name it: ` +
          `'ceiling' (the reachable record is exhausted), 'gap' (a reachable ` +
          `source is still unsearched), or 'conflict' (an unresolved conflict ` +
          `names this question in its blocks_question_ids).`,
      ];
    }
  }

  if (!CONCLUSIVE_TIERS.has(tier)) return [];
  const declaredBeforeThisCall = preCallExhaustiveDeclared?.get(entry?.question_id) === true;
  if (!declaredBeforeThisCall) {
    return [
      `tier '${tier}' requires question '${entry?.question_id}' to already have its stop gate ` +
        `satisfied (search_stop.stopped_because is 'question_answered', 'record_exhausted', or ` +
        `'nothing_further_reachable') from BEFORE this call (a batch may not declare exhaustiveness ` +
        `and consume it for a tier in the same call) — invoke research-exhaustiveness first, in its ` +
        `own call.`,
    ];
  }
  return [];
}

export type ResearchAppendSection = keyof typeof SECTIONS | string;

/** One mutation. The body of a single call, or one element of a batch `ops`. */
export interface ResearchAppendOp {
  section: ResearchAppendSection;
  op: "append" | "update";
  entry?: Record<string, unknown>; // op = append (no id — the tool assigns it)
  entryId?: string; // op = update
  fields?: Record<string, unknown>; // op = update (shallow-merged; id immutable)
  planId?: string; // required for section = "plan_items"
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
  planId?: string;
  // Batch form — supply ops; when present the single-op fields above are ignored.
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
  filesWritten: string[];
  validation: { valid: true; warnings: string[] };
}
interface BatchSuccess {
  ok: true;
  results: { section: string; op: "append" | "update"; entryId: string }[];
  sourceDescriptionId?: string;
  sourceReuse?: SourceReuseEcho;
  resolvedPlaces?: ResolvedPlaceEcho[];
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

/** Next `<prefix>NNN` id (max + 1, zero-padded to 3) for a research section. */
function nextResearchId(entries: any[], prefix: string): string {
  let max = 0;
  const re = new RegExp(`^${prefix}(\\d+)$`);
  for (const e of entries) {
    const m = e && typeof e.id === "string" ? e.id.match(re) : null;
    if (m) {
      const n = Number(m[1]);
      if (n > max) max = n;
    }
  }
  return `${prefix}${String(max + 1).padStart(3, "0")}`;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function now(): string {
  return new Date().toISOString();
}

interface AppliedOp {
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
): Array<{ index: number; message: string }> {
  const createdIds = applied
    .filter((a) => a.section === "plans" && a.op === "append" && typeof a.entryId === "string")
    .map((a) => a.entryId);
  if (createdIds.length === 0) return [];
  // APPENDS only. A `plan_items` update targets an item that already exists in
  // the plan it names, so it is not a misdirected item and the prescription
  // below ("re-issue with planId X") would make it fail on a missing entryId.
  const itemPlanIds = ops
    .filter((o) => o.section === "plan_items" && o.op === "append" && typeof o.planId === "string")
    .map((o) => o.planId as string);
  if (itemPlanIds.length === 0) return [];

  // The k-th `plans` append op produced the k-th created plan id, in op order.
  const planOpIndexes = ops
    .map((o, i) => ({ o, i }))
    .filter(({ o }) => o.section === "plans" && o.op === "append")
    .map(({ i }) => i);
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
    return pl && !(Array.isArray(pl.items) && pl.items.length > 0) &&
      !("items" in pl && pl.items !== null && !Array.isArray(pl.items));
  });

  const out: Array<{ index: number; message: string }> = [];
  for (let k = 0; k < createdIds.length; k++) {
    const newId = createdIds[k];
    const pl = byId.get(newId);
    if (!pl) continue;
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
      index: planOpIndexes[k] ?? 0,
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
 *  labels an assertion with one of these, `canonicalizeAssertionLabels` folds
 *  the type into the event (via FACT_TYPE_ALIASES) AND lifts the place value
 *  into the `place` field if it is not already there — so the machine-readable
 *  place survives the fold and the assertion reads as the event's place-claim. */
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

/** Best-effort canonicalization of an assertion's `fact_type` in place. Maps a
 *  known alias (by normalized key) to its canonical spelling, and folds a
 *  place-of-event variant into the event type while lifting its place value into
 *  the `place` field (see the doc comment on FACT_TYPE_ALIASES). Leaves an
 *  unrecognized value untouched (open enum). No-op for a non-assertion entry
 *  (only assertions carry `fact_type`) or a non-string value. */
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
  // A folded place-of-event variant must keep its place machine-readable: if
  // neither `place` nor `standard_place` is set, lift the human `value` (which
  // for a place-claim IS the place string, e.g. "Ireland") into `place`.
  if (PLACE_VARIANT_KEYS.has(key) && isBlank(entry.place) && isBlank(entry.standard_place) && !isBlank(entry.value)) {
    entry.place = entry.value;
  }
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
): AppliedOp {
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
            "could not settle is still recorded as 'resolved' with all three analyses and " +
            "resolution_kind 'tree', saying in resolution_rationale why it cannot be settled and " +
            "what would settle it — a deferral is a finding, not an omission, but it is not " +
            "'moot', which means the conflict no longer matters. " +
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
    idPool = (Array.isArray(parents) ? parents : []).flatMap((p: any) =>
      Array.isArray(p?.[config.nested!.field]) ? p[config.nested!.field] : [],
    );
  } else {
    // Initialize an absent optional section (e.g. known_holdings) on first write.
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
    entryId = nextResearchId(idPool, config.prefix);
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
    if (stamp && newEntry[stamp.field] === undefined) {
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
    normalizeDateFields(existing);
    normalizeAccessDate(existing);
    canonicalizeAssertionLabels(existing);
    validateNegativeEvidenceRole(existing);
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

  // Section invariants the project validator does not already enforce.
  const invariantErrors: string[] = [];
  // Warn-only advisories: collected here, surfaced on the successful response's
  // validation.warnings (via the caller's flatMap over AppliedOp.warnings), never
  // thrown. Distinct from invariantErrors, which reject the write (#1006).
  const opWarnings: string[] = keptCompletedWarning ? [keptCompletedWarning] : [];
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
      invariantErrors.push(...newQuestionWhileSearchInFlightInvariants(resultEntry, preCallResearch));
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
        if (item && alreadyCompleted.has(item.id)) continue;
        invariantErrors.push(...planItemLogAttributionInvariants(item, research));
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
    // An update re-checks the move only when it sets the tier or the bridge, or
    // re-points the link (a new pairing, as the score gate below reads it), so a
    // rationale edit on a link written before this rule stays possible.
    const touchesMove =
      op.op !== "update" ||
      ["confidence", "move_bridge", "assertion_id", "person_id"].some((f) =>
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
    if (writesScore) {
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
    // Reads PRE-CALL tree and PRE-CALL research: a same-batch hypothesis write
    // does not satisfy this precondition. Gated only on the entry's standing
    // tier (not_proved/disproved pass), not on which fields this op touches.
    invariantErrors.push(...competingParentSetsInvariants(resultEntry, preCallResearch, tree));
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

/** Find a converter-resolved standard_place inside a sidecar record's
 *  simplified gedcomx whose fact `place` matches `place` (trimmed,
 *  case-insensitive). Never geocode what the source record already resolved. */
function sidecarStandardPlace(gx: any, place: string): string | null {
  if (!gx || typeof gx !== "object") return null;
  const want = place.trim().toLowerCase();
  const factLists: any[][] = [];
  for (const p of Array.isArray(gx.persons) ? gx.persons : []) {
    if (p && Array.isArray(p.facts)) factLists.push(p.facts);
  }
  for (const r of Array.isArray(gx.relationships) ? gx.relationships : []) {
    if (r && Array.isArray(r.facts)) factLists.push(r.facts);
  }
  for (const facts of factLists) {
    for (const f of facts) {
      if (
        f &&
        typeof f.place === "string" &&
        f.place.trim().toLowerCase() === want &&
        typeof f.standard_place === "string" &&
        f.standard_place.length > 0
      ) {
        return f.standard_place;
      }
    }
  }
  return null;
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
  /** Assertion ids this call creates; they cannot already carry a score. */
  createdAssertions: ReadonlySet<string>;
  /** Live person_evidence plus this batch's appends, for the contradiction
   *  gate's two-party arm. */
  personLinks: PersonLink[];
  sourceDescriptionId?: string;
  sourceReuse?: SourceReuseEcho;
  resolvedPlaces: ResolvedPlaceEcho[];
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
  const ftKey = factTypeKey(a.fact_type);
  const fact = Object.hasOwn(FACT_TYPE_ALIASES, ftKey) ? factTypeKey(FACT_TYPE_ALIASES[ftKey]) : ftKey;
  return [a.source_id, arkToBareId(a.record_id), log, who, fact].join("\u0000");
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
  const existing = new Map<string, string[]>();
  for (const a of Array.isArray(research.assertions) ? research.assertions : []) {
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
  // Replay id assignment over the batch's assertion appends, in order.
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
  const byId = new Map<string, any>();
  for (const a of existing) if (a && typeof a.id === "string") byId.set(a.id, a);
  for (const [id, e] of predicted) byId.set(id, e);
  return byId;
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
    if (op.op === "update") {
      if (fields.superseded_by) continue;
      entry = { ...(live.find((e: any) => e?.id === op.entryId) ?? {}), ...fields };
    } else {
      entry = (op as any).entry;
    }
    if (!entry || typeof entry !== "object") continue;
    names.push(...birthPlaceCoordNames(entry, research, tree, personLinks, assertions));
  }
  if (names.length === 0) return new Map();
  return lookupPlaceCoords(names, (name) => standardPlaceToCoords(name), BIRTH_PLACE_COORDS_BUDGET_MS);
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
): Promise<PreparedOps> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const resolvedPlaces: ResolvedPlaceEcho[] = [];
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
  const startingPersonIds = startingPersonIdsOf(await readStartingTree(projectPath));
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
  const sidecarCache = new Map<string, any[] | null>();
  const readSidecarResults = async (ref: string): Promise<any[] | null> => {
    if (sidecarCache.has(ref)) return sidecarCache.get(ref)!;
    let results: any[] | null = null;
    if (isInsideProject(projectPath, ref)) {
      try {
        const sc = JSON.parse(await getProjectStore().readText(projectPath, ref));
        if (sc && typeof sc === "object" && Array.isArray(sc.payload?.results)) {
          results = sc.payload.results;
        }
      } catch {
        // unreadable sidecar — the document validator reports it; skip enforcement
      }
    }
    sidecarCache.set(ref, results);
    return results;
  };

  // The other places each record's assertions name in this batch: a bare place
  // ("Shenandoah") is resolved against them, not against the whole world.
  const placesByRecord = new Map<string, string[]>();
  for (const op of ops) {
    const e = op.section === "assertions" && op.op === "append" ? (op.entry as any) : null;
    const place = e ? factText(e.place) : undefined;
    if (!place) continue;
    const key = String(e.record_id ?? "");
    placesByRecord.set(key, [...(placesByRecord.get(key) ?? []), place]);
  }

  /** Place levers (b) then (a) on one assertion's fields, in place. A
   *  standard_place contradicting the place's country is an error, unless
   *  `dropContradiction`, when it is left unset instead. */
  const applyPlaceLevers = async (
    entry: any,
    i: number,
    matchedRecord: any,
    dropContradiction = false,
  ): Promise<void> => {
    // ── Place lever (b): never geocode what the source record already
    // resolved — copy the sidecar's standard_place for the same place string.
    // `standard_place: null` is an explicit opt-out (skip resolution + guard);
    // only a fully omitted field triggers resolution. A non-place phrase
    // ("Same House") is left unset, silently: it has no standard form.
    let geocoded = false;
    if (
      factText(entry.place) !== undefined &&
      entry.standard_place === undefined &&
      !isNonPlacePhrase(factText(entry.place)!)
    ) {
      let sp: string | null = null;
      let source: "sidecar" | "geocoded" | null = null;
      if (matchedRecord) {
        sp = sidecarStandardPlace(matchedRecord.gedcomx, entry.place);
        if (sp) source = "sidecar";
      }
      if (!sp && input.resolveStandardPlace !== false) {
        // resolveStandardPlace swallows network failures and returns null, so
        // a miss and a failure look the same here — both warrant the warning
        // (a silently unresolved place is part of the wrong-geocode theme).
        try {
          const contextPlaces = (placesByRecord.get(String(entry.record_id ?? "")) ?? [])
            .filter((p) => p !== entry.place);
          sp = (await resolveStandardPlace(entry.place, { contextPlaces })) ?? null;
        } catch {
          sp = null;
        }
        if (sp) {
          source = "geocoded";
          geocoded = true;
        } else {
          warnings.push(`could not resolve standard_place for '${entry.place}' (left unset)`);
        }
      }
      if (sp && source) {
        entry.standard_place = sp;
        resolvedPlaces.push({ place: entry.place, standardPlace: sp, source });
      }
    }

    // ── Place lever (a): country-contradiction guard on the final pair
    // (supplied or resolved). Skipped when standard_place is null/absent.
    if (typeof entry.place === "string" && typeof entry.standard_place === "string") {
      const verdict = countryConsistency(entry.place, entry.standard_place);
      if (verdict === "contradiction" && dropContradiction) {
        entry.standard_place = undefined;
        return;
      }
      if (verdict === "contradiction") {
        errors.push(
          fmt(
            i,
            `standard_place '${entry.standard_place}' contradicts place '${entry.place}' — the place text ` +
              "names a different country. Re-resolve with place_search / place_search_all and supply the " +
              "correct standard_place, or set standard_place: null if no standard form exists.",
          ),
        );
        return;
      }
      if (verdict === "unverifiable" && geocoded) {
        warnings.push(
          `resolved standard_place '${entry.standard_place}' for place '${entry.place}' — the country ` +
            "could not be cross-checked (either the place text names no country, or the standard place " +
            "names none that is recognized — e.g. a historical polity like 'Bohemia'); verify it is the " +
            "right place",
        );
      }
    }
  };

  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    if (op.section !== "assertions" || op.op !== "append") continue;
    const entry = op.entry as any;
    if (!entry || typeof entry !== "object") continue;

    // ── D2: persona/record-id matrix against the log entry's sidecar ──
    let matchedRecord: any = null;
    const logId = entry.log_entry_id;
    const logEntry = typeof logId === "string" ? logById.get(logId) : undefined;
    if (logEntry) {
      const ref = logEntry.results_ref;
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
          // `recordId`. fulltext_search / external_links_search stage transcript
          // text and links keyed on `id`, with no persona document — matching
          // them on `recordId` (a field they never carry) matched nothing every
          // time, which either rejected a persona-linked write with an empty
          // "expected one of:" list or silently skipped canonicalizing the id
          // (#2038). Pick the id field by producer.
          const personaBearing = PERSONA_BEARING_PRODUCERS.has(logEntry.tool);
          const resultId = (r: any): string | undefined => {
            const v = personaBearing ? r?.recordId : r?.id;
            return typeof v === "string" ? v : undefined;
          };
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
        }
      }
    }

    await applyPlaceLevers(entry, i, matchedRecord);
  }

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
    if (!Object.prototype.hasOwnProperty.call(fields, "place") || Object.prototype.hasOwnProperty.call(fields, "standard_place")) continue;
    const cur = ((research.assertions ?? []) as any[]).find((a: any) => a?.id === op.entryId);
    const place = factText(fields.place);
    if (!cur || place === undefined || place === factText(cur.place)) continue;
    const view: any = { ...cur, ...fields, standard_place: undefined };
    await applyPlaceLevers(view, i, null, true);
    if (typeof view.standard_place === "string") {
      fields.standard_place = view.standard_place;
    } else if (typeof cur.standard_place === "string") {
      fields.standard_place = null;
      warnings.push(
        `assertion '${op.entryId}': cleared standard_place '${cur.standard_place}' because its place ` +
          `was corrected to '${place}' and no standard form was found for the new place`,
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

  if (errors.length > 0) throw new ResearchAppendError(errors);
  const verdictFile = prepareVerdict(input, ops, fmt, errors);
  if (errors.length > 0) throw new ResearchAppendError(errors);
  // Last, so this batch's assertions carry the standard_place resolved above.
  const birthPlaceCoords = await prefetchBirthPlaceCoords(research, ops, tree, personLinks, batchAssertions);
  return { treeMutated, matchScores, batchAssertions, startingPersonIds, createdAssertions, personLinks, sourceDescriptionId, sourceReuse, resolvedPlaces, warnings, verdictFile, birthPlaceCoords };
}

// ─── Entry point ─────────────────────────────────────────────────────────────

/** Lane scoping for a narrow caller (e.g. `extraction_append`).
 *
 *  This is a second FUNCTION PARAMETER, deliberately not a field on
 *  `ResearchAppendInput`: `index.ts` dispatches with `researchAppend(args)`, a
 *  single argument built from `request.params.arguments`, so an extra key on the
 *  tool input can never reach this object. The restriction is therefore
 *  unforgeable from the LLM side — a caller cannot widen its own lane.
 *
 *  It also lives here, in the module, rather than in the dispatch layer, because
 *  `eval/harness/harness/mock_mcp.py` imports these functions directly and never
 *  routes through `index.ts`. A gate in dispatch would be invisible to every
 *  eval run. */
export interface ResearchAppendOptions {
  /** Sections this caller may write. Omitted = every section (`research_append`). */
  allowedSections?: ReadonlySet<string>;
  /** Tool name used in lane-rejection text, so a narrow caller names itself. */
  toolName?: string;
}

/**
 * The ids of the existing sources that already cover any of `bareRecordIds`,
 * read off the assertions that cite them (§3.4.1). The one derivation of
 * "is this record already extracted", shared by source-reuse detection here and
 * by `extraction_append`'s resend skip, so the two cannot disagree.
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
  input.ops = coerceJsonArg(input.ops) as ResearchAppendOp[] | undefined;
  input.fields = coerceJsonArg(input.fields) as Record<string, unknown> | undefined;
  const isBatch = input.ops !== undefined;
  const ops = isBatch
    ? (Array.isArray(input.ops) ? input.ops : [])
    : [{ section: input.section, op: input.op, fields: input.fields } as ResearchAppendOp];
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
  return researchAppend(input);
}

export async function researchAppend(
  input: ResearchAppendInput,
  options: ResearchAppendOptions = {},
): Promise<ResearchAppendResult> {
  const { projectPath } = input;

  // Recover object/array args the model serialized as JSON strings (see
  // coerceJsonArg) before any shape checks, so a correct-but-stringified batch
  // isn't rejected as "`ops` must be a non-empty array" and driven into a slow
  // one-op-per-call fallback.
  input.ops = coerceJsonArg(input.ops) as ResearchAppendOp[] | undefined;
  input.entry = coerceJsonArg(input.entry) as Record<string, unknown> | undefined;
  input.fields = coerceJsonArg(input.fields) as Record<string, unknown> | undefined;
  input.sourceDescription = coerceJsonArg(input.sourceDescription) as SourceDescriptionInput | undefined;
  input.verdict = coerceJsonArg(input.verdict) as Record<string, unknown> | undefined;

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
        return fail(["`ops` must be a non-empty array"]);
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
      for (let i = 0; i < ops.length; i++) {
        const section = ops[i]?.section;
        if (typeof section !== "string" || !allowed.has(section)) {
          return fail([
            fmt(
              i,
              `section '${section}' is not writable by ${toolName} (it writes only: ${writes}). ` +
                "Another skill owns that section — surface the finding in your summary instead.",
            ),
          ]);
        }
      }
    }

    // ─── Composite + enforcement pre-pass (stamps ids, mutates the tree) ─────
    const prep = await prepareOps(input, ops, research, tree, projectPath, fmt);

    // ─── Apply every op in-memory ─────────────────────────────────────────────
    const applied: AppliedOp[] = [];
    const appendedThisBatch = new Set<string>();
    for (let i = 0; i < ops.length; i++) {
      try {
        applied.push(
          applyOne(
            research,
            ops[i],
            appendedThisBatch,
            preCallExhaustiveDeclared,
            preCallBlockingConflicts,
            beforeResearch,
            tree,
            prep.matchScores,
            prep.batchAssertions,
            prep.startingPersonIds,
            prep.createdAssertions,
            prep.personLinks,
            prep.birthPlaceCoords,
          ),
        );
      } catch (e) {
        if (e instanceof ResearchAppendError) {
          // Identify the failing op; nothing has been written.
          return fail(
            e.errors.map((m) => fmt(i, m)),
            [{
              section: String(ops[i].section),
              op: ops[i].op === "update" ? "update" : "append",
              // The field names the failing op actually set. The worked example
              // is keyed on these so a caller refused on one field is not handed
              // a payload for another — see exampleFor.
              fields: Object.keys(ops[i].fields ?? ops[i].entry ?? {}),
            }],
          );
        }
        throw e;
      }
    }

    // A plan this call created that ends with no items, while the call's
    // plan_items ops wrote elsewhere. Checked on POST-APPLY state (that is what
    // "ends the call with no items" means) and before any write, so nothing is
    // persisted. The `plans` hint teaches the batched shape that satisfies it.
    // Computed here, on post-apply state, but NOT returned on: an early return
    // suppressed every other document-level error in the same batch, so a
    // caller with a misroute AND a bad enum elsewhere was told about one of
    // them and had to make a second call to discover the other. Reordering is
    // not needed to fix that: a created plan ending with no items always
    // produces a validation error (`items` absent fails the required check,
    // `[]` fails the non-empty check, and the non-array case is excluded from
    // the misroute set), so the misroute set is a strict SUBSET of the
    // validation-failing set. Carrying the messages down to the validation
    // failure and merging them there loses nothing and reports everything.
    const misrouted = emptyCreatedPlanErrors(ops, research, applied);

    // #2472: carry an assertion correction onto the fact materialize_facts
    // minted from it, in this same call's atomic composite persist.
    const rewrite = rewriteLinkedFacts(applied, ops, research, beforeResearch, tree);

    const opWarnings = [...prep.warnings, ...applied.flatMap((a) => a.warnings ?? [])];
    // Folded into locals rather than mutated onto `prep`: both the mutation test
    // and the write branch below have to see the rewrite's tree write, and the
    // degrade path below can take it back.
    let treeMutated = prep.treeMutated || rewrite.mutated;
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
          treeMutated = prep.treeMutated;
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
      if (!validation.valid) {
        // Shape errors surface here (the document validator, not applyOne), so
        // this is the site the evaluations/known_holdings rejections land on.
        const mapped = mapValidationErrors(formatIssues(validation.errors), applied, isBatch);
        // The cause-naming messages lead, because they name what to change;
        // the document errors follow so nothing in the batch is hidden.
        const misrouteMsgs = misrouted.map((m) => fmt(m.index, m.message));
        // Only hint the sections the errors actually name — in a wide batch,
        // examples for ops that validated fine would be noise pointing away
        // from the real problem.
        const blamed = ops.filter((o) => mapped.some((m) => m.includes(String(o.section))));
        return fail(
          [...misrouteMsgs, ...mapped],
          misrouteMsgs.length > 0
            ? [{ section: "plans", op: "append" as const }]
            : (blamed.length > 0 ? blamed : ops).map((o) => ({
                section: String(o.section),
                op: o.op === "update" ? ("update" as const) : ("append" as const),
              })),
        );
      }
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
    const validationBlock = {
      valid: true as const,
      warnings: [...validationWarnings, ...opWarnings, ...rewriteWarnings, ...treeEncodingWarnings, ...planItemWarnings, ...(persistenceWarning ? [persistenceWarning] : []), ...transcriptionWarnings],
    };
    const extras: Pick<BatchSuccess, "sourceDescriptionId" | "sourceReuse" | "resolvedPlaces"> = {};
    if (prep.sourceDescriptionId) extras.sourceDescriptionId = prep.sourceDescriptionId;
    if (prep.sourceReuse) extras.sourceReuse = prep.sourceReuse;
    if (prep.resolvedPlaces.length > 0) extras.resolvedPlaces = prep.resolvedPlaces;

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

/** Best-effort mapping of whole-document validation errors back to the batch op
 *  that touched the offending entry, so failure responses name the failing ops.
 *  Errors on entries no op touched keep their `research.json/…` path. */
function mapValidationErrors(errors: string[], applied: AppliedOp[], isBatch: boolean): string[] {
  if (!isBatch) return errors;
  const byLocation = new Map<string, number>();
  for (let k = 0; k < applied.length; k++) {
    const a = applied[k];
    if (a.arrayIndex !== undefined) byLocation.set(`${a.section}[${a.arrayIndex}]`, k);
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
  "known_holdings",
  "localities",
  "project",
  "researcher_profile",
] as const;

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
    "To apply several mutations in one call, pass an `ops` array (each op is " +
    "`{ section, op, entry?/entryId?/fields?, planId? }`). Batches are " +
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
      planId: {
        type: "string",
        description: "Required for section 'plan_items' — the pl_ id of the parent plan to write into.",
      },
      ops: {
        type: "array",
        description:
          "Batch form: apply many mutations in one validate-once/write-once call " +
          "(all-or-nothing). When present, the top-level section/op/entry/entryId/" +
          "fields/planId are ignored. Use this to persist a whole record at once.",
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

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

import { getProjectStore } from "../store/project-store.js";
import { VALIDATOR_ENUMS } from "../validation/validator.js";
import { validateIntroduced } from "../validation/introduced-errors.js";
import { sanitizeTree } from "../validation/tree-sanitize.js";
import {
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
import { getDayRange, isABeforeB } from "../utils/date-helpers.js";
import { placeSegments } from "../utils/place-resolver.js";
import { exampleHints } from "./research-append-examples.js";
import { gcUnreferencedImages, sourceImageCapState } from "../utils/image-store.js";
import { nextId } from "../utils/gedcomx-ids.js";
import { arkToBareId } from "../utils/ark.js";
import { PERSONA_BEARING_PRODUCERS } from "../utils/results-staging.js";
import { resolveStandardPlace, countryConsistency } from "../utils/place-resolver.js";

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
    return [
      `question '${entry.question_id}' already has an active plan (${conflicting[0].id}); supersede it before adding another`,
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
 *  `ownership.json` gives `hypotheses.callers` as `["skill:hypothesis-tracking"]`
 *  while `conflicts` belongs to `skill:conflict-resolution` and `assertions` to
 *  `skill:record-extraction`. Both of those sections are `enforceableAt:
 *  ["unit"]` only (no hook arm, no tool arm), so under a live read nothing would
 *  stop a session from writing the satisfying conflict or assertion in the same
 *  batch as the promote and clearing this gate from inside the call it gates.
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

/** First 4-digit year in a date string, tolerating `~1845`, `11Jan1758`,
 *  `1858-03-12` and `about 1832`. Null when none is present -- an unparseable
 *  date states nothing to compare, which must not read as a contradiction. */
function yearOf(value: unknown): number | null {
  const m = /\b(1[0-9]{3}|20[0-9]{2})\b/.exec(String(value ?? ""));
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
 *  Place uses `compatiblePlace` + `placeSegments`, the SAME comparator
 *  `placeContainmentErrors` uses, for the reason its docstring gives: equality
 *  and containment are both compatible, so only an outright disagreement counts.
 *  A place-less assertion states nothing and is skipped.
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

function coreIdentifierContradictionInvariants(
  entry: any,
  research: any,
  tree: any,
): string[] {
  if (entry.confidence !== "confident" && entry.confidence !== "probable") return [];
  const assertions: any[] = research.assertions ?? [];
  const linked = assertions.find((a: any) => a?.id === entry.assertion_id);
  if (!linked) return [];
  const recordId = linked.record_id ?? linked.source_id ?? null;
  if (recordId == null) return [];

  // A relationship assertion bears on BOTH people it names, and its own party
  // is only one of them: `a_004` ("listed in household of Thomas Flynn,
  // position consistent with son") carries the CHILD's role while the link may
  // be to the father. Comparing the child's stated birth of 1845 against a
  // father the tree puts at 1818 produced 14 refusals that are one household,
  // not one contradiction. We cannot tell from the assertion which side a link
  // is about, so two-party assertions are out of scope for this gate.
  if (RELATIONAL_FACT_TYPES.has(String(linked.fact_type ?? "").toLowerCase())) return [];

  const person = ((tree?.persons ?? []) as any[]).find((p: any) => p?.id === entry.person_id);
  if (!person) return [];
  const birth = ((person.facts ?? []) as any[]).find(
    (f: any) => String(f?.type ?? "").toLowerCase() === "birth",
  );
  if (!birth) return [];

  // Every assertion this record makes about THE SAME PARTY as the linked one.
  //
  // Scoping to the record alone is wrong and was measured wrong: a census or a
  // baptism names several people, and comparing a son's stated birth of 1845
  // against a father who the tree says was born 1818 produced 30 refusals that
  // are all one household, not one contradiction. The party key is the same one
  // `record-persona.ts` groups by -- `record_persona_id` when the sidecar kept
  // one, `record_role` otherwise, which is required on every assertion.
  const partyKey = (a: any) => a?.record_persona_id ?? a?.record_role ?? null;
  const linkedParty = partyKey(linked);
  const sameRecord = assertions.filter(
    (a: any) =>
      a &&
      (a.record_id ?? a.source_id ?? null) === recordId &&
      partyKey(a) === linkedParty &&
      linkedParty !== null,
  );

  const findings: string[] = [];

  // ── place ────────────────────────────────────────────────────────────────
  if (typeof birth.place === "string" && placeSegments(birth.place).length > 0) {
    for (const a of sameRecord) {
      // Like for like. An ANY-place comparison refuses 274 of 323 committed
      // confident/probable entries (85%) because a marriage or census place is
      // not a claim about birthplace: a man born in Ireland appears in a
      // Pennsylvania census, and that is biography, not contradiction.
      if (!BIRTH_PLACE_FACT_TYPES.has(String(a.fact_type ?? "").toLowerCase())) continue;
      if (!contradictionIsCredible(a)) continue;
      if (typeof a.place !== "string" || placeSegments(a.place).length === 0) continue;
      if (!compatiblePlace(a.place, birth.place)) {
        findings.push(
          `the record states '${a.place}' (assertion '${a.id}') where the tree person ` +
            `attests '${birth.place}'`,
        );
        break;
      }
    }
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
  if (logEntry.tool === "record_read") return true;
  if (logEntry.tool === "record_search" && logEntry.results_ref) return true;
  return false;
}

/** Whether this tree person exists only because of the record now being linked.
 *
 *  The lead's step-3 wording is "a tree person whose only source ref is this
 *  record", and it is NOT decidable from the tree alone: `TREE_PERSON_FIELDS`
 *  has no `sources`, refs hang off `names[]`/`facts[]`, and a tree source
 *  description carries `id/title/citation/author/url` and no record id. So the
 *  walk is six hops and ends in `research.json`:
 *
 *    tree names[]/facts[].sources[].ref -> tree sources[].id
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

/** Tier/exhaustiveness cross-field guardrail (docs/specs/guardrail-enforcement-spec.md
 *  §4.2). `proved`/`disproved` claim the research is reasonably exhaustive by
 *  definition, so either tier requires the referenced question's
 *  `exhaustive_declaration.declared` to already be `true` — checked against
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
 * a `gps-mentor` verdict is not something the writer may append for itself. Here
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

/** A question's `status` may not claim an exhaustiveness that its declaration
 *  does not carry.
 *
 *  **Why both spellings need gating.** `status: "exhaustive_declared"` is what
 *  every downstream reader treats as "GPS Component 1 is satisfied", and
 *  `exhaustive_declaration.declared` is the record that is supposed to back it.
 *  The harness has asserted one direction since the validator shipped —
 *  `test_declared_implies_exhaustive_declared_status`, declared ⟹ status — and
 *  nothing has ever asserted the other, which is the direction that leaves a
 *  question looking finished with no declaration behind it.
 *
 *  **Reads the MERGED entry, deliberately.** `applyOne` shallow-merges `fields`
 *  before invariants run, so `entry.exhaustive_declaration` is "set by this op,
 *  or already true from an earlier call" — exactly the live read ADR-0011
 *  prescribes when the precondition is the same author's own prior step. A
 *  pre-call snapshot would refuse the 123 corpus writes that declare and set the
 *  status in one op, which is the common and correct shape.
 *
 *  **A zero-violation arm, and named as one.** Replayed over 157 committed e2e
 *  runs: 125 ops set this status and none of them would be refused. It ships as
 *  a cheap invariant closing a reachable hole — `exhaustive_declaration` is a
 *  required question property so it is always present, and 219 corpus writes set
 *  `declared: false` — not as a gate with demonstrated catches. Its test vector
 *  is synthetic for that reason. */
function declarationStatusInvariants(entry: any): string[] {
  if (entry?.status !== "exhaustive_declared") return [];
  if (entry?.exhaustive_declaration?.declared === true) return [];
  return [
    `status 'exhaustive_declared' requires exhaustive_declaration.declared === true on ` +
      `question '${entry?.id}', and it is ` +
      `${entry?.exhaustive_declaration === undefined ? "absent" : JSON.stringify(entry?.exhaustive_declaration?.declared)}. ` +
      "That status is what every later reader treats as GPS Component 1 satisfied, so it may " +
      "not stand without the declaration that backs it. Set both in this call, or leave the " +
      "status alone: an honest early termination writes `declared: false` and keeps " +
      "`status: \"in_progress\"`.",
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
 *  a researcher who believes the search is done has no way to say so. Issue
 *  #1821 owns that fix.
 *
 *  **`planned` does NOT block, and that is load-bearing.** `research/SKILL.md`
 *  routes here deliberately before the plan is drained — "even with plan items
 *  still `planned` → research-exhaustiveness (consult the stop criteria before
 *  draining the rest of the plan)" — and 122 corpus items sit at `planned`
 *  across 31 declarations that are all correct. The skill body's opening
 *  sentence is stricter than its own operative rule; the operative rule and the
 *  orchestrator agree, and this follows them.
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
  if (entry?.exhaustive_declaration?.declared !== true) return [];
  const qid = entry?.id;
  if (typeof qid !== "string" || qid === "") return [];
  const inFlight: string[] = [];
  for (const plan of Array.isArray(preCallResearch?.plans) ? preCallResearch.plans : []) {
    if (!plan || plan.question_id !== qid) continue;
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
      if (item?.status === "in_progress" && typeof item?.id === "string") inFlight.push(item.id);
    }
  }
  if (inFlight.length === 0) return [];
  const ids = inFlight.sort().join(", ");
  return [
    `question '${qid}' cannot be declared exhaustive while ${ids} ` +
      `${inFlight.length === 1 ? "is" : "are"} still 'in_progress' — the plan says that ` +
      "search has not finished, so the declaration would rest on work still running. " +
      `Report ${inFlight.length === 1 ? "this item" : "these items"} as the blocker and let ` +
      "the search finish; declaring is available on the next call once the plan reflects it. " +
      "Items still at `planned` do not block — consulting the stop criteria before draining " +
      "the plan is the sanctioned path.",
  ];
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
      `tier '${tier}' requires question '${entry?.question_id}' to already carry ` +
        `exhaustive_declaration.declared === true from BEFORE this call (a batch may not ` +
        `declare exhaustiveness and consume it for a tier in the same call) — invoke ` +
        `research-exhaustiveness first, in its own call.`,
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

/** Read the write-once starting-tree.gedcomx.json baseline, or null when it is
 *  absent or unreadable. Fail-open by design: legacy projects created before the
 *  baseline shipped have no such file, and a tree-encoding WARNING must never
 *  block a completion for a project that simply predates it. */
async function readStartingTree(projectPath: string): Promise<SimplifiedGedcomX | null> {
  try {
    const raw = await getProjectStore().readText(projectPath, "starting-tree.gedcomx.json");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as SimplifiedGedcomX) : null;
  } catch {
    return null;
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
 * a missed one. Fails open when the baseline is absent (legacy projects). */
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
      // A `place` correction that leaves an un-corrected `standard_place` is the
      // shape this card was filed about, one level down: the display string
      // reads corrected while the place-AUTHORITY value still names the old
      // jurisdiction. The update path cannot re-resolve it (the sidecar/geocode
      // lever is append-only), and the assertion is equally stale, so the guard
      // below cannot see it either. Say so rather than let it pass silently.
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
      if (
        placeRewritten &&
        !touched.includes("standard_place") &&
        typeof fact.standard_place === "string"
      ) {
        mutationWarnings.push(
          `fact '${fact.id}' kept standard_place '${fact.standard_place}' while its place was ` +
            `corrected from assertion '${a.entryId}' — the place authority value was not part of ` +
            "this correction. Update the assertion's standard_place too if the reading moved.",
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
  marriagelicense: "marriage",
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

/** Reduce a label to its normalized comparison key: lowercase, then drop every
 *  non-alphanumeric character. */
function labelKey(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, "");
}

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
  const key = labelKey(ft);
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
// Exported only so the cross-language drift test can pin it against the
// Python copy; nothing else outside this module reads it.
export const RELATION_CATEGORY: Record<string, string> = Object.assign(
  Object.create(null) as Record<string, string>,
  {
    father: "parent", mother: "parent", parent: "parent",
    son: "child", daughter: "child", child: "child",
    wife: "spouse", husband: "spouse", spouse: "spouse",
    widow: "spouse", widower: "spouse",
    brother: "sibling", sister: "sibling", sibling: "sibling",
  },
);
const RELATION_WORDS = Object.keys(RELATION_CATEGORY).join("|");
// A value LABELS the other party in two shapes that need different patterns.
// An earlier single pattern spanning `[^,]*?` was wrong both ways: a stray
// `[KEY:` colon suppressed real sibling refusals, and one comma in `Father of
// the groom, named as X` made it miss and wrongly refuse a correct assertion.
//
// Only ONE label guard is needed. A label with no ` of ` -- `father: Jan
// Roelfs`, `father named as Casper` -- never reaches here, because
// STATES_SUBJECT_ROLE requires ` of `. A second guard for those was
// written, measured against the corpus, found to change nothing, and
// deleted; do not add it back.
//
// By role: `Father of groom named as Tellef`. The party being named is
// identified by ROLE -- a bare lowercase word -- so it is the other party. A
// CAPITALISED token there is a name, so the value states the subject's own tie
// and must not be skipped.
const LABELS_BY_ROLE = new RegExp(
  `^\\s*(?:the\\s+)?(?:${RELATION_WORDS})\\s+of\\s+(?:the\\s+)?(\\w+)[\\s,]*(?::|\\s+named\\b)`,
  "i",
);
const STATES_SUBJECT_ROLE = new RegExp(
  `^\\s*(?:the\\s+)?(${RELATION_WORDS})\\s+of\\s+`,
  "i",
);

/** Exported only so the cross-language drift test can pin it against the
 *  Python `_relationship_category`: the table alone does not cover the
 *  `_inferred` strip or the trim, and `String.replace` with a string
 *  pattern replaces the FIRST occurrence here while Python's replaces
 *  every one. */
export function relationshipCategory(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  // Anchored, and one suffix only. A bare `.replace("_inferred", "")`
  // strips the FIRST occurrence here and EVERY occurrence in the Python
  // mirror, so `child_inferred_inferred` was unknown to this side and
  // `child` to that one.
  return RELATION_CATEGORY[value.toLowerCase().trim().replace(/_inferred$/, "")];
}

/** The category the VALUE claims for the record subject, or undefined when it
 *  does not speak to the subject's own role. Exported so the cross-language
 *  drift test can pin it against the Python copy in
 *  `eval/harness/validators/test_record_extraction.py`: the rule exists twice
 *  because the harness and the engine share no runtime, and nothing else keeps
 *  the two in step. */
export function subjectRoleInValue(value: string): string | undefined {
  const byRole = LABELS_BY_ROLE.exec(value);
  // A lowercase ASCII token is a role word, not a name. Must stay an
  // explicit class, never a case test: `=== toLowerCase()` is true for a
  // token with no case (`2`) where the Python mirror's .islower() is
  // false, so the two disagreed in both directions before this. The
  // capture stays `\w+` although that is ASCII here and Unicode
  // there: with this guard both spellings reach the same verdict either
  // way, and widening it to `\S+?` was reverted as unobservable.
  if (byRole && /^[a-z]+$/.test(byRole[1])) return undefined;
  const m = STATES_SUBJECT_ROLE.exec(value);
  if (!m) return undefined;
  return RELATION_CATEGORY[m[1].toLowerCase()];
}

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
  preCallCritiquedSummaryIds?: Set<string>,
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
      // gate grading its own homework, the exact defect the sibling mentor gate
      // below was built to avoid. The union is strictly stronger than either
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
            "independence_analysis, weighing_analysis, and resolution_rationale) or 'moot' " +
            "(with a rationale for why it no longer matters) — then retry completing the project. " +
            "A conflict you weighed and could not settle is still recorded as 'resolved' with all " +
            "three analyses, saying in resolution_rationale why it cannot be settled and what " +
            "would settle it, and leaving preferred_assertion_id null — a deferral is a finding, " +
            "not an omission, but it is not 'moot', which means the conflict no longer matters. " +
            "A conflict settled in the same batch as this update does not count; complete it in " +
            "a later call.",
        );
      }

      // Mentor gate: every proof summary backing a RESOLVED question must carry
      // a gps-mentor `proof-critique` verdict before the project may complete.
      //
      // A pure foreign key — proof_summaries[].question_id joins the question
      // (a question entry carries no ps_id), and evaluations[].target_id joins
      // the summary. It reads only data already in memory, so unlike the
      // sibling same_person gate there is nothing to invent and no new field to
      // persist.
      //
      // **The critique set is the PRE-CALL snapshot, deliberately.** Read live,
      // one batch could append its own proof-critique evaluation and consume it
      // for the completed transition in the same call — the gate would grade its
      // own homework. Same discipline as proofSummaryInvariants.
      //
      // Prose was tried on exactly this rule and lost: research/SKILL.md has
      // carried "verify BOTH gates, in order — do not write completed until both
      // hold" since PR #811 (merged 2026-07-23; #1029 touched this file but not
      // that row), and 29 of 128 completed runs in the committed e2e corpus
      // reach `completed` with at least one uncritiqued summary anyway — 23%.
      // Date-split, that 23% is 23/70 before the prose existed, 6/53 with the
      // prose and no enforcement, and 0/5 since this precondition went live:
      // the prose cut the rate by two thirds, and the live window is n=5.
      //
      // A superseded verdict does not count: if a newer verdict replaced it, the
      // newer one is itself in evaluations[] and satisfies the gate; if nothing
      // replaced it, the critique genuinely no longer stands.
      // `resolved` is an ISO date string or null, never a boolean, so the old
      // `=== true` was unsatisfiable dead code — the same shape as the
      // `identity_question === true` bug, written up on `isIdentityConflict` in
      // `utils/question-state.ts` (it used to sit in the sibling gate above,
      // which now shares that helper). `Boolean(q.resolved)`
      // is what `question-state.ts` already uses to answer the same question,
      // and the two disagreeing is how a question could read as resolved to
      // `project_context` while this gate never counted it. Widening the set can
      // only require MORE critiques; measured over the corpus it newly refuses
      // nothing (4 date-only resolved questions, all already critiqued).
      const resolvedQuestionIds = new Set(
        (Array.isArray(research.questions) ? research.questions : [])
          .filter((q: any) => q && (q.status === "resolved" || Boolean(q.resolved)))
          .map((q: any) => q.id),
      );
      const uncritiqued = (
        Array.isArray(research.proof_summaries) ? research.proof_summaries : []
      )
        .filter(
          (ps: any) =>
            ps &&
            resolvedQuestionIds.has(ps.question_id) &&
            !preCallCritiquedSummaryIds?.has(ps.id),
        )
        .map((ps: any) => ps.id);
      // A resolved question with NO proof summary passes vacuously — but that
      // state is no longer REACHABLE through this tool, so the vacuous pass now
      // only covers documents seeded that way (fixtures, hand-authored state).
      // `questionResolvedInvariants` refuses the transition, on either spelling
      // of resolved, unless a summary references the question.
      //
      // That is the deliberate resolution of a contradiction these two gates
      // used to carry: this comment claimed "closed a side question with no
      // candidates" as a legitimate terminal state while its sibling made it
      // unwritable. Concluding is the only way to close a question — a question
      // closed with nothing found gets a `not_proved` summary saying so, which
      // is a GPS-valid finding rather than a non-answer. Neither state occurs in
      // the committed corpus: 0 of 154 runs ever reach `resolved` without a
      // summary, seeded or produced.
      if (uncritiqued.length > 0) {
        throw new ResearchAppendError(
          `cannot set project.status = "completed": proof summary/summaries ` +
            `${uncritiqued.join(", ")} have no gps-mentor verdict. ` +
            "Every proof summary backing a resolved question must be critiqued before " +
            "the project is completed. Invoke the gps-mentor agent with " +
            "focus: proof-critique on each id above — it appends the verdict to " +
            "evaluations[] — then retry completing the project. A verdict appended in " +
            "the same batch as this update does not count; complete it in a later call.",
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

    // Questions: re-declaring exhaustiveness on an already-declared question is
    // a no-op — never overwrite a settled GPS Component-1 record. Only when the
    // declaration is the SOLE field being set, so a bundled update that also
    // changes other fields is not silently dropped.
    if (section === "questions" && Object.keys(op.fields).length === 1) {
      const newEd = op.fields.exhaustive_declaration as any;
      if (existing.exhaustive_declaration?.declared === true && newEd?.declared === true) {
        return {
          section,
          op: op.op,
          entryId: op.entryId,
          noop: true,
          warnings: [`question '${op.entryId}' is already exhaustive_declared; no-op`],
        };
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
  const opWarnings: string[] = [];
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
      Object.prototype.hasOwnProperty.call(fields, "exhaustive_declaration");
    if (declarationTouchedThisOp) {
      invariantErrors.push(...planCompleteInvariants(resultEntry, preCallResearch));
    }
    const statusTouchedThisOp =
      op.op === "append" || Object.prototype.hasOwnProperty.call(fields, "status");
    // EITHER side, because the invariant couples two fields and an op that
    // touches one can break it without naming the other. Gating on `status`
    // alone left the mirror-image hole open: an update lowering
    // `exhaustive_declaration.declared` to false on a question already sitting
    // at `status: "exhaustive_declared"` never ran the check and persisted
    // exactly the state it forbids. That is not hypothetical — it is the
    // agent's own documented re-invocation path, which writes `declared: false`
    // and is told to leave `status` alone.
    if (statusTouchedThisOp || declarationTouchedThisOp) {
      invariantErrors.push(...declarationStatusInvariants(resultEntry));
    }
  }
  if (section === "conflicts") {
    invariantErrors.push(...conflictInvariants(resultEntry));
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
  }
  // One active plan per question — enforced on append OR an update that
  // (re)sets status to "active"; the helper no-ops for non-active entries.
  if (section === "plans") {
    invariantErrors.push(...planActiveInvariants(resultEntry, research));
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
    // (`hypothesis-tracking/SKILL.md`). Gating on `status` alone left three
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
    invariantErrors.push(
      ...coreIdentifierContradictionInvariants(resultEntry, research, tree),
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
  /** Existing assertions plus this batch's predicted appends, so the score gate
   *  resolves a link's assertion whatever order the ops arrive in. */
  batchAssertions: Map<string, any>;
  /** Person ids in the write-once starting-tree baseline. Empty when the
   *  project predates it, which the circular test treats as "unknown". */
  startingPersonIds: ReadonlySet<string>;
  /** Assertion ids this call creates; they cannot already carry a score. */
  createdAssertions: ReadonlySet<string>;
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
  const ftKey = labelKey(a.fact_type);
  const fact = Object.hasOwn(FACT_TYPE_ALIASES, ftKey) ? labelKey(FACT_TYPE_ALIASES[ftKey]) : ftKey;
  return [a.source_id, arkToBareId(a.record_id), log, who, fact].join("\u0000");
}

/** The canonical spelling of a fact_type for a message (the alias fold §3.7 applies). */
function factLabel(ft: unknown): string {
  if (typeof ft !== "string") return String(ft);
  const k = labelKey(ft);
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
  // Read once here: `applyOne` is synchronous. Fail-open (an absent baseline
  // yields an empty set) matches `readStartingTree`'s own contract.
  const baseline = await readStartingTree(projectPath);
  // Array.isArray, not `?? []`: `readStartingTree` is fail-open for a read or
  // parse failure but returns any parsed object as-is, so a baseline whose
  // `persons` is not an array reached `.map` and threw a raw TypeError out of
  // `researchAppend` -- not a ResearchAppendError, and from `prepareOps`, so it
  // killed every call including ones with no person_evidence op at all.
  const startingPersonIds: ReadonlySet<string> = new Set(
    ((Array.isArray(baseline?.persons) ? baseline.persons : []) as any[])
      .map((p: any) => p?.id)
      .filter((id: any): id is string => typeof id === "string" && id !== ""),
  );
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
  // record_id. Record ids compare canonicalized (arkToBareId), repositories
  // by normalized exact match (trim + casefold).
  let reuseSkipsSourceDescription = false;
  let detectionEngaged = false;
  const assertionAppends = ops.filter(
    (op) => op.section === "assertions" && op.op === "append" && op.entry && typeof op.entry === "object",
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
    if (
      srcEntry &&
      typeof srcEntry === "object" &&
      srcEntry.gedcomx_source_description_id == null &&
      batchRecordKeys.size > 0
    ) {
      detectionEngaged = true;
      // Existing sources covering any of the batch's record ids, in
      // research.sources array order (deterministic "first match").
      const sourceIdsForRecords = new Set<string>();
      for (const a of Array.isArray(research.assertions) ? research.assertions : []) {
        if (
          a &&
          typeof a.record_id === "string" &&
          typeof a.source_id === "string" &&
          batchRecordKeys.has(arkToBareId(a.record_id))
        ) {
          sourceIdsForRecords.add(a.source_id);
        }
      }
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
        // No sidecar (record_read, PDF, image, pasted records, or a nil/negative
        // search): the field must be absent or null — there is no persona
        // document to point at.
        if (entry.record_persona_id != null) {
          errors.push(
            fmt(
              i,
              `record_persona_id must be null — log entry '${logId}' has no results sidecar ` +
                "(results_ref is null; record_read/PDF/image/pasted records carry no persona ids)",
            ),
          );
          continue;
        }
      } else if (typeof ref === "string") {
        const results = await readSidecarResults(ref);
        if (results) {
          // Only record_search stages GedcomX personas; its results key on
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

    // ── Place lever (b): never geocode what the source record already
    // resolved — copy the sidecar's standard_place for the same place string.
    // `standard_place: null` is an explicit opt-out (skip resolution + guard);
    // only a fully omitted field triggers resolution.
    let geocoded = false;
    if (factText(entry.place) !== undefined && entry.standard_place === undefined) {
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
          sp = (await resolveStandardPlace(entry.place)) ?? null;
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
      if (verdict === "contradiction") {
        errors.push(
          fmt(
            i,
            `standard_place '${entry.standard_place}' contradicts place '${entry.place}' — the place text ` +
              "names a different country. Re-resolve with place_search / place_search_all and supply the " +
              "correct standard_place, or set standard_place: null if no standard form exists.",
          ),
        );
        continue;
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
  return { treeMutated, matchScores, batchAssertions, startingPersonIds, createdAssertions, sourceDescriptionId, sourceReuse, resolvedPlaces, warnings, verdictFile };
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
        q?.exhaustive_declaration?.declared === true,
      ]),
    );
    // Same discipline, for the mentor gate on project.status = "completed":
    // the proof summaries that already carry a gps-mentor proof-critique
    // verdict, as of BEFORE this call's ops. Snapshotting is what stops a
    // single batch appending the verdict and consuming it for the completion
    // transition in one call.
    // Same discipline again, for the conflict half of the completion gate: the
    // conflicts that were blocking BEFORE this call's ops. Without it a single
    // batch could resolve the conflict and complete in one go.
    // Widened with the live arm, not instead of it: the gate refuses on the
    // union, so narrowing only one half would let a batch resolve a
    // derived-blocking conflict and complete in the same call.
    const preCallTiedAssertionIds = questionTiedAssertionIds(research);
    const preCallBlockingConflicts = (
      Array.isArray(research.conflicts) ? research.conflicts : []
    ).filter((c: any) => c && conflictBlocksCompletion(c, preCallTiedAssertionIds));
    const preCallCritiquedSummaryIds = new Set<string>(
      (Array.isArray(research.evaluations) ? research.evaluations : [])
        .filter(
          (e: any) =>
            e && e.focus === "proof-critique" && !e.superseded_by && typeof e.target_id === "string",
        )
        .map((e: any) => e.target_id as string),
    );
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
            preCallCritiquedSummaryIds,
            preCallBlockingConflicts,
            beforeResearch,
            tree,
            prep.matchScores,
            prep.batchAssertions,
            prep.startingPersonIds,
            prep.createdAssertions,
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
    // THIS call sets project.status = "completed" — the same trigger the mentor
    // and conflict gates use — so it never re-warns on a later write to an
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
    const validationBlock = {
      valid: true as const,
      warnings: [...validationWarnings, ...opWarnings, ...rewriteWarnings, ...treeEncodingWarnings, ...(persistenceWarning ? [persistenceWarning] : [])],
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
    "To persist a whole record in ONE call, pass an `ops` array (each op is " +
    "`{ section, op, entry?/entryId?/fields?, planId? }`): one sources append plus one " +
    "assertions append per fact, with the top-level `sourceDescription: { title, " +
    "author?, url? }`. The tool then creates the tree.gedcomx.json source description " +
    "(assigning the S id), stamps the source op's `gedcomx_source_description_id` and " +
    "every assertion's `source_id`, auto-fills/verifies `record_persona_id` and " +
    "canonicalizes `record_id` against the log entry's results sidecar, resolves " +
    "`standard_place` for assertion places (copying the sidecar's resolution when " +
    "present; resolved values are echoed in `resolvedPlaces`), validates ONCE, and " +
    "writes tree.gedcomx.json + research.json together. Source reuse is " +
    "auto-detected: when the batch's assertions cite a record_id an existing source " +
    "already covers, the tool updates that source in place (same repository) or " +
    "reuses its S entry (different repository) instead of duplicating — always " +
    "supply `sourceDescription` and relay the echoed `sourceReuse` " +
    "({ action: created | updated_existing | new_source_reused_s, srcId, sId }). " +
    "To cite a specific known S entry explicitly, omit `sourceDescription` and set " +
    "the sources op's `gedcomx_source_description_id` to that S id. Batches are " +
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
          "append a new entry (tool assigns the id) or update an existing one by id. " +
          "Correcting an assertion's place/standard_place/date/value also updates the " +
          "tree fact materialized from it — no separate tree_correct call.",
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
                "append (tool assigns id) or update by id. An assertions update also " +
                "updates the tree fact materialized from that assertion.",
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

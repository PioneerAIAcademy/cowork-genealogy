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

import { join } from "path";
import { readFile, mkdir } from "fs/promises";
import { validateIntroduced } from "../validation/introduced-errors.js";
import { sanitizeTree } from "../validation/tree-sanitize.js";
import {
  atomicWriteJson,
  atomicWriteBoth,
  backupIfExists,
  isInsideProject,
  readProjectJson,
  formatIssues,
  withProjectLock,
  NoProjectError,
  noProjectResult,
} from "../utils/project-io.js";
import { coerceJsonArg } from "../utils/coerce-json-arg.js";
import { exampleHints } from "./research-append-examples.js";
import { gcUnreferencedImages } from "../utils/image-store.js";
import { nextId } from "../utils/gedcomx-ids.js";
import { arkToBareId } from "../utils/ark.js";
import { resolveStandardPlace, countryConsistency } from "../utils/place-resolver.js";

// Re-exported for back-compat: tests and any other importer that reaches this
// check via research-append.ts (its original home) keep working unchanged.
// The implementation now lives in place-resolver.ts, shared with tree-edit.ts.
export { countryConsistency };
import { stdDate } from "../utils/date-standardize.js";
import { MONTH_NUM } from "../utils/date-constants.js";
import { treeDiff } from "./tree-diff.js";
import type { SimplifiedGedcomX } from "../types/gedcomx.js";

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

// Section invariants the project validator does NOT already enforce. (It already
// checks conflict competing-counts, hypothesis ruled_out⇒reason, and
// exhaustive-declaration completeness — those are left to validate-before-persist.)
// Each returns error strings on the post-mutation entry; empty = ok.

function conflictInvariants(entry: any): string[] {
  if (entry.status !== "resolved") return [];
  const errs: string[] = [];
  for (const f of ["independence_analysis", "weighing_analysis", "resolution_rationale"]) {
    const v = entry[f];
    if (v === undefined || v === null || v === "") {
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
function personaReachable(entry: any, research: any): boolean {
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

/** The retrieval route for a reachable persona, named so the warning tells the
 *  agent what to DO rather than only what is missing. */
function personaRoute(entry: any, research: any): string {
  const assertions: any[] = research.assertions ?? [];
  const assertion = assertions.find((a: any) => a?.id === entry.assertion_id);
  if (assertion?.record_persona_id) {
    return (
      `assertion '${entry.assertion_id}' carries record_persona_id ` +
      `'${assertion.record_persona_id}' — use it as primaryId1 with that record's gedcomx`
    );
  }
  const log: any[] = research.log ?? [];
  const logEntry = log.find((l: any) => l?.id === assertion?.log_entry_id);
  if (logEntry?.tool === "record_read") {
    return (
      `assertion '${entry.assertion_id}' came from record_read — call ` +
      `record_read({ recordId: '${assertion?.record_id}' }) again; it returns simplified ` +
      `GedcomX, and primaryId1 is the persons[].id for the party this link is about`
    );
  }
  if (logEntry?.results_ref) {
    return (
      `log entry '${logEntry.id}' retained a sidecar — take the persona from ` +
      `'${logEntry.results_ref}'; primaryId1 is the persons[].id for the party this link ` +
      `is about, not the result's top-level primaryId`
    );
  }
  return `resolve the persona for assertion '${entry.assertion_id}' before linking`;
}

/** Warn — NOT reject — a person_evidence link that records no numeric
 *  `match_score` when a record persona was REACHABLE for it (#1006, re-pointed
 *  by #1429). `same_person` returns a 0–1 float and `match_score` is the field
 *  meant to carry it, yet 94% of historical person_evidence writes leave it
 *  unset: identity is asserted, never scored. This ships WARN-ONLY — the fault
 *  text rides the response's `validation.warnings` and the write still succeeds —
 *  because a hard reject on day one would break ~94% of runs and the hosted path
 *  at once. Graduating it to a rejection is a separate decision (needs @DallanQ),
 *  the same shadow-then-graduate discipline as guardrail-enforcement-spec.md §7,
 *  and it has to answer ADR-0009 constraint 2: `match_score` is caller-fabricable,
 *  so a rejection buys a number rather than a call unless something persists the
 *  `same_person` result.
 *
 *  **Two things #1429 changed, both measured.** It used to gate on
 *  `confidence === "confident"` and to know nothing about provenance, so it
 *  (a) said nothing at all about a `probable` link and (b) fired on image- and
 *  full-text-sourced links nothing could ever score. Worse, its escape read "if
 *  no comparable FamilySearch persona exists to score against, leave match_score
 *  null" — and a null `record_persona_id` is not that case. Observed in
 *  `v1_2026-08-27_11-28-52`: on both `ut_person_evidence_022` and `_024` the
 *  agent wrote a confident link with a null score and said "no indexed GedcomX
 *  persona", taking an escape the tool had offered it for a record it could have
 *  re-opened. So the gate is now reachability, at any confidence, and the text
 *  names the retrieval route instead of excusing the omission.
 *
 *  Gated on REACHABILITY at any confidence, not on `confidence === "confident"`.
 *  The old gate reasoned that a stateless write cannot see the tree but can see
 *  the confidence claim. Reachability is knowable statelessly too — the join runs
 *  entirely inside the document being written — and it is the better question:
 *  the confidence gate said nothing about the `probable` links where a skipped
 *  score hides, and fired on links nothing could ever score.
 *  The correct response is to call `same_person` on the pairing and record its
 *  score — NOT to lower the confidence to silence the warning. Confidence is the
 *  correlation judgment; `match_score` is the number behind it, and downgrading the
 *  first to escape a warning about the second games a genealogical claim (and can
 *  slip a link under the `confident` epistemic-gate reject above). A link that
 *  genuinely cannot be scored (no comparable FamilySearch persona) keeps
 *  `match_score: null` and the confidence its analysis supports. A present number
 *  does not prove `same_person` ran — same trust posture the `confidence` field
 *  itself takes — but only a real 0–1 score clears the warning: a number outside the
 *  range does not, since the runtime validator (`validator.ts`, which does not load
 *  the JSON Schema) leaves the schema's 0–1 bound unenforced at the write. */
function personEvidenceScoreWarnings(entry: any, research: any): string[] {
  const score = entry.match_score;
  // A real 0–1 score clears it. A number outside the range does not: the runtime
  // validator does not load the JSON Schema, so the schema's 0–1 bound is
  // unenforced at the write.
  if (typeof score === "number" && score >= 0 && score <= 1) return [];
  // Gated on REACHABILITY, not on confidence. Silent where nothing could be
  // scored, so the warning means something when it does fire.
  if (!personaReachable(entry, research)) return [];
  return [
    `person_evidence link for person '${entry.person_id}' (assertion '${entry.assertion_id}') ` +
      `records no usable match_score (got ${JSON.stringify(entry.match_score)} — expected a ` +
      `number 0–1), but a record persona IS reachable for it: ${personaRoute(entry, research)}. ` +
      `Score the pairing with same_person and record its score. A null record_persona_id is ` +
      `NOT a reason to skip — same_person takes two gedcomx documents plus a focus id inside ` +
      `each and never reads that field; a null value means only that no search sidecar was ` +
      `retained. A locally-minted tree id is not a reason either: it scores on document ` +
      // The one legitimate null this warning must NOT badger the agent out of.
      // Scoring a persona against a person minted FROM that persona is circular
      // — it can only confirm itself. The tool cannot detect the case: by the
      // time the link is written the stub already exists in the tree and looks
      // no different from one that has been there for months. So it is named
      // here as a sanctioned exception rather than suppressed. Observed live:
      // in v1_2026-08-27_12-36-32 this warning drove ut_person_evidence_n7v to
      // score the groom persona G1 against the John Flynn stub it had just
      // minted from G1, a third call that matched no fixture and cost the test
      // its Tool Arguments score.
      `content. If the tree person was minted from the very persona you would be ` +
      `scoring, the comparison IS circular — leave match_score null and say so in the ` +
      `rationale. The link was still written — this is a warning, not a rejection.`,
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

function proofSummaryInvariants(
  entry: any,
  preCallExhaustiveDeclared: Map<string, boolean> | undefined,
): string[] {
  const tier = entry?.tier;
  if (tier !== "proved" && tier !== "disproved") return [];
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
    const raw = await readFile(join(projectPath, "starting-tree.gedcomx.json"), "utf-8");
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
        ? `This call created ${emptyCreated.length} plans and ${emptyCreated.join(", ")} all end it empty, so there is no single id to add: give each plan_items op the id of the plan ITS item belongs to.`
        : `A plan_items op must carry the id the tool assigned the plan the item belongs to, which is '${newId}' for this one.`;

    let cause: string;
    if (preExisting.length > 0) {
      const named = preExisting.map(describe).join(", ");
      const otherQuestion = preExisting.some((id) => {
        const o = byId.get(id);
        return o && typeof o.question_id === "string" && o.question_id !== pl.question_id;
      });
      const hardCoded = preExisting.includes("pl_001") && newId !== "pl_001";
      const tail = hardCoded
        ? " Never a hard-coded 'pl_001': in an ongoing project that is the first plan in the file, not yours."
        : otherQuestion
          ? " Note it belongs to a different question, so its audit trail is not yours to append to."
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

/** Assertions with `evidence_type: "negative"` must set `record_role` to the
 *  exact string `"absent"` (research-schema-spec.md §5.6), and vice versa —
 *  the two fields are not independent judgment calls, `record_role: "absent"`
 *  is a mechanical corollary of the evidence_type decision, so this REJECTS
 *  rather than silently coercing. Silently overwriting `record_role` would
 *  risk masking an assertion whose `value` also failed to differentiate the
 *  person — observed live: three negative-evidence assertions on three
 *  different people sharing one generic `value` string ("preceded Harold
 *  Dean Whitaker in death"), with `record_role` as their only distinguishing
 *  field. No-op for a non-assertion entry (only assertions carry
 *  `evidence_type`) or a non-string `evidence_type`. */
function validateNegativeEvidenceRole(entry: Record<string, unknown>): void {
  if (typeof entry.evidence_type !== "string") return;
  const isNegative = entry.evidence_type === "negative";
  const roleIsAbsent = entry.record_role === "absent";
  if (isNegative && !roleIsAbsent) {
    throw new ResearchAppendError(
      `assertion has evidence_type "negative" but record_role '${entry.record_role}' ` +
        `— negative evidence always uses the literal record_role "absent". Keep the ` +
        `person's identity in \`value\` instead (e.g. "Walter Whitaker preceded Harold ` +
        `Dean Whitaker in death", not a generic value shared across multiple people).`,
    );
  }
  if (roleIsAbsent && !isNegative) {
    throw new ResearchAppendError(
      `assertion has record_role "absent" but evidence_type '${entry.evidence_type}' ` +
        `— record_role "absent" is reserved for negative evidence (evidence_type: "negative").`,
    );
  }
}

function applyOne(
  research: any,
  op: ResearchAppendOp,
  appendedThisBatch?: Set<string>,
  preCallExhaustiveDeclared?: Map<string, boolean>,
  preCallCritiquedSummaryIds?: Set<string>,
  preCallBlockingConflicts?: any[],
  preCallResearch?: any,
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
    // status "unresolved" AND (it is an identity conflict OR blocks_question_ids
    // non-empty). "resolved" and "moot" both settle a conflict. This is a
    // tool precondition on the status transition, not a document-validity
    // rule — an already-completed project with such a conflict still loads.
    // Motivated by the wilkins-death-kentucky e2e run where an agent logged
    // an unresolved identity conflict (wrong-person death certificate,
    // 43-year birth mismatch) and completed the project anyway; prose-level
    // guardrails (warnings, mentor) fired and were rationalized away.
    if (section === "project" && op.fields.status === "completed") {
      // An identity conflict is flagged by a non-empty identity_question STRING.
      // The schema types identity_question as the question's text (string|null),
      // never a boolean, so the old `=== true` was unsatisfiable dead code —
      // an unresolved identity conflict slipped past the gate whenever
      // blocks_question_ids was also empty (issue #1001).
      const isIdentityConflict = (c: any) =>
        typeof c.identity_question === "string" && c.identity_question.trim() !== "";
      const live = (Array.isArray(research.conflicts) ? research.conflicts : []).filter(
        (c: any) =>
          c &&
          c.status === "unresolved" &&
          (isIdentityConflict(c) ||
            (Array.isArray(c.blocks_question_ids) && c.blocks_question_ids.length > 0)),
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
          .map((c: any) => `${c.id} (${c.conflict_type ?? "conflict"}${isIdentityConflict(c) ? ", identity" : ""})`)
          .join(", ");
        throw new ResearchAppendError(
          `cannot set project.status = "completed": unresolved blocking conflict(s) ${names}. ` +
            "GPS Component 4 requires conflicting evidence to be resolved before concluding. " +
            "Run conflict-resolution for each — set its status to 'resolved' (with " +
            "independence_analysis, weighing_analysis, and resolution_rationale) or 'moot' " +
            "(with a rationale for why it no longer matters) — then retry completing the project. " +
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
      // hold" since PR #1029, and 23% of completed runs in the committed e2e
      // corpus reach `completed` with at least one uncritiqued summary anyway.
      //
      // A superseded verdict does not count: if a newer verdict replaced it, the
      // newer one is itself in evaluations[] and satisfies the gate; if nothing
      // replaced it, the critique genuinely no longer stands.
      // `resolved` is an ISO date string or null, never a boolean, so the old
      // `=== true` was unsatisfiable dead code — the same shape as the
      // `identity_question === true` bug 60 lines above. `Boolean(q.resolved)`
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
  if (section === "conflicts") invariantErrors.push(...conflictInvariants(resultEntry));
  // One active plan per question — enforced on append OR an update that
  // (re)sets status to "active"; the helper no-ops for non-active entries.
  if (section === "plans") {
    invariantErrors.push(...planActiveInvariants(resultEntry, research));
  }
  // Identity over-reach: runs on append AND on an update that raises confidence
  // to "confident"; the helper no-ops for every other confidence value.
  if (section === "person_evidence") {
    invariantErrors.push(...personEvidenceInvariants(resultEntry, research));
    // Warn-only: a link that records no match_score where a persona was
    // reachable (#1006, re-pointed by #1429). Rides the response warnings; does
    // not block the write.
    opWarnings.push(...personEvidenceScoreWarnings(resultEntry, research));
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
        .filter((v: unknown): v is string => typeof v === "string" && v.trim() !== "")
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
      .filter((v: unknown): v is string => typeof v === "string" && v.trim() !== "")
      .map((v: string) => arkToBareId(v)),
  );
  const batchAssertionRoles = new Set(
    assertionAppends
      .map((op) => (op.entry as any).record_role)
      .filter((v: unknown): v is string => typeof v === "string" && v.trim() !== ""),
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
        const sc = JSON.parse(await readFile(join(projectPath, ref), "utf-8"));
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
          errors.push(
            fmt(
              i,
              `log entry '${logId}' (${logEntry.tool}) returned results but staged no sidecar ` +
                "(results_ref is null) — record_persona_id cannot be resolved and would be lost. " +
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
          const key = arkToBareId(String(entry.record_id ?? ""));
          const matches = results.filter(
            (r) => r && typeof r === "object" && typeof r.recordId === "string" && arkToBareId(r.recordId) === key,
          );
          if (matches.length === 0) {
            // A record_id outside the sidecar is legal when no persona is
            // claimed (e.g. a negative assertion naming the collection
            // searched); with a persona it is a contradiction.
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
            // Canonicalize record_id to the sidecar's stored form.
            if (entry.record_id !== matchedRecord.recordId) {
              entry.record_id = matchedRecord.recordId;
            }
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

    // ── Place lever (b): never geocode what the source record already
    // resolved — copy the sidecar's standard_place for the same place string.
    // `standard_place: null` is an explicit opt-out (skip resolution + guard);
    // only a fully omitted field triggers resolution.
    let geocoded = false;
    if (typeof entry.place === "string" && entry.place.trim() !== "" && entry.standard_place === undefined) {
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
          `resolved standard_place '${entry.standard_place}' for place '${entry.place}' — the place text ` +
            "names no country, so the resolution could not be cross-checked; verify it is the right place",
        );
      }
    }
  }

  if (errors.length > 0) throw new ResearchAppendError(errors);
  const verdictFile = prepareVerdict(input, ops, fmt, errors);
  if (errors.length > 0) throw new ResearchAppendError(errors);
  return { treeMutated, sourceDescriptionId, sourceReuse, resolvedPlaces, warnings, verdictFile };
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
    const preCallBlockingConflicts = (
      Array.isArray(research.conflicts) ? research.conflicts : []
    ).filter(
      (c: any) =>
        c &&
        c.status === "unresolved" &&
        ((typeof c.identity_question === "string" && c.identity_question.trim() !== "") ||
          (Array.isArray(c.blocks_question_ids) && c.blocks_question_ids.length > 0)),
    );
    const preCallCritiquedSummaryIds = new Set<string>(
      (Array.isArray(research.evaluations) ? research.evaluations : [])
        .filter(
          (e: any) =>
            e && e.focus === "proof-critique" && !e.superseded_by && typeof e.target_id === "string",
        )
        .map((e: any) => e.target_id as string),
    );
    // Heal legacy tree shapes in memory; the healed document is what a
    // composite write persists (same one-shot migration as tree_edit). A
    // research-only call still never writes the tree.
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
    const misrouted = emptyCreatedPlanErrors(ops, research, applied);
    if (misrouted.length > 0) {
      return fail(
        misrouted.map((m) => fmt(m.index, m.message)),
        [{ section: "plans", op: "append" }],
      );
    }

    const opWarnings = [...prep.warnings, ...applied.flatMap((a) => a.warnings ?? [])];
    const anyMutation = applied.some((a) => !a.noop) || prep.treeMutated;

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
      const validation = await validateIntroduced({ research: beforeResearch, tree: beforeTree }, { research, tree }, { projectPath });
      if (!validation.valid) {
        // Shape errors surface here (the document validator, not applyOne), so
        // this is the site the evaluations/known_holdings rejections land on.
        const mapped = mapValidationErrors(formatIssues(validation.errors), applied, isBatch);
        // Only hint the sections the errors actually name — in a wide batch,
        // examples for ops that validated fine would be noise pointing away
        // from the real problem.
        const blamed = ops.filter((o) => mapped.some((m) => m.includes(String(o.section))));
        return fail(
          mapped,
          (blamed.length > 0 ? blamed : ops).map((o) => ({
            section: String(o.section),
            op: o.op === "update" ? "update" : "append",
          })),
        );
      }
      validationWarnings = formatIssues(validation.warnings);
      // Verdict sidecar first: research.json's file_path pointer must never
      // name a file that does not exist. Written before the document commit so
      // a failure here aborts before the pointer is persisted.
      if (prep.verdictFile) {
        await mkdir(join(projectPath, "evaluations"), { recursive: true });
        await atomicWriteJson(join(projectPath, prep.verdictFile.relPath), prep.verdictFile.body);
      }
      const researchPath = join(projectPath, "research.json");
      if (prep.treeMutated) {
        const treePath = join(projectPath, "tree.gedcomx.json");
        await backupIfExists(treePath); // one-deep .bak, same semantics as every tree writer
        await atomicWriteBoth([
          { path: treePath, data: tree }, // tree first —
          { path: researchPath, data: research }, // — then research (commit order)
        ]);
        filesWritten = ["tree.gedcomx.json", "research.json"];
        validationWarnings = [...sanitized.warnings, ...validationWarnings];
      } else {
        await atomicWriteJson(researchPath, research);
        filesWritten = ["research.json"];
      }
      if (prep.verdictFile) filesWritten = [...filesWritten, prep.verdictFile.relPath];
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
      warnings: [...validationWarnings, ...opWarnings, ...treeEncodingWarnings, ...(persistenceWarning ? [persistenceWarning] : [])],
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
        description: "append a new entry (tool assigns the id) or update an existing one by id.",
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
            op: { type: "string", enum: ["append", "update"], description: "append (tool assigns id) or update by id." },
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

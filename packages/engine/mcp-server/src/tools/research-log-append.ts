// research_log_append — append one entry to research.json `log[]` and, when a
// search retained raw results, finalize its results/<log_id>.json sidecar —
// atomically and schema-valid. Append-only by GPS rule (no update/delete).
//
// The tool owns the clerical work the four writing skills do by hand today: id
// assignment, timestamping, the three-way results_ref↔log_id↔filename wiring,
// returned_count integrity, camelCase→snake_case rename, and the atomic write.
// The raw payload reaches disk via host-side staging (search-result-staging-
// spec.md) — it never round-trips through the model. Spec: research-log-editor-spec.md.
//
// Batch form (`ops[]`, added 2026-07-26): mirrors research_append/tree_edit/
// materialize_facts's ops[] convention — validate-once/write-once/all-or-
// nothing on research.json. One wrinkle those tools don't have: a sidecar
// finalization is a REAL file write that happens as each op is applied, not a
// pure in-memory mutation deferred to the final commit — so a batch tracks
// every sidecar it creates and unlinks all of them (not just the failing op's)
// on any later failure, exactly mirroring the single-call path's existing
// orphan-cleanup behavior, just extended to a list.

import { getProjectStore } from "../store/project-store.js";
import { VALIDATOR_ENUMS } from "../validation/validator.js";
import { validateIntroduced } from "../validation/introduced-errors.js";
import { sanitizeTree } from "../validation/tree-sanitize.js";
import {
  atomicWriteJson,
  readProjectJson,
  formatIssues,
  withProjectLock,
  NoProjectError,
  noProjectResult,
} from "../utils/project-io.js";
import { finalizeStagedResults, STAGING_CAPABLE_TOOLS } from "../utils/results-staging.js";
import { coerceJsonArg } from "../utils/coerce-json-arg.js";
import { isHttpUrl, isNonNegativeInteger } from "../utils/search-helpers.js";

const EXTERNAL_SITE_VALUES = VALIDATOR_ENUMS.external_site;
const OUTCOME_VALUES = VALIDATOR_ENUMS.log_outcome;


/** Fire the "logging without persistence" nudge once this many positive-outcome
 *  searches have been logged while the project still holds zero sources and zero
 *  assertions. Mirrors research_append's sources-without-assertions threshold. */
const LOG_WITHOUT_PERSISTENCE_WARN_THRESHOLD = 3;

/** Non-blocking nudge (issue #1478, folded-in sibling of research_append's
 *  sources-without-assertions warning). A session that has logged ≥THRESHOLD
 *  positive-outcome searches while research.json still holds zero sources AND
 *  zero assertions is finding records and persisting none of the evidence — the
 *  feedback bundle-2 shape (26 log entries, 0 sources, 0 assertions). Gated on
 *  BOTH being empty so it owns a distinct shape from the source-append warning
 *  (which fires once ≥3 sources exist); self-silences the instant any source or
 *  assertion lands. Fires per qualifying call while the two-empty state holds.
 *  Tool-name neutral, and a warning — never a failure. */
function logWithoutPersistenceWarning(research: any): string | null {
  const sources = Array.isArray(research.sources) ? research.sources : [];
  const assertions = Array.isArray(research.assertions) ? research.assertions : [];
  if (sources.length > 0 || assertions.length > 0) return null;
  const log = Array.isArray(research.log) ? research.log : [];
  const positives = log.filter((e: any) => e?.outcome === "positive").length;
  if (positives < LOG_WITHOUT_PERSISTENCE_WARN_THRESHOLD) return null;
  return (
    `${positives} search(es) logged with a positive outcome but no sources or ` +
    `assertions recorded yet. When a search identifies a relevant record, persist ` +
    `it — the source and the assertions it supports — or record why it could not, ` +
    `so the evidence is not lost when the session ends.`
  );
}

export interface ResearchLogAppendExternalSite {
  site: string;
  urlGenerated: string;
  captureReceived: boolean;
  captureFilename?: string | null;
}

/** One log entry — the body of a single call, or one element of a batch `ops`. */
export interface ResearchLogAppendOp {
  tool: string;
  query: unknown;
  outcome: string;
  resultsExamined: number;
  planItemId?: string | null;
  resultsAvailable?: number | null;
  notes?: string | null;
  externalSite?: ResearchLogAppendExternalSite | null;
  stagedResultsRef?: string | null;
}

export interface ResearchLogAppendInput extends Partial<ResearchLogAppendOp> {
  projectPath: string;
  // Batch form — supply ops; when present the single-op fields above are
  // ignored. Every op applies to one in-memory research.json (log ids assigned
  // in order), validates ONCE, and writes research.json ONCE (all-or-nothing).
  // Each op's sidecar (if it stages results) is still written as that op is
  // applied — see the module comment on why that's the one place this tool's
  // batching isn't purely in-memory, and how failure cleanup handles it.
  ops?: ResearchLogAppendOp[];
}

/** The per-entry result payload — the body of a single call's success, or one
 *  element of a batch `results`. */
export interface ResearchLogAppendOpResult {
  logId: string;
  performed: string;
  resultsRef: string | null;
  returnedCount: number | null;
}

export type ResearchLogAppendResult =
  | ({
      ok: true;
      filesWritten: string[];
      validation: { valid: true; warnings: string[] };
    } & ResearchLogAppendOpResult)
  | {
      ok: true;
      /** One entry per `ops[]` element, in order — the batch form. */
      results: ResearchLogAppendOpResult[];
      filesWritten: string[];
      validation: { valid: true; warnings: string[] };
    }
  // `reason: "no_project"` marks the one ok:false that is an answer rather than
  // a failure (see noProjectResult). Optional field on the existing arm, NOT a
  // third arm — every `if (!r.ok) r.errors…` keeps narrowing as it does today.
  | { ok: false; errors: string[]; reason?: "no_project" };

/** Raised for expected input problems; turned into `{ ok: false }`. */
class LogAppendError extends Error {}

/**
 * Census mentions the note actually makes: a year BOUND to the word "census",
 * with the jurisdiction that qualifies it.
 *
 * Two things used to be read off the whole note and both were wrong.
 *
 * THE YEAR. `/\b18[0-7]\d\b/` over the whole note meant any incidental pre-1880
 * number tripped the rule, and a census note almost always carries birth years
 * older than the census itself: "1880 US Census ... Henry Bottermiller (head,
 * born 1828 Germany)" was refused on the 1828.
 *
 * THE JURISDICTION. The doctrine is US-federal: 1880 is the dividing line
 * there. England & Wales and Scotland gained the relationship column in 1851,
 * so an "1871 Scotland Census household" is fully documented and was still
 * refused. This is the second of the three objections the lead raised against a
 * tool-boundary gate on 2026-08-27 (recorded in whitfield-1850-household.json's
 * xfail_reason): "not generalizable outside the US (post-1851 England & Wales
 * censuses do carry a relationship column)".
 *
 * MEASURED over the 3,490 distinct `notes` arguments of research_log_append in
 * the committed run logs (eval/runlogs, both the plain and the `ops[]` batch
 * form), measured at 86d50cf0f: refusals fall 355 -> 201, and the 154 removed
 * are 43.4% of every refusal the rule made -- 134 of them the year, 20 the
 * jurisdiction. Nothing in that corpus is newly refused. Re-derive rather than
 * quote these: the corpus grows with every committed run, and two earlier
 * passes of this same docstring read 3,275/332/136 and 3,392/338/142 on
 * smaller ones. The stamp is there so a reader can tell what the number was
 * true of, per tests/packaging/corpus-figures.test.ts's rule 3.
 *
 * That is a MEASUREMENT, not an invariant, and the difference matters to anyone
 * leaning on it. `CENSUS_YEAR` spans 1600-1999 while the old gate was
 * `\b18[0-7]\d\b`, so a census named before 1800 is newly refused: "1790 US
 * Census household: John Smith head, with wife Mary" was allowed before and is
 * refused now (1800 itself was already refused -- `18[0-7]\d` matches it -- so
 * the boundary is 1600-1799). That behaviour is right, because the 1790-1840
 * schedules name only the head of household and tally everyone else by age
 * band, so the structure is inferred even more completely than on an 1850. But
 * the rule does not only narrow, and a maintainer who believes it does will
 * mis-predict this shape.
 *
 * The jurisdiction test is deliberately adjacency-bound and NOT a search of the
 * note, because most non-US words in this corpus are birthplaces on a US
 * schedule: "1850 US Census, Schuylkill County, PA ... born Ireland" is a US
 * census of Irish immigrants and must stay refused. 48 of the 196 surviving
 * refusals name a non-US place somewhere; read through, they are overwhelmingly
 * that shape, so a wider window would be a regression rather than a further fix.
 *
 * Both are bound ADJACENTLY, never by scanning. The jurisdiction must sit in
 * the unbroken run of words touching the census token -- punctuation ends the
 * run -- so "born 1821 Wales, 1860 census at Cosumnes Township, California"
 * still reads as a US 1860 census (correctly refused) rather than a Welsh one.
 */
type CensusMention = { year: number; columnFrom: number };

const CENSUS_YEAR = String.raw`1[6-9]\d\d`;
/** A run of years sharing one census token: "1860 and 1870 censuses". */
const CENSUS_YEAR_RUN = String.raw`(?:${CENSUS_YEAR})(?:\s*(?:,|and|&|\/|or|to|-|–|through)\s*(?:${CENSUS_YEAR}))*`;
/** Words allowed between the year and the token: "1900 US federal census". */
const CENSUS_QUALIFIER = String.raw`(?:u\.?\s?s\.?|united\s+states|federal|state|national|uk|united\s+kingdom|england|english|wales|welsh|scotland|scottish|ireland|irish|britain|british|canada|canadian|denmark|danish|norway|norwegian|sweden|swedish|germany|german|prussia|prussian|colonial|population|agricultural|mortality|slave|veterans?|school|and|&)`;
const CENSUS_TOKEN = String.raw`census(?:es)?`;
const CENSUS_BEFORE = new RegExp(
  String.raw`\b(${CENSUS_YEAR_RUN})\s*((?:${CENSUS_QUALIFIER}\s+){0,4})${CENSUS_TOKEN}\b`,
  "gi",
);
const CENSUS_AFTER = new RegExp(
  // The connector may be a word ("census of 1870"), punctuation ("census, 1870")
  // or nothing at all but a space ("US Census 1880", which is how FamilySearch
  // titles its collections). Only whitespace and these connectors may sit
  // between, never free text -- that is what keeps "census ... born 1828" out.
  String.raw`((?:${CENSUS_QUALIFIER}\s+){0,4})${CENSUS_TOKEN}\b(?:\s*(?:of|for|in|from|year|taken\s+in|enumerated\s+in)\s+|\s*[,:(\[-]\s*|\s+)(${CENSUS_YEAR_RUN})`,
  "gi",
);

/**
 * The first census year whose schedule carries a relationship-to-head column.
 * Sources: search-records/references/census-field-availability.md -- US "1880,
 * the dividing line"; England & Wales "1851 onward -- relationships and exact
 * ages", 1841 having none. Scotland follows E&W. A jurisdiction named but not
 * listed here returns null, which SKIPS the rule rather than guessing: the
 * doctrine is documented for these two only, and a wrong refusal blocks a
 * researcher mid-write.
 */
function relationshipColumnFrom(qualifier: string): number | null {
  const q = qualifier.toLowerCase();
  if (/\b(?:england|english|wales|welsh|scotland|scottish|britain|british|uk|united\s+kingdom)\b/.test(q)) {
    return 1851;
  }
  if (/\b(?:ireland|irish|canada|canadian|denmark|danish|norway|norwegian|sweden|swedish|germany|german|prussia|prussian)\b/.test(q)) {
    return Number.NaN; // named, non-US, undocumented here -> skip
  }
  return 1880; // unqualified or explicitly US/federal
}

export function censusMentions(notes: string): CensusMention[] {
  const out: CensusMention[] = [];
  const push = (years: string, qualifier: string, post: string) => {
    const from = relationshipColumnFrom(`${qualifier} ${post}`);
    if (from === null || Number.isNaN(from)) return;
    for (const y of years.match(new RegExp(CENSUS_YEAR, "g")) ?? []) {
      out.push({ year: Number(y), columnFrom: from });
    }
  };
  for (const m of notes.matchAll(CENSUS_BEFORE)) {
    const post = notes.slice(m.index + m[0].length, m.index + m[0].length + 24);
    push(m[1], m[2] ?? "", /^\s*(?:of|for)\s+([A-Za-z&\s]{0,20})/.exec(post)?.[1] ?? "");
  }
  for (const m of notes.matchAll(CENSUS_AFTER)) push(m[2], m[1] ?? "", "");
  return out;
}

/**
 * Refuse a pre-1880 US census note that states household structure as fact.
 *
 * 1850/1860/1870 carry NO "relationship to head" column. Every "head" / "wife" /
 * "son" read off such a household -- and the record's own ParentChild/Couple
 * edges, which are the indexer's inference from the same signals -- is an
 * inference, not something the census stated. A note asserting it flat records a
 * relationship the source cannot support, and a later reader has no way to tell
 * it from a stated one.
 *
 * ENFORCED HERE RATHER THAN IN PROSE because it is decidable from the note
 * alone, which is ADR-0011's test for a writer-tool precondition. The prose rule
 * has been in search-records/SKILL.md since issue #1284 and adherence is
 * measurably partial: across the five committed run logs the marker appears in
 * 32 of 43 logged searches, and issue #1912's flat "plus sons Thos T McElwee and
 * Stephen McElwee" is real production text.
 *
 * DELIBERATELY NARROWER THAN THE EVAL VALIDATOR, whose pattern sets have been
 * re-tuned three times (#1284, #1642, #1912) for false positives and negatives.
 * Porting them wholesale into a hard refusal would inherit that history, and a
 * wrong refusal blocks a researcher mid-write. This fires only where all three
 * parts are unambiguous, and a note that trips it can always be fixed by saying
 * what is true -- so the refusal is always actionable.
 */
export function requirePre1880CensusHedge(notes: string): void {
  const text = notes.toLowerCase();
  // `\bcensus\b`, singular only, KNOWINGLY: a note saying just "censuses"
  // bypasses the rule entirely ("Traced the family across the 1850 and 1860 US
  // censuses ... head of household Thomas Flynn" writes clean today). Widening
  // to `census(?:es)?` was measured and reverted -- it adds 4 refusals of which
  // 2 are research PLANS rather than claims ("check 1850 and 1860 censuses for
  // a woman named Margaret in the Thomas Flynn household"). The rule cannot
  // tell a plan from a claim, which is a pre-existing weakness that fixing the
  // gate merely exposes on more notes, and it is the real objection here. Do
  // not widen this without solving that first.
  if (!/\bcensus\b/.test(text)) return;

  // Tie the year to the census it qualifies. When no year binds to a census
  // mention at all the note is undecidable on that axis, so fall back to the
  // old whole-note test rather than letting an unhedged 1870 household through
  // on a phrasing the patterns above do not cover. A note that reaches THIS
  // branch gets its pre-change verdict, because the fallback below is the old
  // gate verbatim and the `\bcensus\b` test above it is unchanged. That is a
  // claim about this path and nothing wider: the rule as a whole does NOT only
  // narrow -- a census named before 1800 is newly refused, and it is refused on
  // the bound branch, never reaching this one. See the docstring's 1600-1799
  // boundary, pinned by "refuses a census named before 1800, which the old
  // whole-note test allowed".
  const bound = censusMentions(notes);
  const namesColumnlessCensus = bound.length > 0
    ? bound.some((m) => m.year < m.columnFrom)
    : /\b18[0-7]\d\b/.test(text);
  if (!namesColumnlessCensus) return;

  const describesHousehold =
    /\b(household|dwelling|co-?resident|enumerated with|living with)\b/.test(text);
  // Kinship asserted about a NAMED person: "mother Margaret", "plus sons Thos
  // and Stephen". The lookbehind excludes the possessive form -- "searched for
  // his wife Catherine" names a TREE-side relative who may be absent from the
  // return, which is a statement about the tree and not about what the census
  // stated. That carve-out is the eval validator's too, and dropping it made
  // this refuse a compliant note.
  const assertsKinship =
    /(?<!\b(?:his|her|their)\s)\b(?:mother|father|wife|husband|sons?|daughters?|parents?)\s+[A-Z]/.test(notes) ||
    /\bhead\s+of\s+household\b/.test(text);
  if (!describesHousehold && !assertsKinship) return;

  const hedged =
    /infer/.test(text) ||
    /\bnot\s+(?:a\s+)?stated\b/.test(text) ||
    /\bunstated\b/.test(text) ||
    /\bimplied\b/.test(text) ||
    /\bpresum\w*/.test(text) ||
    /no\s+relationship\s+(?:to\s+head\s+)?column/.test(text) ||
    /relationship\s+column[^.]{0,40}\b(?:does not|did not|is not|was not|absent|missing)\b/.test(text);
  if (hedged) return;

  throw new LogAppendError(
    "This note describes a pre-1880 US census household but states the family " +
      "structure as fact. 1850/1860/1870 censuses have NO relationship-to-head " +
      "column, so the structure is an inference from surname, ages and listing " +
      "order -- as are any ParentChild/Couple edges on the record, which the " +
      "indexer inferred the same way. Say so in the note, e.g. \"...in one " +
      "dwelling; family structure inferred from surname, ages and order, not " +
      "stated.\" Then re-send.",
  );
}

/**
 * Coerce an object-typed tool argument that a model emitted as a JSON string
 * back into an object. Some models stringify nested-object params (observed
 * with `externalSite`: the call arrives as `"{\"site\":...}"` rather than an
 * object, so a downstream `value.site` reads `undefined` and the call fails
 * opaquely). No-op for non-string values (object/null/undefined pass through);
 * throws `LogAppendError` when a string is present but isn't a JSON object.
 */
function coerceObjectArg(value: unknown, field: string): unknown {
  if (typeof value !== "string") return value;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new LogAppendError(
      `${field} must be an object, not a string (received unparseable text)`,
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new LogAppendError(`${field} must be a JSON object`);
  }
  return parsed;
}

async function readJson(projectPath: string, filename: string): Promise<any> {
  try {
    return await readProjectJson(projectPath, filename);
  } catch (e) {
    // NoProjectError is an ANSWER, not a failure — re-raised unchanged so the
    // outer catch can return noProjectResult().
    if (e instanceof NoProjectError) throw e;
    throw new LogAppendError(e instanceof Error ? e.message : String(e));
  }
}

/** Next `log_NNN` id above the current max (max + 1, not count + 1). */
function nextLogId(log: any[]): string {
  let max = 0;
  for (const e of log) {
    const m =
      e && typeof e.id === "string" ? e.id.match(/^log_(\d+)$/) : null;
    if (m) {
      const n = Number(m[1]);
      if (n > max) max = n;
    }
  }
  return `log_${String(max + 1).padStart(3, "0")}`;
}

/** Unlink every sidecar this call created, best-effort — used on any failure
 *  path (a later op in a batch throws, or the final validation fails) so no
 *  orphan sidecar survives a call that ultimately writes nothing. */
async function cleanupSidecars(projectPath: string, resultsRefs: string[]): Promise<void> {
  for (const ref of resultsRefs) {
    await getProjectStore().remove(projectPath, ref);
  }
}

/**
 * Apply one log entry to the shared in-memory `research` document: validates
 * the op's own input consistency, assigns the next log id (reading the
 * CURRENT `research.log`, so ids sequence correctly across a batch), finalizes
 * a staged sidecar if one was supplied (a REAL file write — pushed onto
 * `sidecarsCreated` so a later failure in this same call can unwind it), and
 * pushes the entry. Throws `LogAppendError` on any input problem — the caller
 * (single-op or batch) decides how to report it.
 */
async function applyLogAppendOp(
  research: any,
  op: ResearchLogAppendOp,
  projectPath: string,
  sidecarsCreated: string[],
  warnings: string[],
): Promise<ResearchLogAppendOpResult> {
  // 0. Coerce object-typed args a model may have stringified. Some models
  //    emit `externalSite` / `query` as a JSON string instead of a nested
  //    object; without this they reach the checks below as strings and fail
  //    opaquely ("externalSite.site 'undefined' is not a valid site").
  // 0b. Map the literal string "null" back to null on every nullable arg.
  //     Some models emit `"null"` (the string) where they mean JSON null.
  //     Stored verbatim on `planItemId` it becomes a bogus id reference
  //     ("plan_item_id 'null' not found"); on the fields that carry a
  //     validator it is worse, because it refuses the ENTIRE append:
  //     `resultsAvailable: "null"` fails the non-negative-integer bound below,
  //     `stagedResultsRef: "null"` fails the staging-path check, and
  //     `externalSite: "null"` fails `coerceObjectArg`. One stringly-typed
  //     argument then discards the log entry the caller actually wrote.
  //
  //     One helper over all of them rather than a mapping per field: handling
  //     `planItemId` alone and not its siblings is the same class the integer
  //     bound below already had to be widened for (review round 5), and
  //     CLAUDE.md asks for one shared guard on the second instance.
  //
  //     Safe because `"null"` is never a legitimate value for any of these:
  //     not a `pli_` id, not a number, not a `results/.staging/` path, not an
  //     object. `notes` is deliberately NOT mapped — a note whose text is
  //     "null" is odd but not invalid, and nulling a caller's prose would
  //     discard information rather than recover it.
  const asNull = <T,>(v: T): T | null => ((v as unknown) === "null" ? null : v);
  const planItemId = asNull(op.planItemId);
  const resultsAvailable = asNull(op.resultsAvailable);
  const stagedResultsRef = asNull(op.stagedResultsRef);

  const externalSite = coerceObjectArg(asNull(op.externalSite), "externalSite") as
    | ResearchLogAppendExternalSite
    | null
    | undefined;
  const query = coerceObjectArg(op.query, "query");

  // 0c. planItemId must be a plan-item id (^pli_) from the active plan, or
  //     null for an opportunistic/ad-hoc search. Models sometimes stuff a
  //     question id (q_...) or free text into this slot — which persists
  //     silently (validate_research_schema historically didn't check it) and
  //     then hard-fails the JSON-Schema validator downstream. Reject it here
  //     with an actionable error so the caller can correct it, rather than
  //     silently nulling it (which would discard the caller's expressed
  //     intent) or persisting an invalid reference.
  if (planItemId != null && !(typeof planItemId === "string" && planItemId.startsWith("pli_"))) {
    throw new LogAppendError(
      `planItemId '${planItemId}' is not a plan-item id. It must start ` +
        `with 'pli_' (a plan item from the active research plan) or be null ` +
        `for an opportunistic search with no plan item. A question id ` +
        `(q_...) is not a plan-item id — supply the pli_ item under that ` +
        `question, or null.`,
    );
  }

  // 1. Input-consistency checks (external_site ↔ tool, enums).
  const isExternal = op.tool === "external_site";
  if (isExternal && (externalSite === undefined || externalSite === null)) {
    throw new LogAppendError("tool is 'external_site' but externalSite is missing");
  }
  if (!isExternal && externalSite !== undefined && externalSite !== null) {
    throw new LogAppendError("externalSite provided but tool is not 'external_site'");
  }
  if (externalSite && !EXTERNAL_SITE_VALUES.has(externalSite.site)) {
    throw new LogAppendError(`externalSite.site '${externalSite.site}' is not a valid site`);
  }
  // `urlGenerated` is the string the skill presents as the clickable link and
  // persists into `research.json` — the same caller-composed, URL-shaped
  // input `build_external_search_url` rejects as `invalid_base_url`. Trimmed
  // before both the check and the write: `new URL()` strips padding itself,
  // so a padded value would pass here and persist with its spaces.
  const urlGenerated =
    typeof externalSite?.urlGenerated === "string" ? externalSite.urlGenerated.trim() : externalSite?.urlGenerated;
  if (externalSite && urlGenerated != null && !isHttpUrl(String(urlGenerated))) {
    throw new LogAppendError(
      `externalSite.urlGenerated ${JSON.stringify(externalSite.urlGenerated)} is not an absolute http(s) URL`,
    );
  }
  if (!OUTCOME_VALUES.has(op.outcome)) {
    throw new LogAppendError(`outcome '${op.outcome}' is not one of positive/negative/partial/error`);
  }
  // Coerced the same way `resultsAvailable` is below (a model that
  // stringifies numeric args sends `"5"`); a genuinely non-numeric string is
  // left as-is and rejected by the check under it. That check runs before the
  // `external_links_search` gate because the gate's `> 0` comparison is
  // `false` for both `NaN` and a negative number. `validator.ts` enforces the
  // same bound on the persisted `results_examined` for every writer of
  // `log[]`; this is the fail-fast under the caller's own parameter name, the
  // same split `planItemId` above uses.
  const resultsExamined = coerceJsonArg(op.resultsExamined);
  if (!isNonNegativeInteger(resultsExamined)) {
    throw new LogAppendError(
      `resultsExamined must be a non-negative integer; got ${JSON.stringify(op.resultsExamined)}`,
    );
  }
  // This entry grades the curated-links FETCH, not the search: any links
  // returned is a positive fetch, even when none fit the plan item's record
  // type (that goes in notes instead). Enforced mechanically — rather than
  // left to the model's own judgment call — because it was measured to be
  // wrong often enough in practice to need a hard gate, not another
  // reminder in prose. Measured 2026-09-10 against the five run logs this
  // branch commits: 4 of 66 `external_links_search` entries, across three
  // tests (ut_search_external_sites_002, _005, _006) and three of the five
  // logs. (Issue #1950's census said 9 of 48; the corpus has turned over, so
  // that figure is stale rather than wrong — re-derive rather than reword.)
  // This gate replaced the eval validator that used to grade the same shape
  // after the fact; refusing the write is what made that grader unfireable. Scoped to `external_links_search` only: no other
  // tool value shares this fetch-vs-search distinction, and it is the only
  // one search-external-sites (its sole caller) uses this way.
  if (op.tool === "external_links_search" && resultsExamined > 0 && op.outcome !== "positive") {
    throw new LogAppendError(
      `tool 'external_links_search' returned ${resultsExamined} result(s), so outcome must be ` +
        `'positive' (this entry grades the fetch, not the search); got '${op.outcome}'. Note which ` +
        `results didn't fit the plan item's record type in 'notes' instead.`,
    );
  }

  if (!Array.isArray(research.log)) {
    throw new LogAppendError("research.json `log` is missing or not an array");
  }
  const log: any[] = research.log;

  // 2. Assign the id and timestamp; build the snake_case entry.
  const logId = nextLogId(log);
  const performed = new Date().toISOString();
  const entry: any = {
    id: logId,
    plan_item_id: planItemId ?? null,
    performed,
    tool: op.tool,
    query,
    outcome: op.outcome,
    results_examined: resultsExamined,
    external_site: externalSite
      ? {
          site: externalSite.site,
          url_generated: urlGenerated,
          capture_received: externalSite.captureReceived,
          ...(externalSite.captureFilename !== undefined
            ? { capture_filename: asNull(externalSite.captureFilename) }
            : {}),
        }
      : null,
    results_ref: null,
  };
  const resultsAvailableCoerced = coerceJsonArg(resultsAvailable);
  if (resultsAvailable !== undefined && resultsAvailable !== null) {
    // Coerced the same way `ops` is: a model sending `"5"` otherwise lands a string
    // in an integer-typed field that nothing rejects — `validator.ts` carries
    // `results_available` in field-name allow-lists with no type check. The staged-
    // backlog reader tests `typeof === "number"`, so a string entry never pairs and
    // its staged file nags until the TTL. `coerceJsonArg` leaves a genuinely
    // non-numeric value untouched rather than inventing one. Coerced ONCE, into a
    // local that BOTH consumers read: this persisted field and the retained-none
    // warning below, which otherwise gates on the raw argument and stays silent for
    // exactly the input this coercion exists for. `replay.py`'s `_LOG_FIELD_RENAMES`
    // rebuilds the entry from arguments and does NOT coerce, by its own renames-only
    // contract, so a replayed entry differs from a live one for a stringly-typed
    // value. Left that way deliberately: the replay contract is a harness decision.
    // Same bound as `results_examined` above, from the same shared predicate
    // and for the same reason: the schema declares this `integer, minimum: 0`,
    // and the comment above says `validator.ts` carries it in field-name
    // allow-lists with no type check — so a NaN (which persists as `null`), a
    // negative or a fraction reached the document unchallenged. Adding the
    // bound to one of the two sibling fields and not the other was the second
    // instance of one class; CLAUDE.md asks for one shared guard (review
    // round 5).
    if (!isNonNegativeInteger(resultsAvailableCoerced)) {
      throw new LogAppendError(
        `resultsAvailable must be a non-negative integer; got ${JSON.stringify(resultsAvailable)}`,
      );
    }
    entry.results_available = resultsAvailableCoerced as number;
  }
  if (op.notes !== undefined && op.notes !== null) {
    requirePre1880CensusHedge(op.notes);
    entry.notes = op.notes;
  }

  // 3. Finalize a staged sidecar if results were retained. A REAL file write —
  //    unlike every other op in this tool family, this is not undone just by
  //    skipping the final research.json write, so record it for cleanup.
  let resultsRef: string | null = null;
  let returnedCount: number | null = null;
  if (stagedResultsRef !== undefined && stagedResultsRef !== null) {
    let fin: Awaited<ReturnType<typeof finalizeStagedResults>>;
    try {
      fin = await finalizeStagedResults({
        projectPath,
        stagedResultsRef: stagedResultsRef,
        logId,
        expectedTool: op.tool,
      });
    } catch (e) {
      throw new LogAppendError(e instanceof Error ? e.message : String(e));
    }
    resultsRef = fin.resultsRef;
    returnedCount = fin.returnedCount;
    entry.results_ref = resultsRef;
    sidecarsCreated.push(resultsRef);

    // Default `query` from the producing tool's own echo in the staged payload.
    // The search tool already recorded the exact parameters host-side, so making
    // the model re-serialize them buys nothing and costs a 20%-failure-rate
    // hand-transcription of an ARK-dense object (see the tool description). An
    // explicit caller-supplied `query` always wins — this only fills a gap.
    if (entry.query === undefined && fin.payloadQuery !== undefined) {
      entry.query = fin.payloadQuery;
    }
  }

  // 3b. A staging-capable search that HAD results and retained none leaves a log
  //     entry pointing at nothing. The raw response is then gone for good: it
  //     never reaches disk, and the model does not re-serialize it. Downstream
  //     that costs the record-extraction resultsRef path, match re-ranking, and
  //     — because results/ is the only verbatim record of what a search returned
  //     — the ability to tell a skill fault from a tool fault when triaging a
  //     feedback case (docs/alpha-feedback-guide.md step 4).
  //
  //     Warn rather than fail. A nil search correctly retains nothing, and
  //     `resultsAvailable` is what separates the two: 0/absent means there was
  //     nothing to keep, >0 means results existed and were discarded. Failing
  //     would also reject entries whose search genuinely ran without a
  //     projectPath, turning a lossy log into no log at all.
  if (
    STAGING_CAPABLE_TOOLS.has(op.tool) &&
    (stagedResultsRef === undefined || stagedResultsRef === null) &&
    Number.isFinite(resultsAvailableCoerced) &&
    (resultsAvailableCoerced as number) > 0
  ) {
    warnings.push(
      `${logId}: ${op.tool} reported ${resultsAvailableCoerced} available result(s) but ` +
        `retained none — no results/${logId}.json sidecar was written, and the raw ` +
        `response is unrecoverable. Pass \`projectPath\` to ${op.tool} so it stages ` +
        `its response, then hand the returned \`staged.resultsRef\` back here as ` +
        `\`stagedResultsRef\`. Omit \`projectPath\` only for an exploratory search ` +
        `you do not intend to log.`,
    );
  }

  // Every persisted entry carries a `query` object (research.schema.json). If
  // the caller omitted it and no staged payload supplied one, that is an input
  // error — fail loudly here rather than writing an entry the validator will
  // reject on the next append.
  if (entry.query === undefined) {
    throw new LogAppendError(
      "`query` is required. Supply it as an object — search parameters for a " +
        'search entry, or a keyed identifier for a read-style entry (e.g. ' +
        '`{"recordId": "ark:/61903/1:1:XXXX-XXX"}` for record_read, ' +
        '`{"imageArk": "..."}` for image_transcribe). It may be omitted only ' +
        "when `stagedResultsRef` points at a staged payload that already " +
        "carries the query.",
    );
  }

  // 4. Append (append-only — existing entries are never touched).
  log.push(entry);

  return { logId, performed, resultsRef, returnedCount };
}

export async function researchLogAppend(
  input: ResearchLogAppendInput,
): Promise<ResearchLogAppendResult> {
  const { projectPath } = input;

  // Recover a batch `ops` array the model serialized as a JSON string (see
  // coerceJsonArg) before any shape checks.
  input.ops = coerceJsonArg(input.ops) as ResearchLogAppendOp[] | undefined;

  // Serialize the read-modify-write against every other writer on this project
  // (issue #1715).
  return withProjectLock(projectPath, async () => {
  try {
    // Read project files once (research mutated in memory only; tree read for
    // cross-file checks during validation).
    const research = await readJson(projectPath, "research.json");
    const { tree } = sanitizeTree(
      await readJson(projectPath, "tree.gedcomx.json"),
    );
    // Pre-mutation snapshot (applyLogAppendOp mutates research in place; tree
    // is read-only here): block only on errors THIS call introduces, not
    // pre-existing drift in a section it never touched (#1572).
    const beforeResearch = structuredClone(research);
    const sidecarsCreated: string[] = [];
    // Tool-level warnings (retention gaps), merged with the validator's on success.
    const opWarnings: string[] = [];

    // ─── Batch form: apply every op in-memory, then validate + write once ────
    if (input.ops !== undefined) {
      if (!Array.isArray(input.ops) || input.ops.length === 0) {
        return { ok: false, errors: ["`ops` must be a non-empty array"] };
      }
      const results: ResearchLogAppendOpResult[] = [];
      for (let i = 0; i < input.ops.length; i++) {
        try {
          results.push(
            await applyLogAppendOp(research, input.ops[i], projectPath, sidecarsCreated, opWarnings),
          );
        } catch (e) {
          await cleanupSidecars(projectPath, sidecarsCreated);
          if (e instanceof LogAppendError) return { ok: false, errors: [`ops[${i}]: ${e.message}`] };
          throw e;
        }
      }

      const validation = await validateIntroduced({ research: beforeResearch, tree }, { research, tree }, { projectPath });
      if (!validation.valid) {
        await cleanupSidecars(projectPath, sidecarsCreated);
        return { ok: false, errors: formatIssues(validation.errors) };
      }
      await atomicWriteJson(projectPath, "research.json", research);
      const persistWarn = logWithoutPersistenceWarning(research);
      return {
        ok: true,
        results,
        filesWritten: ["research.json", ...sidecarsCreated],
        validation: {
          valid: true,
          warnings: [...opWarnings, ...(persistWarn ? [persistWarn] : []), ...formatIssues(validation.warnings)],
        },
      };
    }

    // ─── Single-op form (behavior unchanged) ─────────────────────────────────
    // Wrapped in the same unwind the batch path uses. `applyLogAppendOp` can
    // throw AFTER it has finalized a sidecar (the `query`-missing check does
    // exactly that), and a sidecar written with no `research.json` entry to
    // reference it is an orphan the next validate_research_schema hard-fails
    // on — with no recovery, since the staged file it came from is already
    // unlinked. The outer catch below returns the error but cannot know a
    // sidecar was written, so the unwind has to happen here.
    let result;
    try {
      result = await applyLogAppendOp(
        research,
        {
          tool: input.tool!,
          query: input.query,
          outcome: input.outcome!,
          resultsExamined: input.resultsExamined!,
          planItemId: input.planItemId,
          resultsAvailable: input.resultsAvailable,
          notes: input.notes,
          externalSite: input.externalSite,
          stagedResultsRef: input.stagedResultsRef,
        },
        projectPath,
        sidecarsCreated,
        opWarnings,
      );
    } catch (e) {
      await cleanupSidecars(projectPath, sidecarsCreated);
      throw e;
    }

    const validation = await validateIntroduced({ research: beforeResearch, tree }, { research, tree }, { projectPath });
    if (!validation.valid) {
      await cleanupSidecars(projectPath, sidecarsCreated);
      return { ok: false, errors: formatIssues(validation.errors) };
    }
    await atomicWriteJson(projectPath, "research.json", research);

    const persistWarn = logWithoutPersistenceWarning(research);
    return {
      ok: true,
      ...result,
      filesWritten: result.resultsRef ? ["research.json", result.resultsRef] : ["research.json"],
      validation: {
        valid: true,
        warnings: [...opWarnings, ...(persistWarn ? [persistWarn] : []), ...formatIssues(validation.warnings)],
      },
    };
  } catch (e) {
    if (e instanceof NoProjectError) return noProjectResult();
    if (e instanceof LogAppendError) return { ok: false, errors: [e.message] };
    throw e;
  }
  });
}

// ─── MCP schema ──────────────────────────────────────────────────────────────

export const researchLogAppendSchema = {
  name: "research_log_append",
  description:
    "Append one entry to the research log (research.json `log[]`) and, when a " +
    "search retained raw results, write its results/<log_id>.json sidecar — " +
    "atomically and schema-valid. Use this after every search (per the research-" +
    "log protocol: even nil searches are logged). The log is append-only — this " +
    "tool only appends; there is no update or delete.\n" +
    "\n" +
    "The tool assigns the log id, the `performed` timestamp, `results_ref`, and " +
    "the whole sidecar envelope (including a recomputed `returned_count`) — you " +
    "never supply them. To retain a search's results, pass the `staged.resultsRef` " +
    "the search tool returned (when you called it with `projectPath`) as " +
    "`stagedResultsRef`; the host finalizes that staged file into the sidecar " +
    "without you re-serializing the payload. Omit `stagedResultsRef` for nil " +
    "searches and external-site searches.\n" +
    "\n" +
    "Returns a compact summary (logId, resultsRef, returnedCount, filesWritten) — " +
    "never the payload. On a validation failure nothing is written and " +
    "`{ ok: false, errors }` is returned.\n" +
    "\n" +
    "To log several searches at once, pass an `ops` array instead of the " +
    "top-level tool/query/outcome/... fields: each op is the same per-entry " +
    "shape. The tool applies all ops to one in-memory research.json, validates " +
    "ONCE, and writes ONCE — all-or-nothing (on any op's failure nothing is " +
    "written, including any sidecar an earlier op in the batch staged, and the " +
    "error is `ops[i]: <msg>`). Log ids are assigned in order. Returns " +
    "`results: [{ logId, performed, resultsRef, returnedCount }]`, one entry " +
    "per op, in order.",
  inputSchema: {
    type: "object" as const,
    properties: {
      projectPath: {
        type: "string",
        description: "Absolute path to the project directory holding research.json and results/.",
      },
      tool: {
        type: "string",
        description:
          "The tool/source that produced this entry, e.g. 'record_search', " +
          "'fulltext_search', 'external_links_search', 'image_search', 'person_read', or " +
          "'external_site'. Must match the staged file's tool when stagedResultsRef is given.",
      },
      query: {
        type: "object",
        description:
          "Freeform OBJECT capturing enough of the search to reproduce it — " +
          "never a bare sentence. For a search entry, the search parameters: " +
          '`{"surname": "Stephens", "residencePlace": "Shelby, Tennessee, ' +
          'United States", "recordType": "census"}`. For a read-style entry ' +
          "there are no search parameters, so key the identifier instead: " +
          '`record_read` → `{"recordId": "ark:/61903/1:1:XXXX-XXX"}` (or ' +
          '`{"recordIds": [...]}` for several); `image_transcribe` / ' +
          '`image_read` → `{"imageArk": "ark:/61903/3:1:XXXX-XXXX-XXX"}`. ' +
          "Put the prose in `notes`. An ARK written into free text is dense " +
          "with `:` and `/` and is the common cause of an " +
          "InputValidationError that rejects the whole call before this tool " +
          "runs — keep ARKs in a keyed field. Omit entirely when " +
          "`stagedResultsRef` is given and the staged payload already " +
          "carries the query.",
      },
      outcome: {
        type: "string",
        enum: [...OUTCOME_VALUES],
        description: "Your analytical judgment of the search outcome.",
      },
      resultsExamined: {
        type: "number",
        description: "How many results you examined (0 for a nil search).",
      },
      planItemId: {
        type: ["string", "null"],
        description: "The `pli_` plan-item this search served, or null for an ad-hoc search.",
      },
      resultsAvailable: {
        type: ["number", "null"],
        description: "Total results the search reported as available, if known.",
      },
      notes: {
        type: ["string", "null"],
        description: "Optional analytical note (e.g. why a negative result is meaningful).",
      },
      externalSite: {
        type: ["object", "null"],
        description:
          "REQUIRED when tool === 'external_site'; otherwise omit or pass null.",
        properties: {
          site: {
            type: "string",
            enum: [...EXTERNAL_SITE_VALUES],
          },
          urlGenerated: { type: "string" },
          captureReceived: { type: "boolean" },
          captureFilename: { type: ["string", "null"] },
        },
        required: ["site", "urlGenerated", "captureReceived"],
      },
      stagedResultsRef: {
        type: ["string", "null"],
        description:
          "The `staged.resultsRef` handle returned by record_search / fulltext_search " +
          "(when called with projectPath). Omit/null for nil and external-site searches.",
      },
      ops: {
        type: "array",
        description:
          "Batch form: log several searches in one validate-once/write-once call " +
          "(all-or-nothing). When present, the top-level tool/query/outcome/... fields " +
          "are ignored. Each op is the same per-entry shape the single form takes.",
        items: {
          type: "object",
          properties: {
            tool: { type: "string" },
            query: { type: "object" },
            outcome: { type: "string", enum: [...OUTCOME_VALUES] },
            resultsExamined: { type: "number" },
            planItemId: { type: ["string", "null"] },
            resultsAvailable: { type: ["number", "null"] },
            notes: { type: ["string", "null"] },
            externalSite: { type: ["object", "null"] },
            stagedResultsRef: { type: ["string", "null"] },
          },
          // `query` is deliberately absent: it may be omitted when
          // `stagedResultsRef` carries a payload the producing tool already
          // stamped with its own query. Enforced in code (applyLogAppendOp),
          // which fails loudly when neither source supplies one.
          required: ["tool", "outcome", "resultsExamined"],
        },
      },
    },
    required: ["projectPath"],
  },
};

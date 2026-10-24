// timeline_build: a person's timeline built in code from the records linked to
// them (issue #3516, PR C2). Spec: docs/specs/timeline-build-tool-spec.md.
//
// Events come only from live person_evidence links, never from tree facts. Gaps
// are the four kinds timeline.md Step 4 names, with census years read from the
// census table in code (src/data/census-table.ts), never from the catalog.

import type { SimplifiedGedcomX, SimplifiedPerson } from "../types/gedcomx.js";
import type {
  TimelineBuildDeps,
  TimelineBuildInput,
  TimelineBuildResult,
} from "../types/timeline-build.js";
import { NoProjectError, noProjectResult, readProjectJson } from "../utils/project-io.js";
import { findAnchor, isAttachmentLink } from "../utils/tree-person.js";
import { stdDate } from "../utils/date-standardize.js";
import {
  earliestIsUnbounded,
  earliestYear,
  latestIsUnbounded,
  latestYear,
  parseStdDate,
  type ParsedDate,
} from "../utils/date-helpers.js";
import { lookupWithin } from "../utils/place-coords.js";
import { resolveStandardPlace, standardPlaceToCoords, type PlaceCoords } from "../utils/place-resolver.js";
import { normalizeFactType } from "../utils/record-extract.js";
import { relationshipCategory } from "../utils/relationship-category.js";
import { isIdentityConflict } from "../utils/question-state.js";
import {
  CENSUS_TABLE,
  countryHasRows,
  isCoveredPlace,
  rowsForInterval,
  segments,
  type CensusRow,
} from "../data/census-table.js";
import { haversineDistance } from "./distance.js";
import { getPersonName } from "./person-warnings.js";
import {
  researchAppend,
  timelineCensus1890Invariants,
  type ResearchAppendInput,
  type ResearchAppendResult,
} from "./research-append.js";

const RESEARCH_FILE = "research.json";
const TREE_FILE = "tree.gedcomx.json";
const DEFAULT_DEADLINE_MS = 50_000;
const CENSUS_YEARS = [...new Set(CENSUS_TABLE.map((r) => r.year))].sort((x, y) => x - y);

/** timeline.md Step 3's event types, in its order. */
const EVENT_TYPE_ORDER = [
  "birth", "baptism", "marriage", "death", "burial", "residence", "census",
  "military", "immigration", "emigration", "land_transaction", "probate", "other",
];

/** An assertion's normalized fact_type -> its event type. A fact_type absent
 *  here (name, sex, age, occupation, relationship, …) makes no event of its
 *  own: a dated one joins its record's same-dated event, else makes `other`. */
const EVENT_TYPE_OF: Record<string, string> = {
  birth: "birth",
  birth_registration: "birth",
  birth_date: "birth",
  birthplace: "birth",
  birth_place: "birth",
  christening: "baptism",
  baptism: "baptism",
  marriage: "marriage",
  death: "death",
  death_registration: "death",
  burial: "burial",
  residence: "residence",
  census_residence: "residence",
  census: "census",
  military: "military",
  military_service: "military",
  immigration: "immigration",
  emigration: "emigration",
  land: "land_transaction",
  land_transaction: "land_transaction",
  property: "land_transaction",
  probate: "probate",
  will: "probate",
};

/** A date as a span of years, for the gap rules: a census year is expected
 *  only when it falls strictly after every year the earlier event could be and
 *  before every year the later one could be. */
interface YearBounds {
  lo: number;
  hi: number;
  loOpen: boolean;
  hiOpen: boolean;
}

interface FormattedDate {
  date: string;
  certainty: "exact" | "approximate" | "estimated" | "calculated";
  note: string | null;
  bounds: YearBounds;
}

interface Built {
  key: string;
  record: string;
  party: string;
  type: string;
  date: FormattedDate;
  assertions: any[];
  place: string | null;
  standardPlace: string | null;
  conflictIds: string[];
  conflictNotes: string[];
}

const pad = (n: number) => String(n).padStart(2, "0");

function ymd(year: number, month: number | null, day: number | null): string {
  if (month === null) return String(year);
  if (day === null) return `${year}-${pad(month)}`;
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** One day, month or year before or after a parsed date, at its own precision. */
function shift(p: ParsedDate, by: 1 | -1): string {
  if (p.month !== null && p.day !== null) {
    const d = new Date(Date.UTC(p.year, p.month - 1, p.day + by));
    return ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  if (p.month !== null) {
    const m = p.month + by;
    if (m < 1) return ymd(p.year - 1, 12, null);
    if (m > 12) return ymd(p.year + 1, 1, null);
    return ymd(p.year, m, null);
  }
  return String(p.year + by);
}

function plain(p: ParsedDate): string {
  if (p.quarter !== null) return ymd(p.year, (p.quarter - 1) * 3 + 1, null);
  return ymd(p.year, p.month, p.day);
}

/** The year span a date allows, widened for an assertion's own certainty when
 *  the date string carries no modifier. */
function boundsOf(std: string, certainty: unknown): YearBounds | null {
  const lo = earliestYear(std);
  const hi = latestYear(std);
  if (lo === null || hi === null) return null;
  const b: YearBounds = { lo, hi, loOpen: earliestIsUnbounded(std), hiOpen: latestIsUnbounded(std) };
  if (/^(Abt|Cal|Est|Bef|Aft|Bet)\b/.test(std)) return b;
  if (certainty === "approximate") return { ...b, lo: lo - 1, hi: hi + 1 };
  if (certainty === "estimated") return { ...b, lo: lo - 10, hi: hi + 10 };
  if (certainty === "before") return { ...b, loOpen: true };
  if (certainty === "after") return { ...b, hiOpen: true };
  return b;
}

const CERTAINTY_FROM_ASSERTION: Record<string, FormattedDate["certainty"]> = {
  exact: "exact",
  approximate: "approximate",
  estimated: "estimated",
  calculated: "calculated",
  before: "estimated",
  after: "estimated",
  between: "estimated",
};

/** Year-first event date (timeline.md Step 3's forms), or null when undated. */
export function formatEventDate(raw: unknown, assertionCertainty: unknown): FormattedDate | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const std = stdDate(raw);
  if (std === "") return null;
  const parts = parseStdDate(std);
  const bounds = boundsOf(std, assertionCertainty);
  if (!parts || !bounds) return null;
  const stored = CERTAINTY_FROM_ASSERTION[String(assertionCertainty ?? "")] ?? "exact";

  if (parts.kind === "range") {
    return { date: `${parts.start.year}-${parts.end.year}`, certainty: "estimated", note: null, bounds };
  }
  if (parts.kind === "or") {
    const [first, second] =
      plain(parts.a) <= plain(parts.b) ? [parts.a, parts.b] : [parts.b, parts.a];
    return { date: plain(first), certainty: "estimated", note: `(or ${plain(second)})`, bounds };
  }
  const p = parts.date;
  switch (p.modifier) {
    case "Abt":
      return { date: `~${plain(p)}`, certainty: "approximate", note: null, bounds };
    case "Est":
      return { date: plain(p), certainty: "estimated", note: null, bounds };
    case "Cal":
      return { date: plain(p), certainty: "calculated", note: null, bounds };
    case "Bef":
      return { date: shift(p, -1), certainty: "estimated", note: `(before ${plain(p)})`, bounds };
    case "Aft":
      return { date: shift(p, 1), certainty: "estimated", note: `(after ${plain(p)})`, bounds };
  }
  const date = stored === "approximate" ? `~${plain(p)}` : plain(p);
  return { date, certainty: stored, note: null, bounds };
}

/** The key events sort by: the date string with a leading `~` ignored (the
 *  same comparison as the timeline suite's `_event_sort_key`). */
const sortKey = (date: string) => date.replace(/^[~<> \t]+/, "");

const typeRank = (t: string) => {
  const i = EVENT_TYPE_ORDER.indexOf(t);
  return i === -1 ? EVENT_TYPE_ORDER.length : i;
};

function partyOf(a: any): string {
  return String(a?.record_persona_id ?? a?.record_role ?? "");
}

function recordOf(a: any): string {
  return String(a?.record_id ?? a?.source_id ?? a?.id ?? "");
}

function eventTypeOf(a: any): string | null {
  return EVENT_TYPE_OF[normalizeFactType(a?.fact_type)] ?? null;
}

function segmentsOf(place: string): string[] {
  return place.split(",").map((s) => s.trim()).filter((s) => s !== "");
}

/** How an uncovered place is named as unchecked: its country, or, when the
 *  table covers that country somewhere, its first-level subdivision — and a
 *  place given only as such a country says so, since its census was checked
 *  wherever the records name a province or state. */
function uncheckedName(standardPlace: string): string {
  const segs = segmentsOf(standardPlace);
  const country = segs[segs.length - 1] ?? standardPlace;
  if (!countryHasRows(country)) return country;
  if (segs.length >= 2) return `${segs[segs.length - 2]}, ${country}`;
  return `places given only as ${country}`;
}

function isMale(person: SimplifiedPerson): boolean {
  return String(person.gender ?? "").replace(/^.*[/#]/, "").toLowerCase() === "male";
}

function quoteValue(a: any): string {
  const v = a?.value ?? a?.date ?? a?.place ?? "";
  return typeof v === "string" ? v : JSON.stringify(v);
}

function describe(e: Built, unverifiedPrefix: string | null): string {
  const parts: string[] = [];
  const seen = new Set<string>();
  for (const a of e.assertions) {
    const text = `${a.fact_type}: ${quoteValue(a)}`;
    if (!seen.has(text)) {
      seen.add(text);
      parts.push(text);
    }
  }
  const recorded = e.assertions.find((a) => typeof a.date === "string" && a.date.trim() !== "")?.date;
  let body = `${e.type[0].toUpperCase()}${e.type.slice(1).replace(/_/g, " ")}`;
  if (parts.length) body += ` — ${parts.join("; ")}`;
  if (recorded && recorded.trim() !== e.date.date) body += ` (recorded as ${recorded.trim()})`;
  if (e.date.note) body += ` ${e.date.note}`;
  return unverifiedPrefix ? `${unverifiedPrefix} ${body}` : body;
}

/** The anchor's person timelines, newest first. */
function personTimelines(research: any, persons: SimplifiedPerson[], anchorId: string): any[] {
  const timelines: any[] = Array.isArray(research?.timelines) ? research.timelines : [];
  return timelines
    .filter((t) => isPersonTimeline(t, persons, anchorId))
    .sort((x, y) => String(y.generated ?? "").localeCompare(String(x.generated ?? "")));
}

/** A person's own timeline: no hypothesis, and exactly one person who resolves
 *  to the anchor. A stale id is not this person, never a crash. */
function isPersonTimeline(t: any, persons: SimplifiedPerson[], anchorId: string): boolean {
  if (t?.hypothesis_id != null) return false;
  if (!Array.isArray(t?.person_ids) || t.person_ids.length !== 1) return false;
  try {
    return findAnchor(persons, String(t.person_ids[0])).id === anchorId;
  } catch {
    return false;
  }
}

export interface TimelinePlan {
  events: any[];
  gaps: GapOut[];
  unverifiedEvents: number;
  /** Places, or countries, for which no census was checked. */
  unchecked: string[];
  /** The checks the Places deadline cut short. */
  skipped: string[];
}

/** One person's events, places, conflict marks and gaps, from documents already
 *  read. Null when nothing linked to the person dates an event. Reads and writes
 *  no file; its only I/O is the Places lookups in `deps`. */
export async function planTimeline(
  research: any,
  anchor: SimplifiedPerson,
  deps: TimelineBuildDeps = {},
): Promise<TimelinePlan | null> {
  const deadline = Date.now() + (deps.deadlineMs ?? DEFAULT_DEADLINE_MS);
  const remaining = () => Math.max(0, deadline - Date.now());
  const resolvePlace = deps.resolvePlace ?? ((text: string) => resolveStandardPlace(text));
  const placeCoords = deps.placeCoords ?? ((sp: string) => standardPlaceToCoords(sp));
  const anchorId = String(anchor.id);

  const links = (Array.isArray(research.person_evidence) ? research.person_evidence : []).filter(
    (pe: any) => pe?.person_id === anchorId && pe?.superseded_by == null,
  );
  const assertionsById = new Map<string, any>();
  for (const a of Array.isArray(research.assertions) ? research.assertions : []) {
    if (a && typeof a.id === "string") assertionsById.set(a.id, a);
  }
  const linksByAssertion = new Map<string, any[]>();
  for (const pe of links) {
    if (!assertionsById.has(pe.assertion_id)) continue;
    linksByAssertion.set(pe.assertion_id, [...(linksByAssertion.get(pe.assertion_id) ?? []), pe]);
  }
  if (linksByAssertion.size === 0) return null;

  // Conflicts. A resolved conflict with a winner drops its losers; every other
  // conflict that is not moot marks the events it touches.
  const conflicts: any[] = Array.isArray(research.conflicts) ? research.conflicts : [];
  const dropped = new Set<string>();
  const winners: any[] = [];
  const open: any[] = [];
  for (const c of conflicts) {
    if (!c || c.status === "moot") continue;
    const competing: string[] = Array.isArray(c.competing_assertion_ids) ? c.competing_assertion_ids : [];
    const hasWinner =
      c.status === "resolved" &&
      (c.resolution_kind === "competitor" || (c.resolution_kind == null && c.preferred_assertion_id != null));
    if (hasWinner) {
      for (const id of competing) if (id !== c.preferred_assertion_id) dropped.add(id);
      winners.push(c);
    } else {
      open.push(c);
    }
  }

  // Events: one per record, party, event type and date.
  const events = new Map<string, Built>();
  const pendingJoin: Array<{ a: any; date: FormattedDate | null; type: string | null }> = [];
  for (const id of linksByAssertion.keys()) {
    if (dropped.has(id)) continue;
    const a = assertionsById.get(id);
    const date = formatEventDate(a.date, a.date_certainty);
    const type = eventTypeOf(a);
    if (date && type) {
      const key = JSON.stringify([recordOf(a), partyOf(a), type, date.date]);
      const e = events.get(key);
      if (e) e.assertions.push(a);
      else {
        events.set(key, {
          key, record: recordOf(a), party: partyOf(a), type, date, assertions: [a],
          place: null, standardPlace: null, conflictIds: [], conflictNotes: [],
        });
      }
    } else if (date || type) {
      pendingJoin.push({ a, date, type });
    }
  }
  for (const { a, date, type } of pendingJoin) {
    const sameParty = [...events.values()].filter((e) => e.record === recordOf(a) && e.party === partyOf(a));
    if (date) {
      const target = sameParty
        .filter((e) => e.date.date === date.date)
        .sort((x, y) => typeRank(x.type) - typeRank(y.type))[0];
      if (target) target.assertions.push(a);
      else {
        const key = JSON.stringify([recordOf(a), partyOf(a), "other", date.date]);
        const e = events.get(key);
        if (e) e.assertions.push(a);
        else {
          events.set(key, {
            key, record: recordOf(a), party: partyOf(a), type: "other", date, assertions: [a],
            place: null, standardPlace: null, conflictIds: [], conflictNotes: [],
          });
        }
      }
    } else {
      const target = sameParty
        .filter((e) => e.type === type)
        .sort((x, y) => sortKey(x.date.date).localeCompare(sortKey(y.date.date)))[0];
      if (target) target.assertions.push(a);
    }
  }
  if (events.size === 0) return null;

  // Places: copied from the assertions, else resolved from their place text;
  // coordinates for every standard place. One deadline covers both legs.
  for (const e of events.values()) {
    e.place = e.assertions.find((a) => typeof a.place === "string" && a.place.trim())?.place ?? null;
    e.standardPlace =
      e.assertions.find((a) => typeof a.standard_place === "string" && a.standard_place.trim())?.standard_place ?? null;
  }
  const known = [...new Set([...events.values()].map((e) => e.standardPlace).filter((p): p is string => !!p))];
  const rawToResolve = [
    ...new Set([...events.values()].filter((e) => !e.standardPlace && e.place).map((e) => e.place as string)),
  ];
  let resolveExpired = false;
  let coordsExpired = false;
  const [knownCoords, resolved] = await Promise.all([
    lookupWithin(known, placeCoords, remaining(), () => (coordsExpired = true)),
    lookupWithin(rawToResolve, resolvePlace, remaining(), () => (resolveExpired = true)),
  ]);
  for (const e of events.values()) {
    if (!e.standardPlace && e.place) e.standardPlace = resolved.get(e.place) ?? null;
  }
  const newlyStandard = [...new Set([...resolved.values()].filter((p): p is string => !!p && !knownCoords.has(p)))];
  const moreCoords = await lookupWithin(newlyStandard, placeCoords, remaining(), () => (coordsExpired = true));
  const coords = new Map<string, PlaceCoords | null>([...knownCoords, ...moreCoords]);
  const skipped: string[] = [];
  if (resolveExpired) skipped.push("standardizing some places");
  if (coordsExpired) skipped.push("some distances");

  const sorted = [...events.values()].sort(
    (x, y) => sortKey(x.date.date).localeCompare(sortKey(y.date.date)) || typeRank(x.type) - typeRank(y.type),
  );

  // Conflict marks.
  const eventsCiting = (ids: Set<string>) => sorted.filter((e) => e.assertions.some((a) => ids.has(a.id)));
  for (const c of winners) {
    const kept = eventsCiting(new Set([c.preferred_assertion_id]));
    const losers = (c.competing_assertion_ids ?? []).filter((id: string) => id !== c.preferred_assertion_id);
    for (const e of kept) {
      e.conflictIds.push(c.id);
      e.conflictNotes.push(`${c.id} resolved: kept ${c.preferred_assertion_id} over ${losers.join(", ")}.`);
    }
  }
  for (const c of open) {
    const competing: string[] = Array.isArray(c.competing_assertion_ids) ? c.competing_assertion_ids : [];
    const marked = new Set<Built>(eventsCiting(new Set(competing)));
    for (const id of competing) {
      if (sorted.some((e) => e.assertions.some((a) => a.id === id))) continue;
      const a = assertionsById.get(id);
      if (!a) continue;
      for (const e of sorted) {
        if (e.assertions.some((x) => recordOf(x) === recordOf(a) && x.record_role === a.record_role)) marked.add(e);
      }
    }
    let note: string;
    if (isIdentityConflict(c)) {
      note = `${c.id} (identity): ${String(c.identity_question).trim()}`;
    } else {
      const named = competing
        .map((id) => assertionsById.get(id))
        .filter(Boolean)
        .map((a) => `${a.id} "${quoteValue(a)}"`)
        .join(" vs ");
      note = `${c.id}: ${named || "competing assertions disagree"}.`;
    }
    if (c.status === "resolved") {
      const quoted = c.resolved_value ?? c.resolution_rationale;
      if (quoted) note += ` Resolved without a winner: "${typeof quoted === "string" ? quoted : JSON.stringify(quoted)}".`;
    }
    for (const e of marked) {
      e.conflictIds.push(c.id);
      e.conflictNotes.push(note);
    }
  }

  const gaps = buildGaps(sorted, anchor, research, assertionsById, linksByAssertion);
  const unverified = sorted.filter((e) =>
    e.assertions.every((a) => (linksByAssertion.get(a.id) ?? []).every((pe) => pe.confidence === "speculative")),
  );
  const unverifiedSet = new Set(unverified);

  const timelineEvents = sorted.map((e, i) => {
    const prev = i > 0 ? sorted[i - 1] : null;
    let distance: number | null = null;
    if (prev?.standardPlace && e.standardPlace) {
      if (prev.standardPlace === e.standardPlace) distance = 0;
      else {
        const a = coords.get(prev.standardPlace);
        const b = coords.get(e.standardPlace);
        if (a && b) distance = Math.round(haversineDistance(a.latitude, a.longitude, b.latitude, b.longitude).kilometers);
      }
    }
    let prefix: string | null = null;
    if (unverifiedSet.has(e)) {
      const allAttachment = e.assertions.every((a) => (linksByAssertion.get(a.id) ?? []).every(isAttachmentLink));
      prefix = allAttachment ? "Unverified attachment:" : "Unverified:";
    }
    return {
      date: e.date.date,
      date_certainty: e.date.certainty,
      event_type: e.type,
      place: e.place,
      standard_place: e.standardPlace,
      description: describe(e, prefix),
      assertion_ids: e.assertions.map((a) => a.id),
      distance_from_previous_km: distance,
      conflict_ids: e.conflictIds.length ? [...new Set(e.conflictIds)] : null,
      conflict_note: e.conflictNotes.length ? [...new Set(e.conflictNotes)].join(" | ") : null,
    };
  });

  // The 1890 check: an expected census entry the writer would refuse is dropped
  // here, so one entry never refuses the whole timeline.
  const keptGaps: any[] = [];
  for (const gap of gaps) {
    const kept: string[] = [];
    const refused: string[] = [];
    for (const entry of gap.expected_events) {
      const errs = timelineCensus1890Invariants({ events: timelineEvents, gaps: [{ ...gap, expected_events: [entry] }] });
      (errs.length ? refused : kept).push(entry);
    }
    if (kept.length === 0) continue;
    keptGaps.push({
      ...gap,
      expected_events: kept,
      notes: refused.length
        ? [gap.notes, `Dropped ${refused.join(", ")}: that census does not survive.`].filter(Boolean).join(" ")
        : gap.notes,
    });
  }

  const unchecked = new Set<string>();
  for (const e of sorted) {
    if (e.standardPlace && !isCoveredPlace(e.standardPlace)) unchecked.add(uncheckedName(e.standardPlace));
    if (!e.standardPlace && e.place) unchecked.add(e.place);
  }

  return {
    events: timelineEvents,
    gaps: keptGaps,
    unverifiedEvents: unverified.length,
    unchecked: [...unchecked],
    skipped,
  };
}

const NOTHING_LINKED = "No record yet places this person; no timeline was written.";

export async function timelineBuild(
  input: TimelineBuildInput,
  deps: TimelineBuildDeps = {},
): Promise<TimelineBuildResult> {
  const now = deps.now ?? (() => new Date());
  let research: any;
  let tree: SimplifiedGedcomX;
  try {
    research = await readProjectJson(input?.projectPath as string, RESEARCH_FILE);
    tree = (await readProjectJson(input.projectPath, TREE_FILE)) as SimplifiedGedcomX;
  } catch (e) {
    if (e instanceof NoProjectError) return noProjectResult("write");
    return { ok: false, errors: [e instanceof Error ? e.message : String(e)] };
  }
  const personId = typeof input.personId === "string" ? input.personId.trim() : "";
  if (!personId) return { ok: false, errors: ["personId must be a tree person id or a FamilySearch id."] };
  const persons = tree.persons ?? [];
  let anchor: SimplifiedPerson;
  try {
    anchor = findAnchor(persons, personId);
  } catch (e) {
    return { ok: false, errors: [e instanceof Error ? e.message : String(e)] };
  }
  const anchorId = String(anchor.id);

  const plan = await planTimeline(research, anchor, deps);
  if (!plan) return { ok: true, status: "no_linked_evidence", summary: NOTHING_LINKED };
  const { events: timelineEvents, gaps: keptGaps, unverifiedEvents, unchecked, skipped } = plan;

  // Write: append the person's timeline, or update the newest one in place,
  // keeping its person_ids. The choice is re-checked under the writer's lock; a
  // person timeline written or restamped meanwhile sends it round again.
  const label = `${getPersonName(anchor)} — person timeline`;
  const content = { label, events: timelineEvents, gaps: keptGaps };
  const shape = (r: any) => personTimelines(r, persons, anchorId).map((t) => `${t.id}@${t.generated ?? ""}`).join(",");
  let mine: any[] = [];
  let write: ResearchAppendResult = { ok: false, errors: [] };
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      try {
        research = await readProjectJson(input.projectPath, RESEARCH_FILE);
      } catch (e) {
        return { ok: false, errors: [e instanceof Error ? e.message : String(e)] };
      }
    }
    mine = personTimelines(research, persons, anchorId);
    const decided = shape(research);
    let stale = false;
    const opts = {
      allowedSections: new Set(["timelines"]),
      toolName: "timeline_build",
      precondition: (r: any) => {
        if (shape(r) === decided) return null;
        stale = true;
        return "Another run changed this person's timeline while this one was being built; it was not written.";
      },
    };
    write = mine.length
      ? await researchAppend(
          {
            projectPath: input.projectPath,
            section: "timelines",
            op: "update",
            entryId: mine[0].id,
            fields: { ...content, generated: now().toISOString().replace(/\.\d{3}Z$/, "Z") },
          } as ResearchAppendInput,
          opts,
        )
      : await researchAppend(
          {
            projectPath: input.projectPath,
            section: "timelines",
            op: "append",
            entry: { ...content, person_ids: [anchorId] },
          } as ResearchAppendInput,
          opts,
        );
    if (!stale) break;
  }
  if (!write.ok) return { ok: false, errors: write.errors };
  const timelineId = "entryId" in write ? write.entryId : String(mine[0]?.id ?? "");

  const severity = { high: 0, medium: 0, low: 0 };
  for (const g of keptGaps) severity[g.severity as "high" | "medium" | "low"] += 1;
  const sentences = [
    `${timelineEvents.length} event${timelineEvents.length === 1 ? "" : "s"} from linked records` +
      (unverifiedEvents ? `, ${unverifiedEvents} from records nobody has checked` : "") +
      `, and ${severity.high} high-priority gap${severity.high === 1 ? "" : "s"}.`,
  ];
  if (unverifiedEvents) sentences.push("Checking the attached records is a separate request.");
  sentences.push("Census years expected are those FamilySearch has indexed.");
  if (unchecked.length) sentences.push(`No census was checked for ${unchecked.join("; ")}.`);
  if (mine.length > 1) {
    sentences.push(`Other timelines for this person were left as they are: ${mine.slice(1).map((t) => t.id).join(", ")}.`);
  }
  if (skipped.length) sentences.push(`Places lookups ran out of time; skipped ${skipped.join(" and ")}.`);

  return {
    ok: true,
    status: mine.length ? "updated" : "written",
    timelineId,
    events: timelineEvents.length,
    unverifiedEvents,
    gaps: severity,
    summary: sentences.join(" "),
  };
}

interface GapOut {
  start: string;
  end: string;
  expected_events: string[];
  severity: "high" | "medium" | "low";
  notes: string | null;
}

function buildGaps(
  sorted: Built[],
  person: SimplifiedPerson,
  research: any,
  assertionsById: Map<string, any>,
  linksByAssertion: Map<string, any[]>,
): GapOut[] {
  const gaps: GapOut[] = [];
  // A burial ends the span as a death does.
  const deathIdx = sorted.findIndex((e) => e.type === "death" || e.type === "burial");
  const beforeDeath = (i: number) => deathIdx === -1 || i < deathIdx;
  // Census years stop at the earliest year the death allows. A death open on
  // its earlier side ("before 1880") allows any earlier year, so they stop at
  // the latest year the events before it allow.
  const deathBounds = deathIdx === -1 ? null : sorted[deathIdx].date.bounds;
  const deathLo =
    deathBounds === null
      ? null
      : deathBounds.loOpen
        ? Math.max(-Infinity, ...sorted.slice(0, deathIdx).map((e) => e.date.bounds.hi))
        : deathBounds.lo;

  // Census.
  const births = sorted.filter((e) => e.type === "birth");
  // Heads-only schedules: the latest year any linked birth allows, so a man is
  // expected only when he must have been 21. A birth open on its later side
  // allows no latest year.
  const latestBirth =
    births.length && births.every((b) => !b.date.bounds.hiOpen) ? Math.max(...births.map((b) => b.date.bounds.hi)) : null;
  // A heads-only schedule names only household heads, and a man of 21 was often
  // not yet one; he is expected only once a linked marriage has certainly taken
  // place before the census year (lead, 2026-10-23).
  const marriedBefore = (year: number) =>
    sorted.some((e) => e.type === "marriage" && !e.date.bounds.hiOpen && e.date.bounds.hi < year);
  const inHand = (year: number) =>
    sorted.some((e) => e.date.bounds.lo === year && e.date.bounds.hi === year);
  const placed = sorted.map((e, i) => ({ e, i })).filter(({ e }) => e.standardPlace);
  const censusGaps: Array<GapOut & { from: number; to: number }> = [];
  for (let k = 0; k + 1 < placed.length; k++) {
    const A = placed[k];
    const B = placed[k + 1];
    if (!beforeDeath(A.i)) break;
    const a = A.e.date.bounds;
    const b = B.e.date.bounds;
    if (a.hiOpen || b.loOpen) continue;
    const years = CENSUS_YEARS.filter((y) => y > a.hi && y < b.lo && (deathLo === null || y < deathLo));
    const entries: string[] = [];
    for (const year of years) {
      if (inHand(year)) continue;
      let rows = rowsForInterval(A.e.standardPlace!, B.e.standardPlace!, year);
      rows = rows.filter(
        (r) =>
          !r.headsOnly ||
          (isMale(person) && latestBirth !== null && year - latestBirth >= 21 && marriedBefore(year)),
      );
      if (rows.length === 0) continue;
      entries.push(`${year} ${labelFor(rows, A.e.standardPlace!)} census`);
    }
    if (entries.length) {
      censusGaps.push({
        start: A.e.date.date, end: B.e.date.date, expected_events: entries, severity: "high", notes: null,
        from: A.i, to: B.i,
      });
    }
  }

  // Twenty or more years between consecutive events; folded into a census gap
  // whose bounding events contain both.
  const longGaps: GapOut[] = [];
  for (let i = 0; i + 1 < sorted.length; i++) {
    if (!beforeDeath(i)) break;
    const a = sorted[i].date.bounds;
    const b = sorted[i + 1].date.bounds;
    if (a.hiOpen || b.loOpen || b.lo - a.hi < 20) continue;
    const host = censusGaps.find((g) => g.from <= i && i + 1 <= g.to);
    if (host) {
      if (!host.expected_events.includes("residence")) host.expected_events.push("residence");
    } else {
      longGaps.push({
        start: sorted[i].date.date, end: sorted[i + 1].date.date, expected_events: ["residence"],
        severity: "high", notes: null,
      });
    }
  }
  for (const { from: _f, to: _t, ...g } of censusGaps) gaps.push(g);
  gaps.push(...longGaps);

  // An undated linked assertion makes no event, but its record is still in hand.
  const linked = [...linksByAssertion.keys()].map((id) => assertionsById.get(id));
  const linkedType = (t: string) => linked.some((a) => eventTypeOf(a) === t);
  const undatedMarriage = linked.some((a) => eventTypeOf(a) === "marriage" && !formatEventDate(a.date, a.date_certainty));

  // Marriage before the first child's birth.
  const marriage = marriageGap(sorted, research, assertionsById, linksByAssertion, beforeDeath, undatedMarriage);
  if (marriage) gaps.push(marriage);

  // Death without burial, or burial without death.
  const death = sorted.find((e) => e.type === "death");
  const burial = sorted.find((e) => e.type === "burial");
  if (death && !linkedType("burial")) {
    gaps.push({ start: death.date.date, end: death.date.date, expected_events: ["burial"], severity: "medium", notes: null });
  } else if (burial && !linkedType("death")) {
    gaps.push({ start: burial.date.date, end: burial.date.date, expected_events: ["death"], severity: "medium", notes: null });
  }

  return gaps.sort((x, y) => sortKey(x.start).localeCompare(sortKey(y.start)));
}

/** The national row's label when a national and a state row both cover the
 *  year; otherwise the first row's. */
function labelFor(rows: CensusRow[], place: string): string {
  const country = segments(place).pop();
  return (rows.find((r) => r.label.toLowerCase() === country) ?? rows[0]).label;
}

function marriageGap(
  sorted: Built[],
  research: any,
  assertionsById: Map<string, any>,
  linksByAssertion: Map<string, any[]>,
  beforeDeath: (i: number) => boolean,
  undatedMarriage: boolean,
): GapOut | null {
  // An undated linked marriage can precede any child.
  if (undatedMarriage) return null;
  const all: any[] = Array.isArray(research.assertions) ? research.assertions : [];
  // The person's own role(s) in each linked record.
  const rolesByRecord = new Map<string, Set<string>>();
  for (const id of linksByAssertion.keys()) {
    const a = assertionsById.get(id);
    if (!a?.record_role) continue;
    const rec = recordOf(a);
    rolesByRecord.set(rec, new Set([...(rolesByRecord.get(rec) ?? []), String(a.record_role)]));
  }
  let first: { lo: number; hi: number; record: string } | null = null;
  for (const [rec, roles] of rolesByRecord) {
    const childParties = new Set<string>();
    for (const a of all) {
      if (recordOf(a) !== rec || normalizeFactType(a.fact_type) !== "relationship") continue;
      const sv = a.structured_value;
      const type = sv?.relationship_type;
      if (typeof type !== "string" || /_inferred$/i.test(type.trim())) continue;
      if (relationshipCategory(type) !== "child") continue;
      if (!roles.has(String(sv.related_person_role ?? ""))) continue;
      if (roles.has(String(a.record_role ?? ""))) continue;
      childParties.add(partyOf(a));
    }
    for (const a of all) {
      if (recordOf(a) !== rec || !childParties.has(partyOf(a)) || eventTypeOf(a) !== "birth") continue;
      const std = typeof a.date === "string" ? stdDate(a.date) : "";
      const lo = std ? earliestYear(std) : null;
      const hi = std ? latestYear(std) : null;
      if (lo === null || hi === null) continue;
      if (!first || lo < first.lo) first = { lo, hi, record: rec };
    }
  }
  if (!first) return null;
  const marriages = sorted.filter((e) => e.type === "marriage");
  if (marriages.some((m) => m.date.bounds.lo <= first!.hi)) return null;
  // The record's first event that can follow the child's birth: in a census,
  // the person's own age-derived birth comes earlier and would reverse the gap.
  const recordEvents = sorted
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => e.record === first!.record && e.date.bounds.hi >= first!.lo);
  if (recordEvents.length === 0) return null;
  const endIdx = recordEvents[0].i;
  let startIdx = -1;
  for (let i = 0; i < sorted.length; i++) if (sorted[i].date.bounds.hi < first.lo) startIdx = i;
  const from = startIdx === -1 ? endIdx : startIdx;
  if (!beforeDeath(from)) return null;
  return {
    start: sorted[from].date.date,
    end: sorted[endIdx].date.date,
    expected_events: ["marriage"],
    severity: "high",
    notes: null,
  };
}

export const timelineBuildSchema = {
  name: "timeline_build",
  description:
    "Build or refresh a person's timeline in code from the records linked to them in person_evidence " +
    "(never from tree facts), with gaps for missing census years, a missing marriage, long silences and " +
    "a death without a burial, and write it to research.json timelines. Census years come from a table of " +
    "the censuses FamilySearch indexes. Returns status no_linked_evidence when nothing is linked to the person.",
  inputSchema: {
    type: "object" as const,
    properties: {
      projectPath: {
        type: "string",
        description: "Absolute path to the project directory holding research.json and tree.gedcomx.json.",
      },
      personId: {
        type: "string",
        description: "The person: a tree person id or the FamilySearch id a tree person links to.",
      },
    },
    required: ["projectPath", "personId"],
  },
};

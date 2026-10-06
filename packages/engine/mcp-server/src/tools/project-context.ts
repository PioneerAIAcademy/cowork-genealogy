// project_context — compact read-only projection of the project state.
//
// The read-side companion of the structured writers (research_append,
// tree_edit): where those removed "re-serialize large JSON to write," this
// removes "re-read large JSON to think." One call returns the judgment-
// relevant projection of research.json + tree.gedcomx.json — open questions,
// tree persons with their cited S ids, sources with their record ids — so a
// fresh-context agent (the record-extractor) never opens either file.
// Spec: docs/specs/project-context-tool-spec.md.

import { questionStates, type QuestionStatus } from "../utils/question-state.js";
import { readProjectJson, NoProjectError, noProjectResult } from "../utils/project-io.js";
import { readBuildInfo } from "../utils/build-info.js";
import { preferredName } from "../utils/name-helpers.js";

const QUESTION_TRUNCATE_AT = 140;

export interface ProjectContextInput {
  projectPath: string;
}

export interface ProjectContextQuestion {
  id: string;
  question: string;
}

export interface ProjectContextPerson {
  id: string;
  name: string | null;
  gender: string | null;
  sourceRefs: string[];
  spouseIds: string[];
  parentIds: string[];
  childIds: string[];
  died: boolean;
}

export interface ProjectContextSource {
  id: string;
  repository: string | null;
  gedcomxSourceDescriptionId: string | null;
  recordIds: string[];
  assertionCount: number;
}

export interface ProjectContextLocality {
  id: string;
  place: string;
  forPlace: string | null;
  timePeriod: string | null;
  jurisdictions: { name: string; dateRange: string | null }[];
  collections: { id: string; title: string; dateRange: string | null }[];
  quirks: string[];
  /** Wiki sections actually fetched (pages_read with found:true) — read-coverage. */
  pagesRead: string[];
}

/** An external-site URL handed to the user and not yet answered (spec §2.3). */
export interface ProjectContextAwaitingUser {
  logId: string;
  site: string;
  urlGenerated: string;
  planItemId: string | null;
  performed: string | null;
}

export type ProjectContextResult =
  | {
      ok: true;
      /** The engine build (`<base>+<date>.<sha>[.dirty]` or `<base>+dev`) — on every branch, #2126. */
      buildId: string;
      projectStatus: string | null;
      /** research.project.objective verbatim; null when absent. No other tool returns it (#3026). */
      objective: string | null;
      openQuestions: ProjectContextQuestion[];
      /** Advisory per-question state and next step. Nothing gates on it. */
      questionStatuses: QuestionStatus[];
      persons: ProjectContextPerson[];
      sources: ProjectContextSource[];
      localities: ProjectContextLocality[];
      /** Open external-site hand-offs: the user was sent a URL and nothing has come back. */
      awaitingUser: ProjectContextAwaitingUser[];
    }
  // `reason: "no_project"` marks the one ok:false that is an answer rather than
  // a failure (see noProjectResult). Optional field on the existing arm, NOT a
  // third arm — every `if (!r.ok) r.errors…` keeps narrowing as it does today.
  | { ok: false; errors: string[]; reason?: "no_project"; buildId: string };

function truncateQuestion(text: string): string {
  if (text.length <= QUESTION_TRUNCATE_AT) return text;
  return `${text.slice(0, QUESTION_TRUNCATE_AT - 1)}…`;
}

/** Preferred names entry (first entry when none is flagged) as "given surname". */
function preferredDisplayName(person: any): string | null {
  const names = Array.isArray(person?.names) ? person.names.filter((n: any) => n && typeof n === "object") : [];
  const preferred = preferredName(names);
  if (preferred === undefined) return null;
  const parts = [preferred.given, preferred.surname].filter(
    (p: unknown): p is string => typeof p === "string" && p.trim() !== "",
  );
  return parts.length > 0 ? parts.join(" ") : null;
}

/** Distinct S ids cited anywhere on the person — person-level `sources`,
 *  each fact's `sources`, each name's `sources` — in first-seen order. */
function collectSourceRefs(person: any): string[] {
  const refs: string[] = [];
  const take = (sources: unknown): void => {
    if (!Array.isArray(sources)) return;
    for (const s of sources) {
      const ref = s && typeof s === "object" ? (s as any).ref : undefined;
      if (typeof ref === "string" && ref !== "" && !refs.includes(ref)) refs.push(ref);
    }
  };
  take(person?.sources);
  for (const f of Array.isArray(person?.facts) ? person.facts : []) take(f?.sources);
  for (const n of Array.isArray(person?.names) ? person.names : []) take(n?.sources);
  return refs;
}

function externalSiteOf(entry: any): any | null {
  if (!entry || typeof entry !== "object" || entry.tool !== "external_site") return null;
  const ext = entry.external_site;
  return ext && typeof ext === "object" && typeof ext.url_generated === "string" ? ext : null;
}

/**
 * Whether a later log entry ends the hand-off at `url` (spec §2.3): any entry
 * for the same URL whose outcome is not `partial`, whether or not a capture
 * came back. "I have no access" is logged as `error` with no capture, and after
 * it the user is not holding a link from us.
 */
function closesHandOff(entry: any, url: string): boolean {
  const ext = externalSiteOf(entry);
  return ext !== null && ext.url_generated === url && entry.outcome !== "partial";
}

/**
 * Every in-flight hand-off still waiting on the user: an `external_site` entry
 * with `outcome: "partial"` and `capture_received: false` that no LATER entry
 * closes. Keyed on `partial`, not on `capture_received` alone: a `positive`
 * entry logged with `capture_received: false` already had its results in hand
 * (alpha feedback #2864, `log_012`/`log_013`) and is not waiting on anyone.
 */
function awaitingUserHandOffs(log: unknown): ProjectContextAwaitingUser[] {
  const entries: any[] = Array.isArray(log) ? log : [];
  const open: ProjectContextAwaitingUser[] = [];
  entries.forEach((entry, i) => {
    const ext = externalSiteOf(entry);
    if (ext === null || entry.outcome !== "partial" || ext.capture_received !== false) return;
    if (typeof entry.id !== "string") return;
    if (entries.slice(i + 1).some((later) => closesHandOff(later, ext.url_generated))) return;
    open.push({
      logId: entry.id,
      site: typeof ext.site === "string" ? ext.site : "",
      urlGenerated: ext.url_generated,
      planItemId: typeof entry.plan_item_id === "string" ? entry.plan_item_id : null,
      performed: typeof entry.performed === "string" ? entry.performed : null,
    });
  });
  return open;
}

export async function projectContext(input: ProjectContextInput): Promise<ProjectContextResult> {
  // Primary surface for "which build is this?" — 8 skills call project_context,
  // 0 call auth_status — so it rides on every return branch, no-project included.
  const buildId = readBuildInfo().version;
  let research: any;
  let tree: any;
  try {
    research = await readProjectJson(input.projectPath, "research.json");
    tree = await readProjectJson(input.projectPath, "tree.gedcomx.json");
  } catch (e) {
    // The other READ issue #1695 calls out: a skill that looks at project state
    // before answering must not surface a path error to a user who simply is
    // not in a project.
    if (e instanceof NoProjectError) return { ...noProjectResult("read"), buildId };
    return { ok: false, errors: [e instanceof Error ? e.message : String(e)], buildId };
  }

  // Open questions: everything not yet resolved (open / in_progress /
  // exhaustive_declared), in array order. Text truncated — the id is the
  // handle; the text is a reminder, not the record.
  const openQuestions: ProjectContextQuestion[] = [];
  for (const q of Array.isArray(research?.questions) ? research.questions : []) {
    if (!q || typeof q !== "object" || typeof q.id !== "string") continue;
    if (q.status === "resolved" || q.status === "superseded") continue;
    openQuestions.push({ id: q.id, question: truncateQuestion(typeof q.question === "string" ? q.question : "") });
  }

  const family = familyIndex(tree);
  const persons: ProjectContextPerson[] = [];
  for (const p of Array.isArray(tree?.persons) ? tree.persons : []) {
    if (!p || typeof p !== "object" || typeof p.id !== "string") continue;
    const f = family.get(p.id);
    persons.push({
      id: p.id,
      name: preferredDisplayName(p),
      gender: typeof p.gender === "string" ? p.gender : null,
      sourceRefs: collectSourceRefs(p),
      spouseIds: f ? [...f.spouseIds] : [],
      parentIds: f ? [...f.parentIds] : [],
      childIds: f ? [...f.childIds] : [],
      died: hasDeathFact(p),
    });
  }

  // Per-source assertion rollup: distinct record_id values (verbatim,
  // first-seen order) + assertion count.
  const bySource = new Map<string, { recordIds: string[]; count: number }>();
  for (const a of Array.isArray(research?.assertions) ? research.assertions : []) {
    if (!a || typeof a !== "object" || typeof a.source_id !== "string") continue;
    let bucket = bySource.get(a.source_id);
    if (!bucket) {
      bucket = { recordIds: [], count: 0 };
      bySource.set(a.source_id, bucket);
    }
    bucket.count += 1;
    if (typeof a.record_id === "string" && a.record_id !== "" && !bucket.recordIds.includes(a.record_id)) {
      bucket.recordIds.push(a.record_id);
    }
  }
  const sources: ProjectContextSource[] = [];
  for (const s of Array.isArray(research?.sources) ? research.sources : []) {
    if (!s || typeof s !== "object" || typeof s.id !== "string") continue;
    const bucket = bySource.get(s.id);
    sources.push({
      id: s.id,
      repository: typeof s.repository === "string" ? s.repository : null,
      gedcomxSourceDescriptionId:
        typeof s.gedcomx_source_description_id === "string" ? s.gedcomx_source_description_id : null,
      recordIds: bucket ? bucket.recordIds : [],
      assertionCount: bucket ? bucket.count : 0,
    });
  }

  // Localities: compact place/locale projection for research-plan — the
  // actionable bits (jurisdictions, collections, quirks) + read-coverage.
  // guide_markdown is omitted (large prose); read research.json for the full text.
  const localities: ProjectContextLocality[] = [];
  for (const l of Array.isArray(research?.localities) ? research.localities : []) {
    if (!l || typeof l !== "object" || typeof l.id !== "string") continue;
    const jurisdictions = (Array.isArray(l.jurisdictions) ? l.jurisdictions : [])
      .filter((j: any) => j && typeof j === "object" && typeof j.name === "string")
      .map((j: any) => ({ name: j.name, dateRange: typeof j.date_range === "string" ? j.date_range : null }));
    const collections = (Array.isArray(l.collections) ? l.collections : [])
      .filter((c: any) => c && typeof c === "object" && typeof c.id === "string")
      .map((c: any) => ({
        id: c.id,
        title: typeof c.title === "string" ? c.title : "",
        dateRange: typeof c.date_range === "string" ? c.date_range : null,
      }));
    const quirks = (Array.isArray(l.quirks) ? l.quirks : []).filter(
      (q: any): q is string => typeof q === "string",
    );
    const pagesRead = (Array.isArray(l.pages_read) ? l.pages_read : [])
      .filter((p: any) => p && typeof p === "object" && p.found === true && typeof p.section === "string")
      .map((p: any) => p.section as string);
    localities.push({
      id: l.id,
      place: typeof l.place === "string" ? l.place : "",
      forPlace: typeof l.for_place === "string" ? l.for_place : null,
      timePeriod: typeof l.time_period === "string" ? l.time_period : null,
      jurisdictions,
      collections,
      quirks,
      pagesRead,
    });
  }

  const projectStatus =
    research?.project && typeof research.project === "object" && typeof research.project.status === "string"
      ? research.project.status
      : null;
  const objective =
    research?.project && typeof research.project === "object" && typeof research.project.objective === "string"
      ? research.project.objective
      : null;

  // Advisory only — nothing gates on this. It tells the router what each
  // question is waiting on, computed from the document rather than from
  // session history (the only durable state this system has). The gates in
  // research_append compute their own preconditions independently.
  const questionStatuses = questionStates(research);

  const awaitingUser = awaitingUserHandOffs(research?.log);

  return {
    ok: true,
    buildId,
    projectStatus,
    objective,
    openQuestions,
    questionStatuses,
    persons,
    sources,
    localities,
    awaitingUser,
  };
}

// ─── MCP schema ──────────────────────────────────────────────────────────────

/** Each tree person's one-hop family from `tree.relationships`: Couple edges
 *  give spouses, ParentChild edges give parents and children. The type is
 *  matched on its last segment, so the bare `Couple` and the
 *  `http://gedcomx.org/Couple` URI both count. Ids are distinct, in edge order. */
function familyIndex(tree: any): Map<string, { spouseIds: string[]; parentIds: string[]; childIds: string[] }> {
  const index = new Map<string, { spouseIds: string[]; parentIds: string[]; childIds: string[] }>();
  const entry = (id: string) => {
    let e = index.get(id);
    if (!e) {
      e = { spouseIds: [], parentIds: [], childIds: [] };
      index.set(id, e);
    }
    return e;
  };
  const add = (list: string[], id: unknown) => {
    if (typeof id === "string" && id !== "" && !list.includes(id)) list.push(id);
  };
  for (const r of Array.isArray(tree?.relationships) ? tree.relationships : []) {
    if (!r || typeof r !== "object" || typeof r.type !== "string") continue;
    const kind = r.type.split("/").pop();
    if (kind === "Couple" && typeof r.person1 === "string" && typeof r.person2 === "string") {
      add(entry(r.person1).spouseIds, r.person2);
      add(entry(r.person2).spouseIds, r.person1);
    } else if (kind === "ParentChild" && typeof r.parent === "string" && typeof r.child === "string") {
      add(entry(r.parent).childIds, r.child);
      add(entry(r.child).parentIds, r.parent);
    }
  }
  return index;
}

/** True when the person carries a Death or Burial fact, the signal that they
 *  may not appear in a later household. */
function hasDeathFact(p: any): boolean {
  return (Array.isArray(p?.facts) ? p.facts : []).some((f: any) => {
    const kind = typeof f?.type === "string" ? f.type.split("/").pop() : "";
    return kind === "Death" || kind === "Burial";
  });
}

export const projectContextSchema = {
  name: "project_context",
  description:
    "Read-only compact projection of the project state — call this INSTEAD of " +
    "reading research.json or tree.gedcomx.json. Returns projectStatus; " +
    "objective (research.project.objective verbatim, including any stated doubt " +
    "about its premise); " +
    "openQuestions [{id, question}] (unresolved only, text truncated); persons " +
    "[{id, name, gender, sourceRefs, spouseIds, parentIds, childIds, died}] — every " +
    "tree person with the distinct S ids it already cites, its one-hop family from " +
    "the tree's Couple and ParentChild edges, and whether it carries a Death or " +
    "Burial fact; and sources [{id, repository, " +
    "gedcomxSourceDescriptionId, recordIds, assertionCount}] — every research " +
    "source with the record ids its assertions cover; and localities [{id, place, " +
    "forPlace, timePeriod, jurisdictions, collections, quirks, pagesRead}] — the " +
    "place/locale research knowledge (from locality-guide) that research-plan uses " +
    "to stage searches (guide_markdown prose is omitted here); and questionStatuses " +
    "[{id, state, nextStep, openConflictIds, storedStatus}] — per question, how far it " +
    "has got (framed / planned / searching / evidence-gathered / concluded / critiqued), " +
    "what it is waiting on, and storedStatus, the question's own questions[].status " +
    "verbatim (null when absent or not a string). state is DERIVED from the documents " +
    "and storedStatus " +
    "is REPORTED, so the two can disagree — a question can read state 'concluded' on a " +
    "proof summary while its storedStatus is still 'in_progress'; that is not a " +
    "contradiction. questionStatuses is ADVISORY: it reports what the " +
    "documents already show, nothing is gated on it, and a null nextStep means the " +
    "question needs nothing further. awaitingUser [{logId, site, urlGenerated, " +
    "planItemId, performed}] lists external-site URLs already handed to the user that " +
    "nothing has answered yet — do not raise them again; when the user brings back a " +
    "capture, or says they cannot access the site, log that as the row's closing " +
    "entry with the same urlGenerated. " +
    "One call gives the context " +
    "for extraction judgment calls (which questions an assertion bears on, " +
    "whether a record persona is already in the tree, which sources cover a " +
    "record); the writer tools handle every mechanical lookup themselves. Also " +
    "returns buildId, the engine build (version+date.sha) — quote it when reporting " +
    "a problem. Writes nothing.",
  inputSchema: {
    type: "object" as const,
    properties: {
      projectPath: {
        type: "string",
        description: "Absolute path to the project directory holding research.json and tree.gedcomx.json.",
      },
    },
    required: ["projectPath"],
  },
};

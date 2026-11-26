// project_context — compact read-only projection of the project state.
//
// The read-side companion of the structured writers (research_append,
// tree_edit): where those removed "re-serialize large JSON to write," this
// removes "re-read large JSON to think." One call returns the judgment-
// relevant projection of research.json + tree.gedcomx.json — open questions,
// tree persons with their one-hop family, sources with their record ids — so a
// fresh-context agent never opens either file. A key whose value would be null,
// "" or [] is left out (`omitEmpty`).
// Spec: docs/specs/project-context-tool-spec.md.

import { questionStates, type QuestionStatus } from "../utils/question-state.js";
import { attachedBirthPairsByQuestion } from "../utils/attached-births.js";
import {
  RESEARCH_QUERY_SECTIONS,
  RESEARCH_QUERY_OPTIONAL_SECTIONS,
  EXTERNAL_COLLECTIONS_SECTION,
  disagreementsInScope,
} from "./research-query.js";
import { readProjectJson, NoProjectError, NO_PROJECT_MESSAGE_CONTEXT } from "../utils/project-io.js";
import { readExternalCollections } from "../utils/external-collections-store.js";
import { isNationalCollectionTitle, localityNationalCountry } from "../utils/collection-scope.js";
import { collectionAvailability, type CollectionAvailability } from "../utils/collection-availability.js";
import { readBuildInfo } from "../utils/build-info.js";
import { isLiveAssertion } from "../utils/assertion-liveness.js";
import { preferredDisplayName, preferredName } from "../utils/name-helpers.js";
import { treePidOfArk } from "../utils/ark.js";
import { levenshteinDistance, normalizeString } from "../utils/string-similarity.js";
import { lookupNameFamily } from "../utils/name-variants.js";
import { isMachinePageReading, logEntriesById } from "../utils/page-disputes.js";
import { getStandardDate } from "../utils/fact-helpers.js";
import { latestYear, latestIsUnbounded } from "../utils/date-helpers.js";
import { awaitingUserHandOffs, type AwaitingHandOff } from "../utils/awaiting-hand-offs.js";
import { CLAIM_KINDS } from "../validation/validator.js";
import { exhaustedImageGroups } from "../utils/browse-budget.js";
import { waitingPages, type WaitingPage } from "../utils/waiting-pages.js";
import { projectLinks } from "../utils/project-links.js";
import { uploadReadPlan, type UploadRow } from "../utils/upload-read-plan.js";
import { connectorSignInUrl } from "../auth/config.js";
import { connectorSession } from "../utils/session-check.js";
import { getProjectStore } from "../store/project-store.js";
import type { Principal } from "../auth/principal.js";
import { owedFindings, type OwedFinding } from "../utils/owed-findings.js";
import { conclusionStatus, type StatusRow } from "../utils/conclusion-status.js";
import { readStartingTree } from "../utils/starting-tree.js";
import { familyReadPersonIds } from "../utils/import-baseline.js";
import { attachedSources, searchDelegations, subjectBlock, type SearchDelegation } from "../utils/search-delegations.js";
import { stepSpawn, type StepSpawn } from "../utils/step-spawn.js";
import { historicalContextSpawn, type HistoricalContextSpawn } from "../utils/historical-context-spawn.js";

const QUESTION_TRUNCATE_AT = 140;

/** The closed set of lists `include` may name. A list, not `includeX` booleans,
 *  because the conclusion tree (#3032) adds to it (lead, 2026-11-09).
 *  "persons" and "sources" are returned regardless of `include` until #4422
 *  stage 3 flips the default; "status" and "historicalContext" are returned only when named. */
export const PROJECT_CONTEXT_INCLUDE = ["persons", "sources", "status", "historicalContext"] as const;
export type ProjectContextInclude = (typeof PROJECT_CONTEXT_INCLUDE)[number];

export interface ProjectContextInput {
  projectPath: string;
  include?: ProjectContextInclude[];
}

/** `row` without the keys whose value is null, "" or []: in this answer an
 *  absent key means null or empty. `keep` names a key that stays even then.
 *  A person's spouseIds/parentIds/childIds are the exception in meaning: for a
 *  person not in `familyReadPersonIds` the tree holds only the relatives copied
 *  into it, so absent there is "not copied", not "none". */
function omitEmpty<T extends object>(row: T, keep: readonly string[] = []): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    const empty = value === null || value === "" || (Array.isArray(value) && value.length === 0);
    if (!empty || keep.includes(key)) out[key] = value;
  }
  return out as T;
}

export interface ProjectContextQuestion {
  id: string;
  question?: string;
}

export interface ProjectContextPerson {
  id: string;
  name?: string;
  /** The FamilySearch ID from a tree-person `ark` (4:1: or tree URL); absent otherwise. */
  pid?: string;
  gender?: string;
  spouseIds?: string[];
  parentIds?: string[];
  childIds?: string[];
  diedByYear?: number;
  /** The tree's given name when none of the person's linked `name` assertions
   *  carries it: a reading in doubt, never the name to search (#4578). */
  unsupportedGivenName?: { given: string; searchAs: string };
}

/**
 * The person's preferred given name, when the person has linked live `name`
 * assertions and none of their words carries any word of it (`carriesGiven`). A
 * person with no linked name assertion is not judged: nothing is there to
 * support or contradict it. `searchAs` is its first letter and `*`: the readings
 * of one handwritten name agree on little more (Anthony, Armtogne, Ann Tone and
 * Atonne for one woman).
 */
export function unsupportedGivenName(
  person: any,
  linkedNameValues: readonly string[],
): { given: string; searchAs: string } | undefined {
  if (linkedNameValues.length === 0) return undefined;
  const names = Array.isArray(person?.names) ? person.names.filter((n: any) => n && typeof n === "object") : [];
  const raw = preferredName(names)?.given;
  const given = typeof raw === "string" ? raw.trim() : "";
  const words = nameWords(given);
  const first = normalizeString(given).match(/\p{L}/u)?.[0];
  if (words.length === 0 || first === undefined) return undefined;
  const linked = linkedNameValues.flatMap(nameWords);
  const carried = words.some((g) => linked.some((w) => carriesGiven(w, g)));
  return carried ? undefined : { given, searchAs: `${first.toUpperCase()}*` };
}

/** A linked word carries a given word when either is a prefix or a contraction
 *  of the other ("Herm", "Saml", "Wm", an initial), when they differ by a letter
 *  (two from seven letters: Christian, Kristian), or when the bundled given-name
 *  table puts them in one family (Jno, Polly, Bill). The nickname table is not
 *  used: it relates Anthony and Anton. */
function carriesGiven(w: string, given: string): boolean {
  if (given.startsWith(w) || w.startsWith(given)) return true;
  if (contracts(w, given) || contracts(given, w)) return true;
  const shorter = Math.min(w.length, given.length);
  const allowed = shorter >= 7 ? 2 : shorter >= 4 ? 1 : 0;
  if (allowed > 0 && levenshteinDistance(w, given) <= allowed) return true;
  return (lookupNameFamily(given)?.allForms ?? []).some((f) => normalizeString(f).replace(/\.$/, "") === w);
}

/** `short` keeps `long`'s first and last letters and the rest in order ("Saml", "Wm"). */
function contracts(short: string, long: string): boolean {
  if (short[0] !== long[0] || short.at(-1) !== long.at(-1)) return false;
  let i = 0;
  for (const c of long) if (c === short[i]) i++;
  return i === short.length;
}

/** A name's words, lower-cased with accents folded, split the same way on both
 *  sides of a comparison; a quoted word ("Maria 'Mary'") keeps its letters. */
function nameWords(value: string): string[] {
  return normalizeString(value)
    .split(/[^\p{L}'-]+/u)
    .map((w) => w.replace(/^['-]+|['-]+$/g, ""))
    .filter((w) => /^\p{L}/u.test(w));
}

/** Each person's live linked `name` assertion values: live rows of person_evidence
 *  (no `superseded_by`) pointing at live assertions. A machine reading of a page
 *  (`isMachinePageReading`) is linked evidence but never support, so it counts
 *  with an empty value. */
function linkedNameValuesByPerson(research: any): Map<string, string[]> {
  const logById = logEntriesById(research);
  const nameById = new Map<string, string>();
  for (const a of Array.isArray(research?.assertions) ? research.assertions : []) {
    if (isLiveAssertion(a) && a.fact_type === "name" && typeof a.id === "string") {
      nameById.set(a.id, isMachinePageReading(a, logById) ? "" : String(a.value ?? ""));
    }
  }
  const out = new Map<string, string[]>();
  for (const pe of Array.isArray(research?.person_evidence) ? research.person_evidence : []) {
    const value = typeof pe?.assertion_id === "string" ? nameById.get(pe.assertion_id) : undefined;
    if (value === undefined || typeof pe.person_id !== "string" || pe.superseded_by != null) continue;
    const list = out.get(pe.person_id) ?? [];
    list.push(value);
    out.set(pe.person_id, list);
  }
  return out;
}

export interface ProjectContextSource {
  id: string;
  repository?: string;
  gedcomxSourceDescriptionId?: string;
  recordIds?: string[];
  assertionCount: number;
}

export interface ProjectContextLocality {
  id: string;
  place?: string;
  forPlace?: string;
  timePeriod?: string;
  jurisdictions?: { name: string; dateRange?: string }[];
  /** personCount/recordCount: FamilySearch's catalog counts, which research_append stamps on a caller's write (null when unknown). */
  collections?: {
    id: string;
    title?: string;
    dateRange?: string;
    personCount?: number;
    recordCount?: number;
    /** Present only when browse-only: the stored label, else
     *  `collectionAvailability(personCount)`. A row without it is name-searchable,
     *  as on a `collections_search` row; labelling every row was 11-13% of the
     *  answer on the four planning fixtures. */
    availability?: Extract<CollectionAvailability, "browse-only">;
  }[];
  quirks?: string[];
  /** The entry's `record_types` rows, without their source URLs (research_query has them). */
  recordTypes?: {
    type: string;
    years?: string;
    level?: string;
    heldAt?: string;
    access?: string;
    collectionIds?: string[];
    summary?: string;
  }[];
  repositories?: { name: string; holds?: string; access?: string; url?: string }[];
  losses?: { recordSet: string; years?: string }[];
}

export type ProjectContextCollection = NonNullable<ProjectContextLocality["collections"]>[number];

/** An external-site URL handed to the user and not yet answered (spec §2.3). */
export type ProjectContextAwaitingUser = Omit<AwaitingHandOff, "planItemId" | "performed"> & {
  planItemId?: string;
  performed?: string;
};

/** A film whose 20-image browse cap is spent in this project (image-transcribe spec §5.8). */
export interface ProjectContextExhaustedImageGroup {
  imageGroup: string;
  imagesRead: number;
  /** Open plan items with an `image_search` log entry on this film. */
  planItemIds?: string[];
}

/** One `questionStatuses` row. `nextStep` stays when null: null there means
 *  nothing is outstanding. */
export type ProjectContextQuestionStatus = Pick<QuestionStatus, "id" | "state" | "nextStep"> & {
  question?: string;
  openConflictIds?: string[];
  storedStatus?: string;
  unregisteredDisagreements?: QuestionStatus["unregisteredDisagreements"];
  competingParentSets?: QuestionStatus["competingParentSets"];
  /** When `nextStep` is a search: one spawn per open item of the active plan,
   *  its agent and the prompt to send it as it is. */
  searches?: SearchDelegation[];
  /** When `nextStep` names conflict-resolution, person-evidence,
   *  hypothesis-tracking, research-exhaustiveness or proof-conclusion: the agent
   *  and the prompt to send it as it is. */
  spawn?: StepSpawn;
};

/** A `nextStep` that runs the plan's search agents. */
const SEARCH_STEP = /^search-(?:records|hints|external-sites)\b/;

/** Each exhausted film with the open plan items whose `image_search` log
 *  entries browsed it. Only `image_search` entries: that is what search-images
 *  logs, and a `fulltext_search` entry scoped to the same film is not a browse.
 *  Only items still `planned` or `in_progress` on an `active` plan: once an item
 *  is disposed of it must drop off, or the router sends it back every pass. */
async function exhaustedGroupsWithPlanItems(
  projectPath: string,
  research: any,
): Promise<ProjectContextExhaustedImageGroup[]> {
  const groups = await exhaustedImageGroups(projectPath);
  if (groups.length === 0) return [];
  const open = new Set<string>();
  for (const p of Array.isArray(research?.plans) ? research.plans : []) {
    if (!p || typeof p !== "object" || p.status !== "active") continue;
    for (const i of Array.isArray(p.items) ? p.items : []) {
      if (i && typeof i.id === "string" && (i.status === "planned" || i.status === "in_progress")) open.add(i.id);
    }
  }
  const byGroup = new Map<string, string[]>(groups.map((g) => [g.imageGroup, []]));
  for (const e of Array.isArray(research?.log) ? research.log : []) {
    if (!e || typeof e !== "object" || e.tool !== "image_search") continue;
    const num = e.query?.imageGroupNumber;
    if (typeof num !== "string" || typeof e.plan_item_id !== "string" || !open.has(e.plan_item_id)) continue;
    const ids = byGroup.get(num.split("_")[0]);
    if (ids && !ids.includes(e.plan_item_id)) ids.push(e.plan_item_id);
  }
  return groups.map((g) => ({ ...g, planItemIds: byGroup.get(g.imageGroup) ?? [] }));
}

/** One file the user uploaded to the project: `name`, `uploaded` (the ISO time the
 *  store recorded) and `hasText` (whether its text layer `uploads/<name>.txt`
 *  exists), plus, on a stored project, the tool that reads it. */
export type ProjectContextUpload = UploadRow;

/** The project's uploads, newest first, ties by name. An entry `X.txt` whose `X` is
 *  also an entry is X's text layer, not an upload; a lone `notes.txt` is an upload.
 *  The web tier writes the text layer under this name (issue #3987, beside
 *  `upload_key()` in apps/server/proto/web/project_blobs.py). Never throws: a
 *  listing failure must not fail the whole projection. */
async function projectUploads(projectPath: string): Promise<ProjectContextUpload[]> {
  let entries;
  try {
    entries = await getProjectStore().list(projectPath, "uploads");
  } catch {
    return [];
  }
  // A dotfile (a Finder `.DS_Store`) is not something the user uploaded.
  entries = entries.filter((e) => !e.name.startsWith("."));
  const names = new Set(entries.map((e) => e.name));
  const isTextLayer = (name: string) => name.endsWith(".txt") && names.has(name.slice(0, -".txt".length));
  return entries
    .filter((e) => !isTextLayer(e.name))
    .sort((a, b) => b.mtimeMs - a.mtimeMs || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((e) => ({ name: e.name, uploaded: new Date(e.mtimeMs).toISOString(), hasText: names.has(`${e.name}.txt`) }));
}

/** A place's stored counts, or `{ tooLarge: true }` for a place external_links_search
 *  refused as too large to list: looked up, but its collections are unknown, never 0. */
export type ProjectContextCollectionCounts =
  | { total: number; byRecordType: Record<string, number> }
  | { tooLarge: true };

/** Counts from the stored lists; `undefined` when there is nothing to report. Never
 *  throws: a missing or unreadable file must not fail the whole projection. */
async function externalCollectionCounts(
  projectPath: string,
): Promise<Record<string, ProjectContextCollectionCounts> | undefined> {
  let doc;
  try {
    doc = await readExternalCollections(projectPath);
  } catch {
    return undefined;
  }
  if (!doc) return undefined;
  const out: Record<string, ProjectContextCollectionCounts> = {};
  for (const place of Object.keys(doc.places).sort()) {
    if (doc.places[place]?.too_large === true) {
      out[place] = { tooLarge: true };
      continue;
    }
    const rows = Array.isArray(doc.places[place]?.rows) ? doc.places[place].rows : [];
    const byRecordType: Record<string, number> = {};
    for (const row of rows) {
      for (const t of Array.isArray(row?.record_types) ? row.record_types : []) {
        byRecordType[t] = (byRecordType[t] ?? 0) + 1;
      }
    }
    const sortedTypes: Record<string, number> = {};
    for (const t of Object.keys(byRecordType).sort()) sortedTypes[t] = byRecordType[t];
    out[place] = { total: rows.length, byRecordType: sortedTypes };
  }
  return out;
}

/** The project-level `nextStep` of a person project with no question yet (#4791). */
export const FIRST_QUESTION_NEXT_STEP =
  "For the research router only; an agent it spawned ignores this and does its own task. " +
  "No question yet. Not on a bounded request, which gets only what it asked for, and not in the turn " +
  "that created the project, which ends on init-project's report. When the researcher's reply says a " +
  "particular relationship, fact or source of the subject is wrong or doubted, first " +
  "Skill(\"forget-and-rederive\") with mode: verify and the reply verbatim; a reply asking to verify " +
  "none is the broad audit instead. Then, for each id in subjectPersonIds, extraction_append({ " +
  "projectPath, personId }) and timeline_build({ projectPath, personId }); then question-selection.";

/**
 * The first question's `nextStep` (#4791). With a `verify_request` the researcher
 * made when the project was created, the forget runs on it unless their reply names
 * something else, so a bare "Continue." still clears what they doubted.
 */
export function firstQuestionNextStep(verifyRequest: string | undefined): string {
  if (!verifyRequest) return FIRST_QUESTION_NEXT_STEP;
  return (
    "For the research router only; an agent it spawned ignores this and does its own task. " +
    "No question yet. Not on a bounded request, which gets only what it asked for, and not in the turn " +
    "that created the project, which ends on init-project's report. The researcher asked, when the " +
    `project was created: "${verifyRequest}". First Skill(\"forget-and-rederive\") with mode: verify ` +
    "and those words verbatim, or the reply verbatim when it names something else to verify. Then, for " +
    "each id in subjectPersonIds, extraction_append({ projectPath, personId }) and timeline_build({ " +
    "projectPath, personId }); then question-selection, with that text as researcherReply:."
  );
}

export type ProjectContextResult =
  | {
      ok: true;
      /** The engine build (`<base>+<date>.<sha>[.dirty]` or `<base>+dev`) — on every branch, #2126. */
      buildId: string;
      projectStatus?: string;
      /** research.project.objective verbatim. No other tool returns it (#3026). */
      objective?: string;
      /** research.project.subject_person_ids verbatim (strings only). The
       *  router has no other way to see who the research is about. */
      subjectPersonIds?: string[];
      /** Tree persons whose own spouses, parents and children were read from
       *  Family Tree (`familyReadPersonIds`); for anyone else a missing relative
       *  means not copied, not none. */
      familyReadPersonIds?: string[];
      /** The first subject as a search agent's `subject:` block: names (a doubted
       *  given name as its searchAs), birth, death and up to two parents. */
      subject?: Record<string, unknown>;
      /** The first subject's sources attached on FamilySearch when the project was
       *  made, as project_create stored them in the tree. */
      attachedSources?: { id: string; title: string }[];
      /** research.researcher_profile.narration_guidance verbatim. Every
       *  agent's Narration line reads it, and no other tool returns it (#3836). */
      narrationGuidance?: string;
      /** firstQuestionNextStep(project.verify_request) on a project with a subject,
       *  no question and a status other than completed; absent otherwise. */
      nextStep?: string;
      /** research.researcher_profile.subscriptions, strings only. */
      subscriptions?: string[];
      openQuestions?: ProjectContextQuestion[];
      /** Advisory per-question state and next step, resolved questions included,
       *  each with its text truncated as in openQuestions. Nothing gates on it. */
      questionStatuses?: ProjectContextQuestionStatus[];
      persons?: ProjectContextPerson[];
      sources?: ProjectContextSource[];
      localities?: ProjectContextLocality[];
      /** The localities' country-wide collections in the United States, Canada and
       *  Mexico, once per country, by title; left out of each locality's own
       *  `collections`. It covers what the localities stored, not every year. */
      nationalCollections?: Record<string, ProjectContextCollection[]>;
      /** Open external-site hand-offs: the user was sent a URL and nothing has come back. */
      awaitingUser?: ProjectContextAwaitingUser[];
      /** Films whose browse cap is spent in this project; nothing resets it. */
      exhaustedImageGroups?: ProjectContextExhaustedImageGroup[];
      /** Read pages of held records not yet on their source. */
      waitingPages?: WaitingPage[];
      /** The proof_summaries claim kinds this engine accepts. A body that writes a
       *  kind checks it is listed, so a newer body on an older engine keeps
       *  today's behaviour instead of having its write refused. */
      claimKinds: string[];
      owedFindings?: OwedFinding[];
      status?: StatusRow[];
      /** Only under `include: ["historicalContext"]`: the historical-context
       *  spawn for the first subject, the router appending the researcher's message. */
      historicalContext?: HistoricalContextSpawn;
      /** Per place stored in external-collections.json: how many curated collections,
       *  and how many per FamilySearch record type. Counts only, never rows — read the
       *  rows with research_query({section: "external_collections"}). Absent also when
       *  the file cannot be read. */
      externalCollections?: Record<string, ProjectContextCollectionCounts>;
      /** Entries per research.json section research_query serves, matching that
       *  query's unfiltered `count`: 0 for an absent optional section, null for a
       *  section research_query would refuse (a required one absent, or any one
       *  not an array). A 0 answers that section without a query; a null does not. */
      sectionCounts: Record<string, number | null>;
      /** Project-wide count of the unregistered disagreements research_query's
       *  `conflicts` section reports beside its items — so `conflicts: 0` alone
       *  does not mean that query would come back empty. */
      unregisteredDisagreementCount: number;
      /** The files the user uploaded through the web tier. */
      uploads?: ProjectContextUpload[];
      /** Present with uploads: "files" (in the project folder) or "stored" (read
       *  through the tools, each row saying which). */
      uploadsAre?: "files" | "stored";
      /** The project's upload page, when uploads are on. */
      uploadUrl?: string;
      /** The web tier's FamilySearch sign-in page, only for a connector caller
       *  whose FamilySearch session has ended. */
      signInUrl?: string;
    }
  // `reason: "no_project"` marks the one ok:false that is an answer rather than
  // a failure (project_context runs with no project). Optional field on the existing arm, NOT a
  // third arm — every `if (!r.ok) r.errors…` keeps narrowing as it does today.
  | { ok: false; errors: string[]; reason?: "no_project"; buildId: string };

function truncateQuestion(text: string): string {
  if (text.length <= QUESTION_TRUNCATE_AT) return text;
  return `${text.slice(0, QUESTION_TRUNCATE_AT - 1)}…`;
}

export async function projectContext(input: ProjectContextInput, principal: Principal): Promise<ProjectContextResult> {
  // Primary surface for "which build is this?" — 8 skills call project_context,
  // 0 call auth_status — so it rides on every return branch, no-project included.
  const buildId = readBuildInfo().version;

  // `include` is a closed list; an unknown value is a clear error, not a silent
  // no-op. Validated before the file reads — a malformed request is refused
  // whatever the project state. "persons" and "sources" are returned by default
  // until #4422 stage 3; only "status" is branched on below.
  if (input.include !== undefined) {
    const bad =
      !Array.isArray(input.include) ||
      !input.include.every((v) => (PROJECT_CONTEXT_INCLUDE as readonly string[]).includes(v));
    if (bad) {
      return {
        ok: false,
        errors: [`include must be an array of: ${PROJECT_CONTEXT_INCLUDE.join(", ")}.`],
        buildId,
      };
    }
  }

  let research: any;
  let tree: any;
  try {
    research = await readProjectJson(input.projectPath, "research.json");
    tree = await readProjectJson(input.projectPath, "tree.gedcomx.json");
  } catch (e) {
    // The other READ issue #1695 calls out: a skill that looks at project state
    // before answering must not surface a path error to a user who simply is
    // not in a project.
    if (e instanceof NoProjectError) {
      return { ok: false, reason: "no_project" as const, errors: [NO_PROJECT_MESSAGE_CONTEXT], buildId };
    }
    return { ok: false, errors: [e instanceof Error ? e.message : String(e)], buildId };
  }

  // Open questions: everything not yet resolved (open / in_progress /
  // exhaustive_declared), in array order. Text truncated — the id is the
  // handle; the text is a reminder, not the record.
  const openQuestions: ProjectContextQuestion[] = [];
  for (const q of Array.isArray(research?.questions) ? research.questions : []) {
    if (!q || typeof q !== "object" || typeof q.id !== "string") continue;
    if (q.status === "resolved" || q.status === "superseded") continue;
    openQuestions.push(omitEmpty({ id: q.id, question: truncateQuestion(typeof q.question === "string" ? q.question : "") }));
  }

  const family = familyIndex(tree);
  const linkedNames = linkedNameValuesByPerson(research);
  const persons: ProjectContextPerson[] = [];
  for (const p of Array.isArray(tree?.persons) ? tree.persons : []) {
    if (!p || typeof p !== "object" || typeof p.id !== "string") continue;
    const f = family.get(p.id);
    const doubted = unsupportedGivenName(p, linkedNames.get(p.id) ?? []);
    // A given name no linked record carries is a reading in doubt: the name is
    // the surname alone, so no reader takes the reading for the person's name.
    const surname = preferredName(Array.isArray(p.names) ? p.names : [])?.surname;
    persons.push(
      omitEmpty({
        id: p.id,
        name: doubted ? (typeof surname === "string" && surname.trim() !== "" ? surname.trim() : null) : preferredDisplayName(p),
        pid: treePidOfArk(p.ark)?.toUpperCase() ?? null,
        gender: typeof p.gender === "string" ? p.gender : null,
        spouseIds: f ? [...f.spouseIds] : [],
        parentIds: f ? [...f.parentIds] : [],
        childIds: f ? [...f.childIds] : [],
        diedByYear: diedByYear(p),
        unsupportedGivenName: doubted ?? null,
      }) as ProjectContextPerson,
    );
  }

  // Per-source assertion rollup: distinct record_id values (verbatim,
  // first-seen order) + assertion count.
  const bySource = new Map<string, { recordIds: string[]; count: number }>();
  for (const a of Array.isArray(research?.assertions) ? research.assertions : []) {
    if (!isLiveAssertion(a) || typeof a.source_id !== "string") continue;
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
    sources.push(
      omitEmpty({
        id: s.id,
        repository: typeof s.repository === "string" ? s.repository : null,
        gedcomxSourceDescriptionId:
          typeof s.gedcomx_source_description_id === "string" ? s.gedcomx_source_description_id : null,
        recordIds: bucket ? bucket.recordIds : [],
        assertionCount: bucket ? bucket.count : 0,
      }) as ProjectContextSource,
    );
  }

  // Localities: compact place/locale projection for research-plan — the
  // actionable bits (jurisdictions, collections, quirks, record-type rows, repositories,
  // losses). guide_markdown, catalog and pages_read are left out; research_query serves
  // the whole entry.
  const localities: ProjectContextLocality[] = [];
  const national = new Map<string, Map<string, ProjectContextCollection>>();
  for (const l of Array.isArray(research?.localities) ? research.localities : []) {
    if (!l || typeof l !== "object" || typeof l.id !== "string") continue;
    const jurisdictions = (Array.isArray(l.jurisdictions) ? l.jurisdictions : [])
      .filter((j: any) => j && typeof j === "object" && typeof j.name === "string")
      .map((j: any) => omitEmpty({ name: j.name, dateRange: typeof j.date_range === "string" ? j.date_range : null }));
    const country = localityNationalCountry(l);
    const collections: ProjectContextCollection[] = [];
    for (const c of Array.isArray(l.collections) ? l.collections : []) {
      if (!c || typeof c !== "object" || typeof c.id !== "string") continue;
      const row: ProjectContextCollection = omitEmpty({
        id: c.id,
        title: typeof c.title === "string" ? c.title : "",
        dateRange: typeof c.date_range === "string" ? c.date_range : null,
        personCount: Number.isInteger(c.person_count) ? c.person_count : null,
        recordCount: Number.isInteger(c.record_count) ? c.record_count : null,
        ...((c.availability === "name-searchable" || c.availability === "browse-only"
          ? c.availability
          : collectionAvailability(c.person_count)) === "browse-only"
          ? { availability: "browse-only" as const }
          : {}),
      });
      if (country && typeof c.title === "string" && isNationalCollectionTitle(c.title, country)) {
        const rows = national.get(country) ?? new Map<string, ProjectContextCollection>();
        if (!rows.has(c.id)) rows.set(c.id, row);
        national.set(country, rows);
      } else {
        collections.push(row);
      }
    }
    const quirks = (Array.isArray(l.quirks) ? l.quirks : []).filter(
      (q: any): q is string => typeof q === "string",
    );
    const str = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v : null);
    const rows = (field: string) => (Array.isArray(l[field]) ? l[field] : []).filter((r: any) => r && typeof r === "object");
    const recordTypes = rows("record_types")
      .filter((r: any) => typeof r.type === "string")
      .map((r: any) =>
        omitEmpty({
          type: r.type,
          years: str(r.years),
          level: str(r.level),
          heldAt: str(r.held_at),
          access: str(r.access),
          collectionIds: Array.isArray(r.collection_ids) ? r.collection_ids.filter((c: unknown) => typeof c === "string") : [],
          summary: str(r.summary),
        }),
      );
    const repositories = rows("repositories")
      .filter((r: any) => typeof r.name === "string")
      .map((r: any) => omitEmpty({ name: r.name, holds: str(r.holds), access: str(r.access), url: str(r.url) }));
    const losses = rows("losses")
      .filter((r: any) => typeof r.record_set === "string")
      .map((r: any) => omitEmpty({ recordSet: r.record_set, years: str(r.years) }));
    localities.push(
      omitEmpty({
        id: l.id,
        place: typeof l.place === "string" ? l.place : "",
        forPlace: typeof l.for_place === "string" ? l.for_place : null,
        timePeriod: typeof l.time_period === "string" ? l.time_period : null,
        jurisdictions,
        collections,
        quirks,
        recordTypes,
        repositories,
        losses,
      }) as ProjectContextLocality,
    );
  }

  const nationalCollections: Record<string, ProjectContextCollection[]> = {};
  for (const [country, rows] of national) {
    nationalCollections[country] = [...rows.values()].sort((a, b) => (a.title ?? "").localeCompare(b.title ?? ""));
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
  const questionText = new Map<string, string>();
  for (const q of Array.isArray(research?.questions) ? research.questions : []) {
    if (q && typeof q === "object" && typeof q.id === "string" && !questionText.has(q.id)) {
      questionText.set(q.id, truncateQuestion(typeof q.question === "string" ? q.question : ""));
    }
  }
  // #4444: the identity rung's pairs, by research_append's own pair test and
  // place lookup, so the rung and the proof gate cannot disagree.
  const attachedBirthPairs = await attachedBirthPairsByQuestion(research, tree);
  const exhausted = (await exhaustedGroupsWithPlanItems(input.projectPath, research)).map((row) => omitEmpty(row));
  const exhaustedItemIds = new Set(exhausted.flatMap((g) => g.planItemIds ?? []));
  const subjectId = Array.isArray(research?.project?.subject_person_ids) ? research.project.subject_person_ids[0] : undefined;
  const subjectUnsupported = persons.find((p) => p.id === subjectId)?.unsupportedGivenName;
  const questionById = new Map<string, any>(
    (Array.isArray(research?.questions) ? research.questions : [])
      .filter((q: any) => q && typeof q === "object" && typeof q.id === "string")
      .map((q: any) => [q.id, q]),
  );
  const questionStatuses = questionStates(research, tree, attachedBirthPairs).map((status) => {
    const { id, ...rest } = status;
    const searches =
      typeof rest.nextStep === "string" && SEARCH_STEP.test(rest.nextStep)
        ? searchDelegations(input.projectPath, research, tree, questionById.get(id), exhaustedItemIds, subjectUnsupported)
        : [];
    const spawn = stepSpawn(input.projectPath, research, status, tree, attachedBirthPairs.get(id) ?? []);
    return omitEmpty({ id, question: questionText.get(id) ?? "", ...rest, searches, ...(spawn ? { spawn } : {}) }, [
      "nextStep",
    ]) as ProjectContextQuestionStatus;
  });
  const subject =
    typeof subjectId === "string" ? subjectBlock(tree, subjectId, "", subjectUnsupported) : null;

  // Decision 33: what the project still owes. Before questionStatuses in the
  // answer, so a reader scoping to that array by its key does not take these
  // items' own `nextStep` for a question's.
  const owed = owedFindings(research, tree);
  const historicalContext = input.include?.includes("historicalContext")
    ? historicalContextSpawn(
        input.projectPath,
        research,
        tree,
        typeof subjectId === "string" ? subjectId : undefined,
        typeof subjectId === "string" ? family.get(subjectId) : undefined,
      )
    : null;
  const status = input.include?.includes("status")
    ? conclusionStatus(research, tree, await readStartingTree(input.projectPath))
    : undefined;

  const awaitingUser = awaitingUserHandOffs(research?.log).map((row) => omitEmpty(row) as ProjectContextAwaitingUser);
  const waiting = await waitingPages(input.projectPath, research);

  const sectionCounts: Record<string, number | null> = {};
  for (const section of RESEARCH_QUERY_SECTIONS) {
    if (section === EXTERNAL_COLLECTIONS_SECTION) continue;
    const entries = research?.[section];
    sectionCounts[section] = Array.isArray(entries)
      ? entries.length
      : entries === undefined && RESEARCH_QUERY_OPTIONAL_SECTIONS.has(section)
        ? 0
        : null;
  }
  const unregisteredDisagreementCount = disagreementsInScope(
    research,
    { projectPath: input.projectPath, section: "conflicts" },
    undefined,
  ).length;
  const externalCollections = await externalCollectionCounts(input.projectPath);
  const uploads = await projectUploads(input.projectPath);
  const links = await projectLinks(principal);
  // A connector caller whose FamilySearch session has ended gets the link here
  // too, so the next turn shows it even if an agent's summary dropped the tool
  // error that first carried it (E3). Unknown is not ended: no link. With no
  // link to give (no public URL, or any caller but a connector) FamilySearch is
  // not asked at all.
  const signInLink = connectorSignInUrl(principal);
  const signInUrl =
    signInLink !== undefined && (await connectorSession(principal)) === "ended" ? signInLink : undefined;

  // sectionCounts' null values (a section research_query would refuse) sit one
  // level down, so this leaves them alone.
  return omitEmpty({
    ok: true as const,
    buildId,
    projectStatus,
    objective,
    subjectPersonIds: (Array.isArray(research?.project?.subject_person_ids) ? research.project.subject_person_ids : []).filter(
      (id: unknown): id is string => typeof id === "string",
    ),
    familyReadPersonIds: familyReadPersonIds(tree),
    ...(subject ? { subject } : {}),
    attachedSources: typeof subjectId === "string" ? attachedSources(tree, subjectId) : [],
    narrationGuidance:
      typeof research?.researcher_profile?.narration_guidance === "string"
        ? research.researcher_profile.narration_guidance
        : null,
    ...(typeof subjectId === "string" &&
    !(Array.isArray(research?.questions) && research.questions.length > 0) &&
    projectStatus !== "completed"
      ? {
          nextStep: firstQuestionNextStep(
            typeof research?.project?.verify_request === "string" && research.project.verify_request.trim() !== ""
              ? research.project.verify_request
              : undefined,
          ),
        }
      : {}),
    subscriptions: (Array.isArray(research?.researcher_profile?.subscriptions)
      ? research.researcher_profile.subscriptions
      : []
    ).filter((x: unknown): x is string => typeof x === "string"),
    openQuestions,
    owedFindings: owed,
    questionStatuses,
    ...(status ? { status } : {}),
    ...(historicalContext ? { historicalContext } : {}),
    persons,
    sources,
    localities,
    ...(national.size > 0 ? { nationalCollections } : {}),
    awaitingUser,
    exhaustedImageGroups: exhausted,
    waitingPages: waiting,
    claimKinds: [...CLAIM_KINDS],
    ...(externalCollections ? { externalCollections } : {}),
    sectionCounts,
    unregisteredDisagreementCount,
    ...uploadReadPlan(uploads, typeof links.uploadUrl === "string"),
    ...links,
    ...(signInUrl ? { signInUrl } : {}),
  }) as Extract<ProjectContextResult, { ok: true }>;
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

/** The year the person was certainly dead by: the earliest of the latest
 *  possible years of their dated Death and Burial facts, or null when none is
 *  dated. The latest year, not the earliest, so a death "Bef 1870" or "Abt 1861"
 *  never reads as before an 1865 or 1860 household the person may still be in.
 *  A date with no upper bound ("Aft 1850") gives no year: it never says when. */
function diedByYear(p: any): number | null {
  let by: number | null = null;
  for (const f of Array.isArray(p?.facts) ? p.facts : []) {
    const kind = typeof f?.type === "string" ? f.type.split("/").pop() : "";
    if (kind !== "Death" && kind !== "Burial") continue;
    const std = getStandardDate(f);
    const y = std === null || latestIsUnbounded(std) ? null : latestYear(std);
    if (y !== null && (by === null || y < by)) by = y;
  }
  return by;
}

export const projectContextSchema = {
  name: "project_context",
  description:
    "When the user asks where the project stands (\"where are we?\", \"summarize " +
    "progress\", \"what have we found?\") or reopens a project, call this and answer " +
    "from it in exactly ONE plain-language paragraph and nothing else: the objective, " +
    "what is established, what is open or waiting on the researcher, and the next " +
    "step, stated rather than asked, as the paragraph's last sentence. This shape " +
    "overrides narrationGuidance for this answer. No lead-in line (\"Here's where things stand:\"), " +
    "no line breaks, headings, tables, lists or bold, no closing question, " +
    "and no identifiers, file names, tool names or field names: " +
    "say \"the conclusion\" or \"the parentage question\", never q_001 or ps_001. " +
    "nextStep values name ids and agents; restate them in plain words. " +
    "Do not read the project files and do not delegate. " +
    "Read-only compact projection of the project state — call this INSTEAD of " +
    "reading research.json or tree.gedcomx.json. A key whose value would be null, \"\" " +
    "or [] is left out, so an absent key means none; only nextStep and sectionCounts " +
    "values are ever null. The one exception is a person's spouseIds, parentIds and childIds. " +
    "familyReadPersonIds names the persons whose own spouses, parents and children were read " +
    "from Family Tree; it is absent when no one's were. For a person not in familyReadPersonIds, " +
    "an absent or short spouseIds/parentIds/childIds means not copied from Family Tree, not " +
    "none: their parents, other spouses (a stepparent) and children may be in Family Tree. Say " +
    "\"not in the project tree\"; say what Family Tree records only after person_read of their " +
    "pid, and only when your answer depends on it, not to summarize the project. A person " +
    "with no pid cannot be checked. An optional include list (closed: \"persons\", \"sources\", \"status\", \"historicalContext\") names " +
    "the larger lists you read; persons and sources are returned whether or not you pass it, status and " +
    "historicalContext only when named. " +
    "Returns projectStatus; " +
    "objective (research.project.objective verbatim, including any stated doubt " +
    "about its premise); " +
    "openQuestions [{id, question}] (unresolved only, text truncated); persons " +
    "[{id, name, pid, gender, spouseIds, parentIds, childIds, diedByYear, " +
    "unsupportedGivenName}] — every " +
    "tree person, its FamilySearch ID (pid, from a tree-person ark or URL only), " +
    "and its one-hop family from " +
    "the tree's Couple and ParentChild edges, and the year it was certainly dead " +
    "by from its dated Death or Burial facts; unsupportedGivenName {given, searchAs} " +
    "marks a given name none of the person's linked records gives: brief it as a " +
    "reading in doubt, keep it out of a subject's names, and search the given name " +
    "as searchAs; and sources [{id, repository, " +
    "gedcomxSourceDescriptionId, recordIds, assertionCount}] — every research " +
    "source with the record ids its assertions cover; and localities [{id, place, " +
    "forPlace, timePeriod, jurisdictions, collections [{id, title, dateRange, personCount, " +
    "recordCount, availability?}], quirks, recordTypes [{type, years, level, heldAt, access, collectionIds, summary}], " +
    "repositories [{name, holds, access, url}], losses [{recordSet, years}]}] — availability \"browse-only\" marks a " +
    "browse-only collection; a row without it is name-searchable; the " +
    "place/locale research knowledge (from locality-guide) that research-plan uses " +
    "to stage searches (guide_markdown prose is omitted here); and nationalCollections " +
    "{country: [same rows]} — the localities' country-wide collections for the United States, " +
    "Canada and Mexico, once per country and left out of each locality's collections; and questionStatuses " +
    "[{id, question, state, nextStep, openConflictIds, storedStatus, unregisteredDisagreements, " +
    "competingParentSets, searches}] — per question, resolved ones included, its text (truncated) and how far it " +
    "has got (framed / planned / searching / evidence-gathered / concluded / critiqued — " +
    "critiqued means an on-demand gps-mentor review exists and is never a step to take), " +
    "what it is waiting on; searches [{planItemId, agent, prompt}], present when nextStep is a search, " +
    "is the search step written out: spawn each agent with its prompt as the whole delegation; " +
    "spawn {agent, prompt}, present when nextStep names conflict-resolution, person-evidence, " +
    "hypothesis-tracking, research-exhaustiveness or proof-conclusion, is that step written out the same way; " +
    "and storedStatus, the question's own questions[].status " +
    "verbatim when it is a string. state is DERIVED from the documents " +
    "and storedStatus " +
    "is REPORTED, so the two can disagree — a question can read state 'concluded' on a " +
    "proof summary while its storedStatus is still 'in_progress'; that is not a " +
    "contradiction. A top-level nextStep, present only on a project with a subject and " +
    "no question yet, names the steps that write its first question. questionStatuses is ADVISORY: it reports what the " +
    "documents already show, nothing is gated on it, and a null nextStep means the " +
    "question needs nothing further. awaitingUser [{logId, site, urlGenerated, " +
    "planItemId, performed}] lists external-site URLs already handed to the user that " +
    "nothing has answered yet — do not raise them again; when the user brings back a " +
    "capture, or says they cannot access the site, log that as the row's closing " +
    "entry with the same urlGenerated. waitingPages [{sourceId, ref, index}], absent when " +
    "none, lists read pages of held records, each with its record's index " +
    "[{assertionId, role, factType, value, date?, place?}]; hand them to record-structurer in one spawn, " +
    "which keeps them with one extraction_append({ projectPath, attachWaitingPages: true, " +
    "pageReadings }). " +
    "subject is the first subject as a search agent's subject: block, a doubted given name already " +
    "searched as its searchAs; attachedSources [{id, title}] are that subject's sources attached on " +
    "FamilySearch when the project was made. subjectPersonIds are the project's subject " +
    "persons (research.project.subject_person_ids). narrationGuidance is " +
    "researcher_profile.narration_guidance verbatim: the narration " +
    "style every skill applies; subscriptions is researcher_profile.subscriptions. " +
    "For tree facts, dates, places, marriages, cited S ids and arks call tree_query. " +
    "externalCollections counts stored curated " +
    "collections per place by record type (rows: research_query external_collections); " +
    "a place too large to list shows {tooLarge: true}, meaning looked up but its collections unknown, not none. " +
    "sectionCounts gives the entry count of every research.json section research_query " +
    "serves (null when research_query would refuse the section), and unregisteredDisagreementCount the project-wide count of " +
    "unregistered disagreements research_query's conflicts section reports — a section " +
    "counted 0 needs no query, except conflicts while that count is above 0. " +
    "exhaustedImageGroups [{imageGroup, imagesRead, planItemIds}] lists films whose 20-image " +
    "browse cap is spent in this project; nothing resets it, not a new agent or session. Never " +
    "delegate a browse of one: send its planItemIds to research-plan to dispose of. " +
    "claimKinds lists the proof_summaries claim kinds this engine accepts. " +
    "owedFindings [{kind, ref, personIds, nextStep, blocksCompletion}] lists what the project still owes, in " +
    "order: extract (a positive search with nothing extracted), conclude (a question with tied assertions and no " +
    "proof summary), hypothesis (a supported hypothesis with no summary), encode (a likely claim no tree object " +
    "carries), then the advisory raise, claims and frame. With include: [\"status\"], status lists every tree fact " +
    "and relationship with its status read from claims. With include: [\"historicalContext\"], historicalContext " +
    "{agent, prompt} is the historical-context step written out for the first subject: spawn the agent with " +
    "prompt as given, then a line message: and the researcher's message copied verbatim, and nothing else. " +
    "One call gives the context " +
    "for extraction judgment calls (which questions an assertion bears on, " +
    "whether a record persona is already in the tree, which sources cover a " +
    "record); the writer tools handle every mechanical lookup themselves. Also " +
    "returns buildId, the engine build (version+date.sha) — quote it when reporting " +
    "a problem. uploads [{name, uploaded, hasText}] lists the files the " +
    "user uploaded, newest first; hasText says a text layer exists. uploadsAre says how to " +
    "read them: \"files\" are files in the project folder; \"stored\" ones are read with the " +
    "tool each row names in readWith (ref is the sidecar_read ref). uploadUrl, when present, " +
    "is the page where the user uploads a file; give it to the user when they want to add a " +
    "document. signInUrl, when present, means the user's FamilySearch session has ended: " +
    "give them that link to sign in again, then continue. Writes nothing.",
  inputSchema: {
    type: "object" as const,
    properties: {
      projectPath: {
        type: "string",
        description: "Absolute path to the project directory holding research.json and tree.gedcomx.json.",
      },
      include: {
        type: "array",
        items: { type: "string", enum: [...PROJECT_CONTEXT_INCLUDE] },
        description:
          'Optional closed list naming the larger lists to include. Values: "persons", "sources", "status", ' +
          '"historicalContext". ' +
          '"persons" and "sources" are returned whether or not you pass include. "status": every tree fact and ' +
          "relationship with its status read from proof-summary claims (well established, likely, tentative, " +
          "ruled out, set aside, from your starting tree, found in a record, …), returned only when named. " +
          '"historicalContext": the historical-context spawn for the first subject, returned only when named.',
      },
    },
    required: ["projectPath"],
  },
};

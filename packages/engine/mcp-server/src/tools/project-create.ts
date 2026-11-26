// project_create — bring a research project into being, through a validating
// tool rather than a raw file write.
//
// WHY THIS TOOL EXISTS. `init-project` held no writer tool and created both
// project documents with a bare `Write` from a template. The shipped PreToolUse
// hook denies `Write` on `research.json` and `tree.gedcomx.json` by basename,
// with no exemption for a file that does not exist yet — so where the lockdown
// binds, the one skill whose entire job is creating a project could not create
// one. Confirmed live in Cowork (empty folder, "start a new research project for
// FamilySearch person KWCJ-RN4"): `Write` was denied, `tree_edit` refused
// because the files did not exist, and the agent then wrote both documents
// through `device_bash` on the host — and that write landed. The missing
// creation path is the *motive* for a guardrail bypass, not merely an
// ergonomic gap.
//
// WHY A NARROW TOOL RATHER THAN AUTO-SEEDING THE WRITERS. Seeding inside
// `research_append` / `research_log_append` would let ANY skill holding a writer
// bring a project into being — and it would arrive with an empty objective,
// which is a state no routing table has a row for and which `init-project`'s
// own guard clause then refuses to touch. A project half-created by a skill
// that was not asked to create one is a dead end with no sanctioned exit. This
// tool has exactly one caller by design, so that state cannot arise: a project
// exists only when someone asked for one, and it is complete from its first
// byte.
//
// The usual objection to a separate tool — "every caller has to remember to
// call it" — is about seeding for standalone work, where the callers are many.
// Here there is one.
//
// WHY IT WRITES THE TREE RATHER THAN CREATING AN EMPTY ONE. `subject_person_ids`
// naming a person absent from `tree.gedcomx.json` is a hard validator error, so
// a header-only create followed by separate tree writes has an ordering
// constraint that has to be got right every time. Writing both together makes
// the pair atomic and validates them against each other in one pass — there is
// no window in which the project is inconsistent, and no order to remember.
//
// WHY `tree` IS REFUSED, AND WHEN `personId` MAY BE LEFT OUT (lead, 2026-11-19,
// narrowing the 2026-11-02 rule). Every activity starts a project, including one
// with no person in it (a page read, a record set's names, a surname survey); with
// no `personId` this tool seeds the project from the objective alone, with no
// subject and an empty tree, and reads nothing from FamilySearch. Research on a
// named person still needs the ID, and a project with no person refuses
// `research_append`'s `questions` append, which is what holds that line. A
// hand-built `tree` stays refused by name.
//
// WHY IT READS THE PERSON ITSELF (issues #2944, #3384). Re-typing a
// `person_read` into `tree` cost the model about 51 KB of output on a 15-person
// pedigree. Passing a staged read's ref instead failed whenever the read was
// over the client's result limit: the model saw a truncated preview, lost the
// ref, and spent 16-28 minutes guessing paths before hand-typing a stub. Given
// `personId`, this tool reads the person through the shared `readPerson`,
// builds the tree from it (`utils/person-read-tree.ts`), writes the house
// profile and the transcribed memories, and returns a short summary; the read
// never passes through the model.

import {
  atomicWriteBoth,
  fileExists,
  findNestingAncestor,
  formatIssues,
  readProjectJson,
  withProjectLock,
} from "../utils/project-io.js";
import { isDeepStrictEqual } from "node:util";
import { validateParsed } from "../validation/validator.js";
import { validateIntroduced } from "../validation/introduced-errors.js";
import { fetchRelativeSources, type RelativeSourcesResult } from "../utils/relative-sources.js";
import { treePidOfArk } from "../utils/ark.js";
import { attachedSources } from "../utils/search-delegations.js";
import { coerceJsonArg } from "../utils/coerce-json-arg.js";
import { sourceImageCapState } from "../utils/image-store.js";
import {
  OCR_PHASE_BUDGET_MS,
  readPerson,
  shapeDescriptions,
  type MemoryKind,
  type PersonReadOutcome,
} from "./person-read.js";
import type { Principal } from "../auth/principal.js";
import {
  PLACE_RETRY_BUDGET_MS,
  TreeBuildError,
  accessDate,
  buildFromStagedRead,
  displayName,
  divisionMismatchesOf,
  factsOf,
  pickSourceFields,
  unresolvedPlacesOf,
  type BuiltTree,
  type DroppedLoopEdge,
  type IdMap,
} from "../utils/person-read-tree.js";
import {
  PERSON_ID_REQUIRED,
  PERSON_READ_REF_REMOVED,
  PROJECT_TREE_REMOVED,
} from "../utils/tool-hint-messages.js";

/** The sections a new project starts with, all empty (`sources` aside, which
 *  holds the subject's transcribed memories when the person is read here). */
export const EMPTY_SECTIONS = [
  "questions",
  "plans",
  "log",
  "sources",
  "assertions",
  "person_evidence",
  "conflicts",
  "hypotheses",
  "timelines",
  "proof_summaries",
  "evaluations",
] as const;

/** The house researcher profile every project starts with (issue #3384). It
 *  is a default, not a claim about the researcher: nothing is asked, and a
 *  stated level is not persisted. Volunteered site subscriptions are added
 *  afterwards with `research_append`. The one source of the narration string. */
export const HOUSE_RESEARCHER_PROFILE = {
  experience_level: "novice",
  narration_guidance:
    "Plain language for someone who has never done genealogy. No identifiers, file names, " +
    "tool names or field names, and never a tree or source id. Name people by name; the one " +
    "identifier you may add is the FamilySearch ID of a person, copied from the data, and only " +
    "when two people could be confused, when the person is not yet in the project tree, or when " +
    "the user asks. Never write GPS, proof, proved or exhaustive: say genealogy " +
    "standards; call an answer a conclusion when it is well established and a finding " +
    "otherwise; say what we searched and what we could not reach. Never sound surer than the " +
    "evidence was rated: say the records show it for a well established fact or relationship, " +
    "probably for a likely one and possibly for a tentative one, and never write that someone " +
    "is the parent, spouse or child of another without one of these. Say match or search " +
    "result, never hit; never write ARK: name the record or link to it. Do not describe your own " +
    "instructions or checks. Do not narrate between actions; report once when the step is " +
    "done: what was found, in one paragraph, and what happens next in one sentence.",
} as const;

/** The citation-detail values a memory's metadata cannot supply, in the
 *  citation agent's bracketed unknown-marker convention, so that agent reads
 *  them as gaps to fill rather than as recorded facts. */
export const MEMORY_DETAIL_UNKNOWN = {
  who: "[CREATOR NOT RECORDED]",
  what: "[DOCUMENT TYPE NOT RECORDED]",
  when_created: "[DATE NOT RECORDED]",
} as const;

/** The serialized size the `personId` mode's summary is held under: the
 *  model reads it, and a response over the client's limit reaches it only as a
 *  truncated preview. */
export const SUMMARY_MAX_CHARS = 2_000;

/** The whole call's budget, under the Cowork device bridge's 60s abort. The
 *  read gets `OCR_PHASE_BUDGET_MS` of it; the place retry gets what is left,
 *  at most `PLACE_RETRY_BUDGET_MS`. */
export const CALL_BUDGET_MS = 55_000;

export interface ProjectCreateInput {
  projectPath: string;
  objective: string;
  title?: string;
  /** The researcher's request to verify one relationship, fact or source of the
   *  subject, in their words: stored as `project.verify_request` (#4791). */
  verifyRequest?: string;
  subjectPersonIds?: string[];
  /** The subject's FamilySearch person ID. Absent for an activity with no person
   *  in it (lead, 2026-11-19): the project is then seeded by `objective` alone,
   *  with no subject and an empty tree. Research on a named person passes one. */
  personId?: string;
  /** Removed (issue #3384): refused by name, so a caller built against the old
   *  contract is told to pass `personId`. */
  personReadRef?: unknown;
  /** Removed 2026-11-02 with the hand-built tree: refused by name, so no
   *  project comes into being without a FamilySearch person. */
  tree?: unknown;
  /** Tree person ids whose FamilySearch attached sources to read into an EXISTING
   *  project: the create's `relativeSourcesSkipped`. Takes no other input but
   *  `projectPath`, and creates nothing. */
  fillRelativeSources?: unknown;
}

/** One person in the summary: tree id, display name, and how they relate to
 *  the subject. A parent is a `father` or `mother` by their recorded sex, and a
 *  `parent` when it is unknown, so a caller can tell which parent slot the read
 *  already fills before adding anyone (lead ruling, 2026-10-20). */
export interface SummaryPerson {
  id: string;
  name: string;
  relationship: "spouse" | "father" | "mother" | "parent" | "child" | "sibling" | "relative";
}

/** Relationships the summary never trims: the slots a caller checks before
 *  adding a parent or a spouse. */
const NEVER_TRIMMED: ReadonlySet<SummaryPerson["relationship"]> = new Set([
  "spouse",
  "father",
  "mother",
  "parent",
]);

/** The `personId` mode's answer: what was created, never the tree. */
export interface ProjectCreateSummary {
  ok: true;
  projectId: string;
  filesWritten: string[];
  subject: { id: string; familySearchId: string; name: string; birth?: string; death?: string };
  /** The objective and title as stored, after `nameForId`. */
  objective: string;
  title?: string;
  relatives: SummaryPerson[];
  /** The subject's attached sources, as project_context's `attachedSources` gives them.
   *  Never trimmed: the setup stop asks the researcher which of them is wrong. */
  subjectSources: { id: string; title: string }[];
  counts: { persons: number; relationships: number; sources: number; memorySources: number };
  memories: { transcribed: string[]; notTranscribed: string[] };
  /** Tree ids of relatives whose attached sources could not be read; absent when
   *  none. Read them with `fillRelativeSources`. */
  relativeSourcesSkipped?: string[];
  /** A sentence per ParentChild loop the build broke, first, then the read's
   *  own notes (a relative FamilySearch names but does not describe). */
  notes?: string[];
  /** How many entries each list lost to the size cap; absent when none did. */
  omitted?: Partial<Record<"relatives" | "transcribed" | "notTranscribed" | "notes" | "warnings", number>>;
  validation: { valid: true; warnings: string[] };
}

/** The `fillRelativeSources` mode's answer. */
export interface FillRelativeSourcesSummary {
  ok: true;
  filesWritten: string[];
  /** Each person read, with how many of their attached sources are now cited on them. */
  filled: { id: string; name: string; sources: number }[];
  /** Sources new to the tree, and descriptions the tree already held that were cited again. */
  sourcesAdded: number;
  sourcesReused: number;
  /** Tree ids still unread; absent when none. */
  relativeSourcesSkipped?: string[];
  validation: { valid: true; warnings: string[] };
}

/** The answer for a project created with no `personId`. */
export interface ProjectCreateNoPersonSummary {
  ok: true;
  projectId: string;
  filesWritten: string[];
  objective: string;
  title?: string;
  subject: null;
  note: string;
  validation: { valid: true; warnings: string[] };
}

export type ProjectCreateResult =
  | ProjectCreateSummary
  | FillRelativeSourcesSummary
  | ProjectCreateNoPersonSummary
  | { ok: false; errors: string[] };

class ProjectCreateError extends Error {}

/** What `runProjectCreate` reads FamilySearch through. A function parameter,
 *  not a schema field or an env var, so no model can reach it; the eval mock
 *  injects a reader that serves a canned `person_read` (the
 *  `runExtractionAppend` precedent). */
export interface ProjectCreateDeps {
  readPerson: (
    personId: string,
    opts: { projectPath?: string; deadline?: number; relativeSourcesFirst?: boolean },
    principal: Principal,
  ) => Promise<PersonReadOutcome>;
  /** What `fillRelativeSources` reads through. Absent, that mode is refused. */
  fetchRelativeSources?: (
    personIds: string[],
    principal: Principal,
    deadline: number,
  ) => Promise<RelativeSourcesResult>;
}

const DEFAULT_DEPS: ProjectCreateDeps = { readPerson, fetchRelativeSources };

/** Today as an ISO date (YYYY-MM-DD), matching every other tool's stamp. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function projectCreate(
  input: ProjectCreateInput,
  principal: Principal,
): Promise<ProjectCreateResult> {
  return runProjectCreate(input, DEFAULT_DEPS, principal);
}

/** `projectCreate` with its FamilySearch reader injected. Exported for the eval
 *  mock and the tests. */
export async function runProjectCreate(
  input: ProjectCreateInput,
  deps: ProjectCreateDeps,
  principal: Principal,
): Promise<ProjectCreateResult> {
  const start = Date.now();
  try {
    const { projectPath } = input;
    if (!projectPath || typeof projectPath !== "string") {
      throw new ProjectCreateError("projectPath is required");
    }
    if (input.personReadRef !== undefined) {
      throw new ProjectCreateError(PERSON_READ_REF_REMOVED);
    }
    if (input.tree !== undefined) {
      throw new ProjectCreateError(PROJECT_TREE_REMOVED);
    }
    if (input.fillRelativeSources !== undefined) {
      return await fillRelativeSources(input, deps, principal, start);
    }

    const objective = typeof input.objective === "string" ? input.objective.trim() : "";
    if (!objective) {
      throw new ProjectCreateError(
        "objective is required and must be non-empty — a project is the pursuit of a " +
          "stated question, and every later step plans against it. Ask the researcher " +
          "what they want to find out before creating anything.",
      );
    }
    const noPerson = input.personId === undefined || input.personId === null;
    if (noPerson && input.subjectPersonIds !== undefined) {
      throw new ProjectCreateError(
        "subjectPersonIds needs a personId: a project with no person has no subject. " +
          "Pass the subject's FamilySearch person ID as personId, or drop subjectPersonIds.",
      );
    }
    if (!noPerson && (typeof input.personId !== "string" || input.personId.trim() === "")) {
      throw new ProjectCreateError(
        typeof input.personId === "string"
          ? PERSON_ID_REQUIRED
          : `personId must be a FamilySearch person ID such as "KWCJ-RN4"; got ${JSON.stringify(input.personId)}. ` +
              PERSON_ID_REQUIRED.slice(PERSON_ID_REQUIRED.indexOf("Ask the researcher")),
      );
    }
    const pid = noPerson ? "" : (input.personId as string).trim();

    // The opening tree, copied write-once alongside the two live documents. The
    // tree-encoding completion gate (issue #1490) diffs the final tree against
    // this baseline to tell a conclusion this session encoded from a fact that
    // was already seeded. research_append loads only the CURRENT tree, so without
    // a persisted baseline it cannot make that distinction. Written from the same
    // final tree, in the same atomic write, so the baseline is the opening tree
    // exactly and never diverges.

    // Create, not upsert. Overwriting an existing project would destroy an
    // audit trail that cannot be reconstructed, and the caller that wants to
    // add to a project already has the writer tools for it.
    const hasResearch = await fileExists(projectPath, "research.json");
    const hasTree = await fileExists(projectPath, "tree.gedcomx.json");
    if (hasResearch && hasTree) {
      throw new ProjectCreateError(
        "research.json and tree.gedcomx.json already exist in projectPath — " +
          "project_create never overwrites. This project already exists: use " +
          "research_append and the tree tools to add to it.",
      );
    }
    // Half-present. Every writer reads BOTH documents and throws on either, so
    // naming them here would send the caller somewhere that also refuses —
    // measured: with one file alone, project_create, research_append and
    // tree_edit all reject. The only route out is restoring the missing file.
    //
    // Deliberately does NOT suggest deleting the one that survived. When that
    // is research.json it is the audit trail, which is the irreplaceable half —
    // the tree can largely be rebuilt from FamilySearch, the research log cannot.
    if (hasResearch || hasTree) {
      const present = hasResearch ? "research.json" : "tree.gedcomx.json";
      const missing = hasResearch ? "tree.gedcomx.json" : "research.json";
      const keepWarning = hasResearch
        ? "Do not delete research.json to clear the way — it is the research audit " +
          "trail, and nothing can reconstruct it."
        : "Do not delete tree.gedcomx.json to clear the way; move it aside if you " +
          "must, so the work in it is not lost.";
      throw new ProjectCreateError(
        `${present} exists in projectPath but ${missing} does not, so this is a ` +
          `half-present project rather than an empty folder, and project_create never ` +
          `overwrites. Restore ${missing} from wherever it went — a backup, an export, ` +
          `or version control — or start the new project in a different, empty folder. ` +
          keepWarning,
      );
    }

    // A project cannot come into being inside another project's folder — the
    // viewer watches one folder, and a write one level down reads to a
    // tester as lost files (issue #1317 bug 2, issue #1869). Checked after
    // the two exists-refusals above so a half-present project still gets its
    // own, more actionable message.
    const ancestor = await findNestingAncestor(projectPath);
    if (ancestor) {
      throw new ProjectCreateError(
        `${ancestor} is already a research project, and a project cannot be nested inside ` +
          `one. Create this project outside it, or add to the existing project at ` +
          `${ancestor} with research_append.`,
      );
    }

    if (noPerson) {
      const stamp = today();
      const title = input.title ? input.title.trim() : "";
      const tree = { persons: [], relationships: [], sources: [] };
      const research: Record<string, unknown> = {
        project: {
          id: "rp_001",
          objective,
          ...(title ? { title } : {}),
          subject_person_ids: [],
          status: "active",
          created: stamp,
          updated: stamp,
        },
      };
      for (const section of EMPTY_SECTIONS) research[section] = [];
      research.researcher_profile = { ...HOUSE_RESEARCHER_PROFILE };
      const validation = await validateParsed(research, tree, { projectPath });
      if (!validation.valid) return { ok: false, errors: formatIssues(validation.errors) };
      await atomicWriteBoth(projectPath, [
        { ref: "tree.gedcomx.json", data: tree },
        { ref: "research.json", data: research },
        { ref: "starting-tree.gedcomx.json", data: tree },
      ]);
      return {
        ok: true,
        projectId: "rp_001",
        filesWritten: ["tree.gedcomx.json", "research.json", "starting-tree.gedcomx.json"],
        objective,
        ...(title ? { title } : {}),
        subject: null,
        note:
          "This project has no person: it holds an objective and an empty tree. Research on a " +
          "person does not run here; it starts a new project from a FamilySearch person ID.",
        validation: { valid: true, warnings: formatIssues(validation.warnings) },
      };
    }

    const now = new Date();
    let built: BuiltTree;
    let outcome: PersonReadOutcome;
    try {
      // Every refusal that needs no network has passed, so the read is only
      // ever spent on a create that can happen.
      outcome = await deps.readPerson(
        pid,
        { projectPath, deadline: start + OCR_PHASE_BUDGET_MS, relativeSourcesFirst: true },
        principal,
      );
      built = await buildFromStagedRead({
        staged: { personId: outcome.resolvedId, requestedId: pid, gedcomx: outcome.result as never },
        subjectPersonIds: input.subjectPersonIds,
        now,
      });
    } catch (e) {
      if (e instanceof TreeBuildError) throw new ProjectCreateError(e.message);
      throw e;
    }
    const { tree, idMap, subjectPersonIds } = built;
    const loopNotes = built.droppedLoopEdges.map(loopNote);
    const refWarnings: string[] = [...loopNotes];

    // `assertion_id` is stamped by `materialize_facts`, never supplied. This
    // tool copies the read's facts as given, and the document validator type-
    // checks the field but cannot know it was forged — so without this a
    // backlink in a read would persist into BOTH tree.gedcomx.json and the
    // write-once starting-tree baseline, after which an assertion correction
    // rewrites a fact from an assertion it never came from. `tree_edit` refuses
    // the same thing on its four paths; a seeding tree has no assertions to
    // point at, so nothing legitimate carries one.
    // A relationship is described by its type and endpoints.
    const describe = (holder: Record<string, unknown>) => {
      const id = String(holder.id ?? "(unnamed)");
      if (!("type" in holder) || "names" in holder) return id;
      const ends = ["parent", "child", "person1", "person2"]
        .filter((k) => typeof holder[k] === "string")
        .map((k) => `${k} ${holder[k] as string}`);
      return `${id} (${String(holder.type)}, ${ends.join(", ")})`;
    };
    const forged: string[] = [];
    for (const holder of [...tree.persons, ...tree.relationships]) {
      const facts = (holder as { facts?: unknown })?.facts;
      for (const fact of Array.isArray(facts) ? facts : []) {
        if (fact && typeof fact === "object" && "assertion_id" in fact) {
          forged.push(describe(holder as Record<string, unknown>));
        }
      }
    }
    if (forged.length > 0) {
      throw new ProjectCreateError(
        `the starting tree carries \`assertion_id\` on a fact of ${[...new Set(forged)].join(", ")} — ` +
          "that field is the backlink `materialize_facts` stamps on a fact it mints from a " +
          "research.json assertion, and a tree seeded here has no assertions to point at. " +
          "Remove it; materialize the evidence once the project exists.",
      );
    }

    // An objective written before the read can name the subject only by the
    // ID it was given; the read supplies the name.
    const subject = tree.persons.find((p) => p?.id === idMap.persons[outcome.resolvedId]);
    const ids = [...new Set([pid, outcome.resolvedId])];
    const storedObjective = nameForId(objective, ids, displayName(subject));
    const storedTitle = input.title ? nameForId(input.title, ids, displayName(subject)) : input.title;
    const verifyRequest =
      typeof input.verifyRequest === "string" && input.verifyRequest.trim() !== ""
        ? nameForId(input.verifyRequest.trim(), ids, displayName(subject))
        : undefined;

    const stamp = today();
    const research: Record<string, unknown> = {
      project: {
        id: "rp_001",
        objective: storedObjective,
        ...(storedTitle ? { title: storedTitle } : {}),
        ...(verifyRequest ? { verify_request: verifyRequest } : {}),
        subject_person_ids: subjectPersonIds,
        status: "active",
        created: stamp,
        updated: stamp,
      },
    };
    for (const section of EMPTY_SECTIONS) research[section] = [];
    research.researcher_profile = { ...HOUSE_RESEARCHER_PROFILE };
    const memorySources = memorySourcesFor(outcome, idMap, tree, now, projectPath);
    research.sources = memorySources;

    // Validate the PAIR. This is what makes taking the tree here worthwhile:
    // `subject_person_ids` pointing at a person the tree does not contain is a
    // hard error, and checking it now means the caller never has to sequence
    // two writes correctly.
    const validation = await validateParsed(research, tree, { projectPath });
    if (!validation.valid) {
      return { ok: false, errors: formatIssues(validation.errors) };
    }

    // Last, so no refusal above ever waits on it. It only adds a
    // `standard_place` string to a fact that had none, which validation
    // already admits.
    // What the call budget has left, so the read and the retry together stay
    // under the bridge's abort.
    await built.fillPlaces(Math.max(0, Math.min(PLACE_RETRY_BUDGET_MS, start + CALL_BUDGET_MS - Date.now())));
    const unresolvedPlaces = unresolvedPlacesOf(factsOf(tree));
    if (unresolvedPlaces.length > 0) {
      refWarnings.push(`Places kept as written, with no standard place found: ${unresolvedPlaces.join("; ")}.`);
    }
    for (const m of divisionMismatchesOf(factsOf(tree))) {
      refWarnings.push(
        `Place '${m.place}' names one state or province but its standard place '${m.standardPlace}' lies in another ` +
          "(FamilySearch's own value when it came with the tree read): check it before relying on it for a place search.",
      );
    }
    // The fill can take seconds, so check again that no other create landed
    // while it ran: create never overwrites.
    for (const ref of ["research.json", "tree.gedcomx.json"]) {
      if (await fileExists(projectPath, ref)) {
        throw new ProjectCreateError(
          `${ref} appeared in projectPath while this project was being created, so another ` +
            "create finished first. project_create never overwrites; use research_append and " +
            "the tree tools to add to the project that is there.",
        );
      }
    }

    await atomicWriteBoth(projectPath, [
      { ref: "tree.gedcomx.json", data: tree },
      { ref: "research.json", data: research },
      { ref: "starting-tree.gedcomx.json", data: tree },
    ]);

    const warnings = [...refWarnings, ...formatIssues(validation.warnings)];
    return summarize({
      outcome,
      tree,
      relativeSourcesSkipped: treeIdsOf(outcome.relativeSourcesSkipped ?? [], idMap),
      subjectId: idMap.persons[outcome.resolvedId],
      objective: storedObjective,
      ...(storedTitle ? { title: storedTitle } : {}),
      memorySourceCount: memorySources.length,
      loopNotes,
      warnings,
    });
  } catch (e) {
    if (e instanceof ProjectCreateError) return { ok: false, errors: [e.message] };
    return { ok: false, errors: [e instanceof Error ? e.message : String(e)] };
  }
}

/**
 * The classification a memory source is written with, from what the memory is,
 * and the note saying so. A DEFAULT, not a judgement: the text is not examined
 * here, and nothing downstream re-classifies a source, so the note travels with
 * the entry for the conflict and proof steps that weigh it.
 */
export function memoryClassification(kind: MemoryKind): {
  source_classification: "authored" | "original";
  note: string;
} {
  const source_classification = kind === "story" ? "authored" : "original";
  return {
    source_classification,
    note:
      `Classified ${source_classification} from the memory's type (${kind === "story" ? "a story" : "a scanned document"}) ` +
      "when the project was created; its text was not examined. A transcription or abstract " +
      "of another record is derivative.",
  };
}

/**
 * One `research.json` source for each memory of the subject that came back
 * transcribed. A memory with no `text` gets none: an entry would assert it was
 * examined. Fields the memory's metadata cannot supply carry
 * `MEMORY_DETAIL_UNKNOWN`. `transcription_truncated` is derived from the OCR
 * cap store, as `research_append` derives it, never asserted.
 */
function memorySourcesFor(
  outcome: PersonReadOutcome,
  idMap: IdMap,
  tree: { persons: unknown[] },
  now: Date,
  projectPath: string,
): Record<string, unknown>[] {
  const subjectPid = outcome.resolvedId;
  const subject = (tree.persons as Record<string, any>[]).find((p) => p?.id === idMap.persons[subjectPid]);
  const subjectName = displayName(subject);
  const accessed = accessDate(now);
  const iso = today();
  const out: Record<string, unknown>[] = [];
  for (const src of outcome.result.sources) {
    const kind = outcome.memoryKinds[src.id];
    const sId = idMap.sources[src.id];
    if (!kind || !sId || typeof src.text !== "string" || src.text.trim() === "") continue;
    const url = src.url ?? `https://www.familysearch.org/memories/${src.id}`;
    const { source_classification, note } = memoryClassification(kind);
    const image = typeof src.image_ref === "string" && src.image_ref !== "" ? src.image_ref : undefined;
    out.push({
      id: `src_${String(out.length + 1).padStart(3, "0")}`,
      gedcomx_source_description_id: sId,
      citation:
        `"${src.title}," ${kind === "story" ? "story" : "digital image"}, FamilySearch Memories ` +
        `(${url} : accessed ${accessed}), memory ${src.id}, uploaded to the profile of ` +
        `${subjectName} (${subjectPid}).`,
      citation_detail: {
        ...MEMORY_DETAIL_UNKNOWN,
        when_accessed: iso,
        where: "FamilySearch Memories",
        where_within: `memory ${src.id}`,
      },
      source_classification,
      repository: "FamilySearch Memories",
      access_date: iso,
      url,
      notes: note,
      transcription: src.text,
      ...(image ? { image_filename: image } : {}),
      ...(image && sourceImageCapState(projectPath, image) ? { transcription_truncated: true } : {}),
    });
  }
  return out;
}

/** How a person relates to the subject, from the tree's own edges. */
function relationTo(
  subjectId: string,
  person: Record<string, any>,
  relationships: Record<string, any>[],
): SummaryPerson["relationship"] {
  const id = person.id;
  const parentsOf = (child: string) =>
    new Set(relationships.filter((r) => r.type === "ParentChild" && r.child === child).map((r) => r.parent));
  if (relationships.some((r) => r.type === "Couple" && [r.person1, r.person2].includes(subjectId) && [r.person1, r.person2].includes(id))) return "spouse";
  if (parentsOf(subjectId).has(id)) {
    return person.gender === "Male" ? "father" : person.gender === "Female" ? "mother" : "parent";
  }
  if (parentsOf(id).has(subjectId)) return "child";
  const mine = parentsOf(subjectId);
  if ([...parentsOf(id)].some((p) => mine.has(p))) return "sibling";
  return "relative";
}

/**
 * `text` with each mention of the subject by FamilySearch ID — bare, or as
 * "FamilySearch ID <id>" / "person ID <id>" / "ID <id>" — replaced by `name`.
 * A mention in parentheses is an annotation beside a name and is kept, and so
 * is everything when the read gave no name.
 */
export function nameForId(text: string, ids: string[], name: string): string {
  if (!name || name === "Unknown" || ids.length === 0) return text;
  const alt = ids.map((id) => id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const re = new RegExp(
    `(\\(\\s*)?(?<![A-Za-z0-9-])(?:FamilySearch\\s+)?(?:person\\s+)?(?:ID:?\\s+)?(?:${alt})(?![A-Za-z0-9-])`,
    "gi",
  );
  return text.replace(re, (match, paren: string | undefined) => (paren !== undefined ? match : name));
}

/** A fact as one short line: its date and place, whichever it has. */
function factLine(person: Record<string, any> | undefined, type: string): string | undefined {
  const f = (Array.isArray(person?.facts) ? person!.facts : []).find((x: any) => x?.type === type);
  const line = [f?.date, f?.place].filter((v) => typeof v === "string" && v !== "").join(", ");
  return line || undefined;
}

/**
 * The `personId` mode's answer, held under `SUMMARY_MAX_CHARS`. Over the cap,
 * whole entries are dropped from the end of the longest list, one at a time,
 * and each list's loss is counted in `omitted` — never cut mid-entry. Every
 * person stays findable afterwards in the project tree.
 */
function summarize(args: {
  outcome: PersonReadOutcome;
  tree: { persons: Record<string, any>[]; relationships: Record<string, any>[]; sources: unknown[] };
  relativeSourcesSkipped: string[];
  subjectId: string;
  objective: string;
  title?: string;
  memorySourceCount: number;
  loopNotes: string[];
  warnings: string[];
}): ProjectCreateSummary {
  const { outcome, tree, subjectId, memorySourceCount } = args;
  const subject = tree.persons.find((p) => p.id === subjectId);
  const memories = outcome.result.sources.filter((s) => outcome.memoryKinds[s.id]);
  const lists = {
    subjectSources: attachedSources(tree, subjectId),
    relatives: tree.persons
      .filter((p) => p.id !== subjectId)
      .map((p): SummaryPerson => ({ id: p.id, name: displayName(p), relationship: relationTo(subjectId, p, tree.relationships) })),
    transcribed: memories.filter((m) => typeof m.text === "string" && m.text.trim() !== "").map((m) => m.title),
    notTranscribed: memories.filter((m) => !(typeof m.text === "string" && m.text.trim() !== "")).map((m) => m.title),
    // First: the trimmer drops a list's last entry first.
    notes: [...args.loopNotes, ...(Array.isArray(outcome.result.notes) ? outcome.result.notes : [])],
    warnings: [...args.warnings],
  };
  const omitted: NonNullable<ProjectCreateSummary["omitted"]> = {};
  const build = (): ProjectCreateSummary => ({
    ok: true,
    projectId: "rp_001",
    filesWritten: ["tree.gedcomx.json", "research.json", "starting-tree.gedcomx.json"],
    subject: {
      id: subjectId,
      familySearchId: outcome.resolvedId,
      name: displayName(subject),
      ...(factLine(subject, "Birth") ? { birth: factLine(subject, "Birth") } : {}),
      ...(factLine(subject, "Death") ? { death: factLine(subject, "Death") } : {}),
    },
    objective: args.objective,
    ...(args.title ? { title: args.title } : {}),
    relatives: lists.relatives,
    subjectSources: lists.subjectSources,
    counts: {
      persons: tree.persons.length,
      relationships: tree.relationships.length,
      sources: tree.sources.length,
      memorySources: memorySourceCount,
    },
    memories: { transcribed: lists.transcribed, notTranscribed: lists.notTranscribed },
    ...(args.relativeSourcesSkipped.length ? { relativeSourcesSkipped: args.relativeSourcesSkipped } : {}),
    ...(lists.notes.length ? { notes: lists.notes } : {}),
    ...(Object.keys(omitted).length ? { omitted: { ...omitted } } : {}),
    validation: { valid: true, warnings: lists.warnings },
  });
  let summary = build();
  // Trimmed in this order, the last entry first: what the caller reads least,
  // up to the relatives, and among those only a child, sibling or other
  // relative. A parent or a spouse is never dropped, so a pathological family
  // can leave the summary over the cap.
  type Trimmed = Exclude<keyof typeof lists, "subjectSources">;
  const order: Trimmed[] = ["warnings", "notes", "notTranscribed", "transcribed", "relatives"];
  const lastDroppable = (key: Trimmed): number => {
    const list = lists[key] as unknown[];
    if (key !== "relatives") return list.length - 1;
    for (let i = list.length - 1; i >= 0; i--) {
      if (!NEVER_TRIMMED.has((list[i] as SummaryPerson).relationship)) return i;
    }
    return -1;
  };
  while (JSON.stringify(summary).length > SUMMARY_MAX_CHARS) {
    const key = order.find((k) => lastDroppable(k) >= 0);
    if (!key) break;
    (lists[key] as unknown[]).splice(lastDroppable(key), 1);
    omitted[key] = (omitted[key] ?? 0) + 1;
    summary = build();
  }
  return summary;
}

/** The tree ids of `pids`, each once, in order; a PID the tree does not hold is left out. */
function treeIdsOf(pids: string[], idMap: IdMap): string[] {
  return [...new Set(pids.map((pid) => idMap.persons[pid]).filter((id): id is string => typeof id === "string"))];
}

/** A source as the tree dedupes it: the fields a tree source keeps, less its id. */
function sourceKey(src: Record<string, unknown>): string {
  const { id: _id, ...rest } = pickSourceFields(src);
  return JSON.stringify(Object.keys(rest).sort().map((k) => [k, rest[k]]));
}

/**
 * The `fillRelativeSources` mode: read the attached sources of tree persons the
 * create could not read, and merge them into the existing tree as the create's read
 * would have — a description the tree already holds is cited again, not copied, and
 * each is cited at person level on the person it is attached to. Writes the tree
 * (and the starting tree when it is still the opening tree), never research.json.
 */
async function fillRelativeSources(
  input: ProjectCreateInput,
  deps: ProjectCreateDeps,
  principal: Principal,
  start: number,
): Promise<ProjectCreateResult> {
  const { projectPath } = input;
  const extra = (["personId", "objective", "title", "subjectPersonIds"] as const).filter((k) => input[k] !== undefined);
  if (extra.length > 0) {
    throw new ProjectCreateError(
      `fillRelativeSources reads into an existing project and creates nothing, so it takes ` +
        `only projectPath; remove ${extra.join(", ")}.`,
    );
  }
  const asked = coerceJsonArg(input.fillRelativeSources);
  if (!Array.isArray(asked) || asked.length === 0 || asked.some((v) => typeof v !== "string" || v.trim() === "")) {
    throw new ProjectCreateError(
      "fillRelativeSources must be a non-empty array of tree person ids, as the create's " +
        "relativeSourcesSkipped lists them (e.g. [\"I4\", \"I7\"]).",
    );
  }
  const ids = [...new Set((asked as string[]).map((v) => v.trim()))];
  const fetchSources = deps.fetchRelativeSources;
  if (!fetchSources) {
    throw new ProjectCreateError("fillRelativeSources cannot read FamilySearch here; nothing was written.");
  }
  const load = async (ref: string): Promise<any> => {
    try {
      return await readProjectJson(projectPath, ref);
    } catch (e) {
      throw new ProjectCreateError(
        `fillRelativeSources adds to an existing project, and ${projectPath} has none it can read ` +
          `(${e instanceof Error ? e.message : String(e)}). Create the project with personId first.`,
      );
    }
  };
  /** Each asked id -> the FamilySearch PID its `ark` names; refuses any that has none. */
  const pidsOf = (tree: any): Map<string, string> => {
    const out = new Map<string, string>();
    const persons: any[] = Array.isArray(tree?.persons) ? tree.persons : [];
    const bad: string[] = [];
    for (const id of ids) {
      const person = persons.find((p) => p?.id === id);
      const pid = person ? treePidOfArk(person.ark) : undefined;
      if (!pid) bad.push(person ? `${id} (no FamilySearch ark)` : `${id} (not in the tree)`);
      else out.set(id, pid);
    }
    if (bad.length > 0) {
      throw new ProjectCreateError(
        "fillRelativeSources names tree persons with a FamilySearch ark, as relativeSourcesSkipped " +
          `lists them; these are not: ${bad.join(", ")}. Nothing was written.`,
      );
    }
    return out;
  };
  // Every refusal is made before the read, so a refused call spends no network.
  await load("research.json");
  const pids = pidsOf(await load("tree.gedcomx.json"));
  const fetched = await fetchSources([...new Set(pids.values())], principal, start + OCR_PHASE_BUDGET_MS);

  return withProjectLock(projectPath, async (): Promise<ProjectCreateResult> => {
    const research = await load("research.json");
    const tree = await load("tree.gedcomx.json");
    const byPerson = pidsOf(tree);
    const before = structuredClone(tree);
    const persons: any[] = tree.persons;
    if (!Array.isArray(tree.sources)) tree.sources = [];
    const sources: any[] = tree.sources;

    const shaped = new Map(shapeDescriptions(fetched.descriptions).map((s) => [s.id, s]));
    const byKey = new Map<string, string>();
    for (const s of sources) if (typeof s?.id === "string" && !byKey.has(sourceKey(s))) byKey.set(sourceKey(s), s.id);
    const taken = new Set<unknown>(sources.map((s) => s?.id));
    let next = 1;
    const mint = (): string => {
      while (taken.has(`S${next}`)) next++;
      taken.add(`S${next}`);
      return `S${next}`;
    };
    const idsBy = new Map(Object.entries(fetched.idsBy ?? {}).map(([pid, d]) => [pid.toUpperCase(), d]));
    const skippedPids = new Set(fetched.skipped.map((p) => p.toUpperCase()));

    const added = new Set<string>();
    const reused = new Set<string>();
    const filled: FillRelativeSourcesSummary["filled"] = [];
    const stillSkipped: string[] = [];
    for (const [id, pid] of byPerson) {
      if (skippedPids.has(pid.toUpperCase())) {
        stillSkipped.push(id);
        continue;
      }
      const person = persons.find((p) => p?.id === id);
      let cited = 0;
      for (const descId of idsBy.get(pid.toUpperCase()) ?? []) {
        const src = shaped.get(descId) as unknown as Record<string, unknown> | undefined;
        if (!src) continue;
        const key = sourceKey(src);
        let sId = byKey.get(key);
        if (sId === undefined) {
          sId = mint();
          sources.push({ ...pickSourceFields(src), id: sId });
          byKey.set(key, sId);
          added.add(sId);
        } else if (!added.has(sId)) {
          reused.add(sId);
        }
        const refs: any[] = Array.isArray(person.sources) ? person.sources : [];
        if (!refs.some((r) => r?.ref === sId)) person.sources = [...refs, { ref: sId }];
        cited++;
      }
      filled.push({ id, name: displayName(person), sources: cited });
    }

    const validation = await validateIntroduced({ research, tree: before }, { research, tree }, { projectPath });
    if (!validation.valid) return { ok: false, errors: formatIssues(validation.errors) };

    const filesWritten: string[] = [];
    if (!isDeepStrictEqual(before, tree)) {
      const writes = [{ ref: "tree.gedcomx.json", data: tree }];
      // The opening baseline gets them too while it is still the opening tree: they
      // are what the create's read would have put there.
      if (
        (await fileExists(projectPath, "starting-tree.gedcomx.json")) &&
        isDeepStrictEqual(await load("starting-tree.gedcomx.json"), before)
      ) {
        writes.push({ ref: "starting-tree.gedcomx.json", data: tree });
      }
      await atomicWriteBoth(projectPath, writes);
      filesWritten.push(...writes.map((w) => w.ref));
    }
    return {
      ok: true,
      filesWritten,
      filled,
      sourcesAdded: added.size,
      sourcesReused: reused.size,
      ...(stillSkipped.length ? { relativeSourcesSkipped: stillSkipped } : {}),
      validation: { valid: true, warnings: formatIssues(validation.warnings) },
    };
  });
}

/** The researcher-facing sentence for an edge the build dropped to break a
 *  loop, worded by the loop's size so it never claims a link FamilySearch does
 *  not hold. */
export function loopNote(edge: DroppedLoopEdge): string {
  const name = (n: string, pid: string) => (n === "Unknown" ? `the person with FamilySearch ID ${pid}` : n);
  const parent = name(edge.parentName, edge.parentPid);
  const child = name(edge.childName, edge.childPid);
  const tail = "since a person cannot be their own ancestor.";
  if (edge.cycleLength === 1) {
    return `FamilySearch records ${parent} as their own parent; that link was left out of the tree, ${tail}`;
  }
  if (edge.cycleLength === 2) {
    return `FamilySearch records ${parent} as ${child}'s parent and ${child} as ${parent}'s; the first link was left out of the tree, ${tail}`;
  }
  return `FamilySearch records ${parent} as ${child}'s parent, but also records ${child} as ${parent}'s ancestor; that link was left out of the tree, ${tail}`;
}

export const projectCreateSchema = {
  name: "project_create",
  description:
    "Create a new research project: writes research.json and tree.gedcomx.json together, " +
    "validated against each other, in one atomic write (plus a write-once " +
    "starting-tree.gedcomx.json baseline of the opening tree). This is the ONLY way to bring a " +
    "project into being — the other writer tools all require the files to already exist, " +
    "and writing them directly is blocked.\n" +
    "\n" +
    "Every activity starts a project. For research on a named person, pass `personId` and " +
    "nothing else about the tree. For an activity with no person in it (reading a page, a " +
    "record set's names, a surname survey), omit `personId` and pass the researcher's request " +
    "as `objective`: the project holds an objective and an empty tree. This tool " +
    "reads the person, their relatives and sources, and their transcribed memories itself; " +
    "do not call person_read first. It writes the starting tree, the house researcher " +
    "profile, and one research.json source per transcribed memory, and returns a summary: " +
    "the subject, the objective and title as stored, each relative with their tree id and " +
    "relationship, and which memories were and were not transcribed. Add a person the " +
    "researcher named who is not among the relatives afterwards. `subjectPersonIds` takes " +
    "FamilySearch IDs, and defaults to the person read. Research on a named person with no " +
    "ID creates nothing: ask the researcher for the ID first. A project with no person " +
    "refuses research questions.\n" +
    "\n" +
    "When the summary carries `relativeSourcesSkipped`, call this tool once more with only " +
    "`projectPath` and `fillRelativeSources` set to that list: it reads those relatives' " +
    "attached sources into the project's tree and reports anyone still unread.\n" +
    "\n" +
    "Refuses if either file already exists; it never overwrites a project. It writes the " +
    "fixed house `researcher_profile`; it does NOT write subscriptions — add those " +
    "afterwards with research_append, only from what the researcher actually told you.\n" +
    "\n" +
    "Tell the user the project was created and where, naming the folder.",
  inputSchema: {
    type: "object",
    properties: {
      projectPath: {
        type: "string",
        description:
          "Absolute path to the project directory. Create the project in the folder you " +
          "were given — never in a subfolder of it.",
      },
      objective: {
        type: "string",
        description:
          "What this project sets out to find out, in the researcher's terms. Required " +
          "and non-empty. Written once and never rewritten — every later step plans " +
          "against it. Name the subject by their ID if you do not know their name: each " +
          "mention is stored as the name the read gives. Required to create; never with " +
          "`fillRelativeSources`.",
      },
      title: {
        type: "string",
        description:
          "Concise 3-6 word session name (e.g. \"KWCJ-RN4's parents\", stored as \"Patrick " +
          "Flynn's parents\"). A mention of the subject by ID is named as the objective's is.",
      },
      verifyRequest: {
        type: "string",
        description:
          "With personId: the researcher's own words asking to verify one particular " +
          "relationship, fact or source of the subject, or saying one is wrong (\"verify his " +
          "parents\", \"his birth date is wrong\"). Stored as project.verify_request; the first " +
          "question's turn removes that conclusion as a clean slate. Omit when the message names " +
          "nothing in particular to verify.",
      },
      subjectPersonIds: {
        type: "array",
        items: { type: "string" },
        description:
          "The research subject(s), as FamilySearch IDs from the read. Defaults to the person read.",
      },
      personId: {
        type: "string",
        description:
          "The subject's FamilySearch person ID (e.g. \"KWCJ-RN4\"). This tool reads the " +
          "person and builds the starting tree from the read; it requires a FamilySearch " +
          "login. Omit it only for an activity with no person in it, or with fillRelativeSources.",
      },
      fillRelativeSources: {
        type: "array",
        items: { type: "string" },
        description:
          "Only for a project this tool already created: the tree ids its summary listed in " +
          "`relativeSourcesSkipped`. Reads those relatives' attached FamilySearch sources into " +
          "tree.gedcomx.json, a source already in the tree cited rather than copied. Pass with " +
          "`projectPath` alone; it creates nothing and writes nothing to research.json.",
      },
    },
    required: ["projectPath"],
  },
};

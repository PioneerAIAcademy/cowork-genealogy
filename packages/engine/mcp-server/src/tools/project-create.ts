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
// WHY IT TAKES THE TREE RATHER THAN CREATING AN EMPTY ONE. `subject_person_ids`
// naming a person absent from `tree.gedcomx.json` is a hard validator error, so
// a header-only create followed by separate tree writes has an ordering
// constraint that has to be got right every time. Taking both together makes
// the pair atomic and validates them against each other in one pass — there is
// no window in which the project is inconsistent, and no order to remember.
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
} from "../utils/project-io.js";
import { validateParsed } from "../validation/validator.js";
import { listStagedEnvelopes, type StagingEnvelope } from "../utils/results-staging.js";
import { sourceImageCapState } from "../utils/image-store.js";
import {
  OCR_PHASE_BUDGET_MS,
  readPerson,
  type MemoryKind,
  type PersonReadOutcome,
} from "./person-read.js";
import type { Principal } from "../auth/principal.js";
import {
  PLACE_RETRY_BUDGET_MS,
  TreeBuildError,
  accessDate,
  buildFromStagedRead,
  buildTreeEvidence,
  displayName,
  factsOf,
  normalizeHandBuilt,
  retryUnresolvedPlaces,
  type IdMap,
  type FilledPlace,
  type StagedPersonRead,
  type TreeEvidence,
} from "../utils/person-read-tree.js";
import { treePidOfArk } from "../utils/ark.js";
import type { SimplifiedFact } from "../types/gedcomx.js";
import { PERSON_READ_REF_REMOVED } from "../utils/tool-hint-messages.js";

/** The sections a new project starts with, all empty (`sources` aside, which
 *  holds the subject's transcribed memories when the person is read here). */
const EMPTY_SECTIONS = [
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
    "tool names or field names. Never write GPS, proof, proved or exhaustive: say genealogy " +
    "standards; call an answer a conclusion when it is well established and a finding " +
    "otherwise; say what we searched and what we could not reach. Do not describe your own " +
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
  subjectPersonIds?: string[];
  /** A FamilySearch person ID. When set, this tool reads the person and builds
   *  the starting tree from the read; `tree` is refused beside it. */
  personId?: string;
  /** Removed (issue #3384): refused by name, so a caller built against the old
   *  contract is told to pass `personId` rather than falling into the
   *  hand-built path. */
  personReadRef?: unknown;
  tree?: {
    persons?: unknown[];
    relationships?: unknown[];
    sources?: unknown[];
  };
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
  counts: { persons: number; relationships: number; sources: number; memorySources: number };
  memories: { transcribed: string[]; notTranscribed: string[] };
  /** The read's own notes (a relative FamilySearch names but does not describe). */
  notes?: string[];
  /** How many entries each list lost to the size cap; absent when none did. */
  omitted?: Partial<Record<"relatives" | "transcribed" | "notTranscribed" | "notes" | "warnings", number>>;
  validation: { valid: true; warnings: string[] };
}

export type ProjectCreateResult =
  | ProjectCreateSummary
  | {
      ok: true;
      projectId: string;
      filesWritten: string[];
      counts: { persons: number; relationships: number; sources: number };
      /** Which tree ids the create assigned: FamilySearch PIDs and source ids
       *  to `I`/`S` ids, and addition labels to their `I` ids. */
      idMap: IdMap;
      /** Places the read left without a `standard_place` that this create
       *  resolved; absent when there were none. */
      placesFilled?: FilledPlace[];
      validation: { valid: true; warnings: string[] };
    }
  | { ok: false; errors: string[] };

class ProjectCreateError extends Error {}

/** What `runProjectCreate` reads FamilySearch through. A function parameter,
 *  not a schema field or an env var, so no model can reach it; the eval mock
 *  injects a reader that serves a canned `person_read` (the
 *  `runExtractionAppend` precedent). */
export interface ProjectCreateDeps {
  readPerson: (
    personId: string,
    opts: { projectPath?: string; deadline?: number },
    principal: Principal,
  ) => Promise<PersonReadOutcome>;
}

const DEFAULT_DEPS: ProjectCreateDeps = { readPerson };

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

    const objective = typeof input.objective === "string" ? input.objective.trim() : "";
    if (!objective) {
      throw new ProjectCreateError(
        "objective is required and must be non-empty — a project is the pursuit of a " +
          "stated question, and every later step plans against it. Ask the researcher " +
          "what they want to find out before creating anything.",
      );
    }

    // The opening tree, copied write-once alongside the two live documents. The
    // tree-encoding completion gate (issue #1490) diffs the final tree against
    // this baseline to tell a conclusion this session encoded from a fact that
    // was already seeded. research_append loads only the CURRENT tree, so without
    // a persisted baseline it cannot make that distinction. Written from the same
    // final tree (built from the read, or the hand-built one), in the same atomic
    // write, so the baseline is the opening tree exactly and never diverges.

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

    // A collection that is present but not an array is refused, never read as
    // empty: dropping it would write a tree missing what the caller sent. `null`
    // means none, as an absent key does.
    if (input.tree != null && (typeof input.tree !== "object" || Array.isArray(input.tree))) {
      throw new ProjectCreateError(
        `tree must be an object with persons, relationships and sources; got ${JSON.stringify(input.tree)}.`,
      );
    }
    for (const key of ["persons", "relationships", "sources"] as const) {
      const v = (input.tree as Record<string, unknown> | undefined)?.[key];
      if (v != null && !Array.isArray(v)) {
        throw new ProjectCreateError(`tree.${key} must be an array of objects; got ${JSON.stringify(v)}.`);
      }
    }
    const given = {
      persons: input.tree?.persons ?? [],
      relationships: input.tree?.relationships ?? [],
      sources: input.tree?.sources ?? [],
    };
    let pid: string | undefined;
    if (input.personId !== undefined) {
      if (typeof input.personId !== "string" || input.personId.trim() === "") {
        throw new ProjectCreateError(
          `personId must be a FamilySearch person ID such as "KWCJ-RN4"; got ${JSON.stringify(input.personId)}.`,
        );
      }
      pid = input.personId.trim();
      if (given.persons.length + given.relationships.length + given.sources.length > 0) {
        throw new ProjectCreateError(
          "tree cannot be passed with personId: the starting tree is built from the read. Create " +
            "the project with personId alone; this call returns each relative with their tree id, " +
            "and a person the researcher named who is not among them is added afterwards with " +
            "tree-edit.",
        );
      }
    }
    const now = new Date();
    let tree: { persons: unknown[]; relationships: unknown[]; sources: unknown[] };
    let idMap: IdMap;
    let subjectPersonIds: unknown = input.subjectPersonIds;
    let fillPlaces: (extra?: SimplifiedFact[], budgetMs?: number) => Promise<FilledPlace[]> = (
      extra = [],
      budgetMs,
    ) => retryUnresolvedPlaces(extra, budgetMs);
    let handFacts: Record<string, unknown>[];
    const refWarnings: string[] = [];
    let treeCited = { facts: 0, relationships: 0 };
    // The staged person_reads, listed once and only when something needs them:
    // the PID fallback, or a hand-entered person carrying a FamilySearch ark,
    // whose unsourced facts and relationships are cited by what the reads hold
    // (issue #3384). With no such person nothing hand-entered can match a read
    // except a new edge between two staged persons, and that stays the
    // researcher's statement: an under-claim, never an over-claim.
    let listed: Promise<StagedPersonReadFile[]> | undefined;
    const stagedReads = () => (listed ??= listStagedPersonReads(projectPath));
    const evidence = async (): Promise<TreeEvidence> =>
      buildTreeEvidence((await stagedReads()).map((f) => f.read));
    let outcome: PersonReadOutcome | undefined;
    try {
      if (pid !== undefined) {
        // Every refusal that needs no network has passed, so the read is only
        // ever spent on a create that can happen.
        outcome = await deps.readPerson(
          pid,
          { projectPath, deadline: start + OCR_PHASE_BUDGET_MS },
          principal,
        );
        const built = await buildFromStagedRead({
          staged: { personId: outcome.resolvedId, requestedId: pid, gedcomx: outcome.result as never },
          subjectPersonIds: input.subjectPersonIds,
          now,
        });
        tree = built.tree;
        idMap = built.idMap;
        subjectPersonIds = built.subjectPersonIds;
        fillPlaces = built.fillPlaces;
        // A read's facts are FamilySearch's; nothing in it was entered by hand.
        handFacts = [];
      } else {
        ({ tree, idMap, treeCited } = normalizeHandBuilt(
          given,
          now,
          input.subjectPersonIds,
          given.persons.some(hasTreeArk) ? await evidence() : undefined,
        ));
        handFacts = factsOf(tree);
      }
    } catch (e) {
      if (e instanceof TreeBuildError) throw new ProjectCreateError(e.message);
      throw e;
    }
    if (treeCited.facts + treeCited.relationships > 0) {
      refWarnings.push(
        `${treeCited.facts} fact(s) and ${treeCited.relationships} relationship(s) with no source were ` +
          `cited to ${idMap.familySearchTreeSource}, the FamilySearch Family Tree: a staged person_read holds each of them exactly.`,
      );
    }

    // A hand-entered place is standardized here, by the resolver person_read
    // and tree_edit use, never taken from the caller: a value no place
    // authority returned is a claim FamilySearch did not make, and a model
    // told to call place_search first skipped it often enough to invent one.
    // Cleared on every hand-entered fact, not only those with a place: one with
    // no place has nothing to resolve, so a value there could only be invented.
    const hasPlace = (f: Record<string, unknown>) => typeof f.place === "string" && f.place.trim() !== "";
    const placed = handFacts.filter(hasPlace) as unknown as SimplifiedFact[];
    const supplied = new Map<Record<string, unknown>, unknown>();
    for (const f of handFacts) {
      if (f.standard_place != null) supplied.set(f, f.standard_place);
      delete f.standard_place;
    }
    const fillAll = async () => {
      // What the call budget has left, so the read and the retry together stay
      // under the bridge's abort.
      const budget = Math.min(PLACE_RETRY_BUDGET_MS, start + CALL_BUDGET_MS - Date.now());
      const filled = await fillPlaces(placed, Math.max(0, budget));
      for (const [f, was] of supplied) {
        const resolved = f.standard_place;
        if (resolved === was) continue;
        refWarnings.push(
          !hasPlace(f)
            ? `standard_place ${JSON.stringify(was)} on a ${String(f.type ?? "")} fact with no place was ` +
                "not kept: project_create standardizes a hand-entered place itself, from the fact's place"
            : resolved === undefined
              ? `standard_place ${JSON.stringify(was)} for '${f.place}' was not kept: project_create ` +
                  "standardizes hand-entered places itself, and could not standardize this one"
              : `standard_place ${JSON.stringify(was)} for '${f.place}' was replaced by '${resolved}': ` +
                  "project_create standardizes hand-entered places itself",
        );
      }
      return filled;
    };

    // `assertion_id` is stamped by `materialize_facts`, never supplied. This
    // tool writes the caller's facts as given (staged or added), and the document validator type-
    // checks the field but cannot know it was forged — so without this it is the
    // one unguarded fact write path, and a forged backlink would persist into
    // BOTH tree.gedcomx.json and the write-once starting-tree baseline, after
    // which an assertion correction rewrites a hand-entered fact from an
    // assertion it never came from. `tree_edit` refuses the same thing on its
    // four paths; a seeding tree (a FamilySearch snapshot, a hand-built stub)
    // has no assertions to point at, so nothing legitimate carries one.
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
    let storedObjective = objective;
    let storedTitle = input.title;
    if (outcome) {
      const subject = (tree.persons as Record<string, any>[]).find((p) => p?.id === idMap.persons[outcome!.resolvedId]);
      const ids = [...new Set([pid as string, outcome.resolvedId])];
      storedObjective = nameForId(objective, ids, displayName(subject));
      if (storedTitle) storedTitle = nameForId(storedTitle, ids, displayName(subject));
    }

    const stamp = today();
    const research: Record<string, unknown> = {
      project: {
        id: "rp_001",
        objective: storedObjective,
        ...(storedTitle ? { title: storedTitle } : {}),
        subject_person_ids: Array.isArray(subjectPersonIds) ? subjectPersonIds : [],
        status: "active",
        created: stamp,
        updated: stamp,
      },
    };
    for (const section of EMPTY_SECTIONS) research[section] = [];
    research.researcher_profile = { ...HOUSE_RESEARCHER_PROFILE };
    const memorySources = outcome ? memorySourcesFor(outcome, idMap, tree, now, projectPath) : [];
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
    const placesFilled = await fillAll();
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
    if (outcome) {
      return summarize({
        outcome,
        tree: tree as { persons: Record<string, any>[]; relationships: Record<string, any>[]; sources: unknown[] },
        subjectId: idMap.persons[outcome.resolvedId],
        objective: storedObjective,
        ...(storedTitle ? { title: storedTitle } : {}),
        memorySourceCount: memorySources.length,
        warnings,
      });
    }
    return {
      ok: true,
      projectId: "rp_001",
      filesWritten: ["tree.gedcomx.json", "research.json", "starting-tree.gedcomx.json"],
      counts: {
        persons: tree.persons.length,
        relationships: tree.relationships.length,
        sources: tree.sources.length,
      },
      idMap,
      ...(placesFilled.length ? { placesFilled } : {}),
      validation: { valid: true, warnings },
    };
  } catch (e) {
    if (e instanceof ProjectCreateError) return { ok: false, errors: [e.message] };
    return { ok: false, errors: [e instanceof Error ? e.message : String(e)] };
  }
}

/** The one person_read a staged envelope holds, or undefined when it holds none. */
function personReadOf(envelope: StagingEnvelope): StagedPersonRead | undefined {
  const payload = envelope.payload as {
    query?: { personId?: unknown };
    results?: Array<{ personId?: unknown; gedcomx?: unknown }>;
  };
  const element = payload.results?.[0];
  if (!element || typeof element.personId !== "string" || !element.gedcomx) return undefined;
  return {
    personId: element.personId,
    requestedId: typeof payload.query?.personId === "string" ? payload.query.personId : element.personId,
    gedcomx: element.gedcomx as never,
  };
}

interface StagedPersonReadFile {
  ref: string;
  read: StagedPersonRead;
}

/** Every staged person_read in the project still inside the TTL, newest first. */
async function listStagedPersonReads(projectPath: string): Promise<StagedPersonReadFile[]> {
  const out: StagedPersonReadFile[] = [];
  for (const { ref, envelope } of await listStagedEnvelopes(projectPath, "person_read")) {
    const read = personReadOf(envelope);
    if (read) out.push({ ref, read });
  }
  return out;
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
  subjectId: string;
  objective: string;
  title?: string;
  memorySourceCount: number;
  warnings: string[];
}): ProjectCreateSummary {
  const { outcome, tree, subjectId, memorySourceCount } = args;
  const subject = tree.persons.find((p) => p.id === subjectId);
  const memories = outcome.result.sources.filter((s) => outcome.memoryKinds[s.id]);
  const lists = {
    relatives: tree.persons
      .filter((p) => p.id !== subjectId)
      .map((p): SummaryPerson => ({ id: p.id, name: displayName(p), relationship: relationTo(subjectId, p, tree.relationships) })),
    transcribed: memories.filter((m) => typeof m.text === "string" && m.text.trim() !== "").map((m) => m.title),
    notTranscribed: memories.filter((m) => !(typeof m.text === "string" && m.text.trim() !== "")).map((m) => m.title),
    notes: Array.isArray(outcome.result.notes) ? [...outcome.result.notes] : [],
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
    counts: {
      persons: tree.persons.length,
      relationships: tree.relationships.length,
      sources: tree.sources.length,
      memorySources: memorySourceCount,
    },
    memories: { transcribed: lists.transcribed, notTranscribed: lists.notTranscribed },
    ...(lists.notes.length ? { notes: lists.notes } : {}),
    ...(Object.keys(omitted).length ? { omitted: { ...omitted } } : {}),
    validation: { valid: true, warnings: lists.warnings },
  });
  let summary = build();
  // Trimmed in this order, the last entry first: what the caller reads least,
  // up to the relatives, and among those only a child, sibling or other
  // relative. A parent or a spouse is never dropped, so a pathological family
  // can leave the summary over the cap.
  const order: (keyof typeof lists)[] = ["warnings", "notes", "notTranscribed", "transcribed", "relatives"];
  const lastDroppable = (key: keyof typeof lists): number => {
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

/** A person whose `ark` names a FamilySearch tree person. */
function hasTreeArk(person: unknown): boolean {
  return !!person && typeof person === "object" && !!treePidOfArk((person as { ark?: unknown }).ark);
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
    "From a FamilySearch person: pass `personId` and nothing else about the tree. This tool " +
    "reads the person, their relatives and sources, and their transcribed memories itself; " +
    "do not call person_read first. It writes the starting tree, the house researcher " +
    "profile, and one research.json source per transcribed memory, and returns a summary: " +
    "the subject, the objective and title as stored, each relative with their tree id and " +
    "relationship, and which memories were and were not transcribed. `tree` is refused beside `personId`: add a person the " +
    "researcher named who is not among the relatives afterwards. `subjectPersonIds` takes " +
    "FamilySearch IDs, and defaults to the person read.\n" +
    "\n" +
    "With no FamilySearch person, pass the whole starting tree in the SIMPLIFIED GedcomX " +
    "shape (local `I` ids for persons); missing name/fact/relationship ids are assigned, and " +
    "anything without a source is cited to the researcher's statement, or to the FamilySearch " +
    "Family Tree when a person_read staged in this project holds that exact fact or relationship " +
    "(persons matched by `ark`). `subjectPersonIds` " +
    "names persons in that tree.\n" +
    "\n" +
    "Places: enter every hand-entered place (the whole tree here, or an addition) as the " +
    "researcher stated it and never write `standard_place`; this tool standardizes them " +
    "itself, and replaces or drops any value supplied. `placesFilled` lists each place it " +
    "standardized; tell the researcher about those.\n" +
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
          "against it. With personId, name the subject by that ID if you do not know their " +
          "name: each mention is stored as the name the read gives.",
      },
      title: {
        type: "string",
        description:
          "Concise 3-6 word session name (e.g. \"KWCJ-RN4's parents\", stored as \"Patrick " +
          "Flynn's parents\"). With personId, a mention of the subject by ID is named as the " +
          "objective's is.",
      },
      subjectPersonIds: {
        type: "array",
        items: { type: "string" },
        description:
          "The research subject(s). With personId: FamilySearch IDs (defaults to the person " +
          "read). Without: local tree ids (e.g. [\"I1\"]) that exist in `tree`.",
      },
      personId: {
        type: "string",
        description:
          "The subject's FamilySearch person ID (e.g. \"KWCJ-RN4\"). This tool reads the " +
          "person and builds the starting tree from the read. Requires a FamilySearch login.",
      },
      tree: {
        type: "object",
        description:
          "Only with no personId: the whole starting tree, simplified GedcomX. Refused " +
          "beside personId. Omit for no tree data.",
        properties: {
          persons: { type: "array", items: { type: "object" } },
          relationships: { type: "array", items: { type: "object" } },
          sources: { type: "array", items: { type: "object" } },
        },
      },
    },
    required: ["projectPath", "objective"],
  },
};

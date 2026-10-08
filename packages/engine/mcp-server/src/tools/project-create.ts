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
// WHY IT CAN BUILD THE TREE ITSELF (issue #2944). Re-typing a `person_read` into
// `tree` cost the model about 51 KB of output on a 15-person pedigree, and on a
// 12-person read it spent its whole 32,000-token cap rewriting the tree in
// thinking and never made the call. `personReadRef` names the read `person_read`
// staged host-side, and the tree is built from it here
// (`utils/person-read-tree.ts`); `tree` then carries only additions (stubs).

import {
  atomicWriteBoth,
  fileExists,
  findNestingAncestor,
  formatIssues,
} from "../utils/project-io.js";
import { validateParsed } from "../validation/validator.js";
import { checkStagedResults } from "../utils/results-staging.js";
import {
  TreeBuildError,
  buildFromStagedRead,
  normalizeHandBuilt,
  type IdMap,
  type FilledPlace,
} from "../utils/person-read-tree.js";

/** The sections a new project starts with, all empty. `researcher_profile` and
 *  `known_holdings` are deliberately absent: both are written after the fact,
 *  through `research_append`, from what the researcher actually said. An agent
 *  must never invent a profile — a project was observed created with an
 *  experience level and subscriptions the user was never asked for, and a
 *  fabricated profile is indistinguishable downstream from a real one, while an
 *  absent one has a working fallback in every skill. */
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

export interface ProjectCreateInput {
  projectPath: string;
  objective: string;
  title?: string;
  subjectPersonIds?: string[];
  /** The `staged.resultsRef` `person_read` returned. When set, the starting
   *  tree is built from that read and `tree` carries only additions. */
  personReadRef?: string;
  tree?: {
    persons?: unknown[];
    relationships?: unknown[];
    sources?: unknown[];
  };
}

export type ProjectCreateResult =
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

/** Today as an ISO date (YYYY-MM-DD), matching every other tool's stamp. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function projectCreate(
  input: ProjectCreateInput,
): Promise<ProjectCreateResult> {
  try {
    const { projectPath } = input;
    if (!projectPath || typeof projectPath !== "string") {
      throw new ProjectCreateError("projectPath is required");
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
    // final tree (built from the staged read plus additions, or the hand-built
    // one), in the same atomic write, so the baseline is the opening tree exactly
    // and never diverges, and a stub is in it from the start.

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
    const now = new Date();
    let tree: { persons: unknown[]; relationships: unknown[]; sources: unknown[] };
    let idMap: IdMap;
    let subjectPersonIds: unknown = input.subjectPersonIds;
    let fillPlaces: () => Promise<FilledPlace[]> = async () => [];
    try {
      if (input.personReadRef !== undefined) {
        const staged = await loadStagedRead(projectPath, input.personReadRef);
        const built = await buildFromStagedRead({
          staged,
          additions: given,
          subjectPersonIds: input.subjectPersonIds,
          now,
        });
        tree = built.tree;
        idMap = built.idMap;
        subjectPersonIds = built.subjectPersonIds;
        fillPlaces = built.fillPlaces;
      } else {
        ({ tree, idMap } = normalizeHandBuilt(given, now, input.subjectPersonIds));
      }
    } catch (e) {
      if (e instanceof TreeBuildError) throw new ProjectCreateError(e.message);
      throw e;
    }

    // `assertion_id` is stamped by `materialize_facts`, never supplied. This
    // tool writes the caller's facts as given (staged or added), and the document validator type-
    // checks the field but cannot know it was forged — so without this it is the
    // one unguarded fact write path, and a forged backlink would persist into
    // BOTH tree.gedcomx.json and the write-once starting-tree baseline, after
    // which an assertion correction rewrites a hand-entered fact from an
    // assertion it never came from. `tree_edit` refuses the same thing on its
    // four paths; a seeding tree (a FamilySearch snapshot, a hand-built stub)
    // has no assertions to point at, so nothing legitimate carries one.
    // In ref mode the caller wrote labels and never sees the minted ids, so a
    // refusal past the build names which minted id each addition label became.
    const labelOf = new Map(Object.entries(idMap.additions ?? {}).map(([label, id]) => [id, label]));
    const named = (id: string) =>
      labelOf.has(id) ? `${id} (addition ${JSON.stringify(labelOf.get(id))})` : id;
    // A relationship has no label the caller can recognise, so it is described
    // by its type and endpoints, each endpoint named as above.
    const describe = (holder: Record<string, unknown>) => {
      const id = String(holder.id ?? "(unnamed)");
      if (!("type" in holder) || "names" in holder) return named(id);
      const ends = ["parent", "child", "person1", "person2"]
        .filter((k) => typeof holder[k] === "string")
        .map((k) => `${k} ${named(holder[k] as string)}`);
      return `${id} (${String(holder.type)}, ${ends.join(", ")})`;
    };
    const additionsNote = () => {
      if (input.personReadRef === undefined || labelOf.size === 0) return "";
      const at = [...labelOf].map(([id, label]) => {
        const i = tree.persons.findIndex((p) => (p as { id?: unknown })?.id === id);
        return `${JSON.stringify(label)} is ${id}, persons[${i}]`;
      });
      return ` In the built tree, addition ${at.join("; ")}.`;
    };
    const forged: string[] = [];
    for (const holder of [...tree.persons, ...tree.relationships]) {
      for (const fact of (holder as { facts?: unknown[] })?.facts ?? []) {
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
          "Remove it; materialize the evidence once the project exists." +
          additionsNote(),
      );
    }

    const stamp = today();
    const research: Record<string, unknown> = {
      project: {
        id: "rp_001",
        objective,
        ...(input.title ? { title: input.title } : {}),
        subject_person_ids: Array.isArray(subjectPersonIds) ? subjectPersonIds : [],
        status: "active",
        created: stamp,
        updated: stamp,
      },
    };
    for (const section of EMPTY_SECTIONS) research[section] = [];

    // Validate the PAIR. This is what makes taking the tree here worthwhile:
    // `subject_person_ids` pointing at a person the tree does not contain is a
    // hard error, and checking it now means the caller never has to sequence
    // two writes correctly.
    const validation = await validateParsed(research, tree, { projectPath });
    if (!validation.valid) {
      const errors = formatIssues(validation.errors);
      const note = additionsNote();
      return { ok: false, errors: note ? [...errors, note.trim()] : errors };
    }

    // Last, so no refusal above ever waits on it. It only adds a
    // `standard_place` string to a fact that had none, which validation
    // already admits.
    const placesFilled = await fillPlaces();
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
      validation: { valid: true, warnings: formatIssues(validation.warnings) },
    };
  } catch (e) {
    if (e instanceof ProjectCreateError) return { ok: false, errors: [e.message] };
    return { ok: false, errors: [e instanceof Error ? e.message : String(e)] };
  }
}

/**
 * Read the staged `person_read` envelope. The guards (traversal, staging dir,
 * tool match) are `checkStagedResults`', but its messages speak of
 * `research_log_append` and `stagedResultsRef`, so they are rethrown here in
 * this tool's terms.
 */
async function loadStagedRead(projectPath: string, rawRef: unknown) {
  const redo =
    "call person_read again with projectPath and pass the `staged.resultsRef` it returns as " +
    "personReadRef.";
  if (typeof rawRef !== "string" || rawRef.trim() === "") {
    throw new ProjectCreateError(`personReadRef must be the staged.resultsRef person_read returned; ${redo}`);
  }
  const ref = rawRef.trim();
  let envelope;
  try {
    ({ envelope } = await checkStagedResults({
      projectPath,
      stagedResultsRef: ref,
      expectedTool: "person_read",
    }));
  } catch (e) {
    // Classify on the message with the ref's own text removed, so a ref that
    // happens to contain "invalid JSON" cannot pick the reason.
    const why = (e instanceof Error ? e.message : String(e)).split(ref).join("<ref>");
    const reason = /does not match log entry tool/.test(why)
      ? "was not staged by person_read"
      : /is not inside|escapes the project/.test(why)
        ? "is not under results/.staging/"
        : /could not be read/.test(why)
          ? `exists but could not be read (${why.replace(/^.*could not be read: /, "")})`
          : /is not in results\/\.staging|invalid JSON|no 'results'/.test(why)
            ? "is not a staged read in results/.staging/ (pruned after 24h, or never staged)"
            : "could not be read";
    throw new ProjectCreateError(`personReadRef '${ref}' ${reason}: ${redo}`);
  }
  const payload = envelope.payload as {
    query?: { personId?: unknown };
    results?: Array<{ personId?: unknown; gedcomx?: unknown }>;
  };
  const element = payload.results?.[0];
  if (!element || typeof element.personId !== "string" || !element.gedcomx) {
    throw new ProjectCreateError(`personReadRef '${ref}' holds no person_read result: ${redo}`);
  }
  return {
    personId: element.personId,
    requestedId: typeof payload.query?.personId === "string" ? payload.query.personId : element.personId,
    gedcomx: element.gedcomx as never,
  };
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
    "From a FamilySearch person: pass `personReadRef`, the `staged.resultsRef` person_read " +
    "returned, and the tree is built here from that read (ids, arks, sources). Do not copy " +
    "the read into `tree`. `tree` then holds only ADDITIONS, people the researcher's own " +
    "statements imply (e.g. a maiden name's parent), whose ids are labels; a relationship " +
    "names a person from the read by FamilySearch ID. `subjectPersonIds` takes FamilySearch " +
    "IDs too, and defaults to the person read. The result's `idMap` gives the tree ids " +
    "assigned, and `placesFilled` any place this create standardized that the read had not; " +
    "tell the researcher about those.\n" +
    "\n" +
    "With no FamilySearch person, pass the whole starting tree in the SIMPLIFIED GedcomX " +
    "shape (local `I` ids for persons); missing name/fact/relationship ids are assigned, and " +
    "anything without a source is cited to the researcher's statement. `subjectPersonIds` " +
    "names persons in that tree.\n" +
    "\n" +
    "Refuses if either file already exists; it never overwrites a project. It does NOT " +
    "write `researcher_profile` or `known_holdings` — write those afterwards with " +
    "research_append, from what the researcher actually told you. Never invent a profile: " +
    "an absent one falls back to sane defaults everywhere, a wrong one silently changes " +
    "narration for the life of the project.\n" +
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
          "against it.",
      },
      title: {
        type: "string",
        description: "Concise 3-6 word session name (e.g. \"Patrick Flynn's parents\").",
      },
      subjectPersonIds: {
        type: "array",
        items: { type: "string" },
        description:
          "The research subject(s). With personReadRef: FamilySearch IDs (defaults to the " +
          "person read). Without: local tree ids (e.g. [\"I1\"]) that exist in `tree`.",
      },
      personReadRef: {
        type: "string",
        description:
          "The `staged.resultsRef` person_read returned for the subject. The starting tree " +
          "is built from that read.",
      },
      tree: {
        type: "object",
        description:
          "With personReadRef: additions only (stubs and their relationships). Without: " +
          "the whole starting tree, simplified GedcomX. Omit for no tree data.",
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

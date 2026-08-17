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
// The full→simplified GedcomX conversion stays in the skill, exactly where it
// is today; moving it host-side is a separate change.

import { join } from "path";
import { atomicWriteBoth, fileExists } from "../utils/project-io.js";
import { validateParsed } from "../validation/validator.js";
import { formatIssues } from "./merge-shared.js";

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

    const researchPath = join(projectPath, "research.json");
    const treePath = join(projectPath, "tree.gedcomx.json");

    // Create, not upsert. Overwriting an existing project would destroy an
    // audit trail that cannot be reconstructed, and the caller that wants to
    // add to a project already has the writer tools for it.
    const hasResearch = await fileExists(researchPath);
    const hasTree = await fileExists(treePath);
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

    const tree = {
      persons: Array.isArray(input.tree?.persons) ? input.tree.persons : [],
      relationships: Array.isArray(input.tree?.relationships) ? input.tree.relationships : [],
      sources: Array.isArray(input.tree?.sources) ? input.tree.sources : [],
    };

    const stamp = today();
    const research: Record<string, unknown> = {
      project: {
        id: "rp_001",
        objective,
        ...(input.title ? { title: input.title } : {}),
        subject_person_ids: Array.isArray(input.subjectPersonIds)
          ? input.subjectPersonIds
          : [],
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
      return { ok: false, errors: formatIssues(validation.errors) };
    }

    await atomicWriteBoth([
      { path: treePath, data: tree },
      { path: researchPath, data: research },
    ]);

    return {
      ok: true,
      projectId: "rp_001",
      filesWritten: ["tree.gedcomx.json", "research.json"],
      counts: {
        persons: tree.persons.length,
        relationships: tree.relationships.length,
        sources: tree.sources.length,
      },
      validation: { valid: true, warnings: formatIssues(validation.warnings) },
    };
  } catch (e) {
    if (e instanceof ProjectCreateError) return { ok: false, errors: [e.message] };
    return { ok: false, errors: [e instanceof Error ? e.message : String(e)] };
  }
}

export const projectCreateSchema = {
  name: "project_create",
  description:
    "Create a new research project: writes research.json and tree.gedcomx.json together, " +
    "validated against each other, in one atomic write. This is the ONLY way to bring a " +
    "project into being — the other writer tools all require the files to already exist, " +
    "and writing them directly is blocked.\n" +
    "\n" +
    "Supply the research objective and the starting tree in the SIMPLIFIED GedcomX shape " +
    "(snake_case; top-level `sources`, not `sourceDescriptions`; local `I`/`R`/`S` ids, " +
    "never FamilySearch PIDs). `subjectPersonIds` names persons in that tree — pointing at " +
    "someone the tree does not contain is rejected, which is why both go in one call.\n" +
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
        description: "Absolute path to the (empty) project directory.",
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
          "Local tree ids of the research subject(s) (e.g. [\"I1\"]). Each must exist in " +
          "`tree`.",
      },
      tree: {
        type: "object",
        description:
          "The starting tree, simplified GedcomX. Omit for a project with no tree data " +
          "yet; the file is still created, empty.",
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

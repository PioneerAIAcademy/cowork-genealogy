// A real project in a test's own store, without FamilySearch. `project_create`
// always reads a FamilySearch person, which no offline test can reach, so a test
// that needs a project to exist creates it here: the real tool, run against the
// store the server would bind, with a one-person read injected.
import { LOCAL } from "../../src/auth/principal.js";
import { runWithProjectStore, type ProjectStore } from "../../src/store/project-store.js";
import { runProjectCreate } from "../../src/tools/project-create.js";

/** The FamilySearch id the seeded subject is read under. */
export const SEED_PERSON_ID = "SEED-001";

/** Create a project at `projectPath` in `store` whose one person is given-named
 *  `given`. Throws when the create is refused. */
export async function seedProject(store: ProjectStore, projectPath: string, given: string): Promise<void> {
  const read = {
    persons: [{ id: SEED_PERSON_ID, gender: "Male", names: [{ preferred: true, given, surname: "Person" }] }],
    relationships: [],
    sources: [],
  };
  const result = await runWithProjectStore(store, () =>
    runProjectCreate(
      { projectPath, objective: `Who were ${given}'s parents?`, title: `seed ${given}`, personId: SEED_PERSON_ID },
      { readPerson: async (id) => ({ result: structuredClone(read) as never, resolvedId: id, memoryKinds: {} }) },
      LOCAL,
    ),
  );
  if (!result.ok) throw new Error(`seedProject: ${result.errors.join("; ")}`);
}

/** A `research_log_append` payload whose query names `given`: a write any
 *  existing project accepts, so a test can see whose project it landed in. */
export function logArgs(projectPath: string, given: string): Record<string, unknown> {
  return {
    projectPath,
    tool: "record_search",
    query: { givenName: given },
    outcome: "negative",
    resultsExamined: 0,
    resultsAvailable: 0,
  };
}

// A Family Tree read shaped like the Phipps feedback session: the subject
// Benjamin, his wife Mary, his parents Peyton and Clarisa, and a son. The read
// carries the subject's own family only, so Mary's parents and Peyton's second
// wife are not in it.

import { runProjectCreate } from "../../src/tools/project-create.js";
import { LOCAL } from "../../src/auth/principal.js";

export const PIDS = {
  benjamin: "BBBB-111",
  mary: "MMMM-222",
  peyton: "PPPP-333",
  clarisa: "CCCC-444",
  son: "SSSS-555",
} as const;

const person = (pid: string, given: string, surname: string, gender: string) => ({
  id: pid,
  ark: `ark:/61903/4:1:${pid}`,
  gender,
  living: false,
  names: [{ given, surname, preferred: true }],
  facts: [],
});

export function phippsRead(): any {
  return {
    persons: [
      person(PIDS.benjamin, "Benjamin", "Phipps", "Male"),
      person(PIDS.mary, "Mary L", "Childs", "Female"),
      person(PIDS.peyton, "Peyton Randolph", "Phipps", "Male"),
      person(PIDS.clarisa, "Clarisa", "Davis", "Female"),
      person(PIDS.son, "John", "Phipps", "Male"),
    ],
    relationships: [
      { type: "Couple", person1: PIDS.benjamin, person2: PIDS.mary },
      { type: "Couple", person1: PIDS.peyton, person2: PIDS.clarisa },
      { type: "ParentChild", parent: PIDS.peyton, child: PIDS.benjamin },
      { type: "ParentChild", parent: PIDS.clarisa, child: PIDS.benjamin },
      { type: "ParentChild", parent: PIDS.benjamin, child: PIDS.son },
      { type: "ParentChild", parent: PIDS.mary, child: PIDS.son },
    ],
    sources: [],
  };
}

/** Create a project in `dir` from the Phipps read, as project_create does. */
export async function createPhippsProject(dir: string, subjectPersonIds?: string[]): Promise<void> {
  const read = phippsRead();
  const created = await runProjectCreate(
    {
      projectPath: dir,
      objective: "Who was the extra woman in the 1860 household?",
      title: "Phipps",
      personId: PIDS.benjamin,
      ...(subjectPersonIds ? { subjectPersonIds } : {}),
    },
    { readPerson: async () => ({ result: structuredClone(read), resolvedId: PIDS.benjamin, memoryKinds: {} }) },
    LOCAL,
  );
  if (!created.ok) throw new Error(created.errors.join("; "));
}

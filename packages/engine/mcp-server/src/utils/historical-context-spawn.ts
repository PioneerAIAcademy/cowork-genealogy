// The historical-context delegation, written out for the router to send as it is.
//
// research/SKILL.md had the router call tree_query and hand historical-context the
// places and years it returned and nothing else. A Haiku 5.5 low router added its
// own era ranges and a candidate answer ("anthracite coal mining in the
// 1860s–1900s") in 3 of 8 runs of ut_research_ia2. Every fact the delegation holds
// is in the project documents, so the tool writes it (ADR-0011) and the router
// appends only the researcher's message.

export interface HistoricalContextSpawn {
  agent: "historical-context";
  prompt: string;
}

const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

function displayName(person: any): string | null {
  const names = arr(person?.names).filter((n) => n && typeof n === "object");
  const n = names.find((x) => x.preferred === true) ?? names[0];
  const parts = [str(n?.given), str(n?.surname)].filter((p): p is string => p !== null);
  return parts.length > 0 ? parts.join(" ") : null;
}

/** Each fact with a date or a place, as the tree holds it: "Birth about 1845, Ireland". */
function factText(person: any): string[] {
  const out: string[] = [];
  for (const fact of arr(person?.facts)) {
    if (!fact || typeof fact !== "object") continue;
    const type = str(fact.type);
    const date = str(fact.date) ?? str(fact.standard_date);
    const place = str(fact.place) ?? str(fact.standard_place);
    if (!type || (!date && !place)) continue;
    out.push([type, [date, place].filter((p): p is string => p !== null).join(", ")].join(" "));
  }
  return out;
}

/**
 * The spawn for a historical-context ask about the project's first subject:
 * `projectPath`, the objective named as the objective's, and every dated or
 * placed tree fact of the subject and its one-hop family (`family`, from the
 * tree's Couple and ParentChild edges). Null when the tree
 * holds no such subject.
 */
export function historicalContextSpawn(
  projectPath: string,
  research: any,
  tree: any,
  subjectId: string | undefined,
  family: { spouseIds: string[]; parentIds: string[]; childIds: string[] } | undefined,
): HistoricalContextSpawn | null {
  if (typeof subjectId !== "string") return null;
  const persons = new Map<string, any>(
    arr(tree?.persons)
      .filter((p) => p && typeof p === "object" && typeof p.id === "string")
      .map((p) => [p.id, p]),
  );
  const subject = persons.get(subjectId);
  if (!subject) return null;
  const lines = [`projectPath: ${projectPath}`];
  const objective = str(research?.project?.objective);
  if (objective) lines.push(`Project objective (the researcher's, not a tree fact): ${objective}`);
  lines.push("Tree facts (the only places and years the tree holds for these people):");
  const people = [
    { id: subjectId, role: "subject" },
    ...(family?.parentIds ?? []).map((id) => ({ id, role: "parent" })),
    ...(family?.spouseIds ?? []).map((id) => ({ id, role: "spouse" })),
    ...(family?.childIds ?? []).map((id) => ({ id, role: "child" })),
  ];
  for (const { id, role } of people) {
    const person = persons.get(id);
    const facts = factText(person);
    const name = displayName(person) ?? id;
    lines.push(`- ${name} (${id}, ${role}): ${facts.length > 0 ? facts.join("; ") : "no dated or placed facts"}`);
  }
  return { agent: "historical-context", prompt: lines.join("\n") };
}

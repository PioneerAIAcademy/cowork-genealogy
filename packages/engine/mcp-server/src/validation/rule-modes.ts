// The mode of every rule that warns before it refuses. A new rule lands in warn
// mode, and refuses only from its flip stage, a separate PR that changes its
// line here.
//
// research_append, tree_edit and tree_correct each return one flat warning list
// per call, so a warning names what it concerns: the summary id for
// research_append; for the tree tools the object's holder and id. A fact id
// alone is ambiguous: 65 of the 136 e2e starting trees put one fact id on two or
// more persons, up to 15.

export type RuleMode = "warn" | "refuse";

/** Each staged rule's current mode, by rule id. A rule absent here is not staged. */
export const RULE_MODES: Readonly<Record<string, RuleMode>> = {};

/** The prefix a warn-mode finding carries. */
export const WILL_BE_REFUSED = "Will be refused:";

/** What a rule's findings become in `mode`: refusals in refuse mode; in warn
 *  mode, warnings that say they will be refused and name what they concern. */
export function applyRuleMode(
  mode: RuleMode,
  concern: string,
  messages: readonly string[],
): { errors: string[]; warnings: string[] } {
  if (mode === "refuse") return { errors: [...messages], warnings: [] };
  return { errors: [], warnings: messages.map((m) => `${WILL_BE_REFUSED} ${concern}: ${m}`) };
}

/** What a research_append finding concerns: the proof summary it is about. */
export function summaryConcern(summaryId: string): string {
  return `proof_summaries ${summaryId}`;
}

/** What a tree_edit or tree_correct finding concerns: the object's holder and
 *  id. A fact names its holder (person or relationship) beside its id, a name
 *  its person, an edge its relationship id. */
export function treeConcern(target: {
  personId?: string;
  relationshipId?: string;
  factId?: string;
  nameId?: string;
}): string {
  const parts: string[] = [];
  if (target.personId) parts.push(`personId ${target.personId}`);
  if (target.relationshipId) parts.push(`relationshipId ${target.relationshipId}`);
  if (target.factId) parts.push(`factId ${target.factId}`);
  if (target.nameId) parts.push(`nameId ${target.nameId}`);
  return parts.join(", ");
}

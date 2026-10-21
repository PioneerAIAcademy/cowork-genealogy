// Tree persons and their attached records, shared by the tools that resolve a
// person, read what FamilySearch has attached to them, or weigh a link to one.
// A util: it imports no tool module.

import { treePidOfArk } from "./ark.js";
import type { SimplifiedPerson } from "../types/gedcomx.js";

const TREE_FILE = "tree.gedcomx.json";

/**
 * The tree person `personId` names: by tree id first, else (issue #2942) the
 * one person whose FamilySearch link (`ark`) names that id, read by
 * `treePidOfArk` (a `4:1:` ark in any spelling or a tree person URL),
 * compared case-insensitively. init-project keys imported persons `I1`, `I2`…
 * and keeps their FamilySearch id in `ark`, so a caller holding only the
 * FamilySearch id still reaches them. Two persons linked to the same id is a
 * pending merge, not a choice to make silently.
 */
export function findAnchor(persons: SimplifiedPerson[], personId: string): SimplifiedPerson {
  const byId = persons.find((p) => p.id === personId);
  if (byId) return byId;
  const wanted = personId.trim().toUpperCase();
  const linked = persons.filter((p) => treePidOfArk(p.ark)?.toUpperCase() === wanted);
  if (linked.length === 1) return linked[0];
  if (linked.length > 1) {
    throw new Error(
      `FamilySearch id '${personId}' is linked to more than one person in ${TREE_FILE} ` +
        `(${linked.map((p) => p.id).join(", ")}); pass one of those ids.`,
    );
  }
  throw new Error(`Person '${personId}' not found in ${TREE_FILE}.`);
}

/** The source refs on a person, its facts and its names, first-seen order,
 *  de-duplicated. Relationship-level refs are not the person's own: most name
 *  the other party (lead, 2026-10-20). */
export function collectSourceRefs(person: any): string[] {
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

/** The rationale `extraction_append({ personId })` writes on every link it
 *  makes from a FamilySearch attachment. Only code writes it. Mirrored as a
 *  literal in `eval/harness/harness/skill_invocation.py`, pinned by
 *  `tests/packaging/attachment-link-rationale-drift.test.ts`. */
export const ATTACHMENT_LINK_RATIONALE =
  "Linked because FamilySearch has this record attached to this person; not verified.";

/** A link made from a FamilySearch attachment, by its whole shape: the fixed
 *  rationale, `speculative`, and no score. The rationale alone is a string any
 *  writer can copy; a scored or stronger link carrying it is not one of these. */
export function isAttachmentLink(pe: any): boolean {
  return (
    pe?.rationale === ATTACHMENT_LINK_RATIONALE &&
    pe?.confidence === "speculative" &&
    pe?.match_score == null
  );
}

function isLive(pe: any): boolean {
  return pe != null && pe.superseded_by == null;
}

/** Whether a link counts as identity for the unlinked-proof gate: live, and
 *  not speculative. A speculative link is a candidate, not an identity. */
export function countsForProofGate(pe: any): boolean {
  return isLive(pe) && pe.confidence !== "speculative";
}

/** Whether a link counts for project_context's "none linked → person-evidence"
 *  rung: live, and not an attachment link. A speculative link the researcher
 *  confirmed still counts, or the question would go back to person-evidence to
 *  ask again (lead, 2026-10-20). */
export function countsForLinkedRung(pe: any): boolean {
  return isLive(pe) && !isAttachmentLink(pe);
}

// person-id-refs — the single source of truth for which research.json fields
// reference tree.gedcomx.json person ids.
//
// Two callers consume this: the project validator's cross-file check (reports a
// dangling person-id reference) and the merge_tree_persons remap (repoints a
// collapsed id to its survivor). Driving both off one walker means the two can
// never drift — a field added here is checked AND remapped, never one without
// the other. Spec: merge-gedcomx-spec.md §10.

export type PersonIdRefField =
  | "person_evidence"
  | "subject_person_ids"
  | "timelines"
  | "known_holdings";

/** The research.json fields that hold tree person-id references. */
export const PERSON_ID_REF_FIELDS: readonly PersonIdRefField[] = [
  "person_evidence",
  "subject_person_ids",
  "timelines",
  "known_holdings",
];

export interface PersonIdRef {
  /** The referenced person id. */
  pid: string;
  /** Which logical field this reference belongs to (for the remap's counts). */
  field: PersonIdRefField;
  /** Validator error path — identical to the pre-extraction inline checks. */
  path: string;
  /** Validator error message when `pid` is dangling — identical to before. */
  message: string;
  /** Rewrite this reference in place (used by the merge remap). */
  set: (newId: string) => void;
}

/**
 * Yield every tree-person-id reference in `research`, in the same order the
 * validator's cross-file check has always emitted them (person_evidence,
 * subject_person_ids, timelines, known_holdings). Each ref carries the
 * validator's exact error path/message and an in-place setter for the remap.
 *
 * person_evidence keeps its original `if (person_id) …` guard (a falsy
 * person_id is skipped); the array fields check every element, as before.
 */
export function* iteratePersonIdRefs(research: any): Generator<PersonIdRef> {
  // person_evidence[].person_id — scalar; only a truthy id is referenced.
  const personEvidence = Array.isArray(research.person_evidence)
    ? research.person_evidence
    : [];
  for (let i = 0; i < personEvidence.length; i++) {
    const pe = personEvidence[i];
    const pid = pe.person_id;
    if (pid) {
      yield {
        pid,
        field: "person_evidence",
        path: `research.json/person_evidence[${i}]`,
        message: `person_id '${pid}' not found in tree.gedcomx.json persons`,
        set: (newId) => {
          pe.person_id = newId;
        },
      };
    }
  }

  // project.subject_person_ids — array.
  const subjectIds = research.project?.subject_person_ids;
  if (Array.isArray(subjectIds)) {
    for (let j = 0; j < subjectIds.length; j++) {
      const pid = subjectIds[j];
      yield {
        pid,
        field: "subject_person_ids",
        path: "research.json/project",
        message: `subject_person_ids contains '${pid}' which is not in tree.gedcomx.json persons`,
        set: (newId) => {
          subjectIds[j] = newId;
        },
      };
    }
  }

  // timelines[].person_ids — array.
  const timelines = Array.isArray(research.timelines) ? research.timelines : [];
  for (let i = 0; i < timelines.length; i++) {
    const personIds = Array.isArray(timelines[i].person_ids)
      ? timelines[i].person_ids
      : [];
    for (let j = 0; j < personIds.length; j++) {
      const pid = personIds[j];
      yield {
        pid,
        field: "timelines",
        path: `research.json/timelines[${i}]`,
        message: `person_ids contains '${pid}' which is not in tree.gedcomx.json persons`,
        set: (newId) => {
          personIds[j] = newId;
        },
      };
    }
  }

  // known_holdings[].relates_to_person_ids — array.
  const holdings = Array.isArray(research.known_holdings)
    ? research.known_holdings
    : [];
  for (let i = 0; i < holdings.length; i++) {
    const personIds = Array.isArray(holdings[i].relates_to_person_ids)
      ? holdings[i].relates_to_person_ids
      : [];
    for (let j = 0; j < personIds.length; j++) {
      const pid = personIds[j];
      yield {
        pid,
        field: "known_holdings",
        path: `research.json/known_holdings[${i}]`,
        message: `relates_to_person_ids contains '${pid}' which is not in tree.gedcomx.json persons`,
        set: (newId) => {
          personIds[j] = newId;
        },
      };
    }
  }
}

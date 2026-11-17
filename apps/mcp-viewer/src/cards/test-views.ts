import type { Derived, DerivedQuestion, ProjectDocument, QuestionState } from '../contract'
import { COMPOUND, FLYNN, MCANDREW, type Documents } from '../rules/test-data'

/** One question's derived state, as the engine would send it, with the rest empty. */
export function status(id: string, state: QuestionState, patch: Partial<DerivedQuestion> = {}): DerivedQuestion {
  return {
    id,
    state,
    nextStep: null,
    openConflictIds: [],
    storedStatus: null,
    unregisteredDisagreements: [],
    competingParentSets: [],
    ...patch
  }
}

export function documentOf(docs: Documents, derived: Derived): ProjectDocument {
  return { research: structuredClone(docs.research) as ProjectDocument['research'], tree: docs.tree, derived }
}

// Hand-written `derived` for the committed fixtures: the engine computes it in production
// (tests/tools/project-view-derived.test.ts); the page only reads it.
export const MCANDREW_DOC = () =>
  documentOf(MCANDREW, {
    folderName: 'mcandrew',
    questions: [status('q_001', 'critiqued')],
    evaluations: { ev_001: { body: null, craft: false } }
  })

export const COMPOUND_DOC = () =>
  documentOf(COMPOUND, {
    folderName: 'compound',
    questions: [status('q_001', 'critiqued')],
    evaluations: { ev_001: { body: { verdict: 'looks_solid' }, craft: false } }
  })

export const FLYNN_DOC = () =>
  documentOf(FLYNN, {
    folderName: 'flynn',
    questions: [status('q_001', 'critiqued'), status('q_002', 'evidence-gathered')],
    evaluations: { ev_001: { body: { craft: true }, craft: true } }
  })

export const FLYNN_PARENT_CONFLICT =
  'The record names the father Timothy Flynn; the tree has Thomas Flynn. The child and the mother agree.'

/** FLYNN with q_002's record linked to the tree's father as speculative, his name in conflict (#4592's one such link). */
export function FLYNN_WITH_STATED_CONFLICT(): ProjectDocument {
  const doc = FLYNN_DOC()
  const evidence = doc.research!.person_evidence!
  const child = evidence.find((pe) => pe.id === 'pe_001')!
  evidence.push({
    ...child,
    id: 'pe_092',
    person_id: 'I2',
    confidence: 'speculative',
    core_identifier_conflict: FLYNN_PARENT_CONFLICT
  })
  return doc
}

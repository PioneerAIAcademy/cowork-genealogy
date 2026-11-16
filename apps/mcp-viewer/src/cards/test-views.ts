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

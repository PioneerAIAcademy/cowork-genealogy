import { describe, it, expect } from 'vitest'
import { inferProgress } from '../progress'

// ProgressPipeline renders ABOVE the section ErrorBoundary (App.tsx), so a throw
// here blanks the whole viewer — the failure #1317 is about. Each shape below
// threw on `.length` before the `has()` guard.
describe('progress on a partial research.json', () => {
  it.each([
    ['a project-only file', { project: { id: 'rp_x' } }],
    ['a section that is not an array yet', { questions: {} }],
    ['a null section', { plans: null }],
    ['an entirely empty object', {}]
  ])('does not throw on %s', (_label, research) => {
    expect(() => inferProgress(research as never)).not.toThrow()
  })

  it('still reports a stage reached when its section is populated', () => {
    const out = inferProgress({ project: { id: 'rp_x' }, questions: [{ id: 'q_001' }] } as never)
    expect(JSON.stringify(out)).toContain('question_selection')
  })
})

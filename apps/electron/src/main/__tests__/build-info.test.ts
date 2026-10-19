import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getVersion: () => '1.0.0', isPackaged: false }
}))

import { resolveBuildInfo, viewerBuildInfo, viewerVersionString } from '../build-info'

// #2126 — the viewer's version was a frozen `1.0.0`; the build stamp is what
// lets a feedback bundle say which build produced it.
describe('resolveBuildInfo', () => {
  it('returns the injected stamp when it has the right shape', () => {
    const injected = {
      version: '1.0.0+2026-09-18.abc12345.dirty',
      sha: 'abc12345',
      date: '2026-09-18',
      dirty: true
    }
    expect(resolveBuildInfo(injected, '1.0.0')).toEqual(injected)
  })

  it.each([
    ['absent', undefined],
    ['a bare base with no +', { version: '1.0.0', sha: 'x', date: 'x', dirty: false }],
    ['a string', '1.0.0+2026-09-18.abc12345'],
    ['missing fields', { version: '1.0.0+dev' }]
  ])('falls back to <base>+dev when the constant is %s', (_label, defined) => {
    expect(resolveBuildInfo(defined, '1.0.0')).toEqual({
      version: '1.0.0+dev',
      sha: 'dev',
      date: 'dev',
      dirty: false
    })
  })
})

describe('viewerBuildInfo / viewerVersionString under vitest (no define)', () => {
  it('reads app.getVersion() as the base and marks the unpackaged run -dev', () => {
    expect(viewerBuildInfo().version).toBe('1.0.0+dev')
    expect(viewerVersionString()).toBe('1.0.0+dev-dev')
  })
})

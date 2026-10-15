import { afterEach, describe, expect, it, vi } from 'vitest'
import { sessionLogsAvailable } from '../makeSessionConnection'

/**
 * `sessionLogsAvailable` — the prototype tier (`VITE_SESSION_TRANSPORT=sse`) has no
 * sandbox logs and answers `/logs` 501, so the session header hides its Logs button there.
 */
describe('sessionLogsAvailable', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('is false on the SSE transport', () => {
    vi.stubEnv('VITE_SESSION_TRANSPORT', 'sse')
    expect(sessionLogsAvailable()).toBe(false)
  })

  it('is true when no transport is set (the hosted alpha)', () => {
    vi.stubEnv('VITE_SESSION_TRANSPORT', '')
    expect(sessionLogsAvailable()).toBe(true)
  })

  it('is true on the WS transport', () => {
    vi.stubEnv('VITE_SESSION_TRANSPORT', 'ws')
    expect(sessionLogsAvailable()).toBe(true)
  })
})

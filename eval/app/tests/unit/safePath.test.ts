import { describe, it, expect } from 'vitest'
import path from 'path'
import { resolveWithin, isWithin, PathEscapeError } from '../../lib/fs/safe-path'

const BASE = path.resolve('/tmp/evalapp-base')

describe('resolveWithin', () => {
  it('accepts an ordinary name and returns the joined path', () => {
    expect(resolveWithin(BASE, 'citation', 'ut_citation_001.json')).toBe(
      path.join(BASE, 'citation', 'ut_citation_001.json'),
    )
  })

  it('rejects a parent-directory traversal', () => {
    expect(() => resolveWithin(BASE, '..', '..', 'etc', 'passwd')).toThrow(PathEscapeError)
  })

  it('rejects a traversal buried mid-segment', () => {
    // The shape a pre-join `..` scan misses: normalisation is what turns this
    // into an escape, so the check has to run on the resolved result.
    expect(() => resolveWithin(BASE, 'citation/../../../etc/passwd')).toThrow(PathEscapeError)
  })

  it('rejects an absolute segment', () => {
    // path.join would silently discard everything before it.
    expect(() => resolveWithin(BASE, '/etc/passwd')).toThrow(PathEscapeError)
  })

  it('rejects a NUL byte', () => {
    // Truncates the path at the syscall boundary, so a value that passed a
    // string check could still open a different file than the one inspected.
    expect(() => resolveWithin(BASE, 'ok\0../../etc/passwd')).toThrow(PathEscapeError)
  })

  it('rejects an empty segment', () => {
    expect(() => resolveWithin(BASE, '')).toThrow(PathEscapeError)
  })

  it('does not accept a sibling whose name merely starts with the base name', () => {
    // `/tmp/evalapp-base-backup/x` starts with the BASE STRING but is not inside
    // the base directory. A `startsWith(base)` check with no separator accepts
    // it; appending the separator is what rejects it.
    const sibling = path.resolve(BASE + '-backup', 'x')
    expect(sibling.startsWith(BASE)).toBe(true) // the naive check would pass this
    expect(isWithin(BASE, path.relative(BASE, sibling))).toBe(false) // ours does not
  })

  it('allows the base itself', () => {
    expect(resolveWithin(BASE)).toBe(BASE)
  })

  it('does not leak the resolved absolute path in the error', () => {
    // The message reaches an HTTP response; echoing the resolved path would
    // confirm the operator's disk layout to whoever sent the request.
    try {
      resolveWithin(BASE, '..', '..', 'etc', 'passwd')
      throw new Error('should have thrown')
    } catch (e) {
      expect((e as Error).message).not.toContain('/etc/passwd')
      expect((e as Error).message).not.toContain(BASE)
    }
  })
})

describe('isWithin', () => {
  it('answers without throwing, for callers that skip rather than fail', () => {
    expect(isWithin(BASE, 'citation')).toBe(true)
    expect(isWithin(BASE, '..', 'elsewhere')).toBe(false)
  })
})

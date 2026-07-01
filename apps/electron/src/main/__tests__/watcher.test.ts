import { describe, it, expect } from 'vitest'
import { classifyBasename, channelMap, WATCHED_FILES, SIDECAR_BASENAME } from '../watcher'

// Pure-helper tests. The chokidar integration (lifecycle, awaitWriteFinish,
// emit dispatch into BrowserWindow) is exercised by the existing app at
// startup and by manual verification — but the routing decision is where
// bugs hide, so it gets unit-tested here.

describe('classifyBasename', () => {
  describe('fixed files', () => {
    it('classifies research.json as fixed', () => {
      const result = classifyBasename('research.json')
      expect(result).toEqual({ kind: 'fixed', file: 'research.json' })
    })

    it('classifies tree.gedcomx.json as fixed', () => {
      const result = classifyBasename('tree.gedcomx.json')
      expect(result).toEqual({ kind: 'fixed', file: 'tree.gedcomx.json' })
    })

    it('covers every entry in WATCHED_FILES', () => {
      for (const fixed of WATCHED_FILES) {
        const result = classifyBasename(fixed)
        expect(result.kind).toBe('fixed')
      }
    })
  })

  describe('sidecar files', () => {
    it('classifies log_001.json as a sidecar with the right logId', () => {
      expect(classifyBasename('log_001.json')).toEqual({
        kind: 'sidecar',
        logId: 'log_001'
      })
    })

    it('accepts alphanumeric + underscore + hyphen log ids', () => {
      expect(classifyBasename('log_aB-9_zz.json')).toEqual({
        kind: 'sidecar',
        logId: 'log_aB-9_zz'
      })
    })

    it('extracts the logId without the .json extension', () => {
      const result = classifyBasename('log_042.json')
      expect(result.kind).toBe('sidecar')
      if (result.kind === 'sidecar') expect(result.logId).toBe('log_042')
    })
  })

  describe('ignored basenames', () => {
    it('ignores README files in results/', () => {
      expect(classifyBasename('README.md').kind).toBe('ignore')
      expect(classifyBasename('README').kind).toBe('ignore')
    })

    it('ignores macOS .DS_Store', () => {
      expect(classifyBasename('.DS_Store').kind).toBe('ignore')
    })

    it('ignores atomic-write .tmp files', () => {
      // A common write pattern is write-to-.tmp-then-rename. The .tmp
      // basename must not match the sidecar pattern or we fire half-written
      // events.
      expect(classifyBasename('log_001.json.tmp').kind).toBe('ignore')
      expect(classifyBasename('log_001.tmp').kind).toBe('ignore')
    })

    it('ignores non-json files even if they start with log_', () => {
      expect(classifyBasename('log_001').kind).toBe('ignore')
      expect(classifyBasename('log_001.txt').kind).toBe('ignore')
      expect(classifyBasename('log_001.csv').kind).toBe('ignore')
    })

    it('ignores files starting with something other than log_', () => {
      expect(classifyBasename('logs_001.json').kind).toBe('ignore')
      expect(classifyBasename('foo_001.json').kind).toBe('ignore')
      expect(classifyBasename('001.json').kind).toBe('ignore')
    })

    it('ignores log_.json (empty id segment)', () => {
      expect(classifyBasename('log_.json').kind).toBe('ignore')
    })

    it('ignores log files with traversal characters in the basename', () => {
      // Path traversal can't actually happen here because chokidar gives us
      // a basename, but defense in depth: the regex would reject these even
      // if they did reach this code.
      expect(classifyBasename('log_../etc/passwd.json').kind).toBe('ignore')
      expect(classifyBasename('log_001/../etc.json').kind).toBe('ignore')
    })
  })
})

describe('channelMap', () => {
  it('maps each fixed file to a project:* IPC channel', () => {
    expect(channelMap['research.json']).toBe('project:research-updated')
    expect(channelMap['tree.gedcomx.json']).toBe('project:gedcomx-updated')
  })

  it('has an entry for every WATCHED_FILES item', () => {
    for (const fixed of WATCHED_FILES) {
      expect(channelMap[fixed]).toBeDefined()
      expect(channelMap[fixed]).toMatch(/^project:/)
    }
  })
})

describe('SIDECAR_BASENAME regex', () => {
  it('captures only the log id (no extension)', () => {
    const match = 'log_042.json'.match(SIDECAR_BASENAME)
    expect(match?.[1]).toBe('log_042')
  })

  it('is anchored at both ends', () => {
    // Anchoring prevents partial matches like "prefix-log_001.json-suffix"
    expect('prefix-log_001.json'.match(SIDECAR_BASENAME)).toBeNull()
    expect('log_001.json-suffix'.match(SIDECAR_BASENAME)).toBeNull()
  })
})

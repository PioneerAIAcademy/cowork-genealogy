import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  classifyBasename,
  channelMap,
  WATCHED_FILES,
  SIDECAR_BASENAME,
  findNestedResearchJson,
  formatNestedNotice,
  formatNestedPicker,
  assertResearchProject
} from '../watcher'

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

describe('findNestedResearchJson (issue #1317, bug 2 — wrong folder level)', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'watcher-nested-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  async function writeResearch(rel: string): Promise<void> {
    const full = join(dir, rel)
    await mkdir(join(full, '..'), { recursive: true })
    await writeFile(full, '{}', 'utf8')
  }

  it('finds a research.json in a subfolder (the reported case)', async () => {
    await writeResearch('research.json') // top-level (what the viewer watches)
    await writeResearch('subproject/research.json') // where the agent actually wrote
    const found = await findNestedResearchJson(dir)
    // relative() yields the platform separator, so build the expected the same way.
    expect(found).toEqual([join('subproject', 'research.json')])
  })

  it('never includes the top-level research.json itself', async () => {
    await writeResearch('research.json')
    expect(await findNestedResearchJson(dir)).toEqual([])
  })

  it('ignores research.json under results/, _feedback/, and hidden/node_modules dirs', async () => {
    await writeResearch('research.json')
    await writeResearch('results/research.json')
    await writeResearch('_feedback/research.json')
    await writeResearch('.trash/research.json')
    await writeResearch('node_modules/pkg/research.json')
    expect(await findNestedResearchJson(dir)).toEqual([])
  })

  it('returns empty (does not throw) on a folder with no research.json at all', async () => {
    await expect(findNestedResearchJson(dir)).resolves.toEqual([])
  })
})

describe('formatNestedNotice (issue #1317, bug 2 — cap the path list)', () => {
  it('lists every path verbatim when there are 3 or fewer', () => {
    const msg = formatNestedNotice(['a/research.json', 'b/research.json'])
    expect(msg).toContain('"a/research.json"')
    expect(msg).toContain('"b/research.json"')
    expect(msg).not.toContain('more')
    expect(msg).toContain('reopen the viewer on that folder')
  })

  it('caps at 3 and collapses the rest to "and N more"', () => {
    const msg = formatNestedNotice([
      'a/research.json',
      'b/research.json',
      'c/research.json',
      'd/research.json',
      'e/research.json'
    ])
    expect(msg).toContain('"a/research.json"')
    expect(msg).toContain('"c/research.json"')
    expect(msg).not.toContain('"d/research.json"')
    expect(msg).toContain('and 2 more')
  })
})

describe('formatNestedPicker (issue #1317, bug 2 — the empty-top-folder case)', () => {
  it('names the subfolder and does not say the folder "also" has one', () => {
    const msg = formatNestedPicker(['sub/research.json'])
    expect(msg).toContain('"sub/research.json"')
    expect(msg).toContain('Reopen the viewer on that subfolder')
    expect(msg).not.toContain('also')
  })

  it('caps the path list the same way the banner does', () => {
    const msg = formatNestedPicker([
      'a/research.json',
      'b/research.json',
      'c/research.json',
      'd/research.json'
    ])
    expect(msg).toContain('"c/research.json"')
    expect(msg).not.toContain('"d/research.json"')
    expect(msg).toContain('and 1 more')
  })
})

// Pins the branch behind `project:select-folder`. The folder-notice banner
// cannot cover this shape — the handler rejects the folder before
// startWatching runs — so the nested pointer has to come out of this
// rejection. Deleting the findNestedResearchJson lookup in
// assertResearchProject makes the middle case fall back to the generic
// message and fail.
describe('assertResearchProject (the select-folder gate)', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'assert-project-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('accepts a folder with a top-level research.json', async () => {
    await writeFile(join(dir, 'research.json'), '{}', 'utf-8')
    await expect(assertResearchProject(dir)).resolves.toBeUndefined()
  })

  it('points at the subfolder when only a nested research.json exists', async () => {
    await mkdir(join(dir, 'sub'), { recursive: true })
    await writeFile(join(dir, 'sub', 'research.json'), '{}', 'utf-8')
    await expect(assertResearchProject(dir)).rejects.toThrow(/is in a subfolder/)
    await expect(assertResearchProject(dir)).rejects.toThrow(/"sub\/research\.json"/)
  })

  it('falls back to the generic error when there is no research.json anywhere', async () => {
    await expect(assertResearchProject(dir)).rejects.toThrow(/Not a research project/)
  })
})

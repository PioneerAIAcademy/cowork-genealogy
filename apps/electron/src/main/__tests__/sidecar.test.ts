import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readSidecar, SIDECAR_MAX_BYTES } from '../sidecar'

// Real-filesystem tests using a per-test temp directory. Exercises the
// security boundary (path validation + size cap) the same way the IPC
// handler does at runtime.

describe('readSidecar', () => {
  let folder: string

  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'sidecar-test-'))
    await mkdir(join(folder, 'results'), { recursive: true })
  })

  afterEach(async () => {
    await rm(folder, { recursive: true, force: true })
  })

  describe('happy path', () => {
    it('returns { raw, mtime } for an existing sidecar', async () => {
      const payload = JSON.stringify({ log_id: 'log_001', returned_count: 0 })
      await writeFile(join(folder, 'results', 'log_001.json'), payload, 'utf8')
      const result = await readSidecar('log_001', folder)
      expect(result).not.toBeNull()
      expect(result!.raw).toBe(payload)
      expect(typeof result!.mtime).toBe('number')
      expect(result!.mtime).toBeGreaterThan(0)
    })

    it('does NOT parse the payload in the main process', async () => {
      // The handler returns the raw string so JSON.parse runs in the
      // renderer. Garbage in, garbage out, but no throw on read.
      await writeFile(join(folder, 'results', 'log_xx.json'), 'not valid json', 'utf8')
      const result = await readSidecar('log_xx', folder)
      expect(result?.raw).toBe('not valid json')
    })
  })

  describe('null folderPath', () => {
    it('returns null when folderPath is null (no project open)', async () => {
      expect(await readSidecar('log_001', null)).toBeNull()
    })
  })

  describe('invalid log id', () => {
    it('throws when logId is not a string', async () => {
      await expect(readSidecar(undefined, folder)).rejects.toThrow('Invalid log id')
      await expect(readSidecar(null, folder)).rejects.toThrow('Invalid log id')
      await expect(readSidecar(42, folder)).rejects.toThrow('Invalid log id')
      await expect(readSidecar({}, folder)).rejects.toThrow('Invalid log id')
    })

    it('throws when logId lacks the log_ prefix', async () => {
      await expect(readSidecar('001', folder)).rejects.toThrow('Invalid log id')
      await expect(readSidecar('foo_001', folder)).rejects.toThrow('Invalid log id')
    })

    it('throws on path traversal attempts via slashes / dots', async () => {
      await expect(readSidecar('../etc/passwd', folder)).rejects.toThrow('Invalid log id')
      await expect(readSidecar('log_../etc/passwd', folder)).rejects.toThrow('Invalid log id')
      await expect(readSidecar('log_001/..', folder)).rejects.toThrow('Invalid log id')
    })

    it('throws on logId containing a null byte', async () => {
      const NUL = String.fromCharCode(0)
      await expect(readSidecar(`log_001${NUL}`, folder)).rejects.toThrow('Invalid log id')
      await expect(readSidecar(`log_${NUL}001`, folder)).rejects.toThrow('Invalid log id')
    })

    it('throws on logId with whitespace', async () => {
      await expect(readSidecar('log_ 001', folder)).rejects.toThrow('Invalid log id')
      await expect(readSidecar('log_001 ', folder)).rejects.toThrow('Invalid log id')
    })

    it('accepts log ids with letters, numbers, underscores, hyphens', async () => {
      await writeFile(join(folder, 'results', 'log_aB-9_zz.json'), '{}', 'utf8')
      const result = await readSidecar('log_aB-9_zz', folder)
      expect(result?.raw).toBe('{}')
    })
  })

  describe('missing file', () => {
    it('returns null when the sidecar file does not exist', async () => {
      const result = await readSidecar('log_999', folder)
      expect(result).toBeNull()
    })

    it('returns null when the results/ directory does not exist', async () => {
      // Tear down the results dir to simulate a project that has never
      // written a sidecar.
      await rm(join(folder, 'results'), { recursive: true, force: true })
      const result = await readSidecar('log_001', folder)
      expect(result).toBeNull()
    })
  })

  describe('size cap', () => {
    it('throws when the file is larger than SIDECAR_MAX_BYTES', async () => {
      // Write 10MB + 1 byte. Buffer.alloc fills with zeros so this is fast
      // and small to allocate even at the cap.
      const oversized = Buffer.alloc(SIDECAR_MAX_BYTES + 1, 0x20) // ASCII space
      await writeFile(join(folder, 'results', 'log_big.json'), oversized)
      await expect(readSidecar('log_big', folder)).rejects.toThrow(/exceeds.*MB cap/)
    })

    it('accepts a file exactly at the cap', async () => {
      const atCap = Buffer.alloc(SIDECAR_MAX_BYTES, 0x20)
      await writeFile(join(folder, 'results', 'log_max.json'), atCap)
      const result = await readSidecar('log_max', folder)
      expect(result).not.toBeNull()
      expect(result!.raw.length).toBe(SIDECAR_MAX_BYTES)
    })
  })

  describe('isolation', () => {
    it('cannot read files outside the results/ subdirectory', async () => {
      // Write a sibling file at the folder root. The handler should never
      // see it because logId only resolves under results/.
      await writeFile(join(folder, 'log_001.json'), 'AT ROOT', 'utf8')
      // No file at results/log_001.json -> returns null
      const result = await readSidecar('log_001', folder)
      expect(result).toBeNull()
    })
  })
})

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readSourceImage, IMAGE_MAX_BYTES } from '../image'

// Real-filesystem tests using a per-test temp directory. Exercises the security
// boundary (pattern + inside-project resolution + size cap) the IPC handler uses.

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9])
const DATA_PREFIX = 'data:image/jpeg;base64,'

describe('readSourceImage', () => {
  let folder: string

  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'image-test-'))
    await mkdir(join(folder, 'images'), { recursive: true })
  })

  afterEach(async () => {
    await rm(folder, { recursive: true, force: true })
  })

  it('returns a data: URL that decodes to the file bytes', async () => {
    await writeFile(join(folder, 'images', '004884748_02613.jpg'), JPEG)
    const result = await readSourceImage('images/004884748_02613.jpg', folder)
    expect(result).not.toBeNull()
    expect(result!.startsWith(DATA_PREFIX)).toBe(true)
    const decoded = Buffer.from(result!.slice(DATA_PREFIX.length), 'base64')
    expect(decoded.equals(JPEG)).toBe(true)
  })

  it('returns null when folderPath is null (no project open)', async () => {
    expect(await readSourceImage('images/x.jpg', null)).toBeNull()
  })

  it('returns null when the file does not exist', async () => {
    expect(await readSourceImage('images/missing.jpg', folder)).toBeNull()
  })

  it('returns null when the images/ directory does not exist', async () => {
    await rm(join(folder, 'images'), { recursive: true, force: true })
    expect(await readSourceImage('images/x.jpg', folder)).toBeNull()
  })

  describe('invalid filename', () => {
    it('throws when not a string', async () => {
      await expect(readSourceImage(undefined, folder)).rejects.toThrow('Invalid image filename')
      await expect(readSourceImage(42, folder)).rejects.toThrow('Invalid image filename')
      await expect(readSourceImage({}, folder)).rejects.toThrow('Invalid image filename')
    })

    it('throws without the images/ prefix or with the wrong extension', async () => {
      await expect(readSourceImage('x.jpg', folder)).rejects.toThrow('Invalid image filename')
      await expect(readSourceImage('results/x.json', folder)).rejects.toThrow(
        'Invalid image filename'
      )
      await expect(readSourceImage('images/x.png', folder)).rejects.toThrow('Invalid image filename')
      await expect(readSourceImage('images/x', folder)).rejects.toThrow('Invalid image filename')
    })

    it('throws on path traversal / subdirectories', async () => {
      await expect(readSourceImage('images/../secret.jpg', folder)).rejects.toThrow(
        'Invalid image filename'
      )
      await expect(readSourceImage('../images/x.jpg', folder)).rejects.toThrow(
        'Invalid image filename'
      )
      await expect(readSourceImage('images/sub/x.jpg', folder)).rejects.toThrow(
        'Invalid image filename'
      )
    })

    it('throws on a null byte', async () => {
      const NUL = String.fromCharCode(0)
      await expect(readSourceImage(`images/x${NUL}.jpg`, folder)).rejects.toThrow(
        'Invalid image filename'
      )
    })
  })

  it('throws when the file exceeds the size cap', async () => {
    const oversized = Buffer.alloc(IMAGE_MAX_BYTES + 1, 0)
    await writeFile(join(folder, 'images', 'big.jpg'), oversized)
    await expect(readSourceImage('images/big.jpg', folder)).rejects.toThrow(/exceeds.*MB cap/)
  })

  it('cannot reach a JPEG sitting outside images/', async () => {
    await writeFile(join(folder, 'root.jpg'), JPEG)
    // The pattern requires the images/ prefix, so a root file is unreachable.
    await expect(readSourceImage('root.jpg', folder)).rejects.toThrow('Invalid image filename')
  })
})

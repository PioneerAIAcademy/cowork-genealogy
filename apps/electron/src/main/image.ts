import fs from 'node:fs/promises'
import path from 'node:path'

export const IMAGE_MAX_BYTES = 20 * 1024 * 1024
// The engine's image-store.ts writes images/<sanitized-key>.jpg where the key
// is limited to [A-Za-z0-9._-]. This pattern rejects anything else — no
// subdirectories, no traversal, no other extension.
export const IMAGE_REF_PATTERN = /^images\/[A-Za-z0-9._-]+\.jpg$/

// Pulled out of the ipcMain.handle closure in index.ts so the security boundary
// (pattern check + inside-project resolution + size cap + read) is unit-testable
// without spinning up Electron. Returns a `data:` URL the renderer can drop into
// <img src> (img-src data: is allowed by the CSP); null when the file is absent.
export async function readSourceImage(
  filename: unknown,
  folderPath: string | null
): Promise<string | null> {
  if (!folderPath) return null
  if (typeof filename !== 'string' || filename.includes('\0')) {
    throw new Error('Invalid image filename')
  }
  if (!IMAGE_REF_PATTERN.test(filename)) {
    throw new Error('Invalid image filename')
  }

  const imagesDir = path.join(folderPath, 'images')
  const filePath = path.join(folderPath, filename)
  // Defense in depth beyond the pattern: the resolved path must stay inside
  // <folderPath>/images.
  const rel = path.relative(imagesDir, filePath)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Invalid image filename')
  }

  const stat = await fs.stat(filePath).catch(() => null)
  if (!stat || !stat.isFile()) return null
  if (stat.size > IMAGE_MAX_BYTES) {
    throw new Error(`Image exceeds ${IMAGE_MAX_BYTES / 1024 / 1024}MB cap`)
  }
  const bytes = await fs.readFile(filePath)
  return `data:image/jpeg;base64,${bytes.toString('base64')}`
}

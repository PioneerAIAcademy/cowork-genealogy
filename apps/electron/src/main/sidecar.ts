import fs from 'node:fs/promises'
import path from 'node:path'

export const SIDECAR_MAX_BYTES = 10 * 1024 * 1024
export const LOG_ID_PATTERN = /^log_[a-zA-Z0-9_-]+$/

// Pulled out of the ipcMain.handle closure in index.ts so the security
// boundary (path validation + size cap + filesystem read) is unit-testable
// without spinning up Electron.
export async function readSidecar(
  logId: unknown,
  folderPath: string | null
): Promise<{ raw: string; mtime: number } | null> {
  if (!folderPath) return null
  if (typeof logId !== 'string' || !LOG_ID_PATTERN.test(logId)) {
    throw new Error('Invalid log id')
  }
  if (logId.includes('\0')) throw new Error('Invalid log id')

  const filePath = path.join(folderPath, 'results', `${logId}.json`)
  const stat = await fs.stat(filePath).catch(() => null)
  if (!stat) return null
  if (stat.size > SIDECAR_MAX_BYTES) {
    throw new Error(`Sidecar exceeds ${SIDECAR_MAX_BYTES / 1024 / 1024}MB cap`)
  }
  // Return raw string + mtime; renderer parses to keep main process responsive
  const raw = await fs.readFile(filePath, 'utf8')
  return { raw, mtime: stat.mtimeMs }
}

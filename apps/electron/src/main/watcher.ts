import { BrowserWindow } from 'electron'
import { watch, type FSWatcher } from 'chokidar'
import { readFile, stat as fsStat } from 'node:fs/promises'
import { join, resolve, basename } from 'node:path'

let watcher: FSWatcher | null = null
let currentFolderPath: string | null = null
let lastResearch: unknown = null
let lastGedcomx: unknown = null

export const WATCHED_FILES = ['research.json', 'tree.gedcomx.json'] as const
export type FixedFile = (typeof WATCHED_FILES)[number]

export const channelMap: Record<FixedFile, string> = {
  'research.json': 'project:research-updated',
  'tree.gedcomx.json': 'project:gedcomx-updated'
}

// log_<alphanumeric>.json — anything else under results/ is ignored (READMEs,
// .DS_Store, .tmp during atomic writes, etc.).
export const SIDECAR_BASENAME = /^(log_[a-zA-Z0-9_-]+)\.json$/

// Pure classifier — pulled out so the basename routing is testable without
// spinning up chokidar or Electron. Used inside the watch handler below.
export type Classification =
  | { kind: 'fixed'; file: FixedFile }
  | { kind: 'sidecar'; logId: string }
  | { kind: 'ignore' }

export function classifyBasename(base: string): Classification {
  if ((WATCHED_FILES as readonly string[]).includes(base)) {
    return { kind: 'fixed', file: base as FixedFile }
  }
  const m = base.match(SIDECAR_BASENAME)
  if (m) return { kind: 'sidecar', logId: m[1] }
  return { kind: 'ignore' }
}

export function getCurrentState(): {
  folderPath: string | null
  research: unknown
  gedcomx: unknown
} {
  return { folderPath: currentFolderPath, research: lastResearch, gedcomx: lastGedcomx }
}

export function startWatching(folderPath: string, mainWindow: BrowserWindow): void {
  stopWatching()
  currentFolderPath = resolve(folderPath)

  const fixedPaths = WATCHED_FILES.map((f) => join(folderPath, f))
  const sidecarDir = join(folderPath, 'results')

  // Single chokidar instance; we extend it to also watch results/ so there's
  // one lifecycle and one stopWatching path. Dispatch by basename below.
  watcher = watch(fixedPaths, {
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
    ignoreInitial: false
  })
  watcher.add(sidecarDir)

  const handleChange = async (filePath: string): Promise<void> => {
    const cls = classifyBasename(basename(filePath))

    if (cls.kind === 'fixed') {
      try {
        const content = await readFile(filePath, 'utf8')
        const data = JSON.parse(content)
        if (cls.file === 'research.json') lastResearch = data
        if (cls.file === 'tree.gedcomx.json') lastGedcomx = data
        mainWindow.webContents.send(channelMap[cls.file], data)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        mainWindow.webContents.send('project:watch-error', `Error reading ${cls.file}: ${message}`)
      }
      return
    }

    if (cls.kind === 'sidecar') {
      // Pointer-only event so the watcher stays cheap even when the renderer
      // doesn't have a drawer open for this logId.
      const st = await fsStat(filePath).catch(() => null)
      if (!st) return
      mainWindow.webContents.send('project:sidecar-updated', {
        logId: cls.logId,
        mtime: st.mtimeMs
      })
      return
    }

    // cls.kind === 'ignore' — README.md, .DS_Store, log_001.json.tmp, etc.
  }

  watcher.on('add', handleChange)
  watcher.on('change', handleChange)

  watcher.on('unlink', (filePath) => {
    const cls = classifyBasename(basename(filePath))
    if (cls.kind === 'fixed') {
      mainWindow.webContents.send('project:watch-error', `${cls.file} deleted`)
      return
    }
    if (cls.kind === 'sidecar') {
      // mtime: 0 sentinel = the sidecar was removed
      mainWindow.webContents.send('project:sidecar-updated', { logId: cls.logId, mtime: 0 })
    }
  })

  watcher.on('error', (err) => {
    const message = err instanceof Error ? err.message : String(err)
    mainWindow.webContents.send('project:watch-error', `Watcher error: ${message}`)
  })
}

export function stopWatching(): void {
  if (watcher) {
    watcher.close()
    watcher = null
  }
  currentFolderPath = null
  lastResearch = null
  lastGedcomx = null
}

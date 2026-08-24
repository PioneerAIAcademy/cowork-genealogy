import { BrowserWindow } from 'electron'
import { watch, type FSWatcher } from 'chokidar'
import { readFile, readdir, stat as fsStat } from 'node:fs/promises'
import { join, resolve, basename, relative } from 'node:path'

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

// Dirs a nested research.json legitimately lives in — not a wrong-folder signal.
// `results/` holds sidecars; `_feedback/` is an unpacked feedback bundle; the
// rest are noise we should never descend into.
const NESTED_SCAN_SKIP_DIRS = new Set([
  'results',
  '_feedback',
  'node_modules',
  '.git'
])
const NESTED_SCAN_MAX_DEPTH = 6

/**
 * Find `research.json` files sitting in SUBFOLDERS of the watched folder.
 *
 * The viewer watches only the top-level `research.json`, but the agent is handed
 * a folder path per call and can write into a subfolder — so the top can look
 * empty while the real project is one level down, which reads as "lost files"
 * (issue #1317, bug 2). This surfaces that mismatch: a hit means "you may be
 * watching the wrong folder level." Returns paths relative to `folderPath`;
 * the top-level file itself is never included. Bounded in depth, and skips
 * hidden dirs and the known-legit nests so it stays cheap and quiet.
 */
export async function findNestedResearchJson(folderPath: string): Promise<string[]> {
  const found: string[] = []
  const root = resolve(folderPath)

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > NESTED_SCAN_MAX_DEPTH) return
    let entries: import('node:fs').Dirent[]
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return // unreadable dir is not our problem to report here
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || NESTED_SCAN_SKIP_DIRS.has(entry.name)) continue
        await walk(join(dir, entry.name), depth + 1)
      } else if (entry.isFile() && entry.name === 'research.json') {
        const full = join(dir, entry.name)
        if (resolve(full) !== join(root, 'research.json')) {
          found.push(relative(root, full))
        }
      }
    }
  }

  await walk(root, 0)
  return found
}

// Build the folder-notice message. Cap the listed paths so a parent folder
// holding many projects can't produce a message no UI surface can show sensibly
// (this repo alone has ~90 nested research.json); the rest collapse to "and N
// more". Pure + exported so the cap is unit-testable without chokidar.
export function formatNestedNotice(nested: string[]): string {
  const shown = nested.slice(0, 3).map((p) => `"${p}"`).join(', ')
  const rest = nested.length > 3 ? ` and ${nested.length - 3} more` : ''
  return (
    `Heads up: this folder also has research.json in a subfolder (${shown}${rest}). ` +
    `The viewer only shows the top-level project — if your research is in the ` +
    `subfolder, reopen the viewer on that folder.`
  )
}

export function startWatching(folderPath: string, mainWindow: BrowserWindow): void {
  stopWatching()
  currentFolderPath = resolve(folderPath)

  // Warn if research.json also exists in a subfolder: the viewer watches only
  // the top level, so a project one level down looks like an empty/"lost"
  // project (issue #1317, bug 2). Fire-and-forget — never block or fail the
  // watch on this heads-up.
  void findNestedResearchJson(folderPath)
    .then((nested) => {
      if (nested.length === 0) return
      // The scan is async; if the user switched folders while it ran, its
      // result describes the OLD folder — don't warn about a folder we're no
      // longer watching.
      if (currentFolderPath !== resolve(folderPath)) return
      mainWindow.webContents.send('project:folder-notice', formatNestedNotice(nested))
    })
    .catch(() => {
      // A scan failure must never break the watch.
    })

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

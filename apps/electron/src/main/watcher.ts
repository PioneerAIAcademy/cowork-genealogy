import { BrowserWindow } from 'electron'
import { watch, type FSWatcher } from 'chokidar'
import { readFile, readdir, stat as fsStat } from 'node:fs/promises'
import { join, resolve, basename, relative } from 'node:path'

let watcher: FSWatcher | null = null
let currentFolderPath: string | null = null
let lastResearch: unknown = null
let lastGedcomx: unknown = null
let lastNotice: string | null = null

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
  { kind: 'fixed'; file: FixedFile } | { kind: 'sidecar'; logId: string } | { kind: 'ignore' }

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
  notice: string | null
} {
  return {
    folderPath: currentFolderPath,
    research: lastResearch,
    gedcomx: lastGedcomx,
    notice: lastNotice
  }
}

// Dirs a nested research.json legitimately lives in — not a wrong-folder signal.
// `results/` holds sidecars; `_feedback/` is an unpacked feedback bundle; the
// rest are noise we should never descend into.
// Hidden dirs (including .git) are skipped by the startsWith('.') test below,
// so they don't need listing here.
const NESTED_SCAN_SKIP_DIRS = new Set(['results', '_feedback', 'node_modules'])
const NESTED_SCAN_MAX_DEPTH = 6
// The picker's scan runs inside the ipcMain handler, so its cost is a freeze the
// user watches. Kept shallow deliberately — see assertResearchProject.
export const PICKER_SCAN_MAX_DEPTH = 2

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
export async function findNestedResearchJson(
  folderPath: string,
  maxDepth: number = NESTED_SCAN_MAX_DEPTH
): Promise<string[]> {
  const found: string[] = []
  const root = resolve(folderPath)

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth) return
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
export function formatNestedList(nested: string[]): string {
  const shown = nested
    .slice(0, 3)
    .map((p) => `"${p}"`)
    .join(', ')
  const rest = nested.length > 3 ? ` and ${nested.length - 3} more` : ''
  return `${shown}${rest}`
}

export function formatNestedNotice(nested: string[]): string {
  // Deliberately not "also has": startWatching is also reached via
  // --project-dir, which does not require a top-level research.json, so
  // "also" would be wrong there.
  return (
    `Heads up: this folder has research.json in a subfolder ` +
    `(${formatNestedList(nested)}). The viewer only shows the top-level ` +
    `project — if your research is in the subfolder, reopen the viewer on ` +
    `that folder.`
  )
}

// The rejection message for `project:select-folder` when the picked folder has
// NO top-level research.json but does have one below it. The folder-notice
// banner cannot reach this case — the handler rejects the folder before
// startWatching runs — so this error carries the pointer instead.
export function formatNestedPicker(nested: string[]): string {
  return (
    `research.json is in a subfolder (${formatNestedList(nested)}), not in the ` +
    `folder you picked. Reopen the viewer on that subfolder.`
  )
}

/**
 * Gate for `project:select-folder`: the picked folder must be a research
 * project. Resolves when it has a top-level `research.json`; throws otherwise.
 *
 * When the top level has none but a subfolder does, the error names the
 * subfolder instead of the generic "not a research project" — that is the
 * literal "research.json hiding in a subfolder" case (issue #1317, bug 2),
 * and the folder-notice banner can never reach it, because the handler
 * rejects the folder before `startWatching` runs.
 *
 * Pulled out of the ipcMain handler so this branch is testable without
 * `dialog`, `ipcMain`, or a BrowserWindow.
 */
export async function assertResearchProject(folderPath: string): Promise<void> {
  try {
    await fsStat(join(folderPath, 'research.json'))
    return
  } catch {
    // No top-level research.json — work out which error the user needs.
  }

  // Bounded harder than the background scan: this one blocks the folder picker,
  // and the wrong-folder path is exactly where a user lands here. At the full
  // depth, picking a home directory by mistake freezes the dialog for seconds
  // with no feedback; depth 2 still catches the reported shape.
  const nested = await findNestedResearchJson(folderPath, PICKER_SCAN_MAX_DEPTH)
  if (nested.length > 0) {
    throw new Error(formatNestedPicker(nested))
  }
  throw new Error(
    'Not a research project — research.json not found. Run the init-project skill to create a new project, or pick a folder that already has one.'
  )
}

/**
 * Warn if research.json also exists in a subfolder: the viewer watches only the
 * top level, so a project one level down looks like an empty/"lost" project
 * (issue #1317, bug 2).
 *
 * Stores the message as well as sending it. The send only reaches a renderer
 * that has already subscribed, and `--project-dir` calls `startWatching` at
 * window creation — before React mounts — so without the stored copy the notice
 * is gone for good on that launch and on any later reload (issue #1899).
 *
 * Exported so this half is reachable from a unit test: pass a stub
 * `{ webContents: { send } }` and assert both the send and
 * `getCurrentState().notice`, with no chokidar and no Electron.
 */
export async function scanAndNotify(
  folderPath: string,
  mainWindow: Pick<BrowserWindow, 'webContents'>
): Promise<void> {
  try {
    const nested = await findNestedResearchJson(folderPath)
    if (nested.length === 0) return
    // The scan is async; if the user switched folders while it ran, its result
    // describes the OLD folder — don't warn about a folder we're no longer
    // watching, and don't store it either.
    if (currentFolderPath !== resolve(folderPath)) return
    const message = formatNestedNotice(nested)
    lastNotice = message
    mainWindow.webContents.send('project:folder-notice', message)
  } catch {
    // A scan failure must never break the watch.
  }
}

export function startWatching(folderPath: string, mainWindow: BrowserWindow): void {
  stopWatching()
  currentFolderPath = resolve(folderPath)

  // Fire-and-forget — never block or fail the watch on this heads-up.
  void scanAndNotify(folderPath, mainWindow)

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
  // Must be cleared with the rest: otherwise picking a clean folder replays the
  // previous folder's notice on the next reload — a wrong banner, worse than
  // none (issue #1899).
  lastNotice = null
}

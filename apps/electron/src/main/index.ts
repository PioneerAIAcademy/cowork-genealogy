import { app, shell, BrowserWindow, ipcMain, session, dialog } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import fs from 'node:fs/promises'
import path from 'node:path'
import icon from '../../resources/icon.png?asset'
import { setupMenu } from './menu'
import { startWatching, stopWatching, getCurrentState } from './watcher'
import { readSidecar } from './sidecar'
import { readSourceImage } from './image'
import { walkProject, readSessionLog, buildFeedbackZip } from './feedback'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    autoHideMenuBar: false,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  })

  mainWindow = win

  win.on('ready-to-show', () => {
    win.show()
  })

  // HMR for renderer based on electron-vite cli.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// --- CSP header (§3.2) ---
// Skipped in dev mode: Vite HMR injects inline scripts and uses eval,
// which script-src 'self' would block. Production CSP is enforced via header.
function setupCSP(): void {
  if (is.dev) return

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self';",
          "script-src 'self';",
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;",
          "img-src 'self' data:;",
          "font-src 'self' data: https://fonts.gstatic.com;",
          // Renderer reaches the network only through main-process IPC (the
          // feedback POST is a main-process fetch, unaffected by CSP), so the
          // renderer needs no external connect origins.
          "connect-src 'self';",
          "object-src 'none';",
          "base-uri 'none';",
          "frame-ancestors 'none';"
        ].join(' ')
      }
    })
  })
}

// --- IPC handlers (§3.5, §3.6) ---
function setupIPC(): void {
  ipcMain.handle('open-file', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'JSON / Markdown', extensions: ['json', 'md', 'markdown'] }]
    })
    if (canceled || filePaths.length === 0) return null
    const filePath = filePaths[0]
    if (filePath.includes('\0')) throw new Error('Invalid path')
    const ext = path.extname(filePath).toLowerCase()
    if (!['.json', '.md', '.markdown'].includes(ext)) throw new Error('Unsupported file type')
    const stat = await fs.stat(filePath)
    if (stat.size > 50 * 1024 * 1024) throw new Error('File too large')
    const content = await fs.readFile(filePath, 'utf8')
    return { filePath, content, ext }
  })

  ipcMain.handle('open-external', async (_e, url: string) => {
    if (typeof url !== 'string') return
    try {
      const parsed = new URL(url)
      if (parsed.protocol === 'https:') {
        await shell.openExternal(url)
      }
    } catch {
      // Malformed URL — silently ignore
    }
  })

  ipcMain.handle('get-version', () => {
    return app.getVersion()
  })

  ipcMain.handle(
    'feedback:submit',
    async (
      _e,
      payload: {
        includeMedia?: boolean
        includeSessionLog?: boolean
        email: string
        userPrompt: string
        agentDid: string
        agentShouldHave: string
        notes?: string
      }
    ) => {
      const state = getCurrentState()
      if (!state.folderPath) {
        throw new Error('No project folder is open.')
      }

      const built = await buildFeedbackZip({
        folderPath: state.folderPath,
        includeMedia: payload.includeMedia === true,
        includeSessionLog: payload.includeSessionLog !== false,
        report: {
          email: payload.email,
          userPrompt: payload.userPrompt,
          agentDid: payload.agentDid,
          agentShouldHave: payload.agentShouldHave,
          notes: payload.notes
        },
        viewerVersion: app.getVersion() + (app.isPackaged ? '' : '-dev')
      })

      const envelope = JSON.stringify({
        timestamp: new Date().toISOString(),
        email: payload.email,
        filename: built.filename,
        zipBase64: built.zipBase64
      })

      // Production: Apps Script endpoint. Override with FEEDBACK_URL env var for local dev.
      const endpoint =
        process.env.FEEDBACK_URL ||
        'https://script.google.com/macros/s/AKfycbxcMvfhpCqLzSa5sZBrssr48QfqrpFhW9DMRkxG8RYQfGGJIXoCEzbyPHrpT1XWZzcs/exec'

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: envelope
      })

      if (!res.ok) {
        throw new Error(`Server responded with ${res.status}`)
      }

      const result = await res.json().catch(() => ({}))
      return { ok: true, filename: built.filename, ...result }
    }
  )

  ipcMain.handle('project:list-files', async () => {
    const state = getCurrentState()
    if (!state.folderPath) return []
    return walkProject(state.folderPath)
  })

  ipcMain.handle('session:get-log', async () => {
    const state = getCurrentState()
    if (!state.folderPath) return { entries: [], sizeBytes: 0 }
    return readSessionLog(state.folderPath)
  })

  ipcMain.handle('project:get-state', () => {
    return getCurrentState()
  })

  ipcMain.handle('project:read-sidecar', async (_e, logId: unknown) => {
    return readSidecar(logId, getCurrentState().folderPath)
  })

  ipcMain.handle('project:read-image', async (_e, filename: unknown) => {
    return readSourceImage(filename, getCurrentState().folderPath)
  })

  ipcMain.handle('project:select-folder', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openDirectory']
    })
    if (canceled || filePaths.length === 0) return null
    const folderPath = filePaths[0]

    try {
      await fs.stat(path.join(folderPath, 'research.json'))
    } catch {
      throw new Error(
        'Not a research project — research.json not found. Run the init-project skill to create a new project, or pick a folder that already has one.'
      )
    }

    stopWatching()
    startWatching(folderPath, mainWindow!)
    return folderPath
  })
}

// --- Block navigation and new windows (§3.7) ---
function setupNavigationBlocking(): void {
  app.on('web-contents-created', (_e, contents) => {
    contents.on('will-navigate', (e) => e.preventDefault())
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  })
}

// --- App lifecycle ---
app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.pioneeracademy.researchviewer')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  setupCSP()
  setupIPC()
  setupNavigationBlocking()
  setupMenu()
  createWindow()

  const projectDirIndex = process.argv.indexOf('--project-dir')
  if (projectDirIndex !== -1 && process.argv[projectDirIndex + 1]) {
    startWatching(process.argv[projectDirIndex + 1], mainWindow!)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

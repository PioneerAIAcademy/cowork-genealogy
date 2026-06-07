import { Menu, shell, app, dialog } from 'electron'
import { is } from '@electron-toolkit/utils'

const isMac = process.platform === 'darwin'

const REPO_URL = 'https://github.com/pioneeracademy/cowork-genealogy-ui'

const template: Electron.MenuItemConstructorOptions[] = [
  ...(isMac
    ? [
        {
          label: app.name,
          submenu: [
            { role: 'about' as const },
            { type: 'separator' as const },
            { role: 'services' as const },
            { type: 'separator' as const },
            { role: 'hide' as const },
            { role: 'hideOthers' as const },
            { role: 'unhide' as const },
            { type: 'separator' as const },
            { role: 'quit' as const }
          ]
        }
      ]
    : []),
  {
    label: 'File',
    submenu: [isMac ? { role: 'close' as const } : { role: 'quit' as const }]
  },
  {
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'selectAll' }
    ]
  },
  {
    label: 'View',
    submenu: [
      { role: 'reload' },
      { role: 'forceReload' },
      ...(is.dev ? [{ role: 'toggleDevTools' as const }] : []),
      { type: 'separator' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' }
    ]
  },
  {
    label: 'Help',
    submenu: [
      {
        label: `Check for Updates (v${app.getVersion()})`,
        click: (): void => {
          shell.openExternal(`${REPO_URL}/releases`)
        }
      },
      { type: 'separator' },
      {
        label: 'About',
        click: (): void => {
          dialog
            .showMessageBox({
              type: 'info',
              title: 'About Research Viewer',
              message: 'Research Viewer',
              detail: `Version ${app.getVersion()}\n\nMIT License\n${REPO_URL}\n\nNo telemetry. No analytics.`,
              buttons: ['OK', 'View on GitHub']
            })
            .then(({ response }) => {
              if (response === 1) {
                shell.openExternal(REPO_URL)
              }
            })
        }
      }
    ]
  }
]

export function setupMenu(): void {
  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

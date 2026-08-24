import { describe, it, expect, vi, beforeEach } from 'vitest'
import { assertTransportContract } from '@genealogy/viewer-ui/contract'
import { IpcResearchTransport } from '../IpcResearchTransport'

let folderNoticeCb: ((m: string) => void) | null = null

// The IPC adapter must satisfy the SAME structural contract the web WS adapter
// does (shared harness from @genealogy/viewer-ui/contract).
function installApiStub(): void {
  folderNoticeCb = null
  ;(window as unknown as { api: unknown }).api = {
    getState: async () => ({ folderPath: null, research: null, gedcomx: null }),
    onResearchUpdated: () => {},
    onGedcomxUpdated: () => {},
    onWatchError: () => {},
    onFolderNotice: (cb: (m: string) => void) => {
      folderNoticeCb = cb
    },
    onSidecarUpdated: () => {},
    removeAllWatchListeners: () => {},
    readSidecar: async () => null,
    openExternal: async () => {},
    submitFeedback: async () => ({ ok: true }),
    selectFolder: async () => null,
    listProjectFiles: async () => [],
    getSessionLog: async () => ({ entries: [], sizeBytes: 0 }),
    openFile: async () => null,
    getVersion: async () => 'test'
  }
}

describe('IpcResearchTransport', () => {
  beforeEach(installApiStub)

  it('satisfies the ResearchTransport contract', async () => {
    await assertTransportContract(new IpcResearchTransport())
  })

  // Pins the seam between Electron IPC and the viewer: main's
  // `project:folder-notice` must land on `handlers.onNotice`. The contract test
  // above only checks shape, so deleting the wiring line leaves it green.
  it('routes a folder notice to handlers.onNotice', () => {
    const onNotice = vi.fn()
    new IpcResearchTransport().subscribe({
      onResearch: () => {},
      onGedcomx: () => {},
      onSidecar: () => {},
      onError: () => {},
      onNotice
    })
    folderNoticeCb!('research.json is in a subfolder')
    expect(onNotice).toHaveBeenCalledWith('research.json is in a subfolder')
  })
})

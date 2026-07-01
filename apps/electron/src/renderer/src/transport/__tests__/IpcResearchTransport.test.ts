import { describe, it, beforeEach } from 'vitest'
import { assertTransportContract } from '@genealogy/viewer-ui/contract'
import { IpcResearchTransport } from '../IpcResearchTransport'

// The IPC adapter must satisfy the SAME structural contract the web WS adapter
// does (shared harness from @genealogy/viewer-ui/contract).
function installApiStub(): void {
  ;(window as unknown as { api: unknown }).api = {
    getState: async () => ({ folderPath: null, research: null, gedcomx: null }),
    onResearchUpdated: () => {},
    onGedcomxUpdated: () => {},
    onWatchError: () => {},
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
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { assertTransportContract } from '@genealogy/viewer-ui/contract'
import { IpcResearchTransport, unwrapIpcError } from '../IpcResearchTransport'
import type { AppAPI } from '../../../../preload/index.d'

let folderNoticeCb: ((m: string) => void) | null = null

// The IPC adapter must satisfy the SAME structural contract the web WS adapter
// does (shared harness from @genealogy/viewer-ui/contract).
function installApiStub(): void {
  folderNoticeCb = null
  // Annotated, NOT cast. The previous `as unknown` threw the type away, so a
  // channel missing from this stub was invisible to typecheck — it was missing
  // both `openFamilySearch` (added here) and `readImage` (drifted earlier and
  // nobody saw). Typecheck is the only net that catches a stub falling behind
  // the real API, and a cast blinds it.
  const stub: AppAPI = {
    getState: async () => ({ folderPath: null, research: null, gedcomx: null, notice: null }),
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
    getVersion: async () => 'test',
    // The channel this PR adds. Present because the annotation above forces it.
    openFamilySearch: async () => {},
    // Pre-existing drift the cast had been hiding: the real API has had this
    // since source-image reading landed, and the stub never gained it.
    readImage: async () => null
  }
  ;(window as unknown as { api: unknown }).api = stub
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

  // The hydration wire. The contract test above only checks `string | null`,
  // which a hardcoded `null` satisfies, so without this the notice can be dead
  // end-to-end on the only platform that has it with the whole suite green
  // (#1899 review — the same argument as the onNotice test above, other
  // direction).
  it('maps a stored notice through from getState', async () => {
    ;(window as unknown as { api: { getState: unknown } }).api.getState = async () => ({
      folderPath: '/p',
      research: null,
      gedcomx: null,
      notice: 'research.json is in a subfolder'
    })
    const state = await new IpcResearchTransport().getProjectState()
    expect(state.notice).toBe('research.json is in a subfolder')
  })

  // The provider puts err.message straight into the error bar, so the Electron
  // IPC wrapper has to come off here or the user reads boilerplate naming a
  // channel instead of the one sentence that helps them (#1722 round-8).
  it('strips the Electron IPC wrapper off a rejected selectFolder', async () => {
    window.api.selectFolder = () =>
      Promise.reject(
        new Error(
          "Error invoking remote method 'project:select-folder': Error: " +
            'research.json is in a subfolder ("sub"), not in the folder you picked.'
        )
      )
    await expect(new IpcResearchTransport().selectFolder()).rejects.toThrow(
      /^research\.json is in a subfolder/
    )
  })

  it('leaves a message that carries no IPC wrapper untouched', () => {
    expect(unwrapIpcError(new Error('plain failure'))).toBe('plain failure')
  })
})

import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import type { AppAPI } from '../src/preload/index.d'

afterEach(() => {
  cleanup()
})

// Stub window.api so components that reach for IPC during render don't crash
// in jsdom. Individual tests can override specific methods via vi.spyOn.
//
// Typed as AppAPI on purpose: this stub silently drifted from the preload once
// already (`onFolderNotice` was added to the preload and not here, so the next
// test to mount App through the real transport would have hit
// "onFolderNotice is not a function" — #1722 round-8). The annotation makes
// typecheck fail on the next missing method instead. Two dead entries went with
// it: `getProjectState` and `selectProjectFolder` are on no interface and were
// referenced nowhere.
const apiStub: AppAPI = {
  openExternal: () => Promise.resolve(),
  openFile: () => Promise.resolve(null),
  getVersion: () => Promise.resolve('test'),
  submitFeedback: () => Promise.resolve({ ok: true }),
  getSessionLog: () => Promise.resolve({ entries: [], sizeBytes: 0 }),
  getState: () =>
    Promise.resolve({ folderPath: null, research: null, gedcomx: null, notice: null }),
  selectFolder: () => Promise.resolve(null),
  listProjectFiles: () => Promise.resolve([]),
  onResearchUpdated: () => {},
  onGedcomxUpdated: () => {},
  onWatchError: () => {},
  onFolderNotice: () => {},
  onSidecarUpdated: () => {},
  removeAllWatchListeners: () => {},
  readSidecar: () => Promise.resolve(null),
  readImage: () => Promise.resolve(null)
}

if (typeof window !== 'undefined' && !('api' in window)) {
  Object.defineProperty(window, 'api', { writable: true, value: apiStub })
}

import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(() => {
  cleanup()
})

// Stub window.api so components that reach for IPC during render don't crash
// in jsdom. Individual tests can override specific methods via vi.spyOn.
if (typeof window !== 'undefined' && !('api' in window)) {
  Object.defineProperty(window, 'api', {
    writable: true,
    value: {
      openExternal: () => {},
      openFile: () => Promise.resolve(null),
      getVersion: () => Promise.resolve('test'),
      submitFeedback: () => Promise.resolve({ ok: true }),
      getSessionLog: () => Promise.resolve({ entries: [], sizeBytes: 0 }),
      getProjectState: () => Promise.resolve({ folderPath: null, research: null, gedcomx: null }),
      getState: () => Promise.resolve({ folderPath: null, research: null, gedcomx: null }),
      selectFolder: () => Promise.resolve(null),
      selectProjectFolder: () => Promise.resolve(null),
      onResearchUpdated: () => {},
      onGedcomxUpdated: () => {},
      onWatchError: () => {},
      onSidecarUpdated: () => {},
      removeAllWatchListeners: () => {},
      readSidecar: () => Promise.resolve(null)
    }
  })
}

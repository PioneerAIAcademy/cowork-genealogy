import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

// jsdom does not implement Element.prototype.scrollIntoView. Components that
// call it (e.g. SidecarPanel's auto-scroll to the focused person, fired from a
// requestAnimationFrame) would otherwise throw an unhandled error that fails the
// whole test run even though every test passes. Stub it to a no-op.
window.HTMLElement.prototype.scrollIntoView = vi.fn()

// jsdom here does not expose a full Storage either. Sidebar's getInitialTheme()
// reads localStorage unguarded at mount, so every test that renders App threw
// "localStorage.getItem is not a function". Back it with an in-memory store.
// A test needing to assert on storage still stubs its own (vi.stubGlobal wins).
const memoryStorage = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => memoryStorage.get(k) ?? null,
  setItem: (k: string, v: string) => void memoryStorage.set(k, String(v)),
  removeItem: (k: string) => void memoryStorage.delete(k),
  clear: () => memoryStorage.clear(),
  key: (i: number) => [...memoryStorage.keys()][i] ?? null,
  get length() {
    return memoryStorage.size
  }
})

afterEach(() => {
  cleanup()
})

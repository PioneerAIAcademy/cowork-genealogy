import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

// jsdom does not implement Element.prototype.scrollIntoView. Components that
// call it (e.g. SidecarPanel's auto-scroll to the focused person, fired from a
// requestAnimationFrame) would otherwise throw an unhandled error that fails the
// whole test run even though every test passes. Stub it to a no-op.
window.HTMLElement.prototype.scrollIntoView = vi.fn()

afterEach(() => {
  cleanup()
})

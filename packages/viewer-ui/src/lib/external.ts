// Opening an external URL is a UI-shell concern, not data — and it is used by
// deep leaf components (PersonCard, SidecarResultCard) that should stay
// renderable without the data provider. So instead of threading it through
// React context, the app wires the transport's implementation once at startup
// via setOpenExternal(). The default falls back to window.open so components
// work (and tests render) before any wiring.
let impl: (url: string) => void = (url) => {
  if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener,noreferrer')
}

/** Wire the platform implementation (Electron: shell.openExternal; web: window.open). */
export function setOpenExternal(fn: (url: string) => void): void {
  impl = fn
}

/** Open a URL outside the app. No-ops on empty input. */
export function openExternal(url: string | undefined | null): void {
  if (url) impl(url)
}

// The constrained sibling (#1018). Deliberately NOT defaulted to window.open:
// an unwired FamilySearch link must do nothing rather than open an unchecked
// destination, which is the whole point of the channel. In Electron an unwired
// call would be denied by setWindowOpenHandler anyway; failing closed here makes
// that explicit instead of platform-dependent.
let fsImpl: ((value: string) => void) | null = null

/** Wire the platform implementation. See `setOpenExternal` for the why. */
export function setOpenFamilySearch(fn: (value: string) => void): void {
  fsImpl = fn
}

/** Open a FamilySearch link. No-ops on empty input, or before wiring. */
export function openFamilySearch(value: string | undefined | null): void {
  if (value && fsImpl) fsImpl(value)
}

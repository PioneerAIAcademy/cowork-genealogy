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

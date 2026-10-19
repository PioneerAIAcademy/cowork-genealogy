import { app } from 'electron'

// Which build of the viewer this is (#2126). `app.getVersion()` is the frozen
// package.json version (1.0.0 since the day it was added), so on its own it
// identifies nothing. electron.vite.config.ts computes the stamp at build time
// — `<base>+<YYYY-MM-DD>.<sha>[.dirty]`, the same shape the MCP server and the
// hosted web bundle carry — and injects it as the compile-time constant
// `__BUILD_INFO__` (Vite `define`). Under vitest, or any build that skipped the
// define, the constant is absent and we fall back to `<base>+dev`.
export type ViewerBuildInfo = {
  version: string
  sha: string
  date: string
  dirty: boolean
}

declare const __BUILD_INFO__: unknown

/** Pure: turns the injected constant (or its absence) into a ViewerBuildInfo. */
export function resolveBuildInfo(defined: unknown, base: string): ViewerBuildInfo {
  if (
    defined &&
    typeof defined === 'object' &&
    typeof (defined as ViewerBuildInfo).version === 'string' &&
    (defined as ViewerBuildInfo).version.includes('+') &&
    typeof (defined as ViewerBuildInfo).sha === 'string' &&
    typeof (defined as ViewerBuildInfo).date === 'string' &&
    typeof (defined as ViewerBuildInfo).dirty === 'boolean'
  ) {
    const d = defined as ViewerBuildInfo
    return { version: d.version, sha: d.sha, date: d.date, dirty: d.dirty }
  }
  return { version: `${base}+dev`, sha: 'dev', date: 'dev', dirty: false }
}

export function viewerBuildInfo(): ViewerBuildInfo {
  return resolveBuildInfo(
    typeof __BUILD_INFO__ === 'undefined' ? undefined : __BUILD_INFO__,
    app.getVersion()
  )
}

/** The string the feedback bundle and the renderer show; `-dev` marks an unpackaged run. */
export function viewerVersionString(): string {
  return viewerBuildInfo().version + (app.isPackaged ? '' : '-dev')
}

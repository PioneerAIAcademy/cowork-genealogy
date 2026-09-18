import { readFileSync } from 'node:fs'
import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
// Plain .mjs build helper shared with scripts/build-mcpb.mjs and
// scripts/package-plugin.mjs (this tsconfig admits untyped JS imports).
import { buildVersion, gitStamp } from '../../scripts/build-stamp.mjs'

// Build stamp (#2126): `<package.json version>+<YYYY-MM-DD>.<sha>[.dirty]`, or
// `+dev` when git cannot answer. Computed here, at build time, from the repo
// root checkout, and injected into the main process as `__BUILD_INFO__` — read
// by src/main/build-info.ts. Same helper and same shape as the MCP server's
// build/build-info.json, so a feedback bundle's viewer_version and the engine's
// buildId are directly comparable. The release workflow needs nothing extra:
// actions/checkout leaves HEAD readable, which is all gitStamp asks for.
const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as { version: string }
const stamp = gitStamp(resolve('../..'))
const buildInfo = {
  version: buildVersion(pkg.version, stamp),
  sha: stamp.sha ?? 'dev',
  date: stamp.sha ? stamp.date : 'dev',
  dirty: stamp.dirty
}

export default defineConfig({
  main: {
    define: { __BUILD_INFO__: JSON.stringify(buildInfo) }
  },
  preload: {},
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react()]
  }
})

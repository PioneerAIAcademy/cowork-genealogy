#!/usr/bin/env node
/**
 * Does the packaged app actually contain the modules its main process requires?
 *
 * Issue #1070. `out/main/index.js` top-level-requires its declared dependencies
 * (electron-vite externalises anything in `dependencies`), so each one has to be
 * present in the packaged `app.asar`. When electron-builder resolves the wrong
 * node-module collector it silently ships without them: the build stays GREEN,
 * electron-builder logs `cannot find path for dependency` at **warn**, and the
 * installed app opens no window and prints nothing.
 *
 * Measured on this branch before the fix (macOS, `--dir`, electron-builder
 * 26.15.3): `npm run build:unpack` produced an asar with 105 packages and all
 * five direct dependencies missing, 0 renderer helpers; `pnpm build && pnpm exec
 * electron-builder --dir` produced 124 packages, all five present, 3 helpers.
 * Same tree, same command, different package manager.
 *
 * This is the check that makes that difference fail loudly. It reads files only
 * — it never launches Electron — so it is safe in CI and immune to the
 * ELECTRON_RUN_AS_NODE trap described below.
 *
 * Usage:
 *   node scripts/check-packaged-deps.mjs [<dist-dir-or-app.asar>]
 *
 * Defaults to `dist/`, and checks EVERY `app.asar` it finds there — a mac build
 * emits one per architecture, and checking only the first would pass a broken
 * second one.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { builtinModules, createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const HERE = dirname(fileURLToPath(import.meta.url))
const APP_ROOT = resolve(HERE, '..')

/** Modules that are always available to a packaged main process. */
const ALWAYS_PRESENT = new Set([...builtinModules, 'electron'])

/**
 * Top-level `require("x")` calls in the built main bundle.
 *
 * Relative and absolute specifiers are skipped: they resolve inside the bundle
 * (`../preload/index.js`) rather than against `node_modules`. A subpath import
 * like `foo/bar` is reduced to its package name, and a scoped package keeps two
 * segments.
 */
function requiredPackages(mainFile) {
  const source = readFileSync(mainFile, 'utf8')
  const names = new Set()
  for (const [, spec] of source.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)) {
    if (spec.startsWith('.') || spec.startsWith('/')) continue
    if (spec.startsWith('node:')) continue
    const parts = spec.split('/')
    const name = spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
    if (ALWAYS_PRESENT.has(name)) continue
    names.add(name)
  }
  return [...names].sort()
}

/** Every `app.asar` under `dir`, breadth-first. */
function findAsars(dir, depth = 0) {
  if (depth > 8 || !existsSync(dir)) return []
  const found = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    let s
    try {
      s = statSync(full)
    } catch {
      continue // a broken symlink inside a .app bundle is not our problem
    }
    if (s.isDirectory()) found.push(...findAsars(full, depth + 1))
    else if (entry === 'app.asar') found.push(full)
  }
  return found
}

/** Top-level package names present in the asar's own `node_modules`. */
function packagesInAsar(asarPath) {
  const asar = require('@electron/asar')
  const names = new Set()
  for (const file of asar.listPackage(asarPath, { isPack: false })) {
    // `listPackage` returns POSIX-style paths with a leading slash on every
    // platform, so this pattern is not Windows-specific.
    const m = file.match(/^[/\\]node_modules[/\\]((?:@[^/\\]+[/\\])?[^/\\]+)/)
    if (m) names.add(m[1].replace(/\\/g, '/'))
  }
  return names
}

function main(argv) {
  const target = resolve(argv[0] ?? join(APP_ROOT, 'dist'))
  const mainFile = join(APP_ROOT, 'out', 'main', 'index.js')

  if (!existsSync(mainFile)) {
    console.error(
      `check-packaged-deps: no built main bundle at ${mainFile}.\n` +
        'Run the build before the check — with nothing to read, this check ' +
        'would inspect nothing and pass, which is the failure it exists to prevent.',
    )
    return 2
  }

  const asars = target.endsWith('.asar') ? [target] : findAsars(target)
  if (asars.length === 0) {
    // The load-bearing failure. A check that silently inspects nothing reads as
    // coverage and is worse than no check at all (CLAUDE.md, "A new lint must be
    // proven to fail").
    console.error(
      `check-packaged-deps: no app.asar found under ${target}.\n` +
        'Nothing was inspected, so this is a FAILURE, not a pass. Package the ' +
        'app first (`electron-builder --dir`), or pass the asar path explicitly.',
    )
    return 2
  }

  const required = requiredPackages(mainFile)
  if (required.length === 0) {
    console.log(
      'check-packaged-deps: the main bundle requires no external packages; ' +
        'nothing to verify.',
    )
    return 0
  }

  let failed = false
  for (const asarPath of asars) {
    const present = packagesInAsar(asarPath)
    const missing = required.filter((name) => !present.has(name))
    const rel = asarPath.replace(`${APP_ROOT}/`, '')
    if (missing.length > 0) {
      failed = true
      console.error(
        `\ncheck-packaged-deps: FAIL — ${rel}\n` +
          `  ${present.size} package(s) in the asar, but the main process requires ` +
          `${missing.length} that are absent:\n` +
          missing.map((m) => `    - ${m}`).join('\n') +
          '\n  The packaged app will not launch: it exits without a window and ' +
          'prints nothing.\n' +
          "  Cause is almost always electron-builder resolving the wrong node-module\n" +
          "  collector — check for `cannot find path for dependency` in the packaging\n" +
          '  log, and that apps/electron/package.json still has its "packageManager" field.',
      )
    } else {
      console.log(
        `check-packaged-deps: OK — ${rel} (${present.size} packages, all ` +
          `${required.length} required present)`,
      )
    }
  }
  return failed ? 1 : 0
}

process.exit(main(process.argv.slice(2)))

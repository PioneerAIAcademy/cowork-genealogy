#!/usr/bin/env node
/**
 * Does the packaged app actually contain the dependencies it declares?
 *
 * Issue #1070. electron-vite externalises everything in `dependencies`, so each
 * one has to be present in the packaged `app.asar`. When electron-builder
 * resolves the wrong node-module collector it silently ships without them: the
 * build stays GREEN, electron-builder logs `cannot find path for dependency` at
 * **warn**, and the installed app opens no window and prints nothing.
 *
 * Measured on this branch (macOS, `--dir`, electron-builder 26.15.3):
 * `npm run build:unpack` without the `packageManager` field produced an asar with
 * 105 packages and all 5 runtime dependencies missing, 0 renderer helpers;
 * with it, 124 packages, all present, 3 helpers. Same tree, same command.
 *
 * **Why it compares declared dependencies rather than scanning the bundle for
 * `require()` calls.** The scan was the first design and it had a silent no-op:
 * if it found no external requires it had nothing to compare and passed. That
 * state is reachable — an ESM main bundle, or the `externalizeDeps: false`
 * fallback this issue keeps on the table — so a fully broken package would go
 * green, which is the exact failure this check exists to prevent
 * (CLAUDE.md, "A new lint must be proven to fail"). Reading the declared list
 * cannot degrade that way: the list is never empty by accident. It also covers
 * the preload bundle for free, which a main-only scan did not.
 *
 * It reads files only — it never launches Electron — so it is safe in CI and
 * immune to the `ELECTRON_RUN_AS_NODE` trap that makes a *correct* artifact
 * report zero windows.
 *
 * Usage:
 *   node scripts/check-packaged-deps.mjs [<dist-dir-or-app.asar>]
 *
 * Defaults to `dist/`, and checks EVERY `app.asar` beneath it — a mac build
 * emits one per architecture, and checking only the first would pass a broken
 * second one.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const HERE = dirname(fileURLToPath(import.meta.url))
const APP_ROOT = resolve(HERE, '..')

/** Runtime dependencies the packaged app must carry. */
function declaredDependencies() {
  const pkg = JSON.parse(readFileSync(join(APP_ROOT, 'package.json'), 'utf8'))
  return Object.keys(pkg.dependencies ?? {}).sort()
}

/** Every `app.asar` under `dir`, depth-first. */
function findAsars(dir, depth = 0) {
  if (depth > 8 || !existsSync(dir)) return []
  const found = []
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    // Not a directory, or unreadable. Returning empty lands on the no-asar
    // branch below, which FAILS — never on a silent pass.
    return []
  }
  for (const entry of entries) {
    const full = join(dir, entry)
    let stats
    try {
      stats = statSync(full)
    } catch {
      continue // a broken symlink inside a .app bundle is not our problem
    }
    if (stats.isDirectory()) found.push(...findAsars(full, depth + 1))
    else if (entry === 'app.asar') found.push(full)
  }
  return found
}

/** Top-level package names present in the asar's own `node_modules`. */
function packagesInAsar(asarPath) {
  const asar = require('@electron/asar')
  const names = new Set()
  for (const file of asar.listPackage(asarPath, { isPack: false })) {
    // The `[/\\]` alternation is load-bearing, not defensive: `listFiles` builds
    // each entry with `path.join`, so a Windows run yields `\node_modules\foo`
    // while macOS and Linux yield `/node_modules/foo`.
    const match = file.match(/^[/\\]node_modules[/\\]((?:@[^/\\]+[/\\])?[^/\\]+)/)
    if (match) names.add(match[1].replace(/\\/g, '/'))
  }
  return names
}

function main(argv) {
  const target = resolve(argv[0] ?? join(APP_ROOT, 'dist'))

  if (!existsSync(target)) {
    console.error(
      `check-packaged-deps: ${target} does not exist.\n` +
        'Nothing was inspected, so this is a FAILURE, not a pass. Package the app ' +
        'first (`electron-builder --dir`), or pass an existing path.'
    )
    return 2
  }

  const asars = target.endsWith('.asar') ? [target] : findAsars(target)
  if (asars.length === 0) {
    // The load-bearing failure. A check that silently inspects nothing reads as
    // coverage and is worse than no check at all.
    console.error(
      `check-packaged-deps: no app.asar found under ${target}.\n` +
        'Nothing was inspected, so this is a FAILURE, not a pass. Package the app ' +
        'first (`electron-builder --dir`), or pass the asar path explicitly.'
    )
    return 2
  }

  const declared = declaredDependencies()
  if (declared.length === 0) {
    console.error(
      'check-packaged-deps: apps/electron/package.json declares no dependencies.\n' +
        'That is almost certainly a misread rather than a real state, and there ' +
        'would be nothing to verify — failing rather than passing on it.'
    )
    return 2
  }

  let failed = false
  for (const asarPath of asars) {
    const label = asarPath.startsWith(APP_ROOT) ? asarPath.slice(APP_ROOT.length + 1) : asarPath
    let present
    try {
      present = packagesInAsar(asarPath)
    } catch (err) {
      // A truncated or corrupt archive is a packaging failure in its own right,
      // and it must not stop the other architectures being inspected — a mac
      // build emits one asar per arch, and aborting here would leave the second
      // unchecked while printing a header-parse stack instead of a diagnosis.
      failed = true
      console.error(
        `\ncheck-packaged-deps: FAIL — ${label}\n  could not be read as an asar archive: ${err.message}`
      )
      continue
    }
    const missing = declared.filter((name) => !present.has(name))
    if (missing.length > 0) {
      failed = true
      console.error(
        `\ncheck-packaged-deps: FAIL — ${label}\n` +
          `  ${present.size} package(s) in the asar, but ${missing.length} of the ` +
          `${declared.length} declared dependencies are absent:\n` +
          missing.map((name) => `    - ${name}`).join('\n') +
          '\n  A packaged app missing these does not launch: it exits without a ' +
          'window and prints nothing.\n' +
          '  Usual cause is electron-builder resolving the wrong node-module ' +
          'collector — look for\n' +
          '  `cannot find path for dependency` in the packaging log, and check that ' +
          'apps/electron/package.json\n' +
          '  still has its "packageManager" field. If this names an artifact you did ' +
          'not just build,\n' +
          '  `dist/` is stale — remove it and package again.'
      )
    } else {
      console.log(
        `check-packaged-deps: OK — ${label} (${present.size} packages, all ` +
          `${declared.length} declared dependencies present)`
      )
    }
  }
  return failed ? 1 : 0
}

// `process.exitCode`, not `process.exit()`: exiting immediately after writing to
// stderr can truncate the diagnostic when stderr is a pipe, which is exactly the
// case in CI — so the one run that needs the message is the one that loses it.
process.exitCode = main(process.argv.slice(2))

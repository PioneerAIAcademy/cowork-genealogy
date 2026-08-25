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
 * Measured on this branch by running both builds back to back (macOS, `--dir`,
 * electron-builder 26.15.3, counts from this script after its scope-directory
 * miscount was fixed):
 *
 *   without the `packageManager` field -> 102 packages, 5 of the 7 declared
 *     dependencies absent, and `cannot find path for dependency` in the log.
 *     The 2 that survive are the `workspace:*` packages, which is where the
 *     issue's original "five" figure comes from.
 *   with it -> 120 packages, all 7 present, no warning.
 *
 * Same tree, same command, the field the only difference.
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

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const HERE = dirname(fileURLToPath(import.meta.url))
const APP_ROOT = resolve(HERE, '..')

/** The app's own package.json. */
function appPackage() {
  return JSON.parse(readFileSync(join(APP_ROOT, 'package.json'), 'utf8'))
}

/** Runtime dependencies the packaged app must carry. */
function declaredDependencies(pkg) {
  return Object.keys(pkg.dependencies ?? {}).sort()
}

/**
 * The `main` entry, as the asar spells it: `./out/main/index.js` -> `/out/main/index.js`.
 *
 * Checked because every dependency directory can be present while the app's own
 * main bundle is absent — `build:mac` and `build:linux` reach electron-builder
 * even when `electron-vite build` emitted nothing useful, and a dependency-only
 * check calls that artifact OK.
 */
function entryPointPath(pkg) {
  const main = pkg.main ?? 'index.js'
  return '/' + main.replace(/^\.?\//, '')
}

const MAX_DEPTH = 12

/**
 * Every `app.asar` under `dir`, depth-first, plus every subtree we could NOT
 * look inside.
 *
 * Returning the skips is the whole point. An earlier version swallowed a
 * `readdir` failure and returned empty, which only fails loudly at depth 0 —
 * deeper down it meant an unreadable subtree vanished and the run could still
 * exit 0 while that architecture shipped broken. A mac build emits one asar per
 * arch, so "one leg unreadable, the other fine" is a real path, and a check that
 * reports OK there is worse than no check at all.
 *
 * `withFileTypes` gives the entry kind from the single `readdir`, so there is no
 * per-entry `stat`, and symlinks are never followed: an `app.asar` is always a
 * real file, while `Electron Framework.framework` links back through
 * `Versions/Current` and would otherwise be walked repeatedly.
 */
function findAsars(dir, depth = 0, skipped = []) {
  if (depth > MAX_DEPTH) {
    skipped.push(`${dir} (deeper than ${MAX_DEPTH} levels)`)
    return { found: [], skipped }
  }
  const found = []
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch (err) {
    skipped.push(`${dir} (${err.code ?? err.message})`)
    return { found, skipped }
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) found.push(...findAsars(full, depth + 1, skipped).found)
    else if (entry.name === 'app.asar') found.push(full)
  }
  return { found, skipped }
}

/** Top-level package names in the asar's `node_modules`, and whether `entry` is present. */
/**
 * The top-level package name for one asar entry, or null if the entry is not a
 * top-level `node_modules` member.
 *
 * Exported and unit-tested because both rules in it are load-bearing on a
 * platform this repo's test runners never use:
 *
 * The `[/\\]` alternation is not defensive — `listFiles` builds each entry with
 * `path.join`, so a Windows run yields `\node_modules\foo` while macOS and Linux
 * yield `/node_modules/foo`. Break it and a mac test run still passes; only a
 * tagged Windows release notices.
 *
 * Two explicit arms rather than an optional scope group: with the group
 * optional, `/node_modules/@genealogy` — the scope DIRECTORY, which `listFiles`
 * emits before its children — fell through to the unscoped arm and was counted
 * as a package, inflating every number this check printed by the number of
 * scopes present (4 on this tree: 124 reported, 120 real).
 */
export function packageNameFromEntry(file) {
  const match = file.match(/^[/\\]node_modules[/\\](@[^/\\]+[/\\][^/\\]+|[^@][^/\\]*)/)
  return match ? match[1].replace(/\\/g, '/') : null
}

/** One asar entry in the archive's own spelling, for comparing against `main`. */
export function normaliseEntry(file) {
  return file.replace(/\\/g, '/')
}

/** Top-level package names in the asar's `node_modules`, and whether `entry` is present. */
function inspectAsar(asarPath, entry) {
  const asar = require('@electron/asar')
  const names = new Set()
  let hasEntry = false
  for (const file of asar.listPackage(asarPath, { isPack: false })) {
    if (normaliseEntry(file) === entry) hasEntry = true
    const name = packageNameFromEntry(file)
    if (name) names.add(name)
  }
  return { names, hasEntry }
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

  let asars, skipped
  if (target.endsWith('.asar')) {
    asars = [target]
    skipped = []
  } else {
    ;({ found: asars, skipped } = findAsars(target))
  }

  if (skipped.length > 0) {
    // Not a warning. An unread subtree is an unchecked artifact, and reporting
    // OK beside it is the "reads as coverage" failure this check exists to stop.
    console.error(
      `check-packaged-deps: FAIL — ${skipped.length} subtree(s) under ${target} could not be ` +
        'searched, so an app.asar may have gone uninspected:\n' +
        skipped.map((entry) => `    - ${entry}`).join('\n')
    )
    return 2
  }

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

  const pkg = appPackage()
  const declared = declaredDependencies(pkg)
  const entry = entryPointPath(pkg)
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
    let present, hasEntry
    try {
      ;({ names: present, hasEntry } = inspectAsar(asarPath, entry))
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
    if (!hasEntry) {
      failed = true
      console.error(
        `\ncheck-packaged-deps: FAIL — ${label}\n  the app's own entry point ${entry} ` +
          '(package.json "main") is not in the archive.\n  Every dependency can be ' +
          'present and the app still opens nothing without it.'
      )
    }
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
    } else if (hasEntry) {
      console.log(
        `check-packaged-deps: OK — ${label} (${present.size} packages, all ` +
          `${declared.length} declared dependencies present, ${entry} present)`
      )
    }
  }
  return failed ? 1 : 0
}

// `process.exitCode`, not `process.exit()`: exiting immediately after writing to
// stderr can truncate the diagnostic when stderr is a pipe, which is exactly the
// case in CI — so the one run that needs the message is the one that loses it.
//
// Guarded so a test can import the helpers above without running the check. The
// two path-parsing rules are only exercisable on the platform whose separator
// they handle, so they are unit-tested rather than left to a tagged release.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2))
}

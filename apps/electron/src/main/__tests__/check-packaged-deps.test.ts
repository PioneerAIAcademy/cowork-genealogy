/**
 * Behavioural tests for `scripts/check-packaged-deps.mjs` (#1070).
 *
 * `packaging.test.ts` asserts the guard is *wired up* — that each `build:*`
 * script calls it and the release workflow still runs it. It never asserts the
 * guard *works*. Nothing else does either: `check-packaged` runs only from the
 * four `build:*` scripts and from `electron-release.yml`, which fires on a tag
 * or a manual dispatch, so no pull-request check ever executes the script.
 *
 * That is the same window the wiring test exists to close, one level down: break
 * the package-name regex, or the backslash handling the Windows release leg
 * proved load-bearing, and every check stays green until someone cuts a release.
 *
 * These tests build real asar archives with `@electron/asar` in a temp
 * directory, so they need no build, no network and no Electron. They run under
 * `pnpm workspace`, which is a required check on `protect-main`.
 *
 * Fixtures derive the dependency list from `package.json` rather than hardcoding
 * it, so adding a dependency cannot silently make a case vacuous.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import asar from '@electron/asar'
import { packageNameFromEntry, normaliseEntry } from '../../../scripts/check-packaged-deps.mjs'

const APP_ROOT = process.cwd()
const SCRIPT = join(APP_ROOT, 'scripts', 'check-packaged-deps.mjs')

const pkg = JSON.parse(readFileSync(join(APP_ROOT, 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>
  main?: string
}
const DECLARED = Object.keys(pkg.dependencies ?? {})
const ENTRY = (pkg.main ?? 'index.js').replace(/^\.?\//, '')

let root: string

/**
 * Pack an asar containing `deps` under node_modules, and the app's own entry
 * point when `entry` is set. `extras` adds unrelated packages so a case can
 * hold the right *count* without the right *names*.
 */
async function makeAsar(
  name: string,
  { deps, entry, extras = 0 }: { deps: string[]; entry: boolean; extras?: number }
): Promise<string> {
  const src = join(root, `${name}-src`)
  const outDir = join(root, name)
  mkdirSync(outDir, { recursive: true })
  mkdirSync(src, { recursive: true })
  writeFileSync(join(src, 'package.json'), '{}')

  for (const d of deps) {
    mkdirSync(join(src, 'node_modules', d), { recursive: true })
    writeFileSync(join(src, 'node_modules', d, 'package.json'), '{}')
  }
  for (let i = 0; i < extras; i++) {
    mkdirSync(join(src, 'node_modules', `filler-${i}`), { recursive: true })
    writeFileSync(join(src, 'node_modules', `filler-${i}`, 'package.json'), '{}')
  }
  if (entry) {
    mkdirSync(dirname(join(src, ENTRY)), { recursive: true })
    writeFileSync(join(src, ENTRY), '// entry\n')
  }

  const asarPath = join(outDir, 'app.asar')
  await asar.createPackage(src, asarPath)
  return outDir
}

/** Run the guard against `target`; never throws, so the exit code is assertable. */
function runGuard(target: string): { code: number; out: string } {
  try {
    const out = execFileSync(process.execPath, [SCRIPT, target], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    })
    return { code: 0, out }
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string }
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'check-packaged-'))
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('check-packaged-deps.mjs behaviour (#1070)', () => {
  it('has dependencies and an entry point to check, so no case is vacuous', () => {
    // If package.json ever declared nothing, every case below would pass
    // trivially — which is the shape of check this whole file exists to avoid.
    expect(DECLARED.length).toBeGreaterThan(0)
    expect(ENTRY).toMatch(/\.js$/)
  })

  it('passes an archive carrying every declared dependency and the entry point', async () => {
    const dir = await makeAsar('good', { deps: DECLARED, entry: true })
    const { code, out } = runGuard(dir)
    expect(code, out).toBe(0)
    expect(out).toContain('OK')
    expect(out).toContain(`all ${DECLARED.length} declared dependencies present`)
  })

  it('fails and names each missing dependency — the #1070 failure itself', async () => {
    // The shape the npm collector produced: a populated node_modules that
    // happens not to contain the declared packages.
    const dir = await makeAsar('missing-deps', { deps: [], entry: true, extras: 12 })
    const { code, out } = runGuard(dir)
    expect(code, out).toBe(1)
    expect(out).toContain('FAIL')
    for (const d of DECLARED) expect(out).toContain(d)
  })

  it('fails when every dependency is present but the entry point is absent', async () => {
    const dir = await makeAsar('no-entry', { deps: DECLARED, entry: false })
    const { code, out } = runGuard(dir)
    expect(code, out).toBe(1)
    expect(out).toContain(`/${ENTRY}`)
  })

  it('reports a corrupt archive instead of crashing, and still inspects the others', async () => {
    // Two asars under one root: one unreadable, one good. Aborting on the first
    // would leave the second unchecked — a mac build emits one per architecture.
    const dir = join(root, 'pair')
    mkdirSync(join(dir, 'a'), { recursive: true })
    writeFileSync(join(dir, 'a', 'app.asar'), Buffer.from([0xff, 0xfe, 0x00, 0x01, 0x02]))
    const good = await makeAsar('pair-good', { deps: DECLARED, entry: true })
    // copyFileSync, not `cp`: this suite has to run on the Windows half of the
    // team, and a POSIX-only shell call here would be the same platform break
    // this PR's review was about.
    mkdirSync(join(dir, 'b'), { recursive: true })
    copyFileSync(join(good, 'app.asar'), join(dir, 'b', 'app.asar'))

    const { code, out } = runGuard(dir)
    expect(code, out).toBe(1)
    expect(out).toContain('could not be read as an asar archive')
    expect(out, 'the good archive must still be inspected').toContain('OK')
  })

  it('fails rather than passes when there is no archive to inspect', async () => {
    const empty = join(root, 'empty')
    mkdirSync(empty, { recursive: true })
    const { code, out } = runGuard(empty)
    expect(code, out).toBe(2)
    expect(out).toContain('this is a FAILURE, not a pass')
  })

  it('fails rather than passes when the target does not exist', () => {
    const { code, out } = runGuard(join(root, 'nope'))
    expect(code, out).toBe(2)
    expect(out).toContain('does not exist')
  })

  // The two rules below are only exercised on Windows, where `listFiles` builds
  // entries with backslashes. A macOS run cannot reach them: mutating either one
  // left all seven archive tests above green, which is exactly why they are
  // tested directly rather than left to a tagged release to discover.
  describe('path parsing on both separators', () => {
    it('reads a package name from a POSIX entry', () => {
      expect(packageNameFromEntry('/node_modules/chokidar')).toBe('chokidar')
      expect(packageNameFromEntry('/node_modules/@genealogy/schema')).toBe('@genealogy/schema')
    })

    it('reads a package name from a WINDOWS entry', () => {
      expect(packageNameFromEntry('\\node_modules\\chokidar')).toBe('chokidar')
      expect(packageNameFromEntry('\\node_modules\\@genealogy\\schema')).toBe('@genealogy/schema')
    })

    it('does not count a bare scope directory as a package', () => {
      // `listFiles` emits the scope dir before its children; counting it
      // inflated every printed total (124 reported vs 120 real).
      expect(packageNameFromEntry('/node_modules/@genealogy')).toBeNull()
      expect(packageNameFromEntry('\\node_modules\\@genealogy')).toBeNull()
    })

    it('ignores entries outside a top-level node_modules', () => {
      expect(packageNameFromEntry('/out/main/index.js')).toBeNull()
      expect(packageNameFromEntry('/node_modules/chokidar/node_modules/readdirp')).toBe('chokidar')
    })

    it('normalises a Windows entry path for the entry-point comparison', () => {
      expect(normaliseEntry('\\out\\main\\index.js')).toBe('/out/main/index.js')
      expect(normaliseEntry('/out/main/index.js')).toBe('/out/main/index.js')
    })
  })
})

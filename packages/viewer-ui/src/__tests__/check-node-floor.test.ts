import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * scripts/check-node-floor.mjs runs before the reinstall paths (Reinstall.bat,
 * scripts\windows\reinstall.bat, `make reinstall`) delete every node_modules,
 * and before eval\Setup.bat installs anything. pnpm (engine-strict) and the
 * engine's npm refuse the same Node and npm versions, but only once the
 * launcher is under way: a reinstall has deleted everything by then.
 *
 * Three things are pinned here: the script's verdicts, those verdicts against
 * every non-optional engines range in pnpm-lock.yaml (so a dependency bump that
 * raises the floor fails this test until the script moves too), and each
 * launcher running it, and stopping on its refusal, before it deletes or
 * installs. Lives in viewer-ui for the same reason as gen-enums-guards.test.ts:
 * repo-root scripts have no test runner of their own.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')
const SCRIPT = join(repoRoot, 'scripts', 'check-node-floor.mjs')

// Not a declared dependency: every install of this workspace has it hoisted at
// the root (dozens of packages depend on it), and declaring it here re-resolves
// unrelated parts of pnpm-lock.yaml. If it is ever missing this file fails to
// load, so the check cannot pass unseen.
const semver = createRequire(join(repoRoot, 'package.json'))('semver') as {
  satisfies(version: string, range: string): boolean
}

function run(args: string[], env: NodeJS.ProcessEnv = process.env) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env })
  return { status: r.status, stderr: r.stderr, stdout: r.stdout }
}

const read = (path: string) => readFileSync(join(repoRoot, path), 'utf8')

/** A YAML scalar from pnpm-lock.yaml, unquoted. */
const unquote = (value: string) => value.trim().replace(/^'(.*)'$/, '$1').replace(/^"(.*)"$/, '$1')

/** `engines.node` of every pnpm-lock.yaml package that is installed whatever the platform. */
function lockNodeRanges(): Map<string, string> {
  const lock = read('pnpm-lock.yaml')
  const packages = lock.slice(lock.indexOf('\npackages:\n'), lock.indexOf('\nsnapshots:\n'))
  const snapshots = lock.slice(lock.indexOf('\nsnapshots:\n'))
  const entry = /^ {2}('?)([^\s'][^\n]*?)\1:(?: \{\})?\n((?: {4}.*\n)*)/gm
  // A package is optional only when every snapshot of it is (pnpm skips it then).
  // A snapshot written `name@1.0.0: {}` has no body and is not optional.
  const required = new Set<string>()
  for (const m of snapshots.matchAll(entry)) {
    const key = m[2].replace(/\(.*$/, '')
    if (!/^ {4}optional: true$/m.test(m[3])) required.add(key)
  }
  const ranges = new Map<string, string>()
  for (const m of packages.matchAll(entry)) {
    // pnpm writes the keys sorted, so node need not come first: {iojs: ..., node: ...}.
    const node = /^ {4}engines: \{(?:[^}]*?, )?node: ('[^']*'|"[^"]*"|[^,}]+)/m.exec(m[3])
    if (node && required.has(m[2])) ranges.set(m[2], unquote(node[1]))
  }
  return ranges
}

describe('check-node-floor verdicts', () => {
  it.each([
    ['22.22.1', '11.12.1', 1],
    ['22.22.2', '10.9.7', 1],
    ['22.22.2', '11.12.1', 0],
    ['22.23.4', '11.12.1', 0],
    ['23.11.0', '11.12.1', 1],
    ['24.14.1', '11.12.1', 1],
    ['24.15.0', '11.12.1', 0],
    ['v24.15.0', '11.12.1', 0],
    ['25.9.0', '11.12.1', 1],
    ['26.0.0', '11.12.1', 0],
    ['26.13.0', '11.20.0', 0],
    ['26.13.0', '12.2.2', 1],
    ['26.13.0', '11.11.0', 1],
    ['27.1.0', '11.12.1', 0],
  ])('node %s with npm %s exits %i', (node, npm, want) => {
    expect(run(['--node', node, '--npm', npm]).status).toBe(want)
  })

  it.each(['abc', '24.15', '', '24.15.0-rc.1', '24.15.0.1'])('refuses to read node %j (exit 2, never 0)', (node) => {
    expect(run(['--node', node, '--npm', '11.12.1']).status).toBe(2)
  })

  it.each(['eleven', '11', ''])('refuses to read npm %j (exit 2, never 0)', (npm) => {
    expect(run(['--node', '26.13.0', '--npm', npm]).status).toBe(2)
  })

  it.each([
    ['22.22.1', '11.12.1', /22\.22\.2.*24\.15.*26/s],
    ['25.9.0', '11.12.1', /22\.22\.2.*24\.15.*26/s],
    ['22.22.2', '10.9.7', /npm install -g npm@11\.12\.1/],
    ['26.13.0', '12.2.2', /not 12/],
  ])('names the fix when node %s / npm %s is refused', (node, npm, fix) => {
    expect(run(['--node', node, '--npm', npm]).stderr).toMatch(fix)
  })

  it('refuses when npm cannot be run, rather than passing unchecked', () => {
    const r = run(['--node', '26.13.0'], { ...process.env, PATH: '' })
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('npm --version')
  })

  it.each([['--nod', '26.13.0'], ['--node'], ['--ranges', '--ranges']])('refuses the arguments %j', (...args) => {
    expect(run(args).status).toBe(2)
  })
})

describe('check-node-floor agrees with pnpm-lock.yaml', () => {
  it('accepts a Node version exactly when every required package in the lockfile does', () => {
    const ranges = lockNodeRanges()
    expect(ranges.size).toBeGreaterThan(100)
    // Every bound any range names, the releases just below and just above it (an
    // upper bound can be implied: ~22.22.2, 22.22.x), plus the majors.
    const candidates = new Set<string>()
    for (const range of ranges.values()) {
      for (const [, major, minor = '0', patch = '0'] of range.matchAll(/(\d+)(?:\.(\d+))?(?:\.(\d+))?/g)) {
        const [M, m, p] = [Number(major), Number(minor), Number(patch)]
        if (M < 20 || M > 30) continue
        candidates.add(`${M}.${m}.${p}`)
        candidates.add(p > 0 ? `${M}.${m}.${p - 1}` : m > 0 ? `${M}.${m - 1}.99` : `${M - 1}.99.99`)
        candidates.add(`${M}.${m}.${p + 1}`)
        candidates.add(`${M}.${m + 1}.0`)
      }
    }
    for (let M = 20; M <= 30; M++) candidates.add(`${M}.0.0`)
    const disagreements = [...candidates].filter((version) => {
      const lockAccepts = [...ranges.values()].every((range) => semver.satisfies(version, range))
      return (run(['--node', version, '--npm', '11.12.1']).status === 0) !== lockAccepts
    })
    expect(disagreements).toEqual([])
  }, 120_000)

  it('names, in its ranges, the jsdom and vitest that the lockfile resolves', () => {
    const ranges = JSON.parse(run(['--ranges']).stdout) as { node: string[]; npm: string }
    const lock = lockNodeRanges()
    const declared = [...lock].filter(([key]) => /^(jsdom|vitest)@/.test(key)).map(([, range]) => range)
    expect(declared).toHaveLength(2)
    expect([...declared].sort()).toEqual([...ranges.node].sort())
  })

  it("enforces the engine's npm range", () => {
    const ranges = JSON.parse(run(['--ranges']).stdout) as { npm: string }
    expect(ranges.npm).toBe(JSON.parse(read('packages/engine/mcp-server/package.json')).engines.npm)
  })
})

describe('every reinstall path and eval\\Setup.bat check first', () => {
  /**
   * Offset of a line matching `call` whose very next line is `if errorlevel 1`
   * and stops the script: `exit /b` on that line, or inside the block it opens.
   * -1 when there is no such pair.
   */
  function guardedCheck(text: string, call: RegExp): number {
    // Each line keeps its own ending, so offsets stay exact on the CRLF .bat files.
    const raw = text.split(/(?<=\n)/)
    const lines = raw.map((line) => line.replace(/\r?\n$/, ''))
    const EXIT = 'exit /b (?:[1-9]|%errorlevel%)'
    let offset = 0
    for (let i = 0; i < lines.length - 1; i++) {
      const guard = lines[i + 1]
      if (call.test(lines[i]) && /^if errorlevel 1 /i.test(guard)) {
        // cmd matches these words in any case: EXIT /B %ERRORLEVEL% stops too.
        let stops = new RegExp(`^if errorlevel 1 ${EXIT}`, 'i').test(guard)
        if (!stops && guard.trimEnd().endsWith('(')) {
          for (let j = i + 2; j < lines.length && !/^\s*\)\s*$/.test(lines[j]); j++) {
            if (new RegExp(`^\\s*${EXIT}`, 'i').test(lines[j])) stops = true
          }
        }
        if (stops) return offset
      }
      offset += raw[i].length
    }
    return -1
  }
  const CHECK = /^call node "?[^"]*check-node-floor\.mjs"?$/i

  it('Reinstall.bat checks from the repo root, before its first rmdir', () => {
    const text = read('Reinstall.bat')
    expect(text).toMatch(/^cd \/d "%~dp0"\r?$/m)
    const check = guardedCheck(text, CHECK)
    expect(check).toBeGreaterThan(-1)
    expect(check).toBeLessThan(text.search(/^if exist \S+ rmdir/m))
    expect(text).toMatch(/^if exist apps\\mcp-viewer\\node_modules rmdir \/s \/q apps\\mcp-viewer\\node_modules\r?$/m)
  })

  it('scripts\\windows\\reinstall.bat checks before it calls clean-deps.bat', () => {
    const text = read('scripts/windows/reinstall.bat')
    const check = guardedCheck(text, CHECK)
    expect(check).toBeGreaterThan(-1)
    expect(check).toBeLessThan(text.search(/^call "%~dp0clean-deps\.bat"/m))
  })

  it('make reinstall checks before clean-deps, which is not a prerequisite', () => {
    const makefile = read('Makefile')
    const recipe = /^reinstall:([^#\n]*)(?:##[^\n]*)?\n((?:\t[^\n]*\n)+)/m.exec(makefile)
    expect(recipe).not.toBeNull()
    // A prerequisite runs before the recipe, so clean-deps there would delete first.
    // make merges the prerequisites of every rule line naming `reinstall` among its
    // targets (`reinstall : x`, `other reinstall: x`); `reinstall: FOO := bar` sets a
    // target-specific variable and adds none.
    const prerequisites: string[] = []
    for (const line of makefile.split('\n')) {
      const rule = /^([^\t#=:][^#=:]*?)\s*::?(?!=)([^#\n]*)/.exec(line)
      if (!rule || !rule[1].trim().split(/\s+/).includes('reinstall')) continue
      if (!rule[2].includes('=')) prerequisites.push(rule[2].trim())
    }
    expect(prerequisites.filter(Boolean)).toEqual([])
    // `@` only silences the echo; `-` would let make ignore a refusal and delete anyway.
    const steps = recipe![2].split('\n').map((line) => line.trim().replace(/^@/, ''))
    expect(steps.slice(0, 3)).toEqual(['node scripts/check-node-floor.mjs', '$(MAKE) clean-deps', '$(MAKE) install'])
  })

  it('eval\\Setup.bat finds node, then checks, before its first install step', () => {
    const text = read('eval/Setup.bat')
    const where = guardedCheck(text, /^where node >nul 2>nul$/i)
    const check = guardedCheck(text, CHECK)
    expect(where).toBeGreaterThan(-1)
    expect(check).toBeGreaterThan(where)
    expect(check).toBeLessThan(text.indexOf('Set-ExecutionPolicy'))
    expect(check).toBeLessThan(text.search(/^call npm install/m))
  })
})

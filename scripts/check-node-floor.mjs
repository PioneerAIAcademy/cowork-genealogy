#!/usr/bin/env node
// Refuse, in plain words, a Node or npm that the installs would refuse, before a
// reinstall (Reinstall.bat, scripts\windows\reinstall.bat, `make reinstall`)
// deletes every node_modules or eval\Setup.bat installs anything. pnpm
// (`.npmrc` engine-strict) and the engine's npm (its own `.npmrc`) refuse the
// same versions, but only once the launcher is under way, and they name a
// transitive package, not the fix.
//
// The ranges are copied from the packages that declare them, and
// packages/viewer-ui/src/__tests__/check-node-floor.test.ts fails when either
// side moves without the other. No dependencies: it runs before any install.
//
// Usage: node scripts/check-node-floor.mjs [--node <version>] [--npm <version>]
//        node scripts/check-node-floor.mjs --ranges
// Its callers pass nothing, so it checks the Node running it and
// `npm --version`. Exits 0 when both install, 1 when either is refused, and 2
// on an argument or version it cannot read.
import { execSync } from 'node:child_process'

const NODE_RANGES = [
  '^22.22.2 || ^24.15.0 || >=26.0.0', // jsdom 30, the floor
  '^22.12.0 || ^24.0.0 || >=26.0.0', // vitest 5
]
const NPM_RANGE = '>=11.12 <12' // packages/engine/mcp-server/package.json engines.npm

const NODE_FIX =
  'It needs Node 22.22.2 or later on 22, 24.15 or later on 24, or 26 or later (23 and 25 are refused).\n' +
  'Install Node 26 LTS from https://nodejs.org, or switch with nvm-windows or fnm, then run this again.'
const NPM_FIX =
  'It needs npm 11.12 or a later 11.x (not 12), which Node 24.15+ and 26 ship.\n' +
  'Run  npm install -g npm@11.12.1  then run this again.'

function unreadable(message) {
  process.stderr.write(`check-node-floor: ${message}\n`)
  process.exit(2)
}

function parseVersion(text, what) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(text)
  if (!m) unreadable(`${what} "${text}" is not a release version like 24.15.0`)
  return m.slice(1).map(Number)
}

function compare(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1
  return 0
}

// Only the comparators these ranges use: ^X.Y.Z (X > 0), >=X[.Y[.Z]], <X[.Y[.Z]].
function satisfies(version, range) {
  return range.split('||').some((alternative) =>
    alternative
      .trim()
      .split(/\s+/)
      .every((comparator) => {
        const m = /^(\^|>=|<)(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(comparator)
        if (!m || (m[1] === '^' && m[2] === '0')) unreadable(`cannot read the range "${range}"`)
        const bound = [Number(m[2]), Number(m[3] ?? 0), Number(m[4] ?? 0)]
        if (m[1] === '>=') return compare(version, bound) >= 0
        if (m[1] === '<') return compare(version, bound) < 0
        return version[0] === bound[0] && compare(version, bound) >= 0
      }),
  )
}

const args = process.argv.slice(2)
if (args.length === 1 && args[0] === '--ranges') {
  process.stdout.write(`${JSON.stringify({ node: NODE_RANGES, npm: NPM_RANGE })}\n`)
  process.exit(0)
}
const given = {}
for (let i = 0; i < args.length; i += 2) {
  if ((args[i] !== '--node' && args[i] !== '--npm') || i + 1 >= args.length) {
    unreadable(`usage: check-node-floor.mjs [--node <version>] [--npm <version>] | --ranges`)
  }
  given[args[i].slice(2)] = args[i + 1]
}

const nodeText = given.node ?? process.versions.node
const node = parseVersion(nodeText, 'Node')
if (!NODE_RANGES.every((range) => satisfies(node, range))) {
  process.stderr.write(`\nERROR: Node ${nodeText} cannot install this workspace.\n${NODE_FIX}\n`)
  process.exit(1)
}

let npmText = given.npm
if (npmText === undefined) {
  try {
    const options = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 60_000 }
    npmText = execSync('npm --version', options).trim()
  } catch {
    process.stderr.write(
      '\nERROR: `npm --version` did not run: npm is not on PATH, or it failed. npm comes\n' +
        'with Node; reinstall Node 26 LTS from https://nodejs.org, then run this again.\n',
    )
    process.exit(1)
  }
}
const npm = parseVersion(npmText, 'npm')
if (!satisfies(npm, NPM_RANGE)) {
  process.stderr.write(`\nERROR: npm ${npmText} cannot install the MCP server.\n${NPM_FIX}\n`)
  process.exit(1)
}

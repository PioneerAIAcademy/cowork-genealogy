#!/usr/bin/env node
// Replays deploy/Dockerfile's `web` stage locally, without Docker.
//
// `make deploy` builds that stage on a Fly remote builder. When it breaks, you
// find out minutes in, with a log rather than a diagnosis. This runs the same
// COPY sequence and the same RUN commands into a temp dir in ~20s first.
//
// It is a fidelity check, not a heuristic: the failure it exists for is stage 1
// copying too little before `pnpm install`, and no static rule catches that
// class — `packages/schema`'s postinstall needs `scripts/` and `schemas/`, and
// the NEXT package to gain a lifecycle script will need something else.
// Running the real commands is the only check that stays true.
//
// The context is `git ls-files`, so an untracked artifact sitting in the
// working tree cannot mask a break. That makes this stricter than the real
// build, which is the right direction for a gate.
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const dockerfile = join(repoRoot, 'deploy', 'Dockerfile')

// Mutates the host's global node prefix; the ambient pnpm is what `make deploy`
// callers already have, and the lockfile pins the rest.
const SKIP_RUN = ['corepack enable']

/** Stage `web`'s instructions, with line continuations folded. */
function stage(name) {
  const lines = readFileSync(dockerfile, 'utf8').split('\n')
  const out = []
  let inStage = false
  let buf = ''
  for (const raw of lines) {
    const line = raw.trimEnd()
    if (/^FROM\s/i.test(line)) {
      inStage = new RegExp(`\\sAS\\s+${name}\\s*$`, 'i').test(line)
      continue
    }
    if (!inStage) continue
    if (/^\s*(#|$)/.test(line)) continue
    buf += line.replace(/\\$/, ' ')
    if (line.endsWith('\\')) continue
    out.push(buf.trim())
    buf = ''
  }
  if (out.length === 0) throw new Error(`no stage named '${name}' in ${dockerfile}`)
  return out
}

/** Tracked paths under `src`, or [src] when it is a tracked file. */
function tracked(src) {
  const raw = execFileSync('git', ['ls-files', '-z', '--', src], { cwd: repoRoot })
  const paths = raw.toString('utf8').split('\0').filter(Boolean)
  if (paths.length === 0) throw new Error(`COPY ${src}: nothing tracked at that path`)
  return paths
}

function replayCopy(args, root) {
  const dest = args[args.length - 1]
  const sources = args.slice(0, -1)
  if (sources.length === 0) throw new Error(`COPY needs a source: ${args.join(' ')}`)
  const destDir = join(root, dest === './' || dest === '.' ? '' : dest)

  for (const src of sources) {
    const paths = tracked(src)
    const isFile = paths.length === 1 && paths[0] === src
    if (isFile) {
      // A file lands inside dest when dest is a directory (trailing slash, or
      // sharing dest with other sources); otherwise dest IS the file name.
      const asDir = dest.endsWith('/') || dest === '.' || sources.length > 1
      const target = asDir ? join(destDir, basename(src)) : destDir
      mkdirSync(dirname(target), { recursive: true })
      cpSync(join(repoRoot, src), target)
      continue
    }
    // Directory: Docker copies its CONTENTS into dest.
    for (const p of paths) {
      const target = join(destDir, p.slice(src.length + 1))
      mkdirSync(dirname(target), { recursive: true })
      cpSync(join(repoRoot, p), target)
    }
  }
}

function main() {
  if (process.env.SKIP_DEPLOY_STAGE1_CHECK) {
    console.log('deploy stage-1 check: skipped (SKIP_DEPLOY_STAGE1_CHECK set)')
    return
  }
  try {
    execFileSync('pnpm', ['--version'], { stdio: 'ignore' })
  } catch {
    console.log('⚠️  deploy stage-1 check: pnpm not on PATH — skipping (advisory)')
    return
  }

  const instructions = stage('web')
  const root = mkdtempSync(join(tmpdir(), 'deploy-stage1-'))
  let workdir = root
  try {
    for (const line of instructions) {
      const [, verb, rest] = line.match(/^(\w+)\s+(.*)$/) ?? []
      if (verb === 'WORKDIR') {
        workdir = root // the image's /repo is our temp root
        continue
      }
      if (verb === 'COPY') {
        replayCopy(rest.split(/\s+/), root)
        continue
      }
      if (verb === 'RUN') {
        const cmd = rest.replace(/\s+#.*$/, '').trim()
        if (SKIP_RUN.includes(cmd)) continue
        console.log(`  $ ${cmd}`)
        execFileSync('sh', ['-c', cmd], { cwd: workdir, stdio: 'inherit' })
        continue
      }
      if (verb === 'ENV' || verb === 'ARG' || verb === 'EXPOSE' || verb === 'CMD') continue
      throw new Error(`unhandled instruction in stage 'web': ${line}`)
    }
    console.log('✓ deploy stage-1 check: deploy/Dockerfile builds the web client')
  } catch (err) {
    console.error('')
    console.error("✗ deploy/Dockerfile stage 'web' does not build. `make deploy` would")
    console.error('  fail the same way on the Fly builder, several minutes in.')
    console.error(`  ${err.message.split('\n')[0]}`)
    console.error('')
    console.error('  Most likely: a COPY before `RUN pnpm install` no longer brings in')
    console.error('  everything an install-time script needs, or a source a later RUN')
    console.error('  reads is never copied. Re-run with the failing command above.')
    process.exitCode = 1
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

main()

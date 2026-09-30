#!/usr/bin/env node
// Root `preinstall` hook: remove a node_modules that npm created inside a pnpm
// workspace member, before pnpm installs over the top of it.
//
// eval/app was npm-managed until it joined the workspace (#1488). pnpm does NOT
// adopt or clean an existing npm tree in a member directory: with
// `node-linker=hoisted` (.npmrc) it symlinks the workspace packages in and
// leaves every npm-installed package where it is, so the stale copies keep
// winning resolution. Measured on a real upgraded checkout: eval/app resolved
// @tanstack/react-query 5.101.4 while pnpm-lock.yaml pinned 5.104.0, with a
// green install and a green build.
//
// A fresh clone never hits this, which is exactly why no CI job can catch it —
// it only bites the developers and Windows genealogists who already had the old
// tree. `.package-lock.json` is npm's own marker and pnpm never writes one, so
// its presence is an unambiguous "npm built this".
//
// Runs on every `pnpm install` from any entry point (make, eval/Setup.bat,
// eval/Start.bat, scripts/windows/*.bat, CI, a bare invocation), and is a no-op
// once the directory is gone.
import { existsSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

// Members that were npm-managed before joining the workspace. Removing an entry
// after everyone has upgraded is safe; keeping it costs one `existsSync`.
const FORMERLY_NPM_MANAGED = ['eval/app']

let failed = false
for (const member of FORMERLY_NPM_MANAGED) {
  const modules = join(repoRoot, member, 'node_modules')
  if (!existsSync(join(modules, '.package-lock.json'))) continue

  process.stdout.write(
    `[preinstall] ${member}/node_modules was built by npm; removing it so pnpm's lockfile wins.\n`,
  )
  try {
    // maxRetries/retryDelay retry exactly EBUSY, EMFILE, ENFILE, ENOTEMPTY and
    // EPERM, with a linear backoff. That is the Windows failure this hit in
    // testing: an antivirus scanner or Explorer holds a handle under
    // eval\app\node_modules and the first rmSync gets EPERM, on a directory
    // that becomes removable a moment later. Measured on Windows 10 Pro
    // (10.0.19044) before this retry existed — the install aborted and the
    // operator had to delete the folder by hand.
    rmSync(modules, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  } catch (err) {
    failed = true
    process.stderr.write(
      `\n[preinstall] Could not remove ${member}/node_modules: ${err.message}\n` +
        `Delete it by hand and run the install again. Leaving it in place would\n` +
        `let npm-era packages shadow the versions in pnpm-lock.yaml, silently.\n` +
        `On Windows this is usually a held file handle: close any editor or\n` +
        `terminal sitting in that folder, let the antivirus scan settle, and\n` +
        `retry before deleting by hand.\n\n`,
    )
  }
}

// Exit non-zero rather than install over a tree we know is wrong: a blocked
// install names its own fix, a wrong dependency tree does not.
if (failed) process.exit(1)

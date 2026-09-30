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
// RUN IT BEFORE pnpm, NOT ONLY AS `preinstall`. pnpm decides what to link
// before it runs the `preinstall` hook, so a tree removed *during* preinstall
// leaves pnpm believing that member is already linked: the install reports
// success and `eval/app/node_modules/@genealogy/schema` is never created, so
// the next command fails on "Can't resolve '@genealogy/schema'". Measured on
// Windows (issue #1488 review) and reproduced on Linux; `pnpm install --force`
// does not rescue it, and only a second install creates the link.
//
// So the callers that matter — $(JS_DEPS) in the Makefile, eval/Start.bat,
// eval/Setup.bat, Reinstall.bat, scripts/windows/install.bat — invoke this
// script explicitly first, which makes their install a single clean pass.
// The `preinstall` hook stays as the net for a bare `pnpm install`: there it
// removes the tree and then EXITS NON-ZERO, because finishing that install
// would hand back the silently broken tree described above. Re-running is then
// clean, since the marker is gone and this becomes a no-op.
//
// `--as-preinstall` marks the hook invocation. Without it (the explicit
// callers) a successful removal is a normal exit.
import { existsSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

// Members that were npm-managed before joining the workspace. Removing an entry
// after everyone has upgraded is safe; keeping it costs one `existsSync`.
const FORMERLY_NPM_MANAGED = ['eval/app']

// The `preinstall` hook passes this; the explicit callers do not.
const asPreinstall = process.argv.includes('--as-preinstall')

let failed = false
let removedAny = false
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
    removedAny = true
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

// Removed something from inside pnpm's own lifecycle: stop, for the sequencing
// reason in the header. The explicit callers run before pnpm and carry on.
if (removedAny && asPreinstall) {
  process.stdout.write(
    `[preinstall] Stopping this install on purpose. pnpm planned its linking\n` +
      `before this hook ran, so finishing now would report success and leave\n` +
      `eval/app without its @genealogy/schema link. Run the same command again —\n` +
      `the tree is gone, so the next run is a clean single pass.\n`,
  )
  process.exit(1)
}

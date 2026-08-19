/**
 * The packaging contract that has no other guard on a pull request.
 *
 * Issue #1070: with no `packageManager` field and no lockfile of its own,
 * electron-builder falls through to guessing the node-module collector from
 * `npm_config_user_agent`. Under pnpm it picks the pnpm collector (which handles
 * `node-linker=hoisted`); under npm it picks the npm collector and resolves none
 * of the declared dependencies — shipping an app that opens no window and prints
 * nothing, from a green build.
 *
 * `check-packaged-deps.mjs` catches that, but only once something has been
 * packaged, and `electron-release.yml` runs only on an `electron-v*` tag or a
 * manual dispatch. So if this line is dropped by a merge, a revert or a
 * Dependabot bump, nothing notices until someone cuts a release. This file runs
 * on every PR that touches `apps/electron/` (`js-tests.yml`), costs no build,
 * and closes that window.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// vitest runs with cwd at the project root (apps/electron). `import.meta.url` is
// not a file: URL under the jsdom environment this suite uses, so it cannot be
// used here. The name assertion below is what stops a cwd change turning this
// suite into one that reads some other package.json and passes.
const APP_ROOT = process.cwd()
const REPO_ROOT = join(APP_ROOT, '..', '..')

type ElectronPkg = {
  name?: string
  packageManager?: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  scripts?: Record<string, string>
}

const readPkg = (dir: string): ElectronPkg =>
  JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as ElectronPkg

describe('electron packaging contract (#1070)', () => {
  it('is reading the package.json it thinks it is (guards the reader itself)', () => {
    // Without this, a changed cwd makes every assertion below read a different
    // file — and most likely still pass, which is the shape of check that reads
    // as coverage while verifying nothing.
    expect((readPkg(APP_ROOT) as { name?: string }).name).toBe('@genealogy/electron')
    expect((readPkg(REPO_ROOT) as { name?: string }).name).toBeTruthy()
  })

  it('declares packageManager, matching the workspace root exactly', () => {
    const app = readPkg(APP_ROOT)
    const root = readPkg(REPO_ROOT)

    expect(
      app.packageManager,
      'apps/electron/package.json lost its "packageManager" field. Without it ' +
        'electron-builder guesses the node-module collector from the environment, ' +
        'and an `npm run build:*` ships an app that cannot launch (#1070).'
    ).toBeTruthy()

    expect(
      app.packageManager,
      'the field must match the root exactly, or the two resolve different collectors'
    ).toBe(root.packageManager)
  })

  it('runs the packaged-deps check after every packaging script', () => {
    // The gate is only worth having where the broken invocation actually runs.
    // `build:unpack` is the one the issue reproduces with, and the README points
    // developers at `build:win` / `build:mac` / `build:linux` directly.
    const { scripts = {} } = readPkg(APP_ROOT)
    for (const name of ['build:unpack', 'build:win', 'build:mac', 'build:linux']) {
      expect(scripts[name], `${name} is missing`).toBeTruthy()
      expect(
        scripts[name],
        `${name} does not run check-packaged, so it can ship an unlaunchable app silently`
      ).toContain('check-packaged')
    }
  })

  it('declares @electron/asar rather than relying on hoisting', () => {
    // The check imports it. It resolves today only because `.npmrc` hoists an
    // electron-builder transitive — a guard against a resolution bug should not
    // itself depend on undeclared resolution.
    const { devDependencies = {} } = readPkg(APP_ROOT)
    expect(devDependencies['@electron/asar']).toBeTruthy()
  })
})

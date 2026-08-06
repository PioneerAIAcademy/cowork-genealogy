import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Every app's `dev` script regenerates packages/schema's TS enums first.
 *
 * ADR-0008 tier 2 puts `src/enums.generated.ts` behind a generator and
 * gitignores the output, on the condition that "no build entry point can
 * forget it". The dev servers were an entry point nobody counted: turbo's
 * `^build` chain covers `test`/`typecheck`/`build`, and packages/schema's
 * `postinstall` covers a fresh install — but `pnpm --filter <app> dev` goes
 * through neither. An existing checkout that pulled #1271 therefore had no
 * generated file and no path that would write one, and vite died on
 * `Failed to resolve import "./enums.generated.js"`.
 *
 * That is the whole launch surface for the Research Viewer: `make electron`,
 * `eval\Viewer.bat`, and the raw `pnpm --filter @genealogy/electron dev` the
 * alpha guide gives macOS/Linux users all bottom out in this one script, so
 * chaining it here is what makes all three self-healing.
 *
 * Lives in viewer-ui for the same reason as gen-enums-guards.test.ts:
 * packages/schema has no test script and viewer-ui's vitest reaches it.
 */

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..', '..', '..')

/** The command that writes the generated sources, run from any workspace dir. */
const GENERATE = 'pnpm --filter @genealogy/schema generate'

/** A script that starts a vite dev server — `vite` or `electron-vite dev`. */
const STARTS_VITE = /(^|&&\s*)(electron-)?vite\b/

function readPackage(dir: string): { name?: string; scripts?: Record<string, string> } {
  return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
}

/** Every `apps/*` that is a package, read fresh — a new app shows up here on arrival. */
const apps = readdirSync(join(repoRoot, 'apps'))
  .map((entry) => join(repoRoot, 'apps', entry))
  .filter((dir) => existsSync(join(dir, 'package.json')))
  .map((dir) => readPackage(dir))

const viteApps = apps.filter((pkg) => pkg.scripts?.dev && STARTS_VITE.test(pkg.scripts.dev))

describe('app dev scripts', () => {
  it('finds every app whose dev script starts vite', () => {
    // Named, not counted, because the loop below skips what it doesn't
    // recognise — a `dev` rewritten into a form this file can't read would
    // drop out silently, which is the same class of quiet gap as the one this
    // file exists to close. A new app fails here until someone decides
    // whether it needs the chain.
    expect(viteApps.map((pkg) => pkg.name).sort()).toEqual(['@genealogy/electron', 'web'])
  })

  for (const pkg of viteApps) {
    const dev = pkg.scripts!.dev

    it(`${pkg.name} regenerates the schema enums before starting vite`, () => {
      expect(
        dev.startsWith(`${GENERATE} &&`),
        `${pkg.name}'s dev script is "${dev}" — it must start with \`${GENERATE} &&\`. ` +
          `Without it, a checkout that has not reinstalled since the generator or the ` +
          `schema last changed starts vite against a missing src/enums.generated.ts.`,
      ).toBe(true)
    })
  }
})

describe('the generate script', () => {
  it('runs every generator in packages/schema/scripts', () => {
    // The chain above is only as complete as what `generate` itself runs, and
    // pnpm 9's enable-pre-post-scripts defaults to false — so a second
    // generator added as a `pregenerate` hook would never fire (ADR-0008).
    const schemaDir = join(repoRoot, 'packages', 'schema')
    const generators = readdirSync(join(schemaDir, 'scripts')).filter((f) => /^gen-.*\.mjs$/.test(f))
    expect(generators.length).toBeGreaterThan(0)

    const generate = readPackage(schemaDir).scripts?.generate ?? ''
    for (const generator of generators) expect(generate).toContain(generator)
  })
})

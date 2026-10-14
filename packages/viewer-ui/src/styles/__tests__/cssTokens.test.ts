import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/** Every `var(--token)` in this package must name a token the theme defines.
 *
 * A `var()` on a token nothing defines is NOT an error: CSS silently uses the fallback,
 * or renders nothing. So the rule fails in the quietest possible way -- the component
 * looks right in whichever theme the fallback was written for, and wrong in the other.
 *
 * It shipped exactly that way. The off-plan banner used `--color-surface-subtle`,
 * `--color-text-muted` and `--color-border`, none of which exist here (the tokens are
 * `--bg-secondary`, `--text-secondary`, `--border-color`). Light mode looked fine because
 * the fallbacks were light-mode values; in dark mode the banner was a near-white bar with
 * grey text on it -- the one row in the table nobody could read. Found by a human looking
 * at a screen, which is the only thing that was ever going to find it.
 */

// vitest runs with the package as cwd. Checked rather than assumed: a wrong root finds
// no CSS at all, which would make this whole file pass without reading anything.
const SRC = join(process.cwd(), 'src')

function cssFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) cssFiles(full, out)
    else if (name.endsWith('.css')) out.push(full)
  }
  return out
}

/** Tokens set from TypeScript via inline style, which no stylesheet declares. */
const SET_IN_JS = new Set<string>([])

describe('CSS custom properties', () => {
  it('are all defined by the theme before they are used', () => {
    expect(existsSync(join(SRC, 'styles/global.css'))).toBe(true)
    const files = cssFiles(SRC)
    expect(files.length).toBeGreaterThan(5)   // a glob that finds nothing would "pass"

    const defined = new Set<string>(SET_IN_JS)
    for (const f of files) {
      for (const m of readFileSync(f, 'utf8').matchAll(/^\s*(--[\w-]+)\s*:/gm)) {
        defined.add(m[1])
      }
    }
    expect(defined.size).toBeGreaterThan(10)  // ditto for the definition scan

    const used: { token: string; where: string }[] = []
    for (const f of files) {
      for (const m of readFileSync(f, 'utf8').matchAll(/var\(\s*(--[\w-]+)/g)) {
        used.push({ token: m[1], where: relative(SRC, f) })
      }
    }
    expect(used.length).toBeGreaterThan(20)

    const undefinedOnes = used.filter((u) => !defined.has(u.token))
    expect(undefinedOnes.map((u) => `${u.where}: ${u.token}`)).toEqual([])
  })

  it('defines every theme colour token in BOTH themes', () => {
    // The other half of the same failure: a token that exists only in the light block
    // renders as nothing at all in dark mode rather than falling back to something
    // readable. Scoped to colour tokens -- spacing and radii are deliberately shared.
    const global = readFileSync(join(SRC, 'styles/global.css'), 'utf8')
    const dark = global.slice(global.indexOf("[data-theme='dark']"))
    expect(dark.length).toBeGreaterThan(200)

    const lightOnly: string[] = []
    const lightBlock = global.slice(0, global.indexOf("[data-theme='dark']"))
    for (const m of lightBlock.matchAll(/^\s*(--(?:bg|text|border-color|accent)[\w-]*)\s*:/gm)) {
      if (!new RegExp(`${m[1]}\\s*:`).test(dark)) lightOnly.push(m[1])
    }
    expect(lightOnly).toEqual([])
  })
})

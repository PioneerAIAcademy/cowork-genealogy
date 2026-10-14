import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Where the composer's right-hand buttons sit, pinned as CSS rules.
 *
 * The controls row is `[Reasoning] [📎] … [Stop] [Send]`, and the free space belongs in
 * front of the Stop/Send pair. Flexbox puts it wherever the `margin-left: auto` is, and
 * Stop renders ONLY while a turn runs — so with the margin on Send alone, the space
 * collapsed in front of Send and left Stop packed against the attach icon. Measured in a
 * browser at a 634px gap between the two buttons on a 900px composer, for the whole
 * duration of every turn. Idle it looked perfect, which is why it shipped.
 *
 * Asserted as rules rather than as layout because jsdom does not lay flexbox out: a test
 * that read `getBoundingClientRect()` here would return zeroes and pass on any CSS at all.
 * The rules below were verified to produce the right geometry in a real browser; this
 * file is what stops them being edited back.
 */

// vitest runs with the package as cwd. Checked rather than assumed — a wrong root reads
// no CSS, and every assertion below would vacuously pass.
const CSS_PATH = join(process.cwd(), 'src', 'styles.css')

describe('the composer control row', () => {
  it('can find the stylesheet at all', () => {
    expect(existsSync(CSS_PATH), `no stylesheet at ${CSS_PATH} — this suite reads nothing`).toBe(
      true
    )
    expect(readFileSync(CSS_PATH, 'utf-8')).toContain('.chatControls')
  })

  /** The declarations inside one selector's block, whitespace-normalised. */
  function block(selector: string): string {
    const css = readFileSync(CSS_PATH, 'utf-8')
    const at = css.indexOf(`${selector} {`)
    expect(at, `no rule for \`${selector}\``).toBeGreaterThan(-1)
    return css.slice(at, css.indexOf('}', at)).replace(/\s+/g, ' ')
  }

  it('pushes Stop to the right, because Stop is first of the pair when a turn runs', () => {
    expect(block('.chatControls .chatStop')).toMatch(/margin-left:\s*auto/)
  })

  it('still pushes Send to the right when there is no Stop', () => {
    // The idle case, and the one that always looked fine.
    expect(block('.chatControls .chatSend')).toMatch(/margin-left:\s*auto/)
  })

  it('does not let Send push away from Stop once Stop has taken the margin', () => {
    // Both carrying `auto` would split the free space between them and strand Stop in
    // the middle of the row — a different wrong answer from the one this replaced.
    expect(block('.chatControls .chatStop ~ .chatSend')).toMatch(/margin-left:\s*0/)
  })
})

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Every text token must be readable on every surface token of the SAME theme.
 *
 * A palette-level invariant, deliberately not a DOM sweep. A sweep only measures the
 * pairs that happen to be on screen: the dark `--text-tertiary` passed a full 14-section
 * sweep at #968c80 and was still 4.33 on `--bg-hover`, a surface nothing I clicked
 * happened to use. The arithmetic does not have that blind spot, and it runs without a
 * browser.
 *
 * The bar is WCAG AA for normal text (4.5:1). `--text-link` is excluded: it is an accent
 * colour judged against its own usage, not general body text.
 */

const GLOBAL = readFileSync(join(process.cwd(), 'src/styles/global.css'), 'utf8')

type RGB = readonly [number, number, number]
const hex = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as unknown as RGB
const lum = ([r, g, b]: RGB): number => {
  const f = (v: number): number => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
const ratio = (a: RGB, b: RGB): number => {
  const [hi, lo] = [Math.max(lum(a), lum(b)) + 0.05, Math.min(lum(a), lum(b)) + 0.05]
  return hi / lo
}

function tokensOf(block: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of block.matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) out[m[1]] = m[2]
  return out
}

const split = GLOBAL.indexOf("[data-theme='dark']")
const THEMES = { light: GLOBAL.slice(0, split), dark: GLOBAL.slice(split) }

function worstPairs(block: string): { pair: string; ratio: number }[] {
  const t = tokensOf(block)
  const texts = Object.entries(t).filter(([k]) => k.startsWith('--text-') && k !== '--text-link')
  const bgs = Object.entries(t).filter(([k]) => k.startsWith('--bg-'))
  const out: { pair: string; ratio: number }[] = []
  for (const [tk, tv] of texts) {
    for (const [bk, bv] of bgs) {
      const r = ratio(hex(tv), hex(bv))
      if (r < 4.5) out.push({ pair: `${tk} on ${bk}`, ratio: +r.toFixed(2) })
    }
  }
  return out
}

describe('theme contrast', () => {
  it('reads the palette it claims to check', () => {
    // A split that lands wrong, or a regex that matches nothing, would make every
    // assertion below vacuously true.
    expect(split).toBeGreaterThan(0)
    expect(Object.keys(tokensOf(THEMES.light)).length).toBeGreaterThan(10)
    expect(Object.keys(tokensOf(THEMES.dark)).length).toBeGreaterThan(10)
  })

  it('dark: every text token clears 4.5 on every surface', () => {
    expect(worstPairs(THEMES.dark)).toEqual([])
  })

  it('light: primary and secondary clear 4.5 on every surface', () => {
    // Scoped deliberately. `--text-tertiary` in LIGHT is 2.63 on `--bg-code` and under
    // the bar on most surfaces -- a real, PRE-EXISTING failure affecting ~19 elements,
    // not something this work introduced. Fixing it darkens muted text on every screen
    // of the default theme, which is a design decision rather than a bug fix, so it is
    // recorded here with its number rather than silently skipped. Widen this test to all
    // of `--text-*` the moment that call is made.
    const failing = worstPairs(THEMES.light).filter((f) => !f.pair.startsWith('--text-tertiary'))
    expect(failing).toEqual([])
  })

  it('records where light tertiary actually stands, so the gap cannot be forgotten', () => {
    const tertiary = worstPairs(THEMES.light).filter((f) => f.pair.startsWith('--text-tertiary'))
    expect(tertiary.length).toBeGreaterThan(0)      // if this empties, delete the exemption above
    expect(Math.min(...tertiary.map((t) => t.ratio))).toBeLessThan(4.5)
  })
})

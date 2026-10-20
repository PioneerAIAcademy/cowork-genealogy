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

  it('light: every text token clears 4.5 on every surface', () => {
    expect(worstPairs(THEMES.light)).toEqual([])
  })

  it('keeps three VISIBLE muted levels in both themes', () => {
    // The other half of a contrast fix, and the half I got wrong first time round.
    // Raising dark `--text-tertiary` for contrast pushed it to within 1.16 of
    // `--text-secondary` -- both tokens passed the bar and rendered as the same colour,
    // so a fix for readability silently removed a distinction the design uses. Contrast
    // alone cannot see that; this does.
    for (const [name, block] of Object.entries(THEMES)) {
      const t = tokensOf(block)
      const sep = (a: string, b: string): number => ratio(hex(t[a]), hex(t[b]))
      expect(`${name} primary/secondary ${sep('--text-primary', '--text-secondary').toFixed(2)}`)
        .toBe(`${name} primary/secondary ${Math.max(sep('--text-primary', '--text-secondary'), 1.3).toFixed(2)}`)
      expect(`${name} secondary/tertiary ${sep('--text-secondary', '--text-tertiary').toFixed(2)}`)
        .toBe(`${name} secondary/tertiary ${Math.max(sep('--text-secondary', '--text-tertiary'), 1.3).toFixed(2)}`)
    }
  })

  it('badge text is readable on its own badge fill', () => {
    // Badges carry small text on a tinted chip, which is its own surface and therefore
    // invisible to the text-on-background sweep above.
    for (const [name, block] of Object.entries(THEMES)) {
      const t = tokensOf(block)
      const bad: string[] = []
      for (const key of Object.keys(t)) {
        const m = /^--badge-(\w+)-text$/.exec(key)
        if (!m) continue
        const fill = t[`--badge-${m[1]}-bg`]
        if (!fill) continue
        const r = ratio(hex(t[key]), hex(fill))
        if (r < 4.5) bad.push(`${name} ${key} on fill: ${r.toFixed(2)}`)
      }
      expect(bad).toEqual([])
    }
  })
})

import { afterEach, describe, expect, it } from 'vitest'
import { applyHostTheme } from './theme'

afterEach(() => {
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.removeAttribute('style')
})

describe('applyHostTheme', () => {
  it('applies the theme and the CSS variables the host gives', () => {
    applyHostTheme({ theme: 'dark', styles: { variables: { '--color-text-primary': '#fafafa' } as never } })

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(document.documentElement.style.getPropertyValue('--color-text-primary')).toBe('#fafafa')
  })

  it('touches nothing when the host gives neither', () => {
    applyHostTheme({ containerDimensions: { height: 100, width: 100 } })

    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
    expect(document.documentElement.getAttribute('style')).toBeNull()
  })
})

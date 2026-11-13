import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { installLinkOpener } from './links'
import { Prose } from './Prose'
import { mcandrew } from './test-data'

let openLink: Mock<(url: string) => unknown>
let uninstall: () => void
let bubbled: Mock<(event: Event) => void>

beforeEach(() => {
  openLink = vi.fn<(url: string) => unknown>()
  bubbled = vi.fn<(event: Event) => void>()
  uninstall = installLinkOpener(document, openLink)
  document.body.addEventListener('click', bubbled)
})

afterEach(() => {
  uninstall()
  document.body.removeEventListener('click', bubbled)
  document.body.innerHTML = ''
})

function anchor(href: string): HTMLAnchorElement {
  document.body.innerHTML = `<p><a href="${href}"><span>label</span></a></p>`
  return document.querySelector('a') as HTMLAnchorElement
}

function click(el: Element, init: MouseEventInit = {}, type = 'click'): MouseEvent {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, ...init })
  el.dispatchEvent(event)
  return event
}

describe('the link opener', () => {
  it.each([
    'https://evil.example',
    'https://www.familysearch.org/ark:/61903/1:1:QPRC-WPBZ',
    'https://example.com/a?b=c#d'
  ])('opens %s once and keeps the frame where it is', (href) => {
    const event = click(anchor(href).querySelector('span') as Element)
    expect(openLink).toHaveBeenCalledTimes(1)
    expect(openLink.mock.calls[0][0]).toMatch(/^https:\/\//)
    expect(event.defaultPrevented).toBe(true)
    expect(bubbled).not.toHaveBeenCalled()
  })

  it.each(['http://www.familysearch.org/', 'javascript:alert(1)', 'mailto:a@b.example', '#top', '/relative', ''])(
    'opens nothing for %j and still keeps the frame',
    (href) => {
      const event = click(anchor(href))
      expect(openLink).not.toHaveBeenCalled()
      expect(event.defaultPrevented).toBe(true)
    }
  )

  it('a middle click opens, a right click does not', () => {
    const a = anchor('https://evil.example')
    click(a, { button: 1 }, 'auxclick')
    expect(openLink).toHaveBeenCalledTimes(1)
    const right = click(a, { button: 2 }, 'auxclick')
    expect(openLink).toHaveBeenCalledTimes(1)
    expect(right.defaultPrevented).toBe(false)
  })

  it('a click outside an anchor is left alone', () => {
    document.body.innerHTML = '<button>go</button>'
    const event = click(document.querySelector('button') as Element)
    expect(openLink).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
    expect(bubbled).toHaveBeenCalledTimes(1)
  })

  it('a handler on the anchor never sees the click, so nothing opens twice', () => {
    const a = anchor('https://evil.example')
    const own = vi.fn<(event: Event) => void>()
    a.addEventListener('click', own)
    click(a)
    expect(own).not.toHaveBeenCalled()
    expect(openLink).toHaveBeenCalledTimes(1)
  })

  it("a React anchor whose own onClick also opens still opens once, like Linkify's", () => {
    const { container } = render(
      <a href="https://evil.example" onClick={() => openLink('https://evil.example')}>
        x
      </a>
    )
    click(container.querySelector('a') as Element)
    expect(openLink).toHaveBeenCalledTimes(1)
    cleanup()
  })

  it('a link drawn by Prose opens once', () => {
    const { container } = render(<Prose text="See [x](https://evil.example) and https://example.com/y." index={mcandrew} />)
    for (const a of container.querySelectorAll('a')) click(a)
    expect(openLink.mock.calls).toEqual([['https://evil.example/'], ['https://example.com/y']])
    cleanup()
  })

  it('a rejected open is swallowed', async () => {
    openLink.mockRejectedValue(new Error('refused'))
    click(anchor('https://evil.example'))
    await Promise.resolve()
    expect(openLink).toHaveBeenCalledTimes(1)
  })
})

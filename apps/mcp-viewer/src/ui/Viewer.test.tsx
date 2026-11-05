import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { FakeApp, RESULT_FAILED, RESULT_WITH_META, sessionOn } from '../test/fake-app'
import { Viewer } from './Viewer'

afterEach(cleanup)

async function mounted(app = new FakeApp()) {
  const session = sessionOn(app)
  render(<Viewer session={session} />)
  await act(() => session.start())
  return { app, session }
}

function report(): string {
  return document.querySelector('pre')?.textContent ?? ''
}

describe('the hello card', () => {
  it('shows the project name, the counts and the echoed input in one text block', async () => {
    const { app } = await mounted()
    act(() => {
      app.sendInput({ show: 'latest' })
      app.sendResult(RESULT_WITH_META)
    })

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('From the snapshot')
    expect(document.querySelectorAll('pre')).toHaveLength(1)
    expect(report()).toContain('sources: 2')
    expect(report()).toContain('questions: 1')
    expect(report()).toContain('input: {"show":"latest"}')
    expect(report()).toContain('data came from: result _meta')
  })

  it('a cancelled call paints no card and offers no probe', async () => {
    const { app } = await mounted()
    act(() => {
      app.sendInput({ show: 'latest' })
      app.sendCancelled()
    })

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('The call was stopped.')
    expect(report()).not.toContain('project:')
    expect(screen.queryByRole('button', { name: /Read/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Load an image' })).toBeNull()
  })

  it('an error result shows its text', async () => {
    const { app } = await mounted()
    act(() => {
      app.sendInput({ show: 'latest' })
      app.sendResult(RESULT_FAILED)
    })

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('No such project.')
  })

  it('says it cannot reach its host when connect fails', async () => {
    const app = new FakeApp()
    app.connect.mockRejectedValue(new Error('No handshake.'))
    await mounted(app)

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('This page cannot reach its host.')
    expect(report()).toContain('reason: No handshake.')
  })
})

describe('the open button', () => {
  it('the open button is hidden when fullscreen is not offered', async () => {
    const app = new FakeApp()
    app.context = { displayMode: 'inline', availableDisplayModes: ['inline'] }
    await mounted(app)

    expect(screen.queryByRole('button', { name: 'Open full screen' })).toBeNull()
  })

  it('the open button is hidden when the host names no modes at all', async () => {
    const app = new FakeApp()
    app.context = {}
    await mounted(app)

    expect(screen.queryByRole('button', { name: 'Open full screen' })).toBeNull()
  })

  it('opens the case file placeholder and comes back', async () => {
    const { app } = await mounted()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Open full screen' }))
    })

    expect(app.requestDisplayMode).toHaveBeenLastCalledWith({ mode: 'fullscreen' })
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Case file')
    expect(report()).toContain('current mode: fullscreen')

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Back to the card' }))
    })

    expect(app.requestDisplayMode).toHaveBeenLastCalledWith({ mode: 'inline' })
    expect(screen.queryByRole('button', { name: 'Back to the card' })).toBeNull()
  })

  it('follows the host closing the file itself', async () => {
    const { app } = await mounted()
    act(() => app.sendContextChange({ displayMode: 'fullscreen' }))
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Case file')

    act(() => app.sendContextChange({ displayMode: 'inline' }))
    expect(screen.queryByText('Case file')).toBeNull()
  })
})

describe('the probe buttons', () => {
  it('each size button makes one hidden read and reports it', async () => {
    const { app } = await mounted()
    for (const [name, pad] of [
      ['Read 400000 characters', 400_000],
      ['Read 1000000 characters', 1_000_000],
      ['Read 1300000 characters', 1_300_000],
      ['Read 2000000 characters', 2_000_000]
    ] as const) {
      app.callServerTool.mockClear()
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name }))
      })
      expect(app.reads()).toEqual([{ part: 'document', pad }])
    }
    expect(report()).toContain('Size ladder: 4')
  })

  it('the image probe shows the img and reports that it loaded', async () => {
    const { app } = await mounted()
    app.callServerTool.mockResolvedValue({
      content: [],
      structuredContent: { url: 'https://example.test/img/token', expiresAt: 1_000 }
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Load an image' }))
    })

    const image = screen.getByRole('img')
    expect(image.getAttribute('src')).toBe('https://example.test/img/token')
    expect(report()).toContain('result: loading')

    fireEvent.load(image)
    expect(report()).toContain('result: loaded')
  })

  it('the image probe reports that the img failed to load', async () => {
    const { app } = await mounted()
    app.callServerTool.mockResolvedValue({
      content: [],
      structuredContent: { url: 'https://example.test/img/token', expiresAt: 1_000 }
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Load an image' }))
    })
    fireEvent.error(screen.getByRole('img'))

    expect(report()).toContain('result: the image failed to load')
  })
})

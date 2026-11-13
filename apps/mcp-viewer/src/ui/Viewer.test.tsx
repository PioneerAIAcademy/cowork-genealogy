import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { PROJECT_META_KEY } from '../contract'
import { COMPOUND_DOC } from '../cards/test-views'
import { FakeApp, RESULT_FAILED, sessionOn } from '../test/fake-app'
import { Viewer } from './Viewer'

afterEach(cleanup)

async function mounted(app = new FakeApp()) {
  const session = sessionOn(app)
  render(<Viewer session={session} />)
  await act(() => session.start())
  return { app, session }
}

const heading = () => screen.getByRole('heading', { level: 1 }).textContent

describe('the page', () => {
  it('draws the card the call asked for, from the snapshot', async () => {
    const { app } = await mounted()
    act(() => {
      app.sendInput({ show: 'setup' })
      app.sendResult({ content: [], _meta: { [PROJECT_META_KEY]: COMPOUND_DOC() } })
    })
    expect(heading()).toBe('The research is set up')
  })

  it('latest draws the card for where the question stands', async () => {
    const { app } = await mounted()
    act(() => {
      app.sendInput({ show: 'latest' })
      app.sendResult({ content: [], _meta: { [PROJECT_META_KEY]: COMPOUND_DOC() } })
    })
    expect(heading()).toBe('The conclusion')
  })

  it('a cancelled call draws no card', async () => {
    const { app } = await mounted()
    act(() => {
      app.sendInput({ show: 'latest' })
      app.sendCancelled()
    })
    expect(heading()).toBe('The call was stopped.')
  })

  it('an error result shows its text', async () => {
    const { app } = await mounted()
    act(() => {
      app.sendInput({ show: 'latest' })
      app.sendResult(RESULT_FAILED)
    })
    expect(heading()).toBe('No such project.')
  })

  it('says it cannot reach its host when connect fails', async () => {
    const app = new FakeApp()
    app.connect.mockRejectedValue(new Error('No handshake.'))
    await mounted(app)
    expect(heading()).toBe('This page cannot reach its host.')
  })

  it('keeps the host height limit from the context', async () => {
    const app = new FakeApp()
    app.context = { ...app.context, containerDimensions: { maxHeight: 480 } }
    const { session } = await mounted(app)
    expect(session.getState().heightLimit).toBe(480)
    act(() => app.sendContextChange({ containerDimensions: { height: 300 } }))
    expect(session.getState().heightLimit).toBe(300)
    act(() => app.sendContextChange({ theme: 'dark' }))
    expect(session.getState().heightLimit).toBe(300)
  })

  it('in fullscreen offers the way back to the card', async () => {
    const { app } = await mounted()
    act(() => app.sendContextChange({ displayMode: 'fullscreen' }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Back to the card' }))
    })
    expect(app.requestDisplayMode).toHaveBeenLastCalledWith({ mode: 'inline' })
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PROJECT_META_KEY, type ToolInput } from './contract'
import type { ToolResultEvent } from './hosts/host'
import { createCardLoader, RESULT_WAIT_MS } from './load'
import { LINK_PROBE_URL } from './probes'
import { headline, reportText } from './report'
import {
  FakeApp,
  META_DOCUMENT,
  READ_DOCUMENT,
  RESULT_FAILED,
  RESULT_WITHOUT_META,
  RESULT_WITH_META,
  sessionOn
} from './test/fake-app'

const INPUT: ToolInput = { show: 'latest', projectPath: 'mogan' }

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]]
  return items.flatMap((item, index) =>
    permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [item, ...rest])
  )
}

async function connected(app = new FakeApp()) {
  const session = sessionOn(app)
  await session.start()
  return { app, session }
}

/** Lets a read's promise settle. */
const settle = () => vi.advanceTimersByTimeAsync(0)

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('card loading, once per mount', () => {
  it('fetches at most once per mount across every ordering of input, result and timer', async () => {
    const steps = ['input', 'laterInput', 'result', 'laterResult', 'timer'] as const
    const firstResults: Array<[string, ToolResultEvent, ToolResultEvent]> = [
      ['meta', RESULT_WITH_META, RESULT_WITHOUT_META],
      ['no meta', RESULT_WITHOUT_META, RESULT_WITH_META],
      ['isError', RESULT_FAILED, RESULT_WITH_META]
    ]

    for (const [kind, first, second] of firstResults) {
      for (const order of permutations(steps)) {
        const { app, session } = await connected()
        const results = [first, second]
        for (const step of order) {
          if (step === 'input' || step === 'laterInput') app.sendInput(INPUT)
          if (step === 'result' || step === 'laterResult') app.sendResult(results.shift() as ToolResultEvent)
          if (step === 'timer') await vi.advanceTimersByTimeAsync(RESULT_WAIT_MS)
        }
        await vi.advanceTimersByTimeAsync(RESULT_WAIT_MS)

        const at = (...names: string[]) => Math.min(...names.map((name) => order.indexOf(name as (typeof steps)[number])))
        const inputAt = at('input', 'laterInput')
        const resultAt = at('result', 'laterResult')
        const timerFired = inputAt < order.indexOf('timer') && order.indexOf('timer') < resultAt
        const label = `${kind}: ${order.join(' > ')}`

        expect(app.reads().length, label).toBe(kind === 'no meta' || timerFired ? 1 : 0)
        const { load } = session.getState()
        if (kind === 'meta') expect(load.source, label).toBe('result _meta')
        if (kind === 'no meta') expect(load.source, label).toBe('read_project_view call')
        if (kind === 'isError') expect(load.phase, label).toBe('failed')
      }
    }
  })

  it('takes the snapshot from the first result and records that it came from result _meta', async () => {
    const { app, session } = await connected()
    app.sendInput(INPUT)
    app.sendResult(RESULT_WITH_META)
    await vi.advanceTimersByTimeAsync(RESULT_WAIT_MS)

    const { load } = session.getState()
    expect(load.snapshot).toEqual(META_DOCUMENT)
    expect(load.source).toBe('result _meta')
    expect(load.resultCarriedMeta).toBe(true)
    expect(app.reads()).toEqual([])
  })

  it('the first result without _meta triggers one read with the input projectPath', async () => {
    const { app, session } = await connected()
    app.sendInput(INPUT)
    app.sendResult(RESULT_WITHOUT_META)
    await settle()

    expect(app.reads()).toEqual([{ part: 'document', projectPath: 'mogan' }])
    const { load } = session.getState()
    expect(load.snapshot).toEqual(READ_DOCUMENT)
    expect(load.source).toBe('read_project_view call')
    expect(load.resultCarriedMeta).toBe(false)
  })

  it('reads once when no result arrives 2 seconds after the tool input', async () => {
    const { app, session } = await connected()
    app.sendInput(INPUT)
    await vi.advanceTimersByTimeAsync(1_999)
    expect(app.reads()).toEqual([])

    await vi.advanceTimersByTimeAsync(1)
    expect(app.reads()).toEqual([{ part: 'document', projectPath: 'mogan' }])
    expect(session.getState().load.source).toBe('read_project_view call')
  })

  it('later results are ignored', async () => {
    const { app, session } = await connected()
    app.sendInput(INPUT)
    app.sendResult(RESULT_WITH_META)
    app.sendResult(RESULT_FAILED)
    app.sendResult(RESULT_WITHOUT_META)
    await vi.advanceTimersByTimeAsync(RESULT_WAIT_MS)

    expect(session.getState().load.phase).toBe('ready')
    expect(session.getState().load.snapshot).toEqual(META_DOCUMENT)
    expect(app.reads()).toEqual([])
  })

  it('records the key names of the first result only, and none of its values', async () => {
    const { app, session } = await connected()
    app.sendInput(INPUT)
    expect(session.getState().load.resultKeys).toBeNull()

    app.sendResult(RESULT_WITH_META)
    app.sendResult({ ...RESULT_FAILED, structuredContent: {} })

    expect(session.getState().load.resultKeys).toEqual(['content', '_meta'])
    expect(reportText(session.getState())).toContain('first result keys: content, _meta\n')
  })

  it('later tool inputs are ignored', async () => {
    const { app, session } = await connected()
    app.sendInput(INPUT)
    await vi.advanceTimersByTimeAsync(RESULT_WAIT_MS - 1)
    app.sendInput({ show: 'plan', projectPath: 'other' })
    await vi.advanceTimersByTimeAsync(1)

    expect(session.getState().load.input).toEqual(INPUT)
    expect(app.reads()).toEqual([{ part: 'document', projectPath: 'mogan' }])
  })

  it('isError shows its text and fetches nothing', async () => {
    const { app, session } = await connected()
    app.sendInput(INPUT)
    app.sendResult(RESULT_FAILED)
    await vi.advanceTimersByTimeAsync(RESULT_WAIT_MS)

    expect(headline(session.getState())).toBe('No such project.')
    expect(session.getState().load.snapshot).toBeNull()
    expect(app.reads()).toEqual([])
  })

  it('a first result that lands during the fallback read decides the card', async () => {
    const app = new FakeApp()
    let answerRead = (_value: { content: []; structuredContent: Record<string, unknown> }): void => {}
    app.callServerTool.mockImplementation(() => new Promise((resolve) => (answerRead = resolve)))
    const { session } = await connected(app)

    app.sendInput(INPUT)
    await vi.advanceTimersByTimeAsync(RESULT_WAIT_MS)
    app.sendResult(RESULT_WITH_META)
    answerRead({ content: [], structuredContent: READ_DOCUMENT as Record<string, unknown> })
    await settle()

    expect(app.reads()).toHaveLength(1)
    expect(session.getState().load.source).toBe('result _meta')
    expect(session.getState().load.snapshot).toEqual(META_DOCUMENT)
  })

  it('a failed read shows its text and is not retried', async () => {
    const app = new FakeApp()
    app.callServerTool.mockRejectedValue(new Error('Refused: pick a project.'))
    const { session } = await connected(app)
    app.sendInput(INPUT)
    await vi.advanceTimersByTimeAsync(RESULT_WAIT_MS)
    app.sendResult(RESULT_WITHOUT_META)
    await settle()

    expect(headline(session.getState())).toBe('Refused: pick a project.')
    expect(app.reads()).toHaveLength(1)
  })
})

describe('a disposed loader', () => {
  it('arms nothing and reads nothing, whatever arrives', async () => {
    const read = vi.fn(async () => READ_DOCUMENT)
    const loader = createCardLoader({ read, now: Date.now, onChange() {} })
    loader.dispose()

    loader.toolInput(INPUT)
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(RESULT_WAIT_MS)

    loader.toolResult(RESULT_WITHOUT_META)
    loader.load(INPUT)
    await settle()

    expect(read).not.toHaveBeenCalled()
  })

  it('a rejected connect stops the loader, so a later tool input raises no read', async () => {
    const app = new FakeApp()
    app.connect.mockRejectedValue(new Error('No handshake.'))
    const session = sessionOn(app)
    await session.start()

    app.sendInput(INPUT)
    await vi.advanceTimersByTimeAsync(RESULT_WAIT_MS)

    expect(app.reads()).toEqual([])
    expect(session.getState().load.phase).toBe('waiting')
  })
})

describe('a cancelled call', () => {
  it('a cancelled call paints no card and fetches nothing', async () => {
    for (const result of [RESULT_WITH_META, RESULT_WITHOUT_META]) {
      const { app, session } = await connected()
      app.sendInput(INPUT)
      app.sendCancelled('The researcher stopped it.')
      await vi.advanceTimersByTimeAsync(RESULT_WAIT_MS)
      app.sendResult(result)
      await vi.advanceTimersByTimeAsync(RESULT_WAIT_MS)

      const state = session.getState()
      expect(headline(state)).toBe('The call was stopped.')
      expect(state.load.message).toBe('The researcher stopped it.')
      expect(state.load.snapshot).toBeNull()
      expect(app.reads()).toEqual([])
    }
  })

  it('a cancellation before the input leaves no timer behind', async () => {
    const { app, session } = await connected()
    app.sendCancelled()
    app.sendInput(INPUT)
    await vi.advanceTimersByTimeAsync(RESULT_WAIT_MS)

    expect(session.getState().load.phase).toBe('stopped')
    expect(app.reads()).toEqual([])
  })

  it('a cancellation during the fallback read drops its answer', async () => {
    const app = new FakeApp()
    let answerRead = (_value: { content: []; structuredContent: Record<string, unknown> }): void => {}
    app.callServerTool.mockImplementation(() => new Promise((resolve) => (answerRead = resolve)))
    const { session } = await connected(app)

    app.sendInput(INPUT)
    await vi.advanceTimersByTimeAsync(RESULT_WAIT_MS)
    app.sendCancelled()
    answerRead({ content: [], structuredContent: READ_DOCUMENT as Record<string, unknown> })
    await settle()

    expect(session.getState().load.phase).toBe('stopped')
    expect(session.getState().load.snapshot).toBeNull()
  })

  it('a cancellation after the first result changes nothing', async () => {
    const { app, session } = await connected()
    app.sendInput(INPUT)
    app.sendResult(RESULT_WITH_META)
    app.sendCancelled()

    expect(session.getState().load.phase).toBe('ready')
  })
})

describe('the display mode', () => {
  it('a host that answers requestDisplayMode and never notifies keeps the file open through a later resize notification', async () => {
    const { app, session } = await connected()
    await session.requestMode('fullscreen')
    expect(session.getState().display.mode).toBe('fullscreen')

    app.sendContextChange({ containerDimensions: { height: 900, width: 1200 } })

    // The host's merged context still says inline, and must not be consulted.
    expect(app.getHostContext().displayMode).toBe('inline')
    expect(session.getState().display.mode).toBe('fullscreen')
  })

  it('a rejected requestDisplayMode leaves the mode alone', async () => {
    const app = new FakeApp()
    app.requestDisplayMode.mockRejectedValue(new Error('Not now.'))
    const { session } = await connected(app)
    await session.requestMode('fullscreen')

    const state = session.getState()
    expect(state.display.mode).toBe('inline')
    expect(state.modeRequests[0]?.outcome).toBe('rejected: Not now.')
  })

  it('the last of two mode sources wins: an answer after a notification', async () => {
    const app = new FakeApp()
    let answer = (_value: { mode: 'fullscreen' }): void => {}
    app.requestDisplayMode.mockImplementation(() => new Promise((resolve) => (answer = resolve)))
    const { session } = await connected(app)

    const pending = session.requestMode('fullscreen')
    app.sendContextChange({ displayMode: 'pip' })
    expect(session.getState().display.mode).toBe('pip')
    answer({ mode: 'fullscreen' })
    await pending

    expect(session.getState().display.mode).toBe('fullscreen')
  })

  it('the last of two mode sources wins: a notification after an answer', async () => {
    const { app, session } = await connected()
    await session.requestMode('fullscreen')
    app.sendContextChange({ displayMode: 'inline' })

    expect(session.getState().display.mode).toBe('inline')
  })

  it('what requestDisplayMode returns is the mode, whatever was asked for', async () => {
    const app = new FakeApp()
    app.requestDisplayMode.mockResolvedValue({ mode: 'inline' })
    const { session } = await connected(app)
    await session.requestMode('fullscreen')

    expect(session.getState().display.mode).toBe('inline')
  })

  it('takes the mode and the offered modes from the context at connect', async () => {
    const app = new FakeApp()
    app.context = { displayMode: 'fullscreen', availableDisplayModes: ['fullscreen'] }
    const { session } = await connected(app)

    expect(session.getState().display).toEqual({ mode: 'fullscreen', available: ['fullscreen'] })
  })

  it('show file asks once to go straight to fullscreen', async () => {
    const { app, session } = await connected()
    app.sendInput({ show: 'file' })
    app.sendInput({ show: 'file' })
    await settle()

    expect(app.requestDisplayMode.mock.calls).toEqual([[{ mode: 'fullscreen' }]])
    expect(session.getState().modeRequests[0]).toMatchObject({ trigger: 'show: file', outcome: 'answered fullscreen' })
  })

  it('show file records that fullscreen is not offered and asks nothing', async () => {
    const app = new FakeApp()
    app.context = { displayMode: 'inline', availableDisplayModes: ['inline'] }
    const { session } = await connected(app)
    app.sendInput({ show: 'file' })

    expect(app.requestDisplayMode).not.toHaveBeenCalled()
    expect(session.getState().modeRequests[0]?.outcome).toBe('not offered')
  })
})

describe('reaching the host', () => {
  it('connect timeout says the host cannot be reached', async () => {
    const app = new FakeApp()
    app.connect.mockImplementation(() => new Promise(() => {}))
    const session = sessionOn(app)
    void session.start()

    await vi.advanceTimersByTimeAsync(9_999)
    expect(session.getState().connection).toBe('connecting')

    await vi.advanceTimersByTimeAsync(1)
    expect(session.getState().connection).toBe('unreachable')
    expect(headline(session.getState())).toBe('This page cannot reach its host.')
  })

  it('a connect that lands at 11 seconds connects the page after saying so at 10', async () => {
    const app = new FakeApp()
    app.context = { ...app.context, theme: 'dark' }
    let finish = (): void => {}
    app.connect.mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)))
    const applyTheme = vi.fn()
    const session = sessionOn(app, applyTheme)
    void session.start()

    await vi.advanceTimersByTimeAsync(10_000)
    expect(headline(session.getState())).toBe('This page cannot reach its host.')
    expect(session.getState().unreachableReason).toBe('connect took over 10 seconds.')

    await vi.advanceTimersByTimeAsync(1_000)
    finish()
    await settle()

    const state = session.getState()
    expect(state.connection).toBe('connected')
    expect(state.hostName).toBe('Fake Host')
    expect(state.display.available).toEqual(['inline', 'fullscreen'])
    expect(applyTheme.mock.calls[0]?.[0]).toMatchObject({ theme: 'dark' })
    expect(headline(state)).toBe('Waiting for the tool call.')
    expect(reportText(state)).toContain('status: waiting')
    expect(reportText(state)).not.toContain('reason:')

    app.sendInput(INPUT)
    await vi.advanceTimersByTimeAsync(RESULT_WAIT_MS)
    expect(app.reads()).toEqual([{ part: 'document', projectPath: 'mogan' }])
    expect(session.getState().load.phase).toBe('ready')
  })

  it('a connect inside the 10 seconds leaves no message behind', async () => {
    const { session } = await connected()
    await vi.advanceTimersByTimeAsync(20_000)

    expect(session.getState().connection).toBe('connected')
    expect(session.getState().unreachableReason).toBeNull()
  })

  it('a rejected connect says the host cannot be reached', async () => {
    const app = new FakeApp()
    app.connect.mockRejectedValue(new Error('No handshake.'))
    const session = sessionOn(app)
    await session.start()
    await vi.advanceTimersByTimeAsync(20_000)

    expect(headline(session.getState())).toBe('This page cannot reach its host.')
    expect(session.getState().unreachableReason).toBe('No handshake.')
  })

  it('a connect rejected after the message reports the rejection and reads nothing', async () => {
    const app = new FakeApp()
    let fail = (_err: Error): void => {}
    app.connect.mockImplementation(() => new Promise<void>((_resolve, reject) => (fail = reject)))
    const session = sessionOn(app)
    void session.start()

    await vi.advanceTimersByTimeAsync(10_000)
    fail(new Error('Request timed out'))
    await settle()
    app.sendInput(INPUT)
    await vi.advanceTimersByTimeAsync(RESULT_WAIT_MS)

    expect(session.getState().connection).toBe('unreachable')
    expect(session.getState().unreachableReason).toBe('Request timed out')
    expect(app.reads()).toEqual([])
  })

  it('sets every handler before connect', async () => {
    const { app } = await connected()
    expect(app.handlersSetBeforeConnect).toBe(true)
  })

  it('applies the host theme at connect and when it changes', async () => {
    const app = new FakeApp()
    app.context = { ...app.context, theme: 'dark' }
    const applyTheme = vi.fn()
    const session = sessionOn(app, applyTheme)
    await session.start()
    app.sendContextChange({ theme: 'light' })

    expect(applyTheme).toHaveBeenCalledTimes(2)
    expect(applyTheme.mock.calls[0]?.[0]).toMatchObject({ theme: 'dark' })
    expect(applyTheme.mock.calls[1]?.[0]).toEqual({ theme: 'light' })
  })
})

describe('the probes', () => {
  it('the size ladder reports characters and time', async () => {
    const app = new FakeApp()
    const pad = 'x'.repeat(10_000)
    app.callServerTool.mockResolvedValue({
      content: [],
      structuredContent: { ...READ_DOCUMENT, pad } as Record<string, unknown>
    })
    const { session } = await connected(app)
    app.sendInput(INPUT)
    await session.runSizeProbe(400_000)

    expect(app.reads().at(-1)).toEqual({ part: 'document', projectPath: 'mogan', pad: 400_000 })
    expect(session.getState().sizeProbes[0]).toMatchObject({ chars: 400_000, status: 'ok', received: pad.length })
    expect(session.getState().sizeProbes[0]?.ms).toEqual(expect.any(Number))
  })

  it('the size ladder reports an error with its code', async () => {
    const app = new FakeApp()
    app.callServerTool.mockRejectedValue(Object.assign(new Error('Too large.'), { code: -32000 }))
    const { session } = await connected(app)
    await session.runSizeProbe(2_000_000)

    expect(session.getState().sizeProbes[0]).toMatchObject({ status: 'failed', message: 'Too large.', code: '-32000' })
  })

  it('the image probe asks for the first source that has an image', async () => {
    const app = new FakeApp()
    const { session } = await connected(app)
    app.sendInput(INPUT)
    app.sendResult(RESULT_WITH_META)
    app.callServerTool.mockResolvedValue({
      content: [],
      structuredContent: { url: 'https://example.test/img/token', expiresAt: 1_000 }
    })
    await session.runImageProbe()

    expect(app.reads()).toEqual([{ part: 'image', id: 'images/page-1.jpg', projectPath: 'mogan' }])
    expect(session.getState().imageProbe).toMatchObject({ status: 'showing', url: 'https://example.test/img/token' })
  })

  it('a card with no tool input takes projectPath from the snapshot echo', async () => {
    const app = new FakeApp()
    const { session } = await connected(app)
    const echo = { show: 'latest', projectPath: '/proj_0123456789abcdef' }
    app.sendResult({ content: [], _meta: { [PROJECT_META_KEY]: { ...META_DOCUMENT, echo } } })
    app.callServerTool.mockResolvedValue({ content: [], structuredContent: { url: 'https://example.test/img/token' } })
    await session.runImageProbe()

    expect(app.reads()).toEqual([{ part: 'image', id: 'images/page-1.jpg', projectPath: '/proj_0123456789abcdef' }])
  })

  it('the link probe reports how long the host took to answer', async () => {
    const app = new FakeApp()
    app.openLink.mockImplementation(async () => {
      await vi.advanceTimersByTimeAsync(1_500)
      return {}
    })
    const { session } = await connected(app)
    await session.runLinkProbe()

    expect(app.openLink).toHaveBeenCalledWith({ url: LINK_PROBE_URL })
    expect(session.getState().linkProbe).toEqual({ status: 'answered', ms: 1_500 })
    expect(reportText(session.getState())).toContain('result: the host answered in 1500 ms')
  })

  it('the link probe reports a refusal', async () => {
    const app = new FakeApp()
    app.openLink.mockResolvedValue({ isError: true })
    const { session } = await connected(app)
    await session.runLinkProbe()

    expect(session.getState().linkProbe).toMatchObject({ status: 'refused', message: expect.any(String) })
    expect(reportText(session.getState())).toContain('result: refused after')
  })

  it('the image probe falls back to images/probe.jpg and reports a refusal', async () => {
    const app = new FakeApp()
    app.callServerTool.mockResolvedValue({
      isError: true,
      content: [{ type: 'text', text: 'Refused.' }]
    } as never)
    const { session } = await connected(app)
    await session.runImageProbe()

    expect(app.reads()).toEqual([{ part: 'image', id: 'images/probe.jpg' }])
    expect(session.getState().imageProbe).toMatchObject({ status: 'refused', message: 'Refused.' })
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PROJECT_META_KEY, type ToolInput } from './contract'
import { TOOL_CALL_TIMEOUT_MS } from './hosts/app-host'
import type { ToolResultEvent } from './hosts/host'
import { createCardLoader, RESULT_WAIT_MS } from './load'
import { headline } from './ui/status'
import { projectLabel } from './transport/McpAppResearchTransport'
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

/** show_project past the size limit: the call's echo and no documents. */
const RESULT_CUT: ToolResultEvent = {
  content: [{ type: 'text', text: 'shown' }],
  _meta: { [PROJECT_META_KEY]: { derived: { folderName: 'mogan' }, echo: INPUT } }
}

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
      ['cut', RESULT_CUT, RESULT_WITH_META],
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

        const readsAnyway = kind === 'no meta' || kind === 'cut'
        expect(app.reads().length, label).toBe(readsAnyway || timerFired ? 1 : 0)
        const { load } = session.getState()
        expect(load.inputAt, label).not.toBeNull()
        if (kind === 'meta') expect(load.source, label).toBe('result _meta')
        if (readsAnyway) expect(load.source, label).toBe('read_project_view call')
        if (kind === 'cut') expect(app.reads(), label).toEqual([{ part: 'document', projectPath: 'mogan' }])
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

describe('a result too large for its documents', () => {
  const IMAGE_LINK = { content: [], structuredContent: { url: 'https://example.test/img?t=token', expiresAt: 1_000 } }
  const IMAGE_READ = { part: 'image', id: 'images/probe.jpg', projectPath: 'mogan' }

  it('reads with the echoed projectPath on a card with no tool input', async () => {
    const { app, session } = await connected()
    app.sendResult(RESULT_CUT)
    await settle()

    expect(app.reads()).toEqual([{ part: 'document', projectPath: 'mogan' }])
    const { load } = session.getState()
    expect(load.input).toEqual(INPUT)
    expect(load.inputAt).toBeNull()
    expect(load.resultCarriedMeta).toBe(true)
    expect(load.snapshot).toEqual(READ_DOCUMENT)
    expect(load.source).toBe('read_project_view call')
  })

  it('reads with the echoed projectPath when the tool input arrived empty', async () => {
    const { app, session } = await connected()
    app.sendInput({})
    app.sendResult(RESULT_CUT)
    await settle()

    expect(app.reads()).toEqual([{ part: 'document', projectPath: 'mogan' }])
    expect(session.getState().load.input).toEqual(INPUT)
    expect(session.getState().load.inputAt).not.toBeNull()
  })

  it('a failed read on a card with no tool input leaves the case-file reads the id', async () => {
    const app = new FakeApp()
    app.callServerTool.mockRejectedValueOnce(new Error('Refused: pick a project.'))
    const { session } = await connected(app)
    app.sendResult(RESULT_CUT)
    await settle()
    expect(headline(session.getState())).toBe('Refused: pick a project.')

    app.callServerTool.mockResolvedValue(IMAGE_LINK)
    expect(await session.transport.getSourceImage('images/probe.jpg')).toBe(IMAGE_LINK.structuredContent.url)

    expect(app.reads().at(-1)).toEqual(IMAGE_READ)
  })

  it('the case-file reads have the id while the read is still out', async () => {
    const app = new FakeApp()
    app.callServerTool.mockImplementationOnce(() => new Promise(() => {}))
    const { session } = await connected(app)
    app.sendResult(RESULT_CUT)
    await settle()
    expect(session.getState().load.phase).toBe('fetching')

    app.callServerTool.mockResolvedValue(IMAGE_LINK)
    await session.transport.getSourceImage('images/probe.jpg')

    expect(app.reads()).toEqual([{ part: 'document', projectPath: 'mogan' }, IMAGE_READ])
  })

  it('a read in flight when it arrives still lands, and the id stays', async () => {
    const app = new FakeApp()
    let answerRead = (_value: { content: []; structuredContent: Record<string, unknown> }): void => {}
    app.callServerTool.mockImplementationOnce(() => new Promise((resolve) => (answerRead = resolve)))
    const { session } = await connected(app)

    app.sendInput(INPUT)
    await vi.advanceTimersByTimeAsync(RESULT_WAIT_MS)
    app.sendResult(RESULT_CUT)
    answerRead({ content: [], structuredContent: READ_DOCUMENT as Record<string, unknown> })
    await settle()

    expect(app.reads()).toHaveLength(1)
    const { load } = session.getState()
    expect(load.phase).toBe('ready')
    expect(load.snapshot).toEqual(READ_DOCUMENT)
    expect(load.source).toBe('read_project_view call')
    expect(load.resultCarriedMeta).toBe(true)

    app.callServerTool.mockResolvedValue(IMAGE_LINK)
    await session.transport.getSourceImage('images/probe.jpg')
    expect(app.reads().at(-1)).toEqual(IMAGE_READ)
  })

  it('a read in flight that then fails shows its text', async () => {
    const app = new FakeApp()
    let failRead = (_err: Error): void => {}
    app.callServerTool.mockImplementationOnce(() => new Promise((_resolve, reject) => (failRead = reject)))
    const { session } = await connected(app)

    app.sendInput(INPUT)
    await vi.advanceTimersByTimeAsync(RESULT_WAIT_MS)
    app.sendResult(RESULT_CUT)
    failRead(new Error('Refused: pick a project.'))
    await settle()

    expect(headline(session.getState())).toBe('Refused: pick a project.')
    expect(session.getState().load.input).toEqual(INPUT)
  })

  it('a tool input arriving after it records its time and reads nothing more', async () => {
    const { app, session } = await connected()
    app.sendResult(RESULT_CUT)
    await settle()
    expect(session.getState().load.inputAt).toBeNull()

    app.sendInput(INPUT)
    await vi.advanceTimersByTimeAsync(RESULT_WAIT_MS)

    expect(session.getState().load.inputAt).toEqual(expect.any(Number))
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
    expect(state.unreachableReason).toBeNull()

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

describe("the case file's reads", () => {
  const LINK = { content: [], structuredContent: { url: 'https://example.test/img/token', expiresAt: 1_000 } }

  it("a page image carries the card's project", async () => {
    const app = new FakeApp()
    const { session } = await connected(app)
    app.sendInput(INPUT)
    app.sendResult(RESULT_WITH_META)
    app.callServerTool.mockResolvedValue(LINK)

    expect(await session.transport.getSourceImage('images/page-1.jpg')).toBe('https://example.test/img/token')
    expect(app.reads()).toEqual([{ part: 'image', id: 'images/page-1.jpg', projectPath: 'mogan' }])
  })

  it('a card with no tool input takes projectPath from the snapshot echo, for results too', async () => {
    const app = new FakeApp()
    const { session } = await connected(app)
    const echo = { show: 'latest', projectPath: '/proj_0123456789abcdef' }
    app.sendResult({ content: [], _meta: { [PROJECT_META_KEY]: { ...META_DOCUMENT, echo } } })
    app.callServerTool.mockResolvedValue({ content: [], structuredContent: { found: false } })

    expect(await session.transport.readSidecar('log_002')).toBeNull()
    expect(app.reads()).toEqual([{ part: 'results', id: 'log_002', projectPath: '/proj_0123456789abcdef' }])
  })

  it('a refused read rejects, so the side panel offers Try again', async () => {
    const app = new FakeApp()
    app.callServerTool.mockResolvedValue({ isError: true, content: [{ type: 'text', text: 'Refused.' }] } as never)
    const { session } = await connected(app)
    await expect(session.transport.readSidecar('log_001')).rejects.toThrow('Refused.')
  })
})

describe('opening the case file', () => {
  it("asks for fullscreen, reads today's document once, and hands it to the file", async () => {
    const app = new FakeApp()
    const { session } = await connected(app)
    app.sendInput(INPUT)
    app.sendResult(RESULT_WITH_META)
    app.callServerTool.mockResolvedValue({ content: [], structuredContent: READ_DOCUMENT as Record<string, unknown> })

    await session.openFile('log_002')

    expect(app.requestDisplayMode).toHaveBeenLastCalledWith({ mode: 'fullscreen' })
    expect(app.reads()).toEqual([{ part: 'document', projectPath: 'mogan' }])
    expect(session.getState().fileLogId).toBe('log_002')
    expect(projectLabel(session.getState().fileDocument)).toBe('From the read')
    expect(session.getState().load.snapshot).toEqual(META_DOCUMENT)
  })

  it('keeps the snapshot when the read fails, and a plain open clears the panel', async () => {
    const app = new FakeApp()
    const { session } = await connected(app)
    app.sendInput(INPUT)
    app.sendResult(RESULT_WITH_META)
    app.callServerTool.mockRejectedValue(new Error('Store down.'))
    await session.openFile('log_002')
    await session.openFile()

    expect(session.getState().fileLogId).toBeNull()
    expect(projectLabel(session.getState().fileDocument)).toBe('From the snapshot')
  })
})

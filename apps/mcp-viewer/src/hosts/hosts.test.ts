import { afterEach, describe, expect, it, vi } from 'vitest'
import { READ_PROJECT_VIEW } from '../contract'
import { createSession } from '../session'
import { FakeApp, BOOT, READ_DOCUMENT } from '../test/fake-app'
import { createAppHost } from './app-host'
import { createArtifactHost, type ClaudeLike, type McpLike } from './artifact-host'
import { chooseHost, readBootFacts } from './choose-host'
import { ToolCallError } from './host'
import { createTabHost, type TabHostDeps } from './tab-host'
import { headline } from '../ui/status'

afterEach(() => {
  vi.useRealTimers()
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function tabHost(reply: () => Promise<Response>, search = '') {
  const fetch = vi.fn<TabHostDeps['fetch']>(reply)
  const open = vi.fn<TabHostDeps['open']>()
  return { fetch, open, host: createTabHost({ search, fetch, open }) }
}

function artifactHost(callTool: McpLike['callTool']) {
  const mcp: McpLike = { callTool }
  const use = vi.fn<ClaudeLike['use']>(async () => mcp)
  const open = vi.fn()
  return { use, open, host: createArtifactHost({ use }, open) }
}

const NO_LISTENERS = {
  onToolInput() {},
  onToolResult() {},
  onToolCancelled() {},
  onHostContextChanged() {}
}

async function failureOf(work: Promise<unknown>): Promise<unknown> {
  return work.then(
    () => {
      throw new Error('expected a rejection')
    },
    (err: unknown) => err
  )
}

describe('chooseHost', () => {
  const self = () => {
    const win: { parent: unknown; claude?: { use?: unknown } } = { parent: null }
    win.parent = win
    return win
  }

  it('chooseHost checks the artifact first, even in a top-level window', () => {
    expect(chooseHost({ ...self(), parent: {}, claude: { use: () => {} } })).toBe('artifact')
    const top = self()
    top.claude = { use: () => {} }
    expect(chooseHost(top)).toBe('artifact')
  })

  it('chooseHost then checks for a tab, then falls to the MCP App', () => {
    expect(chooseHost(self())).toBe('tab')
    expect(chooseHost({ parent: {} })).toBe('app')
  })

  it('chooseHost ignores a window.claude with no use function', () => {
    expect(chooseHost({ parent: {}, claude: {} })).toBe('app')
    expect(chooseHost({ parent: {}, claude: { use: 'nope' } })).toBe('app')
  })

  it('records what the page saw at boot', () => {
    expect(readBootFacts({ parent: {}, claude: { use: () => {} } })).toEqual({
      typeofClaude: 'object',
      typeofClaudeUse: 'function',
      parentIsWindow: false
    })
    expect(readBootFacts(self())).toEqual({
      typeofClaude: 'undefined',
      typeofClaudeUse: 'undefined',
      parentIsWindow: true
    })
  })
})

describe('the tab host', () => {
  it('the tab POST sends both Accept types to the relative URL and no initialize', async () => {
    const { fetch, host } = tabHost(async () =>
      jsonResponse({ jsonrpc: '2.0', id: 1, result: { content: [], structuredContent: READ_DOCUMENT } })
    )
    const session = createSession({ host, boot: BOOT })
    await session.start()
    await vi.waitFor(() => expect(session.getState().load.phase).toBe('ready'))

    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('mcp')
    expect(init.method).toBe('POST')
    const headers = init.headers as Record<string, string>
    expect(headers.Accept).toContain('application/json')
    expect(headers.Accept).toContain('text/event-stream')
    const body = JSON.parse(init.body as string)
    expect(body).toMatchObject({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: READ_PROJECT_VIEW, arguments: { part: 'document' } }
    })
    expect(session.getState().load.source).toBe('read_project_view call')
  })

  it('the tab takes show and projectPath from the URL query', async () => {
    const { fetch, host } = tabHost(async () =>
      jsonResponse({ jsonrpc: '2.0', id: 1, result: { content: [], structuredContent: READ_DOCUMENT } })
    , '?show=conclusion&projectPath=mogan')
    expect(host.input).toEqual({ show: 'conclusion', projectPath: 'mogan' })

    const session = createSession({ host, boot: BOOT })
    await session.start()
    await vi.waitFor(() => expect(session.getState().load.phase).toBe('ready'))
    const body = JSON.parse((fetch.mock.calls[0] as [string, RequestInit])[1].body as string)
    expect(body.params.arguments).toEqual({ part: 'document', projectPath: 'mogan' })
  })

  it('the tab falls back to latest when show is missing or unknown', () => {
    const reply = async () => jsonResponse({})
    expect(tabHost(reply).host.input).toEqual({ show: 'latest' })
    expect(tabHost(reply, '?show=nonsense').host.input).toEqual({ show: 'latest' })
  })

  it('the tab carries the case file page and the item to open', () => {
    const reply = async () => jsonResponse({})
    const search = '?show=file&projectPath=mogan&page=log&logId=log_002&sourceId=src_001&personId=I1&other=x'
    expect(tabHost(reply, search).host.input).toEqual({
      show: 'file',
      projectPath: 'mogan',
      page: 'log',
      logId: 'log_002',
      sourceId: 'src_001',
      personId: 'I1'
    })
  })

  it('offers both modes as a local toggle and opens links with window.open', async () => {
    const { host, open } = tabHost(async () => jsonResponse({}))
    const connection = await host.connect(NO_LISTENERS)

    expect(connection.context.availableDisplayModes).toEqual(['inline', 'fullscreen'])
    await expect(host.requestDisplayMode('fullscreen')).resolves.toBe('fullscreen')
    await host.openLink('https://www.familysearch.org/')
    expect(open).toHaveBeenCalledWith('https://www.familysearch.org/')
  })

  it('show=file opens the local file view at once', async () => {
    const { host } = tabHost(
      async () => jsonResponse({ jsonrpc: '2.0', id: 1, result: { content: [], structuredContent: READ_DOCUMENT } }),
      '?show=file'
    )
    const session = createSession({ host, boot: BOOT })
    await session.start()
    await vi.waitFor(() => expect(session.getState().display.mode).toBe('fullscreen'))
  })
})

describe('the artifact host', () => {
  it('the artifact host reads payload and passes cache false', async () => {
    const callTool = vi.fn<McpLike['callTool']>(async () => ({ payload: READ_DOCUMENT }))
    const { host, use } = artifactHost(callTool)
    const session = createSession({ host, boot: BOOT })
    await session.start()
    await vi.waitFor(() => expect(session.getState().load.phase).toBe('ready'))

    expect(use).toHaveBeenCalledWith('mcp')
    expect(callTool.mock.calls).toEqual([
      ['Genealogy Viewer', READ_PROJECT_VIEW, { part: 'document' }, { cache: false }]
    ])
    expect(session.getState().load.snapshot).toEqual(READ_DOCUMENT)
    expect(session.getState().load.source).toBe('read_project_view call')
  })

  it('a null use("mcp") says the host cannot be reached', async () => {
    const use = vi.fn<ClaudeLike['use']>(async () => null)
    const session = createSession({ host: createArtifactHost({ use }, vi.fn()), boot: BOOT })
    await session.start()

    expect(session.getState().connection).toBe('unreachable')
    expect(headline(session.getState())).toBe('This page cannot reach its host.')
    expect(session.getState().unreachableReason).toBe('use("mcp") resolved null.')
  })

  it('a use("mcp") that never answers times out as unreachable', async () => {
    vi.useFakeTimers()
    const use = vi.fn<ClaudeLike['use']>(() => new Promise(() => {}))
    const session = createSession({ host: createArtifactHost({ use }, vi.fn()), boot: BOOT })
    void session.start()
    await vi.advanceTimersByTimeAsync(10_000)

    expect(session.getState().connection).toBe('unreachable')
  })

  it('a use("mcp") that answers at 11 seconds still loads the document', async () => {
    vi.useFakeTimers()
    const callTool = vi.fn<McpLike['callTool']>(async () => ({ payload: READ_DOCUMENT }))
    let answer = (_mcp: McpLike): void => {}
    const use = vi.fn<ClaudeLike['use']>(() => new Promise((resolve) => (answer = resolve)))
    const session = createSession({ host: createArtifactHost({ use }, vi.fn()), boot: BOOT })
    void session.start()

    await vi.advanceTimersByTimeAsync(11_000)
    expect(session.getState().connection).toBe('unreachable')

    answer({ callTool })
    await vi.advanceTimersByTimeAsync(0)

    expect(session.getState().connection).toBe('connected')
    expect(session.getState().load.snapshot).toEqual(READ_DOCUMENT)
    expect(callTool).toHaveBeenCalledTimes(1)
  })

  it('opens links with window.open', async () => {
    const { host, open } = artifactHost(vi.fn())
    await host.openLink('https://www.familysearch.org/')
    expect(open).toHaveBeenCalledWith('https://www.familysearch.org/')
  })
})

describe('the App host', () => {
  it('gives a tool call five minutes, long enough to read an approval prompt', async () => {
    const app = new FakeApp()
    await createAppHost(app).call(READ_PROJECT_VIEW, { part: 'document' })

    expect(app.callServerTool.mock.calls).toEqual([
      [{ name: READ_PROJECT_VIEW, arguments: { part: 'document' } }, { timeout: 300_000 }]
    ])
  })
})

describe('one failure shape from all three hosts', () => {
  it('the App host turns isError and a rejected call into a ToolCallError', async () => {
    const app = new FakeApp()
    const host = createAppHost(app)

    app.callServerTool.mockResolvedValueOnce({
      isError: true,
      content: [{ type: 'text', text: 'Refused by the server.' }]
    } as never)
    const refused = await failureOf(host.call(READ_PROJECT_VIEW, {}))
    expect(refused).toBeInstanceOf(ToolCallError)
    expect(refused).toMatchObject({ message: 'Refused by the server.' })

    app.callServerTool.mockRejectedValueOnce(Object.assign(new Error('Timed out'), { code: -32001 }))
    const rejected = await failureOf(host.call(READ_PROJECT_VIEW, {}))
    expect(rejected).toBeInstanceOf(ToolCallError)
    expect(rejected).toMatchObject({ message: 'Timed out', code: '-32001' })
  })

  it('the App host turns a denied link and a rejected mode into a ToolCallError', async () => {
    const app = new FakeApp()
    const host = createAppHost(app)

    app.openLink.mockResolvedValueOnce({ isError: true })
    expect(await failureOf(host.openLink('https://www.familysearch.org/'))).toBeInstanceOf(ToolCallError)

    app.requestDisplayMode.mockRejectedValueOnce(new Error('Not now.'))
    const rejected = await failureOf(host.requestDisplayMode('fullscreen'))
    expect(rejected).toBeInstanceOf(ToolCallError)
    expect(rejected).toMatchObject({ message: 'Not now.' })
  })

  it('the tab host turns isError, an RPC error, an HTTP error, bad JSON and a network failure into a ToolCallError', async () => {
    const cases: Array<[() => Promise<Response>, string, string | undefined]> = [
      [
        async () =>
          jsonResponse({ jsonrpc: '2.0', id: 1, result: { isError: true, content: [{ type: 'text', text: 'Refused.' }] } }),
        'Refused.',
        undefined
      ],
      [async () => jsonResponse({ jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'No tool.' } }), 'No tool.', '-32601'],
      [async () => jsonResponse({}, 404), 'The server answered 404.', 'http_404'],
      [async () => new Response('<html>'), 'The server sent something that is not JSON.', 'bad_response'],
      [async () => jsonResponse({ jsonrpc: '2.0', id: 1 }), 'The server sent no result.', 'bad_response'],
      [() => Promise.reject(new TypeError('Failed to fetch')), 'Failed to fetch', 'network']
    ]
    for (const [reply, message, code] of cases) {
      const failure = await failureOf(tabHost(reply).host.call(READ_PROJECT_VIEW, {}))
      expect(failure).toBeInstanceOf(ToolCallError)
      expect(failure).toMatchObject({ message, code })
    }
  })

  it('the artifact host turns a plain McpError rejection into a ToolCallError carrying its code', async () => {
    const { host } = artifactHost(() =>
      Promise.reject({ code: 'server_not_connected', server: 'Genealogy Viewer', message: 'Add the connector.' })
    )
    await host.connect(NO_LISTENERS)
    const failure = await failureOf(host.call(READ_PROJECT_VIEW, {}))

    expect(failure).toBeInstanceOf(ToolCallError)
    expect(failure).toMatchObject({ message: 'Add the connector.', code: 'server_not_connected' })
  })
})

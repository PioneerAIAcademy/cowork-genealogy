import { App } from '@modelcontextprotocol/ext-apps'
import { AppBridge } from '@modelcontextprotocol/ext-apps/app-bridge'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PROJECT_META_KEY, READ_PROJECT_VIEW, type ToolInput } from '../contract'
import { RESULT_WAIT_MS } from '../load'
import { createSession } from '../session'
import { BOOT, META_DOCUMENT, READ_DOCUMENT } from '../test/fake-app'
import { APP_CAPABILITIES, APP_INFO, createAppHost } from './app-host'

// The real App against the library's real host side, so the fake cannot drift
// from it. A .tsx suite only because App.connect needs a DOM for auto-resize.

class LinkedApp extends App {
  constructor(private readonly link: Transport) {
    super(APP_INFO, APP_CAPABILITIES)
  }

  override connect(): Promise<void> {
    return super.connect(this.link)
  }
}

async function linked() {
  const [viewSide, hostSide] = InMemoryTransport.createLinkedPair()
  const bridge = new AppBridge(
    null,
    { name: 'Test Host', version: '1.2.3' },
    { serverTools: {}, updateModelContext: { text: {} } },
    { hostContext: { displayMode: 'inline', availableDisplayModes: ['inline', 'fullscreen'] } }
  )
  bridge.onrequestdisplaymode = async ({ mode }) => ({ mode })
  const initialized = new Promise<void>((resolve) => {
    bridge.oninitialized = () => resolve()
  })
  await bridge.connect(hostSide)
  const session = createSession({ host: createAppHost(new LinkedApp(viewSide)), boot: BOOT })
  await session.start()
  await initialized
  return { bridge, session }
}

const INPUT: ToolInput = { show: 'latest' }

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  )
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('against the real App', () => {
  it('declares both display modes and reads the host at connect', async () => {
    const { bridge, session } = await linked()
    const state = session.getState()

    expect(bridge.getAppCapabilities()?.availableDisplayModes).toEqual(['inline', 'fullscreen'])
    expect(state.hostName).toBe('Test Host')
    expect(state.hostVersion).toBe('1.2.3')
    expect(state.display).toEqual({ mode: 'inline', available: ['inline', 'fullscreen'] })
    expect(state.capabilities?.updateModelContext).toEqual({ text: {} })
  })

  it('a result _meta survives the real App and is the snapshot', async () => {
    const { bridge, session } = await linked()
    await bridge.sendToolInput({ arguments: INPUT })
    await bridge.sendToolResult({
      content: [{ type: 'text', text: 'shown' }],
      _meta: { [PROJECT_META_KEY]: META_DOCUMENT }
    })

    await vi.waitFor(() => expect(session.getState().load.source).toBe('result _meta'))
    expect(session.getState().load.snapshot).toEqual(META_DOCUMENT)
    expect(session.getState().load.resultKeys).toEqual(expect.arrayContaining(['content', '_meta']))
  })

  it('a mount read answered after 61 seconds lands on the card', async () => {
    const { bridge, session } = await linked()
    vi.useFakeTimers()
    bridge.oncalltool = () =>
      new Promise((resolve) => {
        setTimeout(
          () => resolve({ content: [], structuredContent: READ_DOCUMENT as Record<string, unknown> }),
          61_000
        )
      })

    await bridge.sendToolInput({ arguments: INPUT })
    await vi.advanceTimersByTimeAsync(RESULT_WAIT_MS + 61_000)

    expect(session.getState().load.phase).toBe('ready')
    expect(session.getState().load.snapshot).toEqual(READ_DOCUMENT)
  })

  it('a host that answers requestDisplayMode and never notifies keeps the file open through a real resize', async () => {
    const { bridge, session } = await linked()
    await session.requestMode('fullscreen')
    await bridge.sendHostContextChange({ containerDimensions: { height: 900, width: 1200 } })

    await vi.waitFor(() => expect(session.getState().contextChanges).toHaveLength(1))
    expect(session.getState().contextChanges[0]).toMatchObject({ displayMode: null, keys: ['containerDimensions'] })
    expect(session.getState().display.mode).toBe('fullscreen')
  })

  it('a tool that throws in the host and one that returns isError fail the same way', async () => {
    const { bridge, session } = await linked()
    bridge.oncalltool = async (params) => {
      if (params.arguments?.part === 'image') throw new Error('Host refused.')
      return { isError: true, content: [{ type: 'text', text: 'Server refused.' }] }
    }
    await session.runImageProbe()
    expect(session.getState().imageProbe).toMatchObject({ status: 'refused' })
    expect(session.getState().imageProbe?.message).toContain('Host refused.')

    bridge.oncalltool = async () => ({ isError: true, content: [{ type: 'text', text: 'Server refused.' }] })
    await session.runImageProbe()
    expect(session.getState().imageProbe).toMatchObject({ status: 'refused', message: 'Server refused.' })
  })

  it('passes read_project_view through to the host with its arguments', async () => {
    const { bridge, session } = await linked()
    const seen: unknown[] = []
    bridge.oncalltool = async (params) => {
      seen.push(params)
      return { content: [], structuredContent: { url: 'https://example.test/img?t=x', expiresAt: 1 } }
    }
    await session.runImageProbe()

    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({ name: READ_PROJECT_VIEW, arguments: { part: 'image', id: 'images/probe.jpg' } })
    expect(session.getState().imageProbe).toMatchObject({ status: 'showing', url: 'https://example.test/img?t=x' })
  })
})

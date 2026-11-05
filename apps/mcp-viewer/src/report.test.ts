import { describe, expect, it } from 'vitest'
import { INITIAL_DISPLAY } from './display-mode'
import { INITIAL_LOAD } from './load'
import { headline, projectName, reportText } from './report'
import type { SessionState } from './session'
import { BOOT, META_DOCUMENT } from './test/fake-app'

function state(patch: Partial<SessionState> = {}): SessionState {
  return {
    connection: 'connected',
    unreachableReason: null,
    mountId: 'mount-1',
    loadedAt: Date.UTC(2026, 10, 5),
    boot: BOOT,
    hostKind: 'app',
    hostName: 'Fake Host',
    hostVersion: '9.9.9',
    capabilities: { serverTools: {}, updateModelContext: { text: {} } },
    load: INITIAL_LOAD,
    display: INITIAL_DISPLAY,
    contextChanges: [],
    modeRequests: [],
    sizeProbes: [],
    imageProbe: null,
    ...patch
  }
}

/** One whole line, so a test can say nothing follows the value. */
function reportLine(text: string, label: string): string | undefined {
  return text
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith(`${label}:`))
}

describe('the project name', () => {
  it('is the title, else the folder name, never empty', () => {
    expect(projectName({ research: { project: { title: 'Mogan children' } }, derived: { folderName: 'mogan' } })).toBe(
      'Mogan children'
    )
    expect(projectName({ research: { project: {} }, derived: { folderName: 'mogan' } })).toBe('mogan')
    expect(projectName({ research: { project: { title: '  ' } }, derived: { folderName: 'mogan' } })).toBe('mogan')
    expect(projectName({})).toBe('Untitled project')
  })
})

describe('the report text', () => {
  it('records every page-side item of the M0 list', () => {
    const text = reportText(
      state({
        load: {
          ...INITIAL_LOAD,
          phase: 'ready',
          input: { show: 'latest' },
          inputAt: Date.UTC(2026, 10, 5, 1),
          resultAt: Date.UTC(2026, 10, 5, 2),
          resultCarriedMeta: true,
          snapshot: META_DOCUMENT,
          source: 'result _meta'
        },
        display: { mode: 'fullscreen', available: ['inline', 'fullscreen'] },
        contextChanges: [
          { at: Date.UTC(2026, 10, 5, 3), displayMode: 'fullscreen', keys: ['displayMode'] },
          { at: Date.UTC(2026, 10, 5, 4), displayMode: null, keys: ['containerDimensions'] }
        ]
      })
    )

    for (const line of [
      'project: From the snapshot',
      'sources: 2',
      'questions: 1',
      'canary: CANARY-META-M4X9',
      'input: {"show":"latest"}',
      'mount id: mount-1',
      'frame loaded: 2026-11-05T00:00:00.000Z',
      'typeof window.claude: undefined',
      'typeof window.claude?.use: undefined',
      'window.parent === window: false',
      'host kind: app',
      'host name: Fake Host',
      'host version: 9.9.9',
      'availableDisplayModes: inline, fullscreen',
      'current mode: fullscreen',
      'updateModelContext offered: yes',
      'result _meta arrived: yes',
      'data came from: result _meta',
      'host-context-changed events: 2',
      '2026-11-05T03:00:00.000Z displayMode fullscreen; keys: displayMode',
      '2026-11-05T04:00:00.000Z no displayMode; keys: containerDimensions'
    ]) {
      expect(text).toContain(line)
    }
  })

  it('says when updateModelContext is not offered and no display modes are', () => {
    const text = reportText(state({ capabilities: { serverTools: {} } }))
    expect(text).toContain('updateModelContext offered: no')
    expect(text).toContain('availableDisplayModes: none offered')
    expect(text).toContain('result _meta arrived: no result yet')
    expect(text).toContain('data came from: none yet')
  })

  it('reports the pad a mount carried by size alone', () => {
    const text = reportText(state({ load: { ...INITIAL_LOAD, phase: 'ready', snapshot: { pad: 'x'.repeat(10_000) } } }))
    expect(reportLine(text, 'pad on mount')).toBe('pad on mount: 10000 characters')
    expect(text).not.toContain('xxxx')
  })

  it('names the first result by its top-level keys, or none before one arrives', () => {
    expect(reportLine(reportText(state()), 'first result keys')).toBe('first result keys: none')

    const text = reportText(state({ load: { ...INITIAL_LOAD, resultKeys: ['content', '_meta'] } }))
    expect(reportLine(text, 'first result keys')).toBe('first result keys: content, _meta')
  })

  it('never prints a URL, because the block goes into a public doc', () => {
    const text = reportText(
      state({
        capabilities: { sandbox: { csp: { resourceDomains: ['https://secret-tunnel.example.ts.net'] } } },
        imageProbe: {
          ref: 'images/a.jpg',
          status: 'showing',
          url: 'https://secret-tunnel.example.ts.net/img/token',
          expiresAt: 0
        },
        sizeProbes: [
          { id: 1, chars: 10, status: 'failed', ms: 1, message: 'POST http://secret-tunnel.example.ts.net/x failed' }
        ]
      })
    )
    expect(text).not.toContain('secret-tunnel')
    expect(text).toContain('<url>')
  })

  it('reports each size probe and image outcome', () => {
    const text = reportText(
      state({
        sizeProbes: [
          { id: 1, chars: 400_000, status: 'ok', ms: 12, received: 400_000 },
          { id: 2, chars: 2_000_000, status: 'failed', ms: 30, message: 'Too large.', code: '-32000' },
          { id: 3, chars: 1_000_000, status: 'running' }
        ],
        imageProbe: { ref: 'images/a.jpg', status: 'loaded', expiresAt: 0, width: 640, height: 480 }
      })
    )
    expect(reportLine(text, '400000')).toBe('400000: received 400000 characters in 12 ms')
    expect(text).toContain('2000000: failed after 30 ms: Too large. (-32000)')
    expect(text).toContain('1000000: running')
    expect(text).toContain('ref: images/a.jpg')
    expect(text).toContain('result: loaded, 640 x 480')
  })
})

describe('the headline', () => {
  it('says what the card is waiting on', () => {
    expect(headline(state())).toBe('Waiting for the tool call.')
    expect(headline(state({ load: { ...INITIAL_LOAD, phase: 'fetching' } }))).toBe('Loading the project.')
  })
})

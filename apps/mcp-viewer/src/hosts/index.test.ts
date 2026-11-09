import { describe, expect, it, vi } from 'vitest'
import type { ClaudeLike } from './artifact-host'
import { createHost } from './index'

type HostArgument = Parameters<typeof createHost>[0]

function fakeWindow(patch: { claude?: ClaudeLike; parent?: unknown } = {}) {
  const win = {
    location: { search: '?show=plan' },
    fetch: vi.fn(function (this: unknown) {
      // A browser's fetch throws "Illegal invocation" off its window.
      if (this !== win) throw new TypeError('Illegal invocation')
      return Promise.resolve(new Response(JSON.stringify({ result: { content: [], structuredContent: {} } })))
    }),
    open: vi.fn(),
    parent: patch.parent as unknown,
    claude: patch.claude
  }
  win.parent ??= win
  return win
}

describe('createHost', () => {
  it('builds the host chooseHost names', () => {
    const use = vi.fn<ClaudeLike['use']>(async () => null)
    expect(createHost(fakeWindow({ claude: { use } }) as unknown as HostArgument).kind).toBe('artifact')
    expect(createHost(fakeWindow() as unknown as HostArgument).kind).toBe('tab')
    expect(createHost(fakeWindow({ parent: {} }) as unknown as HostArgument).kind).toBe('app')
  })

  it('the tab reads the real query and calls fetch on the window', async () => {
    const win = fakeWindow()
    const host = createHost(win as unknown as HostArgument)

    expect(host.input).toEqual({ show: 'plan' })
    await host.call('read_project_view', { part: 'document' })
    expect(win.fetch).toHaveBeenCalledTimes(1)
  })

  it('opens a link in a new tab with no opener', async () => {
    const win = fakeWindow()
    await createHost(win as unknown as HostArgument).openLink('https://www.familysearch.org/')

    expect(win.open).toHaveBeenCalledWith('https://www.familysearch.org/', '_blank', 'noopener,noreferrer')
  })
})

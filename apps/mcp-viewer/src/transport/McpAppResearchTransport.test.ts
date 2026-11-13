import { assertTransportContract } from '@genealogy/viewer-ui/contract'
import { describe, expect, it, vi } from 'vitest'
import type { ProjectDocument } from '../contract'
import { McpAppResearchTransport, projectLabel } from './McpAppResearchTransport'

function transport(read = vi.fn(async (_args: Record<string, unknown>): Promise<unknown> => ({ found: false }))) {
  const openLink = vi.fn()
  return { t: new McpAppResearchTransport({ read, openLink }), read, openLink }
}

const doc = (objective: string): ProjectDocument => ({
  research: { project: { objective } } as ProjectDocument['research'],
  tree: { persons: [] },
  collections: null,
  derived: { folderName: 'proj_0123456789abcdef' }
})

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('McpAppResearchTransport', () => {
  it('passes the shared transport contract, reading nothing for the probe id', async () => {
    const { t, read } = transport()
    t.update(doc('A'))
    await assertTransportContract(t)
    expect(read).not.toHaveBeenCalled()
  })

  it('reads one results file, and an absent one is null', async () => {
    const { t, read } = transport(
      vi.fn(async (args: Record<string, unknown>) => (args.id === 'log_002' ? { found: true, results: { results: [1] } } : { found: false }))
    )
    expect(await t.readSidecar('log_002')).toEqual({ raw: '{"results":[1]}', mtime: 0 })
    expect(await t.readSidecar('log_009')).toBeNull()
    expect(read).toHaveBeenCalledWith({ part: 'results', id: 'log_002' })
  })

  it('a failed results read rejects, so the panel offers Try again', async () => {
    const { t } = transport(vi.fn(async () => Promise.reject(new Error('Refused.'))))
    await expect(t.readSidecar('log_001')).rejects.toThrow('Refused.')
  })

  it('a project with no title is named by its objective, then its folder, never blank', () => {
    expect(projectLabel(doc('Find her parents'))).toBe('Find her parents')
    expect(projectLabel(doc('  '))).toBe('proj_0123456789abcdef')
    expect(projectLabel({ research: {} })).toBe('This project')
    expect(projectLabel(null)).toBe('This project')
  })

  it('a transport made from snapshot A shows document B once it arrives', async () => {
    const { t } = transport()
    t.update(doc('A'))
    const heard: string[] = []
    t.subscribe({
      onResearch: (r) => heard.push(String(r.project?.objective)),
      onGedcomx: () => {},
      onCollections: () => {},
      onSidecar: () => {},
      onError: () => {},
      onNotice: () => {}
    })
    const pending = t.getProjectState()
    t.update(doc('B'))
    expect((await pending).research?.project?.objective).toBe('B')
    await flush()
    expect(heard.at(-1)).toBe('B')
    expect((await t.getProjectState()).label).toBe('B')
  })

  it('opens only https links, and only FamilySearch targets that resolve', async () => {
    const { t, openLink } = transport()
    t.openExternal('http://example.com/x')
    t.openExternal('javascript:alert(1)')
    t.openExternal('https://example.com/x')
    t.openFamilySearch('not an id')
    t.openFamilySearch('ark:/61903/1:1:QPRC-WPBZ')
    await flush()
    expect(openLink.mock.calls.map(([url]) => url)).toEqual([
      'https://example.com/x',
      'https://www.familysearch.org/ark:/61903/1:1:QPRC-WPBZ'
    ])
  })

  it('a host that refuses an open throws nothing into the page', async () => {
    const openLink = vi.fn(async () => Promise.reject(new Error('Denied.')))
    const t = new McpAppResearchTransport({ read: vi.fn(), openLink })
    t.openExternal('https://example.com/x')
    await flush()
    expect(openLink).toHaveBeenCalledTimes(1)
  })

  it('has no feedback', async () => {
    const { t } = transport()
    await expect(t.submitFeedback()).rejects.toThrow('Feedback is not available here.')
  })
})

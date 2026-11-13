import { describe, expect, it, vi } from 'vitest'
import type { ProjectDocument } from '../contract'
import { McpAppResearchTransport, projectLabel } from './McpAppResearchTransport'

function transport(read = vi.fn(async (_args: Record<string, unknown>): Promise<unknown> => ({ found: false }))) {
  return { t: new McpAppResearchTransport({ read }), read }
}

const doc = (objective: string): ProjectDocument => ({
  research: { project: { objective } } as ProjectDocument['research'],
  derived: { folderName: 'proj_0123456789abcdef' }
})

describe("the case file's reads", () => {
  it('reads one results file; an absent one, or an id that is no log id, is null with no call for the latter', async () => {
    const { t, read } = transport(
      vi.fn(async (args: Record<string, unknown>) => (args.id === 'log_002' ? { found: true, results: { results: [1] } } : { found: false }))
    )
    expect(await t.readSidecar('log_002')).toEqual({ raw: '{"results":[1]}', mtime: 0 })
    expect(await t.readSidecar('log_009')).toBeNull()
    expect(await t.readSidecar('__not_a_log__')).toBeNull()
    expect(read.mock.calls.map(([args]) => args)).toEqual([
      { part: 'results', id: 'log_002' },
      { part: 'results', id: 'log_009' }
    ])
  })

  it('a failed results read rejects, so the pane offers Try again', async () => {
    const { t } = transport(vi.fn(async () => Promise.reject(new Error('Refused.'))))
    await expect(t.readSidecar('log_001')).rejects.toThrow('Refused.')
  })

  it("finds a record's search, and a page image's signed link", async () => {
    const { t, read } = transport(
      vi.fn(async (args: Record<string, unknown>) =>
        args.part === 'recordSearch' ? { found: true, logId: 'log_004' } : { url: 'https://example.test/img?t=x', expiresAt: 1 }
      )
    )
    expect(await t.recordSearch('ark:/61903/1:1:QPRC-WPBZ')).toBe('log_004')
    expect(await t.getSourceImage('images/page-1.jpg')).toBe('https://example.test/img?t=x')
    expect(read.mock.calls.map(([args]) => args)).toEqual([
      { part: 'recordSearch', id: 'ark:/61903/1:1:QPRC-WPBZ' },
      { part: 'image', id: 'images/page-1.jpg' }
    ])
  })

  it('a project with no title is named by its objective, then its folder, never blank', () => {
    expect(projectLabel(doc('Find her parents'))).toBe('Find her parents')
    expect(projectLabel(doc('  '))).toBe('proj_0123456789abcdef')
    expect(projectLabel({ research: {} })).toBe('This project')
    expect(projectLabel(null)).toBe('This project')
  })
})

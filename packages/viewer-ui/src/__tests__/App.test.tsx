import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ResearchTransport } from '../transport'

vi.mock('../contexts/ResearchDataContext', async () => {
  const actual = await vi.importActual<typeof import('../contexts/ResearchDataContext')>(
    '../contexts/ResearchDataContext'
  )
  return { ...actual, useResearchData: vi.fn() }
})

import { useResearchData } from '../contexts/ResearchDataContext'
import { buildMockContext } from '../contexts/__tests__/mockContext'
import App from '../App'

const stubTransport = {
  getProjectState: async () => ({ research: null, gedcomx: null, label: null }),
  subscribe: () => () => {},
  readSidecar: async () => null,
  submitFeedback: async () => ({ ok: true }),
  openExternal: () => {}
} as unknown as ResearchTransport

// Pins that App MOUNTS the banner, in both AppContent branches. FolderNotice.test.tsx
// renders the component directly, so it passes even if App never renders it.
function mockCtx(notice: string | null, withResearch: boolean): void {
  const base = buildMockContext(withResearch ? { notice } : { notice, research: null })
  vi.mocked(useResearchData).mockReturnValue({ ...base, folderPath: '/p' })
}

describe('App mounts the folder notice', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows the banner when research IS loaded', () => {
    mockCtx('subfolder heads-up', true)
    render(<App transport={stubTransport} />)
    expect(screen.getByRole('status')).toHaveTextContent('subfolder heads-up')
  })

  it('shows the banner when research is NOT loaded', () => {
    mockCtx('subfolder heads-up', false)
    render(<App transport={stubTransport} />)
    expect(screen.getByRole('status')).toHaveTextContent('subfolder heads-up')
  })
})

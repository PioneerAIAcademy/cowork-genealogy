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

// Annotated (not cast) so typecheck reports TS2322 if the transport shape drifts
// — e.g. `notice` going missing from getProjectState (#1899 review).
const stubTransport: ResearchTransport = {
  getProjectState: async () => ({ research: null, gedcomx: null, label: null, notice: null }),
  subscribe: () => () => {},
  readSidecar: async () => null,
  submitFeedback: async () => ({ ok: true }),
  openExternal: () => {},
  openFamilySearch: () => {}
}

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

// Same shape for the error bar, and for the same reason: `error` was rendered by
// nothing, so selectFolder's rejection — the only feedback on picking a
// non-project folder, and where the "research.json is in a subfolder" pointer
// lands — was silent. The no-folder case is the load-bearing one: a rejected
// pick never sets folderPath, so that is the branch the user is looking at.
function mockErrCtx(error: string | null, folderPath: string | null, withResearch = true): void {
  const base = buildMockContext(withResearch ? { error } : { error, research: null })
  vi.mocked(useResearchData).mockReturnValue({ ...base, folderPath })
}

describe('App mounts the error notice', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows the error when NO folder is open (the rejected-pick branch)', () => {
    mockErrCtx('research.json is in a subfolder', null)
    render(<App transport={stubTransport} />)
    expect(screen.getByRole('alert')).toHaveTextContent('research.json is in a subfolder')
  })

  it('shows the error when a folder is open but research is NOT loaded', () => {
    mockErrCtx('watcher blew up', '/p', false)
    render(<App transport={stubTransport} />)
    expect(screen.getByRole('alert')).toHaveTextContent('watcher blew up')
  })

  it('shows the error when research IS loaded', () => {
    mockErrCtx('watcher blew up', '/p', true)
    render(<App transport={stubTransport} />)
    expect(screen.getByRole('alert')).toHaveTextContent('watcher blew up')
  })

  it('renders nothing when there is no error', () => {
    mockErrCtx(null, '/p')
    render(<App transport={stubTransport} />)
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

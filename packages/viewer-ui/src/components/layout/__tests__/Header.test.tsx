import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../../contexts/ResearchDataContext', async () => {
  const actual = await vi.importActual<
    typeof import('../../../contexts/ResearchDataContext')
  >('../../../contexts/ResearchDataContext')
  return { ...actual, useResearchData: vi.fn() }
})

import { useResearchData } from '../../../contexts/ResearchDataContext'
import { buildMockContext } from '../../../contexts/__tests__/mockContext'
import Header from '../Header'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Export GEDCOM button', () => {
  it('is disabled until both documents are loaded', () => {
    vi.mocked(useResearchData).mockReturnValue(buildMockContext({ gedcomx: null }))
    render(<Header />)
    expect(screen.getByRole('button', { name: 'Export GEDCOM' })).toBeDisabled()
  })

  it('downloads the GEDCOM text as <project title>.ged', async () => {
    const ctx = buildMockContext()
    vi.mocked(useResearchData).mockReturnValue(ctx)
    let blob: Blob | undefined
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn((b: Blob) => {
        blob = b
        return 'blob:gedcom'
      }),
      revokeObjectURL: vi.fn()
    })
    let downloaded: { href: string; download: string } | undefined
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement
    ) {
      downloaded = { href: this.getAttribute('href') ?? '', download: this.download }
    })

    render(<Header />)
    await userEvent.click(screen.getByRole('button', { name: 'Export GEDCOM' }))

    expect(downloaded?.href).toBe('blob:gedcom')
    expect(downloaded?.download).toMatch(/\.ged$/)
    // jsdom's Blob has no .text(); FileReader is the portable read.
    const text = await new Promise<string>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.readAsText(blob!)
    })
    expect(text.startsWith('0 HEAD\n')).toBe(true)
    expect(text.trimEnd().endsWith('0 TRLR')).toBe(true)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('downloads as octet-stream and revokes the URL only after a delay', () => {
    vi.useFakeTimers()
    try {
      vi.mocked(useResearchData).mockReturnValue(buildMockContext())
      let blob: Blob | undefined
      const revoke = vi.fn()
      vi.stubGlobal('URL', {
        ...URL,
        createObjectURL: vi.fn((b: Blob) => {
          blob = b
          return 'blob:gedcom'
        }),
        revokeObjectURL: revoke
      })
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

      render(<Header />)
      fireEvent.click(screen.getByRole('button', { name: 'Export GEDCOM' }))

      // text/plain lets Safari save `x.ged.txt`.
      expect(blob?.type).toBe('application/octet-stream')
      vi.advanceTimersByTime(1000)
      expect(revoke).not.toHaveBeenCalled()
      vi.advanceTimersByTime(60_000)
      expect(revoke).toHaveBeenCalledWith('blob:gedcom')
    } finally {
      vi.useRealTimers()
    }
  })
})

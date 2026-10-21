import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ExternalLinksResults from '../ExternalLinksResults'
import type { ExternalLinkResult } from '../SidecarResultCard'
import { setOpenExternal, setOpenFamilySearch } from '../../../lib/external'
import { externalLinksSidecar } from '../../../lib/__fixtures__/external-links-sidecar'

describe('ExternalLinksResults (#3594)', () => {
  const results = externalLinksSidecar.payload.results as unknown as ExternalLinkResult[]
  const fs = vi.fn()
  const generic = vi.fn()

  beforeEach(() => {
    fs.mockClear()
    generic.mockClear()
    setOpenFamilySearch(fs)
    setOpenExternal(generic)
  })

  it('lists each linkText with its URL visible', () => {
    render(<ExternalLinksResults results={results} />)
    for (const r of results) {
      expect(screen.getByText(r.linkText!)).toBeInTheDocument()
      expect(screen.getByText(r.url!)).toBeInTheDocument()
    }
    expect(screen.queryByText('Untitled record')).toBeNull()
  })

  it('opens a link through the generic channel, not the FamilySearch one', async () => {
    render(<ExternalLinksResults results={results} />)
    await userEvent.click(screen.getByRole('button', { name: results[0].url }))
    expect(generic).toHaveBeenCalledWith(results[0].url)
    expect(fs).not.toHaveBeenCalled()
  })

  it('renders a non-http(s) URL as text, with no button', () => {
    render(<ExternalLinksResults results={results} />)
    expect(screen.getAllByRole('button')).toHaveLength(2)
    expect(
      screen.queryByRole('button', { name: 'ftp://archive.example.org/schuylkill/' })
    ).toBeNull()
  })

  it('falls back to the URL as the label, and skips rows with no URL', () => {
    render(
      <ExternalLinksResults
        results={[
          { linkText: '', url: 'https://example.org/a' },
          { linkText: 'No url here' },
          null as never
        ]}
      />
    )
    expect(screen.getAllByText('https://example.org/a')).toHaveLength(2)
    expect(screen.queryByText('No url here')).toBeNull()
  })
})

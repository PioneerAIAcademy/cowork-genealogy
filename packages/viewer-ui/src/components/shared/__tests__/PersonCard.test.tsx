import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PersonCard from '../PersonCard'
import { setOpenExternal } from '../../../lib/external'
import type { GedcomxPerson } from '../../../lib/schema'

const basePerson: GedcomxPerson = {
  id: 'I1',
  gender: 'Male',
  names: [{ id: 'N1', preferred: true, given: 'Patrick', surname: 'Flynn' }],
  facts: [{ id: 'F1', type: 'Birth', primary: true, date: '1846', place: 'Schuylkill County, PA' }]
}

describe('PersonCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setOpenExternal(() => {})
  })

  it('renders the preferred name and facts', () => {
    render(<PersonCard person={basePerson} />)
    expect(screen.getByText('Patrick Flynn')).toBeInTheDocument()
    expect(screen.getByText(/b\. 1846, Schuylkill County, PA/)).toBeInTheDocument()
  })

  it('omits the FamilySearch link when ark is absent', () => {
    render(<PersonCard person={basePerson} />)
    expect(screen.queryByText('View on FamilySearch')).toBeNull()
  })

  it('opens the resolver URL derived from a bare ark', async () => {
    const spy = vi.fn()
    setOpenExternal(spy)
    render(<PersonCard person={{ ...basePerson, ark: 'ark:/61903/4:1:KGS8-LY1' }} />)
    await userEvent.click(screen.getByRole('link', { name: 'View on FamilySearch' }))
    expect(spy).toHaveBeenCalledWith('https://www.familysearch.org/ark:/61903/4:1:KGS8-LY1')
  })

  it('opens a legacy full-URL ark as-is, without prefixing the host again', async () => {
    const spy = vi.fn()
    setOpenExternal(spy)
    render(
      <PersonCard
        person={{ ...basePerson, ark: 'https://familysearch.org/ark:/61903/4:1:KGS8-LY1' }}
      />
    )
    await userEvent.click(screen.getByRole('link', { name: 'View on FamilySearch' }))
    expect(spy).toHaveBeenCalledWith('https://familysearch.org/ark:/61903/4:1:KGS8-LY1')
  })

  it('sets href to the resolved URL, not the bare ark, so opening in a new tab lands correctly', () => {
    render(<PersonCard person={{ ...basePerson, ark: 'ark:/61903/4:1:KGS8-LY1' }} />)
    const link = screen.getByRole('link', { name: 'View on FamilySearch' })
    expect(link).toHaveAttribute('href', 'https://www.familysearch.org/ark:/61903/4:1:KGS8-LY1')
  })
})

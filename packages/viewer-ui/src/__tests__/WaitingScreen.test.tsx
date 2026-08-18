import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { WaitingScreen } from '../App'

describe('WaitingScreen — folder copy is gated on the folder picker being available', () => {
  // Electron: a real folder is watched and the user can open another one.
  it('names the watched folder and offers to open another when folder selection is available', () => {
    render(<WaitingScreen folderPath="/home/me/projects/flynn" canSelectFolder={true} />)
    expect(screen.getByText('/home/me/projects/flynn')).toBeInTheDocument()
    expect(screen.getByText(/Watching/)).toBeInTheDocument()
    expect(screen.getByText(/open that folder instead/)).toBeInTheDocument()
  })

  // Web: `folderPath` is the session title, not a path, and there is no folder
  // picker — so the copy must not call it a watched folder or tell the user to
  // open one (issue #1317 review). Even with a truthy folderPath (the title),
  // none of the folder-specific copy may appear.
  it('shows no folder-specific copy on the web client', () => {
    render(<WaitingScreen folderPath="Children of Charles Checketts" canSelectFolder={false} />)
    expect(screen.queryByText(/Watching/)).toBeNull()
    expect(screen.queryByText(/open that folder instead/)).toBeNull()
    // The session title must not be shown as if it were a folder path.
    expect(screen.queryByText('Children of Charles Checketts')).toBeNull()
    // A neutral, accurate message is still shown.
    expect(screen.getByText('No research data yet')).toBeInTheDocument()
  })
})

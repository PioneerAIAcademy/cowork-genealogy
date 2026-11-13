import type { ReactNode } from 'react'
import { useFile } from './FileContext'
import type { PaneTarget } from './model'

/** A record, search or person named in the file: opens it in the pane, never a new page. */
export function Open({ target, children }: { target: PaneTarget; children: ReactNode }) {
  const { open } = useFile()
  return (
    <button type="button" className="open-link" onClick={() => open(target)}>
      {children}
    </button>
  )
}

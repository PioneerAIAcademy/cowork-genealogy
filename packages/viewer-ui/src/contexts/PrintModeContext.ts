import { createContext, useContext } from 'react'

// True only inside PrintView: every Card, log row and transcription renders
// expanded, with no toggles and no developer panels. The default is false, so a
// component rendered anywhere else behaves exactly as it did before printing
// existed.
export const PrintModeContext = createContext(false)

export function usePrintMode(): boolean {
  return useContext(PrintModeContext)
}

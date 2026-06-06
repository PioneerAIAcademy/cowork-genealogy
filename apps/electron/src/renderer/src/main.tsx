import '@genealogy/viewer-ui/styles.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from '@genealogy/viewer-ui'
import { IpcResearchTransport } from './transport/IpcResearchTransport'

// Electron injects the IPC-backed transport; the shared viewer is otherwise
// identical to the web client's.
const transport = new IpcResearchTransport()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App transport={transport} />
  </StrictMode>
)

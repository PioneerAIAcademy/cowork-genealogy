import { createRoot } from 'react-dom/client'
import { readBootFacts } from './hosts/choose-host'
import { createHost } from './hosts/index'
import { createSession } from './session'
import { applyHostTheme } from './theme'
import './ui/styles.css'
import { Viewer } from './ui/Viewer'

const session = createSession({
  host: createHost(window),
  boot: readBootFacts(window),
  applyTheme: applyHostTheme
})

createRoot(document.getElementById('root') as HTMLElement).render(<Viewer session={session} />)
void session.start()

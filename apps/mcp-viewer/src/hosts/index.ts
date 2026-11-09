import { App } from '@modelcontextprotocol/ext-apps'
import { APP_CAPABILITIES, APP_INFO, createAppHost } from './app-host'
import { createArtifactHost, type ClaudeLike } from './artifact-host'
import { chooseHost } from './choose-host'
import type { Host } from './host'
import { createTabHost } from './tab-host'

export function createHost(win: Window & { claude?: ClaudeLike }): Host {
  const open = (url: string): void => {
    win.open(url, '_blank', 'noopener,noreferrer')
  }

  switch (chooseHost(win)) {
    case 'artifact':
      return createArtifactHost(win.claude as ClaudeLike, open)
    case 'tab':
      return createTabHost({ search: win.location.search, fetch: (url, init) => win.fetch(url, init), open })
    case 'app':
      return createAppHost(new App(APP_INFO, APP_CAPABILITIES))
  }
}

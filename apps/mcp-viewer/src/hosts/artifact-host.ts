import { CONNECTOR_NAME } from '../contract'
import { HostUnreachableError, LOCAL_DISPLAY_CONTEXT, ToolCallError, toToolCallError, type Host } from './host'

export interface McpLike {
  callTool(server: string, tool: string, input: unknown, options: { cache: false }): Promise<{ payload?: unknown }>
}

export interface ClaudeLike {
  use(name: 'mcp'): Promise<McpLike | null>
}

/** A published artifact reaching the connector as the viewer. */
export function createArtifactHost(claude: ClaudeLike, open: (url: string) => void): Host {
  let mcp: McpLike | null = null

  return {
    kind: 'artifact',
    // An artifact has no tool call behind it.
    input: { show: 'latest' },

    async connect() {
      mcp = await claude.use('mcp')
      if (!mcp) throw new HostUnreachableError('use("mcp") resolved null.')
      return { name: 'artifact', context: LOCAL_DISPLAY_CONTEXT }
    },

    async call(tool, args) {
      if (!mcp) throw new ToolCallError('The artifact host is not connected.', 'not_connected')
      try {
        return (await mcp.callTool(CONNECTOR_NAME, tool, args, { cache: false })).payload
      } catch (err) {
        throw toToolCallError(err)
      }
    },

    async openLink(url) {
      open(url)
    },

    async requestDisplayMode(mode) {
      return mode
    }
  }
}

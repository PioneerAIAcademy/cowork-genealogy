import { SHOW_VALUES, type Show, type ToolInput } from '../contract'
import { LOCAL_DISPLAY_CONTEXT, ToolCallError, toToolCallError, unwrapToolResult, type Host } from './host'

export interface TabHostDeps {
  search: string
  fetch(url: string, init: RequestInit): Promise<Response>
  open(url: string): void
}

function inputFromQuery(search: string): ToolInput {
  const query = new URLSearchParams(search)
  const show = query.get('show')
  const input: ToolInput = { show: SHOW_VALUES.includes(show as Show) ? show : 'latest' }
  for (const key of ['projectPath', 'page', 'questionId', 'logId', 'sourceId', 'personId', 'planItemId']) {
    const value = query.get(key)
    if (value) input[key] = value
  }
  return input
}

interface RpcReply {
  result?: { isError?: boolean; content?: unknown; structuredContent?: unknown }
  error?: { code?: unknown; message?: unknown }
}

/** A browser tab on the local server, which is stateless: no initialize. */
export function createTabHost(deps: TabHostDeps): Host {
  let nextId = 1

  return {
    kind: 'tab',
    input: inputFromQuery(deps.search),

    async connect() {
      return { name: 'browser tab', context: LOCAL_DISPLAY_CONTEXT }
    },

    async call(tool, args) {
      let response: Response
      try {
        // Relative, so it lands under the page's own /<secret>/.
        response = await deps.fetch('mcp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: nextId++,
            method: 'tools/call',
            params: { name: tool, arguments: args }
          })
        })
      } catch (err) {
        throw new ToolCallError(toToolCallError(err).message, 'network')
      }
      if (!response.ok) throw new ToolCallError(`The server answered ${response.status}.`, `http_${response.status}`)

      let reply: RpcReply
      try {
        reply = (await response.json()) as RpcReply
      } catch {
        throw new ToolCallError('The server sent something that is not JSON.', 'bad_response')
      }
      if (reply.error) throw toToolCallError(reply.error)
      if (!reply.result) throw new ToolCallError('The server sent no result.', 'bad_response')
      return unwrapToolResult(reply.result)
    },

    async openLink(url) {
      deps.open(url)
    },

    async requestDisplayMode(mode) {
      return mode
    }
  }
}

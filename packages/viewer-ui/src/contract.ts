// Shared structural contract for any ResearchTransport. Both adapters — the
// Electron IPC transport and the web WebSocket transport — run this against a
// live instance to prove they satisfy the seam the viewer depends on.
//
// It is deliberately vitest-free (plain throws) so it can be imported from any
// test runner. Callers wrap it in their own `it(...)`. Event *delivery* is
// adapter-specific and tested separately; this checks the structural contract.
import type { ResearchTransport } from './transport'

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ResearchTransport contract: ${msg}`)
}

export async function assertTransportContract(transport: ResearchTransport): Promise<void> {
  // getProjectState resolves to the expected shape.
  const state = await transport.getProjectState()
  assert(typeof state === 'object' && state !== null, 'getProjectState must resolve to an object')
  assert('research' in state, 'state must have a research field')
  assert('gedcomx' in state, 'state must have a gedcomx field')
  assert(
    state.label === null || typeof state.label === 'string',
    'state.label must be string | null'
  )

  // subscribe returns an unsubscribe function that is safe to call.
  assert(typeof transport.subscribe === 'function', 'subscribe must be a function')
  const unsubscribe = transport.subscribe({
    onResearch: () => {},
    onGedcomx: () => {},
    onSidecar: () => {},
    onError: () => {}
  })
  assert(typeof unsubscribe === 'function', 'subscribe must return an unsubscribe function')
  unsubscribe() // must not throw

  // readSidecar resolves to null or a {raw, mtime} record.
  const sidecar = await transport.readSidecar('__contract_probe__')
  assert(
    sidecar === null || (typeof sidecar.raw === 'string' && typeof sidecar.mtime === 'number'),
    'readSidecar must resolve to null or { raw, mtime }'
  )

  // Required action methods are present.
  assert(typeof transport.openExternal === 'function', 'openExternal must be a function')
  assert(typeof transport.submitFeedback === 'function', 'submitFeedback must be a function')
}

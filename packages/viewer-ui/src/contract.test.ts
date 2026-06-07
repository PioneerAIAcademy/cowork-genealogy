import { describe, it } from 'vitest'
import { assertTransportContract } from './contract'
import type { ResearchTransport } from './transport'

// A minimal in-memory transport — proves the contract harness itself is sound.
// The Electron IPC adapter and the web WS adapter run the SAME assertion
// against their live instances (see apps/electron and apps/web tests).
function makeInMemoryTransport(): ResearchTransport {
  return {
    getProjectState: async () => ({ research: null, gedcomx: null, label: null }),
    subscribe: () => () => {},
    readSidecar: async () => null,
    openExternal: () => {},
    submitFeedback: async () => ({ ok: true }),
    getFeedbackContext: async () => ({ files: [], sessionLogSize: 0, hasSessionLog: false })
  }
}

describe('ResearchTransport contract', () => {
  it('an in-memory transport satisfies the structural contract', async () => {
    await assertTransportContract(makeInMemoryTransport())
  })
})

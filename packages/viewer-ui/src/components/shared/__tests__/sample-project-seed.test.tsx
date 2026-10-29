import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import SidecarResultCard from '../SidecarResultCard'
import { setOpenExternal, setOpenFamilySearch } from '../../../lib/external'
import type { RecordSearchResult } from '../../../lib/schema'

/**
 * The SHIPPED sample project renders (#2476).
 *
 * `apps/server/app/seed/sample_project/` is not a test fixture — `seed/__init__.py`
 * copies it with `rglob("*")` into the sandbox on the hosted "Open a sample
 * project" path (`sessions.py`), and `apps/electron/test/fixtures/sample-project/`
 * is its byte-identical desktop twin. Both are rendered by this component.
 *
 * Nothing checked them. `apps/server/tests/test_mock_agent_schema.py` reads only
 * the seed's `research.json`, and JSON is not typechecked — which is how both
 * copies came to carry a `treeMatches` shape the engine has never emitted
 * (`{personId, personName, treeId, ark}` against the real `{treePersonId, stars}`),
 * so every new user's first view of the product showed an empty bullet under a
 * duplicate `key={undefined}`.
 *
 * This renders the real file rather than a hand-written copy, because a
 * hand-written copy is exactly what hid the bug: the viewer's own fixture was
 * written to the invented shape and its tests passed.
 */

const REPO = path.resolve(__dirname, '../../../../../..')
const SEEDS = {
  server: 'apps/server/app/seed/sample_project/results/log_001.json',
  electron: 'apps/electron/test/fixtures/sample-project/results/log_001.json'
}

function seedResult(rel: string): RecordSearchResult {
  const raw = readFileSync(path.join(REPO, rel), 'utf8')
  return JSON.parse(raw).payload.results[0] as RecordSearchResult
}

describe('the shipped sample-project sidecar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setOpenExternal(() => {})
    setOpenFamilySearch(() => {})
  })

  for (const [name, rel] of Object.entries(SEEDS)) {
    describe(name, () => {
      it('renders a tree-match row with its PID, stars and a working link', () => {
        render(
          <SidecarResultCard
            result={seedResult(rel)}
            tool="record_search"
            defaultExpanded={true}
          />
        )
        expect(screen.getByText('Tree matches')).toBeInTheDocument()
        expect(screen.getByText('KW7C-X9P')).toBeInTheDocument()
        expect(screen.getByText('5/5')).toBeInTheDocument()
        // The link is the part that silently vanishes on a shape the policy
        // refuses, so assert it rather than just the text.
        expect(screen.getByRole('button', { name: /View KW7C-X9P/ })).toBeInTheDocument()
      })

      it('renders the footer FamilySearch link', () => {
        render(
          <SidecarResultCard
            result={seedResult(rel)}
            tool="record_search"
            defaultExpanded={true}
          />
        )
        expect(
          screen.getByRole('button', { name: /Open in FamilySearch/ })
        ).toBeInTheDocument()
      })
    })
  }

  it('keeps the two seed copies byte-identical', () => {
    // They are maintained by hand in two places; a fix applied to one only is
    // the failure mode this pins.
    const a = readFileSync(path.join(REPO, SEEDS.server), 'utf8')
    const b = readFileSync(path.join(REPO, SEEDS.electron), 'utf8')
    expect(b, 'the server seed and the electron fixture have diverged').toBe(a)
  })
})

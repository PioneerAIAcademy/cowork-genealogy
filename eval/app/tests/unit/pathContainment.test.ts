import { describe, it, expect } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { readFixture } from '../../lib/fs/fixtures'
import { readAnnotation, writeAnnotation } from '../../lib/fs/annotations'
import { readRunLogById, readSnapshotFiles } from '../../lib/fs/runlogs'
import { diffSnapshotVsDisk } from '../../lib/snapshot'
import { repoRoot } from '../../lib/paths'
import { deleteCandidate } from '../../lib/release'
import { writeTest, nextTestId } from '../../lib/fs/tests'
import { readScenario } from '../../lib/fs/scenarios'
import { listRunLogsForSkill } from '../../lib/fs/runlogs'

/**
 * One test per sink, not one test for the helper.
 *
 * `safePath.test.ts` proves `resolveWithin` is correct. It cannot prove that any
 * given sink CALLS it — remove the call from one function and every helper test
 * still passes. These drive each exported entry point with a traversing value,
 * so deleting a single containment call reds a named test that says which sink
 * lost its guard.
 *
 * The traversal target is a real file created in a temp dir outside the repo, so
 * a passing test means "the sink refused to reach it", not "the path happened
 * not to exist".
 */

const UP = '../'.repeat(12)

async function withOutsideFile(
  run: (relFromRepo: string, absPath: string) => Promise<void>,
): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'containment-'))
  const abs = path.join(dir, 'secret.json')
  await fs.writeFile(abs, JSON.stringify({ secret: 'must-not-be-read' }), 'utf8')
  try {
    await run(UP + abs.replace(/^\//, ''), abs)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
}

describe('path containment at each sink', () => {
  it('readFixture does not read outside the fixtures directory', async () => {
    await withOutsideFile(async (rel) => {
      // Returns null on a refused path, matching its existing not-found contract
      // — the caller cannot tell "absent" from "refused", which is the correct
      // amount to tell an unauthenticated requester.
      expect(await readFixture(rel.replace(/\.json$/, ''))).toBeNull()
    })
  })

  it('readRunLogById does not read outside the runlogs directory', async () => {
    await withOutsideFile(async (rel) => {
      expect(await readRunLogById(rel.replace(/\.json$/, ''))).toBeNull()
    })
  })

  it('readSnapshotFiles skips a key pointing outside the repo', async () => {
    await withOutsideFile(async (rel) => {
      // Snapshot keys arrive from a run log another contributor committed, and
      // this one returns file CONTENT. A skipped key must be absent from the
      // result rather than present with the file's bytes.
      const out = await readSnapshotFiles({ [rel]: 'whatever' })
      expect(out[rel]).toBeUndefined()
    })
  })

  it('readAnnotation does not read outside the runlogs directory', async () => {
    await withOutsideFile(async (rel) => {
      expect(await readAnnotation(rel.replace(/\.ann\.json$/, ''))).toBeNull()
    })
  })

  it('writeAnnotation refuses to write outside the runlogs directory', async () => {
    await expect(
      writeAnnotation(`${UP}tmp/containment-escape`, {
        run_log: 'x',
        annotator: 'x',
        corrections: [],
      } as never),
    ).rejects.toThrow()
  })

  it('deleteCandidate refuses to remove a file outside the runlogs directory', async () => {
    // The one that leaves nothing to diagnose from if it gets through.
    await expect(deleteCandidate(`${UP}tmp/containment-escape/x`)).rejects.toThrow()
  })

  it('writeTest refuses a traversing skill or id', async () => {
    const base = {
      test: { name: 'n', type: 'positive', description: 'd', tags: [] },
      input: { user_message: 'm', scenario: null },
      judge_context: [],
    }
    await expect(
      writeTest({ ...base, test: { ...base.test, skill: `${UP}tmp`, id: 'ut_x_001' } } as never),
    ).rejects.toThrow()
    await expect(
      writeTest({
        ...base,
        test: { ...base.test, skill: 'citation', id: `${UP}tmp/ut_x_001` },
      } as never),
    ).rejects.toThrow()
  })

  // --- sinks missed by the first pass of this PR (review, 2026-08-28) ---------
  //
  // The body claimed "every filesystem path sink". Four did not route through
  // the helper. Each gets its own test for the same reason as the others: a
  // helper test cannot show that a given function calls it.

  it('readScenario does not read outside the scenarios directory', async () => {
    // The most severe of the four: it reads README.md, research.json and
    // tree.gedcomx.json out of the resolved directory — the exact filenames a
    // real genealogy project uses elsewhere on the same machine.
    await withOutsideFile(async (rel) => {
      expect(await readScenario(path.dirname(rel))).toBeNull()
    })
  })

  it('listRunLogsForSkill does not list outside the runlogs directory', async () => {
    // `skill` arrives from the `?skill=` query param and drives readdir +
    // readFile + JSON.parse.
    //
    // The traversed directory must CONTAIN something listable, or this test
    // cannot fail: an empty directory yields an empty result with or without the
    // guard. My first version did exactly that and stayed green under mutation.
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'containment-runlogs-'))
    await fs.writeFile(
      path.join(dir, 'v1_2026-01-01_00-00-00.json'),
      JSON.stringify({ skill: 'x', tests: [], snapshot: {} }),
      'utf8',
    )
    try {
      const rel = UP + dir.replace(/^\//, '')
      const out = await listRunLogsForSkill(rel)
      // Without containment this readdir reaches the temp dir and the file above
      // is parsed into `runs` or `corrupt`; with it, neither.
      expect([...out.runs, ...out.corrupt]).toEqual([])
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('nextTestId refuses a traversing skill name', async () => {
    // Runs a readdir BEFORE the guarded write. Throws rather than returning a
    // fallback: this is the id-allocation step of a write, and a refused write
    // is loud.
    await withOutsideFile(async (rel) => {
      await expect(nextTestId(path.dirname(rel))).rejects.toThrow()
    })
  })

  it('diffSnapshotVsDisk skips a key pointing outside the repo', async () => {
    // The other guard the review-fix commit added without a test. The assertion
    // discriminates: uncontained, the outside file IS read, its content is
    // hashed, and it mismatches the bogus digest below — giving
    // `content-differs` rather than `missing-on-disk`.
    await withOutsideFile(async (rel) => {
      const out = await diffSnapshotVsDisk({ [rel]: 'deadbeef' }, repoRoot())
      expect(out[rel]).toBe('missing-on-disk')
    })
  })
})

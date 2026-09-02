import { describe, it, expect } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { readFixture } from '../../lib/fs/fixtures'
import { readAnnotation, writeAnnotation } from '../../lib/fs/annotations'
import { readRunLogById, readSnapshotFiles } from '../../lib/fs/runlogs'
import { diffSnapshotVsDisk } from '../../lib/snapshot'
import { repoRoot } from '../../lib/paths'
import { deleteCandidate, releaseRunLog } from '../../lib/release'
import { writeTest, nextTestId } from '../../lib/fs/tests'
import { readScenario } from '../../lib/fs/scenarios'
import { makeFixtureTree, buildRunLog } from '../helpers/fixtureTree'
import { listRunLogsForSkill } from '../../lib/fs/runlogs'
import { readSkill } from '../../lib/skills'

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

  it('releaseRunLog refuses to rename outside the runlogs/unit directory', async () => {
    // `skill` is a catch-all URL segment, and `classify()` only vets the
    // FILENAME. `..` with a valid candidate filename classifies cleanly, so
    // containment is the only thing between this call and an fs.rename outside
    // runlogs/unit. The PR body claimed this sink had a test; it did not —
    // stripping its guards left all 191 green.
    const handle = await makeFixtureTree({ runlogs: [] })
    process.env.EVAL_DIR = handle.root
    const outside = path.join(handle.root, 'runlogs')
    await fs.mkdir(outside, { recursive: true })
    const fname = 'v9_2026-05-18_10-30-00.json'
    await fs.writeFile(
      path.join(outside, fname),
      JSON.stringify(buildRunLog({ skill: 'x', version: 9, timestamp: '2026-05-18_10-30-00' })),
      'utf8',
    )
    await fs.writeFile(
      path.join(outside, 'v9_2026-05-18_10-30-00.ann.json'),
      JSON.stringify({ run_log: fname, annotator: 'a', corrections: [] }),
      'utf8',
    )
    try {
      await expect(releaseRunLog('../v9_2026-05-18_10-30-00')).rejects.toThrow()
      // The file is still where it was: the rename never happened.
      await expect(fs.access(path.join(outside, fname))).resolves.toBeUndefined()
    } finally {
      delete process.env.EVAL_DIR
      await handle.cleanup()
    }
  })

  it('readAnnotation does not read outside the runlogs directory', async () => {
    // The traversal must land on a REAL `.ann.json`. `withOutsideFile` creates
    // `secret.json`, which `/\.ann\.json$/` does not match, so the id kept its
    // `.json` and `annPathForRunLog` appended another suffix — the sink opened
    // `secret.json.ann.json`, a file that never existed. ENOENT, null, green
    // with or without the guard.
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'containment-ann-'))
    const abs = path.join(dir, 'secret.ann.json')
    await fs.writeFile(
      abs,
      JSON.stringify({ run_log: 'v1.json', annotator: 'outsider', corrections: [] }),
      'utf8',
    )
    try {
      const rel = UP + abs.replace(/^\//, '').replace(/\.ann\.json$/, '')
      expect(await readAnnotation(rel)).toBeNull()
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
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

  it('readSkill does not read a SKILL.md outside the plugin skills directory', async () => {
    // The only sink in lib/skills.ts that takes caller input. Uncontained,
    // `path.join` normalises the traversal away and the frontmatter of a
    // SKILL.md outside the base is returned to the caller as a real skill.
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'containment-skill-'))
    await fs.mkdir(path.join(outside, 'outside'), { recursive: true })
    await fs.writeFile(
      path.join(outside, 'outside', 'SKILL.md'),
      '---\nname: outside\ndescription: LEAKED FROM OUTSIDE THE BASE\n---\nbody\n',
      'utf8',
    )
    const handle = await makeFixtureTree({ skills: [{ name: 'citation' }] })
    process.env.EVAL_DIR = handle.root
    try {
      const name = UP + path.join(outside, 'outside').replace(/^\//, '')
      await expect(readSkill(name)).rejects.toThrow()
    } finally {
      delete process.env.EVAL_DIR
      await handle.cleanup()
      await fs.rm(outside, { recursive: true, force: true })
    }
  })

  it('deleteCandidate refuses a traversing SKILL on its own guard', async () => {
    // Isolates release.ts:113. Neither sibling above reaches it: both put the
    // traversal somewhere the FILENAME guard on the next line catches first, so
    // 113 is never the deciding check and its removal changes nothing the suite
    // can see. The shape that isolates it is a single-segment skill of `..` with
    // a filename that still classifies as a candidate — then 113 is the only
    // thing between this call and an fs.rm one level above runlogs/unit.
    //
    // 114 cannot cover it: resolveWithin(dir, filename) proves the filename
    // stayed inside whatever `dir` already is, and confirms containment inside
    // an escaped dir just as happily.
    const handle = await makeFixtureTree({ runlogs: [] })
    process.env.EVAL_DIR = handle.root
    const victim = path.join(handle.root, 'runlogs', 'v9_2026-05-18_10-30-00.json')
    await fs.mkdir(path.dirname(victim), { recursive: true })
    await fs.writeFile(victim, '{"keep":true}', 'utf8')
    try {
      await expect(deleteCandidate('../v9_2026-05-18_10-30-00')).rejects.toThrow()
      await expect(fs.access(victim)).resolves.toBeUndefined()
    } finally {
      delete process.env.EVAL_DIR
      await handle.cleanup()
    }
  })

  it('deleteCandidate refuses a traversing FILENAME, not just a traversing skill', async () => {
    // The test above puts the traversal in `skill`, which the first guard
    // catches. `classify()` returns kind 'other' for a traversing filename and
    // deleteCandidate only rejects 'released', so the filename guard is the only
    // thing between this call and an fs.rm outside the base — and nothing
    // exercised it.
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'containment-del-'))
    const victim = path.join(outside, 'victim.json')
    await fs.writeFile(victim, '{"keep":true}', 'utf8')
    const handle = await makeFixtureTree({ runlogs: [] })
    process.env.EVAL_DIR = handle.root
    try {
      const id = 'citation/' + UP + path.join(outside, 'victim').replace(/^\//, '')
      await expect(deleteCandidate(id)).rejects.toThrow()
      await expect(fs.access(victim)).resolves.toBeUndefined()
    } finally {
      delete process.env.EVAL_DIR
      await handle.cleanup()
      await fs.rm(outside, { recursive: true, force: true })
    }
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

  it('writeTest refuses a traversing skill when EDITING an existing test', async () => {
    // The else-branch. `readTest` finds the id, so the guards that run are the
    // two on the edit path, not the one on the create path — and the test above
    // only ever reaches the create path. Uncontained, this writes the file
    // outside the base AND unlinks the original inside it.
    const existing = {
      test: { id: 'ut_citation_001', skill: 'citation', name: 'n', type: 'positive', description: 'd', tags: [] },
      input: { user_message: 'm', scenario: null },
      mcp_fixtures: [],
      judge_context: [],
    }
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'containment-edit-'))
    const handle = await makeFixtureTree({
      tests: [{ skill: 'citation', filename: 'orig.json', body: existing }],
    })
    process.env.EVAL_DIR = handle.root
    const origPath = path.join(handle.root, 'tests', 'unit', 'citation', 'orig.json')
    try {
      await expect(
        writeTest({
          ...existing,
          test: { ...existing.test, skill: UP + outside.replace(/^\//, '') },
        } as never),
      ).rejects.toThrow()
      expect(await fs.readdir(outside)).toEqual([])
      await expect(fs.access(origPath)).resolves.toBeUndefined()
    } finally {
      delete process.env.EVAL_DIR
      await handle.cleanup()
      await fs.rm(outside, { recursive: true, force: true })
    }
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

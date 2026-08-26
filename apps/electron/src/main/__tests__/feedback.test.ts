import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, isAbsolute } from 'node:path'
import JSZip from 'jszip'
import type { GedcomxCoupleRelationship, GedcomxData, GedcomxPerson } from '@genealogy/schema'
import {
  buildFeedbackZip,
  capSessionLog,
  FEEDBACK_SCHEMA_VERSION,
  MAX_FIELD_CHARS,
  NOT_PROVIDED,
  type FeedbackOptions
} from '../feedback'

async function readFeedbackJson(zipBase64: string): Promise<Record<string, unknown>> {
  const zip = await JSZip.loadAsync(Buffer.from(zipBase64, 'base64'))
  const file = zip.file('_feedback/feedback.json')
  if (!file) throw new Error('feedback.json missing from zip')
  return JSON.parse(await file.async('string'))
}

function makeOptions(
  folder: string,
  overrides: Partial<FeedbackOptions['report']> = {}
): FeedbackOptions {
  return {
    folderPath: folder,
    includeMedia: false,
    includeSessionLog: false,
    viewerVersion: '0.4.2-dev',
    report: {
      email: 'User@Example.com',
      userPrompt: 'Find a marriage record for John Smith.',
      agentDid: 'It searched 1860 census and stopped.',
      workedAsExpected: false,
      agentShouldHave: 'It should have tried 1870 and 1880.',
      notes: undefined,
      ...overrides
    }
  }
}

describe('buildFeedbackZip — feedback.json', () => {
  let folder: string

  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'feedback-test-'))
    await writeFile(join(folder, 'research.json'), '{}', 'utf8')
  })

  afterEach(async () => {
    await rm(folder, { recursive: true, force: true })
  })

  it('writes _feedback/feedback.json to the zip with parseable JSON', async () => {
    const result = await buildFeedbackZip(makeOptions(folder))
    const payload = await readFeedbackJson(result.zipBase64)
    expect(payload.schema_version).toBe(FEEDBACK_SCHEMA_VERSION)
  })

  it('includes every required field, even when notes is empty', async () => {
    const result = await buildFeedbackZip(makeOptions(folder, { notes: undefined }))
    const payload = await readFeedbackJson(result.zipBase64)
    for (const key of [
      'schema_version',
      'submitted_at',
      'viewer_version',
      'platform',
      'email',
      'project_folder_path',
      'user_prompt',
      'agent_did',
      'worked_as_expected',
      'agent_should_have',
      'notes'
    ]) {
      expect(payload, `missing field: ${key}`).toHaveProperty(key)
    }
    expect(payload.notes).toBe('')
  })

  it('stores worked_as_expected as the boolean from the report', async () => {
    const positive = await readFeedbackJson(
      (await buildFeedbackZip(makeOptions(folder, { workedAsExpected: true, agentShouldHave: '' })))
        .zipBase64
    )
    expect(positive.worked_as_expected).toBe(true)

    const negative = await readFeedbackJson(
      (await buildFeedbackZip(makeOptions(folder, { workedAsExpected: false }))).zipBase64
    )
    expect(negative.worked_as_expected).toBe(false)
  })

  it('round-trips text fields verbatim and lowercases/trims email', async () => {
    const userPrompt = 'Line one.\n\nLine two with  spaces.'
    const result = await buildFeedbackZip(
      makeOptions(folder, {
        email: '  Mixed.Case@Example.COM  ',
        userPrompt,
        agentDid: 'did',
        agentShouldHave: 'should',
        notes: '  trim me  '
      })
    )
    const payload = await readFeedbackJson(result.zipBase64)
    expect(payload.email).toBe('mixed.case@example.com')
    expect(payload.user_prompt).toBe(userPrompt)
    expect(payload.notes).toBe('trim me')
  })

  it('sets platform from process.platform and viewer_version verbatim', async () => {
    const result = await buildFeedbackZip(makeOptions(folder))
    const payload = await readFeedbackJson(result.zipBase64)
    expect(payload.platform).toBe(process.platform)
    expect(payload.viewer_version).toBe('0.4.2-dev')
  })

  it('uses an absolute project_folder_path', async () => {
    const result = await buildFeedbackZip(makeOptions(folder))
    const payload = await readFeedbackJson(result.zipBase64)
    expect(typeof payload.project_folder_path).toBe('string')
    expect(isAbsolute(payload.project_folder_path as string)).toBe(true)
  })

  it('emits submitted_at as an ISO 8601 UTC string with Z suffix', async () => {
    const result = await buildFeedbackZip(makeOptions(folder))
    const payload = await readFeedbackJson(result.zipBase64)
    expect(payload.submitted_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  })

  it('throws when a text field exceeds MAX_FIELD_CHARS rather than truncating', async () => {
    const huge = 'x'.repeat(MAX_FIELD_CHARS + 1)
    await expect(buildFeedbackZip(makeOptions(folder, { agentDid: huge }))).rejects.toThrow(
      /agent_?did|exceed/i
    )
  })

  it('still ships FEEDBACK.md alongside feedback.json', async () => {
    const result = await buildFeedbackZip(makeOptions(folder))
    const zip = await JSZip.loadAsync(Buffer.from(result.zipBase64, 'base64'))
    expect(zip.file('FEEDBACK.md')).not.toBeNull()
    expect(zip.file('_feedback/feedback.json')).not.toBeNull()
  })
})

describe('buildFeedbackZip — size budgets follow the server convention', () => {
  let folder: string

  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'feedback-size-'))
    await writeFile(join(folder, 'research.json'), '{}', 'utf8')
  })

  afterEach(async () => {
    await rm(folder, { recursive: true, force: true })
  })

  // Incompressible payload: DEFLATE would otherwise shrink repetitive filler
  // far below the cap and the budget logic would never engage.
  function noise(bytes: number): Buffer {
    const buf = Buffer.allocUnsafe(bytes)
    let x = 123456789
    for (let i = 0; i < bytes; i++) {
      x = (x * 1103515245 + 12345) & 0x7fffffff
      buf[i] = x & 0xff
    }
    return buf
  }

  it('drops the largest files instead of throwing when over the archive budget', async () => {
    // 3 x 15 MB = 45 MB against a 35 MB budget: the biggest must go, and the
    // send must still succeed. Previously this threw and produced nothing.
    await writeFile(join(folder, 'big-a.bin'), noise(15 * 1024 * 1024))
    await writeFile(join(folder, 'big-b.bin'), noise(15 * 1024 * 1024))
    await writeFile(join(folder, 'big-c.bin'), noise(15 * 1024 * 1024))

    const result = await buildFeedbackZip({ ...makeOptions(folder), includeMedia: true })

    const zip = await JSZip.loadAsync(Buffer.from(result.zipBase64, 'base64'))
    const kept = Object.keys(zip.files).filter((n) => n.endsWith('.bin'))
    expect(kept.length).toBe(2)

    const markdown = await zip.file('FEEDBACK.md')!.async('string')
    expect(markdown).toContain('archive size limit')

    // research.json — the file that actually matters — always survives.
    expect(zip.file('research.json')).not.toBeNull()
    // Measured, not guessed: this test genuinely zips 45 MB of incompressible
    // bytes. ~2.4s alone, ~8.4s under `make test-all` (turbo runs every
    // workspace suite at once), against vitest's 5s default — so it failed on a
    // clean tree for anyone running the full gate while passing in isolation.
    // The 45 MB is load-bearing (3 x 15 MB against the 35 MB budget), so the
    // budget to raise is the clock's. DEFLATE dominates the cost, not the
    // fixture: generating the noise is only ~340ms of it. The per-test
    // 30_000 that used to sit here is redundant now that this package's
    // vitest.config.ts raises testTimeout for the whole suite.
  })

  it('keeps a bundle that fits entirely intact', async () => {
    await writeFile(join(folder, 'small.bin'), noise(1024))
    const result = await buildFeedbackZip({ ...makeOptions(folder), includeMedia: true })
    const zip = await JSZip.loadAsync(Buffer.from(result.zipBase64, 'base64'))
    expect(zip.file('small.bin')).not.toBeNull()
    expect(zip.file('research.json')).not.toBeNull()
  })
})

describe('capSessionLog', () => {
  it('passes a small log through unchanged', () => {
    const out = capSessionLog([{ a: 1 }, { b: 2 }])
    expect(out).toBe('{"a":1}\n{"b":2}\n')
  })

  it('keeps the NEWEST entries and prepends a truncation note when over cap', () => {
    // ~600 KB per entry x 64 = ~38 MB against the 20 MB session-log budget.
    const entries = Array.from({ length: 64 }, (_, i) => ({ i, pad: 'x'.repeat(600_000) }))
    const lines = capSessionLog(entries).trimEnd().split('\n')

    const note = JSON.parse(lines[0])
    expect(note.type).toBe('_truncation_note')
    expect(note.dropped_leading_entries).toBeGreaterThan(0)

    // The tail is what matters — the end of a session is where it went wrong.
    const last = JSON.parse(lines[lines.length - 1])
    expect(last.i).toBe(63)
    expect(note.dropped_leading_entries + (lines.length - 1)).toBe(64)
  })
})

describe('buildFeedbackZip — living-person redaction', () => {
  let folder: string

  const TREE = {
    persons: [
      {
        id: 'P1',
        gender: 'Male',
        living: false,
        names: [{ id: 'n1', given: 'Reuben Spencer', surname: 'Spriggs' }],
        facts: [{ id: 'f1', type: 'Birth', date: '6 November 1898', place: 'Maddock, ND' }]
      },
      {
        id: 'P2',
        gender: 'Female',
        living: true,
        ark: 'https://familysearch.org/ark:/61903/4:1:SECRET',
        names: [{ id: 'n2', given: 'Jane Marie', surname: 'Spriggs' }],
        facts: [{ id: 'f2', type: 'Birth', date: '3 March 1985', place: 'Riverside, CA' }]
      },
      // No `living` flag at all — absent is NOT deceased.
      {
        id: 'P3',
        gender: 'Male',
        names: [{ id: 'n3', given: 'Bobby', surname: 'Spriggs' }],
        facts: [{ id: 'f3', type: 'Birth', date: '1990' }]
      }
    ],
    relationships: [
      {
        id: 'r1',
        type: 'Couple',
        person1: 'P1',
        person2: 'P2',
        facts: [{ id: 'rf1', type: 'Marriage', date: '12 June 1980', place: 'Reno, NV' }]
      },
      {
        id: 'r2',
        type: 'Couple',
        person1: 'P1',
        person2: 'P9',
        facts: [{ id: 'rf2', type: 'Marriage', date: '1 Jan 1925' }]
      }
    ],
    sources: []
  }

  async function readTree(zipBase64: string): Promise<GedcomxData> {
    const zip = await JSZip.loadAsync(Buffer.from(zipBase64, 'base64'))
    const file = zip.file('tree.gedcomx.json')
    if (!file) throw new Error('tree.gedcomx.json missing from zip')
    return JSON.parse(await file.async('string'))
  }

  // These narrow rather than assert-non-null, so a person or relationship that
  // the redaction dropped entirely fails as "P2 missing from the bundled tree"
  // instead of a TypeError on `.names` several lines later. `facts` lives only
  // on the Couple arm of GedcomxRelationship, so the type check is real and not
  // ceremony.
  function person(tree: GedcomxData, id: string): GedcomxPerson {
    const found = tree.persons.find((p) => p.id === id)
    if (!found) throw new Error(`person ${id} missing from the bundled tree`)
    return found
  }

  function couple(tree: GedcomxData, id: string): GedcomxCoupleRelationship {
    const found = (tree.relationships ?? []).find((r) => r.id === id)
    if (!found) throw new Error(`relationship ${id} missing from the bundled tree`)
    if (found.type !== 'Couple') throw new Error(`relationship ${id} is ${found.type}, not Couple`)
    return found
  }

  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'feedback-living-'))
    await writeFile(join(folder, 'research.json'), '{}', 'utf8')
    await writeFile(join(folder, 'tree.gedcomx.json'), JSON.stringify(TREE), 'utf8')
  })

  afterEach(async () => {
    await rm(folder, { recursive: true, force: true })
  })

  it('leaves a person explicitly marked deceased untouched', async () => {
    const tree = await readTree((await buildFeedbackZip(makeOptions(folder))).zipBase64)
    const p1 = person(tree, 'P1')
    expect(p1.names[0].given).toBe('Reuben Spencer')
    expect(p1.facts).toHaveLength(1)
  })

  it('redacts a living person: no given name, facts, or ark; id and surname kept', async () => {
    const tree = await readTree((await buildFeedbackZip(makeOptions(folder))).zipBase64)
    const p2 = person(tree, 'P2')
    expect(p2.names[0].given).toBe('Living')
    expect(p2.names[0].surname).toBe('Spriggs')
    expect(p2.facts).toEqual([])
    expect(p2.ark).toBeUndefined()
    expect(p2.gender).toBe('Female')
    expect(p2.living).toBe(true)
  })

  it('treats a MISSING living flag as living — absent is not deceased', async () => {
    const tree = await readTree((await buildFeedbackZip(makeOptions(folder))).zipBase64)
    const p3 = person(tree, 'P3')
    expect(p3.names[0].given).toBe('Living')
    expect(p3.facts).toEqual([])
  })

  it('never leaks a redacted name or date anywhere in the bundled tree', async () => {
    const zip = await JSZip.loadAsync(
      Buffer.from((await buildFeedbackZip(makeOptions(folder))).zipBase64, 'base64')
    )
    const raw = await zip.file('tree.gedcomx.json')!.async('string')
    for (const leak of ['Jane Marie', 'Bobby', '3 March 1985', 'Riverside, CA', 'SECRET']) {
      expect(raw).not.toContain(leak)
    }
    expect(raw).toContain('Reuben Spencer') // the deceased subject survives
  })

  it('clears Couple facts touching a living person, keeps the rest', async () => {
    const tree = await readTree((await buildFeedbackZip(makeOptions(folder))).zipBase64)
    expect(couple(tree, 'r1').facts).toEqual([])
    expect(couple(tree, 'r2').facts).toHaveLength(1)
  })

  it('records the redaction in FEEDBACK.md so a triager reads it as intentional', async () => {
    const zip = await JSZip.loadAsync(
      Buffer.from((await buildFeedbackZip(makeOptions(folder))).zipBase64, 'base64')
    )
    const md = await zip.file('FEEDBACK.md')!.async('string')
    expect(md).toContain('Living people redacted')
    expect(md).toContain('2 person(s)')
  })

  it('passes an unparseable tree through rather than failing the send', async () => {
    await writeFile(join(folder, 'tree.gedcomx.json'), 'not json', 'utf8')
    const zip = await JSZip.loadAsync(
      Buffer.from((await buildFeedbackZip(makeOptions(folder))).zipBase64, 'base64')
    )
    expect(await zip.file('tree.gedcomx.json')!.async('string')).toBe('not json')
    expect(await zip.file('FEEDBACK.md')!.async('string')).not.toContain('Living people redacted')
  })
})

// The "## Session log" section must always render and say why the transcript
// is or isn't there — so a Cowork bundle's missing log reads as expected, not
// missing (issue #1481).
describe('buildFeedbackZip — FEEDBACK.md on a blank prompt or did', () => {
  let folder: string

  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'feedback-test-'))
    await writeFile(join(folder, 'research.json'), '{}', 'utf8')
  })

  afterEach(async () => {
    await rm(folder, { recursive: true, force: true })
  })

  async function markdownFor(overrides: Partial<FeedbackOptions['report']>): Promise<string> {
    const result = await buildFeedbackZip(makeOptions(folder, overrides))
    const zip = await JSZip.loadAsync(Buffer.from(result.zipBase64, 'base64'))
    return zip.file('FEEDBACK.md')!.async('string')
  }

  // Both are optional at the dialog (#1919). A heading with nothing under it
  // reads like the bundler dropped the field; say it was left blank instead.
  // The literal must match NOT_PROVIDED in apps/server/app/feedback.py, so a
  // triager reading either producer's bundle sees the same thing.
  it('says the field was left blank rather than printing an empty section', async () => {
    const md = await markdownFor({ userPrompt: '', agentDid: '   ' })
    expect(md).toContain(`## What I asked\n\n${NOT_PROVIDED}`)
    expect(md).toContain(`## What the agent did\n\n${NOT_PROVIDED}`)
  })

  // Asserted as a LITERAL, not via the imported constant: the point of the
  // comment above is cross-producer agreement, and a test that reads the same
  // constant it is checking moves with it and can never catch the drift.
  it('spells the placeholder exactly as apps/server/app/feedback.py does', () => {
    expect(NOT_PROVIDED).toBe('_(not provided)_')
  })

  it('says so for a blank email too, not just the two text sections', async () => {
    const md = await markdownFor({ email: '' })
    expect(md).toContain(`- **From:** ${NOT_PROVIDED}`)
    expect(md).not.toContain('- **From:** \n')
  })

  it('leaves a supplied prompt and did untouched', async () => {
    const md = await markdownFor({ userPrompt: 'Find John Smith.', agentDid: 'It stopped.' })
    expect(md).not.toContain(NOT_PROVIDED)
    expect(md).toContain('## What I asked\n\nFind John Smith.')
    expect(md).toContain('## What the agent did\n\nIt stopped.')
  })
})

describe('buildFeedbackZip — FEEDBACK.md always states the session-log status', () => {
  let folder: string

  beforeEach(async () => {
    // Underscore on purpose. Claude Code replaces EVERY non-alphanumeric char
    // with '-', not just path separators, so an all-alphanumeric temp name is
    // derived identically by the old (separators-only) and new rules — with
    // 'feedback-slog-' this suite passed against the broken derivation too.
    folder = await mkdtemp(join(tmpdir(), 'feedback_slog-'))
    await writeFile(join(folder, 'research.json'), '{}', 'utf8')
  })

  afterEach(async () => {
    await rm(folder, { recursive: true, force: true })
  })

  async function feedbackMarkdown(options: FeedbackOptions): Promise<string> {
    const zip = await JSZip.loadAsync(
      Buffer.from((await buildFeedbackZip(options)).zipBase64, 'base64')
    )
    return zip.file('FEEDBACK.md')!.async('string')
  }

  it('says the submitter opted out when the log was not requested', async () => {
    const md = await feedbackMarkdown(makeOptions(folder)) // includeSessionLog: false by default
    expect(md).toContain('## Session log')
    expect(md).toContain('No Claude Code session log was included')
    expect(md).toContain('unticked')
    expect(md).not.toContain('See `_feedback/session-log.jsonl`')
  })

  it('flags a requested-but-missing log as expected for Cowork rather than dropping the section', async () => {
    // The tmp folder has no matching ~/.claude/projects/<hash> dir, so
    // readSessionLog finds nothing even though a log was requested — the state a
    // real Cowork bundle lands in, so the Cowork explanation belongs here.
    const md = await feedbackMarkdown({ ...makeOptions(folder), includeSessionLog: true })
    expect(md).toContain('## Session log')
    expect(md).toContain('requested but none was found')
    // Assert on the parts that actually moved into this branch — the results/
    // pointer and the doc link — not just 'Cowork', which the pre-swap wording
    // also contained and so would not catch a regression (chesworthrm review).
    expect(md).toContain('results/')
    expect(md).toContain('docs/alpha-user-guide-cowork.md')
    expect(md).not.toContain('See `_feedback/session-log.jsonl`')
  })

  it('points at the transcript when a Claude Code log is present', async () => {
    // readSessionLog reads os.homedir()/.claude/projects/-<folder-with-dashes>/.
    // Redirect HOME/USERPROFILE at a planted home so the lookup resolves.
    const homeSaved = process.env.HOME
    const profileSaved = process.env.USERPROFILE
    const fakeHome = await mkdtemp(join(tmpdir(), 'feedback-home-'))
    try {
      const projectHash = folder.replace(/[^a-zA-Z0-9-]/g, '-')
      const projectDir = join(fakeHome, '.claude', 'projects', projectHash)
      await mkdir(projectDir, { recursive: true })
      await writeFile(
        join(projectDir, 'session.jsonl'),
        '{"type":"user","message":{"role":"user","content":"hi"}}\n' +
          '{"type":"assistant","message":{"role":"assistant","content":"searched census"}}\n',
        'utf8'
      )
      process.env.HOME = fakeHome
      process.env.USERPROFILE = fakeHome

      const opts = { ...makeOptions(folder), includeSessionLog: true }
      const zip = await JSZip.loadAsync(
        Buffer.from((await buildFeedbackZip(opts)).zipBase64, 'base64')
      )
      const md = await zip.file('FEEDBACK.md')!.async('string')
      expect(md).toContain('## Session log')
      expect(md).toContain('See `_feedback/session-log.jsonl`')
      expect(zip.file('_feedback/session-log.jsonl')).not.toBeNull()
    } finally {
      if (homeSaved === undefined) delete process.env.HOME
      else process.env.HOME = homeSaved
      if (profileSaved === undefined) delete process.env.USERPROFILE
      else process.env.USERPROFILE = profileSaved
      await rm(fakeHome, { recursive: true, force: true })
    }
  })
})

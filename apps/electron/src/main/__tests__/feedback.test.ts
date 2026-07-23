import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import {
  buildFeedbackZip,
  capSessionLog,
  FEEDBACK_SCHEMA_VERSION,
  MAX_FIELD_CHARS,
  type FeedbackOptions
} from '../feedback'

async function readFeedbackJson(zipBase64: string): Promise<Record<string, unknown>> {
  const zip = await JSZip.loadAsync(Buffer.from(zipBase64, 'base64'))
  const file = zip.file('_feedback/feedback.json')
  if (!file) throw new Error('feedback.json missing from zip')
  return JSON.parse(await file.async('string'))
}

function makeOptions(folder: string, overrides: Partial<FeedbackOptions['report']> = {}): FeedbackOptions {
  return {
    folderPath: folder,
    includeMedia: false,
    includeSessionLog: false,
    viewerVersion: '0.4.2-dev',
    report: {
      email: 'User@Example.com',
      userPrompt: 'Find a marriage record for John Smith.',
      agentDid: 'It searched 1860 census and stopped.',
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
      'agent_should_have',
      'notes'
    ]) {
      expect(payload, `missing field: ${key}`).toHaveProperty(key)
    }
    expect(payload.notes).toBe('')
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
    expect((payload.project_folder_path as string).startsWith('/')).toBe(true)
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

  async function readTree(zipBase64: string): Promise<Record<string, any>> {
    const zip = await JSZip.loadAsync(Buffer.from(zipBase64, 'base64'))
    const file = zip.file('tree.gedcomx.json')
    if (!file) throw new Error('tree.gedcomx.json missing from zip')
    return JSON.parse(await file.async('string'))
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
    const p1 = tree.persons.find((p: any) => p.id === 'P1')
    expect(p1.names[0].given).toBe('Reuben Spencer')
    expect(p1.facts).toHaveLength(1)
  })

  it('redacts a living person: no given name, facts, or ark; id and surname kept', async () => {
    const tree = await readTree((await buildFeedbackZip(makeOptions(folder))).zipBase64)
    const p2 = tree.persons.find((p: any) => p.id === 'P2')
    expect(p2.names[0].given).toBe('Living')
    expect(p2.names[0].surname).toBe('Spriggs')
    expect(p2.facts).toEqual([])
    expect(p2.ark).toBeUndefined()
    expect(p2.gender).toBe('Female')
    expect(p2.living).toBe(true)
  })

  it('treats a MISSING living flag as living — absent is not deceased', async () => {
    const tree = await readTree((await buildFeedbackZip(makeOptions(folder))).zipBase64)
    const p3 = tree.persons.find((p: any) => p.id === 'P3')
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
    expect(tree.relationships.find((r: any) => r.id === 'r1').facts).toEqual([])
    expect(tree.relationships.find((r: any) => r.id === 'r2').facts).toHaveLength(1)
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

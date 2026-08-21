import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import JSZip from 'jszip'

const MEDIA_EXTS = new Set([
  '.mp3',
  '.wav',
  '.m4a',
  '.ogg',
  '.jpg',
  '.jpeg',
  '.png',
  '.heic',
  '.webp'
])

const TEXT_EXTS = new Set(['.json', '.md', '.txt', '.csv', '.tsv', '.yaml', '.yml'])

const INDIVIDUAL_FILE_CAP_BYTES = 25 * 1024 * 1024
// Project-file budget. Mirrors apps/server/app/feedback.py `_ZIP_CAP_BYTES`:
// when the selection exceeds it we drop the largest files until it fits rather
// than failing the send. Applied to uncompressed bytes, as the server does.
const ZIP_CAP_BYTES = 35 * 1024 * 1024
// Session-log budget, separate from the file budget (again matching the
// server's `_SESSION_LOG_CAP_BYTES`): over cap we keep the newest entries and
// prepend a truncation note rather than dropping the log.
const SESSION_LOG_CAP_BYTES = 20 * 1024 * 1024

// Living-person redaction. Mirrors apps/server/app/feedback.py
// (`_redact_living`) so a bundle built here and one built in the hosted app
// contain the same thing.
const TREE_FILENAME = 'tree.gedcomx.json'
const LIVING_GIVEN = 'Living'
const LIVING_SURNAME_FALLBACK = 'Unknown'

/**
 * Whether a tree person must be treated as living.
 *
 * Same rule as the e2e fixture gate (eval/harness/e2e/author.py::living_gate):
 * **absent is not deceased.** `living` is optional in simplified GedcomX, and
 * defaulting a missing flag to "probably dead" is exactly the wrong bet for a
 * bundle that is about to leave the user's machine.
 */
function isLiving(person: Record<string, unknown>): boolean {
  return person.living !== false
}

/**
 * Reduce a living person to structure: no given name, dates, places, or ark.
 *
 * Keeps `id` (relationships reference it, so dropping the person would dangle
 * every edge) and `gender`. The schema requires `id`/`gender`/`names`, and a
 * name requires `id`/`given`/`surname` with `minItems: 1` on `names`, so the
 * placeholder has to carry a surname rather than omit it. Surname is retained
 * deliberately: it is already inferable from the deceased relatives around
 * them, and "Living Spriggs" is the convention FamilySearch itself displays,
 * so a triager reads it as redaction rather than as corrupt data.
 */
function redactPerson(person: Record<string, unknown>): Record<string, unknown> {
  const names = Array.isArray(person.names) ? (person.names as Record<string, unknown>[]) : []
  const first = names[0] ?? {}
  const out: Record<string, unknown> = {
    id: person.id,
    living: true,
    names: [
      {
        id: first.id ?? `${person.id ?? 'unknown'}-name-1`,
        given: LIVING_GIVEN,
        surname: first.surname ?? LIVING_SURNAME_FALLBACK
      }
    ],
    facts: []
  }
  if ('gender' in person) out.gender = person.gender
  return out
}

/**
 * Redact living persons out of the bundled tree, in place, before it is zipped.
 *
 * FamilySearch's terms forbid sharing living people's details, and a feedback
 * bundle is a capture of a real family. Doing this at capture time (rather than
 * at triage) means the data never leaves the machine at all.
 *
 * Also clears `facts` on any Couple relationship touching a living person — a
 * marriage date/place is as identifying as a birth. Returns the number of
 * persons redacted. Unparseable or unexpectedly-shaped trees are left untouched:
 * this is a privacy filter, not a validator, and it must never be the reason a
 * report fails to send.
 */
function redactLivingPersons(selected: { relativePath: string; buf: Buffer }[]): number {
  const entry = selected.find((s) => s.relativePath === TREE_FILENAME)
  if (!entry) return 0
  try {
    const tree = JSON.parse(entry.buf.toString('utf-8')) as Record<string, unknown>
    const persons = tree.persons
    if (!Array.isArray(persons)) return 0

    const livingIds = new Set<unknown>()
    let redacted = 0
    tree.persons = persons.map((p) => {
      if (p && typeof p === 'object' && isLiving(p as Record<string, unknown>)) {
        livingIds.add((p as Record<string, unknown>).id)
        redacted++
        return redactPerson(p as Record<string, unknown>)
      }
      return p
    })

    const relationships = Array.isArray(tree.relationships) ? tree.relationships : []
    for (const rel of relationships) {
      if (!rel || typeof rel !== 'object') continue
      const r = rel as Record<string, unknown>
      if (!('facts' in r)) continue
      if (livingIds.has(r.person1) || livingIds.has(r.person2)) r.facts = []
    }

    entry.buf = Buffer.from(JSON.stringify(tree, null, 2), 'utf-8')
    return redacted
  } catch {
    return 0
  }
}

export const MAX_FIELD_CHARS = 10_000
export const FEEDBACK_SCHEMA_VERSION = 1

export type ProjectFile = {
  relativePath: string
  sizeBytes: number
  isMedia: boolean
  isText: boolean
}

export async function walkProject(folder: string): Promise<ProjectFile[]> {
  const out: ProjectFile[] = []

  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      if (entry.isSymbolicLink()) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
      } else if (entry.isFile()) {
        const stat = await fs.stat(full)
        const ext = path.extname(entry.name).toLowerCase()
        out.push({
          relativePath: path.relative(folder, full),
          sizeBytes: stat.size,
          isMedia: MEDIA_EXTS.has(ext),
          isText: TEXT_EXTS.has(ext)
        })
      }
    }
  }

  await walk(folder)
  return out
}

export type SessionLog = { entries: unknown[]; sizeBytes: number }

// Why `_feedback/session-log.jsonl` is or isn't in the bundle. Surfaced in
// FEEDBACK.md (issue #1481) so triage isn't left hunting for a file that was
// never written: a Cowork session has no Claude Code transcript on this machine
// (the agent runs in Cowork's VM), which is expected, not missing.
type SessionLogStatus = 'included' | 'not-requested' | 'requested-but-empty'

export async function readSessionLog(folderPath: string): Promise<SessionLog> {
  // Claude Code stores sessions in ~/.claude/projects/<path-with-dashes>/
  // Replace every non-alphanumeric-non-hyphen char with '-'.
  // On macOS /Users/joe/project → -Users-joe-project (leading / becomes -).
  // On Windows C:\Users\joe\project → C--Users-joe-project (: and \ become -).
  const projectHash = folderPath.replace(/[^a-zA-Z0-9-]/g, '-')
  const claudeProjectDir = path.join(os.homedir(), '.claude', 'projects', projectHash)

  try {
    const files = await fs.readdir(claudeProjectDir)
    const jsonlFiles = files.filter((f) => f.endsWith('.jsonl'))
    if (jsonlFiles.length === 0) return { entries: [], sizeBytes: 0 }

    const stats = await Promise.all(
      jsonlFiles.map(async (f) => {
        const filePath = path.join(claudeProjectDir, f)
        const stat = await fs.stat(filePath)
        return { filePath, mtime: stat.mtimeMs }
      })
    )
    stats.sort((a, b) => b.mtime - a.mtime)
    const activeFile = stats[0].filePath

    const raw = await fs.readFile(activeFile, 'utf8')
    const lines = raw.split('\n').filter((l) => l.trim())

    const entries: unknown[] = []
    for (const line of lines) {
      try {
        const entry = JSON.parse(line)
        if (entry.type !== 'user' && entry.type !== 'assistant') continue
        if (entry.cwd && entry.cwd !== folderPath) continue
        // Retain thinking blocks: the agent's reasoning is the highest-value
        // signal for triage and exists nowhere in the persisted project files.
        // (Web bundler keeps it too — apps/server/app/feedback.py.)
        entries.push(entry)
      } catch {
        // Skip malformed lines
      }
    }

    const sizeBytes = new TextEncoder().encode(JSON.stringify(entries)).length
    return { entries, sizeBytes }
  } catch {
    return { entries: [], sizeBytes: 0 }
  }
}

export type FeedbackReport = {
  email: string
  userPrompt: string
  agentDid: string
  /** The "Did it work as expected?" answer. true = positive report; the dialog
   *  then sends empty agentShouldHave/correctAnswer. Not a text field — it skips
   *  normalizeAndValidate's char-limit loop and is threaded straight to the renderers. */
  workedAsExpected: boolean
  agentShouldHave: string
  /** Ground truth, when the agent reached a wrong conclusion. Optional. */
  correctAnswer?: string
  notes: string | undefined
}

export type FeedbackOptions = {
  folderPath: string
  includeMedia: boolean
  includeSessionLog: boolean
  report: FeedbackReport
  viewerVersion: string
}

export type FeedbackResult = {
  filename: string
  zipBase64: string
  fileCount: number
  uncompressedBytes: number
  zipBytes: number
}

type NormalizedFields = {
  email: string
  userPrompt: string
  agentDid: string
  agentShouldHave: string
  correctAnswer: string
  notes: string
}

function normalizeAndValidate(report: FeedbackReport): NormalizedFields {
  const fields: NormalizedFields = {
    email: report.email.trim().toLowerCase(),
    userPrompt: report.userPrompt.trim(),
    agentDid: report.agentDid.trim(),
    agentShouldHave: report.agentShouldHave.trim(),
    correctAnswer: (report.correctAnswer ?? '').trim(),
    notes: (report.notes ?? '').trim()
  }
  for (const [name, value] of Object.entries(fields)) {
    if (value.length > MAX_FIELD_CHARS) {
      throw new Error(
        `Feedback field "${name}" is ${value.length} characters, exceeding the ${MAX_FIELD_CHARS}-character limit.`
      )
    }
  }
  return fields
}

/**
 * Serialize session-log entries, capped at SESSION_LOG_CAP_BYTES.
 *
 * Mirrors `_filter_transcript`'s tail behavior in apps/server/app/feedback.py:
 * over cap we keep the NEWEST entries that fit and prepend a `_truncation_note`
 * line. The note is valid JSON so the downstream user/assistant filters skip it
 * harmlessly, and it records how many leading entries went -- silent truncation
 * would make a short log indistinguishable from a short session.
 */
export function capSessionLog(entries: unknown[]): string {
  const lines = entries.map((e) => JSON.stringify(e))
  const total = lines.reduce((n, l) => n + Buffer.byteLength(l) + 1, 0)
  if (total <= SESSION_LOG_CAP_BYTES) return lines.join('\n') + '\n'

  const tail: string[] = []
  let size = 0
  for (let i = lines.length - 1; i >= 0; i--) {
    const cost = Buffer.byteLength(lines[i]) + 1
    if (size + cost > SESSION_LOG_CAP_BYTES) break
    tail.push(lines[i])
    size += cost
  }
  tail.reverse()

  const note = JSON.stringify({
    type: '_truncation_note',
    dropped_leading_entries: lines.length - tail.length,
    reason: `session log exceeded ${SESSION_LOG_CAP_BYTES} bytes; kept newest ${tail.length} entries`
  })
  return [note, ...tail].join('\n') + '\n'
}

export async function buildFeedbackZip(options: FeedbackOptions): Promise<FeedbackResult> {
  const { folderPath, includeMedia, includeSessionLog, report, viewerVersion } = options
  const folderResolved = path.resolve(folderPath)
  const folderPrefix = folderResolved + path.sep

  const normalized = normalizeAndValidate(report)

  const zip = new JSZip()
  const files = await walkProject(folderResolved)

  const skipped: string[] = []
  const selected: { relativePath: string; buf: Buffer }[] = []

  for (const f of files) {
    if (f.isMedia && !includeMedia) continue
    if (f.sizeBytes > INDIVIDUAL_FILE_CAP_BYTES) {
      skipped.push(`${f.relativePath} (too large)`)
      continue
    }

    const full = path.resolve(folderResolved, f.relativePath)
    if (full !== folderResolved && !full.startsWith(folderPrefix)) {
      skipped.push(`${f.relativePath} (outside project)`)
      continue
    }

    try {
      selected.push({ relativePath: f.relativePath, buf: await fs.readFile(full) })
    } catch {
      skipped.push(`${f.relativePath} (read failed)`)
    }
  }

  // Over budget: drop the largest files until the selection fits. Same rule as
  // the server, so a bundle built here and one built in the hosted app contain
  // the same thing. Dropping beats throwing -- a too-big project should still
  // produce a usable report, minus its heaviest attachments.
  let uncompressedBytes = selected.reduce((n, s) => n + s.buf.length, 0)
  if (uncompressedBytes > ZIP_CAP_BYTES) {
    const bySizeDesc = [...selected].sort((a, b) => b.buf.length - a.buf.length)
    const dropped = new Set<string>()
    for (const s of bySizeDesc) {
      if (uncompressedBytes <= ZIP_CAP_BYTES) break
      dropped.add(s.relativePath)
      uncompressedBytes -= s.buf.length
      skipped.push(`${s.relativePath} (dropped — archive size limit)`)
    }
    for (let i = selected.length - 1; i >= 0; i--) {
      if (dropped.has(selected[i].relativePath)) selected.splice(i, 1)
    }
  }

  const redactedLiving = redactLivingPersons(selected)

  for (const s of selected) zip.file(s.relativePath, s.buf)
  const fileCount = selected.length

  const timestamp = new Date().toISOString()
  let sessionLogStatus: SessionLogStatus = 'not-requested'
  if (includeSessionLog) {
    const sessionLog = await readSessionLog(folderResolved)
    if (sessionLog.entries.length > 0) {
      zip.file('_feedback/session-log.jsonl', capSessionLog(sessionLog.entries))
      sessionLogStatus = 'included'
    } else {
      sessionLogStatus = 'requested-but-empty'
    }
  }

  zip.file(
    'FEEDBACK.md',
    renderFeedbackMarkdown({
      fields: normalized,
      workedAsExpected: report.workedAsExpected,
      timestamp,
      projectFolder: folderResolved,
      viewerVersion,
      sessionLogStatus,
      skipped,
      redactedLiving
    })
  )

  zip.file(
    '_feedback/feedback.json',
    renderFeedbackJson({
      fields: normalized,
      workedAsExpected: report.workedAsExpected,
      submittedAt: timestamp,
      viewerVersion,
      projectFolderPath: folderResolved
    })
  )

  const buf = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  })

  const safeTimestamp = timestamp.replace(/[:.]/g, '-')
  const filename = `feedback-${safeTimestamp}.zip`

  return {
    filename,
    zipBase64: buf.toString('base64'),
    fileCount,
    uncompressedBytes,
    zipBytes: buf.length
  }
}

function renderFeedbackJson(args: {
  fields: NormalizedFields
  workedAsExpected: boolean
  submittedAt: string
  viewerVersion: string
  projectFolderPath: string
}): string {
  const payload = {
    schema_version: FEEDBACK_SCHEMA_VERSION,
    submitted_at: args.submittedAt,
    viewer_version: args.viewerVersion,
    platform: process.platform,
    email: args.fields.email,
    project_folder_path: args.projectFolderPath,
    user_prompt: args.fields.userPrompt,
    agent_did: args.fields.agentDid,
    worked_as_expected: args.workedAsExpected,
    agent_should_have: args.fields.agentShouldHave,
    correct_answer: args.fields.correctAnswer,
    notes: args.fields.notes
  }
  return JSON.stringify(payload, null, 2) + '\n'
}

function renderFeedbackMarkdown(args: {
  fields: NormalizedFields
  workedAsExpected: boolean
  timestamp: string
  projectFolder: string
  viewerVersion: string
  sessionLogStatus: SessionLogStatus
  skipped: string[]
  redactedLiving?: number
}): string {
  const {
    fields,
    workedAsExpected,
    timestamp,
    projectFolder,
    viewerVersion,
    sessionLogStatus,
    skipped,
    redactedLiving = 0
  } = args

  const sections = [
    '# Feedback',
    '',
    `- **From:** ${fields.email}`,
    `- **When:** ${timestamp}`,
    `- **Viewer version:** ${viewerVersion}`,
    `- **Project folder:** ${projectFolder}`,
    `- **Worked as expected:** ${workedAsExpected ? 'Yes' : 'No'}`,
    '',
    '## What I asked',
    '',
    fields.userPrompt,
    '',
    '## What the agent did',
    '',
    fields.agentDid
  ]

  // Omitted on a positive report and when a bug reporter didn't know the ideal
  // behavior (both send it empty) — the "Worked as expected" line carries the signal.
  if (fields.agentShouldHave) {
    sections.push('', '## What it should have done', '', fields.agentShouldHave)
  }

  if (fields.correctAnswer) {
    sections.push('', '## The correct answer, and the evidence for it', '', fields.correctAnswer)
  }

  if (fields.notes) {
    sections.push('', '## Notes', '', fields.notes)
  }

  // Always state the session log's status — never silently omit the section
  // (issue #1481). Which "no log" state a submission lands in is decided in the
  // assembly above: a Cowork bundle submits with the log requested and finds
  // nothing on the host (the agent ran in Cowork's VM) → requested-but-empty;
  // not-requested happens only when a transcript was available and the submitter
  // unticked it. The wording of each branch follows that, not the reverse.
  sections.push('', '## Session log', '')
  if (sessionLogStatus === 'included') {
    sections.push(
      "See `_feedback/session-log.jsonl` for the Claude Code conversation transcript (tool calls, results, and the agent's reasoning)."
    )
  } else if (sessionLogStatus === 'not-requested') {
    sections.push(
      'No Claude Code session log was included — the submitter unticked "Include Claude ' +
        'Code session log" while a transcript was available on their machine. Ask them ' +
        'for it if the transcript is needed to diagnose this case.'
    )
  } else {
    // requested-but-empty
    sections.push(
      'A Claude Code session log was requested but none was found under `~/.claude/projects`. ' +
        "For a Cowork session that is expected — the agent runs in Cowork's own VM, so there " +
        'is no Claude Code transcript on this machine to attach (see ' +
        '`docs/alpha-user-guide-cowork.md`); the `results/` sidecars carry the search/step ' +
        'record instead. For a Claude Code session, the transcript that should be here is missing.'
    )
  }

  if (redactedLiving > 0) {
    sections.push(
      '',
      '## Living people redacted',
      '',
      `${redactedLiving} person(s) in \`${TREE_FILENAME}\` are living or not marked ` +
        `deceased, so their given names, dates and places were replaced with ` +
        `\`${LIVING_GIVEN} <Surname>\` before this bundle was created. Their ids and ` +
        `relationships are intact, so the case still reproduces. This is expected — ` +
        `not corrupt data.`
    )
  }

  if (skipped.length > 0) {
    sections.push('', '## Skipped files', '', ...skipped.map((s) => `- ${s}`))
  }

  return sections.join('\n') + '\n'
}

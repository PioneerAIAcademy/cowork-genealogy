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
const STARTING_TREE_FILENAME = 'starting-tree.gedcomx.json'
// Both tree-shaped files a project folder can hold. starting-tree.gedcomx.json
// is the write-once completion-gate baseline (issue #1490); it carries the same
// living persons as tree.gedcomx.json and is bundled by the same walkProject, so
// it must be redacted too or a bundle ships living details FamilySearch's terms
// forbid sharing. Mirror of apps/server/app/feedback.py's _REDACTED_TREE_FILENAMES.
const REDACTED_TREE_FILENAMES = [TREE_FILENAME, STARTING_TREE_FILENAME]
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
  let total = 0
  for (const name of REDACTED_TREE_FILENAMES) {
    const entry = selected.find((s) => s.relativePath === name)
    if (entry) total += redactOneTree(entry)
  }
  return total
}

/** Redact one tree file in place, returning the number of persons redacted. A
 *  parse failure or unexpected shape leaves the file untouched and returns 0, so
 *  a file that fails partway never contributes a count for bytes it did not
 *  rewrite. */
function redactOneTree(entry: { relativePath: string; buf: Buffer }): number {
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

// Email, "what you asked" and "what the agent did" are all optional at the dialog
// (issue #1919), so any of the three can arrive empty. Say so rather than printing
// a heading or a bullet with nothing after it — a triager cannot otherwise tell
// "the reporter left it blank" from "the bundler lost it".
// Mirrored verbatim in apps/server/app/feedback.py.
export const NOT_PROVIDED = '_(not provided)_'

const orBlank = (value: string): string => (value.trim() ? value : NOT_PROVIDED)
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

/** One transcript as it will be written into the zip. */
export type TranscriptFile = { path: string; text: string }

// The active session's parent transcript keeps its historical name so every
// existing consumer reads it unchanged. Mirrors `PARENT_LOG_ENTRY` in
// apps/server/app/feedback.py.
const PARENT_LOG_ENTRY = '_feedback/session-log.jsonl'

export type SessionLog = {
  /** The active session's conversation entries. Kept for the renderer, which
   *  only asks "is there anything at all". */
  entries: unknown[]
  /** Every transcript the bundle will carry, already capped and serialized. */
  files: TranscriptFile[]
  /** Transcripts left out, named so a zero downstream is not read as "clean". */
  dropped: string[]
  /** Bytes of `files` — exactly what gets written, which is what the reporter
   *  is shown next to the "include session log" toggle. */
  sizeBytes: number
}

// Why `_feedback/session-log.jsonl` is or isn't in the bundle. Surfaced in
// FEEDBACK.md (issue #1481) so triage isn't left hunting for a file that was
// never written: a Cowork session has no Claude Code transcript on this machine
// (the agent runs in Cowork's VM), which is expected, not missing.
//
// `included-grouped-only` is the same rule applied one level down. The set can
// be non-empty while `_feedback/session-log.jsonl` itself is absent — the active
// session's parent filtered to nothing and another session's group shipped —
// and naming that file anyway sends the triager hunting for exactly the missing
// file this status line exists to prevent.
type SessionLogStatus =
  'included' | 'included-grouped-only' | 'not-requested' | 'requested-but-empty'

/** Conversation entries from one raw transcript.
 *
 * `allowSubdirs` accepts an entry whose `cwd` is BENEATH the project, not only
 * equal to it. A subagent sent to work in a subfolder stamps every line with
 * that folder; under equality every line fails, the file filters to empty, and
 * the transcript is discarded — measured, 1 of 12 local subagent transcripts.
 * The parent keeps the strict test: its scoping is what keeps a sibling
 * project's turns out of the bundle. Mirrors `_filter_transcript` in
 * apps/server/app/feedback.py.
 */
function conversationEntries(raw: string, folderPath: string, allowSubdirs: boolean): unknown[] {
  const entries: unknown[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try {
      const entry = JSON.parse(line)
      if (entry.type !== 'user' && entry.type !== 'assistant') continue
      if (entry.cwd && entry.cwd !== folderPath) {
        if (!allowSubdirs || !String(entry.cwd).startsWith(folderPath + path.sep)) continue
      }
      // Retain thinking blocks: the agent's reasoning is the highest-value
      // signal for triage and exists nowhere in the persisted project files.
      // (Web bundler keeps it too — apps/server/app/feedback.py.)
      entries.push(entry)
    } catch {
      // Skip malformed lines
    }
  }
  return entries
}

/**
 * Every Claude Code transcript this bundle will carry.
 *
 * Subagent transcripts are the reason this returns a set rather than one log:
 * they live one level down at `<session-id>/subagents/agent-*.jsonl` with a
 * small `agent-*.meta.json` beside each, and two guardrail owner arms
 * (`proof_summaries`, `questions.exhaustive_declaration`) do their protected
 * write from inside one. While a bundle carried only the main log, those writes
 * were invisible and a zero could not be told apart from "we cannot see"
 * (issue #1880).
 *
 * Every session directory is walked, not just the newest: a resumed session can
 * be renumbered, leaving the real work under an older id. Each session ships as
 * its own group WITH its parent — a subagent transcript is only usable beside
 * the parent holding the `Agent` call that spawned it, because that call's id
 * is the anchor the consumer splices at.
 *
 * Nothing is filtered by `agentType`: the failure this evidence is most needed
 * for is a silent fallback to a general-purpose stand-in (issue #939), and an
 * allow-list drops precisely that transcript.
 */
export async function readSessionLog(folderPath: string): Promise<SessionLog> {
  // Claude Code stores sessions in ~/.claude/projects/<path-with-dashes>/
  // Replace every non-alphanumeric-non-hyphen char with '-'.
  // On macOS /Users/joe/project -> -Users-joe-project (leading / becomes -).
  // On Windows C:\Users\joe\project -> C--Users-joe-project (: and \ become -).
  const projectHash = folderPath.replace(/[^a-zA-Z0-9-]/g, '-')
  const claudeProjectDir = path.join(os.homedir(), '.claude', 'projects', projectHash)
  const empty: SessionLog = { entries: [], files: [], dropped: [], sizeBytes: 0 }

  try {
    const dirents = await fs.readdir(claudeProjectDir, { withFileTypes: true })
    const jsonlFiles = dirents.filter((d) => d.isFile() && d.name.endsWith('.jsonl'))
    if (jsonlFiles.length === 0) return empty

    const stats = await Promise.all(
      jsonlFiles.map(async (d) => {
        const filePath = path.join(claudeProjectDir, d.name)
        return {
          sid: d.name.slice(0, -'.jsonl'.length),
          filePath,
          mtime: (await fs.stat(filePath)).mtimeMs
        }
      })
    )
    stats.sort((a, b) => b.mtime - a.mtime)
    const activeSid = stats[0].sid

    const parents = new Map<string, unknown[]>()
    for (const s of stats) {
      const parsed = conversationEntries(await fs.readFile(s.filePath, 'utf8'), folderPath, false)
      if (parsed.length > 0) parents.set(s.sid, parsed)
    }

    type Child = {
      sid: string
      name: string
      entries: unknown[]
      meta: string | null
      mtime: number
    }
    const children: Child[] = []
    for (const s of stats) {
      const dir = path.join(claudeProjectDir, s.sid, 'subagents')
      let names: string[]
      try {
        names = (await fs.readdir(dir)).filter((f) => f.endsWith('.jsonl'))
      } catch {
        continue // no subagents for this session
      }
      for (const file of names) {
        const full = path.join(dir, file)
        const base = file.slice(0, -'.jsonl'.length)
        let meta: string | null = null
        try {
          meta = await fs.readFile(path.join(dir, `${base}.meta.json`), 'utf8')
        } catch {
          meta = null
        }
        children.push({
          sid: s.sid,
          name: base,
          entries: conversationEntries(await fs.readFile(full, 'utf8'), folderPath, true),
          meta,
          mtime: (await fs.stat(full)).mtimeMs
        })
      }
    }

    // One shared budget across the whole set. A per-file cap times N files is
    // unbounded, and the overflow costs the tester their submission.
    const files: TranscriptFile[] = []
    const dropped: string[] = []
    let spent = 0
    const admit = (p: string, text: string): boolean => {
      const size = Buffer.byteLength(text)
      if (spent + size > SESSION_LOG_CAP_BYTES) return false
      files.push({ path: p, text })
      spent += size
      return true
    }
    // The active session keeps the historical names so every existing consumer
    // reads it unchanged; any other session ships under _feedback/sessions/<id>/.
    const prefix = (sid: string): string =>
      sid === activeSid ? '_feedback/' : `_feedback/sessions/${sid}/`

    const activeEntries = parents.get(activeSid) ?? []
    const admittedParents = new Set<string>()
    if (activeEntries.length > 0) {
      // Parent first: it is the routing narrative, and nothing else is
      // interpretable without it.
      if (admit(PARENT_LOG_ENTRY, capSessionLog(activeEntries))) {
        admittedParents.add(activeSid)
      } else {
        dropped.push(`${PARENT_LOG_ENTRY} (over the transcript size budget)`)
      }
    }

    children.sort(
      (a, b) => b.mtime - a.mtime || a.sid.localeCompare(b.sid) || a.name.localeCompare(b.name)
    )
    for (const c of children) {
      const label = `${prefix(c.sid)}subagents/${c.name}.jsonl`
      if (c.entries.length === 0) {
        dropped.push(`${label} (no conversation entries)`)
        continue
      }
      if (!admittedParents.has(c.sid)) {
        const parentEntries = parents.get(c.sid)
        if (!parentEntries) {
          dropped.push(`${label} (its session's parent transcript is missing)`)
          continue
        }
        if (!admit(`${prefix(c.sid)}session-log.jsonl`, capSessionLog(parentEntries))) {
          dropped.push(`${label} (over the transcript size budget)`)
          continue
        }
        admittedParents.add(c.sid)
      }
      if (!admit(label, capSessionLog(c.entries))) {
        dropped.push(`${label} (over the transcript size budget)`)
        continue
      }
      if (c.meta !== null) {
        // Four keys, and `toolUseId` is the id of the parent `Agent` call — the
        // anchor the consumer splices at. Shipped as-is: metadata, not a log.
        admit(`${prefix(c.sid)}subagents/${c.name}.meta.json`, c.meta)
      }
    }

    return { entries: activeEntries, files, dropped, sizeBytes: spent }
  } catch {
    return empty
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
  let hasSubagentTranscripts = false
  // Named in FEEDBACK.md for the human AND in feedback.json for the program.
  // The prose list is the one a triager reads; this is the one the guardrail
  // report reads (`_dropped_transcripts` in
  // eval/harness/e2e/guardrail_shadow_report.py), and it is what holds every
  // owner arm at "unknown" instead of reporting a 0 nobody can trust.
  const droppedTranscripts: string[] = []
  if (includeSessionLog) {
    const sessionLog = await readSessionLog(folderResolved)
    for (const f of sessionLog.files) zip.file(f.path, f.text)
    // "Is there anything at all", not "is the MAIN log there". The dialog
    // disables its toggle off this and prints "(none found)", but the value it
    // submits stays true (a disabled input fires no onChange), so a parent-only
    // answer would tell the reporter the opposite of what the bundle carries.
    // The wording still turns on the file itself — see SessionLogStatus.
    sessionLogStatus = sessionLog.files.some((f) => f.path === PARENT_LOG_ENTRY)
      ? 'included'
      : sessionLog.files.length > 0
        ? 'included-grouped-only'
        : 'requested-but-empty'
    hasSubagentTranscripts = sessionLog.files.some((f) => f.path.includes('/subagents/'))
    // A dropped transcript that goes unnamed reads downstream as "we looked and
    // found nothing" — the same invisible zero this change exists to remove.
    for (const name of sessionLog.dropped) {
      skipped.push(`${name}`)
      droppedTranscripts.push(name)
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
      hasSubagentTranscripts,
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
      projectFolderPath: folderResolved,
      droppedTranscripts
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
  droppedTranscripts: string[]
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
    notes: args.fields.notes,
    // Transcripts the producer could not include, in a field a PROGRAM can
    // read. FEEDBACK.md's "Skipped files" names them too, but that is prose no
    // consumer opens, and a dropped transcript that reads downstream as "we
    // looked and found nothing" is the invisible zero #1880 exists to remove:
    // the guardrail report holds its owner arms at "unknown" when this is
    // non-empty. Always written, `[]` when nothing was dropped. An ADDED
    // optional field bumps no schema_version (apps/electron/docs/
    // feedback-json-spec.md §5 — removals, renames and re-meanings only).
    // Mirrors apps/server/app/feedback.py.
    dropped_transcripts: args.droppedTranscripts
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
  hasSubagentTranscripts?: boolean
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
    hasSubagentTranscripts = false,
    skipped,
    redactedLiving = 0
  } = args

  const sections = [
    '# Feedback',
    '',
    `- **From:** ${orBlank(fields.email)}`,
    `- **When:** ${timestamp}`,
    `- **Viewer version:** ${viewerVersion}`,
    `- **Project folder:** ${projectFolder}`,
    `- **Worked as expected:** ${workedAsExpected ? 'Yes' : 'No'}`,
    '',
    '## What I asked',
    '',
    orBlank(fields.userPrompt),
    '',
    '## What the agent did',
    '',
    orBlank(fields.agentDid)
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
  } else if (sessionLogStatus === 'included-grouped-only') {
    // The most recent session's transcript filtered to nothing, so the file the
    // 'included' branch names is not in this bundle. Naming it anyway is the
    // #1481 confusion by another door.
    sections.push(
      "There is no `_feedback/session-log.jsonl` in this bundle: the most recent session's " +
        'transcript either had no conversation entries for this project or did not fit the ' +
        'transcript size budget — the "Skipped files" list below says which. The transcripts ' +
        'that did ship are grouped by session under `_feedback/sessions/<session-id>/`, each ' +
        'with its own `session-log.jsonl`.'
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

  // Only when the bundle actually carries one: describing a directory that is
  // not there is the same #1481 confusion the status line above prevents.
  // Mirrors `_feedback_markdown` in apps/server/app/feedback.py.
  if (hasSubagentTranscripts) {
    sections.push(
      '',
      'Work the agent delegated to a subagent has its own transcript under ' +
        '`_feedback/subagents/`, one `.jsonl` per subagent with a small `.meta.json` beside ' +
        'it naming the parent `Agent` call that spawned it. A session other than the most ' +
        'recent one ships the same pair under `_feedback/sessions/<session-id>/`.'
    )
  }

  if (redactedLiving > 0) {
    sections.push(
      '',
      '## Living people redacted',
      '',
      `${redactedLiving} living-person record(s) across the project's tree files ` +
        `(\`${TREE_FILENAME}\` and, when present, \`${STARTING_TREE_FILENAME}\`) are living ` +
        `or not marked ` +
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

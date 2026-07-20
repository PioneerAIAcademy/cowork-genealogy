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

export async function readSessionLog(folderPath: string): Promise<SessionLog> {
  // Claude Code stores sessions in ~/.claude/projects/<path-with-dashes>/
  const projectHash = folderPath.replace(/^\//, '').replace(/\//g, '-')
  const claudeProjectDir = path.join(os.homedir(), '.claude', 'projects', `-${projectHash}`)

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

  for (const s of selected) zip.file(s.relativePath, s.buf)
  const fileCount = selected.length

  const timestamp = new Date().toISOString()
  let sessionLogIncluded = false
  if (includeSessionLog) {
    const sessionLog = await readSessionLog(folderResolved)
    if (sessionLog.entries.length > 0) {
      zip.file('_feedback/session-log.jsonl', capSessionLog(sessionLog.entries))
      sessionLogIncluded = true
    }
  }

  zip.file(
    'FEEDBACK.md',
    renderFeedbackMarkdown({
      fields: normalized,
      timestamp,
      projectFolder: folderResolved,
      viewerVersion,
      sessionLogIncluded,
      skipped
    })
  )

  zip.file(
    '_feedback/feedback.json',
    renderFeedbackJson({
      fields: normalized,
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
    agent_should_have: args.fields.agentShouldHave,
    correct_answer: args.fields.correctAnswer,
    notes: args.fields.notes
  }
  return JSON.stringify(payload, null, 2) + '\n'
}

function renderFeedbackMarkdown(args: {
  fields: NormalizedFields
  timestamp: string
  projectFolder: string
  viewerVersion: string
  sessionLogIncluded: boolean
  skipped: string[]
}): string {
  const { fields, timestamp, projectFolder, viewerVersion, sessionLogIncluded, skipped } = args

  const sections = [
    '# Feedback',
    '',
    `- **From:** ${fields.email}`,
    `- **When:** ${timestamp}`,
    `- **Viewer version:** ${viewerVersion}`,
    `- **Project folder:** ${projectFolder}`,
    '',
    '## What I asked',
    '',
    fields.userPrompt,
    '',
    '## What the agent did',
    '',
    fields.agentDid,
    '',
    '## What it should have done',
    '',
    fields.agentShouldHave
  ]

  if (fields.correctAnswer) {
    sections.push('', '## The correct answer, and the evidence for it', '', fields.correctAnswer)
  }

  if (fields.notes) {
    sections.push('', '## Notes', '', fields.notes)
  }

  if (sessionLogIncluded) {
    sections.push(
      '',
      '## Session log',
      '',
      "See `_feedback/session-log.jsonl` for the Claude Code conversation transcript (tool calls, results, and the agent's reasoning)."
    )
  }

  if (skipped.length > 0) {
    sections.push('', '## Skipped files', '', ...skipped.map((s) => `- ${s}`))
  }

  return sections.join('\n') + '\n'
}

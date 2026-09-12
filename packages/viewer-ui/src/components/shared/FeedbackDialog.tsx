import { useState, useEffect, useMemo, useCallback } from 'react'
import { useResearchData } from '../../contexts/ResearchDataContext'
import styles from './FeedbackDialog.module.css'

type ProjectFile = {
  relativePath: string
  sizeBytes: number
  isMedia: boolean
  isText: boolean
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const EMAIL_STORAGE_KEY = 'feedback.email'
// Must match MAX_FIELD_CHARS in src/main/feedback.ts (the canonical validator).
const MAX_FIELD_CHARS = 10_000

// One reason a send can't go through, tied to the control it is about. Every
// blocker gets the same treatment — an inline message under its own field — so
// no refusal is silent for any of them.
type Blocker = { id: string; message: string }

// The blockable controls, in the order they render, so a refused Send points at
// the FIRST thing wrong rather than an arbitrary one. Ordering only: an id
// missing here sorts last, it is never dropped, so a desync with the JSX below
// costs message order and cannot let an invalid send through.
const FIELD_ORDER = [
  'feedback-email',
  'feedback-prompt',
  'feedback-did',
  'feedback-worked-yes',
  'feedback-should',
  'feedback-answer',
  'feedback-notes'
] as const

const overLimitMessage = (label: string): string =>
  `"${label}" exceeds the ${MAX_FIELD_CHARS.toLocaleString()}-character limit. ` +
  'Trim it or attach the long text separately.'

function FieldError({ id, message }: { id: string; message?: string }): React.JSX.Element | null {
  if (!message) return null
  return (
    <div className={styles.fieldError} id={`${id}-error`} role="alert">
      {message}
    </div>
  )
}

interface FeedbackDialogProps {
  onClose: () => void
}

type SendState = 'idle' | 'sending' | 'success' | 'error'

export default function FeedbackDialog({ onClose }: FeedbackDialogProps): React.JSX.Element {
  const { submitFeedback, getFeedbackContext } = useResearchData()
  const [files, setFiles] = useState<ProjectFile[]>([])
  const [sessionLogSize, setSessionLogSize] = useState(0)
  const [hasSessionLog, setHasSessionLog] = useState(false)
  // The lookup failed, so we do NOT know what the folder holds. Distinct from
  // "checked, found nothing": the flags below are still submitted as-is and each
  // producer reads the folder itself, so claiming "(none found)" here would tell
  // the reporter the opposite of what the bundle does.
  const [contextUnavailable, setContextUnavailable] = useState(false)

  // On by default: a report about an uploaded document is useless without it,
  // and when the project has no media the flag is a no-op (the checkbox is
  // disabled at mediaCount === 0). Oversize bundles are handled downstream —
  // the web path drops the largest files and reports them.
  const [includeMedia, setIncludeMedia] = useState(true)
  const [includeSessionLog, setIncludeSessionLog] = useState(true)
  const [showFileList, setShowFileList] = useState(false)

  const [email, setEmail] = useState(() => {
    try {
      return localStorage.getItem(EMAIL_STORAGE_KEY) ?? ''
    } catch {
      return ''
    }
  })
  const [userPrompt, setUserPrompt] = useState('')
  const [agentDid, setAgentDid] = useState('')
  const [workedAsExpected, setWorkedAsExpected] = useState<boolean | null>(null)
  const [agentShouldHave, setAgentShouldHave] = useState('')
  const [correctAnswer, setCorrectAnswer] = useState('')
  const [notes, setNotes] = useState('')

  // "It worked" is a positive report: hide the two "what went wrong" fields and
  // clear them so no stale bug-text rides along. Only reachable via the Yes radio.
  const markWorked = useCallback(() => {
    setWorkedAsExpected(true)
    setAgentShouldHave('')
    setCorrectAnswer('')
  }, [])

  const [sendState, setSendState] = useState<SendState>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  // The blocker ids the LAST refused Send actually reported. A plain "have we
  // shown errors yet" flag latches: once set it never clears while the dialog is
  // open, so a field the reporter starts typing later goes red and the footer
  // claims a refusal that never happened. Keying on the refused ids means a
  // message appears only for something a Send genuinely rejected.
  const [refusedIds, setRefusedIds] = useState<ReadonlySet<string>>(() => new Set())

  useEffect(() => {
    if (!getFeedbackContext) return
    void getFeedbackContext()
      .then((ctx) => {
        setFiles(ctx.files)
        setHasSessionLog(ctx.hasSessionLog)
        setSessionLogSize(ctx.sessionLogSize)
      })
      .catch(() => {
        // Say we could not check rather than reporting an empty folder. The flags
        // are submitted unchanged and each producer walks the folder itself, so a
        // "(none found)" here would under-report what the bundle actually carries.
        // An unhandled rejection here used to escape and fail the whole render.
        setContextUnavailable(true)
      })
  }, [getFeedbackContext])

  const { selectedFiles, selectedBytes, mediaCount, mediaBytes } = useMemo(() => {
    let mc = 0
    let mb = 0
    const selected: ProjectFile[] = []
    let sb = 0
    for (const f of files) {
      if (f.isMedia) {
        mc++
        mb += f.sizeBytes
        if (includeMedia) {
          selected.push(f)
          sb += f.sizeBytes
        }
      } else {
        selected.push(f)
        sb += f.sizeBytes
      }
    }
    return { selectedFiles: selected, selectedBytes: sb, mediaCount: mc, mediaBytes: mb }
  }, [files, includeMedia])

  const emailTrimmed = email.trim()
  const emailValid = EMAIL_RE.test(emailTrimmed)
  const overLimitFields = useMemo(() => {
    const fields: Array<[string, string, string]> = [
      ['feedback-email', 'Your email', email],
      ['feedback-prompt', 'What you asked', userPrompt],
      ['feedback-did', 'What the agent did', agentDid],
      ['feedback-should', 'What it should have done', agentShouldHave],
      ['feedback-answer', 'The correct answer', correctAnswer],
      ['feedback-notes', 'Notes', notes]
    ]
    return fields
      .filter(([, , value]) => value.trim().length > MAX_FIELD_CHARS)
      .map(([id, label]) => ({ id, label }))
  }, [email, userPrompt, agentDid, agentShouldHave, correctAnswer, notes])

  // Everything that stops a send. Send is never disabled for any of it (#1919):
  // a greyed-out button with no explanation is indistinguishable from a broken
  // app, and the report is lost. These surface as named messages on the attempt.
  // Only the Yes/No answer is required content — email, "What you asked" and
  // "What the agent did" may all be blank. A bundle carrying the session log
  // usually has the prompt and the transcript anyway (not always: an oversized
  // log is trimmed oldest-first, and the prompt is the oldest entry), and a
  // thinner report still beats the one a dead Send button loses.
  const blockers = useMemo<Blocker[]>(() => {
    const byId = new Map<string, Blocker>()
    if (emailTrimmed.length > 0 && !emailValid) {
      byId.set('feedback-email', {
        id: 'feedback-email',
        message:
          'That does not look like an email address. Fix it, or clear it to send anonymously.'
      })
    }
    for (const f of overLimitFields) {
      byId.set(f.id, { id: f.id, message: overLimitMessage(f.label) })
    }
    if (workedAsExpected === null) {
      byId.set('feedback-worked-yes', {
        id: 'feedback-worked-yes',
        message: 'Choose Yes or No so we know whether this is a bug report.'
      })
    }
    // Unknown ids sort last rather than vanishing: a FIELD_ORDER/JSX desync must
    // cost message ORDER, never a dropped blocker that lets an invalid send through.
    const rank = (id: string): number => {
      const i = (FIELD_ORDER as readonly string[]).indexOf(id)
      return i === -1 ? FIELD_ORDER.length : i
    }
    return [...byId.values()].sort((a, b) => rank(a.id) - rank(b.id))
  }, [emailTrimmed, emailValid, overLimitFields, workedAsExpected])

  // A blocker the reporter has since FIXED leaves the refused set for good: if
  // its id stayed, re-breaking that same field would go red and claim "Not sent"
  // again with no Send in between. Only a fresh refusal may re-add it.
  useEffect(() => {
    setRefusedIds((prev) => {
      const next = new Set([...prev].filter((id) => blockers.some((b) => b.id === id)))
      return next.size === prev.size ? prev : next
    })
  }, [blockers])

  // Still-unfixed blockers from the last refusal. A blocker created after that
  // refusal is not here, so it stays quiet until the reporter tries again.
  const shownBlockers = blockers.filter((b) => refusedIds.has(b.id))
  // Over-limit fields whose message is NOT already inline: those keep the live
  // toast, so a box that goes over after a refusal still says so immediately.
  const untoldOverLimit = overLimitFields.filter((f) => !refusedIds.has(f.id))
  const blockerFor = (id: string): string | undefined =>
    shownBlockers.find((b) => b.id === id)?.message

  // Marks the control itself for assistive tech; the visible text is FieldError.
  const errorProps = (
    id: string
  ): { 'aria-invalid'?: true; 'aria-describedby'?: string } =>
    blockerFor(id) ? { 'aria-invalid': true, 'aria-describedby': `${id}-error` } : {}

  const handleSend = useCallback(async () => {
    // `blockers` already carries the radio when it is unanswered, so testing it
    // again here is what narrows `boolean | null` to `boolean` for the payload,
    // not a second gate — both halves land in the branch that says what is wrong.
    // An unexplained early return here was the original defect (#1919).
    const worked = workedAsExpected
    if (blockers.length > 0 || worked === null) {
      setRefusedIds(new Set(blockers.map((b) => b.id)))
      // A refusal is a fresh attempt: drop any error left by an earlier send, or
      // its toast stacks under this one and blames the wrong thing.
      setSendState('idle')
      setErrorMsg('')
      const target = blockers[0]?.id
      if (target) {
        const el = document.getElementById(target)
        el?.scrollIntoView({ block: 'center' })
        el?.focus()
      }
      return
    }
    setRefusedIds(new Set())
    setSendState('sending')
    setErrorMsg('')
    try {
      const trimmedEmail = email.trim()
      try {
        localStorage.setItem(EMAIL_STORAGE_KEY, trimmedEmail)
      } catch {
        // Storage may be unavailable; not fatal.
      }
      await submitFeedback({
        includeMedia,
        includeSessionLog,
        email: trimmedEmail,
        userPrompt: userPrompt.trim(),
        agentDid: agentDid.trim(),
        workedAsExpected: worked,
        agentShouldHave: agentShouldHave.trim(),
        correctAnswer: correctAnswer.trim() || undefined,
        notes: notes.trim() || undefined
      })
      setSendState('success')
      setTimeout(onClose, 1500)
    } catch (err) {
      setSendState('error')
      setErrorMsg(err instanceof Error ? err.message : 'Failed to send feedback')
    }
  }, [
    blockers,
    includeMedia,
    includeSessionLog,
    email,
    userPrompt,
    agentDid,
    workedAsExpected,
    agentShouldHave,
    correctAnswer,
    notes,
    onClose,
    submitFeedback
  ])

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget && sendState !== 'sending') onClose()
    },
    [onClose, sendState]
  )

  const sendButtonLabel =
    sendState === 'sending' ? 'Bundling & sending…' : sendState === 'success' ? 'Sent' : 'Send'

  return (
    <div className={styles.overlay} onClick={handleOverlayClick}>
      <div className={styles.dialog}>
        <div className={styles.header}>
          <span className={styles.headerTitle}>Send Feedback</span>
          <button
            className={styles.close}
            onClick={onClose}
            disabled={sendState === 'sending'}
            title="Close"
          >
            ✕
          </button>
        </div>

        <div className={styles.body}>
          <p className={styles.notice}>
            Comments are public; the files you send are not. Don't include personal
            details in your comments.
          </p>

          <p className={styles.notice}>
            <strong>A team member will read what you send</strong> &mdash; your research
            log, your notes, and your full session transcript. If your research involves
            living people, please don't send this report.
          </p>

          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="feedback-email">
              Your email <span className={styles.optional}>(optional)</span>
            </label>
            <input
              id="feedback-email"
              type="email"
              className={styles.input}
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={sendState === 'sending'}
              autoComplete="email"
              aria-invalid={blockerFor('feedback-email') ? true : undefined}
              aria-describedby={
                blockerFor('feedback-email') ? 'feedback-email-error' : 'feedback-email-hint'
              }
            />
            {blockerFor('feedback-email') ? (
              <FieldError id="feedback-email" message={blockerFor('feedback-email')} />
            ) : (
              <div className={styles.fieldHint} id="feedback-email-hint">
                Only used to follow up on this report. Leave it blank to submit anonymously.
              </div>
            )}
          </div>

          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="feedback-prompt">
              What you asked the agent to do <span className={styles.optional}>(optional)</span>
            </label>
            <textarea
              id="feedback-prompt"
              {...errorProps('feedback-prompt')}
              className={styles.textarea}
              placeholder="Paste or describe the prompt you gave..."
              value={userPrompt}
              onChange={(e) => setUserPrompt(e.target.value)}
              disabled={sendState === 'sending'}
            />
            <FieldError id="feedback-prompt" message={blockerFor('feedback-prompt')} />
          </div>

          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="feedback-did">
              What the agent did <span className={styles.optional}>(optional)</span>
            </label>
            <textarea
              id="feedback-did"
              {...errorProps('feedback-did')}
              className={styles.textarea}
              placeholder="What actually happened..."
              value={agentDid}
              onChange={(e) => setAgentDid(e.target.value)}
              disabled={sendState === 'sending'}
            />
            <FieldError id="feedback-did" message={blockerFor('feedback-did')} />
          </div>

          <div className={styles.field}>
            <span className={styles.fieldLabel} id="feedback-worked-label">
              Did it work as expected? <span className={styles.required}>(required)</span>
            </span>
            <div
              className={styles.radioGroup}
              role="radiogroup"
              aria-labelledby="feedback-worked-label"
              aria-describedby={
                blockerFor('feedback-worked-yes') ? 'feedback-worked-yes-error' : undefined
              }
            >
              <label className={styles.radioLabel}>
                <input
                  id="feedback-worked-yes"
                  type="radio"
                  name="worked-as-expected"
                  checked={workedAsExpected === true}
                  onChange={markWorked}
                  disabled={sendState === 'sending'}
                />
                <span>Yes</span>
              </label>
              <label className={styles.radioLabel}>
                <input
                  type="radio"
                  name="worked-as-expected"
                  checked={workedAsExpected === false}
                  onChange={() => setWorkedAsExpected(false)}
                  disabled={sendState === 'sending'}
                />
                <span>No</span>
              </label>
            </div>
            <FieldError id="feedback-worked-yes" message={blockerFor('feedback-worked-yes')} />
          </div>

          {workedAsExpected === false && (
            <>
              <div className={styles.field}>
                <label className={styles.fieldLabel} htmlFor="feedback-should">
                  What it should have done <span className={styles.optional}>(optional)</span>
                </label>
                <textarea
                  id="feedback-should"
                  {...errorProps('feedback-should')}
                  className={styles.textarea}
                  placeholder="What you expected instead — leave blank if you're not sure..."
                  value={agentShouldHave}
                  onChange={(e) => setAgentShouldHave(e.target.value)}
                  disabled={sendState === 'sending'}
                />
                <FieldError id="feedback-should" message={blockerFor('feedback-should')} />
              </div>

              <div className={styles.field}>
                <label className={styles.fieldLabel} htmlFor="feedback-answer">
                  If the agent reached a <em>wrong conclusion</em>: what is the correct answer, and
                  what evidence supports it? <span className={styles.optional}>(optional)</span>
                </label>
                <textarea
                  id="feedback-answer"
                  {...errorProps('feedback-answer')}
                  className={styles.textarea}
                  placeholder="e.g. His father was Robert Smith (b. ~1820, Augusta Co., VA) — 1850 census, Robert's household, and the 1872 probate naming John as heir."
                  value={correctAnswer}
                  onChange={(e) => setCorrectAnswer(e.target.value)}
                  disabled={sendState === 'sending'}
                />
                <FieldError id="feedback-answer" message={blockerFor('feedback-answer')} />
                <div className={styles.fieldHint}>
                  Skip this if the problem was how the agent worked rather than the answer it
                  reached. When you do fill it in, we can turn this case into a regression test
                  without coming back to ask you.
                </div>
              </div>
            </>
          )}

          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="feedback-notes">
              Notes <span className={styles.optional}>(optional)</span>
            </label>
            <textarea
              id="feedback-notes"
              {...errorProps('feedback-notes')}
              className={styles.textarea}
              placeholder="Anything else worth knowing..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={sendState === 'sending'}
            />
            <FieldError id="feedback-notes" message={blockerFor('feedback-notes')} />
          </div>

          <div className={styles.summary}>
            <div>
              Including <strong>{selectedFiles.length}</strong>{' '}
              {selectedFiles.length === 1 ? 'file' : 'files'} ·{' '}
              <strong>{formatBytes(selectedBytes)}</strong>
            </div>
            {selectedFiles.length > 0 && (
              <button
                type="button"
                className={styles.showListToggle}
                onClick={() => setShowFileList((s) => !s)}
              >
                <span
                  className={`${styles.chevron} ${showFileList ? styles.chevronOpen : ''}`}
                  aria-hidden="true"
                >
                  ▶
                </span>
                {showFileList ? 'Hide file list' : 'Show file list'}
              </button>
            )}
          </div>

          {showFileList && selectedFiles.length > 0 && (
            <ul className={styles.fileList}>
              {selectedFiles.map((f) => (
                <li key={f.relativePath} className={styles.fileItem}>
                  <span className={styles.filePath}>{f.relativePath}</span>
                  <span className={styles.fileSize}>{formatBytes(f.sizeBytes)}</span>
                </li>
              ))}
            </ul>
          )}

          <div className={styles.toggles}>
            <label
              className={`${styles.toggleLabel} ${mediaCount === 0 && !contextUnavailable ? styles.disabledLabel : ''}`}
            >
              <input
                type="checkbox"
                checked={includeMedia && (mediaCount > 0 || contextUnavailable)}
                disabled={mediaCount === 0 && !contextUnavailable}
                onChange={(e) => setIncludeMedia(e.target.checked)}
              />
              <span className={styles.labelText}>
                Include media files{' '}
                {mediaCount > 0 && (
                  <span className={styles.toggleAside}>
                    ({mediaCount} {mediaCount === 1 ? 'file' : 'files'} · {formatBytes(mediaBytes)})
                  </span>
                )}
                {mediaCount === 0 && (
                  <span className={styles.toggleAside}>
                    {contextUnavailable ? '(could not check)' : '(none in folder)'}
                  </span>
                )}
              </span>
            </label>

            <label
              className={`${styles.toggleLabel} ${!hasSessionLog && !contextUnavailable ? styles.disabledLabel : ''}`}
            >
              <input
                type="checkbox"
                checked={includeSessionLog && (hasSessionLog || contextUnavailable)}
                disabled={!hasSessionLog && !contextUnavailable}
                onChange={(e) => setIncludeSessionLog(e.target.checked)}
              />
              <span className={styles.labelText}>
                Include Claude Code session log{' '}
                {hasSessionLog && (
                  <span className={styles.toggleAside}>({formatBytes(sessionLogSize)})</span>
                )}
                {!hasSessionLog && (
                  <span className={styles.toggleAside}>
                    {contextUnavailable ? '(could not check)' : '(none found)'}
                  </span>
                )}
              </span>
            </label>
          </div>

          <div className={styles.privacy}>
            Send packages your project folder as a zip and uploads it to a private Google Drive
            folder accessible only to the Pioneer Academy team. Documents and images you uploaded
            are included &mdash; untick &ldquo;Include media files&rdquo; to leave them out. The
            session log includes your prompts, Claude&apos;s replies and internal reasoning, and
            every tool call with its results &mdash; the reasoning is what lets us diagnose why the
            agent did what it did.
          </div>
        </div>

        {/* Live while typing, for any over-limit field whose message is not already
            inline under the field itself, which would otherwise say it twice. */}
        {untoldOverLimit.length > 0 && sendState !== 'success' && (
          <div className={`${styles.toast} ${styles.toastError}`} role="alert">
            {untoldOverLimit.length === 1
              ? overLimitMessage(untoldOverLimit[0].label)
              : `${untoldOverLimit.length} fields exceed the ${MAX_FIELD_CHARS.toLocaleString()}-character limit: ${untoldOverLimit.map((f) => `"${f.label}"`).join(', ')}.`}
          </div>
        )}
        {/* Says the click did nothing and why to look up. The detail is inline,
            next to the field, so this does not repeat it. */}
        {shownBlockers.length > 0 && sendState !== 'success' && (
          <div className={`${styles.toast} ${styles.toastError}`} role="alert">
            {shownBlockers.length === 1
              ? 'Not sent. Fix the highlighted field above.'
              : `Not sent. Fix the ${shownBlockers.length} highlighted fields above.`}
          </div>
        )}
        {sendState === 'success' && (
          <div className={`${styles.toast} ${styles.toastSuccess}`}>Feedback sent — thank you!</div>
        )}
        {sendState === 'error' && (
          <div className={`${styles.toast} ${styles.toastError}`} role="alert">
            {errorMsg}
          </div>
        )}

        <div className={styles.footer}>
          <button className={styles.cancelBtn} onClick={onClose} disabled={sendState === 'sending'}>
            Cancel
          </button>
          <button
            className={styles.sendBtn}
            onClick={handleSend}
            disabled={sendState === 'sending' || sendState === 'success'}
          >
            {sendButtonLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

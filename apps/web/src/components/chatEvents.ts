// Pure event-folding for the chat transcript, extracted from ChatPane so the
// text / thinking / tool accumulation is unit-testable without a DOM (#1312).
// The React component holds the state; this module decides how one streamed
// agent event changes it.

export interface ToolChip {
  tool: string
  summary: string
  done: boolean
  agent?: string // set when a subagent, not the main agent, made the call
}

/** One rendered unit, in arrival order. See `blocks` below. */
export interface ChatBlock {
  kind: 'text' | 'chip'
  text?: string
  tool?: string
  /** Index into `tools`, so the chip renders with its live done/summary state. */
  toolIndex?: number
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
  tools: ToolChip[]
  // Arrival order of text and chips. `text` accumulates into one string and `tools`
  // into one array, so the order BETWEEN them is lost -- which is why every chip in a
  // turn renders above every paragraph, 36 of them in one stretch of the captured
  // session. This records it. Both fields above are untouched, so every existing
  // reader keeps working and this stays additive.
  blocks?: ChatBlock[]
  thinking?: string
  // Partial content streaming in ahead of its canonical block. Held separately
  // so committing the block can't double-render what the deltas already showed.
  streamText?: string
  streamThinking?: string
  error?: boolean
  // Closed by an `auto_continue` event: the server answered this message's
  // hand-back itself (issue #2653). The next content event opens a new bubble
  // rather than folding onto this one, so each auto-continued step reads as
  // its own reply.
  handedBack?: boolean
  // A user message typed WHILE a turn was running (PR #2870 item 1b). The
  // server holds it rather than enqueueing it -- two turns on one session would
  // resume the same SDK session -- so the bubble says it is waiting. Cleared at
  // `turn_done`, which is when the held message becomes the next turn.
  queued?: boolean
}

// PR #2870 item 1c: what the browser shows for each `turns.outcome`, carried on
// the turn_done frame. complete() used to hardcode 'ok', so EVERY way a run ended
// looked like success -- including the two ways an unattended run actually ends, a
// spent budget and no progress. To a genealogist a half-finished run then reads as
// "nothing more was found", which is a correctness bug in the product, not a cosmetic
// one. `ok` is deliberately absent: an ordinary turn that simply finished says nothing.
// Phase 2 item 4. Alpha testers who locked the screen reported the run had QUIT
// (#2921, #2922). It had not -- on the prototype a disconnect stops only the stream,
// and the captured session proves it: 133 minutes, one turn delivered FIVE times by
// the queue, the resume guard absorbing each redelivery, and the run completing.
// The behaviour was already right; only the saying-so was missing.
//
// Deliberately promises nothing the product cannot do. There is no notification when
// a job finishes, so this must not imply one -- the reader comes back and looks.
export const KEEPS_RUNNING_NOTE =
  'This keeps running if you close the tab — come back any time.'

export const TURN_OUTCOME_LABELS: Record<string, string> = {
  completed: 'Research complete.',
  stopped: 'Stopped — send a message to carry on.',
  queued: 'Picking up your message…',
  budget: 'Paused: this run reached its step budget. Send a message to carry on.',
  no_progress: 'Paused: the agent stopped making progress. Send a message to carry on.',
  decision: 'Waiting on you — see the question above.',
  // R4: the ask was met and the JOB is still open. It must not read like
  // `completed` ('Research complete.'), or a plan-only request looks like a
  // finished project.
  delivered: "Done — that's what you asked for. Send a message to carry on.",
  mcp_unavailable: 'Paused: the genealogy tools became unavailable.'
}

// 1e: `budget` covers two different caps, and they need different advice. The nudge cap
// ends a turn but not the sitting, so another message carries on where it left off. The
// SPEND cap ends the sitting: the only way on is a new session on the same project, and a
// run that stops at $35 looking finished is worse than no cap at all.
export const SPEND_CAP_LABEL =
  'Stopped: this session reached its spend limit. Everything found so far is saved — ' +
  'start a new session on this project to carry on.'

export function turnOutcomeLabel(outcome: unknown, limit?: unknown): string | null {
  if (outcome === 'budget' && limit === 'spend') return SPEND_CAP_LABEL
  return typeof outcome === 'string' ? (TURN_OUTCOME_LABELS[outcome] ?? null) : null
}

// `turn_done` is when a held message is picked up, so no bubble should still
// claim to be waiting after it. Pure and returns the same array when nothing
// was queued, so it cannot cause a needless re-render.
export function clearQueued(messages: ChatMessage[]): ChatMessage[] {
  if (!messages.some((m) => m.queued)) return messages
  return messages.map((m) => (m.queued ? { ...m, queued: false } : m))
}

// Two canonical text blocks in one assistant turn are separate paragraphs, but
// the SDK delivers them as separate events with no separator between them.
// Joining with `+=` glued them — the tester saw "…every subsequent search.q_001
// written." and filed it as a punctuation defect. The transcript renders as
// markdown, so a blank line is the paragraph boundary the model already
// intended; trailing newlines on the previous block are collapsed so we never
// stack more than one. (#1312 defect 1.)
export function joinTextBlocks(existing: string, addition: string): string {
  if (!existing) return addition
  return existing.replace(/\n+$/, '') + '\n\n' + addition
}

const NO_LIVE_TASKS: ReadonlySet<string> = new Set()

// The set of subagent tasks currently running, keyed by the SDK's `task_id`.
// Pure: returns the same set when nothing changed, a new set otherwise. Kept as
// a set and not a flag because delegations overlap — one alpha session ran
// eight extraction agents at once — and a single nullable "activity" value
// clears on the first task_done while the others are still streaming.
export function trackLiveTask(
  set: ReadonlySet<string>,
  kind: string,
  ev: Record<string, unknown>
): ReadonlySet<string> {
  if (kind !== 'task_started' && kind !== 'task_done') return set
  const id = typeof ev.task_id === 'string' ? ev.task_id : ''
  if (!id) return set
  const next = new Set(set)
  if (kind === 'task_started') next.add(id)
  else next.delete(id)
  return next
}

// A new session's first message opens the project. The canned opener travels
// on the wire ahead of whatever the user typed, so init-project runs and reads
// the objective from the same turn; the bubble shows only the user's words.
export const OPENING_TURN = "Let's start a new genealogy research project."

export function withOpeningTurn(text: string): string {
  return `${OPENING_TURN}\n\n${text}`
}

// Replayed history carries the wire text; give the bubble back its own words.
export function stripOpeningTurn(text: string): string {
  if (text === OPENING_TURN) return text
  return text.startsWith(`${OPENING_TURN}\n\n`) ? text.slice(OPENING_TURN.length).trimStart() : text
}

// Drop any in-flight preview on the streaming assistant message. Used when a
// labelled canonical block arrives: its deltas may already have previewed a
// subagent's prose, and that prose must not stay on screen.
function clearPreview(prev: ChatMessage[]): ChatMessage[] {
  const last = prev[prev.length - 1]
  if (!last || last.role !== 'assistant' || (!last.streamText && !last.streamThinking)) return prev
  const next = [...prev]
  next[next.length - 1] = { ...last, streamText: '', streamThinking: '' }
  return next
}

// Fold one agent_event onto the last assistant message (the streaming one),
// returning a new array. Pure: it clones the tail message before touching it and
// never mutates `prev`. `kind` is the event kind and `ev` the raw event. Kinds
// that are not chat content (turn_done, task_*, usage) are handled by the caller
// and never reach here; the caller tracks `liveTasks` with `trackLiveTask` and
// passes it in.
//
// Subagent prose never reaches the chat. real_agent labels every subagent
// event with `agent`; canonical `text`/`thinking` carrying that label are
// dropped here. Deltas are the catch: `text_delta`/`thinking_delta` carry no
// parent id (measured 2026-09-10, 545 stream events, none tagged), so they are
// dropped whenever a subagent task is live. Tool chips keep their label and
// still render — that is the status trail, not prose.
export function foldChatEvent(
  prev: ChatMessage[],
  kind: string,
  ev: Record<string, unknown>,
  liveTasks: ReadonlySet<string> = NO_LIVE_TASKS
): ChatMessage[] {
  if ((kind === 'text' || kind === 'thinking') && typeof ev.agent === 'string') {
    return clearPreview(prev)
  }
  if ((kind === 'text_delta' || kind === 'thinking_delta') && liveTasks.size > 0) return prev

  const next = [...prev]
  let last = next[next.length - 1]
  if (kind === 'auto_continue') {
    // The server is answering the hand-back itself: close the bubble the
    // literal ended, so the synthetic turn's content opens a fresh one. No
    // user bubble — the "Yes." was never a message the user sent.
    if (last && last.role === 'assistant' && !last.handedBack) {
      next[next.length - 1] = { ...last, handedBack: true }
    }
    return next
  }
  if (!last || last.role !== 'assistant' || last.handedBack) {
    last = { role: 'assistant', text: '', tools: [] }
    next.push(last)
  } else {
    last = { ...last, tools: [...last.tools] }
    next[next.length - 1] = last
  }
  const text = (ev.text as string) ?? ''
  if (kind === 'text') {
    // The canonical block covers everything its deltas already previewed —
    // commit it (as its own paragraph) and drop the preview rather than
    // appending both.
    last.text = joinTextBlocks(last.text, text)
    last.blocks = [...(last.blocks ?? []), { kind: 'text', text }]
    last.streamText = ''
  } else if (kind === 'text_delta') {
    last.streamText = (last.streamText ?? '') + text
  } else if (kind === 'thinking') {
    // real_agent emits one event per ThinkingBlock, same as per TextBlock, so
    // two thinking blocks in one turn need the same paragraph break as text
    // (#1312). .thinkingBody is pre-wrap, so the blank line renders as-is.
    last.thinking = joinTextBlocks(last.thinking ?? '', text)
    last.streamThinking = ''
  } else if (kind === 'thinking_delta') {
    last.streamThinking = (last.streamThinking ?? '') + text
  } else if (kind === 'error') {
    // An error can land after a completed answer (the reconnect-exhausted path
    // in ChatPane), so it needs the same break rather than gluing onto the last
    // sentence (#1312).
    last.text = joinTextBlocks(last.text, (ev.text as string) ?? 'Error')
    last.error = true
  } else if (kind === 'tool_use') {
    last.blocks = [
      ...(last.blocks ?? []),
      { kind: 'chip', tool: ev.tool as string, toolIndex: last.tools.length }
    ]
    last.tools.push({
      tool: ev.tool as string,
      summary: ev.summary as string,
      done: false,
      agent: typeof ev.agent === 'string' ? ev.agent : undefined
    })
  } else if (kind === 'tool_result') {
    // Match the AGENT as well as the tool. Matching on the tool alone closed the
    // first open chip with that name, whoever produced it -- and with up to eight
    // extraction agents live at once and `same_person` called 299 times in one
    // session, a result from agent B closed agent A's chip and overwrote its
    // summary. Measured on the captured session: 28 of 1,006 results (2.8%) landed
    // on the wrong chip. `agent` is undefined on the main thread, so main-thread
    // results still match main-thread chips and only each other.
    const evAgent = typeof ev.agent === 'string' ? ev.agent : undefined
    const idx = last.tools.findIndex(
      (t) => t.tool === ev.tool && t.agent === evAgent && !t.done
    )
    if (idx >= 0) last.tools[idx] = { ...last.tools[idx], done: true, summary: ev.summary as string }
    else
      last.tools.push({
        tool: ev.tool as string,
        summary: ev.summary as string,
        done: true,
        agent: typeof ev.agent === 'string' ? ev.agent : undefined
      })
  }
  return next
}

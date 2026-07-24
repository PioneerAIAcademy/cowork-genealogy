import { useEffect, useRef, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { SessionConnection, WsMessage } from '../transport/SessionConnection'
import { api, ApiError } from '../api'

const OPENING_TURN = "Let's start a new genealogy research project."

interface ToolChip {
  tool: string
  summary: string
  done: boolean
  agent?: string // set when a subagent, not the main agent, made the call
}

interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
  tools: ToolChip[]
  thinking?: string
  // Partial content streaming in ahead of its canonical block. Held separately
  // so committing the block can't double-render what the deltas already showed.
  streamText?: string
  streamThinking?: string
  error?: boolean
}

// What a running subagent is doing right now, from the SDK's task lifecycle
// messages. Live-only — never part of the transcript.
interface AgentActivity {
  agent: string
  lastTool: string
  toolUses: number | null
}

export interface UsageDelta {
  costUsd: number
  inputTokens: number
  outputTokens: number
  estimated: boolean
}

export default function ChatPane({
  conn,
  sessionId,
  isNew,
  onUsage
}: {
  conn: SessionConnection
  sessionId: string
  isNew: boolean
  onUsage?: (delta: UsageDelta) => void
}): React.JSX.Element {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [ready, setReady] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const startedRef = useRef(false)
  const [elapsed, setElapsed] = useState(0)
  const turnStartRef = useRef(0)
  const [activity, setActivity] = useState<AgentActivity | null>(null)
  const [connState, setConnState] = useState<'open' | 'reconnecting'>('open')

  // Append agent_event content onto the last assistant message (the streaming one).
  const applyEvent = (ev: Record<string, unknown>): void => {
    const kind = ev.kind as string
    if (kind === 'turn_done') {
      setBusy(false)
      setActivity(null)
      return
    }
    // Subagent lifecycle. Not chat content — this drives the status line, so a
    // long delegation reads as "record-extractor · person_read · 12 tools"
    // instead of an unattributed spinner.
    if (kind === 'task_started' || kind === 'task_progress') {
      setActivity({
        agent: String(ev.agent ?? 'subagent'),
        lastTool: String(ev.last_tool ?? ''),
        toolUses: typeof ev.tool_uses === 'number' ? ev.tool_uses : null
      })
      return
    }
    if (kind === 'task_done') {
      setActivity(null)
      return
    }
    if (kind === 'usage') {
      // Per-turn cost/tokens, emitted once just before turn_done. Not a chat
      // message — bubble it up to the (alpha-gated) session cost meter.
      onUsage?.({
        costUsd: typeof ev.cost_usd === 'number' ? ev.cost_usd : 0,
        inputTokens: typeof ev.input_tokens === 'number' ? ev.input_tokens : 0,
        outputTokens: typeof ev.output_tokens === 'number' ? ev.output_tokens : 0,
        estimated: Boolean(ev.estimated)
      })
      return
    }
    setMessages((prev) => {
      const next = [...prev]
      let last = next[next.length - 1]
      if (!last || last.role !== 'assistant') {
        last = { role: 'assistant', text: '', tools: [] }
        next.push(last)
      } else {
        last = { ...last, tools: [...last.tools] }
        next[next.length - 1] = last
      }
      if (kind === 'text') {
        // The canonical block covers everything its deltas already previewed —
        // commit it and drop the preview rather than appending both.
        last.text += (ev.text as string) ?? ''
        last.streamText = ''
      } else if (kind === 'text_delta') {
        last.streamText = (last.streamText ?? '') + ((ev.text as string) ?? '')
      } else if (kind === 'thinking') {
        last.thinking = (last.thinking ?? '') + ((ev.text as string) ?? '')
        last.streamThinking = ''
      } else if (kind === 'thinking_delta') {
        last.streamThinking = (last.streamThinking ?? '') + ((ev.text as string) ?? '')
      } else if (kind === 'error') {
        last.text += (ev.text as string) ?? 'Error'
        last.error = true
      } else if (kind === 'tool_use') {
        last.tools.push({
          tool: ev.tool as string,
          summary: ev.summary as string,
          done: false,
          agent: typeof ev.agent === 'string' ? ev.agent : undefined
        })
      } else if (kind === 'tool_result') {
        const idx = last.tools.findIndex((t) => t.tool === ev.tool && !t.done)
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
    })
  }

  useEffect(() => {
    const off = conn.on((msg: WsMessage) => {
      if (msg.type === 'agent_event') applyEvent(msg.event as Record<string, unknown>)
      else if (msg.type === 'user_msg')
        // Replayed transcript on (re)connect — the server only sends user_msg
        // during history replay; live input is added locally in send().
        setMessages((prev) => [...prev, { role: 'user', text: String(msg.text ?? ''), tools: [] }])
      else if (msg.type === 'status' && msg.state === 'chat_ready') setReady(true)
      // A turn was already running when we (re)connected — a reload mid-turn, or
      // a second tab. Without this the indicator is idle while the agent works,
      // because busy is otherwise set only locally in send(). turn_done clears it.
      else if (msg.type === 'status' && msg.state === 'turn_active') setBusy(true)
      else if (msg.type === 'conn_state') setConnState(msg.state as 'open' | 'reconnecting')
      else if (msg.type === 'status' && msg.state === 'chat_error') {
        setReady(false)
        // Reconnect attempts are over — stop the "Reconnecting…" spinner so the
        // error message below carries the state instead of a stuck indicator.
        setConnState('open')
        applyEvent({ kind: 'error', text: `Chat unavailable: ${msg.message ?? 'unknown error'}` })
        applyEvent({ kind: 'turn_done' })
      }
    })
    return off
  }, [conn])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages, busy])

  // Tick a visible "working… Ns" while a turn is in flight, so a long tool call
  // reads as alive rather than hung.
  useEffect(() => {
    if (!busy) return
    turnStartRef.current = Date.now()
    setElapsed(0)
    const id = window.setInterval(
      () => setElapsed(Math.floor((Date.now() - turnStartRef.current) / 1000)),
      1000
    )
    return () => window.clearInterval(id)
  }, [busy])

  const send = (text: string): void => {
    const trimmed = text.trim()
    if (!trimmed || busy) return
    setMessages((prev) => [...prev, { role: 'user', text: trimmed, tools: [] }])
    conn.send({ type: 'user_msg', text: trimmed })
    setBusy(true)
    setInput('')
  }

  // Ask the agent to abort the running turn. The runner forwards this to the SDK
  // (or cancels the mock); either way the turn ends with turn_done, which clears
  // busy. Fire-and-forget — the button reflects intent, turn_done confirms it.
  const stop = (): void => {
    if (!busy) return
    conn.send({ type: 'interrupt' })
  }

  // Upload a document/image, then tell the agent where it landed. The upload
  // alone is invisible to the agent — it only learns about the file from a turn,
  // so the two steps are deliberately coupled here.
  const handleFile = async (file: File): Promise<void> => {
    setUploadError('')
    setUploading(true)
    try {
      const { path } = await api.uploadSessionFile(sessionId, file)
      send(
        `I've uploaded a file to \`${path}\`. Please read it and use it in this research.`
      )
    } catch (err) {
      setUploadError(err instanceof ApiError ? err.message : `Upload failed: ${String(err)}`)
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  // New session: auto-send the opening turn so init-project runs conversationally.
  useEffect(() => {
    if (isNew && !startedRef.current) {
      startedRef.current = true
      send(OPENING_TURN)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNew])

  return (
    <div className="chatBody">
      <div className="chatMessages" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="chatPlaceholder">
            <p className="muted small">
              {ready ? 'Say hello to start.' : 'Connecting to the agent…'}
            </p>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'msgUser' : 'msgAssistant'}>
            {m.tools.length > 0 && (
              <div className="toolChips">
                {m.tools.map((t, j) => (
                  <span key={j} className={`toolChip ${t.done ? 'toolDone' : 'toolRunning'}`}>
                    {t.done ? '✓' : '⟳'} {t.agent ? `${t.agent} · ` : ''}
                    {t.tool}: {t.summary}
                  </span>
                ))}
              </div>
            )}
            {(m.thinking || m.streamThinking) && (
              <details className="thinkingBlock" style={{ margin: '4px 0' }}>
                <summary className="muted small" style={{ cursor: 'pointer' }}>💭 Thinking</summary>
                <div className="muted small" style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>
                  {m.thinking}
                  {m.streamThinking}
                </div>
              </details>
            )}
            {m.text && (
              <div className={`msgText ${m.error ? 'msgError' : ''}`}>
                <Markdown remarkPlugins={[remarkGfm]}>{m.text}</Markdown>
              </div>
            )}
            {/* In-flight text, rendered as plain preformatted text: markdown is
                routinely mid-token at delta granularity, and re-parsing a partial
                document every frame makes list/code blocks flicker as they close. */}
            {m.streamText && (
              <div className={`msgText ${m.error ? 'msgError' : ''}`} style={{ whiteSpace: 'pre-wrap' }}>
                {m.streamText}
              </div>
            )}
          </div>
        ))}
        {/* One status line, three distinct states. Reconnecting is shown even
            when a turn wasn't running, because a dropped socket is worth knowing
            about; it takes priority over "working" so a stall never masquerades
            as progress (the failure mode that hid the 2026-07-20 disconnect). */}
        {connState === 'reconnecting' ? (
          <div className="typing">●●● Reconnecting…</div>
        ) : (
          busy && (
            <div className="typing">
              ●●●{' '}
              {activity
                ? `${activity.agent}${activity.lastTool ? ` · ${activity.lastTool}` : ''}${
                    activity.toolUses ? ` · ${activity.toolUses} tools` : ''
                  }`
                : 'working…'}{' '}
              {elapsed}s
            </div>
          )
        )}
      </div>

      {uploadError && <div className="chatUploadError">{uploadError}</div>}

      <form
        className="chatInputBar"
        onSubmit={(e) => {
          e.preventDefault()
          send(input)
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void handleFile(f)
          }}
        />
        <button
          type="button"
          className="chatAttach"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy || uploading || !ready}
          title="Attach a document or image for the agent to read"
          aria-label="Attach a document or image"
        >
          {uploading ? '…' : '📎'}
        </button>
        <textarea
          className="chatTextarea"
          placeholder={ready ? 'Message the agent…' : 'Connecting…'}
          value={input}
          rows={2}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send(input)
            }
          }}
        />
        {/* While a turn runs, Send becomes Stop — the only escape from a long
            turn used to be a page reload (interrupt was a no-op end to end). */}
        {busy ? (
          <button className="chatStop" type="button" onClick={stop} title="Stop the current turn">
            Stop
          </button>
        ) : (
          <button className="chatSend" type="submit" disabled={!input.trim()}>
            Send
          </button>
        )}
      </form>
    </div>
  )
}

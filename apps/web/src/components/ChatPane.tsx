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
}

interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
  tools: ToolChip[]
  thinking?: string
  error?: boolean
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

  // Append agent_event content onto the last assistant message (the streaming one).
  const applyEvent = (ev: Record<string, unknown>): void => {
    const kind = ev.kind as string
    if (kind === 'turn_done') {
      setBusy(false)
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
        last.text += (ev.text as string) ?? ''
      } else if (kind === 'thinking') {
        last.thinking = (last.thinking ?? '') + ((ev.text as string) ?? '')
      } else if (kind === 'error') {
        last.text += (ev.text as string) ?? 'Error'
        last.error = true
      } else if (kind === 'tool_use') {
        last.tools.push({ tool: ev.tool as string, summary: ev.summary as string, done: false })
      } else if (kind === 'tool_result') {
        const idx = last.tools.findIndex((t) => t.tool === ev.tool && !t.done)
        if (idx >= 0) last.tools[idx] = { ...last.tools[idx], done: true, summary: ev.summary as string }
        else last.tools.push({ tool: ev.tool as string, summary: ev.summary as string, done: true })
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
      else if (msg.type === 'status' && msg.state === 'chat_error') {
        setReady(false)
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
                    {t.done ? '✓' : '⟳'} {t.tool}: {t.summary}
                  </span>
                ))}
              </div>
            )}
            {m.thinking && (
              <details className="thinkingBlock" style={{ margin: '4px 0' }}>
                <summary className="muted small" style={{ cursor: 'pointer' }}>💭 Thinking</summary>
                <div className="muted small" style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>
                  {m.thinking}
                </div>
              </details>
            )}
            {m.text && (
              <div className={`msgText ${m.error ? 'msgError' : ''}`}>
                <Markdown remarkPlugins={[remarkGfm]}>{m.text}</Markdown>
              </div>
            )}
          </div>
        ))}
        {busy && <div className="typing">●●● working… {elapsed}s</div>}
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
        <button className="chatSend" type="submit" disabled={busy || !input.trim()}>
          Send
        </button>
      </form>
    </div>
  )
}

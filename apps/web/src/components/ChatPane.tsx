import { useEffect, useRef, useState } from 'react'
import Markdown from 'react-markdown'
import type { SessionConnection, WsMessage } from '../transport/SessionConnection'

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

export default function ChatPane({
  conn,
  isNew
}: {
  conn: SessionConnection
  isNew: boolean
}): React.JSX.Element {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
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
                <Markdown>{m.text}</Markdown>
              </div>
            )}
          </div>
        ))}
        {busy && <div className="typing">●●● working… {elapsed}s</div>}
      </div>

      <form
        className="chatInputBar"
        onSubmit={(e) => {
          e.preventDefault()
          send(input)
        }}
      >
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

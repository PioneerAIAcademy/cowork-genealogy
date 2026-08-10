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

export interface ChatMessage {
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

// Fold one agent_event onto the last assistant message (the streaming one),
// returning a new array. Pure: it clones the tail message before touching it and
// never mutates `prev`. `kind` is the event kind and `ev` the raw event. Kinds
// that are not chat content (turn_done, task_*, usage) are handled by the caller
// and never reach here.
export function foldChatEvent(
  prev: ChatMessage[],
  kind: string,
  ev: Record<string, unknown>
): ChatMessage[] {
  const next = [...prev]
  let last = next[next.length - 1]
  if (!last || last.role !== 'assistant') {
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
}

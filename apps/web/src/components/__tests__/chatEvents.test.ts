import { describe, it, expect } from 'vitest'
import { foldChatEvent, joinTextBlocks, type ChatMessage } from '../chatEvents'

const textEvent = (text: string): Record<string, unknown> => ({ kind: 'text', text })

describe('joinTextBlocks (#1312 defect 1)', () => {
  it('separates two blocks with a blank line — NOT simple a + b', () => {
    // The exact regression: the model punctuated cleanly ("…every subsequent
    // search.") and began a new block ("q_001 written."); the renderer glued them.
    const joined = joinTextBlocks('…every subsequent search.', 'q_001 written.')
    expect(joined).not.toBe('…every subsequent search.q_001 written.')
    expect(joined).toBe('…every subsequent search.\n\nq_001 written.')
  })

  it('returns the addition unchanged when there is no prior text', () => {
    expect(joinTextBlocks('', 'first block')).toBe('first block')
  })

  it('collapses trailing newlines so paragraphs never stack past one blank line', () => {
    expect(joinTextBlocks('a\n\n', 'b')).toBe('a\n\nb')
  })
})

describe('foldChatEvent', () => {
  it('joins two consecutive text events in one turn with a paragraph break', () => {
    let msgs: ChatMessage[] = []
    msgs = foldChatEvent(msgs, 'text', textEvent('First sentence.'))
    msgs = foldChatEvent(msgs, 'text', textEvent('Second sentence.'))
    expect(msgs).toHaveLength(1)
    expect(msgs[0].text).toBe('First sentence.\n\nSecond sentence.')
    expect(msgs[0].text).not.toBe('First sentence.Second sentence.')
  })

  it('commits a canonical text block and clears the streaming preview', () => {
    let msgs = foldChatEvent([], 'text_delta', { kind: 'text_delta', text: 'First sen' })
    msgs = foldChatEvent(msgs, 'text', textEvent('First sentence.'))
    expect(msgs[0].streamText).toBe('')
    expect(msgs[0].text).toBe('First sentence.')
  })

  it('keeps thinking out of the answer text', () => {
    let msgs = foldChatEvent([], 'thinking', {
      kind: 'thinking',
      text: 'Let me start by identifying the target.'
    })
    msgs = foldChatEvent(msgs, 'text', textEvent('Here is the answer.'))
    expect(msgs[0].thinking).toBe('Let me start by identifying the target.')
    expect(msgs[0].text).toBe('Here is the answer.')
  })

  it('marks a tool_result done against its matching open tool_use', () => {
    let msgs = foldChatEvent([], 'tool_use', { kind: 'tool_use', tool: 'record_read', summary: 'reading' })
    msgs = foldChatEvent(msgs, 'tool_result', { kind: 'tool_result', tool: 'record_read', summary: 'done' })
    expect(msgs[0].tools).toHaveLength(1)
    expect(msgs[0].tools[0]).toMatchObject({ tool: 'record_read', done: true, summary: 'done' })
  })

  it('does not mutate the previous array (pure fold)', () => {
    const before: ChatMessage[] = []
    const after = foldChatEvent(before, 'text', textEvent('x'))
    expect(before).toHaveLength(0)
    expect(after).toHaveLength(1)
  })
})

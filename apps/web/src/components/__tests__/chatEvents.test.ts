import { describe, it, expect } from 'vitest'
import {
  foldChatEvent,
  joinTextBlocks,
  trackLiveTask,
  withOpeningTurn,
  stripOpeningTurn,
  OPENING_TURN,
  type ChatMessage,
  clearQueued,
  turnOutcomeLabel,
  TURN_OUTCOME_LABELS,
  SPEND_CAP_LABEL,
  KEEPS_RUNNING_NOTE
} from '../chatEvents'
import subagentStream from './fixtures/subagent-stream.json'

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

  it('joins two consecutive thinking events with a paragraph break (#1312)', () => {
    // real_agent emits one event per ThinkingBlock, so two thinking blocks in a
    // turn glued the same way text did. .thinkingBody is pre-wrap, so the blank
    // line renders directly.
    let msgs: ChatMessage[] = []
    msgs = foldChatEvent(msgs, 'thinking', { kind: 'thinking', text: 'First thought.' })
    msgs = foldChatEvent(msgs, 'thinking', { kind: 'thinking', text: 'Second thought.' })
    expect(msgs[0].thinking).toBe('First thought.\n\nSecond thought.')
    expect(msgs[0].thinking).not.toBe('First thought.Second thought.')
  })

  it('separates a trailing error from a completed answer (#1312)', () => {
    // The reconnect-exhausted path fires an error event after real answer text;
    // it must not glue onto the last sentence.
    let msgs = foldChatEvent([], 'text', textEvent('Here are the results.'))
    msgs = foldChatEvent(msgs, 'error', { kind: 'error', text: 'Chat unavailable: unknown error' })
    expect(msgs[0].text).toBe('Here are the results.\n\nChat unavailable: unknown error')
    expect(msgs[0].error).toBe(true)
  })

  // Why ChatPane must return early for every non-content kind (#2371 review).
  // foldChatEvent's contract is "append onto the streaming assistant message",
  // so ANY kind reaching it opens a bubble -- including a lifecycle frame that
  // carries no content. `turn_start` fell through and did exactly that. The
  // empty bubble is invisible whenever the reply fills it, and stays on screen
  // when a turn ends with no content: a Stop before the first token.
  //
  // This pins the HAZARD, not the guard. The guard is an early return inside
  // ChatPane's `applyEvent`, and apps/web has no jsdom project (see
  // vitest.config.ts), so nothing here can render the component to prove it.
  it('opens an assistant bubble for a lifecycle kind that carries no content', () => {
    const before: ChatMessage[] = [{ role: 'user', text: 'hello', tools: [] }]
    const after = foldChatEvent(before, 'turn_start', { kind: 'turn_start', queued: false })

    expect(after).toHaveLength(2)
    expect(after[1]).toMatchObject({ role: 'assistant', text: '' })
  })

  // Lay mode: subagent prose never reaches the chat. real_agent labels every
  // subagent event with `agent`; the fold drops labelled canonical blocks and,
  // because deltas carry no label, drops deltas while any task is live.
  it('drops a labelled text block without opening or touching a bubble', () => {
    const before: ChatMessage[] = [{ role: 'user', text: 'go', tools: [] }]
    const after = foldChatEvent(before, 'text', { kind: 'text', text: 'agent prose', agent: 'record-extractor' })
    expect(after).toBe(before)
  })

  it('drops a labelled thinking block', () => {
    const msgs = foldChatEvent([], 'thinking', { kind: 'thinking', text: 'agent reasoning', agent: 'record-extractor' })
    expect(msgs).toHaveLength(0)
  })

  it('clears the streamed preview when the labelled canonical block arrives', () => {
    // Deltas that slipped through before task_started was folded must not stay
    // on screen once the block they previewed turns out to be a subagent's.
    let msgs = foldChatEvent([], 'text_delta', { kind: 'text_delta', text: 'Reading the ce' })
    msgs = foldChatEvent(msgs, 'text', { kind: 'text', text: 'Reading the census.', agent: 'record-extractor' })
    expect(msgs[0].streamText).toBe('')
    expect(msgs[0].text).toBe('')
  })

  it('drops deltas while a subagent task is live, and folds them again after', () => {
    const live = new Set(['t1'])
    let msgs = foldChatEvent([], 'text_delta', { kind: 'text_delta', text: 'subagent delta' }, live)
    expect(msgs).toHaveLength(0)
    msgs = foldChatEvent(msgs, 'text_delta', { kind: 'text_delta', text: 'main delta' }, new Set())
    expect(msgs[0].streamText).toBe('main delta')
  })

  it('still records a labelled tool chip — the status trail is not prose', () => {
    const msgs = foldChatEvent([], 'tool_use', { kind: 'tool_use', tool: 'record_read', summary: 'r', agent: 'record-extractor' })
    expect(msgs[0].tools[0]).toMatchObject({ tool: 'record_read', agent: 'record-extractor' })
  })
})

describe('trackLiveTask', () => {
  it('keeps a task live until ITS task_done, not the first task_done seen', () => {
    let live: ReadonlySet<string> = new Set()
    live = trackLiveTask(live, 'task_started', { task_id: 't1' })
    live = trackLiveTask(live, 'task_started', { task_id: 't2' })
    live = trackLiveTask(live, 'task_done', { task_id: 't1' })
    expect(live.size).toBe(1)
    expect(live.has('t2')).toBe(true)
    live = trackLiveTask(live, 'task_done', { task_id: 't2' })
    expect(live.size).toBe(0)
  })

  it('returns the same set for kinds and events it does not track', () => {
    const live: ReadonlySet<string> = new Set(['t1'])
    expect(trackLiveTask(live, 'task_progress', { task_id: 't1' })).toBe(live)
    expect(trackLiveTask(live, 'text', {})).toBe(live)
    expect(trackLiveTask(live, 'task_done', {})).toBe(live)
  })
})

describe('replaying a captured subagent stream through the fold', () => {
  // The wire shape real_agent.map_message emits for one main-thread turn that
  // delegates twice, with the second delegation overlapping the first. This is
  // the concurrency case a single nullable "activity" value gets wrong.
  it('lands no subagent characters and every main-thread character', () => {
    let live: ReadonlySet<string> = new Set()
    let msgs: ChatMessage[] = []
    for (const ev of subagentStream as Record<string, unknown>[]) {
      const kind = ev.kind as string
      if (kind.startsWith('task_')) {
        live = trackLiveTask(live, kind, ev)
        continue
      }
      msgs = foldChatEvent(msgs, kind, ev, live)
    }
    expect(msgs).toHaveLength(1)
    const m = msgs[0]
    expect(m.text).toBe(
      'Starting the extraction.\n\nBoth records are extracted.\n\nNext: search-records. Continue?'
    )
    expect(m.text).not.toContain('12 assertions')
    expect(m.text).not.toContain('Second record')
    expect(m.thinking ?? '').toBe('')
    expect(m.streamThinking ?? '').toBe('')
    // The delta streamed after t1 finished but while t2 was live was dropped;
    // the one after both finished was committed by its canonical block.
    expect(m.streamText).toBe('')
    // Tool chips keep the agent label.
    expect(m.tools).toEqual([
      { tool: 'record_read', summary: 'recordId=X', done: false, agent: 'record-extractor' }
    ])
  })
})

describe('opening turn', () => {
  it('prefixes the opener on the wire and strips it back on replay', () => {
    const wire = withOpeningTurn('Locate the siblings of LCZ8-949.')
    expect(wire).toBe(`${OPENING_TURN}\n\nLocate the siblings of LCZ8-949.`)
    expect(stripOpeningTurn(wire)).toBe('Locate the siblings of LCZ8-949.')
  })
  it('leaves a bare opener and ordinary messages alone', () => {
    expect(stripOpeningTurn(OPENING_TURN)).toBe(OPENING_TURN)
    expect(stripOpeningTurn('Yes.')).toBe('Yes.')
  })
})

describe('auto_continue is a bubble boundary (issue #2653)', () => {
  // The server answered the hand-back itself, so no user_msg separates the two
  // turns. Without the boundary the second step's text and tool chips would
  // fold onto the first bubble.
  const step1 = 'Project set up.\n\nNext: choose the first research question. Continue?'
  const step2 = 'Question chosen.\n\nNext: plan which records to search. Continue?'

  function twoSteps(): ChatMessage[] {
    let msgs: ChatMessage[] = [{ role: 'user', text: 'find the parents', tools: [] }]
    msgs = foldChatEvent(msgs, 'tool_use', { kind: 'tool_use', tool: 'project_create', summary: 'a' })
    msgs = foldChatEvent(msgs, 'text', { kind: 'text', text: step1 })
    msgs = foldChatEvent(msgs, 'auto_continue', { kind: 'auto_continue', text: 'Yes.', step: 1, max_steps: 30 })
    msgs = foldChatEvent(msgs, 'tool_use', { kind: 'tool_use', tool: 'research_append', summary: 'b' })
    msgs = foldChatEvent(msgs, 'text', { kind: 'text', text: step2 })
    return msgs
  }

  it('two turns joined by auto_continue are two assistant bubbles, no user bubble', () => {
    const msgs = twoSteps()
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant', 'assistant'])
    expect(msgs[1].text).toBe(step1)
    expect(msgs[2].text).toBe(step2)
    expect(msgs[1].handedBack).toBe(true)
    expect(msgs[2].handedBack).toBeUndefined()
  })

  it("the second turn's tool chips land on the second bubble", () => {
    const msgs = twoSteps()
    expect(msgs[1].tools.map((t) => t.tool)).toEqual(['project_create'])
    expect(msgs[2].tools.map((t) => t.tool)).toEqual(['research_append'])
  })

  it('auto_continue with no assistant tail neither opens a bubble nor throws', () => {
    const before: ChatMessage[] = [{ role: 'user', text: 'go', tools: [] }]
    const after = foldChatEvent(before, 'auto_continue', { kind: 'auto_continue', text: 'Yes.' })
    expect(after).toHaveLength(1)
  })

  it('a replayed transcript takes the same path and yields the same bubbles', () => {
    // Replay is the same event list through the same fold; pin that the
    // boundary does not depend on live-only state.
    expect(twoSteps()).toEqual(twoSteps())
  })
})

// PR #2870 item 1b: a message typed while a turn runs is HELD by the server
// and picked up at the next step boundary. The bubble says so until turn_done.
describe('clearQueued', () => {
  it('clears the flag on every queued bubble', () => {
    const before: ChatMessage[] = [
      { role: 'user', text: 'go', tools: [] },
      { role: 'assistant', text: 'working', tools: [] },
      { role: 'user', text: 'also check the 1881 census', tools: [], queued: true }
    ]
    const after = clearQueued(before)
    expect(after[2].queued).toBe(false)
    expect(after[0]).toEqual(before[0])
    expect(after[1]).toEqual(before[1])
  })

  it('returns the SAME array when nothing is queued, so it cannot cause a re-render', () => {
    const before: ChatMessage[] = [{ role: 'user', text: 'go', tools: [] }]
    expect(clearQueued(before)).toBe(before)
  })

  it('does not mutate the input', () => {
    const before: ChatMessage[] = [{ role: 'user', text: 'x', tools: [], queued: true }]
    clearQueued(before)
    expect(before[0].queued).toBe(true)
  })
})

// PR #2870 item 1c: every way a run ends used to look like success.
describe('turnOutcomeLabel', () => {
  it('names each terminal outcome the worker can write', () => {
    for (const outcome of ['completed', 'stopped', 'queued', 'budget', 'no_progress',
                           'decision', 'mcp_unavailable']) {
      expect(turnOutcomeLabel(outcome)).toBeTruthy()
    }
  })

  it('says nothing for an ordinary finish', () => {
    // `ok` is deliberately unlabelled: a turn that simply ended has nothing to report.
    expect(turnOutcomeLabel('ok')).toBeNull()
    expect(turnOutcomeLabel(undefined)).toBeNull()
    expect(turnOutcomeLabel(null)).toBeNull()
    expect(turnOutcomeLabel(42)).toBeNull()
    expect(turnOutcomeLabel('something_new')).toBeNull()
  })

  it('tells the reader how to carry on wherever carrying on is possible', () => {
    // The failure this exists to prevent: a capped or stalled run that reads as
    // "nothing more was found". Each of those three must say what to do next.
    for (const outcome of ['stopped', 'budget', 'no_progress']) {
      expect(turnOutcomeLabel(outcome)).toMatch(/carry on/i)
    }
    expect(turnOutcomeLabel('completed')).not.toMatch(/carry on/i)
  })

  it('separates the two budgets, because only one of them ends the sitting', () => {
    // 1e. The nudge cap ends a TURN -- another message carries on where it left off. The
    // spend cap ends the SITTING, and the only way on is a new session on the project.
    expect(turnOutcomeLabel('budget', 'spend')).toBe(SPEND_CAP_LABEL)
    expect(turnOutcomeLabel('budget', 'spend')).toMatch(/new session/i)
    expect(turnOutcomeLabel('budget')).not.toBe(SPEND_CAP_LABEL)
    expect(turnOutcomeLabel('budget')).not.toMatch(/new session/i)
    // A limit that is not the spend cap must not steal the spend label.
    expect(turnOutcomeLabel('budget', 'nudges')).not.toBe(SPEND_CAP_LABEL)
    expect(turnOutcomeLabel('completed', 'spend')).toBe(TURN_OUTCOME_LABELS.completed)
  })

  it('distinguishes a finished run from every paused one', () => {
    const labels = ['completed', 'stopped', 'budget', 'no_progress', 'mcp_unavailable']
      .map((o) => turnOutcomeLabel(o))
    expect(new Set(labels).size).toBe(labels.length)
  })
})

// --- Chip attribution across concurrent sub-agents (phase 2 item 3 prerequisite) ---
//
// A tool_result closed the first OPEN chip with the same tool name, ignoring which
// agent produced it. With up to eight extraction agents live at once and
// `same_person` called 299 times, results land on the wrong chip and overwrite its
// summary. Measured on the captured session: 28 of 1,006 results (2.8%) closed a
// different agent's chip.
//
// This has to be right before anything anchors paragraphs to steps, or the anchoring
// validates against cross-attributed chips.

describe('tool chips with several agents in flight', () => {
  const start = (tool: string, agent?: string): Record<string, unknown> => ({
    tool, summary: `${agent ?? 'main'} started`, ...(agent ? { agent } : {})
  })
  const finish = (tool: string, agent?: string): Record<string, unknown> => ({
    tool, summary: `${agent ?? 'main'} finished`, ...(agent ? { agent } : {})
  })

  it("closes the chip belonging to the agent that produced the result", () => {
    let msgs: ChatMessage[] = []
    msgs = foldChatEvent(msgs, 'text', { text: 'working' })
    msgs = foldChatEvent(msgs, 'tool_use', start('same_person', 'agent-A'))
    msgs = foldChatEvent(msgs, 'tool_use', start('same_person', 'agent-B'))
    // B finishes first — A must stay open and keep ITS summary.
    msgs = foldChatEvent(msgs, 'tool_result', finish('same_person', 'agent-B'))

    const tools = msgs[msgs.length - 1].tools
    const a = tools.find((t) => t.agent === 'agent-A')
    const b = tools.find((t) => t.agent === 'agent-B')
    expect(b?.done, 'the agent that finished should be closed').toBe(true)
    expect(b?.summary).toBe('agent-B finished')
    expect(a?.done, "the other agent's chip must stay open").toBe(false)
    expect(a?.summary, "and must keep its own summary").toBe('agent-A started')
  })

  it('does not let a sub-agent result close the main thread chip', () => {
    let msgs: ChatMessage[] = []
    msgs = foldChatEvent(msgs, 'text', { text: 'working' })
    msgs = foldChatEvent(msgs, 'tool_use', start('research_query'))
    msgs = foldChatEvent(msgs, 'tool_use', start('research_query', 'agent-A'))
    msgs = foldChatEvent(msgs, 'tool_result', finish('research_query', 'agent-A'))

    const tools = msgs[msgs.length - 1].tools
    expect(tools.find((t) => t.agent === undefined)?.done).toBe(false)
    expect(tools.find((t) => t.agent === 'agent-A')?.done).toBe(true)
  })

  it('still closes same-agent chips in order when one agent repeats a tool', () => {
    let msgs: ChatMessage[] = []
    msgs = foldChatEvent(msgs, 'text', { text: 'working' })
    msgs = foldChatEvent(msgs, 'tool_use', start('record_read', 'agent-A'))
    msgs = foldChatEvent(msgs, 'tool_use', start('record_read', 'agent-A'))
    msgs = foldChatEvent(msgs, 'tool_result', finish('record_read', 'agent-A'))

    const tools = msgs[msgs.length - 1].tools
    expect(tools.filter((t) => t.done).length).toBe(1)
    expect(tools.filter((t) => !t.done).length).toBe(1)
  })
})

// --- Ordered blocks, so chips render where they arrived (phase 2 item 3) ---
//
// `text` accumulates into one string and `tools` into one array, so the order
// BETWEEN them is lost and ChatPane can only render every chip above every
// paragraph. `blocks` records arrival order alongside them; `text`/`tools` are
// untouched, so every existing reader keeps working.

describe('ordered blocks', () => {
  it('records text and chips in the order they arrived', () => {
    let m: ChatMessage[] = []
    m = foldChatEvent(m, 'text', { text: 'first' })
    m = foldChatEvent(m, 'tool_use', { tool: 'record_search', summary: 's' })
    m = foldChatEvent(m, 'text', { text: 'second' })

    const blocks = m[m.length - 1].blocks ?? []
    expect(blocks.map((b) => b.kind)).toEqual(['text', 'chip', 'text'])
    expect(blocks[0].text).toBe('first')
    expect(blocks[1].tool).toBe('record_search')
    expect(blocks[2].text).toBe('second')
  })

  it('leaves the existing text and tools fields exactly as they were', () => {
    let m: ChatMessage[] = []
    m = foldChatEvent(m, 'text', { text: 'a' })
    m = foldChatEvent(m, 'tool_use', { tool: 't1', summary: 's' })
    m = foldChatEvent(m, 'text', { text: 'b' })

    const last = m[m.length - 1]
    expect(last.text).toBe(joinTextBlocks('a', 'b'))
    expect(last.tools.map((t) => t.tool)).toEqual(['t1'])
  })

  it('does not record a block for a tool_result — it closes a chip, it is not new', () => {
    let m: ChatMessage[] = []
    m = foldChatEvent(m, 'text', { text: 'x' })
    m = foldChatEvent(m, 'tool_use', { tool: 't1', summary: 'started' })
    m = foldChatEvent(m, 'tool_result', { tool: 't1', summary: 'done' })

    const blocks = m[m.length - 1].blocks ?? []
    expect(blocks.filter((b) => b.kind === 'chip').length).toBe(1)
  })

  it('each chip block points at ITS OWN entry in tools', () => {
    // Break-testing found this uncovered: pointing every block at tools[0] passed.
    // A wrong index renders the wrong tool's label and done-state in that slot.
    let m: ChatMessage[] = []
    m = foldChatEvent(m, 'text', { text: 'go' })
    m = foldChatEvent(m, 'tool_use', { tool: 'first', summary: 'a' })
    m = foldChatEvent(m, 'tool_use', { tool: 'second', summary: 'b' })
    m = foldChatEvent(m, 'tool_use', { tool: 'third', summary: 'c' })

    const last = m[m.length - 1]
    const chipBlocks = (last.blocks ?? []).filter((b) => b.kind === 'chip')
    expect(chipBlocks.map((b) => last.tools[b.toolIndex as number].tool)).toEqual([
      'first',
      'second',
      'third'
    ])
  })
})

// --- "The job outlives the tab" (phase 2 item 4) ---
//
// Alpha testers who locked the screen reported the run had QUIT (#2921, #2922). It
// had not: on the prototype a disconnect stops only the stream. The captured session
// is direct proof -- 133 minutes, and the queue delivered that one turn FIVE times
// with the resume guard absorbing each redelivery and the run completing.
//
// So the behaviour is right and only the saying-so is missing. The reassurance must
// appear while a turn is running and only then: telling an idle reader their job
// keeps running is noise.

describe('keeps-running reassurance', () => {
  it('names closing the tab, because that is what testers actually did', () => {
    expect(KEEPS_RUNNING_NOTE.toLowerCase()).toMatch(/close|leave/)
    expect(KEEPS_RUNNING_NOTE.toLowerCase()).toMatch(/keep|continue|carry/)
  })

  it('does not promise a notification the product cannot send', () => {
    expect(KEEPS_RUNNING_NOTE.toLowerCase()).not.toMatch(/email|notify|notification/)
  })

  it('is short enough to sit under a typing indicator', () => {
    expect(KEEPS_RUNNING_NOTE.length).toBeLessThan(90)
  })
})

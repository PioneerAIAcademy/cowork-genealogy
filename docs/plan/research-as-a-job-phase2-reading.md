# Phase 2 — the reading experience (detailed pass)

**Status:** NOT BUILT. Written 2026-09-30 against the first captured hosted feed
(`docs/captures/2026-09-29-mcandrew-children/`, 133 minutes, outcome `completed`).
Parent: `docs/plan/research-as-a-job-later-REVISED.md`. Revised after plan-critic round 1,
which found the first draft had measured the **feed** and called it the **screen** — the same
error that put 18% in the parent plan where the truth was 8.8%.

## The feed is not the screen

`chatEvents.ts:154` drops every canonical `text`/`thinking` event carrying an `agent` label —
*"Subagent prose never reaches the chat"*. Chips keep their label and DO render. So the two
columns below differ, and only the right-hand one describes a reader.

| | in the feed | **reaches the screen** |
|---|---|---|
| Events | 2,697 | — |
| Tool chips | 1,009 | 1,009 (574 of them from sub-agents) |
| Narration paragraphs | 282 | **190** (92 sub-agent paragraphs dropped) |
| Chips per paragraph | 3.6 | **5.3** |
| Chips between two paragraphs | median 2, max 39 | median **3**, max **39** |
| Paragraphs over 600 chars | 13% | **8.9%** |
| Schema identifiers in prose | 405 / 164 distinct | **193 occurrences / 94 distinct** |
| Sub-agents | 36 `task_started` events | **32 distinct** — 25 completed, 4 stopped, 3 never closed |

**Prose is single-source; chips are multi-source.** The first draft claimed the reader watches
"a merged stream from 37 sources". They do not: every paragraph they read comes from the main
thread, because the other 92 are dropped. What IS merged is the chip trail — 574 of 1,009
chips are sub-agent work. An ordering rule must therefore reconcile one prose timeline against
33 chip producers, which is a different and easier problem than the draft described.

The identifier count also has to name its pattern: 193/94 counts `q_ pl_ pli_ a_ pe_ src_
log_`. The first draft's 405 silently excluded `src_` (the source cards chips should open) and
`log_`, while including `pli_`. The parent's acceptance is "no schema id renders unlinked", so
the linker's scope is the full set, not whichever prefixes a regex happened to carry.

## Order of work, by measured reader impact

### 1. Identifiers become links

**193 occurrences of 94 distinct schema ids** render as dead text — `a_` 61, `pe_` 47, `src_`
38, `pli_` 24, `log_` 14, `q_` 7, `pl_` 2. Additive by construction: an id that does not
resolve stays plain, exactly as today.

**Co-edits the parent binds to this item and the first draft dropped:** S1/init-project's
identifier clause changes *"here, with the linker and not before it"*
(`later-REVISED.md:279-281`), and the record-extraction relay-leak validator
`test_relay_carries_no_caller_facing_lines`
(`eval/harness/validators/test_record_extraction.py:1373`) needs its key updated (`:282`).

### 2. Chips speak FamilySearch's words

The reader is shown `mcp__genealogy__same_person` **299 times** and
`mcp__genealogy__research_query` **230 times**.

**A name→label map is not sufficient, and the acceptance must not pretend it is.**
`ChatPane.tsx:355` renders `{t.tool}: {t.summary}`, and **18 chips in this capture carry
`select:mcp__genealogy__…` inside the *summary*** (ToolSearch queries). Mapping tool names
leaves those 18 on screen. Either item 2 grows a summary-scrubbing arm or clause 2 scopes to
the tool-name slot; it cannot have both.

**Deferred from the parent's chip item** (`:263-271`), explicitly rather than silently: the
chip *opening the card it names*, collapsed-card identity, compaction state and retry state.
This item is the label only.

### 3. Anchor each paragraph to its step — needs a schema change first

**Not implementable from what the events carry.** A main-thread `text` event carries only
`{text}`: no step id, no task id, no tool linkage. Sub-agent events carry `agent` = the Task's
*description string*, not an id (`real_agent.py:722-725,733`) — and in this capture **five
labels were each used by two different tasks**, so even grouping chips by label is ambiguous.
"Step" is not a wire concept.

So this item owns a **backend** edit site the first draft never named: stamp a `task_id` on
every sub-agent event in `_event_for`, and define the main-thread anchor rule (proposal: a
paragraph anchors to the contiguous main-thread chips since the previous paragraph).

**Prerequisite bug.** `chatEvents.ts:208` closes a chip on `t.tool === ev.tool && !t.done`,
first match. With 299 `same_person` calls and up to eight extraction agents live at once
(comment at `:93`), a result from agent B closes agent A's chip and overwrites its summary.
Any anchoring built on the folded transcript would validate against cross-attributed chips.
Fix by matching on the agent label too, or on `task_id` once the schema change lands.

### 4. The job outlives the tab, and says so

The one item whose evidence already exists: 133 minutes, **`turns.receive_count` = 5**. Read
that column, **not** the `turn_done` event's `receive_count`, which is 1 in this capture.

## Acceptance — each clause falsifiable, and none satisfied by shipping nothing

1. **Links.** Of the **193 reader-visible occurrences**, every id whose section exists in the
   committed `research.json` resolves to that card; the rest stay plain. A floor keyed to the
   rendered corpus — "resolve or stay plain" is satisfied by doing nothing and is not a check.
2. **Chips.** No `mcp__genealogy__*` string reaches the screen **in the tool-name slot**, and
   the 18 summary-borne occurrences are either scrubbed or declared out of scope in this
   plan. Replayed over the committed capture; the harness for that exists
   (`chatEvents.test.ts:173`).
3. **Anchoring.** Ground truth must come from **hand-annotating the 39-chip burst in the
   committed capture** — nothing in the feed records which step a paragraph describes, so a
   replay that derives the answer from the code under test is its own ground truth.
4. **Outliving the tab.** A `turn_done` following `turns.receive_count > 1` renders
   identically to one following a single delivery.

## Not in this pass, each with its destination

- **"One view of job state, in two places"** (`later-REVISED.md:252-261`) — the ticking plan
  panel, the off-plan group, session-list states, and the progress-rail removal from
  viewer-ui. Deferred to the next pass; **not** gated on #2927, and the first draft omitted it
  entirely rather than deferring it.
- **"Three kinds of nothing"** — R5 pins it to phase 3's errand; one semantic, two eval slots
  if split.
- **"Show the scans"** — sidecar bodies 404 on the prototype; a backend gap, not a reading one.

#2927 gates the *Before phase 2 acceptance measurement* only. **All seven** of the parent's
phase-2 items are unaffected by it; the first draft said six and was wrong.

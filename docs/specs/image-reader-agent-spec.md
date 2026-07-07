# Specification: Image Reader Agent

A Cowork plugin subagent that reads FamilySearch page scans in an
isolated context and returns only a text transcription, so the raw image
never enters (or accumulates in) the calling agent's context.

## 1. Purpose

`image_read` returns a page scan as inline base64 (~33% larger than the
raw JPEG). Each response adds a base64 content block to the calling
agent's conversation, and the **whole conversation is re-serialized and
re-sent every turn**. So base64 blobs from successive `image_read` calls
**accumulate**, the per-turn payload grows with each read, and eventually
one re-serialized message carrying the accumulated pile exceeds the
~1 MiB (1,048,576-byte) buffer and crashes the *entire session* — an
uncatchable error — even when every individual image is small. The
overflow is the accumulated conversation, **not** a single MCP response
frame.

Observed: an e2e run (`clark-parents`) made **17** `image_read` calls,
each ≤458 KB raw (~5.4 MB of base64 total), and crashed with
`JSON message exceeded maximum buffer size of 1048576 bytes`. No single
image was near `image_read`'s 700 KB ceiling — the *pile* was the problem,
so lowering the ceiling does not fix it.

The `image-reader` subagent is the fix: it absorbs the base64 in a
throwaway context and returns only text. The bytes never reach the main
transcript, so accumulation cannot happen regardless of how many scans a
session reads. The `image_read` per-image ceiling remains as a transport
**floor** protecting any single response (see `image-read-spec.md`). The
complementary "downscale large scans so they stay readable rather than
refused" work is a separate deferred ticket.

## 2. Files to Create / Modify

- **Create** `packages/engine/plugin/agents/image-reader.md` — the agent.
- **Modify** `packages/engine/plugin/skills/record-extraction/SKILL.md` —
  the only skill that reads images: remove `image_read` from
  `allowed-tools` and change its "Image" input path to delegate via
  `@plugin:image-reader` instead of calling `image_read` directly.
  (Delegation is **not** an `allowed-tools` entry — do not add `Task`;
  the runtime provides delegation, exactly as `/research` invokes
  `@plugin:gps-mentor` with `allowed-tools: [validate_research_schema]`
  only.)
- **Modify** `docs/specs/image-read-spec.md` — reframe the size cap as a
  floor and point at this agent as the accumulation fix.
- `image_read` itself (`src/tools/image-read.ts`) is **unchanged** except
  for the reframed comment; the ceiling value stays at 700 KB.

## 3. Invocation

Invoked via `@plugin:image-reader` by any agent/skill that needs the text
of a page scan — currently `record-extraction` (mirroring how `/research`
invokes `@plugin:gps-mentor`). Delegation resolves to a subagent spawn at
runtime; it is not listed in the caller's `allowed-tools`. The caller
narrows to a specific image first (`image_search` / `volume_search`) and
hands this agent the imageId.

### 3.1 Input convention

| Parameter | Required | Meaning |
|-----------|----------|---------|
| `imageId` | yes | The **single** image to read — a DGS Image Group Number (`004022578_00190`) or image ARK (`3:1:.../$dist`). |
| `looking_for` | no | A **search key only** — *who or what* to locate on the page. It focuses the FOUND / NOT FOUND pointer; it is **not** the expected result and **never** suppresses or shortens the full transcription. If the caller's message asserts the answer ("confirm the father is Adam Schreck"), the agent ignores the assertion and transcribes what the page actually says. |

### 3.2 One image per invocation

The agent reads **exactly one image per invocation** — the single
`imageId` it is given. It does not read a range, a volume, or a "next
few." One image is the only count provably under the ~1 MiB buffer for a
large scan: two large scans (~458 KB raw → ~610 KB base64 each) already
sum past it inside the subagent's own re-serialized conversation, so "read
a few" re-creates the crash the subagent exists to prevent. When several
images are needed the caller invokes the agent **once per image** (which
also yields clean one-image-per-source provenance). If the caller passes
more than one imageId, the agent reads only the first and says so.

## 4. Agent Frontmatter

- `name: image-reader`
- `model: claude-sonnet-4-6` — vision-capable for OCR of dense/old-script
  registers. MAY be swapped for a cheaper vision model later (Cowork
  honors the agent `model:` pin); quality on faint German script is the
  constraint to watch.
- `tools: [image_read]` — the agent's sole capability. It does not write
  `research.json` / `tree.gedcomx.json`, create assertions/sources, or
  search indexes; that stays with the caller.

## 5. Output Protocol

The agent's job is **faithful OCR, not answering the caller's question** —
it transcribes the page and returns it; matching the page to the research
objective stays with the caller. Returns **text only** — never the base64
image, never a request for the caller to fetch it:

- `imageId` + one-line page description (record type, jurisdiction, date
  span, language).
- The **full transcription of every genealogically relevant entry on the
  page** — not only the entry that matches `looking_for` — using `[?]`
  (uncertain), `[illegible]`, `[torn]`; original spelling/language
  preserved. The transcription is never trimmed or slanted toward an
  expected answer.
- An **extracted facts** list (names, dates, relationships, places) the
  caller can turn into assertions.
- If `looking_for` was set: `FOUND` / `NOT FOUND` + the matching line — as
  a pointer for the caller, never a substitute for the full transcription.

## 6. Failure Behavior

If `image_read` throws (image over the 700 KB transport floor, an
unreachable ARK, or any other error) the agent **must not** produce a
transcription — a fabricated read is worse than a visible miss. It returns:

- `NOT READ: <imageId>` on its own line;
- the **exact error message** `image_read` returned, quoted verbatim;
- the pivot recommendation: read the **indexed** record for this image
  (`record_read` / `record_search` / `search-full-text`, or a related
  person's indexed record).

It does **not** retry via browser / `web_fetch` / "Claude in Chrome"
(unavailable), and it never invents, infers, or guesses page contents when
the read failed. The caller decides the pivot. This guardrail is
independent of the ARK-support fix in §8 — the tool can still fail for
other reasons, and this is what turns a failed read into a clean, visible
miss instead of a silent fabrication.

## 7. Testing

This path is **not unit-testable** in the eval harness: the unit
skill-runner backstops the `Task` tool as disallowed
(`skill_runner.py` `DISALLOWED_BACKSTOP`), and `image_read` cannot be
mocked (the mock MCP server cannot emit image content blocks — already
exempt from tool-coverage checks). Like `gps-mentor`, the agent is
validated at the **e2e** level.

**The validation run must genuinely OCR a real scan.** The `clark-parents`
run that first accompanied this agent *fabricated* its single image read
(it "confirmed" the register without a successful `image_read`), so
nothing about the agent's real behavior was exercised — not "reads
correctly," not "returns the full transcription," not "keeps base64 out of
the main context," not "survives accumulation." A run that merely finishes
without crashing is **not** sufficient.

The landing gate is a fresh scored run in which the agent **actually reads
at least one image successfully** — ideally **2+ scans across separate
invocations**, to exercise the once-per-image isolation and confirm base64
never accumulates in the caller. This is now unblocked: the ARK-accepting
`image_read` has landed (§8), so `record-extraction`'s ARK inputs reach a
successful read. Produce this real-read run (the prior `clark-parents` run
that fabricated its read does not count) and record the passing scored run
+ `.ann.json` per the usual e2e gate.

## 8. Merge dependency: the ARK-accepting `image_read` (satisfied)

This agent depends on an `image_read` that accepts document-image **ARKs**
(`3:1:/3:2:`), because `record-extraction` hands the agent ARKs — the shape
`fulltext_search` returns. That dependency is now **satisfied**: the
ARK-accepting `image_read` landed in `main` (#600) and has been merged into
this branch, so the ARK inputs named in the `imageId`/`ark` convention
(§3.1) work as written.

(Historical context, kept because it explains the §6 guardrail: before
#600, `image_read` accepted only a bare `NUMBER_NUMBER` Image Group Number
and rejected an ARK — and the pre-§6 failure path *fabricated* a reading on
that rejection instead of erroring. Had this agent shipped ahead of #600,
every original-scan read would have been broken in production. The §6
NOT-READ hardening is orthogonal and stands regardless: it turns any future
`image_read` failure into a clean, visible miss rather than a fabrication.)

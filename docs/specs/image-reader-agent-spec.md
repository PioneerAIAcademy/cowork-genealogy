# Specification: Image Reader Agent

A Cowork plugin subagent that reads FamilySearch page scans in an
isolated context and returns only a text transcription, so the raw image
never enters (or accumulates in) the calling agent's context.

## 1. Purpose

`image_read` returns a page scan as inline base64 (~33% larger than the
raw JPEG). The MCP stdio transport decodes one message at a time behind a
hard ~1 MiB (1,048,576-byte) buffer, and base64 blobs from successive
`image_read` calls **accumulate** in the calling agent's context and are
re-sent every turn. A later message then overflows the buffer and crashes
the *entire session* — an uncatchable transport error — even when every
individual image is small.

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
| `imageId` (or a short list) | yes | DGS Image Group Number (`004022578_00190`) or image ARK (`3:1:.../$dist`). |
| `looking_for` | no | What the caller needs, to focus the transcription and produce a clear FOUND / NOT FOUND. |

### 3.2 Bounded reads

The agent reads **at most 3 images per invocation**. Reading many scans
in one invocation re-creates the accumulation problem inside the
subagent's own context. For more, it transcribes the most promising few,
says which it read, and instructs the caller to re-invoke with the next
specific imageId(s). The caller must not pass a whole volume/range.

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

Returns **text only** — never the base64 image, never a request for the
caller to fetch it. Per image:

- `imageId` + one-line page description (record type, jurisdiction, date
  span, language).
- Faithful transcription of the relevant entries, using `[?]`
  (uncertain), `[illegible]`, `[torn]`; original spelling/language
  preserved.
- An **extracted facts** list (names, dates, relationships, places) the
  caller can turn into assertions.
- If `looking_for` was set: `FOUND` / `NOT FOUND` + the matching line.

## 6. Failure Behavior

If `image_read` throws (image over the transport floor, or an unreachable
ARK): report the error verbatim + the `imageId`, do **not** retry via
browser / `web_fetch` / "Claude in Chrome", and recommend the indexed
fallback (`record_read` / `record_search` / `search-full-text`, or a
related person's indexed record). The caller decides the pivot.

## 7. Testing

This path is **not unit-testable** in the eval harness: the unit
skill-runner backstops the `Task` tool as disallowed
(`skill_runner.py` `DISALLOWED_BACKSTOP`), and `image_read` cannot be
mocked (the mock MCP server cannot emit image content blocks — already
exempt from tool-coverage checks). Like `gps-mentor`, the agent is
validated at the **e2e** level: the `clark-parents` fixture exercises the
image path and, with this agent in place, must complete without the
transport crash. Record its passing scored run + `.ann.json` per the
usual e2e gate.

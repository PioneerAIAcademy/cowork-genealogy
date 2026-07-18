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

The `image-reader` subagent's reader is `image_transcribe` (host-side Qwen3-VL
OCR), which returns **text** — so no base64 ever enters the caller's context,
the read is ~10× cheaper/faster, and it handles scans of any size (the old
"downscale large scans so they aren't refused" ticket is moot). Because the
tool returns text, the accumulation crash this agent was created to prevent is
now structurally impossible on the read path; the subagent remains as the
delegation seam + one-image-per-source boundary + context hygiene for long
transcriptions. `image_read`'s inline-base64 path is no longer used by this
agent (its 700 KB floor still guards any direct `image_read` consumer — see
`image-read-spec.md`).

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
| `project_path` | no | Absolute project-folder path. When given, `image_transcribe` saves the fetched JPEG under `images/` and returns an `imageRef` the agent reports, so the caller can cite it as the source's `image_filename` (viewer). Only retained-source images are kept; the rest are swept. |

### 3.2 One image per invocation

The agent reads **exactly one image per invocation** — the single `imageId`
it is given. It does not read a range, a volume, or a "next few." This keeps a
clean one-image-per-source provenance and one delegation per scan; when
several images are needed the caller invokes the agent **once per image**. If
the caller passes more than one imageId, the agent reads only the first and
says so.

## 4. Agent Frontmatter

- `name: image-reader`
- `model: claude-sonnet-4-6` — the subagent does **no** vision itself
  (Qwen3-VL does the OCR host-side via `image_transcribe`); its own model only
  relays/formats the returned text and extracts a short facts list. A cheaper
  text model (e.g. `claude-haiku-4-5`) would suffice and is a candidate cost
  optimization — left at `claude-sonnet-4-6` (the pre-spike default) for
  safety. Cowork honors the agent `model:` pin.
- `tools: [image_transcribe]` (qualified as `mcp__genealogy__*` in the
  frontmatter, per the repo convention) — the agent's sole reader. It does not
  write `research.json` / `tree.gedcomx.json`, create assertions/sources, or
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
  (uncertain), `[illegible]`, `[torn]`; original spelling/language preserved.
  The transcription is never trimmed or slanted toward an expected answer.
- When `project_path` was given: the **saved-image** ref (`images/<key>.jpg`)
  from `image_transcribe`, so the caller can set the source's `image_filename`.
- An **extracted facts** list (names, dates, relationships, places) the
  caller can turn into assertions.
- If `looking_for` was set: `FOUND` / `NOT FOUND` + the matching line — as
  a pointer for the caller, never a substitute for the full transcription.

## 6. Failure Behavior

The agent's only reader is `image_transcribe` (host-side Qwen3-VL OCR, any
size, text out). A **genuine** failure is when it errors — an unreachable
image, or no OpenRouter key configured. On a genuine failure the agent **must
not** produce a transcription; a fabricated read is worse than a visible miss.
It returns:

- `NOT READ: <imageId>` on its own line;
- the **exact error message** `image_transcribe` returned, quoted verbatim;
- the pivot recommendation: read the **indexed** record for this image
  (`record_read` / `record_search` / `search-full-text`, or a related
  person's indexed record). If the failure was a missing/rejected OpenRouter
  key, note the caller can fix it via `configure_openrouter`.

It does **not** retry via browser / `web_fetch` / "Claude in Chrome"
(unavailable), and it never invents, infers, or guesses page contents when
the read failed. The caller decides the pivot. This guardrail turns a failed
read into a clean, visible miss instead of a silent fabrication.

## 7. Testing

The agent's **transcription** is not unit-testable: `image_read` cannot be
mocked as an image (the mock MCP server cannot emit image content blocks —
already exempt from tool-coverage checks), so like `gps-mentor` the reading
itself is validated at the **e2e** level.

The **delegation boundary** *is* unit-testable, and is now enforced rather
than graded. (This section previously said the whole path was untestable
because "the unit skill-runner backstops the `Task` tool as disallowed" —
that is stale: `Task` is in the baseline allowlist, and `DISALLOWED_BACKSTOP`
is only `["Bash", "WebFetch", "WebSearch", "NotebookEdit"]`.) The unit
harness's PreToolUse hook denies `image_read` on the main thread and fails the
run through the universal validator `test_no_main_thread_subagent_only_calls`,
so a caller that reads an image itself — the crash this agent exists to
prevent — is caught deterministically instead of by judge inference.

Two scope limits worth knowing:

- **The guard is per-skill.** It applies only to a skill that does *not*
  declare `image_read` in its own `allowed-tools` — i.e. one that holds the
  tool solely through `@plugin:image-reader`, like `record-extraction`.
  `search-images` declares it and browses volumes itself, so it is exempt.
- **Unit only.** e2e runs sub-skills in one session, so it cannot attribute a
  main-thread `image_read` to a skill and cannot apply the guard.

`harness/context_policy.py`; `docs/plan/image-read-context-policy.md` §4.1.
`ut_record_extraction_015` exercises the delegation path.

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

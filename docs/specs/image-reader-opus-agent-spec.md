# Specification: Image Reader (Opus) Agent

A Cowork plugin subagent that re-reads ONE FamilySearch page scan using its
own (Opus) vision, for pages the default reader's fast OCR handled poorly.
Sibling to `docs/specs/image-reader-agent-spec.md` — read that first; this
doc only covers what differs.

## 1. Purpose

`image-reader` (the default reader) OCRs a scan host-side via a hosted,
cheap, fast vision model (Qwen3-VL through `image_transcribe`) and returns
text. That model is not the strongest vision model available, and some
scans need better: badly faded ink, a difficult hand, Kurrentschrift.

This agent exists for exactly that gap, and only that gap. It is invoked
**explicitly** — never as part of any skill's default flow — and reads via
its own native vision rather than a hosted OCR call.

## 2. Why this agent calls `image_read`, not `image_transcribe`

`image_transcribe`'s OCR happens host-side, via a fixed vision model chosen
by the tool (OpenRouter/Qwen3-VL) — the calling agent's own model never sees
the pixels, so a caller pinned to Opus gains nothing by delegating to
`image-reader`; the read quality is set by the tool, not the agent.

To get Opus's own vision on the page, the agent needs the raw image handed
to *it*, which is what `image_read` does: it fetches the scan and returns it
as a real MCP `{type: "image"}` content block (`index.ts:291-297`) that the
calling agent sees directly. `image-reader-opus` is that caller — `model:
claude-opus-4-8`, tool: `image_read` only.

### 2.1 Why this doesn't need a new Anthropic API key or a `fidelity` param

An earlier design considered adding `fidelity: "high"` to `image_transcribe`
and having the *tool* call the Anthropic API directly on that path. That
needs its own credential, and where it comes from forks by environment (the
hosted sandbox has an operator key already in its process env; the desktop
`.mcpb`/Cowork does not, and would need a new per-user config field + a
`configure_anthropic` tool — asking a user to obtain and paste in a key they
don't have and shouldn't need). Routing the read through an Opus-pinned
*agent* instead avoids all of that: the agent's own inference is already
billed under whatever account is running the session, uniformly, in every
environment, because that account **is** what's running the agent. Both
Cowork and the Claude Agent SDK itself honor a subagent's own `model:`
frontmatter (confirmed: `proj_skill_model_frontmatter_inert_in_prod` memory;
this is SDK-level subagent-resolution behavior, not something either
integration layer constructs itself). No key, no bridge, no fork. Full
design history: `docs/plan/image-reader-opus-agent-plan.md`.

## 3. Files to Create / Modify

- **Create** `packages/engine/plugin/agents/image-reader-opus.md` — the agent.
- **Modify** `packages/engine/mcp-server/src/tools/image-read.ts` — add optional
  `projectPath` input / `imageRef` output, mirroring `image_transcribe`'s save
  behavior via the same `saveSourceImage` util, so an Opus-read page can be
  cited as a retained source's `image_filename` the same way a fast-path read
  can.
- **Modify** `docs/specs/image-read-spec.md` — document the `projectPath`/
  `imageRef` addition.
- **Modify** `record-extraction/SKILL.md` and `search-images/SKILL.md` — a
  one-line discoverability pointer (literal `@plugin:image-reader-opus`) in
  each skill's existing "when the reader's output looks unreliable" prose.
  This placement is load-bearing, not just documentation: the unit harness's
  `compute_allowed_tools` unions a delegated agent's tools into a skill's
  session **only** by scanning that skill's own `SKILL.md` body for a literal
  `@plugin:<name>` reference — it does not recurse into an agent's own file.
  A pointer placed only in `image-reader.md` would leave `image-reader-opus`
  spawnable but toolless in the unit harness. Verified with a test against the
  real files (`test_allowed_tools.py`), not just asserted from the mechanism.

## 4. Invocation

Invoked via `@plugin:image-reader-opus`, **only when explicitly asked** for a
higher-accuracy re-read of a specific page — never automatically, and never
as part of any skill's default routing. No skill delegates to it as a matter
of course; both skills that reference it do so only in an escalation
footnote for a caller who already has a reason to expect a better read.

### 4.1 Input convention

Same as `image-reader`'s (§3.1 of its spec): `imageId` (required, single
image), `looking_for` (optional search key, never the expected result),
`project_path` (optional, threads to `image_read`'s new `projectPath`).

### 4.2 One image per invocation

Same rule as `image-reader`, for the same provenance reason. Unlike
`image-reader`, this agent's tool (`image_read`) does put real bytes into its
own context — but since each invocation is a fresh, isolated, one-shot
subagent run that ends after returning text, there is no persistent context
for those bytes to accumulate into across separate invocations. The
remaining constraint is simply `image_read`'s existing single-call size
ceiling (`MAX_INLINE_IMAGE_BYTES`, ~700 KB raw / ~933 KB base64) — already
enforced in code, nothing new needed.

## 5. Agent Frontmatter

- `name: image-reader-opus`
- `model: claude-opus-4-8` — the whole point of this agent is that its *own*
  model does the reading.
- `tools: [image_read]` — both server spellings, per the repo convention.
  No other tools: this agent does not write `research.json` / tree, create
  assertions/sources, or search indexes.
- `description:` worded **narrowly** — an explicit re-read request, not a
  general "reads a FamilySearch image" description. A broad description risks
  the Cowork orchestrator auto-routing an ordinary "read this image" ask to
  the expensive path instead of `image-reader`. This is the one place the
  "explicit only" constraint could quietly leak past the design.

## 6. Output Protocol

Same shape as `image-reader`'s (§5 of its spec): text only, full faithful
transcription of every relevant entry (never trimmed toward `looking_for`),
saved-image ref when `project_path` was given, an extracted-facts list, and a
`FOUND`/`NOT FOUND` pointer when `looking_for` was set.

**The anti-slant charter is weaker here than on the fast path, and the agent
body says so explicitly.** `image_transcribe`'s prompt is baked into the tool
— the caller cannot alter it. `image_read` hands the agent a bare image with
no prompt at all, so "transcribe faithfully, don't slant toward the caller's
assertion" is enforced by agent-body prose only, with no tool-side backstop.
The agent's charter section is written to be more insistent and repeated
than `image-reader`'s for exactly this reason.

## 7. Failure Behavior

Same shape as `image-reader`'s §6: a genuine failure (`image_read`'s size
refusal, or any fetch error) returns `NOT READ: <imageId>` + the exact error
+ a pivot recommendation (try `image-reader`/`image_transcribe`, which has no
size limit, or read the indexed record). Never a fabricated read.

## 8. Testing

Like `image-reader`, this agent's **transcription** is not unit-testable —
`image_read` cannot be mocked as an image (mock MCP server limitation,
already exempt from tool-coverage checks) — so read quality is validated at
the e2e / live-smoke level, not the unit level.

Unlike `image-reader`, the **delegation-union mechanism** for this agent
specifically needs its own test (not just delegation-boundary enforcement):
`test_allowed_tools.py`'s `test_record_extraction_unions_image_reader_opus_image_read`
and `test_search_images_unions_image_reader_opus_image_read` assert
`mcp__genealogy__image_read` actually appears in each skill's computed
allowlist — guarding against the exact placement bug this design caught in
review (§3 above).

**The validation run must genuinely read a real, hard-to-OCR scan** — not
just any scan, and not a run that merely finishes without crashing (same
standard as `image-reader-agent-spec.md` §7's "clark-parents" lesson). Read
quality is this agent's entire reason to exist; a smoke run against an easy
page proves nothing about it.

## 9. Known limitation: the size ceiling

This agent inherits `image_read`'s existing 700 KB raw / ~933 KB base64
ceiling (§4.2) rather than getting its own — reused "for free" on the
reasoning that it's just a per-call transport-size limit, nothing new to
build. Live-tested 2026-07-24 against **7 real scans, not one**: two German
civil/church register volumes (`004764543_00001`/`00271`,
`ark:/61903/3:2:77P1-FRQ`/`77T6-B33`) and a fifth from a different collection
(`3Q9M-CSS8-G345-B`) all exceeded 700 KB (1.2–1.5 MB, one at 0.8 MB) and were
refused outright; only `image_transcribe` (no size limit) could read them.
Two smaller single-sheet US documents (419 KB, 384 KB) succeeded, but neither
was a genuine hard-handwriting case. **The pattern is format/collection, not
legibility**: bound European register books scanned as full high-DPI pages
run consistently over the cap regardless of how hard the handwriting actually
is; single-sheet US-style documents tend to land under it. This is the
central irony of the size gate: the scans most likely to need this agent's
higher-accuracy read are also the ones most likely to be too large for it.

**The 700 KB figure is not a hard wall — it's derived from
`claude_agent_sdk`'s configurable `max_buffer_size` (default 1 MiB,
`subprocess_cli.py:30`), which the e2e harness already overrides to 10 MiB
for this exact class of crash (`e2e/orchestrator.py:752`).** But that
override is scoped to e2e's own harness config only, by its own comment; the
hosted web workbench (`apps/server/app/agent/real_agent.py`) sets no
override (still the 1 MiB default), and Cowork/Desktop production doesn't run
through this Python SDK transport at all — a different, closed-source
client, real ceiling unverified. So raising `MAX_INLINE_IMAGE_BYTES` isn't
just a matter of picking a bigger number: it can only safely go as far as the
actual deployed `max_buffer_size` in *every* environment the tool runs in,
and that's unverified for the one environment that matters most (Cowork
production).

**Decision (Dallan, 2026-07-24): leave the cap as-is.** The agent's `NOT
READ` failure path already recommends `image-reader`/`image_transcribe` as
the pivot, so an oversized scan degrades to the fast path rather than failing
silently. Before ever raising the ceiling: verify Cowork production's actual
transport limit live (same open observation `image-read-context-policy.md`
§5 already calls for), and add a matching `max_buffer_size` override to the
hosted web workbench if raising there too. Giving this agent its own larger
ceiling, or exploring a downscale-before-read path (needs an image-processing
dependency in the cross-platform `.mcpb`, previously deferred for the same
reason — see `image-read-spec.md`), are both still on the table but blocked
on that verification, not on more usage data. Tracked: `docs/TODOs.md`.

## 10. Boundaries

Same as `image-reader`'s: reads one image, returns text, does not write
project state, does not search indexes, never asks the caller to fetch the
image itself. Additionally: never invoked automatically, never the default
for a first-pass read, and never used for routine browsing — cost and
latency make casual use a misuse of the agent, not a normal call.

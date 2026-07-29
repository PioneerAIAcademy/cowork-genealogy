# An explicit, opt-in Opus read path for hard-to-OCR images — plan

> **Status: SHIPPED.** The agent exists
> (`packages/engine/plugin/agents/image-reader-opus.md`), it has a spec
> (`docs/specs/image-reader-opus-agent-spec.md`), and `record-extraction` /
> `search-images` both offer `@plugin:image-reader-opus` as the opt-in re-read.
> The spec is the contract; this file is kept only for the §7 open question it
> records (see below) and should be deleted once that is resolved or moved.
> Builds on, and does not reopen,
> `docs/plan/image-read-context-policy.md` and
> `docs/plan/search-images-base64-accumulation.md`, both already implemented.
> §7 flags one adjacent, unresolved idea from the same conversation that
> conflicts with a decision those plans already made — it is deliberately
> **out of scope** for this plan's DoD.
>
> **Revised after an adversarial review pass, then corrected by Dallan
> (2026-07-24).** The review caught a real placement bug that would have made
> the agent's own tool grant unreachable in the unit harness (§3.4, fixed) and
> a real weakening of the anti-slant guarantee versus the fast path (§3.1,
> now flagged there) — both stand. Two of the review's other findings were
> themselves corrected by Dallan, not accepted as written: the "two ~458 KB
> scans accumulate" crash risk it raised against this agent (§3.6) described
> the old, now-retired architecture where a router called `image_read`
> directly and repeatedly in one persistent session context; it doesn't apply
> to a fresh, isolated, one-shot subagent invocation, where the actual
> constraint is just the per-call size ceiling `image_read` already enforces
> (§3.6, corrected). And model-pin honoring, which the review flagged as
> verified for Cowork but unconfirmed for the hosted web workbench, is in fact
> SDK-level behavior that both environments honor (§2.1, corrected).

## 1. Where this starts

Today, reading a FamilySearch page scan goes through exactly one path in the
plugin:

```
search-images / record-extraction skill
  → @plugin:image-reader subagent   (model: claude-sonnet-4-6, tool: image_transcribe only)
    → image_transcribe({ imageId|ark, lookingFor?, projectPath? })
      → OCRs host-side via OpenRouter (default Qwen3-VL), returns TEXT
```

`image_transcribe`'s OCR prompt is baked into the tool, not caller-supplied
(`image-transcribe.ts:19-39`) — the caller cannot slant or shorten what gets
transcribed. The bytes never cross the MCP transport (`image-transcribe.ts:72-73`
base64-encodes them into a `data:` URL sent host-side to OpenRouter, not back to
the caller), so there is no size cap and no accumulation risk on this path.

`image_read` — which fetches the same bytes (`fetchFsImageBytes`,
`fs-image-fetch.ts:95`, shared by both tools) and returns them as an inline MCP
`{type:"image"}` block (`index.ts:291-297`) — is **not called by anything in the
plugin today**. Both `docs/plan/image-read-context-policy.md` and
`docs/plan/search-images-base64-accumulation.md` record why: when a **skill**
(not an isolated agent) called it directly and repeatedly, each page's base64
stayed resident and re-serialized into every subsequent turn for the rest of
that skill's run, so blobs from separate reads piled up cumulatively until one
re-serialized message blew the transport's ~1 MiB buffer and crashed the
session — observed at 17 calls in one e2e run (`image-read.ts:7-12`).
`search-images` used to call `image_read` directly for browsing and was moved
onto `@plugin:image-reader` for exactly this reason
(`search-images-base64-accumulation.md` §5); `record-extraction` was guarded
against calling it on the main thread by a unit-harness PreToolUse hook
(`image-read-context-policy.md` §4). Both plans conclude the tool is fine — the
*context it runs in* is what's dangerous, specifically a **persistent,
multi-turn** context. An isolated one-shot subagent invocation, which ends
after one read, doesn't have that persistent context to accumulate into — see
§3.6.

**The gap:** the fast/Qwen OCR is sometimes just wrong — badly faded ink, a hard
hand, Kurrentschrift — and there is currently no way to ask for a better read of
one specific page. Qwen3-VL is cheap and fast by design; it isn't the strongest
vision model available.

## 2. What this plan adds

One new agent. No changes to `image_transcribe`, no new MCP tool, no new
per-user config field, no changes to `record-extractor`.

```
image-reader-opus  (NEW agent)
  model: claude-opus-4-8
  tools: image_read only (dual-spelled)
  → calls image_read({ imageId|ark }) → gets a REAL MCP image content block
    (confirmed: index.ts:297 wraps it as {type:"image", data, mimeType} — the
    model genuinely sees it, not a base64 string as text)
  → transcribes it with its OWN multimodal weights, in an isolated one-shot
    subagent context, exactly the isolation/one-image discipline
    `image-reader` already uses for image_transcribe
  → returns text only
```

Invocation is **only** by explicit delegation — a top-level Claude (or the user)
naming this agent because a specific page needs a better read than the fast
path gave. No skill's default flow ever references it. This is what "explicit,
no other option" means operationally here: the constraint isn't a parameter a
caller might forget to set, it's that no code path reaches this agent except a
deliberate `@plugin:image-reader-opus` delegation.

### 2.1 Why not a `fidelity` param on `image_transcribe` calling Anthropic directly

The alternative considered and rejected earlier in this design's discussion:
add `fidelity: "high"` to `image_transcribe`, and on `high` have the *tool*
place an HTTP call to `api.anthropic.com` instead of OpenRouter. That needs its
own Anthropic API key, and where that key comes from forks badly by
environment:

- **Hosted web workbench** (`apps/server`, E2B): the MCP server subprocess runs
  inside the same sandbox environment the operator's `ANTHROPIC_API_KEY` is
  injected into per-connect (`agent_secrets.py`, consumed by
  `real_agent.py:113`; `sandbox_server.py:16` lists it among the env vars the
  sandbox process sees). A tool-side call *could* read it — but only there.
- **Desktop `.mcpb` / Cowork**: the MCP server is a bare Node process on the
  user's own machine, launched by Claude Desktop config. It never sees Claude
  Desktop/Cowork's own OAuth session as a key — that session lives inside the
  app, not exposed to spawned MCP server processes. Reaching Opus this way
  would need a **new** `anthropicApiKey` per-user config field and a
  `configure_anthropic` tool (mirroring `openRouterApiKey`), i.e. asking a
  Cowork user to obtain and paste in a separate Anthropic Console API key —
  something they don't have and shouldn't need, since they're already paying
  for a Claude subscription that is running the very session asking them for
  one.

**Model-pin behavior, confirmed (Dallan, 2026-07-24):** both Cowork and the
Claude Agent SDK itself honor a subagent's own `model:` frontmatter — this is
SDK-level behavior, not something either integration layer (Cowork's bridge or
`apps/server`'s `real_agent.py`) has to construct itself. That matches what
`real_agent.py:93` shows: it builds `ClaudeAgentOptions` with a single
top-level `model=os.environ.get("MODEL") or None` and no `agents=` map of
per-agent overrides — because it doesn't need one; the SDK's own Task-subagent
mechanism reads the staged `.md` frontmatter directly, in both environments.
So `image-reader-opus`'s `model: claude-opus-4-8` pin is honored uniformly, in
Cowork/desktop and the hosted web workbench alike, without extra plumbing —
this is not scoped to "Cowork only" the way SKILL-level `model:` pinning is
(that one really is inert in production; agent-level pins are the established
exception, per `proj_skill_model_frontmatter_inert_in_prod.md`).

There's also a house-style objection, not just a product one:
`auth/config.ts:133-136`'s comment on `getOpenRouterApiKey` — *"config-only (no
env-var fallback, per the repo rule): the server reads it here in every
runtime. e2e and the hosted sandbox bridge their env var into config.json at
the orchestration layer"* — states the established pattern for getting an
orchestration-layer secret to the MCP server: the **orchestrator** bridges it
into `~/.familysearch-mcp/config.json`, the tool never reads `process.env`
itself. A tool-side `getAnthropicApiKey()` checking `process.env.ANTHROPIC_API_KEY`
first would either invent a new env-var-fallback exception to that rule, or
require plumbing a bridge that doesn't exist for this key today. Neither is
needed once the read happens inside the *agent's own inference* rather than a
tool-side HTTP call: the agent's model calls are already billed under whatever
account is running the session, in every environment, uniformly, because that
account **is** what's running the agent. No key, no bridge, no fork.

## 3. Design detail

### 3.1 The agent file

`packages/engine/plugin/agents/image-reader-opus.md`, structured like the
existing `image-reader.md`:

- `model: claude-opus-4-8`
- `tools:` — both spellings, only `image_read`:
  ```
  - mcp__genealogy__image_read
  - mcp__remote-devices__Genealogy_Research__image_read
  ```
- `description:` must be worded **narrowly** — "use only when explicitly asked
  to re-read a specific page with higher accuracy than the default OCR (e.g.
  the fast read came back heavy with `[illegible]`, faded ink, difficult
  handwriting/Kurrentschrift)" — not "reads a FamilySearch image", which would
  risk the Cowork orchestrator auto-routing ordinary "read this image" phrasing
  to the expensive path instead of `image-reader`. This is the one place the
  "explicit only" constraint could quietly leak past the design, so the
  description text is load-bearing, not cosmetic.
- Same invocation contract as `image-reader.md` (`imageId`/`ark`, optional
  `looking_for`, optional `project_path`) and the same **one image per
  invocation** rule stated in its prose — but see §3.6: for this agent, unlike
  the fast one, that rule is the *only* thing preventing a crash, and nothing
  enforces it today.
- Same "faithful OCR, not answering the caller's question" charter as
  `image-reader.md:23-27` — this agent transcribes, it doesn't judge or
  compress (see §7 for why that distinction matters).

  **This charter is weaker here than on the fast path, and that's a real gap,
  not a wording detail.** `image_transcribe`'s anti-slant guarantee is
  *structural* — the OCR prompt is baked into the tool itself
  (`buildOcrPrompt`, `image-transcribe.ts:19-39`), the caller cannot alter it,
  and `lookingFor` only appends a FOUND/NOT-FOUND line that "must not change or
  shorten the transcription above." `image_read` has no prompt at all — its
  schema takes only `imageId`/`ark` (`image-read.ts:94-114`) — so on this
  agent the entire "transcribe faithfully, don't slant toward the caller's
  assertion" instruction is **prose in the agent body**, enforced by nothing
  else, while Opus does the read with the caller's `looking_for`/assertion
  sitting in its own context. That is the same shape of risk
  `search-images-base64-accumulation.md`'s Option-B rejection names —
  "asking the reader for specific information was previously found to
  encourage hallucination." Mitigate by making the anti-slant instruction
  more insistent and repeated than `image-reader.md`'s (it has no tool-side
  backstop to lean on), and treat this as something the adversarial/genealogist
  review of the actual agent prose should scrutinize specifically, not assume
  is inherited for free from `image-reader.md`.
- Its "what to do" step reuses `image-read`'s existing 700 KB
  `MAX_INLINE_IMAGE_BYTES` ceiling (`image-read.ts:37`) as the de facto "small
  images only" gate — no new size check to write. On the tool's existing
  refusal error (`image-read.ts:57-66`, which already recommends
  `image_transcribe` as the pivot), the agent returns `NOT READ` and points back
  to the fast path, mirroring `image-reader.md`'s "when an image can't be read"
  section.

### 3.2 `image_read` parity addition — `projectPath` → `imageRef`

`image_read` currently has no way to save the fetched scan for citation, unlike
`image_transcribe` (`image-transcribe.ts:148-159`, via `saveSourceImage`). If
`record-extraction` is going to cite an Opus-read page as a retained source, it
needs the same `imageRef` a fast-path read already provides. Add an optional
`projectPath` input to `image_read`'s schema, threaded to the same
`saveSourceImage({ projectPath, imageKey, bytes })` (`image-store.ts:38-43`)
both tools already sit on top of via `fetchFsImageBytes`. Same best-effort
semantics as `image_transcribe`'s existing save (a save failure omits
`imageRef` rather than losing the read).

### 3.3 Discoverability, without auto-escalation — and where the pointer must actually live

**Corrected after review: the pointer cannot live in `image-reader.md`.**
`allowed_tools.py`'s union (`compute_allowed_tools`, :65-68) only grants a
delegated agent's tools to a skill's session by scanning that **skill's own
`SKILL.md` body** for a literal `@plugin:<agent-name>` reference
(`agent_refs_for_skill`, :112-117, via `agent_refs_in_text`'s
`_AGENT_REF_RE` in `snapshot.py:41`, matched against SKILL.md text only). It
does **not** recurse into an agent's own body. A pointer placed only in
`image-reader.md` (an agent, not a skill) is never scanned by this mechanism —
`image-reader-opus`'s `image_read` grant would never be unioned into any
session, and under the unit harness's deny-by-default construction
(`disallowed_tools = DISALLOWED_BACKSTOP + (all_mock_mcp − allowed_set)`,
`image-read-context-policy.md` §2) that means the agent spawns but its one
tool is denied — dead on arrival, with nothing failing loudly enough to catch
it.

The fix: put the one-line discoverability pointer in a **`SKILL.md`** body —
`record-extraction/SKILL.md` and `search-images/SKILL.md`, wherever each
already documents the fast reader's "when garbled" handling — as a literal
`@plugin:image-reader-opus` mention. This is not a contradiction of §2's "no
skill's default flow ever references it": an escalation footnote naming the
agent for a caller who explicitly wants a better read is not itself a routing
step in the skill's normal execution path, the same way `image-reader.md`
mentioning `record_read`/`record_search` as a pivot-on-failure option doesn't
make those part of its own tool grant. The agent **never invokes itself** —
this is a one-line pointer so a genealogist doesn't have to already know the
option exists, surfaced from whichever skill the caller is in, not an
escalation the system takes automatically.

### 3.4 Harness visibility

Given §3.3's corrected placement, the requirement is satisfied automatically
by the same mechanism that already makes `image-reader`'s own
`image_transcribe` grant work: once at least one `SKILL.md` contains the
literal string `@plugin:image-reader-opus`, `compute_allowed_tools` unions in
`image-reader-opus.md`'s dual-spelled `image_read` grant for any unit-harness
run of that skill. Nothing new to build — just a placement requirement to get
right when writing the prose, and one worth a dedicated packaging/harness
smoke check (§5) rather than trusting the prose was written in the right
file.

### 3.5 Compatibility with the existing `context_policy.py` guard

No changes needed for **main-thread misuse**, verified against the actual
predicate rather than assumed: `subagent_only_violation`
(`context_policy.py:86-117`) requires, as its second of three conditions, that
the call be on the main thread — `is_subagent_call` (`:71-83`) returns
`"agent_id" in input_data`, and `agent_id` is present on every PreToolUse
firing from inside a Task-spawned subagent (probe-verified in
`image-read-context-policy.md` §3.1). Every `image_read` call this new agent
makes carries `agent_id`, so condition 2 fails and it is never a main-thread
violation regardless of which skill delegated to it or what that skill's own
`declared_tools` set contains. `SUBAGENT_ONLY_TOOLS` (`:56`) does not need
`image-reader-opus` added to any list — the guard was already built to let
exactly this kind of call through; it only polices the *router* calling
`image_read` directly. **This says nothing about how many times the subagent
itself may call `image_read`, which is the actual open risk — see §3.6.**

### 3.6 Size ceiling, corrected — a per-call limit, not an unsolved accumulation problem

The review's citation here (`image-read.ts:28-31`'s "two ~458 KB scans already
sum past the buffer") describes the **old, now-retired architecture**: before
`image-reader` existed as a delegation pattern, `search-images`/an early
router called `image_read` **directly, repeatedly, in its own long-lived
session context** — each read's base64 stayed resident and was re-serialized
into *every subsequent turn for the rest of that session*, so blobs from
successive, separate reads piled up cumulatively (the cited e2e run hit 17
such calls before crashing). That accumulation-across-many-calls-over-many-turns
scenario is what the comment is about, and it no longer applies to either
current read path:

- `image_transcribe` (OpenRouter) never returns bytes at all — any size, no
  cap, confirmed already in §1.
- `image-reader-opus` reads inside a **fresh, isolated, one-shot subagent
  invocation** that returns text and is discarded. There is no persistent,
  multi-turn context for blobs to accumulate *into* the way the old direct-router
  pattern had — each invocation starts clean. Per the one-image-per-invocation
  contract (§3.1), the constraint narrows to a straightforward **per-call size
  ceiling** for the single image being read: `image_read`'s existing
  `MAX_INLINE_IMAGE_BYTES = 700_000` (`image-read.ts:37`, ~700 KB raw → up to
  ~1 MB base64) already enforces this in code today — nothing new to build.

Net: no unresolved enforcement gap here. The size ceiling this agent needs is
the one `image_read` already has.

## 4. What stays unchanged

- `image_transcribe` — no `fidelity` param, no branch, no new dependency.
  Untouched.
- `record-extractor` — still has no image tool of any kind. It receives
  transcription text from whichever reader agent (fast or Opus) was delegated
  to, same as today. This plan does not move OCR responsibility onto it.
- `volume_search` / `image_search` — unaffected; still the discovery path that
  hands `image-reader`/`image-reader-opus` an `imageId`.
- `image-reader` (the fast/Qwen agent) — unchanged behavior, aside from the
  one-line discoverability pointer in §3.3.

## 5. Sequencing / DoD

1. Write `agents/image-reader-opus.md` per §3.1, including the strengthened,
   repeated anti-slant instruction called for at the end of §3.1 (no tool-side
   backstop exists here, unlike `image-reader`).
2. Add `projectPath`/`imageRef` to `image_read`'s schema + implementation +
   type (`ImageReadInput`/`ImageReadResult`) per §3.2; update
   `docs/specs/image-read-spec.md` to match — and while in that file, note
   (separately, not blocking) that its Output/Errors sections and "downstream
   use" list are independently stale (no save path documented, pre-dates
   `image_transcribe`, still cites Gemini/Mistral/Claude 3.5) — worth its own
   cleanup pass, not folded into this plan's diff.
3. Add the one-line discoverability pointer (literal
   `@plugin:image-reader-opus` string) to `record-extraction/SKILL.md` and/or
   `search-images/SKILL.md` — **not** `image-reader.md` — per the corrected
   §3.3/§3.4.
4. New/updated tests: `tests/tools/image-read.test.ts` for the `projectPath`
   addition; packaging test coverage (`tests/packaging/agent-tool-names.test.ts`)
   picks up the new agent's dual-spelled tools automatically (confirmed: it
   auto-discovers agents via directory scan, no separate registration needed),
   but confirm it passes rather than assuming. Add a harness-level check (a
   unit test run against whichever skill carries the §3.3 pointer) that
   actually exercises `compute_allowed_tools` unioning in `image_read` for
   that skill — the placement bug in this plan's first draft (§3.3/§3.4) is
   exactly the kind of mistake that would otherwise pass code review silently.
5. **DONE (2026-07-24), and it turned into the most consequential finding in
   this whole plan.** 7 live `image_read` calls across real FamilySearch
   scans: 5 refused outright (700 KB–1.5 MB, all bound European
   register-book pages — two different volumes), 2 succeeded (single-sheet US
   documents, 419 KB / 384 KB — neither a hard-handwriting case). **Read
   quality is still unvalidated** — every sample that could plausibly need
   Opus's better vision was also too large for `image_read` to fetch at all,
   so the "prove Opus reads a hard scan better" question this DoD item was
   meant to answer remains open. Per `image-reader-agent-spec.md` §7's "a run
   that merely finishes without crashing is not sufficient" — same standard
   applies, and here even that bar wasn't reached for the target use case.

   What *did* come out of chasing this: the "~1 MiB" transport figure is not
   fixed — it's `claude_agent_sdk`'s configurable `max_buffer_size`, and the
   e2e harness already overrides it to 10 MiB for this exact reason
   (`e2e/orchestrator.py:752`), but that override is e2e-only; the hosted web
   workbench has no equivalent, and Cowork production's real ceiling is
   unverified (different, closed-source client). So the fix isn't "raise
   `MAX_INLINE_IMAGE_BYTES`" — it's "verify Cowork's actual limit first,"
   which is the same open item `image-read-context-policy.md` §5 already
   named. Full writeup: `image-reader-opus-agent-spec.md` §9, `docs/TODOs.md`.
   **Still outstanding:** an actual successful read of a genuinely hard scan
   under the cap, to validate read quality at all — nothing tested so far
   has reached that bar.
6. Manifest/doc updates: `README.md`'s agent catalog, `docs/specs/image-reader-agent-spec.md`
   gets an `image-reader-opus` sibling spec (or an addendum — reviewer's call).

**DoD:** `image-reader-opus` exists, is invocable only by explicit delegation,
never appears in any skill's *routing* logic (only in an escalation footnote,
per §3.3); harness visibility is confirmed by an actual test exercising the
union, not just asserted from the mechanism; and `image_read`'s `projectPath`
addition has parity test coverage with `image_transcribe`'s existing save
path.

## 6. Risks

- **The anti-slant charter is prose-only here, not tool-enforced — see the
  note at the end of §3.1.** `image_transcribe` structurally can't be steered
  by the caller's assertion; `image_read` has no prompt at all, so this
  agent's faithfulness rests entirely on its own body text.
- **Cost/latency surprise.** Opus vision is slower and far more expensive than
  Qwen3-VL per page. The agent description and any user-facing mention should
  say so plainly, so nobody reaches for it as a default habit.
- **Description drift.** If `image-reader-opus`'s description is loosened over
  time (e.g. to improve trigger recall), it risks becoming broad enough for the
  Cowork orchestrator to auto-route ordinary reads to it, silently reintroducing
  an implicit "fidelity default" this plan is specifically designed not to have.
  Any future edit to that description should be checked against this.
- **`image_read`'s revival is scoped, not a reversal.** This plan does not
  reopen `image_read` for general use — it remains absent from every skill's
  `allowed-tools` and from `record-extractor`'s and `image-reader`'s (the fast
  agent's) tool grants. Its only caller is `image-reader-opus`, one image per
  isolated invocation, under the same per-call size ceiling the tool already
  enforces (§3.6) — a narrower revival, not a loosening of the rule the two
  prior plans established.
- **Production grant is still an open question inherited from
  `image-read-context-policy.md` §5.** That plan left unresolved whether
  Cowork's production session set even grants `image_read` to a delegated
  subagent at all (either image reading is broken, or the crash is reachable —
  §5 there). This plan reintroduces `image_read` as a tool a subagent
  genuinely calls in production, so that open question now applies here too,
  not only to the router-misuse case §3.5 covers.

## 7. Explicitly out of scope — flagging a conflict, not resolving it

Earlier in the conversation that produced this plan, a second idea was raised
independently: for `search-images`' volume browsing, keep only the
*likely-matching* page's full transcription in the caller's context, and
compress non-matching pages to a one-line verdict, so a ten-page browse doesn't
accumulate ten full transcriptions.

**This conflicts with a decision already made and recorded.**
`search-images-base64-accumulation.md`'s header quotes Dallan's 2026-07-17
decision directly: *"Option B (a targeted 'quick look' reader) was rejected on
a correctness ground, not just cost: asking the reader for specific information
was previously found to encourage hallucination, whereas `image-reader`'s
contract is faithful full-OCR that never slants toward an asked-for answer."*
The compression idea above is Option B's shape — a reader that sometimes
returns a short judgment instead of a full transcription — and that plan rules
it out, not defers it.

One candidate distinction that might make compression safe where Option B
wasn't: gate the caller-facing compression on `image_transcribe`'s own
`found`/`NOT FOUND` field, which is deterministically regex-parsed
(`parseFound`, `image-transcribe.ts:41-53`) off a **forced, always-full**
transcription the tool produces regardless — i.e. the full-fidelity OCR still
happens every time, and only the *relay* is conditional, keyed off a
mechanical parse rather than a fresh relevance judgment made by the relaying
agent. Whether that distinction actually avoids the hallucination failure mode
`search-images-base64-accumulation.md` found, or is a distinction without a
difference, is **not resolved here** — it needs the same kind of scrutiny (and
likely the same genealogist judgment call) that decided Option B, not a
unilateral call folded into this plan's DoD. Recommend: file as its own
`docs/TODOs.md` entry or a follow-up plan doc that cites this section, and keep
it out of `image-reader-opus`'s implementation.

# TODOs — hosted web workbench

Open, deferred work — everything in this file is still to do. Architecture
context: `docs/realtime-architecture.md`.

**Retention rule.** When an item ships, **delete it** — do not check it off,
strike it through, or move it to a "Done" section. If it leaves behind a rule
worth keeping ("don't re-derive X", "the original premise was wrong"), that
belongs in the spec, `CLAUDE.md`, or a code comment, where the next person will
actually be standing when they need it. If it leaves a residual gap, promote the
residual to its own entry here. Git history keeps the prose either way. This is
the same rule `docs/plan/` already follows, and it is not optional bookkeeping:
a Done tier is how this file reached 932 lines with 29 open items filed
underneath it.

## Alpha readiness — deliberately deferred (2026-07-18)
Surfaced while preparing for the first alpha testers and consciously left for
later. Each was judged not to affect a tester's experience; the reasoning is
recorded so it can be re-examined rather than re-derived.

- [ ] **Session cost does not survive a page reload** — `SessionView.tsx` sums
  per-turn usage into component state, so a refresh restarts the count. The chip
  is now shown to all users (it was behind `?alpha=1`), which makes the reset
  user-visible; the tooltip says "counted since this page loaded" as the interim
  honesty measure. Real fix: a `Project.cost` column accumulated server-side.
  Accepted for the alpha (2 testers, no spend cap in play).

- [ ] **Per-user spend cap** — there is no cost, turn, or session cap anywhere in
  the control plane, and sandboxes pause but are never reaped. Tolerable at two
  testers with the cost now visible on every screen; needed before the tester
  count grows. Opus was removed from the model picker in the meantime
  (`SessionList.tsx`) since it is ~5× the cost.

- [ ] **Feedback Drive endpoint accepts unauthenticated writes** — the Apps
  Script URL is hardcoded in a shipped client and committed to git, deployed with
  "anyone" access, and `doPost` validates only that the fields are present. So
  anyone holding the URL can write arbitrary files into the team Drive folder.
  Explicitly deferred: harden later.

- [ ] **`feedback-json-spec.md` §6 contradicts the code on thinking blocks** —
  the spec says thinking is stripped before writing the session log; both
  bundlers deliberately **keep** it (it is the highest-value triage signal) and a
  test pins that behaviour. The user-facing copy in `FeedbackDialog.tsx` was
  corrected 2026-07-18; the spec still needs to catch up. Fix the spec, not the
  code.

- [ ] **GEDCOM import** — no GEDCOM 5.5 parser exists anywhere in the repo, and
  ingesting one needs a parser plus a mapping onto simplified GedcomX plus merge
  semantics against an existing tree. Alpha testers enter their starting tree
  conversationally instead (`init-project` builds local stub persons from what
  they type), and `docs/alpha-user-guide.md` says plainly that import is not
  available.

## Pre-production

- [ ] **Delete-janitor** — GC E2B sandboxes for sessions idle > N days (cost).
  There is no in-session reaper (E2B's `on_timeout: pause` lifecycle is the idle
  backstop; C5 removed the in-CP idle loop). This is only for *abandoned*
  sessions: a background task / cron that lists sandboxes whose project
  `last_active` is older than N days and deletes them.

- [ ] **`ws_signing_key` prod guard** — it defaults to
  `dev-ws-signing-key-change-me` (`config.py`). Make the control plane refuse to
  start in prod (e.g. when `PUBLIC_URL` is https, or behind an explicit flag) if
  it's still the dev default, so a deploy can't silently mint forgeable
  per-sandbox WS tokens.

- [ ] **`WS_TOKEN_SECRET` is still create-time env** — the last instance of the
  anti-pattern #762 removed for the Anthropic key ("a sandbox's environment is
  fixed at `create()`"). `E2BProvider.create` bakes
  `HMAC(ws_signing_key, sandbox_id)` into the WS server's process env
  (`sandbox/e2b.py`), and that server is deliberately never restarted across
  pause/resume, so rotating `ws_signing_key` orphans every existing sandbox: the
  CP mints against the new key, the sandbox verifies against the old one, and
  every handshake fails `bad/expired token` with no recovery but a new session.
  It cannot use the decision-#2 secrets *file* — the WS server reads its secret
  once at boot, not per turn — so the fix is either a restart-on-connect when the
  derived secret has changed, or a key-id in the token so the sandbox can verify
  against the key that minted it. Not urgent: rotation is rare and the alpha hang
  was TTL expiry, not rotation.

- [ ] **`tool_result` is correlated to its chip by tool NAME, not id** —
  `real_agent.map_message` resolves `tool_use_id → name` correctly, then
  `ChatPane` re-matches with `findIndex((t) => t.tool === ev.tool && !t.done)`.
  Parallel calls to the same tool (several `mcp__genealogy__*` searches at once,
  or two subagents both running `Bash`) mark the wrong chip done. The id is
  available at the boundary and is discarded; carry it into the event and match
  on it. Cosmetic today, but it misreports which call is still running.

- [ ] **Operator misconfiguration reaches the user as a raw SDK error string** —
  when the Agent SDK's first call fails auth, `real_agent.handle_turn` wraps the
  exception verbatim (`_event("error", text=f"Agent error: {exc}")`) and
  `ChatPane` renders it as-is, so an alpha tester saw *"Failed to authenticate.
  API Error: 401 API key is invalid."* after ~90s of waiting — a message about
  the operator's Anthropic key, phrased as if it were about the tester's own
  login. Two testers each reported it as a FamilySearch problem, which is the
  real cost: it sends people to debug the wrong credential. Wanted: classify the
  failure in `handle_turn` and emit an operator-vs-user framing — 401/403 from
  the SDK → "This service is misconfigured; the administrator has been notified"
  (plus a server-side log loud enough to page), while genuinely user-actionable
  failures (an expired FamilySearch token) keep their current specific wording.
  Surfaced by the 2026-07-20 outage; the credential-freeze half of that bug is
  fixed (`app/agent_secrets.py`), this half is not.

- [ ] **`make agent-smoke` is a manual gate — no CI job can catch hosted-path
  agent-loading drift.** The guard added with #939
  (`apps/server/tests/test_plugin_agents.py::test_bare_agent_names_are_registered`)
  reads the runtime's resolved agent list out of the SDK init handshake, which
  is the only signal that distinguishes "registered" from "registered under a
  name nobody asks for". It issues no query, so it **bills nothing** — but it
  still needs a key to start the CLI, plus node and a compiled engine, and CI
  today neither holds an Anthropic key nor runs the `apps/server` suite at all.
  The offline tests in the same file do run under `make server-test`, but they
  only prove the staging happened, not what the runtime made of it. Wire
  `agent-smoke` into CI if a key ever lands there; until then it is on whoever
  touches `real_agent.build_options` to run it.

## Before horizontal scaling (`count > 1`)

- [ ] **`init_db` → Fly `release_command`** — move `init_db()` (`create_all()` +
  the allowlist seed) off the per-boot path into a one-time Fly `release_command`
  that runs once before any Machine starts. At `count > 1`, two Machines booting
  together race: both pass `create_all`'s existence check then both `CREATE TABLE`,
  and both see an allowlist email absent then both `INSERT` the same PK
  (`IntegrityError`) — crashing a boot. **Not needed at `count = 1`** (single
  always-on Machine; no concurrent boot — harmless). Required before
  `fly scale count > 1`. See `docs/plan/neon-postgres-plan.md` § "Also before
  count > 1". (The other former `count > 1` blockers are already cleared: the DB
  pin by the Neon migration, and the `LiveSession` pin by the shipped
  sandbox-as-server arch; the `/v1` turn lock is already DB-backed.)

## FamilySearch login (unified front door)
The hosted web workbench signs in with FamilySearch once; that login gates app
access (email allowlist) and yields the data token injected into every sandbox at
create. Google is gone. Follow-ups (`docs/plan/familysearch-login-plan.md`):

- [ ] **Register the prod HTTPS redirect** — FamilySearch must allow
  `https://<public-host>/callback` (top-level, **not** `/familysearch/callback`)
  for the bundled client id before the Fly deploy's login works. Locally it rides
  the desktop loopback registration. See `docs/plan/fly-deploy-plan.md` §
  OAuth-redirect.

- [ ] **Encrypt FS tokens at rest** — `familysearch_tokens.access_token` /
  `refresh_token` are plaintext (`models.py` TODO). Encrypt before any real PII /
  wider alpha.

- [ ] **The `/v1` REST path never re-syncs its FamilySearch token** — the browser
  path recovers on its own (`POST /connect` calls `sessions.sync_fs_token`, which
  refreshes the grant within 10 min of expiry and re-injects it into the sandbox
  on every reconnect; `/connect` returns `familysearch: ok|expired|none` and the
  web `SessionView` shows a "Reconnect FamilySearch" banner on `expired`). `/v1`
  injects once at create and never again, so a bearer session that outlives its
  refresh token has no reconnect surface — bearer clients have no front door.
  Acceptable for now; revisit if a `/v1` client hits it.

- [ ] **Allowlist trusts an unverified email** — `/users/current` returns no
  `email_verified`, so the gate trusts the FS-account email as-is. Fine for a
  hand-curated alpha list; before open signup, pin `users[0].id` (trust-on-first-
  use) so an allowlisted email can't be claimed on a throwaway FS account.

## Guardrail enforcement in production
Plan: `docs/plan/research-guardrail-bypass-plan.md`. The eval-side mechanisms
have proven out; none of them reach Cowork or the hosted web workbench.

- [ ] **Nothing restrains the MAIN THREAD outside the eval harness.** Three
  observations that were filed separately are one hole:
  (1) `extraction_append` (#695) makes the record-extractor structurally unable to
  write `person_evidence`, but the *router* is unrestrained — e2e grants
  `mcp__genealogy` wholesale (`eval/harness/e2e/orchestrator.py`) and the hosted
  path runs `permission_mode="bypassPermissions"` with no allowlist
  (`apps/server/app/agent/real_agent.py`).
  (2) The guardrail-bypass fix is harness-only: the caller-id `PreToolUse` hook
  (§4.1), the `Write`/`Edit` lockdown (§4.3), and the two hard-fail checks (§4.4)
  all live in the e2e orchestrator, so the bypass that plan documents — and the
  live `bagley-father-1884` run confirmed — stays fully reachable in Cowork and
  the hosted web workbench.
  (3) It is not theoretical. In a live Cowork session the `record-extraction`
  router correctly recited that it "cannot call ... `research_append` ... or
  `image_transcribe`/`image_read` directly", then in the next breath: "I'm falling
  back to `image_read` to pull the scan inline so I can see it directly." Closing
  a lane on a subagent raises the pressure on the router to do the job itself, so
  any real fix has to bind the main thread too — this is the exact substitution
  #695's spec §11.4 names as out of scope.
  The instrument exists and is proven: a `context_policy` `PreToolUse` rule keyed
  on `agent_id` (`eval/harness/harness/context_policy.py`, built after the router
  was observed calling `image_read` directly). What is missing is a production
  port to `real_agent.build_options` and to whatever Cowork allows. Current
  mitigation is prose in `record-extraction/SKILL.md`. Plan:
  `docs/plan/research-guardrail-bypass-plan.md` §§3–5.

- [ ] **Whether `Skill`-tool content injection survives compaction is
  unverified — and there's now real reason to suspect it doesn't.**
  `docs/plan/research-guardrail-bypass-plan.md` §6 flagged this as an open
  question (proof-conclusion/research-exhaustiveness/person-evidence/
  conflict-resolution all do an on-demand `Read` of their own
  `references/*.md`, unverified for reliability). The `feedback-2026-07-27-perf`
  branch's compaction audit (commits `3455ce84`/`f05757ef`,
  `docs/plan/research-performance-2026-07-27.md`) independently measured the
  general mechanism: an unanchored prose rule's compliance decays from
  ~100% to 3-45% once its skill body is evicted from context by compaction,
  while tool-validated/output-coupled rules hold at 100%. A guardrail
  skill's own reference-doc reads are exactly this shape (prose-anchored,
  no tool validation) — worth the same before/after-compaction segment
  analysis their audit used, applied to the four guardrail skills
  specifically, before assuming the reference reads hold up in long runs.

- [ ] **`gps-mentor`'s proof-critique gate may be as skippable as the four
  guardrail skills — undetermined.** `find_missing_mentor_verdicts`
  (`harness/skill_invocation.py`) detects a missing verdict after the fact
  but does nothing to prevent the orchestrator from silently skipping the
  `@plugin:gps-mentor` invocation under the same context-pressure conditions
  that caused the other four skips. No runlog evidence has been checked
  either way (`docs/plan/research-guardrail-bypass-plan.md` §6).

- [ ] **`research-append.ts`'s batch-ordering was only audited for one
  TOCTOU case.** The §4.2 fix (tier vs. `exhaustive_declaration`, checked
  against pre-call state) closes the specific same-batch establish-and-
  consume hole found during adversarial review. Other same-batch orderings
  that could similarly self-satisfy a precondition within one atomic write
  (e.g. adding a `person_evidence` link and consuming it for an assertion in
  the same batch) were not exhaustively checked — flagged, not audited, in
  the plan's §6.

## Engine — image reading & transcription

- [ ] **Upgrade `image-reader` (small-image path) Sonnet 4.6 → Sonnet 5** — called out
  by the OCR quality spike as the **biggest remaining accuracy lever**, and cheaper and
  faster than the current pin. A one-line `model:` frontmatter change in
  `packages/engine/plugin/agents/image-reader.md`, gated by the eval suite, independent
  of the Qwen/`image_transcribe` work. Note the countervailing evidence from the
  record-extractor A/B: sonnet-5 at high effort can run away on adaptive thinking, so
  gate on a full suite run, not a spot check.

- [ ] **The inline-image size ceiling is unresolved in production — three
  entangled questions, one sequence.**
  **(a) The router must not call `image_read` itself.** The inline base64
  overflows the transport buffer and crashes the run. *Both harnesses now enforce
  this* — the `PreToolUse` hook denies the call when `agent_id` is absent (main
  thread) and a universal validator hard-fails the test
  (`harness/context_policy.py`). Cowork has no eval hook, so the crash is still
  reachable there, and because per-agent `tools:` is subtractive, production sits
  in one of two states e2e cannot distinguish (its allowlist is a `mcp__genealogy`
  wildcard): either Cowork's session set honors the skill's `allowed-tools` and
  excludes `image_read` — in which case the image-reader subagent cannot call it
  either and **image reading is silently broken in production** — or Cowork grants
  a broader set and **the router can crash a real user's run**. Settling it needs
  one live Cowork run against an image ARK, not a repo read.
  **(b) The "~1 MiB wall" is not a protocol constant.** It is
  `claude_agent_sdk`'s configurable `ClaudeAgentOptions.max_buffer_size`
  (`_DEFAULT_MAX_BUFFER_SIZE = 1024*1024`, `subprocess_cli.py:30`).
  `eval/harness/e2e/orchestrator.py:752` already raises it to 10 MiB for exactly
  this class of crash, and its own comment warns that this is eval-harness-only
  config. `apps/server/app/agent/real_agent.py` sets no override (still the 1 MiB
  default), and Cowork/Desktop production does not run through this Python SDK
  transport at all — a different, closed-source client whose real ceiling is
  unverified. **Do not infer Cowork's ceiling from the e2e harness's override.**
  **(c) The 700 KB `MAX_INLINE_IMAGE_BYTES` cap (`image-read.ts`) prices
  `image-reader-opus` out of most real scans** — confirmed across 7 live attempts
  (2026-07-24), not one sample: **6 of 7** real FamilySearch scans exceeded 700 KB
  (1.2–1.5 MB) and `image_read` refused outright — two German civil/church
  register volumes (`004764543_00001`/`00271` and `ark:/61903/3:2:77P1-FRQ`/
  `77T6-B33`) plus `3Q9M-CSS8-G345-B` (0.8 MB). The 2 that succeeded were smaller
  single-sheet US documents (a printed newspaper column, 419 KB; a 1947 Army
  discharge certificate, 384 KB) — neither a genuine hard-handwriting case.
  Pattern: **format/collection matters more than legibility** — bound European
  register books scanned as full high-DPI pages run over the cap regardless of how
  hard the handwriting is, while single-sheet US-style documents land well under
  it. A genuinely harder page is likely larger still.
  **Decision (Dallan, 2026-07-24): leave the cap as-is for now** — the agent's
  `NOT READ` path already points back to `image_transcribe`. Decide whether to
  raise the cap, give the agent its own larger ceiling, or explore a
  downscale-before-read path once there is more usage data.
  **Sequence: (b) gates (c), and (a) needs the live Cowork run.** Plan:
  `docs/plan/image-read-context-policy.md` §5; spec:
  `docs/specs/image-reader-opus-agent-spec.md` §9.

- [ ] **Should `image-reader`/`image-reader-opus` compress non-matching pages
  during a `search-images` browse?** Raised while designing `image-reader-opus`:
  for a browse with a `looking_for` target, only relay the full transcription for
  a likely-matching page and a one-line verdict for the rest, so a ten-page
  browse doesn't accumulate ten full transcriptions in the calling skill's
  context. **This is the same shape as the search-images accumulation work's
  "Option B", explicitly rejected on 2026-07-17 for a correctness reason, not
  cost** — asking the reader to judge relevance and shorten its output was found
  to encourage hallucination, whereas the current contract (always full, faithful
  OCR, never slanted) avoids it. One candidate distinction was identified but not
  resolved: gate compression on `image_transcribe`'s own deterministic
  `FOUND`/`NOT FOUND` field, produced by a forced always-full pass, rather than
  on a fresh relevance judgment by the relaying agent. Needs the same
  genealogist scrutiny Option B got before anything is built — NOT investigated.

## Skill coverage (orphaned tools)
These MCP tools are shipped, specced, and advertised, but no skill references them
(`image_search` is also orphaned — tracked separately as a new image-search skill).

- [ ] **Integrate `collection_read`** — skills call `collections_search` (13 of them)
  but none drill into a single collection's detail. Wire it into the search path
  (e.g. `search-records` / `record-extraction`) so Claude can read a collection
  after finding it.

- [ ] **Integrate `person_ancestors`** — the pedigree/ancestor-fetch tool isn't
  called by any skill (`tree-edit` uses the match tools + `person_read`, never
  `person_ancestors`). Wire it into the relevant tree/research workflow.

## Record-extraction consolidation follow-ups (2026-07 window)
Deferred at wrap; see
`docs/record-extraction-consolidation-closing-report.md`.

- [ ] **Record-type playbook files + snapshot carve-out** — per-record-type
  references (census/death/probate/church/marriage) as the parallel-team
  ownership surface. Blocked on a design decision: inside the skill dir every
  playbook edit flips the runlog inactive (full re-run+annotation per edit);
  outside it agents have no reliable load path. Needs a deliberate, documented
  snapshot carve-out (e.g. a `playbooks/` subdir exclusion) before creating
  the files. Until then, compact tables live in the extractor agent body.

- [ ] **Fan-out extractor agents** — the extractor runs serially per record;
  the latency plan's P3 full form fans out one agent per record with parent
  batch-persist. Do after per-record overhead is measured on multi-record e2e
  runs.

- [ ] **Extraction→tree materialization gap ownership** — fact-less sibling
  stubs are never enriched, the 5d trigger can't fire on a family's first
  record, and no skill promotes extracted facts onto tree persons (8/27 e2e
  scenarios; judges penalize the thin tree). Needs an ownership spec:
  `merge_record_into_tree` grows this, or person-evidence does.

- [ ] **person-evidence epistemic gate** — identity over-reach: pe links
  written at `confident` from one uncorroborated record with `[?]` readings
  (clark-parents). The extractor agent got a tentative-cap line; person-evidence
  needs the equivalent gate + mandatory conflicts entry.

- [ ] **Recover the classification-quality drop from the sonnet-4-6 pin.** The
  extractor was re-pinned sonnet-5 → `claude-sonnet-4-6` (2026-07-18) because sonnet-5
  hangs at Cowork/e2e `effortLevel: high` (adaptive-thinking runaway); the 8k
  output-cap alternative is non-viable (starves before any tool call, or runs away
  across turns — 0 pass, ~20 min/test in a 5-test A/B). Downgrading is the surgical
  fix (effort is session-wide, model is per-subagent) but costs ~0.24/3 mean judge
  score, concentrated in GPS classification nuance: 4.6 slips on the **existing**
  "Blank columns produce no assertions" rule and on `informant_proximity` /
  `evidence_type` calls. Deferred mitigation: follow the rx-partials pattern of
  adding concrete point-of-use examples (NOT duplicate rules), then re-run the
  record-extraction unit suite to confirm recovery. Do **not** target the 009
  death-cert case — judge noise, not craft.

- [ ] **Enum-drift lint** — grep prose enum enumerations (agent bodies, cribs,
  rubrics) against `enums.schema.json` in CI, following the places-guidance
  byte-lint pattern. Two drift instances shipped 2026-07-12 (the /research crib
  listed `researcher` as invalid after it became a valid
  `informant_proximity`; record-extractor's negative-evidence section still
  said `unknown`).

- [ ] **`evidence_type: "negative"` is not tied to `record_role: "absent"` in
  `validator.ts`** — the runtime validator checks each assertion field
  independently and has no cross-field rule, so `extraction_append` happily
  persists a negative assertion carrying a real role. Doctrine is already
  explicit and correct (`packages/engine/plugin/agents/record-extractor.md`
  "Negative evidence": "A negative assertion always concerns a *person*
  (`record_role: "absent"`)"; `research-schema-spec.md:95,378` name `absent`
  as *the* role for negative evidence) — record-extraction ut_001 violated it
  anyway on the 2026-07-19 run and self-corrected on the next, i.e. it is
  unguarded variance, not a prose gap. Deferred from the validator-failure PR
  because the check does not land cleanly: `eval/fixtures/scenarios/
  flynn-parentage-not-proved/research.json` `a_012` is `negative` with
  `record_role: "deceased"` (a "father: not recorded" blank-field negative —
  itself against doctrine), and proof-conclusion ut_005 calls `research_append`
  against that scenario, so whole-document validation would reject a currently
  passing test. To land: retag `a_012` to `record_role: "absent"`, add the
  cross-field check next to `checkStringOrNull` in the assertions loop, and
  re-run proof-conclusion (the scenario edit flips its runlog inactive).

- [ ] **Scope the record-extraction outage window.** `record-extractor` could
  not spawn in Cowork between 2026-07-12 (#650) and the dual-spelled-tool-names
  fix (#698, 2026-07-18). Because the runtime refuses rather than launching a
  toolless agent, the failure was loud and nothing should have been silently
  half-persisted — but that assumes Cowork ran a build with the loud refusal for
  the whole window (it landed in CLI 2.1.208; the VM CLI on disk was 2.1.205, so
  an earlier silent-toolless window is possible). Spot-check live projects (e.g.
  `kenneth-quass-parents`) for records with a research-log entry but no
  corresponding assertions.

## Eval framework

- [ ] **Adopt a run-log retention rule — `eval/runlogs/` is 147MB tracked and ~85%
  of it is inert.** Measured 2026-07-18: 190 unit run logs (116MB) + 152 `.ann.json`
  (2.9MB) + 56 e2e runs (~27MB). **Nothing in the repo reads more than the latest 2
  run logs per skill** — `skill-improver`/`rubric-critic` read the latest released
  or highest candidate, `skill_latency_report` reads `logs[-1]`/`logs[-2]`,
  `check_runlogs.py` reads the latest, and the CRUD UI halts on first match. The
  only all-history readers are the trend view (filters `released === true`) and
  `calibrate_judge` (reads **only** `.ann.json`, 0.2MB). So 164 of 190 unit logs
  are read by nothing.

  **Root cause is process, not storage: the release action has never been used** —
  0 released, 190 candidates, all `v1_`. `docs/plan/eval-runlog-versioning.md`
  already defines the retention model (released `v{N}.json` kept forever; candidates
  pruned by hand in the CRUD UI; scratch gitignored), but the candidate tier was
  left manual and never performed. That also leaves the trend view rendering
  nothing, since it filters on a flag no file carries. Adopting a rule without
  closing the `v1` line on the mature skills just re-accumulates the same 108MB.

  Proposed rule: (1) keep every `.ann.json` forever — 195 files, 3.1MB, expensive
  genealogist labor and the sole `calibrate_judge` input; (2) keep all released
  `v{N}.json` forever; (3) keep the latest 2 candidates per skill, pruning older
  ones **that have no sibling `.ann.json`** (~25MB); (4) for older candidates that
  *do* have an annotation, **strip the inline `snapshot` block instead of deleting
  the file** — it is 46% of unit-runlog bytes, exists only to support activate /
  active-detection, and a superseded candidate will never be activated, so this
  keeps every judge rationale the annotation argues against (~37MB); (5) delete
  e2e `.transcript.md` older than 60 days where the run has a finalized `.ann.json`
  — nothing reads transcripts back, `result.py` calls them a lossy summary, and the
  annotation carries the durable judgment (~5MB). Keep e2e `final-tree` /
  `final-research` regardless: `grade-e2e-run` reads exactly those to produce future
  annotations. **≈67MB reclaimed with zero loss of annotations, released logs, or
  regradeable evidence.** Deleting all 164 superseded candidates outright would
  reclaim 108MB but orphans 125 annotations from the traces they argue against —
  not recommended.

- [ ] **Revert the temporary $25 e2e cost caps** — `bottemiller-parents` and
  `cruz-corona-ancestry` fixtures carry `caps.max_cost_usd: 25` as experiment
  headroom for the extractor-state-diet measurement window (3 of 5 e2e runs
  were hitting the default $15 cap pre-diet; cruz peaked at $19.12). Once the
  diet (`project_context` + tool-side source reuse + `add_household_children`)
  demonstrably lands runs under $15, drop the `caps` blocks so the default cap
  is the regression gate again.

- [ ] **Verify harness stop-early kill reliability on Windows; robust path if it
  fails.** The shipped quick path leans on OS process-group signal delivery plus the
  SDK's `atexit` sweep to kill in-flight subprocesses — reliable on macOS/Linux, but
  `CTRL_C_EVENT` reaching child console processes on **Windows** (the genealogist
  team's platform) is murkier. **Verify on a real Windows box.** If in-flight `claude`
  processes survive a Ctrl-C there, adopt the robust path: run each test in a child
  process the harness owns — replace the `ThreadPoolExecutor` of `run_one_test` calls
  with a `ProcessPoolExecutor`/explicit `subprocess`, spawned `start_new_session=True`,
  and have the stop handler terminate each worker's process group explicitly
  (`os.killpg` on POSIX, `CTRL_BREAK_EVENT`/`TerminateProcess` on Windows).
  **Inversion to watch:** putting children in their own session means a terminal
  Ctrl-C no longer auto-kills them — ship the explicit teardown *with* it or
  interrupts hang. Cost: `run_one_test` currently shares the parent's imports, auth
  object, and `OrchestratorPaths` in-process, so inputs must become picklable or be
  reconstructed in the child. Bonus: owned subprocesses make a SIGKILL under memory
  pressure one lost test rather than a process-wide hazard. Incremental partial
  persistence is transport-agnostic and unaffected either way.

- [ ] **Attack the eval stall tax (fix deferred pending data).** Instrumentation is in
  place (`duration_api_ms`, `skill_attempts`, and the harness's post-run "Timing
  breakdown": skill work vs wall, API %, judge time, turns, transient retries). The
  *fix* was deliberately deferred — committing to a service-tier change or a
  silence-watchdog retune blind would be guessing. Use `make eval-timings` to decide.
  Related, no harness code: use `num_turns` + output tokens to spot chatty or
  over-scoped *positive* tests; that time is inherent model generation, so cutting it
  is a test-authoring / skill-prompt decision. **Decided against:** mass-tightening the
  80+ oversized `max_wall_clock_seconds` caps — once LPT weights by actual duration the
  cap is only a safety ceiling, so an over-generous cap costs nothing, and tightening
  adds abort/flakiness risk. Revisit only if a specific runaway needs a faster ceiling.

- [ ] **Judge is blind to provenance nulling** — the record-extraction closing report §4
  notes no judge/eval dimension detects a null-persona regression. Needs a rubric or
  deterministic-validator change to catch it.

- [ ] **`match_score` remains fabricable by person-evidence** — it is not
  derivable at the tool boundary (`same_person`'s tree side is a hand-curated
  record-sized slice; a local stub returns a degenerate near-zero score the
  skill must read as *no score*), so the lever is eval/rubric, not tooling.
  A provenance guard was designed and cut in #695: zero observed true
  positives across all 15 `eval/tests/unit/person-evidence/` cases, against a
  real false-positive class.

- [ ] **`_make_research_append_handler` duplicates `_make_compiled_tool_handler`** —
  in `eval/harness/harness/mock_mcp.py` the two are now byte-equivalent modulo
  the parameterized names; the `ops`-shape fallback that justified the bespoke
  copy is gone. `extraction_append` (#695) uses the generic builder. Collapse
  `research_append` onto it too and delete the bespoke handler.

- [ ] **`max_cost_usd` does not cap anything in the e2e harness** — `cost_cap` is
  applied inside the `ResultMessage` branch of `orchestrator.py`, and that
  message only arrives once the run has already finished, so the "cap" is a
  post-hoc label on a completed run. All five `cost_cap` runs in the corpus
  ended with the SDK's own `end_turn` and `is_error: false` — spend ran to
  $15.86–$20.84 against a $15 cap with nothing interrupted. Real enforcement
  needs two pieces the harness lacks: a per-model price table for *agent*
  models (`judge.py::JUDGE_PRICING` covers judge models only, and a run spans
  the parent plus each subagent on its own `.md` pin), and a way to see
  subagent tokens — they never appear in the main SDK message stream, so an
  in-flight estimate built only from streamed usage under-counts by a margin
  consistent with the unattributed portion of a real run's cost. Deliberately
  not half-built: a cap that silently fires late is worse than a documented
  reporting threshold. The spec (`e2e-test-spec.md` §5) now says so explicitly.

- [ ] **Nothing checks that `forget-and-rederive` honors its own redaction rule** —
  the skill stays permanently exempt from the runlog gate (a setup utility has no
  genealogical output for a judge to grade; confirmed 2026-07-18), and as of
  2026-07-23 its mechanical half is `tree_forget`, whose redaction *is*
  unit-tested. What no test covers is the skill's behavioral half: that it
  dry-runs before applying, reaches for `project_context` instead of reading
  `tree.gedcomx.json`, and does not restate removed values back to the
  researcher. That is a transcript property, not a tool property, so it needs
  either a targeted lint over the run transcript or a deliberate decision to
  leave it to prose. Not a unit suite — see `RUNLOG_GATE_EXEMPT_SKILLS`.

- [ ] **Nothing prevents the eval corpus drifting behind a tool contract again** —
  it happened twice unnoticed. `search-records`' rubric was TWO contracts stale
  (still failing runs for not calling `same_person`/`source_attachments`, folded
  into `rank_search_matches` months earlier and into `record_search` on
  2026-07-27),
  and 14 test files' `judge_context` was one contract stale. The corpus was
  marking the skill down for doing the right thing, and only a regression run
  surfaced it. A cheap lint would catch both: flag any tool name appearing in a
  skill's `rubric.md` or per-test `judge_context` that is absent from that
  skill's `allowed-tools`. That single rule would have fired on
  `same_person`/`source_attachments` in the rubric the day they were folded away.
  Same shape as the existing places-guidance byte-lint and the enum-drift lint
  already queued elsewhere in this file.

## Research latency (e2e `/research` runs)
Parent plan: `docs/plan/research-latency-reduction-plan.md`. These two levers were
sized by the Phase-0 latency analysis and are not covered by the parent plan's phases.

- [ ] **Negative-result short-circuit / defer proof** *(top direct lever)* — in the
  `/research` orchestrator, when a question's retrieval yields **no candidate answer
  for the objective**, `research_log_append` a negative result and route to the next
  question, **deferring** the exhaustiveness / proof-conclusion / gps-mentor gates until
  a candidate exists at the objective level. *Defer, don't eliminate* — GPS rigor stays.
  Gate on the agent's explicit "no candidate" signal (it already emits one). Co-design
  with `question-selection`, which is the root cause (it posed the elizabeth gatekeeper
  question); consider not spawning full-proof-cycle gatekeeper questions at all.
  **Rigor-critical: validate on an instrumented e2e re-run before shipping.** Exit
  criteria: on elizabeth-class runs the breakthrough moves earlier and the answering
  question's proof completes inside the cap; answering-first runs (bottemiller) are
  unaffected.

- [ ] **Cut gps-mentor gate count** — gps-mentor is invoked 3–4 gates per answering
  question at ~40–84s each (≈3.5–4 min/question) on the critical path, since the parent
  blocks on each gate. The model half of this lever is **already banked** (repinned
  `claude-opus-4-8` → `claude-sonnet-5`); the residual is the gate *count*: the spec has
  3 checkpoints but runs show 4 (re-checks, "second pass", "final critique after
  revisions"). Consolidate the re-invocations. Optionally right-size per gate — run the
  lightweight readiness gates on a faster model and reserve the stronger model for the
  substantive post-proof critique. (The negative-result short-circuit above already
  removes gates entirely for *non-answering* questions; this covers the answering path.)
  **Not a lever: the ~138s proof-critique call itself.** That one is
  doctrine-required — a real second model call reviewing the conclusion — so carry
  it as a known fixed cost in any re-measurement rather than mistaking it for waste.

- [ ] **person-evidence's prose never got the concision pass proof-conclusion did.**
  `person-evidence/SKILL.md` is 693 lines; `proof-conclusion/SKILL.md` is 231, already
  trimmed once (#582/#583, measured **−44%** output tokens at the unit-test level).
  The batching work that closed person-evidence's round-trip tax (`materialize_facts`
  `ops[]` + the one-call edge write, 2026-07-26) deliberately left this untouched,
  because **batching cuts round-trips, not generation time** — even a correctly
  batched 45-entry `research_append` still cost ~60–90s of raw token streaming. So
  the open question is whether deliberation/output volume, rather than round-trips,
  is now the dominant remaining cost here. **Do not spend this lever
  speculatively**: whether the proof-conclusion cut ever showed up in e2e wall-clock
  was never confirmed (the Phase-0 latency work left "does −44% compound to e2e?"
  open), and the same hazard as `search-records` applies — the unit suite grades
  single invocations in fresh context and cannot see multi-hour retention, so it
  will happily bless a cut that removes something only a long session needs.

- [ ] **The reasoning-effort A/B (C0) is unshipped, and it is the largest single
  lever** — `docs/plan/research-performance-2026-07-27.md` §F0/§C0. 58% of a real
  session's output tokens are unstored billed reasoning, and generation time is
  linear in output tokens, so effort is the only knob that reaches the majority
  of the cost. `high` is the default everywhere — the SDK's own default
  (`ClaudeAgentOptions.effort` docstring: *"high — Deep reasoning (default)"*),
  inherited by the unit harness, pinned explicitly by the e2e orchestrator, and
  never set by `apps/server/app/agent/real_agent.py`. **Nobody has measured this
  product at any other effort.** Sequenced last deliberately: the payload and
  ranking changes move the baseline, so an A/B run before them would be
  invalidated. Run it against the e2e suite (unit can only screen), and note the
  suite economics — 20 fixtures ≈ $185 / ~20.5 h serial, scaled by the mean not
  the median, since 17 of 96 committed runlogs carry no cost.

- [ ] **`ClaudeAgentOptions.effort` is not verified end-to-end** — the field exists
  in claude-agent-sdk 0.1.81 with a documented default, and would make C0 a
  one-line change in `build_options` instead of writing a `settings.json` into
  the sandbox. The e2e orchestrator's comment calls its settings-file write "the
  only working effort lever from the harness", but that comment names the
  `CLAUDE_EFFORT` env var as what failed, not the SDK option — so it may simply
  predate it. Five-minute check; do it before building C0 the harder way.

- [ ] **`search-records/SKILL.md` is 41.6 KB and wants shrinking** — it was resident
  for 228 of 309 turns in the measured session, and its unanchored rules decayed
  under compaction (`research-performance-2026-07-27.md` §5.2–5.3). Shrinking is
  now *safer* than it was: the two load-bearing rules (ranking, `count: 50`)
  became tool contracts, so they can no longer be lost with the prose. The
  hazard that remains is that the unit suite grades single invocations in fresh
  context and therefore **cannot see** multi-hour retention — so it will happily
  bless a cut that removes something only a long session needs. Needs a gate
  other than the unit suite before anyone cuts deeply.

- [ ] **The ranking fold has not been tested under real compaction pressure** — the
  post-change e2e run (`hannah-earnest-children` 2026-07-27) compacted only 4
  times in 190 turns and ranked 7 of 7 eligible searches. That confirms the
  contract fires; it does not demonstrate the contract beating prose under the
  23-compaction pressure that motivated it. The 302-turn baseline of the same
  fixture would be the harder test.

- [ ] **Agents read records the ranker did not surface** — in the same run, 6 of 11
  `record_read` calls (55%) targeted a record in a ranker top-3. Some is
  legitimate (5 of 14 searches were deliberately subject-less broad sweeps, which
  cannot rank), but it is worth checking whether the agent is ignoring rankings
  it now gets for free. That would be the same adoption gap one layer down.

- [ ] **`docs/plan/research-performance-2026-07-27.md` is kept deliberately, against
  the "delete a plan once the work ships" convention** — because C0 (the
  reasoning-effort A/B, the largest remaining lever) has not shipped. C1–C7 have,
  and their rationale is in the tool specs, but three things in that plan belong
  in neither a spec nor a commit message: §1 (the session decomposition and the
  output-tokens/wall-clock equation), §5.1 (the live probe that refuted this
  plan's own F2 — the ranker works; the low scores were correct negatives), and
  §5.3 (the rule audit showing only unanchored SKILL.md prose decays under
  compaction). Delete or trim it once C0 is decided, and fold those three
  findings somewhere durable rather than losing them with the file.

## Skills / tools

- [ ] **Write `docs/specs/place-distance-tool-spec.md`** — `place_distance` is
  advertised in `tool-schemas.ts` but is the only live tool with **no spec**, so
  `spec-review` cannot check it. The 2026-05-07 timeline-distances design doc was the
  de facto stand-in and has been retired; the behavior is currently defined only by
  `src/tools/place-distance.ts` and its use in `timeline/SKILL.md`.

- [ ] **Optional `site`/`host` filter param on `external_links_search`** — deferred from
  the search-shaping work (option B) as unnecessary while the count cap holds. File it
  properly if the cap proves insufficient on real runs.

- [ ] **There is no per-op authorization within a single tool.** The
  `tree_edit`/`tree_correct` split (2026-07-12) settled the concrete case by
  moving the mutating ops (`update_fact`/`update_name`/`update_person`/
  `update_source`/`remove`) into `tree_correct`, so the record-extractor agent
  (`tree_edit` only) is structurally unable to rename, rewrite, or remove existing
  tree entities — the ut_013 rename incident. But there is no `allowedOperations`
  caller contract, so a finer split (e.g. `add_name` but not `add_person`) has no
  lever except splitting the tool again.

- [ ] **README tool catalog is stale** — `README.md` says "33 tools" in one place
  and "31 MCP tools" in another; `manifest.json` lists 45. `research_append`,
  `tree_edit`, `materialize_facts`, and `extraction_append` appear in no README
  tool table, and `docs/specs/mcpb-package-spec.md` still tells a manual tester
  to assert 21 tools. No CI reads either, so nothing reds.

- [ ] **`init-project` writes both project files with `Write`, not a writer tool** —
  its `allowed-tools` is `person_search` / `person_read` / `place_search`, so the
  initial `research.json` and `tree.gedcomx.json` are hand-serialized with no
  validate-before-persist. It escapes the universal
  `test_project_file_changes_route_through_writer_tools` validator only because a
  new project has no `before_state` to diff against. The cost is real: ut_002
  (2026-07-19) wrote a name with no `given` key and the invalid tree landed on
  disk, which in production would make every later `tree_edit` reject the whole
  document — the same project-wide write block that the D5-invalid
  `flynn-household-skeleton` fixture caused for person-evidence. The prose bug is
  fixed; the missing guard is not. Options: give init-project a writer tool for
  the seed write, or have the validator treat an absent `before_state` as a diff
  against empty rather than a skip.

- [ ] **A specialized `places-guidance.md` copy is unlinted for drift** — the drift
  lint (`tests/packaging/skill-guidance.test.ts`) holds 8 skills byte-identical
  to `plugin/references/places-guidance.md`, but `research-plan`'s copy is
  deliberately specialized (8bf43be2 split place work by function, so its copy
  reframes four tools it no longer has as locality-guide's). It now gets only an
  exists-and-non-empty check, so a genuine regression *inside* that copy — or a
  canonical edit that should have been mirrored into its shared paragraphs —
  passes silently. Two ways out: factor the guidance into a shared core plus a
  per-skill "who calls what" section and lint the core, or derive each skill's
  copy from the canonical at plugin-build time using its `allowed-tools`. The
  second kills the duplication problem outright but is a build-step change.

- [ ] **Six private copies of `readJson` / `formatIssues` across the writer tools** —
  `materialize-facts`, `project-context`, `research-append`, `research-log-append`,
  and `tree-edit` each carry a byte-identical `readJson(projectPath, filename)`,
  and five carry `formatIssues` (only `merge-shared.ts` exports its copy).
  `tree_forget` (2026-07-23) added the shared `readProjectJson` to
  `src/utils/project-io.ts` — the designated project-IO layer — and uses it, but
  did not migrate the five incumbents, since that touches the merge and append
  write paths in a PR scoped to a skill fix. Migrate them onto `readProjectJson`
  and onto `merge-shared.ts`'s `formatIssues`, then delete the copies. The only
  wrinkle is the error class: each tool wraps the read failure in its own
  `*Error` type so it surfaces as `{ ok: false, errors }`; `readProjectJson`
  throws a plain `Error` and leaves that mapping to the caller (see
  `tree-forget.ts`'s three-line `readJson` wrapper).

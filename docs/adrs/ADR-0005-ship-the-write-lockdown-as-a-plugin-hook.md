# ADR-0005: Ship the write lockdown as a plugin `PreToolUse` hook

> **Read before you:** add a guardrail · restrain the main thread · try to stop
> the agent doing something with an allow-list · wonder why the `Bash` route is
> left open · change `PROTECTED_PROJECT_FILES`.

- **Status:** Accepted
- **Decided:** 2026-07-30 (#989; Windows path fix #984)
- **Recorded:** 2026-08-02
- **Deciders:** Dallan Quass
- **Supersedes:** —
- **Superseded by:** —
- **Applies to:** `packages/engine/plugin/hooks`, `apps/server/app/agent/real_agent.py`, `eval/harness/e2e/orchestrator.py`
- **Related:** ADR-0003, ADR-0006, `docs/specs/guardrail-enforcement-spec.md` §6, issues #941, #984, #989, #911, #1160

## Context

`research.json` and `tree.gedcomx.json` are the durable product of a research
session. Both are written through validating writer tools that check the whole
project in memory and write nothing on failure. A raw `Write` or `Edit` to either
file bypasses every invariant those tools enforce.

This is not a theoretical bypass. Across three `william-ferber-origins` e2e runs
on 2026-07-29, the agent wrote `research.json` raw **33 times** (12 / 13 / 8 —
32 `Edit` plus 1 `Write`), all successful. All three runs made **zero MCP tool
calls** — the genealogy server never connected (#941) — and
`eval/runlogs/e2e/william-ferber-origins/run-2026-07-29_17-05-11.json` carries
the agent's own diagnosis verbatim: `BLOCKER: mcp__genealogy__research_append
tool not found`. Having no writer tool, it fell back to editing the file
directly.

The obvious fix is an allow-list. It cannot work, for a structural reason:
**allow-lists are subtractive.** A per-agent `tools:` list can only *narrow* what
a subagent inherits from the session, and the session's tool set is always a
superset. There is no allow-list that denies the **main thread** a tool, and the
main thread is what did the writing.

The second constraint is environmental. `hooks=` is an SDK argument. The hosted
control plane can set it; **Cowork cannot be made to** — session options there
are not ours. And Cowork is the product.

## Decision

**The lockdown ships as a `PreToolUse` hook inside the plugin**
(`packages/engine/plugin/hooks/hooks.json` + `guard_project_files.py`), denying
raw `Write` / `Edit` / `NotebookEdit` on `research.json` and `tree.gedcomx.json`,
matched on basename with both path separators handled.

A plugin-shipped hook binds in **both** environments that matter: Cowork loads it
as part of the plugin, and the hosted path gets it alongside its own `hooks=`.
Verified live in Cowork on 2026-07-30 — the hook loads, fires under either
matcher form, and its deny is honored with the script's own reason text
surfacing. (That probe used a **broader matcher** than the shipped one and so
also fired for `Bash`; the shipped `hooks.json` matcher is
`Write|Edit|NotebookEdit`, and the `Bash` route is deliberately open — see the
costs below.) Cowork runs `permission_mode: "default"`, the hosted path runs
`bypassPermissions`; a hook binds under both.

Three deliberate properties of the script:

1. **It never raises.** Every failure path — unparseable stdin, missing fields —
   falls through to **allowing** the call. An exception here would fail a tool
   call the user was entitled to make.
2. **The deny names the sanctioned writer tools, and sets no `stopReason`.** A
   denied write is a recoverable mistake, not a stop; the turn continues.
3. **The `Bash` route is deliberately left open.**

## Alternatives considered

| Option | Why rejected | Evidence |
|---|---|---|
| **A per-agent `tools:` allow-list** | Subtractive — cannot restrain the main thread, which is what performed all 33 raw writes | `CLAUDE.md` § "Allow-lists are subtractive"; the ferber runs |
| **The `hooks=` SDK argument only** (no plugin hook) | The hosted path can set it; Cowork cannot be made to — and Cowork is the product. This is why the shipped hook lives in the plugin *and* the hosted path keeps its own | Verified live in Cowork 2026-07-30 |
| **Prose in the skill bodies** — "never write these files directly" | The rule must hold for hours, so ADR-0003 applies: unanchored prose decays. The agent that wrote raw 33 times had that instruction | §5.3 audit; #941 runs |
| **Also match `Bash`** by pattern-matching command text | Would false-deny a legitimate `python script.py research.json > out` while still missing a variable-built path. False-deny is the asymmetric risk here | `real_agent.py`; `guardrail-enforcement-spec.md` §10 |
| **Revoke `Write`/`Edit` entirely** from the session | Skills legitimately write other files — reports, notes, templates. And no MCP tool reads `tree.gedcomx.json` as a query surface, so `Read` and its siblings are still needed | `guardrail-enforcement-spec.md` §6 "Deliberate gaps" |
| **Raise on malformed input** so failures are visible | Inverts the risk: a bug in the guard would then fail tool calls the user was entitled to make. Fail-open is correct for a guard that sits in front of every call | Script design, `guard_project_files.py` |

## Consequences

**Gains.** The one route no allow-list can close is closed, in the one
environment we cannot configure. Since it shipped, a repeat of the ferber
scenario flails against denied writes rather than producing an unvalidated file
— the degradation path is closed even though the underlying cause is not.

**Costs, knowingly accepted.**

1. **The `Bash` route is open, on purpose.** `cat >`, `sed -i`, and `python -c`
   all get through, because the guard matches on `file_path`. The stated
   rationale — "skills run their stdlib-only scripts through `Bash`, so it cannot
   be revoked" — is currently *hypothetical*: no skill ships a `scripts/` folder
   today. **The decision stands on the false-deny argument alone**, which is the
   honest version. The rationale lives in `docs/specs/guardrail-enforcement-spec.md`
   §6 ("`Bash` is not covered"), to be revisited only if a bypass ever actually
   uses the shell.
2. **Three sibling implementations exist** — the plugin hook, the hosted SDK
   hook, and the e2e harness's own — and no test asserts they agree. They are
   behaviourally identical today but are not textual copies, so a same-behavior
   test has to be vector-driven rather than a string diff.
3. **The guard is silent about *why* the writer tool was missing.** It denies the
   symptom. Nothing treats "the writer tools are absent" as a halt condition, so
   a run in the ferber situation now burns its full budget producing nothing at
   all, rather than producing something wrong (#941).

**Risks.** The unit tier has **no write-lockdown in any form** — its harness hook
handles `Skill` tracking, the `image_read` context policy, and call limits, but
carries no protected-file rule, and the unit baseline grants `Write`/`Edit` to
every skill. So the raw-write class is entirely ungated at call time in unit runs
and is caught only at grading time.

A POSIX-only path split made the **e2e harness's** copy of this rule a complete
no-op on Windows — the platform the genealogist team runs — between #914 (07-27)
and #984 (07-30). The plugin hook shipped *after* that fix (#989, eleven minutes
later the same day) and never carried the bug. But it shipped as a **copy of a
rule that had**, which is exactly why cost 2 above matters: the divergence risk
is not hypothetical, it has already produced one silent no-op.

## Enforcement

> `packages/engine/mcp-server/tests/packaging/plugin-hooks.test.ts` — asserts
> `scripts/package-plugin.mjs`'s `INCLUDE` carries `"hooks"` (without it the
> directory never ships, which looks identical to the runtime refusing to load
> it) and **runs the real guard script** against vectors.

What it does **not** catch: that the hook **binds as a runtime hook** — only the
script's decisions are exercised (#1160); that the three implementations agree
(tracked only as critique §3 P3 — no issue number of its own);
or the `Bash` route, which is out of scope by design.

`docs/specs/guardrail-enforcement-spec.md` **§6** is the authority on this
guardrail; **§4** is the table of every guardrail's instrument, binding
environment, and enforcing-vs-shadow status.

## Revisit when

A bypass is observed using the shell route — at which point the false-deny
calculus changes and `Bash` matching becomes worth its cost. Or a skill ships a
`scripts/` folder, which would finally make the hypothetical half of the
rationale real. Or the per-context policy is ported to production (#911), which
would give the hook layer a caller dimension it does not have today.

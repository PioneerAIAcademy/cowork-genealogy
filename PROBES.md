# PROBES.md — experiments that gate the enforcement-layer plan

Working document, gitignored. Companion to `PLAN.md`.

**The rule for inclusion:** a probe earns a place here only if a *different
answer changes the plan*. Anything that merely refines a number we already have
is not on this list.

Each probe states its question, why it gates the plan, the method, what each
outcome changes, and its cost. Run them in group order. **Do not write the
implementation half of `PLAN.md` before Group B returns** — Group B decides
whether the design has three enforcement planes or two.

| Probe | Group | Cost | Status | Gates |
|---|---|---|---|---|
| A1 ownership satisfiability replay | A | free, offline | **DONE** — table not satisfiable; 47.9% denied, ≥39% of those wrong | whether any ownership row is safe to enforce |
| A2 writer census for unowned sections | A | free, offline | **DONE** — 4 rows proposed; `researcher_profile` has no writer at all | the four missing manifest rows |
| A3 pairing classification + fold cost | A | free, offline | **DONE** — fold ceiling ~54 KB; shortlist reranked by traffic | which skills convert, and whether it is affordable |
| A4 ad-hoc / no-project coverage census | A | free, offline | **DONE** — real coverage 75/388 unit, 0/105 e2e | the scope boundary and a fixture class |
| C1 `.claude/settings.json` write under bypassPermissions | C | 1 short run | **DONE (part 3 inconclusive)** — write lands, inert in-session, cross-session risk | protected set: 2 files or 4 |
| C2 anything version-shaped in the init handshake | C | free | **DONE** — nothing; skew must be a release rule | whether artifact-skew detection is possible at all |
| B1 does the plugin hook bind, per run mode | B | 1 Cowork session | ready to build | **the Ledger plane exists or not** |
| B2 does `agent_id` discriminate in production | B | same session | ready to build | caller rules exist or not |
| B3 can the hook read a packaged file | B | same session | ready to build | how the manifest reaches the hook |
| B4 does the Cowork router hold `image_read` | B | 1 Cowork run | ready | read-side rule; also unblocks issue #1593 |
| C1b rerun part 3 cleanly | C | 1 short run | **new, from C1** | whether settings bind at session start |
| D1 does a document-derived "what's next" change routing | D | ~2 e2e runs | **blocked — needs the advisory field built first** | **whether the rest of the plan is needed at scale** |

---

# Group A — free, offline, no API key

## A1 — Ownership satisfiability replay

**Question.** If `OWNERSHIP_TABLE` / `TREE_OWNERSHIP_TABLE` were enforced as a
hard deny at the MCP write boundary, how many writes in the committed e2e corpus
would be denied, and how many of those denials would be *wrong*?

**Why it gates the plan.** This repo has repeatedly shipped gates no compliant
caller could satisfy — four successive candidate discriminators for the
`same_person` provenance gate died on exactly this, and the one write-lockdown
bypass that reached production was *caused* by a deny pointing at a door that
was locked. Every ownership row must be replayed against real traffic before it
is built. This probe is the manifest's satisfiability check.

**Method.**

1. Read `OWNERSHIP_TABLE`, `TREE_OWNERSHIP_TABLE` and `REQUIRED_SECTIONS` from
   `eval/harness/validators/test_universal.py`, with their comments.
2. Enumerate `eval/runlogs/e2e/*/run-*.json`, **excluding** the sidecars
   (`.final-research.json`, `.final-tree.gedcomx.json`, `.ann.json`). State the
   denominator and the filter — a prior analysis in this repo counted sidecars
   as runs and reported 435 instead of 145.
3. For each `tool_calls` entry, identify writes. Confirm the writer-tool set
   against `packages/engine/mcp-server/src/tool-schemas.ts`; strip any
   `mcp__<server>__` prefix.
4. Extract the target section from **both** `args.section` and
   `args.ops[].section`. Map tree writes onto `persons` / `relationships` /
   `sources`.
5. Attribute each write: (a) the entry's `agent_type`; else (b) the most recent
   preceding `Skill` call in the same run; else (c) unattributed.
6. Apply the table; a write is denied when its caller is outside the section's
   allowed set. State the agent→skill mapping used.
7. Hand-adjudicate ≥10 denials across sections: genuine violation, or a
   legitimate write the rule would wrongly refuse? Quote the args.

**Discipline.** Only ~333 of ~23,798 ledger entries carry `agent_type`, and all
of them come from a single run — so step 5(b) is a **heuristic**. Report the
(a)/(b)/(c) split and never present a (b)-derived number as measured. Every
count needs the command that produced it. `encoding="utf-8"` on every text read.

**What each outcome changes.**

| Result | Consequence |
|---|---|
| Some rows produce false denies | Those rows are rewritten before they are built. This is the expected and desirable outcome. |
| No row produces a false deny | Ownership can be promoted to a hard deny in one step rather than shadow-first. |
| Attribution is too thin to decide | Ownership enforcement must ship in shadow mode with a stated exit criterion, and the exit criterion is a satisfiability threshold, not a false-positive rate. |

---

## A2 — Writer census for the four uncovered sections

**Question.** Who actually writes `evaluations`, `known_holdings`,
`researcher_profile` — the sections with no declared owner — and does
`localities`' paper owner match reality?

**Why it gates the plan.** Already measured: research.json has 15 sections; the
ownership check iterates 11; the table declares 12. `localities` has an owner
that is never enforced (it is not in `REQUIRED_SECTIONS`), and `evaluations`,
`known_holdings` and `researcher_profile` have no owner at all. `evaluations` is
schema-**required**, is what `gps-mentor` writes, and is what the completion
gate in issue #1490 is about to depend on. The manifest cannot be promoted with
four holes in it, and the rows should come from evidence rather than intent.

**Method.**

1. Reproduce the four-section gap independently (schema properties vs
   `REQUIRED_SECTIONS` vs `OWNERSHIP_TABLE`).
2. Scan the e2e ledger for `research_append`-family writes to those sections,
   both `args.section` and `args.ops[].section`. Attribute as in A1 and report
   the attribution split.
3. Cross-check the committed `run-*.final-research.json` sidecars: in how many
   runs is each section non-empty? A populated section with no ledger write is
   itself a finding.
4. Grep the plugin for who is *supposed* to write each, and compare against the
   prose ownership table in `docs/specs/research-schema-spec.md` and against
   `RESEARCH_APPEND_SECTIONS` in `research-append.ts`.
5. Resolve the `gps-mentor` case specifically: it is an **agent**, the ownership
   check keys on the calling **skill's** frontmatter name. Work out what a
   mentor write is attributed to and whether that is coherent.

**What each outcome changes.** The four rows are written from evidence, and the
`evaluations` row in particular determines whether issue #1490's mentor gate has
a sound foreign key to stand on. If the census shows `evaluations` is written by
more than one caller, the completion gate needs a different join.

---

## A3 — Pairing classification and fold cost

**Question.** Which of the 27 skills are skill-agent pair candidates, and what
does folding their reference files into an agent body cost?

**Why it gates the plan.** Only an agent has an enforceable capability envelope
in production; a skill's `allowed-tools` is documentation. So the conversion
list *is* the enforceable-ownership list. Three hard constraints bound it:
agents cannot nest, agents cannot take turns with the user, and reference files
must be folded (on-demand `Read` inside an agent was measured at 6/19 against a
12–14/19 baseline and reverted).

**Method.** Per skill: frontmatter; SKILL.md and `references/*.md` byte counts
and a stated bytes-per-token estimate; onward delegation (`Skill("…")`,
`@plugin:…`); conversational shape, quoted; what it writes (from the ownership
tables); whether it has a unit suite and how many tests; whether it is in
`RUNLOG_GATE_EXEMPT_SKILLS`. Then classify: **PAIR** / **PAIR-PARTIAL** /
**SOLO** / **READ-ONLY** / **ALREADY-PAIRED**.

**What each outcome changes.** Produces the ranked conversion shortlist and the
per-conversion cost. If the fold cost for the top candidates is large, the
program shifts toward preconditions-only and away from pairing.

---

## A4 — Ad-hoc / no-project coverage census

**Question.** What coverage exists for work done with no project open, which
skills break without one, and what would a minimal fixture class need?

**Why it gates the plan.** Standalone use is a first-class product goal
("transcribe this image", "does this record belong to this person?"), and it is
the case where **no artifact is produced and therefore no enforcement applies**.
That boundary has to be drawn deliberately. It is also the least-covered path in
the repo — one scenario, one routing test — which is exactly how issue #1080
stayed invisible, and it is the most prompt-exposed path because no extractor
agent sits between pasted record text and the writer tools.

**Method.** Confirm the two known facts (`empty-folder-no-project` is the only
projectless scenario; one test uses it). Census the unit tier by scenario and
the e2e tier for `starting-research.json`. Per skill, decide
WORKS-STANDALONE / BREAKS-WITHOUT-PROJECT / DEGRADES-GRACEFULLY by reading the
body and quoting any no-project conditional. Enumerate plausible ad-hoc requests
from the skills' own `description` frontmatter, not invented ones.

**What each outcome changes.** Sizes the ad-hoc fixture class and tells us which
skills need a no-project conditional before standalone use is safe to advertise.

---

# Group B — RUNBOOK (canary built and verified 2026-08-15)

The canary is built, exercised against synthetic payloads, and confirmed to ship
inside the zip. **`hooks/policy.json` is in the package** (197 bytes), so if the
hook cannot read it that is a real finding and not a packaging mistake.

Changed in this worktree, all throwaway:
`packages/engine/plugin/hooks/canary_probe.py` (new),
`packages/engine/plugin/hooks/policy.json` (new),
`packages/engine/plugin/hooks/hooks.json` (a second `".*"` matcher).
The real guard is untouched and still denies `research.json`.

**Install.** `releases/genealogy-plugin.zip` is built from this worktree.
Cowork → Customize → remove the existing genealogy plugin → upload this zip →
**fully quit and reopen** Claude Desktop. Do the whole run in **on-computer**
mode first, then repeat in **cloud** mode — run mode is a per-task setting
nothing in the plugin can see, and that asymmetry has broken an agent before
while CI stayed green.

**Step 1 — B1 + B3, main thread.** In an empty folder, ask:

> Create a file called `canary-probe.txt` containing the word hello.

Expected: a refusal whose text begins `CANARY-B1-DENY-OK`. Record verbatim.

| What to read off it | Answers |
|---|---|
| the refusal appears at all | **B1** — the hook binds, matches, is parsed, and the deny is honoured |
| `token=PROBE-B3-PACKAGED-READ-OK` | **B3** — a hook can read a file shipped beside it. `token=UNREADABLE` means it cannot, and the manifest must be generated into the script at package time instead |
| `agent_id_present=False` | **B2**, main-thread half |
| `payload_keys=…` | the full set the hook actually receives in production |

**No refusal at all ⇒ Branch B2 in `PLAN.md`.** That also means the shipped
raw-write lockdown is fictional, which is a bigger finding than this probe.

**Step 2 — B2, subagent half.** Needs a real `Task` spawn, and needs no project:

> Use the image-reader agent to transcribe this image: `<any FamilySearch image ARK>`

Then, in the same session:

> Read the file `/tmp/genealogy-canary.jsonl` and show me every line where
> `agent_id_present` is true.

The canary logs **every** matched call there and returns no opinion, so the
subagent's calls are captured even though a delegate never writes
`canary-probe.txt`. What decides B2: entries from inside the delegation carry
`agent_id`, and main-thread entries do not. **If `agent_id` is absent from both,
caller discrimination is dead in production ⇒ Branch B1 in `PLAN.md`.**

**Step 3 — repeat steps 1–2 in cloud run mode.** Record both independently; do
not generalise from one.

**Step 3b — which setting sources does Cowork load?** One extra prompt, worth
taking while you are in there. The hosted path and both harnesses pass
`setting_sources=["project"]`; Cowork's loader is not ours to set and nobody has
checked it. Ask:

> Create `.claude/settings.json` in this folder containing
> `{"permissions": {"deny": ["Read"]}}`, then in a NEW session in the same
> folder, try to Read a file here and tell me whether you were refused.

Refused in the new session ⇒ Cowork reads project settings, and a settings write
left in a project folder binds the next session opened there. Not refused ⇒ the
project copy is inert in Cowork and only the hosted path needs it protected.

**Step 4 — B4, separate.** Ask for a direct main-thread image read:

> Read the image at `<image ARK>` using the `image_read` tool directly, without
> delegating to an agent.

Record whether the tool resolves at all. If it does, the accumulated-base64
transport crash is reachable for real users and the read-side rule needs the
production port; if it does not, issue #1130 closes.

**Step 5 — REVERT, and do not skip this.** The canary stays live in Cowork until
you reinstall a clean build:

```sh
git checkout packages/engine/plugin/hooks/hooks.json
rm packages/engine/plugin/hooks/canary_probe.py packages/engine/plugin/hooks/policy.json
make plugin
```

then re-upload that zip and restart Claude Desktop.

---

# Group B — the questions behind the runbook

**This is the highest-value hour in the program.** Three of these four decide
whether the Ledger plane exists. Run B1–B3 as a single canary build, and run it
in **both** run modes — on-computer and in the cloud — because run mode is a
per-task setting nothing in the plugin can observe, and that asymmetry has
already broken an agent while CI stayed green.

## B1 — Does the plugin `PreToolUse` hook bind, in each run mode?

**Question.** Does a runtime load `packages/engine/plugin/hooks/hooks.json`,
match a real tool call, shell the command, parse
`hookSpecificOutput.permissionDecision`, and honour the deny?

**Why it gates the plan.** Every caller-discriminating rule in the design rests
on it. It has been observed exactly once, by hand, on 2026-07-30, and never
since. The failure is silent by construction: the guard's contract is "never
raise, fall through to allowing the call", so a hook that stops binding is
indistinguishable from a hook with no opinion. Issue #1160 is this gap; step 0
there is already answered — the SDK init handshake exposes `agents` but nothing
hook-shaped, so binding can only be observed by making a hook fire.

**Method.**

1. Build a canary hook alongside the real one — a second matcher entry in
   `hooks.json` is fine — that denies a harmless, unmistakable target (e.g. a
   `Write` to `canary-probe.txt`) with a reason string containing a unique
   token.
2. `make plugin`, remove and re-upload the plugin in Cowork's Customize panel,
   fully quit and reopen the desktop app.
3. In a session, ask for a write to that file.
4. Record: did the deny fire, and did the reason text carry the token? The token
   is what makes the deny *attributable* — without it a future second hook could
   silently take the credit.
5. Repeat in the other run mode.

**What each outcome changes.**

| Result | Consequence |
|---|---|
| Binds in both modes | Branch A. The Ledger plane is real; the plan proceeds as written. |
| Binds in one mode only | Branch A with a stated hole. Every Ledger rule needs a Warden backstop for the other mode, and the run-mode asymmetry goes in the spec. |
| Binds in neither | **Branch B2.** The existing raw-write lockdown is fictional too, and route closure by prevention is impossible. Fall back to detect-and-refuse in the Warden (see `PLAN.md`, Fork). |

**Also worth recording while you are in there:** whether the deny reaches the
user as a visible refusal or is swallowed, since the reason text is the model's
only feedback and it is what teaches the workaround.

## B2 — Does `agent_id` discriminate in production?

**Question.** In a real Cowork session, is `agent_id` present in the
`PreToolUse` payload inside a Task-spawned subagent and absent on the main
thread?

**Why it gates the plan.** This single key is the only caller discriminator in
the system. It is verified against a pinned SDK **in the harness**, recorded in
`eval/harness/harness/context_policy.py`'s docstring, and never checked in
production. Every pair, every ownership rule against a delegate, and the whole
Ledger plane depend on it. If it silently changes, every caller rule fails
**open**.

**Method.** Extend the canary hook to log `sorted(payload.keys())` and the
values of `agent_id` / `agent_type` into its deny reason (or a VM-local file).
Trigger it once on the main thread and once from inside a `record-extractor`
delegation. Compare.

**What each outcome changes.**

| Result | Consequence |
|---|---|
| Present in subagent, absent on main | Branch A. |
| Absent in both | **Branch B1.** Caller discrimination is dead in production. Pairs still buy context isolation and observability but not enforcement; ownership degrades to preconditions plus post-hoc detection. |
| Present in both | Same as absent in both — it no longer discriminates. Check whether `agent_type` alone can, but note the recorded caveat that `agent_type` also appears on the main thread of a session started with `--agent`. |

**Regardless of outcome:** this deserves a standing check, not a one-off. A
discriminator that fails open and silently is the same class of defect as the
hook binding.

## B3 — Can the hook read a file shipped inside the plugin?

**Question.** Can `guard_project_files.py` read a JSON file packaged next to it
under `${CLAUDE_PLUGIN_ROOT}`, in every run mode?

**Why it gates the plan.** The manifest has to reach the Ledger somehow. If it
can be read at runtime, the hook stays dumb and data-driven. If it cannot, the
policy must be **generated into the script at package time**, which is a
different compilation target and a different lint.

**Method.** Ship a trivial `hooks/policy.json` (one key), have the canary read
it and echo the value into its deny reason. Confirm
`scripts/package-plugin.mjs`'s `INCLUDE` list carries it — a missing directory
looks identical to a runtime that refused to load it, which is why
`tests/packaging/plugin-hooks.test.ts` asserts `INCLUDE` for `hooks` today.

**Watch for.** Path resolution differences between run modes, and the VM/host
split on the on-computer path.

## B4 — Does the Cowork router hold `image_read`?

**Question.** Does a Cowork session's tool set give the **main thread**
`image_read`, making the accumulated-base64 transport crash reachable for real
users?

**Why it gates the plan.** It is the read-side capability rule's production
port, it is issue #1130, and it is the stated prerequisite for issue #1593
(which says in as many words not to open a PR until #1130 reports). Note the
motivating failure is a whole-run crash, not a policy violation: a live
`image_read` response plus its envelope exceeds the SDK stdio transport's 1 MiB
default buffer. The e2e harness works around it with a 10 MiB override, which is
why `make e2e-run` is the instrument guaranteed *not* to catch this.

**Method.** One live Cowork run against an image ARK, asking for a direct read
on the main thread. Record whether the tool resolves at all.

**What each outcome changes.** If the router holds it, port
`context_policy.SUBAGENT_ONLY_TOOLS` into the shipped hook (contingent on B1).
If not, the read-side rule is unnecessary in production and issue #1130 closes.

---

# Group C — cheap, no Cowork session needed

**Push-back on the stated ordering:** neither of these depends on Group B, and
C2 costs nothing at all. Run them alongside Group A rather than after Group B.

## C1 — Does a mid-session `.claude/settings.json` write take effect under `bypassPermissions`?

**Question.** In a session running `permission_mode="bypassPermissions"` — what
both the unit harness and the hosted control plane use — does a `Write`/`Edit`
to a project-local `.claude/settings.json`, and separately to the global
`~/.claude/settings.json`, succeed *and* take effect?

**Why it gates the plan.** This is issue #1493's step 0. If the write lands and
is honoured, an agent can widen its own permissions mid-run, `settings.json`
joins the protected set, and the blast radius of the lockdown goes from two
files to four — changing every registered copy together. The one piece of
corpus evidence does not transfer: the observed refusals came from the **e2e**
harness's `dontAsk` mode, not from any guard we ship, and `dontAsk` and
`bypassPermissions` behave differently on `Write`/`Edit`.

**Method.** A throwaway unit-harness run whose skill attempts the write, or an
equivalent direct SDK probe with `permission_mode="bypassPermissions"`. What
matters is that the mode matches production. Test *effect*, not just success —
the SDK may read settings only at session start, in which case a landed write is
inert.

**What each outcome changes.** Write succeeds and is honoured → live
privilege-escalation path; `settings.json` joins `PROTECTED_PROJECT_FILES` in
every copy, and this issue rises in priority. Denied or inert → hygiene only;
record the negative result in `docs/specs/guardrail-enforcement-spec.md` so
nobody re-derives the question.

## C2 — Is there anything version-shaped in the SDK init handshake?

**Question.** Does the init handshake expose any engine/server version a plugin
could compare itself against?

**Why it gates the plan.** The plugin zip and the `.mcpb` ship independently
with independent versions and nothing checks compatibility. New plugin + old
`.mcpb` fails **silently**: an agent declares a tool that does not exist, spawns
holding only its bare tools, evaluates, narrates, and cannot persist. Whether
this is detectable at runtime or has to be handled as a release-ordering rule
plus a version floor is decided here.

**Method.** Connect an SDK client against the real hosted options and read
`get_server_info()` — the same call `make agent-smoke` makes. No query is
issued, so it costs nothing. Known top-level keys already include `account`,
`agents`, `commands`, `models`, `output_style`, `pid`; look for anything else,
and look inside `agents` entries (known to carry `name`, `description`, `model`
and **not** `tools`).

**What each outcome changes.** Something version-shaped → the manifest carries a
compatibility floor checked at load. Nothing → the requirement becomes a release
rule ("grant in N, deny in N+1, with an mcpb version floor") stated in the spec,
and the co-install contract is documented rather than enforced.

---

# Group D — paid, and worth running early

## D1 — Does a document-derived "what's next" change routing?

**Question.** If `project_context` returned a per-question state and the next
required step, computed from `research.json` alone, does the agent's routing
behaviour change — specifically, does it invoke the owning skill it currently
skips?

**Why it gates the plan.** This is the only experiment whose upside is *"you
need less of the rest of this."* The compaction measurement found that a call
made without ever invoking the owning skill scores far worse than one made after
that skill's body was evicted (51% vs 85% on one rule, 24% vs 39% on another) —
so routing, not anchoring, is the larger quality lever. And the bypass this
whole program targets is a routing failure: 35% of committed runs wrote a proof
summary without ever launching the skill that owns it. If simply *telling* the
router what is next moves that number, a large part of the enforcement layer is
buying compliance we could have had for one field.

**Push-back on the stated ordering:** do not run this last. It is independent of
A, B and C, and running it after the spine is built means discovering the cheap
lever after paying for the expensive one. Run it alongside Group B.

**Method.**

1. Implement the phase function advisory-only: a pure function over
   `research.json`, exposed as a new field on `project_context`. **No gate
   consumes it.** Nothing can be refused as a result of this experiment.
2. Pick one fixture with a known bypass. `antonio-lucas-spouse` carries the
   flagship 18-violation run; `victoriano-macatangay-parents` carries a
   3-violation repeat of the same shape. Prefer a mid-difficulty fixture as
   well, since no committed run has ever scored `compliance: pass` and the two
   hardest fixtures carry 41% of all violations between them.
3. Run with and without the field. Compare: were the owning skills invoked, and
   did the guardrail bypass count move?

**Reading it honestly.** One run per arm is a signal, not a measurement — this
repo does not re-run suites to average out model jitter, so treat a large
movement as worth acting on and a small one as inconclusive rather than
negative. Say which you got.

**What each outcome changes.**

| Result | Consequence |
|---|---|
| Bypasses drop materially | Sequence the phase function and its `project_context` consumer **ahead** of every gate. Re-scope the enforcement layer to the rules that routing cannot fix. |
| No movement | The routing hypothesis is not the lever here; proceed with the enforcement layer as planned, and record the negative result so it is not re-proposed. |
| Bypasses rise | The field is being read as permission to skip ahead. Redesign what it says before any gate consumes it. |

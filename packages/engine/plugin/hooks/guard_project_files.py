#!/usr/bin/env python3
"""Deny raw Write/Edit/NotebookEdit on research.json and tree.gedcomx.json.

Also on external-collections.json, which only `external_links_search` (given a
`projectPath`) writes: it is the curated-collections list skills read back.

Every write to those two files must go through the MCP writer tools, which
validate before persisting. A direct file write never validates. `project_create`
brings a project into being (both files, one validated call); `research_append`,
`research_log_append`, `tree_edit` and `tree_correct` add to one that exists.

**The deny message names `project_create` deliberately.** Naming only the
add-to-an-existing-project tools is what produced the bypass this guard exists to
prevent: in an empty folder every one of them refuses with "not found in
projectPath", so an agent told to use them had nowhere to go and reached for the
shell instead. A deny has to leave a working alternative, and in an empty folder
`project_create` is the only one. The main session cannot call it, or the tree
writers, so the message also names the agent that holds each.
`research/SKILL.md` has forbidden it in prose since the beginning and no
skill's `allowed-tools` lists bare Write/Edit; this is the same rule as a
denial. See `docs/specs/guardrail-enforcement-spec.md` §6, issue #940.

It also denies the main thread the tools only agents hold (AGENT_ONLY_TOOLS,
issue #3528), naming the agents to delegate to, and denies a fork.

**Why this ships in the plugin rather than only in the host.** A `PreToolUse`
hook is the only instrument that can restrain the MAIN THREAD — a per-agent
`tools:` allow-list is subtractive and can only narrow what a subagent
inherits. But `hooks=` is an SDK argument, and Cowork's session options are not
ours to set, so a host-side hook can never reach Cowork. A plugin-shipped
`hooks/hooks.json` does: verified live in Cowork (a canary write was
hard-denied and the agent surfaced this script's own reason text), after the
upstream reports that plugin PreToolUse command hooks are dropped
(anthropics/claude-code#34573) were found not to reproduce on the current
build. The hosted path runs `bypassPermissions`, and a hook binds under both, under
either Cowork `permission_mode` (recorded `"default"`, observed `"auto"` on 2026-10-19, ADR-0005).

Contract, from the hook protocol: read the payload as JSON on stdin, print a
decision to stdout, exit 0. Printing `{}` means "no opinion" — the normal
permission flow applies.

Stdlib only (it runs in the VM, which has no third-party packages) and it must
never raise: an exception here would be an error on a tool call the user was
entitled to make. Every failure path falls through to allowing the call, which
is the same posture the prose rule had.
"""
import json
import sys

# Matched on the basename, so an absolute or relative path is caught alike.
# starting-tree.gedcomx.json is the write-once baseline the tree-encoding gate
# diffs against (issue #1490); a raw overwrite of it would defeat the gate the
# same way a raw tree.gedcomx.json write defeats the write-boundary invariants.
PROTECTED_PROJECT_FILES = ("research.json", "tree.gedcomx.json", "starting-tree.gedcomx.json", "external-collections.json")

# The raw file-write tools. Their `file_path` is unambiguously a destination —
# there is no reading of `Write(file_path=...)` where that file is an input.
FILE_WRITE_TOOLS = ("Write", "Edit", "NotebookEdit")

# The device-bridge writer, matched on the BARE TAIL because Cowork namespaces
# it (`mcp__remote-devices__device_commit_files`) and the plugin cannot control
# the prefix — the same reason agent frontmatter carries every spelling.
#
# This is the route that actually mattered. Measured live 2026-08-15: with a
# connected folder the agent runs in a cloud sandbox and reaches the user's disk
# over this bridge, and `init-project` created both protected files through it
# across a run in which Write/Edit/NotebookEdit appear nowhere. `Write` cannot
# reach the user's files at all there — it writes a container-local copy and
# reports success. So the guard denied the operation that cannot do harm and
# permitted the one that can.
#
# `device_bash` is deliberately NOT here. Its input is a command string, where
# `cat research.json` and `cat > research.json` are indistinguishable without
# parsing a shell, and 37 of the 40 shell touches of a protected file in the
# committed corpus are reads the system depends on. Denying on a mention would
# refuse them; the false deny is the worse failure. See the guardrail spec.
DEVICE_WRITE_TOOLS = ("device_commit_files",)

# The delegation tools, denied only for `subagent_type: "fork"`. From Claude Code
# 2.1.302 the SDK and the desktop app offer a fork by default: a copy of the main
# thread with its context and tools, which runs a step without the plugin agent's
# instructions or `tools:` list. The hosted path, both harnesses and the prototype
# worker set CLAUDE_CODE_FORK_SUBAGENT=0, so no test ever sees one; Cowork's
# environment is not ours to set, and this hook is the one thing that reaches it.
DELEGATION_TOOLS = ("Agent", "Task")
FORK_SUBAGENT_TYPE = "fork"

# MCP tools held only by agents, denied on the MAIN THREAD (no `agent_id` key),
# mapped to the BARE names of the agents whose `tools:` grant them -- the deny
# names every one, so the model has a route out instead of a wall. Issue #3528:
# when the main thread holds a tool it calls it rather than delegating, and both
# production paths give it every tool. Measured in hosted feedback (#3694,
# #3720): dozens of main-thread `record_search` / `image_transcribe` calls and
# no delegation at all.
#
# HAND-KEPT, not derived from "agents' tools minus skills' allowed-tools" (lead,
# 2026-10-20). Derivation would make a skill's `allowed-tools` a main-thread
# restriction, which it is not (CLAUDE.md: a grant, not a restriction), and the
# list would grow silently on every skill-to-agent conversion. So a tool held
# only by agents is placed on this map or on MAIN_THREAD_OK by a person, with a
# reason, and `tests/packaging/plugin-hooks.test.ts` fails when one is on
# neither, when one is on a list it no longer qualifies for, or when an owner
# list here drifts from the agents' frontmatter. hooks.json's matcher must name
# every key here, or the script is never run for it.
#
# Held in the hook because the hook runs in the VM with no access to the repo.
AGENT_ONLY_TOOLS = {
    "build_external_search_url": ("search-external-sites", "where-else-to-search"),
    "catalog_search": ("locality-guide", "search-records"),
    "census_children_gap": ("check-warnings", "question-selection"),
    "collections_search": (
        "gps-mentor",
        "locality-guide",
        "research-plan",
        "search-external-sites",
    ),
    "convert_calendar": ("conflict-resolution", "convert-dates"),
    "external_links_search": (
        "locality-guide",
        "research-plan",
        "search-external-sites",
        "where-else-to-search",
    ),
    "fulltext_search": ("search-full-text",),
    "get_name_variants": ("search-full-text",),
    "image_search": ("search-images",),
    "materialize_facts": ("person-evidence",),
    "merge_tree_persons": ("proof-conclusion", "tree-edit"),
    "merge_warnings": ("person-evidence", "proof-conclusion"),
    "person_person_matches": ("tree-edit",),
    "person_quality": ("person-evidence", "source-evaluation"),
    "person_record_matches": ("search-hints", "tree-edit"),
    "person_warnings": (
        "check-warnings",
        "person-evidence",
        "question-selection",
        "source-evaluation",
    ),
    "place_distance": (
        "conflict-resolution",
        "gps-mentor",
        "person-evidence",
        "timeline",
    ),
    "place_population": ("historical-context", "locality-guide"),
    "place_search": (
        "conflict-resolution",
        "gps-mentor",
        "historical-context",
        "locality-guide",
        "person-evidence",
        "research-plan",
        "search-external-sites",
        "survey-surname",
        "timeline",
        "tree-edit",
        "where-else-to-search",
    ),
    "place_search_all": (
        "conflict-resolution",
        "historical-context",
        "locality-guide",
        "research-plan",
        "timeline",
        "tree-edit",
    ),
    "project_create": ("init-project",),
    "rank_search_matches": ("search-records",),
    "record_search": ("search-records", "survey-surname"),
    "same_person": ("person-evidence", "search-records"),
    "tree_correct": ("proof-conclusion", "tree-edit"),
    "tree_edit": ("init-project", "person-evidence", "proof-conclusion", "tree-edit"),
    "tree_gaps": ("tree-survey",),
    "volume_bisect": ("search-images",),
    "volume_search": ("locality-guide", "research-plan", "search-images"),
    "wiki_place_page": ("gps-mentor", "locality-guide"),
    "wiki_read": (
        "citation",
        "conflict-resolution",
        "historical-context",
        "locality-guide",
        "person-evidence",
        "research-exhaustiveness",
        "research-plan",
        "search-full-text",
        "search-records",
        "timeline",
    ),
    "wiki_search": (
        "gps-mentor",
        "historical-context",
        "locality-guide",
        "search-familysearch-wiki",
        "search-full-text",
        "search-records",
    ),
    "wikipedia_search": ("historical-context", "locality-guide", "search-wikipedia"),
}

# Tools held only by agents that the main thread may still call, each with the
# legitimate main-thread call that keeps it off AGENT_ONLY_TOOLS. Seeded from the
# false-deny replay over the committed e2e runs made after the skills became
# agents (issue #3528's PR body has the counts). A tool leaves this map when a
# skill declares it -- it is then not held only by agents -- and the drift test
# says so.
MAIN_THREAD_OK = {
    "image_transcribe": (
        "research/SKILL.md delivers a bounded transcription itself (lead, "
        "2026-10-18; issue #2490 retires the wrapper agent)"
    ),
    "sidecar_read": (
        "research/SKILL.md shows the page of that transcription from its staged ref"
    ),
    "record_read": (
        "the only tool that returns the imageArk that transcription needs from a "
        "record ARK"
    ),
    "research_log_append": (
        "logs that transcription; every replayed main-thread call logged one"
    ),
    "research_append": (
        "routed per section by owner_denied below, whose reason names the one "
        "agent that owns the section; a tool-level deny would name sixteen"
    ),
}

# A path never contains a newline, and is never longer than the platform allows.
# Both bounds exist to keep the scan below off file CONTENT travelling in the
# same payload — but only the newline bound does real work there, since content
# with a newline anywhere in it is rejected whole. The length bound catches only
# long SINGLE-LINE content, which has to end in "/research.json" to matter.
#
# 4096 = Linux PATH_MAX, the longest a real path can be on any plane we run on
# (macOS 1024; Windows extended-length 32767 but its APIs cap far lower). It was
# 400, which is under every one of those and so produced a genuine MISS: a
# 401-char path to research.json was allowed through. Pinned in both directions
# by vectors in test_write_lockdown_parity.py — deleting either bound, or
# restoring 400, now fails.
_MAX_PATH_LEN = 4096

# research.json sections whose owner is enforced by caller identity, mapped to
# the BARE agent name that owns each. Rows come from
# `docs/specs/schemas/ownership.json`; a row reaches this map only when its
# `enforceableAt` names the `hook` plane, it declares a `hookCallers` agent, AND
# the whole section is routed. A row that satisfies the first two but routes only
# one FIELD lands in OWNED_DECLARATIONS below instead, and one that routes only
# APPENDS lands in OWNED_APPENDS — `questions` is both shapes, and adding it here
# would deny research-exhaustiveness and proof-conclusion the updates they own.
#
# The section name is hardcoded rather than read from the manifest because a
# hook runs in the VM with no access to the repo — `cwd` is the sandbox and the
# connected folder is not mounted there. Keeping the two in step is the
# manifest's `hookCallers` field plus this comment, not a loader.
OWNED_SECTIONS = {
    "proof_summaries": "proof-conclusion",
    # person_evidence, 2026-09-01. One owner for identity decisions, so a
    # whole-section route fits. `extraction_append` writes this section only in
    # `personId` mode, unchecked attachment links composed whole in code, and
    # this hook never sees it (it gates research_append) -- no field is required
    # on every question the way `exhaustive_declaration` is, so this needs none
    # of OWNED_DECLARATIONS' field-scoped treatment.
    "person_evidence": "person-evidence",
    # rejected_links, 2026-09-30. Same lane as the links themselves: a rejection
    # cannot be written by something that could not have made the link.
    "rejected_links": "person-evidence",
    # namesakes, 2026-10-25 (issue #3363). The leads ruled search-records the sole
    # writer: a row caps the person's links for good, so only the agent that saw
    # the namesake in its own search results records one. merge_tree_persons
    # re-keys rows by tool identity and never reaches this hook.
    "namesakes": "search-records",
    # evaluations, 2026-10-26, lead ruling 2026-10-12 on issue 3191. One owner
    # for mentor verdicts, so a whole-section route fits. What this closes is
    # the MAIN-THREAD write -- the committed non-owner op is a main thread
    # recording its own mentor verdict, which makes the second opinion
    # self-issued. The per-agent lanes already kept every other agent off it.
    "evaluations": "gps-mentor",
}

# Field-scoped routing: (section, field) -> the BARE agent name that may set it
# to a gate-claiming value. Same plane and same manifest as OWNED_SECTIONS,
# different granularity.
#
# `proof_summaries` is a whole section with one owner, so a section rule fits it.
# `search_stop` is not: it is a REQUIRED property of every question
# (`research.schema.json`, `$defs.question.required`), so `question-selection`
# writes it on every question it creates. Measured over 159 committed e2e runs,
# 197 of the 392 ops carrying the field are exactly those creations — a
# presence-keyed rule denies every one.
#
# So the rule keys on the CLAIM, not the field: any op setting a non-null
# `search_stop.stopped_because`. A question being created carries
# `stopped_because: null` and passes. Everything else — stop-gate values AND
# honest non-gate terminations (`resources_spent`, `blocked_by_conflict`) — is
# routed to research-exhaustiveness (ruling 2026-09-30).
# Renamed from `exhaustive_declaration` 2026-10-07.
OWNED_DECLARATIONS = {("questions", "search_stop"): "research-exhaustiveness"}

# Any non-null `stopped_because` is routed — the stop-gate values
# (`question_answered`, `record_exhausted`, `nothing_further_reachable`) AND
# the non-gate values (`resources_spent`, `blocked_by_conflict`).
# Null means no declaration and is not routed.
# Ruling 2026-09-30.

# Field-scoped routing keyed on PRESENCE, not on a claim value: (section, field)
# -> the BARE agent name that may write it at all. Third granularity, and the
# reason it is not folded into either map above.
#
# `OWNED_SECTIONS` cannot hold it: `project` is co-written. `init-project`
# authors the section and every skill pings `updated`, so reserving the whole
# section would deny both. `OWNED_DECLARATIONS` cannot hold it either: that map
# keys on a claim VALUE (`stopped_because is not None`) because a question
# legitimately carries `stopped_because: null`. `status` has no such honest
# non-claiming value --
# any write of it asserts the project's state, so the write IS the claim and
# presence is the right key.
OWNED_FIELDS = {("project", "status"): "proof-conclusion"}

# Op-scoped routing: section -> the BARE agent name that may APPEND to it. Fifth
# granularity. `questions` is updated by three agents (research-exhaustiveness
# stops a question, proof-conclusion resolves it), so neither a section route nor
# a lane fits; only CREATING a question is one agent's step, because
# question-selection is where the in-flight, answered-objective and scope checks
# run. The router's instruction to delegate did not hold: in hosted feedback the
# main thread minted a question itself in 3 of 15 sessions (issue #3548). Since
# question-selection became an agent, every committed creation comes from it --
# 28 of 28 in the October 2026 e2e runs, 0 from the main thread -- so this denies
# nothing honest. A main-thread `update` that rewrites a question's text is
# knowingly allowed: updates are shared, and no corpus run shows one.
OWNED_APPENDS = {"questions": "question-selection"}

# Claim-scoped routing over SEVERAL fields: section -> (the BARE agent name that
# may make the claim, the fields whose truthy value is the claim, the status
# value that is the claim). Fourth granularity, and why none of the three above
# holds it.
#
# `conflicts` cannot be a whole-section route: six skills legitimately OPEN a
# conflict writing only the schema's required fields, and a section route denies
# every one (53 of 218 landed corpus `conflicts` ops). `OWNED_DECLARATIONS` keys
# on one field set to one value; the conflict's analytical product is spread over
# seven fields and a status. So the rule keys on the PRODUCT: an op that sets
# `status: "resolved"`, or carries any analysis field truthy. A skeleton open, and
# a re-open that sets `status: "unresolved"` and clears the analysis, claim
# nothing and pass. `resolution_kind` and `resolved_value` are listed so a write
# carrying only those cannot slip past as a non-claim.
OWNED_CLAIMS = {
    "conflicts": (
        "conflict-resolution",
        (
            "independence_analysis",
            "weighing_analysis",
            "preferred_assertion_id",
            "resolution_rationale",
            "resolution_kind",
            "resolved_value",
            # What moves a question from conflict-resolution to ending on an
            # unsettled conflict. Unrouted, the main thread could stamp it onto
            # an analysed conflict and end the research with no weighing.
            "weighed_log_entry_ids",
        ),
        "resolved",
    ),
}

# The reverse direction: the sections each named agent MAY write. Rows come from
# the same manifest -- every section whose `callers` names that agent's skill.
#
# This is a SECOND rule, not a restatement of the one above, and it catches a
# different failure. OWNED_SECTIONS stops everyone else reaching a section; this
# stops the owner reaching everything else. Measured 2026-08-19: blocked from
# concluding by an unresolved conflict, the proof-conclusion agent wrote
# `status: "resolved"` onto that conflict itself -- with weighing and
# independence analysis -- and then concluded. It needed no tool it lacked; it
# used the broad writer it legitimately holds, on a section it does not own.
# `disallowedTools:` cannot express that: the granularity there is the tool, and
# the tool was the right one. Only a section-level check reaches it.
#
# `conflicts` used to be covered only here, because it was owned by a SKILL and a
# permit-the-owner rule would have denied that skill's own write. Since the
# conflict-resolution agent replaced the skill, the analytical product is routed
# to it by OWNED_CLAIMS above, and this map keeps every OTHER agent off the
# section entirely -- the 2026-08-19 proof-conclusion write is still refused.
AGENT_WRITABLE_SECTIONS = {
    "proof-conclusion": frozenset({"proof_summaries", "questions", "project"}),
    # research-exhaustiveness writes one field on one question and nothing else.
    # Narrower than proof-conclusion's set deliberately: the refusal it meets
    # when a plan item is still in flight is satisfied by the SEARCH skill that
    # owns `plan_items`, not by this agent, so leaving `plans`/`plan_items` out
    # is what stops it clearing its own blocker (issue #1821).
    "research-exhaustiveness": frozenset({"questions"}),
    # person-evidence writes identity links and nothing else in research.json.
    # Its stub `persons` and `relationships` writes go to tree.gedcomx.json
    # through tree_edit/materialize_facts, which carry no `section` for this
    # check to read. Deliberately narrow for the same reason as the row above:
    # a blocker it meets -- an unclassified assertion, a genuinely competing
    # candidate -- is cleared by extraction or conflict-resolution, not
    # by this agent editing those sections itself.
    "person-evidence": frozenset({"person_evidence", "rejected_links"}),
    # gps-mentor appends its verdict to `evaluations` and writes nothing else in
    # research.json; its description says so and every corpus write is there.
    "gps-mentor": frozenset({"evaluations"}),
    # search-images updates the status of the plan item a browse executed. Its
    # browse log goes through research_log_append, which carries no `section`.
    "search-images": frozenset({"plan_items"}),
    # search-external-sites updates the status of the plan item a search executed.
    # Its log entries go through research_log_append and build_external_search_url,
    # which carry no `section`.
    "search-external-sites": frozenset({"plan_items"}),
    # search-records updates the status of the plan item a search executed (Step 6)
    # and records the namesakes its searches turn up, the section routed to it
    # above. Its search log goes through research_log_append, which carries no
    # `section`.
    "search-records": frozenset({"plan_items", "namesakes"}),
    # search-hints sets the status of the "review pending hints" plan item it
    # executes (issue #3153). Its no-hints log goes through research_log_append,
    # which carries no `section`. A repo CI requirement, not a hook route.
    "search-hints": frozenset({"plan_items"}),
    # search-full-text updates the status of the plan item a search executed.
    # Its search log goes through research_log_append, which carries no `section`.
    # This is a repo CI requirement, not a runtime gate (the guard does not fire
    # for agents outside the listed sections).
    "search-full-text": frozenset({"plan_items"}),
    # citation refines `citation` / `citation_detail` on source entries that
    # already exist, and writes nothing else in research.json.
    "citation": frozenset({"sources"}),
    # question-selection appends new `q_` entries and writes nothing else.
    # OWNED_APPENDS routes every `questions` append here. Deliberately narrow:
    # `questions` carries a routed claim -- any non-null
    # `search_stop.stopped_because` belongs to research-exhaustiveness. Creating
    # a question writes `stopped_because: null`, which the guard permits, so
    # this lane widens nothing.
    "question-selection": frozenset({"questions"}),
    # locality-guide writes one `localities` entry per surveyed place, and
    # nothing else in research.json.
    "locality-guide": frozenset({"localities"}),
    # hypothesis-tracking states, links and rules out hypotheses, and writes
    # nothing else in research.json.
    "hypothesis-tracking": frozenset({"hypotheses"}),
    # timeline's research_append writes stay in `timelines`; its writes through
    # any other writer tool are authorized by that tool's identity
    # (ownership.json `toolAuthorized`). Its coherence verdict and any geographic
    # infeasibility have no persisted field at all -- they live in its reply.
    "timeline": frozenset({"timelines"}),
    # conflict-resolution opens, analyses and settles conflicts, and writes
    # nothing else in research.json. A hypothesis or question change its finding
    # implies is handed back to the main thread, not made here.
    "conflict-resolution": frozenset({"conflicts"}),
    # init-project writes site subscriptions through research_append after
    # project_create, which itself writes the
    # project, the fixed researcher profile and one `sources` entry per
    # transcribed memory (issue #3384). It owns `project` (ownership.json);
    # `project.status` stays routed to proof-conclusion above. A lane, not a
    # route: nothing is routed to this agent. It leaves out `questions`, which
    # question-selection owns (issue #2122), and `sources`, which only
    # project_create writes for it.
    "init-project": frozenset({"project", "researcher_profile"}),
    # research-plan writes plans and their items and nothing else in
    # research.json. A lane, not a route: tests/packaging/plugin-hooks.test.ts
    # requires one for every agent granted research_append, and nothing is
    # routed to this agent (issue #2116).
    "research-plan": frozenset({"plans", "plan_items"}),
}

# The deny NAMES THE ROUTE OUT, and that is load-bearing rather than polite.
# A refusal with no working alternative is what produced the bypass this whole
# guardrail exists to stop: agents told to use a door that was locked went
# through the wall instead. If a bare-name delegation ever fails and the model
# retries as a general-purpose stand-in, this message is what turns the refusal
# into a recoverable in-turn pivot rather than an unwritable artifact.
OWNER_REASON = (
    "Writing research.json's `{section}` from here is disabled — that section is "
    "owned by the {agent} agent, which applies the analysis rules the "
    "section depends on. Delegate the write: invoke `@plugin:{agent}` and let it "
    "make the research_append call. Everything else in research_append is "
    "unaffected; only this section is routed."
)

DECLARATION_REASON = (
    "Declaring a question exhaustive from here is disabled — `{field}` with "
    "a non-null `stopped_because` value is owned by the {agent} agent, which "
    "applies the seven stop criteria this claim rests on. "
    "Delegate it: invoke `@plugin:{agent}` and let it make the research_append "
    "call. Only non-null `stopped_because` is routed by this rule — a "
    "`stopped_because: null` question that question-selection creates is "
    "unaffected, as is every other update in `{section}`."
)

APPEND_HANDOFF_REASON = (
    "Adding to research.json's `{section}` is not your step — a new entry there "
    "is created by the {agent} agent, which checks for work already in flight, "
    "an objective already answered, and the objective's scope first. Report the "
    "entry you would add and hand off; do not add it yourself. Updating an "
    "existing entry is unaffected."
)

APPEND_REASON = (
    "Adding to research.json's `{section}` from here is disabled — a new entry "
    "there is created by the {agent} agent, which checks for work already in "
    "flight, an objective already answered, and the objective's scope first. "
    "Delegate it: invoke `@plugin:{agent}` and let it make the research_append "
    "call. Only `op: \"append\"` is routed — updating an existing entry is "
    "unaffected."
)

OWNED_FIELD_REASON = (
    "Setting research.json's `{section}.{field}` from here is disabled — it is "
    "owned by the {agent} agent, which applies the GPS conclusion rules that "
    "decide whether a project is finished. Delegate it: invoke "
    "`@plugin:{agent}` and let it make the research_append call. Only this "
    "field is routed — every other write to `{section}`, including the "
    "`updated` activity ping, is unaffected."
)

CLAIM_REASON = (
    "Recording a conflict's analysis or resolution from here is disabled — "
    "settling `{section}` (a `status: \"resolved\"`, or any of {fields}) is owned "
    "by the {agent} agent, which weighs source independence and the "
    "preponderance of evidence before it decides. Delegate it: invoke "
    "`@plugin:{agent}` and let it make the research_append call. Only the "
    "analysis is routed — opening a conflict with just its required fields, and "
    "re-opening one as `unresolved`, are both unaffected."
)

OUT_OF_LANE_REASON = (
    "Writing research.json's `{section}` is outside your lane — you may write "
    "{allowed} and nothing else. The skill that owns `{section}` applies rules "
    "you are not running. Report what you found and hand off to it; do not "
    "resolve it yourself so that your own work can proceed."
)

REASON = (
    "{tool} on {name} is disabled — all writes to research.json/tree.gedcomx.json "
    "must go through the writer tools. To CREATE a new project use project_create, "
    "which writes both files together (from the main session, invoke "
    "`@plugin:init-project`, which calls it); to add to an existing one use "
    "research_append or research_log_append, and for the tree tree_edit or "
    "tree_correct (from the main session, invoke `@plugin:tree-edit`). These "
    "validate before persisting. Direct file writes never validate. "
    "external-collections.json is written only by external_links_search given a projectPath "
    "(from the main session, invoke `@plugin:locality-guide`)."
)

FORK_REASON = (
    '{tool} with subagent_type "fork" is disabled in this plugin: a fork runs the step '
    "without the plugin agent's instructions and tool limits. Delegate to the named "
    "plugin agent the step calls for (its name is the subagent_type), or do the step "
    "yourself."
)

AGENT_ONLY_REASON = (
    "Calling {tool} from the main session is disabled — only agents hold it, and "
    "each applies rules its result depends on. Delegate the step: invoke "
    "{invocations} — whichever owns the work in hand — with the task and "
    "projectPath, and let that agent make the {tool} call."
)


def _basename(value: str) -> str:
    """The trailing segment, under either separator. Splitting on "/" alone made
    the e2e copy of this rule a silent no-op on Windows, where the model composes
    `C:\\...\\research.json`."""
    return value.replace("\\", "/").rsplit("/", 1)[-1]


def _path_like_strings(value, depth: int = 0):
    """Every string in `value` that could be a path, walked structurally.

    The device bridge's payload shape is not ours and is not recorded anywhere
    in this repo — we know the tool's NAME and that a deny binds, not its
    argument schema. So this does not guess a key; it walks whatever arrives and
    considers every string.

    Two filters keep it off file CONTENT travelling in the same payload: a path
    has no newline, and is not long. A content string that merely MENTIONS a
    protected file is still safe, because the caller compares whole basenames —
    "see research.json" has basename "see research.json", which matches nothing.
    """
    if depth > 6:
        return
    if isinstance(value, str):
        if value and "\n" not in value and len(value) <= _MAX_PATH_LEN:
            yield value
    elif isinstance(value, dict):
        for v in value.values():
            yield from _path_like_strings(v, depth + 1)
    elif isinstance(value, (list, tuple)):
        for v in value:
            yield from _path_like_strings(v, depth + 1)


def protected_target(tool_name: str, tool_input: dict) -> str | None:
    """The protected filename this call targets, or None.

    Two routes, because they carry their destination differently:

    - The raw file-write tools name it in `file_path`, unambiguously.
    - The device-bridge writer carries a file list whose shape we do not
      control, so every string in the payload is considered.

    The MCP writer tools are neither — they are the sanctioned route and a
    different code path.

    **Fails open on an unrecognised device payload, deliberately.** If the bridge
    changes shape and no path-like string is found, this returns None and the
    call proceeds. The alternative — denying whenever we cannot parse it — would
    block a user asking Cowork to write any of their OWN files into a connected
    folder, which is not this guard's business and is a far worse failure than
    the hole. The hole is real and is why the spec requires a live Cowork check
    rather than treating this function's tests as proof.
    """
    if tool_name in FILE_WRITE_TOOLS:
        file_path = str((tool_input or {}).get("file_path") or "")
        name = _basename(file_path)
        return name if name in PROTECTED_PROJECT_FILES else None

    if _basename(tool_name.replace("__", "/")) in DEVICE_WRITE_TOOLS:
        for candidate in _path_like_strings(tool_input or {}):
            name = _basename(candidate)
            if name in PROTECTED_PROJECT_FILES:
                return name
        return None

    return None


def _decoded(value):
    """`value` parsed from JSON when it is a string, else `value` unchanged.

    `research_append` runs `coerceJsonArg` on `ops`, `entry` and `fields`, so a
    stringified argument is parsed and applied there. Reading only lists and
    dicts here let the same write through unexamined. Never raises: a string
    that does not parse is returned as-is and matches nothing.
    """
    if not isinstance(value, str):
        return value
    try:
        return json.loads(value)
    except (ValueError, RecursionError):
        return value


def _with_payloads_decoded(op: dict) -> dict:
    """`op` with its `fields` and `entry` decoded, for the same reason."""
    out = dict(op)
    for key in ("fields", "entry"):
        if key in out:
            out[key] = _decoded(out[key])
    return out


def _ops(tool_input: dict):
    """Every op in a `research_append` call, batch or single.

    A batch puts them in `ops`; a single call carries `section` at the top
    level. Both shapes reach the same sections, so both are walked. Each is read
    after `_decoded`, as the tool reads it.
    """
    ops = _decoded((tool_input or {}).get("ops"))
    if isinstance(ops, list):
        for op in ops:
            op = _decoded(op)
            if isinstance(op, dict):
                yield _with_payloads_decoded(op)
    elif tool_input:
        yield _with_payloads_decoded(tool_input)


def owner_denied(tool_name: str, tool_input: dict, payload: dict) -> tuple | None:
    """`(section, rule, caller)` for a denied write, or None to allow.

    Four rules, all keyed on the caller and all returning the offending
    section: `routed` — a section reserved to an owning agent, reached by
    someone else; `declaration` — a routed CLAIM (a field set to a particular
    value), reached by someone else; `owned_field` — a routed field, keyed on
    presence rather than value; `out_of_lane` — a known agent reaching outside
    the sections its own skill is a declared caller for. `declaration` and
    `owned_field` return a dotted `section.field`, which is a key in neither
    `OWNED_SECTIONS` nor `AGENT_WRITABLE_SECTIONS`, so every consumer must
    branch on `rule` and never on the shape of the first element. A fifth,
    `claim`, returns the bare section of an `OWNED_CLAIMS` route: a conflict's
    analytical product (a resolve, or any analysis field), reached by anyone
    but its owning agent. A sixth, `owned_append`, returns the bare section of
    an `OWNED_APPENDS` route: an `op: "append"` there, made by anyone but its
    owning agent.

    `proof_summaries` is owned by `proof-conclusion`
    (`docs/specs/schemas/ownership.json`). Measured over the committed corpus,
    52 of the 142 runs that wrote a proof summary never launched the skill that
    owns it. Prose did not hold it — see ADR-0011 — so the caller is checked
    here, which is the only plane that can see who is calling.

    **Both caller keys are required.** `agent_id` is absent as a KEY on the main
    thread (test membership, never truthiness), and `agent_type` alone is not
    sufficient because it is also present on the main thread of a session
    started with `--agent`, which an `agent_type`-only rule would misread as a
    subagent (`eval/harness/harness/context_policy.py`). The tail comparison
    accepts both `proof-conclusion` and the namespaced
    `genealogy-research:proof-conclusion`, which is what production actually
    reports — a bare equality never fires there, and under `deny unless ==` that
    denies every caller including the owner.

    Covers `op: "update"` as well as `"append"`: the skill updates an existing
    `ps_NNN` in place on every re-conclusion, and a rule that saw only appends
    would leave that path denied in production with its fixture still green.

    **Gating on `research_append` alone is complete, and here is the check that
    says so** — it looks like an oversight and is the first thing a reader asks.
    Of the six declared writers of any research.json section
    (`research_append`, `project_create`, `research_log_append`,
    `extraction_append`, `merge_tree_persons`, `build_external_search_url`),
    two also write a section this function routes without ever passing through
    here. `merge_tree_persons` reaches `person_evidence` and `proof_summaries`.
    `extraction_append`, in `personId` mode only, appends `person_evidence`
    links.

    That is safe for a structural reason, not a lucky one: it writes those
    sections through `iteratePersonIdRefs`, whose setters assign one field on an
    entry that already exists — `pe.person_id = newId`. It cannot create an
    entry, and it cannot touch `match_score`, which is the failure the
    `person_evidence` row exists to prevent. A merge permutes ids; it never
    authors a claim. `extraction_append`'s links are composed whole in code:
    always `speculative`, no `match_score`, the fixed attachment rationale, and
    only ever superseded afterwards (research_append refuses any other edit to
    one). No caller field reaches them, so they author no identity decision.

    What keeps that true is the source-vs-manifest guard in
    `tests/packaging/ownership-manifest.test.ts`, which reds when the manifest's
    `writerTools` and the walker's own field set disagree. Note its limit before
    relying on it: it catches this tool gaining a NEW SECTION, not it gaining
    scope *within* a section. If `merge_tree_persons` ever writes a routed
    section through anything but a ref setter, this docstring is what stops
    being true, and nothing checks it.
    """
    if _basename(tool_name.replace("__", "/")) != "research_append":
        return None
    caller = ""
    if "agent_id" in payload:
        caller = str(payload.get("agent_type") or "").rsplit(":", 1)[-1]
    writable = AGENT_WRITABLE_SECTIONS.get(caller)
    for op in _ops(tool_input):
        section = op.get("section")
        if not isinstance(section, str):
            continue
        # A routed section, reached by anyone but its owning agent.
        if section in OWNED_SECTIONS and caller != OWNED_SECTIONS[section]:
            return (section, "routed", caller)
        # A routed APPEND, made by anyone but its owning agent. Before the
        # declaration loop: a main-thread question append that also carries a
        # stop claim is refused either way, and this message names the agent
        # that can make the append, where the declaration one names an agent
        # that may not. An agent whose lane lacks the section is left to the
        # lane arm below, whose "hand off" fits a subagent, which cannot invoke
        # another agent.
        if (
            section in OWNED_APPENDS
            and op.get("op") == "append"
            and caller != OWNED_APPENDS[section]
            and (writable is None or section in writable)
        ):
            return (section, "owned_append", caller)
        # A routed CLAIM, reached by anyone but its owning agent. Read from the
        # op's own payload — `fields` on an update, `entry` on an append — and
        # only when `stopped_because` is non-null. A `stopped_because: null`
        # write claims nothing: it is a question being created (null init) and
        # is the owning skill's own sanctioned path.
        for (owned_section, field), owner in OWNED_DECLARATIONS.items():
            if section != owned_section or caller == owner:
                continue
            # BOTH keys, never one-or-the-other. `research_append`'s op schema
            # declares `entry` and `fields`, and nothing stops a caller sending
            # both — `applyOne` simply ignores `fields` on an append. Reading
            # `fields` first and falling back only when it is not a dict let
            # `{op: "append", entry: {…declared: true…}, fields: {}}` through:
            # the empty dict is a dict, so the fallback never fired and the
            # declaration landed. This is the only plane that binds in Cowork,
            # and a missing deny here fails open silently.
            for key in ("fields", "entry"):
                payload_obj = op.get(key)
                if not isinstance(payload_obj, dict):
                    continue
                value = payload_obj.get(field)
                if isinstance(value, dict) and value.get("stopped_because") is not None:
                    return (f"{section}.{field}", "declaration", caller)
        # A routed FIELD, reached by anyone but its owning agent. Keyed on
        # presence: unlike the declaration above there is no honest
        # non-claiming value to let through, so carrying the key at all is the
        # claim. Both payload keys for the same reason as that loop -- an empty
        # `fields` dict beside a populated `entry` is still a dict, and a
        # missing deny here fails open silently.
        for (owned_section, field), owner in OWNED_FIELDS.items():
            if section != owned_section or caller == owner:
                continue
            for key in ("fields", "entry"):
                payload_obj = op.get(key)
                if isinstance(payload_obj, dict) and field in payload_obj:
                    return (f"{section}.{field}", "owned_field", caller)
        # A known agent reaching outside its own set.
        if writable is not None and section not in writable:
            return (section, "out_of_lane", caller)
        # A routed CLAIM spread over several fields, reached by anyone but its
        # owning agent. After the lane check, so an agent with no business in
        # the section at all is told that, not that the claim belongs
        # elsewhere. Both payload keys, for the same fail-open reason as the two
        # loops above. A moot is claimed too: the tool refuses one without a
        # `resolution_rationale`, which is a claim field.
        claim = OWNED_CLAIMS.get(section)
        if claim is not None and caller != claim[0]:
            _owner, claim_fields, claim_status = claim
            for key in ("fields", "entry"):
                payload_obj = op.get(key)
                if not isinstance(payload_obj, dict):
                    continue
                if payload_obj.get("status") == claim_status or any(
                    payload_obj.get(f) for f in claim_fields
                ):
                    return (section, "claim", caller)
    return None


def agent_only_denied(tool_name: str, payload: dict) -> str | None:
    """The bare tool name when a main-thread call reaches AGENT_ONLY_TOOLS, else None.

    The main thread is told apart by the ABSENCE of the `agent_id` key, as in
    `owner_denied`: `agent_type` alone is also present on the main thread of a
    session started with `--agent`. Matched on the bare tail, so every server
    spelling is caught.
    """
    if "agent_id" in payload:
        return None
    bare = _basename(tool_name.replace("__", "/"))
    return bare if bare in AGENT_ONLY_TOOLS else None


def agent_only_reason(tool: str) -> str:
    """The deny text for a main-thread call to an AGENT_ONLY_TOOLS member.

    One copy, imported by the harness (`context_policy.subagent_only_denial`).
    """
    calls = [f"`@plugin:{a}`" for a in AGENT_ONLY_TOOLS[tool]]
    invocations = calls[0] if len(calls) == 1 else ", ".join(calls[:-1]) + " or " + calls[-1]
    return AGENT_ONLY_REASON.format(tool=tool, invocations=invocations)


def deny_reason(denied: tuple) -> str:
    """The deny text for an `owner_denied` triple.

    One copy, imported by the harness (`context_policy.owned_section_denial`),
    so a new rule tag is added in one place. A tag missing here falls through
    to the lane arm, which raises KeyError for the main thread's `caller == ""`.
    """
    section, rule, caller = denied
    # Branch on `rule`, never on the shape of `section` — a "declaration"
    # return carries a dotted `section.field`, which is a key in neither
    # OWNED_SECTIONS nor AGENT_WRITABLE_SECTIONS.
    if rule == "routed":
        reason = OWNER_REASON.format(section=section, agent=OWNED_SECTIONS[section])
    elif rule == "owned_append":
        # A subagent cannot invoke another agent, so it is told to hand off.
        template = APPEND_HANDOFF_REASON if caller else APPEND_REASON
        reason = template.format(section=section, agent=OWNED_APPENDS[section])
    elif rule == "declaration":
        owned_section, _, field = section.partition(".")
        reason = DECLARATION_REASON.format(
            section=owned_section,
            field=field,
            agent=OWNED_DECLARATIONS[(owned_section, field)],
        )
    elif rule == "claim":
        owner, claim_fields, _status = OWNED_CLAIMS[section]
        reason = CLAIM_REASON.format(
            section=section,
            fields=", ".join(f"`{f}`" for f in claim_fields),
            agent=owner,
        )
    elif rule == "owned_field":
        owned_section, _, field = section.partition(".")
        reason = OWNED_FIELD_REASON.format(
            section=owned_section,
            field=field,
            agent=OWNED_FIELDS[(owned_section, field)],
        )
    else:
        allowed = ", ".join(f"`{s}`" for s in sorted(AGENT_WRITABLE_SECTIONS[caller]))
        reason = OUT_OF_LANE_REASON.format(section=section, allowed=allowed)
    return reason


def decision(payload: dict) -> dict:
    """The hook's stdout payload: a deny, or `{}` for no opinion."""
    tool_input = payload.get("tool_input")
    tool_input = tool_input if isinstance(tool_input, dict) else {}
    tool_name = str(payload.get("tool_name") or "")

    if tool_name in DELEGATION_TOOLS and tool_input.get("subagent_type") == FORK_SUBAGENT_TYPE:
        return {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "deny",
                "permissionDecisionReason": FORK_REASON.format(tool=tool_name),
            },
        }

    tool = agent_only_denied(tool_name, payload)
    if tool is not None:
        return {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "deny",
                "permissionDecisionReason": agent_only_reason(tool),
            },
        }

    denied = owner_denied(tool_name, tool_input, payload)
    if denied is not None:
        reason = deny_reason(denied)
        return {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "deny",
                "permissionDecisionReason": reason,
            },
        }

    name = protected_target(tool_name, tool_input)
    if name is None:
        return {}
    return {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            # The model's only feedback, so it names the way out rather than
            # just refusing. No stopReason: a denied write is a recoverable
            # mistake and the turn should continue so it can pivot to the
            # writer tool.
            "permissionDecisionReason": REASON.format(
                tool=payload.get("tool_name") or "This tool", name=name
            ),
        },
    }


def main() -> None:
    try:
        payload = json.loads(sys.stdin.read() or "{}")
    except (json.JSONDecodeError, OSError, ValueError):
        payload = {}
    print(json.dumps(decision(payload if isinstance(payload, dict) else {})))
    sys.exit(0)


if __name__ == "__main__":
    main()

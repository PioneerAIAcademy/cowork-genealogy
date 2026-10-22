"""The step boundary: one pure predicate every enforcing plane shares.

A turn does ONE step. `step_allowed` decides whether a candidate agent may run
given the steps the turn has already taken, so each plane asks the same question
and gets the same answer.

**This is a LIBRARY, not a registered hook** (lead, 2026-10-21). The prototype
worker and both eval harnesses load it with
``importlib.util.spec_from_file_location``, the way
``eval/harness/harness/context_policy.py`` loads ``guard_project_files.py``.
Cowork ships no step hook under decision 25, so there is no ``hooks.json`` entry
and no ``GENEALOGY_STEP_HOST``: one copy, loaded directly, so no parity test is
needed.

Stdlib only, and no I/O of its own -- every caller passes the parsed documents
in, because the planes read ``research.json`` by different means (the worker with
``read_research``, the harnesses from the workspace).
"""

from __future__ import annotations

# The router itself is never a step: it is what spawns them.
ROUTER = "research"

# A turn's first step fixes the group; the rest of that group may follow it.
# Every agent and skill the router can spawn is in exactly one group here, or in
# a one-member group below -- `test_step_boundary_covers_every_agent` fails when
# one is in none, so a new agent cannot ship without a decision about what may
# follow it in a turn.
GROUPS: dict[str, tuple[str, ...]] = {
    "setup": ("init-project", "question-selection", "locality-guide"),
    "plan": ("research-plan", "locality-guide"),
    "search": (
        "search-records",
        "search-images",
        "search-full-text",
        "search-external-sites",
        "record-structurer",
        "image-reader",
    ),
    "link": ("person-evidence",),
    "conflict": ("conflict-resolution",),
    "hypothesis": ("hypothesis-tracking",),
    "assess": ("research-exhaustiveness", "research-plan"),
    "conclude": ("proof-conclusion",),
    "forget": ("forget-and-rederive", "init-project", "record-structurer"),
}

# One member each: every other agent the router can spawn. A turn one of these
# opens admits only itself.
_SOLO = (
    "tree-survey",
    "search-hints",
    "source-evaluation",
    "survey-surname",
    "timeline",
    "gps-mentor",
    "citation",
    "translation",
    "historical-context",
    "check-warnings",
    "tree-edit",
    "convert-dates",
    "search-familysearch-wiki",
    "search-wikipedia",
    "validate-schema",
)
for _solo in _SOLO:
    GROUPS[_solo] = (_solo,)
del _solo

# A step that OPENS a turn uses its home group. The overlaps above only admit a
# follower -- they never change what a step means when it comes first. So a turn
# opened by research-plan is a plan step (admitting locality-guide), not an
# assess step, and a turn opened by record-structurer is a search step.
HOME_GROUP: dict[str, str] = {
    "research-plan": "plan",
    "locality-guide": "setup",
    "init-project": "setup",
    "record-structurer": "search",
}

# `search-hints` keeps its own home group, so a turn it opens -- a verdict on a
# hint -- admits no search. It is admitted only as a FOLLOWER of a search step,
# because a hints plan item runs in the search step (section D, issue #3153).
_HINTS = "search-hints"

# Mode `wrapup` allows these, in this order, and nothing else. Skipping ahead is
# allowed (the router prose says when a member is skipped); going back is not.
WRAPUP_ORDER: tuple[str, ...] = (
    "research-plan",
    "person-evidence",
    "conflict-resolution",
    "research-exhaustiveness",
    "proof-conclusion",
)

# What "Continue with <label>?" says. The three the researcher actually sees in
# the common flow are fixed by the plan's "What the researcher sees" table:
# plan, search and link.
STEP_LABELS: dict[str, str] = {
    "setup": "setting up the project",
    "plan": "planning the searches",
    "search": "running the searches",
    "link": "linking the records",
    "conflict": "resolving the conflict",
    "hypothesis": "sorting out the competing identities",
    "assess": "checking the search is exhaustive",
    "conclude": "writing the conclusion",
    "forget": "re-deriving the project",
    "wrap-up": "wrapping up",
    "tree-survey": "surveying the tree",
    "search-hints": "checking the record hints",
    "source-evaluation": "evaluating the source",
    "survey-surname": "surveying the surname",
    "timeline": "building the timeline",
    "gps-mentor": "the GPS review",
    "citation": "writing the citation",
    "translation": "the translation",
    "historical-context": "the historical context",
    "check-warnings": "checking the warnings",
    "tree-edit": "editing the tree",
    "convert-dates": "converting the dates",
    "search-familysearch-wiki": "searching the FamilySearch wiki",
    "search-wikipedia": "searching Wikipedia",
    "validate-schema": "validating the project files",
}

_DENY_REASON = (
    "Step complete. Give the researcher your report on the step that just "
    "finished, end with \"Continue with {label}?\", and end your turn."
)


def bare_name(name: str) -> str:
    """The agent name, compared after the last ``:``.

    A plugin-namespaced spawn arrives as ``genealogy-research:research-plan``;
    the bare name is what every table here is keyed on.
    """
    return str(name or "").rsplit(":", 1)[-1].strip()


def home_group(step: str) -> str | None:
    """The group a step fixes when it OPENS a turn, or None if it is in none."""
    name = bare_name(step)
    if name in HOME_GROUP:
        return HOME_GROUP[name]
    for group, members in GROUPS.items():
        if name in members:
            return group
    return None


def step_mode(text: str) -> str:
    """`job`, `wrapup` or `step`, from the researcher's message.

    Exact-phrase only, case and trailing punctuation ignored, so a typed
    "Keep going!" starts the same thing on every plane. Anything else is a step
    turn -- a steer, a question and an upload all run one step.
    """
    t = str(text or "").strip().lower().rstrip(".!? \t\n")
    if t == "keep going":
        return "job"
    if t == "wrap it up":
        return "wrapup"
    return "step"


def _wrapup_allowed(steps: list[str], name: str, ctx: dict | None) -> bool:
    if name not in WRAPUP_ORDER:
        return False
    # research-plan here is dispose, whose precondition is an open item.
    if name == "research-plan" and not (ctx or {}).get("open_items"):
        return False
    index = WRAPUP_ORDER.index(name)
    taken = [WRAPUP_ORDER.index(s) for s in steps if s in WRAPUP_ORDER]
    # Equal is a repeat, which is allowed; lower is going back, which is not.
    return not taken or index >= max(taken)


def step_allowed(
    turn_steps: list[str],
    candidate: str,
    mode: str = "step",
    ctx: dict | None = None,
) -> bool:
    """Whether `candidate` may run, given the steps this turn already took.

    `ctx` carries what the turn's steps cannot show, from `step_ctx`. A host that
    cannot read `research.json` passes None, and the one gated follower is then
    denied: the cost is one needless pause, never an unasked plan.
    """
    name = bare_name(candidate)
    if name == ROUTER:
        return True

    steps = [bare_name(s) for s in (turn_steps or [])]
    steps = [s for s in steps if s and s != ROUTER]

    if mode == "job":
        return True
    if mode == "wrapup":
        return _wrapup_allowed(steps, name, ctx)

    if not steps:
        return True
    if name in steps:
        # A step may always repeat itself: the search step fans out.
        return True

    group = home_group(steps[0])
    if group is None:
        return False
    if name == _HINTS:
        return group == "search"
    if name not in GROUPS.get(group, ()):
        return False
    if group == "assess" and name == "research-plan":
        # Dispose's precondition. A decline turn cannot start a new plan.
        return bool((ctx or {}).get("open_items"))
    return True


def deny_reason(candidate: str, mode: str = "step") -> str:
    """What the denied call is told, naming the step it was about to start."""
    name = bare_name(candidate)
    key = "wrap-up" if mode == "wrapup" else (home_group(name) or name)
    return _DENY_REASON.format(label=STEP_LABELS.get(key, "the next step"))


def _external_site_of(entry: dict) -> dict | None:
    if not isinstance(entry, dict) or entry.get("tool") != "external_site":
        return None
    ext = entry.get("external_site")
    if isinstance(ext, dict) and isinstance(ext.get("url_generated"), str):
        return ext
    return None


def _closes_hand_off(entry: dict, url: str) -> bool:
    ext = _external_site_of(entry)
    return ext is not None and ext.get("url_generated") == url and entry.get("outcome") != "partial"


def awaiting_upload_item_ids(research: dict) -> set[str]:
    """Plan items waiting only on a capture the researcher owes us.

    The Python mirror of `awaitingUserHandOffs` (`project-context.ts`): an
    `external_site` entry with `outcome: "partial"` and `capture_received: false`
    that no LATER entry closes. Keyed on `partial`, not on `capture_received`
    alone -- a `positive` entry logged with `capture_received: false` already had
    its results in hand (alpha feedback #2864) and waits on nobody.
    """
    log = research.get("log") if isinstance(research, dict) else None
    entries = log if isinstance(log, list) else []
    waiting: set[str] = set()
    for i, entry in enumerate(entries):
        ext = _external_site_of(entry)
        if ext is None or entry.get("outcome") != "partial" or ext.get("capture_received") is not False:
            continue
        url = ext["url_generated"]
        if any(_closes_hand_off(later, url) for later in entries[i + 1:]):
            continue
        item_id = entry.get("plan_item_id")
        if isinstance(item_id, str):
            waiting.add(item_id)
    return waiting


def current_question(research: dict) -> dict | None:
    """The last unresolved entry in `questions[]`.

    Entries are appended in order, so array order is creation order. Keyed on the
    stored `status`, not on whether a proof summary exists, so a CONCLUDED
    question whose conflict is getting its evidence round is still current --
    E's rule refuses a new question while that round's items are open.
    """
    questions = research.get("questions") if isinstance(research, dict) else None
    if not isinstance(questions, list):
        return None
    for entry in reversed(questions):
        if isinstance(entry, dict) and entry.get("status") != "resolved":
            return entry
    return None


def step_ctx(research: dict) -> dict:
    """What the turn's steps cannot show, computed from `research.json`.

    `open_items`: whether the current question's ACTIVE plan still has a
    `planned` or `in_progress` item, not counting one waiting only on the
    researcher's upload -- that item is not work the agent can do.
    """
    question = current_question(research)
    if question is None:
        return {"open_items": False, "question_id": None}

    question_id = question.get("id")
    waiting = awaiting_upload_item_ids(research)
    plans = research.get("plans") if isinstance(research, dict) else None
    open_items = False
    for plan in plans if isinstance(plans, list) else []:
        if not isinstance(plan, dict):
            continue
        if plan.get("question_id") != question_id or plan.get("status") != "active":
            continue
        for item in plan.get("items") if isinstance(plan.get("items"), list) else []:
            if not isinstance(item, dict):
                continue
            if item.get("status") not in ("planned", "in_progress"):
                continue
            if item.get("id") in waiting:
                continue
            open_items = True
            break
        if open_items:
            break

    return {"open_items": open_items, "question_id": question_id}


# ---------------------------------------------------------------------------
# "Keep going": the host replies for the researcher (section A2)
# ---------------------------------------------------------------------------

# Each button sends its exact phrase, and `step_mode` reads them back, so these
# are the single spelling of each reply.
REPLY_CONTINUE = "Continue."
REPLY_KEEP_GOING = "Keep going."
REPLY_WRAP_UP = "Wrap it up."
REPLY_SEARCH_MORE = "Search more."

# The offer only the researcher can answer.
WRAP_UP = "wrap-up"

# How many replies one run may send. Replaces the alpha's
# `auto_continue_max_steps`, which is 30 today.
MAX_AUTO_REPLIES = 30

# A research-plan turn following one of these is the ordinary first plan, not a
# re-plan, so it does not spend the run's one planning round.
_PLANNING_EXEMPT = frozenset(GROUPS["setup"]) | frozenset(GROUPS["plan"])


def _has_proof_summary(research: dict, question_id) -> bool:
    summaries = research.get("proof_summaries")
    for summary in summaries if isinstance(summaries, list) else []:
        if isinstance(summary, dict) and summary.get("question_id") == question_id:
            return True
    return False


def _is_low_risk_choice(question, research: dict) -> bool:
    """The decline that recommends concluding: a `resources_spent` stop, not yet concluded.

    Read from the STATE, not from the step this turn ran, so a question between
    steps that repeats the offer keeps its button (section J).
    """
    if not isinstance(question, dict):
        return False
    stop = question.get("search_stop")
    if not isinstance(stop, dict) or stop.get("stopped_because") != "resources_spent":
        return False
    return not _has_proof_summary(research, question.get("id"))


def reply_options(offered_step, research: dict | None = None) -> list[str]:
    """The replies that apply to this turn, as exact phrases.

    The host shows a button for each and nothing else. Keyed on the OFFER LINE,
    never on the step the turn ran, so a wrap-up turn that ends by offering the
    next question still gets its buttons.
    """
    offer = bare_name(offered_step) if offered_step else ""
    if not offer:
        return []
    if offer == WRAP_UP:
        return [REPLY_WRAP_UP]

    research = research if isinstance(research, dict) else {}
    question = current_question(research)
    options = [REPLY_CONTINUE, REPLY_KEEP_GOING]

    # Not beside proof-conclusion (Continue already concludes), and not beside
    # question-selection (the offer after a wrap-up, where the current question
    # may be one a conflict held open).
    if question is not None and offer not in ("proof-conclusion", "question-selection"):
        options.append(REPLY_WRAP_UP)
    if offer == "proof-conclusion" and _is_low_risk_choice(question, research):
        options.append(REPLY_SEARCH_MORE)
    return options


def _auto_reply_state(state: dict | None) -> tuple[int, int, list]:
    state = state if isinstance(state, dict) else {}
    replies = state.get("replies")
    rounds = state.get("planning_rounds")
    answered = state.get("answered")
    return (
        replies if isinstance(replies, int) and replies > 0 else 0,
        rounds if isinstance(rounds, int) and rounds > 0 else 0,
        [tuple(pair) for pair in answered if isinstance(pair, (list, tuple))]
        if isinstance(answered, list)
        else [],
    )


def next_auto_reply(
    state: dict | None,
    turn_mode: str,
    prev_step,
    turn_step,
    offered_step,
    outcome: str,
) -> dict:
    """The reply the host sends for the researcher, or None to end the run.

    Returns ``{"reply": str | None, "state": dict}``. Pure: the caller persists
    the returned state and never mutates the one it passed in.

    Ends the run when the turn did not finish cleanly, made no offer, offered
    `wrap-up` (only the researcher answers that), ran proof-conclusion, repeated
    a (step, offer) pair already answered since the last planning round, or hit
    `MAX_AUTO_REPLIES`.
    """
    replies, rounds, answered = _auto_reply_state(state)
    step = bare_name(turn_step) if turn_step else ""
    offer = bare_name(offered_step) if offered_step else ""
    prev = bare_name(prev_step) if prev_step else ""

    def done(reply, rounds=rounds, answered=answered):
        return {
            "reply": reply,
            "state": {
                "replies": replies + (1 if reply else 0),
                "planning_rounds": rounds,
                "answered": [list(pair) for pair in answered],
            },
        }

    # Only a "keep going." turn -- the researcher's own or a host reply -- gets
    # a reply, so a "Continue." or "Wrap it up." turn ends the run.
    if turn_mode != "job":
        return done(None)
    if outcome not in ("ok", "completed"):
        return done(None)
    if not offer or offer == WRAP_UP:
        return done(None)
    if step == "proof-conclusion":
        return done(None)
    if replies >= MAX_AUTO_REPLIES:
        return done(None)

    # A planning round bounds both loops: a second "not exhaustive" round and a
    # conflict's second evidence round.
    if step == "research-plan" and prev and prev not in _PLANNING_EXEMPT:
        if rounds >= 1:
            return done(None)
        rounds += 1
        answered = []

    pair = (step, offer)
    if pair in answered:
        # A link-and-assess cycle that never plans.
        return done(None)
    answered = answered + [pair]

    if offer == "research-plan" and rounds >= 1:
        return done(REPLY_WRAP_UP, rounds, answered)
    return done(REPLY_KEEP_GOING, rounds, answered)

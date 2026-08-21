# Deep dive: search-images — findings and validator requests

Issue #1661. Guide followed: `docs/skill-deep-dive-guide.md`.

**Corpus read:** `eval/runlogs/unit/search-images/v1_2026-08-10_13-17-12.json` (newest,
12 tests, 1 run each), model `claude-sonnet-4-6`. Recurrence was checked across **all
five** committed run logs (`v1_2026-07-24`, `-07-25`, `-07-28`, `-07-29`, `-08-10`).
Transcripts read before scores. Prohibition list: `search-images-prohibition-list.md`.

**Starting numbers, verified:** 11 pass / 1 fail (`ut_search_images_008`). The grep the
issue prescribed — `judge_context` naming a `score N` branch — returns 0 files;
confirmed. This skill's leak is not a score-branch phrasing; it is uncaught behaviour
under dimensions that never move.

**Coverage sweep first.** Before proposing a validator I checked the whole
`eval/harness/validators/` tree (including the universal validators that run on every
skill) and `docs/specs/schemas/ownership.json`, so nothing below duplicates an existing
guard. Two candidate validators were dropped as already-covered — see F1 and F4.

**Dimensions that never discriminate — 2 of 6, as the issue states:**

| dimension | score distribution across the suite |
|---|---|
| base / Tool Arguments | 3×8, N/A×4 (the 4 routing negatives make no tool call) |
| rubric / Volume selection | 3×8 (only the 8 positive tests receive rubric dims) |

Neither has taken a non-pass value on any test in the suite, so neither can report a
regression in what it grades.

---

## F1 — `Tool Arguments` never moves, and the `image_search` argument mistake the body calls "the single most common" is exercised by no test and checked by no validator.

**Did:** `Tool Arguments` scored 3 on all 8 tests that made tool calls (run
`v1_2026-08-10_13-17-12`). Across the whole corpus **no `image_search` call is ever made
with an `imageId`** — every call passes a bare group number (`007936749`, `004452257`,
`008116090`, `007936752`) — and none carries an `offset` / `limit` / `imageIndex`
parameter or re-queries the same group. All correct behaviour — but passing an `imageId`
to `image_search` is exactly what SKILL.md §"MCP tools" calls *"the single most common
mistake,"* and the `image_search`-has-no-pagination-params rule sits right beside it; the
dimension that would catch either — `Browse execution`, whose fail bullet names "invented
`image_search` parameters (`offset`/`imageId`/etc.)" — has never scored below 3 *for that
reason*, because no test exercises the mistake and no validator checks the argument. It
does move: it scored 1 on `008` in `-08-10`, but for a different clause of the same
bullet ("skipped `image_search` entirely"), which is the point — the parameter clause is
the one nothing has ever put to the test.

**Should:** a dimension that can never move cannot report a defect (deep-dive guide,
Step 3). This is a literal argument constraint — the shape Step 6 says to convert to a
validator, not to grow the rubric or add a fixture for.

**Gap — lane 2.** The `Volume selection` rubric already defines rich partial/fail
branches, and the skill genuinely passes the multi-candidate / split / mixed tests
(`010`/`011`/`012`), so that second dead dimension is *pre-decided-good* on today's
corpus rather than mis-written — its one mechanical sub-rule (a volume-split target must
browse **all** jointly-covering films) is convertible but tag-dependent and is left as a
note, not a headline request. The durable close for `Tool Arguments` is one validator
covering the full `image_search` argument contract.

> **Validator request V1 — `image_search` argument integrity**
> **Rule:** for every `image_search` call, all of: (a) `imageGroupNumber` must NOT match
> the imageId shape `^\d+_\d{5}$` (a page id belongs to `@plugin:image-reader`, never to
> `image_search`); (b) the call carries none of `offset` / `limit` / `imageIndex` /
> `imageId` (SKILL.md:98-100 — `image_search` lists the whole group in one call and has
> no such parameters); (c) no two `image_search` calls in one run share the same
> `imageGroupNumber` ("never re-query to get more").
> **Where to look:** `output.tool_calls`, entries whose tool ends in `image_search`.
> **Why it is not judgment:** a regex and a key-presence/duplicate check on literal
> argument values; nothing interpreted.
> **What a violation looks like:** none in the current corpus — this locks the body's
> "single most common mistake" and its two siblings so `Tool Arguments` is no longer the
> only guard.

**Already covered — the other prohibited tool, `image_read`, needs no request.** The
body also forbids the skill calling `image_read` itself. That one *is* already enforced:
`image_read` is in `SUBAGENT_ONLY_TOOLS` (`eval/harness/harness/context_policy.py`),
the PreToolUse hook blocks a main-thread call, and the universal
`test_no_main_thread_subagent_only_calls` (`eval/harness/validators/test_universal.py`)
fails on it — on every skill, search-images included. So there is no `image_read`
validator to request; only the `image_search` argument contract above is unguarded.

---

## F2 — A no-volume nil browse logs `tool: "image_search"` though no `image_search` ever ran — in every committed run. The audit-trail dimension and the existing validator both pass it.

**Did:** `ut_search_images_004` (no-digitized-volume). `output.tool_calls` = three
`volume_search` calls (all returning zero volumes) and one `research_log_append`; **no
`image_search` call exists.** The appended log entry records `tool: "image_search"`,
`outcome: "negative"`. This is **not a one-off — it recurs in all 5 committed run logs
(0-for-5):** `v1_2026-07-24`, `-07-25`, `-07-28`, `-07-29`, `-08-10`. The related failure
test `ut_search_images_008` logs the same `tool: "image_search"`-with-zero-calls shape in
3 of the 5 (`-07-25`, `-07-28`, `-08-10`); the accompanying `outcome` varies and is only
`"error"` in `-08-10` (`negative` in `-07-25`, `partial` in `-07-28`) — the mislabelled
`tool` is the constant, not the outcome.
`Browse audit trail` scored `004` a **3** every time.

**Should:** the log's `tool` field is the search that was performed. For a no-volume nil
browse the search that returned nothing is `volume_search`, not `image_search` — the
test's own `judge_context` says *"The negative log entry's tool may reference
volume_search since that is the search that returned nothing,"* and the existing
validator's docstring says the tool "should reference … volume_search (the volume
discovery, e.g. when no volume was found)." Logging `image_search` claims an
image-listing browse happened when none did — for an exhaustiveness audit that is the
difference between "a volume was opened and came back empty" and "no volume was ever
found."

**Gap — lane 2.** `test_positive_appends_browse_log_entry` accepts `image_search`
**or** `volume_search`, so it does not catch a no-volume browse mislabeled
`image_search`; and the `Browse audit trail` judge passed it five times running. The
SKILL.md step-6 example hardcodes `tool: "image_search"` and does not say which tool to
log for the no-volume branch, so this could also carry a one-line SKILL.md clarification
(lane 4), but the durable close is the validator. No prior art anywhere in the harness
cross-checks a log entry's `tool` against the tool ledger — this is V3's specific
contribution.

> **Validator request V3 — a logged `image_search` browse must have actually happened**
> **Rule:** if a new `log` entry has `tool` containing `image_search`, then
> `output.tool_calls` must contain at least one `image_search` call in the same run.
> (Equivalently: a no-volume browse — zero `image_search` calls — must not log
> `tool: "image_search"`.)
> **Where to look:** new entries in `research.json` `log[]` (after-state minus before)
> and `output.tool_calls`.
> **Why it is not judgment:** compares a literal log field to the tool ledger.
> **What a violation looks like:** `ut_search_images_004`, all five committed runs —
> `log` entry `tool: "image_search"`, `tool_calls` = 3×`volume_search` +
> `research_log_append`, zero `image_search`.

---

## F3 — `results_examined` and `outcome` are recorded three different ways for the identical "listed the group, read no pages" state. Every variant scored 3.

**Did:** in the harness the image-reader returns nothing, so no run reads a page; all a
positive test can do is list a group. For that one state the corpus logs three shapes:

| test | outcome | results_examined | results_available |
|---|---|---|---|
| `ut_search_images_001` | positive | 15 | 15 |
| `ut_search_images_002` | positive | 0 | 15 |
| `ut_search_images_011` | positive | 15 | 15 |
| `ut_search_images_010` | partial | 15 | 15 |
| `ut_search_images_012` | positive | 0 | 22 |

`Browse audit trail` scored 3 on every one. The SKILL.md step-6 worked example shows
`results_examined: 36` for *"read images 40–75"* — pages actually read — so `examined:
15` for a list-only browse that read 0 pages overstates the audit trail, and `examined:
0` (002, 012) is the reading that matches the example. `outcome: "partial"` (010) versus
`"positive"` (001, 011) for the same state is a second inconsistency.

**Should:** the audit trail should mean one thing across the corpus.

**Gap — lane 2/4, and it does not convert.** The field is genuinely ambiguous and the
body never defines it for the list-only case, so a program cannot decide the "right"
value without a definition first — mechanising it would be the score-3-forever dimension
Step 6 warns against. The fix is a one-line definition in SKILL.md step 6 (and a matching
rubric note), not a validator. Recorded for whoever next edits the body; it does not on
its own justify a paid run.

---

## F4 — The plan-item field lane ("update only `status`") is stated in the ownership manifest but enforced by nothing. Section-level writes are already covered; the field level is not.

**Did:** across the corpus, `output.file_changes` only ever modifies `log` (every browse)
and, on `ut_search_images_012`, `plans` (a `status` update on `pli_006`). The
`research_append` call recorded `fields: { status: "completed" }` — correct. No run
writes `sources` or `assertions`.

**Should:** SKILL.md §"Important rules" — *"don't add fields to plan items beyond
`status`."* `ownership.json:103` states the same in prose: *"The search skills and
record-extraction may update only `items[].status`."*

**Gap — lane 2, field-level only.** The **section**-level half is already enforced and
needs no request: `ownership.json` lists `sources` callers as record-extraction + citation
and `assertions` as record-extraction only — search-images is not a caller — and the
universal `test_ownership_table` (`test_universal.py`) fails any out-of-lane section
write. **So the earlier V4 (a search-images `sources`/`assertions` write) is dropped as a
duplicate of `test_ownership_table`.** What remains uncovered is the **field** level:
`test_ownership_table` checks section ownership only, `plan_items` `enforceableAt` is even
empty, and search-images *is* an authorized `plans`/`plan_items` writer — so a run that
changed a plan item's `title` or `priority` would pass every existing validator.

> **Validator request V5 — a search-images plan-item update changes only `status`**
> **Rule:** every `research_append` call from search-images with `section: "plan_items"`
> must have a `fields` object whose keys are a subset of `{status}`. (Equivalently, on the
> persisted side: the only per-item field that differs between the `plans` diff's
> `changed_fields.items.before` and `.after` is `status`.)
> **Where to look:** `output.tool_calls` (the `research_append` `fields` arg) — cross-check
> against `output.file_changes["research.json"].diff.plans` if a persisted-side check is
> preferred.
> **Why it is not judgment:** a set-subset check on literal field keys.
> **What a violation looks like:** none currently — `ut_search_images_012` sets only
> `status`; this locks the field lane the ownership table does not reach.

---

## F5 — The routing-decline no-op invariant is guarded on only one of the skill's five decline branches.

**Did:** the skill's ROUTING block has five decline branches, each of which must redirect
and stop with **zero MCP calls and zero writes** (SKILL.md:30-63). The deterministic guard
for that invariant, `test_no_browse_or_writes_on_planning_request`
(`test_search_images.py`), fires **only** on the `no-browse-no-write` tag — which is
set on exactly one scenario, `negative-research-plan.json` (the planning branch). The
indexed-search, full-text, and record-extraction decline negatives
(`ut_search_images_005` / `006` / `007`) carry no such tag, so "zero calls, zero writes"
is asserted on none of them, and the **external-site** decline branch has **no negative
test at all**. In the newest run all four negatives happened to make zero calls and zero
writes — but nothing enforces it, so a regression on any non-planning branch (e.g. an
indexed-search decline that first calls `volume_search`) would pass green.

**Should:** every routing decline is a no-op on state — the invariant the planning branch
already asserts should hold on all five branches, since the whole ROUTING block exists to
make the skill stop before touching anything.

**Gap — lane 2.** Two closable halves. The mechanical one converts to a validator that
does not depend on which branch routed. (The external-site *coverage* gap — no negative
test — is noted but not chased per the guide; V6 would cover it the moment such a test
exists.)

> **Validator request V6 — a routing-decline negative touches nothing**
> **Rule:** for a search-images **negative** test tagged as a routing decline (any of the
> five branches), `output.tool_calls` must contain no `volume_search` or `image_search`
> call, `output.file_changes` must add no new `log` entry, and no `results/` sidecar may
> be written. (This generalises `test_no_browse_or_writes_on_planning_request` from the
> single `no-browse-no-write`/planning scenario to every decline branch.)
> **Where to look:** `output.tool_calls`, `output.file_changes`.
> **Why it is not judgment:** presence checks on the tool ledger and the file diff.
> **What a violation looks like:** none in the newest run — but only `009` is guarded
> today; `005`/`006`/`007` are asserted by nothing.

---

## F6 — `research_log_append` retried after a rejected write is prohibited but unchecked.

**Did:** no violation in the corpus, but the recovery rule (SKILL.md:242-245 — *"do not
call it again with the same arguments"* after `{ ok: false }`) is a hard, checkable rule
that nothing asserts.

**Should:** a rejected write must not be re-sent unchanged — retrying in a loop wastes the
turn.

**Gap — lane 2, convertible.**

> **Validator request V7 — no retry of a rejected `research_log_append`**
> **Rule:** there must be no two `research_log_append` calls in one run with identical
> arguments where the first returned `{ ok: false }`.
> **Where to look:** `output.tool_calls` (args and each call's result/`is_error`).
> **Why it is not judgment:** equality of two argument objects plus the first result.
> **What a violation looks like:** none currently — a regression guard.

---

## Secondary observation (already caught — not a quiet pass)

`ut_search_images_008` (the one failure) hallucinated a tool outage — its log `notes`
read *"image_search tool is not available in this session (absent from the deferred
tools registry); … Browse halted"* — although `image_search` is in `allowed-tools`. The
correct behaviour on a 95%-indexed volume is to decline the browse and steer to
search-records (which it also did, in the same notes). `Browse execution` scored 1 and
`Completeness` 1, so the judge caught this; noted only because "invented a tool outage"
is a distinct shape from the rubric's current `Browse execution` fail branches, and V3
above would also flag its `outcome: "error"` log entry (it likewise cites no real
`image_search`).

**Minor, non-functional:** `eval/fixtures/mcp/image-search-schuylkill-probate.json`'s
`description` says *"the skill pages through them with image_read,"* stale wording that
contradicts the `image_read` prohibition. Fixture `description` fields are not fed to the
model, so this cannot mislead a run — a one-word fix only if that file is touched for
another reason; not worth a paid run on its own.

---

## Lane summary

| # | Finding | Lane | Converts |
|---|---|---|---|
| F1 | `Tool Arguments` & `Volume selection` never discriminate; the full `image_search` argument mistake is unexercised & unchecked (`image_read` is already guarded) | 2 | V1 |
| F2 | No-volume nil browse logs `tool: image_search` with zero image_search calls — 0-for-5; audit-trail dim + existing validator both pass it | 2 (+4 optional) | V3 |
| F3 | Three treatments of `results_examined`/`outcome` for the identical list-only state, all scored 3 | 2/4 | — (needs a definition) |
| F4 | Plan-item field lane ("only `status`") stated in ownership.json but enforced at section level only | 2 | V5 |
| F5 | Routing-decline no-op invariant guarded on only 1 of 5 decline branches | 2 | V6 |
| F6 | `research_log_append` not-retried-after-`ok:false` rule unchecked | 2 | V7 |

**Final validator requests: V1, V3, V5, V6, V7 — five, all non-duplicative.**
Two candidates were dropped after the coverage sweep as already enforced by universal
validators:

- **V2 (no `image_read`)** — covered by `test_no_main_thread_subagent_only_calls` +
  `SUBAGENT_ONLY_TOOLS` (`context_policy.py`).
- **V4 (no `sources`/`assertions` write)** — covered by `test_ownership_table` +
  `ownership.json` (search-images is not a caller of either section).

V3, V5 and V6 are novel (no existing harness check cross-checks a log `tool` against the
ledger, restricts plan-item fields, or asserts the decline no-op off the planning branch).
V1 and V7 fill literal-argument / call-ledger gaps. V5 and V6 generalise cleanly to the
other search skills that write `plans`/`log` (`search-records`, `search-full-text`,
`search-external-sites`, `record-extraction`).

## Fixes made this session — none, deliberately, and why

There is no `judge_context` score-branch leak (grep returns 0) and the `rubric.md`
wording is sound — the two non-discriminating dimensions are pre-decided-good on today's
corpus, not mis-written, so restating them would only lengthen the prompt (guide, "do not
add prose for a rule it already contains"). Every finding's durable close is a validator
(developer-owned Python, per the guide) except F3, which needs a field definition, not a
guard. **No file under `eval/tests/unit/search-images/` or the skill body is edited, so
this dive does not flip the run-log snapshot inactive and buys no `make eval-skill` run.**

Two fixes are available but held, because each would change the skill body / tests and
buy a paid run for a change that alters no grade: the F3 field definition (SKILL.md step 6
+ rubric note) and the F5 test-side alternative (tagging `005`/`006`/`007`
`no-browse-no-write` so the existing validator covers them, instead of the more general
V6). Neither is required to close this dive; V6 is the preferred F5 close because it does
not depend on remembering to tag each future decline test.

## Cost note

This deliverable adds only `docs/deep-dives/` files, which trigger none of the
`check-runlogs` / eval CI gates. The validator requests V1, V3, V5, V6, V7 are handed to a
developer (a separate skill, per the guide) and implemented in their own PR against
`eval/harness/validators/test_search_images.py` (V6 may instead generalise the existing
planning-only validator); each is a `nothing-checks` guard — CI is green today while all
five failure modes are uncaught.

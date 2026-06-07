# `feedback.json` Submission Spec

**Project:** Cowork Genealogy
**Repo that implements this spec:** `cowork-genealogy-ui` (the
Electron viewer). Specifically `src/main/feedback.ts` and the
submission dialog.
**Repo that consumes this spec:** `cowork-genealogy` (this repo).
The feedback workflow (`docs/specs/feedback-case-spec.md`) and two
Claude Code skills (`/compare-state`, `/draft-unit-test`) read
`feedback.json` from inside the submitted zip.

This spec is the contract between the two repos. The viewer must
emit it; the workflow may rely on it.

---

## 1. What this is

When an end user submits feedback through the Cowork Genealogy
viewer, the viewer builds a zip of the user's current project folder,
adds a small set of feedback-specific files, and uploads it to a
shared Drive folder. The dev team picks the zip up and works through
the workflow in `feedback-case-spec.md` to turn it into a fix + unit
test.

`feedback.json` is the **structured form data** the user filled in
when they submitted. It exists so the dev tooling can read the user's
description programmatically without parsing Markdown.

A second file, `FEEDBACK.md`, carries the same content in human-
readable form. The viewer must produce both; the workflow reads
`feedback.json`.

---

## 2. File location inside the zip

```
<zip root>/
  research.json              ← project files at zip root, unchanged
  tree.gedcomx.json
  results/log_NNN.json
  CLAUDE.md
  …
  FEEDBACK.md                ← human-readable summary (already shipping)
  _feedback/
    feedback.json            ← THIS SPEC
    session-log.jsonl        ← optional; see §6
```

The `_feedback/` directory exists to keep feedback-specific files
out of the user's normal project-file namespace. Any future feedback-
related additions (manifest, screenshots) go inside `_feedback/`.

---

## 3. Schema (v1)

```json
{
  "schema_version": 1,
  "submitted_at": "2026-05-25T18:22:31Z",
  "viewer_version": "0.4.2",
  "email": "user@example.com",
  "user_prompt": "Find a marriage record for John Smith born 1850 in Ohio.",
  "agent_did": "The agent searched the 1860 census and reported no results, then stopped.",
  "agent_should_have": "The agent should have tried the 1870 and 1880 censuses, and should have searched marriage records in Ohio counties.",
  "notes": "",
  "project_folder_path": "/Users/example/genealogy/smith-family",
  "platform": "darwin"
}
```

### Field reference

| Field | Type | Required | Notes |
|---|---|---|---|
| `schema_version` | integer | yes | Currently `1`. Bump on breaking changes; see §5. |
| `submitted_at` | string (ISO 8601, UTC, with `Z` suffix) | yes | Time the user clicked submit. Used by the dev team for triage ordering. |
| `viewer_version` | string | yes | The Electron viewer's semantic version (`package.json::version`). Used by devs to know which build the user was on. |
| `email` | string | yes | May be empty string for anonymous submissions. Not used by the workflow's automation; included so devs can follow up. |
| `user_prompt` | string | yes | Verbatim text of the prompt the user typed when the bad result occurred. The Claude Code session re-issues this verbatim in §3.2 of the workflow spec. |
| `agent_did` | string | yes | The user's free-text description of what the agent actually did wrong. Read by `/compare-state --against=what-went-wrong` to confirm repro. |
| `agent_should_have` | string | yes | The user's free-text description of what the agent should have done. Read by `/compare-state --against=desired` to verify fixes and by `/draft-unit-test` as the starting-point rubric. |
| `notes` | string | yes | Free-text notes ("first time this happened", "had this same issue last week", etc.). Always present; empty string when the user left the field blank. Same model as `email`. |
| `project_folder_path` | string | yes | Absolute path of the project folder the user was working in when they submitted. Lets devs disambiguate when one user has multiple projects open and helps correlate with the user's filesystem layout. Mild PII; included because the diagnostic value outweighs the leak (the same path is already in `FEEDBACK.md` today). Empty string if the viewer cannot determine it. |
| `platform` | string | yes | `process.platform` value at submit time (e.g. `"darwin"`, `"linux"`, `"win32"`). Useful for triaging viewer-specific bugs. Empty string if unknown. |

### Constraints

- All string fields: trim leading/trailing whitespace before writing
  (standard `String.prototype.trim()` semantics — includes leading/
  trailing newlines). Interior newlines and runs of whitespace are
  preserved verbatim; only the boundaries are trimmed.
- All string fields: max length 10,000 characters. Enforced at the
  dialog (block submit with a clear error) **and** in
  `buildFeedbackZip` as belt-and-suspenders, so the limit can't be
  bypassed by future callers of the function. Longer text is almost
  certainly a paste of session output that belongs in a separate
  attachment, not in the form.
- Encoding: UTF-8, no BOM.
- Pretty-printed with two-space indentation (matches `research.json`
  convention). Newline at end of file.
- **Field order is advisory.** JSON objects have no semantic order;
  the example in this spec lists fields in a readable order for
  human reviewers, but consumers MUST NOT depend on order.
- **Producer-side closure, consumer-side openness.** v1 producers
  MUST emit only the fields listed above (no ad-hoc extras).
  Consumers MUST ignore unknown fields — this is what allows §5
  to add optional fields in a future schema_version without
  breaking older consumers. Together these rules give producers a
  tight contract and consumers forward compatibility.

### What goes verbatim, what doesn't

`user_prompt`, `agent_did`, `agent_should_have`, and `notes` are
**verbatim** from the dialog's text fields. Don't transform, don't
auto-correct, don't strip newlines, don't HTML-escape. The
workflow's skills depend on these being unmodified copies of what
the user typed.

`email` should be trimmed and lowercased. Note that lowercasing the
local-part is technically incorrect per RFC 5321 (the local-part is
case-sensitive), but for triage and dedup purposes it's the right
practical call. The user-typed casing is not preserved anywhere, so
don't be surprised when `John.Smith@example.com` appears as
`john.smith@example.com` in submissions.

---

## 4. Companion file: `FEEDBACK.md`

The viewer continues to emit a human-readable `FEEDBACK.md` at the
zip root, as it does today. Suggested template (already roughly
what `feedback.ts` produces — adjust if your current version
differs):

```markdown
# Feedback from <email or "(anonymous)">

**Submitted:** <submitted_at>
**Viewer version:** <viewer_version>

## What I asked
<user_prompt>

## What the agent did
<agent_did>

## What the agent should have done
<agent_should_have>

## Notes
<notes>
```

The dev workflow does **not** parse `FEEDBACK.md` — it reads
`feedback.json` for all structured access. `FEEDBACK.md` exists so a
human dev (or genealogist, or end user) can read the submission at
a glance without opening the JSON.

If the form's set of fields ever diverges between `feedback.json`
and `FEEDBACK.md`, `feedback.json` is authoritative.

The template above is a **suggestion**, not a requirement. The
current `cowork-genealogy-ui` template in `src/main/feedback.ts`
uses slightly different headings (`## What it should have done`,
extra metadata bullets, a "Skipped files" section). The spec does
not mandate a specific Markdown layout — render whatever is most
readable for the human reader. Only `feedback.json` is contractual.

---

## 5. Versioning

- `schema_version` is a single integer.
- **Add optional fields without bumping the version.** A new
  optional field is backward-compatible — consumers that don't know
  about it just ignore it. Don't bump.
- **Bump the version when:** a field is removed; a field is renamed;
  a field's semantic meaning changes; a previously-optional field
  becomes required.
- **No migration of stored zips.** Each zip carries the version it
  was submitted under. The workflow reads `schema_version` and
  refuses zips it doesn't know how to handle (it'll fail loudly
  rather than silently misinterpret a future schema).
- Version bumps are coordinated between the two repos via a paired
  PR.

---

## 6. Optional companion: `session-log.jsonl`

The viewer optionally includes `_feedback/session-log.jsonl` — the
Claude Code transcript of the session in which the bad result
occurred. The workflow uses it as **read-only context** for the dev
and for the `/draft-unit-test` skill (to identify which tools the
agent called during the failure).

### Shape contract (when included)

If the viewer emits this file, it must conform to the following so
consuming skills can rely on it:

- **One JSON object per line**, no trailing comma, no blank lines.
- **Entries are limited to `user` and `assistant` message types** —
  the same filtering `feedback.ts` already does today. System
  messages, hook outputs, and other SDK-internal entries are
  excluded.
- **Thinking blocks are stripped** from assistant messages before
  writing. The skill that summarizes the transcript should not see
  the model's internal reasoning.
- **Entries are filtered to the submitting project's `cwd`** —
  multi-project sessions get one log per submission, scoped to
  the failing project only.
- Each entry preserves the SDK's `model` field on assistant
  messages. This is the **authoritative source** for which model
  produced the bad result (e.g. `claude-sonnet-4-6` vs.
  `claude-opus-4-7`). `feedback.json` does not duplicate this
  field — the model can vary per turn within a session, so a
  single top-level value would be misleading.

### Omission policy

If the viewer decides not to include `session-log.jsonl` (size,
privacy, capture failure), no schema change is needed — the file
is strictly optional. The skills fall back to inspecting only the
current state when it's absent, with degraded ability to identify
which tools the failing agent called.

The schema_version in `feedback.json` does **not** cover
`session-log.jsonl`'s shape; if the shape above changes
meaningfully in a future release, bump `feedback.json`'s
`schema_version` so consumers know.

---

## 7. Future zip-file additions (not in v1)

The following were considered for inclusion in v1 and explicitly
deferred. Documented here so future-you doesn't re-derive the
analysis from scratch.

### 7.1 Pre-action state snapshot — rejected

The case fixture is post-failure state, which means the dev
iterates against state already mutated by the failed agent. A
viewer-side pre-action snapshot (saving `research.json` /
`tree.gedcomx.json` immediately before each tool call) would
eliminate this. Rejected because:

- Snapshotting at feedback-submit time is too late — the user
  notices the problem *after* it happened, so the snapshot at
  that point is already post-failure.
- Continuously snapshotting on every turn boundary works but
  adds steady-state I/O and disk usage for what is, in volume,
  a rare event.

Accepted alternative: post-failure state is tolerated by the
**skill re-invocation contract** in `feedback-case-spec.md` §5.
Every SKILL.md must be safe to re-invoke against state containing
its own prior output. If a specific class of failure makes this
intolerable in practice, revisit.

### 7.2 Runtime version manifest — deferred

A `_feedback/manifest.json` capturing plugin / MCP / Cowork /
model versions at submission time was considered. Rejected for
v1 because:

- The viewer can't naturally read the plugin/MCP manifests; they
  live in Cowork's install directory, paths are OS-specific.
- The current `viewer_version` field (§3) plus the submission
  timestamp lets devs reconstruct most version state via
  `git log` on this repo.
- No reported bug to date has required strict plugin/MCP version
  pinning to reproduce.

If this becomes load-bearing, the lowest-friction implementation
is to have `init-project` write `runtime_versions` into
`research.json`. That requires a `research.json` schema extension
but no viewer code. Stale-after-update is a real downside but
acceptable for triage.

### 7.3 Tool-call summary — derived, not stored

A `_feedback/tool-calls.json` listing MCP tools called during the
failure was considered. Rejected: the same data is in
`session-log.jsonl` and `/draft-unit-test` computes it on demand.
Storing a derived view risks divergence from the underlying log.

### 7.4 Screenshots — out of scope

A file picker for attaching screenshots to a feedback submission
is useful for visual / viewer-rendering bugs but is out of scope
for the genealogy correctness work this spec serves. Worth its
own scoping document if pursued.

### 7.5 Structured triage fields on `feedback.json` — defer until data exists

Possible future fields: a triage tag from a dropdown ("wrong
record returned", "incomplete search", "citation formatting", …),
a severity picker, a "which skill failed" guess. Don't add yet —
the free-text fields cover the same ground, and narrowing
prematurely loses signal. Revisit after ~50 cases of real data
when the actual failure categories are observable.

---

## 8. Implementation checklist for `cowork-genealogy-ui`

Concrete tasks for the UI repo:

1. In `src/main/feedback.ts::buildFeedbackZip`, after the current
   `FEEDBACK.md` write, also write `_feedback/feedback.json` with
   the schema in §3. Field values come from the same form state
   already used to build `FEEDBACK.md`. Sources for the
   non-form-field values:
   - `submitted_at`: `new Date().toISOString()`
   - `viewer_version`: `app.getVersion()`
   - `platform`: `process.platform`
   - `project_folder_path`: the same value already used to
     populate `FEEDBACK.md`'s "Project folder" line
2. Enforce 10,000-char max on the user-typed text fields
   (`user_prompt`, `agent_did`, `agent_should_have`, `notes`) in
   **two** places:
   - The dialog blocks submit with a clear error message when any
     field exceeds the limit.
   - `buildFeedbackZip` validates field lengths and throws on
     violation, so the limit can't be bypassed by future callers
     of the function. Single source of truth: the same constant
     used by both checks.
3. Add a unit test (or update the existing one) for
   `buildFeedbackZip` that asserts:
   - The zip contains `_feedback/feedback.json`.
   - The JSON parses.
   - All required fields are present (including `notes`,
     `project_folder_path`, `platform` — even when empty).
   - `schema_version` is `1`.
   - The field values round-trip the form data without
     transformation (modulo whitespace trim and `email`
     lowercasing).
   - Over-length fields throw rather than silently truncate.
4. `viewer_version` from `app.getVersion()` may report `'0.0.0'` or
   `'1.0.0'` in unpackaged dev builds. Decide whether that's
   acceptable (devs can filter on it in triage) or whether dev
   submissions should be marked distinctly (e.g. append `-dev`).
   Either is fine for v1; just commit to one.
5. Coordinate with this repo (`cowork-genealogy`) on the cutover.
   The dev workflow can't run until at least one zip with
   `feedback.json` exists, but old zips without it are explicitly
   not supported (per `feedback-case-spec.md`).
6. Nothing else in §7 is in scope for v1. If you find yourself
   wanting any of the deferred items, ping the consuming repo
   (`cowork-genealogy`) first — most of them have downstream
   implications for the workflow.

---

## 9. Out of scope for this spec

- The zip's overall layout (which project files are included, how
  they're packaged) — that's already established in the existing
  `feedback.ts`.
- The Drive upload mechanism — already in place.
- Anything the dev tooling does with `feedback.json` after reading
  it — that's `feedback-case-spec.md`.
- Per-user feedback throttling, abuse handling — separate concerns.

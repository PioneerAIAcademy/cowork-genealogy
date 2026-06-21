# Shorten: check-warnings

**Bucket:** A (dead-mechanics removal) — large protected interpretive core
**Primary owner:** both (developer cuts the tag catalog + I/O dump + edge
cases; **genealogist owns the interpretation/actionability judgment**)
**Current size:** 444 lines → **Target:** ~180–210 lines (~55% reduction)
**Tool migration:** done — calls `person_warnings` (read-only; deterministic
detection).
**Still needed as a skill?** **Yes** — the tool detects; the skill supplies
severity framing, actionability (naming the specific facts/sources), and the
identity-signal interpretation. That's all graded craft.

## TL;DR
`person_warnings` now does the detection math deterministically and returns
each warning's `issueType`, `severity`, `personName`, and `message`. So the
30-line warning-tag catalog and the tool I/O schema dump are dead. The big
interpretive sections (the `hasEventAfterDeath1` three-causes, the clustered-
warning identity verdict, "don't re-derive what the tool computed") are
load-bearing — but the same rules are repeated 4–6 times. Cut the catalog,
keep the judgment, state each rule once.

## Why this skill is shortenable
The whole point of the `person_warnings` migration is that Claude no longer
does the date arithmetic. So every passage that enumerates *how* a warning is
computed, *which* tags exist, or the *shape* of the tool's response is
redundant with the tool itself.

## The floor: what the unit tests actually grade
- **Deterministic validators** (`eval/harness/validators/test_check_warnings.py`):
  - `test_research_json_unmodified` / `test_tree_gedcomx_unmodified` —
    read-only on positive tests (skipped on negatives, which route away).
  - Universal `test_tool_allowlist` — calls must match `allowed-tools`
    (`person_warnings` is its checking engine; that's allowed).
- **Rubric dims** (`eval/tests/unit/check-warnings/rubric.md`): detection
  accuracy, severity classification, **actionability** — all craft (read the
  narrative report).
- **Base dims:** Correctness, Completeness, Tool Arguments.
- **Negative/boundary tests:** two-source-disagreement → conflict-resolution;
  "fix it" → don't fix here, route. (Boundaries are in the description +
  "Handoff rules".)

## CUT — safe to remove
- **[~46–76] "Quick reference — common warning tags"** — the full
  Fundamental/Valid/relative-mob tag catalog. The tool *returns* `issueType` +
  a user-friendly `message`; the skill doesn't need to recite the vocabulary.
  This is a fallback "in case the reference isn't loaded" — let the reference
  (`references/warning-checks.md`) own it. **(~30 lines, top cut.)**
- **[~126–140] the `person_warnings({...})` call + return-shape JSON dump** —
  the tool schema documents both. Keep one line: "call it per person; it reads
  the tree itself and returns warnings with severity + message."
- **[~411–431] "Edge cases"** (approximate-date fudging, multiple persons,
  empty result, tool error) — these describe tool internals
  (`imperfectDateFudgeDays`) or are one-liners. Keep only "surface a tool error
  verbatim, don't fall back to manual reasoning" (that's the migration's
  point); fold it into Important rules. Cut the rest.
- **[~433–444] "Re-invocation behavior"** — boilerplate.
- **[~108–124] Step 2 `projectPath` explanation** — compress to one line.

## KEEP — load-bearing judgment (do NOT cut)
- **The `hasEventAfterDeath1` three-causes block** (identity confusion / wrong
  death date / posthumous mention, with cues + user-facing actions) — this is
  the actionability rubric dim in its strongest form, and the "don't default to
  identity confusion" rule prevents data damage. Keep; tighten prose.
- **The clustered-warning verdict** ("2+ errors on one person → likely two
  merged identities; lead with this, list warnings under it") — keep.
- **Actionability requirements in Step 3** (name the specific `factIds` /
  sources; concrete next-step like "verify death date against S3") — directly
  the actionability dim. Keep.
- **Severity → assumption-category mapping** (Fundamental→error,
  Valid→warning, Unsound→doesn't fire) — the severity-classification dim. Keep
  the short framing; the full catalog goes to the reference.
- **"The tool is the arbiter; don't re-derive what it computed"** (Important
  rules: don't invent a root cause, don't do your own date arithmetic to
  "explain" a warning, the `208 years` example) — this is *the* migration
  guardrail. Keep.
- **`relatives*` handling** (the warning is about the relationship; verify the
  link before "fixing" the relative) — keep; it's a distinct correctness rule.
- **Handoff rules** (conflict vs warning; "fix it" → route) — boundary tests.

## TIGHTEN (this is where most of the win is)
The "**don't name internal skills to the user — phrase as a research action**"
rule appears in Step 3, Step 5 (×3 bullets), and the clustered-warning block.
**State it once** (e.g. a single "Phrasing" rule near the top) and delete every
repeat. Steps 4 ("interpret as identity signals") and 5 ("suggest next steps")
substantially overlap the three-causes block and each other — merge into one
"Interpret & recommend" section.

## Suggested target structure (~200 lines)
1. Frontmatter + Narration.
2. Purpose: tool detects deterministically; you decide *whom* to check,
   present clearly, interpret. Warnings ≠ conflicts (one line).
3. One **Phrasing** rule (research actions, not skill names) — stated once.
4. Whom to check (3 trigger cases) + one-line call note.
5. Report each warning: severity icon + tag + message + **the specific
   facts/sources** + concrete next step.
6. Interpret & recommend (merged): error→investigate, warning→verify,
   clustered→identity verdict, relatives→verify link first; the
   `hasEventAfterDeath1` three causes.
7. Important rules: tool is arbiter / don't re-derive / don't auto-correct /
   historical exceptions exist / surface tool errors verbatim.
8. Handoff rules.

## Verify
```
cd eval/harness && uv run python run_tests.py --skill check-warnings
```
Watch actionability and severity-classification; confirm the negative tests
still route conflicts → conflict-resolution and decline to "fix."

## Owner notes
**Developer** cuts the tag catalog, the I/O dump, edit-case internals, and the
repeated phrasing rule. **Genealogist** owns the three-causes interpretation,
the clustered-identity verdict, and the actionability requirements — these are
the graded craft and the data-safety guardrails. The big line win comes from
deleting the catalog + deduping the phrasing rule, not from touching the
interpretation.

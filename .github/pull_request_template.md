## Summary

<!-- 1-3 bullets describing what changed and why. Name the tier
     (Trivial / Normal) — docs/task-lifecycle.md. -->

## Review guidance

<!-- Two lines. The diff shows what you changed; these say what a reviewer
     can't work out from it. Both a human and the Claude session they point at
     the diff read this, so write it for someone who has not seen your branch.

     Start here — the file or function where the actual decision lives, and
     what you want checked about it. Not a file list; the diff has that.

     Unsure about — anything you couldn't resolve. "Nothing" is a valid answer
     on a mechanical change. If it's a question you should have asked before
     building, ask it now rather than shipping past it (task-lifecycle.md
     § "Ask early"). -->

**Start here:**

**Unsure about:**

## Plan

<!-- Normal: the two parts of PLAN.md nothing else here carries. Trivial:
     delete this section. Don't paste PLAN.md whole — its file list is the
     diff, its deferrals are "Follow-on issues", and by the time you open
     the PR it may be a plan you knowingly deviated from (step 4).

     Didn't change — the tempting adjacent thing you left alone, so a
     reviewer reads it as a decision rather than an omission.

     Acceptance check — the named test that fails on `main` and passes on
     this branch. Not "the tests pass"; they passed before.

     Deviated from the plan — anything you re-planned mid-flight (step 4).
     "Nothing" is the common answer. PLAN.md is gitignored, so this line is
     the only way a deviation reaches your reviewer.

     Hit the step-4 stop rule (schema, auth, plugin-agent binding, an ADR
     reversal, anything hard to undo)? Say so here and name the message
     where you raised it. -->

**Didn't change:**

**Acceptance check:**

**Deviated from the plan:**

## Test plan

<!-- If this PR touches a code/infra file (.ts/.tsx/.js/.mjs/.cjs/.py/.json/
     .yml/.yaml) outside packages/engine/plugin/skills/, packages/engine/
     plugin/agents/, eval/fixtures/, eval/tests/, eval/runlogs/, or docs/,
     a senior-developers approval is required by branch protection — see
     .github/CODEOWNERS for the exact rule. Peer approval alone will not
     unblock merge. This is a convenience note; GitHub's merge button is
     the actual enforcement. -->

- [ ] I ran `make test-all` (or `scripts/test.sh` — the same command) and it passed.
      <!-- No Windows equivalent exists (issue #1185): `eval\RunTests.bat` is the
           paid per-skill eval run, not this gate. On Windows, say so here and
           lean on CI, which runs the same suites. -->
      <!-- Note: every suite in it is offline and free — nothing here calls a
           model, which is what keeps it around 30s. Keep it that way. -->

- [ ] For every skill whose **run-log snapshot** I changed (anything under its
      skill dir, an agent it delegates to, its `eval/tests/unit/<skill>/`, or a
      scenario/fixture it references), I ran `make eval-skill SKILL=<name>` —
      Windows: `RunTests.bat` — and committed the run log **and its
      `.ann.json`** under `eval/runlogs/unit/<skill>/`.
      <!-- Behaviour-neutral skill edit (typo, rewording, comment)? Ask a senior
           for the `eval-cosmetic-skip` label instead of burning a paid run.
           Rules: eval/CLAUDE.md § "GitHub Action rules". -->

- [ ] If I changed a skill's `description` frontmatter or its DO NOT clauses, I
      added or refreshed the negative test on **both** sides of every routing
      pair I touched — not just the direction I was fixing.
      <!-- The edit that stops A over-triggering is the one that can start B
           under-triggering, and a one-directional pair hides it.
           `check_negative_reciprocity.py` reports the gaps, but only after the
           fact and only as a warning — this box is the part that prevents them.
           Nothing enforces it; it is here because the lint can't be. -->

## Follow-on issues

<!-- Numbers filed for work you deferred. DEVELOPMENT.md § "Follow-on work". -->

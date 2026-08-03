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

<!-- Normal: paste PLAN.md. Trivial: delete this section.
     If you hit the step-4 stop rule (schema, auth, plugin-agent binding,
     an ADR reversal, or anything hard to undo), say so here and name the
     message where you raised it. -->

## Test plan

- [ ] I ran `make test-all` (or `scripts/test.sh` — the same command) and it passed.
      <!-- No Windows equivalent exists (issue #1185): `eval\RunTests.bat` is the
           paid per-skill eval run, not this gate. On Windows, say so here and
           lean on CI, which runs the same suites. -->
      <!-- Note: this runs the harness's e2e-marked contract test, which makes a
           real (billed) Anthropic call. It skips itself when no key is
           reachable; CI never runs it. -->

- [ ] For every skill whose **run-log snapshot** I changed (anything under its
      skill dir, an agent it delegates to, its `eval/tests/unit/<skill>/`, or a
      scenario/fixture it references), I ran `make eval-skill SKILL=<name>` —
      Windows: `RunTests.bat` — and committed the run log **and its
      `.ann.json`** under `eval/runlogs/unit/<skill>/`.
      <!-- Behaviour-neutral skill edit (typo, rewording, comment)? Ask a senior
           for the `eval-cosmetic-skip` label instead of burning a paid run.
           Rules: eval/CLAUDE.md § "GitHub Action rules". -->

## Follow-on issues

<!-- Numbers filed for work you deferred. DEVELOPMENT.md § "Follow-on work". -->

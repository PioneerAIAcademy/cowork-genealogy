## Summary

<!-- 1-3 bullets describing what changed and why. Name the tier
     (Trivial / Normal / Risky) — docs/task-lifecycle.md. -->

## Plan

<!-- Normal tier: paste PLAN.md. Risky tier: paste it here and get the lead's
     review before writing code. Trivial: delete this section. -->

## Test plan

- [ ] I ran `make test-all` (or `scripts/test.sh` — the same command) and it passed.
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

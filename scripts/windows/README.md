# Windows batch wrappers

Native `cmd.exe` equivalents of the `make` targets a developer runs, for
Windows machines without Git Bash or WSL. Run them from anywhere — each one
resolves the repo root from its own location:

```
scripts\windows\install.bat
scripts\windows\test-all.bat
```

On macOS and Linux use `make <target>` instead; these files are not needed
there.

## Targets

| Make target | Windows wrapper | What it does |
|---|---|---|
| `make install` | `scripts\windows\install.bat` | Install everything: pnpm workspace, server venv, engine build, eval-ui deps |
| `make reinstall` | `scripts\windows\reinstall.bat` | `clean-deps` then `install`, from scratch |
| `make clean-deps` | `scripts\windows\clean-deps.bat` | Remove every `node_modules` |
| `make server-install` | `scripts\windows\server-install.bat` | Create the FastAPI server venv (uv sync) |
| `make engine-build` | `scripts\windows\engine-build.bat` | Build the genealogy engine (mcp-server) |
| `make server-mock` | `scripts\windows\server-mock.bat` | Mock agent, dev-login, port 8000 — no keys needed |
| `make server-dev` | `scripts\windows\server-dev.bat` | Real agent, dev-login, port 8000 |
| `make server` | `scripts\windows\server.bat` | Real agent + FamilySearch, port 1837 |
| `make web-dev` | `scripts\windows\web-dev.bat` | Web client for `server-mock` / `server-dev` |
| `make web` | `scripts\windows\web.bat` | Web client for `server` |
| `make db-reset` | `scripts\windows\db-reset.bat` | Wipe the local SQLite DB and sandbox dirs |
| `make test-all` | `scripts\windows\test-all.bat` | **The pre-PR gate** — every suite, all failures reported together |
| `make lint` | `scripts\windows\lint.bat` | ESLint (apps/electron, eval/app) |
| `make test-js` | `scripts\windows\test-js.bat` | JS workspace tests (turbo) |
| `make typecheck` | `scripts\windows\typecheck.bat` | TypeScript typecheck (turbo) |
| `make server-test` | `scripts\windows\server-test.bat` | Control-plane tests (pytest) |
| `make engine-test` | `scripts\windows\engine-test.bat` | Engine unit tests (vitest) |
| `make eval-ui-test` | `scripts\windows\eval-ui-test.bat` | Eval CRUD UI tests (vitest) |
| `make judge-report` | `scripts\windows\judge-report.bat` | Non-discrimination scan of the unit eval judge over committed run logs (no API calls) |
| `make harness-test` | `scripts\windows\harness-test.bat` | Eval harness tests (pytest) |
| `make harness-lint` | `scripts\windows\harness-lint.bat` | Harness ruff check |
| `make agent-smoke` | `scripts\windows\agent-smoke.bat` | Plugin agent registration smoke test |
| `make deploy-status` | `scripts\windows\deploy-status.bat` | Health-check the deployed control plane |

Pass parameters as environment variables, the same names the make targets use:

```
set DEPLOY_URL_OVERRIDE=https://staging.example.com
scripts\windows\deploy-status.bat
```

## What is not here

- **Running e2e fixtures, skill evals, or building the shipped artifacts.**
  Those have double-clickable wrappers in `eval\` — `RunE2E.bat`,
  `RunTests.bat`, `GateSkill.bat`, `BuildMcpb.bat`, `BuildPlugin.bat` and the
  rest. They prompt for the fixture or skill name instead of taking arguments.
  The mapping tables are in [`docs/e2e-testing-guide.md`](../../docs/e2e-testing-guide.md)
  and [`docs/alpha-feedback-guide.md`](../../docs/alpha-feedback-guide.md).
- **Git hooks** — `eval\InstallHooks.bat`, once per clone.
- **Feedback cases** — `scripts\setup-feedback-case.bat` and
  `scripts\reset-feedback-case.bat`, which take the zip or case directory as an
  argument.
- **Deploy, sandbox images, and worktree linking** — operator targets that need
  bash. Run them from Git Bash.

## Changing these

`make help` lists every target; this table lists every wrapper. They are checked
against each other and against the Makefile by
`packages/engine/mcp-server/tests/packaging/windows-wrappers.test.ts`, which runs
under `make engine-test`. Adding, renaming, or deleting a wrapper means editing
this table in the same commit.

Each wrapper reimplements its recipe rather than shelling out to `make`, so a
recipe change has to be made in both places. The wrappers do not reproduce
make's staleness tracking — `engine-build.bat` reinstalls on a lockfile change
and otherwise always rebuilds, where make skips work that is already current.

Two rules the guard enforces, because breaking either fails silently:

- Run `npm`, `pnpm` and `npx` through `call` — `call npm ci`, never `npm ci`.
  They are `.cmd` batch files, and cmd.exe *replaces* the running script when
  one batch file invokes another without `call`, so every line below a bare
  `npm ci` is skipped with no error.
- Call a sibling wrapper by its own location — `call "%~dp0install.bat"`, not
  `call scripts\install.bat`, which breaks the moment the directory moves.

### Why there is no `windows-latest` CI job

Adding one was considered and declined: it would arrive red on every pre-existing
Windows-only failure and pull unrelated noise into every PR. The workaround is
manual: `scripts\windows\test-all.bat` on the branch, output pasted in the PR.

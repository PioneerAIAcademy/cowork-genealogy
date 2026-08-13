@echo off
REM Lists all available Windows batch file wrappers for make targets
echo.
echo  cowork-genealogy Windows batch wrappers  (scripts\*.bat)
echo  ──────────────────────────────────────────────────────────
echo.
echo  SETUP
echo    scripts\install.bat              Install everything (pnpm + venv + engine + eval-ui)
echo    scripts\server-install.bat       Create FastAPI server venv (uv sync)
echo    scripts\engine-build.bat         Build genealogy engine (mcp-server)
echo    scripts\clean-deps.bat           Remove all node_modules (run install after)
echo    scripts\reinstall.bat            clean-deps then install from scratch
echo.
echo  DEV SERVERS  (run in separate terminals)
echo    scripts\server-mock.bat          Mock agent, dev-login, port 8000  (no keys)
echo    scripts\server-dev.bat           Real agent, dev-login, port 8000
echo    scripts\server.bat               Real agent + FamilySearch, port 1837
echo    scripts\web-dev.bat              Web client for server-mock / server-dev
echo    scripts\web.bat                  Web client for server
echo    scripts\electron.bat             Electron Research Viewer
echo    scripts\db-reset.bat             Wipe local SQLite DB + sandbox dirs
echo.
echo  TESTS
echo    scripts\test-js.bat              JS workspace tests (turbo)
echo    scripts\typecheck.bat            TypeScript typecheck (turbo)
echo    scripts\server-test.bat          FastAPI server tests (pytest)
echo    scripts\engine-test.bat          Engine unit tests (vitest)
echo    scripts\harness-test.bat         Eval harness tests (pytest)
echo    scripts\harness-lint.bat         Harness ruff lint check
echo    scripts\agent-smoke.bat          Plugin agent registration smoke test
echo.
echo  E2E
echo    scripts\e2e-preflight.bat        Check machine ready for e2e runs
echo    scripts\e2e-login.bat            FamilySearch login (~24h token)
echo    scripts\e2e-run.bat ^<slug^>       Run one e2e fixture (expensive)
echo    scripts\e2e-view.bat ^<slug^>      Load latest run into Research Viewer
echo    scripts\e2e-project.bat ^<slug^>   Seed editable Cowork project from fixture
echo    scripts\e2e-author.bat ^<args^>    Fixture authoring (snapshot/strip/scaffold)
echo    scripts\e2e-validate.bat [slug]  Stripping linter (omit slug = all fixtures)
echo    scripts\e2e-calibrate.bat        Judge calibration
echo    scripts\e2e-corpus.bat           Corpus report (recent runs)
echo    scripts\e2e-latency.bat          Phase-0 latency breakdown
echo    scripts\e2e-guardrail-shadow.bat Guardrail shadow calibration
echo    scripts\e2e-scratch.bat ^<slug^>   Debug fixture live with /research
echo    scripts\e2e-thinking-probe.bat   Reproduce record-extractor thinking freeze
echo.
echo  SKILL EVAL
echo    scripts\eval-skill.bat ^<skill^>   Run skill eval harness
echo    scripts\gate-skill.bat           Gate SKILL.md edit (set SKILL + TEST first)
echo    scripts\eval-timings.bat         Weekly timing review
echo    scripts\prune-runlogs.bat        Maintenance sweep of unit run logs
echo    scripts\skill-latency.bat        Per-skill output-token profile
echo    scripts\optimize-skill.bat ^<s^>   Tune skill description from test queries
echo.
echo  ARTIFACTS
echo    scripts\mcpb.bat                 Build .mcpb desktop extension
echo    scripts\plugin.bat               Build Cowork plugin .zip
echo    scripts\cowork-install.bat       Build both + print install instructions
echo.
echo  EVAL UI
echo    scripts\eval-ui.bat              Launch Eval CRUD UI (Next.js, port 3000)
echo    scripts\eval-ui-test.bat         Eval CRUD UI tests (vitest)
echo.
echo  MISC
echo    scripts\deploy-status.bat        Health-check deployed control plane
echo.
echo  For parameters, set env vars first: set TEST=mary-mcandrew-son ^&^& scripts\e2e-run.bat
echo  Or pass as first arg:              scripts\e2e-run.bat mary-mcandrew-son
echo.

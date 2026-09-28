"""Offline tests for the D14/D17 prep: proto/audit.py's classification of tool_calls rows
(acceptance criteria 3 and 4), proto/seed.py's fixture resolution and file plan, and
proto/export.py's pure seams (D18: the manifest, the out-dir layout, the exit codes), and
proto/env.sh's token handling (the file's mode, what a failed refresh leaves behind and
says, and the `--min-life` window it asks dev/fs-token.ts for). No Postgres, no stack, no
model, and no FamilySearch: the refresh is a stand-in on PATH."""

from __future__ import annotations

import json
import re
import shlex
import shutil
import stat
import subprocess
import sys
from pathlib import Path

import psycopg
import pytest

from proto import audit, export, seed


def row(tool: str, decision: str = "allow", path: str | None = None, ms: int | None = None) -> dict:
    return {"turn_id": "t", "agent_type": None, "tool_name": tool, "input_path": path,
            "decision": decision, "duration_ms": ms}


# ── audit ─────────────────────────────────────────────────────────────────────────


def test_audit_passes_a_clean_session_and_reports_its_durations():
    a = audit.audit([
        row("mcp__genealogy__place_search", ms=310),
        row("Read", path="/opt/genealogy/plugin/skills/x/references/y.md", ms=5),
        row("Task", ms=90_000),
        row("mcp__genealogy__record_read"),  # in flight at a kill: no duration, not a failure
    ], anchor="/project")
    assert a.criterion_3_ok and a.rows == 4
    assert a.completed == 3 and a.without_duration == 1
    assert a.longest == ("Task", 90_000) and a.p50_ms == 310 and a.denied == {}


def test_audit_fails_on_an_executed_bash_or_an_allowed_project_read():
    assert not audit.audit([row("Bash", ms=3)], anchor="/project").criterion_3_ok
    assert not audit.audit([row("Read", path="/project/research.json", ms=3)], anchor="/project").criterion_3_ok
    assert not audit.audit([row("Grep", path="/project/results/x.json")], anchor="/project").criterion_3_ok
    assert not audit.audit([row("Glob", path="/project")], anchor="/project").criterion_3_ok


def test_audit_counts_denied_attempts_separately_and_reads_beside_the_anchor_as_ordinary():
    a = audit.audit([
        row("Read", "deny", "/project/research.json"),
        row("Bash", "deny"),
        row("Read", path="/projects/other.json", ms=1),  # a sibling path, not under /project
    ], anchor="/project")
    assert a.criterion_3_ok and a.project_reads_allowed == 0 and a.bash_executed == 0
    assert a.denied == {"Read": 1, "Bash": 1}


def test_audit_report_names_the_verdict_and_the_ceiling():
    text = audit.report(audit.audit([row("Bash", ms=3)], anchor="/project"), ceiling_s=1800, session_id="s")
    assert "FAIL" in text and "session s" in text
    text = audit.report(audit.audit([row("Task", ms=2_000_000)], anchor="/project"), ceiling_s=1800, session_id=None)
    assert "PASS" in text and "reached the ceiling" in text and "every session" in text
    assert "no completed call" in audit.report(audit.audit([], anchor="/project"), ceiling_s=1800, session_id=None)


# ── seed ──────────────────────────────────────────────────────────────────────────


def _e2e_fixture(root: Path) -> Path:
    d = root / "e2e" / "fx"
    d.mkdir(parents=True)
    for name in ("starting-research.json", "starting-tree.gedcomx.json", "unstripped-tree.gedcomx.json",
                 "expected-findings.json"):
        (d / name).write_text("{}", encoding="utf-8")
    (d / "fixture.json").write_text(json.dumps({"name": "Fx", "researcher_question": "Who?"}), encoding="utf-8")
    (d / "README.md").write_text("notes", encoding="utf-8")
    return d


def test_plan_files_maps_an_e2e_fixture_to_the_two_project_documents(tmp_path):
    d = _e2e_fixture(tmp_path)
    plan = seed.plan_files(d)
    assert [ref for ref, _ in plan] == ["research.json", "tree.gedcomx.json"]
    assert plan[0][1] == d / "starting-research.json"
    assert seed.fixture_meta(d) == {"name": "Fx", "researcher_question": "Who?"}


def test_plan_files_takes_a_scenario_whole_but_for_its_readme_and_dotfiles(tmp_path):
    d = tmp_path / "sc"
    (d / "results").mkdir(parents=True)
    (d / ".hidden").mkdir()
    for name in ("research.json", "tree.gedcomx.json", "results/log_1.json", "README.md", ".hidden/x"):
        (d / name).write_text("{}", encoding="utf-8")
    assert [ref for ref, _ in seed.plan_files(d)] == ["research.json", "results/log_1.json", "tree.gedcomx.json"]
    assert seed.fixture_meta(d) == {}


def test_plan_files_refuses_a_directory_with_no_research_document(tmp_path):
    (tmp_path / "x.json").write_text("{}", encoding="utf-8")
    with pytest.raises(ValueError, match="research.json"):
        seed.plan_files(tmp_path)


def test_resolve_fixture_tries_a_directory_then_e2e_then_scenarios(tmp_path):
    e2e, sc = tmp_path / "e2e", tmp_path / "sc"
    (e2e / "a").mkdir(parents=True)
    (sc / "b").mkdir(parents=True)
    assert seed.resolve_fixture("a", e2e_dir=e2e, scenario_dir=sc) == (e2e / "a").resolve()
    assert seed.resolve_fixture("b", e2e_dir=e2e, scenario_dir=sc) == (sc / "b").resolve()
    assert seed.resolve_fixture(str(sc / "b"), e2e_dir=e2e, scenario_dir=sc) == (sc / "b").resolve()
    with pytest.raises(FileNotFoundError, match="no fixture 'c'"):
        seed.resolve_fixture("c", e2e_dir=e2e, scenario_dir=sc)


def test_default_project_id_is_a_valid_store_key(tmp_path):
    d = tmp_path / "bagley-father 1884"
    d.mkdir()
    pid = seed.default_project_id(d)
    assert re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", pid) and pid.startswith("proj_bagley-father-1884_")


def test_the_repos_own_fixtures_plan_in_both_layouts():
    e2e = seed.plan_files(seed.resolve_fixture("bagley-father-1884"))
    assert [ref for ref, _ in e2e] == ["research.json", "tree.gedcomx.json"]
    assert seed.fixture_meta(seed.resolve_fixture("bagley-father-1884"))["researcher_question"].startswith("Who was the father")
    scenario = dict(seed.plan_files(seed.resolve_fixture("flynn-first-plan")))
    assert "research.json" in scenario and "tree.gedcomx.json" in scenario and "README.md" not in scenario


# ── env.sh: the token file's mode, and what a failed refresh leaves behind ────────


ROOT = Path(__file__).resolve().parents[3]
#: Windows chmod only toggles read-only, so a file mode never reads back as 0o600 there.
POSIX_MODES = sys.platform != "win32"


@pytest.mark.skipif(shutil.which("sh") is None, reason="env.sh needs a POSIX shell")
def test_env_sh_keeps_the_token_file_0600_and_a_failed_refresh_keeps_the_previous_token(tmp_path):
    token_file = tmp_path / "fs-token"
    token_file.write_text("", encoding="utf-8")
    token_file.chmod(0o644)  # what proto-up-core's empty-file arm leaves under the default umask
    # PATH without npx: the engine refresh fails the way a missing login or a blip would.
    # A stand-in for eval/.env, so the test never reads the real one.
    dotenv = tmp_path / "dotenv"
    dotenv.write_text("ANTHROPIC_API_KEY=k-from-dotenv\nOPENROUTER_API_KEY=or-from-dotenv\n", encoding="utf-8")
    base_env = {"PATH": "/usr/bin:/bin", "HOME": str(tmp_path), "PROTO_TOKEN_FILE": str(token_file),
                "PROTO_ENV_FILE": str(dotenv)}

    def source(**shell_vars: str) -> subprocess.CompletedProcess:
        # The caller's values are UNEXPORTED shell variables, so only the script's own
        # `export` makes them reach the worker's `up`; stdout is one printenv per key
        # (exported values only; BSD printenv prints just its first argument), stderr is
        # the script's own output, which must never carry a value.
        prefix = "".join(f"{k}={shlex.quote(v)}; " for k, v in shell_vars.items())
        cmd = prefix + ". apps/server/proto/env.sh; printenv ANTHROPIC_API_KEY; printenv OPENROUTER_API_KEY"
        return subprocess.run(["sh", "-c", cmd], cwd=ROOT, env=base_env, capture_output=True, text=True,
                              encoding="utf-8")

    r = source(FS_ACCESS_TOKEN="tok-1", ANTHROPIC_API_KEY="k", OPENROUTER_API_KEY="or-key-1")
    assert r.returncode == 0 and "FS token written" in r.stderr, r.stderr
    assert r.stdout.split() == ["k", "or-key-1"], "the caller's keys, exported for the worker's up"
    assert "OPENROUTER_API_KEY set" in r.stderr and "or-key-1" not in r.stderr and "k\n" not in r.stderr, "never echoed"
    assert token_file.read_text(encoding="utf-8") == "tok-1"
    if POSIX_MODES:
        assert stat.S_IMODE(token_file.stat().st_mode) == 0o600, "the mode is set on every run, not only at creation"
    assert "tok-1" not in r.stderr, "never echoed"
    # No caller values: the keys come from the dotenv file and are exported; no refresh:
    # the previous token survives, and the status says so.
    r = source()
    assert r.returncode == 0 and "refresh FAILED" in r.stderr and "kept" in r.stderr, r.stderr
    assert r.stdout.split() == ["k-from-dotenv", "or-from-dotenv"], "both keys read from the dotenv and exported"
    assert "from-dotenv" not in r.stderr, "never echoed"
    assert token_file.read_text(encoding="utf-8") == "tok-1"
    # WHY it failed reaches the operator: fs-token.ts reports every failure on stderr and
    # exits 2 with nothing on stdout, so a 2>/dev/null here would swallow the one line that
    # says what to do ("log in again with make e2e-login" when the refresh token is dead).
    # Here the failure is the missing npx, and the shell's own reason is on the line.
    assert "not found" in r.stderr, f"the refresh's own reason must join the status line: {r.stderr}"
    # The empty directory an early compose `up` leaves in the file's place is replaced.
    token_file.unlink()
    token_file.mkdir()
    r = source(FS_ACCESS_TOKEN="tok-2", ANTHROPIC_API_KEY="k")
    assert token_file.is_file() and token_file.read_text(encoding="utf-8") == "tok-2", r.stderr
    if POSIX_MODES:
        assert stat.S_IMODE(token_file.stat().st_mode) == 0o600
    # Nothing to refresh and nothing kept: UNSET.
    token_file.write_text("", encoding="utf-8")
    assert "UNSET" in source(ANTHROPIC_API_KEY="k").stderr


@pytest.mark.skipif(shutil.which("sh") is None, reason="env.sh needs a POSIX shell")
def test_env_sh_asks_fs_token_for_a_window_that_outlives_a_full_length_turn(tmp_path):
    """`make proto-token` sources env.sh and passes no arguments of its own, so whatever
    window the refresh uses is the one env.sh asks for. It must be at least the step
    ceiling (READ_TIMEOUT_S, 1800 s) in minutes -- a narrower one still hands over a token
    a turn can outlive, which is how the D17 run died -- and an operator must be able to
    widen it without editing the script."""
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    argv_log = tmp_path / "argv.log"
    # A stand-in npx: records the argv and prints a stand-in token. The real script is
    # never run here -- it would reach FamilySearch and rotate the operator's refresh token.
    npx = bin_dir / "npx"
    npx.write_text(
        f'#!/bin/sh\necho "$*" >> {shlex.quote(str(argv_log))}\nprintf stub-token\n',
        encoding="utf-8",
    )
    npx.chmod(0o755)
    token_file = tmp_path / "fs-token"
    token_file.write_text("", encoding="utf-8")
    dotenv = tmp_path / "dotenv"
    dotenv.write_text("ANTHROPIC_API_KEY=k\n", encoding="utf-8")
    env = {"PATH": f"{bin_dir}:/usr/bin:/bin", "HOME": str(tmp_path),
           "PROTO_TOKEN_FILE": str(token_file), "PROTO_ENV_FILE": str(dotenv)}

    def source(**extra: str) -> str:
        subprocess.run(["sh", "-c", ". apps/server/proto/env.sh"], cwd=ROOT, env={**env, **extra},
                       capture_output=True, text=True, encoding="utf-8", check=True)
        return argv_log.read_text(encoding="utf-8").splitlines()[-1]

    ceiling_s = int(re.search(r"READ_TIMEOUT_S:-(\d+)", (ROOT / "apps" / "server" / "proto" /
                                                         "docker-compose.yml").read_text(encoding="utf-8")).group(1))
    default = source()
    assert default.startswith("tsx dev/fs-token.ts "), default
    minutes = int(default.split("--min-life")[1].split()[0])
    assert minutes >= ceiling_s / 60, f"env.sh asks for {minutes} min against a {ceiling_s} s step ceiling"
    assert source(PROTO_TOKEN_MIN_LIFE="55").endswith("--min-life 55"), "an operator can widen it"
    assert token_file.read_text(encoding="utf-8") == "stub-token"


# ── export (D18): the mirror image of seed ────────────────────────────────────────


def test_export_manifest_mirrors_the_seed_manifest_and_the_ts_side_reads_every_key(tmp_path):
    m = export.manifest("proj_x", tmp_path)
    assert m == {"projectId": "proj_x", "anchorPath": "/project", "outDir": str(tmp_path)}
    assert export.ANCHOR == seed.ANCHOR and export.ENGINE_DIR == seed.ENGINE_DIR
    ts = (export.ENGINE_DIR / "dev" / "export-project.ts").read_text(encoding="utf-8")
    assert all(key in ts for key in m), "the TS side reads every key the manifest carries"
    assert "readBytes" in ts, "images are bytes, never a text decode"
    assert '"results"' in ts and '"images"' in ts and '"research.json"' in ts and '"tree.gedcomx.json"' in ts


def test_export_dir_is_the_project_id_under_out_and_the_default_out_is_gitignored():
    assert export.export_dir(Path("/x/exports"), "proj_y") == Path("/x/exports/proj_y")
    assert export.DEFAULT_OUT == ROOT / "apps" / "server" / "proto" / "exports"
    assert "apps/server/proto/exports/" in (ROOT / ".gitignore").read_text(encoding="utf-8").splitlines()


def test_export_main_exits_2_on_an_unknown_session_or_no_postgres_without_running_the_ts_side(monkeypatch, capsys):
    def must_not_run(*a, **k):
        raise AssertionError("the TS side must not run for an unknown session")

    monkeypatch.setattr(export, "export", must_not_run)
    monkeypatch.setattr(export, "resolve_project", lambda dsn, sid: None)
    assert export.main(["--session", "nope"]) == 2
    assert "no session 'nope'" in capsys.readouterr().err

    def down(dsn, sid):
        raise psycopg.OperationalError("connection refused")

    monkeypatch.setattr(export, "resolve_project", down)
    assert export.main(["--session", "s"]) == 2
    assert "postgres unreachable" in capsys.readouterr().err


def test_export_main_runs_the_ts_side_on_the_resolved_project_and_maps_its_exit(monkeypatch, tmp_path, capsys):
    monkeypatch.setattr(export, "resolve_project", lambda dsn, sid: "proj_z")
    calls: list[tuple] = []
    monkeypatch.setattr(export, "export", lambda pid, **kw: calls.append((pid, kw)) or 0)
    assert export.main(["--session", "s", "--out", str(tmp_path)]) == 0
    [(pid, kw)] = calls
    assert pid == "proj_z" and kw["out_dir"] == tmp_path.resolve()
    assert str(tmp_path.resolve() / "proj_z") in capsys.readouterr().out
    monkeypatch.setattr(export, "export", lambda pid, **kw: 3)
    assert export.main(["--session", "s"]) == 1, "any TS-side failure is exit 1"


def test_export_runs_the_ts_side_from_the_engine_dir_with_the_store_env(monkeypatch, tmp_path):
    runs: list[dict] = []

    def fake_run(cmd, **kw):
        runs.append({"cmd": cmd, **kw})
        return subprocess.CompletedProcess(cmd, 0, stdout="exported 0 files\n", stderr="")

    monkeypatch.setattr(export.subprocess, "run", fake_run)
    assert export.export("proj_q", out_dir=tmp_path, pg_dsn="postgresql://x/y", s3_endpoint="http://s3:9000") == 0
    [run] = runs
    assert run["cmd"] == ["npx", "tsx", "dev/export-project.ts"] and run["cwd"] == export.ENGINE_DIR
    assert run["env"]["PROTO_PG_DSN"] == "postgresql://x/y" and run["env"]["PROTO_S3_ENDPOINT"] == "http://s3:9000"
    assert json.loads(run["input"]) == export.manifest("proj_q", tmp_path) and run["encoding"] == "utf-8"

"""U13's compose-or-deployed seam (proto/target.py) and what the drivers send through it.

Pinned: compose's argv is today's; the deployed target reads CloudWatch, signals over SSM
and restores every setting it changed, even on an exception; a CloudWatch line's syslog
prefix no longer hides its event; a cookie file signs a driver in without dev-login; the
``*-aws`` recipes point the store at real S3 with no key pair and no tree-read block.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

import httpx
import pytest

SERVER = Path(__file__).resolve().parents[1]
REPO = SERVER.parents[1]
if str(SERVER) not in sys.path:
    sys.path.insert(0, str(SERVER))

from proto import bounds, demo, target, turn  # noqa: E402

FIXTURE = SERVER / "tests" / "fixtures" / "eb-cloudwatch" / "worker-web-stdout.txt"
COOKIE = "c0ffee-session-value"


class FakeAws:
    """argv in, canned JSON out; records every call."""

    def __init__(self, settings: dict[str, str] | None = None, log_lines: list[str] | None = None):
        self.calls: list[list[str]] = []
        self.settings = dict(settings or {})
        self.log_lines = log_lines or []
        self.fail_update_on: int | None = None

    def op(self, argv: list[str]) -> tuple[str, str]:
        i = argv.index("--output") + 2
        return argv[i], argv[i + 1]

    def __call__(self, argv: list[str]) -> subprocess.CompletedProcess:
        self.calls.append(argv)
        svc, op = self.op(argv)
        body: dict = {}
        if (svc, op) == ("elasticbeanstalk", "describe-environment-resources"):
            body = {"EnvironmentResources": {"Instances": [{"Id": "i-0abc"}]}}
        elif (svc, op) == ("elasticbeanstalk", "describe-environments"):
            body = {"Environments": [{"Status": "Ready"}]}
        elif (svc, op) == ("elasticbeanstalk", "describe-configuration-settings"):
            body = {"ConfigurationSettings": [{"OptionSettings": [
                {"Namespace": target.ENV_NS, "OptionName": k, "Value": v} for k, v in self.settings.items()]}]}
        elif (svc, op) == ("elasticbeanstalk", "update-environment"):
            if self.fail_update_on is not None and len(self.updates()) == self.fail_update_on:
                return subprocess.CompletedProcess(argv, 254, "", "boom")
        elif (svc, op) == ("ssm", "send-command"):
            body = {"Command": {"CommandId": "cmd-1"}}
        elif (svc, op) == ("ssm", "get-command-invocation"):
            body = {"Status": "Success", "StandardOutputContent": "ok"}
        elif (svc, op) == ("logs", "filter-log-events"):
            body = {"events": [{"timestamp": n, "message": m} for n, m in enumerate(self.log_lines)]}
        return subprocess.CompletedProcess(argv, 0, json.dumps(body), "")

    def updates(self) -> list[list[str]]:
        return [a for a in self.calls if self.op(a) == ("elasticbeanstalk", "update-environment")]


def deployed(fake: FakeAws) -> target.DeployedTarget:
    return target.DeployedTarget(profile="p", runner=fake, sleep=lambda s: None)


# ── parsing ────────────────────────────────────────────────────────────────────────────


def test_a_cloudwatch_line_with_a_syslog_prefix_yields_its_event():
    text = FIXTURE.read_text(encoding="utf-8")
    events = target.json_records(text)
    assert [e["ev"] for e in events] == ["prepare", "start", "prepare", "turn"]
    assert events[1]["sqs_credentials"] == "default chain (iam-role)"
    assert bounds.parse_json_lines(text) == events, "bounds parses through the same function"


def test_bare_compose_lines_still_parse():
    assert target.json_records('{"ev":"start"}\nplain\n  {"ev":"turn"}  \n[1]\n') == [{"ev": "start"}, {"ev": "turn"}]


# ── compose: today's argv ──────────────────────────────────────────────────────────────


def test_compose_target_argv_is_todays(monkeypatch):
    seen: list[tuple[str, ...]] = []
    monkeypatch.setattr(turn, "docker", lambda *a: seen.append(a))
    t = bounds.compose_target("w", "pg", "tl")
    t.signal("worker", "stop")
    t.signal("worker", "start")
    t.signal("worker", "kill")
    t.signal("worker", "term")
    with t.pause("postgres"):
        pass
    assert seen == [("stop", "w"), ("start", "w"), ("kill", "w"), ("restart", "-t", "30", "w"),
                    ("pause", "pg"), ("unpause", "pg")]


def test_compose_target_reads_logs_the_way_worker_events_did():
    seen: list[tuple[str, ...]] = []
    t = target.ComposeTarget(compose=lambda *a: seen.append(a) or '{"ev":"start"}\n')
    assert t.events("worker") == [{"ev": "start"}]
    assert seen == [("logs", "--no-color", "--no-log-prefix", "worker")]


# ── deployed ───────────────────────────────────────────────────────────────────────────


def test_deployed_logs_read_the_tiers_cloudwatch_group():
    fake = FakeAws(log_lines=FIXTURE.read_text(encoding="utf-8").splitlines())
    events = deployed(fake).events("worker", since_ms=5)
    call = fake.calls[-1]
    assert fake.op(call) == ("logs", "filter-log-events")
    assert call[call.index("--log-group-name") + 1] == "/aws/elasticbeanstalk/genealogy-u13-worker/var/log/web.stdout.log"
    assert call[call.index("--start-time") + 1] == "5"
    assert call[:7] == ["aws", "--profile", "p", "--region", "us-east-1", "--output", "json"]
    assert [e["ev"] for e in events] == ["prepare", "start", "prepare", "turn"]


@pytest.mark.parametrize("action, command", [
    ("kill", "systemctl kill -s KILL web.service"),
    ("term", "systemctl restart web.service"),
])
def test_deployed_signal_runs_systemctl_over_ssm_and_waits(action, command):
    fake = FakeAws()
    deployed(fake).signal("worker", action)
    send = next(a for a in fake.calls if fake.op(a) == ("ssm", "send-command"))
    assert send[send.index("--instance-ids") + 1] == "i-0abc"
    assert json.loads(send[send.index("--parameters") + 1]) == {"commands": [command]}
    assert any(fake.op(a) == ("ssm", "get-command-invocation") for a in fake.calls), "the signal waits for the command"


def test_deployed_configure_restores_a_set_name_and_removes_a_new_one():
    fake = FakeAws(settings={"SESSION_SPEND_CAP_USD": "35"})
    with deployed(fake).configure("worker", {"SESSION_SPEND_CAP_USD": "1", "U13_PROBE": "x"}):
        pass
    applied, restored = fake.updates()
    assert json.loads(applied[applied.index("--option-settings") + 1]) == [
        {"Namespace": target.ENV_NS, "OptionName": "SESSION_SPEND_CAP_USD", "Value": "1"},
        {"Namespace": target.ENV_NS, "OptionName": "U13_PROBE", "Value": "x"}]
    assert json.loads(restored[restored.index("--option-settings") + 1]) == [
        {"Namespace": target.ENV_NS, "OptionName": "SESSION_SPEND_CAP_USD", "Value": "35"}]
    assert json.loads(restored[restored.index("--options-to-remove") + 1]) == [
        {"Namespace": target.ENV_NS, "OptionName": "U13_PROBE"}]


def test_deployed_configure_restores_on_an_exception():
    fake = FakeAws(settings={"FS_GRANT_REFRESH_AGE_S": "600"})
    with pytest.raises(RuntimeError, match="mid-case"):
        with deployed(fake).configure("web", {"FS_GRANT_REFRESH_AGE_S": "0"}):
            raise RuntimeError("mid-case")
    assert len(fake.updates()) == 2, "the restore ran in finally"


def test_deployed_has_no_pause():
    with pytest.raises(NotImplementedError, match="RDS"):
        with deployed(FakeAws()).pause("postgres"):
            pass


def test_bounds_refuses_compose_only_cases_on_a_deployed_target():
    args = bounds.build_parser().parse_args(["--case", "outage_pause", "--target", "deployed"])
    with pytest.raises(ValueError, match="compose-only"):
        bounds.make_ctx(args, None)
    args = bounds.build_parser().parse_args(["--case", "stop_main", "--target", "deployed", "--profile", "p"])
    assert isinstance(bounds.make_target(args), target.DeployedTarget)
    assert bounds.make_ctx(args, None).target == "deployed"


def test_shim_posts_for_refuses_a_deployed_target(monkeypatch):
    monkeypatch.setattr(bounds, "TARGET", deployed(FakeAws()))
    with pytest.raises(NotImplementedError, match="sqsd"):
        bounds.shim_posts_for("m-1")


def test_turn_kill_spec_builds_a_deployed_target_only_when_asked():
    parser = turn.build_parser()
    spec = turn.kill_spec(parser.parse_args(["--kill", "--target", "deployed", "--profile", "p"]))
    assert type(spec.deployed).__name__ == "DeployedTarget" and spec.deployed.profile == "p"
    assert turn.kill_spec(parser.parse_args(["--kill"])).deployed is None, "compose stays the default"


# ── signing in with a cookie file ──────────────────────────────────────────────────────


def test_a_cookie_file_signs_in_without_dev_login(tmp_path, monkeypatch):
    monkeypatch.delenv(turn.COOKIE_FILE_ENV, raising=False)
    seen: list[tuple[str, str | None]] = []
    transport = httpx.MockTransport(lambda r: seen.append((r.url.path, r.headers.get("cookie"))) or httpx.Response(200, json=[]))
    path = tmp_path / "wb_session"
    path.write_text(COOKIE + "\n", encoding="utf-8")
    with turn.signed_in_client("http://tier", transport=transport, cookie_file=str(path)) as client:
        client.get("/api/sessions")
    assert seen == [("/api/sessions", f"wb_session={COOKIE}")]
    path.write_text(f"wb_session={COOKIE}", encoding="utf-8")
    monkeypatch.setenv(turn.COOKIE_FILE_ENV, str(path))
    seen.clear()
    with turn.signed_in_client("http://tier", transport=transport) as client:
        client.get("/api/sessions")
    assert seen == [("/api/sessions", f"wb_session={COOKIE}")], "the env var names the file"


def test_a_cookie_file_with_two_values_is_refused(tmp_path):
    path = tmp_path / "wb_session"
    path.write_text("a b", encoding="utf-8")
    with pytest.raises(ValueError, match="no single"):
        turn.read_cookie_file(str(path))


def test_no_driver_takes_a_cookie_or_password_on_its_command_line():
    for parser in (turn.build_parser(), bounds.build_parser()):
        flags = [s for a in parser._actions for s in a.option_strings]
        assert not [f for f in flags if re.search(r"cookie|password|secret", f)], flags


# ── demo's deployed queries ────────────────────────────────────────────────────────────


def test_acceptance_queries_add_the_stand_in_and_the_first_receive_checks():
    labels = {label: sql for label, sql, _ in demo.acceptance_queries("t", "s", "p")}
    stand_in = next(sql for label, sql in labels.items() if "general-purpose" in label)
    assert "agent_type = 'general-purpose'" in stand_in
    first = next(sql for label, sql in labels.items() if "U5 (a)" in label)
    assert "receive_count = 1" in first and "interval '1800 seconds'" in first


def test_the_autonomous_arm_reads_the_turns_own_max_nudges(monkeypatch):
    monkeypatch.setattr(demo, "rows", lambda dsn, sql, params: [("40",)] if "max_nudges" in sql else [])
    assert demo.turn_max_nudges("dsn", "t") == "40"
    monkeypatch.setattr(demo, "rows", lambda dsn, sql, params: [])
    assert demo.turn_max_nudges("dsn", "t") is None


# ── the *-aws recipes ──────────────────────────────────────────────────────────────────

AWS_VARS = ["BASE=http://127.0.0.1:1837", "PG_DSN=host=rds.invalid.test hostaddr=127.0.0.1 port=15432 dbname=g user=u",
            "NODE_PG_DSN=postgresql://u@rds.invalid.test:15432/g", "BUCKET=genealogy-u13-data-x",
            "COOKIE_FILE=/work/wb_session", "RDS_CA=/work/ca.pem", "EMAIL=op@example.invalid",
            "PGPASSFILE=/work/pgpass", "CASE=stop_main"]


def make_n(recipe: str, *extra: str) -> subprocess.CompletedProcess:
    return subprocess.run(["make", "-n", "-s", recipe, *AWS_VARS, *extra], cwd=REPO, capture_output=True,
                          text=True, encoding="utf-8", check=False)


@pytest.mark.parametrize("recipe", ["proto-demo-aws", "proto-bounds-aws"])
def test_aws_recipes_point_the_store_at_real_s3_with_no_keys_and_no_block(recipe):
    proc = make_n(recipe)
    assert proc.returncode == 0, proc.stderr
    out = proc.stdout
    assert "--s3-endpoint 'https://s3.us-east-1.amazonaws.com'" in out
    assert "PROTO_S3_ENDPOINT='https://s3.us-east-1.amazonaws.com'" in out
    assert "PROTO_S3_BUCKET='genealogy-u13-data-x'" in out
    assert re.search(r"PROTO_S3_ACCESS_KEY= ", out) and re.search(r"PROTO_S3_SECRET_KEY= ", out)
    assert "PROTO_SESSION_COOKIE_FILE='/work/wb_session'" in out and "PGSSLMODE=verify-full" in out
    assert "PROTO_NODE_PG_DSN='postgresql://u@rds.invalid.test:15432/g'" in out
    assert "BLOCKED_TOOLS" not in out
    assert "env.sh" not in out and "compose" not in out.lower()


@pytest.mark.parametrize("bad", [
    "PG_DSN=host=x hostaddr=127.0.0.1 password=p",
    "PG_DSN=host=x sslmode=require",
    "NODE_PG_DSN=postgresql://u:p@x:15432/g",
    "COOKIE_FILE=",
])
def test_aws_recipes_refuse_a_password_in_a_dsn_and_a_missing_variable(bad):
    proc = make_n("proto-demo-aws", bad)
    assert proc.returncode != 0
    assert "is required" in proc.stderr or "password or sslmode" in proc.stderr, proc.stderr


def test_proto_bounds_aws_runs_bounds_on_the_deployed_target():
    out = make_n("proto-bounds-aws", "PROFILE=fts-int").stdout
    assert "proto/bounds.py --target deployed" in out and "--profile 'fts-int'" in out


# ── the deployed-only bounds cases ─────────────────────────────────────────────────────


class RecordingTarget:
    name = "deployed"

    def __init__(self, order: list[str]):
        self.order = order

    def run(self, tier: str, *commands: str, comment: str = "") -> str:
        self.order.extend(f"run {tier}: {c}" for c in commands)
        return ""

    def signal(self, tier: str, action: str) -> None:
        self.order.append(f"signal {tier} {action}")

    def events(self, tier: str) -> list[dict]:
        return []


def _case_stack(monkeypatch, order: list[str]):
    monkeypatch.setattr(bounds, "TARGET", RecordingTarget(order))
    monkeypatch.setattr(bounds, "fresh_session", lambda ctx, client, rep: setattr(rep, "session_id", "sess_1") or "sess_1")
    monkeypatch.setattr(bounds, "post", lambda ctx, client, rep, text: rep.turn_ids.append("t1") or {"turn_id": "t1"})
    monkeypatch.setattr(bounds, "reach", lambda ctx, rep, tid, subagent: ("row",))
    monkeypatch.setattr(bounds, "done", lambda *a, **k: True)
    monkeypatch.setattr(bounds, "snapshot", lambda ctx, s, t: bounds.TurnSnap(turn_id=t, row=(2, "now", "completed", 1.0)))
    monkeypatch.setattr(bounds.turn, "one", lambda dsn, sql, params: 1)


def _ctx():
    return bounds.Ctx(base="b", dsn="d", email="e", s3_endpoint="s", fixture="f", session=None, deadline_s=5.0,
                      kill_after_s=10.0, pause_s=1.0, cap_usd=35.0, price_output=15.0, target="deployed")


def test_keepalive_drop_arms_the_deadman_first_drops_both_ways_and_undrops_in_finally(monkeypatch):
    order: list[str] = []
    _case_stack(monkeypatch, order)

    def lock_poll(ctx, *a, **k):
        order.append("poll")
        raise RuntimeError("driver lost")

    monkeypatch.setattr(bounds, "wait_lock_gone", lock_poll)
    rep = bounds.Report(case="keepalive_drop")
    with pytest.raises(RuntimeError, match="driver lost"):
        bounds.case_keepalive_drop(_ctx(), None, rep)
    runs = [o for o in order if o.startswith("run worker:")]
    assert "systemd-run" in runs[0] and f"--on-active={bounds.DEADMAN_S}" in runs[0], "the dead-man is armed first"
    assert any("out tcp dport 5432 drop" in r for r in runs) and any("in tcp sport 5432 drop" in r for r in runs), runs
    assert order[-2:] == [f"run worker: {bounds.NFT_UNDROP[0]}", f"run worker: {bounds.NFT_UNDROP[1]}"], \
        "the drop is removed even when the case dies mid-poll"


def test_the_lock_poll_reads_the_attempt_lock_namespace():
    from proto import grants

    assert bounds.ATTEMPT_LOCK_NS == grants.ATTEMPT_LOCK_NS
    assert "l.locktype = 'advisory'" in bounds.ATTEMPT_LOCK_SQL and "l.classid = %s" in bounds.ATTEMPT_LOCK_SQL


def test_wait_lock_gone_reports_seconds_to_disappearance(monkeypatch):
    counts = iter([1, 1, 0])
    monkeypatch.setattr(bounds.turn, "one", lambda dsn, sql, params: next(counts))
    monkeypatch.setattr(bounds.time, "sleep", lambda s: None)
    assert bounds.wait_lock_gone(_ctx(), deadline_s=60, every_s=5) is not None


def test_sigterm_real_signals_term_over_the_target(monkeypatch):
    order: list[str] = []
    _case_stack(monkeypatch, order)
    monkeypatch.setattr(bounds, "worker_events", lambda: [{"ev": "shutdown", "answered": ["t1"]}])
    monkeypatch.setattr(bounds, "sdk_of", lambda ctx, s: "sdk")
    monkeypatch.setattr(bounds, "max_entry", lambda ctx, sdk: 1)
    rep = bounds.Report(case="sigterm_real")
    bounds.case_sigterm_real(_ctx(), None, rep)
    assert "signal worker term" in order
    assert ("sigterm_real: ev=shutdown names the turn", True, "") in rep.checks


def test_deployed_only_cases_refuse_compose():
    args = bounds.build_parser().parse_args(["--case", "keepalive_drop"])
    with pytest.raises(ValueError, match="--target deployed"):
        bounds.make_ctx(args, None)


def test_the_tls_probe_dsn_verifies_the_name_and_connects_to_the_forward():
    """dev/probe_tls_hostaddr.py's live run is the proof (PR body); this pins its DSN shape."""
    import importlib.util

    spec = importlib.util.spec_from_file_location("probe_tls_hostaddr", SERVER / "dev" / "probe_tls_hostaddr.py")
    probe = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(probe)
    dsn = probe.psycopg_dsn("rds.invalid.test", 15432, hostaddr="127.0.0.1", ca=Path("/ca.crt"))
    assert "host=rds.invalid.test hostaddr=127.0.0.1" in dsn and "sslmode=verify-full" in dsn
    assert "hostaddr" not in probe.psycopg_dsn("127.0.0.1", 15432, hostaddr=None, ca=Path("/ca.crt"))

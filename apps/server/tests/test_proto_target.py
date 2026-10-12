"""U13's compose-or-deployed seam (proto/target.py) and what the drivers send through it.

Pinned: compose's argv is today's; the deployed target reads CloudWatch, signals over SSM
and restores every setting it changed, even on an exception; a CloudWatch line's syslog
prefix no longer hides its event; a cookie file signs a driver in without dev-login; the
``*-aws`` recipes point the store at real S3 with no key pair and no tree-read block.
"""

from __future__ import annotations

import dataclasses
import json
import re
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any

import httpx
import psycopg
import pytest

SERVER = Path(__file__).resolve().parents[1]
REPO = SERVER.parents[1]
if str(SERVER) not in sys.path:
    sys.path.insert(0, str(SERVER))

from proto import bounds, demo, target, turn  # noqa: E402

FIXTURE = SERVER / "tests" / "fixtures" / "eb-cloudwatch" / "worker-web-stdout.txt"
COOKIE = "c0ffee-session-value"


SQSD = "aws:elasticbeanstalk:sqsd"


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
                {"Namespace": target.ENV_NS, "OptionName": k, "Value": v} for k, v in self.settings.items()]
                + [{"Namespace": SQSD, "OptionName": "ErrorVisibilityTimeout", "Value": "300"}]}]}
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


def test_settings_reads_one_namespace():
    t = deployed(FakeAws(settings={"ErrorVisibilityTimeout": "10"}))
    assert t.settings("worker") == {"ErrorVisibilityTimeout": "10"}, "the environment namespace by default"
    assert t.settings("worker", SQSD) == {"ErrorVisibilityTimeout": "300"}


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


@pytest.mark.parametrize("case", ["held_release", "held_after_stop"])
def test_the_held_cases_run_on_a_deployed_target(case):
    args = bounds.build_parser().parse_args(["--case", case, "--target", "deployed", "--profile", "p"])
    assert bounds.make_ctx(args, None).target == "deployed"


def _released(msgid: str = "m-B", turn_id: str = "t-B") -> str:
    return json.dumps({"ev": "released", "session_id": "s", "turn_id": turn_id, "message_id": msgid})


def _b_turn(turn_id: str = "t-B") -> str:
    return json.dumps({"ev": "turn", "turn_id": turn_id, "session_id": "s", "receive_count": 1, "status": 200})


def _shim_on(monkeypatch, lines: list[str]) -> FakeAws:
    fake = FakeAws(log_lines=[f"Oct 07 15:09:22 ip-10-0-0-1 web[1]: {ln}" for ln in lines])
    monkeypatch.setattr(bounds, "TARGET", deployed(fake))
    monkeypatch.setattr(bounds.smoke, "service_lines", lambda *a: pytest.fail("a deployed target has no shim"))
    return fake


def test_deployed_shim_posts_for_reads_the_workers_released_and_turn_lines(monkeypatch):
    fake = _shim_on(monkeypatch, [_released(), _b_turn()])
    [post] = bounds.shim_posts_for("m-B", timeout_s=0, every_s=0)
    assert post["msgid"] == "m-B" and post["turn_id"] == "t-B"
    assert any(fake.op(c) == ("logs", "filter-log-events") and bounds.TARGET.log_group("worker") in c
               for c in fake.calls), fake.calls


@pytest.mark.parametrize("lines", [
    [_released()],                                                     # released, never delivered
    [_b_turn()],                                                       # a turn, but nothing released it
    [_released(turn_id="t-other"), _b_turn()],                         # released another turn
    [_released(), json.dumps({"ev": "turn", "turn_id": "t-B", "status": 400, "error": "bad body"})],  # no receive
])
def test_deployed_shim_posts_for_finds_no_delivery(monkeypatch, lines):
    _shim_on(monkeypatch, lines)
    assert bounds.shim_posts_for("m-B", timeout_s=0, every_s=0) == []


def test_deployed_shim_posts_for_ignores_another_msgid(monkeypatch):
    _shim_on(monkeypatch, [_released(msgid="m-A"), _b_turn()])
    assert bounds.shim_posts_for("m-B", timeout_s=0, every_s=0) == []


def test_deployed_shim_posts_for_polls_longer_than_compose(monkeypatch):
    waits: list[tuple] = []
    monkeypatch.setattr(bounds, "TARGET", deployed(FakeAws()))
    monkeypatch.setattr(bounds.smoke, "wait_for", lambda pred, t, every: waits.append((t, every)))
    bounds.shim_posts_for("m-B")
    monkeypatch.setattr(bounds, "TARGET", bounds.compose_target())
    bounds.shim_posts_for("m-B")
    assert waits == [bounds.DEPLOYED_DELIVERY_S, (60, 1.0)]
    assert bounds.DEPLOYED_DELIVERY_S[0] >= 180


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

    def __init__(self, order: list[str], settings: dict[str, dict[str, str]] | None = None, run_out: str = "",
                 logs: dict[str, str] | None = None):
        self.order = order
        self._settings = settings or {}
        self.run_out = run_out
        self._logs = logs or {}

    def logs(self, tier: str, since_ms: int | None = None, until_ms: int | None = None) -> str:
        self.order.append(f"logs {tier}")
        return self._logs.get(tier, "")

    def run(self, tier: str, *commands: str, comment: str = "") -> str:
        self.order.extend(f"run {tier}: {c}" for c in commands)
        return self.run_out

    def settings(self, tier: str, namespace: str = target.ENV_NS) -> dict[str, str]:
        self.order.append(f"settings {tier}" + ("" if namespace == target.ENV_NS else f" {namespace}"))
        return dict(self._settings.get(tier if namespace == target.ENV_NS else (tier, namespace), {}))

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
    assert runs[0] == f"run worker: {bounds.NFT_INSTALL}", "nftables is installed first: AL2023 lacks it"
    assert "systemd-run" in runs[1] and f"--on-active={bounds.DEADMAN_S}" in runs[1], "the dead-man is armed before any drop"
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


def _sigterm_run(monkeypatch, *, handed_over: bool) -> tuple[bounds.Report, list[str]]:
    """sigterm_real where the first post is t1 and the held one t2; t1 closes by handover
    before the signal when ``handed_over``."""
    order: list[str] = []
    _case_stack(monkeypatch, order)
    ids = iter(["t1", "t2"])
    monkeypatch.setattr(bounds, "post", lambda ctx, client, rep, text: {"turn_id": next(ids)})
    monkeypatch.setattr(bounds, "HANDOVER_WAIT_S", 0.05)
    monkeypatch.setattr(bounds.turn, "one", lambda dsn, sql, params:
                        ("now" if handed_over and params == ("t1",) else None) if sql == bounds.COMPLETED_SQL else 1)
    monkeypatch.setattr(bounds, "worker_events", lambda: [{"ev": "shutdown", "answered": ["t2" if handed_over else "t1"]}])
    monkeypatch.setattr(bounds, "sdk_of", lambda ctx, s: "sdk")
    monkeypatch.setattr(bounds, "max_entry", lambda ctx, sdk: 1)
    rep = bounds.Report(case="sigterm_real")
    bounds.case_sigterm_real(_ctx(), None, rep)
    return rep, order


def test_sigterm_real_signals_the_held_turn_when_the_original_handed_over(monkeypatch):
    rep, order = _sigterm_run(monkeypatch, handed_over=True)
    assert rep.figures["kill_target"] == "held"
    assert "signal worker term" in order
    assert ("sigterm_real: ev=shutdown names the turn", True, "") in rep.checks


def test_sigterm_real_signals_the_original_turn_when_no_handover_came(monkeypatch):
    rep, order = _sigterm_run(monkeypatch, handed_over=False)
    assert rep.figures["kill_target"] == "original"
    assert ("sigterm_real: ev=shutdown names the turn", True, "") in rep.checks


def _dead_letter_run(monkeypatch, events: list[dict]) -> bounds.Report:
    order: list[str] = []
    _case_stack(monkeypatch, order)
    ids = iter(["t1", "t2"])
    monkeypatch.setattr(bounds, "post", lambda ctx, client, rep, text: {"turn_id": next(ids)})
    monkeypatch.setattr(bounds.turn, "db", lambda dsn, sql, params: [(True,)])
    monkeypatch.setattr(bounds, "snapshot", lambda ctx, s, t: bounds.TurnSnap(turn_id=t, row=(1, "now", "retries_exhausted", 1.0)))
    monkeypatch.setattr(bounds, "worker_events", lambda: events)
    rep = bounds.Report(case="dead_letter_real")
    bounds.case_dead_letter_real(_ctx(), None, rep)
    return rep


def _released_ok(rep: bounds.Report) -> bool:
    [ok] = [ok for n, ok, _ in rep.checks if n.startswith("dead_letter_real: its close released")]
    return ok


def test_dead_letter_real_counts_close_turns_ev_released_for_the_held_turn(monkeypatch):
    """The worker's own last-receive close logs ev=released naming the held turn, with no
    released_turn on the closing ev=turn (U13, 2026-10-08)."""
    events = [{"ev": "close", "turn_id": "t1", "outcome": "retries_exhausted"},
              {"ev": "released", "turn_id": "t2", "message_id": "m"}]
    assert _released_ok(_dead_letter_run(monkeypatch, events))


def test_dead_letter_real_fails_when_nothing_released_the_held_turn(monkeypatch):
    events = [{"ev": "close", "turn_id": "t1", "outcome": "retries_exhausted"},
              {"ev": "released", "turn_id": "t9", "message_id": "m"}]
    assert not _released_ok(_dead_letter_run(monkeypatch, events))


def _spill_run(monkeypatch, *, reads_after: int, rerun: int, outcome: str = "completed") -> tuple[bounds.Report, list[str]]:
    """spill_kill with the spilling call at id 7 and no read before the kill; ``reads_after``
    tool-results reads and ``rerun`` calls after it, closing ``outcome``."""
    order: list[str] = []
    _case_stack(monkeypatch, order)
    monkeypatch.setattr(bounds, "snapshot", lambda ctx, s, t: bounds.TurnSnap(turn_id=t, row=(2, "now", outcome, 1.0)))
    monkeypatch.setattr(bounds.turn, "db", lambda dsn, sql, params: [(7, 1200)] if sql == bounds.SPILL_CALL_SQL else [])

    def one(dsn, sql, params):
        killed = "signal worker kill" in order
        if sql == bounds.SPILL_READ_SQL:
            return reads_after if killed else 0
        if sql == bounds.RERUN_SQL:
            return rerun
        return 1

    monkeypatch.setattr(bounds.turn, "one", one)
    rep = bounds.Report(case="spill_kill")
    bounds.case_spill_kill(_ctx(), None, rep)
    return rep, order


def _spilled(rep: bounds.Report) -> bool:
    [ok] = [ok for n, ok, _ in rep.checks if n.startswith("spill_kill: the result spilled")]
    return ok


def test_spill_kill_is_void_when_nothing_read_a_tool_results_file(monkeypatch):
    """A failed upstream call stamps duration_ms too: the kill fires, but nothing ever spilled."""
    rep, order = _spill_run(monkeypatch, reads_after=0, rerun=0)
    assert "signal worker kill" in order
    assert _spilled(rep) is False
    assert rep.figures["tool_results_reads"] == 0 and rep.figures["rerun_calls"] == 0
    assert "neither re-ran nor read" in rep.findings[-1]


@pytest.mark.parametrize("rerun, said", [(0, "stranded spill"), (1, "re-ran collections_search")])
def test_spill_kill_counts_a_tool_results_read_and_records_rerun_vs_stranded(monkeypatch, rerun, said):
    rep, _order = _spill_run(monkeypatch, reads_after=1, rerun=rerun)
    assert _spilled(rep) is True
    assert rep.figures["tool_results_reads"] == 1 and rep.figures["reads_after_kill"] == 1
    assert rep.figures["rerun_calls"] == rerun and said in rep.findings[-1]


@pytest.mark.parametrize("rerun, ok", [(0, False), (1, True)])
def test_spill_kill_allows_a_nudged_no_progress_only_after_a_rerun(monkeypatch, rerun, ok):
    """Every deployed spill_kill session is project-less and nudged, so the allowance alone
    would pass a stranded spill; it holds only once the call was re-run (U13 review)."""
    monkeypatch.setattr(bounds, "events_until", lambda tid, lines: [])
    monkeypatch.setattr(bounds, "nudged_projectless", lambda *a: True)
    rep, _order = _spill_run(monkeypatch, reads_after=1, rerun=rerun, outcome=bounds.TERMINAL_NO_PROGRESS)
    [closed] = [c for n, c, _ in rep.checks if n.startswith("spill_kill: not closed no_progress")]
    assert closed is ok


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


# ── U13 PR8: the probe-case measurements (kill_hold, kill_refresh, idle_watch, concurrent_rss) ──

T0 = datetime(2026, 10, 8, 12, 0, 0, tzinfo=timezone.utc)
KILL_PROBES = {"worker": {"SQSD_VISIBILITY_TIMEOUT_S": "1500"},
               "tools": {"GENEALOGY_DEBUG_HOLD_BEFORE_COMMIT_MS": "20000"},
               "web": {"FS_GRANT_REFRESH_AGE_S": "0"}}


def _db(monkeypatch, answers: dict[str, Any]):
    """turn.db and turn.one by SQL: each answer is rows, or a callable of params (an iterator's
    next, for a sequence); any other SQL reads nothing."""
    def db(dsn, sql, params):
        got = answers.get(sql, [])
        return got(params) if callable(got) else got

    monkeypatch.setattr(bounds.turn, "db", db)
    monkeypatch.setattr(bounds.turn, "one", lambda dsn, sql, params: (db(dsn, sql, params) or [(None,)])[0][0])


def _seq(*values):
    it = iter(values)
    last: list = []

    def nxt(_params):
        try:
            last[:] = [next(it)]
        except StopIteration:
            pass
        return last[0]

    return nxt


def _failed(rep: bounds.Report) -> list[str]:
    return [n for n, ok, _ in rep.checks if not ok]


def _kill_hold(monkeypatch, *, duration=None, kill_at_s=2.0, killed_by_s=8.0, reclaim_s=310.0, dups_after=(), reauth=(),
               settings=KILL_PROBES, events=None) -> tuple[bounds.Report, list[str]]:
    order: list[str] = []
    _case_stack(monkeypatch, order)
    monkeypatch.setattr(bounds, "TARGET", RecordingTarget(order, settings))
    monkeypatch.setattr(bounds, "seeded_session", lambda ctx, rep: setattr(rep, "session_id", "sess_s") or "sess_s")
    killed_by = T0 + timedelta(seconds=killed_by_s)
    _db(monkeypatch, {
        bounds.PROJECT_SQL: [("proj",)],
        bounds.HOLD_ROW_SQL: [(7, T0)],
        bounds.PG_NOW_SQL: _seq([(T0 + timedelta(seconds=kill_at_s),)], [(killed_by,)]),
        bounds.DURATION_SQL: [(duration,)],
        bounds.AGENT_ROW_SQL: [(5, None)],
        bounds.RECLAIM_SQL: [(2, killed_by + timedelta(seconds=reclaim_s), None)],
        bounds.DUP_SOURCES_SQL: _seq([], list(dups_after)),
        bounds.SOURCES_SQL: [(3,)],
        bounds.USER_SEQ_SQL: [(1,)],
        bounds.SDK_SQL: [("sdk",)],
        bounds.MAX_ENTRY_SQL: _seq([(10,)], [(20,)]),
    })
    lines = events if events is not None else [
        {"ev": "turn", "turn_id": "t1", "status": 200, "receive_count": 2, "resumed": True, "list_subkeys": 2}]
    monkeypatch.setattr(bounds, "worker_events", lambda: lines)
    monkeypatch.setattr(bounds, "EVENT_LAG_S", 0)
    monkeypatch.setattr(bounds.time, "sleep", lambda s: None)
    monkeypatch.setattr(bounds.turn, "reauth_hits", lambda dsn, sid, since: list(reauth))
    monkeypatch.setattr(bounds.turn, "reauth_entry_hits", lambda dsn, sdk, tid: [])
    monkeypatch.setattr(bounds, "post", lambda ctx, client, rep, text: (order.append("post"), rep.turn_ids.append("t1"),
                                                                       {"turn_id": "t1"})[-1])
    rep = bounds.Report(case="kill_hold")
    bounds.case_kill_hold(_ctx(), None, rep)
    return rep, order


def test_kill_hold_kills_inside_the_hold_and_records_the_timer(monkeypatch):
    rep, order = _kill_hold(monkeypatch)
    assert not _failed(rep), rep.checks
    assert order.index("signal worker kill") < order.index("signal worker start")
    assert rep.figures["kill_landed_by_s_into_hold"] == 8.0 and rep.figures["kill_signal_s"] == 6.0
    assert rep.figures["kill_sent_s_into_hold"] == 2.0


def test_kill_hold_trusts_an_unstamped_call_over_a_slow_ssm_return(monkeypatch):
    """SSM's poll can return well after the kill ran: sent inside the hold and still no
    duration_ms is inside, however late the signal call came back."""
    rep, _order = _kill_hold(monkeypatch, kill_at_s=4.0, killed_by_s=24.0)
    assert not _failed(rep), rep.checks
    assert rep.figures["reclaimed_after_kill_s"] == 310.0 and rep.figures["redelivered_by"] == "ErrorVisibilityTimeout"


def test_kill_hold_names_visibility_timeout_for_a_late_reclaim(monkeypatch):
    rep, _order = _kill_hold(monkeypatch, reclaim_s=1504.0)
    assert rep.figures["redelivered_by"] == "VisibilityTimeout"


@pytest.mark.parametrize("over, failing", [
    ({"duration": 20012}, "kill_hold: the kill landed inside the hold (else void)"),
    ({"kill_at_s": 20.5, "killed_by_s": 26.0}, "kill_hold: the kill landed inside the hold (else void)"),
    ({"dups_after": [("ark:/1", 2)]}, "kill_hold: research.json holds each source once (no duplicate the kill added)"),
    ({"reauth": ["Call the login tool."]}, "kill_hold: no FamilySearch call got the reconnect instruction (else void)"),
    ({"events": [{"ev": "turn", "turn_id": "t1", "status": 200, "receive_count": 2, "resumed": False}]},
     "kill_hold: the redelivery's ev=turn has resumed true and list_subkeys >= 1"),
])
def test_kill_hold_voids_or_fails_each_way(monkeypatch, over, failing):
    rep, _order = _kill_hold(monkeypatch, **over)
    assert _failed(rep) == [failing], rep.checks


def test_kill_hold_posts_nothing_without_its_probes(monkeypatch):
    rep, order = _kill_hold(monkeypatch, settings={"worker": {"SQSD_VISIBILITY_TIMEOUT_S": "36300"}})
    assert "post" not in order and not any(o.startswith("signal") for o in order)
    assert _failed(rep) == ["kill_hold: probe kill_window in effect (else void)",
                            "kill_hold: probe debug_hold in effect (else void)"]


def _kill_refresh(monkeypatch, *, refreshed=True, reauth=(), refresh_raises=False, order: list[str] | None = None):
    order = [] if order is None else order
    _case_stack(monkeypatch, order)
    monkeypatch.setattr(bounds, "TARGET", RecordingTarget(order, KILL_PROBES))
    _db(monkeypatch, {bounds.PROJECT_SQL: [("proj",)], bounds.SDK_SQL: [("sdk",)],
                      bounds.MAX_ENTRY_SQL: _seq([(10,)], [(20,)]), bounds.turn.GRANT_START_SQL: [(T0,)],
                      bounds.USER_SEQ_SQL: [(1,)]})

    def refresh(dsn, project_id, before):
        order.append(f"wait refresh {project_id} {before == T0}")
        if refresh_raises:
            raise RuntimeError("postgres gone")
        return refreshed

    monkeypatch.setattr(bounds.turn, "wait_grant_refresh", refresh)
    monkeypatch.setattr(bounds.turn, "reauth_hits", lambda dsn, sid, since: list(reauth))
    monkeypatch.setattr(bounds.turn, "reauth_entry_hits", lambda dsn, sdk, tid: [])
    rep = bounds.Report(case="kill_refresh")
    bounds.case_kill_refresh(_ctx(), None, rep)
    return rep, order


def test_kill_refresh_waits_for_the_refresh_while_the_worker_is_down(monkeypatch):
    rep, order = _kill_refresh(monkeypatch)
    assert not _failed(rep), rep.checks
    assert order[-3:] == ["signal worker kill", "wait refresh proj True", "signal worker start"]
    assert rep.figures["reauth_hits"] == 0 and rep.figures["receive_count"] == 2


@pytest.mark.parametrize("over, failing", [
    ({"refreshed": False}, "kill_refresh: grant refreshed between attempts"),
    ({"reauth": ["Reconnect FamilySearch"]}, "kill_refresh: reauth_hits=0 since the user_msg"),
])
def test_kill_refresh_fails_without_a_refresh_or_on_a_reauth(monkeypatch, over, failing):
    rep, _order = _kill_refresh(monkeypatch, **over)
    assert _failed(rep) == [failing], rep.checks


def test_kill_refresh_starts_the_worker_whatever_happens(monkeypatch):
    order: list[str] = []
    with pytest.raises(RuntimeError, match="postgres gone"):
        _kill_refresh(monkeypatch, refresh_raises=True, order=order)
    assert order[-1] == "signal worker start", order


def _idle(monkeypatch, polls: list[tuple], *, events=(), setting="60000", logs=None):
    """``polls``: per sample ``(receive_count, completed, lock rows, turn rows)``."""
    order: list[str] = []
    _case_stack(monkeypatch, order)
    monkeypatch.setattr(bounds, "TARGET", RecordingTarget(order, logs=logs))
    rc = _seq(*[[(p[0], T0, T0 if p[1] else None)] for p in polls])
    lock = _seq(*[p[2] for p in polls])
    tconn = _seq(*[p[3] for p in polls])
    _db(monkeypatch, {bounds.IDLE_SETTING_SQL: [(setting,)], bounds.RECLAIM_SQL: rc,
                      bounds.LOCK_BACKEND_SQL: lock, bounds.TURN_BACKEND_SQL: tconn})
    monkeypatch.setattr(bounds.time, "sleep", lambda s: None)
    reads = iter([[]])  # the first read is CloudWatch behind: the lines arrive on the second
    monkeypatch.setattr(bounds, "worker_events", lambda: next(reads, [*events, {"ev": "turn", "turn_id": "t1"}]))
    monkeypatch.setattr(bounds, "press", lambda ctx, client, rep: order.append("press") or 0.0)
    monkeypatch.setattr(bounds, "post", lambda ctx, client, rep, text: (order.append(text[:20]), rep.turn_ids.append("t1"),
                                                                       {"turn_id": "t1"})[-1])
    rep = bounds.Report(case="idle_watch")
    bounds.case_idle_watch(_ctx(), None, rep)
    return rep, order


LOCK_30 = [(101, 31.0, "idle", 30.0)]
LOCK_70 = [(101, 71.0, "idle", 70.0)]
TURN_ON = [(202, 70.0, "idle", 2.0)]


def test_idle_watch_passes_a_lock_that_outlived_a_minute_idle(monkeypatch):
    rep, order = _idle(monkeypatch, [(1, False, LOCK_30, TURN_ON), (1, False, LOCK_70, TURN_ON), (1, True, [], [])])
    assert not _failed(rep), rep.checks
    assert "press" not in order and any(o.startswith("Use place_search") for o in order)
    assert rep.figures["lock_pids"] == [101] and rep.figures["lock_max_idle_s"] == 70.0
    assert "never vanished" in rep.findings[0]
    assert rep.findings[1:] == ["web tier: 0 log line(s) naming the idle-session timeout",
                                "tools tier: 0 log line(s) naming the idle-session timeout"]


def test_idle_watch_records_a_cut_turn_connection_and_stops_the_redelivery(monkeypatch):
    rep, order = _idle(monkeypatch, [(1, False, LOCK_30, TURN_ON), (1, False, LOCK_70, []), (2, False, [], [])],
                       events=[{"ev": "turn", "turn_id": "t1", "status": 500, "error": "OperationalError: x"}])
    assert not _failed(rep), rep.checks
    assert "press" in order, "a turn still running at the end is Stopped"
    assert rep.figures["final_receive_count"] == 2 and rep.figures["turn_backend_gone_at_s"] is not None
    assert "vanished at" in rep.findings[0] and "OperationalError" in rep.findings[0]


def test_idle_watch_reads_a_backend_gone_at_the_close_as_the_close(monkeypatch):
    rep, _order = _idle(monkeypatch, [(1, False, LOCK_70, TURN_ON), (1, False, LOCK_70, []), (1, True, [], [])])
    assert rep.figures["turn_backend_gone_at_s"] is None and "never vanished" in rep.findings[0]


def test_idle_watch_records_a_web_or_tools_tier_cut(monkeypatch):
    cut = "FATAL:  terminating connection due to idle-session timeout"
    rep, order = _idle(monkeypatch, [(1, False, LOCK_70, TURN_ON), (1, True, [], [])], logs={"tools": f"ok\n{cut}\n"})
    assert "logs web" in order and "logs tools" in order
    assert rep.findings[1].startswith("web tier: 0") and rep.findings[2].startswith("tools tier: 1") and cut in rep.findings[2]


def test_idle_watch_reads_hidden_backend_columns_as_missing(monkeypatch):
    """A role without pg_read_all_stats sees another role's backend_start and state_change
    as NULL: the run voids on a missing age instead of crashing."""
    rep, _order = _idle(monkeypatch, [(1, False, [(101, None, None, None)], TURN_ON), (1, True, [], [])])
    assert rep.figures["lock_max_age_s"] is None
    assert "idle_watch: attempt 1's lock backend lived past 60 s (else void)" in _failed(rep)


@pytest.mark.parametrize("polls, events, failing", [
    ([(1, False, LOCK_30, TURN_ON), (1, True, [], [])], (),
     ["idle_watch: attempt 1's lock backend lived past 60 s (else void)",
      "idle_watch: the lock backend outlived 60 s idle, one pid throughout attempt 1"]),
    ([(1, False, LOCK_30, TURN_ON), (1, False, [(102, 71.0, "idle", 70.0)], TURN_ON), (1, True, [], [])], (),
     ["idle_watch: the lock backend outlived 60 s idle, one pid throughout attempt 1"]),
    ([(1, False, LOCK_70, TURN_ON), (1, True, [], [])], ({"ev": "grant_lock_lost", "turn_id": "t1"},),
     ["idle_watch: no ev=grant_lock_lost"]),
])
def test_idle_watch_voids_a_short_attempt_and_fails_a_lost_lock(monkeypatch, polls, events, failing):
    rep, _order = _idle(monkeypatch, polls, events=events)
    assert _failed(rep) == failing, rep.checks


def test_idle_watch_posts_nothing_without_the_rds_parameter(monkeypatch):
    rep, order = _idle(monkeypatch, [(1, True, [], [])], setting="0")
    assert order == [] and _failed(rep) == ["idle_watch: probe idle_session_60s in effect (else void)"]


RSS_OUT = """cgroup_bytes=1073741824
avail_kb=4194304
tmp_used_mb=12
 2048 sqsd
524288 node
 1024 python3
"""


def test_parse_rss_reads_every_figure_and_tolerates_a_missing_one():
    got = bounds.parse_rss(RSS_OUT)
    assert got == {"total_rss_mb": 515.0, "top_mb": 512.0, "top_comm": "node", "cgroup_mb": 1024.0,
                   "avail_mb": 4096.0, "tmp_used_mb": 12}
    bare = bounds.parse_rss("cgroup_bytes=[not set]\n")
    assert bare["cgroup_mb"] is None and bare["total_rss_mb"] == 0 and bare["top_mb"] is None


def _rss(monkeypatch, claims: list[list[tuple]]):
    """``claims``: per sample, each turn's ``(claimed, completed)``."""
    order: list[str] = []
    _case_stack(monkeypatch, order)
    monkeypatch.setattr(bounds, "TARGET", RecordingTarget(order, run_out=RSS_OUT))
    sessions = iter(["sess_1", "sess_2"])
    turns = iter(["t1", "t2"])
    monkeypatch.setattr(bounds, "fresh_session", lambda ctx, client, rep: setattr(rep, "session_id", next(sessions))
                        or rep.session_id)
    monkeypatch.setattr(bounds, "post", lambda ctx, client, rep, text: rep.turn_ids.append(next(turns))
                        or {"turn_id": rep.turn_ids[-1]})
    rows = iter([r for sample in claims for r in sample])
    _db(monkeypatch, {bounds.RECLAIM_SQL: lambda p: (lambda c: [(1, T0 if c[0] else None, T0 if c[1] else None)])(next(rows))})
    monkeypatch.setattr(bounds.time, "sleep", lambda s: None)
    monkeypatch.setattr(bounds, "done", lambda ctx, client, rep, tid, **k: order.append(f"done {rep.session_id} {tid}") or True)
    monkeypatch.setattr(bounds, "settle", lambda ctx, client, sid: order.append(f"settle {sid}") or ([], []))
    rep = bounds.Report(case="concurrent_rss")
    bounds.case_concurrent_rss(_ctx(), None, rep)
    return rep, order


def test_concurrent_rss_samples_until_both_close_and_records_the_peaks(monkeypatch):
    rep, order = _rss(monkeypatch, [[(True, False), (True, False)], [(True, True), (True, True)]])
    assert not _failed(rep), rep.checks
    assert sum(1 for o in order if o == f"run worker: {bounds.RSS_COMMANDS[-1]}") == 2
    assert rep.figures["peak_total_rss_mb"] == 515.0 and rep.figures["peak_process"] == "node"
    assert rep.figures["peak_cgroup_mb"] == 1024.0 and rep.figures["min_avail_mb"] == 4096.0
    assert ["done sess_1 t1", "done sess_2 t2", "settle sess_1"] == [o for o in order if o.startswith(("done", "settle"))]


def test_concurrent_rss_is_void_when_the_turns_ran_one_after_the_other(monkeypatch):
    rep, _order = _rss(monkeypatch, [[(True, False), (False, False)], [(True, True), (True, False)],
                                     [(True, True), (True, True)]])
    assert _failed(rep) == ["concurrent_rss: both turns ran at once (else void)"]


UIDS = {name: 1001 + i for i, name in enumerate(bounds.TURN_USERS_ALL)}
HOST = {"instance_id": "i-0abc", "instance_type": "t3.xlarge", "nproc": "4", "mem_total_kb": "16384000",
        "uptime": "5000.5", "control_group": "/system.slice/web.service", "cpu_stat_readable": "1"}


def host_out(**over: str) -> str:
    return "".join(f"{k}={v}\n" for k, v in {**HOST, **over}.items()) + "".join(f"uid_{n}={u}\n" for n, u in UIDS.items())


def cpu_out(at: float, *, usage: bool = True, end: bool = True) -> str:
    """A CPU_COMMANDS sample ``at`` seconds in: web.service at 2 cores, 1% steal on 4 CPUs, the
    first two slot users' node at a fixed RSS gaining CPU."""
    lines = [f"cgstat_usage_usec={int(at * 2_000_000)}", "cgstat_user_usec=1", "cgstat_nr_periods=0"] if usage else []
    lines += [f"epoch={1760000000 + at:.6f}", f"uptime={1000 + at:.2f}", f"loadavg={1.5 + at / 1000:.2f} 1.2 0.9 3/210 4242",
              f"hoststat=cpu {int(at * 150)} 0 {int(at * 50)} {int(at * 196)} 0 0 0 {int(at * 4)} 0 0",
              "proc=  100     0  2048     5 sqsd",
              f"proc=  200  {UIDS['genealogy-turn-0']} 524288 {int(at / 2)} node",
              f"proc=  201  {UIDS['genealogy-turn-1']} 262144 {int(at / 4)} claude code"]
    return "\n".join(lines + (["cpu_end=1"] if end else [])) + "\n"


def start_line(n: int = 8) -> dict:
    return {"ev": "start", "turn_users": list(bounds.TURN_USERS_ALL[:n])}


def _heavy(monkeypatch, *, n: int = 2, in_window: int = 3, claim_at=None, close_at=None, redeliver_at=None,
           projects=None, deadline_s: float = 30.0, ssm_fails: int = 0, host_fails: int = 0, settings=None,
           events=None, host: dict | None = None, credit: str = "unlimited", idle_setting: str = "0",
           rate_limited=(), reauth=(), cpu_usage: bool = True, truncate_at=(), rss_cut_at=(), db_fails_at=(),
           window_fails: int = 0, **ctx_over):
    """concurrent_rss_heavy on a fake clock (sleep advances it) with ``n`` sessions: turn i is
    claimed at ``claim_at[i]``, closes at ``close_at[i]`` (None: only a Stop closes it) and is
    redelivered at ``redeliver_at[i]``. ``deadline_s`` sits far under HEAVY_WINDOW_S, so a
    window it cut would show. The target answers HOST_COMMANDS with host facts and a sample
    (CPU_COMMANDS + RSS_COMMANDS + RSS_END) with ``cpu_out`` + RSS_OUT + ``rss_end=1``;
    ``ssm_fails`` / ``host_fails`` fail that many of each, ``truncate_at`` / ``rss_cut_at`` drop
    the CPU or RSS end marker at those times, ``db_fails_at`` fails both per-pass queries, and
    ``window_fails`` fails the first reads of the window's subagent count."""
    claim_at = claim_at or (0.0,) * n
    close_at = close_at or (None,) * n
    redeliver_at = redeliver_at or (None,) * n
    projects = projects or tuple(f"proj_{i}" for i in range(1, n + 1))
    if settings is None:
        settings = {"worker": {"WORKER_TURN_USERS": " ".join(bounds.TURN_USERS_ALL[:n])}} if n > 2 else {}
    order: list[str] = []
    _case_stack(monkeypatch, order)
    target_ = RecordingTarget(order, settings)
    clock = [0.0]
    fails = {"sample": ssm_fails, "host": host_fails}

    def run(tier, *commands, comment=""):
        kind = "host" if commands == bounds.HOST_COMMANDS else "sample" if commands[0] == bounds.CPU_COMMANDS[0] else None
        if kind and fails[kind] > 0:
            fails[kind] -= 1
            raise subprocess.CalledProcessError(254, ["aws", "ssm", "send-command"])
        order.extend(f"run {tier}: {c}" for c in commands)
        if kind == "host":
            return host_out(**(host or {}))
        return (cpu_out(clock[0], usage=cpu_usage, end=clock[0] not in truncate_at) + RSS_OUT
                + ("" if clock[0] in rss_cut_at else "rss_end=1\n"))

    target_.run = run
    target_.aws = lambda *a: order.append(f"aws {' '.join(a)}") or {
        "InstanceCreditSpecifications": [{"InstanceId": a[-1], "CpuCredits": credit}]}
    monkeypatch.setattr(bounds, "TARGET", target_)
    monkeypatch.setattr(bounds.time, "monotonic", lambda: clock[0])
    monkeypatch.setattr(bounds.time, "sleep", lambda s: clock.__setitem__(0, clock[0] + max(s, 0.01)))
    seeds = iter([(f"sess_{i}", projects[i - 1], {"researcher_question": "Who was Q's father?"}) for i in range(1, n + 1)])
    monkeypatch.setattr(bounds.demo, "seed_session", lambda args: (lambda s: order.append(f"seed {s[0]}") or s)(next(seeds)))
    turns = iter([f"t{i}" for i in range(1, n + 1)])
    monkeypatch.setattr(bounds, "post", lambda ctx, client, rep, text: order.append(f"post {rep.session_id} {text}")
                        or rep.turn_ids.append(next(turns)) or {"turn_id": rep.turn_ids[-1]})
    stopped: set[int] = set()

    def blip():
        if clock[0] in db_fails_at:
            raise psycopg.OperationalError("connection to RDS lost")

    def reclaim(params):
        blip()
        order.append(f"reclaim-any {len(params[0])}")
        rows = []
        for tid in params[0]:
            i = int(tid[1:]) - 1
            closed = i in stopped or (close_at[i] is not None and clock[0] >= close_at[i])
            rc = 2 if redeliver_at[i] is not None and clock[0] >= redeliver_at[i] else 1
            rows.append((tid, rc, T0 if clock[0] >= claim_at[i] else None, T0 if closed else None))
        return rows

    def press(ctx, client, rep):
        order.append(f"stop {rep.session_id} at {clock[0]:g}")
        stopped.add(int(rep.session_id.split("_")[1]) - 1)
        return clock[0]

    window_params: list[tuple] = []
    _db(monkeypatch, {bounds.RECLAIM_ANY_SQL: reclaim,
                      bounds.RECLAIM_SQL: lambda p: pytest.fail("one ANY query per pass, not one per turn"),
                      bounds.PG_NOW_SQL: lambda p: blip() or [(T0 + timedelta(seconds=clock[0]),)],
                      bounds.SUBAGENT_ROWS_SQL: [(in_window + 2,)],
                      bounds.WINDOW_SUBAGENT_SQL: lambda p: window_params.append(p) or (
                          [(in_window,)] if len(window_params) > window_fails
                          else (_ for _ in ()).throw(psycopg.OperationalError("connection to RDS lost"))),
                      bounds.PG_ACTIVITY_SQL: lambda p: blip() or [(False, 12), (True, n)],
                      bounds.RATE_LIMIT_SQL: list(rate_limited),
                      bounds.IDLE_SETTING_SQL: [(idle_setting,)],
                      bounds.GRANT_AGE_SQL: [(Decimal("90000.4"), Decimal("3600"), Decimal("600"), False)],
                      bounds.USER_SEQ_SQL: [(1,)], bounds.SDK_SQL: [("sdk",)]})
    monkeypatch.setattr(bounds.turn, "reauth_hits", lambda dsn, sid, since: list(reauth) if sid == "sess_1" else [])
    monkeypatch.setattr(bounds.turn, "reauth_entry_hits", lambda dsn, sdk, tid: [])
    lines = events if events is not None else [start_line()]
    monkeypatch.setattr(bounds, "worker_events", lambda: list(lines))
    monkeypatch.setattr(bounds, "press", press)
    monkeypatch.setattr(bounds, "done", lambda ctx, client, rep, tid, since=None, label="", **k:
                        order.append(f"done {rep.session_id} {tid} since={since} label={label}") or True)
    monkeypatch.setattr(bounds, "settle", lambda ctx, client, sid: order.append(f"settle {sid}") or ([], []))
    rep = bounds.Report(case="concurrent_rss_heavy")
    ctx = dataclasses.replace(_ctx(), deadline_s=deadline_s, sessions=n, **ctx_over)
    bounds.case_concurrent_rss_heavy(ctx, None, rep)
    return rep, order, window_params


def _stops(order: list[str]) -> list[str]:
    return [o for o in order if o.startswith("stop")]


def _dones(order: list[str]) -> list[str]:
    return [o.split(" label=")[0] for o in order if o.startswith(("done", "settle"))]


def _billed(order: list[str]) -> bool:
    return any(o.startswith(("seed", "post")) for o in order)


def test_concurrent_rss_heavy_stops_both_at_the_window_end_and_records_the_load(monkeypatch):
    rep, order, window_params = _heavy(monkeypatch)
    assert not _failed(rep), rep.checks
    posts = [o for o in order if o.startswith("post")]
    assert posts == ["post sess_1 /research --autonomous Who was Q's father?",
                     "post sess_2 /research --autonomous Who was Q's father?"]
    # A 30 s --deadline-s does not cut the window short; sampling runs on until both close.
    assert _stops(order) == ["stop sess_1 at 600", "stop sess_2 at 600"]
    assert rep.figures["window_s"] == bounds.HEAVY_WINDOW_S and rep.figures["stopped"] == ["sess_1", "sess_2"]
    assert rep.figures["subagent_rows"] == 5 and rep.figures["subagent_rows_in_window"] == 3
    assert window_params == [(["t1", "t2"], T0, T0 + timedelta(seconds=600))]
    assert rep.figures["peak_total_rss_mb"] == 515.0 and rep.figures["rss_samples"] == 62
    assert ["done sess_1 t1 since=600.0", "done sess_2 t2 since=600.0", "settle sess_1"] == _dones(order)
    assert rep.session_id == "sess_2", "run_case settles the second session"
    # The window's CPU: passes 0..60 (61 samples), 2 cores for 600 s, 1% steal.
    assert rep.figures["cpu_samples"] == 61 and rep.figures["cpu_core_s"] == 1200.0
    assert rep.figures["cpu_cores_avg"] == 2.0 and rep.figures["cpu_cores_peak"] == 2.0
    assert rep.figures["host_steal_pct"] == 1.0 and rep.figures["host_loadavg_1_peak"] == 2.1
    assert rep.figures["turn_user_peak_rss_mb"] == {"genealogy-turn-0": 512.0, "genealogy-turn-1": 256.0}
    assert rep.figures["turn_user_cpu_s"] == {"genealogy-turn-0": 300, "genealogy-turn-1": 150}
    assert rep.figures["window_from"] == "2026-10-08T12:00:00Z" and rep.figures["window_to"] == "2026-10-08T12:10:00Z"
    line = "rehearse.py cpu --worker-instance i-0abc --start 2026-10-08T12:00:00Z --end 2026-10-08T12:10:00Z --work-dir <dir>"
    assert rep.figures["cpu_line"] == line and any(line in f for f in rep.findings)
    assert rep.figures["credit_mode"] == "unlimited" and rep.figures["instance_type"] == "t3.xlarge"
    assert rep.figures["grant_age_s"] == 90000 and rep.figures["grant_refresh_refused"] is False


def test_concurrent_rss_heavy_stops_only_the_turn_still_open(monkeypatch):
    # Rewritten (U18): a turn closing inside the window voids the run, and the other is
    # Stopped at that sample, not billed on to the window's end.
    rep, order, _ = _heavy(monkeypatch, close_at=(300.0, None))
    assert _stops(order) == ["stop sess_2 at 300"]
    assert rep.figures["stopped"] == ["sess_2"] and rep.figures["window_s"] == 300.0
    assert _failed(rep) == ["concurrent_rss_heavy: every turn open at every sample from window open to due (else void)"]
    assert "done sess_1 t1 since=None" in _dones(order)


@pytest.mark.parametrize(("over", "failing"), [
    ({"in_window": 0}, "concurrent_rss_heavy: a subagent tool call ran inside the window (else void)"),
    ({"projects": ("proj_1", "proj_1")}, "concurrent_rss_heavy: 2 projects seeded"),
])
def test_concurrent_rss_heavy_voids_each_way(monkeypatch, over, failing):
    rep, _order, _ = _heavy(monkeypatch, **over)
    assert _failed(rep) == [failing]


def test_concurrent_rss_heavy_stops_at_once_when_the_turns_never_ran_together(monkeypatch):
    # The first closed before the second was claimed: void already, so the second is not
    # billed a ten-minute window. No window opened, so no window-dependent check is emitted.
    rep, order, _ = _heavy(monkeypatch, claim_at=(0.0, 20.0), close_at=(10.0, None))
    assert _stops(order) == ["stop sess_2 at 20"]
    assert rep.figures["window_s"] is None and rep.figures["subagent_rows_in_window"] == 0
    assert _failed(rep) == ["concurrent_rss_heavy: all 2 turn(s) ran at once (else void)"]
    assert not any("window" in n or "CPU sampled" in n for n, _ok, _d in rep.checks if "preflight" not in n), rep.checks


def test_concurrent_rss_heavy_rides_out_a_failed_ssm_sample(monkeypatch):
    rep, order, _ = _heavy(monkeypatch, ssm_fails=2)
    assert not _failed(rep), rep.checks
    assert rep.figures["rss_sample_errors"] == 2 and rep.figures["rss_samples"] == 60
    assert _stops(order) == ["stop sess_1 at 600", "stop sess_2 at 600"]
    assert any("2 sample(s) lost" in f for f in rep.findings)


def test_concurrent_rss_heavy_rides_out_one_failed_host_facts_call(monkeypatch):
    rep, order, _ = _heavy(monkeypatch, host_fails=1)
    assert not _failed(rep), rep.checks
    assert rep.figures["rss_sample_errors"] == 0, "a lost host-facts call is not a sample error"
    assert _stops(order) == ["stop sess_1 at 600", "stop sess_2 at 600"]


def test_concurrent_rss_heavy_refuses_when_host_facts_fail_twice(monkeypatch):
    rep, order, _ = _heavy(monkeypatch, host_fails=2)
    assert _failed(rep) == ["concurrent_rss_heavy: preflight: host facts read over SSM (else refused)"]
    assert not _billed(order)


def test_concurrent_rss_heavy_runs_n_sessions(monkeypatch):
    rep, order, window_params = _heavy(monkeypatch, n=4)
    assert not _failed(rep), rep.checks
    billed = [o.split(" ")[0] for o in order if o.startswith(("seed", "post"))]
    assert billed == ["seed"] * 4 + ["post"] * 4, "every seed before any post"
    samples = sum(1 for o in order if o == f"run worker: {bounds.RSS_COMMANDS[-1]}")
    assert [o for o in order if o.startswith("reclaim-any")] == ["reclaim-any 4"] * samples, "one ANY query per pass"
    assert _stops(order) == [f"stop sess_{i} at 600" for i in range(1, 5)]
    assert [o.split(" label=")[1] for o in order if o.startswith("done")] == [f"session_{i}" for i in range(1, 5)]
    assert ("concurrent_rss_heavy: 4 projects seeded", True, "projects=['proj_1', 'proj_2', 'proj_3', 'proj_4']") in rep.checks
    assert window_params == [(["t1", "t2", "t3", "t4"], T0, T0 + timedelta(seconds=600))]
    assert rep.figures["pg_conns_peak"] == 16 and rep.figures["pg_turn_conns_peak"] == 4
    assert [o for o in order if o.startswith("settle")] == ["settle sess_1", "settle sess_2", "settle sess_3"]


def test_concurrent_rss_heavy_honours_the_window(monkeypatch):
    rep, order, _ = _heavy(monkeypatch, window_s=1800.0, deadline_s=30.0)
    assert not _failed(rep), rep.checks
    assert _stops(order) == ["stop sess_1 at 1800", "stop sess_2 at 1800"] and rep.figures["window_s"] == 1800.0


def test_concurrent_rss_heavy_zero_sessions_samples_the_idle_worker(monkeypatch):
    rep, order, window_params = _heavy(monkeypatch, n=0, window_s=900.0)
    assert not _failed(rep), rep.checks
    assert not _billed(order) and not _stops(order) and window_params == []
    assert rep.figures["window_s"] == 900.0 and rep.figures["rss_samples"] == 91 and rep.figures["cpu_samples"] == 91
    assert rep.figures["cpu_core_s"] == 1800.0 and rep.figures["cpu_cores_avg"] == 2.0
    assert rep.figures["cpu_line"].startswith("rehearse.py cpu --worker-instance i-0abc --start 2026-10-08T12:00:00Z ")
    names = [n for n, _ok, _d in rep.checks]
    assert not any("ran at once" in n or "subagent" in n or "projects seeded" in n for n in names), names
    assert "concurrent_rss_heavy: CPU sampled, >= 2 in-window samples with usage_usec (else void)" in names
    assert rep.session_id is None, "nothing for run_case to settle"


def test_concurrent_rss_heavy_zero_sessions_refuses_a_fresh_instance(monkeypatch):
    rep, order, _ = _heavy(monkeypatch, n=0, host={"uptime": "300.0"})
    assert _failed(rep) == ["concurrent_rss_heavy: preflight: the worker is >= 600 s past boot (else refused)"]
    assert not any(o.startswith("run worker: echo cpu_end") for o in order), "refused before any sample"


def test_concurrent_rss_heavy_stops_all_at_once_when_one_closes_early(monkeypatch):
    rep, order, _ = _heavy(monkeypatch, n=4, close_at=(None, 300.0, None, None))
    assert _stops(order) == ["stop sess_1 at 300", "stop sess_3 at 300", "stop sess_4 at 300"]
    assert _failed(rep) == ["concurrent_rss_heavy: every turn open at every sample from window open to due (else void)"]


def test_concurrent_rss_heavy_voids_a_redelivered_turn(monkeypatch):
    rep, order, _ = _heavy(monkeypatch, redeliver_at=(None, 200.0))
    assert _stops(order) == ["stop sess_1 at 200", "stop sess_2 at 200"]
    assert _failed(rep) == ["concurrent_rss_heavy: every turn received once (else void)"]
    assert rep.figures["max_receive_count"] == 2


def test_concurrent_rss_heavy_refuses_when_the_worker_has_fewer_slots_than_sessions(monkeypatch):
    rep, order, _ = _heavy(monkeypatch, n=4, settings={})  # absent: 02-worker.config's two
    assert _failed(rep) == ["concurrent_rss_heavy: preflight: WORKER_TURN_USERS names >= 4 slot(s) (else refused)"]
    assert not _billed(order)


START_CHECK = ("concurrent_rss_heavy: preflight: the worker's newest ev=start names >= 4 turn_users, "
               "no refused start after it (else refused)")


@pytest.mark.parametrize("events", [
    [start_line(), {"ev": "prepare", "step": "turn_users", "error": "TurnUsersError: no such user 'genealogy-turn-3'"}],
    [start_line(), {"ev": "prepare", "step": "tmpdir", "error": "not writable", "tmpdir": "/nonexistent"}],
    [start_line(2)],
    [{"ev": "prepare", "step": "turn_users", "error": "TurnUsersError: x"}],
])
def test_concurrent_rss_heavy_refuses_a_refused_worker_start(monkeypatch, events):
    rep, order, _ = _heavy(monkeypatch, n=4, events=events)
    assert _failed(rep) == [START_CHECK]
    assert not _billed(order)


@pytest.mark.parametrize("events", [
    [start_line(), {"ev": "prepare", "step": "turn_users", "killed": {"genealogy-turn-0": 1}, "purged": {}}],
    [start_line(), {"ev": "prepare", "step": "schema", "error": "OperationalError: timeout", "retrying": True},
     {"ev": "prepare", "step": "schema", "at": "011"}],
    [start_line(2), {"ev": "prepare", "step": "turn_users", "error": "TurnUsersError: x"}, start_line()],
    # The refusal rule's conjuncts one at a time: a schema error, and an error still retrying.
    [start_line(), {"ev": "prepare", "step": "schema", "error": "OperationalError: x"}],
    [start_line(), {"ev": "prepare", "step": "turn_users", "error": "x", "retrying": True}],
])
def test_concurrent_rss_heavy_passes_a_healthy_worker_start(monkeypatch, events):
    rep, _order, _ = _heavy(monkeypatch, n=4, events=events)
    assert not _failed(rep), rep.checks


@pytest.mark.parametrize("probe, over", [
    ("nudges_0", {"settings": {"web": {"AUTONOMOUS_MAX_NUDGES": "0"}}}),
    ("cap_1usd", {"settings": {"worker": {"SESSION_SPEND_CAP_USD": "1"}}}),
    ("kill_window", {"settings": {"worker": {"SQSD_VISIBILITY_TIMEOUT_S": "1500"}}, "deadline_s": 1200.0}),
    ("debug_hold", {"settings": {"tools": {"GENEALOGY_DEBUG_HOLD_BEFORE_COMMIT_MS": "20000"}}}),
    ("idle_session_60s", {"idle_setting": "60000"}),
    ("fast_errors", {"settings": {("worker", "aws:elasticbeanstalk:sqsd"): {"ErrorVisibilityTimeout": "10"}}}),
])
def test_concurrent_rss_heavy_refuses_with_another_probe_live(monkeypatch, probe, over):
    rep, order, _ = _heavy(monkeypatch, **over)
    failed = _failed(rep)
    assert "concurrent_rss_heavy: preflight: no other probe case live (else refused)" in failed, rep.checks
    [detail] = [d for n, _ok, d in rep.checks if n.endswith("no other probe case live (else refused)")]
    assert probe in detail
    if probe == "kill_window":
        assert "concurrent_rss_heavy: preflight: SQSD_VISIBILITY_TIMEOUT_S >= window + deadline + 600 s (else refused)" in failed
    else:
        assert len(failed) == 1, failed
    assert not _billed(order)


def test_concurrent_rss_heavy_refuses_a_visibility_timeout_the_window_outlasts(monkeypatch):
    rep, order, _ = _heavy(monkeypatch, settings={"worker": {"SQSD_VISIBILITY_TIMEOUT_S": "2000"}}, window_s=1800.0)
    assert _failed(rep) == ["concurrent_rss_heavy: preflight: SQSD_VISIBILITY_TIMEOUT_S >= window + deadline + 600 s "
                            "(else refused)"]
    assert not _billed(order)


def test_concurrent_rss_heavy_ignores_the_slot_cases_own_values(monkeypatch):
    """slots_4 is what the heavy case runs under: its WORKER_TURN_USERS is not "another probe"."""
    rh = bounds.rehearse_module()
    monkeypatch.setitem(rh.CASES, "slots_4", {"measures": "x", "ops": {"worker": [
        (rh.SQSD_NS, "HttpConnections", "4"), (rh.ENV_NS, "WORKER_TURN_USERS", " ".join(bounds.TURN_USERS_ALL[:4]))]}})
    monkeypatch.setitem(rh.CASES, "worker_xlarge", {"measures": "x", "ops": {"worker": [
        (rh.ENV_NS, "WORKER_TURN_USERS", " ".join(bounds.TURN_USERS_ALL[:4]))]}})
    rep, _order, _ = _heavy(monkeypatch, n=4)
    assert not _failed(rep), rep.checks


@pytest.mark.parametrize("expect, ok", [("t3.large", False), ("t3.xlarge", True)])
def test_concurrent_rss_heavy_refuses_the_wrong_instance_type(monkeypatch, expect, ok):
    rep, order, _ = _heavy(monkeypatch, expect_instance_type=expect)
    assert _failed(rep) == ([] if ok else [f"concurrent_rss_heavy: preflight: the worker is a {expect} (else refused)"])
    assert _billed(order) == ok


@pytest.mark.parametrize("allow, ok", [(False, False), (True, True)])
def test_concurrent_rss_heavy_refuses_standard_credits(monkeypatch, allow, ok):
    rep, order, _ = _heavy(monkeypatch, credit="standard", allow_standard_credits=allow)
    assert _failed(rep) == ([] if ok else ["concurrent_rss_heavy: preflight: unlimited credits, or --allow-standard-credits "
                                           "(else refused)"])
    assert rep.figures["credit_mode"] == "standard" and _billed(order) == ok
    assert "aws ec2 describe-instance-credit-specifications --instance-ids i-0abc" in order


def test_concurrent_rss_heavy_refuses_an_empty_control_group(monkeypatch):
    rep, order, _ = _heavy(monkeypatch, host={"control_group": "", "cpu_stat_readable": "0"})
    assert _failed(rep) == ["concurrent_rss_heavy: preflight: web.service has a ControlGroup (else refused)",
                            "concurrent_rss_heavy: preflight: web.service's cpu.stat reads (else refused)"]
    assert not _billed(order)


def test_concurrent_rss_heavy_void_without_two_in_window_cpu_samples(monkeypatch):
    rep, _order, _ = _heavy(monkeypatch, cpu_usage=False)
    assert _failed(rep) == ["concurrent_rss_heavy: CPU sampled, >= 2 in-window samples with usage_usec (else void)"]
    assert rep.figures["cpu_samples"] == 0 and rep.figures["cpu_core_s"] is None


def test_concurrent_rss_heavy_counts_a_truncated_sample_lost(monkeypatch):
    rep, _order, _ = _heavy(monkeypatch, truncate_at=(10.0,))
    assert not _failed(rep), rep.checks
    assert rep.figures["cpu_truncated_samples"] == 1 and rep.figures["rss_sample_errors"] == 1
    assert rep.figures["cpu_samples"] == 60 and rep.figures["rss_samples"] == 61
    assert any("truncated: no cpu_end=1" in f for f in rep.findings)


def test_concurrent_rss_heavy_counts_a_sample_cut_inside_the_memory_half_lost(monkeypatch):
    rep, _order, _ = _heavy(monkeypatch, rss_cut_at=(10.0,))
    assert not _failed(rep), rep.checks
    assert rep.figures["rss_sample_errors"] == 1 and rep.figures["rss_samples"] == 61
    assert any("truncated: no rss_end=1" in f for f in rep.findings)
    assert bounds.RSS_END not in bounds.RSS_COMMANDS, "concurrent_rss's sample is unchanged"


def test_concurrent_rss_heavy_rides_out_failed_reads_after_the_window(monkeypatch):
    monkeypatch.setattr(bounds, "heavy_throttle_figures", lambda *a: (_ for _ in ()).throw(
        psycopg.OperationalError("rate-limit read lost")))
    rep, _order, window_params = _heavy(monkeypatch, window_fails=bounds.DB_TRIES - 1)
    assert not _failed(rep), rep.checks
    assert rep.figures["subagent_rows_in_window"] == 3 and len(window_params) == bounds.DB_TRIES
    assert any("throttle figures not read: OperationalError: rate-limit read lost" in f for f in rep.findings)


@pytest.mark.parametrize("at", [0.0, 600.0], ids=["window_open", "window_due"])
def test_concurrent_rss_heavy_rides_out_a_failed_read_of_the_window_bounds(monkeypatch, at):
    rep, order, _ = _heavy(monkeypatch, db_fails_at=(at,))
    assert not _failed(rep), rep.checks
    assert [o.split(" at ")[0] for o in _stops(order)] == ["stop sess_1", "stop sess_2"], "db_one's retry, then the Stop"
    assert rep.figures["cpu_samples"] > 2


def test_concurrent_rss_heavy_rides_out_a_failed_database_read(monkeypatch):
    rep, order, _ = _heavy(monkeypatch, db_fails_at=(300.0,))
    assert not _failed(rep), rep.checks
    assert _stops(order) == ["stop sess_1 at 600", "stop sess_2 at 600"]
    assert rep.figures["rss_sample_errors"] == 2
    assert any("connection to RDS lost" in f for f in rep.findings)


def test_concurrent_rss_heavy_records_pg_connections_rate_limits_and_api_errors(monkeypatch):
    events = [start_line(),
              {"ev": "cli_stderr", "turn_id": "t1", "line": "API Error: 529 {\"type\":\"overloaded_error\"}"},
              {"ev": "cli_stderr", "turn_id": "t1", "line": "fetched 1529 records"},
              {"ev": "turn", "turn_id": "t2", "status": 500, "outcome": "failed",
               "error": "RuntimeError: ResultMessage is_error (error_during_execution, api 429): rate limited"}]
    rep, _order, _ = _heavy(monkeypatch, events=events, rate_limited=[("sess_1", 2)], reauth=["Reconnect FamilySearch"])
    assert not _failed(rep), "throttles are findings, never voids"
    assert rep.figures["pg_conns_peak"] == 14 and rep.figures["pg_turn_conns_peak"] == 2
    assert rep.figures["session_1.rate_limited"] == 2 and rep.figures["session_2.rate_limited"] == 0
    assert rep.figures["session_1.api_throttle_lines"] == 1 and rep.figures["session_2.api_throttle_lines"] == 1
    assert rep.figures["session_1.reauth_hits"] == 1 and rep.figures["session_2.reauth_hits"] == 0
    assert "API throttle lines (429/529/overloaded/rate limit): 2" in rep.findings


def test_concurrent_rss_heavy_reports_no_api_throttle_as_not_observed(monkeypatch):
    rep, _order, _ = _heavy(monkeypatch)
    assert "API throttle lines: not observed (CLI-internal retries are not logged)" in rep.findings


def test_parse_cpu_reads_every_figure():
    got = bounds.parse_cpu(cpu_out(10.0) + RSS_OUT)
    assert got["complete"] and not got["cgstat_missing"]
    assert got["usage_usec"] == 20_000_000 and got["cgroup"]["nr_periods"] == 0
    assert got["epoch"] == 1760000010.0 and got["uptime"] == 1010.0 and got["loadavg_1"] == 1.51
    assert got["hoststat"] == [1500, 0, 500, 1960, 0, 0, 0, 40, 0, 0]
    assert got["procs"] == [(100, 0, 2048, 5, "sqsd"), (200, 1001, 524288, 5, "node"), (201, 1002, 262144, 2, "claude code")]
    assert bounds.parse_rss(cpu_out(10.0) + RSS_OUT) == bounds.parse_rss(RSS_OUT), "parse_rss skips every CPU line"
    bare = bounds.parse_cpu("cgstat_missing=1\nuptime=[not set]\ncpu_end=1\n")
    assert bare["cgstat_missing"] and bare["usage_usec"] is None and bare["uptime"] is None and bare["complete"]


def test_parse_cpu_flags_a_truncated_sample():
    assert not bounds.parse_cpu(cpu_out(10.0, end=False))["complete"]
    assert not bounds.parse_cpu(cpu_out(10.0)[:-len("cpu_end=1\n") + 6])["complete"], "a cut marker is not one"


# What a CPU_COMMANDS / HOST_COMMANDS entry may emit with: `echo KEY=`, an awk printing a
# literal "KEY= (or a "key_ prefix), `sed 's/^/KEY=/'`. Assignments and tests emit nothing.
_EMITS = re.compile(r"""^(echo\s+[a-z_]+=|awk\b.*\bprint\s*"[a-z]+(_"|[a-z_]*=)|sed\s+'s/\^/[a-z_]+=/')""")
_SILENT = re.compile(r"^(if\s|\[|fi$|[A-Z_]+=\$\()")


def _unprefixed(command: str) -> list[str]:
    """The segments of one entry whose output reaches stdout unprefixed: each simple command's
    last pipeline stage must be a prefixing emitter."""
    out = []
    for seg in re.split(r";|&&|\|\||\bthen\b|\belse\b", command):
        seg = seg.strip()
        if seg and not _SILENT.match(seg) and not _EMITS.match(seg.split("|")[-1].strip()):
            out.append(seg)
    return out


def test_cpu_commands_emit_only_prefixed_lines():
    for command in (*bounds.CPU_COMMANDS, *bounds.HOST_COMMANDS):
        assert not _unprefixed(command), command
    assert bounds.CPU_COMMANDS[-1] == "echo cpu_end=1", "the end marker comes last"
    assert "/sys/fs/cgroup/cpu.stat" not in " ".join(bounds.CPU_COMMANDS + bounds.HOST_COMMANDS)
    assert any("cgstat_missing=1" in c for c in bounds.CPU_COMMANDS), "an empty ControlGroup never reads the root cgroup"


def _sample(at: float, usage: int | None, uptime: float) -> dict:
    return {"complete": True, "usage_usec": usage, "uptime": uptime, "hoststat": None, "loadavg_1": None, "procs": []}


def test_cpu_figures_use_the_samples_bracketing_the_window():
    # Passes 0-5; the window opened on pass 2 and closed on pass 4. Outside it the worker was
    # far busier, so a figure that leaked past the bracket would show.
    samples = [(0, _sample(0, 0, 100.0)), (1, _sample(1, 90_000_000, 110.0)), (2, _sample(2, 100_000_000, 120.0)),
               (3, _sample(3, 110_000_000, 130.0)), (4, _sample(4, 140_000_000, 140.0)),
               (5, _sample(5, 900_000_000, 150.0))]
    got = bounds.cpu_figures(samples, 2, 4, {})
    assert got["cpu_samples"] == 3 and got["cpu_core_s"] == 40.0
    assert got["cpu_cores_avg"] == 2.0 and got["cpu_cores_peak"] == 3.0
    assert bounds.cpu_figures(samples, 2, 2, {})["cpu_core_s"] is None, "one sample is no interval"


def test_concurrent_rss_heavy_counts_subagent_rows_by_agent_id():
    # agent_type is set on the main thread of an --agent session; agent_id only on a subagent's.
    for sql in (bounds.SUBAGENT_ROWS_SQL, bounds.WINDOW_SUBAGENT_SQL):
        assert "agent_id IS NOT NULL" in sql and "agent_type" not in sql


def test_redelivery_timer_picks_the_nearer_timer():
    assert bounds.redelivery_timer(305, visibility_s=1500) == "ErrorVisibilityTimeout"
    assert bounds.redelivery_timer(1490, visibility_s=1500) == "VisibilityTimeout"


@pytest.mark.parametrize("case", ["kill_hold", "kill_refresh", "idle_watch", "concurrent_rss",
                                  "concurrent_rss_heavy"])
def test_the_probe_cases_refuse_compose_and_run_deployed(case):
    with pytest.raises(ValueError, match="--target deployed"):
        bounds.make_ctx(bounds.build_parser().parse_args(["--case", case]), None)
    args = bounds.build_parser().parse_args(["--case", case, "--target", "deployed", "--profile", "p"])
    assert bounds.make_ctx(args, None).target == "deployed"


def test_kill_hold_alone_takes_a_seeded_session():
    args = bounds.build_parser().parse_args(["--case", "kill_hold", "--target", "deployed", "--session", "s1"])
    assert bounds.make_ctx(args, None).session == "s1"
    args = bounds.build_parser().parse_args(["--case", "kill_refresh", "--target", "deployed", "--session", "s1"])
    with pytest.raises(ValueError, match="fresh session"):
        bounds.make_ctx(args, None)


def test_the_probe_values_are_what_rehearse_sets():
    import importlib.util

    path = SERVER / "proto" / "eb-rehearsal" / "rehearse.py"
    spec = importlib.util.spec_from_file_location("u13_rehearse_pin", path)
    rh = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(rh)
    for probe, (tier, name, value) in bounds.PROBE_SETTINGS.items():
        assert (rh.ENV_NS, name, value) in rh.CASES[probe]["ops"][tier], probe
    assert rh.CASES["idle_session_60s"]["rds_param"] == bounds.IDLE_PROBE
    assert bounds.IDLE_TEXT.read_text(encoding="utf-8").count(";") >= 10, "the idle turn must outlast a minute"
    # concurrent_rss_heavy's preflight reads every other case's values off the same table.
    live = {case for case, *_ in bounds.probe_case_values()}
    assert {"nudges_0", "cap_1usd", "kill_window", "debug_hold", "refresh_age_0"} <= live, live
    assert not {c for c in live if c.startswith("slots_") or c == "worker_xlarge"}
    assert all(value is not rh.REMOVE for *_, value in bounds.probe_case_values())


def test_template_turn_users_match_the_worker_config():
    """What the heavy preflight assumes when the API carries no value is what .ebextensions sets;
    TURN_USERS_ALL is the hook's literal (the getent uid map reads those)."""
    rh = bounds.rehearse_module()
    env = rh.template_env("worker")
    assert env["WORKER_TURN_USERS"] == bounds.TEMPLATE_TURN_USERS
    assert int(env["SQSD_VISIBILITY_TIMEOUT_S"]) == bounds.TEMPLATE_SQSD_VISIBILITY_S
    hook = (SERVER / "proto" / "eb-worker" / ".platform" / "hooks" / "predeploy" / "01-worker-layout.sh").read_text(
        encoding="utf-8")
    [literal] = re.findall(r'^TURN_USERS="([^"]*)"', hook, re.M)
    assert tuple(literal.split()) == bounds.TURN_USERS_ALL and len(bounds.TURN_USERS_ALL) == bounds.MAX_SESSIONS


def test_events_until_polls_the_deployed_log_until_the_turns_closing_line_lands(monkeypatch):
    """stop_main read CloudWatch 3.8 s after its close and found no ev=halt yet (U13,
    2026-10-08): a deployed read waits for the closing ev=turn, which is logged last."""
    reads = iter([[{"ev": "halt", "turn_id": "t1"}],
                  [{"ev": "halt", "turn_id": "t1"}, {"ev": "turn", "turn_id": "t1", "status": 200}],
                  [{"ev": "halt", "turn_id": "t1"}, {"ev": "turn", "turn_id": "t1", "status": 200, "outcome": "stopped"}]])
    monkeypatch.setattr(bounds, "TARGET", object.__new__(target.DeployedTarget))
    monkeypatch.setattr(bounds, "worker_events", lambda: next(reads))
    monkeypatch.setattr(bounds.smoke.time, "sleep", lambda s: None)
    events = bounds.events_until("t1", bounds.closing_lines)
    assert events[-1].get("outcome") == "stopped", events


def test_events_until_looks_once_on_compose(monkeypatch):
    calls: list[int] = []
    monkeypatch.setattr(bounds, "TARGET", RecordingTarget([]))
    monkeypatch.setattr(bounds, "worker_events", lambda: calls.append(1) or [])
    assert bounds.events_until("t1", bounds.closing_lines) == []
    assert len(calls) <= 2, "compose has no log lag to poll for"


def test_outage_held_terminates_before_it_posts_the_held_message(monkeypatch):
    """Posted first, the held message handed the turn over at its next tool call before the
    terminate landed, so the attempt closed queued and never saw the outage (U13, 2026-10-08)."""
    order: list[str] = []
    _case_stack(monkeypatch, order)
    monkeypatch.setattr(bounds, "post", lambda ctx, client, rep, text:
                        order.append("post held" if text == bounds.turn.TEXT_KILL else "post first") or {"turn_id": "t1"})
    monkeypatch.setattr(bounds, "sdk_of", lambda ctx, s: "sdk")
    monkeypatch.setattr(bounds, "max_entry", lambda ctx, sdk: 1)
    monkeypatch.setattr(bounds.turn, "db", lambda dsn, sql, params: order.append("terminate") or [(True,)]
                        if sql == bounds.TERMINATE_SQL else [(2, "now")])
    monkeypatch.setattr(bounds, "entries", lambda ctx, sdk, a, b: [])
    monkeypatch.setattr(bounds, "tools_log_lines", lambda ctx, a, b: [])
    monkeypatch.setattr(bounds, "done", lambda *a, **k: False)
    bounds.case_outage_held(_ctx(), None, bounds.Report(case="outage_held"))
    assert order.index("post first") < order.index("terminate") < order.index("post held"), order


def _outage_hook_run(monkeypatch, allowed_after: list[tuple]) -> bounds.Report:
    order: list[str] = []
    _case_stack(monkeypatch, order)
    monkeypatch.setattr(bounds, "sdk_of", lambda ctx, s: "sdk")
    monkeypatch.setattr(bounds, "max_entry", lambda ctx, sdk: 1)
    monkeypatch.setattr(bounds, "cancel_hook_waiter", lambda ctx, tid, stamp=None: (stamp.append("t_cancel") if stamp is not None else None) or 1)
    # The entries window still sees a call that ran before the cancel (U13 call 873).
    monkeypatch.setattr(bounds, "entries", lambda ctx, sdk, a, b: [])
    monkeypatch.setattr(bounds, "calls_ran", lambda rows: ([("", "place_search", "early")], []))
    monkeypatch.setattr(bounds.turn, "db", lambda dsn, sql, params: list(allowed_after)
                        if sql == bounds.ALLOWED_AFTER_SQL else [(2, "now")])
    monkeypatch.setattr(bounds, "events_until", lambda tid, lines=None: [
        {"ev": "halt_check_failed", "turn_id": "t1", "store_down": True},
        {"ev": "halt", "turn_id": "t1", "reason": bounds.STORE_UNAVAILABLE_REASON},
        {"ev": "turn", "turn_id": "t1", "status": 500, "error": "StoreUnavailable: x"}])
    rep = bounds.Report(case="outage_hook")
    bounds.case_outage_hook(_ctx(), None, rep)
    return rep


def _ran_after_ok(rep: bounds.Report) -> bool:
    [ok] = [ok for n, ok, _ in rep.checks if "no tool call ran after the outage" in n]
    return ok


def test_outage_hook_ignores_a_call_allowed_before_the_cancel(monkeypatch):
    assert _ran_after_ok(_outage_hook_run(monkeypatch, allowed_after=[]))


def test_outage_hook_fails_a_call_the_hook_allowed_after_the_cancel(monkeypatch):
    assert not _ran_after_ok(_outage_hook_run(monkeypatch, allowed_after=[("", "place_search", "late")]))

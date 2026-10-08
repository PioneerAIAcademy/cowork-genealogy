"""Where a driver reads logs, sends signals and changes settings: compose's containers, or
U13's rehearsal tiers on Elastic Beanstalk (``--target deployed``).

    ComposeTarget   ``docker compose logs`` / ``docker`` -- the argv the drivers always ran.
    DeployedTarget  CloudWatch ``logs filter-log-events`` for logs, ``ssm send-command`` for
                    signals, ``elasticbeanstalk update-environment`` for settings.

A tier is named ``web``, ``worker`` or ``tools`` (compose: the service; deployed: the
environment ``genealogy-u13-<tier>``). ``configure`` is a context manager that restores
what it changed in ``finally``; ``pause`` exists only on compose (RDS has no freeze).
Every AWS call goes through ``runner(argv) -> CompletedProcess``, so tests pass a fake.
Stdlib only.
"""

from __future__ import annotations

import json
import shlex
import subprocess
import time
from contextlib import contextmanager
from typing import Any, Callable, Iterator

REGION = "us-east-1"
ENV_NS = "aws:elasticbeanstalk:application:environment"
ENV_PREFIX = "genealogy-u13"
# What each action runs on a Beanstalk instance. ``term`` is systemd's stop (SIGTERM, then
# SIGKILL after TimeoutStopUSec, 90 s on the platform) followed by a start: sqsd stays up.
SIGNALS = {
    "kill": "systemctl kill -s KILL web.service",
    "term": "systemctl restart web.service",
    "stop": "systemctl stop web.service",
    "start": "systemctl start web.service",
}
COMPOSE_SIGNALS = {
    "kill": ("kill",),
    "term": ("restart", "-t", "30"),
    "stop": ("stop",),
    "start": ("start",),
}

Runner = Callable[[list[str]], subprocess.CompletedProcess]


def default_runner(argv: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(argv, capture_output=True, text=True, encoding="utf-8", check=False)


def json_records(text: str) -> list[dict]:
    """Every log line holding a JSON object, parsed from its first ``{``: compose lines are
    bare, CloudWatch's carry a syslog prefix (``Oct 07 15:09:22 ip-… web[10213]: {…}``)."""
    out: list[dict] = []
    for line in text.splitlines():
        start = line.find("{")
        if start < 0:
            continue
        try:
            rec = json.loads(line[start:])
        except ValueError:
            continue
        if isinstance(rec, dict):
            out.append(rec)
    return out


class ComposeTarget:
    name = "compose"

    def __init__(self, containers: dict[str, str] | None = None, *, docker: Callable[..., None] | None = None,
                 compose: Callable[..., str] | None = None):
        self.containers = containers or {"web": "proto-web", "worker": "proto-worker", "tools": "proto-tools",
                                         "postgres": "proto-postgres"}
        self._docker = docker
        self._compose = compose

    def docker(self, *args: str) -> None:
        if self._docker is not None:
            self._docker(*args)
            return
        subprocess.run(["docker", *args], check=True, capture_output=True, text=True, encoding="utf-8")

    def compose(self, *args: str) -> str:
        if self._compose is not None:
            return self._compose(*args)
        import smoke  # noqa: PLC0415 -- smoke imports this module

        return smoke.compose(*args)

    def logs(self, tier: str) -> str:
        return self.compose("logs", "--no-color", "--no-log-prefix", tier)

    def events(self, tier: str) -> list[dict]:
        return json_records(self.logs(tier))

    def signal(self, tier: str, action: str) -> None:
        self.docker(*COMPOSE_SIGNALS[action], self.containers[tier])

    @contextmanager
    def pause(self, tier: str) -> Iterator[None]:
        self.docker("pause", self.containers[tier])
        try:
            yield
        finally:
            self.docker("unpause", self.containers[tier])

    @contextmanager
    def configure(self, tier: str, settings: dict[str, str | None]) -> Iterator[None]:
        raise NotImplementedError("compose sets a tier's environment in docker-compose.yml or an overlay")
        yield  # pragma: no cover


class DeployedTarget:
    name = "deployed"

    def __init__(self, *, profile: str | None = None, runner: Runner = default_runner,
                 sleep: Callable[[float], None] = time.sleep, prefix: str = ENV_PREFIX,
                 log_file: str = "/var/log/web.stdout.log", poll_s: float = 5.0, timeout_s: float = 2700.0):
        self.profile = profile
        self.runner = runner
        self.sleep = sleep
        self.prefix = prefix
        self.log_file = log_file
        self.poll_s = poll_s
        self.timeout_s = timeout_s
        self._instances: dict[str, str] = {}

    def env_name(self, tier: str) -> str:
        return f"{self.prefix}-{tier}"

    def aws(self, *args: str) -> Any:
        argv = ["aws"] + (["--profile", self.profile] if self.profile else []) + [
            "--region", REGION, "--output", "json", *args]
        res = self.runner(argv)
        if res.returncode != 0:
            raise RuntimeError(f"aws {args[0]} {args[1]} failed (rc {res.returncode}): {(res.stderr or '').strip()[:800]}")
        body = (res.stdout or "").strip()
        return json.loads(body) if body.startswith(("{", "[")) else {}

    def instance(self, tier: str) -> str:
        if tier not in self._instances:
            res = self.aws("elasticbeanstalk", "describe-environment-resources", "--environment-name", self.env_name(tier))
            ids = [i["Id"] for i in res.get("EnvironmentResources", {}).get("Instances", [])]
            if len(ids) != 1:
                raise RuntimeError(f"{self.env_name(tier)} has {len(ids)} instances; expected 1")
            self._instances[tier] = ids[0]
        return self._instances[tier]

    def log_group(self, tier: str) -> str:
        return f"/aws/elasticbeanstalk/{self.env_name(tier)}{self.log_file}"

    def logs(self, tier: str, since_ms: int | None = None, until_ms: int | None = None) -> str:
        args = ["logs", "filter-log-events", "--log-group-name", self.log_group(tier)]
        if since_ms is not None:
            args += ["--start-time", str(since_ms)]
        if until_ms is not None:
            args += ["--end-time", str(until_ms)]
        events = self.aws(*args).get("events", [])
        return "\n".join(e.get("message", "") for e in sorted(events, key=lambda e: (e.get("timestamp", 0),
                                                                                    e.get("ingestionTime", 0))))

    def events(self, tier: str, since_ms: int | None = None) -> list[dict]:
        return json_records(self.logs(tier, since_ms))

    def run(self, tier: str, *commands: str, comment: str = "U13 driver") -> str:
        """``commands`` over SSM on the tier's one instance; its stdout once it finishes."""
        params = json.dumps({"commands": list(commands)})
        sent = self.aws("ssm", "send-command", "--document-name", "AWS-RunShellScript", "--instance-ids",
                        self.instance(tier), "--comment", comment, "--parameters", params)
        cid = sent["Command"]["CommandId"]
        waited = 0.0
        while True:
            self.sleep(self.poll_s)
            waited += self.poll_s
            inv = self.aws("ssm", "get-command-invocation", "--command-id", cid, "--instance-id", self.instance(tier))
            status = inv.get("Status")
            if status == "Success":
                return inv.get("StandardOutputContent", "")
            if status in ("Failed", "Cancelled", "TimedOut"):
                raise RuntimeError(f"ssm {shlex.join(commands)} on {tier}: {status}: "
                                   f"{(inv.get('StandardErrorContent') or '').strip()[:400]}")
            if waited >= self.timeout_s:
                raise TimeoutError(f"ssm command on {tier} still {status} after {waited:.0f}s")

    def signal(self, tier: str, action: str) -> None:
        self.run(tier, SIGNALS[action], comment=f"U13 driver: {action} {tier}")

    @contextmanager
    def pause(self, tier: str) -> Iterator[None]:
        raise NotImplementedError("a deployed tier has no pause: RDS cannot be frozen, and U19 calls a freeze "
                                  "no RDS failure shape")
        yield  # pragma: no cover

    def settings(self, tier: str) -> dict[str, str]:
        res = self.aws("elasticbeanstalk", "describe-configuration-settings", "--application-name", self.prefix,
                       "--environment-name", self.env_name(tier))
        opts = res.get("ConfigurationSettings", [{}])[0].get("OptionSettings", [])
        return {o["OptionName"]: o.get("Value") for o in opts if o.get("Namespace") == ENV_NS}

    def wait_ready(self, tier: str) -> None:
        waited = 0.0
        while True:
            res = self.aws("elasticbeanstalk", "describe-environments", "--environment-names", self.env_name(tier))
            envs = res.get("Environments", [])
            if envs and envs[0].get("Status") == "Ready":
                return
            if waited >= self.timeout_s:
                raise TimeoutError(f"{self.env_name(tier)} not Ready after {waited:.0f}s")
            self.sleep(max(self.poll_s, 20.0))
            waited += max(self.poll_s, 20.0)

    def _update(self, tier: str, set_: dict[str, str], remove: list[str]) -> None:
        args = ["elasticbeanstalk", "update-environment", "--environment-name", self.env_name(tier)]
        if set_:
            args += ["--option-settings", json.dumps(
                [{"Namespace": ENV_NS, "OptionName": k, "Value": v} for k, v in sorted(set_.items())])]
        if remove:
            args += ["--options-to-remove", json.dumps(
                [{"Namespace": ENV_NS, "OptionName": k} for k in sorted(remove)])]
        self.aws(*args)
        self.wait_ready(tier)

    @contextmanager
    def configure(self, tier: str, settings: dict[str, str | None]) -> Iterator[None]:
        """Set (or, for ``None``, remove) plain environment values, and put back exactly what
        was there: a name that had a value gets it back, one that had none is removed."""
        before = self.settings(tier)
        self.wait_ready(tier)
        self._update(tier, {k: v for k, v in settings.items() if v is not None},
                     [k for k, v in settings.items() if v is None])
        try:
            yield
        finally:
            self.wait_ready(tier)
            self._update(tier, {k: before[k] for k in settings if before.get(k) is not None},
                         [k for k in settings if before.get(k) is None])


def make(name: str, *, profile: str | None = None, runner: Runner = default_runner) -> ComposeTarget | DeployedTarget:
    if name == "compose":
        return ComposeTarget()
    if name == "deployed":
        return DeployedTarget(profile=profile, runner=runner)
    raise ValueError(f"--target must be compose or deployed, not {name!r}")

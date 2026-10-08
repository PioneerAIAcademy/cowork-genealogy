"""Offline shape checks on the three Beanstalk tier templates (U12), the
``apps/server/proto/eb-{web,worker,tools}/`` directories the bundle builder copies verbatim
to each zip's root. Plan: docs/plan/familysearch-handoff.md, U12; the interface is
``scripts/eb_bundles/layout.py``, whose constants these compare against.

- every ``.ebextensions/*.config`` parses with duplicate keys refused (YAML keeps the last
  one silently), and no option is set in two files of one tier;
- the Procfile is one ``web:`` line in Beanstalk's shape; web and tools carry ``--port``
  equal to the template's ``PORT``, and the worker's takes no arguments with ``PORT=8000``;
- every environment value is inside Beanstalk's documented character set -- which has no
  ``?``, ``&`` or ``,`` -- and no secret, API-level or dev-only variable is in any template;
- U11: no file under a template directory but its README, and no tier ``Dockerfile``,
  names one of ``layout.py``'s dev-only variables outside a comment;
- the logs block, the health paths, nginx at 1800 s for tools, one instance for worker
  and tools;
- the worker's ``ENGINE_PLUGIN_DIR`` is where its predeploy hook puts the plugin, and the
  hook is executable in git and runs under ``set -euo pipefail``;
- the CA variable names ``/var/app/current/`` plus the bundle's CA path.

Values are compared as strings, so re-quoting a YAML value is not an offence.
"""

from __future__ import annotations

import importlib.util
import re
import stat
import subprocess
from pathlib import Path

import pytest
import yaml

REPO = Path(__file__).resolve().parents[3]
PROTO = REPO / "apps" / "server" / "proto"
LAYOUT_PY = REPO / "scripts" / "eb_bundles" / "layout.py"
WORKER_HOOK = PROTO / "eb-worker" / ".platform" / "hooks" / "predeploy" / "01-worker-layout.sh"
TOOLS_NGINX = PROTO / "eb-tools" / ".platform" / "nginx" / "conf.d" / "01-tools-timeouts.conf"


def _load_layout():
    spec = importlib.util.spec_from_file_location("eb_bundles_layout", LAYOUT_PY)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


layout = _load_layout()

ENV_NS = "aws:elasticbeanstalk:application:environment"
PROCESS_NS = "aws:elasticbeanstalk:environment:process:default"
LOGS_NS = "aws:elasticbeanstalk:cloudwatch:logs"
ASG_NS = "aws:autoscaling:asg"
# Beanstalk's documented environment-property value set: letters, digits, space and
# _ . : / = + \ - @ ' ".
EB_VALUE = re.compile(r"""^[A-Za-z0-9 _.:/=+\\\-@'"]*$""")
EB_PROCFILE_LINE = re.compile(r"^[A-Za-z0-9_-]+:\s*\S.*$")
HEALTH_PATHS = {"web": "/api/health", "tools": "/healthz"}
# A secret travels as an API-level setting (or environmentsecrets), never in a bundle;
# API_LEVEL are per-deploy switches. The dev-only list is layout.py's.
SECRET_NAME = re.compile(r"KEY|SECRET|TOKEN|PASSWORD|DSN")
API_LEVEL = frozenset({"MODEL_PROVIDER", "GATEWAY_BASE_URL", "PYTHONPATH", "HOME"})
NGINX_UNIT_S = {"": 1, "s": 1, "m": 60, "h": 3600, "d": 86400}
TOOLS_MIN_TIMEOUT_S = 1800


class _StrictLoader(yaml.SafeLoader):
    """SafeLoader that refuses a repeated mapping key instead of keeping the last one."""


def _construct_mapping(loader, node, deep=False):
    seen = set()
    for key_node, _ in node.value:
        key = loader.construct_object(key_node, deep=deep)
        if key in seen:
            raise yaml.constructor.ConstructorError(
                None, None, f"duplicate key {key!r}", key_node.start_mark)
        seen.add(key)
    return yaml.SafeLoader.construct_mapping(loader, node, deep=deep)


_StrictLoader.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, _construct_mapping)


def _template(tier: str) -> Path:
    return REPO / layout.TEMPLATE_DIRS[tier]


def _config_files(tier: str) -> list[Path]:
    return sorted((_template(tier) / ".ebextensions").glob("*.config"))


def _load_config(path: Path) -> dict:
    return yaml.load(path.read_text(encoding="utf-8"), Loader=_StrictLoader)


def _options(tier: str) -> dict[tuple[str, str], list[tuple[str, str]]]:
    """``(namespace, option) -> [(value, file), ...]``, every setting in the tier's configs."""
    out: dict[tuple[str, str], list[tuple[str, str]]] = {}
    for path in _config_files(tier):
        for namespace, settings in (_load_config(path).get("option_settings") or {}).items():
            for option, value in (settings or {}).items():
                out.setdefault((namespace, str(option)), []).append((str(value), path.name))
    return out


def _settings(tier: str, namespace: str) -> dict[str, str]:
    return {opt: entries[-1][0] for (ns, opt), entries in _options(tier).items() if ns == namespace}


def _env(tier: str) -> dict[str, str]:
    return _settings(tier, ENV_NS)


def _procfile_command(tier: str) -> str:
    lines = [line for line in (_template(tier) / "Procfile").read_text(encoding="utf-8").splitlines()
             if line.strip()]
    assert len(lines) == 1, f"{tier}: the Procfile must be one line, got {lines}"
    assert EB_PROCFILE_LINE.match(lines[0]), f"{tier}: {lines[0]!r} is not `<process>: <command>`"
    name, _, command = lines[0].partition(":")
    assert name == "web", f"{tier}: the Procfile's process must be `web`, got {name!r}"
    return command.strip()


def _hook_assignment(name: str) -> str:
    match = re.search(rf"^{name}=(\S+)$", WORKER_HOOK.read_text(encoding="utf-8"), re.MULTILINE)
    assert match, f"{WORKER_HOOK.name} sets no {name}="
    return match.group(1).strip("\"'")


def _nginx_seconds(path: Path, directive: str) -> int | None:
    body = "\n".join(line.split("#", 1)[0] for line in path.read_text(encoding="utf-8").splitlines())
    match = re.search(rf"^\s*{directive}\s+(\d+)(s|m|h|d)?\s*;", body, re.MULTILINE)
    return None if match is None else int(match.group(1)) * NGINX_UNIT_S[match.group(2) or ""]


@pytest.mark.parametrize("tier", layout.TIERS)
def test_template_has_a_procfile_and_configs(tier):
    assert (_template(tier) / "Procfile").is_file(), f"{tier}: no Procfile"
    assert _config_files(tier), f"{tier}: no .ebextensions/*.config"


@pytest.mark.parametrize("tier", layout.TIERS)
def test_configs_parse_with_duplicate_keys_refused(tier):
    for path in _config_files(tier):
        data = _load_config(path)
        assert isinstance(data, dict) and isinstance(data.get("option_settings"), dict), path
        for namespace, settings in data["option_settings"].items():
            assert isinstance(settings, dict), f"{path.name}: {namespace} is not a mapping"


@pytest.mark.parametrize("tier", layout.TIERS)
def test_no_option_is_set_in_two_files(tier):
    twice = {f"{ns} {opt}": [f for _, f in entries] for (ns, opt), entries in _options(tier).items()
             if len(entries) > 1}
    assert not twice, f"{tier}: set in more than one file: {twice}"


@pytest.mark.parametrize("tier", ["web", "tools"])
def test_procfile_port_equals_the_template_port(tier):
    command = _procfile_command(tier)
    ports = re.findall(r"--port[ =](\S+)", command)
    assert len(ports) == 1, f"{tier}: one --port literal in {command!r}"
    assert _env(tier).get("PORT") == ports[0] == str(layout.PORTS[tier]), (command, _env(tier).get("PORT"))
    assert "--host 127.0.0.1" in command, f"{tier}: bind loopback, behind nginx: {command!r}"


def test_worker_procfile_takes_no_arguments_and_port_is_8000():
    assert _procfile_command("worker") == "python proto/worker/worker.py"
    assert _env("worker").get("PORT") == str(layout.PORTS["worker"]) == "8000"


@pytest.mark.parametrize("tier", layout.TIERS)
def test_environment_values_are_in_the_eb_character_set(tier):
    bad = {k: v for k, v in _env(tier).items() if not EB_VALUE.match(v)}
    assert not bad, f"{tier}: outside Beanstalk's environment-value set: {bad}"


@pytest.mark.parametrize("tier", layout.TIERS)
def test_no_secret_or_api_level_variable_in_a_template(tier):
    bad = sorted(k for k in _env(tier) if SECRET_NAME.search(k) or k.startswith("AWS_") or k in API_LEVEL)
    assert not bad, f"{tier}: secret or API-level variables in the template: {bad}"


def _dev_settings(tier: str, env: dict[str, str]) -> list[str]:
    bad = [k for k in env if k.startswith(layout.DEV_PREFIXES) or k in layout.DEV_VARIABLES
           or k in layout.DEV_VARIABLES_BY_TIER[tier]]
    bad += [f"{k}={env[k]}" for k, v in layout.DEV_VALUES.items() if env.get(k, "").strip().lower() == v]
    return sorted(bad)


@pytest.mark.parametrize("tier", layout.TIERS)
def test_no_dev_variable_in_a_template(tier):
    assert not _dev_settings(tier, _env(tier)), f"{tier}: dev-only settings in the template"


@pytest.mark.parametrize(("tier", "env", "dev"), [
    ("worker", {"DEV_PATHS": "true"}, True),
    ("web", {"DEV_LOGIN": "true"}, True),
    ("tools", {"GENEALOGY_DEBUG_HOLD_BEFORE_COMMIT_MS": "30000"}, True),
    ("web", {"BLOCKED_TOOLS": "person_read"}, True),
    ("worker", {"AUTONOMOUS_MAX_NUDGES": "60"}, True),
    ("worker", {"WORKER_TURN_USERS": "none"}, True),
    ("web", {"AUTONOMOUS_MAX_NUDGES": "60"}, False),
    ("worker", {"WORKER_TURN_USERS": "genealogy-turn-0 genealogy-turn-1"}, False),
    ("worker", {"PGSSLMODE": "verify-full", "SWEEP_INTERVAL_S": "300"}, False),
])
def test_the_dev_rule_sees_each_shape(tier, env, dev):
    assert bool(_dev_settings(tier, env)) is dev, (tier, env)


def _dev_pattern(tier: str) -> re.Pattern[str]:
    names = sorted(layout.DEV_VARIABLES | layout.DEV_VARIABLES_BY_TIER[tier])
    words = [re.escape(p) + r"\w+" for p in layout.DEV_PREFIXES] + [re.escape(n) + r"\b" for n in names]
    words += [rf"{re.escape(k)}\s*[=:]\s*[\"']?(?i:{re.escape(v)})\b" for k, v in layout.DEV_VALUES.items()]
    return re.compile(r"\b(?:" + "|".join(words) + ")")


def _dev_mentions(tier: str, text: str) -> list[str]:
    """Each dev-only name or value outside a whole-line ``#`` comment."""
    pattern = _dev_pattern(tier)
    return [m.group(0) for line in text.splitlines() if not line.lstrip().startswith("#")
            for m in pattern.finditer(line)]


def _shipped_files(tier: str) -> list[Path]:
    """Every file the builder copies from the tier's template directory (dot-dirs too) but
    its README, and the tier's image."""
    files = [p for p in sorted(_template(tier).rglob("*"))
             if p.is_file() and not p.name.upper().startswith("README")]
    return files + [PROTO / tier / "Dockerfile"]


def test_the_scan_reaches_the_hidden_directories():
    scanned = {p for tier in layout.TIERS for p in _shipped_files(tier)}
    assert WORKER_HOOK in scanned and TOOLS_NGINX in scanned
    assert all(p in scanned for tier in layout.TIERS for p in _config_files(tier))
    assert all((PROTO / tier / "Dockerfile").is_file() for tier in layout.TIERS)
    assert not [p for p in scanned if p.name == "README.md"]


@pytest.mark.parametrize("tier", layout.TIERS)
def test_no_dev_variable_in_a_shipped_file_or_image(tier):
    bad = {p.relative_to(REPO).as_posix(): hits for p in _shipped_files(tier)
           if (hits := _dev_mentions(tier, p.read_text(encoding="utf-8")))}
    assert not bad, f"{tier}: dev-only variables in a shipped file or image: {bad}"


@pytest.mark.parametrize(("tier", "text", "dev"), [
    ("worker", "set -euo pipefail\nexport DEV_PATHS=1\n", True),
    ("worker", "FROM python:3.12-slim\nENV DEV_PATHS=1\n", True),
    ("web", "ENV DEV_LOGIN=true\n", True),
    ("worker", "export DEV_PATHS=1  # a trailing comment is not a comment line\n", True),
    ("web", 'RUN echo "${GENEALOGY_DEBUG_HOLD_AFTER_COMMIT_MS}"\n', True),
    ("tools", "ENV AUTONOMOUS_MAX_NUDGES=5\n", True),
    ("worker", "ENV WORKER_TURN_USERS=none\n", True),
    ("worker", "WORKER_TURN_USERS: \"None\"\n", True),
    ("worker", "# DEV_PATHS is compose's, never set here\nset -euo pipefail\n", False),
    ("web", "ENV AUTONOMOUS_MAX_NUDGES=60\n", False),
    ("worker", 'TURN_USERS="genealogy-turn-0"\ndev_dir=/opt\nWORKER_TURN_USERS=nonesuch\n', False),
    ("web", "ENV GENEALOGY_SQS_REGION=us-east-1 SQS_ENDPOINT_URL=x\n", False),
])
def test_the_scan_sees_each_shape(tier, text, dev):
    assert bool(_dev_mentions(tier, text)) is dev, (tier, text)


@pytest.mark.parametrize("tier", layout.TIERS)
def test_logs_stream_and_survive_terminate(tier):
    logs = _settings(tier, LOGS_NS)
    assert logs.get("StreamLogs", "").lower() == "true", (tier, logs)
    assert logs.get("DeleteOnTerminate", "").lower() == "false", (tier, logs)


@pytest.mark.parametrize("tier", layout.TIERS)
def test_health_check_path(tier):
    assert _settings(tier, PROCESS_NS).get("HealthCheckPath") == HEALTH_PATHS.get(tier)


@pytest.mark.parametrize("directive", ["proxy_read_timeout", "proxy_send_timeout"])
def test_tools_nginx_holds_a_full_tool_call(directive):
    seconds = _nginx_seconds(TOOLS_NGINX, directive)
    assert seconds is not None and seconds >= TOOLS_MIN_TIMEOUT_S, (directive, seconds)


def test_tools_alb_idle_timeout_is_alone_in_its_file():
    entries = _options("tools")[("aws:elbv2:loadbalancer", "IdleTimeout")]
    assert [f for _, f in entries] == ["02-tools-alb.config"]
    assert int(entries[0][0]) >= TOOLS_MIN_TIMEOUT_S
    data = _load_config(_template("tools") / ".ebextensions" / "02-tools-alb.config")
    assert list(data["option_settings"]) == ["aws:elbv2:loadbalancer"]


@pytest.mark.parametrize("tier", ["worker", "tools"])
def test_one_instance_until_u6(tier):
    asg = _settings(tier, ASG_NS)
    assert (asg.get("MinSize"), asg.get("MaxSize")) == ("1", "1"), (tier, asg)


def test_worker_runtime_paths_match_the_hook_and_layout():
    env = _env("worker")
    assert env.get("ENGINE_PLUGIN_DIR") == layout.PLUGIN_DEST == _hook_assignment("PLUGIN_DEST")
    assert env.get("WORKER_CWD") == layout.WORKER_CWD == _hook_assignment("PROJECT_DIR") == "/project"
    assert env.get("TMPDIR") == layout.TMPDIR == "/tmp"


def test_web_dist_dir_is_the_layout_directory():
    assert _env("web").get("WEB_DIST_DIR") == layout.WEB_DIST_DIR


def test_root_drop_in_lives_where_a_deploy_does_not_delete_it():
    """U13 (2026-10-07): every deploy, app or configuration, deregisters web and deletes
    /etc/systemd/system/web.service.d after predeploy and before the restart, so a drop-in
    there never governs the deploy's own start; the worker came up as webapp. One under
    /usr/lib/systemd/system/web.service.d survived both kinds of deploy."""
    text = WORKER_HOOK.read_text(encoding="utf-8")
    live = [ln for ln in text.splitlines() if not ln.lstrip().startswith("#")]
    assert any(re.fullmatch(r"printf '\[Service\]\\nUser=root\\nGroup=root\\n' > "
                            r"/usr/lib/systemd/system/web\.service\.d/10-genealogy-root\.conf", ln)
               for ln in live), "the hook writes no root drop-in under /usr/lib"
    assert not any("/etc/systemd/system/web.service.d" in ln for ln in live), \
        "a drop-in under /etc is deleted by every deploy"


def test_worker_hook_is_executable_in_git_and_strict():
    rel = WORKER_HOOK.relative_to(REPO).as_posix()
    staged = subprocess.run(["git", "ls-files", "-s", "--", rel], cwd=REPO, capture_output=True,
                            text=True, encoding="utf-8", check=True).stdout.split()
    if staged:
        assert staged[0] == "100755", f"{rel} is {staged[0]} in git; git update-index --chmod=+x"
    else:
        # Untracked: `git add` records the working-tree mode.
        assert WORKER_HOOK.stat().st_mode & stat.S_IXUSR, f"{rel} is not executable"
    lines = WORKER_HOOK.read_text(encoding="utf-8").splitlines()
    assert lines[0] in ("#!/bin/bash", "#!/usr/bin/env bash"), lines[0]
    assert "set -euo pipefail" in [line.strip() for line in lines], "the hook must run under set -euo pipefail"


@pytest.mark.parametrize("tier", layout.TIERS)
def test_ca_variable_names_the_bundled_ca(tier):
    env = _env(tier)
    assert env.get(layout.CA_ENV_VAR[tier]) == f"{layout.APP_DIR}/{layout.CA_PATH_IN_BUNDLE}", (tier, env)
    assert env.get("PGSSLMODE") == "verify-full", (tier, env)


def test_the_hook_creates_exactly_the_slot_users_the_worker_is_told():
    """U3: the hook's users and 02-worker.config's WORKER_TURN_USERS are two copies of one
    list. A name only in the config refuses start (no such user); one only in the hook is a
    slot no turn uses."""
    text = WORKER_HOOK.read_text(encoding="utf-8")
    match = re.search(r'^TURN_USERS="([^"]+)"$', text, re.MULTILINE)
    assert match, f"{WORKER_HOOK.name} sets no TURN_USERS=\"…\""
    assert match.group(1).split() == _env("worker")["WORKER_TURN_USERS"].split()
    assert re.search(r"useradd [^\n]*--gid \"\$TURN_GROUP\"", text), "the users share the hook's group"
    # The offline smoke runs the hook with no systemd; an unguarded reload fails the deploy.
    reload_lines = [ln for ln in text.splitlines() if "systemctl daemon-reload" in ln and not ln.lstrip().startswith("#")]
    assert reload_lines, "the drop-in is never loaded"
    assert re.search(r"if \[ -d /run/systemd/system \]; then\n\s+systemctl daemon-reload", text), \
        "the reload runs only where systemd does"

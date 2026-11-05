"""Offline checks on the malachi stack (apps/server/proto/malachi/).

The compose and nginx rules live as functions that return violations, so every rule is run
against planted defects below as well as the real file: a rule that cannot fail reads as
coverage. Each defect is the real file with one change, and each legitimate variant must
stay clean. The shell halves run the real scripts against a local stub and a fake ``curl``,
so nothing here reaches the network. ``make malachi-rehearsal`` brings the stack up.
"""

from __future__ import annotations

import copy
import http.server
import io
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import threading
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import pytest
import yaml

from tests._bash import find_bash

SERVER = Path(__file__).resolve().parents[1]
ROOT = SERVER.parents[1]
MALACHI = SERVER / "proto" / "malachi"
COMPOSE = MALACHI / "compose.yml"
NGINX = MALACHI / "nginx.conf"
TEMPLATE = MALACHI / "env.template"
SCRIPT = MALACHI / "malachi.sh"
TAILSCALE = ROOT / "scripts" / "tailscale-services.sh"

SERVICES = {"postgres", "minio", "minio-init", "migrate", "web", "tools", "edge"}
LONG_RUNNING = {"postgres", "minio", "web", "tools", "edge"}
SECRET_NAME = re.compile(r"PASSWORD|SECRET|_KEY$|TOKEN")
REQUIRED_VALUE = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*):\?[^}]*\}")
DSN_PASSWORD = re.compile(r"://[^:/@\s]+:([^@\s]*)@")
INTERPOLATION_DEFAULT = re.compile(r"\$\{[A-Za-z_][A-Za-z0-9_]*:-([^}]*)\}")
PORT_SHORT = re.compile(r"^(?:(\[[^\]]+\]|[^:\[\]]*):)?(?:(\d+):)?(\d+)(?:/\w+)?$")

BASH = find_bash()
needs_bash = pytest.mark.skipif(BASH is None or os.name == "nt" or shutil.which("curl") is None,
                                reason="runs a POSIX shell script with curl")


# ── the compose rules ────────────────────────────────────────────────────────


def _env(service: dict) -> dict[str, str]:
    raw = service.get("environment") or {}
    if isinstance(raw, dict):
        return {k: "" if v is None else str(v).lower() if isinstance(v, bool) else str(v) for k, v in raw.items()}
    pairs = [str(item).split("=", 1) for item in raw]
    return {pair[0]: pair[1] if len(pair) > 1 else "" for pair in pairs}


def _publishes(service: dict) -> list[tuple[str | None, str | None, str]]:
    """Each entry of ``ports:`` as ``(host, published, target)``, with ``${X:-d}`` read as d."""
    out = []
    for entry in service.get("ports") or []:
        if isinstance(entry, dict):
            host = entry.get("host_ip")
            published = entry.get("published")
            published = INTERPOLATION_DEFAULT.sub(r"\1", str(published)) if published is not None else None
            out.append((host, published, str(entry.get("target"))))
            continue
        text = INTERPOLATION_DEFAULT.sub(r"\1", str(entry))
        match = PORT_SHORT.match(text)
        out.append((match.group(1), match.group(2), match.group(3)) if match else ("?", "?", text))
    return out


def publish_violations(doc: dict) -> list[str]:
    out = []
    for name, service in doc["services"].items():
        if service.get("network_mode") == "host":
            out.append(f"publish: {name} uses the host network")
        for host, published, target in _publishes(service):
            if name != "edge":
                out.append(f"publish: {name} publishes {host}:{published}:{target}")
            elif (host, published, target) != ("127.0.0.1", "8006", "8006"):
                out.append(f"publish: edge publishes {host}:{published}:{target}, not 127.0.0.1:8006:8006")
    if [p for p in _publishes(doc["services"].get("edge", {}))] == []:
        out.append("publish: edge publishes nothing")
    return out


def _required_as_name(text: str) -> str:
    """``${X:?message}`` as ``<X>``, so the colons inside it cannot split a value."""
    return REQUIRED_VALUE.sub(r"<\1>", text)


def _mounts(service: dict) -> list[str]:
    return [str(v.get("source", "")) if isinstance(v, dict) else _required_as_name(str(v)).split(":", 1)[0]
            for v in service.get("volumes") or []]


def docker_sock_violations(doc: dict) -> list[str]:
    out = []
    for name, service in doc["services"].items():
        for source in _mounts(service):
            if "docker.sock" in source:
                out.append(f"docker.sock: {name} mounts {source}")
        for key, value in _env(service).items():
            if "docker.sock" in value:
                out.append(f"docker.sock: {name} points {key} at it")
    return out


def _argv(service: dict) -> str:
    parts: list[str] = []
    for field in ("command", "entrypoint"):
        value = service.get(field) or []
        parts.extend(value if isinstance(value, list) else [value])
    return " ".join(str(p) for p in parts)


def password_violations(doc: dict) -> list[str]:
    out = []
    for name, service in doc["services"].items():
        for key, value in _env(service).items():
            if SECRET_NAME.search(key) and not REQUIRED_VALUE.fullmatch(value):
                out.append(f"default password: {name} {key} is not a bare ${{VAR:?}}")
            match = DSN_PASSWORD.search(_required_as_name(value))
            if match and not re.fullmatch(r"<\w+>", match.group(1)):
                out.append(f"default password: {name} {key} carries a password in its DSN")
        argv = _argv(service)
        if re.search(r"\bmc\s+alias\s+set\b", argv) or DSN_PASSWORD.search(argv):
            out.append(f"default password: {name} has credentials in argv")
    return out


def dev_login_violations(doc: dict) -> list[str]:
    out = []
    for name, service in doc["services"].items():
        for key in _env(service):
            if key in ("DEV_LOGIN", "DEV_PATHS"):
                out.append(f"dev-login: {name} sets {key}")
        if "env_file" in service:
            out.append(f"dev-login: {name} has an env_file, which can set anything")
    return out


def chat_violations(doc: dict) -> list[str]:
    value = _env(doc["services"]["web"]).get("GENEALOGY_CHAT")
    return [] if value == "false" else [f"chat: web's GENEALOGY_CHAT is {value!r}, not false"]


def shape_violations(doc: dict) -> list[str]:
    out = []
    services = doc["services"]
    if set(services) != SERVICES:
        out.append(f"services: {sorted(set(services) ^ SERVICES)}")
    web, tools = _env(services["web"]), _env(services["tools"])
    if web.get("WEB_DIST_DIR") != "":
        out.append("spa: web must set WEB_DIST_DIR to a literal blank")
    if "--no-access-log" not in _argv(services["web"]):
        out.append("logs: uvicorn's access log prints query strings")
    if web.get("OPENROUTER_LINKING_ENABLED") != "false":
        out.append("openrouter: web must set OPENROUTER_LINKING_ENABLED to a literal false")
    for name, env in (("web", web), ("tools", tools)):
        if env.get("UPLOADS_ENABLED") != "${UPLOADS_ENABLED:-false}":
            out.append(f"uploads: {name}'s UPLOADS_ENABLED comes from the env file and defaults to false")
    if tools.get("GENEALOGY_SHARED_COLLECTIONS_CACHE") != "true":
        out.append("collections: tools must share one catalog cache across patrons")
    for key in ("GENEALOGY_FS_CALLS_PER_MINUTE", "GENEALOGY_MAX_TRANSCRIPTIONS"):
        if tools.get(key) != f"${{{key}:-}}":
            out.append(f"limits: tools' {key} comes from the env file")
    if tools.get("WEB_PUBLIC_URL") != "${WEB_PUBLIC_URL:-}":
        out.append("links: tools' WEB_PUBLIC_URL comes from the env file alone")
    if tools.get("OAUTH_ISSUER", "").split(":")[0] != "${PUBLIC_URL":
        out.append("issuer: tools' OAUTH_ISSUER must be PUBLIC_URL")
    if services["tools"].get("read_only") is not True or services["edge"].get("read_only") is not True:
        out.append("read_only: tools and edge run read-only")
    if not any("dml_role.py" in m for m in _mounts(services["migrate"])):
        out.append("migrate: dml_role.py is not in the image, so it needs the bind")
    if "dml_role.py" not in _argv(services["migrate"]):
        out.append("migrate: dml_role.py never runs")
    for name, service in services.items():
        if "container_name" in service:
            out.append(f"container_name: {name}")
        env = _env(service)
        if "QUEUE_URL" in env:
            out.append(f"queue: {name} sets QUEUE_URL")
        if "MIGRATE_PG_DSN" in env and name != "migrate":
            out.append(f"owner dsn: {name} holds it")
        for key in ("PG_DSN", "GENEALOGY_PG_DSN"):
            if key in env and "genealogy_dml:" not in env[key]:
                out.append(f"dml: {name} {key} is not the DML role")
        wanted = "unless-stopped" if name in LONG_RUNNING else "no"
        if service.get("restart") != wanted:
            out.append(f"restart: {name} is {service.get('restart')!r}, want {wanted}")
        logging = service.get("logging") or {}
        if logging.get("driver") != "json-file" or not (logging.get("options") or {}).get("max-size"):
            out.append(f"logging: {name} has no rotation")
    for name in ("postgres", "minio"):
        if not any(m.startswith("<DATA_DIR>/") for m in _mounts(services[name])):
            out.append(f"data: {name} is not under DATA_DIR")
    for name in ("postgres", "minio", "web", "tools"):
        if not services[name].get("mem_limit"):
            out.append(f"memory: {name} has no mem_limit")
    if "-h 127.0.0.1" not in " ".join(services["postgres"]["healthcheck"]["test"]):
        out.append("postgres: the health check must use TCP; the first-run init server answers the socket")
    wait = services["edge"].get("depends_on") or {}
    for name in ("web", "tools"):
        if (wait.get(name) or {}).get("condition") != "service_healthy":
            out.append(f"edge: must wait for {name} to be healthy")
    if "genealogy.edge-conf" not in (services["edge"].get("labels") or {}):
        out.append("edge: no label ties it to nginx.conf")
    return out


RULES: dict[str, Callable[[dict], list[str]]] = {
    "publish": publish_violations,
    "docker.sock": docker_sock_violations,
    "default password": password_violations,
    "dev-login": dev_login_violations,
    "chat": chat_violations,
    "shape": shape_violations,
}


def _load() -> dict:
    return yaml.safe_load(COMPOSE.read_text(encoding="utf-8"))


def _set_ports(*entries: Any, service: str = "edge") -> Callable[[dict], None]:
    def plant(doc: dict) -> None:
        doc["services"][service]["ports"] = list(entries)
    return plant


def _set_env(service: str, key: str, value: Any) -> Callable[[dict], None]:
    def plant(doc: dict) -> None:
        doc["services"][service].setdefault("environment", {})[key] = value
    return plant


def _add_volume(service: str, volume: Any) -> Callable[[dict], None]:
    def plant(doc: dict) -> None:
        doc["services"][service].setdefault("volumes", []).append(volume)
    return plant


def _env_as_list(service: str, *extra: str) -> Callable[[dict], None]:
    def plant(doc: dict) -> None:
        env = doc["services"][service]["environment"]
        doc["services"][service]["environment"] = [f"{k}={v}" for k, v in env.items()] + list(extra)
    return plant


def _drop_env(service: str, key: str) -> Callable[[dict], None]:
    def plant(doc: dict) -> None:
        del doc["services"][service]["environment"][key]
    return plant


def _all(*plants: Callable[[dict], None]) -> Callable[[dict], None]:
    def plant(doc: dict) -> None:
        for one in plants:
            one(doc)
    return plant


def _set(service: str, key: str, value: Any) -> Callable[[dict], None]:
    def plant(doc: dict) -> None:
        doc["services"][service][key] = value
    return plant


def _unset(service: str, key: str) -> Callable[[dict], None]:
    def plant(doc: dict) -> None:
        del doc["services"][service][key]
    return plant


DEFECTS: list[tuple[str, str, Callable[[dict], None]]] = [
    ("publish", "no host", _set_ports("8006:8006")),
    ("publish", "every interface", _set_ports("0.0.0.0:8006:8006")),
    ("publish", "long form, no host_ip", _set_ports({"target": 8006, "published": "8006"})),
    ("publish", "ipv6 loopback", _set_ports("[::1]:8006:8006")),
    ("publish", "wrong port", _set_ports("127.0.0.1:8007:8006")),
    ("publish", "default moved", _set_ports("127.0.0.1:${EDGE_PORT:-8007}:8006")),
    ("publish", "a port on web", _set_ports("127.0.0.1:8085:8085", service="web")),
    ("publish", "random host port", _set_ports("8006")),
    ("publish", "second publish on the edge", _set_ports("127.0.0.1:8006:8006", "127.0.0.1:9000:9000")),
    ("publish", "host network", _set("tools", "network_mode", "host")),
    ("publish", "edge publishes nothing", _unset("edge", "ports")),
    ("docker.sock", "short bind", _add_volume("web", "/var/run/docker.sock:/var/run/docker.sock")),
    ("docker.sock", "long form", _add_volume("tools", {"type": "bind", "source": "/run/docker.sock",
                                                       "target": "/s"})),
    ("docker.sock", "read-only", _add_volume("edge", "/var/run/docker.sock:/s:ro")),
    ("docker.sock", "DOCKER_HOST", _set_env("web", "DOCKER_HOST", "unix:///var/run/docker.sock")),
    ("default password", "literal", _set_env("postgres", "POSTGRES_PASSWORD", "proto")),
    ("default password", "default in interpolation", _set_env("postgres", "POSTGRES_PASSWORD",
                                                              "${POSTGRES_PASSWORD:-proto}")),
    ("default password", "empty default", _set_env("web", "SESSION_SECRET", "${SESSION_SECRET:-}")),
    ("default password", "unchecked", _set_env("web", "FS_TOKEN_ENC_KEY", "${FS_TOKEN_ENC_KEY}")),
    ("default password", "literal in a DSN", _set_env("web", "PG_DSN",
                                                      "postgresql://genealogy_dml:proto@postgres:5432/genealogy")),
    ("default password", "default in a DSN", _set_env("web", "PG_DSN",
                                                      "postgresql://genealogy_dml:${DML:-x}@postgres:5432/genealogy")),
    ("default password", "list form", _env_as_list("minio", "MINIO_ROOT_PASSWORD=protoproto")),
    ("default password", "mc alias in argv", _set("minio-init", "command",
                                                  ["mc alias set beta http://minio:9000 u protoproto"])),
    ("default password", "DSN in argv", _set("migrate", "command",
                                             ["psql", "postgresql://postgres:proto@postgres:5432/genealogy"])),
    ("dev-login", "map form", _set_env("web", "DEV_LOGIN", "true")),
    ("dev-login", "list form", _env_as_list("web", "DEV_LOGIN=true")),
    ("dev-login", "false still counts", _set_env("web", "DEV_LOGIN", "false")),
    ("dev-login", "on tools", _set_env("tools", "DEV_LOGIN", "true")),
    ("dev-login", "DEV_PATHS", _set_env("tools", "DEV_PATHS", "true")),
    ("dev-login", "env_file", _set("web", "env_file", ["./secrets.env"])),
    ("chat", "omitted", _drop_env("web", "GENEALOGY_CHAT")),
    ("chat", "on", _set_env("web", "GENEALOGY_CHAT", "true")),
    ("chat", "from the shell", _set_env("web", "GENEALOGY_CHAT", "${GENEALOGY_CHAT:-false}")),
    ("chat", "only on tools", _all(_drop_env("web", "GENEALOGY_CHAT"), _set_env("tools", "GENEALOGY_CHAT", "false"))),
    ("shape", "SPA left on", _drop_env("web", "WEB_DIST_DIR")),
    ("shape", "a queue", _set_env("web", "QUEUE_URL", "http://elasticmq:9324/000000000000/turns")),
    ("shape", "a container_name", _set("web", "container_name", "x")),
    ("shape", "access log on", _set("web", "command", ["uvicorn", "web.app:app", "--port", "8085"])),
    ("shape", "tools writable", _set("tools", "read_only", False)),
    ("shape", "edge writable", _unset("edge", "read_only")),
    ("shape", "dml_role.py not mounted", _unset("migrate", "volumes")),
    ("shape", "OpenRouter linking on", _set_env("web", "OPENROUTER_LINKING_ENABLED", "true")),
    ("shape", "OpenRouter linking left out", _drop_env("web", "OPENROUTER_LINKING_ENABLED")),
    ("shape", "OpenRouter linking from the env file", _set_env("web", "OPENROUTER_LINKING_ENABLED",
                                                               "${OPENROUTER_LINKING_ENABLED:-false}")),
    ("shape", "uploads on in web", _set_env("web", "UPLOADS_ENABLED", "true")),
    ("shape", "uploads on in tools", _set_env("tools", "UPLOADS_ENABLED", "true")),
    ("shape", "uploads default to on", _set_env("web", "UPLOADS_ENABLED", "${UPLOADS_ENABLED:-true}")),
    ("shape", "uploads off in tools alone", _drop_env("tools", "UPLOADS_ENABLED")),
    ("shape", "collections cache per token", _drop_env("tools", "GENEALOGY_SHARED_COLLECTIONS_CACHE")),
    ("shape", "a limit the env file cannot reach", _drop_env("tools", "GENEALOGY_MAX_TRANSCRIPTIONS")),
    ("shape", "dead links", _set_env("tools", "WEB_PUBLIC_URL", "${PUBLIC_URL:?x}")),
    ("shape", "owner DSN on web", _set_env("web", "MIGRATE_PG_DSN", "x")),
    ("shape", "owner on tools", _set_env("tools", "GENEALOGY_PG_DSN",
                                         "postgresql://postgres:${POSTGRES_PASSWORD:?x}@postgres:5432/genealogy")),
    ("shape", "edge does not wait", _unset("edge", "depends_on")),
    ("shape", "health check on the socket", _set("postgres", "healthcheck", {"test": ["CMD-SHELL", "pg_isready -U postgres"]})),
    ("shape", "no memory cap", _unset("tools", "mem_limit")),
    ("shape", "no rotation", _unset("minio", "logging")),
    ("shape", "one-shot restarts", _set("migrate", "restart", "unless-stopped")),
]

LEGITIMATE: list[tuple[str, str, Callable[[dict], None]]] = [
    ("publish", "long form on loopback", _set_ports({"target": 8006, "published": "8006", "host_ip": "127.0.0.1"})),
    ("publish", "long form, variable port", _set_ports({"target": 8006, "published": "${EDGE_PORT:-8006}",
                                                        "host_ip": "127.0.0.1"})),
    ("publish", "literal short form", _set_ports("127.0.0.1:8006:8006")),
    ("docker.sock", "a neighbour", _add_volume("web", "/var/run/dockerish:/x")),
    ("default password", "required value", _set_env("web", "ANOTHER_SECRET", "${ANOTHER_SECRET:?set it}")),
    ("default password", "required in a DSN", _set_env("web", "PG_DSN",
                                                       "postgresql://genealogy_dml:${DML_PASSWORD:?x}@postgres/g")),
    ("default password", "a harmless blank", _set_env("tools", "WIKI_API_URL", "${WIKI_API_URL:-}")),
    ("default password", "a plain setting", _set_env("web", "GENEALOGY_S3_BUCKET", "projects")),
    ("dev-login", "a key that merely contains DEV", _set_env("web", "DEVICE_NAME", "x")),
    ("chat", "list form", _all(_drop_env("web", "GENEALOGY_CHAT"), _env_as_list("web", "GENEALOGY_CHAT=false"))),
    ("chat", "unquoted", _set_env("web", "GENEALOGY_CHAT", False)),
    ("shape", "linking off, unquoted", _set_env("web", "OPENROUTER_LINKING_ENABLED", False)),
    ("shape", "list form", _env_as_list("web")),
]


def test_the_real_file_breaks_no_rule():
    doc = _load()
    assert [v for rule in RULES.values() for v in rule(doc)] == []


@pytest.mark.parametrize(("rule", "name", "plant"), DEFECTS, ids=[f"{r}-{n}" for r, n, _ in DEFECTS])
def test_compose_rule_fails_on_a_planted_defect(rule, name, plant):
    doc = copy.deepcopy(_load())
    plant(doc)
    assert RULES[rule](doc), f"{rule} passed {name}"


@pytest.mark.parametrize(("rule", "name", "plant"), LEGITIMATE, ids=[f"{r}-{n}" for r, n, _ in LEGITIMATE])
def test_compose_rule_passes_a_legitimate_variant(rule, name, plant):
    doc = copy.deepcopy(_load())
    plant(doc)
    assert RULES[rule](doc) == [], name


def test_compose_rule_ignores_a_comment():
    doc = yaml.safe_load(COMPOSE.read_text(encoding="utf-8") + "\n# DEV_LOGIN docker.sock 0.0.0.0:8006:8006\n")
    assert [v for rule in RULES.values() for v in rule(doc)] == []


def test_a_listed_service_outside_the_seven_fails():
    doc = copy.deepcopy(_load())
    doc["services"]["worker"] = {"restart": "unless-stopped"}
    assert any(v.startswith("services:") for v in shape_violations(doc))


def test_the_template_carries_no_secret_and_no_port():
    values = dict(line.split("=", 1) for line in TEMPLATE.read_text(encoding="utf-8").splitlines()
                  if line and not line.startswith("#"))
    for key in ("POSTGRES_PASSWORD", "DML_PASSWORD", "MINIO_ROOT_PASSWORD", "SESSION_SECRET", "FS_TOKEN_ENC_KEY",
                "ALLOWED_EMAILS", "WIKI_API_URL", "POP_STATS_URL", "WEB_PUBLIC_URL", "OPENROUTER_SEED_KEY",
                "GENEALOGY_FS_CALLS_PER_MINUTE", "GENEALOGY_MAX_TRANSCRIPTIONS"):
        assert values[key] == "", key
    assert values["UPLOADS_ENABLED"] == "false"
    assert values["DATA_DIR"] == "/home/data/genealogy-beta"
    assert values["PUBLIC_URL"] == "https://malachi.taild68f1b.ts.net"
    assert "EDGE_PORT" not in values


def test_no_service_sees_the_seed_key():
    assert "OPENROUTER_SEED_KEY" not in COMPOSE.read_text(encoding="utf-8")


def test_malachi_sh_knows_the_development_keys():
    """A dev key in the env file must be refused, so the list follows the code."""
    source = SCRIPT.read_text(encoding="utf-8")
    dev = re.search(r'^DEV_VALUES="([^"]*)"', source, re.M).group(1).split()
    auth = (SERVER / "proto" / "web" / "auth.py").read_text(encoding="utf-8")
    grants = (SERVER / "proto" / "grants.py").read_text(encoding="utf-8")
    assert re.search(r'^DEV_SESSION_SECRET = "([^"]*)"', auth, re.M).group(1) in dev
    assert re.search(r'^DEV_FS_TOKEN_ENC_KEY = "([^"]*)"', grants, re.M).group(1) in dev


# ── the nginx rules ──────────────────────────────────────────────────────────


def _strip_comments(text: str) -> str:
    return "\n".join(line.split("#", 1)[0] for line in text.splitlines())


def _location(text: str, match: str) -> str:
    found = re.search(r"location\s+" + re.escape(match) + r"\s*\{(.*?)\}", text, re.S)
    return found.group(1) if found else ""


def nginx_violations(raw: str) -> list[str]:
    text = _strip_comments(raw)
    out = []
    log_format = re.search(r"log_format\s.*?;", text, re.S)
    leaks = re.findall(r"\$(request\b(?!_)|request_uri|args|arg_\w+|query_string|is_args|http_referer)",
                       log_format.group(0) if log_format else "")
    if not log_format or leaks:
        out.append(f"log-query: {leaks or 'no log_format'}")
    if re.search(r"^\s*access_log\b(?!.*\bedge;)", text, re.M):
        out.append("log-query: access_log does not use the edge format")
    errors = re.findall(r"^\s*error_log\s+(.*?);", text, re.M)
    if errors != ["stderr crit"]:
        out.append(f"error-level: {errors}")
    for path in ("/healthz", "/api/health"):
        if "return 404" not in _location(text, f"= {path}"):
            out.append(f"deep-check: {path} is not an exact-match 404")
    if re.search(r"location\s+(/healthz|/api/health)\b", text):
        out.append("deep-check: a prefix location")
    if re.search(r"proxy_pass\s+https?://", text):
        out.append("upstream: a literal proxy_pass resolves once at start")
    if not re.search(r"resolver\s+127\.0\.0\.11\b", text):
        out.append("upstream: no resolver")
    if not re.search(r"^\s*client_max_body_size\s+26m;", text, re.M):
        out.append("body-size: client_max_body_size must be 26m")
    if not re.search(r"proxy_buffering\s+off;", text):
        out.append("buffering: proxy_buffering must be off")
    if not re.search(r"proxy_request_buffering\s+off;", text):
        out.append("buffering: proxy_request_buffering must be off")
    if not re.search(r"proxy_http_version\s+1\.1;", text):
        out.append("http: proxy_http_version must be 1.1")
    for path in ("/mcp", "/.well-known/oauth-protected-resource/mcp"):
        if "$tools_upstream" not in _location(text, f"= {path}"):
            out.append(f"routing: {path} does not reach tools")
    if "$web_upstream" not in _location(text, "/"):
        out.append("routing: everything else must reach web")
    return out


NGINX_DEFECTS = [
    ("log-query", '"path":"$uri"', '"path":"$request_uri"'),
    ("log-query", '"path":"$uri"', '"path":"$request"'),
    ("log-query", '"path":"$uri"', '"path":"$uri?$args"'),
    ("log-query", '"path":"$uri"', '"path":"$arg_code"'),
    ("log-query", '"path":"$uri"', '"path":"$uri","ref":"$http_referer"'),
    ("log-query", "access_log /dev/stdout edge;", "access_log /dev/stdout combined;"),
    ("error-level", "error_log stderr crit;", "error_log stderr error;"),
    ("error-level", "error_log stderr crit;", ""),
    ("deep-check", "location = /healthz {", "location /healthz {"),
    ("deep-check", "location = /api/health { return 404; }", ""),
    ("upstream", "proxy_pass $web_upstream;", "proxy_pass http://web:8085;"),
    ("upstream", "resolver 127.0.0.11 valid=10s ipv6=off;", ""),
    ("body-size", "client_max_body_size 26m;", "client_max_body_size 100m;"),
    ("body-size", "client_max_body_size 26m;", "# client_max_body_size 26m;"),
    ("buffering", "proxy_buffering off;", "proxy_buffering on;"),
    ("buffering", "proxy_request_buffering off;", ""),
    ("routing", "location = /mcp {", "location = /mcp-off {"),
    ("routing", "proxy_pass $tools_upstream;", "proxy_pass $web_upstream;"),
]

NGINX_LEGITIMATE = [
    ("reflowed format", "'\"status\":$status,\"bytes\":$body_bytes_sent,\"seconds\":$request_time}';",
     "'\"status\":$status,'\n        '\"bytes\":$body_bytes_sent,\"seconds\":$request_time}';"),
    ("changed timeout", "proxy_read_timeout 1800s;", "proxy_read_timeout 900s;"),
    ("a comment naming a banned variable", "http {", "# never $request_uri here\nhttp {"),
]


def test_the_real_nginx_file_breaks_no_rule():
    assert nginx_violations(NGINX.read_text(encoding="utf-8")) == []


@pytest.mark.parametrize(("rule", "old", "new"), NGINX_DEFECTS, ids=[f"{r}-{i}" for i, (r, _, _) in enumerate(NGINX_DEFECTS)])
def test_nginx_rule_fails_on_a_planted_defect(rule, old, new):
    text = NGINX.read_text(encoding="utf-8")
    assert old in text, old
    assert any(v.startswith(rule) for v in nginx_violations(text.replace(old, new)))


@pytest.mark.parametrize(("name", "old", "new"), NGINX_LEGITIMATE, ids=[n for n, _, _ in NGINX_LEGITIMATE])
def test_nginx_rule_passes_a_legitimate_variant(name, old, new):
    text = NGINX.read_text(encoding="utf-8")
    assert old in text, old
    assert nginx_violations(text.replace(old, new)) == [], name


# ── the env file ─────────────────────────────────────────────────────────────


def _script_env(tmp_path: Path, **extra: str) -> dict[str, str]:
    env = {"PATH": os.environ["PATH"], "HOME": str(tmp_path), "MALACHI_ENV": str(tmp_path / "cfg" / "env")}
    return {**env, **extra}


def _run(args: list[str], env: dict[str, str]) -> subprocess.CompletedProcess:
    return subprocess.run([BASH, str(SCRIPT), *args], env=env, capture_output=True, text=True, encoding="utf-8",
                          timeout=60)


def _read_env(path: Path) -> dict[str, str]:
    return dict(line.split("=", 1) for line in path.read_text(encoding="utf-8").splitlines()
                if "=" in line and not line.startswith("#"))


FAKE_DOCKER = """#!/bin/sh
if [ "$1" = info ]; then
  printf '%s\\n' "${FAKE_DOCKER_ROOT-}"
  exit 0
fi
if [ "$1" = image ] && [ -n "${FAKE_IMAGE_PRUNE_FAILS-}" ]; then
  exit 1
fi
[ -z "${FAKE_DOCKER_STDIN-}" ] || cat >"$FAKE_DOCKER_STDIN"
printf '%s|%s|%s\\n' "${FS_TOKEN_ENC_KEY-unset}" "${EDGE_PORT-unset}" "$*"
"""


def _with_fake_docker(folder: Path, env: dict[str, str]) -> dict[str, str]:
    """``env`` with a docker first on PATH that prints what reached it and succeeds. ``docker
    info`` answers ``FAKE_DOCKER_ROOT``, and ``FAKE_DOCKER_STDIN`` names a file for its stdin."""
    bin_dir = folder / "docker-bin"
    bin_dir.mkdir(exist_ok=True)
    fake = bin_dir / "docker"
    fake.write_text(FAKE_DOCKER, encoding="utf-8")
    fake.chmod(0o755)
    return {**env, "PATH": f"{bin_dir}{os.pathsep}{env['PATH']}"}


@pytest.fixture
def first_run(tmp_path: Path) -> tuple[Path, dict[str, str]]:
    data = tmp_path / "data"
    env = _script_env(tmp_path, DATA_DIR=str(data), PUBLIC_URL="https://example.test",
                      ALLOWED_EMAILS="a@example.test")
    result = _run(["env-init"], env)
    assert result.returncode == 0, result.stderr
    return tmp_path / "cfg" / "env", env


@needs_bash
def test_env_init_writes_mode_600_with_every_secret_filled(first_run):
    path, _env_vars = first_run
    assert stat.S_IMODE(path.stat().st_mode) == 0o600
    values = _read_env(path)
    secrets = [values[k] for k in ("POSTGRES_PASSWORD", "DML_PASSWORD", "MINIO_ROOT_PASSWORD", "SESSION_SECRET",
                                   "FS_TOKEN_ENC_KEY")]
    assert all(re.fullmatch(r"[0-9a-f]{64}", s) for s in secrets)
    assert len(set(secrets)) == 5
    assert values["PUBLIC_URL"] == "https://example.test"
    assert values["ALLOWED_EMAILS"] == "a@example.test"


@needs_bash
def test_env_init_twice_changes_nothing(first_run):
    path, env = first_run
    before = path.read_bytes()
    assert _run(["env-init"], {**env, "PUBLIC_URL": "https://other.test"}).returncode == 0
    assert path.read_bytes() == before


@needs_bash
def test_env_init_adds_a_key_a_newer_template_named(first_run, tmp_path):
    path, env = first_run
    kept = _read_env(path)["FS_TOKEN_ENC_KEY"]
    text = "".join(line + "\n" for line in path.read_text(encoding="utf-8").splitlines()
                   if not line.startswith(("DML_PASSWORD=", "WIKI_API_URL=")))
    path.write_text(text, encoding="utf-8")
    assert _run(["env-init"], env).returncode == 0
    values = _read_env(path)
    assert re.fullmatch(r"[0-9a-f]{64}", values["DML_PASSWORD"])
    assert values["WIKI_API_URL"] == ""
    assert values["FS_TOKEN_ENC_KEY"] == kept


@needs_bash
@pytest.mark.parametrize("key", ["FS_TOKEN_ENC_KEY", "POSTGRES_PASSWORD"])
def test_env_init_refuses_to_replace_a_deleted_secret_over_live_data(first_run, key):
    path, env = first_run
    data = Path(env["DATA_DIR"])
    data.mkdir()
    (data / ".genealogy-beta").touch()
    kept = "".join(line + "\n" for line in path.read_text(encoding="utf-8").splitlines()
                   if not line.startswith(f"{key}="))
    path.write_text(kept, encoding="utf-8")
    result = _run(["env-init"], env)
    assert result.returncode == 1 and f"{key} is missing" in result.stderr
    assert path.read_text(encoding="utf-8") == kept


@needs_bash
def test_env_init_adds_a_key_on_a_line_of_its_own(first_run):
    path, env = first_run
    last = _read_env(path)["FS_TOKEN_ENC_KEY"]
    text = "".join(line + "\n" for line in path.read_text(encoding="utf-8").splitlines()
                   if not line.startswith("WIKI_API_URL="))
    path.write_text(text.rstrip("\n"), encoding="utf-8")
    assert _run(["env-init"], env).returncode == 0
    values = _read_env(path)
    assert values["FS_TOKEN_ENC_KEY"] == last and values["WIKI_API_URL"] == ""


@needs_bash
def test_env_init_refuses_a_loose_mode(first_run):
    path, env = first_run
    path.chmod(0o644)
    result = _run(["env-init"], env)
    assert result.returncode == 1 and "mode 600" in result.stderr


@needs_bash
@pytest.mark.parametrize("value", ["dev-insecure-fs-token-key-change-me", ""])
def test_env_init_refuses_a_development_or_blank_key(first_run, value):
    path, env = first_run
    before = _read_env(path)["FS_TOKEN_ENC_KEY"]
    path.write_text(path.read_text(encoding="utf-8").replace(f"FS_TOKEN_ENC_KEY={before}", f"FS_TOKEN_ENC_KEY={value}"),
                    encoding="utf-8")
    after = path.read_text(encoding="utf-8")
    result = _run(["env-init"], env)
    assert result.returncode == 1 and "FS_TOKEN_ENC_KEY" in result.stderr
    assert path.read_text(encoding="utf-8") == after


@needs_bash
def test_env_init_refuses_to_replace_a_lost_file_over_live_data(first_run):
    path, env = first_run
    data = Path(env["DATA_DIR"])
    data.mkdir()
    (data / ".genealogy-beta").touch()
    path.unlink()
    result = _run(["env-init"], env)
    assert result.returncode == 1 and "Restore that file" in result.stderr
    assert not path.exists()


@needs_bash
def test_a_shell_variable_does_not_replace_the_env_files_value(first_run):
    """Shell variables beat --env-file, so the script must drop them; this reads what the
    wrapper hands docker, through a fake docker first on PATH."""
    path, env = first_run
    result = _run(["logs"], {**_with_fake_docker(path.parent, env), "FS_TOKEN_ENC_KEY": "stray", "EDGE_PORT": "9999"})
    assert result.returncode == 0, result.stderr
    assert result.stdout.startswith("unset|unset|compose -p genealogy-beta --env-file"), result.stdout


@needs_bash
def test_up_creates_data_dir_private_and_marked(first_run):
    path, env = first_run
    result = _run(["up"], {**_with_fake_docker(path.parent, env), "EDGE": "off"})
    assert result.returncode == 0, result.stderr
    data = Path(env["DATA_DIR"])
    assert stat.S_IMODE(data.stat().st_mode) == 0o700
    assert (data / ".genealogy-beta").exists()
    assert all((data / name).is_dir() for name in ("postgres", "minio", "backups", "exports"))


@needs_bash
def test_up_leaves_the_mode_of_a_directory_it_did_not_create(first_run):
    path, env = first_run
    data = Path(env["DATA_DIR"])
    data.mkdir()
    data.chmod(0o755)
    assert _run(["up"], {**_with_fake_docker(path.parent, env), "EDGE": "off"}).returncode == 0
    assert stat.S_IMODE(data.stat().st_mode) == 0o755


@needs_bash
def test_up_refuses_a_populated_directory_it_does_not_own(first_run):
    path, env = first_run
    data = Path(env["DATA_DIR"])
    data.mkdir()
    (data / "someone-elses").touch()
    result = _run(["up"], _with_fake_docker(path.parent, env))
    assert result.returncode == 1 and "not this stack's" in result.stderr
    assert sorted(p.name for p in data.iterdir()) == ["someone-elses"]


@needs_bash
@pytest.mark.parametrize("edge", ["of", "OFF", "no"])
def test_up_refuses_an_edge_value_it_does_not_know(first_run, edge):
    """Read before anything starts: a typo must not open the public port."""
    path, env = first_run
    result = _run(["up"], {**_with_fake_docker(path.parent, env), "EDGE": edge})
    assert result.returncode == 1 and "EDGE must be on or off" in result.stderr
    assert "compose" not in result.stdout


@needs_bash
@pytest.mark.skipif(not Path("/proc/meminfo").exists(), reason="reads /proc/meminfo")
def test_up_refuses_under_the_memory_floor(first_run):
    path, env = first_run
    result = _run(["up"], {**_with_fake_docker(path.parent, env), "MIN_FREE_MEM_GB": "999999"})
    assert result.returncode == 1 and "memory free" in result.stderr
    assert "compose" not in result.stdout


@needs_bash
def test_up_refuses_under_the_docker_root_floor_before_it_builds(first_run, tmp_path):
    path, env = first_run
    result = _run(["up"], {**_with_fake_docker(path.parent, env), "FAKE_DOCKER_ROOT": str(tmp_path),
                           "MIN_DOCKER_FREE_GB": "99999999"})
    assert result.returncode == 1 and "under the floor" in result.stderr and "malachi-prune" in result.stderr
    assert "FAIL  docker root" in result.stdout
    assert "compose" not in result.stdout
    assert not Path(env["DATA_DIR"]).exists()


@needs_bash
def test_up_builds_over_the_docker_root_floor(first_run, tmp_path):
    path, env = first_run
    result = _run(["up"], {**_with_fake_docker(path.parent, env), "FAKE_DOCKER_ROOT": str(tmp_path),
                           "MIN_DOCKER_FREE_GB": "0", "EDGE": "off"})
    assert result.returncode == 0, result.stderr
    assert "up -d --build web tools" in result.stdout


@needs_bash
def test_up_builds_when_docker_root_is_not_on_this_host(first_run):
    path, env = first_run
    result = _run(["up"], {**_with_fake_docker(path.parent, env), "FAKE_DOCKER_ROOT": "/no/such/root",
                           "MIN_DOCKER_FREE_GB": "99999999", "EDGE": "off"})
    assert result.returncode == 0, result.stderr
    assert "skip  docker root" in result.stdout


@needs_bash
@pytest.mark.parametrize("edge", ["on", "off"])
def test_up_prunes_this_stacks_images_and_no_one_elses(first_run, edge):
    path, env = first_run
    result = _run(["up"], {**_with_fake_docker(path.parent, env), "MALACHI_PROJECT": "own-stack", "EDGE": edge})
    assert result.returncode == 0, result.stderr
    rows = [row.split("|")[2] for row in result.stdout.splitlines() if "prune -f" in row]
    assert rows == ["image prune -f --filter label=com.docker.compose.project=own-stack"]


@needs_bash
def test_up_survives_a_prune_the_daemon_refuses(first_run):
    """The stack is up by then, so a failure here must not stop malachi-deploy's check."""
    path, env = first_run
    result = _run(["up"], {**_with_fake_docker(path.parent, env), "FAKE_IMAGE_PRUNE_FAILS": "1"})
    assert result.returncode == 0, result.stderr
    assert "could not remove the replaced images" in result.stderr


@needs_bash
def test_prune_reaches_the_build_cache_only_when_asked(first_run):
    path, env = first_run
    result = _run(["prune"], {**_with_fake_docker(path.parent, env), "MALACHI_PROJECT": "own-stack"})
    assert result.returncode == 0, result.stderr
    assert [row.split("|")[2] for row in result.stdout.splitlines()] == [
        "image prune -f --filter label=com.docker.compose.project=own-stack",
        "builder prune -f --filter until=168h",
    ]


@needs_bash
@pytest.mark.parametrize(("name", "command"), [("MIN_FREE_MEM_GB", "up"), ("MIN_DOCKER_FREE_GB", "up"),
                                               ("MIN_FREE_GB", "backup"), ("KEEP", "backup"),
                                               ("TAIL", "logs"), ("MIN_FREE_GB", "check")])
@pytest.mark.parametrize("value", ["abc", "1.5", "-1"])
def test_a_number_that_is_not_one_is_refused(first_run, name, command, value):
    path, env = first_run
    Path(env["DATA_DIR"]).mkdir(exist_ok=True)
    result = _run([command], {**_with_fake_docker(path.parent, env), name: value})
    assert result.returncode == 1 and "whole number" in result.stderr


@needs_bash
def test_backup_refuses_under_the_disk_floor(first_run):
    path, env = first_run
    data = Path(env["DATA_DIR"])
    (data / "backups").mkdir(parents=True)
    result = _run(["backup"], {**_with_fake_docker(path.parent, env), "MIN_FREE_GB": "99999999"})
    assert result.returncode == 1 and "under the floor" in result.stderr
    assert list((data / "backups").iterdir()) == []


def _finished_backups(env: dict[str, str], *names: str) -> Path:
    backups = Path(env["DATA_DIR"]) / "backups"
    for name in names:
        (backups / name).mkdir(parents=True)
        (backups / name / "manifest.txt").write_text("git_sha=x\nledger_rows=1\n", encoding="utf-8")
    return backups


def _finished(backups: Path) -> list[str]:
    return sorted(p.name for p in backups.iterdir() if (p / "manifest.txt").exists())


@needs_bash
@pytest.mark.parametrize("keep", ["1", "2", "13"])
def test_backup_under_the_default_keep_asks_first(first_run, keep):
    """KEEP is read from the ambient shell as well, and pruning runs before any restore check."""
    path, env = first_run
    backups = _finished_backups(env, "20260101T000000Z", "20260102T000000Z")
    result = _run(["backup"], {**_with_fake_docker(path.parent, env), "KEEP": keep, "MIN_FREE_GB": "0"})
    assert result.returncode == 1 and "pass CONFIRM=yes" in result.stderr
    assert "compose" not in result.stdout
    assert _finished(backups) == ["20260101T000000Z", "20260102T000000Z"]


@needs_bash
def test_backup_under_the_default_keep_prunes_once_confirmed(first_run):
    path, env = first_run
    backups = _finished_backups(env, "20260101T000000Z", "20260102T000000Z")
    result = _run(["backup"], {**_with_fake_docker(path.parent, env), "KEEP": "2", "CONFIRM": "yes", "MIN_FREE_GB": "0"})
    assert result.returncode == 0, result.stderr
    kept = _finished(backups)
    assert len(kept) == 2 and "20260101T000000Z" not in kept and "20260102T000000Z" in kept


@needs_bash
@pytest.mark.parametrize("given", [{}, {"KEEP": "14"}, {"KEEP": "30"}])
def test_backup_at_or_over_the_default_keep_does_not_ask(first_run, given):
    path, env = first_run
    backups = _finished_backups(env, "20260101T000000Z")
    result = _run(["backup"], {**_with_fake_docker(path.parent, env), **given, "MIN_FREE_GB": "0"})
    assert result.returncode == 0, result.stderr
    assert len(_finished(backups)) == 2


# ── malachi-check's HTTP half ────────────────────────────────────────────────

GOOD_ROUTES: dict[tuple[str, str], tuple[int, dict[str, str], bytes]] = {
    ("GET", "/livez"): (200, {}, b'{"ok":true}'),
    ("GET", "/.well-known/oauth-protected-resource/mcp"): (200, {}, b'{"resource":"http://x/mcp"}'),
    ("POST", "/mcp"): (401, {"WWW-Authenticate": 'Bearer resource_metadata="http://x/m"'}, b"{}"),
    ("GET", "/auth/config"): (200, {}, b'{"familysearch":true,"devLogin":false,"openrouter":false}'),
}


class _Stub(http.server.BaseHTTPRequestHandler):
    routes: dict = GOOD_ROUTES

    def _answer(self) -> None:
        self.rfile.read(int(self.headers.get("Content-Length") or 0))
        status, headers, body = self.routes.get((self.command, self.path), (404, {}, b"{}"))
        self.send_response(status)
        for key, value in headers.items():
            self.send_header(key, value)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    do_GET = do_POST = _answer

    def log_message(self, *args: Any) -> None:
        pass


@pytest.fixture
def stub() -> Iterator[Callable[[dict], str]]:
    servers = []

    def start(routes: dict) -> str:
        handler = type("Handler", (_Stub,), {"routes": routes})
        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        servers.append(server)
        return f"http://127.0.0.1:{server.server_address[1]}"

    yield start
    for server in servers:
        server.shutdown()
        server.server_close()


def _routes(**changes: Any) -> dict:
    keys = {"livez": ("GET", "/livez"), "metadata": ("GET", "/.well-known/oauth-protected-resource/mcp"),
            "mcp": ("POST", "/mcp"), "config": ("GET", "/auth/config"), "healthz": ("GET", "/healthz"),
            "health": ("GET", "/api/health"), "index": ("GET", "/index.html"), "sessions": ("GET", "/api/sessions")}
    return {**GOOD_ROUTES, **{keys[k]: v for k, v in changes.items()}}


@needs_bash
def test_check_http_passes_the_right_answers(stub, tmp_path):
    result = _run(["check-http", stub(GOOD_ROUTES)], _script_env(tmp_path))
    assert result.returncode == 0, result.stdout + result.stderr
    assert "FAIL" not in result.stdout


FAULTS = [
    ("/healthz", {"healthz": (200, {}, b"{}")}),
    ("/api/health", {"health": (200, {}, b"{}")}),
    ("/livez", {"livez": (500, {}, b"{}")}),
    ("unauthenticated POST /mcp", {"mcp": (200, {}, b"{}")}),
    ("unauthenticated POST /mcp", {"mcp": (401, {}, b"{}")}),
    ("metadata", {"metadata": (200, {}, b'{"resource":"http://x/other"}')}),
    ("metadata", {"metadata": (404, {}, b"{}")}),
    ("/index.html", {"index": (200, {}, b"<html>")}),
    ("/api/sessions", {"sessions": (200, {}, b"[]")}),
    ("/auth/config", {"config": (200, {}, b'{"familysearch":true,"devLogin":true,"openrouter":false}')}),
    ("/auth/config", {"config": (200, {}, b'{"familysearch":false,"devLogin":false,"openrouter":false}')}),
    ("/auth/config", {"config": (200, {}, b'{"familysearch":true,"devLogin":false,"openrouter":true}')}),
    ("/auth/config", {"config": (200, {}, b'{"familysearch":true,"devLogin":false}')}),
]


@needs_bash
@pytest.mark.parametrize(("line", "changes"), FAULTS, ids=[f"{i}-{f[0]}" for i, f in enumerate(FAULTS)])
def test_check_http_fails_a_planted_fault_and_names_it(stub, tmp_path, line, changes):
    result = _run(["check-http", stub(_routes(**changes))], _script_env(tmp_path))
    assert result.returncode == 1
    assert any(row.strip().startswith("FAIL") and line in row for row in result.stdout.splitlines()), result.stdout


@needs_bash
def test_check_http_fails_with_nothing_listening(tmp_path):
    result = _run(["check-http", "http://127.0.0.1:9"], _script_env(tmp_path))
    assert result.returncode == 1 and "/livez: got 000" in result.stdout


# ── scripts/tailscale-services.sh ────────────────────────────────────────────

FAKE_CURL = """#!/bin/sh
for arg in "$@"; do url=$arg; done
case $url in
  */wiki/openapi.json) printf %s "$FAKE_WIKI" ;;
  */pop-stats/openapi.json) printf %s "$FAKE_POP" ;;
  */livez) printf %s "$FAKE_SLOT" ;;
  */auth/config) printf %s "${FAKE_CONFIG:-$FAKE_SLOT}" ;;
  *) printf 000; exit 7 ;;
esac
"""


def _fake_curl(tmp_path: Path) -> Path:
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    fake = bin_dir / "curl"
    fake.write_text(FAKE_CURL, encoding="utf-8")
    fake.chmod(0o755)
    return bin_dir


def _tailscale_check(tmp_path: Path, wiki: str, pop: str, slot: str, config: str = "") -> subprocess.CompletedProcess:
    env = {"PATH": f"{_fake_curl(tmp_path)}{os.pathsep}{os.environ['PATH']}", "FAKE_WIKI": wiki, "FAKE_POP": pop,
           "FAKE_SLOT": slot, "FAKE_CONFIG": config}
    return subprocess.run([BASH, str(TAILSCALE), "check"], env=env, capture_output=True, text=True, encoding="utf-8",
                          timeout=60)


@needs_bash
@pytest.mark.parametrize("slot", ["502", "200"])
def test_tailscale_check_accepts_an_empty_slot_and_a_live_edge(tmp_path, slot):
    result = _tailscale_check(tmp_path, "200", "200", slot)
    assert result.returncode == 0, result.stdout


@needs_bash
@pytest.mark.parametrize("slot", ["404", "000", "301"])
def test_tailscale_check_fails_anything_else_at_the_slot(tmp_path, slot):
    result = _tailscale_check(tmp_path, "200", "200", slot)
    assert result.returncode == 1 and "FAIL" in result.stdout


@needs_bash
def test_tailscale_check_fails_a_process_that_answers_livez_but_is_not_the_stack(tmp_path):
    """The connector probe and a bare tool server both serve /livez, and neither /auth/config."""
    result = _tailscale_check(tmp_path, "200", "200", "200", "404")
    assert result.returncode == 1
    assert any(row.strip().startswith("FAIL") and "/auth/config" in row for row in result.stdout.splitlines())


@needs_bash
def test_tailscale_check_passes_a_web_tier_gone_behind_a_live_edge(tmp_path):
    assert _tailscale_check(tmp_path, "200", "200", "502", "502").returncode == 0


@needs_bash
def test_tailscale_check_still_needs_wiki_and_pop_stats(tmp_path):
    assert _tailscale_check(tmp_path, "502", "200", "200").returncode == 1


@needs_bash
def test_check_public_runs_the_ingress_check_and_the_http_half(first_run, tmp_path):
    """`malachi-check PUBLIC=1`'s two halves, with curl faked: the live edge answers nothing
    the HTTP half wants, so it must fail even though the script's own check passes."""
    _path, env = first_run
    bin_dir = _fake_curl(tmp_path)
    fake_env = {**env, "PATH": f"{bin_dir}{os.pathsep}{env['PATH']}", "FAKE_WIKI": "200", "FAKE_POP": "200",
                "FAKE_SLOT": "200"}
    result = _run(["check-public"], fake_env)
    assert result.returncode == 1
    assert "reserved /livez" in result.stdout and "checking https://example.test" in result.stdout

    off = _run(["check-public"], {**fake_env, "EDGE": "off", "FAKE_SLOT": "502"})
    assert off.returncode == 0, off.stdout + off.stderr
    assert "checking https://example.test" not in off.stdout

    held = _run(["check-public"], {**fake_env, "EDGE": "off", "FAKE_SLOT": "200"})
    assert held.returncode == 1 and "public slot empty: got 200" in held.stdout


# ── openrouter_seed ──────────────────────────────────────────────────────────


@pytest.fixture
def seed_module():
    sys.path.insert(0, str(SERVER / "proto"))
    sys.path.insert(0, str(MALACHI))
    try:
        import openrouter_seed
        yield openrouter_seed
    finally:
        sys.path.remove(str(MALACHI))
        sys.path.remove(str(SERVER / "proto"))


def _seed_main(module: Any, monkeypatch: pytest.MonkeyPatch, stdin: str, found: bool) -> tuple[int, list[tuple]]:
    calls: list[tuple] = []

    def seed(dsn: str, email: str, key: str) -> bool:
        calls.append((dsn, email, key))
        return found

    monkeypatch.setenv("PG_DSN", "unused")
    monkeypatch.setattr(module, "seed", seed)
    monkeypatch.setattr(sys, "stdin", io.StringIO(stdin))
    return module.main(["--email", "a@example.test"]), calls


def test_seed_takes_the_key_from_stdin_and_never_prints_it(seed_module, monkeypatch, capsys):
    status, calls = _seed_main(seed_module, monkeypatch, "sk-or-secret\n", True)
    assert status == 0 and calls == [("unused", "a@example.test", "sk-or-secret")]
    printed = capsys.readouterr()
    assert "sk-or-secret" not in printed.out + printed.err and "a@example.test" in printed.out


def test_seed_refuses_a_blank_key_without_touching_a_row(seed_module, monkeypatch, capsys):
    status, calls = _seed_main(seed_module, monkeypatch, " \n", True)
    assert status == 2 and calls == []
    assert "no key" in capsys.readouterr().err


def test_seed_says_when_no_such_user_exists(seed_module, monkeypatch, capsys):
    status, _calls = _seed_main(seed_module, monkeypatch, "sk-or-secret", False)
    assert status == 1
    printed = capsys.readouterr()
    assert "no user a@example.test" in printed.err and "sk-or-secret" not in printed.out + printed.err


def test_seed_takes_no_key_on_the_command_line(seed_module):
    with pytest.raises(SystemExit):
        seed_module.main(["--email", "a@example.test", "--key", "sk-or-secret"])


@needs_bash
def test_malachi_openrouter_needs_an_email(first_run):
    path, env = first_run
    result = _run(["openrouter"], _with_fake_docker(path.parent, env))
    assert result.returncode == 1 and "EMAIL= is required" in result.stderr
    assert "compose" not in result.stdout


@needs_bash
def test_malachi_openrouter_refuses_a_blank_key(first_run):
    path, env = first_run
    result = _run(["openrouter"], {**_with_fake_docker(path.parent, env), "EMAIL": "a@example.test"})
    assert result.returncode == 1 and "OPENROUTER_SEED_KEY is blank" in result.stderr
    assert "compose" not in result.stdout


@needs_bash
def test_malachi_openrouter_sends_the_key_on_stdin_and_never_argv(first_run, tmp_path):
    path, env = first_run
    path.write_text(path.read_text(encoding="utf-8").replace("OPENROUTER_SEED_KEY=\n", "OPENROUTER_SEED_KEY=sk-or-secret\n"),
                    encoding="utf-8")
    stdin = tmp_path / "stdin"
    result = _run(["openrouter"], {**_with_fake_docker(path.parent, env), "EMAIL": "a@example.test",
                                   "FAKE_DOCKER_STDIN": str(stdin)})
    assert result.returncode == 0, result.stderr
    assert stdin.read_text(encoding="utf-8") == "sk-or-secret"
    assert "sk-or-secret" not in result.stdout + result.stderr
    assert "openrouter_seed.py --email a@example.test" in result.stdout


@needs_bash
def test_malachi_openrouter_fails_when_the_seed_does(first_run):
    path, env = first_run
    path.write_text(path.read_text(encoding="utf-8").replace("OPENROUTER_SEED_KEY=\n", "OPENROUTER_SEED_KEY=k\n"),
                    encoding="utf-8")
    fake_env = _with_fake_docker(path.parent, env)
    fake = Path(fake_env["PATH"].split(os.pathsep)[0]) / "docker"
    fake.write_text("#!/bin/sh\ncat >/dev/null\nexit 1\n", encoding="utf-8")
    assert _run(["openrouter"], {**fake_env, "EMAIL": "a@example.test"}).returncode != 0


# ── project_export ───────────────────────────────────────────────────────────


@pytest.fixture
def export_module():
    sys.path.insert(0, str(SERVER / "proto"))
    sys.path.insert(0, str(MALACHI))
    try:
        import project_export
        yield project_export
    finally:
        sys.path.remove(str(MALACHI))
        sys.path.remove(str(SERVER / "proto"))


class _Store:
    def __init__(self, docs: dict, index: list) -> None:
        self.docs, self.index = docs, index

    async def documents(self, project_id: str) -> dict:
        return self.docs

    async def blob_index(self, project_id: str) -> list:
        return self.index


class _Blobs:
    def __init__(self, objects: dict[str, bytes]) -> None:
        self.objects = objects

    def get(self, key: str) -> bytes:
        return self.objects[key]


def _export(module: Any, store: _Store, blobs: _Blobs, out: Path, project: str = "proj_a") -> Path:
    import asyncio

    return asyncio.run(module.export_project(store, blobs, project, out))


def test_export_writes_the_documents_and_the_files(export_module, tmp_path):
    store = _Store({"research.json": (3, {"project": {"id": "x"}})},
                   [("uploads/deed.pdf", "s3/deed", 4), ("images/a.jpg", "s3/a", 3)])
    dest = _export(export_module, store, _Blobs({"s3/deed": b"%PDF", "s3/a": b"jpg"}), tmp_path)
    assert dest == tmp_path / "proj_a"
    assert json.loads((dest / "research.json").read_text(encoding="utf-8"))["project"]["id"] == "x"
    assert (dest / "uploads" / "deed.pdf").read_bytes() == b"%PDF"
    assert not (dest / "MISSING.txt").exists()


def test_export_names_an_unreadable_blob_in_missing(export_module, tmp_path):
    store = _Store({"research.json": (1, {})}, [("uploads/gone.pdf", "s3/gone", 4), ("uploads/ok.pdf", "s3/ok", 2)])
    dest = _export(export_module, store, _Blobs({"s3/ok": b"ok"}), tmp_path)
    assert "uploads/gone.pdf" in (dest / "MISSING.txt").read_text(encoding="utf-8")
    assert (dest / "uploads" / "ok.pdf").read_bytes() == b"ok"


def test_export_keeps_a_climbing_key_inside_the_folder(export_module, tmp_path):
    out = tmp_path / "out"
    out.mkdir()
    store = _Store({"research.json": (1, {})}, [("../../evil.txt", "s3/e", 1), ("uploads/../../evil2.txt", "s3/e", 1)])
    dest = _export(export_module, store, _Blobs({"s3/e": b"x"}), out)
    escaped = [p for p in tmp_path.rglob("evil*") if dest not in p.parents]
    assert escaped == []


def test_export_replaces_an_earlier_export(export_module, tmp_path):
    (tmp_path / "proj_a").mkdir()
    (tmp_path / "proj_a" / "stale.txt").write_text("old", encoding="utf-8")
    dest = _export(export_module, _Store({"research.json": (1, {})}, []), _Blobs({}), tmp_path)
    assert not (dest / "stale.txt").exists()


def test_export_refuses_an_unknown_project(export_module, tmp_path):
    with pytest.raises(LookupError):
        _export(export_module, _Store({}, []), _Blobs({}), tmp_path)


@pytest.mark.parametrize("project", ["../up", "a/b", ".."])
def test_export_refuses_a_project_id_that_is_not_a_folder_name(export_module, tmp_path, project):
    with pytest.raises(ValueError):
        _export(export_module, _Store({"research.json": (1, {})}, []), _Blobs({}), tmp_path, project)


def test_export_of_several_projects_survives_an_empty_one(export_module, tmp_path, monkeypatch, capsys):
    stores = {"proj_a": _Store({}, []), "proj_b": _Store({"research.json": (1, {})}, [])}

    class Store:
        def __init__(self, _dsn: str) -> None:
            pass

        async def documents(self, project_id: str) -> dict:
            return await stores[project_id].documents(project_id)

        async def blob_index(self, project_id: str) -> list:
            return await stores[project_id].blob_index(project_id)

    monkeypatch.setenv("PG_DSN", "unused")
    monkeypatch.setattr(export_module, "projects_of", lambda _dsn, _email: ["proj_a", "proj_b"])
    monkeypatch.setattr(export_module.blobstore, "from_env", lambda _env: _Blobs({}))
    monkeypatch.setattr(export_module.web_app, "PgStore", Store)
    assert export_module.main(["--email", "a@example.test", "--out", str(tmp_path)]) == 1
    assert (tmp_path / "proj_b" / "research.json").exists()
    assert "proj_a has no documents" in capsys.readouterr().err


def test_export_says_when_files_were_left_out(export_module, tmp_path, monkeypatch, capsys):
    store = _Store({"research.json": (1, {})}, [("uploads/gone.pdf", "s3/gone", 4)])
    monkeypatch.setenv("PG_DSN", "unused")
    monkeypatch.setattr(export_module.blobstore, "from_env", lambda _env: _Blobs({}))
    monkeypatch.setattr(export_module.web_app, "PgStore", lambda _dsn: store)
    assert export_module.main(["--project", "proj_a", "--out", str(tmp_path)]) == 0
    assert "MISSING.txt names files left out" in capsys.readouterr().out


@needs_bash
@pytest.mark.parametrize("given", [{}, {"EMAIL": "a@b.c", "PROJECT": "proj_a"}])
def test_malachi_export_needs_exactly_one_selector(first_run, given):
    _path, env = first_run
    result = _run(["export"], {**env, **given})
    assert result.returncode == 1 and "exactly one" in result.stderr

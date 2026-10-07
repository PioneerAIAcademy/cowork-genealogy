#!/usr/bin/env python3
"""U13's rehearsal deploy of the search-agent prototype into one AWS account (us-east-1).

Provisioner, teardown, empty-proof, probe cases and the account-id leak check, in one stdlib
script that shells out to the ``aws`` CLI (no boto3). Usage and the rules it enforces:
README.md beside this file; the plan is docs/plan/familysearch-handoff.md, section 3.

Subcommands: plan, up --phase ..., status, probe --case ..., down, prove-empty, leak-check.
Every mutating subcommand takes --dry-run, which calls nothing and prints pasteable
commands. Secret values and option settings reach the CLI only as 0600 ``file://`` paths
under --work-dir, never as argv.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import importlib.util
import json
import os
import re
import secrets as pysecrets
import shlex
import subprocess
import sys
import time
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
LOCAL_DIR = HERE / ".local"
PROTO = REPO / "apps" / "server" / "proto"
LAYOUT_PY = REPO / "scripts" / "eb_bundles" / "layout.py"
EVAL_ENV = REPO / "eval" / ".env"

REGION = "us-east-1"
PREFIX = "genealogy-u13"
IAM_PATH = f"/{PREFIX}/"
TAG_REHEARSAL = ("genealogy:rehearsal", "u13")
TAG_RUN = "genealogy:run"
APP = PREFIX
TIERS = ("web", "worker", "tools")
ENV_NAMES = {tier: f"{PREFIX}-{tier}" for tier in TIERS}
THROWAWAY_PREFIX = f"{PREFIX}-x-"
INSTANCE_TYPES = {"web": "t3.small", "worker": "t3.large", "tools": "t3.small", "bastion": "t3.micro"}
STACK_PATTERNS = {"web": r"^64bit Amazon Linux 2023 v([\d.]+) running Python 3\.12$",
                  "worker": r"^64bit Amazon Linux 2023 v([\d.]+) running Python 3\.12$",
                  "tools": r"^64bit Amazon Linux 2023 v([\d.]+) running Node\.js 24$"}
BASTION_AMI_PARAM = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64"

RDS_ID = f"{PREFIX}-pg"
RDS_SUBNET_GROUP = f"{PREFIX}-pg"
RDS_PARAM_GROUP = f"{PREFIX}-pg16"
RDS_CLASS = "db.t4g.micro"
RDS_ENGINE_VERSION = "16.13"
RDS_FAMILY = "postgres16"
DB_NAME = "genealogy"
DB_OWNER = "genealogy_owner"
DB_DML = "genealogy_dml"
# The tables H:225 grants to the DML role; the test pins them against sql/*.sql.
DML_TABLES = ("projects", "documents", "blobs", "staging", "sessions", "turns", "session_events",
              "session_seq", "session_activity", "session_entries", "tool_calls", "users",
              "allowed_emails", "familysearch_tokens")

BUDGET_NAME = PREFIX
BUDGET_MARGIN_USD = 15.0
BUDGET_EARLY_ALERT_USD = 5.0
RESOLVER_NAME = PREFIX
RESOLVER_LOG_GROUP = f"/{PREFIX}/resolver"
EB_LOG_PREFIX = f"/aws/elasticbeanstalk/{PREFIX}"
STORAGE_PREFIX = f"{PREFIX}/"
MIGRATE_POLICY = f"{PREFIX}-migrate"

# Loopback sign-in: the dev key's registered callback.
LOOPBACK_PUBLIC_URL = "http://127.0.0.1:1837"
SIGNIN_NAMES = ("PUBLIC_URL", "FAMILYSEARCH_WEB_ENABLED", "ALLOWED_EMAILS")

ENV_NS = "aws:elasticbeanstalk:application:environment"
SECRETS_NS = "aws:elasticbeanstalk:application:environmentsecrets"
SQSD_NS = "aws:elasticbeanstalk:sqsd"
LC_NS = "aws:autoscaling:launchconfiguration"
ASG_NS = "aws:autoscaling:asg"
INSTANCES_NS = "aws:ec2:instances"
VPC_NS = "aws:ec2:vpc"
EBENV_NS = "aws:elasticbeanstalk:environment"
ELBV2_NS = "aws:elbv2:loadbalancer"
MANAGED_NS = "aws:elasticbeanstalk:managedactions"
HEALTH_NS = "aws:elasticbeanstalk:healthreporting:system"

# The sqsd options whose values the worker also reads from its environment (U5).
# ErrorVisibilityTimeout has none.
MIRRORS = {"MaxRetries": "SQSD_MAX_RETRIES", "VisibilityTimeout": "SQSD_VISIBILITY_TIMEOUT_S",
           "RetentionPeriod": "SQSD_RETENTION_PERIOD_S"}
SQSD_CONFIG = PROTO / "eb-worker" / ".ebextensions" / "01-sqsd.config"

# test_proto_bundles.py's EB_VALUE and SECRET_NAME; the test pins these copies equal.
EB_VALUE = re.compile(r"""^[A-Za-z0-9 _.:/=+\\\-@'"]*$""")
SECRET_NAME = re.compile(r"KEY|SECRET|TOKEN|PASSWORD|DSN")
EB_ENV_TOTAL_BYTES = 4096

# Secrets, by Secrets Manager name suffix, and the variable each tier maps to one.
SECRET_KEYS = ("web/pg-dsn", "web/session-secret", "shared/fs-token-enc-key", "worker/pg-dsn",
               "worker/anthropic-api-key", "tools/pg-dsn")
TIER_SECRETS = {
    "web": {"PG_DSN": "web/pg-dsn", "SESSION_SECRET": "web/session-secret",
            "FS_TOKEN_ENC_KEY": "shared/fs-token-enc-key"},
    "worker": {"PG_DSN": "worker/pg-dsn", "FS_TOKEN_ENC_KEY": "shared/fs-token-enc-key",
               "ANTHROPIC_API_KEY": "worker/anthropic-api-key"},
    "tools": {"GENEALOGY_PG_DSN": "tools/pg-dsn"},
}
MANAGED = {
    "web": ("AWSElasticBeanstalkWebTier", "AmazonSSMManagedInstanceCore"),
    "worker": ("AWSElasticBeanstalkWorkerTier", "AmazonSSMManagedInstanceCore"),
    "tools": ("AWSElasticBeanstalkWebTier", "AmazonSSMManagedInstanceCore"),
    "bastion": ("AmazonSSMManagedInstanceCore",),
    "service": ("service-role/AWSElasticBeanstalkEnhancedHealth",
                "AWSElasticBeanstalkManagedUpdatesCustomerRolePolicy"),
}
ROLES = ("service", "web", "worker", "tools", "bastion")
PROFILES = ("web", "worker", "tools", "bastion")
# Security groups: name suffix -> [(port, source group suffix)].
SECURITY_GROUPS = {"web": [], "worker": [], "tools": [], "tools-alb": [(80, "worker")],
                   "rds": [(5432, "web"), (5432, "worker"), (5432, "tools")]}
SG_DELETE_ORDER = ("rds", "tools-alb", "web", "worker", "tools")

PHASES = ("guard", "iam", "net", "stores", "secrets", "bastion", "versions", "tools", "worker",
          "queue", "web", "migrate")
OPTIONAL_PHASES = ("signin", "resolver")
# Every kind `up` records; `down` deletes each and `prove-empty` checks each.
KINDS = ("budget", "iam-role", "instance-profile", "sg", "db-subnet-group", "db-param-group", "rds",
         "s3", "secret", "ec2", "app", "eb-storage", "env", "log-group", "resolver")

# Beanstalk answers a missing environment or application with InvalidParameterValue and
# "No Environment found for EnvironmentName = '...'" / "No Application named '...' found."
NOT_FOUND = re.compile(
    r"NotFound|NoSuchEntity|NoSuchBucket|\(404\)|Not Found|does not exist|NonExistentQueue|"
    r"ResourceNotFoundException|InvalidInstanceID\.Malformed|No Environment found|No Application named", re.I)
RDS_DELETING = re.compile(r"NotFound|InvalidDBInstanceState.*(deleting|being deleted)", re.I)
EB_TRANSITIONAL = ("Launching", "Updating", "Aborting", "LinkingFrom", "LinkingTo")
ALREADY = re.compile(r"AlreadyExists|BucketAlreadyOwnedByYou|InvalidPermission\.Duplicate|"
                     r"DuplicateRecord|EntityAlreadyExists|ResourceExistsException|DuplicateRecordException",
                     re.I)
DEPENDENCY = re.compile(r"DependencyViolation", re.I)
REMOVE = object()


class Die(Exception):
    def __init__(self, message: str, rc: int = 2):
        super().__init__(message)
        self.rc = rc


def _load_layout():
    spec = importlib.util.spec_from_file_location("eb_bundles_layout", LAYOUT_PY)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


layout = _load_layout()


# ── the .ebextensions subset this script reads ────────────────────────────────────────


def parse_ebextensions(text: str) -> dict[str, dict[str, str]]:
    """``option_settings`` of a tier template: two levels, every value a quoted scalar. Any
    other shape raises, so a template edit cannot be read silently wrong."""
    out: dict[str, dict[str, str]] = {}
    namespace = None
    seen_root = False
    for raw in text.splitlines():
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        if raw == "option_settings:":
            seen_root = True
            continue
        ns = re.match(r"^  ([A-Za-z0-9:_-]+):\s*$", raw)
        if ns and seen_root:
            namespace = ns.group(1)
            if namespace in out:
                raise ValueError(f"namespace {namespace} repeated")
            out[namespace] = {}
            continue
        opt = re.match(r'^    ([A-Za-z0-9_]+):\s*"([^"]*)"\s*$', raw)
        if opt and namespace:
            if opt.group(1) in out[namespace]:
                raise ValueError(f"{namespace} {opt.group(1)} repeated")
            out[namespace][opt.group(1)] = opt.group(2)
            continue
        raise ValueError(f"unsupported .ebextensions line: {raw!r}")
    if not seen_root:
        raise ValueError("no option_settings")
    return out


def sqsd_template() -> dict[str, dict[str, str]]:
    """Both namespaces of 01-sqsd.config, which `up --phase worker` sets at API level."""
    parsed = parse_ebextensions(SQSD_CONFIG.read_text(encoding="utf-8"))
    return {SQSD_NS: parsed[SQSD_NS], ENV_NS: parsed[ENV_NS]}


def template_env(tier: str) -> dict[str, str]:
    env: dict[str, str] = {}
    for path in sorted((REPO / layout.TEMPLATE_DIRS[tier] / ".ebextensions").glob("*.config")):
        env.update(parse_ebextensions(path.read_text(encoding="utf-8")).get(ENV_NS, {}))
    return env


def opt(namespace: str, name: str, value) -> dict:
    return {"Namespace": namespace, "OptionName": name, "Value": str(value)}


def options_map(options: list[dict]) -> dict[tuple[str, str], str]:
    return {(o["Namespace"], o["OptionName"]): o["Value"] for o in options}


# ── guards ────────────────────────────────────────────────────────────────────────────


def is_dev_setting(tier: str, name: str, value: str) -> bool:
    return (name.startswith(layout.DEV_PREFIXES) or name in layout.DEV_VARIABLES
            or name in layout.DEV_VARIABLES_BY_TIER.get(tier, frozenset())
            or layout.DEV_VALUES.get(name) == value)


PLACEHOLDER = re.compile(r"<[a-z0-9-]+>")


def check_options(tier: str, options: list[dict], *, signin: bool = False, case: dict | None = None,
                  dry: bool = False) -> None:
    """Refuse an option-settings list `up` or a probe case is about to send.

    Outside a case: no dev-only name or value (layout.py), no secret-shaped name in the
    plain environment, every value inside Beanstalk's character set, and no sign-in
    setting except from the signin phase. Everywhere: each sqsd option with a mirror is set
    with that mirror, at the same value."""
    problems = []
    names = options_map(options)
    if dry:
        names = {k: PLACEHOLDER.sub("x", v) for k, v in names.items()}
    allowed = set(case.get("allow", ())) if case else set()
    for (namespace, name), value in names.items():
        if namespace == ENV_NS:
            if is_dev_setting(tier, name, value) and name not in allowed:
                problems.append(f"{name} is dev-only (layout.py); only a probe case may set it")
            if SECRET_NAME.search(name) and name not in allowed:
                problems.append(f"{name} looks like a secret; map it through {SECRETS_NS}")
            if not EB_VALUE.match(value) and not (case and case.get("charset_probe")):
                problems.append(f"{name}'s value is outside Beanstalk's environment-value set")
            if tier == "web" and name in SIGNIN_NAMES and not signin and name not in allowed:
                problems.append(f"{name} is set only by `up --phase signin`")
        if namespace == SECRETS_NS and not value.startswith(f"arn:aws:secretsmanager:{REGION}:"):
            problems.append(f"{name} in {SECRETS_NS} must be a Secrets Manager ARN")
    for option, mirror in MIRRORS.items():
        a, b = names.get((SQSD_NS, option)), names.get((ENV_NS, mirror))
        if (a is None) != (b is None) or (a is not None and int(a) != int(b)):
            problems.append(f"sqsd {option}={a} and its mirror {mirror}={b} must be set together, equal")
    if not (case and case.get("charset_probe")):
        env = dict(template_env(tier))
        env.update({n: v for (ns, n), v in names.items() if ns == ENV_NS})
        total = sum(len(k) + len(v) + 1 for k, v in env.items())
        if total > EB_ENV_TOTAL_BYTES:
            problems.append(f"environment properties total {total} bytes, over {EB_ENV_TOTAL_BYTES}")
    if problems:
        raise Die(f"{tier}: refusing option settings:\n  " + "\n  ".join(problems))


def read_local(name: str, local_dir: Path = LOCAL_DIR) -> str | None:
    path = local_dir / name
    if not path.is_file():
        return None
    value = path.read_text(encoding="utf-8").strip()
    return value or None


def secure_dir(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    os.chmod(path, 0o700)
    return path


def write_private(path: Path, text: str) -> Path:
    secure_dir(path.parent)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        fh.write(text)
    os.chmod(path, 0o600)
    return path


WORK_MARKER = ".genealogy-u13-work"


def inside_git(path: Path) -> bool:
    """True when the nearest existing ancestor of path is in any git work tree or git dir."""
    probe = path
    while not probe.exists():
        probe = probe.parent
    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
    res = subprocess.run(["git", "-C", str(probe if probe.is_dir() else probe.parent), "rev-parse", "--git-dir"],
                         capture_output=True, text=True, encoding="utf-8", check=False, env=env)
    return res.returncode == 0


def resolve_work_dir(raw: str | None, repo: Path = REPO) -> Path:
    """Refuse a work dir inside any git checkout (this worktree, the main checkout a
    .claude/worktrees/* checkout sits in, or any other). Create it 0700; adopt an existing
    directory only when it is empty or one this tool made, so it never chmods the operator's."""
    if not raw:
        raise Die("--work-dir is required: secret material and option files live there")
    path = Path(raw).expanduser().resolve()
    try:
        path.relative_to(repo.resolve())
        inside = True
    except ValueError:
        inside = inside_git(path)
    if inside:
        raise Die(f"--work-dir {path} is inside a git work tree; pick a directory outside every checkout")
    if path.exists():
        if not path.is_dir():
            raise Die(f"--work-dir {path} is not a directory")
        if not (path / WORK_MARKER).is_file() and any(path.iterdir()):
            raise Die(f"--work-dir {path} already holds files this tool did not write; pick a new or empty directory")
    secure_dir(path)
    (path / WORK_MARKER).touch()
    return path


def anthropic_key(env_file: Path) -> str:
    """The eval/.env key (or the environment's), never printed."""
    value = (os.environ.get("ANTHROPIC_API_KEY") or "").strip()
    if not value and env_file.is_file():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            m = re.match(r"^\s*(?:export\s+)?ANTHROPIC_API_KEY\s*=\s*(.*)$", line)
            if m:
                value = m.group(1).strip().strip("'\"")
    if not value:
        raise Die(f"no ANTHROPIC_API_KEY in the environment or {env_file}")
    return value


# ── probe cases (closed table) ─────────────────────────────────────────────────────────

# Each case: "measures", and either "ops" {tier: [(namespace, name, value | REMOVE)]},
# "throwaway" (a genealogy-u13-x-* environment created and terminated), or "rds_param".
# "allow" names the dev-only or secret-shaped names it may set, each with a literal,
# public or dummy value. Restores: a name in the env's snapshot is set back to its value;
# a name absent from it goes to --options-to-remove.
DEV_SESSION_SECRET = "dev-insecure-secret-change-me"
DEV_FS_TOKEN_ENC_KEY = "dev-insecure-fs-token-key-change-me"
CASES: dict[str, dict] = {
    "env_chars": {"measures": "env value charset", "charset_probe": True, "ops": {"web": [
        (ENV_NS, "U13_PROBE_QUESTION", "a?b"), (ENV_NS, "U13_PROBE_AMP", "a&b"),
        (ENV_NS, "U13_PROBE_COMMA", "a,b")]}},
    "env_4096": {"measures": "env properties size", "charset_probe": True, "ops": {"web": [
        (ENV_NS, f"U13_PROBE_PAD_{i}", "x" * 1000) for i in range(5)]}},
    "tools_single": {"measures": "tools without a load balancer", "throwaway": "tools_single"},
    "tools_classic": {"measures": "tools on the default load balancer", "throwaway": "tools_classic"},
    "ebext_naming": {"measures": ".ebextensions file naming", "throwaway": "ebext_naming"},
    "graviton_boot": {"measures": "worker boot on arm64", "throwaway": "graviton_boot"},
    "tools_no_pgsslmode": {"measures": "tools with RDS TLS off", "ops": {"tools": [(ENV_NS, "PGSSLMODE", "disable")]}},
    "tools_no_dsn": {"measures": "tools start refusal", "ops": {"tools": [(SECRETS_NS, "GENEALOGY_PG_DSN", REMOVE)]}},
    "tools_bad_path_style": {"measures": "tools start refusal", "ops": {"tools": [
        (ENV_NS, "GENEALOGY_S3_FORCE_PATH_STYLE", "maybe")]}},
    "tools_half_s3_pair": {"measures": "tools start refusal", "allow": ("GENEALOGY_S3_ACCESS_KEY",), "ops": {"tools": [
        (ENV_NS, "GENEALOGY_S3_ACCESS_KEY", "U13DUMMYACCESSKEY")]}},
    "worker_half_sqs": {"measures": "SQS settings refusal", "allow": ("GENEALOGY_SQS_ACCESS_KEY",), "ops": {"worker": [
        (ENV_NS, "GENEALOGY_SQS_ACCESS_KEY", "U13DUMMYACCESSKEY")]}},
    "web_half_sqs": {"measures": "SQS settings refusal", "allow": ("GENEALOGY_SQS_ACCESS_KEY",), "ops": {"web": [
        (ENV_NS, "GENEALOGY_SQS_ACCESS_KEY", "U13DUMMYACCESSKEY")]}},
    "sqs_region_contradicts": {"measures": "SQS settings refusal", "ops": {
        "web": [(ENV_NS, "GENEALOGY_SQS_REGION", "us-west-2")],
        "worker": [(ENV_NS, "GENEALOGY_SQS_REGION", "us-west-2")]}},
    "fast_errors": {"measures": "error redelivery delay", "ops": {"worker": [(SQSD_NS, "ErrorVisibilityTimeout", "10")]}},
    "maxretries_2": {"measures": "sqsd receive count", "ops": {"worker": [
        (SQSD_NS, "MaxRetries", "2"), (ENV_NS, "SQSD_MAX_RETRIES", "2")]}},
    "maxretries_1": {"measures": "sqsd receive count", "ops": {"worker": [
        (SQSD_NS, "MaxRetries", "1"), (ENV_NS, "SQSD_MAX_RETRIES", "1")]}},
    "tmpdir_bad": {"measures": "worker without a usable TMPDIR", "ops": {"worker": [(ENV_NS, "TMPDIR", "/nonexistent")]}},
    "worker_no_provider": {"measures": "worker start refusal", "ops": {"worker": [(ENV_NS, "MODEL_PROVIDER", REMOVE)]}},
    "worker_no_tool_url": {"measures": "worker start refusal", "ops": {"worker": [(ENV_NS, "TOOL_SERVER_URL", REMOVE)]}},
    "worker_blocked_tools": {"measures": "worker start refusal", "allow": ("BLOCKED_TOOLS",), "ops": {"worker": [
        (ENV_NS, "BLOCKED_TOOLS", "Bash")]}},
    "worker_no_queue_url": {"measures": "worker start refusal", "ops": {"worker": [(ENV_NS, "QUEUE_URL", REMOVE)]}},
    "worker_default_enc_key": {"measures": "worker start refusal", "allow": ("FS_TOKEN_ENC_KEY",), "ops": {"worker": [
        (SECRETS_NS, "FS_TOKEN_ENC_KEY", REMOVE), (ENV_NS, "FS_TOKEN_ENC_KEY", DEV_FS_TOKEN_ENC_KEY)]}},
    "web_no_queue_url": {"measures": "web start refusal", "ops": {"web": [(ENV_NS, "QUEUE_URL", REMOVE)]}},
    "default_session_secret": {"measures": "default-secret refusal with sign-in on", "allow": ("SESSION_SECRET",), "ops": {"web": [
        (SECRETS_NS, "SESSION_SECRET", REMOVE), (ENV_NS, "SESSION_SECRET", DEV_SESSION_SECRET)]}},
    "kill_window": {"measures": "redelivery window for a kill that also stops sqsd", "ops": {"worker": [
        (SQSD_NS, "InactivityTimeout", "1200"), (SQSD_NS, "VisibilityTimeout", "1500"),
        (ENV_NS, "SQSD_VISIBILITY_TIMEOUT_S", "1500")]}},
    "debug_hold": {"measures": "acceptance step 4's hold", "allow": ("GENEALOGY_DEBUG_HOLD_BEFORE_COMMIT_MS",), "ops": {"tools": [
        (ENV_NS, "GENEALOGY_DEBUG_HOLD_BEFORE_COMMIT_MS", "20000")]}},
    "refresh_age_0": {"measures": "grant refresh every turn", "ops": {"web": [(ENV_NS, "FS_GRANT_REFRESH_AGE_S", "0")]}},
    "cap_1usd": {"measures": "session spend cap", "ops": {"worker": [(ENV_NS, "SESSION_SPEND_CAP_USD", "1")]}},
    "idle_session_60s": {"measures": "Postgres idle-session timeout", "rds_param": ("idle_session_timeout", "60000")},
}


def case_options(case: dict, tier: str) -> tuple[list[dict], list[dict]]:
    """(settings, removals) for one tier of a case."""
    sets, removes = [], []
    for namespace, name, value in case.get("ops", {}).get(tier, []):
        if value is REMOVE:
            removes.append({"Namespace": namespace, "OptionName": name})
        else:
            sets.append(opt(namespace, name, value))
    return sets, removes


def restore_options(snapshot: list[dict], touched: list[tuple[str, str]]) -> tuple[list[dict], list[dict]]:
    """A touched name present in the snapshot is set back to its value; one absent from it
    is removed, never set to a value."""
    snap = options_map(snapshot)
    sets, removes = [], []
    for namespace, name in touched:
        if (namespace, name) in snap:
            sets.append(opt(namespace, name, snap[(namespace, name)]))
        else:
            removes.append({"Namespace": namespace, "OptionName": name})
    return sets, removes


# ── the AWS session ───────────────────────────────────────────────────────────────────


def default_runner(argv: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(argv, capture_output=True, text=True, encoding="utf-8", check=False)


class Rehearsal:
    def __init__(self, args, *, runner=None, sleep=time.sleep, out=None, local_dir: Path = LOCAL_DIR,
                 repo: Path = REPO):
        self.args = args
        self.runner = runner or default_runner
        self.sleep = sleep
        self.out = out or (lambda line: print(line, flush=True))
        self.local_dir = local_dir
        self.repo = repo
        self.dry = bool(getattr(args, "dry_run", False)) or args.cmd == "plan"
        self.work = resolve_work_dir(args.work_dir, repo)
        self.files = secure_dir(self.work / ("dry-run" if self.dry else "files"))
        self.inv_path = self.work / "inventory.json"
        self.inv = self._load_inventory()
        self.account = "<account>"

    # inventory

    def _load_inventory(self) -> dict:
        if self.inv_path.is_file():
            return json.loads(self.inv_path.read_text(encoding="utf-8"))
        return {"run_id": None, "resources": [], "state": {}}

    def save(self) -> None:
        if not self.dry:
            write_private(self.inv_path, json.dumps(self.inv, indent=2, sort_keys=True) + "\n")

    @property
    def state(self) -> dict:
        return self.inv["state"]

    def record(self, kind: str, rid: str, **extra) -> None:
        if kind not in KINDS:
            raise Die(f"internal: unknown kind {kind}")
        for item in self.inv["resources"]:
            if item["kind"] == kind and item["id"] == rid:
                item.update(extra)
                break
        else:
            self.inv["resources"].append({"kind": kind, "id": rid, **extra})
        self.save()

    def recorded(self, kind: str) -> list[dict]:
        return [r for r in self.inv["resources"] if r["kind"] == kind]

    @property
    def run_id(self) -> str:
        return self.inv.get("run_id") or getattr(self.args, "run_id", None) or "<run>"

    def fix_run_id(self) -> None:
        """`up` fixes the run id on its first run; every later command reads it back."""
        if self.inv.get("run_id"):
            return
        rid = getattr(self.args, "run_id", None) or (
            dt.datetime.now(dt.timezone.utc).strftime("%Y%m%d%H%M") + "-" + pysecrets.token_hex(2))
        if not re.fullmatch(r"[a-z0-9-]{4,24}", rid):
            raise Die(f"--run-id {rid!r}: 4-24 of a-z, 0-9 and -")
        if not self.dry:
            self.inv["run_id"] = rid
            self.save()

    @property
    def data_bucket(self) -> str:
        return f"{PREFIX}-data-{self.run_id}"

    def tags(self) -> list[tuple[str, str]]:
        return [TAG_REHEARSAL, (TAG_RUN, self.run_id)]

    def tags_kv(self) -> list[str]:
        return [f"Key={k},Value={v}" for k, v in self.tags()]

    def tags_ec2(self, resource_type: str) -> str:
        inner = ",".join(f"{{Key={k},Value={v}}}" for k, v in self.tags())
        return f"ResourceType={resource_type},Tags=[{inner}]"

    # files

    def file(self, name: str, obj) -> str:
        path = write_private(self.files / name, json.dumps(obj, indent=2) + "\n")
        return f"file://{path}"

    def secret_path(self, key: str) -> Path:
        return self.work / "secrets" / key.replace("/", "--")

    # the CLI

    def argv(self, args) -> list[str]:
        base = ["aws"]
        if getattr(self.args, "profile", None):
            base += ["--profile", self.args.profile]
        return base + ["--region", REGION, "--output", "json"] + [str(a) for a in args]

    def aws(self, *args, placeholder=None, ok: re.Pattern | None = None, text: bool = False):
        argv = self.argv(args)
        self.out("+ " + shlex.join(argv))
        if self.dry:
            return placeholder
        result = self.runner(argv)
        if result.returncode != 0:
            err = (result.stderr or "").strip()
            if ok is not None and ok.search(err):
                return None
            raise Die(f"aws {args[0]} {args[1]} failed (rc {result.returncode}): {err[:1500]}", rc=1)
        body = (result.stdout or "").strip()
        if text:
            return body
        return json.loads(body) if body.startswith(("{", "[", '"')) else {}

    def note(self, line: str) -> None:
        self.out(f"# {line}")

    def poll(self, what: str, fn, *, every_s: float = 20, timeout_s: float = 2400):
        """Call fn() until it returns a truthy value; dry-run prints and returns None."""
        self.note(f"poll every {every_s:g}s, up to {timeout_s:g}s: {what}")
        if self.dry:
            return None
        deadline = time.monotonic() + timeout_s
        while True:
            value = fn()
            if value:
                return value
            if time.monotonic() > deadline:
                raise Die(f"timed out: {what}", rc=1)
            self.sleep(every_s)

    # the account guard

    def guard(self) -> None:
        if getattr(self.args, "region", REGION) != REGION:
            raise Die(f"--region {self.args.region}: the rehearsal is pinned to {REGION}")
        expected = getattr(self.args, "expect_account", None) or read_local("account", self.local_dir)
        if not expected:
            raise Die("no expected account: pass --expect-account or write .local/account")
        if not re.fullmatch(r"\d{12}", expected):
            raise Die("the expected account must be 12 digits")
        if self.dry:
            self.note("dry-run: the account is not checked (sts get-caller-identity runs first for real)")
            return
        who = self.aws("sts", "get-caller-identity")
        if not who or who.get("Account") != expected:
            raise Die("the caller's account does not match the expected one; refusing before any other call")
        self.account = expected

    def require_billed(self) -> None:
        if not self.dry and not getattr(self.args, "billed", False):
            raise Die(f"`{self.args.cmd}` spends money in the account: pass --billed (or --dry-run)")

    # names and ARNs

    def role_arn(self, name: str) -> str:
        return f"arn:aws:iam::{self.account}:role{IAM_PATH}{PREFIX}-{name}"

    @property
    def rds_class(self) -> str:
        return getattr(self.args, "rds_class", None) or RDS_CLASS

    def profile_arn(self, name: str) -> str:
        return f"arn:aws:iam::{self.account}:instance-profile{IAM_PATH}{PREFIX}-{name}"

    def secret_arn(self, key: str) -> str:
        """A placeholder ARN (dry-run): Secrets Manager appends six random characters."""
        return f"arn:aws:secretsmanager:{REGION}:{self.account}:secret:{PREFIX}/{key}-<suffix>"

    def secret_arn_pattern(self, scope: str) -> str:
        return f"arn:aws:secretsmanager:{REGION}:{self.account}:secret:{PREFIX}/{scope}/*"

    # ── phases ───────────────────────────────────────────────────────────────────────

    def daily_costs(self, days: int) -> list[float]:
        today = dt.datetime.now(dt.timezone.utc).date()
        res = self.aws("ce", "get-cost-and-usage", "--time-period",
                       f"Start={today - dt.timedelta(days=days)},End={today}", "--granularity", "DAILY",
                       "--metrics", "UnblendedCost",
                       placeholder={"ResultsByTime": [{"Total": {"UnblendedCost": {"Amount": "0"}}}]})
        return [float(r["Total"]["UnblendedCost"]["Amount"]) for r in res.get("ResultsByTime", [])]

    def phase_guard(self) -> None:
        email = getattr(self.args, "alert_email", None) or read_local("alert-email", self.local_dir) or (
            "<alert-email>" if self.dry else None)
        if not email:
            raise Die("the budget needs an alert address: --alert-email or .local/alert-email")
        costs = self.daily_costs(30) or [0.0]
        lo, hi = min(costs), max(costs)
        limit = round(hi + BUDGET_MARGIN_USD, 2)
        early = round(hi + BUDGET_EARLY_ALERT_USD, 2)
        self.note(f"trailing 30-day daily UnblendedCost: min {lo:.2f}, max {hi:.2f} USD; budget limit "
                  f"{limit:.2f}; worst-case trigger {hi - lo + BUDGET_MARGIN_USD:.2f} of our own daily spend")
        budget = {"BudgetName": BUDGET_NAME, "BudgetType": "COST", "TimeUnit": "DAILY",
                  "BudgetLimit": {"Amount": f"{limit:.2f}", "Unit": "USD"}}
        notes = [{"Notification": {"NotificationType": "ACTUAL", "ComparisonOperator": "GREATER_THAN",
                                   "Threshold": t, "ThresholdType": "ABSOLUTE_VALUE"},
                  "Subscribers": [{"SubscriptionType": "EMAIL", "Address": email}]} for t in (early, limit)]
        existing = self.aws("budgets", "describe-budget", "--account-id", self.account, "--budget-name",
                            BUDGET_NAME, ok=NOT_FOUND, placeholder=None)
        if existing is None:
            self.aws("budgets", "create-budget", "--account-id", self.account,
                     "--budget", self.file("budget.json", budget),
                     "--notifications-with-subscribers", self.file("budget-notifications.json", notes),
                     "--resource-tags", *self.tags_kv())
        else:
            self.aws("budgets", "update-budget", "--account-id", self.account,
                     "--new-budget", self.file("budget.json", budget))
            old = self.aws("budgets", "describe-notifications-for-budget", "--account-id", self.account,
                           "--budget-name", BUDGET_NAME) or {}
            for n in old.get("Notifications", []):
                self.aws("budgets", "delete-notification", "--account-id", self.account, "--budget-name",
                         BUDGET_NAME, "--notification", self.file("budget-old-notification.json", n))
            for i, n in enumerate(notes):
                self.aws("budgets", "create-notification", "--account-id", self.account, "--budget-name",
                         BUDGET_NAME, "--notification", self.file(f"budget-notification-{i}.json", n["Notification"]),
                         "--subscribers", self.file(f"budget-subscribers-{i}.json", n["Subscribers"]))
        self.state["budget"] = {"limit": limit, "trailing_min": lo, "trailing_max": hi}
        self.record("budget", BUDGET_NAME)

    def phase_iam(self) -> None:
        trust = {
            "ec2": {"Version": "2012-10-17", "Statement": [{"Effect": "Allow", "Principal": {
                "Service": "ec2.amazonaws.com"}, "Action": "sts:AssumeRole"}]},
            "service": {"Version": "2012-10-17", "Statement": [{"Effect": "Allow", "Principal": {
                "Service": "elasticbeanstalk.amazonaws.com"}, "Action": "sts:AssumeRole", "Condition": {
                "StringEquals": {"sts:ExternalId": "elasticbeanstalk"}}}]},
        }
        inline = self.inline_policies()
        for role in ROLES:
            name = f"{PREFIX}-{role}"
            if self.aws("iam", "get-role", "--role-name", name, ok=NOT_FOUND) is None:
                self.aws("iam", "create-role", "--role-name", name, "--path", IAM_PATH,
                         "--assume-role-policy-document",
                         self.file(f"trust-{role}.json", trust["service" if role == "service" else "ec2"]),
                         "--tags", *self.tags_kv())
            self.record("iam-role", name)
            for policy in MANAGED[role]:
                self.aws("iam", "attach-role-policy", "--role-name", name, "--policy-arn",
                         f"arn:aws:iam::aws:policy/{policy}")
            if role in inline:
                self.aws("iam", "put-role-policy", "--role-name", name, "--policy-name", name,
                         "--policy-document", self.file(f"policy-{role}.json", inline[role]))
        for role in PROFILES:
            name = f"{PREFIX}-{role}"
            got = self.aws("iam", "get-instance-profile", "--instance-profile-name", name, ok=NOT_FOUND)
            if got is None:
                self.aws("iam", "create-instance-profile", "--instance-profile-name", name, "--path", IAM_PATH,
                         "--tags", *self.tags_kv())
            self.record("instance-profile", name)
            if not (got or {}).get("InstanceProfile", {}).get("Roles"):
                self.aws("iam", "add-role-to-instance-profile", "--instance-profile-name", name,
                         "--role-name", name)

    def inline_policies(self) -> dict[str, dict]:
        def doc(*statements):
            return {"Version": "2012-10-17", "Statement": list(statements)}

        def secrets(*scopes):
            return {"Effect": "Allow", "Action": "secretsmanager:GetSecretValue",
                    "Resource": [self.secret_arn_pattern(s) for s in scopes]}

        bucket = f"arn:aws:s3:::{self.data_bucket}"
        return {
            "web": doc(secrets("web", "shared"), {"Effect": "Allow", "Action": "sqs:SendMessage",
                                                  "Resource": f"arn:aws:sqs:{REGION}:{self.account}:awseb-e-*"}),
            "worker": doc(secrets("worker", "shared")),
            "tools": doc(secrets("tools"),
                         {"Effect": "Allow", "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
                          "Resource": f"{bucket}/*"},
                         {"Effect": "Allow", "Action": "s3:ListBucket", "Resource": bucket}),
        }

    def network(self) -> tuple[str, list[str]]:
        if "vpc_id" not in self.state:
            vpcs = self.aws("ec2", "describe-vpcs", "--filters", "Name=is-default,Values=true",
                            placeholder={"Vpcs": [{"VpcId": "<vpc-id>"}]})
            if not vpcs.get("Vpcs"):
                raise Die("no default VPC in the account")
            vpc = vpcs["Vpcs"][0]["VpcId"]
            subnets = self.aws("ec2", "describe-subnets", "--filters", f"Name=vpc-id,Values={vpc}",
                               "Name=default-for-az,Values=true",
                               placeholder={"Subnets": [{"SubnetId": "<subnet-a>"}, {"SubnetId": "<subnet-b>"}]})
            ids = sorted(s["SubnetId"] for s in subnets.get("Subnets", []))
            if len(ids) < 2:
                raise Die("the default VPC needs two default subnets (RDS and the ALBs span two AZs)")
            self.state["vpc_id"], self.state["subnets"] = vpc, ids
            self.save()
        return self.state["vpc_id"], self.state["subnets"]

    def sg_id(self, name: str) -> str:
        return self.state.get("sg", {}).get(name) or f"<sg-{name}>"

    def phase_net(self) -> None:
        vpc, _ = self.network()
        self.state.setdefault("sg", {})
        for name in SECURITY_GROUPS:
            full = f"{PREFIX}-{name}"
            found = self.aws("ec2", "describe-security-groups", "--filters", f"Name=group-name,Values={full}",
                             f"Name=vpc-id,Values={vpc}", placeholder={"SecurityGroups": []})
            if found.get("SecurityGroups"):
                gid = found["SecurityGroups"][0]["GroupId"]
            else:
                made = self.aws("ec2", "create-security-group", "--group-name", full, "--description",
                                f"U13 rehearsal {name}", "--vpc-id", vpc, "--tag-specifications",
                                self.tags_ec2("security-group"), placeholder={"GroupId": f"<sg-{name}>"})
                gid = made["GroupId"]
            self.state["sg"][name] = gid
            self.record("sg", full, group_id=gid)
        for name, rules in SECURITY_GROUPS.items():
            for port, source in rules:
                self.aws("ec2", "authorize-security-group-ingress", "--group-id", self.sg_id(name),
                         "--protocol", "tcp", "--port", port, "--source-group", self.sg_id(source), ok=ALREADY)

    def phase_stores(self) -> None:
        _, subnets = self.network()
        if self.aws("rds", "describe-db-subnet-groups", "--db-subnet-group-name", RDS_SUBNET_GROUP,
                    ok=NOT_FOUND) is None:
            self.aws("rds", "create-db-subnet-group", "--db-subnet-group-name", RDS_SUBNET_GROUP,
                     "--db-subnet-group-description", "U13 rehearsal", "--subnet-ids", *subnets,
                     "--tags", *self.tags_kv())
        self.record("db-subnet-group", RDS_SUBNET_GROUP)
        if self.aws("rds", "describe-db-parameter-groups", "--db-parameter-group-name", RDS_PARAM_GROUP,
                    ok=NOT_FOUND) is None:
            self.aws("rds", "create-db-parameter-group", "--db-parameter-group-name", RDS_PARAM_GROUP,
                     "--db-parameter-group-family", RDS_FAMILY, "--description", "U13 rehearsal",
                     "--tags", *self.tags_kv())
        self.record("db-param-group", RDS_PARAM_GROUP)
        if self.aws("rds", "describe-db-instances", "--db-instance-identifier", RDS_ID, ok=NOT_FOUND) is None:
            self.aws("rds", "create-db-instance", "--db-instance-identifier", RDS_ID,
                     "--db-instance-class", self.rds_class, "--engine", "postgres", "--engine-version",
                     RDS_ENGINE_VERSION, "--allocated-storage", "20", "--storage-type", "gp3",
                     "--storage-encrypted", "--master-username", DB_OWNER, "--manage-master-user-password",
                     "--db-name", DB_NAME, "--vpc-security-group-ids", self.sg_id("rds"),
                     "--db-subnet-group-name", RDS_SUBNET_GROUP, "--db-parameter-group-name", RDS_PARAM_GROUP,
                     "--no-publicly-accessible", "--no-multi-az", "--backup-retention-period", "0",
                     "--tags", *self.tags_kv())
        self.record("rds", RDS_ID)
        self.aws("rds", "wait", "db-instance-available", "--db-instance-identifier", RDS_ID)
        db = self.aws("rds", "describe-db-instances", "--db-instance-identifier", RDS_ID, placeholder={
            "DBInstances": [{"Endpoint": {"Address": "<rds-endpoint>"},
                             "MasterUserSecret": {"SecretArn": "<rds-master-secret-arn>"}}]})["DBInstances"][0]
        self.state["rds"] = {"endpoint": db["Endpoint"]["Address"],
                             "master_secret_arn": db["MasterUserSecret"]["SecretArn"]}
        self.save()
        bucket = self.data_bucket
        if self.aws("s3api", "head-bucket", "--bucket", bucket, ok=NOT_FOUND) is None:
            self.aws("s3api", "create-bucket", "--bucket", bucket)
        self.aws("s3api", "put-bucket-tagging", "--bucket", bucket, "--tagging",
                 self.file("data-bucket-tagging.json", {"TagSet": [{"Key": k, "Value": v} for k, v in self.tags()]}))
        self.aws("s3api", "put-public-access-block", "--bucket", bucket, "--public-access-block-configuration",
                 "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true")
        self.aws("s3api", "put-bucket-encryption", "--bucket", bucket, "--server-side-encryption-configuration",
                 self.file("data-bucket-encryption.json", {"Rules": [
                     {"ApplyServerSideEncryptionByDefault": {"SSEAlgorithm": "AES256"}}]}))
        self.record("s3", bucket)

    def secret_values(self) -> dict[str, Path]:
        """Write (once) and return the 0600 file of every secret. Generated values are random
        hex; the model key comes from eval/.env or the environment."""
        endpoint = self.state.get("rds", {}).get("endpoint")
        if not endpoint:
            raise Die("run `up --phase stores` first: the DSNs need the RDS endpoint")
        paths = {key: self.secret_path(key) for key in SECRET_KEYS}
        dml_pw_path = self.work / "secrets" / "dml-password"
        if not dml_pw_path.is_file():
            write_private(dml_pw_path, pysecrets.token_hex(24))
        dml_pw = dml_pw_path.read_text(encoding="utf-8").strip()
        dsn = f"postgresql://{DB_DML}:{dml_pw}@{endpoint}:5432/{DB_NAME}"
        values = {"web/pg-dsn": dsn, "worker/pg-dsn": dsn, "tools/pg-dsn": dsn}
        for key in ("web/session-secret", "shared/fs-token-enc-key"):
            if not paths[key].is_file():
                values[key] = pysecrets.token_hex(32)
        values["worker/anthropic-api-key"] = anthropic_key(Path(getattr(self.args, "env_file", None) or EVAL_ENV))
        for key, value in values.items():
            write_private(paths[key], value)
        return paths

    def phase_secrets(self) -> None:
        if self.dry:
            paths = {key: self.secret_path(key) for key in SECRET_KEYS}
            self.note("dry-run: no secret file is written; each --secret-string names its 0600 path")
        else:
            paths = self.secret_values()
        self.state.setdefault("secrets", {})
        for key in SECRET_KEYS:
            name = f"{PREFIX}/{key}"
            got = self.aws("secretsmanager", "describe-secret", "--secret-id", name, ok=NOT_FOUND)
            if got is None:
                made = self.aws("secretsmanager", "create-secret", "--name", name, "--secret-string",
                                f"file://{paths[key]}", "--tags", *self.tags_kv(),
                                placeholder={"ARN": self.secret_arn(key)})
                arn = made["ARN"]
            else:
                self.aws("secretsmanager", "put-secret-value", "--secret-id", name, "--secret-string",
                         f"file://{paths[key]}")
                arn = got["ARN"]
            self.state["secrets"][key] = arn
            self.record("secret", name, arn=arn)

    def phase_bastion(self) -> None:
        _, subnets = self.network()
        found = self.aws("ec2", "describe-instances", "--filters", f"Name=tag:Name,Values={PREFIX}-bastion",
                         "Name=instance-state-name,Values=pending,running,stopping,stopped",
                         placeholder={"Reservations": []})
        running = [i["InstanceId"] for r in found.get("Reservations", []) for i in r.get("Instances", [])]
        if running:
            instance = running[0]
        else:
            ami = self.aws("ssm", "get-parameter", "--name", BASTION_AMI_PARAM,
                           placeholder={"Parameter": {"Value": "<al2023-ami>"}})["Parameter"]["Value"]
            name_tag = f"{{Key=Name,Value={PREFIX}-bastion}}"
            inner = ",".join([name_tag] + [f"{{Key={k},Value={v}}}" for k, v in self.tags()])
            made = None
            for attempt in range(6):
                made = self.aws("ec2", "run-instances", "--image-id", ami, "--instance-type",
                                INSTANCE_TYPES["bastion"], "--iam-instance-profile",
                                f"Arn={self.profile_arn('bastion')}", "--security-group-ids", self.sg_id("worker"),
                                "--subnet-id", subnets[0], "--associate-public-ip-address",
                                "--metadata-options", "HttpTokens=required,HttpEndpoint=enabled",
                                "--tag-specifications", f"ResourceType=instance,Tags=[{inner}]",
                                f"ResourceType=volume,Tags=[{inner}]",
                                placeholder={"Instances": [{"InstanceId": "<bastion-id>"}]},
                                ok=re.compile(r"Invalid IAM Instance Profile|InvalidParameterValue.*iamInstanceProfile",
                                              re.I))
                if made is not None:
                    break
                self.note("the new instance profile has not propagated yet; retrying in 15 s")
                self.sleep(15)
            if made is None:
                raise Die("run-instances kept refusing the bastion's instance profile", rc=1)
            instance = made["Instances"][0]["InstanceId"]
        self.state["bastion"] = instance
        self.record("ec2", instance, role="bastion")
        self.aws("ec2", "wait", "instance-running", "--instance-ids", instance)

    def phase_versions(self) -> None:
        bundles = Path(getattr(self.args, "bundles_dir", None) or "<bundles-dir>")
        if not (bundles / layout.MANIFEST_NAME).is_file():
            if not self.dry:
                raise Die(f"--bundles-dir must hold a CI eb-bundles artifact ({layout.MANIFEST_NAME} and the zips)")
            manifest = {"git_sha": "<sha>", "bundles": {t: {"file": layout.BUNDLE_NAMES[t]} for t in TIERS}}
        else:
            manifest = json.loads((bundles / layout.MANIFEST_NAME).read_text(encoding="utf-8"))
            if manifest.get("dirty"):
                raise Die("the bundles were built from a dirty tree; use a CI artifact for a main sha")
            for tier in TIERS:
                entry = manifest["bundles"][tier]
                digest = hashlib.sha256((bundles / entry["file"]).read_bytes()).hexdigest()
                if digest != entry["sha256"]:
                    raise Die(f"{entry['file']}: sha256 {digest} != the manifest's {entry['sha256']}")
        sha = str(manifest.get("git_sha", "<sha>"))[:12]
        storage = f"elasticbeanstalk-{REGION}-{self.account}"
        if "storage_bucket" not in self.state:
            before = self.aws("s3api", "head-bucket", "--bucket", storage, ok=NOT_FOUND, placeholder=None)
            made = self.aws("elasticbeanstalk", "create-storage-location", placeholder={"S3Bucket": storage})
            storage = made["S3Bucket"]
            self.state["storage_bucket"] = storage
            self.state["created_by_run"] = before is None
            self.save()
        storage = self.state["storage_bucket"]
        self.record("eb-storage", storage, created_by_run=self.state["created_by_run"])
        apps = self.aws("elasticbeanstalk", "describe-applications", "--application-names", APP,
                        placeholder={"Applications": []})
        if not apps.get("Applications"):
            self.aws("elasticbeanstalk", "create-application", "--application-name", APP, "--description",
                     "U13 rehearsal", "--tags", *self.tags_kv())
        self.record("app", APP)
        self.state.setdefault("versions", {})
        for tier in TIERS:
            label = f"{PREFIX}-{tier}-{sha}"
            self.upload_version(label, bundles / manifest["bundles"][tier]["file"], storage)
            self.state["versions"][tier] = label
            self.save()

    def upload_version(self, label: str, zip_path: Path, storage: str) -> None:
        key = f"{STORAGE_PREFIX}{label}/{zip_path.name}"
        got = self.aws("elasticbeanstalk", "describe-application-versions", "--application-name", APP,
                       "--version-labels", label, placeholder={"ApplicationVersions": []})
        if got.get("ApplicationVersions"):
            return
        self.aws("s3", "cp", str(zip_path), f"s3://{storage}/{key}", text=True)
        self.aws("elasticbeanstalk", "create-application-version", "--application-name", APP,
                 "--version-label", label, "--source-bundle", f"S3Bucket={storage},S3Key={key}", "--process",
                 "--tags", *self.tags_kv())

        def processed():
            v = self.aws("elasticbeanstalk", "describe-application-versions", "--application-name", APP,
                         "--version-labels", label)["ApplicationVersions"][0]["Status"]
            if v == "FAILED":
                raise Die(f"application version {label} failed processing", rc=1)
            return v == "PROCESSED"

        self.poll(f"{label} Status=PROCESSED", processed, every_s=10, timeout_s=900)

    def stack(self, tier: str) -> str:
        if self.dry:
            return {"tools": "64bit Amazon Linux 2023 v<x> running Node.js 24"}.get(
                tier, "64bit Amazon Linux 2023 v<x> running Python 3.12")
        stacks = self.aws("elasticbeanstalk", "list-available-solution-stacks").get("SolutionStacks", [])
        matches = [(tuple(int(p) for p in m.group(1).split(".")), s) for s in stacks
                   if (m := re.match(STACK_PATTERNS[tier], s))]
        if not matches:
            raise Die(f"no solution stack matches {STACK_PATTERNS[tier]}")
        return max(matches)[1]

    # tier option settings

    def common_options(self, tier: str, *, instance_type: str | None = None) -> list[dict]:
        vpc, subnets = self.network()
        sg = {"web": "web", "worker": "worker", "tools": "tools"}[tier]
        out = [
            opt(LC_NS, "SecurityGroups", self.sg_id(sg)),
            opt(LC_NS, "IamInstanceProfile", self.profile_arn(tier)),
            opt(INSTANCES_NS, "InstanceTypes", instance_type or INSTANCE_TYPES[tier]),
            opt(ASG_NS, "MinSize", 1), opt(ASG_NS, "MaxSize", 1),
            opt(VPC_NS, "VPCId", vpc), opt(VPC_NS, "Subnets", ",".join(subnets)),
            opt(VPC_NS, "AssociatePublicIpAddress", "true"),
            opt(EBENV_NS, "ServiceRole", self.role_arn("service")),
            opt(MANAGED_NS, "ManagedActionsEnabled", "false"),
            opt(HEALTH_NS, "SystemType", "enhanced"),
        ]
        for var, key in TIER_SECRETS[tier].items():
            out.append(opt(SECRETS_NS, var, self.state.get("secrets", {}).get(key) or self.secret_arn(key)))
        return out

    def load_balanced(self, *, internal: bool) -> list[dict]:
        _, subnets = self.network()
        out = [opt(EBENV_NS, "EnvironmentType", "LoadBalanced"), opt(EBENV_NS, "LoadBalancerType", "application"),
               opt(VPC_NS, "ELBSubnets", ",".join(subnets))]
        if internal:
            out += [opt(VPC_NS, "ELBScheme", "internal"),
                    opt(ELBV2_NS, "SecurityGroups", self.sg_id("tools-alb")),
                    opt(ELBV2_NS, "ManagedSecurityGroup", self.sg_id("tools-alb"))]
        return out

    def extra_env(self, tier: str) -> list[dict]:
        out = []
        for item in getattr(self.args, "env", None) or []:
            m = re.fullmatch(r"(web|worker|tools):([A-Za-z_][A-Za-z0-9_]*)=(.*)", item, re.S)
            if not m:
                raise Die(f"--env {item!r}: expected <tier>:NAME=VALUE")
            if m.group(1) == tier:
                out.append(opt(ENV_NS, m.group(2), m.group(3)))
        return out

    def tools_options(self, variant: str | None = None) -> list[dict]:
        out = self.common_options("tools")
        if variant == "tools_single":
            out.append(opt(EBENV_NS, "EnvironmentType", "SingleInstance"))
        elif variant == "tools_classic":
            _, subnets = self.network()
            out += [opt(EBENV_NS, "EnvironmentType", "LoadBalanced"), opt(VPC_NS, "ELBScheme", "internal"),
                    opt(VPC_NS, "ELBSubnets", ",".join(subnets))]
        else:
            out += self.load_balanced(internal=True)
        out += [opt(ENV_NS, "GENEALOGY_S3_BUCKET", self.data_bucket), opt(ENV_NS, "GENEALOGY_S3_REGION", REGION)]
        return out + self.extra_env("tools")

    def worker_options(self, *, instance_type: str | None = None, arm: bool = False) -> list[dict]:
        out = self.common_options("worker", instance_type=instance_type)
        if arm:
            out.append(opt(INSTANCES_NS, "SupportedArchitectures", "arm64"))
        sqsd = sqsd_template()
        out += [opt(SQSD_NS, k, v) for k, v in sqsd[SQSD_NS].items()]
        out += [opt(ENV_NS, k, v) for k, v in sqsd[ENV_NS].items()]
        tools_cname = self.state.get("envs", {}).get("tools", {}).get("cname") or "<tools-cname>"
        out += [opt(ENV_NS, "MODEL_PROVIDER", "anthropic"),
                opt(ENV_NS, "TOOL_SERVER_URL", f"http://{tools_cname}/mcp")]
        return out + self.extra_env("worker")

    def web_options(self) -> list[dict]:
        out = self.common_options("web") + self.load_balanced(internal=False)
        out.append(opt(ENV_NS, "QUEUE_URL", self.state.get("queue_url") or "<queue-url>"))
        return out + self.signin_options() + self.extra_env("web")

    def signin_options(self) -> list[dict]:
        """The loopback sign-in settings, present only once `up --phase
        signin` has run; off on first boot."""
        signin = self.state.get("signin") or {}
        if signin.get("mode") != "loopback":
            return []
        return [opt(ENV_NS, "PUBLIC_URL", LOOPBACK_PUBLIC_URL), opt(ENV_NS, "FAMILYSEARCH_WEB_ENABLED", "true"),
                opt(ENV_NS, "ALLOWED_EMAILS", signin["emails"])]

    def options_path(self, env_name: str) -> Path:
        return self.work / "options" / f"{env_name}.json"

    def snapshot(self, env_name: str) -> list[dict]:
        path = self.options_path(env_name)
        if not path.is_file():
            raise Die(f"no snapshot for {env_name}: run its `up` phase first")
        return json.loads(path.read_text(encoding="utf-8"))

    def write_options(self, env_name: str, options: list[dict]) -> str:
        """The API layer `up` set for an environment, kept as the probe cases' snapshot."""
        if self.dry:
            return self.file(f"options-{env_name}.json", options)
        write_private(self.options_path(env_name), json.dumps(options, indent=2) + "\n")
        return f"file://{self.options_path(env_name)}"

    def describe_env(self, name: str) -> dict | None:
        got = self.aws("elasticbeanstalk", "describe-environments", "--application-name", APP,
                       "--environment-names", name, "--no-include-deleted", placeholder={"Environments": []})
        envs = [e for e in (got or {}).get("Environments", []) if e.get("Status") != "Terminated"]
        return envs[0] if envs else None

    def wait_env(self, name: str) -> dict:
        def ready():
            env = self.describe_env(name)
            if env is None or env.get("Status") in ("Terminating", "Terminated"):
                events = self.aws("elasticbeanstalk", "describe-events", "--environment-name", name,
                                  "--max-items", "15")
                for e in (events or {}).get("Events", []):
                    self.out(f"  {e.get('EventDate')} {e.get('Severity')} {e.get('Message')}")
                raise Die(f"environment {name} is {env and env.get('Status')}, expected Ready", rc=1)
            return env if env.get("Status") == "Ready" else None

        return self.poll(f"{name} Status=Ready", ready, every_s=20, timeout_s=2700) or {}

    def wait_env_gone(self, name: str) -> None:
        self.poll(f"{name} is terminated", lambda: self.describe_env(name) is None, every_s=20, timeout_s=2700)

    def settle_env(self, name: str) -> dict | None:
        """Wait until the environment is gone or out of a transitional status: Beanstalk
        refuses an update or a terminate mid-launch or mid-update ("Must be Ready")."""
        def settled():
            env = self.describe_env(name)
            return {"env": env} if env is None or env.get("Status") not in EB_TRANSITIONAL else None

        got = self.poll(f"{name} is out of {'/'.join(EB_TRANSITIONAL[:2])}", settled, every_s=20, timeout_s=2700)
        return (got or {}).get("env")

    def ensure_env(self, tier: str, name: str, label: str, options: list[dict], *, worker: bool = False,
                   throwaway: bool = False) -> dict:
        check_options(tier, options, signin=self.signin_active(tier, options), dry=self.dry)
        settings = self.write_options(name, options) if not throwaway else self.file(f"options-{name}.json", options)
        existing = self.describe_env(name)
        if existing is None:
            extra = ["--tier", "Name=Worker,Type=SQS/HTTP"] if worker else []
            self.aws("elasticbeanstalk", "create-environment", "--application-name", APP, "--environment-name",
                     name, "--solution-stack-name", self.stack(tier), "--version-label", label, *extra,
                     "--option-settings", settings, "--tags", *self.tags_kv())
        else:
            self.aws("elasticbeanstalk", "update-environment", "--environment-name", name, "--version-label",
                     label, "--option-settings", settings)
        env = self.wait_env(name)
        env_id = env.get("EnvironmentId", f"<{name}-id>")
        res = self.aws("elasticbeanstalk", "describe-environment-resources", "--environment-name", name,
                       placeholder={"EnvironmentResources": {}}).get("EnvironmentResources", {})
        self.record("env", name, env_id=env_id, throwaway=throwaway, stack=f"awseb-{env_id}-stack",
                    load_balancers=[lb.get("Name") for lb in res.get("LoadBalancers", [])],
                    queues=[q.get("URL") for q in res.get("Queues", [])])
        self.record("log-group", f"/aws/elasticbeanstalk/{name}/")
        info = {"name": name, "id": env_id, "cname": env.get("CNAME", f"<{name}-cname>")}
        if not throwaway:
            self.state.setdefault("envs", {})[tier] = info
            self.save()
        return {**info, "resources": res}

    def signin_active(self, tier: str, options: list[dict]) -> bool:
        return tier == "web" and bool(self.signin_options())

    def version(self, tier: str) -> str:
        return self.state.get("versions", {}).get(tier) or f"<{tier}-label>"

    def phase_tools(self) -> None:
        self.ensure_env("tools", ENV_NAMES["tools"], self.version("tools"), self.tools_options())

    def phase_worker(self) -> None:
        options = self.worker_options()
        if self.state.get("queue_url"):
            options.append(opt(ENV_NS, "QUEUE_URL", self.state["queue_url"]))
        self.ensure_env("worker", ENV_NAMES["worker"], self.version("worker"), options, worker=True)

    def queue_url_of(self, name: str) -> str:
        res = self.aws("elasticbeanstalk", "describe-environment-resources", "--environment-name", name,
                       placeholder={"EnvironmentResources": {"Queues": [{"Name": "WorkerQueue",
                                                                          "URL": "<queue-url>"}]}})
        queues = [q["URL"] for q in res["EnvironmentResources"].get("Queues", []) if q.get("Name") == "WorkerQueue"]
        if not queues:
            raise Die(f"{name} has no WorkerQueue yet", rc=1)
        return queues[0]

    def phase_queue(self) -> None:
        """The QUEUE_URL two-step: the worker exits 2 at step=queue_url until it has its own
        queue's URL, which exists only once the environment does."""
        name = ENV_NAMES["worker"]
        url = self.queue_url_of(name)
        self.state["queue_url"] = url
        self.save()
        options = [o for o in self.snapshot(name) if o["OptionName"] != "QUEUE_URL"] if not self.dry \
            else self.worker_options()
        options.append(opt(ENV_NS, "QUEUE_URL", url))
        check_options("worker", options, dry=self.dry)
        self.aws("elasticbeanstalk", "update-environment", "--environment-name", name, "--option-settings",
                 self.write_options(name, options))
        self.wait_env(name)

    def phase_web(self) -> None:
        if not self.state.get("queue_url") and not self.dry:
            raise Die("run `up --phase queue` first: the web tier refuses to start without QUEUE_URL")
        self.ensure_env("web", ENV_NAMES["web"], self.version("web"), self.web_options())

    def migrate_script(self, master_arn: str, dml_arn: str, endpoint: str) -> str:
        """The SSM script: reads both secrets on the instance and prints neither."""
        tables = ", ".join(DML_TABLES)
        return f"""set -euo pipefail
cd /var/app/current
PY=$(ls -d /var/app/venv/*/bin/python | head -n 1)
"$PY" - <<'U13PY'
import json, os, subprocess, sys
from urllib.parse import unquote, urlsplit
import psycopg
from psycopg import sql

def secret(arn):
    out = subprocess.run(["aws", "--region", "{REGION}", "secretsmanager", "get-secret-value", "--secret-id", arn,
                          "--query", "SecretString", "--output", "text"], check=True, capture_output=True,
                         text=True, encoding="utf-8").stdout
    return out.rstrip("\\n")

master = json.loads(secret("{master_arn}"))
dml_password = unquote(urlsplit(secret("{dml_arn}")).password or "")
if not dml_password:
    sys.exit("the DML DSN secret carries no password")
os.environ.update(PGPASSWORD=master["password"], PGSSLMODE="verify-full",
                  PGSSLROOTCERT="/var/app/current/certs/rds-global-bundle.pem",
                  MIGRATE_PG_DSN="host={endpoint} port=5432 dbname={DB_NAME} user=" + master["username"])
subprocess.run([sys.executable, "migrate.py"], check=True)
with psycopg.connect(os.environ["MIGRATE_PG_DSN"]) as conn:
    owner = sql.Identifier(master["username"])
    dml = sql.Identifier("{DB_DML}")
    exists = conn.execute("SELECT 1 FROM pg_roles WHERE rolname = %s", ("{DB_DML}",)).fetchone()
    verb = "ALTER" if exists else "CREATE"
    conn.execute(sql.SQL(verb + " ROLE {{}} LOGIN PASSWORD {{}}").format(dml, sql.Literal(dml_password)))
    tables = sql.SQL(", ").join(sql.Identifier(t) for t in "{tables}".split(", "))
    conn.execute(sql.SQL("GRANT SELECT, INSERT, UPDATE, DELETE ON {{}} TO {{}}").format(tables, dml))
    conn.execute(sql.SQL("GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO {{}}").format(dml))
    conn.execute(sql.SQL("ALTER DEFAULT PRIVILEGES FOR ROLE {{}} IN SCHEMA public "
                         "GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO {{}}").format(owner, dml))
    conn.execute(sql.SQL("ALTER DEFAULT PRIVILEGES FOR ROLE {{}} IN SCHEMA public "
                         "GRANT USAGE ON SEQUENCES TO {{}}").format(owner, dml))
print("migrate: DML role", verb.lower() + "d", "(no secret printed)")
subprocess.run([sys.executable, "migrate.py", "--status"], check=True)
U13PY
"""

    def phase_migrate(self) -> None:
        rds = self.state.get("rds", {})
        master_arn = rds.get("master_secret_arn") or "<rds-master-secret-arn>"
        dml_arn = self.state.get("secrets", {}).get("web/pg-dsn") or self.secret_arn("web/pg-dsn")
        endpoint = rds.get("endpoint") or "<rds-endpoint>"
        res = self.aws("elasticbeanstalk", "describe-environment-resources", "--environment-name",
                       ENV_NAMES["web"], placeholder={"EnvironmentResources": {"Instances": [{"Id": "<web-instance>"}]}})
        instances = [i["Id"] for i in res["EnvironmentResources"].get("Instances", [])]
        if not instances:
            raise Die("the web environment has no instance to run the migration on", rc=1)
        role = f"{PREFIX}-web"
        policy = {"Version": "2012-10-17", "Statement": [{"Effect": "Allow", "Action": "secretsmanager:GetSecretValue",
                                                          "Resource": [master_arn, dml_arn]}]}
        params = {"commands": [self.migrate_script(master_arn, dml_arn, endpoint)], "executionTimeout": ["900"]}
        self.aws("iam", "put-role-policy", "--role-name", role, "--policy-name", MIGRATE_POLICY,
                 "--policy-document", self.file("policy-migrate.json", policy))
        try:
            self.note("waiting 15 s for the transient policy to propagate")
            if not self.dry:
                self.sleep(15)
            sent = self.aws("ssm", "send-command", "--document-name", "AWS-RunShellScript", "--instance-ids",
                            instances[0], "--comment", "U13 rehearsal migrate", "--parameters",
                            self.file("ssm-migrate.json", params), placeholder={"Command": {"CommandId": "<command-id>"}})
            command = sent["Command"]["CommandId"]

            def finished():
                inv = self.aws("ssm", "get-command-invocation", "--command-id", command, "--instance-id",
                               instances[0], ok=re.compile("InvocationDoesNotExist"))
                if not inv or inv.get("Status") in ("Pending", "InProgress", "Delayed"):
                    return None
                return inv

            inv = self.poll("the migrate command finishes", finished, every_s=10, timeout_s=1200)
            if not self.dry:
                self.out((inv.get("StandardOutputContent") or "").rstrip())
                if inv.get("Status") != "Success":
                    self.out((inv.get("StandardErrorContent") or "").rstrip())
                    raise Die(f"migrate over SSM ended {inv.get('Status')}", rc=1)
        finally:
            self.aws("iam", "delete-role-policy", "--role-name", role, "--policy-name", MIGRATE_POLICY, ok=NOT_FOUND)

    def phase_signin(self) -> None:
        mode = getattr(self.args, "mode", None) or "loopback"
        if mode == "https":
            raise Die("--mode https needs a hostname and certificate; deferred until the hostname is decided")
        name = ENV_NAMES["web"]
        base = [o for o in (self.snapshot(name) if not self.dry else self.web_options())
                if not (o["Namespace"] == ENV_NS and o["OptionName"] in SIGNIN_NAMES)]
        removes = []
        if mode == "off":
            self.state["signin"] = None
            removes = [{"Namespace": ENV_NS, "OptionName": n} for n in SIGNIN_NAMES]
        elif mode == "loopback":
            emails = getattr(self.args, "allowed_emails", None) or read_local("allowed-emails", self.local_dir) or (
                "<email> <email>" if self.dry else None)
            if not emails:
                raise Die("loopback sign-in needs --allowed-emails or .local/allowed-emails")
            joined = " ".join(e for e in re.split(r"[,\s]+", emails) if e)
            self.state["signin"] = {"mode": "loopback", "emails": joined}
        else:
            raise Die(f"--mode {mode}: loopback, https or off")
        options = base + self.signin_options()
        check_options("web", options, signin=mode == "loopback", dry=self.dry)
        call = ["elasticbeanstalk", "update-environment", "--environment-name", name, "--option-settings",
                self.write_options(name, options)]
        if removes:
            call += ["--options-to-remove", self.file("signin-remove.json", removes)]
        self.aws(*call)
        self.save()
        self.wait_env(name)
        if mode == "loopback":
            self.note("then forward laptop 1837 to the web instance's port 8000 (README, 'Loopback sign-in')")

    def phase_resolver(self) -> None:
        vpc, _ = self.network()
        self.aws("logs", "create-log-group", "--log-group-name", RESOLVER_LOG_GROUP, "--tags",
                 ",".join(f"{k}={v}" for k, v in self.tags()), ok=ALREADY)
        self.record("log-group", RESOLVER_LOG_GROUP)
        found = self.aws("route53resolver", "list-resolver-query-log-configs", "--filters",
                         f"Name=Name,Values={RESOLVER_NAME}", placeholder={"ResolverQueryLogConfigs": []})
        if found.get("ResolverQueryLogConfigs"):
            config = found["ResolverQueryLogConfigs"][0]["Id"]
        else:
            made = self.aws("route53resolver", "create-resolver-query-log-config", "--name", RESOLVER_NAME,
                            "--destination-arn", f"arn:aws:logs:{REGION}:{self.account}:log-group:{RESOLVER_LOG_GROUP}",
                            "--creator-request-id", f"{PREFIX}-{self.run_id}", "--tags", *self.tags_kv(),
                            placeholder={"ResolverQueryLogConfig": {"Id": "<rqlc-id>"}})
            config = made["ResolverQueryLogConfig"]["Id"]
        self.record("resolver", config)
        self.aws("route53resolver", "associate-resolver-query-log-config", "--resolver-query-log-config-id",
                 config, "--resource-id", vpc, ok=ALREADY)

    def up(self) -> int:
        self.require_billed()
        self.guard()
        phases = [p for raw in (self.args.phase or ["all"]) for p in (PHASES if raw == "all" else (raw,))]
        for phase in phases:
            if phase not in PHASES + OPTIONAL_PHASES:
                raise Die(f"unknown phase {phase}")
        self.fix_run_id()
        for phase in phases:
            self.out(f"== up --phase {phase}")
            getattr(self, f"phase_{phase}")()
        return 0

    # ── probe ────────────────────────────────────────────────────────────────────────

    def throwaway_options(self, variant: str) -> tuple[str, str, list[dict], bool]:
        if variant == "graviton_boot":
            return "worker", self.version("worker"), self.worker_options(instance_type="t4g.large", arm=True), True
        return "tools", self.version("tools"), self.tools_options(variant if variant != "ebext_naming" else None), False

    def ebext_version(self) -> str:
        """A copy of the tools zip carrying .ebextensions/03-u13.yaml (ebext_naming)."""
        label = f"{self.version('tools')}-ebext"
        bundles = Path(getattr(self.args, "bundles_dir", None) or "")
        src = bundles / layout.BUNDLE_NAMES["tools"]
        dest = self.work / "bundles" / "eb-tools-ebext.zip"
        if not self.dry:
            if not src.is_file():
                raise Die("ebext_naming needs --bundles-dir with eb-tools.zip")
            secure_dir(dest.parent)
            with zipfile.ZipFile(src) as zin, zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED) as zout:
                for item in zin.infolist():
                    zout.writestr(item, zin.read(item.filename))
                zout.writestr(".ebextensions/03-u13.yaml",
                              'option_settings:\n  aws:elasticbeanstalk:application:environment:\n'
                              '    U13_PROBE_EBEXT: "yaml"\n')
        self.upload_version(label, dest, self.state.get("storage_bucket") or "<storage-bucket>")
        return label

    def apply_case(self, name: str, undo: list) -> None:
        """Apply one case, appending each restore step to ``undo`` before its change is sent,
        so a case that fails half-way is still restored."""
        case = CASES[name]
        if "rds_param" in case:
            param, value = case["rds_param"]
            undo.append(("rds", param))
            self.aws("rds", "modify-db-parameter-group", "--db-parameter-group-name", RDS_PARAM_GROUP,
                     "--parameters", f"ParameterName={param},ParameterValue={value},ApplyMethod=immediate")
            self.wait_param_in_sync()
            return
        if "throwaway" in case:
            variant = case["throwaway"]
            env_name = f"{THROWAWAY_PREFIX}{variant.replace('_', '-')}"
            undo.append(("throwaway", env_name))
            tier, label, options, worker = self.throwaway_options(variant)
            if variant == "ebext_naming":
                label = self.ebext_version()
            info = self.ensure_env(tier, env_name, label, options, worker=worker, throwaway=True)
            if worker:
                url = self.queue_url_of(env_name)
                self.aws("elasticbeanstalk", "update-environment", "--environment-name", env_name,
                         "--option-settings", self.file(f"options-{env_name}-queue.json",
                                                        options + [opt(ENV_NS, "QUEUE_URL", url)]))
                self.wait_env(env_name)
            self.note(f"{env_name} is up ({info.get('id')}); it is terminated when the case ends")
            return
        for tier in case["ops"]:
            env_name = ENV_NAMES[tier]
            snapshot = self.snapshot(env_name) if not self.dry else []
            sets, removes = case_options(case, tier)
            touched = [(o["Namespace"], o["OptionName"]) for o in sets + removes]
            undo.append(("env", env_name, snapshot, touched))
            merged = {**options_map(snapshot), **{(o["Namespace"], o["OptionName"]): o["Value"] for o in sets}}
            for r in removes:
                merged.pop((r["Namespace"], r["OptionName"]), None)
            check_options(tier, [opt(ns, n, v) for (ns, n), v in merged.items()], case=case,
                          signin=bool(self.state.get("signin")), dry=self.dry)
            call = ["elasticbeanstalk", "update-environment", "--environment-name", env_name]
            if sets:
                call += ["--option-settings", self.file(f"case-{name}-{tier}.json", sets)]
            if removes:
                call += ["--options-to-remove", self.file(f"case-{name}-{tier}-remove.json", removes)]
            self.aws(*call)
            self.wait_env(env_name)

    def wait_param_in_sync(self) -> None:
        def in_sync():
            db = self.aws("rds", "describe-db-instances", "--db-instance-identifier", RDS_ID)["DBInstances"][0]
            return all(g.get("ParameterApplyStatus") == "in-sync" for g in db.get("DBParameterGroups", []))

        self.poll("ParameterApplyStatus=in-sync", in_sync, every_s=10, timeout_s=600)

    def restore(self, undo: list) -> None:
        """Every step runs even when an earlier one fails; the first failure is raised last."""
        failures = []
        for item in reversed(undo):
            try:
                self.restore_one(item)
            except Die as exc:
                self.out(f"restore failed: {exc}")
                failures.append(exc)
        if failures:
            raise failures[0]

    def restore_one(self, item: tuple) -> None:
        if item[0] == "rds":
            self.aws("rds", "reset-db-parameter-group", "--db-parameter-group-name", RDS_PARAM_GROUP,
                     "--parameters", f"ParameterName={item[1]},ApplyMethod=immediate")
            self.wait_param_in_sync()
        elif item[0] == "throwaway":
            env = self.settle_env(item[1]) if not self.dry else {}
            if env is None:
                self.note(f"{item[1]} does not exist; nothing to terminate")
                return
            if env.get("Status") != "Terminating":
                self.aws("elasticbeanstalk", "terminate-environment", "--environment-name", item[1], ok=NOT_FOUND)
            self.wait_env_gone(item[1])
        else:
            _, env_name, snapshot, touched = item
            self.wait_env(env_name)
            sets, removes = restore_options(snapshot, touched)
            call = ["elasticbeanstalk", "update-environment", "--environment-name", env_name]
            if sets:
                call += ["--option-settings", self.file(f"restore-{env_name}.json", sets)]
            if removes:
                call += ["--options-to-remove", self.file(f"restore-{env_name}-remove.json", removes)]
            self.aws(*call)
            self.wait_env(env_name)

    def probe(self) -> int:
        names = self.args.case or []
        unknown = [n for n in names if n not in CASES]
        if not names or unknown:
            raise Die(f"--case must name one of: {', '.join(CASES)}" + (f" (not {unknown})" if unknown else ""))
        self.require_billed()
        self.guard()
        undo: list = []
        try:
            for name in names:
                self.out(f"== probe --case {name} ({CASES[name]['measures']})")
                self.apply_case(name, undo)
            hold = getattr(self.args, "hold_s", None)
            if self.dry:
                self.note("hold: measure now; the restore below runs on Enter, Ctrl-C or --hold-s")
            elif hold is not None:
                self.out(f"holding {hold} s, then restoring")
                self.sleep(hold)
            else:
                input("case applied: measure, then press Enter to restore (Ctrl-C restores too) ")
        finally:
            self.out("== restore")
            self.restore(undo)
        return 0

    # ── status ───────────────────────────────────────────────────────────────────────

    def status(self) -> int:
        self.guard()
        rc = 0
        try:
            today = dt.datetime.now(dt.timezone.utc).date()
            res = self.aws("ce", "get-cost-and-usage", "--time-period",
                           f"Start={today - dt.timedelta(days=1)},End={today + dt.timedelta(days=1)}",
                           "--granularity", "DAILY", "--metrics", "UnblendedCost", placeholder={"ResultsByTime": []})
            for r in (res or {}).get("ResultsByTime", []):
                self.out(f"daily cost {r['TimePeriod']['Start']}: {float(r['Total']['UnblendedCost']['Amount']):.2f} USD")
        except Die as exc:
            self.out(f"daily cost: unavailable ({exc})")
            rc = 1
        try:
            budget = self.aws("budgets", "describe-budget", "--account-id", self.account, "--budget-name",
                              BUDGET_NAME, ok=NOT_FOUND)
            spent = ((budget or {}).get("Budget", {}).get("CalculatedSpend", {}).get("ActualSpend", {}))
            self.out(f"budget {BUDGET_NAME}: " + (f"actual {spent.get('Amount')} {spent.get('Unit')}" if budget
                                                   else "absent"))
        except Die as exc:
            self.out(f"budget: unreadable ({exc}); the daily cost line is the only guard")
        for env in [r for r in self.recorded("env")]:
            got = self.describe_env(env["id"])
            if got is None:
                self.out(f"{env['id']}: gone")
                continue
            self.out(f"{env['id']}: {got.get('Status')} {got.get('Health')} {got.get('HealthStatus', '')}")
            if self.options_path(env["id"]).is_file():
                drift = self.drift(env["id"])
                for line in drift:
                    self.out(f"  drift: {line}")
                rc = rc or (1 if drift else 0)
        if self.state.get("bastion"):
            rds = self.state.get("rds", {}).get("endpoint", "<rds-endpoint>")
            self.out("RDS forward: " + shlex.join(self.argv([
                "ssm", "start-session", "--target", self.state["bastion"], "--document-name",
                "AWS-StartPortForwardingSessionToRemoteHost", "--parameters",
                f"host={rds},portNumber=5432,localPortNumber=15432"])))
        return rc

    def drift(self, env_name: str) -> list[str]:
        got = self.aws("elasticbeanstalk", "describe-configuration-settings", "--application-name", APP,
                       "--environment-name", env_name, placeholder={"ConfigurationSettings": [{"OptionSettings": []}]})
        live = {(o["Namespace"], o["OptionName"]): o.get("Value")
                for o in got["ConfigurationSettings"][0].get("OptionSettings", [])}
        out = [f"{ns} {n}: {live.get((ns, n))!r}, expected {v!r}"
               for (ns, n), v in options_map(self.snapshot(env_name)).items() if live.get((ns, n)) != v]
        out += [f"{n} is set ({ns}); no case is running" for (ns, n) in live
                if ns == ENV_NS and (n.startswith(("U13_PROBE_",) + tuple(layout.DEV_PREFIXES))
                                     or n in layout.DEV_VARIABLES)]
        return out

    # ── down ─────────────────────────────────────────────────────────────────────────

    def down(self) -> int:
        self.require_billed()
        self.guard()
        steps = [
            ("env", self.down_envs), ("ec2", self.down_bastion), ("rds", self.down_rds),
            ("app", self.down_app), ("secret", self.down_secrets), ("s3", self.down_data_bucket),
            ("sg", self.down_security_groups), ("iam", self.down_iam), ("budget", self.down_budget),
            ("resolver", self.down_resolver), ("log-group", self.down_log_groups),
        ]
        for label, step in steps:
            self.out(f"== down: {label}")
            step()
        self.note("local: remove the /etc/hosts line for the RDS endpoint, then delete the work-dir")
        return 0

    def live_envs(self) -> dict[str, str]:
        """Name -> Status of every environment the application still has."""
        got = self.aws("elasticbeanstalk", "describe-environments", "--application-name", APP,
                       "--no-include-deleted", placeholder={"Environments": [
                           {"EnvironmentName": n, "Status": "Ready"} for n in ENV_NAMES.values()]})
        return {e["EnvironmentName"]: e.get("Status", "") for e in (got or {}).get("Environments", [])
                if e.get("Status") != "Terminated"}

    def down_envs(self) -> None:
        """Terminate only what Beanstalk still lists (a recorded name may be long gone: a
        throwaway, or a re-run), then wait on every live and recorded name."""
        live = self.live_envs()
        for name in sorted(live):
            status = live[name]
            if status in EB_TRANSITIONAL:
                status = (self.settle_env(name) or {"Status": "Terminated"}).get("Status")
            if status not in ("Terminating", "Terminated"):
                self.aws("elasticbeanstalk", "terminate-environment", "--environment-name", name, ok=NOT_FOUND)
        for name in sorted(set(live) | {r["id"] for r in self.recorded("env")}):
            self.wait_env_gone(name)

    def down_bastion(self) -> None:
        got = self.aws("ec2", "describe-instances", "--filters", f"Name=tag:{TAG_REHEARSAL[0]},Values={TAG_REHEARSAL[1]}",
                       "Name=instance-state-name,Values=pending,running,stopping,stopped",
                       placeholder={"Reservations": [{"Instances": [{"InstanceId": "<bastion-id>"}]}]})
        ids = sorted({i["InstanceId"] for r in got.get("Reservations", []) for i in r.get("Instances", [])})
        if ids:
            self.aws("ec2", "terminate-instances", "--instance-ids", *ids, ok=NOT_FOUND)
            self.aws("ec2", "wait", "instance-terminated", "--instance-ids", *ids, ok=NOT_FOUND)

    def down_rds(self) -> None:
        if self.aws("rds", "describe-db-instances", "--db-instance-identifier", RDS_ID, ok=NOT_FOUND,
                    placeholder={"DBInstances": [{}]}) is not None:
            self.aws("rds", "delete-db-instance", "--db-instance-identifier", RDS_ID, "--skip-final-snapshot",
                     "--delete-automated-backups", ok=RDS_DELETING)
            self.aws("rds", "wait", "db-instance-deleted", "--db-instance-identifier", RDS_ID)
        self.aws("rds", "delete-db-subnet-group", "--db-subnet-group-name", RDS_SUBNET_GROUP, ok=NOT_FOUND)
        self.aws("rds", "delete-db-parameter-group", "--db-parameter-group-name", RDS_PARAM_GROUP, ok=NOT_FOUND)

    def storage(self) -> tuple[str, bool]:
        entries = self.recorded("eb-storage")
        if entries:
            return entries[0]["id"], bool(entries[0].get("created_by_run"))
        return self.state.get("storage_bucket") or f"elasticbeanstalk-{REGION}-{self.account}", False

    def down_app(self) -> None:
        self.aws("elasticbeanstalk", "delete-application", "--application-name", APP, "--terminate-env-by-force",
                 ok=NOT_FOUND)
        bucket, created = self.storage()
        if created:
            self.empty_bucket(bucket)
            self.aws("s3api", "delete-bucket-policy", "--bucket", bucket, ok=NOT_FOUND)
            self.aws("s3api", "delete-bucket", "--bucket", bucket, ok=NOT_FOUND)
            return
        self.aws("s3", "rm", f"s3://{bucket}/{STORAGE_PREFIX}", "--recursive", text=True, ok=NOT_FOUND)
        for env in self.recorded("env"):
            keys = self.aws("s3api", "list-objects-v2", "--bucket", bucket, "--query",
                            f"Contents[?contains(Key, '{env.get('env_id')}')].Key", ok=NOT_FOUND,
                            placeholder=[f"<keys containing {env.get('env_id')}>"]) or []
            if keys:
                self.aws("s3api", "delete-objects", "--bucket", bucket, "--delete",
                         self.file(f"storage-delete-{env['id']}.json", {"Objects": [{"Key": k} for k in keys]}))

    def empty_bucket(self, bucket: str) -> None:
        self.aws("s3", "rm", f"s3://{bucket}", "--recursive", text=True, ok=NOT_FOUND)
        versioning = self.aws("s3api", "get-bucket-versioning", "--bucket", bucket, ok=NOT_FOUND,
                              placeholder={"Status": "Enabled"}) or {}
        if versioning.get("Status") in ("Enabled", "Suspended"):
            got = self.aws("s3api", "list-object-versions", "--bucket", bucket, ok=NOT_FOUND,
                           placeholder={"Versions": [{"Key": "<key>", "VersionId": "<version>"}]}) or {}
            objects = [{"Key": v["Key"], "VersionId": v["VersionId"]}
                       for v in got.get("Versions", []) + got.get("DeleteMarkers", [])]
            for i in range(0, len(objects), 1000):
                self.aws("s3api", "delete-objects", "--bucket", bucket, "--delete",
                         self.file(f"versions-{bucket}-{i}.json", {"Objects": objects[i:i + 1000]}))

    def down_secrets(self) -> None:
        got = self.aws("secretsmanager", "list-secrets", "--filters", f"Key=name,Values={PREFIX}/",
                       placeholder={"SecretList": [{"Name": f"{PREFIX}/{k}"} for k in SECRET_KEYS]})
        names = {s["Name"] for s in got.get("SecretList", []) if s["Name"].startswith(f"{PREFIX}/")}
        names |= {r["id"] for r in self.recorded("secret")}
        for name in sorted(names):
            self.aws("secretsmanager", "delete-secret", "--secret-id", name, "--force-delete-without-recovery",
                     ok=NOT_FOUND)

    def data_buckets(self) -> list[str]:
        got = self.aws("s3api", "list-buckets", "--query", f"Buckets[?starts_with(Name, '{PREFIX}-data-')].Name",
                       placeholder=[self.data_bucket]) or []
        return sorted(set(got) | {r["id"] for r in self.recorded("s3")})

    def down_data_bucket(self) -> None:
        for bucket in self.data_buckets():
            self.empty_bucket(bucket)
            self.aws("s3api", "delete-bucket", "--bucket", bucket, ok=NOT_FOUND)

    def down_security_groups(self) -> None:
        got = self.aws("ec2", "describe-security-groups", "--filters", f"Name=group-name,Values={PREFIX}-*",
                       placeholder={"SecurityGroups": [{"GroupName": f"{PREFIX}-{n}", "GroupId": f"<sg-{n}>"}
                                                       for n in SECURITY_GROUPS]})
        by_name = {g["GroupName"]: g["GroupId"] for g in got.get("SecurityGroups", [])}
        order = [f"{PREFIX}-{n}" for n in SG_DELETE_ORDER]
        for name in order + sorted(set(by_name) - set(order)):
            if name not in by_name:
                continue
            deadline = time.monotonic() + 600
            while True:
                done = self.aws("ec2", "delete-security-group", "--group-id", by_name[name],
                                ok=re.compile(NOT_FOUND.pattern + "|DependencyViolation", re.I))
                if done is not None or self.dry:
                    break
                still = self.aws("ec2", "describe-security-groups", "--group-ids", by_name[name], ok=NOT_FOUND)
                if still is None:
                    break
                if time.monotonic() > deadline:
                    raise Die(f"{name} still has dependencies after 10 min", rc=1)
                self.note(f"{name}: DependencyViolation; retrying in 30 s")
                self.sleep(30)

    def down_iam(self) -> None:
        profiles = self.aws("iam", "list-instance-profiles", "--path-prefix", IAM_PATH, placeholder={
            "InstanceProfiles": [{"InstanceProfileName": f"{PREFIX}-{p}", "Roles": [{"RoleName": f"{PREFIX}-{p}"}]}
                                 for p in PROFILES]})
        for p in profiles.get("InstanceProfiles", []):
            for role in p.get("Roles", []):
                self.aws("iam", "remove-role-from-instance-profile", "--instance-profile-name",
                         p["InstanceProfileName"], "--role-name", role["RoleName"], ok=NOT_FOUND)
            self.aws("iam", "delete-instance-profile", "--instance-profile-name", p["InstanceProfileName"],
                     ok=NOT_FOUND)
        roles = self.aws("iam", "list-roles", "--path-prefix", IAM_PATH,
                         placeholder={"Roles": [{"RoleName": f"{PREFIX}-{r}"} for r in ROLES]})
        for r in roles.get("Roles", []):
            name = r["RoleName"]
            attached = self.aws("iam", "list-attached-role-policies", "--role-name", name, ok=NOT_FOUND,
                                placeholder={"AttachedPolicies": [{"PolicyArn": "<managed-policy-arn>"}]}) or {}
            for p in attached.get("AttachedPolicies", []):
                self.aws("iam", "detach-role-policy", "--role-name", name, "--policy-arn", p["PolicyArn"],
                         ok=NOT_FOUND)
            inline = self.aws("iam", "list-role-policies", "--role-name", name, ok=NOT_FOUND,
                              placeholder={"PolicyNames": [name]}) or {}
            for p in inline.get("PolicyNames", []):
                self.aws("iam", "delete-role-policy", "--role-name", name, "--policy-name", p, ok=NOT_FOUND)
            self.aws("iam", "delete-role", "--role-name", name, ok=NOT_FOUND)
        self.note("service-linked roles Beanstalk or RDS created are account-shared and left in place")

    def down_budget(self) -> None:
        self.aws("budgets", "delete-budget", "--account-id", self.account, "--budget-name", BUDGET_NAME,
                 ok=NOT_FOUND)

    def down_resolver(self) -> None:
        got = self.aws("route53resolver", "list-resolver-query-log-configs", "--filters",
                       f"Name=Name,Values={RESOLVER_NAME}",
                       placeholder={"ResolverQueryLogConfigs": [{"Id": "<rqlc-id>"}]})
        for config in got.get("ResolverQueryLogConfigs", []):
            assoc = self.aws("route53resolver", "list-resolver-query-log-config-associations", "--filters",
                             f"Name=ResolverQueryLogConfigId,Values={config['Id']}",
                             placeholder={"ResolverQueryLogConfigAssociations": [{"ResourceId": "<vpc-id>"}]})
            for a in assoc.get("ResolverQueryLogConfigAssociations", []):
                self.aws("route53resolver", "disassociate-resolver-query-log-config",
                         "--resolver-query-log-config-id", config["Id"], "--resource-id", a["ResourceId"],
                         ok=NOT_FOUND)

            def gone(cid=config["Id"]):
                left = self.aws("route53resolver", "list-resolver-query-log-config-associations", "--filters",
                                f"Name=ResolverQueryLogConfigId,Values={cid}")
                return not [a for a in left.get("ResolverQueryLogConfigAssociations", [])
                            if a.get("Status") != "DELETED"]

            self.poll("the query-log association is gone", gone, every_s=10, timeout_s=600)
            self.aws("route53resolver", "delete-resolver-query-log-config", "--resolver-query-log-config-id",
                     config["Id"], ok=NOT_FOUND)
        self.aws("logs", "delete-log-group", "--log-group-name", RESOLVER_LOG_GROUP, ok=NOT_FOUND)

    def down_log_groups(self) -> None:
        got = self.aws("logs", "describe-log-groups", "--log-group-name-prefix", EB_LOG_PREFIX,
                       placeholder={"logGroups": [{"logGroupName": f"{EB_LOG_PREFIX}-web/var/log/web.stdout.log"}]})
        for g in got.get("logGroups", []):
            self.aws("logs", "delete-log-group", "--log-group-name", g["logGroupName"], ok=NOT_FOUND)

    # ── prove-empty ──────────────────────────────────────────────────────────────────

    def prove_empty(self) -> int:
        self.guard()
        left: list[str] = []

        def found(kind: str, what: str, items) -> None:
            if items:
                left.append(f"{kind}: {what}: {items}")

        tagged = self.tagged()
        if tagged and not self.dry:
            self.note("tagged resources remain; the tag index lags deletes, so re-polling once")
            self.sleep(getattr(self.args, "repoll_s", 600))
            tagged = self.tagged()
        found("tagged", "resourcegroupstaggingapi", tagged)
        apps = self.aws("elasticbeanstalk", "describe-applications", "--application-names", APP,
                        placeholder={"Applications": []})
        found("app", APP, [a["ApplicationName"] for a in apps.get("Applications", [])])
        envs = self.aws("elasticbeanstalk", "describe-environments", "--application-name", APP,
                        "--no-include-deleted", placeholder={"Environments": []})
        found("env", "environments", [e["EnvironmentName"] for e in envs.get("Environments", [])
                                      if e.get("Status") != "Terminated"])
        for env in self.recorded("env"):
            if self.aws("cloudformation", "describe-stacks", "--stack-name", env["stack"], ok=NOT_FOUND,
                        placeholder=None) is not None:
                found("env", "stack", [env["stack"]])
            for arn in env.get("load_balancers") or []:
                if self.aws("elbv2", "describe-load-balancers", "--load-balancer-arns", arn,
                            ok=re.compile("LoadBalancerNotFound|ValidationError"), placeholder=None) is not None:
                    found("env", "load balancer", [arn])
            for url in env.get("queues") or []:
                if self.aws("sqs", "get-queue-url", "--queue-name", url.rsplit("/", 1)[-1], ok=NOT_FOUND,
                            placeholder=None) is not None:
                    found("env", "queue", [url])
        eips = self.aws("ec2", "describe-addresses", "--filters",
                        f"Name=tag:elasticbeanstalk:environment-name,Values={PREFIX}-*", placeholder={"Addresses": []})
        found("env", "elastic IPs", [a.get("PublicIp") for a in eips.get("Addresses", [])])
        inst = self.aws("ec2", "describe-instances", "--filters",
                        f"Name=tag:{TAG_REHEARSAL[0]},Values={TAG_REHEARSAL[1]}",
                        "Name=instance-state-name,Values=pending,running,shutting-down,stopping,stopped",
                        placeholder={"Reservations": []})
        found("ec2", "instances", [i["InstanceId"] for r in inst.get("Reservations", []) for i in r["Instances"]])
        sgs = self.aws("ec2", "describe-security-groups", "--filters", f"Name=group-name,Values={PREFIX}-*",
                       placeholder={"SecurityGroups": []})
        found("sg", "security groups", [g["GroupName"] for g in sgs.get("SecurityGroups", [])])
        for kind, call in (("rds", ["describe-db-instances", "--db-instance-identifier", RDS_ID]),
                           ("db-subnet-group", ["describe-db-subnet-groups", "--db-subnet-group-name", RDS_SUBNET_GROUP]),
                           ("db-param-group", ["describe-db-parameter-groups", "--db-parameter-group-name",
                                               RDS_PARAM_GROUP])):
            if self.aws("rds", *call, ok=NOT_FOUND, placeholder=None) is not None:
                found(kind, call[-1], [call[-1]])
        secrets = self.aws("secretsmanager", "list-secrets", "--filters", f"Key=name,Values={PREFIX}/",
                           placeholder={"SecretList": []})
        found("secret", "secrets", [s["Name"] for s in secrets.get("SecretList", [])])
        for bucket in self.data_buckets_for_proof():
            if self.head_bucket(bucket):
                found("s3", "data bucket", [bucket])
        bucket, created = self.storage()
        if created:
            if self.head_bucket(bucket):
                found("eb-storage", "storage bucket this run created", [bucket])
        else:
            keys = self.aws("s3api", "list-objects-v2", "--bucket", bucket, "--prefix", STORAGE_PREFIX,
                            "--query", "Contents[].Key", ok=NOT_FOUND, placeholder=None) or []
            found("eb-storage", f"s3://{bucket}/{STORAGE_PREFIX}", keys)
            for env in self.recorded("env"):
                keys = self.aws("s3api", "list-objects-v2", "--bucket", bucket, "--query",
                                f"Contents[?contains(Key, '{env.get('env_id')}')].Key", ok=NOT_FOUND,
                                placeholder=None) or []
                found("eb-storage", f"keys naming {env.get('env_id')}", keys)
        roles = self.aws("iam", "list-roles", "--path-prefix", IAM_PATH, placeholder={"Roles": []})
        found("iam-role", "roles", [r["RoleName"] for r in roles.get("Roles", [])])
        profiles = self.aws("iam", "list-instance-profiles", "--path-prefix", IAM_PATH,
                            placeholder={"InstanceProfiles": []})
        found("instance-profile", "instance profiles", [p["InstanceProfileName"] for p in profiles.get(
            "InstanceProfiles", [])])
        if self.aws("budgets", "describe-budget", "--account-id", self.account, "--budget-name", BUDGET_NAME,
                    ok=NOT_FOUND, placeholder=None) is not None:
            found("budget", "budget", [BUDGET_NAME])
        configs = self.aws("route53resolver", "list-resolver-query-log-configs", "--filters",
                           f"Name=Name,Values={RESOLVER_NAME}", placeholder={"ResolverQueryLogConfigs": []})
        found("resolver", "query-log configs", [c["Id"] for c in configs.get("ResolverQueryLogConfigs", [])])
        for prefix in (EB_LOG_PREFIX, f"/{PREFIX}/"):
            groups = self.aws("logs", "describe-log-groups", "--log-group-name-prefix", prefix,
                              placeholder={"logGroups": []})
            found("log-group", prefix, [g["logGroupName"] for g in groups.get("logGroups", [])])
        for line in left:
            self.out(f"NOT EMPTY {line}")
        self.out("prove-empty: " + ("not empty" if left else "empty"))
        return 1 if left else 0

    def tagged(self) -> list[str]:
        got = self.aws("resourcegroupstaggingapi", "get-resources", "--tag-filters",
                       f"Key={TAG_REHEARSAL[0]},Values={TAG_REHEARSAL[1]}",
                       placeholder={"ResourceTagMappingList": []})
        return [m["ResourceARN"] for m in got.get("ResourceTagMappingList", [])]

    def data_buckets_for_proof(self) -> list[str]:
        names = {r["id"] for r in self.recorded("s3")}
        got = self.aws("s3api", "list-buckets", "--query", f"Buckets[?starts_with(Name, '{PREFIX}-data-')].Name",
                       placeholder=[]) or []
        return sorted(names | set(got))

    def head_bucket(self, bucket: str) -> bool:
        """True unless head-bucket answers 404: a 403 is a bucket that still exists."""
        try:
            return self.aws("s3api", "head-bucket", "--bucket", bucket,
                            ok=re.compile(r"\(404\)|Not Found|NoSuchBucket", re.I), placeholder=None) is not None
        except Die:
            return True

    # ── plan ─────────────────────────────────────────────────────────────────────────

    def plan(self) -> int:
        self.guard()
        self.out(f"rehearsal plan: region {REGION}, names {PREFIX}-*, IAM path {IAM_PATH}, tags "
                 f"{TAG_REHEARSAL[0]}={TAG_REHEARSAL[1]} and {TAG_RUN}=<run id>")
        self.out(f"phases (up --phase all): {' '.join(PHASES)}; optional: {' '.join(OPTIONAL_PHASES)}")
        self.out(f"environments: {', '.join(ENV_NAMES.values())}; throwaways {THROWAWAY_PREFIX}*")
        self.out(f"instance types: {INSTANCE_TYPES}; RDS {self.rds_class} PostgreSQL {RDS_ENGINE_VERSION}")
        self.out(f"probe cases: {', '.join(CASES)}")
        self.out("no AWS call is made; the commands `up --phase all` would run follow")
        for phase in PHASES:
            self.out(f"== up --phase {phase}")
            getattr(self, f"phase_{phase}")()
        return 0


# ── leak check ───────────────────────────────────────────────────────────────────────────


LEAK_FILES = ("account", "zone", "host")


def leak_values(local_dir: Path) -> list[str]:
    values = []
    for path in sorted(p for p in local_dir.iterdir() if p.is_file() and p.name in LEAK_FILES):
        tokens = [t for t in re.split(r"[\s,]+", path.read_text(encoding="utf-8")) if t]
        if not tokens:
            raise Die(f"leak-check: {path.name} is empty or whitespace; an empty pattern matches every line")
        values.extend(tokens)
    if not values:
        raise Die(f"leak-check: .local/ holds none of {', '.join(LEAK_FILES)}")
    return values


def history_hits(repo: Path, base: str, values: list[str]) -> list[str]:
    """Every added or removed diff line in <base>..HEAD holding a value, as
    ``history <commit>:<path>``: a value committed and scrubbed later is still pushed."""
    log = subprocess.run(["git", "log", "-p", "--no-color", "--no-ext-diff", "--no-textconv", "--text",
                          "--format=commit %H", f"{base}..HEAD"], cwd=repo, capture_output=True, text=True,
                         encoding="utf-8", errors="replace", check=False)
    if log.returncode != 0:
        raise Die(f"leak-check: git log -p {base}..HEAD failed: {log.stderr.strip()}")
    out, commit, path, header = [], "?", "?", False
    for line in log.stdout.splitlines():
        if line.startswith("commit "):
            commit, path, header = line.split()[1][:12], "?", False
        elif line.startswith("diff --git "):
            header, path = True, line.rsplit(" b/", 1)[-1]
        elif header:
            header = not line.startswith("@@")
        elif line[:1] in "+-" and any(v in line for v in values):
            hit = f"history {commit}:{path}"
            if hit not in out:
                out.append(hit)
    return out


def leak_check(args, *, local_dir: Path = LOCAL_DIR, repo: Path = REPO, out=print) -> int:
    if not local_dir.is_dir():
        raise Die(f"leak-check: no {local_dir}; copy .local/ into this worktree before pushing")
    work = resolve_work_dir(args.work_dir, repo)
    values = leak_values(local_dir)
    patterns = write_private(work / "leak-patterns", "\n".join(values) + "\n")
    hits: list[str] = []
    grep = subprocess.run(["git", "grep", "-n", "-F", "--untracked", "-f", str(patterns)], cwd=repo,
                          capture_output=True, text=True, encoding="utf-8", check=False)
    if grep.returncode not in (0, 1):
        raise Die(f"leak-check: git grep failed: {grep.stderr.strip()}")
    for line in grep.stdout.splitlines():
        hits.append("tree " + ":".join(line.split(":", 2)[:2]) if not line.startswith("Binary") else line)

    def scan(label: str, text: str) -> None:
        for n, line in enumerate(text.splitlines(), 1):
            if any(v in line for v in values):
                hits.append(f"{label}:{n}")

    for body in args.body or []:
        scan(f"body {body}", Path(body).read_text(encoding="utf-8"))
    log = subprocess.run(["git", "log", f"{args.base}..HEAD", "--format=%B"], cwd=repo, capture_output=True,
                         text=True, encoding="utf-8", check=False)
    if log.returncode != 0:
        raise Die(f"leak-check: git log {args.base}..HEAD failed: {log.stderr.strip()}")
    scan(f"commit messages since {args.base}", log.stdout)
    hits.extend(history_hits(repo, args.base, values))
    for hit in hits:
        out(f"LEAK {hit}")
    out(f"leak-check: {len(hits)} hit(s) for {len(values)} value(s) from .local/")
    return 1 if hits else 0


# ── CLI ───────────────────────────────────────────────────────────────────────────────


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--work-dir", help="local state, option files and 0600 secret files (outside the repo)")
    common.add_argument("--profile", help="the aws CLI profile")
    common.add_argument("--region", default=REGION, help=f"must be {REGION}")
    common.add_argument("--expect-account", help="the 12-digit account the caller must be in (else .local/account)")
    common.add_argument("--dry-run", action="store_true", help="call nothing; print pasteable commands")
    billed = argparse.ArgumentParser(add_help=False)
    billed.add_argument("--billed", action="store_true", help="acknowledge that this spends money")
    sub = p.add_subparsers(dest="cmd", required=True)
    plan = sub.add_parser("plan", parents=[common], help="print names, phases and every `up` command; no AWS call")
    plan.add_argument("--run-id")
    up = sub.add_parser("up", parents=[common, billed], help="provision, one or more phases")
    up.add_argument("--phase", action="append", help=f"all, or one of {', '.join(PHASES + OPTIONAL_PHASES)}")
    up.add_argument("--run-id", help="fixed on the first up, kept in the inventory")
    up.add_argument("--bundles-dir", help="a CI eb-bundles artifact: eb-bundles.json and the three zips")
    up.add_argument("--alert-email", help="the budget's alert address (else .local/alert-email)")
    up.add_argument("--allowed-emails", help="signin: patrons, space- or comma-separated (else .local/allowed-emails)")
    up.add_argument("--mode", choices=("loopback", "https", "off"), help="signin's mode (default loopback)")
    up.add_argument("--env", action="append", help="<tier>:NAME=VALUE, a non-secret operator override")
    up.add_argument("--rds-class", default=RDS_CLASS, help=f"RDS instance class (default {RDS_CLASS}); another one when AWS reports InsufficientDBInstanceCapacity")
    up.add_argument("--env-file", help=f"where ANTHROPIC_API_KEY is read (default {EVAL_ENV.relative_to(REPO)})")
    sub.add_parser("status", parents=[common], help="daily cost, budget, environment health and drift")
    probe = sub.add_parser("probe", parents=[common, billed], help="apply probe cases, hold, restore")
    probe.add_argument("--case", action="append", help=f"one of {', '.join(CASES)}; repeatable")
    probe.add_argument("--hold-s", type=float, help="restore after this many seconds instead of on Enter")
    probe.add_argument("--bundles-dir", help="ebext_naming copies eb-tools.zip from here")
    sub.add_parser("down", parents=[common, billed], help="tear everything down, in order")
    proof = sub.add_parser("prove-empty", parents=[common], help="exit 1 if anything of the rehearsal remains")
    proof.add_argument("--repoll-s", type=float, default=600)
    leak = sub.add_parser("leak-check", help="no .local/ value in the tree, a PR body, or <base>..HEAD's messages and diffs")
    leak.add_argument("--work-dir")
    leak.add_argument("--body", action="append", help="a PR body (or any text) file to scan; repeatable")
    leak.add_argument("--base", default="main", help="<base>..HEAD's commit messages and diffs are scanned")
    return p


def main(argv: list[str] | None = None, *, runner=None, sleep=time.sleep, out=None,
         local_dir: Path = LOCAL_DIR, repo: Path = REPO) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    args = build_parser().parse_args(argv)
    printer = out or (lambda line: print(line, flush=True))
    try:
        if args.cmd == "leak-check":
            return leak_check(args, local_dir=local_dir, repo=repo, out=printer)
        r = Rehearsal(args, runner=runner, sleep=sleep, out=printer, local_dir=local_dir, repo=repo)
        return {"plan": r.plan, "up": r.up, "status": r.status, "probe": r.probe, "down": r.down,
                "prove-empty": r.prove_empty}[args.cmd]()
    except Die as exc:
        print(f"rehearse.py: {exc}", file=sys.stderr)
        return exc.rc
    except KeyboardInterrupt:
        print("rehearse.py: interrupted", file=sys.stderr)
        return 130


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Verify built Elastic Beanstalk bundles (U12) against the deploy contract.

    python scripts/eb_bundles/verify.py [--no-pip] [--allow-dev] [--arch x86_64,aarch64] <zip>...

Exit 0 when every zip passes; exit 1 listing every finding. The tier comes from the file
name (eb-web.zip, eb-worker.zip, eb-tools.zip).

Independent of build.py and layout.py on purpose -- it imports neither and states every
path, port rule and limit itself -- so a builder bug is caught here instead of being
agreed with. Same posture as scripts/verify-mcpb.sh for the .mcpb.

The offline pip dry-run resolves requirements.txt against the bundle's wheels/ for each
architecture, so a dependency with no aarch64 wheel fails on an x86_64 CI runner.
"""
from __future__ import annotations

import argparse
import json
import re
import shlex
import subprocess
import sys
import tempfile
import zipfile
from collections import Counter
from pathlib import Path, PurePosixPath

SIZE_LIMIT_BYTES = 500_000_000
APP_DIR = "/var/app/current/"
ARCHES = ("x86_64", "aarch64")
# AL2023's glibc is 2.34.
GLIBC_MINOR = 34
ENV_NAMESPACE = "aws:elasticbeanstalk:application:environment"
CA_VAR = {"web": "PGSSLROOTCERT", "worker": "PGSSLROOTCERT", "tools": "NODE_EXTRA_CA_CERTS"}
WORKER_COMMAND = "python proto/worker/worker.py"
WORKER_PORT = "8000"

# Beanstalk's documented Procfile/Buildfile line shape.
PROCFILE_LINE = re.compile(r"^[A-Za-z0-9_-]+:\s*[^\s].*$")
# scripts/build-stamp.mjs's BUILD_VERSION_RE.
BUILD_VERSION_RE = re.compile(r"^\d+\.\d+\.\d+\+(dev|\d{4}-\d{2}-\d{2}\.[0-9a-f]{7,40}(\.dirty)?)$")

COMMON_REQUIRED = ("Procfile", "BUILD-INFO.json", "certs/rds-global-bundle.pem")
REQUIRED = {
    "web": COMMON_REQUIRED + ("requirements.txt", "web/app.py", "web/auth.py", "web/spa.py", "enqueue.py", "grants.py",
                              "migrate.py", "config/familysearch.json", "web-dist/index.html"),
    "worker": COMMON_REQUIRED + ("requirements.txt", "app/__init__.py", "app/agent/__init__.py",
                                 "app/agent/real_agent.py", "proto/enqueue.py", "proto/grants.py", "proto/migrate.py",
                                 "proto/worker/worker.py", "proto/worker/options.py",
                                 "plugin/.claude-plugin/plugin.json", "plugin/hooks/hooks.json"),
    "tools": COMMON_REQUIRED + ("package.json", "package-lock.json", "build/http.js", "build/build-info.json",
                                "config/familysearch.json", "node_modules/pg/package.json",
                                "smoke/dev/smoke-http.js"),
}
REQUIRED_PREFIXES = {
    "web": (".ebextensions/", "wheels/", "sql/", "web-dist/assets/"),
    "worker": (".ebextensions/", ".platform/hooks/predeploy/", "wheels/", "proto/sql/", "plugin/agents/",
               "plugin/skills/"),
    "tools": (".ebextensions/", "node_modules/@modelcontextprotocol/sdk/"),
}

# Forbidden anywhere in the zip.
FORBIDDEN_ANYWHERE = re.compile(r"(^|/)(\.fs-token|__pycache__)(/|$)|\.pyc$")
# Forbidden anywhere but node_modules/, a third-party tree npm ci wrote (zod ships tests/).
FORBIDDEN_OUTSIDE_NODE_MODULES = re.compile(
    r"(^|/)(\.env(\.[^/]*)?|\.npmrc|\.DS_Store)$|(^|/)(tests|exports)/")
# Image and doc files that belong to the checkout, not to tier code.
FORBIDDEN_IN_CODE = re.compile(r"(^|/)(Dockerfile|README\.md)$")
CODE_EXEMPT = ("node_modules/", "plugin/", "web-dist/", "wheels/")
TOOLS_FORBIDDEN_PREFIXES = ("src/", "dev/", "node_modules/typescript/", "node_modules/vitest/",
                            "node_modules/@anthropic-ai/mcpb/")
HOOK_DIRS = (".platform/hooks/", ".platform/confighooks/")


def tier_of(path: Path) -> str | None:
    m = re.fullmatch(r"eb-(web|worker|tools)\.zip", path.name)
    return m.group(1) if m else None


def _env_settings(zf: zipfile.ZipFile, names: list[str], findings: list[str]) -> dict[str, str]:
    """The application-environment options across .ebextensions/*.config, in either of
    option_settings' shapes (namespace map, or a list of namespace/option_name/value)."""
    try:
        import yaml
    except ImportError:
        findings.append("pyyaml is not installed; cannot read .ebextensions (run through make eb-bundles-verify)")
        return {}
    env: dict[str, str] = {}
    for name in sorted(n for n in names if re.fullmatch(r"\.ebextensions/[^/]+\.config", n)):
        try:
            doc = yaml.safe_load(zf.read(name).decode("utf-8")) or {}
        except (yaml.YAMLError, UnicodeDecodeError) as exc:
            findings.append(f"{name} does not parse: {exc}")
            continue
        settings = doc.get("option_settings") if isinstance(doc, dict) else None
        if isinstance(settings, dict):
            for key, value in (settings.get(ENV_NAMESPACE) or {}).items():
                env[str(key)] = str(value)
        elif isinstance(settings, list):
            for item in settings:
                if isinstance(item, dict) and item.get("namespace") == ENV_NAMESPACE and "option_name" in item:
                    env[str(item["option_name"])] = str(item.get("value", ""))
    return env


def _check_procfile(tier: str, text: str, env: dict[str, str], findings: list[str]) -> None:
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    for ln in lines:
        if not PROCFILE_LINE.match(ln):
            findings.append(f"Procfile line does not match Beanstalk's format: {ln!r}")
    web = [ln.split(":", 1)[1].strip() for ln in lines if ln.split(":", 1)[0] == "web"]
    if len(web) != 1:
        findings.append(f"Procfile needs exactly one web: line, found {len(web)}")
        return
    cmd = web[0]
    port = env.get("PORT")
    if tier == "worker":
        if cmd.split() != WORKER_COMMAND.split():
            findings.append(f"worker Procfile must be exactly `web: {WORKER_COMMAND}` (worker.py reads PORT, "
                            f"not argv), found `web: {cmd}`")
        if port != WORKER_PORT:
            findings.append(f"worker template must set PORT={WORKER_PORT} (nginx's upstream), found {port!r}")
        return
    try:
        argv = shlex.split(cmd)
    except ValueError as exc:
        findings.append(f"Procfile web: command does not parse: {exc}")
        return
    ports = [argv[i + 1] for i, a in enumerate(argv[:-1]) if a == "--port"]
    ports += [a.split("=", 1)[1] for a in argv if a.startswith("--port=")]
    if len(ports) != 1:
        findings.append(f"Procfile web: command needs one --port, found {ports or 'none'}")
    elif port is None:
        findings.append("template sets no PORT; Beanstalk's nginx would proxy to the platform default")
    elif ports[0] != port:
        findings.append(f"Procfile --port {ports[0]} differs from the template's PORT={port}")


def verify(path: Path, *, pip: bool = True, allow_dev: bool = False, arches: tuple[str, ...] = ARCHES,
           size_limit: int = SIZE_LIMIT_BYTES, tier: str | None = None) -> list[str]:
    findings: list[str] = []
    tier = tier or tier_of(path)
    if tier is None:
        return [f"cannot tell the tier from the name {path.name!r} (want eb-web.zip, eb-worker.zip or eb-tools.zip)"]
    size = path.stat().st_size
    if size > size_limit:
        findings.append(f"{size:,} bytes, over the {size_limit:,}-byte Beanstalk limit")
    try:
        zf = zipfile.ZipFile(path)
    except zipfile.BadZipFile as exc:
        return findings + [f"not a zip: {exc}"]
    with zf:
        infos = [i for i in zf.infolist() if not i.is_dir()]
        names = [i.filename for i in infos]
        _check_names(tier, names, findings)

        env = _env_settings(zf, names, findings)
        if "Procfile" in names:
            _check_procfile(tier, zf.read("Procfile").decode("utf-8", "replace"), env, findings)

        ca_var = CA_VAR[tier]
        ca = env.get(ca_var)
        if not ca:
            findings.append(f"template sets no {ca_var}")
        elif not ca.startswith(APP_DIR) or ca[len(APP_DIR):] not in names:
            findings.append(f"{ca_var}={ca} does not name a file this bundle puts under {APP_DIR}")

        for info in infos:
            if info.filename.startswith(HOOK_DIRS) and not (info.external_attr >> 16) & 0o100:
                findings.append(f"{info.filename} has no exec bit; Beanstalk skips (or fails on) a "
                                "non-executable hook")

        if tier in ("web", "worker") and "requirements.txt" in names:
            _check_requirements(zf, names, findings, pip=pip, arches=arches)
        if tier == "tools":
            _check_tools(zf, names, findings, allow_dev=allow_dev)
        if tier == "web":
            _check_spa(zf, names, findings)
    return findings


def _check_names(tier: str, names: list[str], findings: list[str]) -> None:
    present = set(names)
    dupes = sorted(n for n, c in Counter(names).items() if c > 1)
    if dupes:
        findings.append(f"duplicate entries: {dupes}")
    unsafe = [n for n in names if n.startswith("/") or ".." in PurePosixPath(n).parts or "\\" in n]
    if unsafe:
        findings.append(f"unsafe entry names: {unsafe[:5]}")
    tops = {n.split("/", 1)[0] for n in names}
    if len(tops) == 1 and all("/" in n for n in names):
        findings.append(f"everything sits under one top-level folder {tops.pop()!r}; Beanstalk wants "
                        "Procfile at the zip root")
    for req in REQUIRED[tier]:
        if req not in present:
            findings.append(f"missing {req}")
    for prefix in REQUIRED_PREFIXES[tier]:
        if not any(n.startswith(prefix) for n in names):
            findings.append(f"missing {prefix}")
    for n in names:
        if FORBIDDEN_ANYWHERE.search(n):
            findings.append(f"forbidden {n}")
        elif not n.startswith("node_modules/") and FORBIDDEN_OUTSIDE_NODE_MODULES.search(n):
            findings.append(f"forbidden {n}")
        elif not n.startswith(CODE_EXEMPT) and FORBIDDEN_IN_CODE.search(n):
            findings.append(f"forbidden {n} (checkout file in tier code)")
        elif tier == "tools" and n.startswith(TOOLS_FORBIDDEN_PREFIXES):
            findings.append(f"forbidden {n} (source or dev-only package in the tools bundle)")


def _check_requirements(zf: zipfile.ZipFile, names: list[str], findings: list[str], *, pip: bool,
                        arches: tuple[str, ...]) -> None:
    lines = [ln.strip() for ln in zf.read("requirements.txt").decode("utf-8", "replace").splitlines()]
    head = [ln for ln in lines if ln and not ln.startswith("#")][:2]
    if head != ["--no-index", "--find-links wheels"]:
        findings.append(f"requirements.txt must begin with --no-index and --find-links wheels, begins {head}")
    if not any(n.startswith("wheels/") and n.endswith(".whl") for n in names):
        findings.append("wheels/ holds no wheel")
    if not pip:
        return
    with tempfile.TemporaryDirectory(prefix="eb-verify-") as tmp:
        for n in names:
            if n == "requirements.txt" or n.startswith("wheels/"):
                zf.extract(n, tmp)
        for arch in arches:
            cmd = [sys.executable, "-m", "pip", "install", "--disable-pip-version-check", "--dry-run",
                   "--no-index", "--find-links", "wheels", "--only-binary=:all:",
                   *[a for plat in _manylinux(arch) for a in ("--platform", plat)], "--python-version", "3.12",
                   "--target", str(Path(tmp) / f"target-{arch}"), "-r", "requirements.txt"]
            proc = subprocess.run(cmd, cwd=tmp, capture_output=True, text=True, encoding="utf-8")
            if proc.returncode != 0:
                tail = " | ".join((proc.stderr or proc.stdout).strip().splitlines()[-3:])
                findings.append(f"offline pip dry-run fails for {arch}: {tail}")


def _manylinux(arch: str) -> list[str]:
    """Every platform tag pip on AL2023 (glibc 2.34) accepts, newest first. pip does not
    widen an explicit --platform manylinux_2_34 to the older glibc tags itself."""
    return [f"manylinux_2_{minor}_{arch}" for minor in range(GLIBC_MINOR, 16, -1)] + [f"manylinux2014_{arch}"]


def _check_tools(zf: zipfile.ZipFile, names: list[str], findings: list[str], *, allow_dev: bool) -> None:
    if "build/build-info.json" not in names:
        return
    try:
        version = json.loads(zf.read("build/build-info.json").decode("utf-8")).get("version")
    except (ValueError, AttributeError) as exc:
        findings.append(f"build/build-info.json is not a JSON object: {exc}")
        return
    if not isinstance(version, str) or not BUILD_VERSION_RE.match(version):
        findings.append(f"build/build-info.json version {version!r} is not a build stamp")
    elif version.endswith("+dev") and not allow_dev:
        findings.append(f"build/build-info.json version {version} carries no git sha (built outside a checkout)")


def _check_spa(zf: zipfile.ZipFile, names: list[str], findings: list[str]) -> None:
    js = b"".join(zf.read(n) for n in names if n.startswith("web-dist/") and n.endswith(".js"))
    if b"new EventSource" not in js:
        findings.append("web-dist JS has no `new EventSource`: not the SSE build (VITE_SESSION_TRANSPORT=sse)")
    if b"new WebSocket" in js:
        findings.append("web-dist JS opens a WebSocket: the hosted-viewer transport, not the SSE build")


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("zips", nargs="+", type=Path)
    ap.add_argument("--no-pip", action="store_true", help="skip the offline pip dry-run")
    ap.add_argument("--allow-dev", action="store_true", help="accept a tools build-info version of +dev")
    ap.add_argument("--arch", default=",".join(ARCHES), help="architectures the pip dry-run checks")
    ap.add_argument("--size-limit", type=int, default=SIZE_LIMIT_BYTES)
    args = ap.parse_args(argv)
    arches = tuple(a.strip() for a in args.arch.split(",") if a.strip())
    if not arches or any(a not in ARCHES for a in arches):
        ap.error(f"--arch must be a comma list of {', '.join(ARCHES)}")

    failed = 0
    for path in args.zips:
        if not path.is_file():
            print(f"FAIL  {path}: not found")
            failed += 1
            continue
        findings = verify(path, pip=not args.no_pip, allow_dev=args.allow_dev, arches=arches,
                          size_limit=args.size_limit)
        if findings:
            failed += 1
            print(f"FAIL  {path} ({len(findings)} finding{'s' if len(findings) != 1 else ''})")
            for f in findings:
                print(f"        {f}")
        else:
            print(f"ok    {path} ({path.stat().st_size:,} bytes)")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

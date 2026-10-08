"""Offline checks on the Beanstalk bundle builder and verifier (U12, scripts/eb_bundles/).

The builder's source selection is checked against what git lists and against the web and
worker Dockerfiles' COPY sources, so a module added to an image reaches its bundle too. The
verifier is checked on synthetic zips: one legitimate bundle per tier passes, and each
rejection the deploy contract names is a mutation of it that must fail. Nothing here builds a
real bundle or runs pip; `make eb-bundles && make eb-bundles-verify` (the eb-bundles CI job)
does that.
"""
from __future__ import annotations

import ast
import importlib.util
import json
import re
import shlex
import stat
import subprocess
import sys
import zipfile
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[3]
SCRIPTS = REPO / "scripts" / "eb_bundles"


def _load(name: str):
    spec = importlib.util.spec_from_file_location(f"eb_bundles_{name}", SCRIPTS / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


layout = _load("layout")
build = _load("build")
verify = _load("verify")
smoke = _load("smoke")


# ── source selection ─────────────────────────────────────────────────────────────


@pytest.fixture(scope="module")
def files() -> dict[str, int]:
    return build.git_files()


def _git_listed() -> set[str]:
    out = subprocess.run(["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"], cwd=REPO,
                         check=True, capture_output=True, text=True, encoding="utf-8").stdout
    return {p for p in out.split("\0") if p}


@pytest.mark.parametrize("tier", layout.TIERS)
def test_tier_sources_are_listed_by_git_and_never_forbidden(tier, files):
    sources = build.tier_sources(tier, files)
    listed = _git_listed()
    assert sources, f"{tier}: no sources selected"
    assert not [src for src, _ in sources if src not in listed], "a source git does not list"
    bad = [dest for _, dest in sources
           if verify.FORBIDDEN_ANYWHERE.search(dest)
           or (not dest.startswith("node_modules/") and verify.FORBIDDEN_OUTSIDE_NODE_MODULES.search(dest))
           or (not dest.startswith(verify.CODE_EXEMPT) and verify.FORBIDDEN_IN_CODE.search(dest))]
    assert not bad, f"{tier}: the builder would ship {bad}"
    assert ("Procfile" in {dest for _, dest in sources})
    assert not [d for _, d in sources if d.endswith("README.md")], "a template README would ship"


def test_builder_refuses_a_forbidden_source():
    fake = {"apps/server/proto/web/app.py": 0o644, "apps/server/proto/eb-web/Procfile": 0o644,
            "apps/server/proto/eb-web/.env": 0o644}
    with pytest.raises(build.BuildError, match="refusing to ship"):
        build.tier_sources("web", fake)
    fake.pop("apps/server/proto/eb-web/.env")
    assert [d for _, d in build.tier_sources("web", fake)] == ["Procfile", "web/app.py"]


def test_builder_refuses_a_template_without_procfile():
    with pytest.raises(build.BuildError, match="no Procfile"):
        build.tier_sources("tools", {"apps/server/proto/eb-tools/.ebextensions/01-tools.config": 0o644})


def _final_stage_copies(dockerfile: Path) -> tuple[str, list[tuple[list[str], str]]]:
    """(WORKDIR, [(sources, dest)]) for the final stage's COPY lines that read the build
    context (a COPY --from= reads another stage)."""
    text = re.sub(r"\\\n", " ", dockerfile.read_text(encoding="utf-8"))
    lines = [ln.strip() for ln in text.splitlines() if ln.strip() and not ln.strip().startswith("#")]
    last = max(i for i, ln in enumerate(lines) if ln.upper().startswith("FROM "))
    workdir, copies = "/", []
    for ln in lines[last + 1:]:
        words = shlex.split(ln)
        if words[0].upper() == "WORKDIR":
            workdir = words[1]
        elif words[0].upper() == "COPY":
            args = words[1:]
            if any(a.startswith("--from") for a in args):
                continue
            args = [a for a in args if not a.startswith("--")]
            copies.append((args[:-1], args[-1]))
    return workdir, copies


# The image path each tier's bundle root (or a moved directory) stands for.
IMAGE_ROOTS = {
    "web": {"/app": ""},
    "worker": {"/opt/genealogy/server": "", layout.PLUGIN_DEST: layout.PLUGIN_IN_BUNDLE},
}
NOT_TIER_CODE = {"Dockerfile", "README.md", "requirements.txt"}


def _bundle_path(tier: str, image_path: str) -> str | None:
    for root, dest in sorted(IMAGE_ROOTS[tier].items(), key=lambda kv: -len(kv[0])):
        if image_path == root or image_path.startswith(root + "/"):
            rest = image_path[len(root) + 1:]
            return "/".join(p for p in (dest, rest) if p)
    return None


@pytest.mark.parametrize("tier", ["web", "worker"])
def test_every_dockerfile_copy_source_ships_where_the_image_puts_it(tier, files):
    workdir, copies = _final_stage_copies(REPO / f"apps/server/proto/{tier}/Dockerfile")
    shipped = set(build.tier_sources(tier, files))
    assert copies, "no COPY parsed from the final stage"
    for sources, dest in copies:
        for src in sources:
            if src == layout.REQUIREMENTS[tier]:
                continue
            target = dest if dest.startswith("/") else f"{workdir.rstrip('/')}/{dest}"
            target = re.sub(r"/\./|/\.$", "/", target)
            under = sorted(f for f in files if f == src or f.startswith(src + "/"))
            if tier == "worker" and src == "apps/server/app":
                under = [f for f in under if f == "apps/server/app/__init__.py"
                         or re.fullmatch(r"apps/server/app/agent/[^/]+\.py", f)]
            under = [f for f in under if Path(f).name not in NOT_TIER_CODE]
            assert under, f"COPY {src}: nothing git lists under it"
            for f in under:
                if f == src:
                    image = f"{target.rstrip('/')}/{Path(src).name}" if target.endswith("/") else target
                else:
                    image = f"{target.rstrip('/')}/{f[len(src) + 1:]}"
                want = _bundle_path(tier, image)
                assert want is not None, f"COPY {src} {dest}: {image} is outside every image root"
                assert (f, want) in shipped, f"{tier}: {f} is in the image at {image} but not in the bundle at {want}"


def test_hook_entry_round_trips_mode_0755(tmp_path):
    hook = tmp_path / "hook.sh"
    hook.write_text("#!/bin/bash\nset -euo pipefail\n", encoding="utf-8")
    plain = tmp_path / "Procfile"
    plain.write_text("web: true\n", encoding="utf-8")
    target = tmp_path / "out.zip"
    build.write_zip(target, [(".platform/hooks/predeploy/01.sh", hook, 0o755), ("Procfile", plain, 0o644)],
                    (2026, 10, 2, 0, 0, 0))
    with zipfile.ZipFile(target) as zf:
        modes = {i.filename: (i.create_system, i.external_attr >> 16) for i in zf.infolist()}
    assert modes[".platform/hooks/predeploy/01.sh"] == (3, stat.S_IFREG | 0o755)
    assert modes["Procfile"] == (3, stat.S_IFREG | 0o644)


def test_git_files_reads_the_index_exec_bit(files):
    assert files["apps/server/proto/eb-worker-probe/deploy.sh"] == 0o755
    assert files["apps/server/proto/eb-worker-probe/Procfile"] == 0o644


def test_check_pem_counts_and_refuses():
    cert = "-----BEGIN CERTIFICATE-----\nTUlJQg==\n-----END CERTIFICATE-----\n"
    assert build.check_pem((cert * 3).encode()) == 3
    for bad in (b"", b"<html>not found</html>", cert.replace("TUlJQg==", "not*base64").encode(),
                (cert + "-----BEGIN CERTIFICATE-----\nTUlJQg==\n").encode()):
        with pytest.raises(build.BuildError):
            build.check_pem(bad)


# ── the verifier is independent, and agrees ──────────────────────────────────────


def test_verifier_imports_neither_builder_nor_layout():
    tree = ast.parse((SCRIPTS / "verify.py").read_text(encoding="utf-8"))
    imported = {a.name.split(".")[0] for n in ast.walk(tree) if isinstance(n, ast.Import) for a in n.names}
    imported |= {n.module.split(".")[0] for n in ast.walk(tree) if isinstance(n, ast.ImportFrom) and n.module}
    assert not imported & {"build", "layout"}


def test_verifier_states_the_same_contract_as_layout():
    assert verify.SIZE_LIMIT_BYTES == layout.SIZE_LIMIT_BYTES
    assert verify.APP_DIR == layout.APP_DIR + "/"
    assert verify.CA_VAR == layout.CA_ENV_VAR
    assert verify.ARCHES == layout.ARCHES
    assert verify.WORKER_PORT == str(layout.PORTS["worker"])
    assert f"certs/{Path(layout.CA_PATH_IN_BUNDLE).name}" in verify.COMMON_REQUIRED
    stamp = (REPO / "scripts" / "build-stamp.mjs").read_text(encoding="utf-8")
    js = re.search(r"BUILD_VERSION_RE\s*=\s*/(.*)/;", stamp).group(1)
    assert verify.BUILD_VERSION_RE.pattern == js


def test_verifier_states_the_same_dev_variables_as_layout():
    assert verify.DEV_PREFIXES == layout.DEV_PREFIXES
    assert verify.DEV_VARIABLES == layout.DEV_VARIABLES
    assert verify.DEV_VARIABLES_BY_TIER == layout.DEV_VARIABLES_BY_TIER
    assert verify.DEV_VALUES == layout.DEV_VALUES


def test_smoke_stands_in_for_each_worker_start_refusal_and_never_for_a_dev_variable():
    """U11: the worker refuses to start without these, and must start without DEV_PATHS."""
    for tier, env in smoke.API_LEVEL_STANDINS.items():
        dev = [k for k in env if k.startswith(layout.DEV_PREFIXES) or k in layout.DEV_VARIABLES
               or k in layout.DEV_VARIABLES_BY_TIER[tier]]
        assert not dev, f"{tier}: the smoke stands in a dev-only variable: {dev}"
    worker = smoke.API_LEVEL_STANDINS["worker"]
    assert set(worker) == {"QUEUE_URL", "TOOL_SERVER_URL", "FS_TOKEN_ENC_KEY", "MODEL_PROVIDER", "GATEWAY_BASE_URL"}
    assert worker["MODEL_PROVIDER"] == "gateway" and worker["GATEWAY_BASE_URL"]
    from proto import grants

    assert len(worker["FS_TOKEN_ENC_KEY"]) >= 32 and worker["FS_TOKEN_ENC_KEY"] != grants.DEV_FS_TOKEN_ENC_KEY
    for tier in ("web", "worker"):
        url = smoke.API_LEVEL_STANDINS[tier]["QUEUE_URL"]
        assert re.fullmatch(r"https://sqs\.[a-z0-9-]+\.amazonaws\.com/\d{12}/\w+", url), url


def test_makefile_pyyaml_pin_is_the_locked_version():
    make = (REPO / "Makefile").read_text(encoding="utf-8")
    lock = (REPO / "apps" / "server" / "uv.lock").read_text(encoding="utf-8")
    pinned = re.search(r"^EB_PYYAML\s*:=\s*(\S+)", make, re.M).group(1)
    locked = re.search(r'^name = "pyyaml"\nversion = "([^"]+)"', lock, re.M).group(1)
    assert pinned == locked


# ── the verifier on synthetic zips ───────────────────────────────────────────────

CA = "/var/app/current/certs/rds-global-bundle.pem"
PEM = b"-----BEGIN CERTIFICATE-----\nTUlJQg==\n-----END CERTIFICATE-----\n"
REQS = b"--no-index\n--find-links wheels\nfoo==1.0 --hash=sha256:00\n"


def _config(env: dict[str, str]) -> bytes:
    lines = ["option_settings:", "  aws:elasticbeanstalk:application:environment:"]
    lines += [f'    {k}: "{v}"' for k, v in env.items()]
    return ("\n".join(lines) + "\n").encode()


def good(tier: str) -> dict[str, tuple[bytes, int]]:
    f = 0o644
    common = {"BUILD-INFO.json": (b"{}", f), "certs/rds-global-bundle.pem": (PEM, f)}
    if tier == "web":
        return {**common,
                "Procfile": (b"web: python -m uvicorn web.app:app --host 127.0.0.1 --port 8000\n", f),
                ".ebextensions/01-web.config": (_config({"PORT": "8000", "PGSSLROOTCERT": CA}), f),
                "requirements.txt": (REQS, f), "wheels/foo-1.0-py3-none-any.whl": (b"x", f),
                "web/app.py": (b"", f), "web/auth.py": (b"", f), "web/spa.py": (b"", f),
                "enqueue.py": (b"", f), "grants.py": (b"", f), "migrate.py": (b"", f),
                "sql/001_schema.sql": (b"", f),
                "config/familysearch.json": (b"{}", f),
                "web-dist/index.html": (b"<html>", f),
                "web-dist/assets/index-abc.js": (b"const s=new EventSource(u);", f)}
    if tier == "worker":
        return {**common,
                "Procfile": (b"web: python proto/worker/worker.py\n", f),
                ".ebextensions/01-sqsd.config": (b"option_settings:\n  aws:elasticbeanstalk:sqsd:\n"
                                                 b"    HttpPath: \"/turn\"\n", f),
                ".ebextensions/02-worker.config": (_config({"PORT": "8000", "PGSSLROOTCERT": CA}), f),
                ".platform/hooks/predeploy/01-worker-layout.sh": (b"#!/bin/bash\n", 0o755),
                "requirements.txt": (REQS, f), "wheels/foo-1.0-py3-none-any.whl": (b"x", f),
                "app/__init__.py": (b"", f), "app/agent/__init__.py": (b"", f), "app/agent/real_agent.py": (b"", f),
                "proto/enqueue.py": (b"", f), "proto/grants.py": (b"", f), "proto/migrate.py": (b"", f),
                "proto/sql/001_schema.sql": (b"", f),
                "proto/worker/worker.py": (b"", f), "proto/worker/options.py": (b"", f),
                "plugin/.claude-plugin/plugin.json": (b"{}", f), "plugin/hooks/hooks.json": (b"{}", f),
                "plugin/agents/citation.md": (b"", f), "plugin/skills/research/SKILL.md": (b"", f)}
    return {**common,
            "Procfile": (b"web: node build/http.js --host 127.0.0.1 --port 8080\n", f),
            ".ebextensions/01-tools.config": (_config({"PORT": "8080", "NODE_EXTRA_CA_CERTS": CA}), f),
            "package.json": (b"{}", f), "package-lock.json": (b"{}", f), "build/http.js": (b"", f),
            "build/build-info.json": (json.dumps({"version": "0.1.0+2026-10-02.abc12345"}).encode(), f),
            "config/familysearch.json": (b"{}", f), "node_modules/pg/package.json": (b"{}", f),
            "node_modules/@modelcontextprotocol/sdk/package.json": (b"{}", f),
            "smoke/dev/smoke-http.js": (b"", f), "smoke/dev/smoke-calls.js": (b"", f),
            "smoke/src/auth/config.js": (b"", f)}


def zip_of(tmp_path: Path, tier: str, entries: dict[str, tuple[bytes, int]]) -> Path:
    path = tmp_path / f"eb-{tier}.zip"
    with zipfile.ZipFile(path, "w") as zf:
        for name, (data, mode) in entries.items():
            info = zipfile.ZipInfo(name)
            info.create_system = 3
            info.external_attr = (stat.S_IFREG | mode) << 16
            zf.writestr(info, data)
    return path


def findings(tmp_path: Path, tier: str, entries, **kw) -> list[str]:
    return verify.verify(zip_of(tmp_path, tier, entries), pip=False, **kw)


@pytest.mark.parametrize("tier", layout.TIERS)
def test_verifier_accepts_a_correct_bundle(tmp_path, tier):
    assert findings(tmp_path, tier, good(tier)) == []


LEGITIMATE = {
    "web Procfile with no space after the colon": (
        "web", {"Procfile": b"web:python -m uvicorn web.app:app --host 127.0.0.1 --port 8000\n"}),
    "an extra harmless file": ("web", {"web/notes.txt": b"hello"}),
    "re-quoted template values": ("web", {".ebextensions/01-web.config": (
        b"option_settings:\n  aws:elasticbeanstalk:application:environment:\n    PORT: 8000\n"
        b"    PGSSLROOTCERT: '/var/app/current/certs/rds-global-bundle.pem'\n", 0o644)}),
    "list-form option_settings": ("tools", {".ebextensions/01-tools.config": (
        b"option_settings:\n  - namespace: aws:elasticbeanstalk:application:environment\n    option_name: PORT\n"
        b"    value: '8080'\n  - namespace: aws:elasticbeanstalk:application:environment\n"
        b"    option_name: NODE_EXTRA_CA_CERTS\n    value: /var/app/current/certs/rds-global-bundle.pem\n", 0o644)}),
    "a third-party tests/ dir and .env under node_modules": ("tools", {
        "node_modules/zod/src/v4/core/tests/x.test.ts": b"", "node_modules/somepkg/.env": b"",
        "node_modules/somepkg/README.md": b""}),
    "a dirty build stamp": ("tools", {"build/build-info.json": json.dumps(
        {"version": "0.1.0+2026-10-02.abc12345.dirty"}).encode()}),
    "the web tier's nudge cap": ("web", {".ebextensions/01-web.config": _config(
        {"PORT": "8000", "PGSSLROOTCERT": CA, "AUTONOMOUS_MAX_NUDGES": "60"})}),
    "the worker's slot users": ("worker", {".ebextensions/02-worker.config": _config(
        {"PORT": "8000", "PGSSLROOTCERT": CA, "WORKER_TURN_USERS": "genealogy-turn-0 genealogy-turn-1"})}),
}


@pytest.mark.parametrize("case", LEGITIMATE, ids=list(LEGITIMATE))
def test_verifier_accepts_legitimate_variants(tmp_path, case):
    tier, changes = LEGITIMATE[case]
    entries = good(tier)
    entries.update({k: v if isinstance(v, tuple) else (v, 0o644) for k, v in changes.items()})
    assert findings(tmp_path, tier, entries) == []


def _drop(tier, *names):
    entries = good(tier)
    for n in names:
        entries.pop(n)
    return entries


def _add(tier, **kv):
    entries = good(tier)
    entries.update({k: v if isinstance(v, tuple) else (v, 0o644) for k, v in kv.items()})
    return entries


REJECTED = {
    "missing Procfile": ("web", lambda: _drop("web", "Procfile"), "missing Procfile"),
    "web --port differs from PORT": ("web", lambda: _add("web", **{
        "Procfile": b"web: python -m uvicorn web.app:app --host 127.0.0.1 --port 8001\n"}), "differs from"),
    "tools PORT differs from --port": ("tools", lambda: _add("tools", **{
        ".ebextensions/01-tools.config": _config({"PORT": "8081", "NODE_EXTRA_CA_CERTS": CA})}), "differs from"),
    "tools template sets no PORT": ("tools", lambda: _add("tools", **{
        ".ebextensions/01-tools.config": _config({"NODE_EXTRA_CA_CERTS": CA})}), "sets no PORT"),
    "two web: lines": ("web", lambda: _add("web", **{
        "Procfile": b"web: python -m uvicorn web.app:app --port 8000\nweb: true\n"}), "exactly one web"),
    "a Procfile line EB cannot parse": ("web", lambda: _add("web", **{
        "Procfile": b"web: python -m uvicorn web.app:app --port 8000\nnot a process\n"}), "Beanstalk's format"),
    "worker Procfile with arguments": ("worker", lambda: _add("worker", **{
        "Procfile": b"web: python proto/worker/worker.py --port 8000\n"}), "must be exactly"),
    "worker template without PORT": ("worker", lambda: _add("worker", **{
        ".ebextensions/02-worker.config": _config({"PGSSLROOTCERT": CA})}), "must set PORT=8000"),
    "worker template PORT 8080": ("worker", lambda: _add("worker", **{
        ".ebextensions/02-worker.config": _config({"PORT": "8080", "PGSSLROOTCERT": CA})}), "must set PORT=8000"),
    "CA variable names a file not in the zip": ("web", lambda: _add("web", **{
        ".ebextensions/01-web.config": _config({"PORT": "8000",
                                                "PGSSLROOTCERT": "/var/app/current/certs/other.pem"})}),
        "does not name a file"),
    "CA variable outside the app dir": ("tools", lambda: _add("tools", **{
        ".ebextensions/01-tools.config": _config({"PORT": "8080",
                                                  "NODE_EXTRA_CA_CERTS": "/etc/certs/rds-global-bundle.pem"})}),
        "does not name a file"),
    "CA variable unset": ("worker", lambda: _add("worker", **{
        ".ebextensions/02-worker.config": _config({"PORT": "8000"})}), "sets no PGSSLROOTCERT"),
    "the CA file is missing": ("web", lambda: _drop("web", "certs/rds-global-bundle.pem"),
                               "missing certs/rds-global-bundle.pem"),
    "top-level src/ in tools": ("tools", lambda: _add("tools", **{"src/http.ts": b""}), "forbidden src/http.ts"),
    "top-level dev/ in tools": ("tools", lambda: _add("tools", **{"dev/smoke-http.ts": b""}),
                                "forbidden dev/smoke-http.ts"),
    "a dev-only package in tools": ("tools", lambda: _add("tools", **{"node_modules/typescript/package.json": b""}),
                                    "forbidden node_modules/typescript"),
    ".npmrc in tools": ("tools", lambda: _add("tools", **{".npmrc": b"engine-strict=true"}), "forbidden .npmrc"),
    "tests/ outside node_modules": ("worker", lambda: _add("worker", **{"proto/worker/tests/x.py": b""}),
                                    "forbidden proto/worker/tests/x.py"),
    ".env outside node_modules": ("web", lambda: _add("web", **{".env": b"SECRET=1"}), "forbidden .env"),
    "exports/ outside node_modules": ("worker", lambda: _add("worker", **{"exports/a.json": b""}),
                                      "forbidden exports/a.json"),
    ".fs-token": ("web", lambda: _add("web", **{".fs-token": b"tok"}), "forbidden .fs-token"),
    ".fs-token even under node_modules": ("tools", lambda: _add("tools", **{"node_modules/x/.fs-token": b"t"}),
                                          "forbidden node_modules/x/.fs-token"),
    "__pycache__": ("web", lambda: _add("web", **{"web/__pycache__/app.cpython-312.pyc": b""}),
                    "forbidden web/__pycache__"),
    "a Dockerfile in tier code": ("web", lambda: _add("web", **{"web/Dockerfile": b"FROM x"}),
                                  "forbidden web/Dockerfile"),
    "a template README": ("worker", lambda: _add("worker", **{"README.md": b"#"}), "forbidden README.md"),
    "a top-level folder": ("web", lambda: {f"bundle/{k}": v for k, v in good("web").items()}, "top-level folder"),
    "an .ebextensions file that is not .config": ("tools", lambda: _add("tools", **{
        ".ebextensions/03-u13.yaml": b"option_settings: {}\n"}), "is not a .config file"),
    "a hook without its exec bit": ("worker", lambda: _add("worker", **{
        ".platform/hooks/predeploy/01-worker-layout.sh": (b"#!/bin/bash\n", 0o644)}), "has no exec bit"),
    "a hook stored with no Unix mode": ("worker", lambda: _add("worker", **{
        ".platform/hooks/predeploy/01-worker-layout.sh": (b"#!/bin/bash\n", 0)}), "has no exec bit"),
    "no predeploy hook": ("worker", lambda: _drop("worker", ".platform/hooks/predeploy/01-worker-layout.sh"),
                          "missing .platform/hooks/predeploy/"),
    "no migrate.py in web": ("web", lambda: _drop("web", "migrate.py"), "missing migrate.py"),
    "no migrate.py in worker": ("worker", lambda: _drop("worker", "proto/migrate.py"), "missing proto/migrate.py"),
    "the WebSocket SPA": ("web", lambda: _add("web", **{"web-dist/assets/index-abc.js": b"x=new WebSocket(u)"}),
                          "opens a WebSocket"),
    "a SPA with no SSE": ("web", lambda: _add("web", **{"web-dist/assets/index-abc.js": b"x=1"}),
                          "no `new EventSource`"),
    "tools build-info +dev": ("tools", lambda: _add("tools", **{
        "build/build-info.json": json.dumps({"version": "0.1.0+dev"}).encode()}), "carries no git sha"),
    "tools build-info not a stamp": ("tools", lambda: _add("tools", **{
        "build/build-info.json": json.dumps({"version": "dev"}).encode()}), "is not a build stamp"),
    "missing node_modules/pg": ("tools", lambda: _drop("tools", "node_modules/pg/package.json"),
                                "missing node_modules/pg/package.json"),
    "requirements without --no-index": ("worker", lambda: _add("worker", **{
        "requirements.txt": b"--find-links wheels\nfoo==1.0\n"}), "must begin with --no-index"),
    "no wheels": ("web", lambda: _drop("web", "wheels/foo-1.0-py3-none-any.whl"), "missing wheels/"),
    "an unparseable template": ("web", lambda: _add("web", **{".ebextensions/02-bad.config": b"a: [\n"}),
                                "does not parse"),
    "DEV_PATHS in the worker template": ("worker", lambda: _add("worker", **{
        ".ebextensions/02-worker.config": _config({"PORT": "8000", "PGSSLROOTCERT": CA, "DEV_PATHS": "true"})}),
        "sets DEV_PATHS, a dev-only variable"),
    "a debug hold in a list-form tools template": ("tools", lambda: _add("tools", **{
        ".ebextensions/03-debug.config": (
            b"option_settings:\n  - namespace: aws:elasticbeanstalk:application:environment\n"
            b"    option_name: GENEALOGY_DEBUG_HOLD_BEFORE_COMMIT_MS\n    value: '30000'\n", 0o644)}),
        "sets GENEALOGY_DEBUG_HOLD_BEFORE_COMMIT_MS, a dev-only variable"),
    "BLOCKED_TOOLS in the web template": ("web", lambda: _add("web", **{
        ".ebextensions/01-web.config": _config({"PORT": "8000", "PGSSLROOTCERT": CA, "BLOCKED_TOOLS": "person_read"})}),
        "sets BLOCKED_TOOLS"),
    "the nudge cap in the worker template": ("worker", lambda: _add("worker", **{
        ".ebextensions/02-worker.config": _config({"PORT": "8000", "PGSSLROOTCERT": CA,
                                                   "AUTONOMOUS_MAX_NUDGES": "60"})}),
        "sets AUTONOMOUS_MAX_NUDGES"),
    "no slot users in the worker template": ("worker", lambda: _add("worker", **{
        ".ebextensions/02-worker.config": _config({"PORT": "8000", "PGSSLROOTCERT": CA,
                                                   "WORKER_TURN_USERS": "none"})}),
        "a dev-only value"),
}


@pytest.mark.parametrize("case", REJECTED, ids=list(REJECTED))
def test_verifier_rejects(tmp_path, case):
    tier, entries, expected = REJECTED[case]
    got = findings(tmp_path, tier, entries())
    assert any(expected in f for f in got), got


def test_verifier_rejects_an_oversize_zip(tmp_path):
    got = findings(tmp_path, "tools", good("tools"), size_limit=100)
    assert any("over the 100-byte" in f for f in got), got


def test_verifier_allow_dev_accepts_an_unstamped_build(tmp_path):
    entries = _add("tools", **{"build/build-info.json": json.dumps({"version": "0.1.0+dev"}).encode()})
    assert findings(tmp_path, "tools", entries, allow_dev=True) == []


def test_verifier_dry_runs_pip_once_per_arch_and_reports_a_failure(tmp_path, monkeypatch):
    calls = []

    def fake_run(cmd, **kw):
        calls.append((cmd, kw["cwd"]))
        assert (Path(kw["cwd"]) / "requirements.txt").is_file()
        arch = cmd[cmd.index("--platform") + 1]
        fail = arch.endswith("aarch64")
        return subprocess.CompletedProcess(cmd, 1 if fail else 0, "", "ERROR: No matching distribution for foo"
                                           if fail else "")

    monkeypatch.setattr(verify.subprocess, "run", fake_run)
    got = verify.verify(zip_of(tmp_path, "worker", good("worker")))
    assert [cmd[cmd.index("--platform") + 1] for cmd, _ in calls] == \
        ["manylinux_2_34_x86_64", "manylinux_2_34_aarch64"]
    for cmd, _ in calls:
        assert {"--dry-run", "--no-index", "--only-binary=:all:"} <= set(cmd)
        assert cmd[cmd.index("--find-links") + 1] == "wheels"
    assert got == ["offline pip dry-run fails for aarch64: ERROR: No matching distribution for foo"]


def test_verifier_cli_exit_codes(tmp_path, capsys):
    ok = zip_of(tmp_path, "tools", good("tools"))
    assert verify.main(["--no-pip", str(ok)]) == 0
    bad_dir = tmp_path / "bad"
    bad_dir.mkdir()
    bad = zip_of(bad_dir, "web", _drop("web", "Procfile"))
    assert verify.main(["--no-pip", str(ok), str(bad)]) == 1
    assert "missing Procfile" in capsys.readouterr().out
    unnamed = tmp_path / "bundle.zip"
    unnamed.write_bytes(ok.read_bytes())
    assert verify.main(["--no-pip", str(unnamed)]) == 1


def test_build_rejects_an_unknown_tier_or_arch():
    with pytest.raises(SystemExit):
        build.main(["--tiers", "web,api"])
    with pytest.raises(SystemExit):
        build.main(["--arch", "arm64"])


# ── toolchain resolution ─────────────────────────────────────────────────────────


def _fake_bin(directory: Path, versions: dict[str, str]) -> Path:
    directory.mkdir(parents=True)
    for name, version in versions.items():
        exe = directory / name
        exe.write_text(f"#!/bin/sh\necho {version}\n", encoding="utf-8")
        exe.chmod(0o755)
    return directory


@pytest.mark.skipif(sys.platform == "win32", reason="POSIX shell stubs")
def test_toolchain_resolves_npm_on_the_callers_path_not_uvs(tmp_path, monkeypatch):
    """The first eb-bundles CI run: `uv run` put /usr/local/bin (npm 10.9.9) ahead of the
    pinned npm 11.12.1, and the builder refused to build."""
    shadow = _fake_bin(tmp_path / "uv-interpreter-dir", {"npm": "10.9.9", "node": "v22.22.3"})
    pinned = _fake_bin(tmp_path / "toolcache", {"npm": "11.12.1", "node": "v24.21.0"})
    monkeypatch.setenv("PATH", f"{shadow}:{pinned}")
    with pytest.raises(build.BuildError, match="found 10.9.9"):
        build.toolchain(["tools"])
    monkeypatch.setenv(build.CALLER_PATH_VAR, f"{pinned}:{shadow}")
    build.use_caller_path()
    assert build.toolchain(["tools"])["npm"] == "11.12.1"


def test_use_caller_path_leaves_path_alone_without_the_variable():
    env = {"PATH": "/a:/b"}
    build.use_caller_path(env)
    assert env == {"PATH": "/a:/b"}
    env[build.CALLER_PATH_VAR] = ""
    build.use_caller_path(env)
    assert env["PATH"] == "/a:/b"


def test_make_eb_bundles_hands_the_builder_the_callers_path():
    text = (REPO / "Makefile").read_text(encoding="utf-8")
    recipe = re.search(r"^eb-bundles:.*\n((?:\t.*\n)+)", text, re.MULTILINE)
    assert recipe, "Makefile has no eb-bundles recipe"
    lines = [ln for ln in recipe.group(1).splitlines() if "scripts/eb_bundles/build.py" in ln]
    assert lines, "eb-bundles does not run scripts/eb_bundles/build.py"
    for line in lines:
        before_uv = line.split("uv run", 1)[0]
        assert f'{build.CALLER_PATH_VAR}="$$PATH"' in before_uv, (
            f"eb-bundles must pass {build.CALLER_PATH_VAR}=\"$$PATH\" ahead of `uv run`: {line.strip()}")

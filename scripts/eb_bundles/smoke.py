#!/usr/bin/env python3
"""Boot each built Beanstalk bundle offline, the way the platform would (U12, D34).

    python scripts/eb_bundles/smoke.py [--platform linux/amd64|linux/arm64] [--dir releases]
                                       [--tiers web,worker,tools] [--keep]

Web and worker run in an amazonlinux:2023 helper image (python3.12, unzip, util-linux,
shadow-utils, user webapp) with --network none and a tmpfs /tmp: unzip to
/var/app/staging, build the venv and pip install requirements.txt from the bundle's own
wheels (Beanstalk's build step), run .platform/hooks/predeploy/* as root, move staging to
/var/app/current, then run the Procfile's web: command with the template's environment, as
webapp (web) or as root (worker: the hook's drop-in, so it can launch each turn's CLI as its
slot user, U3). Tools runs in node:24-slim with --network none from a root-owned
/var/app/current, as user node. Each tier is then probed over loopback.

The bundle reaches the container by `docker cp`, never a bind mount (colima cannot mount
the scratchpad). Needs docker and pyyaml; `make eb-bundles-smoke` supplies both.
"""
from __future__ import annotations

import argparse
import json
import re
import shlex
import stat
import subprocess
import sys
import tempfile
import time
import uuid
import zipfile
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import layout  # noqa: E402

REPO = HERE.parents[1]
ENV_NAMESPACE = "aws:elasticbeanstalk:application:environment"
VENV = "/var/app/venv/staging"
STAGING = "/var/app/staging"
NODE_IMAGE = "node:24-slim"
AL2023_DOCKERFILE = b"""FROM amazonlinux:2023
RUN dnf install -y -q python3.12 python3.12-pip unzip util-linux shadow-utils findutils procps-ng \\
    && dnf clean all \\
    && useradd --uid 900 --create-home --shell /sbin/nologin webapp
"""
# Polls GET <base><paths[0]> until it answers, then reports every path as JSON.
PY_PROBE = r"""
import json, sys, time, urllib.error, urllib.request
base, paths = sys.argv[1], sys.argv[2:]
def get(p):
    try:
        r = urllib.request.urlopen(base + p, timeout=10)
    except urllib.error.HTTPError as e:
        r = e
    return {"status": r.status, "headers": {k.lower(): v for k, v in r.headers.items()},
            "body": r.read(20000).decode("utf-8", "replace")}
deadline = time.time() + 120
while True:
    try:
        get(paths[0])
        break
    except OSError as e:
        if time.time() > deadline:
            print(json.dumps({"error": f"never answered: {e}"}))
            sys.exit(0)
        time.sleep(1)
print(json.dumps({p: get(p) for p in paths}))
"""
NODE_PROBE = r"""
const [base, ...paths] = process.argv.slice(1);
const get = async (p) => {
  const r = await fetch(base + p, { signal: AbortSignal.timeout(10000) });
  return { status: r.status, headers: Object.fromEntries(r.headers), body: (await r.text()).slice(0, 20000) };
};
const deadline = Date.now() + 120000;
for (;;) {
  try { await get(paths[0]); break; } catch (e) {
    if (Date.now() > deadline) { console.log(JSON.stringify({ error: `never answered: ${e}` })); process.exit(0); }
    await new Promise((r) => setTimeout(r, 1000));
  }
}
const out = {};
for (const p of paths) out[p] = await get(p);
console.log(JSON.stringify(out));
"""


class Checks:
    def __init__(self, tier: str) -> None:
        self.tier = tier
        self.failed = 0

    def check(self, ok: bool, what: str, detail: object = "") -> bool:
        print(f"  {'ok  ' if ok else 'FAIL'}  {self.tier}: {what}" + ("" if ok or detail == "" else f" -- {detail}"),
              flush=True)
        self.failed += 0 if ok else 1
        return ok


def docker(*args: str, check: bool = True, input_bytes: bytes | None = None, timeout: int = 900) -> subprocess.CompletedProcess:
    proc = subprocess.run(["docker", *args], input=input_bytes, capture_output=True, timeout=timeout)
    if check and proc.returncode != 0:
        raise RuntimeError(f"docker {' '.join(args[:3])} exited {proc.returncode}: "
                           f"{proc.stderr.decode('utf-8', 'replace').strip()[-2000:]}")
    return proc


def out(proc: subprocess.CompletedProcess) -> str:
    return proc.stdout.decode("utf-8", "replace").strip()


def template(zip_path: Path) -> tuple[dict[str, str], str]:
    """The bundle's application environment and its Procfile web: command."""
    env: dict[str, str] = {}
    with zipfile.ZipFile(zip_path) as zf:
        for name in sorted(n for n in zf.namelist() if re.fullmatch(r"\.ebextensions/[^/]+\.config", n)):
            settings = (yaml.safe_load(zf.read(name).decode("utf-8")) or {}).get("option_settings") or {}
            if isinstance(settings, dict):
                env.update({str(k): str(v) for k, v in (settings.get(ENV_NAMESPACE) or {}).items()})
            else:
                env.update({str(s["option_name"]): str(s.get("value", "")) for s in settings
                            if s.get("namespace") == ENV_NAMESPACE})
        procfile = zf.read("Procfile").decode("utf-8")
    web = [ln.split(":", 1)[1].strip() for ln in procfile.splitlines() if ln.split(":", 1)[0].strip() == "web"]
    if len(web) != 1:
        raise RuntimeError(f"{zip_path.name}: Procfile has {len(web)} web: lines")
    return env, web[0]


def launcher(env: dict[str, str], command: str, path: str, home: str) -> bytes:
    lines = ["#!/bin/bash", "set -e", f"cd {layout.APP_DIR}", f"export PATH={shlex.quote(path)}",
             f"export HOME={shlex.quote(home)}"]
    lines += [f"export {k}={shlex.quote(v)}" for k, v in sorted(env.items())]
    # Not exec: a process killed by a signal (SIGILL is 132) leaves an empty log, so the
    # exit status is appended for the probe's failure detail.
    lines += [f"/bin/sh -c {shlex.quote(command)} > /tmp/app.log 2>&1 && rc=0 || rc=$?",
              'echo "smoke: the web: command exited $rc" >> /tmp/app.log']
    return ("\n".join(lines) + "\n").encode("utf-8")


def put(container: str, name: str, data: bytes, mode: int = 0o755) -> None:
    with tempfile.TemporaryDirectory(prefix="eb-smoke-") as tmp:
        f = Path(tmp) / Path(name).name
        f.write_bytes(data)
        f.chmod(mode)
        docker("cp", str(f), f"{container}:{name}")


def probe(container: str, interp: list[str], code: str, port: int, paths: list[str]) -> dict:
    proc = docker("exec", container, *interp, code, f"http://127.0.0.1:{port}", *paths, check=False, timeout=300)
    try:
        return json.loads(out(proc).splitlines()[-1])
    except (ValueError, IndexError):
        return {"error": f"probe exited {proc.returncode}: {proc.stderr.decode('utf-8', 'replace')[-1000:]}"}


def app_log(container: str) -> str:
    return out(docker("exec", container, "sh", "-c", "tail -c 3000 /tmp/app.log", check=False))


def sh(container: str, script: str, *, user: str | None = None, timeout: int = 900) -> subprocess.CompletedProcess:
    args = ["exec"] + (["-u", user] if user else []) + [container, "bash", "-c", script]
    return docker(*args, check=False, timeout=timeout)


def ca_check(c: Checks, container: str, env: dict[str, str]) -> None:
    var = layout.CA_ENV_VAR[c.tier]
    path = env.get(var, "")
    c.check(bool(path) and sh(container, f"test -f {shlex.quote(path)}").returncode == 0,
            f"{var}={path} exists in the deployed tree")


def python_tier(tier: str, zip_path: Path, platform: str, keep: bool, extra: dict[str, str]) -> int:
    c = Checks(tier)
    env, command = template(zip_path)
    env = {**env, **extra}
    arch = platform.split("/")[-1]
    image = f"eb-bundles-smoke-al2023:{arch}"
    print(f"== {tier}: building the AL2023 helper image ({platform}) ==", flush=True)
    docker("build", "--platform", platform, "-t", image, "-", input_bytes=AL2023_DOCKERFILE, timeout=1800)
    name = f"eb-smoke-{tier}-{uuid.uuid4().hex[:8]}"
    docker("run", "-d", "--platform", platform, "--network", "none", "--tmpfs", "/tmp:rw,mode=1777",
           "--name", name, image, "sleep", "infinity")
    try:
        docker("cp", str(zip_path), f"{name}:/bundle.zip")
        deploy = (f"set -euo pipefail; mkdir -p {STAGING}; cd {STAGING}; unzip -q /bundle.zip; "
                  f"python3.12 -m venv {VENV}; "
                  f"{VENV}/bin/pip install --disable-pip-version-check -q -r requirements.txt; "
                  "if [ -d .platform/hooks/predeploy ]; then "
                  "for h in $(ls .platform/hooks/predeploy | sort); do ./.platform/hooks/predeploy/$h; done; fi; "
                  f"cd /; mv {STAGING} {layout.APP_DIR}")
        proc = sh(name, deploy)
        if not c.check(proc.returncode == 0, "offline deploy (unzip, venv, pip install, predeploy hooks)",
                       (proc.stdout + proc.stderr).decode("utf-8", "replace").strip()[-2000:]):
            return c.failed
        put(name, "/run-app.sh", launcher(env, command, f"{VENV}/bin:/usr/local/bin:/usr/bin:/bin", "/home/webapp"))
        # U3: on Beanstalk the hook's drop-in runs the worker's web.service as root, so it
        # can launch each turn's CLI as its slot user; the web tier stays webapp.
        docker("exec", "-d", "-u", "root" if tier == "worker" else "webapp", name, "/run-app.sh")
        ca_check(c, name, env)
        port = int(env.get("PORT", "0"))
        py = [f"{VENV}/bin/python", "-c"]
        if tier == "web":
            asset = out(sh(name, f"cd {layout.APP_DIR}/{layout.WEB_DIST_DIR} && ls assets/*.js | head -1"))
            res = probe(name, py, PY_PROBE, port, ["/", f"/{asset}", "/api/health", "/api/sessions"])
            if not c.check("error" not in res, f"web: command answers on :{port}", res.get("error", "")):
                print(app_log(name))
                return c.failed
            root = res["/"]
            c.check(root["status"] == 200 and root["headers"].get("content-type", "").startswith("text/html"),
                    "GET / is 200 text/html", (root["status"], root["headers"].get("content-type")))
            c.check("no-cache" in root["headers"].get("cache-control", ""), "GET / is no-cache",
                    root["headers"].get("cache-control"))
            a = res[f"/{asset}"]
            c.check(a["status"] == 200 and "immutable" in a["headers"].get("cache-control", ""),
                    f"GET /{asset} is 200 immutable", (a["status"], a["headers"].get("cache-control")))
            h = res["/api/health"]
            c.check(h["status"] == 503 and _json(h["body"]) is not None, "/api/health is 503 JSON (no Postgres)",
                    (h["status"], h["body"][:200]))
            c.check(res["/api/sessions"]["status"] == 401, "/api/sessions is 401",
                    res["/api/sessions"]["status"])
        else:
            res = probe(name, py, PY_PROBE, port, ["/healthz"])
            if not c.check("error" not in res, f"web: command answers on :{port}", res.get("error", "")):
                print(app_log(name))
                return c.failed
            h = res["/healthz"]
            checks = (_json(h["body"]) or {}).get("checks", {})
            c.check(h["status"] == 503 and checks.get("postgres", {}).get("ok") is False,
                    "/healthz is 503 with postgres failing", (h["status"], h["body"][:300]))
            for key in ("agents", "cwd", "tmpdir"):
                c.check(checks.get(key, {}).get("ok") is True, f"/healthz {key} ok", checks.get(key))
            start = next((json.loads(ln) for ln in out(docker("exec", name, "cat", "/tmp/app.log")).splitlines()
                          if ln.startswith("{") and '"ev":"start"' in ln), None)
            hook = (start or {}).get("hook_python", "")
            m = re.search(r"(\d+)\.(\d+)", hook.rsplit(" ", 1)[-1]) if hook else None
            c.check(m is not None and (int(m.group(1)), int(m.group(2))) >= (3, 10),
                    "ev=start hook_python >= 3.10", hook or app_log(name))
            dest = shlex.quote(layout.PLUGIN_DEST)
            c.check(out(sh(name, f"stat -c %U:%G {dest}")) == "root:root", f"{layout.PLUGIN_DEST} is root-owned",
                    out(sh(name, f"stat -c %U:%G {dest}")))
            pool = (start or {}).get("turn_users")
            c.check(isinstance(pool, list) and len(pool) >= 2 and "root" not in pool,
                    "ev=start names the slot users each CLI runs as", pool or app_log(name))
            slot = pool[0] if isinstance(pool, list) and pool else "genealogy-turn-0"
            dropin = out(sh(name, "cat /etc/systemd/system/web.service.d/10-genealogy-root.conf"))
            c.check("User=root" in dropin, "the hook's drop-in runs web.service as root", dropin)
            c.check(sh(name, f"touch {dest}/x || test -w {dest}", user=slot).returncode != 0,
                    f"{slot} cannot write {layout.PLUGIN_DEST}")
            c.check(out(sh(name, f"stat -c %a {layout.WORKER_CWD}")) == "555", f"{layout.WORKER_CWD} is mode 555",
                    out(sh(name, f"stat -c %a {layout.WORKER_CWD}")))
            cli = out(sh(name, f"{VENV}/bin/python -c 'import claude_agent_sdk, pathlib; "
                               "print(pathlib.Path(claude_agent_sdk.__file__).parent / \"_bundled\" / \"claude\")'"))
            ver = sh(name, f"HOME=/tmp {shlex.quote(cli)} --version", user=slot, timeout=120)
            c.check(ver.returncode == 0, f"the SDK's bundled claude --version runs as {slot}",
                    out(ver) or ver.stderr.decode("utf-8", "replace")[-300:])
        return c.failed
    finally:
        if not keep:
            docker("rm", "-f", name, check=False)


def extract(zip_path: Path, dest: Path) -> None:
    """Unzip with each entry's Unix mode, which zipfile.extract drops."""
    with zipfile.ZipFile(zip_path) as zf:
        for info in zf.infolist():
            path = zf.extract(info, dest)
            mode = (info.external_attr >> 16) & 0o777
            if mode and not info.is_dir():
                Path(path).chmod(mode | stat.S_IRUSR)


def tools_tier(zip_path: Path, platform: str, keep: bool, extra: dict[str, str]) -> int:
    c = Checks("tools")
    env, command = template(zip_path)
    env = {**env, "GENEALOGY_PG_DSN": "postgresql://u:p@127.0.0.1:1/x", "GENEALOGY_S3_BUCKET": "smoke", **extra}
    manifest = json.loads((REPO / layout.ENGINE_DIR / "manifest.json").read_text(encoding="utf-8"))
    tool_count = len(manifest["tools"])
    print(f"== tools: {NODE_IMAGE} ({platform}) ==", flush=True)
    name = f"eb-smoke-tools-{uuid.uuid4().hex[:8]}"
    docker("pull", "--platform", platform, NODE_IMAGE, timeout=900)
    docker("run", "-d", "--platform", platform, "--network", "none", "--name", name, NODE_IMAGE, "sleep", "infinity")
    try:
        with tempfile.TemporaryDirectory(prefix="eb-smoke-tools-") as tmp:
            extract(zip_path, Path(tmp))
            Path(tmp).chmod(0o755)  # docker cp gives /var/app/current the mkdtemp's 0700
            docker("exec", name, "mkdir", "-p", "/var/app")
            docker("cp", f"{tmp}/.", f"{name}:{layout.APP_DIR}")
        docker("exec", name, "sh", "-c", f"chown -R root:root {layout.APP_DIR} && chmod -R go-w {layout.APP_DIR}")
        c.check(sh(name, f"test ! -w {layout.APP_DIR}", user="node").returncode == 0,
                f"{layout.APP_DIR} is read-only to node")
        put(name, "/run-app.sh", launcher(env, command, "/usr/local/bin:/usr/bin:/bin", "/home/node"))
        docker("exec", "-d", "-u", "node", name, "/run-app.sh")
        ca_check(c, name, env)
        port = int(env.get("PORT", "0"))
        res = probe(name, ["node", "--input-type=module", "-e"], NODE_PROBE, port, ["/healthz"])
        if c.check("error" not in res, f"web: command answers on :{port}", res.get("error", "")):
            h = res["/healthz"]
            body = _json(h["body"]) or {}
            c.check(h["status"] == 503 and body.get("tools") == tool_count,
                    f"/healthz is 503 with tools={tool_count} (no Postgres/S3)", (h["status"], h["body"][:300]))
        else:
            print(app_log(name))
        imports = ("await import('./smoke/dev/smoke-calls.js');"
                   "await import('@modelcontextprotocol/sdk/client/index.js');"
                   "await import('@modelcontextprotocol/sdk/client/streamableHttp.js');")
        imp = docker("exec", "-u", "node", "-w", layout.APP_DIR, name, "sh", "-c",
                     f"node --check smoke/dev/smoke-http.js && node --input-type=module -e {shlex.quote(imports)}",
                     check=False)
        c.check(imp.returncode == 0, "the compiled smoke's modules import",
                imp.stderr.decode("utf-8", "replace")[-500:])
        return c.failed
    finally:
        if not keep:
            docker("rm", "-f", name, check=False)


def _json(body: str) -> dict | None:
    try:
        value = json.loads(body)
    except ValueError:
        return None
    return value if isinstance(value, dict) else None


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--platform", default="linux/amd64", choices=("linux/amd64", "linux/arm64"))
    ap.add_argument("--dir", default="releases")
    ap.add_argument("--tiers", default=",".join(layout.TIERS))
    ap.add_argument("--keep", action="store_true", help="leave the containers running for inspection")
    # A host workaround, never a bundle fix: under an Apple M4's Linux VM, cryptography's
    # OpenSSL dies with SIGILL probing SME unless OPENSSL_armcap=0 (arm64 runs only).
    ap.add_argument("--env", action="append", default=[], metavar="KEY=VALUE",
                    help="add to every tier's environment, on top of the template's")
    args = ap.parse_args(argv)
    tiers = [t.strip() for t in args.tiers.split(",") if t.strip()]
    if not tiers or any(t not in layout.TIERS for t in tiers):
        ap.error(f"--tiers must be a comma list of {', '.join(layout.TIERS)}")
    root = Path(args.dir) if Path(args.dir).is_absolute() else REPO / args.dir
    if any("=" not in kv for kv in args.env):
        ap.error("--env takes KEY=VALUE")
    extra = dict(kv.split("=", 1) for kv in args.env)
    if extra:
        print(f"extra environment, not from the templates: {extra}")

    failed = 0
    started = time.monotonic()
    for tier in tiers:
        zip_path = root / layout.BUNDLE_NAMES[tier]
        if not zip_path.is_file():
            print(f"  FAIL  {tier}: {zip_path} not found; run `make eb-bundles`")
            failed += 1
            continue
        try:
            failed += tools_tier(zip_path, args.platform, args.keep, extra) if tier == "tools" else \
                python_tier(tier, zip_path, args.platform, args.keep, extra)
        except (RuntimeError, subprocess.TimeoutExpired) as exc:
            print(f"  FAIL  {tier}: {exc}")
            failed += 1
    print(f"\n{'all checks passed' if not failed else f'{failed} check(s) failed'} "
          f"({args.platform}, {time.monotonic() - started:.0f}s)")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

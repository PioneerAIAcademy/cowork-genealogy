#!/usr/bin/env python3
"""Build the three Elastic Beanstalk source bundles (U12, docs/plan/familysearch-handoff.md).

    python scripts/eb_bundles/build.py [--tiers web,worker,tools] [--arch x86_64,aarch64]
                                       [--out releases] [--rds-ca FILE]

writes <out>/eb-{web,worker,tools}.zip and <out>/eb-bundles.json. `make eb-bundles` runs it
under uv with Python 3.12 and the pip AL2023 ships. Stdlib only.

Every dependency is vendored, so a deploy reaches neither PyPI nor npm: web and worker ship
wheels/ for both architectures with a requirements.txt that begins --no-index, and tools ships
its production node_modules/. Sources are the files git lists (tracked, plus untracked files
not ignored), read from the working tree, so .fs-token, exports/, __pycache__ and .env never
reach a bundle; BUILD-INFO.json says `dirty` when an included path differs from HEAD.

Everything is built in a mkdtemp() stage outside the repo. The repo's own tree is never
written: in a worktree the engine's node_modules is a symlink into the main checkout, and
the encoding lint walks releases/. The zips are written with Python's zipfile, which stores
Unix modes (a .platform hook keeps its exec bit) and zip64.

Needs git, node >= 22 with npm >= 11.12 < 12, pnpm with the JS workspace installed, and pip;
the network for PyPI, npm and the RDS truststore (--rds-ca FILE replaces the last).
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import platform
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import urllib.request
import zipfile
from base64 import b64decode
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import layout  # noqa: E402

REPO = HERE.parents[1]


class BuildError(RuntimeError):
    pass


def log(msg: str) -> None:
    print(f"eb-bundles: {msg}", file=sys.stderr, flush=True)


def run(cmd: list[str], *, cwd: Path | None = None, env: dict[str, str] | None = None) -> None:
    log(f"$ {' '.join(cmd)}" + (f"  (in {cwd})" if cwd else ""))
    proc = subprocess.run(cmd, cwd=cwd, env=env)
    if proc.returncode != 0:
        raise BuildError(f"{cmd[0]} exited {proc.returncode}: {' '.join(cmd)}")


def capture(cmd: list[str], *, cwd: Path | None = None) -> str:
    return subprocess.run(cmd, cwd=cwd, check=True, capture_output=True, text=True,
                          encoding="utf-8").stdout.strip()


# ── sources ──────────────────────────────────────────────────────────────────────


def git_files(repo: Path = REPO) -> dict[str, int]:
    """Every file git lists, tracked or untracked-but-not-ignored, that exists in the working
    tree as a regular file: {repo-relative path: Unix mode}. A tracked file's mode is its
    index mode (100755 or 100644), so an exec bit survives a checkout that dropped it."""
    index_modes: dict[str, int] = {}
    staged = capture(["git", "ls-files", "-s", "-z"], cwd=repo)
    for rec in staged.split("\0"):
        if rec:
            meta, path = rec.split("\t", 1)
            index_modes[path] = 0o755 if meta.split()[0] == "100755" else 0o644
    listed = capture(["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"], cwd=repo)
    files: dict[str, int] = {}
    for path in listed.split("\0"):
        full = repo / path
        if not path or full.is_symlink() or not full.is_file():
            continue
        files[path] = index_modes.get(path, _fs_mode(full))
    return files


def _fs_mode(path: Path) -> int:
    return 0o755 if path.stat().st_mode & stat.S_IXUSR else 0o644


@dataclass(frozen=True)
class Rule:
    """Ship `src` (a file, or a directory when it ends in /) at `dest`. `top_py` keeps only a
    directory's own *.py files."""
    src: str
    dest: str
    top_py: bool = False

    def match(self, path: str) -> str | None:
        if not self.src.endswith("/"):
            return self.dest if path == self.src else None
        if not path.startswith(self.src):
            return None
        rest = path[len(self.src):]
        if self.top_py and ("/" in rest or not rest.endswith(".py")):
            return None
        return self.dest + rest


PROTO = "apps/server/proto/"
RULES: dict[str, tuple[Rule, ...]] = {
    # The image's /app shape, so auth's CLIENT_CONFIG_CANDIDATES[0] and SQL_DIR resolve.
    "web": (
        Rule(PROTO + "web/", "web/", top_py=True),
        Rule(PROTO + "enqueue.py", "enqueue.py"),
        Rule(PROTO + "sql/", "sql/"),
        Rule(f"{layout.ENGINE_DIR}/config/familysearch.json", "config/familysearch.json"),
    ),
    # worker.py puts its parents[1] on sys.path; only app.agent is imported.
    "worker": (
        Rule("apps/server/app/__init__.py", "app/__init__.py"),
        Rule("apps/server/app/agent/", "app/agent/", top_py=True),
        Rule(PROTO + "enqueue.py", "proto/enqueue.py"),
        Rule(PROTO + "sql/", "proto/sql/"),
        Rule(PROTO + "worker/", "proto/worker/", top_py=True),
        Rule(layout.PLUGIN_DIR + "/", layout.PLUGIN_IN_BUNDLE + "/"),
    ),
    # build/, smoke/ and node_modules/ are generated (build_tools); config/ sits beside
    # build/ because the bundled-data readers resolve ../../config/ from build/*/.
    "tools": (
        Rule(f"{layout.ENGINE_DIR}/config/", "config/"),
        Rule(f"{layout.ENGINE_DIR}/package.json", "package.json"),
        Rule(f"{layout.ENGINE_DIR}/package-lock.json", "package-lock.json"),
    ),
}

# Never shipped by the builder (the verifier states its own copy of this rule).
_ANYWHERE = re.compile(r"(^|/)(\.fs-token|__pycache__)(/|$)|\.pyc$")
_OUTSIDE_NODE_MODULES = re.compile(r"(^|/)(\.env(\.[^/]*)?|\.npmrc|\.DS_Store)$|(^|/)(tests|exports)/")


def forbidden(dest: str) -> bool:
    if _ANYWHERE.search(dest):
        return True
    return not dest.startswith("node_modules/") and bool(_OUTSIDE_NODE_MODULES.search(dest))


def template_sources(tier: str, files: dict[str, int]) -> list[tuple[str, str]]:
    root = layout.TEMPLATE_DIRS[tier] + "/"
    out = [(p, p[len(root):]) for p in files if p.startswith(root) and Path(p).name != "README.md"]
    if not any(dest == "Procfile" for _, dest in out):
        raise BuildError(f"{root} has no Procfile; Beanstalk would fall back to its default command")
    return out


def tier_sources(tier: str, files: dict[str, int]) -> list[tuple[str, str]]:
    """(repo path, bundle path) for every file the tier takes from the checkout: its code, its
    template, and nothing generated. Sorted, and refused when two sources claim one path or a
    forbidden name would ship."""
    out = []
    for path in sorted(files):
        for rule in RULES[tier]:
            dest = rule.match(path)
            if dest is not None:
                out.append((path, dest))
                break
    out += template_sources(tier, files)
    dupes = sorted(d for d, c in Counter(d for _, d in out).items() if c > 1)
    if dupes:
        raise BuildError(f"{tier}: two sources claim {dupes}")
    bad = [p for p, d in out if forbidden(d)]
    if bad:
        raise BuildError(f"{tier}: refusing to ship {bad}")
    return sorted(out, key=lambda pd: pd[1])


def pathspecs(tier: str) -> list[str]:
    specs = [r.src.rstrip("/") for r in RULES[tier]] + [layout.TEMPLATE_DIRS[tier]]
    if tier in layout.REQUIREMENTS:
        specs.append(layout.REQUIREMENTS[tier])
    if tier == "tools":
        specs += [layout.ENGINE_DIR, "scripts/write-build-info.mjs", "scripts/build-stamp.mjs"]
    if tier == "web":
        specs += ["apps/web", "packages/schema", "packages/viewer-ui", "pnpm-lock.yaml"]
    return sorted(set(specs))


def is_dirty(tier: str, repo: Path = REPO) -> bool:
    out = capture(["git", "status", "--porcelain", "--untracked-files=all", "--", *pathspecs(tier)], cwd=repo)
    return out != ""


# ── the RDS CA ───────────────────────────────────────────────────────────────────

_PEM_BLOCK = re.compile(r"-----BEGIN CERTIFICATE-----\s*([A-Za-z0-9+/=\s]+?)\s*-----END CERTIFICATE-----")


def check_pem(data: bytes) -> int:
    """The certificate count; raises unless the file is PEM holding at least one certificate."""
    try:
        text = data.decode("ascii")
    except UnicodeDecodeError as exc:
        raise BuildError(f"RDS CA bundle is not ASCII PEM: {exc}") from exc
    blocks = _PEM_BLOCK.findall(text)
    if not blocks or len(blocks) != text.count("-----BEGIN"):
        raise BuildError("RDS CA bundle holds no well-formed PEM certificate block")
    for body in blocks:
        try:
            b64decode("".join(body.split()), validate=True)
        except ValueError as exc:
            raise BuildError(f"RDS CA bundle has a certificate that is not base64: {exc}") from exc
    return len(blocks)


def fetch_rds_ca(path: str | None) -> bytes:
    if path:
        return Path(path).read_bytes()
    log(f"fetching {layout.RDS_CA_URL}")
    try:
        with urllib.request.urlopen(layout.RDS_CA_URL, timeout=60) as resp:
            return resp.read()
    except OSError as exc:
        raise BuildError(f"could not fetch the RDS CA bundle ({exc}); pass --rds-ca FILE for an offline build") from exc


# ── tiers ────────────────────────────────────────────────────────────────────────


def download_wheels(requirements: Path, wheels: Path, arches: list[str]) -> None:
    for arch in arches:
        # Every tag AL2023's glibc 2.34 accepts: pip does not widen an explicit --platform.
        platforms = [f"manylinux_2_{minor}_{arch}" for minor in range(34, 16, -1)] + [f"manylinux2014_{arch}"]
        run([sys.executable, "-m", "pip", "download", "--disable-pip-version-check", "--progress-bar", "off",
             "-r", str(requirements), "--only-binary=:all:", "--python-version", layout.PYTHON_VERSION,
             "--implementation", "cp", "--abi", "cp" + layout.PYTHON_VERSION.replace(".", ""),
             *[a for p in platforms for a in ("--platform", p)], "-d", str(wheels)])


def python_tier(tier: str, stage: Path, arches: list[str]) -> list[tuple[str, Path]]:
    committed = REPO / layout.REQUIREMENTS[tier]
    if not committed.is_file():
        raise BuildError(f"{layout.REQUIREMENTS[tier]} is missing; run `make proto-requirements`")
    wheels = stage / layout.WHEELS_DIR
    wheels.mkdir()
    download_wheels(committed, wheels, arches)
    req = stage / layout.REQUIREMENTS_IN_BUNDLE
    req.write_text(layout.REQUIREMENTS_HEADER + committed.read_text(encoding="utf-8"), encoding="utf-8")
    out = [(layout.REQUIREMENTS_IN_BUNDLE, req)]
    out += [(f"{layout.WHEELS_DIR}/{w.name}", w) for w in sorted(wheels.iterdir())]
    if tier == "web":
        dist = stage / layout.WEB_DIST_DIR
        run(["pnpm", "--filter", "@genealogy/schema", "run", "generate"], cwd=REPO)
        run(["pnpm", "--filter", "web", "exec", "vite", "build", "--outDir", str(dist), "--emptyOutDir"],
            cwd=REPO, env={**os.environ, "VITE_SESSION_TRANSPORT": "sse"})
        out += tree(dist, layout.WEB_DIST_DIR)
    return out


def build_tools(stage: Path, files: dict[str, int]) -> list[tuple[str, Path]]:
    """`npm ci && npm run build` in a stage mirroring the repo's paths (so build-info.json
    stamps the checkout's sha through GIT_DIR/GIT_WORK_TREE), the compiled smoke, then the
    production tree from a second clean `npm ci --omit=dev`. Optional dependencies are kept:
    pg and the S3 client are optional."""
    mirror = stage / "mirror"
    engine = mirror / layout.ENGINE_DIR
    for p in files:
        if p.startswith(layout.ENGINE_DIR + "/") or p in ("scripts/write-build-info.mjs", "scripts/build-stamp.mjs"):
            (mirror / p).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(REPO / p, mirror / p)
    git_env = {**os.environ, "GIT_DIR": capture(["git", "rev-parse", "--absolute-git-dir"], cwd=REPO),
               "GIT_WORK_TREE": str(REPO)}
    run(["npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund"], cwd=engine)
    run(["npm", "run", "build"], cwd=engine, env=git_env)
    run(["node", "node_modules/typescript/bin/tsc", "-p", "tsconfig.smoke.json"], cwd=engine)

    prod = stage / "prod"
    prod.mkdir()
    for name in ("package.json", "package-lock.json", ".npmrc"):
        if (engine / name).is_file():
            shutil.copy2(engine / name, prod / name)
    run(["npm", "ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], cwd=prod)
    if not (prod / "node_modules" / "pg").is_dir():
        raise BuildError("the production tree has no node_modules/pg; optional dependencies were dropped")

    out = tree(engine / "build", "build")
    out += tree(engine / "smoke-build", layout.SMOKE_IN_BUNDLE)
    out += tree(prod / "node_modules", "node_modules", skip_bin=True)
    return out


def tree(root: Path, dest: str, *, skip_bin: bool = False) -> list[tuple[str, Path]]:
    if not root.is_dir():
        raise BuildError(f"{root} was not produced")
    out = []
    for path in sorted(root.rglob("*")):
        rel = path.relative_to(root).as_posix()
        if skip_bin and (rel == ".bin" or rel.startswith(".bin/") or "/.bin/" in rel):
            continue
        if path.is_symlink():
            raise BuildError(f"{path} is a symlink; a bundle carries regular files only")
        if path.is_file():
            out.append((f"{dest}/{rel}", path))
    return out


# ── zip ──────────────────────────────────────────────────────────────────────────

_STORED = (".whl", ".zip", ".gz", ".png", ".woff2")


def write_zip(target: Path, entries: list[tuple[str, Path, int]], date_time: tuple[int, ...]) -> None:
    """Entries at the zip root, sorted, each with its Unix mode (create_system 3)."""
    tmp = target.with_suffix(".zip.partial")
    with zipfile.ZipFile(tmp, "w", allowZip64=True) as zf:
        for dest, src, mode in sorted(entries):
            info = zipfile.ZipInfo(dest, date_time=date_time)
            info.create_system = 3
            info.external_attr = (stat.S_IFREG | mode) << 16
            info.compress_type = zipfile.ZIP_STORED if dest.endswith(_STORED) else zipfile.ZIP_DEFLATED
            size = src.stat().st_size
            with open(src, "rb") as fsrc, zf.open(info, "w", force_zip64=size > zipfile.ZIP64_LIMIT) as fdst:
                shutil.copyfileobj(fsrc, fdst, 1 << 20)
    tmp.replace(target)


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


# ── toolchain ────────────────────────────────────────────────────────────────────


def _version(cmd: list[str], cwd: Path | None = None) -> str | None:
    try:
        return capture(cmd, cwd=cwd)
    except (OSError, subprocess.CalledProcessError):
        return None


def toolchain(tiers: list[str]) -> dict[str, str | None]:
    info: dict[str, str | None] = {"python": platform.python_version(), "pip": None, "node": None, "npm": None,
                                   "pnpm": None}
    if {"web", "worker"} & set(tiers):
        pip = _version([sys.executable, "-m", "pip", "--version"])
        if pip is None:
            raise BuildError(f"{sys.executable} has no pip; run through `make eb-bundles`")
        info["pip"] = pip.split()[1]
    if "web" in tiers:
        info["pnpm"] = _version(["pnpm", "--version"])
        if info["pnpm"] is None:
            raise BuildError("pnpm is not on PATH; the web tier builds the SPA with it")
        if not (REPO / "apps" / "web" / "node_modules").is_dir():
            raise BuildError("apps/web has no node_modules; run `pnpm install --frozen-lockfile` first")
    if "tools" in tiers or "web" in tiers:
        node = _version(["node", "--version"])
        if node is None or int(node.lstrip("v").split(".")[0]) < 22:
            raise BuildError(f"node >= 22 is required, found {node}")
        info["node"] = node.lstrip("v")
    if "tools" in tiers:
        npm = _version(["npm", "--version"])
        parts = [int(x) for x in (npm or "0.0").split(".")[:2]]
        if npm is None or parts[0] != 11 or parts[1] < 12:
            raise BuildError(f"npm >= 11.12 < 12 is required (the engine's packageManager), found {npm}"
                             f" at {shutil.which('npm')}")
        info["npm"] = npm
    return info


# ── main ─────────────────────────────────────────────────────────────────────────


def _csv(value: str, allowed: tuple[str, ...], what: str) -> list[str]:
    items = [v.strip() for v in value.split(",") if v.strip()]
    bad = [v for v in items if v not in allowed]
    if not items or bad:
        raise argparse.ArgumentTypeError(f"{what} must be a comma list of {', '.join(allowed)}; got {value!r}")
    return list(dict.fromkeys(items))


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--tiers", type=lambda v: _csv(v, layout.TIERS, "--tiers"), default=list(layout.TIERS))
    ap.add_argument("--arch", type=lambda v: _csv(v, layout.ARCHES, "--arch"), default=list(layout.ARCHES))
    ap.add_argument("--out", default="releases")
    ap.add_argument("--rds-ca", metavar="FILE")
    args = ap.parse_args(argv)

    try:
        return build(args.tiers, args.arch, Path(args.out) if Path(args.out).is_absolute() else REPO / args.out,
                     args.rds_ca)
    except (BuildError, subprocess.CalledProcessError) as exc:
        log(f"FAILED: {exc}")
        return 1


def build(tiers: list[str], arches: list[str], out: Path, rds_ca: str | None) -> int:
    if not sys.platform.startswith("linux"):
        log(f"warning: building on {sys.platform}; pip evaluates requirement markers against this host, "
            "so the AL2023 boot smoke (make eb-bundles-smoke) is the ground truth")
    tools = toolchain(tiers)
    files = git_files()
    sha = capture(["git", "rev-parse", "HEAD"], cwd=REPO)
    commit_time = int(capture(["git", "log", "-1", "--format=%ct"], cwd=REPO))
    date_time = dt.datetime.fromtimestamp(max(commit_time, 315532800), dt.timezone.utc).timetuple()[:6]

    ca = fetch_rds_ca(rds_ca)
    ca_info = {"sha256": hashlib.sha256(ca).hexdigest(), "certificates": check_pem(ca)}
    log(f"RDS CA: {ca_info['certificates']} certificates, sha256 {ca_info['sha256']}")

    out.mkdir(parents=True, exist_ok=True)
    # A failed run must not leave a manifest describing the previous run's zips.
    (out / layout.MANIFEST_NAME).unlink(missing_ok=True)
    manifest: dict = {"git_sha": sha, "dirty": False, "arches": arches, "rds_ca": ca_info, "toolchain": tools,
                      "size_limit_bytes": layout.SIZE_LIMIT_BYTES, "bundles": {}}
    with tempfile.TemporaryDirectory(prefix="eb-bundles-") as tmp:
        for tier in tiers:
            stage = Path(tmp) / tier
            stage.mkdir()
            log(f"== {tier} ==")
            entries = [(dest, REPO / src, files[src]) for src, dest in tier_sources(tier, files)]
            generated = python_tier(tier, stage, arches) if tier != "tools" else build_tools(stage, files)
            ca_file = stage / "rds-ca.pem"
            ca_file.write_bytes(ca)
            generated.append((layout.CA_PATH_IN_BUNDLE, ca_file))
            dirty = is_dirty(tier)
            info = {"tier": tier, "git_sha": sha, "dirty": dirty, "built_at": dt.datetime.now(dt.timezone.utc)
                    .strftime("%Y-%m-%dT%H:%M:%SZ"), "arches": arches if tier != "tools" else [],
                    "rds_ca": ca_info, "toolchain": tools}
            info_file = stage / layout.BUILD_INFO_IN_BUNDLE
            info_file.write_text(json.dumps(info, indent=2) + "\n", encoding="utf-8")
            generated.append((layout.BUILD_INFO_IN_BUNDLE, info_file))
            entries += [(dest, path, _fs_mode(path)) for dest, path in generated]

            dests = [d for d, _, _ in entries]
            clash = sorted(d for d, c in Counter(dests).items() if c > 1)
            if clash:
                raise BuildError(f"{tier}: generated files collide with sources: {clash}")
            bad = [d for d in dests if forbidden(d)]
            if bad:
                raise BuildError(f"{tier}: refusing to ship {bad[:10]}")

            target = out / layout.BUNDLE_NAMES[tier]
            write_zip(target, entries, date_time)
            size = target.stat().st_size
            if size > layout.SIZE_LIMIT_BYTES:
                raise BuildError(f"{target.name} is {size:,} bytes, over Beanstalk's {layout.SIZE_LIMIT_BYTES:,}")
            manifest["bundles"][tier] = {"file": target.name, "size": size, "sha256": sha256(target),
                                         "entries": len(entries), "dirty": dirty}
            manifest["dirty"] = manifest["dirty"] or dirty
            log(f"{target.name}: {size:,} bytes, {len(entries)} entries{' (dirty)' if dirty else ''}")
    (out / layout.MANIFEST_NAME).write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    log(f"wrote {out / layout.MANIFEST_NAME}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

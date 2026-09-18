"""The three-way seam behind `sandboxImageCommit` (#1489): a bash writer, a
Dockerfile `COPY`, and a Python reader, each naming the same path in its own
language, with no compiler or import linking them.

Why this file exists. `test_e2b_provider.py` imports `_BUILD_INFO_PATH` and uses
it on BOTH sides of the fake sandbox — it seeds the fake FS at that key and then
asserts the provider read that key — so it passes no matter what the constant
says. Renaming it to a path the image does not contain leaves the whole suite
green while production reports `sandboxImageCommit: null` for every session,
forever. Nothing else in the repo compares these files: no CI job builds the E2B
image, and the only other proof would be booting a real microVM.

The layer-cache rule is checked here too, for the same reason: it is stated as a
comment in the Dockerfile, and a comment is not a guard.
"""
import re
import subprocess
from pathlib import Path

from app.sandbox.e2b import _AGENT_HOME, _BUILD_INFO_PATH

REPO_ROOT = Path(__file__).resolve().parents[3]
DOCKERFILE = REPO_ROOT / "apps" / "server" / "sandbox" / "e2b.Dockerfile"
BUILD_SCRIPT = REPO_ROOT / "apps" / "server" / "sandbox" / "build-image.sh"


def _dockerfile_lines() -> list[str]:
    return DOCKERFILE.read_text(encoding="utf-8").splitlines()


def _copy_directives() -> list[tuple[int, str, str]]:
    """(line number, source, destination) for every COPY, in file order.

    Dockerfile instructions are case-insensitive and may be indented, may carry
    `--chown=`/`--from=` flags, may be split over backslash continuations, and may
    name several sources before the destination. All of those are legal and all
    of them are parsed.

    Continuations are folded ONLY once a COPY has been recognised. Folding every
    line would let an unrelated comment ending in a backslash swallow the COPY
    that follows it, which silently removes that COPY from the "is last" check
    below. A line that looks like a COPY but cannot be parsed raises, so an
    unrecognised shape is loud instead of quietly unguarded.
    """
    lines = _dockerfile_lines()
    out: list[tuple[int, str, str]] = []
    i = 0
    while i < len(lines):
        if not re.match(r"\s*COPY\b", lines[i], re.IGNORECASE):
            i += 1
            continue
        start, logical = i, lines[i]
        while logical.rstrip().endswith("\\") and i + 1 < len(lines):
            i += 1
            logical = logical.rstrip()[:-1] + " " + lines[i]
        tokens = [t for t in logical.split()[1:] if not t.startswith("--")]
        if len(tokens) < 2:
            raise AssertionError(
                f"e2b.Dockerfile line {start + 1}: COPY shape not understood by this "
                f"guard ({logical!r}). Widen the parser rather than leaving it unchecked."
            )
        # Several sources may precede the destination; the destination is last.
        for src in tokens[:-1]:
            out.append((start + 1, src, tokens[-1]))
        i += 1
    return out


def _dockerfile_agent_home() -> str:
    for line in _dockerfile_lines():
        m = re.match(r"^ENV\s+AGENT_HOME=(\S+)\s*$", line)
        if m:
            return m.group(1)
    raise AssertionError("e2b.Dockerfile declares no ENV AGENT_HOME")


def _provenance_copy() -> tuple[int, str, str]:
    matches = [c for c in _copy_directives() if "build-provenance" in c[1]]
    assert len(matches) == 1, f"expected exactly one provenance COPY, got {matches}"
    return matches[0]


def test_agent_home_constant_matches_the_dockerfile():
    assert _AGENT_HOME == _dockerfile_agent_home()


def test_reader_path_matches_the_dockerfile_copy_destination():
    """The path `E2BProvider` reads must be the path the image actually bakes."""
    _, _, dest = _provenance_copy()
    resolved = dest.replace("${AGENT_HOME}", _dockerfile_agent_home())
    assert resolved == _BUILD_INFO_PATH


def test_dockerfile_copies_the_file_the_build_script_writes():
    """The COPY source must be the file `build-image.sh` writes into the context.

    Both halves are asserted. Checking only the PROVENANCE_FILE assignment would
    let the script stop writing the file while this test stayed green, which is
    more than the name above promises."""
    _, source, _ = _provenance_copy()
    script = BUILD_SCRIPT.read_text(encoding="utf-8")
    m = re.search(r'^PROVENANCE_FILE="\$\{ROOT\}/(?P<rel>[^"]+)"\s*$', script, re.M)
    assert m, "build-image.sh no longer defines PROVENANCE_FILE relative to ${ROOT}"
    assert m.group("rel") == source
    assert re.search(r'>\s*"\$\{PROVENANCE_FILE\}"', script), (
        "build-image.sh defines PROVENANCE_FILE but never writes to it"
    )


def test_provenance_copy_is_last_and_below_the_npm_ci_layer():
    """Its contents change on every build. Above `npm ci` it would invalidate that
    layer and every layer under it, so each image build would re-run apt, pip and
    a clean production npm install."""
    copies = _copy_directives()
    prov_line, _, _ = _provenance_copy()
    assert prov_line == max(line for line, _, _ in copies), (
        "the provenance COPY must be the LAST COPY in the Dockerfile"
    )
    npm_ci = [
        i for i, line in enumerate(_dockerfile_lines(), start=1)
        if line.startswith("RUN ") and "npm ci" in line
    ]
    assert npm_ci, "e2b.Dockerfile no longer runs npm ci"
    assert prov_line > max(npm_ci)


def test_the_build_script_writes_a_gitignored_path():
    """The artifact is regenerated every build. If it were tracked it would dirty
    the tree on each `make sandbox-image` — and the dirty flag it carries would
    then be reporting its own presence."""
    _, source, _ = _provenance_copy()
    ignore = (REPO_ROOT / ".gitignore").read_text(encoding="utf-8").splitlines()
    assert source in [line.strip() for line in ignore]


def _run_dirty_computation(repo: Path) -> str:
    """Execute the shipped dirty computation inside `repo` and return `_dirty`.

    Lifted from build-image.sh and RUN, not read. Three previous versions of this
    guard matched the script as text and were each defeated by text that was not
    code: a comment, a second comment, and a string containing the command. Running
    it cannot be fooled that way, because nothing is being matched.
    """
    script = BUILD_SCRIPT.read_text(encoding="utf-8").splitlines()
    start = next(i for i, ln in enumerate(script) if ln.startswith("_dirty=false"))
    end = next(i for i in range(start, len(script)) if script[i].rstrip() == "fi")
    block = "\n".join(script[start:end + 1])
    out = subprocess.run(
        ["bash", "-c", f'set -euo pipefail\n{block}\nprintf "%s" "$_dirty"'],
        cwd=repo, capture_output=True, text=True, encoding="utf-8", check=True,
    )
    return out.stdout.strip()


def _scratch_repo(tmp_path: Path) -> Path:
    repo = tmp_path / "repo"
    (repo / "pkg").mkdir(parents=True)
    (repo / "pkg" / "tracked.txt").write_text("v1\n", encoding="utf-8")
    run = lambda *a: subprocess.run(a, cwd=repo, capture_output=True, check=True)
    run("git", "init", "-q", ".")
    run("git", "add", "-A")
    run("git", "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "init")
    return repo


def test_a_clean_tree_is_reported_clean(tmp_path):
    assert _run_dirty_computation(_scratch_repo(tmp_path)) == "false"


def test_an_uncommitted_edit_is_reported_dirty(tmp_path):
    """The failure this flag exists for. If the computation is ever deleted or
    neutered, `_dirty` stays false here and this is what says so."""
    repo = _scratch_repo(tmp_path)
    (repo / "pkg" / "tracked.txt").write_text("v2\n", encoding="utf-8")
    assert _run_dirty_computation(repo) == "true"


def test_an_untracked_file_is_reported_dirty(tmp_path):
    """Untracked counts: a brand-new skill file is exactly the change most likely
    to matter and has never been committed."""
    repo = _scratch_repo(tmp_path)
    (repo / "pkg" / "brand_new.md").write_text("new\n", encoding="utf-8")
    assert _run_dirty_computation(repo) == "true"


def test_a_gitignored_file_is_not_reported_dirty(tmp_path):
    """Editor cruft is excluded where it belongs, in .gitignore, rather than by
    narrowing what this check looks at. An allowlist would fail toward CLEAN,
    which is the lie the flag exists to prevent; this fails toward DIRTY."""
    repo = _scratch_repo(tmp_path)
    (repo / ".gitignore").write_text(".vscode/\n", encoding="utf-8")
    subprocess.run(["git", "add", ".gitignore"], cwd=repo, capture_output=True, check=True)
    subprocess.run(["git", "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q",
                    "-m", "ignore"], cwd=repo, capture_output=True, check=True)
    (repo / ".vscode").mkdir()
    (repo / ".vscode" / "settings.json").write_text("{}\n", encoding="utf-8")
    assert _run_dirty_computation(repo) == "false"


def test_editor_cruft_is_gitignored_in_this_repo():
    """The symptom that started this: `.vscode/` was not ignored, so an open editor
    marked every image build dirty."""
    ignore = (REPO_ROOT / ".gitignore").read_text(encoding="utf-8")
    assert ".vscode/" in ignore, "an unignored editor directory marks every build dirty"


def test_the_dirty_flag_is_written_as_a_json_boolean():
    """The reader compares `info.get("dirty") is True` after json.loads, so shell-ish
    1/0 or "yes" would silently drop the marker."""
    script = BUILD_SCRIPT.read_text(encoding="utf-8")
    assigned = set(re.findall(r"^\s*_dirty=(\S+)\s*$", script, re.M))
    assert assigned == {"false", "true"}, (
        f"_dirty must be assigned exactly the JSON boolean literals; found "
        f"{sorted(assigned)}. Anything else silently drops the dirty marker."
    )

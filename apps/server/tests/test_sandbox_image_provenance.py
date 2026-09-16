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
from pathlib import Path

from app.sandbox.e2b import _AGENT_HOME, _BUILD_INFO_PATH

REPO_ROOT = Path(__file__).resolve().parents[3]
DOCKERFILE = REPO_ROOT / "apps" / "server" / "sandbox" / "e2b.Dockerfile"
BUILD_SCRIPT = REPO_ROOT / "apps" / "server" / "sandbox" / "build-image.sh"


def _dockerfile_lines() -> list[str]:
    return DOCKERFILE.read_text(encoding="utf-8").splitlines()


def _copy_directives() -> list[tuple[int, str, str]]:
    """(line number, source, destination) for every COPY, in file order.

    Folds backslash continuations and tolerates `--chown=`/`--from=` flags. Both
    matter, and in opposite directions: a narrower pattern SKIPS a flagged COPY,
    so a later one becomes invisible and the "is last" assertion below passes
    over it; and it MIS-PARSES a continued COPY, capturing the backslash as the
    destination and false-alarming on a legal, semantically identical spelling.
    A guard that rejects correct input is worse than the gap it closes.

    Any line starting with COPY that this cannot parse raises rather than being
    dropped, so an unrecognised shape is loud instead of silently unguarded.
    """
    lines = _dockerfile_lines()
    out: list[tuple[int, str, str]] = []
    i = 0
    while i < len(lines):
        start, logical = i, lines[i]
        while logical.rstrip().endswith("\\") and i + 1 < len(lines):
            i += 1
            logical = logical.rstrip()[:-1] + " " + lines[i]
        if logical.startswith("COPY"):
            tokens = [t for t in logical.split()[1:] if not t.startswith("--")]
            if len(tokens) != 2:
                raise AssertionError(
                    f"e2b.Dockerfile line {start + 1}: COPY shape not understood by this "
                    f"guard ({logical!r}). Widen the parser rather than leaving it unchecked."
                )
            out.append((start + 1, tokens[0], tokens[1]))
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

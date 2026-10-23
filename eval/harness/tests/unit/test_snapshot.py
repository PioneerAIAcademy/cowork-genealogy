"""Tests for harness.snapshot — normalize() + build_snapshot().

The normalize() contract is shared with eval/app/lib/snapshot.ts; the
test vectors below mirror eval/app/tests/unit/snapshot.test.ts so the
two implementations are forced to agree byte-for-byte.
"""

import json
import os
import re
from pathlib import Path

import pytest

from harness.snapshot import (
    AGENT_FRONTMATTER_SUFFIX,
    agent_embed_forms,
    agent_refs_in_text,
    build_snapshot,
    diff_snapshot_vs_disk,
    frontmatter_fingerprint_text,
    hash_content,
    hash_file,
    hash_snapshot,
    normalize,
    router_suites,
)

REPO_ROOT = Path(__file__).resolve().parents[4]
VECTORS_PATH = REPO_ROOT / "docs" / "specs" / "schemas" / "agent-frontmatter-vectors.json"


# ---- normalize contract --------------------------------------------------


def test_normalize_json_sorts_keys_and_pretty_prints():
    raw = b'{"b": 2, "a": 1}'
    out = normalize("eval/foo.json", raw)
    assert out == '{\n  "a": 1,\n  "b": 2\n}\n'


def test_normalize_json_strips_cosmetic_test_fields():
    raw = json.dumps({
        "test": {
            "id": "ut_001",
            "name": "human-readable name",
            "description": "longer prose",
            "tags": ["foo"],
            "skill": "search-familysearch-wiki",
        },
        "input": {"user_message": "do the thing"},
    }).encode()
    out = normalize("eval/tests/unit/search-familysearch-wiki/ut_001.json", raw)
    parsed = json.loads(out)
    # Cosmetic stripped; grading-relevant kept.
    assert "name" not in parsed["test"]
    assert "description" not in parsed["test"]
    # tags is NOT cosmetic — it selects validators (issue #2694).
    assert parsed["test"]["tags"] == ["foo"]
    assert parsed["test"]["id"] == "ut_001"
    assert parsed["test"]["skill"] == "search-familysearch-wiki"


def test_tag_edit_changes_normalized_output():
    """A tag edit is substantive — it selects validators (issue #2694)."""
    base = {
        "test": {"id": "ut_001", "skill": "s", "name": "n",
                 "description": "d", "tags": ["grade:trigger"], "type": "positive"},
        "input": {"user_message": "m"},
    }
    path = "eval/tests/unit/s/ut_001.json"
    out_a = normalize(path, json.dumps(base).encode())

    edited = {**base, "test": {**base["test"], "tags": ["1850-census"]}}
    out_b = normalize(path, json.dumps(edited).encode())

    assert out_a != out_b, "tag edit must change normalized output"


def test_name_description_edit_does_not_change_normalized_output():
    """Name and description edits remain cosmetic — no hash change."""
    base = {
        "test": {"id": "ut_001", "skill": "s", "name": "original",
                 "description": "original desc", "tags": ["a"], "type": "positive"},
        "input": {"user_message": "m"},
    }
    path = "eval/tests/unit/s/ut_001.json"
    out_a = normalize(path, json.dumps(base).encode())

    edited = {**base, "test": {**base["test"], "name": "RENAMED", "description": "NEW desc"}}
    out_b = normalize(path, json.dumps(edited).encode())

    assert out_a == out_b, "name/description edit must NOT change normalized output"


def test_shared_digest_vector():
    """Both Python and TypeScript must produce this exact hash for the same input.

    The TypeScript twin of this vector is in snapshot.test.ts —
    test_shared_digest_vector / 'produces the shared digest vector'.
    """
    raw = json.dumps({
        "test": {"id": "ut_001", "skill": "s", "name": "ignored",
                 "description": "also ignored", "tags": ["grade:trigger"],
                 "type": "positive"},
        "input": {"user_message": "hello"},
    }).encode()
    normalized = normalize("eval/tests/unit/s/ut_001.json", raw)
    digest = hash_content(normalized)
    # Pinned: the TS twin asserts the same digest for the same input JSON.
    # If this value changes, update snapshot.test.ts too.
    assert digest == "a96c04ecadb2576600c24d749c867052596e518f780685017a6b1b4193178150"


def test_normalize_json_outside_tests_keeps_all_fields():
    """Cosmetic stripping is scoped to eval/tests/unit/ only."""
    raw = json.dumps({"test": {"id": "x", "name": "kept here"}}).encode()
    out = normalize("packages/engine/plugin/skills/foo/SKILL.json", raw)
    assert "kept here" in out


def test_normalize_text_crlf_to_lf():
    raw = b"line one\r\nline two\r\n"
    out = normalize("packages/engine/plugin/skills/foo/SKILL.md", raw)
    assert out == "line one\nline two\n"
    assert "\r" not in out


def test_normalize_text_ensures_trailing_newline():
    raw = b"no newline at end"
    out = normalize("packages/engine/plugin/skills/foo/SKILL.md", raw)
    assert out.endswith("\n")


def test_normalize_text_idempotent():
    raw = b"already normalized\n"
    out1 = normalize("foo.md", raw)
    out2 = normalize("foo.md", out1.encode())
    assert out1 == out2


def test_normalize_json_idempotent():
    raw = b'{"x": 1, "y": [3, 1, 2]}'
    out1 = normalize("eval/foo.json", raw)
    out2 = normalize("eval/foo.json", out1.encode())
    assert out1 == out2


def test_normalize_unknown_extension_decodes_utf8():
    raw = "plain text".encode()
    out = normalize("foo.bin", raw)
    assert out == "plain text"


def test_hash_content_is_sha256():
    h = hash_content("hello\n")
    # Sanity: 64 hex chars.
    assert len(h) == 64
    assert all(c in "0123456789abcdef" for c in h)


def test_hash_file_missing_returns_empty(tmp_path: Path):
    missing = tmp_path / "nope.md"
    assert hash_file("eval/nope.md", missing) == ""


def test_hash_file_matches_normalize(tmp_path: Path):
    f = tmp_path / "x.md"
    f.write_bytes(b"hi\r\n")  # Will be normalized to "hi\n"
    h = hash_file("packages/engine/plugin/skills/foo/x.md", f)
    assert h == hash_content("hi\n")


# ---- agent_refs_in_text (shared vectors with snapshot.test.ts) ------------


def test_agent_refs_dedupes_and_sorts():
    text = (
        "Delegate to `@plugin:search-images`, the same way /research invokes\n"
        "`@plugin:gps-mentor`. Then call @plugin:gps-mentor again.\n"
    )
    assert agent_refs_in_text(text) == ["gps-mentor", "search-images"]


def test_agent_refs_empty_when_no_references():
    assert agent_refs_in_text("No delegation here. @plugin: alone is not a ref.") == []


def test_agent_refs_stop_at_invalid_chars():
    # Name charset is [a-z0-9-]; the ref ends at the first invalid char.
    assert agent_refs_in_text("see @plugin:record-extractor.") == ["record-extractor"]
    assert agent_refs_in_text("bad @plugin:Foo uppercase") == []


# ---- build_snapshot ------------------------------------------------------


def test_build_snapshot_covers_skill_files(tmp_path: Path):
    repo = tmp_path
    skill_dir = repo / "packages" / "engine" / "plugin" / "skills" / "search-familysearch-wiki"
    skill_dir.mkdir(parents=True)
    (skill_dir / "SKILL.md").write_text("---\nname: search-familysearch-wiki\n---\nbody\n", encoding="utf-8")
    (skill_dir / "template.md").write_text("template\n", encoding="utf-8")
    tests_dir = repo / "eval" / "tests" / "unit" / "search-familysearch-wiki"
    tests_dir.mkdir(parents=True)
    (tests_dir / "rubric.md").write_text("# rubric\n", encoding="utf-8")

    snap = build_snapshot(skill="search-familysearch-wiki", repo_root=repo)
    assert "packages/engine/plugin/skills/search-familysearch-wiki/SKILL.md" in snap
    assert "packages/engine/plugin/skills/search-familysearch-wiki/template.md" in snap
    assert "eval/tests/unit/search-familysearch-wiki/rubric.md" in snap


def test_build_snapshot_embeds_referenced_scenarios_and_fixtures(tmp_path: Path):
    repo = tmp_path
    (repo / "packages" / "engine" / "plugin" / "skills" / "x").mkdir(parents=True)
    tests_dir = repo / "eval" / "tests" / "unit" / "x"
    tests_dir.mkdir(parents=True)
    (tests_dir / "ut_001.json").write_text(json.dumps({
        "test": {"id": "ut_001", "skill": "x", "name": "n", "type": "positive",
                 "description": "x", "tags": []},
        "input": {"user_message": "m", "scenario": "scenario-a"},
        "mcp_fixtures": ["fix-1", "fix-2"],
    }), encoding="utf-8")
    scen_dir = repo / "eval" / "fixtures" / "scenarios" / "scenario-a"
    scen_dir.mkdir(parents=True)
    (scen_dir / "research.json").write_text("{}", encoding="utf-8")
    (scen_dir / "README.md").write_text("# scenario\n", encoding="utf-8")
    fix_dir = repo / "eval" / "fixtures" / "mcp"
    fix_dir.mkdir(parents=True)
    (fix_dir / "fix-1.json").write_text('{"tool": "x", "description": "y", "response": {}}', encoding="utf-8")
    (fix_dir / "fix-2.json").write_text('{"tool": "x", "description": "y", "response": {}}', encoding="utf-8")

    snap = build_snapshot(skill="x", repo_root=repo)
    assert "eval/fixtures/scenarios/scenario-a/research.json" in snap
    assert "eval/fixtures/scenarios/scenario-a/README.md" in snap
    assert "eval/fixtures/mcp/fix-1.json" in snap
    assert "eval/fixtures/mcp/fix-2.json" in snap


def test_build_snapshot_skips_missing_skill(tmp_path: Path):
    """No skill dir → empty snapshot, no exception."""
    snap = build_snapshot(skill="nope", repo_root=tmp_path)
    assert snap == {}


def _skill_repo(tmp_path: Path, body: str = "body\n") -> Path:
    """Minimal repo with one skill whose SKILL.md holds `body`."""
    skill_dir = tmp_path / "packages" / "engine" / "plugin" / "skills" / "s1"
    skill_dir.mkdir(parents=True)
    (skill_dir / "SKILL.md").write_text(body, encoding="utf-8")
    return tmp_path


def test_build_snapshot_stores_hashes_not_content(tmp_path: Path):
    """schema_version 3: values are sha256 digests, not file bytes. Git holds
    the content; the snapshot only has to answer "does this still match?"."""
    repo = _skill_repo(tmp_path, "---\nname: s1\n---\nhello\n")
    snap = build_snapshot(skill="s1", repo_root=repo)

    rel = "packages/engine/plugin/skills/s1/SKILL.md"
    assert snap[rel] == hash_content("---\nname: s1\n---\nhello\n")
    assert all(re.fullmatch(r"[a-f0-9]{64}", v) for v in snap.values())


def test_diff_snapshot_hashed_matches_and_detects_drift(tmp_path: Path):
    """A hashed snapshot compares clean against the tree it was built from,
    and flags the path once the file changes."""
    repo = _skill_repo(tmp_path, "original\n")
    snap = build_snapshot(skill="s1", repo_root=repo)
    assert diff_snapshot_vs_disk(snap, repo) == {}

    (repo / "packages/engine/plugin/skills/s1/SKILL.md").write_text(
        "edited\n", encoding="utf-8"
    )
    assert diff_snapshot_vs_disk(snap, repo) == {
        "packages/engine/plugin/skills/s1/SKILL.md": "content-differs"
    }


def test_diff_snapshot_still_reads_legacy_content_snapshot(tmp_path: Path):
    """Pre-3 run logs stored normalized content. They must keep evaluating
    correctly so in-flight branches and unmigrated worktrees aren't stranded."""
    repo = _skill_repo(tmp_path, "original\n")
    rel = "packages/engine/plugin/skills/s1/SKILL.md"

    legacy = {rel: "original\n"}  # content, not a digest
    assert diff_snapshot_vs_disk(legacy, repo) == {}

    (repo / rel).write_text("edited\n", encoding="utf-8")
    assert diff_snapshot_vs_disk(legacy, repo) == {rel: "content-differs"}


AGENTS_REL = "packages/engine/plugin/agents"
_AGENT_A = (
    "---\nname: record-extractor\ndescription: >-\n  Extracts one record.\n"
    "model: sonnet\ntools:\n  - Read\n---\nagent body\n"
)
_AGENT_B = "---\nname: unrelated\ndescription: Not referenced.\ntools:\n  - Read\n---\nother body\n"


def _router_repo(repo: Path, *, run_agents=None, with_tests_dir: bool = True) -> Path:
    """A router suite `router` (SKILL.md naming @plugin:record-extractor) plus
    two staged agents. With `run_agents`, one test opts those agents in."""
    skill_dir = repo / "packages" / "engine" / "plugin" / "skills" / "router"
    skill_dir.mkdir(parents=True)
    (skill_dir / "SKILL.md").write_text(
        "---\nname: router\n---\nPer record, delegate to `@plugin:record-extractor`.\n",
        encoding="utf-8",
    )
    agents_dir = repo / AGENTS_REL
    agents_dir.mkdir(parents=True)
    (agents_dir / "record-extractor.md").write_text(_AGENT_A, encoding="utf-8")
    (agents_dir / "unrelated.md").write_text(_AGENT_B, encoding="utf-8")
    if with_tests_dir:
        tests_dir = repo / "eval" / "tests" / "unit" / "router"
        tests_dir.mkdir(parents=True)
        test = {"test": {"id": "ut_router_001", "skill": "router", "type": "negative"}}
        if run_agents is not None:
            test["execution"] = {"run_agents": run_agents}
        (tests_dir / "t1.json").write_text(json.dumps(test), encoding="utf-8")
    return repo


def test_build_snapshot_embeds_referenced_agent_files(tmp_path: Path):
    """A router suite fingerprints EVERY staged agent by its frontmatter only
    (#3568): the referenced agent and the unreferenced one alike, each under the
    `#frontmatter` key and never under the bare full-body key. Its body is
    denied at the spawn, so only what the router reads can change the run."""
    repo = _router_repo(tmp_path)

    snap = build_snapshot(skill="router", repo_root=repo)

    for name, text in (("record-extractor", _AGENT_A), ("unrelated", _AGENT_B)):
        reduced_key = f"{AGENTS_REL}/{name}.md{AGENT_FRONTMATTER_SUFFIX}"
        assert snap[reduced_key] == hash_content(frontmatter_fingerprint_text(text))
        assert f"{AGENTS_REL}/{name}.md" not in snap


def test_run_agents_opt_in_embeds_the_full_body(tmp_path: Path):
    """An agent an included test runs live gets its full body under the bare
    key; the others in the router suite stay reduced."""
    repo = _router_repo(tmp_path, run_agents=["record-extractor"])

    snap = build_snapshot(skill="router", repo_root=repo)

    assert snap[f"{AGENTS_REL}/record-extractor.md"] == hash_content(_AGENT_A)
    assert f"{AGENTS_REL}/record-extractor.md{AGENT_FRONTMATTER_SUFFIX}" not in snap
    assert f"{AGENTS_REL}/unrelated.md{AGENT_FRONTMATTER_SUFFIX}" in snap


def test_a_skill_with_agent_refs_but_no_suite_is_not_a_router(tmp_path: Path):
    """forget-and-rederive's shape: @plugin: refs, no unit-test directory. It
    has no runs to fingerprint, so it is not a router and embeds no agent."""
    repo = _router_repo(tmp_path, with_tests_dir=False)

    snap = build_snapshot(skill="router", repo_root=repo)

    assert not [k for k in snap if k.startswith(AGENTS_REL)]
    assert router_suites([repo / "packages" / "engine" / "plugin" / "skills"],
                         repo / "eval" / "tests" / "unit") == set()


@pytest.mark.parametrize(
    ("edit", "expected"),
    [
        (lambda t: t.replace("agent body", "a rewritten body"), {}),
        (lambda t: t.replace("model: sonnet", "model: opus"), {}),
        (lambda t: t.replace("Extracts one record.", "Extracts two records."), "content-differs"),
        (lambda t: t.replace("  - Read\n", "  - Read\n  - Write\n"), "content-differs"),
    ],
    ids=["body", "model", "description", "tools"],
)
def test_a_reduced_agent_goes_stale_only_on_a_frontmatter_edit(tmp_path: Path, edit, expected):
    """The point of #3568: a body-only (or `model:`) edit to an agent the
    router never runs leaves the run log active; a `description` or `tools:`
    edit, which the router reads, does not."""
    repo = _router_repo(tmp_path)
    snap = build_snapshot(skill="router", repo_root=repo)
    path = repo / AGENTS_REL / "record-extractor.md"
    path.write_text(edit(_AGENT_A), encoding="utf-8")

    diff = diff_snapshot_vs_disk(snap, repo)

    key = f"{AGENTS_REL}/record-extractor.md{AGENT_FRONTMATTER_SUFFIX}"
    assert diff == ({} if expected == {} else {key: expected})


def test_a_body_edit_to_an_opted_in_agent_goes_stale(tmp_path: Path):
    repo = _router_repo(tmp_path, run_agents=["record-extractor"])
    snap = build_snapshot(skill="router", repo_root=repo)
    (repo / AGENTS_REL / "record-extractor.md").write_text(
        _AGENT_A.replace("agent body", "a rewritten body"), encoding="utf-8"
    )

    assert diff_snapshot_vs_disk(snap, repo) == {
        f"{AGENTS_REL}/record-extractor.md": "content-differs"
    }


def test_a_deleted_reduced_agent_is_missing_on_disk(tmp_path: Path):
    repo = _router_repo(tmp_path)
    snap = build_snapshot(skill="router", repo_root=repo)
    (repo / AGENTS_REL / "unrelated.md").unlink()

    assert diff_snapshot_vs_disk(snap, repo) == {
        f"{AGENTS_REL}/unrelated.md{AGENT_FRONTMATTER_SUFFIX}": "missing-on-disk"
    }


def test_agent_embed_forms_full_for_own_and_opted_in_reduced_for_the_rest(tmp_path: Path):
    repo = _router_repo(tmp_path, run_agents=["record-extractor"])
    assert agent_embed_forms("router", repo) == {
        "record-extractor": "full",
        "unrelated": "reduced",
    }


def test_agent_embed_forms_for_an_agent_suite_is_its_own_agent_only(tmp_path: Path):
    """An agent suite is run direct-arm: its dispatcher spawns only its own
    agent, so it embeds no other agent, opted in or not."""
    repo = tmp_path
    agents_dir = repo / AGENTS_REL
    agents_dir.mkdir(parents=True)
    (agents_dir / "solo.md").write_text(_AGENT_B.replace("unrelated", "solo"), encoding="utf-8")
    (agents_dir / "other.md").write_text(_AGENT_B, encoding="utf-8")
    (repo / "eval" / "tests" / "unit" / "solo").mkdir(parents=True)

    assert agent_embed_forms("solo", repo) == {"solo": "full"}


# ---- frontmatter fingerprint: shared vectors with snapshot.test.ts --------


def _vectors():
    return json.loads(VECTORS_PATH.read_text(encoding="utf-8"))["vectors"]


@pytest.mark.parametrize("vector", _vectors(), ids=lambda v: v["name"])
def test_frontmatter_fingerprint_vectors(vector):
    """The same vectors drive the TypeScript twin in
    eval/app/tests/unit/snapshot.test.ts; both must produce `expected_text`."""
    text = frontmatter_fingerprint_text(normalize("x.md", vector["input"].encode("utf-8")))
    assert text == vector["expected_text"]
    assert hash_content(text) == vector["expected_digest"]


def test_the_vectors_cover_what_the_spec_names():
    """Anti-vacuity: the cases that once split the two implementations stay in
    the file — a trimmed vector list would pass both sides vacuously."""
    names = {v["name"] for v in _vectors()}
    for required in ("crlf", "lone_cr", "bom_falls_back_to_whole_text",
                     "line_separator_u2028", "next_line_u0085", "form_feed_u000c",
                     "duplicate_key_all_occurrences", "body_edit_keeps_digest",
                     "description_edit_changes_digest", "missing_closing_delimiter"):
        assert required in names


def test_every_real_agent_has_well_formed_frontmatter():
    """No staged agent falls back to whole-file fingerprinting, which would
    quietly make a body edit stale research again."""
    agents = sorted((REPO_ROOT / AGENTS_REL).glob("*.md"))
    assert agents
    for path in agents:
        text = normalize(f"{AGENTS_REL}/{path.name}", path.read_bytes())
        reduced = frontmatter_fingerprint_text(text)
        assert reduced != text, f"{path.name}: no well-formed frontmatter"
        assert reduced.startswith("name: "), path.name


def test_build_snapshot_ignores_missing_referenced_agent(tmp_path: Path):
    """A dangling @plugin: reference (agent file absent) is skipped, not an
    error — the frontmatter lint owns dangling-reference detection."""
    repo = tmp_path
    skill_dir = repo / "packages" / "engine" / "plugin" / "skills" / "router"
    skill_dir.mkdir(parents=True)
    (skill_dir / "SKILL.md").write_text(
        "---\nname: router\n---\nUses `@plugin:ghost`.\n", encoding="utf-8"
    )
    snap = build_snapshot(skill="router", repo_root=repo)
    assert "packages/engine/plugin/agents/ghost.md" not in snap
    assert "packages/engine/plugin/skills/router/SKILL.md" in snap


def test_build_snapshot_excludes_mcp_server_source(tmp_path: Path):
    """MCP source under packages/engine/mcp-server/src/ is NOT embedded.
    The harness serves tool calls from mocks (and live tools run compiled
    build/, not src/), so MCP source is not a dependency of a run. Tool-code
    correctness is Vitest's job, not the runlog snapshot's."""
    repo = tmp_path
    (repo / "packages" / "engine" / "plugin" / "skills" / "x").mkdir(parents=True)
    src_dir = repo / "packages" / "engine" / "mcp-server" / "src"
    tools_dir = src_dir / "tools"
    tools_dir.mkdir(parents=True)
    (tools_dir / "wikipedia.ts").write_text("export const x = 1;\n", encoding="utf-8")
    (src_dir / "constants.ts").write_text("export const UA = 'mozilla';\n", encoding="utf-8")

    snap = build_snapshot(skill="x", repo_root=repo)
    assert "packages/engine/mcp-server/src/tools/wikipedia.ts" not in snap
    assert "packages/engine/mcp-server/src/constants.ts" not in snap


# ---- diff vs disk --------------------------------------------------------


def test_diff_detects_content_change(tmp_path: Path):
    f = tmp_path / "skill.md"
    f.write_text("original\n", encoding="utf-8")
    snapshot = {"skill.md": "original\n"}
    assert diff_snapshot_vs_disk(snapshot, tmp_path) == {}

    f.write_text("edited\n", encoding="utf-8")
    diffs = diff_snapshot_vs_disk(snapshot, tmp_path)
    assert diffs == {"skill.md": "content-differs"}


def test_diff_detects_missing_file(tmp_path: Path):
    snapshot = {"missing.md": "expected\n"}
    diffs = diff_snapshot_vs_disk(snapshot, tmp_path)
    assert diffs == {"missing.md": "missing-on-disk"}


def test_diff_normalizes_before_comparing(tmp_path: Path):
    """A CRLF↔LF change on disk shouldn't flap diff."""
    f = tmp_path / "skill.md"
    f.write_bytes(b"hello\r\n")
    snapshot = {"skill.md": "hello\n"}  # Normalized form
    # Disk's CRLF normalizes to LF → matches snapshot.
    assert diff_snapshot_vs_disk(snapshot, tmp_path) == {}


def test_diff_ignores_legacy_mcp_server_source(tmp_path: Path):
    """Legacy run logs embedded packages/engine/mcp-server/src/**. Those
    keys are skipped so a changed-or-missing MCP source file no longer
    flips the run log inactive."""
    snapshot = {
        "skill.md": "body\n",
        "packages/engine/mcp-server/src/constants.ts": "export const UA = 'old';\n",
    }
    (tmp_path / "skill.md").write_text("body\n", encoding="utf-8")
    # The src/ file is absent on disk AND would differ — yet neither is flagged.
    assert diff_snapshot_vs_disk(snapshot, tmp_path) == {}


def test_diff_refuses_a_traversing_key(tmp_path: Path):
    """A snapshot key is an arbitrary string from a committed run log.

    Parity vector with `diffSnapshotVsDisk` in eval/app/lib/snapshot.ts. Before
    containment the two disagreed on exactly this input: TypeScript refused it
    and reported "missing-on-disk", Python read the outside file and reported
    "content-differs". Neither side had a traversing vector, which is why the
    divergence survived.
    """
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "secret.txt").write_text("SECRET\n", encoding="utf-8")
    repo = tmp_path / "repo"
    repo.mkdir()

    rel = "../outside/secret.txt"
    # The snapshot claims content the outside file really has, so an uncontained
    # read returns {} and a contained one reports it missing. Asserting the
    # SECRET value keeps this from passing for the wrong reason.
    assert diff_snapshot_vs_disk({rel: "SECRET\n"}, repo) == {rel: "missing-on-disk"}


@pytest.mark.skipif(
    os.name == "nt",
    reason=(
        "Creating a symlink on Windows needs SeCreateSymbolicLink (admin or "
        "Developer Mode), so the behaviour cannot be exercised here and "
        "asserting on it would encode the platform's limitation as a failure."
    ),
)
def test_diff_follows_a_symlink_inside_the_base(tmp_path: Path):
    """Containment is LEXICAL on both sides, so a symlink out is still read.

    This is the second half of the parity contract, and the reason this module
    uses `os.path.abspath` rather than `Path.resolve()`: `resolve()` follows
    symlinks and `path.resolve` on the TypeScript side does not. Refusing here
    would trade the traversal divergence for a symlink one. Both sides share
    this gap deliberately — safe-path.ts documents it — and closing it means
    realpath at every sink on both. Pinned so a future change to either side
    cannot quietly break the parity in this direction either.
    """
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "secret.txt").write_text("SECRET\n", encoding="utf-8")
    repo = tmp_path / "repo"
    repo.mkdir()
    (repo / "link.txt").symlink_to(outside / "secret.txt")

    assert diff_snapshot_vs_disk({"link.txt": "SECRET\n"}, repo) == {}
    assert diff_snapshot_vs_disk({"link.txt": "other\n"}, repo) == {
        "link.txt": "content-differs"
    }


# ---- hash_snapshot -------------------------------------------------------


def test_hash_snapshot_returns_per_path_hashes(tmp_path: Path):
    snap = {"a.md": "alpha\n", "b.md": "beta\n"}
    hashes = hash_snapshot(snap)
    assert set(hashes.keys()) == {"a.md", "b.md"}
    assert hashes["a.md"] == hash_content("alpha\n")
    assert hashes["b.md"] == hash_content("beta\n")


def test_expected_outcome_is_not_cosmetic():
    """`expected_outcome` decides whether check_runlogs.py's rule 6 suppresses a
    failing test, so stripping it from the hash would let a marker move without
    staling the skill's run log — silently defeating the gate's suppression field.
    Only the marker's PROSE (`xfail_reason`) is a candidate for this tuple.
    Guarded rather than left as a comment because the comment cannot fail."""
    from harness.snapshot import _COSMETIC_TEST_FIELDS

    assert "expected_outcome" not in _COSMETIC_TEST_FIELDS


# ---- the suite's own agent (issue #1253) ---------------------------------


def test_build_snapshot_embeds_the_suites_own_agent_with_no_skill_dir(tmp_path: Path):
    """An agent-keyed suite: `test.skill` names an agent file and there is no
    skill directory, so the `@plugin:` scan has no SKILL.md to read.

    This is the test that reds without the rule. Without it the snapshot omits
    the very body the suite grades, so editing the agent leaves the run log
    ACTIVE and its grades are quoted forward against prose that changed — a
    suite that cannot go stale is a suite that cannot be trusted.
    """
    repo = tmp_path
    agents_dir = repo / "packages" / "engine" / "plugin" / "agents"
    agents_dir.mkdir(parents=True)
    (agents_dir / "gps-mentor.md").write_text(
        "---\nname: gps-mentor\n---\nagent body\n", encoding="utf-8"
    )
    tests_dir = repo / "eval" / "tests" / "unit" / "gps-mentor"
    tests_dir.mkdir(parents=True)
    (tests_dir / "rubric.md").write_text("# Rubric\n", encoding="utf-8")

    assert not (repo / "packages" / "engine" / "plugin" / "skills" / "gps-mentor").exists()

    snap = build_snapshot(skill="gps-mentor", repo_root=repo)
    assert "packages/engine/plugin/agents/gps-mentor.md" in snap
    assert snap["packages/engine/plugin/agents/gps-mentor.md"] == hash_content(
        "---\nname: gps-mentor\n---\nagent body\n"
    )
    assert "eval/tests/unit/gps-mentor/rubric.md" in snap


def test_build_snapshot_own_agent_is_a_noop_for_a_pair(tmp_path: Path):
    """For a skill-agent pair the `@plugin:` scan already embeds the same path,
    so the rule adds no key and changes no hash.

    That is why it invalidates no existing run log and buys no paid re-run —
    verified across all 27 committed suites, and pinned here.
    """
    repo = tmp_path
    skill_dir = repo / "packages" / "engine" / "plugin" / "skills" / "search-images"
    skill_dir.mkdir(parents=True)
    (skill_dir / "SKILL.md").write_text(
        "---\nname: search-images\n---\nDelegate to `@plugin:search-images`.\n",
        encoding="utf-8",
    )
    agents_dir = repo / "packages" / "engine" / "plugin" / "agents"
    agents_dir.mkdir(parents=True)
    (agents_dir / "search-images.md").write_text(
        "---\nname: search-images\n---\nagent body\n", encoding="utf-8"
    )

    snap = build_snapshot(skill="search-images", repo_root=repo)
    assert [k for k in snap if k.startswith("packages/engine/plugin/agents/")] == [
        "packages/engine/plugin/agents/search-images.md"
    ]


def test_build_snapshot_skill_with_no_same_named_agent_embeds_nothing_extra(tmp_path: Path):
    repo = _skill_repo(tmp_path)
    snap = build_snapshot(skill="s1", repo_root=repo)
    assert not [k for k in snap if k.startswith("packages/engine/plugin/agents/")]

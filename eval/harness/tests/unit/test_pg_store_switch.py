"""`run_tests.py --store pg` (U15's paid half): every live tool call on
PgS3ProjectStore, via `harness/pg_store_prelude.mjs` preloaded into each
`node --eval` by `mock_mcp._run_node_eval`.

The offline cases prove the flag reaches the subprocess, the releasability
decision, the envelope and the log directory. The live cases need the compose
Postgres + MinIO (`make proto-up-store`) and skip without PROTO_PG_DSN.
"""

from __future__ import annotations

import json
import os
import uuid
from pathlib import Path

import pytest

import run_tests
from harness import mock_mcp
from harness.runlog import build_run_log, unit_dir_name, validate_run_log, write_run_log
from harness.versioning import is_releasable_invocation

from tests.unit.test_cli import _stub_anthropic_ok, _stub_log
from tests.unit.test_runlog import _make_entry

STACK_ENV = {
    "PROTO_PG_DSN": "postgresql://postgres:proto@localhost:5434/proto",
    "PROTO_S3_ENDPOINT": "http://localhost:9000",
    "PROTO_S3_ACCESS_KEY": "proto",
    "PROTO_S3_SECRET_KEY": "protoproto",
}


# ---- the subprocess flag ---------------------------------------------------


def test_node_gets_the_prelude_only_under_pg(monkeypatch):
    monkeypatch.delenv("PROTO_STORE", raising=False)
    assert mock_mcp._store_import_args() == []
    monkeypatch.setenv("PROTO_STORE", "fs")
    assert mock_mcp._store_import_args() == []
    monkeypatch.setenv("PROTO_STORE", "pg")
    args = mock_mcp._store_import_args()
    assert args[0] == "--import"
    assert args[1].startswith("file://") and args[1].endswith("/pg_store_prelude.mjs")
    assert mock_mcp.PG_STORE_PRELUDE.is_file()


def test_run_node_eval_passes_it_to_node(monkeypatch):
    seen = {}

    def fake_run(cmd, **kwargs):
        seen["cmd"] = cmd
        class P:
            stdout, stderr, returncode = "", "", 0
        return P()

    monkeypatch.setattr(mock_mcp.subprocess, "run", fake_run)
    monkeypatch.setenv("PROTO_STORE", "pg")
    mock_mcp._run_node_eval("1")
    assert seen["cmd"][:3] == ["node", "--import", mock_mcp.PG_STORE_PRELUDE.as_uri()]
    monkeypatch.delenv("PROTO_STORE")
    mock_mcp._run_node_eval("1")
    assert seen["cmd"][:2] == ["node", "--input-type=module"]


def test_seed_is_a_no_op_on_the_file_store(monkeypatch, tmp_path):
    monkeypatch.delenv("PROTO_STORE", raising=False)
    monkeypatch.setattr(mock_mcp, "_run_node_eval", lambda *a, **k: pytest.fail("node was spawned"))
    mock_mcp.seed_pg_workspace(tmp_path)


def test_a_failed_seed_raises_with_nodes_stderr(monkeypatch, tmp_path):
    class P:
        stdout, stderr, returncode = "", "ECONNREFUSED 127.0.0.1:5434", 1
    monkeypatch.setenv("PROTO_STORE", "pg")
    monkeypatch.setattr(mock_mcp, "_run_node_eval", lambda *a, **k: P())
    with pytest.raises(RuntimeError, match="ECONNREFUSED"):
        mock_mcp.seed_pg_workspace(tmp_path)


# ---- releasability, envelope, directory ------------------------------------


def test_a_pg_run_is_never_releasable():
    assert is_releasable_invocation(mode="skill", has_tag_filter=False) is True
    assert is_releasable_invocation(mode="skill", has_tag_filter=False, store="pg") is False


def test_envelope_records_pg_and_writes_under_unit_pg(tmp_path):
    log = build_run_log(
        skill="skill-a", version=None, released=False, releasable=False,
        invocation="skill", timestamp="2026-10-12_10-30-00", harness_version="0.2.0",
        model="claude-sonnet-4-6", judge_prompt_hash="b" * 64, snapshot={},
        tests=[_make_entry()], store="pg",
    )
    assert log["store"] == "pg"
    validate_run_log(log)
    out = write_run_log(log, runlogs_root=tmp_path, filename="scratch_2026-10-12_10-30-00.json")
    assert out.parent == tmp_path / "unit-pg" / "skill-a"
    assert unit_dir_name(None) == "unit"


def test_envelope_omits_store_on_the_file_store_and_rejects_other_values():
    import jsonschema

    log = build_run_log(
        skill="skill-a", version=None, released=False, releasable=False,
        invocation="skill", timestamp="2026-10-12_10-30-00", harness_version="0.2.0",
        model="claude-sonnet-4-6", judge_prompt_hash="b" * 64, snapshot={},
        tests=[_make_entry()],
    )
    assert "store" not in log
    validate_run_log(log)
    log["store"] = "fs"
    with pytest.raises(jsonschema.ValidationError):
        validate_run_log(log)


# ---- main(), end to end ----------------------------------------------------


def _skill_tree(tmp_path):
    root = tmp_path / "unit"
    skill_dir = root / "skill-a"
    skill_dir.mkdir(parents=True)
    (skill_dir / "rubric.md").write_text(
        "# skill-a\n\n## Dim1\n\n- **pass:** ok\n- **partial:** mid\n- **fail:** no\n",
        encoding="utf-8",
    )
    (skill_dir / "t0.json").write_text(json.dumps({
        "test": {"id": "ut_a_000", "skill": "skill-a", "name": "n",
                  "type": "positive", "description": "x", "tags": []},
        "input": {"user_message": "m", "scenario": None},
        "judge_context": [],
    }), encoding="utf-8")
    return root


@pytest.mark.parametrize("store", ["pg", "fs"])
def test_main_store_end_to_end(tmp_path, monkeypatch, capsys, store):
    """The flag must reach the subprocess environment, the releasability
    decision, the banner, the envelope and the directory."""
    from harness.auth import AuthConfig

    for k, v in STACK_ENV.items():
        monkeypatch.setenv(k, v)
    monkeypatch.delenv("PROTO_STORE", raising=False)
    monkeypatch.delenv("HARNESS_PG_RUN", raising=False)
    root = _skill_tree(tmp_path)
    monkeypatch.setattr(
        run_tests, "resolve_auth",
        lambda: AuthConfig(skill_runner_mode="api_key", api_key="x", detail="stub"),
    )
    _stub_anthropic_ok(monkeypatch)
    env_at_run: list = []
    fault_log_at_run: list = []
    monkeypatch.delenv("HARNESS_PG_FAULT_LOG", raising=False)
    monkeypatch.setattr(
        run_tests, "run_one_test",
        lambda spec, **kw: (env_at_run.append(os.environ.get("PROTO_STORE")),
                            fault_log_at_run.append(os.environ.get("HARNESS_PG_FAULT_LOG")),
                            _stub_log(spec.id, spec.skill, "pass"))[2],
    )
    written: list[tuple[str, dict]] = []

    def fake_write(log, *, runlogs_root, filename, **kwargs):
        written.append((filename, log))
        return Path(runlogs_root) / filename

    monkeypatch.setattr(run_tests, "write_run_log", fake_write)
    monkeypatch.setattr(
        run_tests, "write_partial_runlog",
        lambda log, *, runlogs_root, skill, timestamp: Path(runlogs_root) / f".partial_{timestamp}.json",
    )
    runlogs = tmp_path / "runlogs"
    runlogs.mkdir()
    rc = run_tests.main([
        "--skill", "skill-a", "--tests-dir", str(root), "--runlogs-root", str(runlogs),
        "--store", store,
    ])
    os.environ.pop("PROTO_STORE", None)
    os.environ.pop("HARNESS_PG_RUN", None)
    os.environ.pop("HARNESS_PG_FAULT_LOG", None)

    assert rc == 0
    filename, log = written[0]
    out = capsys.readouterr().out
    if store == "pg":
        assert env_at_run == ["pg"]
        assert fault_log_at_run[0] and fault_log_at_run[0].endswith(".jsonl")
        assert filename.startswith("scratch_")
        assert log["store"] == "pg" and log["releasable"] is False
        assert "store: pg (run " in out
    else:
        assert env_at_run == [None]
        assert filename.startswith("v1_")
        assert "store" not in log


@pytest.mark.parametrize("missing", ["PROTO_PG_DSN", "PROTO_S3_ENDPOINT"])
def test_main_refuses_pg_without_the_stack(tmp_path, monkeypatch, capsys, missing):
    for k, v in STACK_ENV.items():
        monkeypatch.setenv(k, v)
    monkeypatch.setenv(missing, "")
    monkeypatch.setattr(run_tests, "run_one_test", lambda *a, **k: pytest.fail("ran a test"))
    rc = run_tests.main(["--skill", "skill-a", "--tests-dir", str(_skill_tree(tmp_path)), "--store", "pg"])
    assert rc == 2
    assert missing in capsys.readouterr().err
    assert os.environ.get("PROTO_STORE") != "pg"


# ---- live, against the compose stack ---------------------------------------

live = pytest.mark.skipif(
    not os.environ.get("PROTO_PG_DSN") or not mock_mcp._MCP_BUILD.joinpath("store", "pg-s3-project-store.js").exists(),
    reason="needs the compose Postgres + MinIO (make proto-up-store) and PROTO_PG_DSN",
)


@pytest.fixture
def pg_run(monkeypatch):
    for k, v in STACK_ENV.items():
        monkeypatch.setenv(k, os.environ.get(k) or v)
    monkeypatch.setenv("PROTO_STORE", "pg")
    monkeypatch.setenv("HARNESS_PG_RUN", uuid.uuid4().hex)


def _node(script: str) -> dict:
    proc = mock_mcp._run_node_eval(script, timeout=mock_mcp.NODE_EVAL_TIMEOUT_LONG)
    assert proc.returncode == 0, proc.stderr
    return json.loads(proc.stdout)


def _ps_url() -> str:
    return str(mock_mcp._MCP_BUILD / "store" / "project-store.js").replace("\\", "/")


@live
def test_seed_then_tools_read_postgres_and_writes_come_back(tmp_path, pg_run):
    ws = tmp_path / "ws"
    ws.mkdir()
    (ws / "research.json").write_text(json.dumps({"project": {"status": "active"}}), encoding="utf-8")
    (ws / ".claude").mkdir()
    (ws / ".claude" / "settings.json").write_text("{}", encoding="utf-8")
    mock_mcp.seed_pg_workspace(ws)
    w = str(ws).replace("\\", "/")

    # The tools see the seeded file; the staged harness runtime is not project data.
    got = _node(
        f"import {{ getProjectStore }} from '{_ps_url()}'; const s = getProjectStore();"
        f" process.stdout.write(JSON.stringify({{ name: s.constructor.name,"
        f" doc: JSON.parse(await s.readText('{w}', 'research.json')),"
        f" claude: await s.exists('{w}', '.claude/settings.json') }}));"
    )
    assert got == {"name": "WorkspaceMirrorStore", "doc": {"project": {"status": "active"}}, "claude": False}

    # A file the agent writes itself after the seed never reaches the store.
    (ws / "evaluations").mkdir()
    (ws / "evaluations" / "raw.json").write_text('{"raw": 1}', encoding="utf-8")
    got = _node(
        f"import {{ getProjectStore }} from '{_ps_url()}'; const s = getProjectStore();"
        f" await s.writeJson('{w}', 'evaluations/tool.json', {{ tool: 1 }});"
        f" process.stdout.write(JSON.stringify({{ raw: await s.exists('{w}', 'evaluations/raw.json') }}));"
    )
    assert got == {"raw": False}
    # The tool's write came back to the workspace; the agent's own file was left alone.
    assert json.loads((ws / "evaluations" / "tool.json").read_text(encoding="utf-8")) == {"tool": 1}
    assert (ws / "evaluations" / "raw.json").exists()

    # A remove through the store deletes the workspace copy.
    _node(
        f"import {{ getProjectStore }} from '{_ps_url()}';"
        f" await getProjectStore().remove('{w}', 'evaluations/tool.json'); process.stdout.write('{{}}');"
    )
    assert not (ws / "evaluations" / "tool.json").exists()


@live
def test_a_seeded_document_that_is_not_json_fails_the_seed(tmp_path, pg_run):
    (tmp_path / "research.json").write_text("{not json", encoding="utf-8")
    with pytest.raises(RuntimeError, match="'research.json' is not JSON"):
        mock_mcp.seed_pg_workspace(tmp_path)


# ---- store faults from any node process -------------------------------------


def test_pg_store_faults_reads_only_this_workspaces_lines(tmp_path, monkeypatch):
    log = tmp_path / "faults.jsonl"
    ws, other = tmp_path / "ws", tmp_path / "other"
    ws.mkdir(), other.mkdir()
    log.write_text(
        "\n".join([
            json.dumps({"dir": str(ws), "op": "writeBytes", "message": "NoSuchBucket: gone"}),
            json.dumps({"dir": str(other), "op": "readText", "message": "elsewhere"}),
            "not json",
        ]),
        encoding="utf-8",
    )
    monkeypatch.setenv("HARNESS_PG_FAULT_LOG", str(log))
    monkeypatch.delenv("PROTO_STORE", raising=False)
    assert mock_mcp.pg_store_faults(ws) == []
    monkeypatch.setenv("PROTO_STORE", "pg")
    assert mock_mcp.pg_store_faults(ws) == [{"op": "writeBytes", "message": "NoSuchBucket: gone"}]


def test_a_recorded_fault_becomes_a_registered_warning():
    from harness.orchestrator import _build_warnings

    out = _build_warnings([], pg_faults=[{"op": "writeBytes", "message": "NoSuchBucket: gone"}])
    (w,) = [w for w in out if w["kind"] == "pg_store_fault"]
    assert w["faults"] == [{"op": "writeBytes", "message": "NoSuchBucket: gone"}]
    assert not [w for w in _build_warnings([], pg_faults=[]) if w["kind"] == "pg_store_fault"]


@live
def test_the_prelude_records_a_store_fault_but_not_an_ordinary_answer(tmp_path, pg_run, monkeypatch):
    log = tmp_path / "faults.jsonl"
    monkeypatch.setenv("HARNESS_PG_FAULT_LOG", str(log))
    ws = tmp_path / "ws"
    ws.mkdir()
    (ws / "research.json").write_text("{}", encoding="utf-8")
    mock_mcp.seed_pg_workspace(ws)
    w = str(ws).replace("\\", "/")
    # Ordinary answers: an absent ref, and an error the tool's own body throws in a transaction.
    _node(
        f"import {{ getProjectStore }} from '{_ps_url()}'; const s = getProjectStore();"
        f" await s.readText('{w}', 'absent.json').catch(() => {{}});"
        f" await s.withTransaction('{w}', async () => {{ throw new Error('the tool refused'); }}).catch(() => {{}});"
        " process.stdout.write('{}');"
    )
    assert mock_mcp.pg_store_faults(ws) == []
    # A real one: the bucket the blob write needs does not exist.
    monkeypatch.setenv("PROTO_S3_BUCKET", "no-such-bucket-u15")
    _node(
        f"import {{ getProjectStore }} from '{_ps_url()}';"
        f" await getProjectStore().writeBytes('{w}', 'results/x.txt', new Uint8Array([1])).catch(() => {{}});"
        " process.stdout.write('{}');"
    )
    faults = mock_mcp.pg_store_faults(ws)
    assert [f["op"] for f in faults] == ["writeBytes"]
    assert "NoSuchBucket" in faults[0]["message"] or "bucket" in faults[0]["message"].lower()

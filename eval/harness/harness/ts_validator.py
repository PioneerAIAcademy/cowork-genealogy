"""Bridge to the compiled TypeScript project validator (single source of truth).

The Python universal validators check research.json / tree.gedcomx.json against
the JSON Schemas (`schema_validator.py`, jsonschema), which by design cannot
express intra-/cross-document reference integrity — dangling relationship
endpoints, cross-file id references, ancestry cycles. Those checks live only in
the TypeScript `validateParsed`
(`packages/engine/mcp-server/src/validation/validator.ts`). Rather than maintain
a drifting second Python copy, this module drives that single source of truth:
the compiled `validateParsed` in `build/`.

It reuses the `node --input-type=module --eval` pattern already proven by
`mock_mcp._make_validate_handler`, but calls `validateParsed(research, tree)`
with the two parsed objects over stdin and NO projectPath — so it runs research
+ gedcomx + cross-file validation with no disk access and no sidecar-integrity
blast radius.

Returns None (the caller should SKIP, not fail) ONLY when the compiled validator
cannot be run at all — the build is absent, or `node` is not installed. The
build is intentionally not in the run-log snapshot, so a validation *failure* on
an un-built machine would wrongly red the whole suite. But if node runs and then
crashes or fails (non-zero exit, empty/unparseable output, timeout), that is
returned as a validation error and fails loudly — a crash must never be
mistaken for a missing build and silently passed.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from typing import Any

_REPO_ROOT = Path(__file__).resolve().parents[3]
_VALIDATOR_JS = (
    _REPO_ROOT
    / "packages"
    / "engine"
    / "mcp-server"
    / "build"
    / "validation"
    / "validator.js"
)

# validateParsed(research, tree) with no options -> no projectPath -> no disk
# access, no sidecar checks. Errors are {path, message}; flatten to strings.
_NODE_SCRIPT = (
    "import { validateParsed } from '__VALIDATOR_URL__';"
    "let d='';for await (const c of process.stdin) d+=c;"
    "const { research, tree } = JSON.parse(d);"
    "const r = await validateParsed(research, tree);"
    "const errs = (r.errors || []).map(e => typeof e === 'string' ? e"
    " : (e && e.path ? e.path + ': ' + e.message : (e && e.message ? e.message : JSON.stringify(e))));"
    "process.stdout.write(JSON.stringify({ valid: r.valid, errors: errs }));"
)


def validate_parsed(research: Any, tree: Any) -> list[str] | None:
    """Run the compiled `validateParsed(research, tree)` (no projectPath).

    Returns the list of error strings ([] when valid), or None when the compiled
    validator is unavailable and the caller should skip rather than fail.
    """
    if not _VALIDATOR_JS.exists():
        return None

    vjs = str(_VALIDATOR_JS).replace("\\", "/").replace("'", "\\'")
    # Node ESM needs a file:// URL for absolute imports on Windows; a bare
    # drive-letter path fails with ERR_UNSUPPORTED_ESM_URL_SCHEME.
    url = ("file:///" + vjs) if sys.platform == "win32" else vjs
    script = _NODE_SCRIPT.replace("__VALIDATOR_URL__", url)

    try:
        proc = subprocess.run(
            ["node", "--input-type=module", "--eval", script],
            input=json.dumps({"research": research, "tree": tree}),
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=30,
        )
    except FileNotFoundError:
        # `node` is not installed -> the bridge cannot run at all -> skip, like a
        # missing build. Never a silent pass on a real validation problem.
        return None
    except (OSError, subprocess.SubprocessError) as exc:
        # node was invoked but did not complete (timeout, etc.). That is a real
        # failure, not a missing build -> fail loudly.
        return [f"validateParsed bridge did not complete: {exc}"]

    out = (proc.stdout or "").strip()
    if out:
        try:
            result = json.loads(out)
        except json.JSONDecodeError:
            pass  # unparseable output => a crash, handled below
        else:
            return [str(e) for e in (result.get("errors") or [])]

    # The build IS present (checked at the top), yet node produced no parseable
    # output. That is a validator CRASH (e.g. a malformed tree that trips a
    # TypeError in the TS validator), NOT a missing build. Fail loudly with
    # stderr so a crash is never mistaken for "unavailable" and passed
    # (finding 1, #987 review).
    stderr = (proc.stderr or "").strip()[:800]
    return [
        f"validateParsed bridge crashed (node exit {proc.returncode}); "
        f"stderr: {stderr or '(none)'}"
    ]
